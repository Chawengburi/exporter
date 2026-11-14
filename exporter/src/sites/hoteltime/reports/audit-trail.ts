import type { Page } from 'playwright';
import { addDaysISO, formatDMY, formatISO, parseISODate, type DateRange } from '../../../core/order.ts';
import { DAY_MINUTES } from '../../../core/scraped-split.ts';
import { gridRowCount, setSingleDate } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Audit trail" (`Front desk → Audit trail`) — ทุกเหตุการณ์ของระบบพร้อมเวลาระดับวินาที (ADR-0012 · specs/07 · recon 2026-11-14)
 *
 * **หน้านี้ไม่มีปุ่ม export** — อ่านตาราง `dtgList` แล้วเขียนเป็นไฟล์ดิบแบบ scrape (`Report.scrape`) · รายงานตามวัน: วัน D ดึงหลัง D จบ
 *
 * 🔴 ช่วงที่ส่งเข้าหน้าเว็บ = `D 00:00` ถึง `D+1 00:00` ไม่ใช่ `D 23:59` — ช่อง "To HH:MM" ไม่รวมนาทีที่ระบุ ค้นถึง 23:59 จะตกทุกแถวของนาที 23:59:xx
 * (วัดจริง: ถึง 00:00 ของวันถัดไปได้ 154 แถว ถึง 23:59 ได้ 153 — แถวที่ตกคือ 23:59:24) · ช่อง "From HH:MM" รวมวินาที :00
 * 🔴 เพดาน 500 แถวและไม่มีตัวแบ่งหน้า — และตัดแถวที่**เก่าที่สุด**ทิ้ง (ตรงข้ามกับรายงานอื่น) · ปุ่มที่แตะได้มีแค่ Search — `Reset filter` ห้ามแตะ (ADR-0001)
 */
const REPORT_ID = 'audit-trail';

/** เพดานแถวของหน้า (วัดจริง 2026-09-08: สั่งช่วงกว้างได้ 500 แถวเท่ากันเสมอ) */
export const AUDIT_ROW_CAP = 500;

const FROM_DATE = 'ctl00$pc$calFrom';
const FROM_HOUR = 'ctl00$pc$tsFrom$tbH';
const FROM_MINUTE = 'ctl00$pc$tsFrom$tbM';
const TO_DATE = 'ctl00$pc$calTo';
const TO_HOUR = 'ctl00$pc$tsTo$tbH';
const TO_MINUTE = 'ctl00$pc$tsTo$tbM';
const FIND = 'ctl00$pc$btnFind';

/** ทุก control ที่ใบนี้แตะจริงใน applyFilters — ดู core/gate.ts · ไม่มี `btnFiltrReset` โดยเจตนา */
const ALLOWED_CONTROLS = [FROM_DATE, FROM_HOUR, FROM_MINUTE, TO_DATE, TO_HOUR, TO_MINUTE, FIND];

type WindowFields = {
  readonly fromDate: string; readonly fromHour: string; readonly fromMinute: string;
  readonly toDate: string; readonly toHour: string; readonly toMinute: string;
};

/** ค่าที่กรอกลงหน้าเว็บสำหรับช่วงครึ่งเปิด `[start, end)` นาทีของวัน D (end = 1440 → 00:00 ของวันถัดไป) */
export function auditWindowMinutes(day: Date, startMinute: number, endMinute: number): WindowFields {
  const next = parseISODate(addDaysISO(formatISO(day), 1));
  if (next === null) throw new Error(`วันที่ไม่ถูกต้อง: ${formatISO(day)}`);
  const at = (m: number) => ({ date: formatDMY(m >= DAY_MINUTES ? next : day), hour: String(Math.floor(m / 60) % 24).padStart(2, '0'), minute: String(m % 60).padStart(2, '0') });
  const [f, t] = [at(startMinute), at(endMinute)];
  return { fromDate: f.date, fromHour: f.hour, fromMinute: f.minute, toDate: t.date, toHour: t.hour, toMinute: t.minute };
}

/** ค่าที่กรอกลงหน้าเว็บสำหรับวันของข้อมูล D — ช่วงครึ่งเปิด `[D 00:00, D+1 00:00)` */
export const auditWindow = (day: Date): WindowFields => auditWindowMinutes(day, 0, DAY_MINUTES);

async function fillWindow(page: Page, w: WindowFields): Promise<void> {
  // ตั้งทุกช่องแบบ explicit ทับค่าตั้งต้นของหน้า (From = วันนี้ 03:00, To ว่าง)
  await setSingleDate(page, FROM_DATE, w.fromDate, ALLOWED_CONTROLS, REPORT_ID);
  await setSingleDate(page, FROM_HOUR, w.fromHour, ALLOWED_CONTROLS, REPORT_ID);
  await setSingleDate(page, FROM_MINUTE, w.fromMinute, ALLOWED_CONTROLS, REPORT_ID);
  await setSingleDate(page, TO_DATE, w.toDate, ALLOWED_CONTROLS, REPORT_ID);
  await setSingleDate(page, TO_HOUR, w.toHour, ALLOWED_CONTROLS, REPORT_ID);
  await setSingleDate(page, TO_MINUTE, w.toMinute, ALLOWED_CONTROLS, REPORT_ID);
}

export const auditTrail: Report = {
  id: REPORT_ID,
  label: 'Audit trail',
  path: 'audit/auditlist.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: true,
  family: 'per-day',
  skipDateCoverageCheck: false,
  scrape: {
    gridIdPart: 'dtgList',
    rowCap: AUDIT_ROW_CAP,
    applyWindow: (page, day, start, end) => fillWindow(page, auditWindowMinutes(day, start, end)),
  },

  chunk: {
    kind: 'whole',
    reason: 'dailyOnly — วันของข้อมูลวันเดียว (ปกติ 100–170 แถวต่อวัน) · ชนเพดาน 500 → แบ่งช่วงเวลาลงไปถึง 1 ชั่วโมง (core/scraped-split.ts) ชั่วโมงเดียวยังชน = ล้ม',
  },
  hasRowCap: true,
  dateColumn: 'Date',
  filterNote: 'กรองด้วยเวลาเกิดเหตุการณ์ (Date) ช่วงครึ่งเปิด [วัน 00:00, วันถัดไป 00:00) — ไฟล์ดิบแบบ scrape (ADR-0012)',
  boundaryToleranceDays: 0,
  searchButton: FIND,

  // สองคอลัมน์แรกไม่มีหัว (ไอคอน) — เป็นแบบนี้ในหน้าจริง
  expectedColumns: ['', '', 'Date', 'Operation', 'Object', 'Object connected with operation', 'Description', 'Data', 'User'],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await fillWindow(page, auditWindow(range.from));
  },

  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgList"]');
    return rows !== null && rows > 1; // แถวแรกคือ header
  },

  async expectedRowCount(): Promise<number | null> {
    return null; // หน้านี้ไม่มีตัวเลขจำนวนแถว
  },
};
