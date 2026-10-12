import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setSingleDate } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "In-house guests" — รายชื่อผู้เข้าพักที่ยังอยู่ในโรงแรม ณ วันที่ระบุ
 *
 * dailyOnly (ADR-0003) เหมือน arrivals.ts/departures.ts แต่มี**ปัญหาคนละชั้น**: ไม่มีคอลัมน์ไหน
 * ในผลลัพธ์ที่เท่ากับวันที่ถูกกรองเสมอ (Arrival/Departure ของแต่ละแถวเป็นวันอื่นได้ทั้งคู่ เพราะ
 * แขกอาจเข้าพักมาแล้วหลายวันและจะออกอีกหลายวันข้างหน้า) — เดิมใช้ `skipDateCoverageCheck: true` (ดู
 * `.scratch/pms-export-new-report-pilot/issues/03-in-house-guests-report.md`) · ตั้งแต่ 2026-10-07 ใช้ด่าน "คร่อมช่วง"
 * (`overlapColumns`: Arrival ≤ วันนั้น ≤ Departure) ซึ่งจับ "filter ไม่ทำงาน" ได้โดยไม่ต้องเดาค่าเผื่อขอบ
 */
const REPORT_ID = 'in-house-guests';

const ALLOWED_CONTROLS = ['ctl00$pc$calDate', 'ctl00$pc$btnFind'];

export const inHouseGuests: Report = {
  id: REPORT_ID,
  label: 'In-house guests',
  path: 'reports/RoomGuests.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: true,
  skipDateCoverageCheck: false,
  overlapColumns: { from: 'Arrival', to: 'Departure' },

  chunk: {
    kind: 'whole',
    reason: 'dailyOnly — ช่วงเป็นวันเดียวเสมอ ไม่มีอะไรให้แบ่งก้อน',
  },
  hasRowCap: false,

  // ไม่ถูกใช้ — ด่านวันที่ใช้ overlapColumns แทน (ดูคอมเมนต์บนสุดของไฟล์) ใส่ไว้ให้ type ผ่าน
  dateColumn: 'Arrival',
  searchButton: 'ctl00$pc$btnFind',
  dateColumns: ['Arrival', 'Departure'],
  boundaryToleranceDays: 0,

  // จากไฟล์ .xlsx ที่ดาวน์โหลดจริง 2026-09-22 — คอลัมน์ที่ 4 และ 10 ไม่มีชื่อในไฟล์จริง
  // (icon column) เก็บไว้เป็น '' ตามที่ downloadExport ให้มาจริง ไม่ใช่เดา
  expectedColumns: [
    'Reservation number', 'Group name', 'Room', '', 'Assigned type', 'Arrival', 'Departure',
    'Stay', 'Number of guests', '', 'Agent', 'Client type', 'Price / night', '', 'Age group',
    'Guest category', 'Notes', 'Reservation request',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await setSingleDate(page, 'ctl00$pc$calDate', formatDMY(range.from), ALLOWED_CONTROLS, REPORT_ID);
  },

  /** grid id ต่างจาก arrivals.ts/departures.ts — เป็น `dtgGuests` ไม่ใช่ `dtgItems` */
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgGuests"]');
    return rows !== null && rows > 1;
  },

  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
