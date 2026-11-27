import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { clearDateRange, gridRowCount, setDateRange } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Search cancelled reservations" ค้นด้วย **Stay date range** — รายการยกเลิกทั้งหมดที่เคยมี (สั่งมือเท่านั้น)
 *
 * 🔴 ทำไมต้องมีใบนี้ — recon 2026-11-27 (recon/hoteltime-cancelled-history-recon.ts, อ่านอย่างเดียว):
 * หน้า `ResDeleteList.aspx` ค้นด้วย "Cancelled from - to" ได้ **0 แถว ทุกเดือนก่อน 2026-06** (ลอง 2026-05, 04, 03, 01, 2025-10, 06, 01, 2024-09, 06)
 * แต่ค้นด้วย "Stay date range" ในเดือนเดียวกันได้ 30-327 แถว และคอลัมน์ `Cancelled` ของแถวเหล่านั้นย้อนไปถึง 2024-05-20
 * → ตัวกรองวันที่ยกเลิกของ HotelTime มองไม่เห็นการยกเลิกเก่า ไม่ได้แปลว่าไม่มีข้อมูล · `reservations-cancelled` (ค้นด้วยวันยกเลิก) จึงเก็บไม่ครบ
 *
 * ผลที่ตามมา:
 *   · ช่วงที่สั่ง = ช่วง **เข้าพัก** (Stay) ไม่ใช่วันยกเลิก → `skipDateCoverageCheck` (คอลัมน์ `Cancelled` ไม่เท่ากับช่วงที่กรอง ด่านวันที่ใช้ไม่ได้)
 *   · reservation ที่พักคร่อมหลายเดือนปรากฏในหลายก้อน (ซ้ำข้ามไฟล์ได้) — ปลายทางต้อง dedupe ด้วยเลข reservation
 *   · ไม่อยู่ใน `REPORTS` — ไม่ถูกดึงใน `--report all` / รอบรายวัน / baseline / `exporter status` · สั่งได้ด้วยมือเท่านั้น:
 *       exporter export --report reservations-cancelled-by-stay --from DD/MM/YYYY --to DD/MM/YYYY
 *   · ไฟล์ที่ได้หัวคอลัมน์เหมือน `reservations-cancelled` ทุกคอลัมน์ (Silver จำแนกชนิดจากหัวตาราง)
 */
const REPORT_ID = 'reservations-cancelled-by-stay';

/** ทุก control ที่ใบนี้แตะจริงใน applyFilters — ดู core/gate.ts */
const ALLOWED_CONTROLS = ['ctl00$pc$drStay', 'ctl00$pc$drDeleted', 'ctl00$pc$btnFind'];

export const reservationsCancelledByStay: Report = {
  id: REPORT_ID,
  label: 'Search cancelled reservations (by stay date)',
  path: 'ResDeleteList.aspx',
  allowedControls: ALLOWED_CONTROLS,

  chunk: {
    kind: 'monthly',
    reason:
      'export ของหน้านี้เงียบสนิทเมื่อช่วงกว้าง (เหมือน reservations-cancelled) · recon 2026-11-27: เดือนที่หนาสุดที่วัดได้คือ 327 แถว',
  },
  hasRowCap: false,
  dailyOnly: false,
  family: 'per-day',
  // 🔴 ช่วงที่กรองเป็นวันเข้าพัก แต่คอลัมน์ `Cancelled` เป็นวันยกเลิก — ไม่มีวันที่ในไฟล์ที่เท่ากับช่วงที่กรองเสมอ ด่านวันที่ตรวจไม่ได้
  skipDateCoverageCheck: true,

  dateColumn: 'Cancelled',
  searchButton: 'ctl00$pc$btnFind',
  boundaryToleranceDays: 0,
  filterNote:
    'กรองด้วยช่วงเข้าพัก (Stay date range) ไม่ใช่วันที่ยกเลิก — range ใน manifest คือช่วงเข้าพักที่ค้น · ตัวกรองวันที่ยกเลิกของ HotelTime มองไม่เห็นการยกเลิกก่อน 2026-06 (recon 2026-11-27) · reservation ที่พักคร่อมเดือนอาจซ้ำข้ามไฟล์',

  expectedColumns: [
    'Reservation number', 'Group name', 'CHM ID', 'Reservation owner',
    'Room type', 'Room', 'Type', 'Guests',
    'Arrival', 'Departure', 'Nights', 'Currency',
    'Price per night', 'Price list', 'Room price', 'Extras price',
    'Advance payments / Proforms', 'Cancelled', 'Cancellation reason',
    'Cancellation note', 'User',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    // ล้างช่อง Cancelled from-to (ปกติว่างอยู่แล้ว) แล้วตั้ง Stay date range
    await clearDateRange(page, 'ctl00$pc$drDeleted', ALLOWED_CONTROLS, REPORT_ID);
    await setDateRange(
      page,
      'ctl00$pc$drStay',
      formatDMY(range.from),
      formatDMY(range.to),
      ALLOWED_CONTROLS,
      REPORT_ID,
    );
  },

  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '#pc_dtgItems');
    return rows !== null && rows > 1;
  },

  async expectedRowCount(_page: Page): Promise<number | null> {
    // เหมือน reservations-cancelled: `Total reservations:` นับ reservation ไม่ใช่แถว — เทียบจำนวนแถวไม่ได้
    return null;
  },
};
