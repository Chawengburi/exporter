import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setSingleDate } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Arrivals" — รายการผู้เข้าพักที่มีวันเข้าพักตรงกับวันที่ระบุ
 *
 * dailyOnly (ADR-0003): กรองด้วย `calDate` วันเดียว ไม่ใช่ created-date range แบบรายงานอื่น
 * — recon 2026-09-22, รายละเอียดใน `.scratch/pms-export-new-report-pilot/issues/01-arrivals-report.md`
 */
const REPORT_ID = 'arrivals';

/** ทุก control ที่ใบนี้แตะจริงใน applyFilters — ดู core/gate.ts */
const ALLOWED_CONTROLS = ['ctl00$pc$calDate', 'ctl00$pc$btnFind'];

export const arrivals: Report = {
  id: REPORT_ID,
  label: 'Arrivals',
  path: 'reports/RoomArrivals.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: true,
  family: 'picture',
  period: 'none',
  skipDateCoverageCheck: false,

  chunk: {
    kind: 'whole',
    reason: 'dailyOnly — ช่วงเป็นวันเดียวเสมอ (ตัววางแผนของรอบรายวันส่งมาวันเดียว) ไม่มีอะไรให้แบ่งก้อน',
  },
  // 🔴 ยังไม่วัดวันที่ยุ่งที่สุด (วันนี้ที่ recon มีแค่ 3 แถว) — ตั้ง false เพราะ query
  // ได้ทีละวันอยู่แล้ว ไม่ใช่เพราะพิสูจน์แล้วว่าไม่มีทางชน 2000 แถวในวันเดียว
  hasRowCap: false,

  dateColumn: 'Arrival',
  searchButton: 'ctl00$pc$btnFind',
  boundaryToleranceDays: 0,

  // จากไฟล์ .xlsx ที่ดาวน์โหลดจริง 2026-09-22 (ไม่ใช่จากโครง HTML ของหน้าเว็บ)
  expectedColumns: [
    'Reservation no.', 'Group name', 'Room', 'Guest', 'Loyalty', 'Stays',
    'Last stay date', 'Room type', 'Assigned type', 'Arrival', 'ETA', 'Departure',
    'Number of guests', 'Age groups', 'Reservation owner', 'Stay', 'Reservation note',
    'Room note', 'Note for housekeeping', 'External Note', 'Promo code', 'Payment type',
    'Room / night', 'Due balance', 'Execute', 'Client type', 'Room requests',
    'Reservation request', 'Operation flags - reservation', 'Operation flags - room',
    'Source', 'Meal plan', 'On-line check-in', 'Arrival flight details:', 'Agent',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    // dailyOnly เสมอ: range.from === range.to === วันนี้ · ตั้งค่าใหม่ทับ default ที่มีอยู่แล้ว
    // (calDate default = วันนี้พอดี) แบบ explicit แทนที่จะพึ่ง default เฉย ๆ — กันกรณี default
    // เปลี่ยนไปในอนาคตแบบเงียบ ๆ · ไม่มีช่วง ETA ให้ล้าง เพราะ default เป็นค่าว่างอยู่แล้ว
    // (= ไม่กรองเวลา = ได้ทั้งวัน) ไม่ต้องแตะ
    await setSingleDate(page, 'ctl00$pc$calDate', formatDMY(range.from), ALLOWED_CONTROLS, REPORT_ID);
  },

  /**
   * ไม่มีแถวสรุปที่เชื่อถือได้ (`readTotals()` ว่างเปล่า วัดแล้ว 2026-09-22) — ใช้ตาราง
   * ผลลัพธ์เองแทน: ไม่เจอตาราง (`null`) = ไม่มีผลลัพธ์เลย ตรงกับที่ recon เจอ (วันที่ไม่มี
   * arrival ตารางหายไปทั้งตาราง ไม่ใช่ตารางว่าง)
   */
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgItems"]');
    return rows !== null && rows > 1; // แถวแรกคือ header
  },

  /** ไม่มีแถวสรุปให้เชื่อ — อย่าเดา ให้ verify เทียบแค่ช่วงวันที่ในไฟล์แทน */
  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
