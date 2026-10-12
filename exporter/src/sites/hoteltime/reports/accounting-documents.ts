import type { Page } from 'playwright';
import { formatDMY, OrderError, type DateRange } from '../../../core/order.ts';
import { assertCheckboxes, gridRowCount, setDateRange, setSelect, setText } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * เอกสารบัญชี (ticket 15 ของ exporter-daily-expansion-and-data-store) — `invoices/InvoicesList.aspx?type=…` 4 ชนิด (+ เงินมัดจำ
 * แยกตามชนิดเอกสาร) และ `invoices/InvoicesReport.aspx` · ledger ย้อน 3 วัน กรองด้วยวันที่ออกเอกสาร (Issue date) = อดีตล้วน
 * · recon อ่านอย่างเดียว 2026-10-07 อยู่ใน `recon/NOTES.md`
 *
 * 🔴 InvoicesList กรองทิ้งเงียบ ๆ สองชั้นตามค่าตั้งต้น:
 *  - สถานะ = **to be processed** อย่างเดียว → ตั้ง "(all)" ทุกครั้ง
 *  - ปี (`ddlYear`) **กรองจริง** ด้วยปีของวันที่ออกเอกสาร (ทดลอง 2026-10-07: ช่วง 1–7 ม.ค. 2026 มีผลเฉพาะปี 2026, ช่วง 25–31 ธ.ค.
 *    2025 เฉพาะปี 2025) และไม่มี "ทั้งหมด" → แบ่งก้อนรายเดือน (ก้อนไม่คร่อมปี) แล้วตั้งปีให้ตรงกับก้อน · ก้อนคร่อมปีโยนทันที
 * หน้านี้มีปุ่ม `btnNew` (สร้างเอกสาร) และ `btnPrint` — ห้ามอยู่ในรายการที่อนุญาต
 */

const RANGE = 'ctl00$pc'; // ช่องชื่อ ctl00$pc$calFrom/calTo ตรง ๆ — setDateRange ต่อ suffix ให้ (ไม่ใช่ทั้ง panel)
const DISCHARGE_FROM = 'ctl00$pc$calDischargeFrom';
const DISCHARGE_TO = 'ctl00$pc$calDischargeTo';
const YEAR = 'ctl00$pc$ddlYear';
const STATE = 'ctl00$pc$ddlState';
const DOC_TYPE = 'ctl00$pc$ddlDocType';
const SHOW = 'ctl00$pc$btnShow';

const LIST_COLUMNS = [
  'Invoice number', 'Customer', 'Issue date', 'Tax effective date', 'Due date', 'VAT base', 'VAT', 'Total with VAT',
  'Document value', 'Paid', 'Not paid', 'Currency', 'Remittance date', 'Payment type', 'Invoice status', 'Created by',
  'Note',
];
const DEPOSIT_COLUMNS = [
  'Invoice number', 'Customer', 'Issue date', 'Tax effective date', 'Due date', 'VAT base', 'VAT', 'Total with VAT',
  'Document value', 'Posted on invoices', 'Blocked on accounts', 'Remaining balance', 'VAT charge rate', 'Paid',
  'Not paid', 'Currency', 'Remittance date', 'Payment type', 'Invoice status', 'Created by', 'Note',
];

type ListSpec = {
  readonly id: string;
  readonly label: string;
  readonly query: string;
  readonly expectedColumns: readonly string[];
  /** ชนิดเอกสารในดรอปดาวน์ของหน้าเงินมัดจำ (ค่าตั้งต้น = Deposit invoice) — ไม่มี = หน้านั้นไม่มีดรอปดาวน์นี้ */
  readonly docType?: string;
};

function assertSingleYear(range: DateRange, id: string): void {
  if (range.from.getUTCFullYear() !== range.to.getUTCFullYear()) {
    throw new OrderError(
      `${id}: ช่วง ${formatDMY(range.from)}–${formatDMY(range.to)} คร่อมปี — ดรอปดาวน์ปีกรองได้ทีละปี ` +
        `ต้องแบ่งก้อนรายเดือน (chunk.kind = 'monthly') เท่านั้น`,
    );
  }
}

