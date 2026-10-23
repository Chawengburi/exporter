import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { formatDMY, formatISO, splitRange, utcDate, type DateRange } from '../../core/order.ts';
import { fetchWithRowCapSplit, type FetchOneResult } from '../../core/rowcap.ts';
import {
  assertBranch,
  assertSessionDateRange,
  sessionDateRangeProblem,
  dismissInterstitial,
  selectShowNRows,
  setDateRangeByTyping,
  setPeriodFilter,
  triggerExportAndCaptureDownload,
  waitForReady,
  CONTROL_PERIOD_FILTER,
  InteractionError,
} from './interactions.ts';
import { verifyRowCount } from './verify.ts';
import { readFoodStorySheet } from './xlsx.ts';
import { XlsxError, readSheetNames } from '../../core/xlsx.ts';
import { isTransientOnSamePage, withBrowserRetry, type Attempted } from '../../core/retry.ts';
import { dailyFolder, latestPointer, foodstoryFileName, monthlyFolder, monthlyRoot } from '../../core/placement.ts';
import { exitCodeFor, readRunRecord, recordRun, type ReportOutcome, type StoreKind } from '../../core/run-record.ts';
import { createRedactor, redactError, type Redactor } from '../../core/redact.ts';
import { thaiToday } from '../../core/thai-time.ts';
import { loadConfig, loadCredentials, type Config, type Credentials } from './config.ts';
import { login, openSession, type Session } from './session.ts';
import { downloadSaleByChannel, readSaleByChannelCsv, EXPECTED_COLUMNS as SALEBYCHANNEL_COLUMNS, ID as SALEBYCHANNEL_ID, LABEL as SALEBYCHANNEL_LABEL, PATH as SALEBYCHANNEL_PATH } from './salebychannel.ts';
import {
  HOST as RESERVATION_HOST,
  ID as RESERVATION_ID,
  LABEL as RESERVATION_LABEL,
  PATH as RESERVATION_PATH,
  navigateToReservationReport,
  setReservationDateRange,
  triggerReservationExcelDownloadAndCapture,
} from './reservation-report.ts';
import { REPORTS } from './reports/index.ts';
import { runFoodStoryDaily } from './daily.ts';
import { FOODSTORY_ROW_CAP } from './reports/salebybilldetail.ts';
import type { Report } from './reports/_types.ts';

/**
 * runner การรันจริงของ FoodStory (ticket 12) — ต่างจาก HotelTime (`hoteltime/export.ts`) ใน
 * โครงสร้างพื้นฐานเพราะโมเดลของเว็บต่างกันจริง:
 *
 * 1. **รายเดือน + รายวัน ไม่มี baseline** — สเปกต้นทาง §9 สั่งรอบรายเดือน (preset "เดือนที่แล้ว") · รอบรายเดือนทำหน้าที่เก็บการแก้
 *    ย้อนหลังแทน baseline · `--daily` ส่งต่อให้ `daily.ts` (โมเดลใหม่ ใบ 06) — ทาง `daily` ที่เหลือในไฟล์นี้ (`foodstoryWindow`, ส่วน
 *    รายวันของ `runFoodStoryExport`) เป็นของโมเดลเก่า ไม่ถูกเรียกแล้ว รอถอดออก
 * 2. **ช่วงวันที่เป็น session-level ไม่ใช่ per-report** — ตั้งครั้งเดียวก่อนวนลูป (ดู
 *    `reports/_types.ts`) ไม่ใช่ทุกรายงานประกาศ `applyFilters` ของตัวเอง
 * 3. **ไม่ต้องรวมไฟล์เป็น CSV รายปี** — แต่ละไฟล์ที่ดาวน์โหลดมาคือหนึ่งเดือนเต็มอยู่แล้ว (ไม่มี
 *    concept ก้อนรายเดือนสะสมหลายปีแบบ HotelTime) แค่ rename ตามสเปกต้นทาง §7 พอ
 *
 * 🔴 **`reservation-report` (#55) รันเป็นใบสุดท้ายของรอบเสมอ** (ต่อเข้า runner 2026-09-28) — อยู่
 * คนละ host (`manage.foodstory.co`) `goto()` ตรง ๆ ไม่ได้ ต้องคลิก sidebar จาก page ที่ login
 * owner.foodstory.co ค้างอยู่ (ticket 11 พิสูจน์แล้ว) ซึ่งทำได้ใน process/captcha เดียวกัน แต่พอข้าม
 * ไปแล้วไม่กลับมา owner อีก — รายงานอื่นทุกใบจึงต้องจบก่อน (ดู `planFoodStoryRun`)
 *
 * login แก้ reCAPTCHA ได้ 2 ทางตามการมี `TWOCAPTCHA_API_KEY` (ADR-0010, ดู `session.ts::login`):
 * มีคีย์ → แก้อัตโนมัติ รันไร้คนดูแลบน Windmill headless container ได้เหมือน HotelTime · ไม่มีคีย์ →
 * รอคนแก้ captcha เอง ต้องรันจากเครื่องที่มีหน้าจอ `--headful` (dev บน Mac) · ไม่ว่าทางไหน runner นี้
 * ยังทำงานแบบ login เดียวต่อรอบเหมือนเดิม (กลับคำจาก ADR-0006 ที่เคยบังคับว่าต้องมีคนเสมอ)
 */

export const ALL_REPORTS = 'all';

/**
 * ผลรายใบของ FoodStory → บันทึกผลรอบชุดเดียวกับ HotelTime (core/run-record.ts, ticket 03) · ok/empty/split = ผ่าน · failed/truncated =
 * ล้ม (truncated = ชนเพดานแล้วผ่าต่อไม่ได้ ข้อมูลไม่ครบ ต้องให้คนดู) · `shaOf` ใส่จากผู้เรียก (อ่านไฟล์) ให้ฟังก์ชันนี้ไม่แตะดิสก์
 */
export function toReportOutcomes(
  results: readonly FoodStoryReportResult[],
  range: DateRange,
  shaOf: (file: string) => string,
): ReportOutcome[] {
  const span = { from: formatISO(range.from), to: formatISO(range.to) };
  return results.map((r): ReportOutcome => {
    const attempts = r.attempts ?? 1;
    if (r.status === 'failed' || r.status === 'truncated') {
      return { report: r.id, status: 'failed', error: `${r.status}${r.note ? `: ${r.note}` : ''}`, attempts };
    }
    return {
      report: r.id,
      status: 'ok',
      rows: r.rowsExported ?? 0,
      range: span,
      actualRange: null,
      files: r.files.map((f) => ({
        file: path.basename(f),
        ...(r.files.length === 1 && r.rowsExported !== null ? { rows: r.rowsExported } : {}),
        sha256: shaOf(f),
      })),
      attempts,
    };
  });
}

/**
 * เติมชื่อชีตของไฟล์ xlsx ให้ผลรายใบ (manifest ต้องบอกได้ว่าไฟล์มีกี่ชีต — ticket 01 ของ exporter-daily-per-day-raw) · รายงานที่ผ่าครึ่ง
 * รวมชื่อจากทุกส่วน · ไฟล์ที่ตัวอ่านเปิดไม่ได้ (เช่น reservation-report ที่ยังไม่มีนิยามหัวตาราง) ไม่ทำให้ทั้งรอบล้ม แต่พิมพ์เตือนและไม่ใส่ `sheets`
 */
function withSheetNames(r: FoodStoryReportResult): FoodStoryReportResult {
  const xlsx = r.files.filter((f) => f.endsWith('.xlsx'));
  if (xlsx.length === 0) return r;
  try {
    return { ...r, sheets: [...new Set(xlsx.flatMap((f) => readSheetNames(f)))] };
  } catch (err) {
    if (!(err instanceof XlsxError)) throw err;
    console.warn(`⚠ อ่านชื่อชีตของ "${r.id}" ไม่ได้ — manifest จะไม่มี sheets ของรายงานนี้: ${err.message.split('\n')[0]}`);
    return r;
  }
}

export type FoodStoryReportStatus = 'ok' | 'empty' | 'split' | 'truncated' | 'failed';

