import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { formatISO, parseISODate, type DateRange } from '../../core/order.ts';
import { dailyFolder, dataFileName, latestPointer, pictureFileName } from '../../core/placement.ts';
import { publishRawFiles, recordPublished, type RawFileEntry } from '../../core/raw-manifest.ts';
import { createRedactor, redactError, type Redactor } from '../../core/redact.ts';
import { isTransientOnSamePage, withBrowserRetry } from '../../core/retry.ts';
import {
  daysToRead, periodCloseId, planDailyRun, planWarnings, storeStateFrom, type PlannedReport,
} from '../../core/run-planner.ts';
import { exitCodeFor, readRunRecord, recordRun, type ReportOutcome, type RunRecord } from '../../core/run-record.ts';
import { thaiIsoString, thaiToday } from '../../core/thai-time.ts';
import { XlsxError, readSheetNames } from '../../core/xlsx.ts';
import { loadConfig, loadCredentials, type Config } from './config.ts';
import { foodstoryDailySteps, type FoodStoryStep } from './daily-steps.ts';
import { DateRangeNotAppliedError } from './interactions.ts';
import {
  closeSessionWithTimeout, exportOneReport, exportReservationReport, exportSaleByChannel, groupOf, resetSessionDateRange,
  type FoodStoryExportOptions, type FoodStoryReportResult,
} from './export.ts';
import { ID as RESERVATION_ID } from './reservation-report.ts';
import { ALL_IDS, REPORTS, familyOf, plannedReports } from './reports/index.ts';
import { login, openSession } from './session.ts';

/**
 * รอบรายวันของ FoodStory ตามโมเดลใหม่ (ADR-0008/0009, ใบ 06) — พนักงานกดปุ่มครั้งเดียว (captcha ครั้งเดียว) แล้วได้:
 * **รายงานตามวัน** ของเมื่อวาน พร้อม**รอบเก็บตก**วันของข้อมูลที่ยังไม่สำเร็จตั้งแต่วันเริ่มใช้งาน (ไม่เกินจำนวนวันสูงสุดต่อรอบ) ลงโฟลเดอร์ของวันนั้น ·
 * **รายงาน snapshot** ณ เวลาที่กดลงโฟลเดอร์ของวันนี้ · **snapshot ปิดงวด**ของ salebymonthsum ช่วงต้นปี · ชื่อไฟล์ ISO + `_manifest.json` รูปเดียวกับ HotelTime
 * (ใบ 02) · ไม่มีงาน = จบโดยไม่ login (ไม่ต้องกด captcha) · รอบรายเดือนยังเป็นแบบเดิม (export.ts)
 */

const SESSION_FILTER = 'ช่วงวันที่ระดับ session (วันขาย)';
const SESSION_FILTER_NOTE = 'FoodStory กรองทุกรายงานด้วยช่วงวันที่ของ session ที่ตั้งครั้งเดียวต่อรอบ (สเปกต้นทาง §4.2) — รายงาน snapshot ไม่กรองตามวัน';

/** ผลของรายงานหนึ่งตัวในวันหนึ่ง พร้อมว่าไปลงโฟลเดอร์ไหน */
type Done = { readonly step: Extract<FoodStoryStep, { kind: 'report' | 'reservation' }>; readonly result: FoodStoryReportResult; readonly fetchedAt: Date };

