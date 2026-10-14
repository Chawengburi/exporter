import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setDateRange } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Reservations by arrival period" — รายการจองที่มีวันเข้าพักอยู่ในช่วงที่ระบุ
 *
 * ต่างจาก arrivals.ts/departures.ts/in-house-guests.ts/housekeeping.ts ตรงที่หน้านี้มี
 * date-control เป็น**ช่วงจริง** (`dtrTerm$calFrom`/`dtrTerm$calTo`) ไม่ใช่วันเดียว — recon
 * 2026-09-22 พบว่าตรงกับ pattern `group$calFrom`/`group$calTo` ที่ `setDateRange()` มีอยู่แล้ว
 * พอดี ไม่ต้องเขียน helper ใหม่ จึงเป็น `dailyOnly: false` แบบเดียวกับ 3 รายงานเดิม (ไม่ใช่
 * ADR-0003) — ดู `.scratch/pms-export-new-report-pilot/issues/04-reservations-by-arrival-period-report.md`
 *
 * 🔴 ข้อควรระวังที่ไม่เหมือนรายงานอื่น: **คอลัมน์ที่กรอง (Arrival) แก้ไขได้ในอนาคต** — ต่างจาก
 * created date หรือ Cancelled date ที่เป็นอดีตล้วนแก้ไม่ได้ (ADR-0002) แขกสามารถเลื่อนวันเข้าพัก
 * ก่อนวันจริงได้ ดังนั้นไฟล์ของวันนี้ที่บอกว่า "จองนี้มาถึง 5 ต.ค." อาจไม่จริงแล้วถ้าดึงซ้ำวันหลัง
 * เพราะแขกเลื่อนวันไปแล้ว — ความเสี่ยงเรื่องแก้ย้อนหลังจึงหนักกว่ากรณีปกติที่ ADR-0002 คุยไว้
 * (นั่นคุยเรื่อง "มองไม่เห็นการแก้" แต่นี่คือ "ตัวกรองเองเปลี่ยนได้") — เป็นข้อจำกัดที่ยอมรับได้
 * ตามหลักการเดิมของ ADR-0002 (exporter ไม่ถือความเป็นเจ้าของ row identity/history) แต่ควรรู้ไว้
 */
const REPORT_ID = 'arrival-period';

/** ทุก control ที่ใบนี้แตะจริงใน applyFilters — ดู core/gate.ts */
const ALLOWED_CONTROLS = ['ctl00$pc$dtrTerm', 'ctl00$pc$btnFind'];

export const arrivalPeriod: Report = {
  id: REPORT_ID,
  label: 'Reservations by arrival period',
  path: 'reports/GuestArrivalsTerm.aspx',
  allowedControls: ALLOWED_CONTROLS,
  dailyOnly: false,
  family: 'per-day',
  skipDateCoverageCheck: false,

  chunk: {
    kind: 'monthly',
    reason:
      'วัดจริง 2026-09-22: 1 เดือน (22/09–22/10) ได้ 54 แถว — ยังไม่เคยลองเต็มปีเพื่อพิสูจน์ว่า ' +
      'ไม่ชนเพดาน 2000 จึงเลือกซอยรายเดือนแบบเดียวกับ reservations-search ไว้ก่อน (ปลอดภัยกว่า ' +
      'ไม่ใช่ตัวเลขที่วัดจนมั่นใจว่าไม่จำเป็น)',
  },
  hasRowCap: true,

  dateColumn: 'Arrival',
  searchButton: 'ctl00$pc$btnFind',
  boundaryToleranceDays: 0,

  // จากไฟล์ .xlsx ที่ดาวน์โหลดจริง 2026-09-22 — คอลัมน์ที่ 5 ไม่มีชื่อในไฟล์จริง (icon column)
  expectedColumns: [
    'Reservation no.', 'Room', 'Room type', 'Assigned type', '', 'Name', 'Arrival', 'Departure',
    'Reservation owner', 'Loyalty', 'Room note', 'Reservation note', 'Agent',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    // default ของหน้านี้คือ "วันนี้ → พรุ่งนี้" ไม่ใช่ช่วงกว้างเป็นปีแบบ reservations-search
    // แต่ยังตั้งค่าทับแบบ explicit เสมอ ไม่พึ่ง default เพื่อกันกรณี default เปลี่ยนแบบเงียบ ๆ
    await setDateRange(
      page,
      'ctl00$pc$dtrTerm',
      formatDMY(range.from),
      formatDMY(range.to),
      ALLOWED_CONTROLS,
      REPORT_ID,
    );
  },

  /** ไม่มีแถวสรุปที่เชื่อถือได้ (วัดแล้ว 2026-09-22) — ใช้ตารางผลลัพธ์แทน (หายไปทั้งตารางเมื่อว่าง) */
  async hasResults(page: Page): Promise<boolean> {
    const rows = await gridRowCount(page, '[id*="dtgItems"]');
    return rows !== null && rows > 1;
  },

  async expectedRowCount(): Promise<number | null> {
    return null;
  },
};