export type FoodStoryExportOptions = {
  readonly reportId: string;
  /** DD/MM/YYYY ทั้งคู่ต้องมาด้วยกัน — ไม่ระบุ = ใช้เดือนที่แล้วตามสเปกต้นทาง §9 */
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly headful: boolean;
  readonly slowMoMs: number | undefined;
  readonly json: boolean;
  /** รอบรายวันตามโมเดลใหม่ (daily.ts, ใบ 06) — ใช้คู่กับ from/to ไม่ได้ (CLI กันไว้) */
  readonly daily: boolean;
};

export type FoodStoryReportResult = {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly path: string;
  readonly status: FoodStoryReportStatus;
  readonly rowCountReported: number | null;
  readonly rowsExported: number | null;
  readonly files: readonly string[];
  /** ชื่อทุกชีตของไฟล์ xlsx ของรายงานนี้ตามลำดับแท็บ (รวมทุกส่วนของรายงานที่ผ่าครึ่ง) · ไม่มี = ไม่มีไฟล์ xlsx หรืออ่านชื่อชีตไม่ได้ (มีคำเตือนตอนรัน) */
  readonly sheets?: readonly string[];
  readonly note: string | null;
  /** จำนวนครั้งที่ลอง (core/retry.ts) — ไม่มี = 1 (ใบที่ไม่ได้ผ่านนโยบายลองใหม่) */
  readonly attempts?: number;
};

/**
 * 🔴 ตั้งใจใช้ camelCase (`runStartedUtc`, `rowsExported`, ...) ต่างจากตัวอย่าง manifest ของ
 * สเปกต้นทาง §7 ที่เขียนเป็น snake_case (`run_started_utc`, `rows_exported`) — ตรงกับ convention
 * TypeScript ของโปรเจกต์นี้เอง (เหมือน `ExportPayload`/manifest ของ HotelTime ทุกที่) สเปกต้นทาง
 * เป็นเอกสารบรรยายพฤติกรรมที่สังเกตจากการรันมือ ไม่ใช่ contract ที่มี consumer ภายนอกอิงอยู่แล้ว —
 * ยังไม่มี uploader/consumer จริงที่ parse ไฟล์นี้ (รอ ticket ถัดไป) จึงยังไม่ใช่ breaking change
 * แต่ถ้าวันหนึ่งมี consumer ต้องรู้ว่า key เป็น camelCase ไม่ตรงตัวอักษรกับสเปกต้นทาง
 */
export type FoodStoryManifest = {
  readonly period: string;
  readonly branch: string;
  readonly runStartedUtc: string;
  readonly requestedRange: { readonly from: string; readonly to: string };
  readonly reports: readonly FoodStoryReportResult[];
  readonly crossCheck: { readonly ok: boolean; readonly note: string } | null;
  /** เหตุผลที่ไม่ได้เช็คไขว้ (รอบรายวัน) — ไม่มี = เช็คแล้วหรือขาดไฟล์ที่ใช้เทียบ */
  readonly crossCheckSkipped?: string;
  readonly spotCheckWarnings: readonly string[];
};

const DAILY_CROSS_CHECK_SKIPPED =
  'รอบรายวัน — salebymonthsum เป็นยอดรวมรายเดือน (ทั้งปี แถวละเดือน) เทียบกับยอดวันเดียวไม่ได้ · เช็คในรอบรายเดือนแทน';

/**
 * สเปกต้นทาง §8.3: "assert that the core reports (salebysumdate, salebyproduct, costbyproduct,
 * inv_movement) are non-empty for any month with trading activity" — ใช้ `salebysumdate` เองเป็น
 * ตัวบ่งชี้ว่าเดือนนี้มีการค้าขายจริงไหม (ถ้า `salebysumdate` ว่างเปล่าด้วย ก็ไม่มีฐานให้เทียบ
 * เลย ไม่ flag อะไร) แล้วเช็คว่า core report ที่เหลือว่างเปล่าผิดปกติไหม
 */
const CORE_REPORT_IDS = ['salebyproduct', 'costbyproduct', 'inv_movement'] as const;

export function spotCheckCoreReports(results: readonly FoodStoryReportResult[]): readonly string[] {
  const salebysumdate = results.find((r) => r.id === 'salebysumdate');
  if (!salebysumdate || salebysumdate.status === 'empty' || salebysumdate.status === 'failed') return [];

  const warnings: string[] = [];
  for (const id of CORE_REPORT_IDS) {
    const r = results.find((x) => x.id === id);
    if (r?.status === 'empty') {
      warnings.push(
        `⚠ "${id}" ว่างเปล่าทั้งที่ salebysumdate มีข้อมูลจริง (${salebysumdate.rowsExported} แถว) — ` +
          'ผิดปกติตามสเปกต้นทาง §8.3 ควรตรวจด้วยมือ',
      );
    }
  }
  return warnings;
}

/** เดือนก่อนหน้าแบบเต็มเดือน (ปฏิทิน) — ใช้เป็นค่าเริ่มต้นตามสเปกต้นทาง §9 */
export function previousMonthRange(today: Date): DateRange {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1; // 1-indexed
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const from = utcDate(prevY, prevM, 1);
  const to = utcDate(prevY, prevM + 1, 0); // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้
  return { from, to };
}

