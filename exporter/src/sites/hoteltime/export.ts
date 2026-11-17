import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import type { Page } from 'playwright';
import {
  OrderError,
  assertContiguous,
  formatDMY,
  formatISO,
  monthChunks,
  partitionForRunAll,
  resolveRunPlan,
  parseISODate,
  splitRange,
  type DateRange,
  type RunKind,
} from '../../core/order.ts';
import { dailyFolder, dataFileName, latestPointer, pictureFileName, runFolder } from '../../core/placement.ts';
import { publishRawFiles, recordPublished, type RawFileEntry } from '../../core/raw-manifest.ts';
import { withBrowserRetry } from '../../core/retry.ts';
import { thaiIsoString, thaiToday } from '../../core/thai-time.ts';
import { exitCodeFor, readRunRecord, recordRun, type ReportOutcome, type SkippedReport } from '../../core/run-record.ts';
import {
  PlanError, gateRound, isRoundHour, planRound, redoId, roundId, ROUND_HOURS, ROUND_WINDOW, SNAPSHOT_SLOTS, SLOT_WINDOW, daysToRead, isSnapshotSlot, periodCloseId, planBaselineRun, planDailyRun, planSnapshotSlot, refreshId, planDateRun, planWarnings,
  slotRefreshId, storeStateFrom, type WorkPlan,
} from '../../core/run-planner.ts';
import { createRedactor, redactError, type Redactor } from '../../core/redact.ts';
import { verifyMerged, type ChunkVerdict } from '../../core/verify.ts';
import {
  ConfigError,
  loadConfig,
  loadCredentials,
  type Config,
  type Credentials,
} from './config.ts';
import { login, openSession, type Session } from './session.ts';
import { RowCapError, verifyChunk } from './verify.ts';
import {
  assertFormAccepted,
  clickAndSettle,
  downloadExport,
  readGridText,
} from './webforms.ts';
import { DAY_MINUTES, fetchSplitTable, type WindowFetcher } from '../../core/scraped-split.ts';
import { ScrapeError, scrapedTableToRawFile } from '../../core/scraped-table.ts';
import { REPORTS, findReport, reportIds, toPlanned } from './reports/index.ts';
import type { Report } from './reports/_types.ts';

export type ExportOptions = {
  readonly reportId: string;
  readonly from: string | undefined;
  readonly to: string | undefined;
  /** ดึงย้อนหลัง N วันจากวันนี้ — ใช้คู่กับ `from`/`to` ไม่ได้ (ดู `resolveRunPlan`) */
  readonly lastDays: number | undefined;
  /** โหมดรอบรายวัน — ใช้คู่กับ from/to/lastDays ไม่ได้ (ดู `resolveRunPlan`) */
  readonly daily: boolean;
  /** `--date YYYY-MM-DD`: ดึงวันของข้อมูลวันเดียวใหม่ (รายงานตามวันเท่านั้น) — ใช้คู่กับโหมดอื่นไม่ได้ */
  readonly date: string | undefined;
  /** โหมด baseline — ใช้คู่กับ from/to/lastDays ไม่ได้ (ดู `resolveRunPlan`) */
  readonly baseline: boolean;
  readonly baselineIntervalDays: number | undefined;
  readonly headful: boolean;
  /** หน่วงทุก action (ms) ให้คนดูทันตอน --headful · undefined = ใช้ค่าจาก .env */
  readonly slowMoMs: number | undefined;
  readonly json: boolean;
  /**
   * `--snapshot-slot 06|23`: an extra snapshot-only round (ADR-0013) — takes the snapshot reports again and nothing else (no per-day reports, no back-fill,
   * no period-close); cannot be combined with any other mode. Optional so existing callers need not set it.
   */
  readonly snapshotSlot?: string | undefined;
  /** `--round HH`: one extraction round (ADR-0014) — snapshot set + today's per-day + redo of yesterday at 08/12 + capped catch-up · cannot be combined with other modes */
  readonly round?: string | undefined;
};

/**
 * ค่าพิเศษของ `--report` ที่หมายถึง "ทุกรายงานในทะเบียน เรียงตามลำดับใน REPORTS"
 *
 * ไม่ใช่ id ของรายงานจริง จึงต้องเช็คก่อน `findReport()` เสมอ · แต่ละรายงานยังเปิด session
 * ของตัวเองเหมือนเดิม ไม่ได้ใช้ session ร่วมกัน เพราะการแทนไฟล์ของรายงานในโฟลเดอร์รอบต้องแยกกันอยู่แล้ว การรวม session จะได้ความเร็วแต่แลกกับความเสี่ยง
 * ที่รายงานหนึ่งพาอีกสองรายงานล้มไปด้วย
 */
export const ALL_REPORTS = 'all';

/** payload ของการดึงรายงานเดียว — ใช้ทั้งตอนพิมพ์ JSON เดี่ยวและตอนรวมหลายรายงาน */
export type ExportPayload = {
  readonly report: string;
  readonly runKind: RunKind;
  readonly range: { readonly from: string; readonly to: string };
  readonly chunks: { readonly total: number; readonly withData: number; readonly empty: number };
  readonly totalRows: number;
  /** ช่วงวันที่ที่พบจริงในข้อมูล · null = ไม่มีแถวเลย */
  readonly actualRange: { readonly from: string; readonly to: string } | null;
  /** ไฟล์ดิบที่วางในโฟลเดอร์รอบแล้ว (ADR-0007) พร้อมที่มา — รายการเดียวกับที่บันทึกใน `_manifest.json` */
  readonly files: readonly RawFileEntry[];
};

type ChunkOutcome =
  | {
      readonly kind: 'data';
      readonly verdict: ChunkVerdict;
      /** ชื่อไฟล์ที่ HotelTime เสนอมา เก็บไว้เป็นหลักฐานที่มา */
      readonly sourceName: string;
      readonly sha256: string;
      readonly bytes: number;
      /** เวลาที่ได้ไฟล์มา — เวลาที่ถ่ายของรายงาน snapshot */
      readonly fetchedAt: Date;
    }
  | { readonly kind: 'empty'; readonly range: DateRange };

type DataOutcome = Extract<ChunkOutcome, { kind: 'data' }>;

const isData = (o: ChunkOutcome): o is DataOutcome => o.kind === 'data';

function chunkFileName(range: DateRange, ext = 'xlsx'): string {
  return `${formatISO(range.from)}_${formatISO(range.to)}.${ext}`;
}

/**
 * ดึงหนึ่งก้อน
 *
 * ลำดับของด่านตรงนี้สำคัญและห้ามสลับ:
 *   applyFilters → Search → ตรวจว่าฟอร์มไม่ถูกปฏิเสธ → ตรวจว่ามีผลลัพธ์ → ค่อย export
 * ข้ามด่านไหนก็ได้ไฟล์ที่ "ดูปกติแต่ผิด" ทั้งนั้น เหตุผลของแต่ละด่านอยู่ใน webforms.ts
 */
