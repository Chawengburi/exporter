/**
 * recon แบบอ่านอย่างเดียวของ HotelTime — คำถามเรื่องความสมบูรณ์ของข้อมูล in-house — รอบสอง: เจาะ Audit trail (ชื่อ Operation ของการ check-in, ช่วงเวลาที่เกิด, ระยะจองถึงเข้าพัก)
 *
 *   Q1  หน้า in-house / arrivals / departures เลือก "วันที่ย้อนหลัง" แล้วผลเป็นอย่างไร (ADR-0003 สรุปไว้ว่าไม่มีความหมาย — ลองจริง)
 *   Q2  Audit trail (specs/07) ต่อวัน: แถวไม่ชนเพดาน 500 ไหม · ชื่อ Operation จริง · check-in เกิดชั่วโมงไหนบ้าง (24 ชั่วโมงจริงหรือไม่)
 *       · จองแล้ว check-in ภายในไม่กี่นาที (walk-in จองผ่านแอป) มีไหม · ไล่เหตุการณ์ของ reservation 603444268 (handoff: 10:14 ย้ายห้อง, 14:15 check-in)
 *
 * 🔴 อ่านอย่างเดียว: คลิกได้แค่ปุ่ม Search (`btnFind`) ห้ามแตะ `Reset filter` / ปุ่มในตาราง (ADR-0001) · ไม่พิมพ์/ไม่เก็บชื่อแขก — ผลที่ออกเป็นตัวเลขรวมและเวลาเท่านั้น
 * ผลลัพธ์ลงไฟล์ที่ระบุใน argv[2] (ไม่ลง repo)
 *
 * ใช้: node recon/hoteltime-completeness-recon.ts <ไฟล์ผลลัพธ์.json>
 */
import { writeFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { createRedactor, redactError } from '../src/core/redact.ts';
import { thaiClock } from '../src/core/thai-time.ts';
import { loadConfig, loadCredentials } from '../src/sites/hoteltime/config.ts';
import { login, openSession } from '../src/sites/hoteltime/session.ts';

const OUT = process.argv[2];
if (!OUT) throw new Error('ระบุไฟล์ผลลัพธ์เป็น argv[2]');

const pad = (n: number) => String(n).padStart(2, '0');
const dmy = (d: Date) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const c = thaiClock(new Date());
const TODAY = new Date(Date.UTC(c.year, c.month - 1, c.day));
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);

async function fill(page: Page, name: string, value: string): Promise<void> {
  const el = page.locator(`input[name="${name}"]`);
  if ((await el.count()) !== 1) throw new Error(`ไม่พบช่อง ${name} ชิ้นเดียวที่ ${new URL(page.url()).pathname}`); // เฉพาะ path ไม่มี query
  await el.fill(value);
  await el.dispatchEvent('change');
}

async function search(page: Page): Promise<void> {
  await page.locator('input[name="ctl00$pc$btnFind"], [name="ctl00$pc$btnFind"]').first().click(); // ปุ่ม Search เท่านั้น
  await page.waitForLoadState('networkidle');
}

/** ตาราง (ตาม id บางส่วน) → แถวของข้อความ แถวแรก = หัวตาราง · null = ไม่พบตาราง */
async function readGrid(page: Page, idPart: string): Promise<string[][] | null> {
  return page.evaluate((p) => {
    const t = document.querySelector<HTMLTableElement>(`table[id*="${p}"]`);
    if (t === null) return null;
    return [...t.rows].map((r) => [...r.cells].map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()));
  }, idPart);
}

const tally = (xs: readonly string[]) => {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
};
const col = (header: readonly string[], name: string) => header.findIndex((h) => h === name);
const parseDMY = (s: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};


