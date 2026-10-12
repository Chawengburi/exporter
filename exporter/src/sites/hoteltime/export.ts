import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import {
  assertContiguous,
  formatDMY,
  formatISO,
  monthChunks,
  partitionForRunAll,
  resolveDailyOnlyRange,
  resolveRunPlan,
  splitRange,
  utcDate,
  type DateRange,
  type RunKind,
} from '../../core/order.ts';
import { toCsv } from '../../core/csv.ts';
import { dataFileName, latestPointer, rawDirFor, runFolder } from '../../core/placement.ts';
import { withBrowserRetry } from '../../core/retry.ts';
import { thaiToday } from '../../core/thai-time.ts';
import { exitCodeFor, readRunRecord, recordRun, selectRetryTargets, type ReportOutcome } from '../../core/run-record.ts';
import { createRedactor, redactError, type Redactor } from '../../core/redact.ts';
import { verifyMerged, type ChunkVerdict } from '../../core/verify.ts';
import { formatCellDate, parseCellDate, requireColumn } from '../../core/xlsx.ts';
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
import { REPORTS, findReport, reportIds } from './reports/index.ts';
import type { Report } from './reports/_types.ts';

/**
 * รูปแบบผลลัพธ์ที่จะเก็บไว้
 *
 * ไฟล์ `.xlsx` ดิบถูกดาวน์โหลดทุกรอบอยู่แล้วเพราะชั้นตรวจต้องอ่านมัน ตัวเลือกนี้จึงคุมแค่
 * ว่าจะ **เก็บอะไรไว้** หลังตรวจเสร็จ:
 *
 *  - `raw`  = เก็บเฉพาะ .xlsx ดิบจาก HotelTime + manifest ไม่เขียน CSV
 *  - `csv`  = เขียน CSV รายปีแล้วลบไฟล์ดิบทิ้ง
 *  - `both` = เก็บทั้งคู่ (ค่าเริ่มต้น)
 *
 * 🔑 ถ้าจะใช้เป็น source of truth ให้เลือก `raw` หรือ `both` — ไฟล์ดิบคือไบต์ที่ HotelTime
 * ส่งมาโดยไม่ถูกแตะเลย ส่วน CSV ผ่านการอ่าน/รวม/แปลงวันที่ของเราแล้ว
 */
export type OutputFormat = 'raw' | 'csv' | 'both';

export type ExportOptions = {
  readonly reportId: string;
  readonly from: string | undefined;
  readonly to: string | undefined;
  /** ดึงย้อนหลัง N วันจากวันนี้ — ใช้คู่กับ `from`/`to` ไม่ได้ (ดู `resolveRunPlan`) */
  readonly lastDays: number | undefined;
  /** โหมดรอบรายวัน — ใช้คู่กับ from/to/lastDays ไม่ได้ (ดู `resolveRunPlan`) */
  readonly daily: boolean;
  /** รอบเก็บตก — ใช้คู่กับ `daily` เท่านั้น: รันเฉพาะใบที่สถานะล่าสุดในโฟลเดอร์ของวันนี้ยังล้ม */
  readonly retryFailed: boolean;
  readonly overlapDays: number | undefined;
  /** โหมด baseline — ใช้คู่กับ from/to/lastDays ไม่ได้ (ดู `resolveRunPlan`) */
  readonly baseline: boolean;
  readonly baselineIntervalDays: number | undefined;
  readonly format: OutputFormat;
  readonly headful: boolean;
  /** หน่วงทุก action (ms) ให้คนดูทันตอน --headful · undefined = ใช้ค่าจาก .env */
  readonly slowMoMs: number | undefined;
  readonly json: boolean;
};

/**
 * ค่าพิเศษของ `--report` ที่หมายถึง "ทุกรายงานในทะเบียน เรียงตามลำดับใน REPORTS"
 *
 * ไม่ใช่ id ของรายงานจริง จึงต้องเช็คก่อน `findReport()` เสมอ · แต่ละรายงานยังเปิด session
 * ของตัวเองเหมือนเดิม ไม่ได้ใช้ session ร่วมกัน เพราะการแทน `_raw/<report>/` และการเขียน
 * manifest ต่อรายงานต้องแยกกันอยู่แล้ว การรวม session จะได้ความเร็วแต่แลกกับความเสี่ยง
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
  readonly format: OutputFormat;
  readonly rawDir: string | null;
  readonly manifest: string | null;
  /** `year` มีเฉพาะ CSV รายปี (baseline/back-fill) — รอบรายวันเป็นไฟล์เดียวต่อรายงาน */
  readonly files: readonly { readonly year?: number; readonly rows: number; readonly path: string; readonly sha256: string }[];
};

