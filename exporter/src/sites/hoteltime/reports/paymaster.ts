import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { clearDateRange, gridRowCount, setDateRange, setSelect } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * Post masters 2 หน้า (ticket 14 ของ exporter-daily-expansion-and-data-store) — ledger ย้อน 3 วันแบบรายงาน reservations-*
 * recon อ่านอย่างเดียว 2026-10-07 อยู่ใน `recon/NOTES.md`
 */

const PM_ID = 'post-masters';
const PM_ISSUED = 'ctl00$pc$drIssued';
const PM_ITEMS = 'ctl00$pc$drItems';
const PM_STATE = 'ctl00$pc$ddlState';
const PM_SHOW = 'ctl00$pc$btnShow';
// 🔴 หน้านี้มีปุ่ม `ctl00$pc$btnNew` (สร้างบัญชีใหม่) — ห้ามอยู่ในรายการนี้เด็ดขาด
const PM_ALLOWED = [PM_ISSUED, PM_ITEMS, PM_STATE, PM_SHOW];

/**
 * "Post masters" — บัญชี post master (บัญชีลูกหนี้/บริษัท) กรองด้วยวันที่ออกบัญชี (Issue date) = อดีตล้วน
 *
 * 🔴 ค่าตั้งต้นของหน้ากรองทิ้งเงียบ ๆ: สถานะ = **Open** อย่างเดียว — ต้องตั้งเป็น "--- not specified ---" (ทุกสถานะ) ทุกครั้ง
 * · ดรอปดาวน์ปี (`ddlYear`, ไม่มี "ทั้งหมด") **ไม่มีผลเมื่อกรอกช่วงวันที่ออกบัญชี** — ทดลองจริง 2026-10-07: เดือนเดียวกันได้
 * จำนวนแถวเท่ากันทุกปี (2024/2025/2026) จึงไม่แตะ · สถานะ Paid/unpaid ที่เปลี่ยนภายหลังรอบรายวันมองไม่เห็น — baseline เก็บ
 * (ADR-0002)
 */
export const postMasters: Report = {
  id: PM_ID,
  label: 'Post masters',
  path: 'paymaster/list.aspx',
  allowedControls: PM_ALLOWED,
  dailyOnly: false,
  skipDateCoverageCheck: false,
  // วัดจริง ~55 แถว/เดือน (baseline 1,510 แถวใน 28 เดือน) — ทั้งช่วงตั้งแต่ 2024 ยังไม่ถึง 2000 แต่จะถึงในไม่กี่ปี
  chunk: { kind: 'monthly', reason: '~55 แถว/เดือน — ทั้งช่วงจะเกินเพดาน 2000 ในไม่กี่ปี' },
  hasRowCap: true,
  dateColumn: 'Issue date',
  filterNote: 'กรองด้วยวันที่ออกบัญชี (Issue date) ทุกสถานะ — สถานะ/ยอดจ่ายเปลี่ยนภายหลัง baseline เก็บ (ADR-0002)',
  searchButton: PM_SHOW,
  dateColumns: ['Issue date', 'Items from', 'Items to'],
  boundaryToleranceDays: 0,
  expectedColumns: [
    'Account number', 'Account name', 'Account status', 'Customer', 'Issue date', 'Segment', 'Client type', 'Source',
    'Agent', 'Items from', 'Items to', 'Total including VAT', 'Paid', 'unpaid', 'Create', 'Currency',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    // ดรอปดาวน์ก่อนช่องวันที่ — ถ้าเป็น AutoPostBack การส่งฟอร์มอาจล้างค่าช่องวันที่ที่กรอกไว้ก่อนหน้า
    await setSelect(page, PM_STATE, '--- not specified ---', PM_ALLOWED, PM_ID);
    await setDateRange(page, PM_ISSUED, formatDMY(range.from), formatDMY(range.to), PM_ALLOWED, PM_ID);
    // ช่วงรายการ (Items) ว่างเป็นค่าตั้งต้นอยู่แล้ว — ล้างแบบ explicit กันค่าตั้งต้นเปลี่ยนเงียบ ๆ
    await clearDateRange(page, PM_ITEMS, PM_ALLOWED, PM_ID);
  },
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgData"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};

const PH_ID = 'post-master-history';
/**
 * ช่วงวันที่ของหน้านี้ชื่อ `ctl00$pc$calFrom/calTo` ตรง ๆ — group จึงเป็น `ctl00$pc` (setDateRange ต่อ suffix ให้) ·
 * ในรายการที่อนุญาต ชื่อนี้หมายถึง "คู่ช่องวันที่" เท่านั้น ไม่ใช่ทั้ง panel — ประตูเทียบชื่อแบบตรงตัว
 */
const PH_RANGE = 'ctl00$pc';
const PH_SERVICE = 'ctl00$pc$ddlService';
const PH_FIND = 'ctl00$pc$btnFind';
const PH_ALLOWED = [PH_RANGE, PH_SERVICE, PH_FIND];

/**
 * "Post master - transaction history" — รายการที่ลงบัญชี post master กรองด้วยเวลาที่ลงรายการ (Posted) = อดีตล้วน
 *
 * ค่าตั้งต้นของหน้าคือ 14 วันล่าสุด — ตั้งทับทุกครั้ง · ตัวกรองบริการตั้งเป็น "ไม่ระบุ" แบบ explicit กันค่าตั้งต้นเปลี่ยน
 * · Date from/to (ช่วงพักของการจอง) ว่างในรายการที่ไม่ผูกการจอง · เวลาใน Posted หายใน CSV (เหลือวันที่) — ไฟล์ดิบมีครบ
 */
export const postMasterHistory: Report = {
  id: PH_ID,
  label: 'Post master - transaction history',
  path: 'paymaster/PostingHistory.aspx',
  allowedControls: PH_ALLOWED,
  dailyOnly: false,
  skipDateCoverageCheck: false,
  // วัดจริง 421 แถวใน 90 วัน (~140/เดือน) — ก้อนรายเดือนห่างเพดาน 2000 มาก แต่ทั้งช่วงตั้งแต่ 2024 เกินแน่
  chunk: { kind: 'monthly', reason: '~140 แถว/เดือน — ทั้งช่วงตั้งแต่ 2024 เกินเพดาน 2000' },
  hasRowCap: true,
  dateColumn: 'Posted',
  filterNote: 'กรองด้วยเวลาที่ลงรายการ (Posted)',
  searchButton: PH_FIND,
  dateColumns: ['Posted', 'Date from', 'Date to'],
  boundaryToleranceDays: 0,
  // คอลัมน์ที่ 12 ไม่มีชื่อ และ 'Room typ' สะกดแบบนี้ในไฟล์จริง
  expectedColumns: [
    'Account', 'Subject name', 'Account name', 'Posted', 'Service', 'Revenue centre name', 'Date from', 'Date to',
    'VAT charge', 'Vat', 'Price', '', 'Reservation', 'Room typ', 'Room number', 'Issuer',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await setSelect(page, PH_SERVICE, '--- not specified ---', PH_ALLOWED, PH_ID);
    await setDateRange(page, PH_RANGE, formatDMY(range.from), formatDMY(range.to), PH_ALLOWED, PH_ID);
  },
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgData"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
