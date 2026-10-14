import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setDateRange } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Manual postings report" (`reports/RetailReport.aspx`) — รายการที่ลงมือ (ขายหน้าร้าน/บริการเสริม) กรองด้วยวันที่ลงรายการ
 * = อดีตล้วน · ticket 18 ของ exporter-daily-expansion-and-data-store · recon อ่านอย่างเดียว 2026-10-07 อยู่ใน `recon/NOTES.md`
 *
 * ช่วงวันที่ชื่อ `ctl00$pc$calFrom/calTo` ตรง ๆ (group = `ctl00$pc`) ค่าตั้งต้น 7 วันล่าสุด — ตั้งทับทุกครั้ง · ไม่มีตัวกรองอื่น
 */
const REPORT_ID = 'manual-postings';
const RANGE = 'ctl00$pc';
const FIND = 'ctl00$pc$btnFind';
const ALLOWED_CONTROLS = [RANGE, FIND];

export const manualPostings: Report = {
  id: REPORT_ID,
  label: 'Manual postings report',
  path: 'reports/RetailReport.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: false,
  family: 'per-day',
  skipDateCoverageCheck: false,
  // วัดจริง 2,061 แถวใน 90 วัน (~700/เดือน) — ก้อนรายเดือนห่างเพดาน แต่ทั้งช่วงตั้งแต่ 2024 เกิน 2000 แน่
  chunk: { kind: 'monthly', reason: '~700 แถว/เดือน — ทั้งช่วงตั้งแต่ 2024 เกินเพดาน 2000' },
  hasRowCap: true,
  dateColumn: 'Date from',
  filterNote: 'กรองด้วยวันที่ลงรายการ (Date from)',
  searchButton: FIND,
  boundaryToleranceDays: 0,
  // คอลัมน์ที่ 2 ไม่มีชื่อในไฟล์จริง
  expectedColumns: [
    'Document no.', '', 'Date from', 'Amount', 'Service / product', 'VAT', 'Price / unit', 'Total price', 'Currency',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
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
