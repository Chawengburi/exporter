import type { Page } from 'playwright';
import { addDays, formatDMY, type DateRange } from '../../../core/order.ts';
import { LOOKAHEAD_DAYS_ENV, parseLookaheadDays } from '../../../core/run-planner.ts';
import { gridRowCount, setDateRange } from '../webforms.ts';
import { arrivalPeriod } from './arrival-period.ts';
import type { Report } from './_types.ts';

/**
 * **รายงานล่วงหน้า** (look-ahead report, ADR-0015) — หน้าเดียวกับ `arrival-period` (รายการจองตามช่วงวันเข้าพัก) แต่เป็น **รายงาน snapshot**
 * ช่วง วันนี้ถึง +N ทุกรอบดึง ไฟล์เดียวต่อรอบ เก็บเป็นฉบับใหม่ทุกรอบใน Silver ให้ Gold ใช้ฉบับล่าสุดที่ครอบคลุมแต่ละวัน · เก็บฝั่ง local อย่างเดียว ไม่ส่ง uploader
 *
 * ช่วงต้องคงที่ทุกรอบ (วันนี้ถึง +N เมื่อ N เท่ากัน) ไม่หดกลางทาง ไม่ซอยก้อน — ข้ามเดือนก็ยังไฟล์เดียว · ชนเพดานแถว = ล้มดัง ๆ (`rowCapFatal`)
 * ด่านวันที่ตรวจคอลัมน์ Arrival ทั้งช่วงแบบ arrival-period (ไม่มีค่าเผื่อขอบ) — จับ "filter ไม่ทำงาน" ได้
 */
const REPORT_ID = 'arrival-ahead';

/** N ตั้งต้นของการสั่งมือตอนยังไม่ได้ตั้ง `HOTELTIME_LOOKAHEAD_DAYS` (ผังรอบไม่ใช้ค่านี้ — ไม่ตั้ง = ปิด) */
export const DEFAULT_LOOKAHEAD_DAYS = 14;

/** ช่วง วันนี้ถึง +N */
export function lookaheadWindow(day: Date, days: number): DateRange {
  return { from: day, to: addDays(day, days) };
}

/**
 * N ที่ใช้ตอนนี้: อ่านด้วย `parseLookaheadDays` ตัวเดียวกับ `loadConfig` (กติกาเดียว: 1–60) · ไม่ตั้ง/ว่าง = ค่าตั้งต้นสำหรับสั่งมือ (ผังรอบไม่ใช้ค่านี้ — ไม่ตั้ง = ปิด) ·
 * ค่าผิดโยน error ไม่ถอยเงียบไปใช้ 14 · อ่านตอนเรียก ไม่ใช่ตอนโหลดโมดูล (เทสต์ตั้ง env ได้)
 */
function currentDays(): number {
  const parsed = parseLookaheadDays(process.env[LOOKAHEAD_DAYS_ENV]);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.days ?? DEFAULT_LOOKAHEAD_DAYS;
}

const lookaheadWindowOfToday = (day: Date): DateRange => lookaheadWindow(day, currentDays());

export const arrivalAhead: Report = {
  ...arrivalPeriod,
  id: REPORT_ID,
  label: 'Arrival look-ahead (today to +N days)',
  dailyOnly: true,
  family: 'picture',
  period: 'none',
  chunk: { kind: 'whole', reason: 'ไฟล์เดียวต่อรอบ — ช่วงวันนี้ถึง +N คงที่ทุกรอบ ไม่ซอยก้อน (ADR-0015)' },
  rowCapFatal: true,
  neverUpload: true,
  warnIfBlank: ['Name', 'Room type'],
  filterNote: 'กรองด้วยวันเข้าพัก (Arrival) ช่วงวันนี้ถึง +N วัน — รายงานล่วงหน้า: ฉบับล่าสุดที่ครอบคลุมวันนั้นคือค่าปัจจุบัน แถวที่หายไปแปลว่าเลื่อนหรือยกเลิก (ADR-0015)',
  dataWindow: lookaheadWindowOfToday,
  requestWindow: lookaheadWindowOfToday,

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await setDateRange(page, 'ctl00$pc$dtrTerm', formatDMY(range.from), formatDMY(range.to), arrivalPeriod.allowedControls, REPORT_ID);
  },

  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgItems"]');
    return rows !== null && rows > 1;
  },
};
