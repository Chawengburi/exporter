/**
 * ทดลอง ticket 06 ของ `.scratch/exporter-hoteltime-4h-rounds/` — อ่านอย่างเดียว ไม่เขียนลง data/ ไม่ส่ง uploader
 *
 * โหมด (argv[2]):
 *   shared <YYYY-MM-DD> [N=8]   login ครั้งเดียว แล้วดึง per-day N รายงานของวันนั้นต่อเนื่องใน session เดียว
 *   fresh  <YYYY-MM-DD> [N=8]   เปิดเบราว์เซอร์ + login ใหม่ต่อรายงาน (แบบโค้ดปัจจุบัน) N รายงานเดียวกัน
 *   rapid  [N=10]               login อย่างเดียว N ครั้งติดกัน (ปิดเบราว์เซอร์ทุกครั้ง) ดูว่าโดนจำกัดไหม
 *   countdown <YYYY-MM-DD>      login → อ่านตัวนับ "You will be logged out due to inactivity HH:MM:SS" ในหน้า (เริ่มต้น / หลังรอ 30 วินาที / หลังโหลดหน้าใหม่)
 *   idle   <YYYY-MM-DD> <นาที>  login → ดึง 1 รายงาน → ว่างไว้ตามนาที → ดึงอีกรายงาน (session ฝั่ง server หมดอายุไหม)
 *
 * 🔴 พิมพ์เฉพาะ id รายงาน เวลา จำนวนไฟล์/ไบต์ ผ่าน-ล้ม — ไม่พิมพ์เนื้อไฟล์ ชื่อ หรือรหัสผ่าน · ไฟล์ที่ดึงลงโฟลเดอร์ชั่วคราวและลบทิ้ง
 * ใช้: node recon/hoteltime-login-session-experiment.ts shared 2026-11-16 8
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRedactor, redactError } from '../src/core/redact.ts';
import { parseISODate } from '../src/core/order.ts';
import { loadConfig, loadCredentials, type Config } from '../src/sites/hoteltime/config.ts';
import { REPORTS } from '../src/sites/hoteltime/reports/index.ts';
import type { Report } from '../src/sites/hoteltime/reports/_types.ts';
import { login, openSession, type Session } from '../src/sites/hoteltime/session.ts';
import { assertFormAccepted, clickAndSettle, downloadExport } from '../src/sites/hoteltime/webforms.ts';

const [mode = '', arg1 = '', arg2 = ''] = process.argv.slice(2);
const cfg = loadConfig();
const creds = loadCredentials();
const redact = createRedactor([creds.username, creds.password]);
const ms = (t0: number) => Math.round(Date.now() - t0);
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));

/** รายงาน per-day ที่ดึงด้วยปุ่ม export จริง (ไม่ scrape ไม่ dailyOnly) เรียงตามลำดับใน REPORTS */
function perDayReports(n: number): Report[] {
  return REPORTS.filter((r) => r.family === 'per-day' && !r.dailyOnly && r.scrape === undefined).slice(0, n);
}

