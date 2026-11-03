import type { Page } from 'playwright';
import type { DateRange } from '../../../core/order.ts';
import { gridRowCount, setText } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * บัญชีที่ยังเปิดอยู่ (`AccountList.aspx?type=opened`) — ticket 02 ของ `.scratch/exporter-hoteltime-gold-feed/` · ต้นแบบ selector:
 * `hoteltime-schema/recon/live-export-vat-accounts-open.mjs`
 *
 * 🔴 รายการสถานะ ณ ตอนดึง ไม่ใช่ ledger — บัญชีที่ปิดแล้วหายจากรายการ จึงเป็น **รายงาน snapshot** ที่ย้อนดึงไม่ได้ และ snapshot
 * ของวันที่พลาดเอาคืนไม่ได้ (Gold เก็บลิงก์บัญชี→การจองได้ก็ต่อเมื่อเคยเห็นคู่นั้นใน snapshot) · ทุกครั้งที่ดึงเป็นฉบับใหม่
 * ไม่เขียนทับ (ADR-0005, ADR-0008) · ต้องล้างตัวกรอง "Departure to" ไม่งั้นได้เฉพาะบัญชีที่ออกก่อนวันที่ค่าตั้งต้น
 * · หัวตารางมี `Open balance` ซ้ำสองคอลัมน์ (ไฟล์จริง) — ด่านตรวจหัวตารางเทียบตามตำแหน่ง
 */
const REPORT_ID = 'accounts-open';
const DEPARTURE_TO = 'ctl00$pc$drTo$calTo';
const OPENED_BUTTON = 'ctl00$pc$btnOpened';
const ALLOWED_CONTROLS = [DEPARTURE_TO, OPENED_BUTTON];

export const accountsOpen: Report = {
  id: REPORT_ID,
  label: 'Accounts — open',
  path: 'AccountList.aspx?type=opened',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: true,
  family: 'picture',
  period: 'none',
  // ไม่มีช่วงวันที่ให้เทียบกับวันที่ดึง (ล้างตัวกรองแล้วได้ทุกบัญชีที่เปิดอยู่)
  skipDateCoverageCheck: true,
  chunk: { kind: 'whole', reason: 'snapshot ของวันที่ดึง ไม่มีอะไรให้แบ่งก้อน (62 บัญชี ณ 2026-11-04)' },
  // ถ้าวันหนึ่งเปิดค้างถึง 2000 บัญชี ชั้นตรวจจะล้มดัง ๆ ซึ่งดีกว่าได้รายการขาดเงียบ ๆ
  hasRowCap: true,
  dateColumn: 'Opened from',
  exportLink: 'pc_btnExportXLS_Open',
  filterNote: 'บัญชีที่ยังเปิดอยู่ทั้งหมด ณ วันที่ดึง (ล้างตัวกรอง Departure to) — บัญชีที่ปิดแล้วหายจากรายการ',
  searchButton: OPENED_BUTTON,
  boundaryToleranceDays: 0,
  expectedColumns: [
    'Account number', 'Reservation no.', 'Group', 'Room', 'Opened from', 'Departure to', 'Customer', 'Account type',
    'Currency', 'Account total', 'Future revenue', 'Open balance', 'Deposits', 'Closed', 'Audited revenue', 'Open balance',
  ],

  async applyFilters(page: Page, _range: DateRange): Promise<void> {
    await setText(page, DEPARTURE_TO, '', ALLOWED_CONTROLS, REPORT_ID); // ล้างช่อง = ไม่จำกัดวันออก
  },
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id$="dtgOpened"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