function invoicesList(spec: ListSpec): Report {
  const allowed = [RANGE, DISCHARGE_FROM, DISCHARGE_TO, YEAR, STATE, ...(spec.docType ? [DOC_TYPE] : []), SHOW];
  return {
    id: spec.id,
    label: spec.label,
    path: `invoices/InvoicesList.aspx?${spec.query}`,
    allowedControls: allowed,
    dailyOnly: false,
    skipDateCoverageCheck: false,
    chunk: { kind: 'monthly', reason: 'ดรอปดาวน์ปีกรองตามปีของวันที่ออกเอกสารและไม่มี "ทั้งหมด" — ก้อนรายเดือนไม่คร่อมปี' },
    // export ไม่ถูกตัดที่ 2000 (ตรวจเบื้องต้นได้ 2,301 แถวในไฟล์เดียว) แต่ไม่ได้พิสูจน์ทุกหน้า จึงให้ชั้นตรวจจับไว้
    hasRowCap: true,
    dateColumn: 'Issue date',
    filterNote: 'กรองด้วยวันที่ออกเอกสาร (Issue date) ทุกสถานะ — สถานะ/ยอดที่จ่ายเปลี่ยนภายหลัง รอบรายวันมองไม่เห็น baseline เก็บ (ADR-0002)',
    searchButton: SHOW,
    dateColumns: ['Issue date', 'Tax effective date', 'Due date', 'Remittance date'],
    boundaryToleranceDays: 0,
    expectedColumns: spec.expectedColumns,

    async applyFilters(page: Page, range: DateRange): Promise<void> {
      assertSingleYear(range, spec.id);
      // ดรอปดาวน์ก่อนช่องวันที่ — AutoPostBack อาจล้างช่องวันที่ที่กรอกไว้ก่อน
      await setSelect(page, STATE, '(all)', allowed, spec.id);
      await setSelect(page, YEAR, String(range.from.getUTCFullYear()), allowed, spec.id);
      if (spec.docType) await setSelect(page, DOC_TYPE, spec.docType, allowed, spec.id);
      await setDateRange(page, RANGE, formatDMY(range.from), formatDMY(range.to), allowed, spec.id);
      await setText(page, DISCHARGE_FROM, '', allowed, spec.id);
      await setText(page, DISCHARGE_TO, '', allowed, spec.id);
    },
    async hasResults(page: Page): Promise<boolean> {
      const rows = await gridRowCount(page, '[id*="dtgData"]');
      return rows !== null && rows > 1;
    },
    async expectedRowCount(): Promise<number | null> {
      return null;
    },
  };
}

export const invoicesAdvance = invoicesList({
  id: 'invoices-advance',
  label: 'Accounting — invoices (type=advance)',
  query: 'type=advance',
  expectedColumns: LIST_COLUMNS,
});

export const invoicesAnnul = invoicesList({
  id: 'invoices-annul',
  label: 'Accounting — invoices (type=annul)',
  query: 'type=annul',
  expectedColumns: LIST_COLUMNS,
});

export const invoicesClosedAccount = invoicesList({
  id: 'invoices-closed-account',
  label: 'Accounting — closed accounts (type=closedaccount)',
  query: 'type=closedaccount',
  expectedColumns: LIST_COLUMNS,
});

// หน้าเดียวกัน (Deposit and GC ledger) แยกสองรายงานตามชนิดเอกสาร — ค่าตั้งต้นแสดงแค่ Deposit invoice
export const depositLedger = invoicesList({
  id: 'deposit-ledger',
  label: 'Deposit and GC ledger — deposit invoices',
  query: 'type=advance&uncharged=true',
  expectedColumns: DEPOSIT_COLUMNS,
  docType: 'Deposit invoice',
});

export const giftCertificateLedger = invoicesList({
  id: 'gift-certificate-ledger',
  label: 'Deposit and GC ledger — gift certificates',
  query: 'type=advance&uncharged=true',
  expectedColumns: DEPOSIT_COLUMNS,
  docType: 'Gift certificate',
});

const IR_ID = 'invoices-report';
const IR_CURRENCY = 'ctl00$pc$ddlCurrency';
const IR_ALLOWED = [RANGE, DISCHARGE_FROM, DISCHARGE_TO, IR_CURRENCY, SHOW];

/**
 * `invoices/InvoicesReport.aspx` — เอกสารทุกชนิดในรายงานเดียว · ช่องชนิดเอกสาร (checkbox 9 ชนิด) ติ๊กครบทุกชนิดเป็นค่าตั้งต้น
 * (recon 2026-10-07) — ไม่แตะ แต่ยืนยันว่ายังติ๊กครบทุกรอบ (`assertCheckboxes`) · สกุลเงินตั้งเป็น "ทั้งหมด" แบบ explicit ·
 * ไม่มีดรอปดาวน์ปี
 */
export const invoicesReport: Report = {
  id: IR_ID,
  label: 'Invoices report (all document types)',
  path: 'invoices/InvoicesReport.aspx',
  allowedControls: IR_ALLOWED,
  dailyOnly: false,
  skipDateCoverageCheck: false,
  chunk: { kind: 'monthly', reason: 'สูงสุด 1,807 แถว/เดือน (baseline 2026-10-07) — ทั้งช่วงเกินเพดาน 2000' },
  hasRowCap: true,
  dateColumn: 'Issue date',
  filterNote: 'กรองด้วยวันที่ออกเอกสาร (Issue date) เอกสารทุกชนิด',
  searchButton: SHOW,
  dateColumns: ['Issue date', 'Tax effective date'],
  boundaryToleranceDays: 0,
  expectedColumns: ['Invoice number', 'Document type', 'Issue date', 'Tax effective date', 'Customer', 'ID', 'Currency', 'VAT base', 'VAT'],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await assertCheckboxes(page, 'ctl00$pc$cblDocType', true);
    await setSelect(page, IR_CURRENCY, '--- all ---', IR_ALLOWED, IR_ID);
    await setDateRange(page, RANGE, formatDMY(range.from), formatDMY(range.to), IR_ALLOWED, IR_ID);
    await setText(page, DISCHARGE_FROM, '', IR_ALLOWED, IR_ID);
    await setText(page, DISCHARGE_TO, '', IR_ALLOWED, IR_ID);
  },
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgData"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
