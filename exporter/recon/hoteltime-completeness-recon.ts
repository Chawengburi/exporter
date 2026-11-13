/**
 * recon แบบอ่านอย่างเดียวของ HotelTime — คำถามเรื่องความสมบูรณ์ของข้อมูล in-house (ADR-0011 · ต่อจาก handoff 2026-11-13)
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
try {
  await login(session, cfg, creds, redact);
  const { page } = session;
  const url = (p: string) => new URL(p, `${cfg.baseUrl}/pms/`).toString();

  // ── Q1: วันที่ย้อนหลังในหน้า snapshot ──
  const q1: Record<string, unknown> = {};
  for (const [name, path, grid] of [
    ['in-house-guests', 'reports/RoomGuests.aspx', 'dtgGuests'],
    ['arrivals', 'reports/RoomArrivals.aspx', 'dtg'],
    ['departures', 'reports/RoomDepartures.aspx', 'dtg'],
  ] as const) {
    const perDate: Record<string, unknown> = {};
    for (const n of [0, 1, 4]) {
      const d = daysAgo(n);
      await page.goto(url(path), { waitUntil: 'domcontentloaded' });
      await fill(page, 'ctl00$pc$calDate', dmy(d));
      await search(page);
      const rows = await readGrid(page, grid);
      if (rows === null || rows.length === 0) {
        perDate[iso(d)] = { rows: rows === null ? 'no-grid' : 0 };
        continue;
      }
      const [header, ...body] = rows as [string[], ...string[][]];
      const iA = col(header, 'Arrival');
      const iD = col(header, 'Departure');
      const iS = col(header, 'Stay');
      const dayIso = iso(d);
      const arrivals = body.map((r) => parseDMY(r[iA] ?? ''));
      const departures = body.map((r) => parseDMY(r[iD] ?? ''));
      perDate[dayIso] = {
        rows: body.length,
        header,
        stayValues: iS >= 0 ? tally(body.map((r) => r[iS] ?? '')) : 'no Stay column',
        arrivalAfterDay: arrivals.filter((a) => a !== null && a > dayIso).length,
        departureBeforeDay: departures.filter((x) => x !== null && x < dayIso).length,
        arrivalOnDay: arrivals.filter((a) => a === dayIso).length,
        departureOnDay: departures.filter((x) => x === dayIso).length,
      };
    }
    q1[name] = perDate;
  }
  result.q1_pastDateSnapshots = q1;

  // ── Q2: Audit trail ต่อวัน ──
  await page.goto(url('audit/auditlist.aspx'), { waitUntil: 'domcontentloaded' });
  const ops = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLOptionElement>('select[name="ctl00$pc$ddlOperation"] option')].map((o) => o.textContent?.trim() ?? ''),
  );
  result.q2_operationDropdown = ops;

  const auditDays: Record<string, unknown> = {};
  const reservationEvents: { at: string; operation: string; object: string }[] = [];
  const checkInHours: Record<string, number> = {};
  const createToCheckInMinutes: number[] = [];
  for (const n of [1, 2, 3]) {
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
    if (rows === null || rows.length < 2) {
      auditDays[iso(d)] = { rows: rows === null ? 'no-grid' : 0 };
      continue;
    }
    const [header, ...body] = rows as [string[], ...string[][]];
    const iDate = col(header, 'Date');
    const iOp = col(header, 'Operation');
    const iObj = col(header, 'Object');
    const iConn = col(header, 'Object connected with operation');
    auditDays[iso(d)] = {
      rows: body.length,
      hitsCap500: body.length >= 500,
      header,
      operations: tally(body.map((r) => r[iOp] ?? '')),
    };
    const created = new Map<string, number>();
    for (const r of body) {
      const when = r[iDate] ?? '';
      const op = r[iOp] ?? '';
      const ms = Date.parse(
        `${when.slice(6, 10)}-${when.slice(3, 5)}-${when.slice(0, 2)}T${when.slice(11, 19)}+07:00`,
      );
      const ref = `${r[iObj] ?? ''}|${r[iConn] ?? ''}`;
      if ((r[iObj] ?? '').includes('603444268') || (r[iConn] ?? '').includes('603444268')) {
        reservationEvents.push({ at: when, operation: op, object: (r[iObj] ?? '').replace(/[^\d ]/g, '').slice(0, 40) });
      }
      if (/check.?in/i.test(op)) {
        const h = when.slice(11, 13);
        checkInHours[h] = (checkInHours[h] ?? 0) + 1;
      }
      if (/(create|new)/i.test(op) && /reserv/i.test(op)) created.set(ref, ms);
    }
    for (const r of body) {
      if (!/check.?in/i.test(r[iOp] ?? '')) continue;
      const when = r[iDate] ?? '';
      const ms = Date.parse(`${when.slice(6, 10)}-${when.slice(3, 5)}-${when.slice(0, 2)}T${when.slice(11, 19)}+07:00`);
      const made = created.get(`${r[iObj] ?? ''}|${r[iConn] ?? ''}`);
      if (made !== undefined) createToCheckInMinutes.push(Math.round((ms - made) / 60_000));
    }
  }
  result.q2_auditDays = auditDays;
  result.q2_checkInEventsByHour = Object.fromEntries(Object.entries(checkInHours).sort());
  result.q2_createdThenCheckedInSameDayMinutes = createToCheckInMinutes.sort((a, b) => a - b);
  result.q2_reservation603444268 = reservationEvents.sort((a, b) => a.at.localeCompare(b.at));
} catch (err) {
  console.error(redactError(err, redact)); // ข้อความ error ของ Playwright อาจแนบค่าที่กรอก/HTML ของหน้า
  process.exitCode = 1;
} finally {
  await session.close();
}
await writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`เขียนผลลง ${OUT}`);
