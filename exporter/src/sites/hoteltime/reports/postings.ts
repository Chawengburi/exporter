import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setDateRange, setText } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Postings report" (`reports/PostingsReport.aspx`) — ทุกรายการที่ลงบัญชีแขก/บริษัท กรองด้วยเวลาที่ทำรายการ (Operation time)
 * = อดีตล้วน · ticket 13 ของ exporter-daily-expansion-and-data-store · recon อ่านอย่างเดียว 2026-10-07 อยู่ใน `recon/NOTES.md`
 *
 * 🔴 ช่วงเวลาของหน้านี้เป็น **[From 00:00, To 00:00)** — ค่าตั้งต้นคือวันนี้ 00:00 ถึงพรุ่งนี้ 00:00 · ขอวันที่ a–b ต้องกรอก
 * To = b + 1 วัน ไม่งั้นวันสุดท้ายหายทั้งวันเงียบ ๆ · ช่องชั่วโมง/นาทีตั้งเป็น 00 ทุกครั้งกันค่าตั้งต้นเปลี่ยน
 * · ช่วงวันที่ของรายการ (Item from/to) ล้างทิ้ง (ว่างเป็นค่าตั้งต้นอยู่แล้ว)
 */
const REPORT_ID = 'postings';
const RANGE = 'ctl00$pc'; // ช่องชื่อ ctl00$pc$calFrom/calTo ตรง ๆ — setDateRange ต่อ suffix ให้
const TIMES = ['ctl00$pc$calFrom_tbHour', 'ctl00$pc$calFrom_tbMin', 'ctl00$pc$calTo_tbHour', 'ctl00$pc$calTo_tbMin'];
const ITEMS_FROM = 'ctl00$pc$calItemFrom';
const ITEMS_TO = 'ctl00$pc$calItemTo';
const SHOW = 'ctl00$pc$btnShow';
const ALLOWED_CONTROLS = [RANGE, ...TIMES, ITEMS_FROM, ITEMS_TO, SHOW];

const DAY_MS = 86_400_000;

export const postings: Report = {
  id: REPORT_ID,
  label: 'Postings report',
  path: 'reports/PostingsReport.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: false,
  family: 'per-day',
  skipDateCoverageCheck: false,
  // วัดจริง 2026-10-07: export ไม่ถูกตัดที่ 2000 (ส.ค. 2026 ได้ 3,730 แถวในไฟล์เดียว) จึงไม่ต้องก้อนเล็กกว่ารายเดือนแบบที่ ticket
  // คาดไว้ · ยังเปิดชั้นตรวจเพดานไว้ เดือนที่ได้ 2000 พอดีแค่ถูกผ่าครึ่งดึงซ้ำหนึ่งรอบ ไม่เสียหาย
  chunk: { kind: 'monthly', reason: 'สูงสุดที่เจอ 3,730 แถว/เดือน และ export ไม่ถูกตัดที่ 2000 — รายเดือนพอ' },
  hasRowCap: true,
  dateColumn: 'Operation time',
  filterNote: 'กรองด้วยเวลาที่ทำรายการ (Operation time) — หน้าเว็บใช้ช่วง [From 00:00, To+1 00:00)',
  searchButton: SHOW,
  // Item/Reservation from/to เป็น "DD/MM" ไม่มีปี (เจอตอนรันจริง 2026-10-07) — แปลงไม่ได้ เก็บข้อความเดิม
  boundaryToleranceDays: 0,
  expectedColumns: [
    'Account', 'Account owner', 'Room number', 'Item name', 'Item from', 'Item to', 'Reservation from',
    'Reservation to', 'Price', 'Currency', 'Operation', 'Note', 'Operation time', 'User',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    const toExclusive = new Date(range.to.getTime() + DAY_MS);
    await setDateRange(page, RANGE, formatDMY(range.from), formatDMY(toExclusive), ALLOWED_CONTROLS, REPORT_ID);
    for (const t of TIMES) await setText(page, t, '00', ALLOWED_CONTROLS, REPORT_ID);
    await setText(page, ITEMS_FROM, '', ALLOWED_CONTROLS, REPORT_ID);
    await setText(page, ITEMS_TO, '', ALLOWED_CONTROLS, REPORT_ID);
  },
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgData"]');
    return rows !== null && rows > 1;
  },
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
