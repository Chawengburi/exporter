import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { clearDateRange, readTotals, setDateRange, totalAsNumber } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Reservation search by" — ใบหลัก รายการจองระดับห้อง
 *
 * สำรวจ 2026-09-08 · รายละเอียดใน recon/NOTES.md
 */
const REPORT_ID = 'reservations-search';

/** ทุก control ที่ใบนี้แตะจริงใน applyFilters — ดู core/gate.ts */
const ALLOWED_CONTROLS = [
  'ctl00$pc$calArrival',
  'ctl00$pc$calDeparture',
  'ctl00$pc$calStayDate',
  'ctl00$pc$calIssued',
  'ctl00$pc$btnFind',
];

export const reservationsSearch: Report = {
  id: REPORT_ID,
  label: 'Reservation search by',
  path: 'ReservationListMaster.aspx',
  allowedControls: ALLOWED_CONTROLS,

  chunk: {
    kind: 'monthly',
    reason:
      'HotelTime ตัดผลลัพธ์ที่ 2000 แถวเงียบ ๆ — ปี 2025 และ 2026 ชนเพดานทั้งคู่ ' +
      'แม้แต่ครึ่งปีก็ชน · เดือนที่หนาสุดที่วัดได้คือ 662 แถว เหลือ headroom 3 เท่า',
  },
  hasRowCap: true,
  dailyOnly: false,
  family: 'per-day',
  skipDateCoverageCheck: false,

  /** คอลัมน์ created date ของใบนี้ · เก็บเป็นข้อความ DD/MM/YYYY */
  dateColumn: 'Reserved:',
  searchButton: 'ctl00$pc$btnFind',
  boundaryToleranceDays: 0,

  expectedColumns: [
    'Reservation number', 'Reserved:', 'Group name', 'Arrival',
    'Departure', 'Nights', 'Status', 'Reservation owner',
    'Room', 'Type', 'Assigned type', 'Rooms',
    'Guest', 'Guests', 'Price list',
    // 🔴 'Reservation number' ซ้ำอีกครั้งที่ตำแหน่ง 15 — เป็นแบบนี้ในไฟล์จริง
    'Reservation number', 'Order no.', 'Promo code', 'Reference number',
    'Channel-Manager ID', 'Origin reservation ID', 'Created by',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    // 🔴 ต้องล้างสามช่วงนี้ก่อนเสมอ — `calArrival` ถูกกรอกมาให้เป็น "วันนี้ → อีก 1 ปี"
    // ตั้งแต่เปิดหน้า ถ้าไม่ล้าง ผลจะเป็น intersection ที่ผิดโดยไฟล์หน้าตาปกติ
    // (พิสูจน์แล้ว: ทดสอบ created 01-07/09/2026 มี arrival ถึง 16/08/2027 ในผล
    //  ซึ่งแถว arrival 01-06/09/2026 จะหายทั้งหมดถ้าปล่อยค่า default ไว้)
    await clearDateRange(page, 'ctl00$pc$calArrival', ALLOWED_CONTROLS, REPORT_ID);
    await clearDateRange(page, 'ctl00$pc$calDeparture', ALLOWED_CONTROLS, REPORT_ID);
    await clearDateRange(page, 'ctl00$pc$calStayDate', ALLOWED_CONTROLS, REPORT_ID);

    await setDateRange(
      page,
      'ctl00$pc$calIssued',
      formatDMY(range.from),
      formatDMY(range.to),
      ALLOWED_CONTROLS,
      REPORT_ID,
    );

    // checkbox `cbGroupReservations` ปล่อยเป็นค่า default (ไม่ติ๊ก) ตามที่เจ้าของเลือก
    // = หนึ่งแถวต่อหนึ่งห้อง ไม่ใช่ต่อหนึ่ง reservation
  },

  async hasResults(page: Page): Promise<boolean> {
    // วัดแล้ว: ผลว่าง → ไม่มีแถวสรุปเลย · ผลมีข้อมูล → มี Total amount of reserved rooms
    return (await readTotals(page)).has('Total amount of reserved rooms:');
  },

  async expectedRowCount(page: Page): Promise<number | null> {
    // ใบเดียวในสามใบที่แถวสรุปตรงกับจำนวนแถวในไฟล์พอดี (ยืนยัน: 65 = 65)
    return totalAsNumber(await readTotals(page), 'Total amount of reserved rooms:');
  },
};
