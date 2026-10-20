import type { Page } from 'playwright';
import { formatDMY, lastDayOfMonth, utcDate, type DateRange } from '../../../core/order.ts';
import { gridRowCount, setSelect, setSingleDate } from '../webforms.ts';
import type { ReportPeriod } from '../../../core/run-planner.ts';
import type { Report } from './_types.ts';

/**
 * หน้าสถิติ 7 หน้าจากการตรวจเบื้องต้น (`recon/PROBE.md`, ticket 21 ของ exporter-daily-expansion-and-data-store)
 *
 * เก็บเป็น snapshot ของวันที่ดึงทุกวัน (เจ้าของระบบยืนยัน 2026-10-07) — ตัวเลขสถิติ/พยากรณ์เปลี่ยนทุกวันตามการจอง ไฟล์ของแต่ละวัน
 * จึงคือ "สถิติตามที่ระบบเห็น ณ วันนั้น" · dailyOnly (ADR-0003) — ดึงได้แค่วันนี้
 *
 * 🔴 ค่าตั้งต้นของหน้าเหล่านี้ไม่สม่ำเสมอ (recon อ่านอย่างเดียว 2026-10-07: term/CombinedForecast ตั้งไว้ที่**เดือนหน้า**,
 * segment = ทั้งปีนี้, roomtype = ย้อน 12 เดือนถึงวันนี้) จึงตั้งช่วงเองทุกครั้งตามความหมายเดียวกับค่าตั้งต้น
 * แทนการพึ่งค่าที่หน้าเว็บกรอกให้ — ค่าตั้งต้นเปลี่ยนเงียบ ๆ แล้วไฟล์จะหน้าตาปกติแต่คนละช่วง
 *
 * ทุกใบข้ามด่าน "ทุกแถวเท่ากับวันที่เลือก" — เป็นตัวเลขรวม ไม่มีคอลัมน์วันที่แบบนั้น (คอลัมน์ Date ของหน้า day เป็น
 * "01. 10." ไม่มีปี จึงไม่ประกาศเป็นคอลัมน์วันที่ให้แปลง) · ไม่มีทางชนเพดาน 2000 (สูงสุดราว 140 แถว)
 */

type StatsSpec = {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly searchButton: string;
  /** control ที่ applyFilters แตะ (ไม่รวมปุ่มค้นหา) — ประตูอ่านอย่างเดียว core/gate.ts */
  readonly controls: readonly string[];
  /** ตารางผลบนหน้า · null = หน้าไม่แสดงตาราง (roomtype — ดูได้จากไฟล์ export เท่านั้น) */
  readonly grid: string | null;
  readonly expectedColumns: readonly string[];
  readonly trailingColumns?: 'data-driven';
  /** ช่วงข้อมูลของ snapshot นี้ตามวันที่ดึง — ใช้ตั้งตัวกรองและตั้งชื่อไฟล์ (`Report.dataWindow`, ticket 26) */
  readonly window: (day: Date) => DateRange;
  /** งวดของ snapshot ปิดงวด (ใบ 05) — snapshot ของงวดที่จบแล้วทั้งงวดถ่ายวันแรกของงวดถัดไป · snapshot ที่มองไปข้างหน้า/ช่วงเลื่อนไม่มีงวด */
  readonly period: ReportPeriod;
  readonly applyFilters: (page: Page, window: DateRange, allowed: readonly string[], id: string) => Promise<void>;
};