async function fetchChunk(
  session: Session,
  cfg: Config,
  report: Report,
  range: DateRange,
  chunkDir: string,
): Promise<ChunkOutcome> {
  const { page } = session;

  await page.goto(new URL(report.path, `${cfg.baseUrl}/pms/`).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  await report.applyFilters(page, range);
  await clickAndSettle(page, report.searchButton, cfg.timeoutMs, report.allowedControls, report.id);
  await assertFormAccepted(page);

  // หน้าที่ไม่มีปุ่ม export: อ่านตารางแล้วเขียนไฟล์ดิบแบบ scrape เอง (ADR-0012) — ผลว่าง (0 แถว) ล้มเอง ไม่ใช่ "ว่าง"
  if (report.scrape !== undefined) return fetchScraped(session, cfg, report, range, chunkDir);

  // ต้องเช็คก่อน export เสมอ — ผลว่างจะไม่มีไฟล์ส่งมาเลย ได้แค่ timeout
  if (!(await report.hasResults(page))) {
    return { kind: 'empty', range };
  }

  const reportedRowCount = await report.expectedRowCount(page);
  const dest = path.join(chunkDir, chunkFileName(range));
  const { suggestedFilename } = await downloadExport(page, dest, cfg.timeoutMs, report.exportLink);

  // คิด checksum จากไบต์ที่ได้มาก่อนแตะอะไรทั้งสิ้น — เป็นหลักฐานว่าไฟล์ที่เก็บไว้
  // คือไฟล์เดียวกับที่ HotelTime ส่งมาจริง
  const bytes = await readFile(dest);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fetchedAt = new Date();

  return {
    kind: 'data',
    verdict: verifyChunk(report, range, dest, reportedRowCount),
    sourceName: suggestedFilename,
    sha256,
    bytes: bytes.byteLength,
    fetchedAt,
  };
}

/**
 * หน้าที่ไม่มีปุ่ม export (`Report.scrape`) — อ่านตารางผลลัพธ์ → ด่านความครบ (`scrapedTableToRawFile`) → เขียน CSV ลงที่พัก · ข้อมูลทั้งวันก้อนเดียว
 * (ชนเพดานแถว → แบ่งช่วงเวลา ticket 04 · รายงานที่ไม่มี `applyWindow` = ล้ม) · วันของข้อมูลคือวันเดียวของ `range`
 */
async function fetchScraped(session: Session, cfg: Config, report: Report, range: DateRange, chunkDir: string): Promise<ChunkOutcome> {
  const { page } = session;
  const scrape = report.scrape!;
  const read = async (): Promise<string[][]> => {
    const t = await readGridText(page, scrape.gridIdPart);
    if (t === null) throw new ScrapeError(`ไม่พบตารางผลลัพธ์ (id มี "${scrape.gridIdPart}") — หน้าเว็บน่าจะเปลี่ยนโครงสร้าง`);
    return t;
  };
  const wholeDay = await read(); // ฟิลเตอร์ทั้งวันถูกตั้งและกด Search แล้วโดย fetchChunk
  const fetchWindow: WindowFetcher = async (start, end) => {
    if (start === 0 && end === DAY_MINUTES) return wholeDay;
    await scrape.applyWindow!(page, range.from, start, end);
    await clickAndSettle(page, report.searchButton, cfg.timeoutMs, report.allowedControls, report.id);
    await assertFormAccepted(page);
    return read();
  };
  // รายงานที่แบ่งช่วงได้ (มี applyWindow): ชนเพดาน → แบ่งแล้วรวม · แต่ละช่วงผ่านด่านเพดานของตัวเองแล้ว จึงไม่ตรวจเพดานซ้ำกับตารางรวม
  // รายงานที่แบ่งไม่ได้: ใช้ตารางทั้งวัน ชนเพดาน = ล้มที่ scrapedTableToRawFile
  const split = scrape.applyWindow !== undefined;
  const table = split
    ? await fetchSplitTable({ fetchWindow, expectedHeader: report.expectedColumns, dateColumn: report.dateColumn, rowCap: scrape.rowCap })
    : wholeDay;
  const file = scrapedTableToRawFile(table, {
    expectedHeader: report.expectedColumns, rowCap: split ? Infinity : scrape.rowCap, dateColumn: report.dateColumn, day: formatISO(range.from),
  });
  const dest = path.join(chunkDir, chunkFileName(range, 'csv'));
  const bytes = Buffer.from(file.csv, 'utf8');
  await writeFile(dest, bytes);
  return {
    kind: 'data',
    verdict: {
      range, filePath: dest, rowCount: file.rowCount,
      sheets: [{ name: 'scrape', header: table[0] ?? [], rows: [] }],
      actualSpan: { from: range.from, to: range.to },
    },
    sourceName: `scrape:${scrape.gridIdPart}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    fetchedAt: new Date(),
  };
}

/**
 * ทำงานทีละก้อนแบบมีคิว — ก้อนที่ชนเพดานจะถูกผ่าครึ่งแล้วใส่กลับเข้าคิว
 * ทำซ้ำจนทุกก้อนต่ำกว่าเพดาน
 */
async function fetchAll(
  session: Session,
  cfg: Config,
  report: Report,
  chunks: readonly DateRange[],
  chunkDir: string,
  log: (line: string) => void,
): Promise<ChunkOutcome[]> {
  const queue = [...chunks].sort((a, b) => a.from.getTime() - b.from.getTime());
  const done: ChunkOutcome[] = [];

  while (queue.length > 0) {
    const range = queue.shift()!;
    const label = `${formatDMY(range.from)}–${formatDMY(range.to)}`;

    try {
      const outcome = await fetchChunk(session, cfg, report, range, chunkDir);
      if (outcome.kind === 'empty') {
        log(`  ${label}  ${chalk.dim('ว่าง — ข้าม')}`);
      } else {
        log(`  ${label}  ${String(outcome.verdict.rowCount).padStart(5)} แถว`);
      }
      done.push(outcome);
    } catch (err) {
      if (!(err instanceof RowCapError)) throw err;

      const halves = splitRange(range);
      if (halves === null) {
        throw new RowCapError(
          `ช่วง ${label} เหลือวันเดียวแล้วแต่ยังชนเพดาน ${'2000'} แถว\n` +
            `  ดึงข้อมูลวันนี้ให้ครบด้วยเครื่องมือนี้ไม่ได้ ต้องเรียกคนมาตัดสินใจ`,
        );
      }
      log(`  ${label}  ${chalk.yellow('ชนเพดาน — ผ่าครึ่งแล้วลองใหม่')}`);
      queue.unshift(...halves);
    }
  }

  return done;
}


/**
 * รายงานที่ตัวกรองไม่ใช่ created date ตรง ๆ — คำอธิบายไว้ที่เดียว ไม่ต้องไล่หาความหมายจาก id
 */
const NON_CREATED_DATE_FILTER_NOTES: Readonly<Record<string, string>> = {
  'reservations-cancelled': 'ใบนี้ไม่มี created date จึงกรองด้วยวันที่ยกเลิก (เจ้าของตัดสิน 2026-09-08)',
  // 🔴 ต่างจากกรณีอื่นในตารางนี้ตรงที่ "Arrival" แก้ไขได้ในอนาคต (แขกเลื่อนวันเข้าพักได้ก่อนถึงวันจริง)
  // ไม่ใช่แค่ "อดีตล้วนแต่มองไม่เห็นการแก้" แบบที่ ADR-0002 คุยไว้ — ตัวกรองเองเปลี่ยนความหมายได้
  'arrival-period': 'กรองด้วยวันเข้าพัก (Arrival) ไม่ใช่ created date — และ Arrival แก้ไขได้ในอนาคต',
};

function filterNoteFor(report: Report): string {
  if (report.filterNote !== undefined) return report.filterNote;
  if (report.dailyOnly) return 'รายงาน dailyOnly — กรองด้วยวันปฏิบัติการ ไม่ใช่ created date (ดู ADR-0003)';
  return NON_CREATED_DATE_FILTER_NOTES[report.id] ?? 'กรองด้วย created date';
}

/** ช่วงวันของข้อมูลของไฟล์หนึ่ง — รายงานภาพรวมที่ค้นช่วงอื่น (`dataWindow`) ใช้ช่วงข้อมูลจริง ไม่ใช่วันที่ค้น */
function dataRangeOf(report: Report, chunk: DateRange): DateRange {
  return report.dataWindow ? report.dataWindow(chunk.from) : chunk;
}

/**
 * ชื่อไฟล์ ISO ของไฟล์ดิบหนึ่งไฟล์ — รายงาน snapshot ใช้เวลาที่ถ่าย รายงานตามวันใช้ช่วงวันของข้อมูล (ADR-0008) · **snapshot ปิดงวด** ใช้ช่วงของงวด
 * (`2026-09-01--2026-09-30__<id>.xlsx`) — ไม่ชนกับ snapshot ปกติในโฟลเดอร์เดียวกันซึ่งใช้เวลาที่ถ่าย
 */
function rawFileName(report: Report, o: DataOutcome, periodClose: boolean): string {
  const ext = report.scrape !== undefined ? 'csv' : 'xlsx'; // ไฟล์ดิบแบบ scrape (ADR-0012) เป็น CSV
  return report.family === 'picture' && !periodClose
    ? pictureFileName('hoteltime', o.fetchedAt, report.id, ext)
    : dataFileName('hoteltime', dataRangeOf(report, o.verdict.range), report.id, ext);
}

/**
 * ช่วงวันที่ที่พบจริงในไฟล์ (รวมทุกก้อนที่ให้มา) · null = ไม่มีแถว หรือรายงานที่ข้ามด่านวันที่ (actualSpan = ช่วงที่สั่ง ไม่ใช่ที่วัดได้
 * — อย่าบันทึกว่าเป็นช่วงที่พบจริง)
 */
function measuredRange(report: Report, verdicts: readonly ChunkVerdict[]): { from: string; to: string } | null {
  if (verdicts.length === 0 || report.skipDateCoverageCheck) return null;
  return {
    from: formatISO(new Date(verdicts.reduce((a, v) => Math.min(a, v.actualSpan.from.getTime()), Infinity))),
    to: formatISO(new Date(verdicts.reduce((a, v) => Math.max(a, v.actualSpan.to.getTime()), -Infinity))),
  };
}

/**
 * รายการ `_manifest.json` ของไฟล์ดิบแต่ละไฟล์ — ทำให้ไฟล์ดิบใช้เป็น source of truth ได้จริง เพราะตอบได้ว่ามาจากหน้าไหน กรองด้วยแกนวันที่อะไร
 * ครอบวันไหน ได้เมื่อไหร่ กี่แถว กี่ชีต และไบต์ยังเหมือนตอนดาวน์โหลดไหม (sha256)
 */
function manifestEntryFor(report: Report, cfg: Config, o: DataOutcome, job: ReportJob): RawFileEntry {
  const { runKind, baselineIntervalDays, periodClose } = job;
  const range = dataRangeOf(report, o.verdict.range);
  return {
    file: rawFileName(report, o, periodClose),
    site: 'hoteltime',
    report: report.id,
    label: report.label,
    family: report.family,
    runKind,
    range: { from: formatISO(range.from), to: formatISO(range.to) },
    actualRange: measuredRange(report, [o.verdict]),
    takenAt: thaiIsoString(o.fetchedAt),
    rows: o.verdict.rowCount,
    sheets: o.verdict.sheets.map((sh) => sh.name),
    bytes: o.bytes,
    sha256: o.sha256,
    source: new URL(report.path, `${cfg.baseUrl}/pms/`).toString(),
    sourceName: o.sourceName,
    filterColumn: report.dateColumn,
    filterNote: filterNoteFor(report),
    ...(baselineIntervalDays !== undefined ? { baselineIntervalDays } : {}),
    ...(periodClose ? { periodClose: true } : {}),
    ...(report.scrape !== undefined ? { provenance: 'scrape' as const } : {}),
  };
}

/** งานของรายงานหนึ่งในรอบนี้ — ช่วงที่ขอและชนิดรอบ ตัดสินโดยผู้เรียก (ตัววางแผนของรอบรายวัน หรือ flag ของรอบอื่น) */
type ReportJob = {
  readonly range: DateRange;
  readonly runKind: RunKind;
  readonly baselineIntervalDays: number | undefined;
  /** snapshot ปิดงวด (ใบ 05): ชื่อไฟล์เป็นช่วงของงวด และบันทึกผลด้วย id `<รายงาน>@period-close` */
  readonly periodClose: boolean;
  /** id ที่บันทึกใน `_run.json` แทน id ของรายงาน — baseline (ใบ 09) มีหลายวันของรายงานเดียวในโฟลเดอร์เดียว: `<รายงาน>@<วันของข้อมูล>` */
  readonly recordId?: string;
};

/**
 * งานของ back-fill (`--from`/`--to`, `--last-days` — baseline แยกไปที่ `runBaseline`) · รายงาน dailyOnly (ADR-0003) ดึงหลายวันในรอบเดียวไม่ได้
 * — สั่งตรง ๆ โดยไม่ใส่ `--daily` ล้มดัง ๆ (`--report all` ข้ามให้ก่อนถึงตรงนี้แล้ว ดู `partitionForRunAll`)
 */
function nonDailyJob(report: Report, opts: ExportOptions): ReportJob {
  if (report.dailyOnly) {
    throw new ConfigError(
      `"${report.id}" ดึงได้เฉพาะรอบรายวัน (dailyOnly — ตัวกรองเป็นวันเดียว) — สั่งด้วย --daily ไม่รองรับ --from/--to/--last-days`,
    );
  }
  const plan = resolveRunPlan(opts, thaiToday());
  return { range: plan.range, runKind: plan.kind, baselineIntervalDays: undefined, periodClose: false };
}

/** id ที่บันทึกผลใน `_run.json` — snapshot ปิดงวดแยกจาก snapshot ปกติของรายงานเดียวกัน (`<รายงาน>@period-close`) */
function recordIdOf(report: Report, job: ReportJob): string {
  return job.recordId ?? (job.periodClose ? periodCloseId(report.id) : report.id);
}

/** งานวันเดียว (วันของข้อมูล / วันสุดท้ายของงวด) — รอบรายวันและ baseline ขอ Site ทีละวันเหมือนกัน */
function oneDayJob(date: Date, runKind: RunKind, extra: { readonly baselineIntervalDays?: number; readonly periodClose?: boolean } = {}): () => ReportJob {
  return () => ({ range: { from: date, to: date }, runKind, baselineIntervalDays: extra.baselineIntervalDays, periodClose: extra.periodClose ?? false });
}

/** ของที่ทุกรายงานในรอบใช้ร่วมกัน */
type RunContext = {
  readonly opts: ExportOptions;
  readonly cfg: Config;
  readonly creds: Credentials;
  readonly redact: Redactor;
};

const REPORT_BY_ID: ReadonlyMap<string, Report> = new Map(REPORTS.map((r) => [r.id, r]));

/** โหลดบัญชีตอนจะเปิดเบราว์เซอร์จริงเท่านั้น (ไม่มีงาน = ไม่แตะ credential) พร้อมตัว redact ของบัญชีนั้น */
function runContext(opts: ExportOptions, cfg: Config): RunContext {
  const creds = loadCredentials();
  return { opts, cfg, creds, redact: createRedactor([creds.password, creds.username]) };
}



/**
 * ดึงหนึ่งรายงานให้จบ
 *
 * พิมพ์ความคืบหน้าและสรุปแบบคนอ่านเมื่อ `!json` แต่ **ไม่พิมพ์ JSON เอง** — คืน payload
 * ให้ผู้เรียกไปประกอบ เพราะโหมด `--report all` ต้องรวมหลายรายงานเป็นก้อน JSON เดียว
 * ถ้าล้มก็โยน error ออกไปตรง ๆ ผู้เรียกเป็นคนถือ redactor และเป็นคนตัดสินว่าจะหยุดหรือไปต่อ
 */
async function exportOne(ctx: RunContext, report: Report, outDir: string, job: ReportJob): Promise<ExportPayload> {
  const { opts, cfg, creds, redact } = ctx;
  const { range, runKind, baselineIntervalDays } = job;

  // รายงานภาพรวมที่ค้นช่วงอื่น (ticket 26): ชื่อไฟล์และช่วงใน _run.json เป็นช่วงข้อมูลจริง ไม่ใช่วันที่ดึง
  const dataRange = dataRangeOf(report, range);
  const chunks = report.chunk.kind === 'monthly' ? monthChunks(range) : [range];
  assertContiguous(chunks, range);

  // ดึงลงที่พักในโฟลเดอร์รอบก่อน แล้วค่อยวางแทนของรอบก่อนเมื่อผ่านทุกด่าน — รันซ้ำแล้วล้มกลางทางต้องไม่ทำให้
  // ไฟล์ดิบที่ดีของรอบก่อนหายไป (ADR-0005) · ที่พักของรอบที่ตายกลางทางถูกล้างตรงนี้ก่อนเริ่มเสมอ
  const stagingRoot = path.join(outDir, '_staging');
  const staging = path.join(stagingRoot, report.id);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const dropStaging = async () => {
    await rm(staging, { recursive: true, force: true });
    await rmdir(stagingRoot).catch(() => undefined); // ลบเฉพาะเมื่อว่างแล้ว
  };

  const log = (l: string) => {
    if (!opts.json) console.log(l);
  };

  if (!opts.json) {
    console.log(`${chalk.dim('รายงาน')}   ${report.label}  (${report.id})`);
    console.log(`${chalk.dim('ช่วง')}      ${formatDMY(range.from)} → ${formatDMY(range.to)}`);
    console.log(
      `${chalk.dim('แบ่งก้อน')}  ${report.chunk.kind === 'monthly' ? `รายเดือน ${chunks.length} ก้อน` : 'ทั้งช่วงทีเดียว'}`,
    );
    console.log(chalk.dim(`          เหตุผล: ${report.chunk.reason}`));
    console.log();
  }

  const session = await openSession({
    ...cfg,
    headless: opts.headful ? false : cfg.headless,
    slowMoMs: opts.slowMoMs ?? cfg.slowMoMs,
  });
  let outcomes: ChunkOutcome[];
  try {
    await login(session, cfg, creds, redact);
    outcomes = await fetchAll(session, cfg, report, chunks, staging, log);
  } catch (err) {
    await dropStaging();
    throw err;
  } finally {
    await session.close();
  }

  const dataChunks = outcomes.filter((o) => o.kind === 'data').length;
  const emptyChunks = outcomes.length - dataChunks;
  const verdicts = outcomes.filter(isData).map((o) => o.verdict);

  const emptyRanges = outcomes
    .filter((o): o is Extract<ChunkOutcome, { kind: 'empty' }> => o.kind === 'empty')
    .map((o) => o.range);
  const files = outcomes
    .filter(isData)
    .map((o) => ({ staged: o.verdict.filePath, entry: manifestEntryFor(report, cfg, o, job) }));
  let merged: ReturnType<typeof verifyMerged>;
  try {
    merged = verifyMerged(verdicts, emptyRanges, range);
    // ชื่อซ้ำกันในชุดเดียว = สองก้อนจะทับกันเอง (เช่น snapshot สองก้อนในวินาทีเดียวกัน) — ล้มก่อนแตะของเดิม
    const names = files.map((f) => f.entry.file);
    if (new Set(names).size !== names.length) {
      throw new Error(`ชื่อไฟล์ดิบของ "${report.id}" ซ้ำกันในรอบเดียว: ${names.join(', ')}`);
    }
    const movedAt = new Date();
    const moved = await publishRawFiles(outDir, files, movedAt);
    // manifest ไปพร้อมไฟล์ของรายงานนี้ทันที ไม่รอจบทั้งรอบ — รอบที่ตายกลางทางไม่ทิ้งไฟล์ที่ไม่มีรายการ
    await recordPublished(outDir, files.map((f) => f.entry), moved, new Set(await readdir(outDir)), thaiIsoString(movedAt));
  } finally {
    await dropStaging();
  }
  const actualRange = measuredRange(report, verdicts);

  if (!opts.json) {
    console.log();
    console.log(`${chalk.dim('ก้อนที่มีข้อมูล')}  ${dataChunks}  ${chalk.dim(`(ว่าง ${emptyChunks})`)}`);
    console.log(`${chalk.dim('แถวรวม')}          ${merged.totalRows.toLocaleString()}`);
    console.log(`${chalk.dim('ครอบคลุมช่วง')}    ${chalk.green('✔ ปูเต็มไม่มีรู')}  ${chalk.dim(`(${merged.coveredChunks} ก้อน)`)}`);
    console.log();
    for (const { entry } of files) {
      console.log(`${chalk.green('✔')} ${entry.file}  ${String(entry.rows).padStart(6)} แถว  ${chalk.dim('ไฟล์ดิบ')}`);
    }
  }

  return {
    report: recordIdOf(report, job),
    runKind,
    range: { from: formatISO(dataRange.from), to: formatISO(dataRange.to) },
    chunks: { total: outcomes.length, withData: dataChunks, empty: emptyChunks },
    totalRows: merged.totalRows,
    actualRange,
    files: files.map((f) => f.entry),
  };
}

type Failure = { readonly code: 'config' | 'export_failed'; readonly text: string };

/** แปลง error เป็นข้อความที่ redact แล้ว — ConfigError เป็นข้อความของเราเอง ส่วน error อื่นอาจมี stack/credential */
function failureOf(err: unknown, redact: Redactor): Failure {
  // คำสั่งผิด (flag ขัดกัน / ช่วงวันผิด) — ข้อความของเราเอง ไม่ต้องมี stack
  return err instanceof ConfigError || err instanceof PlanError || err instanceof OrderError
    ? { code: 'config', text: redact(err.message) }
    : { code: 'export_failed', text: redactError(err, redact) };
}

/** รายงานความล้มเหลวของการรันรายงานใบเดียว (หรือของทั้งรอบ) ในรูปแบบเดียวกันเสมอ */
function printFailure(opts: ExportOptions, code: Failure['code'], text: string): void {
  if (opts.json) {
    console.log(JSON.stringify({ ok: false, code, text }, null, 2));
  } else {
    console.error(`${chalk.red('✘ ไม่สำเร็จ')}\n${text}`);
  }
}

function requireReport(id: string): Report {
  const report = findReport(id);
  if (!report) {
    throw new ConfigError(
      `ไม่รู้จักรายงาน "${id}"\n  ที่มีให้เลือก: ${reportIds().join(', ')}, ${ALL_REPORTS}`,
    );
  }
  return report;
}

type ReportResult = {
  readonly done: ExportPayload[];
  readonly failed: (Failure & { readonly report: string })[];
  readonly attempts: Map<string, number>;
};

/**
 * รันรายงานตามลำดับ ลงโฟลเดอร์รอบเดียว — แต่ละรายงานเปิด session ใหม่และลองใหม่เฉพาะความผิดพลาดชั่วคราว (core/retry.ts) ·
 * รายงานหนึ่งล้มไม่พาที่เหลือล้มไปด้วย (การดึงหลายนาที ไม่ควรต้องรันใหม่ทั้งก้อน) · `job` เป็นฟังก์ชัน ให้ error ของการคำนวณงาน
 * (เช่น รายงาน dailyOnly ที่สั่งผิดโหมด) เกิดในรอบลองของรายงานนั้นและถูกนับเป็นผลของรายงานนั้น ไม่ใช่ล้มทั้งรอบ ·
 * `numbering` = ลำดับเริ่มของรายงานแรกในชุดนี้และจำนวนทั้งรอบ (รอบรายวันรันหลายโฟลเดอร์ต่อกัน)
 */
async function runReports(
  ctx: RunContext,
  outDir: string,
  jobs: readonly { readonly report: Report; readonly job: () => ReportJob; readonly periodClose?: boolean; readonly recordId?: string }[],
  many: boolean,
  numbering: { readonly first: number; readonly total: number },
): Promise<ReportResult> {
  const { opts, redact } = ctx;
  const result: ReportResult = { done: [], failed: [], attempts: new Map() };
  for (const [i, { report, job, periodClose, recordId: fixedId }] of jobs.entries()) {
    // ตรงกับ recordIdOf ของงานนั้น (job ยังไม่ถูกเรียก — error ต้องเกิดในรอบลอง)
    const recordId = fixedId ?? (periodClose ? periodCloseId(report.id) : report.id);
    const n = numbering.first + i;
    if (many && !opts.json) {
      if (n > 0) console.log();
      console.log(chalk.bold(`${chalk.dim(`[${n + 1}/${numbering.total}]`)} ${recordId}`));
      console.log(chalk.dim('─'.repeat(72)));
    }
    const outcome = await withBrowserRetry(() => exportOne(ctx, report, outDir, fixedId ? { ...job(), recordId: fixedId } : job()), {
      label: report.id,
      describe: (err) => failureOf(err, redact).text,
      ...(opts.json ? {} : { log: (line: string) => console.error(chalk.yellow(line)) }),
    });
    result.attempts.set(recordId, outcome.attempts);
    if (outcome.ok) {
      result.done.push(outcome.value);
    } else {
      // ConfigError ของรายงานใบเดียว (เช่น dailyOnly โดยไม่ใส่ --daily) ไม่ใช่ "รอบที่ล้ม" — ไม่ต้องทิ้ง _run.json ไว้ในโฟลเดอร์ที่ยัง
      // ไม่ได้ดึงอะไรเลย ปล่อยให้ catch ของ runExport รายงานตามเดิม
      if (!many && outcome.error instanceof ConfigError) throw outcome.error;
      const f = failureOf(outcome.error, redact);
      result.failed.push({ report: recordId, ...f });
      if (many && !opts.json) console.error(`${chalk.red('✘ ไม่สำเร็จ')}  ${recordId}\n${f.text}`);
    }
  }
  return result;
}

/** ผลรายใบของโฟลเดอร์หนึ่ง → `_run.json` (รูปเดียวกันทุกชนิดรอบ) */
function outcomesOf(result: ReportResult): ReportOutcome[] {
  return [
    ...result.done.map((p): ReportOutcome => ({
      report: p.report,
      status: 'ok',
      rows: p.totalRows,
      range: p.range,
      actualRange: p.actualRange,
      files: p.files.map((f) => ({ file: f.file, rows: f.rows, sha256: f.sha256 })),
      attempts: result.attempts.get(p.report) ?? 1,
    })),
    ...result.failed.map((f): ReportOutcome => ({
      report: f.report, status: 'failed', error: f.text, attempts: result.attempts.get(f.report) ?? 1,
    })),
  ];
}


/**
 * รอบรายวัน (ADR-0008/0009) — ตัววางแผนตัดสินว่าต้องทำอะไรจาก `_run.json` ของโฟลเดอร์ที่มันขอให้อ่าน (`daysToRead`): **รายงานตามวัน**
 * ทุกวันของข้อมูลที่ถึงกำหนดแต่ยังไม่สำเร็จ ตั้งแต่วันเริ่มใช้งาน (ไม่เกิน `CATCH_UP_CAP_DAYS` วันต่อรอบ) ลงโฟลเดอร์ของวันนั้น ·
 * **รายงาน snapshot** ถ่ายครั้งเดียวต่อวันลงโฟลเดอร์ของวันนี้ (โฟลเดอร์ของวัน D = วันของข้อมูล D ตาม ADR-0005) แต่ snapshot ทุกใบของ HotelTime
 * ถ่ายซ้ำอีกครั้งในรอบ 18:00 (`refreshAtHour` จาก `toPlanned`) (ADR-0011 — บันทึกผลด้วย id `<รายงาน>@refresh`) · `--date` = ดึงวันเดียวใหม่
 * ไม่สนสถานะ · รอบ 15:00/18:00 รันคำสั่งเดียวกัน · ไม่มีงาน = จบโดยไม่เปิดเบราว์เซอร์และไม่โหลด credential
 */
async function runDaily(opts: ExportOptions, cfg: Config, requested: readonly Report[], many: boolean): Promise<number> {
  const now = new Date();
  const today = formatISO(thaiToday(now));
  const folderOf = (date: Date) => dailyFolder(cfg.dataDir, 'hoteltime', { from: date, to: date });
  const planned = requested.map(toPlanned);
  const warnings: string[] = [];
  let plan: WorkPlan;
  if (opts.date !== undefined) {
    plan = planDateRun({ now, reports: planned, day: opts.date });
  } else {
    const folders = [];
    for (const day of daysToRead({ now, goLive: cfg.goLive })) {
      try {
        const record = await readRunRecord(folderOf(parseISODate(day)!));
        if (record !== null) folders.push({ day, record });
      } catch (err) {
        // _run.json ที่เสียของวันเก่าวันเดียวต้องไม่หยุดทั้งรอบ — ถือว่าวันนั้นยังไม่ได้ดึง (ดึงใหม่ได้ ไฟล์เดิมไม่หาย ADR-0005) แล้วบอกให้รู้
        warnings.push(`อ่าน _run.json ของวัน ${day} ไม่ได้ (${(err as Error).message.split('\n')[0]}) — ถือว่าวันนั้นยังไม่ได้ดึง`);
      }
    }
    const daily = planDailyRun({ now, reports: planned, state: storeStateFrom(folders, REPORTS), goLive: cfg.goLive });
    warnings.push(...planWarnings(daily, cfg.goLive, { dateOption: true }));
    plan = daily;
  }
  if (!opts.json) for (const w of warnings) console.error(chalk.yellow(`⚠ ${w}`));
  const items = [
    ...plan.perDay,
    ...plan.pictures,
    ...plan.refreshes.map((i) => ({ ...i, refresh: true })),
    ...plan.periodCloses.map((i) => ({ ...i, periodClose: true })),
  ];

  if (items.length === 0) {
    const text = 'ไม่มีงานค้าง — รายงานตามวันที่ถึงกำหนดและรายงาน snapshot ของวันนี้สำเร็จแล้ว';
    if (opts.json) {
      console.log(JSON.stringify(
        { ok: true, code: 'nothing_to_do', text, warnings, reports: [], failed: [], skipped: [], totalRows: 0, outDirs: [] },
        null,
        2,
      ));
    } else {
      console.log(`${chalk.green('✔')} ${text}`);
    }
    return 0;
  }

  const ctx = runContext(opts, cfg);
  const total: ReportResult = { done: [], failed: [], attempts: new Map() };
  const outcomes: ReportOutcome[] = [];
  const outDirs: string[] = [];
  const itemDays = [...new Set(items.map((i) => i.day))].sort();

  // เรียงตามวัน (เก่าไปใหม่) · ตัวชี้ latest เลื่อนเฉพาะตอนเขียนโฟลเดอร์ของวันนี้ — รอบที่เติมแค่วันเก่าต้องไม่ดึงมันถอยหลัง ·
  // คำเตือนบันทึกเฉพาะโฟลเดอร์ใหม่สุดของรอบนี้ — ไม่ทิ้งสำเนาเก่าค้างในโฟลเดอร์ของวันที่เติมย้อนหลัง
  for (const day of itemDays) {
    const date = parseISODate(day)!;
    const outDir = folderOf(date);
    outDirs.push(outDir);
    if (!opts.json) console.log(`${chalk.dim('ผลรอบนี้')}  ${path.relative(cfg.projectRoot, outDir)}/  ${chalk.dim(`(วัน ${day})`)}\n`);
    // ทุกงานขอวันเดียว — snapshot ปิดงวดขอวันสุดท้ายของงวด ซึ่งรายงานยอดสะสม (dataWindow) แปลงเป็นทั้งงวดเอง
    const startedAt = new Date();
    const result = await runReports(
      ctx, outDir,
      items.filter((i) => i.day === day).map((i) => {
        const periodClose = 'periodClose' in i;
        // snapshot ถ่ายซ้ำ (ADR-0011): ไฟล์ชื่อตามเวลาที่ถ่ายเหมือน snapshot ปกติ แต่บันทึกผลด้วย id แยก ไม่ทับผลรอบเที่ยง
        const recordId = 'refresh' in i ? refreshId(i.report) : undefined;
        return { report: REPORT_BY_ID.get(i.report)!, job: oneDayJob(date, 'daily', { periodClose }), periodClose, ...(recordId !== undefined ? { recordId } : {}) };
      }),
      many,
      { first: total.done.length + total.failed.length, total: items.length },
    );
    const folderOutcomes = outcomesOf(result);
    await recordRun(outDir, {
      site: 'hoteltime',
      kind: 'daily',
      dataThrough: day,
      startedAt,
      finishedAt: new Date(),
      outcomes: folderOutcomes,
      ...(day === itemDays.at(-1) ? { warnings } : {}),
      ...(day === today ? { latest: latestPointer(cfg.dataDir, 'hoteltime', 'daily') } : {}),
    });
    total.done.push(...result.done);
    total.failed.push(...result.failed);
    outcomes.push(...folderOutcomes);
  }

  return finish(opts, many, total, [], outcomes, { outDirs }, warnings);
}

/**
 * Extra snapshot round (ADR-0013): `export --snapshot-slot 06|23`. Takes the snapshot reports again into today's folder and records each result under its own id
 * `<report>@refresh-<HH>`; never plans per-day reports, back-fill or period-close, never moves `daily/latest`, and never touches the normal snapshot's status — so the
 * noon round and the 18:30 deadline logic see exactly what they saw before. Does nothing (no browser, no credentials) when the slot is switched off in
 * `HOTELTIME_SNAPSHOT_SLOTS`, when it is outside the slot's Thai-time window, or when every report of the slot is already done (that is what the second cron 30 minutes later hits).
 */
async function runSnapshotSlot(opts: ExportOptions, cfg: Config, requested: readonly Report[], many: boolean): Promise<number> {
  const slot = opts.snapshotSlot!;
  if (!isSnapshotSlot(slot)) {
    throw new ConfigError(`--snapshot-slot must be one of ${SNAPSHOT_SLOTS.join(', ')} — got ${JSON.stringify(slot)}`);
  }
  if (!many) {
    const report = requested[0]!;
    if (toPlanned(report).family !== 'picture') throw new ConfigError(`--snapshot-slot takes snapshot reports only — "${report.id}" is a per-day report`);
  }
  const nothing = (code: string, text: string): number => {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, code, text, warnings: [], reports: [], failed: [], skipped: [], totalRows: 0, outDirs: [] }, null, 2));
    } else {
      console.log(`${chalk.green('✔')} ${text}`);
    }
    return 0;
  };
  if (!cfg.snapshotSlots.includes(slot)) {
    return nothing('slot_disabled', `snapshot slot ${slot} is switched off — add ${slot} to HOTELTIME_SNAPSHOT_SLOTS in exporter/.env to enable it`);
  }
  const now = new Date();
  const today = formatISO(thaiToday(now));
  const date = parseISODate(today)!;
  const outDir = dailyFolder(cfg.dataDir, 'hoteltime', { from: date, to: date });
  const warnings: string[] = [];
  let state = storeStateFrom([], REPORTS.map(toPlanned));
  try {
    const record = await readRunRecord(outDir);
    if (record !== null) state = storeStateFrom([{ day: today, record }], REPORTS.map(toPlanned));
  } catch (err) {
    // an unreadable _run.json must not stop the round — the files already there stay (ADR-0005) and this round simply plans every report again
    warnings.push(`could not read the _run.json of ${today} (${(err as Error).message.split('\n')[0]}) — treating the slot as not taken yet`);
  }
  if (!opts.json) for (const w of warnings) console.error(chalk.yellow(`⚠ ${w}`));
  const plan = planSnapshotSlot({
    now,
    reports: requested.map(toPlanned),
    state,
    slot,
    ...(cfg.snapshotSlotReports !== null ? { only: cfg.snapshotSlotReports } : {}),
  });
  if (!plan.inWindow) {
    const w = SLOT_WINDOW[slot];
    return nothing('slot_window_passed', `snapshot slot ${slot} only runs between ${String(w.from).padStart(2, '0')}:00 and ${String(w.to).padStart(2, '0')}:00 Thai time — nothing done`);
  }
  if (plan.items.length === 0) {
    return nothing('nothing_to_do', `snapshot slot ${slot} of ${today}: nothing left to take — every report is done`);
  }

  const ctx = runContext(opts, cfg);
  const startedAt = new Date();
  if (!opts.json) console.log(`${chalk.dim('Result of this round')}  ${path.relative(cfg.projectRoot, outDir)}/  ${chalk.dim(`(snapshot slot ${slot}, ${plan.items.length} reports)`)}\n`);
  const result = await runReports(
    ctx, outDir,
    plan.items.map((i) => ({ report: REPORT_BY_ID.get(i.report)!, job: oneDayJob(date, 'daily'), recordId: slotRefreshId(i.report, slot) })),
    plan.items.length > 1,
    { first: 0, total: plan.items.length },
  );
  const outcomes = outcomesOf(result);
  // no `latest`: a slot-only folder must not become `daily/latest` (at 06:00 it would hold no normal snapshot yet)
  await recordRun(outDir, { site: 'hoteltime', kind: 'daily', dataThrough: today, startedAt, finishedAt: new Date(), outcomes });
  return finish(opts, plan.items.length > 1, result, [], outcomes, { outDirs: [outDir] }, warnings);
}

/**
 * **รอบดึง** (ADR-0014): `export --report all --round HH` — ทำตาม `planRound`: snapshot ครบชุด + per-day ของวันนี้ทุกรอบ, รอบ 08/12 ดึงซ้ำของเมื่อวาน, เก็บตกวันที่ขาด ·
 * ผลของแต่ละรอบบันทึกใต้ id `<รายงาน>@round-<HH>` (เก็บตกใช้ id ปกติ) · per-day ของวัน D ลงโฟลเดอร์ D เสมอ (ADR-0005) snapshot ลงโฟลเดอร์ของวันนี้ ·
 * ไบต์ต่างแทนชื่อเดิม = ฉบับเก่าไป `_superseded/` · ไบต์เหมือนเดิมไม่สร้างงานซ้ำ (ticket 01) · `daily/latest` ขยับทุกรอบที่เขียนไฟล์ลงโฟลเดอร์วันนี้
 * · ออกทันทีโดยไม่ login ถ้ารอบไม่ได้เปิดใน `HOTELTIME_ROUNDS` หรือนอกหน้าต่างเวลา หรือไม่มีงาน
 */
async function runRound(opts: ExportOptions, cfg: Config, many: boolean): Promise<number> {
  const round = opts.round!;
  if (!isRoundHour(round)) throw new ConfigError(`--round must be one of ${ROUND_HOURS.join(', ')} — got ${JSON.stringify(round)}`);
  if (!many) throw new ConfigError('--round takes --report all — an extraction round is the whole set of reports');
  const nothing = (code: string, text: string): number => {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, code, text, warnings: [], reports: [], failed: [], skipped: [], totalRows: 0, outDirs: [] }, null, 2));
    } else {
      console.log(`${chalk.green('✔')} ${text}`);
    }
    return 0;
  };
  const now = new Date();
  const gate = gateRound({ now, round, enabled: cfg.rounds });
  if (gate.reason === 'disabled') return nothing('round_disabled', `round ${round} is switched off — add ${round} to HOTELTIME_ROUNDS in exporter/.env to enable it`);
  if (gate.reason === 'outside_window') {
    const w = ROUND_WINDOW[round];
    return nothing('round_window_passed', `round ${round} only runs between ${String(w.from).padStart(2, '0')}:00 and ${String(w.to).padStart(2, '0')}:00 Thai time — nothing done`);
  }

  const today = formatISO(thaiToday(now));
  const folderOf = (date: Date) => dailyFolder(cfg.dataDir, 'hoteltime', { from: date, to: date });
  const planned = REPORTS.map(toPlanned);
  const warnings: string[] = [];
  const folders = [];
  for (const day of daysToRead({ now, goLive: cfg.goLive })) {
    try {
      const record = await readRunRecord(folderOf(parseISODate(day)!));
      if (record !== null) folders.push({ day, record });
    } catch (err) {
      warnings.push(`อ่าน _run.json ของวัน ${day} ไม่ได้ (${(err as Error).message.split('\n')[0]}) — ถือว่าวันนั้นยังไม่ได้ดึง`);
    }
  }
  const plan = planRound({ now, round, enabled: cfg.rounds, reports: planned, state: storeStateFrom(folders, planned), goLive: cfg.goLive });
  if (!opts.json) for (const w of warnings) console.error(chalk.yellow(`⚠ ${w}`));
  const items = [
    ...plan.catchUp.map((i) => ({ ...i, recordId: i.report })),
    ...plan.redoYesterday.map((i) => ({ ...i, recordId: redoId(i.report, round) })),
    ...plan.today.map((i) => ({ ...i, recordId: roundId(i.report, round) })),
    ...plan.pictures.map((i) => ({ ...i, recordId: roundId(i.report, round) })),
  ];
  if (items.length === 0) return nothing('nothing_to_do', `round ${round} of ${today}: nothing left to take — every report of this round is done`);

  const ctx = runContext(opts, cfg);
  const total: ReportResult = { done: [], failed: [], attempts: new Map() };
  const outcomes: ReportOutcome[] = [];
  const outDirs: string[] = [];
  const itemDays = [...new Set(items.map((i) => i.day))].sort();
  for (const day of itemDays) {
    const date = parseISODate(day)!;
    const outDir = folderOf(date);
    outDirs.push(outDir);
    if (!opts.json) console.log(`${chalk.dim('ผลรอบนี้')}  ${path.relative(cfg.projectRoot, outDir)}/  ${chalk.dim(`(รอบ ${round} · วัน ${day})`)}\n`);
    const startedAt = new Date();
    const result = await runReports(
      ctx, outDir,
      items.filter((i) => i.day === day).map((i) => ({ report: REPORT_BY_ID.get(i.report)!, job: oneDayJob(date, 'daily'), recordId: i.recordId })),
      true,
      { first: total.done.length + total.failed.length, total: items.length },
    );
    const folderOutcomes = outcomesOf(result);
    await recordRun(outDir, {
      site: 'hoteltime',
      kind: 'daily',
      dataThrough: day,
      startedAt,
      finishedAt: new Date(),
      outcomes: folderOutcomes,
      ...(day === itemDays.at(-1) ? { warnings } : {}),
      // latest = โฟลเดอร์ของวันนี้ ขยับทุกรอบที่เขียนไฟล์ลงโฟลเดอร์นั้นอย่างน้อยหนึ่งไฟล์ (เหมือนรอบรายวันเดิม) — ขาอัปโหลดคำนวณโฟลเดอร์เมื่อวานเอง ไม่อ่านตัวชี้นี้
      ...(day === today && result.done.some((d) => d.files.length > 0) ? { latest: latestPointer(cfg.dataDir, 'hoteltime', 'daily') } : {}),
    });
    total.done.push(...result.done);
    total.failed.push(...result.failed);
    outcomes.push(...folderOutcomes);
  }
  return finish(opts, true, total, [], outcomes, { outDirs }, warnings);
}

/**
 * **baseline** (ใบ 09, ADR-0008) — ดึงวันของข้อมูลในช่วงใหม่หมด ทีละวัน ไฟล์ละวัน `YYYY-MM-DD__<รายงาน>.xlsx` (ชื่อ/key เดียวกับรอบรายวัน) ลงโฟลเดอร์ของ
 * รอบนี้ `baseline/<วันที่รัน>/` (เจ้าของเลือก 2026-10-14): ฉบับรายวันกับฉบับ baseline อยู่คนละโฟลเดอร์ ไม่ลบไม่ทับ (ADR-0005) เทียบกันได้เลย · ตัววางแผนและ
 * status อ่านแค่โฟลเดอร์รายวัน — ผลของ baseline (รวมที่ล้ม) จึงไม่ทำให้รอบรายวันดึงวันนั้นซ้ำ · `_run.json` บันทึกด้วย id `<รายงาน>@<วัน>` ·
 * รายงาน snapshot ไม่มี baseline: สั่งใบเดียว = ปฏิเสธ · `--report all` = ข้ามพร้อมเหตุผล (แบบ ADR-0003)
 */
async function runBaseline(opts: ExportOptions, cfg: Config, requested: readonly Report[]): Promise<number> {
  const plan = resolveRunPlan(opts, thaiToday()); // flag ที่ขัดกัน / ช่วงถึงวันนี้ โยนจากที่นี่
  const { items, skipped } = planBaselineRun({ reports: requested.map(toPlanned), from: formatISO(plan.range.from), to: formatISO(plan.range.to) });
  if (items.length === 0) {
    throw new ConfigError(`"${requested.map((r) => r.id).join(', ')}" — ${skipped[0]?.reason ?? 'ไม่มีรายงานตามวันให้ทำ baseline'}`);
  }
  const startedAt = new Date();
  const outDir = runFolder(cfg.dataDir, 'hoteltime', 'baseline', plan.range, startedAt);
  const ctx = runContext(opts, cfg);
  if (!opts.json) {
    for (const sk of skipped) console.log(`${chalk.yellow('⏭ ข้าม')}  ${sk.report} — ${sk.reason}`);
    if (skipped.length > 0) console.log();
    console.log(`${chalk.dim('ผลรอบนี้')}  ${path.relative(cfg.projectRoot, outDir)}/  ` +
      chalk.dim(`(baseline ${formatISO(plan.range.from)} ถึง ${formatISO(plan.range.to)} · ไฟล์ละวันของข้อมูล — ฉบับรายวันอยู่ในโฟลเดอร์ daily ไม่ถูกแตะ)`));
    console.log();
  }
  // ไม่ผูกกับวันเริ่มใช้งาน — baseline คือการสั่งดึงวันที่ระบุใหม่โดยตั้งใจ (คนละเรื่องกับรอบเก็บตก)
  const jobs = items.map((i) => ({
    report: REPORT_BY_ID.get(i.report)!,
    job: oneDayJob(parseISODate(i.day)!, 'baseline', { baselineIntervalDays: plan.baselineIntervalDays }),
    recordId: `${i.report}@${i.day}`,
  }));
  const manyJobs = jobs.length > 1;
  const result = await runReports(ctx, outDir, jobs, manyJobs, { first: 0, total: jobs.length });
  const outcomes = outcomesOf(result);
  await recordRun(outDir, {
    site: 'hoteltime',
    kind: 'baseline',
    dataThrough: formatISO(plan.range.to),
    startedAt,
    finishedAt: new Date(),
    outcomes,
    skipped,
    latest: latestPointer(cfg.dataDir, 'hoteltime', 'baseline'),
  });
  return finish(opts, manyJobs, result, skipped, outcomes, { outDir });
}

/**
 * พิมพ์ผลของทั้งรอบ (JSON หรือคนอ่าน) แล้วคืน exit code — 0 ผ่านหมด · 2 ผ่านบางใบ · 1 ไม่ได้อะไรเลย · `where` ลง JSON ตรง ๆ:
 * รอบรายวันเขียนได้หลายโฟลเดอร์ (`outDirs`) รอบอื่นโฟลเดอร์เดียว (`outDir` ตามเดิม)
 */
function finish(
  opts: ExportOptions,
  many: boolean,
  result: ReportResult,
  skipped: readonly SkippedReport[],
  outcomes: readonly ReportOutcome[],
  where: { readonly outDir: string } | { readonly outDirs: readonly string[] },
  warnings: readonly string[] = [],
): number {
  const totalRows = result.done.reduce((n, p) => n + p.totalRows, 0);
  if (!many && result.failed.length > 0) {
    printFailure(opts, result.failed[0]!.code, result.failed[0]!.text);
    return 1;
  }
  if (opts.json) {
    console.log(JSON.stringify(
      many
        ? { ok: result.failed.length === 0, code: 'exported_all', reports: result.done, failed: result.failed, skipped, totalRows, warnings, ...where }
        : { ok: true, code: 'exported', ...result.done[0]!, warnings, ...where },
      null,
      2,
    ));
  } else if (many) {
    console.log();
    console.log(chalk.dim('═'.repeat(72)));
    console.log(`${chalk.dim('รายงานที่สำเร็จ')}  ${result.done.length}/${result.done.length + result.failed.length}`);
    console.log(`${chalk.dim('แถวรวมทุกใบ')}    ${totalRows.toLocaleString()}`);
    for (const p of result.done) {
      const span = p.range.from === p.range.to ? p.range.from : `${p.range.from}--${p.range.to}`;
      console.log(`  ${chalk.green('✔')} ${p.report.padEnd(24)} ${String(p.totalRows).padStart(6)} แถว  ${chalk.dim(`(${span})`)}`);
    }
    for (const f of result.failed) console.log(`  ${chalk.red('✘')} ${f.report}`);
    for (const sk of skipped) console.log(`  ${chalk.yellow('⏭')} ${sk.report.padEnd(24)} ${chalk.dim(`ข้าม — ${sk.reason}`)}`);
  }
  if (!opts.json && result.done.length > 0) {
    console.log();
    for (const d of 'outDir' in where ? [where.outDir] : where.outDirs) {
      console.log(`${chalk.dim('ไฟล์อยู่ที่')}  ${d}/  ${chalk.dim('(สรุปใน _summary.txt)')}`);
    }
    for (const w of warnings) console.log(chalk.yellow(`⚠ ${w}`)); // ซ้ำท้ายรอบ — บรรทัดต้นรอบถูกดันขึ้นไปไกลแล้ว
  }
  return exitCodeFor(outcomes);
}

export async function runExport(opts: ExportOptions): Promise<number> {
  let redact: Redactor = createRedactor([]);

  try {
    const cfg = loadConfig();
    const many = opts.reportId === ALL_REPORTS;

    if (opts.round !== undefined) {
      if (opts.snapshotSlot !== undefined || opts.daily || opts.baseline || opts.date !== undefined || opts.from !== undefined || opts.to !== undefined
        || opts.lastDays !== undefined || opts.baselineIntervalDays !== undefined) {
        throw new ConfigError('--round cannot be combined with --snapshot-slot/--daily/--date/--from/--to/--last-days/--baseline — it is its own extraction round');
      }
      return await runRound(opts, cfg, many);
    }
    if (opts.snapshotSlot !== undefined) {
      if (opts.daily || opts.baseline || opts.date !== undefined || opts.from !== undefined || opts.to !== undefined || opts.lastDays !== undefined
        || opts.baselineIntervalDays !== undefined) {
        throw new ConfigError('--snapshot-slot cannot be combined with --daily/--date/--from/--to/--last-days/--baseline — it is its own snapshot-only round');
      }
      return await runSnapshotSlot(opts, cfg, many ? REPORTS : [requireReport(opts.reportId)], many);
    }
    if (opts.date !== undefined) {
      if (opts.daily || opts.baseline || opts.from !== undefined || opts.to !== undefined || opts.lastDays !== undefined
        || opts.baselineIntervalDays !== undefined) {
        throw new ConfigError('--date ใช้คู่กับ --daily/--from/--to/--last-days/--baseline ไม่ได้ — --date ดึงวันของข้อมูลวันเดียวอยู่แล้ว');
      }
      return await runDaily(opts, cfg, many ? REPORTS : [requireReport(opts.reportId)], many);
    }
    if (opts.daily) {
      resolveRunPlan(opts, thaiToday()); // flag ที่ขัดกับ --daily โยนจากที่นี่ที่เดียวตามเดิม
      return await runDaily(opts, cfg, many ? REPORTS : [requireReport(opts.reportId)], many);
    }

    if (opts.baseline) return await runBaseline(opts, cfg, many ? REPORTS : [requireReport(opts.reportId)]);

    const { run: reports, skipped } = many ? partitionForRunAll(REPORTS) : { run: [requireReport(opts.reportId)], skipped: [] };

    // ตัดสินครั้งเดียวต่อรอบ ทุกรายงานใน --report all ต้องลงโฟลเดอร์เดียวกัน · resolveRunPlan โยนเรื่อง flag ขัดกันที่นี่ได้เลย
    const plan = resolveRunPlan(opts, thaiToday());
    const runKind = plan.kind;
    const startedAt = new Date();
    const outDir = runFolder(cfg.dataDir, 'hoteltime', runKind, plan.range, startedAt);

    const creds = loadCredentials();
    redact = createRedactor([creds.password, creds.username]);
    const ctx: RunContext = { opts, cfg, creds, redact };
    if (many && !opts.json) {
      for (const sk of skipped) console.log(`${chalk.yellow('⏭ ข้าม')}  ${sk.report} — ${sk.reason}`);
      if (skipped.length > 0) console.log();
    }
    if (!opts.json) {
      console.log(`${chalk.dim('ผลรอบนี้')}  ${path.relative(cfg.projectRoot, outDir)}/  ${chalk.dim('(โฟลเดอร์ของรอบนี้ แยกจากรอบรายวัน)')}`);
      console.log();
    }

    const result = await runReports(
      ctx, outDir, reports.map((report) => ({ report, job: () => nonDailyJob(report, opts) })), many,
      { first: 0, total: reports.length },
    );
    const outcomes = outcomesOf(result);
    // back-fill / --from --to / --last-days (baseline แยกไปที่ runBaseline) — บันทึกผลรายใบแบบเดียวกับทุกชนิดรอบ
    await recordRun(outDir, {
      site: 'hoteltime',
      kind: runKind,
      dataThrough: formatISO(plan.range.to),
      startedAt,
      finishedAt: new Date(),
      outcomes,
      skipped,
    });
    return finish(opts, many, result, skipped, outcomes, { outDir });
  } catch (err) {
    const f = failureOf(err, redact);
    printFailure(opts, f.code, f.text);
    return 1;
  }
}