type ChunkOutcome =
  | {
      readonly kind: 'data';
      readonly verdict: ChunkVerdict;
      /** ชื่อไฟล์ที่ HotelTime เสนอมา เก็บไว้เป็นหลักฐานที่มา */
      readonly sourceName: string;
      readonly sha256: string;
      readonly bytes: number;
    }
  | { readonly kind: 'empty'; readonly range: DateRange };

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

  return {
    kind: 'data',
    verdict: verifyChunk(report, range, dest, reportedRowCount),
    sourceName: suggestedFilename,
    sha256,
    bytes: bytes.byteLength,
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

/** แปลงคอลัมน์วันที่ทุกตัวให้เป็น DD/MM/YYYY เหมือนกันหมด ก่อนเขียน CSV */
function normalizeRow(row: readonly string[], dateColIdx: readonly number[]): string[] {
  const out = [...row];
  for (const i of dateColIdx) {
    const v = formatCellDate(out[i] ?? '');
    if (v !== null) out[i] = v;
  }
  return out;
}

/**
 * เขียน CSV ของรายงานหนึ่ง
 *
 * ชื่อไฟล์ขึ้นต้นด้วยช่วงข้อมูลจริงเสมอ (ADR-0005) · รอบรายวันได้ไฟล์เดียวต่อรายงาน เพราะครอบแค่ 1–3 วัน
 * · รอบอื่น (baseline/back-fill) ครอบหลายปีจึงแยกไฟล์ละปี ช่วงในชื่อคือส่วนของปีนั้นที่อยู่ในช่วงที่ขอ เช่น
 * `2024-01-01_2024-12-31__<id>.csv`, `2026-01-01_2026-10-07__<id>.csv`
 */
async function writeCsv(
  report: Report,
  outcomes: readonly ChunkOutcome[],
  outDir: string,
  runKind: RunKind,
  range: DateRange,
): Promise<{ file: string; year?: number; rows: number; sha256: string }[]> {
  const withData = outcomes.filter((o): o is Extract<ChunkOutcome, { kind: 'data' }> => o.kind === 'data');
  if (withData.length === 0) {
    // รันซ้ำในโฟลเดอร์เดิมแล้วไม่มีแถว = ผลใหม่คือ "ไม่มีข้อมูล" — ไฟล์ของรอบก่อนต้องไม่ค้างให้ขัดกับ _run.json
    await replaceReportCsvs(outDir, report.id, []);
    return [];
  }

  const first = withData[0]!.verdict.sheet;
  const header = first.header;
  const dateColIdx = report.dateColumns.map((c) => requireColumn(first, c));

  const byYear = new Map<number, string[][]>();

  if (report.dailyOnly || report.overlapColumns !== undefined) {
    // รายงานแบบคร่อมช่วง (city tax, profiles): ก้อนเดือน ม.ค. มีการเข้าพักที่เริ่ม ธ.ค. ด้วย — จัดกลุ่มตามปีของวันเริ่มรายแถวจะได้ชื่อไฟล์
    // กลับหัว (2025-01-01_2024-12-31) และยอดของ ม.ค. ไปอยู่ไฟล์ปีก่อน (code review ticket 17) จึงจัดตามปีของก้อนแทน
    // dailyOnly (ADR-0003) มีก้อนเดียวเสมอ ครอบวันเดียว — จัดกลุ่มด้วยปีของวันที่ query ตรง ๆ
    // ไม่ต้องพึ่งคอลัมน์วันที่รายแถวเลย เพราะบางรายงาน (เช่น Housekeeping) ไม่มีคอลัมน์ที่มีค่า
    // ครบทุกแถว (ห้องว่างไม่มีแขก ช่อง Arrival/Departure จึงว่าง) — วันเดียวไม่มีทาง "โกหกเนื้อใน"
    // แบบที่คอมเมนต์เดิมกังวลไว้กับก้อนที่ครอบหลายปี (RateCode ฯลฯ)
    for (const o of withData) {
      const year = o.verdict.range.from.getUTCFullYear();
      const rows = byYear.get(year) ?? [];
      for (const row of o.verdict.sheet.rows) rows.push(normalizeRow(row, dateColIdx));
      byYear.set(year, rows);
    }
  } else {
    const groupColIdx = requireColumn(first, report.dateColumn);

    /**
     * จัดกลุ่มตามปีของ "วันที่ในแถวนั้นเอง" ไม่ใช่ปีที่ก้อนเริ่ม
     *
     * จำเป็นเพราะรายงานที่ดึงทั้งช่วงทีเดียว (เช่น RateCode) มีก้อนเดียวที่เริ่มปี 2024
     * แต่ข้างในมีข้อมูลถึง 2026 — ถ้าจัดกลุ่มจากช่วงของก้อน จะได้ไฟล์ชื่อ 2024
     * ที่บรรจุข้อมูลสามปี ซึ่งชื่อไฟล์โกหกเนื้อใน
     */
    for (const o of [...withData].sort((a, b) => a.verdict.range.from.getTime() - b.verdict.range.from.getTime())) {
      for (const row of o.verdict.sheet.rows) {
        const d = parseCellDate(row[groupColIdx] ?? '');
        if (d === null) {
          throw new Error(
            `แถวหนึ่งไม่มีค่าในคอลัมน์ "${report.dateColumn}" จึงจัดปีให้ไม่ได้ — ` +
              `ชั้นตรวจควรดักไว้ตั้งแต่ verifyChunk แล้ว`,
          );
        }
        const year = d.getUTCFullYear();
        const rows = byYear.get(year) ?? [];
        rows.push(normalizeRow(row, dateColIdx));
        byYear.set(year, rows);
      }
    }
  }

  const years = [...byYear].sort((a, b) => a[0] - b[0]);

  if (runKind === 'daily') {
    const all = years.flatMap(([, rows]) => rows);
    const content = toCsv([...header], all);
    const [file] = await replaceReportCsvs(outDir, report.id, [{ name: dataFileName(range, report.id, 'csv'), content }]);
    return [{ file: file!, rows: all.length, sha256: sha256Of(content) }];
  }

  const next = years.map(([year, rows]) => {
    const span = {
      from: new Date(Math.max(range.from.getTime(), utcDate(year, 1, 1).getTime())),
      to: new Date(Math.min(range.to.getTime(), utcDate(year, 12, 31).getTime())),
    };
    return { year, rows: rows.length, name: dataFileName(span, report.id, 'csv'), content: toCsv([...header], rows) };
  });
  const files = await replaceReportCsvs(outDir, report.id, next);
  return next.map((n, i) => ({ file: files[i]!, year: n.year, rows: n.rows, sha256: sha256Of(n.content) }));
}

function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * แทน CSV ทั้งชุดของรายงานหนึ่งในโฟลเดอร์รอบด้วยผลใหม่ (`[]` = ผลใหม่ไม่มีแถว) · คืน path ไฟล์ใหม่ตามลำดับ
 *
 * เขียนไฟล์ชั่วคราวแล้ว rename ทับ ไฟล์ของรอบก่อนจึงไม่หายถ้าเขียนไม่สำเร็จ (ADR-0005) · ค่อยลบชื่อเก่า
 * ที่ไม่อยู่ในชุดใหม่ทีหลัง — ชื่ออาจต่างกันถ้าช่วงต่างจากรอบก่อน (เช่น --overlap-days) จึงหาด้วย suffix
 * ของ id · ไฟล์ของรายงานอื่นในโฟลเดอร์เดียวกันไม่ถูกแตะ (id ไม่มี `__`)
 */
async function replaceReportCsvs(
  outDir: string,
  reportId: string,
  next: readonly { readonly name: string; readonly content: string }[],
): Promise<string[]> {
  // เขียน .partial ให้ครบทุกไฟล์ก่อน แล้วค่อย rename ทีเดียว — ปีที่สองเขียนไม่สำเร็จต้องไม่ทิ้งชุดที่แทน
  // ไปครึ่งเดียว (ปีแรกเป็นของใหม่ ปีหลังเป็นของเก่า) ซึ่ง sha256 ใน _run.json จะไม่ตรงกับไฟล์จริง
  const files = next.map((n) => path.join(outDir, n.name));
  try {
    for (const [i, n] of next.entries()) await writeFile(`${files[i]}.partial`, n.content, 'utf8');
  } catch (err) {
    for (const f of files) await rm(`${f}.partial`, { force: true });
    throw err;
  }
  for (const f of files) await rename(`${f}.partial`, f);
  const keep = new Set(next.map((n) => n.name));
  for (const name of await readdir(outDir)) {
    if (name.endsWith(`__${reportId}.csv`) && !keep.has(name)) await rm(path.join(outDir, name));
  }
  return files;
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

/**
 * เขียนไฟล์กำกับที่มาไว้ข้าง ๆ ไฟล์ดิบ
 *
 * ทำให้ไฟล์ดิบใช้เป็น source of truth ได้จริง เพราะตอบได้ว่าแต่ละไฟล์มาจากหน้าไหน
 * กรองด้วยช่วงอะไร ดึงเมื่อไหร่ ได้กี่แถว และไบต์ยังเหมือนตอนดาวน์โหลดไหม (sha256)
 */
async function writeManifest(
  report: Report,
  cfg: Config,
  requested: DateRange,
  outcomes: readonly ChunkOutcome[],
  rawDir: string,
  runKind: RunKind,
  baselineIntervalDays: number | undefined,
): Promise<string> {
  const manifest = {
    report: report.id,
    label: report.label,
    source: new URL(report.path, `${cfg.baseUrl}/pms/`).toString(),
    filterColumn: report.dateColumn,
    filterNote: filterNoteFor(report),
    // 🔴 ปลายทาง (เช่น uploader) ใช้ค่านี้ตัดสินว่าไฟล์ไหนแทนที่ไฟล์ไหน โดยไม่ต้องรู้จัก
    // ตัวตนของแถวเลย — baseline ใบใหม่แทนที่ใบเก่าในระดับไฟล์ (ดู ADR-0002)
    runKind,
    ...(baselineIntervalDays !== undefined ? { baselineIntervalDays } : {}),
    requested: { from: formatISO(requested.from), to: formatISO(requested.to) },
    fetchedAt: new Date().toISOString(),
    chunkStrategy: report.chunk.kind,
    chunkReason: report.chunk.reason,
    totalRows: outcomes.reduce((n, o) => n + (o.kind === 'data' ? o.verdict.rowCount : 0), 0),
    files: outcomes
      .filter((o): o is Extract<ChunkOutcome, { kind: 'data' }> => o.kind === 'data')
      .map((o) => ({
        file: path.basename(o.verdict.filePath),
        from: formatISO(o.verdict.range.from),
        to: formatISO(o.verdict.range.to),
        rows: o.verdict.rowCount,
        actualFrom: formatISO(o.verdict.actualSpan.from),
        actualTo: formatISO(o.verdict.actualSpan.to),
        sourceName: o.sourceName,
        bytes: o.bytes,
        sha256: o.sha256,
      })),
    emptyRanges: outcomes
      .filter((o): o is Extract<ChunkOutcome, { kind: 'empty' }> => o.kind === 'empty')
      .map((o) => ({ from: formatISO(o.range.from), to: formatISO(o.range.to) })),
  };

  const file = path.join(rawDir, 'manifest.json');
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * ดึงหนึ่งรายงานให้จบ
 *
 * พิมพ์ความคืบหน้าและสรุปแบบคนอ่านเมื่อ `!json` แต่ **ไม่พิมพ์ JSON เอง** — คืน payload
 * ให้ผู้เรียกไปประกอบ เพราะโหมด `--report all` ต้องรวมหลายรายงานเป็นก้อน JSON เดียว
 * ถ้าล้มก็โยน error ออกไปตรง ๆ ผู้เรียกเป็นคนถือ redactor และเป็นคนตัดสินว่าจะหยุดหรือไปต่อ
 */
async function exportOne(
  opts: ExportOptions,
  cfg: Config,
  creds: Credentials,
  report: Report,
  redact: Redactor,
  outDir: string,
): Promise<ExportPayload> {
  const runOpts = {
    daily: opts.daily,
    overlapDays: opts.overlapDays,
    baseline: opts.baseline,
    baselineIntervalDays: opts.baselineIntervalDays,
    from: opts.from,
    to: opts.to,
    lastDays: opts.lastDays,
  };

  // รายงาน dailyOnly (ADR-0003) ไม่ผ่าน resolveRunPlan() ตามปกติ — วันนี้วันเดียวเสมอ
  // ไม่มี overlap/back-fill/baseline เพราะกรองด้วยวันปฏิบัติการ ไม่ใช่ created date
  let range: DateRange;
  let runKind: RunKind;
  let baselineIntervalDays: number | undefined;
  if (report.dailyOnly) {
    range = resolveDailyOnlyRange(runOpts, thaiToday());
    runKind = 'daily';
    baselineIntervalDays = undefined;
  } else {
    const plan = resolveRunPlan(runOpts, thaiToday());
    range = plan.range;
    runKind = plan.kind;
    baselineIntervalDays = plan.baselineIntervalDays;
  }

  // รายงานภาพรวมที่ค้นช่วงอื่น (ticket 26): ชื่อไฟล์และช่วงใน _run.json เป็นช่วงข้อมูลจริง ไม่ใช่วันที่ดึง
  const dataRange = report.dataWindow ? report.dataWindow(range.from) : range;
  const chunks = report.chunk.kind === 'monthly' ? monthChunks(range) : [range];
  assertContiguous(chunks, range);

  // ล้างของรอบก่อนทิ้งก่อนเสมอ — ไม่งั้นไฟล์ค้างจากรอบที่ล้มกลางทางจะปนกับรอบนี้
  // แล้ว manifest กับไฟล์ในโฟลเดอร์จะไม่ตรงกัน
  const rawDir = rawDirFor(outDir, report.id);
  // ดึงลงที่พักข้าง ๆ ก่อน แล้วค่อยสลับแทนของรอบก่อนเมื่อผ่านทุกด่าน — รันซ้ำแล้วล้มกลางทางต้องไม่ทำให้
  // ไฟล์ดิบที่ดีของรอบก่อนหายไป (ADR-0005) · ที่พักของรอบที่ตายกลางทางถูกล้างตรงนี้ก่อนเริ่มเสมอ
  const stagingRaw = `${rawDir}.partial`;
  await rm(stagingRaw, { recursive: true, force: true });
  await mkdir(stagingRaw, { recursive: true });

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
    console.log(`${chalk.dim('เก็บผลเป็น')} ${
      opts.format === 'raw' ? '.xlsx ดิบ + manifest (ไม่เขียน CSV)'
      : opts.format === 'csv' ? 'CSV รายปี (ลบไฟล์ดิบทิ้ง)'
      : 'ทั้ง .xlsx ดิบ + manifest และ CSV รายปี'}`);
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
    outcomes = await fetchAll(session, cfg, report, chunks, stagingRaw, log);
  } catch (err) {
    await rm(stagingRaw, { recursive: true, force: true });
    throw err;
  } finally {
    await session.close();
  }

  const dataChunks = outcomes.filter((o) => o.kind === 'data').length;
  const emptyChunks = outcomes.length - dataChunks;
  const verdicts = outcomes
    .filter((o): o is Extract<ChunkOutcome, { kind: 'data' }> => o.kind === 'data')
    .map((o) => o.verdict);

  const emptyRanges = outcomes
    .filter((o): o is Extract<ChunkOutcome, { kind: 'empty' }> => o.kind === 'empty')
    .map((o) => o.range);
  let merged: ReturnType<typeof verifyMerged>;
  let files: Awaited<ReturnType<typeof writeCsv>>;
  try {
    merged = verifyMerged(verdicts, emptyRanges, range);
    // manifest ก่อน CSV — ทุกอย่างที่ล้มได้ต้องเกิดก่อนเริ่มแทนของเดิม ลำดับคือ "ตรวจผ่าน → บันทึกที่มา →
    // แทน CSV → สลับไฟล์ดิบ"
    if (opts.format !== 'csv') {
      await writeManifest(report, cfg, range, outcomes, stagingRaw, runKind, baselineIntervalDays);
    }
    // --format raw ไม่เขียน CSV แต่ชุดไฟล์ของรายงานนี้ในโฟลเดอร์ต้องตรงกับ _run.json — CSV ของรอบก่อนจึงถูก
    // แทนด้วยชุดว่าง (ข้อยกเว้นเดียวของ ADR-0005: ผลใหม่ที่ผ่านแทนไฟล์ของรายงานเดียวกันในโฟลเดอร์เดียวกัน)
    files = opts.format === 'raw'
      ? (await replaceReportCsvs(outDir, report.id, []), [])
      : await writeCsv(report, outcomes, outDir, runKind, dataRange);
  } catch (err) {
    await rm(stagingRaw, { recursive: true, force: true });
    throw err;
  }
  // --format csv ก็เช่นกัน: ไฟล์ดิบของรอบก่อนถูกแทนด้วย "ไม่เก็บไฟล์ดิบ" ตามที่สั่ง
  await rm(rawDir, { recursive: true, force: true });
  let manifestPath: string | null = null;
  if (opts.format === 'csv') {
    await rm(stagingRaw, { recursive: true, force: true });
  } else {
    await rename(stagingRaw, rawDir);
    manifestPath = path.join(rawDir, 'manifest.json');
  }
  // รายงานที่ข้ามด่านวันที่ไม่ได้วัดช่วงจริง (actualSpan = ช่วงที่สั่ง) — อย่าบันทึกว่าเป็นช่วงที่พบจริง
  const actualRange = verdicts.length === 0 || report.skipDateCoverageCheck
    ? null
    : {
        from: formatISO(new Date(verdicts.reduce((a, v) => Math.min(a, v.actualSpan.from.getTime()), Infinity))),
        to: formatISO(new Date(verdicts.reduce((a, v) => Math.max(a, v.actualSpan.to.getTime()), -Infinity))),
      };

  if (!opts.json) {
    console.log();
    console.log(`${chalk.dim('ก้อนที่มีข้อมูล')}  ${dataChunks}  ${chalk.dim(`(ว่าง ${emptyChunks})`)}`);
    console.log(`${chalk.dim('แถวรวม')}          ${merged.totalRows.toLocaleString()}`);
    console.log(`${chalk.dim('ครอบคลุมช่วง')}    ${chalk.green('✔ ปูเต็มไม่มีรู')}  ${chalk.dim(`(${merged.coveredChunks} ก้อน)`)}`);
    console.log();
    for (const f of files) {
      console.log(`${chalk.green('✔')} ${path.basename(f.file)}  ${String(f.rows).padStart(6)} แถว`);
    }
    if (manifestPath !== null) {
      console.log(`${chalk.green('✔')} ${path.relative(outDir, rawDir)}/  ${String(dataChunks).padStart(6)} ไฟล์ .xlsx ดิบ + manifest.json`);
    }
  }

  return {
    report: report.id,
    runKind,
    range: { from: formatISO(dataRange.from), to: formatISO(dataRange.to) },
    chunks: { total: outcomes.length, withData: dataChunks, empty: emptyChunks },
    totalRows: merged.totalRows,
    actualRange,
    format: opts.format,
    rawDir: opts.format === 'csv' ? null : rawDir,
    manifest: manifestPath,
    files: files.map((f) => ({ year: f.year, rows: f.rows, path: f.file, sha256: f.sha256 })),
  };
}

type Failure = { readonly code: 'config' | 'export_failed'; readonly text: string };

/** แปลง error เป็นข้อความที่ redact แล้ว — ConfigError เป็นข้อความของเราเอง ส่วน error อื่นอาจมี stack/credential */
function failureOf(err: unknown, redact: Redactor): Failure {
  return err instanceof ConfigError
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

export async function runExport(opts: ExportOptions): Promise<number> {
  let redact: Redactor = createRedactor([]);

  try {
    const cfg = loadConfig();

    const many = opts.reportId === ALL_REPORTS;
    let { run: reports, skipped } = many
      ? partitionForRunAll(REPORTS, opts, thaiToday())
      : { run: [requireReport(opts.reportId)], skipped: [] };

    // ตัดสินครั้งเดียวต่อรอบ ทุกรายงานใน --report all ต้องลงโฟลเดอร์เดียวกัน · resolveRunPlan
    // โยนเรื่อง flag ขัดกันที่นี่ได้เลย (ข้อความเดียวกับที่ exportOne จะโยน)
    const plan = resolveRunPlan(opts, thaiToday());
    const runKind = plan.kind;
    const startedAt = new Date();
    const outDir = runFolder(cfg.dataDir, 'hoteltime', runKind, plan.range, startedAt);
    const outLabel = `${path.relative(cfg.projectRoot, outDir)}/`;

    // รอบเก็บตก (ticket 07): รันซ้ำเฉพาะใบที่ยังล้มในโฟลเดอร์ของวันนี้ · ยังไม่มีรอบของวันนี้เลย = ทำเหมือน
    // รอบรายวันปกติ (เช่น รอบเที่ยงไม่ได้รันเพราะเครื่องหลับ) · ไม่มีใบล้ม = จบตรงนี้ ไม่เปิดเบราว์เซอร์
    // ก่อนโหลด credential โดยตั้งใจ — รอบ 15:00/18:00 ที่ไม่มีอะไรต้องทำต้องจบเขียวแม้ .env จะมีปัญหา
    if (opts.retryFailed) {
      const targets = selectRetryTargets(await readRunRecord(outDir), reports);
      if (targets.kind === 'nothing') {
        if (opts.json) {
          // shape เดียวกับ exported_all — ผู้อ่านที่วน failed[] / reports[] ไม่ต้องมีกรณีพิเศษ
          console.log(JSON.stringify({
            ok: true, code: 'nothing_to_retry', text: targets.message,
            reports: [], failed: [], skipped: [], totalRows: 0, format: opts.format, outDir,
          }, null, 2));
        } else {
          console.log(`${chalk.green('✔')} ${targets.message}  ${chalk.dim(outLabel)}`);
        }
        return 0;
      }
      if (targets.kind === 'retry') {
        reports = [...targets.reports];
        skipped = [];
        if (!opts.json) console.log(`${chalk.dim('เก็บตก')}    ${reports.map((r) => r.id).join(', ')}\n`);
      }
    }

    const creds = loadCredentials();
    redact = createRedactor([creds.password, creds.username]);
    if (many && !opts.json) {
      for (const sk of skipped) console.log(`${chalk.yellow('⏭ ข้าม')}  ${sk.report} — ${sk.reason}`);
      if (skipped.length > 0) console.log();
    }
    if (!opts.json) {
      const note = runKind === 'baseline'
        ? '(โฟลเดอร์ของวันนี้ — baseline ใบเก่าเก็บไว้ ใบที่ผ่านล่าสุดเป็นใบอ้างอิงรายใบ)'
        : runKind === 'daily'
          ? '(โฟลเดอร์ของวันสุดท้ายที่ข้อมูลครอบคลุม)'
          : '(โฟลเดอร์ของรอบนี้ แยกจากรอบรายวัน)';
      console.log(`${chalk.dim('ผลรอบนี้')}  ${outLabel}  ${chalk.dim(note)}`);
      console.log();
    }

    const done: ExportPayload[] = [];
    const failed: (Failure & { readonly report: string })[] = [];
    const attempts = new Map<string, number>();

    for (const [i, report] of reports.entries()) {
      if (many && !opts.json) {
        if (i > 0) console.log();
        console.log(chalk.bold(`${chalk.dim(`[${i + 1}/${reports.length}]`)} ${report.id}`));
        console.log(chalk.dim('─'.repeat(72)));
      }
      // แต่ละครั้งที่ลองเปิด session ใหม่และล็อกอินใหม่ (exportOne ทำเองทั้งหมด) · ลองใหม่เฉพาะความผิดพลาด
      // ชั่วคราว — ชนเพดานแถว/verify ไม่ผ่าน/รหัสผิด คืนความล้มเหลวทันที (ดู core/retry.ts)
      const outcome = await withBrowserRetry(() => exportOne(opts, cfg, creds, report, redact, outDir), {
        label: report.id,
        describe: (err) => failureOf(err, redact).text,
        ...(opts.json ? {} : { log: (line: string) => console.error(chalk.yellow(line)) }),
      });
      attempts.set(report.id, outcome.attempts);
      if (outcome.ok) {
        done.push(outcome.value);
      } else {
        // รายงานหนึ่งล้มไม่ควรพาที่เหลือล้มไปด้วย — การดึงย้อนหลังใช้เวลาหลายนาที
        // ถ้าใบที่สองสะดุดแล้วทิ้งใบที่สามไปเลย คนใช้ต้องรันใหม่ทั้งก้อนโดยไม่จำเป็น
        // ConfigError ของรายงานใบเดียว (เช่น dailyOnly โดยไม่ใส่ --daily) ไม่ใช่ "รอบที่ล้ม" — ไม่ต้อง
        // ทิ้ง _run.json ไว้ในโฟลเดอร์ที่ยังไม่ได้ดึงอะไรเลย ปล่อยให้ catch ข้างล่างรายงานตามเดิม
        if (!many && outcome.error instanceof ConfigError) throw outcome.error;
        const f = failureOf(outcome.error, redact);
        failed.push({ report: report.id, ...f });
        if (many && !opts.json) console.error(`${chalk.red('✘ ไม่สำเร็จ')}  ${report.id}\n${f.text}`);
      }
    }

    const totalRows = done.reduce((n, p) => n + p.totalRows, 0);


    const outcomes: ReportOutcome[] = [
      ...done.map((p): ReportOutcome => ({
        report: p.report,
        status: 'ok',
        rows: p.totalRows,
        range: p.range,
        actualRange: p.actualRange,
        files: p.files.map((f) => ({ file: path.relative(outDir, f.path), rows: f.rows, sha256: f.sha256 })),
        attempts: attempts.get(p.report) ?? 1,
      })),
      ...failed.map((f): ReportOutcome => ({
        report: f.report,
        status: 'failed',
        error: f.text,
        attempts: attempts.get(f.report) ?? 1,
      })),
    ];
    // ทุกชนิดรอบบันทึกผลรายใบ — baseline ที่บางใบล้ม ใบที่ผ่านใช้ได้ทันที ใบที่ล้มใช้ baseline ก่อนหน้า
    // ไปก่อน ตามกฎ currentBaselineFor() ใน run-record
    await recordRun(outDir, {
      site: 'hoteltime',
      kind: runKind,
      dataThrough: formatISO(plan.range.to),
      startedAt,
      finishedAt: new Date(),
      outcomes,
      skipped,
      ...(runKind !== 'manual' ? { latest: latestPointer(cfg.dataDir, 'hoteltime', runKind) } : {}),
    });

    if (!many && failed.length > 0) {
      printFailure(opts, failed[0]!.code, failed[0]!.text);
      return 1;
    }

    if (opts.json) {
      console.log(JSON.stringify(
        many
          ? {
              ok: failed.length === 0,
              code: 'exported_all',
              reports: done,
              failed,
              skipped,
              totalRows,
              format: opts.format,
              outDir,
            }
          : { ok: true, code: 'exported', ...done[0]!, outDir },
        null,
        2,
      ));
    } else if (many) {
      console.log();
      console.log(chalk.dim('═'.repeat(72)));
      console.log(`${chalk.dim('รายงานที่สำเร็จ')}  ${done.length}/${reports.length}`);
      console.log(`${chalk.dim('แถวรวมทุกใบ')}    ${totalRows.toLocaleString()}`);
      for (const p of done) {
        console.log(`  ${chalk.green('✔')} ${p.report.padEnd(24)} ${String(p.totalRows).padStart(6)} แถว  ${chalk.dim(`(${p.chunks.withData} ก้อน · ว่าง ${p.chunks.empty})`)}`);
      }
      for (const f of failed) {
        console.log(`  ${chalk.red('✘')} ${f.report}`);
      }
      for (const sk of skipped) {
        console.log(`  ${chalk.yellow('⏭')} ${sk.report.padEnd(24)} ${chalk.dim('ข้าม — ดึงได้เฉพาะ --daily')}`);
      }
    }
    if (!opts.json && done.length > 0) {
      console.log();
      if (runKind === 'baseline' && failed.length > 0) {
        console.log(`${chalk.yellow('⚠ baseline ของใบที่ล้มยังเป็นของรอบก่อน')}  ${chalk.dim('ใบที่ผ่านเป็นใบอ้างอิงใหม่แล้ว')}`);
      }
      console.log(`${chalk.dim('ไฟล์อยู่ที่')}  ${outLabel}  ${chalk.dim('(สรุปใน _summary.txt)')}`);
    }

    // 0 = ผ่านหมด · 2 = ผ่านบางใบ · 1 = ไม่ได้อะไรเลย
    return exitCodeFor(outcomes);
  } catch (err) {
    const f = failureOf(err, redact);
    printFailure(opts, f.code, f.text);
    return 1;
  }
}