function statsReport(spec: StatsSpec): Report {
  const allowed = [...spec.controls, spec.searchButton];
  return {
    id: spec.id,
    label: spec.label,
    path: spec.path,
    allowedControls: allowed,
    dailyOnly: true,
    family: 'picture',
    period: spec.period,
    skipDateCoverageCheck: true,
    chunk: { kind: 'whole', reason: 'dailyOnly — snapshot ของวันที่ดึง ไม่มีอะไรให้แบ่งก้อน' },
    hasRowCap: false,
    dateColumn: spec.expectedColumns[0]!,
    filterNote: 'สถิติรวม เก็บเป็น snapshot ของวันที่ดึง — ช่วงในชื่อไฟล์คือช่วงที่สถิติครอบคลุม (ปีนี้/เดือนนี้/เดือนหน้า/ย้อน 12 เดือน)',
    dataWindow: spec.window,
    searchButton: spec.searchButton,
    boundaryToleranceDays: 0,
    expectedColumns: spec.expectedColumns,
    ...(spec.trailingColumns ? { trailingColumns: spec.trailingColumns } : {}),
    applyFilters: (page: Page, range: DateRange) => spec.applyFilters(page, spec.window(range.from), allowed, spec.id),
    async hasResults(page: Page): Promise<boolean> {
      // ไม่มีตารางให้ดู — ถือว่ามีผลเสมอ วันที่ไม่มีข้อมูลจริงจะไม่มีไฟล์ส่งมาแล้วล้มดัง ๆ (ไม่ใช่ "ว่าง") ซึ่งรับได้
      // เพราะ occupancy ย้อน 12 เดือนไม่มีวันว่าง
      if (spec.grid === null) return true;
      const rows = await gridRowCount(page, `[id*="${spec.grid}"]`);
      return rows !== null && rows > 1;
    },
    async expectedRowCount(): Promise<number | null> {
      return null;
    },
  };
}

const year = (d: Date) => String(d.getUTCFullYear());
const month = (d: Date) => String(d.getUTCMonth() + 1); // ดรอปดาวน์เดือนแสดง 1–12 ไม่มีเลข 0 นำหน้า
const monthOf = (y: number, m1: number): DateRange => ({ from: utcDate(y, m1, 1), to: utcDate(y, m1, lastDayOfMonth(y, m1)) });
const thisYear = (d: Date): DateRange => ({ from: utcDate(d.getUTCFullYear(), 1, 1), to: utcDate(d.getUTCFullYear(), 12, 31) });
const thisMonth = (d: Date): DateRange => monthOf(d.getUTCFullYear(), d.getUTCMonth() + 1);
// utcDate ล้นเดือนให้เอง (เดือน 13 = มกราคมปีหน้า) จึงใช้หาเดือนถัดไปได้ตรง ๆ
const nextMonth = (d: Date): DateRange => {
  const start = utcDate(d.getUTCFullYear(), d.getUTCMonth() + 2, 1);
  return monthOf(start.getUTCFullYear(), start.getUTCMonth() + 1);
};

// หัวตารางทั้งหมดจากไฟล์ .xlsx ที่ดาวน์โหลดจริงตอนตรวจเบื้องต้น 2026-10-07

export const reservationStatsMonth = statsReport({
  id: 'reservation-stats-month',
  label: 'Reporting — reservation statistics by month',
  path: 'ReservationStats.aspx?type=month',
  searchButton: 'ctl00$pc$btnFind',
  controls: ['ctl00$pc$ddlYear'],
  grid: 'dtgStats',
  expectedColumns: [
    'Month', 'Accommodation(excl. SVC and VAT)', 'Others (excl. SVC and VAT)', 'Summary (excl. SVC and VAT)',
    'Roomnights Total', 'Roomnights occupied', 'Occupancy rooms', 'Bednights Total', 'Bednight occupied',
    'Beds per room', 'Check-in', 'Check-out', 'Average accommodation/room rate (excl. SVC and VAT)',
    'Average accommodation/bed rate (excl. SVC and VAT)', 'RevPAR',
  ],
  // 12 เดือนของปีนี้ (ดรอปดาวน์เดือนของหน้านี้ไม่มีผลกับผล — ผลเป็นรายเดือนทั้งปีเสมอ)
  window: thisYear,
  period: 'year',
  applyFilters: (page, w, allowed, id) => setSelect(page, 'ctl00$pc$ddlYear', year(w.from), allowed, id),
});