export function periodLabel(range: DateRange): string {
  const y = range.from.getUTCFullYear();
  const m = String(range.from.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** รอบหนึ่งของ FoodStory: ชนิดรอบในคลัง + ช่วงข้อมูล + คำนำหน้าชื่อไฟล์ (`<label>__<กลุ่ม>__<id>`) */
export type FoodStoryWindow = { readonly kind: Extract<StoreKind, 'daily' | 'monthly'>; readonly range: DateRange; readonly label: string };

/**
 * ช่วงข้อมูลของรอบ — `daily` (โมเดลเก่า ไม่ถูกเรียกแล้ว — ดูหัวไฟล์) = **เมื่อวาน** (เวลาไทย) วันเดียว: วันที่ปิดยอดแล้ว ไม่ได้ยอดครึ่งวัน และยังถูกถ้าย้ายไปรันตอน
 * เที่ยงคืน (ADR-0006, ticket 10) · ไม่ไล่เก็บวันที่พลาด — รอบรายเดือนครอบคลุมให้ · ไม่ใช่ daily: `from`/`to` ที่ขอ หรือ
 * เดือนที่แล้วเต็มเดือน · `today` = วันนี้ตามเวลาไทย (`thaiToday()`)
 */
export function foodstoryWindow(
  opts: { readonly daily: boolean; readonly from?: Date; readonly to?: Date },
  today: Date,
): FoodStoryWindow {
  if (opts.daily) {
    const yesterday = utcDate(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate() - 1);
    return { kind: 'daily', range: { from: yesterday, to: yesterday }, label: formatISO(yesterday) };
  }
  const range = opts.from && opts.to ? { from: opts.from, to: opts.to } : previousMonthRange(today);
  return { kind: 'monthly', range, label: periodLabel(range) };
}

/**
 * กลุ่มของแต่ละรายงาน — ใช้ตั้งชื่อไฟล์ตามสเปกต้นทาง §7 (`{YYYY-MM}__{group}__{slug}.xlsx`)
 * ตรงกับกลุ่มที่ ticket แบ่งไว้ (03=tax, 04/05=sales, 06/07=product-detail, 08/09=inventory,
 * 10=remaining) — รายงานที่ไม่อยู่ในตารางนี้ถือเป็นบั๊ก (โยน error ทันทีไม่เดาให้)
 */
const GROUP_BY_ID: Readonly<Record<string, string>> = {
  outputtax: 'tax', fulltaxinvoice: 'tax',
  salebysumdate: 'sales', salebydate: 'sales', salebybill: 'sales', pay: 'sales',
  salebyproduct: 'sales', salebyproducthourly: 'sales', salebyproductdaily: 'sales',
  salebycategory: 'sales', salebygroup: 'sales', salebyoption: 'sales', 'sale-claim': 'sales',
  salebymonthsum: 'sales', salebybilldetail: 'sales', [SALEBYCHANNEL_ID]: 'sales',
  costbyproduct: 'product-detail', intermidiate: 'product-detail', ingredient: 'product-detail',
  ingredientaddon: 'product-detail', order: 'product-detail', option: 'product-detail',
  option_by_date: 'product-detail', order_by_employee: 'product-detail',
  payment_by_employee: 'product-detail',
  current_stock: 'inventory', check_stock: 'inventory', activity: 'inventory', supplier: 'inventory',
  purchase_stock: 'inventory', 'purchase-detail': 'inventory', add_waste: 'inventory',
  used_stock: 'inventory', used_stock_by_date: 'inventory', transfer_stock: 'inventory',
  'transfer-detail': 'inventory', transfer: 'inventory', inv_movement: 'inventory',
  summary_stock_movement: 'inventory',
  crm: 'remaining', drawer: 'remaining', drawer_paid: 'remaining', promotion: 'remaining',
  promotion_use: 'remaining', voucher: 'remaining', employee: 'remaining', working: 'remaining',
  table: 'remaining',
  [RESERVATION_ID]: 'reservation',
};

export function groupOf(reportId: string): string {
  const g = GROUP_BY_ID[reportId];
  if (!g) throw new Error(`ไม่รู้จักกลุ่มของรายงาน "${reportId}" — เพิ่มเข้า GROUP_BY_ID ก่อน`);
  return g;
}

/**
 * 🔴 เดิมเคยเช็ค `.carlendar-force.hide` ก่อนตัดสินใจว่าจะลอง `fetchWithRowCapSplit` ไหม —
 * **พังจริง 2026-09-26** (ticket 12 batch run แรก): `.carlendar-force` hidden จริงบน**ทุกหน้าที่
 * เช็ค แม้แต่ `salebysumdate` ที่พิสูจน์มาตั้งแต่ ticket 03 ว่ามีตัวกรองวันที่ใช้งานได้จริง** —
 * แปลว่า class นี้ไม่ได้บอกอะไรเกี่ยวกับตัวกรองที่ `setDateRangeByTyping` ใช้จริงเลย (คนละ element
 * กับที่ ticket 08/09 เคยไล่เจอผ่าน `#calendar` บนหน้า inventory โดยเฉพาะ — เข้าใจผิดว่าเป็นกฎ
 * ทั่วไปได้) ผลคือ `salebybilldetail`/`order` เดือน ส.ค. 2026 ที่เกิน 5,000 แถวจริงถูก truncate
 * ทิ้งข้อมูลไปทั้งที่ควรผ่าครึ่งได้จริง
 *
 * **แก้แล้ว:** ไม่เดาอีกต่อไป — ลอง `fetchWithRowCapSplit` ตรง ๆ เลย แล้วจับ `InteractionError`
 * เฉพาะตอน `setDateRangeByTyping` เองบอกว่าหาปุ่ม/คลิกไม่ได้ (แบบที่ ticket 08/09 เจอกับ
 * `current_stock`/`inv_movement` จริง) ค่อยถือว่าตัดกลับไปทาง truncated แทน — เป็นการทดสอบ
 * พฤติกรรมจริงของ primitive เดียวกับที่จะใช้งานจริง ไม่ใช่การเดาจาก DOM class แยกต่างหาก
 */

type ChunkFile = { readonly range: DateRange; readonly rowCount: number; readonly filePath: string };

async function fetchOneChunk(
  page: Page,
  report: Report,
  downloadDir: string,
  range: DateRange,
): Promise<FetchOneResult<ChunkFile>> {
  await setDateRangeByTyping(page, range);
  await selectShowNRows(page, report.allowedControls, report.id);
  const showing = await waitForReady(page);
  await assertSessionDateRange(page, range);

  // ชนเพดาน → fetchWithRowCapSplit จะผ่าต่อและไม่ใช้ไฟล์ของช่วงนี้เลย ไม่ต้อง export (เดิมดาวน์โหลด
  // ไฟล์ 5,000 แถวทิ้งทุกครั้ง และตรวจจำนวนแถวไม่ได้เพราะไฟล์ถูกตัดโดยตั้งใจ)
  if (showing.total === 0 || showing.total >= FOODSTORY_ROW_CAP) {
    return { total: showing.total, rows: [] };
  }

  const destFileName = `${report.id}__${formatISO(range.from)}_${formatISO(range.to)}.xlsx`;
  const { filePath, rows } = await exportAndVerifyRows(page, report, showing, downloadDir, destFileName);
  return { total: showing.total, rows: [{ range, rowCount: rows, filePath }] };
}

/**
 * export แล้วนับแถวในไฟล์จริงเทียบกับ `Showing … of N` (สเปกต้นทาง §8.2 — `verifyRowCount`) ถ้าไม่ตรง
 * เลือก Show N rows ใหม่แล้ว export ซ้ำหนึ่งครั้ง ยังไม่ตรงก็โยน `VerifyError`
 *
 * 🔴 พังจริง 2026-09-28 (batch ส.ค. รอบสาม): `salebybilldetail` ส่วน 01–16 ส.ค. ได้ไฟล์แค่ 25 แถว
 * (ค่าเริ่มต้น "Show 25") จาก 3,048 — export ก่อน Show 5000 มีผล และไม่มีใครรู้เพราะ `verifyRowCount`
 * เขียนไว้แต่ไม่เคยถูกเรียกเลย ส่วน manifest เอาจำนวนแถวมาจากตัวเลขบนหน้า ไม่ใช่จากไฟล์
 */
async function exportAndVerifyRows(
  page: Page,
  report: Report,
  showing: Awaited<ReturnType<typeof waitForReady>>,
  downloadDir: string,
  destFileName: string,
): Promise<{ readonly filePath: string; readonly rows: number }> {
  let expected = showing;
  for (let attempt = 1; ; attempt++) {
    const filePath = await triggerExportAndCaptureDownload(
      page, report.allowedControls, report.id, report.exportButtonText, downloadDir, destFileName,
    );
    const sheet = readFoodStorySheet(filePath, report);
    try {
      verifyRowCount(sheet, expected);
      return { filePath, rows: sheet.rows.length };
    } catch (err) {
      if (attempt >= 2) throw err;
      await selectShowNRows(page, report.allowedControls, report.id);
      expected = await waitForReady(page);
    }
  }
}

async function finalizeFile(
  rawPath: string,
  outDir: string,
  period: string,
  group: string,
  slug: string,
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const destPath = path.join(outDir, foodstoryFileName('foodstory', period, group, slug, 'xlsx'));
  await rename(rawPath, destPath);
  return destPath;
}

/**
 * ย้ายไฟล์ของรายงานที่ดึงสำเร็จจากที่พัก (`_downloads/<id>/`) เข้าโฟลเดอร์รอบในคลัง — ไฟล์เก่าของรายงานนี้ในโฟลเดอร์
 * นั้นถูกแทนก็ต่อเมื่อรอบใหม่ผ่าน (ok/empty/split) · ล้ม = ไม่แตะคลังเลย (ADR-0005, /code-review ticket 03: เดิมลบก่อน
 * เริ่มดึง ดึงซ้ำวันเดียวกันแล้วล้มไฟล์ที่เคยได้หายไปจากคลัง — แบบเดียวกับ HotelTime ที่แทนเมื่อผ่านเท่านั้น)
 * · truncated (ข้อมูลไม่ครบ) / empty (0 แถว) เก็บได้เฉพาะเมื่อยังไม่มีไฟล์ของใบนี้ — ถ้ามีแล้ว ไม่แทน และนับเป็นล้ม
 * · ย้ายไฟล์ใหม่เข้าก่อน แล้วค่อยลบไฟล์เก่าที่ไม่ได้ถูกทับ — ย้ายพังกลางทางไฟล์เก่าก็ไม่หายก่อน
 */
export async function publishReport(result: FoodStoryReportResult, outDir: string, period: string): Promise<FoodStoryReportResult> {
  if (result.status === 'failed') return result;
  const previous = await previousOutputOf(outDir, period, result.group, result.id);
  if (result.status === 'truncated' && previous.length > 0) {
    return {
      ...result, status: 'failed', files: [],
      note: `${result.note ?? 'truncated'} — ไม่แทนไฟล์เดิมของรอบก่อนในโฟลเดอร์นี้ (ไฟล์ที่ถูกตัดค้างอยู่ใน ${path.dirname(result.files[0] ?? '')})`,
    };
  }
  // ได้ 0 แถวทั้งที่รอบก่อนของโฟลเดอร์นี้มีไฟล์ — ข้อมูลของวัน/เดือนที่ปิดแล้วไม่ควรหายไปเฉย ๆ ถือว่าน่าสงสัย ไม่ลบของเดิม
  // (/code-review ticket 10 — รอบรายวันดึงเมื่อวานซ้ำ ยอดไม่ควรเปลี่ยน)
  if (result.status === 'empty' && previous.length > 0) {
    return { ...result, status: 'failed', note: 'ได้ 0 แถวแต่รอบก่อนในโฟลเดอร์นี้มีไฟล์ — ไม่แทนไฟล์เดิม (ตรวจด้วยตาว่าหน้าเว็บว่างจริงไหม)' };
  }
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  for (const f of result.files) {
    const dest = path.join(outDir, path.basename(f));
    await rename(f, dest);
    files.push(dest);
  }
  const kept = new Set(files.map((f) => path.basename(f)));
  for (const old of previous) if (!kept.has(old)) await rm(path.join(outDir, old), { force: true });
  return { ...result, files };
}

/**
 * ดึงซ้ำลงโฟลเดอร์รอบเดิม (วันเดียวกัน) — ใบที่ไม่ได้รันใหม่ หรือรันใหม่แล้วล้มแต่เดิมผ่าน (ไฟล์เดิมยังอยู่ ไม่ถูกแตะ) คงรายการ
 * เดิมใน `_manifest.json` (เดิมเขียนทับทั้งไฟล์ ที่มาของใบอื่นหาย) · เช็คไขว้เดิมใช้ต่อได้เฉพาะเมื่อไม่มีใบที่ใช้เทียบถูกแทน
 * ด้วยไฟล์ใหม่ — ไม่งั้นมันเทียบกับไฟล์ที่ถูกแทนไปแล้ว
 */
export function mergeManifest(previous: FoodStoryManifest | null, current: FoodStoryManifest): FoodStoryManifest {
  if (!previous) return current;
  const before = new Map(previous.reports.map((r) => [r.id, r]));
  const replaces = (r: FoodStoryReportResult) => r.status !== 'failed' || (before.get(r.id)?.status ?? 'failed') === 'failed';
  const replaced = new Set(current.reports.filter(replaces).map((r) => r.id));
  const reports = [...previous.reports.filter((r) => !replaced.has(r.id)), ...current.reports.filter(replaces)];
  const crossCheckInputsReplaced = current.reports.some(
    (r) => (r.id === 'salebysumdate' || r.id === 'salebymonthsum') && r.status !== 'failed',
  );
  return { ...current, reports, crossCheck: current.crossCheck ?? (crossCheckInputsReplaced ? null : previous.crossCheck) };
}

/**
 * ไฟล์ผลลัพธ์เดิมของรายงานนี้ในโฟลเดอร์รอบ (`publishReport` แทนเมื่อรอบใหม่ผ่าน) — 🔴 พังจริง 2026-09-26: รันซ้ำรายงาน
 * เดียวกันหลังแก้บั๊ก truncated→split แล้วไฟล์เก่า `..._salebybilldetail.xlsx` (ไม่มี part suffix จากรอบก่อนที่ยัง truncate
 * อยู่) ค้างอยู่ข้าง ๆ ไฟล์ใหม่ `_part1`/`_part2` คนเปิดโฟลเดอร์มาเจอทั้งไฟล์เก่าผิด ๆ กับไฟล์ใหม่ปนกันโดยไม่รู้ว่าอันไหนถูก
 * · `monthlyFolder` ไม่คืนโฟลเดอร์ของวันอื่น และ `dailyFolder` ผูกกับวันของข้อมูล (เมื่อวาน) จึงแทนได้แค่ไฟล์ของข้อมูลชุดเดียวกัน
 *   ที่ดึงซ้ำ (spec: ยอมเขียนทับเฉพาะรันซ้ำรายงานเดียวกัน
 * ลงโฟลเดอร์วันเดียวกัน)
 */
async function previousOutputOf(outDir: string, period: string, group: string, reportId: string): Promise<string[]> {
  const prefix = foodstoryFileName('foodstory', period, group, reportId, '').slice(0, -1);
  const entries = await readdir(outDir).catch(() => [] as string[]); // ยังไม่มีโฟลเดอร์ = ไม่มีของเดิม
  // เจาะจงด้วย `${prefix}.` หรือ `${prefix}_part` กันไม่ให้โดนรายงานอื่นที่ id ขึ้นต้นด้วยกัน (เช่น `order` กับ `order_by_employee`)
  return entries.filter((e) => e === `${prefix}.xlsx` || e === `${prefix}.csv` || e.startsWith(`${prefix}_part`));
}

/**
 * ตั้งช่วงวันที่ระดับ session ผ่านหน้า `salebysumdate` — หน้าเบาที่พิสูจน์แล้วว่าตั้งได้เสมอ ใช้ทั้งตอน
 * เริ่มรอบ, ตอนคืนช่วงหลักหลังแบ่งช่วง และตอนเจอว่า session เพี้ยนก่อนเริ่มรายงาน
 */
export async function resetSessionDateRange(page: Page, cfg: Config, range: DateRange): Promise<void> {
  const salebysumdate = REPORTS.find((r) => r.id === 'salebysumdate');
  if (!salebysumdate) throw new Error('ไม่เจอ salebysumdate ใน REPORTS — ใช้ตั้งช่วงวันที่ระดับ session ไม่ได้');
  await page.goto(`${cfg.baseUrl}${salebysumdate.path}`);
  await dismissInterstitial(page, salebysumdate.allowedControls, salebysumdate.id);
  await setDateRangeByTyping(page, range);
}

/**
 * เปิดหน้ารายงานโดยให้แน่ใจว่า session อยู่ที่ช่วงหลัก — ถ้าเพี้ยน (request ที่ค้างฝั่ง server เขียนทับ
 * ย้อนหลัง หรือรายงานก่อนหน้าคืนช่วงไม่สำเร็จ) ตั้งใหม่ผ่าน `salebysumdate` แล้วเปิดหน้านี้ซ้ำครั้งเดียว
 *
 * 🔴 พังจริง 2026-09-28 (batch ส.ค. รอบสอง): `inv_movement` แบ่งช่วงสำเร็จแต่คืนช่วงหลักบนหน้าตัวเองไม่ติด
 * session ค้างที่ 25–31 ส.ค. — `assertSessionDateRange` กันไม่ให้ export ผิดช่วงได้ถูกต้อง แต่ทุกใบหลังจาก
 * นั้นล้มตามกันหมด 11 ใบเพราะไม่มีใครตั้งช่วงคืน — ขั้นนี้คือการกู้ตัวเอง ด่านสุดท้ายยังเป็น
 * `assertSessionDateRange` เหมือนเดิม
 */
async function openWithSessionRange(
  page: Page,
  cfg: Config,
  path_: string,
  range: DateRange,
  dismiss: (() => Promise<void>) | null,
): Promise<void> {
  await page.goto(`${cfg.baseUrl}${path_}`);
  if (dismiss) await dismiss();
  if ((await sessionDateRangeProblem(page, range)) === null) return;
  await resetSessionDateRange(page, cfg, range);
  await page.goto(`${cfg.baseUrl}${path_}`);
  if (dismiss) await dismiss();
}

export async function exportOneReport(
  page: Page,
  cfg: Config,
  report: Report,
  mainRange: DateRange,
  stagingDir: string,
  period: string,
): Promise<FoodStoryReportResult> {
  const group = groupOf(report.id);

  await openWithSessionRange(page, cfg, report.path, mainRange, () =>
    dismissInterstitial(page, report.allowedControls, report.id));

  // 🔴 salebymonthsum (และรายงานที่ใช้ CONTROL_PERIOD_FILTER อื่นในอนาคต) ไม่ตอบสนองต่อ
  // setDateRangeByTyping ระดับ session เลย — ต้องตั้ง period เอง (ปี = ปีของช่วงหลัก) ก่อนอ่าน
  // waitForReady ครั้งแรก ไม่งั้นจะอ่านค่า default ของหน้า (ปีปัจจุบันตาม state เดิม) ผิดช่วง
  if (report.allowedControls.includes(CONTROL_PERIOD_FILTER)) {
    await setPeriodFilter(page, report.allowedControls, report.id, { year: mainRange.from.getUTCFullYear() });
  }

  const showing = await waitForReady(page);
  await assertBranch(page, cfg.branchName);
  await assertSessionDateRange(page, mainRange);

  if (showing.total === 0) {
    return {
      id: report.id, label: report.label, group, path: report.path, status: 'empty',
      rowCountReported: 0, rowsExported: 0, files: [], note: null,
    };
  }

  if (showing.total < FOODSTORY_ROW_CAP) {
    await selectShowNRows(page, report.allowedControls, report.id);
    const shown = await waitForReady(page);
    const tmpFileName = `${report.id}__tmp.xlsx`;
    const { filePath: tmpPath, rows } = await exportAndVerifyRows(page, report, shown, cfg.downloadDir, tmpFileName);
    const finalPath = await finalizeFile(tmpPath, stagingDir, period, group, report.id);
    return {
      id: report.id, label: report.label, group, path: report.path, status: 'ok',
      rowCountReported: showing.total, rowsExported: rows, files: [finalPath], note: null,
    };
  }

  // เกินเพดาน — ลองผ่าครึ่งช่วงวันที่จริงเลย (ไม่เดาจาก DOM class แยกต่างหาก — ดูคอมเมนต์ด้านบน)
  let chunks: readonly ChunkFile[];
  try {
    chunks = await fetchWithRowCapSplit(mainRange, FOODSTORY_ROW_CAP, (r) =>
      fetchOneChunk(page, report, cfg.downloadDir, r),
    );
  } catch (err) {
    if (!(err instanceof InteractionError)) throw err;

    // 🔴 กรณีที่ยืนยันแล้วจริงตอน ticket 09 (`inv_movement`, 9,179 แถว) — ตัวกรองวันที่หาไม่เจอ/
    // คลิกไม่ได้จริง (InteractionError จาก setDateRangeByTyping เอง) ต้องยอมรับว่าไฟล์ที่ได้ถูก
    // cap ไว้ที่ FOODSTORY_ROW_CAP จริง ไม่ใช่ข้อมูลครบ — กลับไปหน้ารายงานให้สะอาดก่อน (state อาจ
    // ค้างกลางทางจาก setDateRangeByTyping ที่พังไปครึ่งทาง) — ยังไม่เคยแตะช่วงวันที่ระดับ session
    // สำเร็จสักครั้งในสาขานี้ (fetchOneChunk ครั้งแรกพังตั้งแต่ยังไม่ได้เปลี่ยนอะไร) จึงไม่ต้อง
    // คืนค่าช่วงหลัก — ของเดิมยังอยู่ครบ
    // session อาจค้างที่ช่วงย่อยถ้าการแบ่งช่วงล้มกลางทาง — เปิดใหม่แบบตั้งช่วงหลักคืนถ้าเพี้ยน
    await openWithSessionRange(page, cfg, report.path, mainRange, () =>
      dismissInterstitial(page, report.allowedControls, report.id));
    await waitForReady(page);
    await selectShowNRows(page, report.allowedControls, report.id);
    await waitForReady(page);
    await assertSessionDateRange(page, mainRange);
    const tmpFileName = `${report.id}__tmp.xlsx`;
    const tmpPath = await triggerExportAndCaptureDownload(
      page, report.allowedControls, report.id, report.exportButtonText, cfg.downloadDir, tmpFileName,
    );
    const finalPath = await finalizeFile(tmpPath, stagingDir, period, group, report.id);
    return {
      id: report.id, label: report.label, group, path: report.path, status: 'truncated',
      rowCountReported: showing.total, rowsExported: FOODSTORY_ROW_CAP, files: [finalPath],
      note: `เกินเพดาน ${FOODSTORY_ROW_CAP} แถวจริง (${showing.total}) แต่ไม่มีตัวกรองวันที่ให้ผ่าครึ่ง ` +
        `(${err.message}) ไฟล์นี้มีแค่ส่วนที่มองเห็นได้ ไม่ครบทั้งหมด — ดู ticket 09 §Comments`,
    };
  }

  // 🔴 พังจริง 2026-09-26 (code review ticket 12, §8.5 ของสเปกต้นทาง): เดิมขั้นตอนคืนค่าช่วงหลัก
  // อยู่ *ใน* try/catch เดียวกับการผ่าครึ่งด้านบน — ถ้า `setDateRangeByTyping` ตรงนี้พัง (เช่น
  // ชนจังหวะ reload แบบเดียวกับที่เจอใน waitForReady) จะถูกจับเป็น "ไม่มีตัวกรองวันที่" ผิด ๆ
  // (ทั้งที่ split สำเร็จไปแล้วจริง) แล้วยัง fallback ไป export ซ้ำแบบ truncated ทิ้งผลที่ผ่ามาถูก
  // ต้องแล้วไปเปล่า ๆ — ย้ายออกมานอก catch ให้ error ตรงนี้ throw ตรง ๆ (ถูก per-report catch ใน
  // runFoodStoryExport จับเป็น 'failed' ตามจริง ไม่ใช่ 'truncated' ปลอม ๆ) `setDateRangeByTyping`
  // เองตรวจ header กลับมาให้ตรงกับที่ตั้งไว้อยู่แล้วภายใน (throw ถ้าไม่ตรง) จึงเป็นการยืนยัน
  // ช่วงวันที่ก่อนไปรายงานถัดไปในตัวอยู่แล้ว ไม่ต้องเช็คซ้ำ
  // 🔴 2026-09-28: คืนผ่าน `salebysumdate` (หน้าเบา) แทนหน้ารายงานที่เพิ่งโหลดตาราง 5,000 แถว และถ้ายัง
  // ไม่ติดก็ไม่นับว่ารายงานนี้ล้ม — ไฟล์ทุกส่วนผ่านการตรวจช่วงของตัวเองมาแล้ว และรายงานถัดไปจะตั้ง
  // ช่วงหลักใหม่เองก่อนเริ่ม (`openWithSessionRange`) — เดิม throw ทำให้ไฟล์ที่ถูกต้องถูกนับเป็นล้ม
  let restoreNote: string | null = null;
  try {
    await resetSessionDateRange(page, cfg, mainRange);
  } catch (err) {
    restoreNote = `คืนช่วงหลักหลังแบ่งช่วงไม่สำเร็จ (${(err as Error).message.split('\n')[0]}) — ` +
      'ไฟล์ทุกส่วนตรวจช่วงแล้ว รายงานถัดไปจะตั้งช่วงหลักใหม่เอง';
  }

  const sorted = [...chunks].sort((a, b) => a.range.from.getTime() - b.range.from.getTime());
  const finalPaths: string[] = [];
  for (const [i, chunk] of sorted.entries()) {
    const slug = `${report.id}_part${i + 1}`;
    finalPaths.push(await finalizeFile(chunk.filePath, stagingDir, period, group, slug));
  }
  const rowsExported = sorted.reduce((n, c) => n + c.rowCount, 0);

  return {
    id: report.id, label: report.label, group, path: report.path, status: 'split',
    rowCountReported: showing.total, rowsExported, files: finalPaths, note: restoreNote,
  };
}

export type FoodStoryRunPlan = {
  /** รายงาน DataTables (`Report` shape) ตามลำดับทะเบียน */
  readonly reports: readonly Report[];
  readonly saleByChannel: boolean;
  /** รันหลังสุดเสมอ — ข้าม host แล้วไม่กลับ (ดูหัวไฟล์) */
  readonly reservation: boolean;
  readonly total: number;
};

/** แปลง `--report <id|all>` เป็นแผนของรอบ — id ที่ไม่รู้จักคืน null */
export function planFoodStoryRun(reportId: string): FoodStoryRunPlan | null {
  const many = reportId === ALL_REPORTS;
  const reports = many ? REPORTS : REPORTS.filter((r) => r.id === reportId);
  const saleByChannel = many || reportId === SALEBYCHANNEL_ID;
  const reservation = many || reportId === RESERVATION_ID;
  if (reports.length === 0 && !saleByChannel && !reservation) return null;
  return { reports, saleByChannel, reservation, total: reports.length + Number(saleByChannel) + Number(reservation) };
}

/**
 * "การจองโต๊ะ" (#55) — ใช้ primitives ของ `reservation-report.ts` ตามลำดับที่ยืนยันสดใน ticket 11:
 * คลิก sidebar ข้าม host → ตั้งช่วงวันที่ด้วยปฏิทินคลิก → dropdown ดาวน์โหลด → Excel
 *
 * 🔴 ข้อจำกัดที่รู้ตัว (ticket 11): ไม่เคยมีไฟล์จริงให้ตรวจเลย (บัญชีนี้ไม่มีข้อมูลจองโต๊ะ) จึงไม่มี
 * `expectedColumns`/ไม่อ่านจำนวนแถว และถ้าว่างระบบไม่สร้างไฟล์เลย (ขึ้น toast แทน) — ต่างจาก
 * รายงานอื่นที่ได้ไฟล์ header-only เสมอ · ถ้าวันหนึ่งได้ไฟล์จริง ต้องตรวจเรื่อง page_size=100 ก่อน
 * เชื่อว่าครบ (ดูหัวไฟล์ `reservation-report.ts`)
 */
export async function exportReservationReport(
  page: Page,
  cfg: Config,
  range: DateRange,
  stagingDir: string,
  period: string,
  /** false = อยู่ที่หน้าจองโต๊ะแล้ว (รอบรายวันที่เติมหลายวัน — ข้ามไป manage host ครั้งเดียว ใบ 06) */
  navigate = true,
): Promise<FoodStoryReportResult> {
  const group = groupOf(RESERVATION_ID);
  const path_ = `${RESERVATION_HOST}${RESERVATION_PATH}`;
  if (navigate) await navigateToReservationReport(page, cfg.baseUrl);
  await setReservationDateRange(page, range);
  const outcome = await triggerReservationExcelDownloadAndCapture(page, cfg.downloadDir, `${RESERVATION_ID}__tmp.xlsx`);
  if (outcome.status === 'empty') {
    return {
      id: RESERVATION_ID, label: RESERVATION_LABEL, group, path: path_, status: 'empty',
      rowCountReported: 0, rowsExported: 0, files: [],
      note: 'ไม่มีข้อมูลการจองในช่วงนี้ — หน้านี้ไม่สร้างไฟล์เมื่อว่าง (ขึ้น toast แทน) จึงไม่มีไฟล์ header-only',
    };
  }
  const finalPath = await finalizeFile(outcome.destPath, stagingDir, period, group, RESERVATION_ID);
  return {
    id: RESERVATION_ID, label: RESERVATION_LABEL, group, path: path_, status: 'ok',
    rowCountReported: null, rowsExported: null, files: [finalPath],
    note: '🔴 ไฟล์จองโต๊ะไฟล์แรกที่เคยได้ — ยังไม่มี expectedColumns/ไม่ได้นับแถว และต้องตรวจว่า ' +
      'ไม่ถูกตัดที่ page_size=100 ก่อนเชื่อว่าครบ (ticket 11)',
  };
}

export async function exportSaleByChannel(
  page: Page,
  cfg: Config,
  mainRange: DateRange,
  stagingDir: string,
  period: string,
): Promise<FoodStoryReportResult> {
  const group = groupOf(SALEBYCHANNEL_ID);
  await openWithSessionRange(page, cfg, SALEBYCHANNEL_PATH, mainRange, null);
  await assertSessionDateRange(page, mainRange);
  // downloadSaleByChannel() เรียก dismissInterstitial() เองภายในอยู่แล้ว (พร้อม allowlist ของ
  // มันเอง) — เรียกซ้ำตรงนี้ด้วย allowlist ว่างจะโดน GateError เปล่า ๆ

  const tmpFileName = `${SALEBYCHANNEL_ID}__tmp.csv`;
  const tmpPath = await downloadSaleByChannel(page, cfg.downloadDir, tmpFileName);
  const sheet = await readSaleByChannelCsv(tmpPath);

  const mismatch = SALEBYCHANNEL_COLUMNS.some((c, i) => sheet.header[i] !== c);
  await mkdir(stagingDir, { recursive: true });
  const destPath = path.join(stagingDir, foodstoryFileName('foodstory', period, group, SALEBYCHANNEL_ID, 'csv'));
  await rename(tmpPath, destPath);

  return {
    id: SALEBYCHANNEL_ID, label: SALEBYCHANNEL_LABEL, group, path: SALEBYCHANNEL_PATH,
    status: sheet.rows.length === 0 ? 'empty' : 'ok',
    rowCountReported: null, rowsExported: sheet.rows.length, files: [destPath],
    note: mismatch ? '🔴 header ไม่ตรงกับ EXPECTED_COLUMNS ที่ยืนยันไว้ — รายงานอาจเปลี่ยนโครง' : null,
  };
}

/**
 * เช็คไขว้ยอดขาย (สเปกต้นทาง §8.4) — `salebysumdate` เทียบ `salebymonthsum` ต้องใกล้กัน
 * ยอมรับส่วนต่างได้ถึง ฿5,750 (เคสจริงที่สเปกบันทึกไว้ — ส่วนลด Entertain นับเป็นรายได้ใบหนึ่ง
 * ไม่นับอีกใบ ไม่ใช่บั๊ก) เกินกว่านี้ถึงจะ flag ว่าน่าสงสัย
 */
const CROSS_CHECK_TOLERANCE_THB = 5_750;

const NET_SALES_COLUMN = 'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี';

/** ยืนยันจริง 2026-09-26: คอลัมน์ "เดือน" ของ salebymonthsum เก็บชื่อเดือนเต็มภาษาไทย
 * ("สิงหาคม" ไม่ใช่ "08" หรือ "8") — ต้องแปลงเลขเดือนเป็นชื่อไทยก่อนหาแถวที่ตรงกัน */
const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function sumColumn(sheet: { readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] }, columnName: string): number {
  const idx = sheet.header.indexOf(columnName);
  if (idx < 0) return NaN;
  return sheet.rows.reduce((n, row) => n + (Number((row[idx] ?? '0').replaceAll(',', '')) || 0), 0);
}

/** หาแถวของเดือนเป้าหมายใน salebymonthsum แล้วอ่านค่ายอดขายสุทธิของแถวนั้นเดียว (ไม่ใช่รวมทั้งไฟล์
 * — ไฟล์นี้มีหนึ่งแถวต่อเดือน ครอบทั้งปีถึงเดือนปัจจุบัน ไม่ใช่แค่เดือนที่รันรอบนี้) */
function monthTotal(sheet: { readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] }, monthIndex0: number): number {
  const monthColIdx = sheet.header.indexOf('เดือน');
  const totalColIdx = sheet.header.indexOf(NET_SALES_COLUMN);
  if (monthColIdx < 0 || totalColIdx < 0) return NaN;
  const monthName = THAI_MONTH_NAMES[monthIndex0];
  const row = sheet.rows.find((r) => r[monthColIdx] === monthName);
  if (!row) return NaN;
  return Number((row[totalColIdx] ?? '0').replaceAll(',', '')) || 0;
}

