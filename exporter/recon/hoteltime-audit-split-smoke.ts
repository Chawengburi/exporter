/**
 * smoke ของ ticket 04 (exporter-audit-trail) กับหน้า Audit จริง — อ่านอย่างเดียว (ปุ่มที่กดมีแค่ Search ผ่านตัวเดียวกับของจริง)
 *
 * 1. ดึงทั้งวัน D ปกติ → N แถว
 * 2. ดึงซ้ำด้วย "เพดานจำลองต่ำ" (SMOKE_CAP) ให้ตัวแบ่งช่วงทำงานจริงกับหน้าจริง → ต้องได้แถวเท่ากันทั้งชุด (นับ + เนื้อหาเทียบด้วย hash ในหน่วยความจำ)
 * 3. ช่วงย่อย 1 ชั่วโมงที่ไม่มีแถวเลย: หน้าจริงยังมีตารางอยู่ไหม (ความเสี่ยง "ตารางหายเมื่อว่าง" ของ fetchScraped)
 *
 * 🔴 พิมพ์เฉพาะจำนวน/ผ่าน-ไม่ผ่าน ห้ามพิมพ์เนื้อแถว · ใช้: node recon/hoteltime-audit-split-smoke.ts YYYY-MM-DD [SMOKE_CAP]
 */
import { createHash } from 'node:crypto';
import { createRedactor, redactError } from '../src/core/redact.ts';
import { parseISODate } from '../src/core/order.ts';
import { fetchSplitTable } from '../src/core/scraped-split.ts';
import { loadConfig, loadCredentials } from '../src/sites/hoteltime/config.ts';
import { auditTrail } from '../src/sites/hoteltime/reports/audit-trail.ts';
import { login, openSession } from '../src/sites/hoteltime/session.ts';
import { assertFormAccepted, clickAndSettle, readGridText } from '../src/sites/hoteltime/webforms.ts';

const DAY = process.argv[2] ?? '';
const SMOKE_CAP = Number(process.argv[3] ?? 60);
const day = parseISODate(DAY);
if (day === null) throw new Error('ระบุวัน YYYY-MM-DD เป็น argv[2]');

const cfg = loadConfig();
const creds = loadCredentials();
const redact = createRedactor([creds.username, creds.password]);
const session = await openSession(cfg);
const out: Record<string, unknown> = { day: DAY, smokeCap: SMOKE_CAP };
try {
  await login(session, cfg, creds, redact);
  const { page } = session;
  const scrape = auditTrail.scrape!;
  const open = async () => {
    await page.goto(new URL(auditTrail.path, `${cfg.baseUrl}/pms/`).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
  };
  const search = async () => {
    await clickAndSettle(page, auditTrail.searchButton, cfg.timeoutMs, auditTrail.allowedControls, auditTrail.id);
    await assertFormAccepted(page);
  };
  const window = async (start: number, end: number): Promise<{ table: string[][] | null }> => {
    await scrape.applyWindow!(page, day, start, end);
    await search();
    return { table: await readGridText(page, scrape.gridIdPart) };
  };

  // 1) ทั้งวันแบบของจริง
  await open();
  const whole = (await window(0, 1440)).table;
  if (whole === null) throw new Error('ไม่พบตารางทั้งวัน');
  out.wholeDayRows = whole.length - 1;

  // 2) บังคับแบ่งช่วงด้วยเพดานจำลอง
  const calls: string[] = [];
  const merged = await fetchSplitTable({
    expectedHeader: auditTrail.expectedColumns, dateColumn: auditTrail.dateColumn, rowCap: SMOKE_CAP,
    fetchWindow: async (s, e) => {
      calls.push(`${s}-${e}`);
      await open();
      const r = (await window(s, e)).table;
      if (r === null) throw new Error(`ช่วง ${s}-${e}: ไม่พบตาราง`);
      return r;
    },
  });
  out.splitCalls = calls.length;
  out.splitWindows = calls;
  out.splitRows = merged.length - 1;
  const sig = (t: readonly (readonly string[])[]) =>
    t.slice(1).map((r) => createHash('sha256').update(r.join('\u0001')).digest('hex')).sort().join('');
  out.countEqual = merged.length === whole.length;
  out.contentEqual = sig(merged) === sig(whole);
  out.sameOrder = JSON.stringify(merged) === JSON.stringify(whole);

  // 3) ช่วง 1 ชั่วโมงที่ว่าง: ตารางยังอยู่ไหม
  const perHour: { hour: number; rows: number | 'no-table' }[] = [];
  for (let h = 0; h < 24; h++) {
    await open();
    const t = (await window(h * 60, h * 60 + 60)).table;
    perHour.push({ hour: h, rows: t === null ? 'no-table' : t.length - 1 });
  }
  out.perHourRows = perHour.map((x) => `${x.hour}:${x.rows}`).join(' ');
  out.perHourSum = perHour.reduce((a, x) => a + (typeof x.rows === 'number' ? x.rows : 0), 0);
  out.emptyHours = perHour.filter((x) => x.rows === 0).length;
  out.emptyHourHasNoTable = perHour.filter((x) => x.rows === 'no-table').length;
} catch (e) {
  out.error = redactError(e, redact);
} finally {
  await session.browser.close().catch(() => undefined);
}
console.log(JSON.stringify(out, null, 2));