export const reservationStatsDay = statsReport({
  id: 'reservation-stats-day',
  label: 'Reporting — reservation statistics by day',
  path: 'ReservationStats.aspx?type=day',
  searchButton: 'ctl00$pc$btnFind',
  controls: ['ctl00$pc$ddlYear', 'ctl00$pc$ddlMonth'],
  grid: 'dtgStats',
  expectedColumns: [
    'Date', 'Day', 'Revenue (incl. SVC and VAT)', 'Revenue (excl. SVC and VAT)', 'Roomnights Total',
    'Roomnights occupied', 'Occupancy rooms', 'Bednights Total', 'Bednight occupied', 'Beds per room', 'Check-in',
    'Check-out', 'Average room rate (excl. SVC and VAT)', 'Average bed rate (excl. SVC and VAT)', 'RevPAR',
  ],
  // ทุกวันของเดือนนี้
  window: thisMonth,
  period: 'month',
  async applyFilters(page, w, allowed, id) {
    await setSelect(page, 'ctl00$pc$ddlYear', year(w.from), allowed, id);
    await setSelect(page, 'ctl00$pc$ddlMonth', month(w.from), allowed, id);
  },
});

export const reservationStatsTerm = statsReport({
  id: 'reservation-stats-term',
  label: 'Reporting — reservation statistics for a stay period',
  path: 'ReservationStats.aspx?type=term',
  searchButton: 'ctl00$pc$btnFindTerm',
  controls: ['ctl00$pc$calAccFrom', 'ctl00$pc$calAccTo'],
  grid: 'dtgStats',
  expectedColumns: [
    'Name', 'Revenue (incl. SVC and VAT)', 'Revenue (excl. SVC and VAT)', 'Roomnights Total', 'Roomnights occupied',
    'Occupancy rooms', 'Bednight occupied', 'Check-in', 'Check-out', 'Average room rate (excl. SVC and VAT)',
    'Average bed rate (excl. SVC and VAT)', 'RevPAR',
  ],
  // ช่วงเข้าพัก = เดือนหน้าทั้งเดือน (ค่าตั้งต้นของหน้า) · ช่อง Created from/to ปล่อยว่างตามค่าตั้งต้น = ไม่กรอง
  window: nextMonth,
  period: 'none',
  async applyFilters(page, w, allowed, id) {
    await setSingleDate(page, 'ctl00$pc$calAccFrom', formatDMY(w.from), allowed, id);
    await setSingleDate(page, 'ctl00$pc$calAccTo', formatDMY(w.to), allowed, id);
  },
});

export const reservationStatsSegment = statsReport({
  id: 'reservation-stats-segment',
  label: 'Reporting — roomnights by region and segment',
  path: 'ReservationStats.aspx?type=segment',
  searchButton: 'ctl00$pc$btnSegFind',
  controls: ['ctl00$pc$calSegFrom', 'ctl00$pc$calSegTo'],
  grid: 'dtgSegments',
  // หลังสองคอลัมน์แรกคือชื่อ segment **ที่มีการจองในช่วงที่ค้น** — เปลี่ยนตามข้อมูล ไม่ใช่โครงรายงาน (snapshot ปิดงวดปี 2025 ใบ 05 ได้ชุดต่างจาก 2026:
  // มี F.I.T. - Longstay/Travel Trade/Package แต่ไม่มี Complimentary/Corporate - Local) จึงตรวจแค่สองคอลัมน์แรก · '&nbsp;' เป็นแบบนี้ในไฟล์จริง
  // ไม่ใช่พิมพ์ผิด · ชุดที่เห็นปี 2026: F.I.T. - Promotion, F.I.T. - Full Price, OTA, Complimentary, ฺฺฺBooking.com (มีสระที่มองไม่เห็นนำหน้า),
  // Expedia, Traveloka, Trip.com, Xcaliber, Corporate - Local
  expectedColumns: ['Region', '&nbsp;'],
  trailingColumns: 'data-driven',
  // ทั้งปีนี้ (ค่าตั้งต้นของหน้า)
  window: thisYear,
  period: 'year',
  async applyFilters(page, w, allowed, id) {
    await setSingleDate(page, 'ctl00$pc$calSegFrom', formatDMY(w.from), allowed, id);
    await setSingleDate(page, 'ctl00$pc$calSegTo', formatDMY(w.to), allowed, id);
  },
});

