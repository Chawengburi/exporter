import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import chalk from 'chalk';
import { createRedactor, redactError, type Redactor } from '../../core/redact.ts';
import { ConfigError, loadConfig, loadCredentials, type Config, type Credentials } from './config.ts';
import { login, openSession } from './session.ts';
import { EXPORT_LINK_NAME, isLoginPage } from './webforms.ts';
import { buildSweepReport, classifyPage, type PageProbe, type PageSummary } from './sweep-classify.ts';

export type SweepOptions = {
  readonly headful: boolean;
  readonly json: boolean;
  /** path เต็มของไฟล์ผลลัพธ์ — ค่าเริ่มต้น recon/menu-sweep.json */
  readonly out?: string;
};

export type SweepResult = {
  readonly outPath: string;
  readonly total: number;
  readonly reachable: number;
  readonly unreachable: number;
  readonly withExportLink: number;
  readonly withMandatoryField: number;
};

/**
 * เดินหน้า Welcomepage.aspx แล้วเก็บลิงก์ใต้ `/pms/` ทั้งหมดแบบไม่กรองชื่อ
 * (ต่างจาก recon/MENU.md เดิมที่กรองเฉพาะคำว่า report/overview/stats)
 *
 * ตัดลิงก์ logout ออกโดยตั้งใจ — พลาดคลิกจะจบ session กลางทางแล้วพา 200 กว่าหน้าที่เหลือล้มหมด
 */
async function discoverMenuLinks(page: Page, baseUrl: string): Promise<string[]> {
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.length > 0),
  );

  const seen = new Set<string>();
  const links: string[] = [];
  for (const href of hrefs) {
    let url: URL;
    try {
      url = new URL(href, `${baseUrl}/pms/`);
    } catch {
      continue;
    }
    if (!/\/pms\//i.test(url.pathname)) continue;
    // 🔴 เช็คทั้ง pathname และ query — พบจริง 2026-09-17 ว่า login/login.aspx?logout=yes
    // ใส่คำว่า logout ไว้ใน query ไม่ใช่ path เช็คแค่ pathname จึงหลุดแล้วไปเปิดหน้า logout เอง
    // กลางการกวาด ทำให้ session หลุดจริงและพาหน้าถัดไปล้มเป็นโดมิโน
    if (/logout/i.test(url.pathname + url.search)) continue;

    const key = url.pathname.toLowerCase() + url.search.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(url.pathname.replace(/^\/pms\//i, '') + url.search);
  }
  return links;
}

async function writeSweepOutput(
  outPath: string,
  baseUrl: string,
  summaries: readonly PageSummary[],
  complete: boolean,
): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify(
      {
        _comment: complete
          ? 'ผลการกวาดเมนูแบบอ่านอย่างเดียว ไม่ผ่าน recon เชิงลึก — ดู docs/adr/0001-recon-is-a-script-sweep.md'
          : 'checkpoint ระหว่างกวาด — ยังไม่ครบ ดู sweptAt/total เทียบกับจำนวนลิงก์ที่เจอจริง',
        sweptAt: new Date().toISOString(),
        complete,
        baseUrl,
        ...buildSweepReport(summaries),
      },
      null,
      1,
    ),
    'utf8',
  );
}

