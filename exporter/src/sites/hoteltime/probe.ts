import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import chalk from 'chalk';
import { assertControlAllowed } from '../../core/gate.ts';
import { formatDMY, formatISO } from '../../core/order.ts';
import { createRedactor, redactError, type Redactor } from '../../core/redact.ts';
import { thaiToday } from '../../core/thai-time.ts';
import { readWorkbook } from '../../core/xlsx.ts';
import { ConfigError, loadConfig, loadCredentials, type Config, type Credentials } from './config.ts';
import { login, openSession, type Session } from './session.ts';
import {
  controlsOf,
  findDateColumns,
  judgeProbe,
  selectProbeTargets,
  type ProbeObservation,
  type ProbeTarget,
  type ProbeVerdict,
} from './probe-classify.ts';
import { REPORTS } from './reports/index.ts';
import {
  EXPORT_LINK_NAME,
  WebFormsError,
  assertStillLoggedIn,
  clickAndSettle,
  downloadExport,
  isLoginPage,
  setDateRange,
} from './webforms.ts';

/**
 * การตรวจเบื้องต้น (probe — CONTEXT.md) ส่วนที่คุยกับหน้าเว็บ · ticket 09 ของ
 * `.scratch/exporter-daily-expansion-and-data-store/`
 *
 * ต่อหน้า: เปิดหน้า → ตั้งทุกช่วงวันที่เป็น 90 วันล่าสุด (ช่องวันเดี่ยวปล่อยค่าตั้งต้น = วันนี้) → กดปุ่มค้นหา →
 * ถ้ามีปุ่ม export ให้ดาวน์โหลด นับแถว หาคอลัมน์วันที่ · **แตะได้เฉพาะช่วงวันที่กับปุ่มค้นหาของหน้านั้น** ผ่าน
 * ประตูอ่านอย่างเดียว (core/gate.ts) และไม่เปิด 5 หน้าใน EXCLUDED_FROM_PROBE เลย
 *
 * ไฟล์ที่ดาวน์โหลดระหว่างตรวจเป็นข้อมูลจริง (มีชื่อแขก) อยู่ใต้ `recon/captures/probe/` ที่ gitignore —
 * ผลที่ commit ได้คือ `recon/probe-<วันที่>.json` + `recon/PROBE.md` ซึ่งมีแค่ metadata
 */

export type ProbeOptions = {
  readonly headful: boolean;
  readonly json: boolean;
  /** ตรวจเฉพาะหน้าที่ระบุ (href ตามผลการกวาด คั่นด้วยจุลภาค) — ไว้ลองซ้ำหน้าที่สงสัย */
  readonly only?: string;
  /** ไม่ตั้งช่วงวันที่ ใช้ค่าตั้งต้นของหน้า — แยกว่า "ไม่มีข้อมูล" มาจากการตั้ง 90 วันผิดแกน หรือหน้าไม่มีข้อมูลจริง (ticket 22) */
  readonly keepDates?: boolean;
  /** ชื่อไฟล์ผล — ค่าเริ่มต้นเขียนทับ recon/PROBE.md + recon/probe-<วัน>.json · รอบตรวจซ้ำใส่ชื่ออื่นกันทับผลรอบเต็ม */
  readonly outName?: string;
};

type ProbeRow = ProbeObservation & { readonly title: string; readonly result: ProbeVerdict };

const PROBE_DAYS = 90;

/** ผลตรวจของหน้าที่ไปไม่ถึงขั้นดาวน์โหลด — ผู้เรียกเติม error เอง */
const EMPTY_OBS = (target: ProbeTarget): ProbeObservation => ({
  href: target.href, exportLinkCount: 0, exportLinkCountBeforeSearch: 0, formRejected: false, downloaded: false, rows: null,
  dateColumns: [], dateRangeGroups: target.dateRangeGroups, singleDates: target.singleDates, error: null,
});
const DOWNLOAD_TIMEOUT_MS = 60_000;

