import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { assertCheckboxes, gridRowCount, setDateRange, setSelect, setSingleDate } from '../webforms.ts';
import type { Report } from './_types.ts';
import { monthToDate } from './month-to-date.ts';

/**
 * Manager reports (ticket 23–24 ของ exporter-daily-expansion-and-data-store) · recon อ่านอย่างเดียว 2026-10-08 อยู่ใน `recon/NOTES.md`
 *
 * `Reports.aspx?type=manager` มี export สองแบบ — เจ้าของระบบเลือกเอาทั้งคู่ (2026-10-08):
 *  - สรุปรายได้ต่อ revenue centre (`pc_btnExportXLS`, ~10 แถว) → ภาพรวม "เดือนนี้ถึงวันนี้" ตามค่าตั้งต้นของหน้า
 *  - รายการรายได้ (`pc_btnExportXLSItems`, มีคอลัมน์ Date — baseline สูงสุด 21,212 แถว/เดือน) → ledger ย้อน 3 วัน เพื่อให้แต่ละวัน
 *    เห็นรายการใหม่โดยไม่ต้องโหลดทั้งเดือนซ้ำทุกวัน · export นี้ไม่ถูกตัดที่ 2000 (baseline 2026-10-08)
 * `reports/RastrDayDetail.aspx` (Manager day detail) — รายได้ของวันเดียว ค่าตั้งต้นคือ**เมื่อวาน** (วันที่ปิดยอดแล้ว) → ภาพของเมื่อวาน
 * · ดรอปดาวน์ตัวกรองทุกตัวตั้งแบบ explicit ให้ตรงค่าตั้งต้น (ทั้งหมด/ไม่ระบุ) และยืนยันว่าชนิดรายได้ 4 ชนิดยังติ๊กครบ
 */

const RANGE = 'ctl00$pc'; // ช่องชื่อ ctl00$pc$calFrom/calTo ตรง ๆ — setDateRange ต่อ suffix ให้ (ไม่ใช่ทั้ง panel)
const FIND = 'ctl00$pc$btnFind';

/** ตัวกรองที่สองหน้าใช้ร่วมกัน ค่าตั้งต้น = ไม่ระบุ */
const COMMON_SELECTS: readonly (readonly [string, string])[] = [
  ['ctl00$pc$ddlSegment', '--- not specified ---'],
  ['ctl00$pc$ddlService', '--- not specified ---'],
  ['ctl00$pc$ddlNationality', '--- not specified ---'],
  ['ctl00$pc$ddlSeller', '--- not specified ---'],
  ['ctl00$pc$ddlClientType', '--- not specified ---'],
];
/** ตัวกรองเฉพาะหน้า Manager reports · กลุ่มห้อง/ประเภทห้องเป็น AutoPostBack — setSelect รอให้เอง */
const MANAGER_SELECTS: readonly (readonly [string, string])[] = [
  ['ctl00$pc$ddlCurrency', '--- all ---'],
  ['ctl00$pc$roomTypeFilter$ddlRoomTypeGroup', '--- all ---'],
  ['ctl00$pc$roomTypeFilter$ddlRoomType', '--- all ---'],
  ['ctl00$pc$roomTypeFilter$ddlRoom', '--- all ---'],
  ...COMMON_SELECTS,
  ['ctl00$pc$ddlGroupBy', 'Revenue centre'],
];
const MANAGER_ALLOWED = [RANGE, ...MANAGER_SELECTS.map(([n]) => n), FIND];

async function managerFilters(page: Page, window: DateRange, id: string): Promise<void> {
  await assertCheckboxes(page, 'ctl00$pc$cblDocType', true);
  for (const [name, label] of MANAGER_SELECTS) await setSelect(page, name, label, MANAGER_ALLOWED, id);
  await setDateRange(page, RANGE, formatDMY(window.from), formatDMY(window.to), MANAGER_ALLOWED, id);
}

async function hasManagerGrid(page: Page): Promise<boolean> {
  const rows = await gridRowCount(page, '[id*="dtgManagerGrid"]');
  return rows !== null && rows > 1;
}

