/**
 * ticket 01 ของ exporter-audit-trail — recon แบบอ่านอย่างเดียวของหน้า Audit (`/pms/audit/auditlist.aspx`) ตอบ 3 ข้อ:
 *   1. "To HH:MM" รวมวินาที :59 ไหม (และ "From HH:MM" รวม :00 ไหม) — ตัดสินนโยบายแบ่งช่วงเวลา (ticket 04)
 *   2. Audit เก็บย้อนหลังนานแค่ไหน (หาวันแรกที่มีข้อมูล)
 *   3. ห้อง/ชื่อห้องอยู่คอลัมน์ไหนของแถว `Room status change` (บันทึกรูปแบบเซลล์โดยแทนตัวเลข/ตัวอักษร ไม่เก็บค่าจริง)
 *
 * 🔴 อ่านอย่างเดียว: คลิกได้แค่ปุ่ม Search (`btnFind`) · ไม่เก็บ/ไม่พิมพ์ชื่อแขก ชื่อผู้ใช้ หรือเลขจอง · ผลลง argv[2] (ไม่ลง repo)
 * ใช้: node recon/hoteltime-audit-open-questions-recon.ts <ไฟล์ผลลัพธ์.json>
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



const result: Record<string, unknown> = { ranAt: new Date().toISOString() };
const cfg = loadConfig();
const creds = loadCredentials();
const redact = createRedactor([creds.username, creds.password]);
const session = await openSession(cfg);
const hhmm = (s: string) => [s.slice(0, 2), s.slice(3, 5)] as const;
try {
  await login(session, cfg, creds, redact);
  const { page } = session;
  const url = (p: string) => new URL(p, `${cfg.baseUrl}/pms/`).toString();

  /** ค้นช่วง [from..to] (วันที่ DD/MM/YYYY + HH:MM) → แถวของตาราง (ไม่มีหัว) · null = ไม่มีตาราง */
  async function query(fromDate: string, fromTime: string, toDate: string, toTime: string): Promise<{ header: string[]; body: string[][] }> {
    await page.goto(url('audit/auditlist.aspx'), { waitUntil: 'domcontentloaded' });
    await fill(page, 'ctl00$pc$calFrom', fromDate);
    await fill(page, 'ctl00$pc$tsFrom$tbH', hhmm(fromTime)[0]);
    await fill(page, 'ctl00$pc$tsFrom$tbM', hhmm(fromTime)[1]);
    await fill(page, 'ctl00$pc$calTo', toDate);
    await fill(page, 'ctl00$pc$tsTo$tbH', hhmm(toTime)[0]);
    await fill(page, 'ctl00$pc$tsTo$tbM', hhmm(toTime)[1]);
    await search(page);
    const rows = await readGrid(page, 'dtgList');
    if (rows === null || rows.length < 1) return { header: [], body: [] };
    const [header, ...body] = rows as [string[], ...string[][]];
    return { header, body };
  }
  const secondsOf = (r: readonly string[], i: number) => (r[i] ?? '').slice(17, 19);
  const minuteOf = (r: readonly string[], i: number) => (r[i] ?? '').slice(11, 16);

  // ── ข้อ 1: ความหมายของ From/To ──
  const day = dmy(daysAgo(2));
  const full = await query(day, '00:00', day, '23:59');
  const iDate = full.header.indexOf('Date');
  const q1: Record<string, unknown> = { day: iso(daysAgo(2)), fullDayRows: full.body.length, hitsCap500: full.body.length >= 500 };
  // นาทีที่มีเหตุการณ์หลายแถว เพื่อวัดขอบ (เลือกนาทีที่มีแถวที่วินาทีต่าง ๆ)
  const perMinute = new Map<string, number[]>();
  for (const r of full.body) {
    const m = minuteOf(r, iDate);
    perMinute.set(m, [...(perMinute.get(m) ?? []), Number(secondsOf(r, iDate))]);
  }
  const probeMinutes = [...perMinute.entries()].filter(([, s]) => s.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  const boundary: unknown[] = [];
  for (const [m, secs] of probeMinutes) {
    const sameMinute = await query(day, m, day, m); // [m..m]
    const got = sameMinute.body.map((r) => `${minuteOf(r, iDate)}:${secondsOf(r, iDate)}`);
    boundary.push({
      minute: m, expectedSecondsInFullDay: secs.sort((a, b) => a - b), rowsWhenFromEqualsTo: sameMinute.body.length,
      secondsReturned: got.map((x) => x.slice(6)).sort(),
      minutesReturned: [...new Set(got.map((x) => x.slice(0, 5)))],
    });
  }
  q1.sameMinuteProbe = boundary;
  // [m .. m+1]: ถ้า To ไม่รวมนาที m+1 ทั้งนาที และ From รวม m:00 → ได้ครบทุกวินาทีของนาที m (แถวของนาที m+1 ไม่เข้า)
  const plusOne: unknown[] = [];
  for (const [m, secs] of probeMinutes) {
    const [h, mm] = [Number(m.slice(0, 2)), Number(m.slice(3, 5))];
    const next = `${pad(mm === 59 ? h + 1 : h)}:${pad(mm === 59 ? 0 : mm + 1)}`;
    const r = await query(day, m, day, next);
    const minutes: Record<string, number> = {};
    for (const row of r.body) minutes[minuteOf(row, iDate)] = (minutes[minuteOf(row, iDate)] ?? 0) + 1;
    plusOne.push({ from: m, to: next, rows: r.body.length, expectedRowsInMinuteFrom: secs.length, rowsByMinute: minutes });
  }
  q1.fromMinuteToNextMinuteProbe = plusOne;
  // To = 00:00 ของวันถัดไป จับแถวช่วง 23:59:xx ได้ไหม (เทียบกับ To 23:59 ของวันเดียวกัน)
  const nextDay = dmy(new Date(daysAgo(2).getTime() + 86_400_000));
  const toMidnight = await query(day, '00:00', nextDay, '00:00');
  q1.toNextDay0000 = { rows: toMidnight.body.length, versusTo2359: full.body.length,
    rowsAtOrAfterNextDay: toMidnight.body.filter((r) => (r[iDate] ?? '').startsWith(nextDay)).length,
    latest: toMidnight.body.map((r) => (r[iDate] ?? '')).sort((x, y) => x.slice(6, 10).localeCompare(y.slice(6, 10)) || x.slice(3, 5).localeCompare(y.slice(3, 5)) || x.slice(0, 2).localeCompare(y.slice(0, 2)) || x.slice(11).localeCompare(y.slice(11))).at(-1)?.slice(11, 19) };
  // แบ่งครึ่งวันแล้วรวม — ถ้า "To" รวม :59 และ "From" รวม :00 จะได้ครึ่งแรก + ครึ่งหลัง = เต็มวันพอดี ไม่ซ้ำ ไม่ตก
  const a = await query(day, '00:00', day, '11:59');
  const b = await query(day, '12:00', day, '23:59');
  const keyOf = (r: string[]) => r.join('\u0001');
  const fullSet = new Map<string, number>();
  for (const r of full.body) fullSet.set(keyOf(r), (fullSet.get(keyOf(r)) ?? 0) + 1);
  const unionSet = new Map<string, number>();
  for (const r of [...a.body, ...b.body]) unionSet.set(keyOf(r), (unionSet.get(keyOf(r)) ?? 0) + 1);
  let missing = 0, extra = 0;
  for (const [k, n] of fullSet) missing += Math.max(0, n - (unionSet.get(k) ?? 0));
  for (const [k, n] of unionSet) extra += Math.max(0, n - (fullSet.get(k) ?? 0));
  q1.halves = {
    firstHalfRows: a.body.length, secondHalfRows: b.body.length, sum: a.body.length + b.body.length, fullDay: full.body.length,
    rowsInFullButNotInUnion: missing, rowsInUnionButNotInFull: extra,
    firstHalfLatest: a.body.length > 0 ? a.body.map((r) => (r[iDate] ?? '').slice(11, 19)).sort().at(-1) : null,
    secondHalfEarliest: b.body.length > 0 ? b.body.map((r) => (r[iDate] ?? '').slice(11, 19)).sort().at(0) : null,
  };
  result.q1_fromToSemantics = q1;

  // ── ข้อ 2: อายุของ audit — ค้นทีละสัปดาห์ (7 วันแรกของเดือนที่เลือก) หาวันแรกที่มีข้อมูลแบบหยาบ แล้วละเอียดเป็นวัน ──
  const weekCount = async (start: Date) => {
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const r = await query(dmy(start), '00:00', dmy(end), '23:59');
    return r.body.length;
  };
  const dayCount = async (d: Date) => (await query(dmy(d), '00:00', dmy(d), '23:59')).body.length;
  const probes: Record<string, number> = {};
  for (const ymd of ['2026-06-01', '2026-01-01', '2025-07-01', '2025-01-01', '2024-09-01', '2024-06-01', '2024-04-01', '2024-02-01', '2024-01-01']) {
    probes[ymd] = await weekCount(new Date(`${ymd}T00:00:00Z`));
  }
  result.q2_weekProbes = probes;
  // bisect หาสัปดาห์แรกที่มีข้อมูลระหว่างสัปดาห์ที่ว่างล่าสุดกับสัปดาห์ที่มีข้อมูลแรก
  const ordered = Object.entries(probes).sort(([x], [y]) => x.localeCompare(y));
  const firstWith = ordered.find(([, n]) => n > 0);
  if (firstWith !== undefined) {
    let hi = new Date(`${firstWith[0]}T00:00:00Z`).getTime();
    const prev = ordered.filter(([k]) => k < firstWith[0]).at(-1);
    let lo = prev !== undefined ? new Date(`${prev[0]}T00:00:00Z`).getTime() : hi - 120 * 86_400_000; // ว่างตรงนี้
    for (let i = 0; i < 6 && hi - lo > 7 * 86_400_000; i++) {
      const mid = lo + Math.floor((hi - lo) / 2 / 86_400_000) * 86_400_000;
      if ((await weekCount(new Date(mid))) > 0) hi = mid; else lo = mid;
    }
    // วันแรกของสัปดาห์ hi ที่มีข้อมูล
    let first: string | null = null;
    for (let k = 0; k < 7; k++) {
      const d = new Date(hi + k * 86_400_000);
      if ((await dayCount(d)) > 0) { first = iso(d); break; }
    }
    result.q2_earliestDayWithData = first;
    result.q2_windowedBy = { emptyWeekStart: iso(new Date(lo)), nonEmptyWeekStart: iso(new Date(hi)) };
  }

  // ── ข้อ 3: รูปแบบเซลล์ของ Room status change (แทนตัวเลขเป็น # ตัวอักษรเป็น A — ไม่เก็บค่าจริง) ──
  // allowlist: เก็บเฉพาะอักขระโครงสร้าง (เว้นวรรค : / - |) ที่เหลือทุกตัวอักษรของทุกภาษาเป็น # (ตัวเลข) หรือ A — ไม่ปล่อยอักษรนอก A-Z/ไทยหลุด
const mask = (v: string) => v.replace(/[^\s:/|\-]/gu, (ch) => (/\p{Nd}/u.test(ch) ? '#' : 'A')).slice(0, 60);
  const iOp = full.header.indexOf('Operation');
  const rsc = full.body.filter((r) => (r[iOp] ?? '') === 'Room status change');
  const byColumn: Record<string, Record<string, number>> = {};
  full.header.forEach((h, i) => {
    const name = h === '' ? `(blank col ${i})` : h;
    const m: Record<string, number> = {};
    for (const r of rsc) { const k = mask(r[i] ?? ''); m[k] = (m[k] ?? 0) + 1; }
    byColumn[name] = m;
  });
  // เทียบกับแถวของ Reservation room move / Room assignment (น่าจะมีห้องชัดเจนกว่า)
  const other = full.body.filter((r) => ['Reservation room move', 'Room assignment', 'Room state change'].includes(r[iOp] ?? ''));
  const otherBy: Record<string, Record<string, number>> = {};
  full.header.forEach((h, i) => {
    const m: Record<string, number> = {};
    for (const r of other) { const k = `${r[iOp]} | ${mask(r[i] ?? '')}`; m[k] = (m[k] ?? 0) + 1; }
    otherBy[h === '' ? `(blank col ${i})` : h] = m;
  });
  result.q3_header = full.header;
  result.q3_roomStatusChangeRowsOnDay = rsc.length;
  result.q3_roomStatusChange_cellPatterns = byColumn;
  result.q3_otherRoomOps_cellPatterns = otherBy;
} catch (err) {
  console.error(redactError(err, redact)); // ข้อความ error ของ Playwright อาจแนบค่าที่กรอก/HTML ของหน้า
  process.exitCode = 1;
} finally {
  await session.close();
}
await writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`เขียนผลลง ${OUT}`);