/** สำเนาเฉพาะส่วนที่จำเป็นของ fetchChunk (ไม่ตรวจเนื้อไฟล์) — วัดเวลาและว่า session ยังอยู่ */
async function fetchOne(session: Session, c: Config, report: Report, day: Date, dir: string): Promise<{ result: string; bytes: number }> {
  const { page } = session;
  await page.goto(new URL(report.path, `${c.baseUrl}/pms/`).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await report.applyFilters(page, { from: day, to: day });
  await clickAndSettle(page, report.searchButton, c.timeoutMs, report.allowedControls, report.id);
  await assertFormAccepted(page);
  if (!(await report.hasResults(page))) return { result: 'empty', bytes: 0 };
  const dest = path.join(dir, `${report.id}.xlsx`);
  await downloadExport(page, dest, c.timeoutMs, report.exportLink);
  return { result: 'data', bytes: (await stat(dest)).size };
}

async function timed(label: string, fn: () => Promise<{ result: string; bytes: number }>): Promise<number> {
  const t0 = Date.now();
  try {
    const r = await fn();
    log({ report: label, ms: ms(t0), ...r });
  } catch (err) {
    log({ report: label, ms: ms(t0), result: 'FAILED', error: redactError(err, redact).split('\n')[0] });
  }
  return ms(t0);
}

const day = parseISODate(arg1);
const dir = await mkdtemp(path.join(tmpdir(), 'ht-login-exp-'));
try {
  if (mode === 'shared' || mode === 'fresh') {
    if (day === null) throw new Error('ระบุวัน YYYY-MM-DD เป็น argv[3]');
    const reports = perDayReports(Number(arg2 || 8));
    const t0 = Date.now();
    let logins = 0;
    if (mode === 'shared') {
      const session = await openSession(cfg);
      try {
        const tl = Date.now();
        await login(session, cfg, creds, redact);
        logins += 1;
        log({ step: 'login', ms: ms(tl) });
        for (const r of reports) await timed(r.id, () => fetchOne(session, cfg, r, day, dir));
      } finally {
        await session.close();
      }
    } else {
      for (const r of reports) {
        const session = await openSession(cfg);
        try {
          const tl = Date.now();
          await login(session, cfg, creds, redact);
          logins += 1;
          log({ step: 'login', ms: ms(tl) });
          await timed(r.id, () => fetchOne(session, cfg, r, day, dir));
        } finally {
          await session.close();
        }
      }
    }
    log({ mode, reports: reports.length, logins, totalMs: ms(t0) });
  } else if (mode === 'rapid') {
    const n = Number(arg1 || 10);
    for (let i = 1; i <= n; i += 1) {
      const t0 = Date.now();
      const session = await openSession(cfg);
      try {
        await login(session, cfg, creds, redact);
        log({ attempt: i, result: 'ok', ms: ms(t0) });
      } catch (err) {
        log({ attempt: i, result: 'FAILED', ms: ms(t0), error: redactError(err, redact).split('\n')[0] });
      } finally {
        await session.close();
      }
    }
  } else if (mode === 'countdown') {
    if (day === null) throw new Error('ระบุวัน YYYY-MM-DD เป็น argv[3]');
    const [first] = perDayReports(1);
    if (first === undefined) throw new Error('ไม่พบรายงาน per-day');
    const read = async (page: Session['page']): Promise<string> => {
      const text = await page.evaluate(() => document.body.innerText);
      return /logged out due to inactivity\s*([0-9]{1,2}:[0-9]{2}:[0-9]{2})/i.exec(text)?.[1] ?? '(ไม่พบข้อความ)';
    };
    const session = await openSession(cfg);
    try {
      await login(session, cfg, creds, redact);
      log({ step: 'หลัง login', countdown: await read(session.page), url: new URL(session.page.url()).pathname });
      await session.page.goto(new URL(first.path, `${cfg.baseUrl}/pms/`).toString(), { waitUntil: 'domcontentloaded' });
      log({ step: 'หน้ารายงานทันที', countdown: await read(session.page) });
      await new Promise((r) => setTimeout(r, 30_000));
      log({ step: 'หลังรอ 30 วินาที (ไม่ทำอะไร)', countdown: await read(session.page) });
      await session.page.goto(new URL(first.path, `${cfg.baseUrl}/pms/`).toString(), { waitUntil: 'domcontentloaded' });
      log({ step: 'โหลดหน้าใหม่', countdown: await read(session.page) });
    } finally {
      await session.close();
    }
  } else if (mode === 'idle') {
    if (day === null) throw new Error('ระบุวัน YYYY-MM-DD เป็น argv[3]');
    const minutes = Number(arg2 || 10);
    const [first, second] = perDayReports(2);
    if (first === undefined || second === undefined) throw new Error('ไม่พบรายงาน per-day พอ');
    const session = await openSession(cfg);
    try {
      await login(session, cfg, creds, redact);
      await timed(first.id, () => fetchOne(session, cfg, first, day, dir));
      log({ step: 'idle', minutes });
      await new Promise((r) => setTimeout(r, minutes * 60_000));
      await timed(`${second.id} (after ${minutes} min idle)`, () => fetchOne(session, cfg, second, day, dir));
    } finally {
      await session.close();
    }
  } else {
    throw new Error('โหมดไม่ถูกต้อง: shared | fresh | rapid | countdown | idle');
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