export function crossCheckSales(
  mainRange: DateRange,
  salebysumdateSheet: ReturnType<typeof readFoodStorySheet> | null,
  salebymonthsumSheet: ReturnType<typeof readFoodStorySheet> | null,
): { readonly ok: boolean; readonly note: string } | null {
  if (!salebysumdateSheet || !salebymonthsumSheet) return null;
  const sumdateTotal = sumColumn(salebysumdateSheet, NET_SALES_COLUMN);
  const monthsumTotal = monthTotal(salebymonthsumSheet, mainRange.from.getUTCMonth());
  if (Number.isNaN(sumdateTotal) || Number.isNaN(monthsumTotal)) {
    return { ok: false, note: 'หาคอลัมน์/แถวเดือนที่ตรงกันไม่เจอในไฟล์ใดไฟล์หนึ่ง — ตรวจด้วยมือ' };
  }
  const diff = Math.abs(sumdateTotal - monthsumTotal);
  const ok = diff <= CROSS_CHECK_TOLERANCE_THB;
  return {
    ok,
    note: `salebysumdate=${sumdateTotal.toFixed(2)} salebymonthsum=${monthsumTotal.toFixed(2)} ` +
      `ส่วนต่าง=${diff.toFixed(2)} (เพดานที่ยอมรับ ${CROSS_CHECK_TOLERANCE_THB})`,
  };
}

