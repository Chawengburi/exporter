import type { Page } from 'playwright';
import { formatDMY, utcDate, type DateRange } from '../../../core/order.ts';
import { setDateRange, setSelect } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * ตัวเลขรวม 4 หน้า เก็บทุกวันเป็น "เดือนนี้ถึงวันนี้" (ticket 25 ของ exporter-daily-expansion-and-data-store — เจ้าของระบบเลือก 2026-10-08)
 * · ไม่มีคอลัมน์วันที่ในผล → dailyOnly snapshot ของวันที่ดึง (ADR-0003) ชื่อไฟล์บอกช่วง `<วันที่ 1>_<วันนี้>` (`dataWindow`, ticket 26)
 * · ไฟล์ของวันสุดท้ายของเดือนคือยอดทั้งเดือน · recon อ่านอย่างเดียว 2026-10-08 อยู่ใน `recon/NOTES.md`
 */

/** วันที่ 1 ของเดือนถึงวันนี้ — วันที่ 1 ได้ช่วงวันเดียว */
export const monthToDate = (day: Date): DateRange => ({ from: utcDate(day.getUTCFullYear(), day.getUTCMonth() + 1, 1), to: day });

const RANGE = 'ctl00$pc'; // ช่องชื่อ ctl00$pc$calFrom/calTo ตรง ๆ — setDateRange ต่อ suffix ให้ (ไม่ใช่ทั้ง panel)

type MtdSpec = {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly searchButton: string;
  /** ตารางผลบนหน้า · null = หน้าไม่แสดงตาราง (Trial balance — ตัดสินจากไฟล์ export) */
  readonly grid: string | null;
  readonly expectedColumns: readonly string[];
  readonly filterNote: string;
  /** ดรอปดาวน์ที่ตั้งแบบ explicit ให้ตรงค่าตั้งต้นของหน้า (กันค่าตั้งต้นเปลี่ยนเงียบ ๆ) */
  readonly selects: readonly (readonly [name: string, label: string])[];
};

function monthToDateReport(spec: MtdSpec): Report {
  const allowed = [RANGE, ...spec.selects.map(([n]) => n), spec.searchButton];
  return {
    id: spec.id,
    label: spec.label,
    path: spec.path,
    allowedControls: allowed,
    dailyOnly: true,
    family: 'picture',
    period: 'month',
    skipDateCoverageCheck: true, // ตัวเลขรวม ไม่มีคอลัมน์วันที่
    chunk: { kind: 'whole', reason: 'ตัวเลขรวมของเดือนนี้ถึงวันนี้ — ค้นทีเดียว' },
    hasRowCap: false, // ตัวเลขรวม สูงสุดราว 80 แถว
    dateColumn: spec.expectedColumns[0]!,
    filterNote: spec.filterNote,
    dataWindow: monthToDate,
    searchButton: spec.searchButton,
    boundaryToleranceDays: 0,
    expectedColumns: spec.expectedColumns,
    async applyFilters(page: Page, range: DateRange): Promise<void> {
      const w = monthToDate(range.to);
      for (const [name, label] of spec.selects) await setSelect(page, name, label, allowed, spec.id);
      await setDateRange(page, RANGE, formatDMY(w.from), formatDMY(w.to), allowed, spec.id);
    },
    async hasResults(page: Page): Promise<boolean> {
      // ไม่มีตารางให้ดู — ถือว่ามีผล ถ้าไม่มีข้อมูลจริงจะไม่มีไฟล์ส่งมาแล้วล้มดัง ๆ
      // วันที่ไม่มีข้อมูลจริงจะรอจน timeout แล้วล้ม (ข้อความบอกว่า "ช่วงกว้างเกินไป" ซึ่งไม่ใช่สาเหตุ) — รับได้ เพราะงบทดลอง
      // เดือนนี้ถึงวันนี้แทบไม่มีวันว่าง
      if (spec.grid === null) return true;
      // บางหน้ามีตารางผลซ้ำหลายชุด (`…_dtgDetailed_0`, `_1` — แบ่งตามกลุ่ม) — นับแถวข้อมูลรวมทุกตาราง ไม่ใช่แค่ตารางแรก
      const dataRows = await page.evaluate((g) => Array.from(document.querySelectorAll(`table[id*="${g}"]`))
        .reduce((n, t) => n + Math.max(0, t.querySelectorAll('tr').length - 1), 0), spec.grid);
      return dataRows > 0;
    },
    async expectedRowCount(): Promise<number | null> {
      return null;
    },
  };
}

// หัวตารางจากไฟล์ที่การตรวจเบื้องต้นดาวน์โหลดจริง (2026-10-07)

export const trialBalance = monthToDateReport({
  id: 'trial-balance',
  label: 'Trial balance',
  path: 'trialbalance/TrialBalance.aspx',
  searchButton: 'ctl00$pc$btnFind',
  grid: null,
  filterNote: 'งบทดลอง เดือนนี้ถึงวันนี้ (สกุลเงินบ้าน THB)',
  selects: [['ctl00$pc$ddlCurrency', 'THB']],
  // คอลัมน์แรกไม่มีชื่อในไฟล์จริง (ชื่อบัญชี)
  expectedColumns: ['', 'Vatcharge', 'Debit total', 'Credit total', 'Currency'],
});

export const nationalityRevenue = monthToDateReport({
  id: 'nationality-revenue',
  label: 'Nationality revenue',
  path: 'reports/NationalityRevenue.aspx',
  searchButton: 'ctl00$pc$btnShow',
  grid: 'dtgData',
  filterNote: 'รายได้/คืนเข้าพักแยกตามสัญชาติ เดือนนี้ถึงวันนี้',
  selects: [],
  expectedColumns: [
    'State', 'Person', 'Bednights', 'Roomnights', 'Roomnight %', 'Bednight %', 'Receipt in home currency',
    'Receipt in secondary currency', 'Avg roomnight home currency', 'Avg roomnight complementary currency',
  ],
});

export const occupancyByNationality = monthToDateReport({
  id: 'occupancy-by-nationality',
  label: 'Reporting — occupancy by nationality',
  path: 'reports/StatsOccupationForeign.aspx',
  searchButton: 'ctl00$pc$btnFind',
  grid: 'rptDetailedGroups_dtgDetailed',
  filterNote: 'การเข้าพักแยกตามสัญชาติ เดือนนี้ถึงวันนี้ (ไม่แบ่งกลุ่ม)',
  selects: [['ctl00$pc$ddlSplitBy', '--- do not split ---'], ['ctl00$pc$ddlResNationalityMode', 'Each separately']],
  expectedColumns: ['Nationality', 'Reservations arrivals', 'Guest arrivals', 'Room nights', 'Guest nights', 'Nights count'],
});

export const occupancyByNationalityAndStayReason = monthToDateReport({
  id: 'occupancy-by-nationality-stay-reason',
  label: 'Reporting — occupancy by nationality, split by stay reason',
  path: 'reports/StatsOccupationForeign.aspx?g=4',
  searchButton: 'ctl00$pc$btnFind',
  grid: 'rptDetailedGroups_dtgDetailed',
  filterNote: 'การเข้าพักแยกตามสัญชาติ แบ่งตามเหตุผลการเข้าพัก เดือนนี้ถึงวันนี้',
  selects: [['ctl00$pc$ddlSplitBy', 'stay reason'], ['ctl00$pc$ddlResNationalityMode', 'Each separately']],
  expectedColumns: ['Nationality', 'Reservations arrivals', 'Guest arrivals', 'Room nights', 'Guest nights', 'Nights count', 'Out of all groups'],
});
