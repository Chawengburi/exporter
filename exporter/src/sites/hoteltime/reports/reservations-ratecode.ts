import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setDateRange } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * "Reservation search by RateCode" — รายการจองพร้อมข้อมูลราคา/RateCode
 *
 * สำรวจ 2026-09-08 · รายละเอียดใน recon/NOTES.md
 */

/**
 * ช่วงที่กว้างจนไม่กรองอะไรเลย ใช้กับช่อง `Period:` ที่เป็นฟิลด์บังคับ
 *
 * 🔴 ห้ามล้างช่อง Period ทิ้ง — หน้าจะ re-render พร้อมป้าย `* mandatory item`
 * แล้ว Search ไม่ทำงาน แต่ลิงก์ export ยังอยู่ตรงนั้น (มันอยู่ในเมนู "Other operations"
 * ไม่ได้โผล่ตามผลลัพธ์) การกด export ตอนนั้นจะได้ไฟล์ที่ไม่ตรงกับที่สั่ง
 */
const WIDE_PERIOD_FROM = '01/01/2020';
const WIDE_PERIOD_TO = '31/12/2030';

const REPORT_ID = 'reservations-ratecode';

/** ทุก control ที่ใบนี้แตะจริงใน applyFilters — ดู core/gate.ts */
const ALLOWED_CONTROLS = ['ctl00$pc$cal', 'ctl00$pc$calCreated', 'ctl00$pc$btnShow'];

export const reservationsRateCode: Report = {
  id: REPORT_ID,
  label: 'Reservation search by RateCode',
  path: 'reports/ResListRateCode.aspx',
  allowedControls: ALLOWED_CONTROLS,

  chunk: {
    kind: 'whole',
    reason:
      'ใบนี้ไม่มีเพดาน 2000 — ทดสอบ created ทั้งปี 2025 ได้ 4,644 แถวครบ ' +
      'จึงยิงทั้งช่วงทีเดียวได้ ไม่ต้องซอย',
  },
  hasRowCap: false,
  dailyOnly: false,
  family: 'per-day',
  skipDateCoverageCheck: false,

  /** 🔴 คอลัมน์นี้เก็บวันที่เป็น Excel serial (45658 = 2025-01-01) ไม่ใช่ข้อความ */
  dateColumn: 'Created',
  searchButton: 'ctl00$pc$btnShow',
  boundaryToleranceDays: 0,

  expectedColumns: [
    'Reservation number', 'Room type', 'Room', 'Reservation owner:',
    'Agent', 'Client type', 'Segment', 'Reservation source',
    'RateCode', 'Arrival', 'Departure', 'Created',
    'State', 'Persons', 'Nights', 'ARR *2)',
    'Total for accommodation', 'Total inc. VAT *1)', 'Unpaid *1)', 'Currency',
  ],

  async applyFilters(page: Page, range: DateRange): Promise<void> {
    // ตั้งกว้างแทนการล้าง เพราะเป็นฟิลด์บังคับ — ดูหมายเหตุที่ WIDE_PERIOD_* ด้านบน
    await setDateRange(
      page,
      'ctl00$pc$cal',
      WIDE_PERIOD_FROM,
      WIDE_PERIOD_TO,
      ALLOWED_CONTROLS,
      REPORT_ID,
    );
    await setDateRange(
      page,
      'ctl00$pc$calCreated',
      formatDMY(range.from),
      formatDMY(range.to),
      ALLOWED_CONTROLS,
      REPORT_ID,
    );
  },

  async hasResults(page: Page): Promise<boolean> {
    // วัดแล้ว: ผลว่าง → ไม่มีตาราง #pc_dtgData บนหน้าเลย · ผลมีข้อมูล → มีพร้อมแถว
    const rows = await gridRowCount(page, '#pc_dtgData');
    return rows !== null && rows > 1;
  },

  async expectedRowCount(_page: Page): Promise<number | null> {
    // ใบนี้มีแถว `Total` แต่ค่าว่างเปล่า — ไม่มีตัวเลขให้เทียบ อย่าเดา
    return null;
  },
};