function slug(href: string): string {
  return href.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** ปุ่มค้นหาของ WebForms มีสองแบบ: `<input>` ธรรมดา กับลิงก์ `__doPostBack('<ชื่อ>')` (หน้ากลุ่ม "อาจมีหลังกดค้นหา") */
async function clickSearch(page: Page, name: string, cfg: Config, allowed: readonly string[], id: string): Promise<void> {
  if ((await page.locator(`input[name="${name}"]`).count()) === 1) {
    await clickAndSettle(page, name, cfg.timeoutMs, allowed, id);
    return;
  }
  assertControlAllowed(allowed, name, id);
  const link = page.locator(`a[href*="__doPostBack('${name}'"]`);
  const n = await link.count();
  if (n !== 1) throw new WebFormsError(`คาดว่าจะเจอปุ่มค้นหา ${name} ชิ้นเดียว แต่เจอ ${n} ชิ้นที่ ${page.url()}`);
  await link.click();
  await page.waitForLoadState('domcontentloaded', { timeout: cfg.timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: cfg.timeoutMs }).catch(() => undefined);
  await assertStillLoggedIn(page);
}

async function probeOne(
  page: Page,
  target: ProbeTarget,
  cfg: Config,
  redact: Redactor,
  downloadDir: string,
  keepDates: boolean,
): Promise<ProbeObservation> {
  const id = `probe:${target.href}`;
  await page.goto(new URL(target.href, `${cfg.baseUrl}/pms/`).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: cfg.timeoutMs }).catch(() => undefined);
  await assertStillLoggedIn(page);

  // อ่าน control สด ๆ จากหน้าจริง — ผลการกวาดของหน้ากลุ่ม "อาจมีหลังกดค้นหา" เก็บแค่ชื่อปุ่ม ไม่มีช่องวันที่
  const inputNames = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input[name]')).map((el) => el.getAttribute('name') ?? ''),
  );
  const live = controlsOf(inputNames);
  const searchButton = target.searchButton ?? live.searchButton;
  const allowed = [...live.dateRangeGroups, ...(searchButton ? [searchButton] : [])];
  const exportLinkCountBeforeSearch = await page.getByRole('link', { name: EXPORT_LINK_NAME }).count();
  const base = {
    href: target.href, dateRangeGroups: live.dateRangeGroups, singleDates: live.singleDates, exportLinkCountBeforeSearch,
  };

  try {
    const to = thaiToday();
    const from = new Date(to.getTime() - (PROBE_DAYS - 1) * 86_400_000);
    if (!keepDates) {
      for (const g of live.dateRangeGroups) await setDateRange(page, g, formatDMY(from), formatDMY(to), allowed, id);
    }
    if (searchButton) await clickSearch(page, searchButton, cfg, allowed, id);

    const formRejected = /mandatory item/i.test(await page.locator('body').innerText().catch(() => ''));
    const exportLinkCount = await page.getByRole('link', { name: EXPORT_LINK_NAME }).count();
    if (formRejected || exportLinkCount !== 1) {
      return {
        ...base, exportLinkCount, formRejected, downloaded: false, rows: null, dateColumns: [],
        error: exportLinkCount > 1 ? `เจอลิงก์ export ${exportLinkCount} ชิ้น` : null,
      };
    }

    const dest = path.join(downloadDir, `${slug(target.href)}.xlsx`);
    try {
      await downloadExport(page, dest, DOWNLOAD_TIMEOUT_MS);
    } catch (err) {
      // ผลว่าง HotelTime ไม่ส่งไฟล์มาเลยทั้งที่ลิงก์ยังอยู่ (webforms.ts) — นับเป็น "ไม่มีข้อมูล" ไม่ใช่ error
      if (err instanceof WebFormsError && /ไม่มีไฟล์ส่งมา/.test(err.message)) {
        return { ...base, exportLinkCount, formRejected, downloaded: false, rows: null, dateColumns: [], error: null };
      }
      throw err;
    }
    // ทุกชีต (แถวแรกของแต่ละชีตคือ header) — หน้าที่แตกหนึ่งชีตต่อกลุ่มต้องนับแถวครบ ไม่ใช่แค่ชีตแรก
    const sheets = readWorkbook(dest);
    const header = sheets[0]?.rows[0] ?? [];
    const data = sheets.flatMap((s) => s.rows.slice(1)).filter((r) => r.some((c) => c.trim() !== ''));
    return {
      ...base, exportLinkCount, formRejected, downloaded: true, rows: data.length,
      dateColumns: findDateColumns(header, data), error: null,
    };
  } catch (err) {
    return {
      ...base, exportLinkCount: 0, formRejected: false, downloaded: false, rows: null, dateColumns: [],
      error: redactError(err, redact),
    };
  }
}

