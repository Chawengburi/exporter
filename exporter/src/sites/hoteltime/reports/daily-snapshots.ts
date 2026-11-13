import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setSingleDate } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * หน้า snapshot ของวันนั้น 6 หน้าจากการตรวจเบื้องต้น (`recon/PROBE.md`, ticket 20 ของ exporter-daily-expansion-and-data-store)
 *
 * ทุกหน้าโครงเดียวกันกับ arrivals/housekeeping (recon เชิงลึกด้วยสคริปต์อ่านอย่างเดียว 2026-10-07): ช่องวันเดียว
 * `ctl00$pc$calDate` (ค่าตั้งต้น = วันนี้) + ปุ่ม `ctl00$pc$btnFind` + ตารางผล `dtgItems` (ยกเว้น Housekeeping all-in-one
 * ที่เป็น `dgvResult`) · dailyOnly (ADR-0003) — ดึงได้แค่วันนี้ ไม่มี back-fill/baseline
 *
 * เขียนเป็นตัวสร้างร่วมแทนหกไฟล์ที่เหมือนกันเกือบทุกบรรทัด — ที่ต่างกันจริงมีแค่ path, ตาราง, หัวตาราง และว่าตรวจ
 * คอลัมน์วันที่ได้ไหม
 */

const DATE = 'ctl00$pc$calDate';
const FIND = 'ctl00$pc$btnFind';
const ALLOWED_CONTROLS = [DATE, FIND];

type SnapshotSpec = {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly grid: string;
  readonly expectedColumns: readonly string[];
  /**
   * คอลัมน์ที่ทุกแถวต้องเท่ากับวันที่เลือก (ด่านจับ "filter ไม่ทำงาน") · null = ไม่มีคอลัมน์แบบนั้น → ข้ามด่านนั้นแบบ
   * เดียวกับ housekeeping — เขียนเหตุผลไว้เป็นคอมเมนต์ที่รายงานใบนั้นเสมอ
   */
  readonly coverageColumn: string | null;
  /** แถวคือช่วงที่คร่อมวันที่เลือก (เช่น ช่วงปิดห้อง) — ตรวจว่าทุกแถวแตะวันนั้นแทน (`Report.overlapColumns`) */
  readonly overlap?: { readonly from: string; readonly to: string };
  /** จำนวนแถวเพิ่มตามธุรกรรม (อาจชนเพดาน 2000) หรือคงที่ตามจำนวนห้อง */
  readonly hasRowCap: boolean;
};

function dailySnapshot(spec: SnapshotSpec): Report {
  return {
    id: spec.id,
    label: spec.label,
    path: spec.path,
    allowedControls: ALLOWED_CONTROLS,
    dailyOnly: true,
    family: 'picture',
    period: 'none',
    skipDateCoverageCheck: spec.coverageColumn === null && spec.overlap === undefined,
    ...(spec.overlap ? { overlapColumns: spec.overlap } : {}),
    chunk: { kind: 'whole', reason: 'dailyOnly — ช่วงเป็นวันเดียวเสมอ ไม่มีอะไรให้แบ่งก้อน' },
    hasRowCap: spec.hasRowCap,
    // รายงาน dailyOnly ที่ข้ามด่านวันที่ไม่ใช้คอลัมน์นี้เลย (ดู _types.ts) — ใส่คอลัมน์แรกที่มีจริงให้ type ผ่าน
    dateColumn: spec.coverageColumn ?? spec.expectedColumns[0]!,
    searchButton: FIND,
    boundaryToleranceDays: 0,
    expectedColumns: spec.expectedColumns,

    async applyFilters(page: Page, range: DateRange): Promise<void> {
      // ตั้งทับค่าตั้งต้น (= วันนี้) แบบ explicit — กันกรณีค่าตั้งต้นของหน้าเปลี่ยนไปเงียบ ๆ
      await setSingleDate(page, DATE, formatDMY(range.from), ALLOWED_CONTROLS, spec.id);
    },
    async hasResults(page: Page): Promise<boolean> {
      const rows = await gridRowCount(page, `[id*="${spec.grid}"]`);
      return rows !== null && rows > 1; // แถวแรกคือ header
    },
    async expectedRowCount(): Promise<number | null> {
      return null;
    },
  };
}

// หัวตารางทั้งหมดจากไฟล์ .xlsx ที่ดาวน์โหลดจริงตอนตรวจเบื้องต้น 2026-10-07 (ไม่ใช่จากโครง HTML)