export async function runFoodStoryDaily(opts: FoodStoryExportOptions): Promise<number> {
  let redact: Redactor = createRedactor([]);
  try {
    const cfg = loadConfig();
    const now = new Date();
    const today = formatISO(thaiToday(now));
    const folderOf = (day: string) => {
      const d = parseISODate(day)!;
      return dailyFolder(cfg.dataDir, 'foodstory', { from: d, to: d });
    };

    if (opts.reportId !== 'all' && !ALL_IDS.includes(opts.reportId)) {
      console.error(`ไม่รู้จักรายงาน "${opts.reportId}"`);
      return 1;
    }
    const planned: PlannedReport[] = plannedReports().filter((r) => opts.reportId === 'all' || r.id === opts.reportId);

    const warnings: string[] = [];
    const folders: { day: string; record: RunRecord }[] = [];
    for (const day of daysToRead({ now, goLive: cfg.goLive })) {
      try {
        const record = await readRunRecord(folderOf(day));
        if (record !== null) folders.push({ day, record });
      } catch (err) {
        warnings.push(`อ่าน _run.json ของวัน ${day} ไม่ได้ (${(err as Error).message.split('\n')[0]}) — ถือว่าวันนั้นยังไม่ได้ดึง`);
      }
    }
    const plan = planDailyRun({ now, reports: planned, state: storeStateFrom(folders, planned), goLive: cfg.goLive });
    warnings.push(...planWarnings(plan, cfg.goLive, { dateOption: false }));
    const steps = foodstoryDailySteps(plan);
    if (!opts.json) for (const w of warnings) console.log(`⚠ ${w}`);

    if (steps.length === 0) {
      const text = 'ไม่มีงานค้าง — รายงานของวันที่ถึงกำหนดและรายงาน snapshot ของวันนี้ได้ครบแล้ว ไม่ต้อง login';
      if (opts.json) console.log(JSON.stringify({ ok: true, code: 'nothing_to_do', text, warnings, outDirs: [] }, null, 2));
      else console.log(`✔ ${text}`);
      return 0;
    }

    const creds = loadCredentials();
    redact = createRedactor([creds.password, creds.email]);
    const session = await openSession({ ...cfg, headless: opts.headful ? false : cfg.headless, slowMoMs: opts.slowMoMs ?? cfg.slowMoMs });
    const { page } = session;
    // ลองใหม่บน page เดิมที่ล็อกอินค้างไว้ — ไม่ล็อกอินใหม่ เพราะต้องมีคนกด captcha (ADR-0006)
    const retry = <T>(task: () => Promise<T>, label: string, isRetryable = isTransientOnSamePage) =>
      withBrowserRetry(task, {
        label, describe: (err) => redactError(err, redact), isRetryable,
        ...(opts.json ? {} : { log: (line: string) => console.log(line) }),
      });

    const done: Done[] = [];
    const todo = steps.filter((s) => s.kind !== 'set-range').length;
    const failed = (step: Done['step'], note: string): FoodStoryReportResult => {
      const id = step.kind === 'reservation' ? RESERVATION_ID : step.report;
      return { id, label: id, group: groupOf(id), path: '', status: 'failed', rowCountReported: null, rowsExported: null, files: [], note };
    };
    try {
      await login(session, cfg, creds);
      if (!opts.json) console.log(`✔ login สำเร็จ — งาน ${todo} รายการ`);
      let range: DateRange | null = null;
      let rangeError: string | null = null; // ตั้งช่วงไม่สำเร็จ = ทุกรายงานของช่วงนั้นล้ม (ไม่ export ผิดช่วง)
      let onReservationHost = false;
      for (const step of steps) {
        if (step.kind === 'set-range') {
          const d = parseISODate(step.day)!;
          range = { from: d, to: d };
          const r = range;
          // ช่วงไม่ขึ้นตามที่พิมพ์ = ตั้งใหม่ทั้งขั้น (resetSessionDateRange เปิด salebysumdate ใหม่) — ดู DateRangeNotAppliedError
          const outcome = await retry(
            () => resetSessionDateRange(page, cfg, r), `ตั้งช่วง ${step.day}`,
            (err) => err instanceof DateRangeNotAppliedError || isTransientOnSamePage(err),
          );
          rangeError = outcome.ok ? null : `ตั้งช่วงวันที่ ${step.day} ไม่สำเร็จ: ${redactError(outcome.error, redact)}`;
          continue;
        }
        const staging = path.join(cfg.downloadDir, step.kind === 'reservation' ? RESERVATION_ID : step.report);
        let result: FoodStoryReportResult;
        if (step.kind === 'reservation') {
          const d = parseISODate(step.day)!;
          const navigate = !onReservationHost;
          const outcome = await retry(() => exportReservationReport(page, cfg, { from: d, to: d }, staging, step.day, navigate), RESERVATION_ID);
          onReservationHost = true;
          result = outcome.ok ? outcome.value : failed(step, redactError(outcome.error, redact));
        } else if (rangeError !== null || range === null) {
          result = failed(step, rangeError ?? 'ยังไม่ได้ตั้งช่วงวันที่');
        } else {
          const r = range;
          const report = REPORTS.find((x) => x.id === step.report);
          const outcome = await retry(
            () => (report ? exportOneReport(page, cfg, report, r, staging, step.day) : exportSaleByChannel(page, cfg, r, staging, step.day)),
            step.report,
          );
          result = outcome.ok ? outcome.value : failed(step, redactError(outcome.error, redact));
        }
        done.push({ step, result, fetchedAt: new Date() });
        if (!opts.json) {
          const tail = result.status === 'failed' ? (result.note ?? '') : `${String(result.rowsExported ?? '-').padStart(6)} แถว`;
          const label = step.kind === 'report' && step.periodClose ? `${result.id} (snapshot ปิดงวด)` : result.id;
          console.log(`[${done.length}/${todo}] ${step.day}  ${result.status.padEnd(9)} ${label.padEnd(28)} ${tail.split('\n')[0]}`);
        }
      }
    } finally {
      await closeSessionWithTimeout(session);
    }

    return await finish(opts, cfg, done, folderOf, today, warnings, now);
  } catch (err) {
    const text = redactError(err, redact);
    if (opts.json) console.log(JSON.stringify({ ok: false, code: 'export_failed', text }, null, 2));
    else console.error(`✘ ไม่สำเร็จ\n${text}`);
    return 1;
  }
}