/** อ่านโครงหน้าเดียว — ไม่คลิก ไม่กรอกอะไรทั้งสิ้น มีแค่ goto() กับการอ่าน DOM */
async function probePage(page: Page, href: string, baseUrl: string, timeoutMs: number): Promise<PageProbe> {
  try {
    await page.goto(new URL(href, `${baseUrl}/pms/`).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);

    if (isLoginPage(page.url())) {
      return { href, reachable: false, errorMessage: 'session หลุด — โดนเด้งกลับหน้า login' };
    }

    const title = await page.title();
    const exportLinkCount = await page.getByRole('link', { name: EXPORT_LINK_NAME }).count();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const hasMandatoryMarker = /mandatory item/i.test(bodyText);
    const inputNames = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[name]')).map((el) => el.getAttribute('name') ?? ''),
    );
    // ปุ่มแบบลิงก์ `javascript:__doPostBack('<target>', ...)` — อ่านอย่างเดียว ไม่คลิก (ADR-0001)
    const postbackTargets = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href^="javascript:__doPostBack"]'))
        .map((a) => /__doPostBack\('([^']+)'/.exec(a.getAttribute('href') ?? '')?.[1] ?? '')
        .filter((t) => t !== ''),
    );

    return { href, reachable: true, title, exportLinkCount, hasMandatoryMarker, inputNames, postbackTargets };
  } catch (err) {
    return { href, reachable: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

export async function runSweep(opts: SweepOptions): Promise<number> {
  let redact: Redactor = createRedactor([]);

  try {
    const cfg: Config = loadConfig();
    const creds: Credentials = loadCredentials();
    redact = createRedactor([creds.password, creds.username]);

    const session = await openSession({ ...cfg, headless: opts.headful ? false : cfg.headless });
    let summaries: PageSummary[];

    try {
      await login(session, cfg, creds, redact);
      const { page } = session;

      await page.goto(new URL('Welcomepage.aspx', `${cfg.baseUrl}/pms/`).toString(), {
        waitUntil: 'domcontentloaded',
      });
      const links = await discoverMenuLinks(page, cfg.baseUrl);

      if (!opts.json) {
        console.log(`${chalk.dim('เจอลิงก์ใต้ /pms/ ไม่ซ้ำ')}  ${links.length} หน้า`);
        console.log(chalk.dim('เริ่มกวาด — อ่านอย่างเดียว ไม่คลิกไม่กรอก\n'));
      }

      summaries = [];
      let reLoginUsed = false;
      const checkpointOutPath = opts.out ?? path.join(cfg.projectRoot, 'recon', 'menu-sweep.json');

      for (const [i, href] of links.entries()) {
        let probe: PageProbe;
        try {
          probe = await probePage(page, href, cfg.baseUrl, cfg.timeoutMs);

          // session อาจหลุดกลางทางจากอายุ ASP.NET session — ลองล็อกอินใหม่ "ครั้งเดียว" ต่อทั้ง
          // การกวาด แล้วลองหน้านี้ซ้ำ ถ้ายังพังอีกให้ยอมแพ้หน้านี้ ไม่วนซ้ำจนไม่จบ
          if (!probe.reachable && probe.errorMessage?.includes('session หลุด') && !reLoginUsed) {
            reLoginUsed = true;
            await login(session, cfg, creds, redact);
            probe = await probePage(page, href, cfg.baseUrl, cfg.timeoutMs);
          }
        } catch (err) {
          // 🔴 ห้ามให้ error ของหน้าเดียว (รวมถึง re-login ที่ล้มเอง เช่น uniqueByRole
          // ปฏิเสธเพราะเจอ repeater ผู้ใช้ล่าสุดหลายแถว) พังทั้งลูป — ไม่งั้นผลของทุกหน้า
          // ที่กวาดไปแล้วก่อนหน้านั้นหายเงียบ ๆ ขัดกับเกณฑ์ "ไม่ข้ามเงียบ" ของ ticket นี้เอง
          probe = { href, reachable: false, errorMessage: err instanceof Error ? err.message : String(err) };
        }

        const summary = classifyPage(probe);
        summaries.push(summary);

        if (!opts.json) {
          const tag = !summary.reachable
            ? chalk.red('✘ เปิดไม่ได้')
            : summary.hasExportLink
              ? chalk.green('✔ มี export')
              : chalk.dim('  ไม่มี export');
          console.log(`${chalk.dim(`[${i + 1}/${links.length}]`)} ${tag}  ${href}`);
        }

        // เขียน checkpoint ทุก 20 หน้า — กันกรณีที่ไม่คาดคิดจริง ๆ (เช่น เบราว์เซอร์ค้าง)
        // พังทั้งโปรเซสแล้วผลที่กวาดมาแล้วหายไปทั้งหมด
        if ((i + 1) % 20 === 0) {
          await writeSweepOutput(checkpointOutPath, cfg.baseUrl, summaries, false);
        }
      }
    } finally {
      await session.close();
    }

    const outPath = opts.out ?? path.join(cfg.projectRoot, 'recon', 'menu-sweep.json');
    await writeSweepOutput(outPath, cfg.baseUrl, summaries, true);

    const result: SweepResult = {
      outPath,
      total: summaries.length,
      reachable: summaries.filter((s) => s.reachable).length,
      unreachable: summaries.filter((s) => !s.reachable).length,
      withExportLink: summaries.filter((s) => s.hasExportLink).length,
      withMandatoryField: summaries.filter((s) => s.hasMandatoryField).length,
    };

    if (opts.json) {
      console.log(JSON.stringify({ ok: true, code: 'swept', ...result }, null, 2));
    } else {
      console.log();
      console.log(chalk.dim('═'.repeat(60)));
      console.log(`${chalk.dim('หน้าทั้งหมด')}      ${result.total}`);
      console.log(`${chalk.dim('เปิดได้')}          ${result.reachable}`);
      console.log(`${chalk.dim('เปิดไม่ได้')}       ${result.unreachable}`);
      console.log(`${chalk.dim('มีปุ่ม export')}    ${result.withExportLink}`);
      console.log(`${chalk.dim('มีฟิลด์บังคับ')}    ${result.withMandatoryField}`);
      console.log(`${chalk.dim('บันทึกไว้ที่')}     ${outPath}`);
    }

    return 0;
  } catch (err) {
    const isConfig = err instanceof ConfigError;
    const text = isConfig ? redact((err as Error).message) : redactError(err, redact);
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, code: isConfig ? 'config' : 'sweep_failed', text }, null, 2));
    } else {
      console.error(`${chalk.red('✘ ไม่สำเร็จ')}\n${text}`);
    }
    return 1;
  }
}