const SESSION_CLOSE_TIMEOUT_MS = 30_000;

/**
 * ปิด session พร้อมกันเวลา — 🔴 พังจริง 2026-09-26: รอบแรกที่ทดสอบ runner นี้ทั้งก้อน setup
 * phase (login/ตั้งช่วงวันที่) พังกลางทางแบบไม่รู้สาเหตุ แล้ว `session.close()` ค้างต่อไปเรื่อย ๆ
 * ไม่มีวันจบ (สังเกตจาก process ยัง alive อยู่ 2 ชม.กว่า ไม่มี error พิมพ์ออกมาเลย, ไม่มีไฟล์
 * output เลยสักไฟล์) — Playwright's `browser.close()` ค้างได้จริงถ้า browser process ไม่ตอบสนอง
 * ใส่ timeout กันไว้ไม่ให้กระบวนการทั้งหมดค้างตายแบบเงียบ ๆ อีก
 */
export async function closeSessionWithTimeout(session: Session): Promise<void> {
  await Promise.race([
    session.close(),
    new Promise<void>((resolve) => setTimeout(resolve, SESSION_CLOSE_TIMEOUT_MS)),
  ]);
}

export async function runFoodStoryExport(opts: FoodStoryExportOptions): Promise<number> {
  // 🔴 พังจริง 2026-09-26 (code review ticket 12): เดิมไม่มี redactor เลย ทั้งที่เรียก login()
  // ตรงเดียวกับที่ HotelTime กัน password หลุดลง error message ไว้ — เริ่มด้วย no-op เผื่อ
  // loadCredentials() เองพังก่อนที่จะรู้ว่าอะไรต้อง redact (ตาม pattern เดียวกับ
  // hoteltime/export.ts::runExport)
  // รอบรายวันใช้ตัววางแผน (ADR-0008/0009, ใบ 06) — เติมวันที่ขาดใน login เดียว · รอบรายเดือนคงเดิม
  if (opts.daily) return runFoodStoryDaily(opts);
  let redact: Redactor = createRedactor([]);
  try {
    const cfg = loadConfig();
    const creds = loadCredentials();
    redact = createRedactor([creds.password, creds.email]);

    if ((opts.from === undefined) !== (opts.to === undefined)) {
      console.error('--from และ --to ต้องระบุมาด้วยกันทั้งคู่ หรือไม่ระบุเลยทั้งคู่ (ใช้เดือนที่แล้ว)');
      return 1;
    }

    const today = thaiToday(); // เวลาไทย (ticket 27) — เดิมใช้ UTC: ตี 0–7 ของวันที่ 1 จะได้เดือนก่อนหน้าผิดไปหนึ่งเดือน
    const runWindow = foodstoryWindow({
      daily: opts.daily,
      ...(opts.from && opts.to ? { from: parseDMYOrThrow(opts.from), to: parseDMYOrThrow(opts.to) } : {}),
    }, today);
    const { range, label: period } = runWindow;
    const startedAt = new Date();
    const outDir = runWindow.kind === 'daily'
      // รอบรายวัน (ticket 10): daily/<YYYY-MM>/<เมื่อวาน>/ — รันซ้ำวันเดียวกันใช้โฟลเดอร์เดิม รวมผล แทนเฉพาะใบที่ผ่าน
      ? dailyFolder(cfg.dataDir, 'foodstory', range)
      : await monthlyOutDir(cfg.dataDir, period, startedAt);
    // ดาวน์โหลดลงที่พักแยกใบก่อน ย้ายเข้าคลังเมื่อผ่านเท่านั้น (publishReport)
    const stagingOf = (reportId: string) => path.join(cfg.downloadDir, reportId);

    const plan = planFoodStoryRun(opts.reportId);
    if (!plan) {
      console.error(`ไม่รู้จักรายงาน "${opts.reportId}"`);
      return 1;
    }
    const reportList = plan.reports;

    const session: Session = await openSession({
      ...cfg,
      headless: opts.headful ? false : cfg.headless,
      slowMoMs: opts.slowMoMs ?? cfg.slowMoMs,
    });
    const { page } = session;

    // ลองใหม่บน page เดิมที่ล็อกอินค้างไว้ — ไม่ล็อกอินใหม่ เพราะ login ใหม่ต้องแก้ captcha อีกรอบ (เสีย
    // เครดิต 2captcha หรือต้องมีคน — ADR-0010) · page ตาย
    // แล้วไม่ลองซ้ำ (isTransientOnSamePage) ไม่งั้นทุกใบที่เหลือจะรอเปล่า ๆ ใบละ 90 วินาที
    const retryOnSamePage = <T>(task: () => Promise<T>, label: string) =>
      withBrowserRetry(task, {
        label,
        describe: (err) => redactError(err, redact),
        isRetryable: isTransientOnSamePage,
        ...(opts.json ? {} : { log: (line: string) => console.log(line) }),
      });

    // ผ่าน → ย้ายเข้าคลัง (แทนไฟล์เก่าของใบนี้) · ล้ม รวมถึงย้ายไม่สำเร็จ → ผลแบบ failed โดยไม่แตะคลัง
    type Identity = Pick<FoodStoryReportResult, 'id' | 'label' | 'group' | 'path'>;
    const settle = async (outcome: Attempted<FoodStoryReportResult>, who: Identity): Promise<FoodStoryReportResult> => {
      try {
        if (!outcome.ok) throw outcome.error;
        return await publishReport({ ...outcome.value, attempts: outcome.attempts }, outDir, period);
      } catch (err) {
        return {
          ...who, status: 'failed', rowCountReported: null, rowsExported: null, files: [],
          note: redactError(err, redact), attempts: outcome.attempts,
        };
      }
    };
    const results: FoodStoryReportResult[] = [];
    const logLast = () => {
      if (opts.json) return;
      const r = results[results.length - 1]!;
      const tail = r.status === 'failed' ? r.note : `${String(r.rowsExported ?? '-').padStart(6)} แถว`;
      console.log(`[${results.length}/${plan.total}] ${r.status.padEnd(10)} ${r.id.padEnd(24)} ${tail}`);
    };
    const sheetById = new Map<string, ReturnType<typeof readFoodStorySheet>>();

    try {
      await login(session, cfg, creds);
      if (!opts.json) console.log(`✔ login สำเร็จ — เริ่มตั้งช่วงวันที่ (${formatDMY(range.from)} → ${formatDMY(range.to)})`);

      // ตั้งช่วงวันที่ระดับ session ครั้งเดียวก่อนวนลูป (สเปกต้นทาง §4.2) — ไปหน้าที่มีตัวกรองจริง
      // ก่อน (salebysumdate) แม้จะไม่ได้อยู่ใน reportList (กรณีรันรายงานเดียวที่ไม่ใช่ตัวนี้) · รัน
      // reservation-report อย่างเดียวไม่ต้องตั้ง — หน้านั้นใช้ปฏิทินของตัวเอง ไม่ใช่ session range
      if (reportList.length > 0 || plan.saleByChannel) {
        await resetSessionDateRange(page, cfg, range);
        if (!opts.json) console.log('✔ ตั้งช่วงวันที่ระดับ session สำเร็จ — เริ่มวนลูปรายงาน\n');
      }

      for (const report of reportList) {
        const outcome = await retryOnSamePage(() => exportOneReport(page, cfg, report, range, stagingOf(report.id), period), report.id);
        results.push(await settle(outcome, { id: report.id, label: report.label, group: groupOf(report.id), path: report.path }));
        const result = results[results.length - 1]!;
        if ((report.id === 'salebysumdate' || report.id === 'salebymonthsum') && result.files[0]) {
          try {
            sheetById.set(report.id, readFoodStorySheet(result.files[0], report));
          } catch (err) {
            // อ่านไฟล์ที่ย้ายเข้าคลังแล้วไม่ได้ = ใช้ไม่ได้ ถือว่าใบนี้ล้ม (ไฟล์ยังอยู่ให้คนตรวจ)
            results[results.length - 1] = { ...result, status: 'failed', note: redactError(err, redact) };
          }
        }
        logLast();
      }

      if (plan.saleByChannel) {
        const outcome = await retryOnSamePage(() => exportSaleByChannel(page, cfg, range, stagingOf(SALEBYCHANNEL_ID), period), SALEBYCHANNEL_ID);
        results.push(await settle(outcome, {
          id: SALEBYCHANNEL_ID, label: SALEBYCHANNEL_LABEL, group: groupOf(SALEBYCHANNEL_ID), path: SALEBYCHANNEL_PATH,
        }));
        logLast();
      }

      // ต้องเป็นใบสุดท้ายเสมอ — คลิก sidebar ข้ามไป manage.foodstory.co แล้วไม่กลับมา owner อีก
      if (plan.reservation) {
        const outcome = await retryOnSamePage(() => exportReservationReport(page, cfg, range, stagingOf(RESERVATION_ID), period), RESERVATION_ID);
        results.push(await settle(outcome, {
          id: RESERVATION_ID, label: RESERVATION_LABEL, group: groupOf(RESERVATION_ID), path: `${RESERVATION_HOST}${RESERVATION_PATH}`,
        }));
        logLast();
      }
    } finally {
      await closeSessionWithTimeout(session);
    }

    return finishRun(opts, cfg, runWindow, outDir, startedAt, results, sheetById);
  } catch (err) {
    const text = redactError(err, redact);
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, code: 'export_failed', text }, null, 2));
    } else {
      console.error(`✘ ไม่สำเร็จ\n${text}`);
    }
    return 1;
  }
}