const VERDICT_LABEL: Readonly<Record<ProbeVerdict['verdict'], string>> = {
  pass: '✅ ผ่าน',
  'no-data': '⚪ ไม่มีข้อมูล',
  'no-export': '⚪ ไม่มีปุ่ม export',
  undetermined: '🟡 ต้องให้คนตัดสิน',
};
const MODE_LABEL = { ledger: 'ledger ย้อน 3 วัน', snapshot: 'ภาพของวันนั้น', whole: 'ภาพรวมทั้งก้อน' } as const;

function renderMarkdown(rows: readonly ProbeRow[], probedAt: string, keepDates: boolean): string {
  const order: ProbeVerdict['verdict'][] = ['pass', 'undetermined', 'no-data', 'no-export'];
  const count = (v: ProbeVerdict['verdict']) => rows.filter((r) => r.result.verdict === v).length;
  const lines = [
    '# ผลการตรวจเบื้องต้น HotelTime',
    '',
    `ตรวจเมื่อ ${probedAt} · ${rows.length} หน้า · ช่วงที่ลองค้น ${keepDates ? 'ค่าตั้งต้นของแต่ละหน้า (--keep-dates)' : `${PROBE_DAYS} วันล่าสุด`} · สร้างโดย \`exporter probe\``,
    '(ticket 09 ของ `.scratch/exporter-daily-expansion-and-data-store/` — คำว่า "การตรวจเบื้องต้น" ดู CONTEXT.md)',
    '',
    `ผ่าน ${count('pass')} · ต้องให้คนตัดสิน ${count('undetermined')} · ไม่มีข้อมูล ${count('no-data')} · ไม่มีปุ่ม export ${count('no-export')}`,
    '',
    '| ผล | หน้า | path | แบบรอบรายวัน | แถว | คอลัมน์วันที่ | เหตุผล |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const v of order) {
    for (const r of rows.filter((x) => x.result.verdict === v)) {
      const mode = r.result.verdict === 'pass' ? MODE_LABEL[r.result.dailyMode] : '—';
      const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(
        `| ${VERDICT_LABEL[v]} | ${cell(r.title || '(ไม่มีชื่อ)')} | \`${cell(r.href)}\` | ${mode} | ${r.rows ?? '—'} | ${cell(r.dateColumns.join(', ') || '—')} | ${cell(r.result.reason)} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

export async function runProbe(opts: ProbeOptions): Promise<number> {
  let redact: Redactor = createRedactor([]);
  try {
    const cfg = loadConfig();
    const creds: Credentials = loadCredentials();
    redact = createRedactor([creds.password, creds.username]);

    const sweep = JSON.parse(await readFile(path.join(cfg.projectRoot, 'recon', 'menu-sweep.json'), 'utf8'));
    let targets = selectProbeTargets(sweep, REPORTS.map((r) => r.path));
    if (opts.only !== undefined) {
      const wanted = new Set(opts.only.split(',').map((h) => h.trim()));
      targets = targets.filter((t) => wanted.has(t.href));
    }
    if (targets.length === 0) throw new ConfigError(`ไม่มีหน้าให้ตรวจ${opts.only ? ` (ไม่รู้จัก "${opts.only}" หรืออยู่ในรายการที่ตัดออก)` : ''}`);

    const downloadDir = path.join(cfg.captureDir, 'probe');
    await mkdir(downloadDir, { recursive: true });
    if (!opts.json) console.log(`${chalk.dim('หน้าที่จะตรวจ')}  ${targets.length} หน้า — อ่านอย่างเดียว ไม่เปิด 5 หน้าที่ห้ามตรวจ\n`);

    const session: Session = await openSession({ ...cfg, headless: opts.headful ? false : cfg.headless });
    const rows: ProbeRow[] = [];
    try {
      await login(session, cfg, creds, redact);
      for (const [i, target] of targets.entries()) {
        let obs: ProbeObservation;
        const sessionLost = (text: string | null) => text !== null && /session หลุด/.test(text);
        try {
          obs = await probeOne(session.page, target, cfg, redact, downloadDir, opts.keepDates ?? false).catch((err: unknown) => {
            if (!sessionLost(err instanceof Error ? err.message : null)) throw err;
            return { ...EMPTY_OBS(target), error: 'session หลุด' };
          });
          // session หลุดกลางทาง (ASP.NET หมดอายุเอง) — ล็อกอินใหม่แล้วลองหน้านี้ซ้ำครั้งเดียว
          if (sessionLost(obs.error)) {
            await login(session, cfg, creds, redact);
            obs = await probeOne(session.page, target, cfg, redact, downloadDir, opts.keepDates ?? false);
          }
        } catch (err) {
          // หน้าเดียวพัง (รวม re-login ที่ล้ม) ต้องไม่ทิ้งผลของทุกหน้าที่ตรวจไปแล้ว
          obs = { ...EMPTY_OBS(target), error: redactError(err, redact) };
          if (isLoginPage(session.page.url())) await login(session, cfg, creds, redact).catch(() => undefined);
        }
        // หน้าที่ล้มอาจทิ้ง navigation ค้างไว้ — ถ้าไม่ล้างก่อน ทุกหน้าถัดไปจะล้มด้วย "interrupted by another navigation"
        // (เจอจริง 2026-10-08: เน็ตสลับกลางรอบ ERR_NETWORK_CHANGED แล้ว 13 หน้าที่เหลือล้มตามกันหมด)
        if (obs.error !== null) await session.page.goto('about:blank').catch(() => undefined);
        const result = judgeProbe(obs);
        rows.push({ ...obs, title: target.title, result });
        if (!opts.json) {
          const mode = result.verdict === 'pass' ? ` · ${MODE_LABEL[result.dailyMode]}` : '';
          console.log(`${chalk.dim(`[${i + 1}/${targets.length}]`)} ${VERDICT_LABEL[result.verdict]}${mode}  ${target.href}  ${chalk.dim(result.reason)}`);
        }
      }
    } finally {
      await session.close();
    }

    const probedAt = new Date().toISOString();
    const day = formatISO(thaiToday());
    const base = opts.outName ?? 'PROBE';
    const jsonPath = path.join(cfg.projectRoot, 'recon', `${base.toLowerCase()}-${day}.json`);
    const mdPath = path.join(cfg.projectRoot, 'recon', `${base}.md`);
    await writeFile(jsonPath, `${JSON.stringify({ probedAt, probeDays: PROBE_DAYS, pages: rows }, null, 1)}\n`, 'utf8');
    await writeFile(mdPath, renderMarkdown(rows, probedAt, opts.keepDates ?? false), 'utf8');

    const pass = rows.filter((r) => r.result.verdict === 'pass').length;
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, code: 'probed', total: rows.length, pass, jsonPath, mdPath }, null, 2));
    } else {
      console.log(`\n${chalk.dim('ผ่าน')} ${pass}/${rows.length}  ${chalk.dim('ตาราง')} ${mdPath}`);
    }
    return 0;
  } catch (err) {
    const isConfig = err instanceof ConfigError;
    const text = isConfig ? redact((err as Error).message) : redactError(err, redact);
    if (opts.json) console.log(JSON.stringify({ ok: false, code: isConfig ? 'config' : 'probe_failed', text }, null, 2));
    else console.error(`${chalk.red('✘ ไม่สำเร็จ')}\n${text}`);
    return 1;
  }
}
