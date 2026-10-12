import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setSingleDate } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Housekeeping report" — สถานะห้องพักทั้งหมด ณ วันที่ระบุ (สะอาด/สกปรก/มีแขกพัก ฯลฯ)
 *
 * dailyOnly (ADR-0003) + skipDateCoverageCheck — ต่างจาก in-house-guests.ts ตรงที่**ไม่มีคอลัมน์
 * วันที่ไหนมีค่าครบทุกแถวเลยด้วยซ้ำ** (ห้องว่างไม่มีแขก ช่อง Arrival/Departure จึงว่างเปล่า
 * ไม่ใช่แค่ "ไม่ตรงช่วง") — เป็น snapshot ของ**ทุกห้อง**ในโรงแรม (120 ห้องวัดจริง) ไม่ใช่รายชื่อ
 * ที่ผูกกับวันที่แบบ arrivals/departures/in-house-guests เลย
 * ดู `.scratch/pms-export-new-report-pilot/issues/03-in-house-guests-report.md` (ปัญหาเดียวกัน
 * ขยายผลมาถึงใบนี้)
 */
const REPORT_ID = 'housekeeping';

const ALLOWED_CONTROLS = ['ctl00$pc$calDate', 'ctl00$pc$btnFind'];

export const housekeeping: Report = {
  id: REPORT_ID,
  label: 'Housekeeping report',
  path: 'reports/RoomStates.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: true,
  skipDateCoverageCheck: true,

  chunk: {
    kind: 'whole',
    reason: 'dailyOnly — ช่วงเป็นวันเดียวเสมอ ไม่มีอะไรให้แบ่งก้อน',
  },
  // วัดจริง 2026-09-22: 120 ห้องพอดี (จำนวนห้องทั้งหมดของโรงแรม) — คงที่ตามจำนวนห้อง
  // ไม่ใช่ตามธุรกรรม จึงไม่มีทางชนเพดาน 2000 เว้นแต่โรงแรมขยายห้องมหาศาล
  hasRowCap: false,

  // ใช้แค่จัดกลุ่มไฟล์ CSV รายปี (writeYearlyCsv กิ่ง dailyOnly ใช้ปีของวันที่ query ตรง ๆ
  // ไม่แตะคอลัมน์นี้เลยด้วยซ้ำ) — ใส่ 'Arrival' ไว้ให้ type ผ่านเฉย ๆ ไม่มีความหมายอื่น
  dateColumn: 'Arrival',
  searchButton: 'ctl00$pc$btnFind',
  dateColumns: ['Arrival', 'Departure'],
  boundaryToleranceDays: 0,

  // จากไฟล์ .xlsx ที่ดาวน์โหลดจริง 2026-09-22 — คอลัมน์ 'Departure' ซ้ำ 2 ครั้ง (ตำแหน่ง 8 และ
  // 13) และคอลัมน์สุดท้ายไม่มีชื่อ เป็นแบบนี้ในไฟล์จริง ไม่ใช่พิมพ์ผิด
  expectedColumns: [
    'Room', 'Room type', 'Capacity', 'Room group', 'Room status', 'Days from inspection',
    'Arrival', 'Departure', 'Number of guests', 'Age groups', 'Bed linen', 'Extra beds',
    'Departure', 'DayUse', 'Arriving', 'Night/Stay', 'Guests', 'Nationality', 'Notes',
    'Execute', 'Res count', '',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    await setSingleDate(page, 'ctl00$pc$calDate', formatDMY(range.from), ALLOWED_CONTROLS, REPORT_ID);
  },

  /** grid id ต่างจากทั้ง arrivals/departures (`dtgItems`) และ in-house-guests (`dtgGuests`) */
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgRooms"]');
    return rows !== null && rows > 1;
  },

  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
