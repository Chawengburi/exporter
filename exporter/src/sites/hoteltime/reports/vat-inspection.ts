import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { setText } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Inspection" — ภาษีแยกรายอัตรา (`invoices/AccontancyInvoiceReport.aspx`, ชื่อหน้าสะกดผิดตามของจริง) — ticket 04 ของ
 * `.scratch/exporter-hoteltime-gold-feed/` · ฝั่ง Gold (hoteltime-schema) เก็บเข้า Silver `hoteltime_vat_inspection` เท่านั้น ยังไม่มีตาราง Gold ใดอ่าน
 *
 * 1 แถว = 1 ใบ เลขใบตรงกับ `vat-output` ทุกใบ (ต.ค. 2026 466/466, พ.ย. 2025 814/814 — DUPCHECK 2026-11-03) แต่ตัวเลขภาษีต่างกันทุกใบ:
 * อัตรา 17.7% = ค่าบริการ 10% + VAT 7% คิดบนฐานรวมค่าบริการ · ไม่ใช่ข้อมูลซ้ำ จึงเป็นรายงานของตัวเอง · ไม่มี Issue date / Document type / Status
 * / Linked documents · คอลัมน์ `Tax ID` ว่างเกือบทุกแถว · หัวคอลัมน์ฝังอัตรา (17.7% / 7%) ถ้าอัตราเปลี่ยน ด่านหัวตารางจะล้มดัง ๆ ซึ่งตั้งใจ
 *
 * recon สดอ่านอย่างเดียว 2026-11-16 (+ ทดสอบเดิม 2026-11-03): ช่วงวันที่ = `ctl00$pc$calDUZPFrom/To` (DUZP = วันที่ภาษีมีผล) กรองด้วย
 * **Tax effective day** · ปุ่มค้นหา `btnFind` · export `pc_btnExportXLS` (ไฟล์มีสองชีต `a4` ว่าง กับ `a5` มีข้อมูล) · **ตารางผลลัพธ์ไม่มี id**
 * (`table.stndtable` — แถวหัวตารางไม่ใช่แถวแรก และมีแถวหัวซ้ำอีกหนึ่งแถว) จึงนับแถวข้อมูลเองใน `hasResults` · ช่อง `tbLimit` ค่าตั้งต้น 10000
 * ไม่ใช่เพดาน 2000 แบบหน้าอื่น (เดือนที่ใหญ่สุดที่เห็น 814 แถว) · ช่วงที่ไม่มีใบ (ม.ค. 2020) = ไม่มีแถวข้อมูลเลย
 *
 * ไม่ตรวจค่าใด ๆ ฝั่ง exporter · ไม่ตัดคอลัมน์ PII (Customer, Tax ID) — ไฟล์ดิบเก็บใน `data/` ที่ gitignore
 */
const REPORT_ID = 'vat-inspection';
const FROM = 'ctl00$pc$calDUZPFrom';
const TO = 'ctl00$pc$calDUZPTo';
const FIND = 'ctl00$pc$btnFind';
const ALLOWED_CONTROLS = [FROM, TO, FIND];

export const vatInspection: Report = {
  id: REPORT_ID,
  label: 'VAT Inspection (Tax breakdown)',
  path: 'invoices/AccontancyInvoiceReport.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: false,
  family: 'per-day',
  skipDateCoverageCheck: false,
  chunk: { kind: 'monthly', reason: 'ราว 470-820 ใบ/เดือน (ต.ค. 2026 = 466, พ.ย. 2025 = 814) — รายเดือนห่างเพดานหน้า (ช่อง Limit ตั้งต้น 10000)' },
  // หน้านี้ไม่มีเพดาน 2000 แบบหน้าอื่น (ช่อง Limit = 10000) — ไม่ผ่าครึ่งตามเพดาน
  hasRowCap: false,
  dateColumn: 'Tax effective day',
  filterNote: 'กรองด้วยวันที่ภาษีมีผล (Tax effective day) — ยืนยันกับหน้าจริงแล้ว (recon 2026-11-16)',
  exportLink: 'pc_btnExportXLS',
  searchButton: FIND,
  boundaryToleranceDays: 0,
  expectedColumns: [
    'Invoice number', 'Customer', 'Tax ID', 'Tax effective day', 'Total in invoice currency',
    'VAT base 17.7%', 'VAT 17.7%', 'VAT base 7%', 'VAT 7%',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await setText(page, FROM, formatDMY(range.from), ALLOWED_CONTROLS, REPORT_ID);
    await setText(page, TO, formatDMY(range.to), ALLOWED_CONTROLS, REPORT_ID);
  },
  async hasResults(page: Page): Promise<boolean> {
    // ตารางผลลัพธ์ไม่มี id: หาจากหัวคอลัมน์ "VAT base 17.7%" แล้วนับแถวหลังหัวตารางที่มีเลขใบจริง (ไม่นับแถวหัวซ้ำ / แถวว่าง)
    return page.evaluate(() => {
      const head = [...document.querySelectorAll('td,th')].find((c) => /^VAT base 17\.7%/.test((c.textContent ?? '').trim()));
      const table = head?.closest('table');
      const headRow = head?.closest('tr');
      if (!table || !headRow) return false;
      const rows = [...table.rows];
      return rows.slice(rows.indexOf(headRow as HTMLTableRowElement) + 1).some((r) => {
        const first = (r.cells[0]?.textContent ?? '').trim();
        return r.cells.length >= 9 && first !== '' && first !== 'Invoice number';
      });
    });
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
