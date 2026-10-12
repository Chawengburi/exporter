import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { clearDateRange, gridRowCount, setDateRange } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Search cancelled reservations" — รายการจองที่ถูกยกเลิก
 *
 * 🔴 ใบนี้ไม่มีช่อง created date เลย มีแค่ "Stay date range" กับ "Cancelled from - to"
 * เจ้าของตัดสิน 2026-09-08 ให้ใช้ **วันที่ยกเลิก** เพราะเป็นอดีตล้วนแก้ย้อนหลังไม่ได้
 * คุณสมบัติเดียวกับ created date · ผลที่ตามมาที่ต้องรู้: ใบที่สร้างปี 2023 แต่ยกเลิก
 * ปี 2024 จะติดมาด้วย ซึ่งเป็นประชากรคนละชุดกับ "สร้างตั้งแต่ 2024"
 *
 * สำรวจ 2026-09-08 · รายละเอียดใน recon/NOTES.md
 */
const REPORT_ID = 'reservations-cancelled';

/** ทุก control ที่ใบนี้แตะจริงใน applyFilters — ดู core/gate.ts */
const ALLOWED_CONTROLS = ['ctl00$pc$drStay', 'ctl00$pc$drDeleted', 'ctl00$pc$btnFind'];

export const reservationsCancelled: Report = {
  id: REPORT_ID,
  label: 'Search cancelled reservations',
  path: 'ResDeleteList.aspx',
  allowedControls: ALLOWED_CONTROLS,

  chunk: {
    kind: 'monthly',
    reason:
      'export ของใบนี้เงียบสนิทเมื่อช่วงกว้าง — 1 เดือนได้ไฟล์ใน 0.3 วินาที ' +
      'แต่ 1 ปีและเต็มช่วงไม่มี download มาเลยใน 120 วินาที โดยไม่มี error ใด ๆ',
  },
  hasRowCap: false,
  dailyOnly: false,
  skipDateCoverageCheck: false,

  /** วันที่ยกเลิก — ตัวที่ใช้กรองแทน created date */
  dateColumn: 'Cancelled',
  searchButton: 'ctl00$pc$btnFind',
  dateColumns: ['Arrival', 'Departure', 'Cancelled'],
  // 🔴 ค่าใน `Cancelled` เป็นเวลาท้องถิ่น (UTC+7) แต่ตัวกรองตัดขอบด้วย UTC
  // ช่วง 01/05–31/05 จึงคืนค่าถึง 01/06 06:59 เวลาไทยได้โดยชอบธรรม
  // (วัดจริง 2026-09-08: พ.ค. 2026 มีค่าสูงสุด 01/06/2026 01:40)
  // แถวยังถูกจัดเข้าก้อนเดียวไม่ซ้ำไม่ขาด เพราะตัวกรองฝั่ง server เป็นตัวตัดสิน
  boundaryToleranceDays: 1,

  expectedColumns: [
    'Reservation number', 'Group name', 'CHM ID', 'Reservation owner',
    'Room type', 'Room', 'Type', 'Guests',
    'Arrival', 'Departure', 'Nights', 'Currency',
    'Price per night', 'Price list', 'Room price', 'Extras price',
    'Advance payments / Proforms', 'Cancelled', 'Cancellation reason',
    'Cancellation note', 'User',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    // `drStay` ถูกกรอกมาให้เป็น "วันนี้ → อีก 7 วัน" ตั้งแต่เปิดหน้า ต้องล้างทิ้ง
    await clearDateRange(page, 'ctl00$pc$drStay', ALLOWED_CONTROLS, REPORT_ID);
    await setDateRange(
      page,
      'ctl00$pc$drDeleted',
      formatDMY(range.from),
      formatDMY(range.to),
      ALLOWED_CONTROLS,
      REPORT_ID,
    );
  },

  async hasResults(page: Page): Promise<boolean> {
    // วัดแล้ว: ผลว่าง → #pc_dtgItems มีอยู่แต่ 0 แถว (ต่างจากใบ RateCode ที่ตารางหายไปเลย)
    const rows = await gridRowCount(page, '#pc_dtgItems');
    return rows !== null && rows > 1;
  },

  async expectedRowCount(_page: Page): Promise<number | null> {
    // 🔴 หน้านี้มี `Total reservations:` แต่นับ *reservation* ไม่ใช่ *แถว*
    // (วัดจริง: หน้าเว็บบอก 19 แต่ไฟล์มี 22 แถว) — ใช้เทียบจำนวนแถวไม่ได้ อย่าเดา
    return null;
  },
};
