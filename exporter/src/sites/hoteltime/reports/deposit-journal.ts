import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setDateRange } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Deposit journal" (`invoices/AdvanaceLinksJournal.aspx`) — การผูกเงินมัดจำเข้ากับใบแจ้งหนี้จริง กรองด้วยเวลาที่ผูก (Date and time)
 * = อดีตล้วน · ticket 22 (ผ่านตอนตรวจซ้ำด้วยช่วงวันที่ตั้งต้นของหน้า — รอบแรกตั้ง 90 วันแล้วปุ่ม export หาย) · ช่วง `ctl00$pc$calFrom/calTo`
 * ค่าตั้งต้น = วันนี้ · `btnFind` · ตาราง `dtgResult` · recon อ่านอย่างเดียว 2026-10-08 อยู่ใน `recon/NOTES.md`
 */
const REPORT_ID = 'deposit-journal';
const RANGE = 'ctl00$pc'; // ช่องชื่อ ctl00$pc$calFrom/calTo ตรง ๆ — setDateRange ต่อ suffix ให้ (ไม่ใช่ทั้ง panel)
const FIND = 'ctl00$pc$btnFind';
const ALLOWED_CONTROLS = [RANGE, FIND];

export const depositJournal: Report = {
  id: REPORT_ID,
  label: 'Deposit journal',
  path: 'invoices/AdvanaceLinksJournal.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: false,
  family: 'per-day',
  skipDateCoverageCheck: false,
  chunk: { kind: 'monthly', reason: 'สูงสุด 1,208 แถว/เดือน (baseline 2026-10-08) — รายเดือนห่างเพดาน 2000' },
  // 🔴 ไม่เคยเห็นหน้านี้คืน 2000 แถวพอดี — ช่วง 90 วันรอบแรกทำให้ปุ่ม export หายไปเลย ด่านเพดานจึงอาจไม่ทำงานกับหน้านี้ เดือนที่ใหญ่มาก
  // น่าจะล้มดัง ๆ (ไม่มีไฟล์) มากกว่าได้ไฟล์ขาดเงียบ ๆ
  hasRowCap: true,
  dateColumn: 'Date and time',
  filterNote: 'กรองด้วยเวลาที่ผูกเงินมัดจำเข้ากับใบแจ้งหนี้ (Date and time)',
  searchButton: FIND,
  boundaryToleranceDays: 0,
  // คอลัมน์สุดท้ายไม่มีชื่อในไฟล์จริง
  expectedColumns: [
    'Date and time', 'Final invoice', 'Reservation', 'Post masters', 'Final invoice Customer', 'Deposit', 'Customer',
    'Final invoice total', 'Payments', 'Used', '',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await setDateRange(page, RANGE, formatDMY(range.from), formatDMY(range.to), ALLOWED_CONTROLS, REPORT_ID);
  },
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgResult"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