/**
 * คลังผลลัพธ์ (ADR-0005, ticket 03): รอบแรกของเดือนได้ monthly/<YYYY-MM>/ · ดึงซ้ำวันอื่นได้โฟลเดอร์ที่มีวันที่ดึง ไม่เขียนทับ
 * · `_run.json` เสียอ่านไม่ได้ = ไม่รู้ว่ารอบแรกเมื่อไหร่ → ได้โฟลเดอร์ที่มีวันที่ดึง (ไม่แตะโฟลเดอร์นั้น) แทนการล้มทั้งรอบก่อน login
 */
async function monthlyOutDir(dataDir: string, period: string, startedAt: Date): Promise<string> {
  const root = monthlyRoot(dataDir, 'foodstory');
  const existing = await readdir(root).catch(() => [] as string[]);
  const firstRun = (await readRunRecord(path.join(root, period)).catch(() => null))?.runs[0]?.startedAt;
  return monthlyFolder(dataDir, 'foodstory', period, startedAt, existing, firstRun ? new Date(firstRun) : null);
}

async function finishRun(
  opts: FoodStoryExportOptions,
  cfg: Config,
  runWindow: FoodStoryWindow,
  outDir: string,
  startedAt: Date,
  results: FoodStoryReportResult[],
  sheetById: Map<string, ReturnType<typeof readFoodStorySheet>>,
): Promise<number> {
  const { kind, range, label: period } = runWindow;
  // รอบรายวันข้ามการเช็คไขว้ (ticket 10): เทียบยอดรวมทั้งเดือนของ salebymonthsum กับผลรวมรายวัน — วันเดียวเทียบกับทั้งเดือนไม่ได้
  const crossCheckSkipped = kind === 'daily' ? DAILY_CROSS_CHECK_SKIPPED : undefined;
  const crossCheck = crossCheckSkipped ? null : crossCheckSales(
    range,
    sheetById.get('salebysumdate') ?? null,
    sheetById.get('salebymonthsum') ?? null,
  );

  // `_` นำหน้าให้แยกกลุ่มจากไฟล์รายงาน (ไฟล์ xlsx ของ FoodStory คือไฟล์ข้อมูลเลย ไม่มี CSV แยก)
  const manifestPath = path.join(outDir, '_manifest.json');
  const previous = await readFile(manifestPath, 'utf8').then((t) => JSON.parse(t) as FoodStoryManifest, () => null);
  const merged = mergeManifest(previous, {
    period, branch: cfg.branchName, runStartedUtc: startedAt.toISOString(),
    requestedRange: { from: formatISO(range.from), to: formatISO(range.to) },
    reports: results.map(withSheetNames), crossCheck, spotCheckWarnings: [], ...(crossCheckSkipped ? { crossCheckSkipped } : {}),
  });
  const manifest: FoodStoryManifest = { ...merged, spotCheckWarnings: spotCheckCoreReports(merged.reports) };
  const { spotCheckWarnings } = manifest;
  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const outcomes = toReportOutcomes(results, range, (f) => createHash('sha256').update(readFileSync(f)).digest('hex'));
  await recordRun(outDir, {
    site: 'foodstory',
    kind,
    dataThrough: formatISO(range.to),
    startedAt,
    finishedAt: new Date(),
    outcomes,
    // daily/latest ชี้รอบรายวันล่าสุดที่ผ่านอย่างน้อยหนึ่งใบ แบบเดียวกับ HotelTime
    ...(kind === 'daily' ? { latest: latestPointer(cfg.dataDir, 'foodstory', 'daily') } : {}),
  });

  const failed = results.filter((r) => r.status === 'failed');
  const truncated = results.filter((r) => r.status === 'truncated');

  if (opts.json) {
    // outDir: ดึงเดือนเดิมซ้ำได้โฟลเดอร์ที่มีวันที่ดึง ผู้เรียกเดาเองไม่ได้ (ticket 03) · ok ตรงกับ exit code 0 (truncated = ล้ม)
    console.log(JSON.stringify({ ok: exitCodeFor(outcomes) === 0, outDir, manifest }, null, 2));
  } else {
    console.log(`ช่วง: ${formatDMY(range.from)} → ${formatDMY(range.to)} (${period})`);
    for (const r of results) {
      const marker = r.status === 'ok' ? '✔' : r.status === 'empty' ? '·' : r.status === 'split' ? '⚡' : r.status === 'truncated' ? '⚠' : '✘';
      console.log(`  ${marker} ${r.id.padEnd(24)} ${r.status.padEnd(10)} ${String(r.rowsExported ?? '-').padStart(6)} แถว`);
    }
    console.log(`สำเร็จ ${results.length - failed.length}/${results.length} — ล้ม ${failed.length} — ถูกตัด ${truncated.length}`);
    if (crossCheck) console.log(`เช็คไขว้ยอดขาย: ${crossCheck.ok ? 'ผ่าน' : '⚠ น่าสงสัย'} — ${crossCheck.note}`);
    if (crossCheckSkipped) console.log(`เช็คไขว้ยอดขาย: ข้าม — ${crossCheckSkipped}`);
    for (const w of spotCheckWarnings) console.log(w);
  }

  // 0 = ผ่านหมด · 2 = ผ่านบางใบ · 1 = ไม่ได้อะไรเลย (เหมือน HotelTime) — truncated นับเป็นล้มแล้ว (ข้อมูลไม่ครบ)
  if (!opts.json) console.log(`ไฟล์อยู่ที่ ${path.relative(cfg.dataDir, outDir)}/ (สรุปใน _summary.txt)`);
  return exitCodeFor(outcomes);
}

function parseDMYOrThrow(s: string): Date {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) throw new Error(`รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น DD/MM/YYYY) — ได้มา "${s}"`);
  return utcDate(Number(m[3]), Number(m[2]), Number(m[1]));
}
