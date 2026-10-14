import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
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
  PlanError, daysToRead, periodCloseId, planBaselineRun, planDailyRun, planDateRun, planWarnings, storeStateFrom, type WorkPlan,
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
} from './webforms.ts';
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
      /** เวลาที่ได้ไฟล์มา — เวลาที่ถ่ายของรายงานภาพ */
      readonly fetchedAt: Date;
    }
  | { readonly kind: 'empty'; readonly range: DateRange };

type DataOutcome = Extract<ChunkOutcome, { kind: 'data' }>;

const isData = (o: ChunkOutcome): o is DataOutcome => o.kind === 'data';

function chunkFileName(range: DateRange): string {
  return `${formatISO(range.from)}_${formatISO(range.to)}.xlsx`;
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
 * ชื่อไฟล์ ISO ของไฟล์ดิบหนึ่งไฟล์ — รายงานภาพใช้เวลาที่ถ่าย รายงานตามวันใช้ช่วงวันของข้อมูล (ADR-0008) · **ภาพปิดงวด** ใช้ช่วงของงวด
 * (`2026-09-01--2026-09-30__<id>.xlsx`) — ไม่ชนกับภาพปกติในโฟลเดอร์เดียวกันซึ่งใช้เวลาที่ถ่าย
 */
function rawFileName(report: Report, o: DataOutcome, periodClose: boolean): string {
  return report.family === 'picture' && !periodClose
    ? pictureFileName(o.fetchedAt, report.id, 'xlsx')
    : dataFileName(dataRangeOf(report, o.verdict.range), report.id, 'xlsx');
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
  };
}

/** งานของรายงานหนึ่งในรอบนี้ — ช่วงที่ขอและชนิดรอบ ตัดสินโดยผู้เรียก (ตัววางแผนของรอบรายวัน หรือ flag ของรอบอื่น) */
type ReportJob = {
  readonly range: DateRange;
  readonly runKind: RunKind;
  readonly baselineIntervalDays: number | undefined;
  /** ภาพปิดงวด (ใบ 05): ชื่อไฟล์เป็นช่วงของงวด และบันทึกผลด้วย id `<รายงาน>@period-close` */
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

/** id ที่บันทึกผลใน `_run.json` — ภาพปิดงวดแยกจากภาพปกติของรายงานเดียวกัน (`<รายงาน>@period-close`) */
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
    // ชื่อซ้ำกันในชุดเดียว = สองก้อนจะทับกันเอง (เช่น ภาพสองก้อนในวินาทีเดียวกัน) — ล้มก่อนแตะของเดิม
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
 * **รายงานภาพ** ถ่ายครั้งเดียวต่อวันลงโฟลเดอร์ของวันนี้ (โฟลเดอร์ของวัน D = วันของข้อมูล D ตาม ADR-0005) · `--date` = ดึงวันเดียวใหม่
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
  const items = [...plan.perDay, ...plan.pictures, ...plan.periodCloses.map((i) => ({ ...i, periodClose: true }))];

  if (items.length === 0) {
    const text = 'ไม่มีงานค้าง — รายงานตามวันที่ถึงกำหนดและรายงานภาพของวันนี้สำเร็จแล้ว';
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
    // ทุกงานขอวันเดียว — ภาพปิดงวดขอวันสุดท้ายของงวด ซึ่งรายงานยอดสะสม (dataWindow) แปลงเป็นทั้งงวดเอง
    const startedAt = new Date();
    const result = await runReports(
      ctx, outDir,
      items.filter((i) => i.day === day).map((i) => {
        const periodClose = 'periodClose' in i;
        return { report: REPORT_BY_ID.get(i.report)!, job: oneDayJob(date, 'daily', { periodClose }), periodClose };
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
 * **baseline** (ใบ 09, ADR-0008) — ดึงวันของข้อมูลในช่วงใหม่หมด ทีละวัน ไฟล์ละวัน `YYYY-MM-DD__<รายงาน>.xlsx` (ชื่อ/key เดียวกับรอบรายวัน) ลงโฟลเดอร์ของ
 * รอบนี้ `baseline/<วันที่รัน>/` (เจ้าของเลือก 2026-10-14): ฉบับรายวันกับฉบับ baseline อยู่คนละโฟลเดอร์ ไม่ลบไม่ทับ (ADR-0005) เทียบกันได้เลย · ตัววางแผนและ
 * status อ่านแค่โฟลเดอร์รายวัน — ผลของ baseline (รวมที่ล้ม) จึงไม่ทำให้รอบรายวันดึงวันนั้นซ้ำ · `_run.json` บันทึกด้วย id `<รายงาน>@<วัน>` ·
 * รายงานภาพไม่มี baseline: สั่งใบเดียว = ปฏิเสธ · `--report all` = ข้ามพร้อมเหตุผล (แบบ ADR-0003)
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