/** ชื่อไฟล์ ISO (ADR-0007): รายงานตามวัน = วันของข้อมูล · snapshot = เวลาที่ได้ไฟล์ · snapshot ปิดงวด = ช่วงของงวด (ปี) · ผ่าครึ่งหลายไฟล์ = `<id>_part<n>` */
function rawName(d: Done, file: string, index: number, count: number): string {
  const id = d.result.id;
  const slug = count > 1 ? `${id}_part${index + 1}` : id;
  const ext = path.extname(file).slice(1) || 'xlsx';
  const day = parseISODate(d.step.day)!;
  if (d.step.kind === 'report' && d.step.periodClose) {
    return dataFileName('foodstory', { from: parseISODate(`${d.step.day.slice(0, 4)}-01-01`)!, to: day }, slug, ext);
  }
  return familyOf(id) === 'picture' ? pictureFileName('foodstory', d.fetchedAt, slug, ext) : dataFileName('foodstory', { from: day, to: day }, slug, ext);
}

async function entryOf(d: Done, file: string, name: string, cfg: Config): Promise<RawFileEntry> {
  const bytes = await readFile(file);
  const periodClose = d.step.kind === 'report' && d.step.periodClose;
  const range = periodClose ? { from: `${d.step.day.slice(0, 4)}-01-01`, to: d.step.day } : { from: d.step.day, to: d.step.day };
  let sheets: readonly string[] = [];
  if (file.endsWith('.xlsx')) {
    try {
      sheets = readSheetNames(file);
    } catch (err) {
      if (!(err instanceof XlsxError)) throw err;
    }
  }
  return {
    file: name,
    site: 'foodstory',
    report: d.result.id,
    label: d.result.label,
    family: familyOf(d.result.id),
    runKind: 'daily',
    range,
    actualRange: null,
    takenAt: thaiIsoString(d.fetchedAt),
    ...(d.result.files.length === 1 && d.result.rowsExported !== null ? { rows: d.result.rowsExported } : {}),
    sheets,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: d.result.path.startsWith('http') ? d.result.path : `${cfg.baseUrl}${d.result.path}`,
    filterColumn: SESSION_FILTER,
    filterNote: SESSION_FILTER_NOTE,
    ...(periodClose ? { periodClose: true as const } : {}),
  };
}