const MS_ID = 'manager-summary';
export const managerSummary: Report = {
  id: MS_ID,
  label: 'Manager reports — revenue summary',
  path: 'Reports.aspx?type=manager',
  allowedControls: MANAGER_ALLOWED,
  exportLink: 'pc_btnExportXLS',
  dailyOnly: true,
  skipDateCoverageCheck: true, // ยอดรวมต่อ revenue centre ไม่มีคอลัมน์วันที่
  chunk: { kind: 'whole', reason: 'ยอดรวมเดือนนี้ถึงวันนี้ — ค้นทีเดียว' },
  hasRowCap: false,
  dateColumn: 'Name',
  filterNote: 'รายได้รวมต่อ revenue centre เดือนนี้ถึงวันนี้ (ค่าตั้งต้นของหน้า)',
  dataWindow: monthToDate,
  searchButton: FIND,
  dateColumns: [],
  boundaryToleranceDays: 0,
  expectedColumns: [
    'Name', 'Total excl. VAT', 'VAT:', 'Including VAT', 'Currency', 'Converted to THB (excl.VAT)', 'Converted to USD (excl.VAT)',
  ],
  applyFilters: (page: Page, range: DateRange) => managerFilters(page, monthToDate(range.to), MS_ID),
  hasResults: hasManagerGrid,
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};

const MI_ID = 'manager-items';
export const managerItems: Report = {
  id: MI_ID,
  label: 'Manager reports — revenue items',
  path: 'Reports.aspx?type=manager',
  allowedControls: MANAGER_ALLOWED,
  exportLink: 'pc_btnExportXLSItems',
  dailyOnly: false,
  skipDateCoverageCheck: false,
  // baseline 2026-10-08: 313,495 แถวใน 34 ก้อน สูงสุด 21,212 แถวในไฟล์เดียว — export นี้ไม่ถูกตัดที่ 2000 (ไม่มีก้อนไหนได้ 2000 พอดี)
  chunk: { kind: 'monthly', reason: 'สูงสุด ~21,000 แถว/เดือน และ export ไม่ถูกตัดที่ 2000 — รายเดือนพอ' },
  hasRowCap: false,
  dateColumn: 'Date',
  filterNote: 'รายการรายได้ กรองด้วยวันที่ของรายการ (Date)',
  searchButton: FIND,
  dateColumns: ['Date'],
  boundaryToleranceDays: 0,
  expectedColumns: [
    'ID', 'Name', 'Date', 'Decription', 'Amount', 'VAT charge', 'Total excl. VAT (THB)', 'VAT: (THB)', 'Total excl. VAT (USD)', 'VAT: (USD)',
  ],
  applyFilters: (page: Page, range: DateRange) => managerFilters(page, range, MI_ID),
  hasResults: hasManagerGrid,
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};

const DD_ID = 'manager-day-detail';
const DD_DATE = 'ctl00$pc$calDate';
const DD_SHOW = 'ctl00$pc$btnShow';
const DD_ALLOWED = [DD_DATE, ...COMMON_SELECTS.map(([n]) => n), DD_SHOW];
const DAY_MS = 86_400_000;
const yesterday = (day: Date): DateRange => {
  const d = new Date(day.getTime() - DAY_MS);
  return { from: d, to: d };
};

export const managerDayDetail: Report = {
  id: DD_ID,
  label: 'Manager reports — day detail (yesterday)',
  path: 'reports/RastrDayDetail.aspx',
  allowedControls: DD_ALLOWED,
  dailyOnly: true,
  skipDateCoverageCheck: true, // รายได้ต่อรายการของวันเดียว ไม่มีคอลัมน์วันที่
  chunk: { kind: 'whole', reason: 'รายได้ของเมื่อวานวันเดียว' },
  hasRowCap: true,
  dateColumn: 'Revenue centre',
  filterNote: 'รายได้รายการของเมื่อวาน (วันที่ปิดยอดแล้ว — ค่าตั้งต้นของหน้า)',
  dataWindow: yesterday,
  searchButton: DD_SHOW,
  dateColumns: [],
  boundaryToleranceDays: 0,
  expectedColumns: ['Revenue centre', 'Item', 'Including VAT', 'Total excl. VAT', 'Currency', 'Room'],
  async applyFilters(page: Page, range: DateRange): Promise<void> {
    for (const [name, label] of COMMON_SELECTS) await setSelect(page, name, label, DD_ALLOWED, DD_ID);
    await setSingleDate(page, DD_DATE, formatDMY(yesterday(range.to).from), DD_ALLOWED, DD_ID);
  },
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id$="dtgItems"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
