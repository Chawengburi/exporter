import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setDateRange, setSelect } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "City tax report" (`reports/CityTaxReport.aspx`) — ภาษีเตียงต่อการเข้าพัก · ticket 17 ของ exporter-daily-expansion-and-data-store
 *
 * แถวคือ**การเข้าพักที่คร่อมช่วงที่เลือก** และ "Number of days in term" / "Bed tax total" นับเฉพาะคืนที่อยู่ในช่วงนั้น (การตรวจเบื้องต้น:
 * 128 จาก 2,637 แถวเข้าพักก่อนช่วง) → ด่าน "คร่อมช่วง" (`overlapColumns`) · แกนวันที่คือวันเข้าพัก **แก้ย้อนหลังได้** (เลื่อน/ยกเลิก
 * การจอง) เหมือน arrival-period
 *
 * 🔴 ไฟล์รายวัน (ย้อน 3 วัน) ทับช่วงกันทุกวัน **เอามารวมเป็นยอดภาษีไม่ได้** — ยอดรายเดือนที่ถูกต้องใช้ baseline/back-fill ซึ่งแบ่งก้อน
 * ตามเดือนพอดี (เจ้าของระบบเลือกแบบนี้ 2026-10-07) · การเข้าพักที่คร่อมสิ้นเดือนอยู่ในทั้งสองก้อน แต่จำนวนคืนในแต่ละก้อนนับเฉพาะ
 * เดือนนั้น จึงรวมได้ถูก — **ยอดต่อเดือนอยู่ในไฟล์ดิบ `_raw/city-tax/<ต้นเดือน>_<สิ้นเดือน>.xlsx`** (หนึ่งไฟล์ต่อเดือน) ส่วน CSV รวมทั้งปี ·
 * กลุ่มห้องตั้งเป็น "ทั้งหมด" แบบ explicit (กลุ่มห้องหายบางส่วน = ภาษีต่ำเกินจริงเงียบ ๆ) · recon อ่านอย่างเดียว 2026-10-07 อยู่ใน `recon/NOTES.md`
 */
const REPORT_ID = 'city-tax';
const RANGE = 'ctl00$pc'; // ช่องชื่อ ctl00$pc$calFrom/calTo ตรง ๆ — setDateRange ต่อ suffix ให้ (ไม่ใช่ทั้ง panel)
const ROOM_GROUPS = 'ctl00$pc$ddlRoomGroups';
const FIND = 'ctl00$pc$btnFind';
const ALLOWED_CONTROLS = [RANGE, ROOM_GROUPS, FIND];

export const cityTax: Report = {
  id: REPORT_ID,
  label: 'City tax report',
  path: 'reports/CityTaxReport.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: false,
  skipDateCoverageCheck: false,
  overlapColumns: { from: 'Reservation from', to: 'Reservation to' },
  chunk: { kind: 'monthly', reason: 'ยอดภาษีรายเดือนต้องได้จากก้อนที่ตรงกับเดือนพอดี · ~880 แถว/เดือน' },
  hasRowCap: true,
  dateColumn: 'Reservation from',
  filterNote: 'การเข้าพักที่คร่อมช่วง (Reservation from/to) จำนวนคืนนับเฉพาะในช่วง — วันเข้าพักแก้ย้อนหลังได้ · ยอดรายเดือนใช้ baseline',
  searchButton: FIND,
  dateColumns: ['Reservation from', 'Reservation to'],
  boundaryToleranceDays: 0,
  expectedColumns: [
    'Reservation', 'Room', 'Reservation from', 'Reservation to', 'Room state', 'Resident name', 'Address', 'Day of birth',
    'Passport ID', 'Age category', 'Number of days in term', 'Reason of stay', 'Subject category', 'Bed tax total',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await setSelect(page, ROOM_GROUPS, '--- all ---', ALLOWED_CONTROLS, REPORT_ID);
    await setDateRange(page, RANGE, formatDMY(range.from), formatDMY(range.to), ALLOWED_CONTROLS, REPORT_ID);
  },
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgData"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
