import {
  depositLedger,
  giftCertificateLedger,
  invoicesAdvance,
  invoicesAnnul,
  invoicesClosedAccount,
  invoicesReport,
} from './accounting-documents.ts';
import { accountingReportDetail, accountingReportSummary } from './accounting-report.ts';
import { arrivalPeriod } from './arrival-period.ts';
import { depositToUse, unpaidInvoicesByDate } from './balances.ts';
import { depositJournal } from './deposit-journal.ts';
import { arrivals } from './arrivals.ts';
import { cityTax } from './city-tax.ts';
import {
  housekeepingAllInOne,
  housekeepingBasic,
  reservationsByArrivalDate,
  roomsAvailable,
  roomsOutOfOrder,
  roomsStatusOverview,
} from './daily-snapshots.ts';
import {
  combinedForecast,
  occupancyAnnual,
  occupancyByRoomType,
  reservationStatsDay,
  reservationStatsMonth,
  reservationStatsSegment,
  reservationStatsTerm,
} from './statistics.ts';
import { departures } from './departures.ts';
import { housekeeping } from './housekeeping.ts';
import { managerDayDetail, managerItems, managerSummary } from './manager-reports.ts';
import { manualPostings } from './manual-postings.ts';
import {
  nationalityRevenue,
  occupancyByNationality,
  occupancyByNationalityAndStayReason,
  trialBalance,
} from './month-to-date.ts';
import { postMasterHistory, postMasters } from './paymaster.ts';
import { postings } from './postings.ts';
import { foreignPoliceProfiles, guestProfiles } from './profiles.ts';
import { unchargedInvoices, unchargedInvoicesByCustomer } from './uncharged-invoices.ts';
import { inHouseGuests } from './in-house-guests.ts';
import { reservationsCancelled } from './reservations-cancelled.ts';
import { reservationsRateCode } from './reservations-ratecode.ts';
import { reservationsSearch } from './reservations-search.ts';
import type { Report } from './_types.ts';

/** ทะเบียนรายงานทั้งหมด — เพิ่มรายงานใหม่โดยเพิ่มไฟล์แล้วมาต่อท้ายที่นี่ */
export const REPORTS: readonly Report[] = [
  reservationsSearch,
  reservationsRateCode,
  reservationsCancelled,
  arrivals,
  departures,
  inHouseGuests,
  housekeeping,
  arrivalPeriod,
  // ticket 20 — หน้าภาพของวันนั้นจากการตรวจเบื้องต้น
  reservationsByArrivalDate,
  housekeepingBasic,
  housekeepingAllInOne,
  roomsStatusOverview,
  roomsOutOfOrder,
  roomsAvailable,
  // ticket 21 — หน้าสถิติ เก็บเป็นภาพของวันที่ดึง
  reservationStatsMonth,
  reservationStatsDay,
  reservationStatsTerm,
  reservationStatsSegment,
  combinedForecast,
  occupancyAnnual,
  occupancyByRoomType,
  // ticket 14 — ledger ย้อน 3 วัน
  postMasters,
  postMasterHistory,
  // ticket 18, 13 — ledger ย้อน 3 วัน
  manualPostings,
  postings,
  // ticket 15 — เอกสารบัญชี ledger ย้อน 3 วัน
  invoicesAdvance,
  invoicesAnnul,
  invoicesClosedAccount,
  depositLedger,
  giftCertificateLedger,
  invoicesReport,
  // ticket 17, 19 — การเข้าพักที่คร่อมช่วง (ด่าน overlapColumns)
  cityTax,
  guestProfiles,
  foreignPoliceProfiles,
  // ticket 16 — ใบแจ้งหนี้ค้างชำระ (สถานะ ณ วันที่ดึง)
  unchargedInvoices,
  unchargedInvoicesByCustomer,
  // ticket 23 — ยอดคงค้าง ณ วันที่ + รายได้ของเมื่อวาน
  depositToUse,
  unpaidInvoicesByDate,
  managerDayDetail,
  // ticket 24 — หน้าที่มี export สองแบบ (เอาทั้งคู่)
  managerSummary,
  managerItems,
  accountingReportSummary,
  accountingReportDetail,
  // ticket 25 — ตัวเลขรวม เดือนนี้ถึงวันนี้
  trialBalance,
  nationalityRevenue,
  occupancyByNationality,
  occupancyByNationalityAndStayReason,
  // ticket 22 — ผ่านตอนตรวจซ้ำ
  depositJournal,
];

export function findReport(id: string): Report | undefined {
  return REPORTS.find((r) => r.id === id);
}

export function reportIds(): string[] {
  return REPORTS.map((r) => r.id);
}
