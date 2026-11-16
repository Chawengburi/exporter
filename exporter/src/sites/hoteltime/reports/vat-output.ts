import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setDateRange } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "VAT Output" (`invoices/invoicesVatOutputReport.aspx`) — ticket 01 ของ `.scratch/exporter-hoteltime-gold-feed/` · ต้นแบบ selector:
 * `hoteltime-schema/exploration/recon/live-export-vat-accounts-open.mjs` (ช่วง `ctl00$pc$calFrom/calTo` · `ctl00$pc$btnShow` ·
 * ปุ่ม export `pc_btnExportXLS`) · 1 แถว = 1 ใบกำกับภาษี (DEP / CLHA / CORR) ใช้เป็นแหล่งของ `ht_gold_invoice`
 *
 * recon สด 2026-11-16 (อ่านอย่างเดียว) ยืนยันแล้ว: (1) ฟอร์มกรองด้วย **Issue date** — ใบ DEP ที่ Issue 28/11/2025 แต่ Tax effective 27/11/2025 โผล่เมื่อกรองวันที่ 28
 * ไม่โผล่เมื่อกรองวันที่ 27 (ใบที่สองวันนี้ต่างกันมีแค่ 1 ใน 814 ใบของ พ.ย. 2025) (2) ตารางผลลัพธ์ = `pc_dtgData` (อีกตาราง `pc_cblDocType` เป็นตัวกรองชนิดเอกสาร
 * ค่าตั้งต้นให้ครบทุกชนิด) (3) ค่าที่ได้ ต.ค. 2026 = 466 ใบ (DEP 297 / CLHA 169) · พ.ย. 2025 = 814 ใบ (DEP 554 / CLHA 251 / CORR 9 · Issued 806 / Cancelled 8)
 * รวม 1,280 ใบ ตรงตัวเลขอ้างอิง · ไม่ชนเพดาน 2000 ที่ช่วงรายเดือน · ไฟล์ xlsx ผ่านด่านหัวตาราง 14 คอลัมน์ (หมายเหตุ: ตารางบนหน้าเว็บเรียกคอลัมน์ที่ 8
 * ว่า `Branch` แต่ไฟล์ xlsx ที่ export ใช้ `Identity document no.` ซึ่งเป็นชื่อที่ Gold ของ hoteltime-schema รอ)
 *
 * ไม่ตรวจค่า `Document type` / `Status` ที่ฝั่ง exporter และไม่ตัดคอลัมน์ PII (Customer, Tax ID, Identity document no.) — ไฟล์ดิบเก็บใน
 * `data/` ที่ gitignore · Gold แยกชนิดใบจากตัวนำหน้าเลขใบ (DEP/CLHA/CORR) และรับ Status เฉพาะ Issued/Cancelled ถ้ามีค่าอื่น Gold build พัง
 */
const REPORT_ID = 'vat-output';
const RANGE = 'ctl00$pc'; // setDateRange ต่อ suffix calFrom/calTo ให้เอง (เหมือน deposit-journal)
const SHOW = 'ctl00$pc$btnShow';
const ALLOWED_CONTROLS = [RANGE, SHOW];

export const vatOutput: Report = {
  id: REPORT_ID,
  label: 'VAT Output',
  path: 'invoices/invoicesVatOutputReport.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: false,
  family: 'per-day',
  skipDateCoverageCheck: false,
  chunk: { kind: 'monthly', reason: 'ราว 600 ใบ/เดือน (ตัวเลขอ้างอิง พ.ย. 2025 + ต.ค. 2026 = 1,280 ใบ) — รายเดือนห่างเพดาน 2000' },
  // เดือนที่ใหญ่สุดที่เห็น 814 ใบ ห่างเพดาน 2000 — คงด่านเพดานไว้ (ล้มดัง ๆ ดีกว่าได้ไฟล์ขาดเงียบ ๆ)
  hasRowCap: true,
  dateColumn: 'Issue date',
  filterNote: 'กรองด้วยวันที่ออกใบ (Issue date) — ยืนยันกับหน้าจริงแล้ว (recon 2026-11-16)',
  exportLink: 'pc_btnExportXLS',
  searchButton: SHOW,
  boundaryToleranceDays: 0,
  expectedColumns: [
    'No.', 'Invoice number', 'Document type', 'Issue date', 'Tax effective date', 'Customer', 'Tax ID', 'Identity document no.',
    'Currency', 'VAT base', 'VAT', 'Total', 'Status', 'Linked documents',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await setDateRange(page, RANGE, formatDMY(range.from), formatDMY(range.to), ALLOWED_CONTROLS, REPORT_ID);
  },
  async hasResults(page: Page): Promise<boolean> {
    // recon สด 2026-11-16: ตารางผลลัพธ์คือ `pc_dtgData` (ตารางอื่นในหน้า = `pc_cblDocType` ตัวกรองชนิดเอกสาร)
    const rows = await gridRowCount(page, '[id$="dtgData"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
