import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { assertCheckboxes, clearDateRange, gridRowCount, setDateRange, setSelect } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Accounting report" (`AccountancyDocuments.aspx`) — เอกสารบัญชีพร้อมยอด VAT · ticket 24 ของ exporter-daily-expansion-and-data-store
 *
 * หน้านี้มี export สองแบบ เจ้าของระบบเลือกเอาทั้งคู่ (2026-10-08): สรุป (`pc_btnExportXLS`) และรายละเอียด (`pc_btnExportDetailXLS`) —
 * แถวชุดเดียวกัน ฉบับรายละเอียดเพิ่มคอลัมน์ลูกค้า (ID, เลขผู้เสียภาษี, ประเทศ) · ledger ย้อน 3 วัน กรองด้วยวันที่ภาษีมีผล (ค่าตั้งต้นของ
 * `ddlDateFilter` = Vat effective date — ตั้งแบบ explicit) · ช่วงวันที่ของรายการ (`drItemDate`) ล้าง · ดรอปดาวน์ชนิดเอกสาร/การชำระตั้งเป็น
 * "ทั้งหมด" · ยืนยันว่า "Group by VAT" ยังติ๊ก (ค่าตั้งต้น — ผลแยกแถวตามอัตรา VAT) · recon อ่านอย่างเดียว 2026-10-08 อยู่ใน `recon/NOTES.md`
 */

const DATE_RANGE = 'ctl00$pc$drDate';
const ITEM_RANGE = 'ctl00$pc$drItemDate';
const FIND = 'ctl00$pc$btnFind';
const SELECTS: readonly (readonly [string, string])[] = [
  ['ctl00$pc$ddlDateFilter', 'Vat effective date'],
  ['ctl00$pc$ddlDocumentType', '--- all ---'],
  ['ctl00$pc$ddlPaymentType', '--- all ---'],
  ['ctl00$pc$ddlPaymentCurrency', '--- all ---'],
  ['ctl00$pc$ddlPaymentTarget', '--- all ---'],
];
const ALLOWED = [DATE_RANGE, ITEM_RANGE, ...SELECTS.map(([n]) => n), FIND];

const SUMMARY_COLUMNS = [
  'Invoice number', 'Customer - payer', 'Tax effective date', 'Issue date', 'Type', 'Payment type', 'Payment target', 'Text',
  'Service type', 'VAT base', 'Service charge', 'VAT', 'Total incl. VAT',
];

function accountingReport(spec: { id: string; label: string; exportLink: string; expectedColumns: readonly string[] }): Report {
  return {
    id: spec.id,
    label: spec.label,
    path: 'AccountancyDocuments.aspx',
    allowedControls: ALLOWED,
    exportLink: spec.exportLink,
    dailyOnly: false,
    skipDateCoverageCheck: false,
    // baseline 2026-10-08: 45,162 แถวใน 34 ก้อน สูงสุด 3,058 แถวในไฟล์เดียว — export นี้ไม่ถูกตัดที่ 2000
    chunk: { kind: 'monthly', reason: 'สูงสุด ~3,000 แถว/เดือน และ export ไม่ถูกตัดที่ 2000 — รายเดือนพอ' },
    hasRowCap: false,
    dateColumn: 'Tax effective date',
    filterNote: 'กรองด้วยวันที่ภาษีมีผล (Tax effective date) — เอกสารทุกชนิด แยกแถวตามอัตรา VAT',
    searchButton: FIND,
    dateColumns: ['Tax effective date', 'Issue date'],
    boundaryToleranceDays: 0,
    expectedColumns: spec.expectedColumns,
    async applyFilters(page: Page, range: DateRange): Promise<void> {
      await assertCheckboxes(page, 'ctl00$pc$cbGroupByVat', true);
      for (const [name, label] of SELECTS) await setSelect(page, name, label, ALLOWED, spec.id);
      await setDateRange(page, DATE_RANGE, formatDMY(range.from), formatDMY(range.to), ALLOWED, spec.id);
      await clearDateRange(page, ITEM_RANGE, ALLOWED, spec.id);
    },
    async hasResults(page: Page): Promise<boolean> {
      // ตารางรายการคือ id `dtgdata` (ตัวเล็ก) — `dtgData` (ตัวใหญ่) อีกตัวคือตารางสรุป
      const rows = await gridRowCount(page, '[id="dtgdata"]');
      return rows !== null && rows > 1;
    },
    async expectedRowCount(): Promise<number | null> {
      return null;
    },
  };
}

export const accountingReportSummary = accountingReport({
  id: 'accounting-report',
  label: 'Accounting report',
  exportLink: 'pc_btnExportXLS',
  expectedColumns: SUMMARY_COLUMNS,
});

export const accountingReportDetail = accountingReport({
  id: 'accounting-report-detail',
  label: 'Accounting report — detail (with customer IDs)',
  exportLink: 'pc_btnExportDetailXLS',
  expectedColumns: [...SUMMARY_COLUMNS, 'Customer ID', 'Customer VAT NO.', 'Country of customer:'],
});