const result: Record<string, unknown> = { ranAt: new Date().toISOString(), todayThai: iso(TODAY) };
const cfg = loadConfig();
const creds = loadCredentials();
const redact = createRedactor([creds.username, creds.password]);
const session = await openSession(cfg);
type Ev = { ms: number; at: string; op: string; ref: string; desc: string; data: string };
try {
  await login(session, cfg, creds, redact);
  const { page } = session;
  const url = (p: string) => new URL(p, `${cfg.baseUrl}/pms/`).toString();
  const events: Ev[] = [];
  const perDay: Record<string, number> = {};
  for (let n = 1; n <= 7; n++) {
    const d = daysAgo(n);
    await page.goto(url('audit/auditlist.aspx'), { waitUntil: 'domcontentloaded' });
    await fill(page, 'ctl00$pc$calFrom', dmy(d));
    await fill(page, 'ctl00$pc$tsFrom$tbH', '00');
    await fill(page, 'ctl00$pc$tsFrom$tbM', '00');
    await fill(page, 'ctl00$pc$calTo', dmy(d));
    await fill(page, 'ctl00$pc$tsTo$tbH', '23');
    await fill(page, 'ctl00$pc$tsTo$tbM', '59');
    await search(page);
    const rows = await readGrid(page, 'dtgList');
    if (rows === null || rows.length < 2) { perDay[iso(d)] = 0; continue; }
    const [header, ...body] = rows as [string[], ...string[][]];
    perDay[iso(d)] = body.length;
    const iDate = col(header, 'Date'), iOp = col(header, 'Operation'), iObj = col(header, 'Object');
    const iConn = col(header, 'Object connected with operation'), iDesc = col(header, 'Description'), iData = col(header, 'Data');
    for (const r of body) {
      const when = r[iDate] ?? '';
      events.push({
        ms: Date.parse(`${when.slice(6, 10)}-${when.slice(3, 5)}-${when.slice(0, 2)}T${when.slice(11, 19)}+07:00`),
        at: when, op: r[iOp] ?? '', ref: (r[iObj] ?? '').replace(/\D/g, '') || (r[iConn] ?? '').replace(/\D/g, ''),
        desc: (r[iDesc] ?? '').replace(/\d+/g, '#').slice(0, 90), data: (r[iData] ?? '').replace(/\d+/g, '#').slice(0, 60),
      });
    }
  }
  result.rowsPerDay = perDay;
  events.sort((a, b) => a.ms - b.ms);
  const rsc = events.filter((e) => e.op === 'Room status change');
  result.roomStatusChange_byHour = tally(rsc.map((e) => e.at.slice(11, 13)));
  result.roomStatusChange_descPatterns = tally(rsc.map((e) => `${e.desc} || ${e.data}`));
  result.opsSeen = tally(events.map((e) => e.op));
  result.reservationCreate_byHour = tally(events.filter((e) => e.op === 'Reservation create').map((e) => e.at.slice(11, 13)));
  result.otherInterestingOps = tally(events.filter((e) => /check|early|room state|assignment|move|swap/i.test(e.op)).map((e) => `${e.op} @${e.at.slice(11, 13)}h`));
  // ระยะจาก "เหตุการณ์แรกของการจองในช่วงที่ดู" ถึง Room status change (ไม่เก็บเลขการจอง)
  const firstOf = new Map<string, Ev>();
  for (const e of events) if (e.ref !== '' && !firstOf.has(e.ref)) firstOf.set(e.ref, e);
  result.firstEventToStatusChange = rsc.filter((e) => firstOf.has(e.ref)).map((e) => {
    const f = firstOf.get(e.ref)!;
    return { firstOp: f.op, minutes: Math.round((e.ms - f.ms) / 60_000), statusChangeHour: e.at.slice(11, 13) };
  }).sort((a, b) => a.minutes - b.minutes);
} catch (err) {
  console.error(redactError(err, redact)); // ข้อความ error ของ Playwright อาจแนบค่าที่กรอก/HTML ของหน้า
  process.exitCode = 1;
} finally {
  await session.close();
}
await writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`เขียนผลลง ${OUT}`);
