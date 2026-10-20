import type { Page } from 'playwright';
import { DEFAULT_FROM_DMY, formatDMY, parseDMY, type DateRange } from '../../../core/order.ts';
import { clearDateRange, gridRowCount, setDateRange } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * ใบแจ้งหนี้ค้างชำระ `invoices/UnchargedInvoices.aspx` (ticket 16 ของ exporter-daily-expansion-and-data-store) · recon อ่านอย่างเดียว
 * 2026-10-07 อยู่ใน `recon/NOTES.md`
 *
 * 🔴 ทั้งสองหน้าเป็น**รายการสถานะ ณ ตอนดึง** ไม่ใช่ ledger ที่สะสม — ใบที่ชำระครบแล้วหายไปจากรายการ จึงเก็บเป็น snapshot ของวันที่ดึง
 * (dailyOnly — ADR-0003): ไฟล์ของแต่ละวันคือ "ค้างอยู่อะไรบ้าง ณ วันนั้น" · เดิมทำ taxes เป็น ledger ย้อน 3 วัน ซึ่งให้แค่ใบค้างที่ออกใน
 * 3 วันล่าสุด (วันที่ทดสอบ = 0 จาก 12 ใบที่ค้างจริง) และไฟล์เก่าค้างใบที่จ่ายแล้วไว้จนถึง baseline ถัดไป — code review ticket 16
 */

const T_ID = 'uncharged-invoices';
const T_ISSUED = 'ctl00$pc$dtIssued';
const T_DISCHARGE = 'ctl00$pc$dtDischarge';
const T_EXPIRATION = 'ctl00$pc$dtExpiration';
const FIND = 'ctl00$pc$btnFind';
const T_ALLOWED = [T_ISSUED, T_DISCHARGE, T_EXPIRATION, FIND];

/**
 * แท็บ "by taxes" — ใบแจ้งหนี้ที่ยังค้างชำระทั้งหมด ณ วันที่ดึง: ตั้งช่วงวันที่ออกเอกสารเองเป็นวันแรกที่มีข้อมูล (DEFAULT_FROM_DMY) ถึงวันนี้
 * (ค่าตั้งต้นของหน้าคือ 14 วันล่าสุด) · ช่วง Discharge และวันหมดอายุล้างทิ้ง · Last payment date ของใบที่ยังไม่เคยจ่ายเป็น "---"
 */
export const unchargedInvoices: Report = {
  id: T_ID,
  label: 'Uncharged invoices — by taxes',
  path: 'invoices/UnchargedInvoices.aspx?type=taxes',
  allowedControls: T_ALLOWED,
  dailyOnly: true,
  family: 'picture',
  period: 'none',
  // ช่วงที่ค้นกว้างกว่า "วันนี้" ที่ชั้นตรวจเทียบ (ค้นตั้งแต่ 2024) — ด่าน "อยู่ในช่วง" ใช้ไม่ได้ · ตัวกรองยังพิสูจน์ได้จากหัวตาราง
  skipDateCoverageCheck: true,
  chunk: { kind: 'whole', reason: 'snapshot ของวันที่ดึง — ค้นทั้งช่วงทีเดียว (ค้างชำระ 12 ใบ ณ 2026-10-07)' },
  // ถ้าวันหนึ่งค้างถึง 2000 ใบ ชั้นตรวจจะล้มดัง ๆ (ผ่าครึ่งวันเดียวไม่ได้) ซึ่งดีกว่าได้รายการขาดเงียบ ๆ
  hasRowCap: true,
  dateColumn: 'Issue date',
  filterNote: `ใบที่ยังค้างชำระทั้งหมด ณ วันที่ดึง (ออกเอกสารตั้งแต่ ${DEFAULT_FROM_DMY}) — ใบที่ชำระครบหายจากรายการ`,
  dataWindow: (day) => ({ from: parseDMY(DEFAULT_FROM_DMY), to: day }),
  searchButton: FIND,
  boundaryToleranceDays: 0,
  expectedColumns: [
    'Invoice number', 'Customer', 'Issue date', 'Tax effective date', 'Due date', 'No. of days after due date',
    'Last payment date', 'Total including VAT', 'Deposit including VAT', 'Paid', 'Open balance',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await setDateRange(page, T_ISSUED, DEFAULT_FROM_DMY, formatDMY(range.to), T_ALLOWED, T_ID); // = dataWindow
    await clearDateRange(page, T_DISCHARGE, T_ALLOWED, T_ID);
    await clearDateRange(page, T_EXPIRATION, T_ALLOWED, T_ID);
  },
  async hasResults(page: Page): Promise<boolean> {
    // `[id$=…]` ไม่ใช่ `*=` — หน้านี้มี `dtgUnchargedInvoicesBySubjects` ของอีกแท็บด้วย
    const rows = await gridRowCount(page, '[id$="dtgUnchargedInvoices"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};

const S_ID = 'uncharged-invoices-by-customer';

/**
 * แท็บ "by subjects" — ยอดค้างชำระรวมต่อลูกค้า แยกตามอายุหนี้ (ก่อนครบกำหนด / 0–30 / 31–60 / 61–90 / 91+ วัน) · ไม่มีตัวกรอง
 * เก็บเป็น snapshot ของวันที่ดึงทุกวัน (dailyOnly — ADR-0003)
 */
export const unchargedInvoicesByCustomer: Report = {
  id: S_ID,
  label: 'Uncharged invoices — aging by customer',
  path: 'invoices/UnchargedInvoices.aspx?type=subjects',
  allowedControls: [FIND],
  dailyOnly: true,
  family: 'picture',
  period: 'none',
  skipDateCoverageCheck: true,
  chunk: { kind: 'whole', reason: 'snapshot ของวันที่ดึง ไม่มีตัวกรอง' },
  hasRowCap: false,
  dateColumn: 'Customer',
  filterNote: 'ยอดค้างชำระต่อลูกค้า ณ วันที่ดึง แยกตามอายุหนี้ — ไม่มีตัวกรองวันที่',
  searchButton: FIND,
  boundaryToleranceDays: 0,
  expectedColumns: ['Customer', 'Before due date', '0 - 30', '31 - 60', '61 - 90', '91 and more', 'Total to pay'],

  async applyFilters(): Promise<void> {
    // ไม่มีตัวกรอง — กดค้นหาอย่างเดียว
  },
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id$="dtgUnchargedInvoicesBySubjects"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
