import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setSingleDate } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Departures" — รายการผู้เข้าพักที่มีวันออกตรงกับวันที่ระบุ
 *
 * dailyOnly (ADR-0003) เหมือน `arrivals.ts` เป๊ะ — โครงหน้าคล้ายกันมาก (`calDate` เดี่ยว,
 * default = วันนี้, ETD hour/min แทน ETA) recon 2026-09-22 พบว่าวันนี้ (22/09) ไม่มี
 * departure เลย (grid หายไปทั้งตาราง) แต่ 23/09 มี 9 แถว — ใช้วันนั้นดึง expectedColumns จริง
 */
const REPORT_ID = 'departures';

const ALLOWED_CONTROLS = ['ctl00$pc$calDate', 'ctl00$pc$btnFind'];

export const departures: Report = {
  id: REPORT_ID,
  label: 'Departures',
  path: 'reports/RoomDepartures.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: true,
  skipDateCoverageCheck: false,

  chunk: {
    kind: 'whole',
    reason: 'dailyOnly — ช่วงเป็นวันเดียวเสมอ ไม่มีอะไรให้แบ่งก้อน',
  },
  // เหตุผลเดียวกับ arrivals.ts — ยังไม่วัดวันที่ยุ่งที่สุด แต่ query ได้ทีละวันอยู่แล้ว
  hasRowCap: false,

  dateColumn: 'Departure',
  searchButton: 'ctl00$pc$btnFind',
  dateColumns: ['Arrival', 'Departure'],
  boundaryToleranceDays: 0,

  // จากไฟล์ .xlsx ที่ดาวน์โหลดจริง 2026-09-22 (ช่วง 23/09/2026 ซึ่งมีข้อมูล — วันนี้เองว่าง)
  expectedColumns: [
    'Reservation no.', 'Group name', 'Room', 'Room type', 'Arrival', 'Departure',
    'Number of guests', 'Loyalty', 'Age groups', 'Reservation owner', 'Stays', 'Stay',
    'Notes', 'Promo code', 'Guest', 'Payment type', 'Due balance', 'Execute', 'Client type',
    'ETD', 'Departure flight details:', 'Room requests', 'Reservation request',
    'Operation flags - reservation', 'Operation flags - room',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await setSingleDate(page, 'ctl00$pc$calDate', formatDMY(range.from), ALLOWED_CONTROLS, REPORT_ID);
  },

  /** ไม่มีแถวสรุปที่เชื่อถือได้ (เหมือน arrivals.ts) — ใช้ตารางผลลัพธ์แทน */
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgItems"]');
    return rows !== null && rows > 1;
  },

  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