/**
 * วางไฟล์ของแต่ละผลลงโฟลเดอร์ของวันนั้น (ไม่ลบไม่ทับ — `_superseded/` ADR-0005) · บันทึก `_manifest.json` ทันทีต่อรายงาน (crash กลางทางแล้ว manifest ไม่ค้าง) · แล้ว `_run.json`
 * ต่อโฟลเดอร์ (เก่าไปใหม่ — `latest` เลื่อนเฉพาะโฟลเดอร์ของวันนี้ · คำเตือนบันทึกเฉพาะโฟลเดอร์ใหม่สุด) · truncated = ล้ม ไม่วางไฟล์ที่ไม่ครบ
 */
async function finish(
  opts: FoodStoryExportOptions,
  cfg: Config,
  done: readonly Done[],
  folderOf: (day: string) => string,
  today: string,
  warnings: readonly string[],
  startedAt: Date,
): Promise<number> {
  const days = [...new Set(done.map((d) => d.step.day))].sort();
  const outcomes: ReportOutcome[] = [];
  const outDirs: string[] = [];
  for (const day of days) {
    const outDir = folderOf(day);
    outDirs.push(outDir);
    const folderOutcomes: ReportOutcome[] = [];
    for (const d of done.filter((x) => x.step.day === day)) {
      const recordId = d.step.kind === 'report' && d.step.periodClose ? periodCloseId(d.result.id) : d.result.id;
      const attempts = d.result.attempts ?? 1;
      const { status } = d.result;
      if (status === 'failed' || status === 'truncated') {
        folderOutcomes.push({ report: recordId, status: 'failed', error: d.result.note ?? status, attempts });
        continue;
      }
      const placed = await Promise.all(d.result.files.map(async (f, i) => {
        const name = rawName(d, f, i, d.result.files.length);
        return { staged: f, entry: await entryOf(d, f, name, cfg) };
      }));
      // ว่างแบบไม่มีไฟล์ (reservation-report 0 แถวไม่มีอะไรให้ดาวน์โหลด) — ไม่มีอะไรให้วาง และโฟลเดอร์อาจยังไม่มีถ้ารายงานอื่นของวันนั้นล้มหมด
      // (รันจริงใบ 06: readdir ENOENT ล้มทั้งรอบ) · `recordRun` สร้างโฟลเดอร์เอง
      if (placed.length > 0) {
        const movedAt = new Date();
        const moved = await publishRawFiles(outDir, placed, movedAt);
        await recordPublished(outDir, placed.map((p) => p.entry), moved, new Set(await readdir(outDir)), thaiIsoString(movedAt));
      }
      folderOutcomes.push({
        report: recordId,
        status: 'ok',
        rows: status === 'empty' ? 0 : (d.result.rowsExported ?? 0),
        range: { from: d.step.day, to: d.step.day },
        actualRange: null,
        files: placed.map((p) => ({ file: p.entry.file, ...(p.entry.rows !== undefined ? { rows: p.entry.rows } : {}), sha256: p.entry.sha256 })),
        attempts,
      });
    }
    await recordRun(outDir, {
      site: 'foodstory', kind: 'daily', dataThrough: day, startedAt, finishedAt: new Date(), outcomes: folderOutcomes,
      ...(day === days.at(-1) ? { warnings } : {}),
      ...(day === today ? { latest: latestPointer(cfg.dataDir, 'foodstory', 'daily') } : {}),
    });
    outcomes.push(...folderOutcomes);
  }

  const failedCount = outcomes.filter((o) => o.status === 'failed').length;
  if (opts.json) {
    console.log(JSON.stringify({ ok: failedCount === 0, code: 'exported_all', reports: outcomes, warnings, outDirs }, null, 2));
  } else {
    console.log(`\nสำเร็จ ${outcomes.length - failedCount}/${outcomes.length} — ล้ม ${failedCount}`);
    for (const d of outDirs) console.log(`ไฟล์อยู่ที่ ${path.relative(cfg.dataDir, d)}/ (สรุปใน _summary.txt)`);
    for (const w of warnings) console.log(`⚠ ${w}`);
  }
  return exitCodeFor(outcomes);
}
