import { mkdir, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunKind } from './order.ts';
import { thaiClock } from './thai-time.ts';
import type { SiteId } from './placement.ts';
import { PERIOD_CLOSE_SUFFIX } from './run-planner.ts';

/**
 * บันทึกผลรอบ — `_run.json` (เครื่องอ่าน) + `_summary.txt` (คนอ่าน) ในโฟลเดอร์รอบ และตัวชี้ `latest`
 *
 * ใช้ร่วมทุก Site · รันซ้ำในโฟลเดอร์เดิม (รอบเก็บตก หรือรันรายงานใบเดียวซ้ำ) **รวม**กับผลเดิม
 * ใบที่รันใหม่แทนผลเดิมของใบนั้น ใบอื่นคงเดิม — หนึ่งวันจึงมีสรุปเดียวที่บอกสถานะล่าสุดเสมอ
 * · `_run.json` เป็นสัญญากับปลายทางในอนาคต (uploader) เปลี่ยน shape ต้องคิดถึงคนอ่านด้วย
 */

type OkOutcome = Extract<ReportOutcome, { status: 'ok' }>;

export type ReportOutcome =
  | {
      readonly report: string;
      readonly status: 'ok';
      readonly rows: number;
      /** ช่วงที่ขอ (และที่ตรวจแล้วว่าปูเต็มไม่มีรู) */
      readonly range: { readonly from: string; readonly to: string };
      /** ช่วงวันที่ที่พบจริงในข้อมูล · null = ไม่มีแถวเลย */
      readonly actualRange: { readonly from: string; readonly to: string } | null;
      /**
       * ไฟล์ข้อมูลที่คนเปิดใช้ (ชื่อ relative กับโฟลเดอร์รอบ) · `rows` ไม่มี = ไม่รู้จำนวนต่อไฟล์ (FoodStory ที่ผ่าเป็นหลายไฟล์ รู้แค่ยอดรวม)
       */
      readonly files: readonly { readonly file: string; readonly rows?: number; readonly sha256: string }[];
      readonly attempts: number;
    }
  | {
      readonly report: string;
      readonly status: 'failed';
      /** ข้อความที่ redact แล้ว — ห้ามส่ง error ดิบที่อาจมี credential เข้ามา */
      readonly error: string;
      readonly attempts: number;
    };

export type SkippedReport = { readonly report: string; readonly reason: string };

/** ชนิดรอบในคลัง — ของ HotelTime (`RunKind`) + รอบรายเดือนของ FoodStory */
export type StoreKind = RunKind | 'monthly';

export type RunRecordInput = {
  readonly site: SiteId;
  readonly kind: StoreKind;
  /** วันสุดท้ายที่ข้อมูลของรอบนี้ครอบคลุม (YYYY-MM-DD) */
  readonly dataThrough: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly outcomes: readonly ReportOutcome[];
  readonly skipped?: readonly SkippedReport[];
  /** path ของตัวชี้ `latest` — เลื่อนมาที่โฟลเดอร์นี้เมื่อรอบนี้ผ่านอย่างน้อยหนึ่งใบ · ไม่ใส่ = ไม่แตะ */
  readonly latest?: string;
  /** คำเตือนของรอบนี้ที่คนต้องเห็น (เช่น วันที่ขาดเกินเพดาน, ยังไม่ได้ตั้งวันเริ่มใช้งาน) — บันทึกไว้ในรายการรอบและ `_summary.txt` */
  readonly warnings?: readonly string[];
};

export type RecordedOutcome =
  | (OkOutcome & { readonly finishedAt: string })
  | (Extract<ReportOutcome, { status: 'failed' }> & {
      readonly finishedAt: string;
      readonly previousOk?: OkOutcome & { readonly finishedAt: string };
    });

export type RunRecord = {
  readonly site: SiteId;
  readonly kind: StoreKind;
  readonly dataThrough: string;
  readonly runs: readonly {
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly reports: readonly string[];
    readonly warnings?: readonly string[];
  }[];
  /**
   * สถานะล่าสุดของแต่ละใบ · ใบที่ล้มในรอบนี้แต่เคยผ่านในโฟลเดอร์เดียวกันมาก่อน มี `previousOk` — ไฟล์ของ
   * รอบนั้นยังอยู่ เพราะการแทนไฟล์เกิดเฉพาะตอนผ่าน
   */
  readonly reports: Readonly<Record<string, RecordedOutcome>>;
  readonly skipped: readonly SkippedReport[];
};

const RECORD_FILE = '_run.json';
const SUMMARY_FILE = '_summary.txt';

/**
 * 0 = ผ่านหมด · 2 = ผ่านบางใบ · 1 = ไม่ได้อะไรเลย (ConfigError ของทั้งรอบ ผู้เรียกคืน 1 เองก่อนถึงตรงนี้)
 * · ไม่มีใบไหนต้องรันเลย (ทุกใบถูกข้าม) = 0 เพราะไม่มีอะไรล้ม — พฤติกรรมเดิมก่อนมีบันทึกผลรอบ
 */
