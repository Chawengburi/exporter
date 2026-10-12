import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setSelect, setSingleDate } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * ยอดคงค้าง ณ วันที่ 2 หน้า (ticket 23 ของ exporter-daily-expansion-and-data-store — ผ่านการตรวจซ้ำใน ticket 22) · ภาพของวันที่ดึง
 * (dailyOnly — ADR-0003) · ช่องวันเดี่ยว `ctl00$pc$calFrom` = "ณ วันที่" (ค่าตั้งต้น = วันนี้) — เดิมการตรวจเบื้องต้นนับเป็นช่วงครึ่งเดียวแล้วล้ม
 * · recon อ่านอย่างเดียว 2026-10-08 อยู่ใน `recon/NOTES.md`
 */

const AS_OF = 'ctl00$pc$calFrom';
const FIND = 'ctl00$pc$btnFind';

type BalanceSpec = {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly expectedColumns: readonly string[];
  readonly filterNote: string;
  /** ดรอปดาวน์ที่ต้องตั้งแบบ explicit ให้ตรงค่าตั้งต้น (กันค่าตั้งต้นเปลี่ยนเงียบ ๆ) */
  readonly selects?: readonly (readonly [name: string, label: string])[];
};

function balanceAsOf(spec: BalanceSpec): Report {
  const allowed = [AS_OF, ...(spec.selects ?? []).map(([n]) => n), FIND];
  return {
    id: spec.id,
    label: spec.label,
    path: spec.path,
    allowedControls: allowed,
    dailyOnly: true,
    // ยอดคงค้างต่อเอกสาร ไม่มีคอลัมน์วันที่ให้เทียบกับ "ณ วันที่"
    skipDateCoverageCheck: true,
    chunk: { kind: 'whole', reason: 'ยอดคงค้าง ณ วันที่ดึง ไม่มีอะไรให้แบ่งก้อน' },
    hasRowCap: true,
    dateColumn: spec.expectedColumns[0]!,
    filterNote: spec.filterNote,
    searchButton: FIND,
    dateColumns: [],
    boundaryToleranceDays: 0,
    expectedColumns: spec.expectedColumns,
    async applyFilters(page: Page, range: DateRange): Promise<void> {
      for (const [name, label] of spec.selects ?? []) await setSelect(page, name, label, allowed, spec.id);
      await setSingleDate(page, AS_OF, formatDMY(range.to), allowed, spec.id);
    },
    async hasResults(page: Page): Promise<boolean> {
      const rows = await gridRowCount(page, '[id*="dtgResult"]');
      return rows !== null && rows > 1;
    },
    async expectedRowCount(): Promise<number | null> {
      return null;
    },
  };
}

// หัวตารางจากไฟล์ที่การตรวจซ้ำดาวน์โหลดจริง (2026-10-08) · คอลัมน์สุดท้ายไม่มีชื่อในไฟล์จริง

export const depositToUse = balanceAsOf({
  id: 'deposit-to-use',
  label: 'Deposit to use',
  path: 'invoices/UnchargedAdvanceJournal.aspx',
  filterNote: 'เงินมัดจำ/บัตรของขวัญที่ยังใช้ไม่หมด ณ วันที่ดึง',
  selects: [['ctl00$pc$ddlDocType', '--- not specified ---']],
  expectedColumns: ['Invoice number', 'Customer', 'Document type', 'Total', 'Used', 'Cancelled', 'To use', ''],
});

export const unpaidInvoicesByDate = balanceAsOf({
  id: 'unpaid-invoices-by-date',
  label: 'Unpaid invoices by date',
  path: 'invoices/CityLedgerJournal.aspx',
  filterNote: 'ใบแจ้งหนี้ที่ยังไม่ได้รับชำระ ณ วันที่ดึง (city ledger)',
  expectedColumns: ['Invoice number', 'Customer', 'Reservation', 'Post master', 'Total', 'Payments', 'Advances', 'To be paid', ''],
});