export const reservationsByArrivalDate = dailySnapshot({
  id: 'reservations-by-arrival-date',
  label: 'Reservations by arrival date',
  path: 'reports/GuestArrivals.aspx',
  grid: 'dtgItems',
  coverageColumn: 'Arrival',
  // 🔴 ยังไม่วัดวันที่ยุ่งที่สุด (วันที่ตรวจมี 12 แถว) — ตั้ง false เพราะ query ได้ทีละวัน ไม่ใช่เพราะพิสูจน์แล้วว่าไม่มีทาง
  // ชน 2000 แถวในวันเดียว (เหตุผลเดียวกับ arrivals.ts)
  hasRowCap: false,
  expectedColumns: [
    'Reservation no.', 'Room', 'Room type', 'Assigned type', 'Name', 'Stays', 'Last stay date', 'ETA', 'Arrival',
    'Departure', 'Reservation owner', 'Category', 'Profile note', 'Client type', 'Room requests', 'Reservation request',
    'Operation flags - reservation', 'Operation flags - room', 'Room note', 'Reservation note', 'External Note',
    'Promo code', 'On-line check-in', 'Agent',
  ],
});

export const housekeepingBasic = dailySnapshot({
  id: 'housekeeping-basic',
  label: 'Housekeeping - basic report',
  path: 'reports/RoomStatesSimple.aspx',
  grid: 'dtgItems',
  // snapshot ของทุกห้อง (121 แถว) — ห้องว่างไม่มีแขก ช่อง Arrival/Departure จึงว่าง ไม่มีคอลัมน์ไหนเท่ากับวันที่เลือก
  coverageColumn: null,
  hasRowCap: false,
  expectedColumns: [
    'Room', 'Room type', 'Room status', 'Bed linen', 'Apply', 'Arrival', 'Departure', 'ETA', 'ETD',
    'Number of guests', 'Age groups', 'Guests', 'Notes',
  ],
});

export const housekeepingAllInOne = dailySnapshot({
  id: 'housekeeping-all-in-one',
  label: 'Housekeeping all-in-one',
  path: 'reports/RoomStatesHSK.aspx',
  grid: 'dgvResult',
  // snapshot ของทุกห้อง — Date from/to คือช่วงพักของแขก ไม่ใช่วันที่เลือก
  coverageColumn: null,
  hasRowCap: false,
  expectedColumns: [
    'Room no.', 'Room type', 'Operational room group', 'Room status', 'Linen', 'Linen change', 'Operation',
    'Date from', 'Date to', 'ETA', 'ETD', 'Inventory', 'Room requests', 'Pax', 'Age groups', 'Birthday', 'Guest',
    'Note for housekeeping',
  ],
});

export const roomsStatusOverview = dailySnapshot({
  id: 'rooms-status-overview',
  label: 'Rooms status overview',
  path: 'reports/RoomUsage.aspx',
  grid: 'dtgItems',
  // snapshot ของทุกห้อง (130 แถว) — ห้องว่างไม่มีการจอง ช่องวันที่จึงว่าง
  coverageColumn: null,
  hasRowCap: false,
  // คอลัมน์ที่ 3 ไม่มีชื่อในไฟล์จริง ไม่ใช่พิมพ์ตก
  expectedColumns: [
    'Reservation number', 'Room', '', 'Room type', 'Arrival', 'Departure', 'Number of guests', 'Stay', 'Notes',
    'Guest', 'Payment type',
  ],
});

export const roomsOutOfOrder = dailySnapshot({
  id: 'rooms-ooo',
  label: 'Rooms - OOO overview',
  path: 'reports/RoomOOO.aspx',
  grid: 'dtgItems',
  // ช่วงปิดห้อง (From/To) ที่คร่อมวันที่เลือก — From มักอยู่ก่อนวันที่เลือก จึงใช้ด่าน "คร่อมช่วง" (From ≤ วันนั้น ≤ To)
  coverageColumn: null,
  overlap: { from: 'From', to: 'To' },
  hasRowCap: false,
  expectedColumns: ['From', 'To', 'Closure type', 'Notes', 'Room', 'Room type'],
});

export const roomsAvailable = dailySnapshot({
  id: 'rooms-available',
  label: 'Rooms available',
  path: 'reports/RoomEmpty.aspx',
  grid: 'dtgItems',
  // รายชื่อห้องว่าง ณ วันที่เลือก — ไม่มีคอลัมน์วันที่เลย
  coverageColumn: null,
  hasRowCap: false,
  expectedColumns: ['Room', 'Room type', 'Room group', 'Room status', 'Room note', 'Room features'],
});