export function exitCodeFor(outcomes: readonly ReportOutcome[]): 0 | 1 | 2 {
  if (outcomes.length === 0) return 0;
  const passed = outcomes.filter((o) => o.status === 'ok').length;
  if (passed === 0) return 1;
  return passed === outcomes.length ? 0 : 2;
}

export async function readRunRecord(folder: string): Promise<RunRecord | null> {
  try {
    return JSON.parse(await readFile(path.join(folder, RECORD_FILE), 'utf8')) as RunRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function recordRun(folder: string, input: RunRecordInput): Promise<RunRecord> {
  await mkdir(folder, { recursive: true });
  const previous = await readRunRecord(folder);
  const finishedAt = input.finishedAt.toISOString();

  const reports: Record<string, RecordedOutcome> = { ...(previous?.reports ?? {}) };
  for (const o of input.outcomes) {
    const before = reports[o.report];
    const previousOk = before?.status === 'ok' ? before : before?.previousOk;
    reports[o.report] = o.status === 'failed' && previousOk !== undefined
      ? { ...o, finishedAt, previousOk }
      : { ...o, finishedAt };
  }

  const record: RunRecord = {
    site: input.site,
    kind: input.kind,
    dataThrough: input.dataThrough,
    runs: [
      ...(previous?.runs ?? []),
      {
        startedAt: input.startedAt.toISOString(),
        finishedAt,
        reports: input.outcomes.map((o) => o.report),
        ...(input.warnings !== undefined && input.warnings.length > 0 ? { warnings: input.warnings } : {}),
      },
    ],
    reports,
    skipped: mergeSkipped(previous?.skipped ?? [], input.skipped ?? [], input.outcomes),
  };

  await writeFile(path.join(folder, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await writeFile(path.join(folder, SUMMARY_FILE), renderSummary(record), 'utf8');
  if (input.latest !== undefined && input.outcomes.some((o) => o.status === 'ok')) {
    await pointLatest(input.latest, folder);
  }
  return record;
}

/**
 * baseline ปัจจุบันของ (รายงาน, **วันของข้อมูล**) = โฟลเดอร์ baseline ล่าสุดที่วันนั้นของรายงานนั้นมีไฟล์ที่ผ่านอยู่ (ADR-0002/0005, ใบ 09 —
 * baseline ไฟล์ละวัน บันทึกใน `_run.json` ด้วย id `<รายงาน>@<วัน>`)
 *
 * รอบ baseline ที่บางวันล้มไม่ถูกทิ้งทั้งรอบ — วันที่ผ่านใช้ได้ทันที วันที่ล้มใช้ของโฟลเดอร์ก่อนหน้าไปก่อน
 * · วันที่ล้มในการรันซ้ำวันเดียวกันแต่มี `previousOk` ยังนับ เพราะไฟล์ของรอบที่ผ่านยังอยู่ในโฟลเดอร์นั้น
 * · คืน null ถ้ายังไม่เคยมี baseline ที่วันนั้นผ่านเลย
 */
export async function currentBaselineFor(baselineDir: string, reportId: string, day: string): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(baselineDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  // ชื่อโฟลเดอร์ baseline คือ YYYY-MM-DD (ดู runFolder ใน placement.ts) — เรียงตามตัวอักษร = เรียงตามวัน
  // · ไม่มี production code เรียกตอนนี้ ปลายทางที่จะใช้คือขาส่งเข้า uploader (ticket 08 เดิม)
  for (const name of names.filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse()) {
    const folder = path.join(baselineDir, name);
    const entry = (await readRunRecord(folder))?.reports[`${reportId}@${day}`];
    if (entry?.status === 'ok' || (entry?.status === 'failed' && entry.previousOk !== undefined)) return folder;
  }
  return null;
}

/** รายการที่ข้ามสะสมข้ามรอบเหมือนผลรายใบ — ใบที่รอบนี้รันจริงหลุดออกจากรายการ ใบที่ข้ามใหม่แทนเหตุผลเดิม */
function mergeSkipped(
  previous: readonly SkippedReport[],
  now: readonly SkippedReport[],
  outcomes: readonly ReportOutcome[],
): SkippedReport[] {
  const replaced = new Set([...now.map((s) => s.report), ...outcomes.map((o) => o.report)]);
  return [...previous.filter((s) => !replaced.has(s.report)), ...now];
}

const SITE_LABEL: Readonly<Record<SiteId, string>> = { hoteltime: 'HotelTime', foodstory: 'FoodStory' };
const KIND_LABEL: Readonly<Record<StoreKind, string>> = {
  daily: 'รอบรายวัน',
  baseline: 'baseline',
  manual: 'back-fill',
  monthly: 'รอบรายเดือน',
};

/** เวลาไทย (ticket 27) — ไม่ใช้ getter แบบ local เพราะ job บน Windmill เป็น UTC */
function localTime(iso: string): string {
  const c = thaiClock(new Date(iso));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${c.year}-${p(c.month)}-${p(c.day)} ${p(c.hour)}:${p(c.minute)}`;
}

function renderSummary(record: RunRecord): string {
  const all = Object.values(record.reports).sort((a, b) => a.report.localeCompare(b.report));
  const passed = all.filter((r) => r.status === 'ok');
  const failedList = all.filter((r) => r.status === 'failed');
  const width = Math.max(12, ...all.map((r) => r.report.length), ...record.skipped.map((s) => s.report.length));
  const last = record.runs[record.runs.length - 1]!;

  const lines = [
    // โฟลเดอร์ที่มีแต่ภาพปิดงวด (วันสุดท้ายของงวดก่อนวันเริ่มใช้งาน/ก่อนเครื่องเริ่มเก็บ) ไม่ใช่รอบรายวันของวันนั้น (ใบ 07)
    all.length > 0 && all.every((r) => r.report.endsWith(PERIOD_CLOSE_SUFFIX))
      ? `${SITE_LABEL[record.site]} · ภาพปิดงวดของงวดที่จบวันที่ ${record.dataThrough} (ไม่มีรายงานของวันนั้นในโฟลเดอร์นี้)`
      : `${SITE_LABEL[record.site]} · ${KIND_LABEL[record.kind]} · ข้อมูลถึง ${record.dataThrough}`,
    `รันล่าสุด ${localTime(last.finishedAt)} (รันในโฟลเดอร์นี้ ${record.runs.length} ครั้ง)`,
    ...(last.warnings ?? []).map((w) => `⚠ ${w}`),
    '',
    `ผ่าน ${passed.length}/${all.length}` +
      (failedList.length > 0 ? ` · ล้ม ${failedList.length}` : '') +
      (record.skipped.length > 0 ? ` · ข้าม ${record.skipped.length}` : ''),
    '',
  ];
  for (const r of all) {
    if (r.status === 'ok') {
      const span = r.range.from === r.range.to ? r.range.from : `${r.range.from} → ${r.range.to}`;
      const retry = r.attempts > 1 ? `  (ลอง ${r.attempts} ครั้ง)` : '';
      lines.push(`✔ ${r.report.padEnd(width)}  ${String(r.rows).padStart(6)} แถว  ${span}${retry}`);
    } else {
      const firstLine = r.error.split('\n')[0] ?? '';
      lines.push(`✘ ${r.report.padEnd(width)}  ล้ม (ลอง ${r.attempts} ครั้ง): ${firstLine}`);
      if (r.previousOk !== undefined) {
        lines.push(`  ${' '.repeat(width)}  ไฟล์ที่ผ่านของรอบก่อน (${localTime(r.previousOk.finishedAt)}, ${r.previousOk.rows} แถว) ยังอยู่`);
      }
    }
  }
  for (const s of record.skipped) lines.push(`⏭ ${s.report.padEnd(width)}  ข้าม: ${s.reason}`);
  // FoodStory (รายเดือนและรายวัน): xlsx คือไฟล์ข้อมูลเลย ไม่มี _raw/ — manifest อยู่ที่ _manifest.json (ticket 03/10)
  const provenance = record.site === 'foodstory'
    ? 'ที่มาของแต่ละไฟล์ + การเช็คไขว้ยอดขายอยู่ใน _manifest.json'
    : 'ไฟล์ดิบอยู่ในโฟลเดอร์นี้ (ชื่อ ISO) · ที่มาของแต่ละไฟล์อยู่ใน _manifest.json';
  lines.push('', `${provenance} · ข้อมูลเต็มของรอบอยู่ใน _run.json`, '');
  return lines.join('\n');
}

/**
 * สลับ `latest` ให้ชี้ `folder` แบบ atomic (สร้างตัวชี้ชั่วคราวแล้ว rename ทับ) · path เป็น relative
 * เพื่อให้คลังทั้งก้อนย้ายเครื่องหรือ mount ที่อื่นได้ · ระบบที่สร้าง symlink ไม่ได้ ใช้ไฟล์ข้อความแทน
 */
async function pointLatest(latest: string, folder: string): Promise<void> {
  const target = path.relative(path.dirname(latest), folder);
  const tmp = `${latest}.tmp-${process.pid}`;
  await rm(tmp, { force: true });
  try {
    await symlink(target, tmp);
  } catch (err) {
    // เฉพาะระบบที่สร้าง symlink ไม่ได้จริง ๆ (เช่น บาง mount ของ Windows/SMB) — error อื่นต้องดังออกไป
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP') throw err;
    await writeFile(`${latest}.txt`, `${target}\n`, 'utf8');
    return;
  }
  await rename(tmp, latest);
}