export const combinedForecast = statsReport({
  id: 'combined-forecast',
  label: 'Reporting — combined forecast',
  path: 'reports/CombinedForecast.aspx',
  searchButton: 'ctl00$pc$btnShow',
  controls: ['ctl00$pc$ddlYear', 'ctl00$pc$ddlMonth'],
  grid: 'dtgData',
  expectedColumns: [
    'Name', 'Segment', 'Accommodation (excl. SVC and VAT)', 'Meal plan (excl. SVC and VAT)',
    'Summary (excl. SVC and VAT)', 'Roomnights occupied', 'Occupancy rooms', 'Bednight occupied',
    'Average accommodation/room rate (excl. SVC and VAT)', 'Average accommodation/bed rate (excl. SVC and VAT)',
    'Average meal plan/room rate (excl. SVC and VAT)', 'Average meal plan/bed rate (excl. SVC and VAT)',
  ],
  // พยากรณ์ของเดือนหน้า (ค่าตั้งต้นของหน้า) — ธันวาคมข้ามไปมกราคมปีหน้า
  window: nextMonth,
  period: 'none',
  async applyFilters(page, w, allowed, id) {
    await setSelect(page, 'ctl00$pc$ddlYear', year(w.from), allowed, id);
    await setSelect(page, 'ctl00$pc$ddlMonth', month(w.from), allowed, id);
  },
});

export const occupancyAnnual = statsReport({
  id: 'occupancy-annual',
  label: 'Reporting — occupancy by month for the year',
  path: 'StatsOccupation.aspx?type=annual',
  searchButton: 'ctl00$pc$btnFind',
  controls: ['ctl00$pc$ddlFrom', 'ctl00$pc$ddlTo'],
  grid: 'dtgStats',
  expectedColumns: [
    'Year', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December', 'Summary',
  ],
  // ปีนี้ปีเดียว (ค่าตั้งต้นของหน้า)
  window: thisYear,
  period: 'year',
  async applyFilters(page, w, allowed, id) {
    await setSelect(page, 'ctl00$pc$ddlFrom', year(w.from), allowed, id);
    await setSelect(page, 'ctl00$pc$ddlTo', year(w.to), allowed, id);
  },
});

export const occupancyByRoomType = statsReport({
  id: 'occupancy-room-type',
  label: 'Reporting — occupancy by room type',
  path: 'StatsOccupation.aspx?type=roomtype',
  searchButton: 'ctl00$pc$btnShowRoomType',
  controls: ['ctl00$pc$calRoomTypeFrom', 'ctl00$pc$calRoomTypeTo'],
  // หน้าไม่แสดงตารางหลังกดแสดงผล (recon 2026-10-07) — ตรวจจากไฟล์ export อย่างเดียว
  grid: null,
  expectedColumns: [
    'Room type', 'Year', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December', 'Summary',
  ],
  // ย้อน 12 เดือนถึงวันนี้ (ค่าตั้งต้นของหน้า)
  window: (day) => ({ from: utcDate(day.getUTCFullYear() - 1, day.getUTCMonth() + 1, day.getUTCDate()), to: day }),
  period: 'none', // 12 เดือนย้อนหลังแบบเลื่อน ไม่มีงวดให้ปิด
  async applyFilters(page, w, allowed, id) {
    await setSingleDate(page, 'ctl00$pc$calRoomTypeFrom', formatDMY(w.from), allowed, id);
    await setSingleDate(page, 'ctl00$pc$calRoomTypeTo', formatDMY(w.to), allowed, id);
  },
});
