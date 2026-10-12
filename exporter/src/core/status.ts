import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatISO, utcDate } from './order.ts';
import type { RunRecord } from './run-record.ts';
import { thaiClock, type ThaiClock } from './thai-time.ts';

/**
 * `exporter status` (Ubuntu ticket 05) — สรุปภาษาไทยหน้าเดียวว่าระบบปกติไหม สำหรับเครื่องที่ไม่มี AI ช่วยอ่าน อ่านจาก `_run.json`
 * ในคลังเท่านั้น (ไม่เปิดเบราว์เซอร์ ไม่ต้องมี .env)
 *
 * กติกา (เจ้าของระบบเลือก 2026-10-12):
 * - HotelTime รันเอง (Windmill 12:00 + เก็บตก 15:00/18:00): วันที่ผ่านมาขาด/มีใบล้ม/ไม่จบ = ปัญหา · วันนี้ยังไม่มีรอบหลัง 15:00 = ปัญหา
 *   (ก่อนนั้น = รอ) · วันนี้มีใบล้ม หลัง 18:30 = ปัญหา (ก่อนนั้น = รอรอบเก็บตก)
 * - FoodStory รายวัน คนกด: เมื่อวานยังไม่ได้ดึง = สิ่งที่ต้องทำ · ดึงแล้วมีใบล้ม = ปัญหา · วันก่อนหน้าที่ขาดแค่แสดง (รอบรายเดือนครอบคลุม)
 * - FoodStory รายเดือนของเดือนที่แล้ว (รวมทุกโฟลเดอร์ของเดือนนั้น): ยังไม่มีหลังวันที่ 5 = สิ่งที่ต้องทำ · มีใบที่ไม่เคยผ่านเลย = ปัญหา
 * - วันก่อนรอบแรกสุดของแต่ละ Site ไม่นับว่าขาด (เครื่องใหม่เริ่มคลังจากศูนย์) · `_run.json` อ่านไม่ได้ = ปัญหาเสมอ
 */

export type FailedReport = { readonly report: string; readonly error: string };
/** `running` = มีโฟลเดอร์แต่ยังไม่มี `_run.json` (กำลังรัน หรือรอบนั้นตายกลางทาง) · `unreadable` = `_run.json` เสีย/ผิดรูป */
export type RunState = 'done' | 'running' | 'unreadable';
type Counts = {
  readonly passed: number;
  readonly total: number;
  readonly failed: readonly FailedReport[];
  /** ใบที่ล้มรอบหลังสุดแต่ไฟล์ที่ผ่านของรอบก่อนยังอยู่ — นับว่าได้ (`_summary.txt` ยังแสดง ✘ ของรอบหลังสุด) */
  readonly fromEarlier?: number;
  readonly state?: RunState;
};
/** รอบรายวันหนึ่งโฟลเดอร์ (สถานะล่าสุดรวมทุกรอบของวันนั้น) · `day` = วันของข้อมูล */
export type DayRun = Counts & { readonly day: string };
/** รอบรายเดือนของเดือนหนึ่ง รวมทุกโฟลเดอร์ของเดือนนั้น · `pulledOn` = วันที่ดึงล่าสุด (เวลาไทย) */
export type MonthRun = Counts & { readonly period: string; readonly pulledOn: string };
export type StoreSnapshot = {
  readonly hoteltime: readonly DayRun[];
  readonly foodstoryDaily: readonly DayRun[];
  readonly foodstoryMonthly: readonly MonthRun[];
};
export type StatusLevel = 'ok' | 'info' | 'wait' | 'action' | 'problem';
export type StatusLine = { readonly level: StatusLevel; readonly text: string };
export type StatusSection = { readonly title: string; readonly lines: readonly StatusLine[] };
export type StatusReport = {
  /** เวลาไทย `YYYY-MM-DD HH:MM` */
  readonly at: string;
  readonly verdict: 'ok' | 'action' | 'problem';
  readonly problems: readonly string[];
  readonly actions: readonly string[];
  readonly sections: readonly StatusSection[];
};

const WINDMILL_RUNS = 'http://localhost:8000/runs';
const HOTELTIME_TODAY_DEADLINE_MIN = 15 * 60; // รอบเที่ยงใช้ ~1.5–2 ชม. — 15:00 แล้วยังไม่มี = รอบเที่ยงไม่ได้รัน
const HOTELTIME_CATCHUP_DONE_MIN = 18 * 60 + 30; // รอบเก็บตกสุดท้าย 18:00
const MONTHLY_DUE_DAY = 5;

const pad2 = (n: number) => String(n).padStart(2, '0');

function failSummary(failed: readonly FailedReport[]): string {
  const names = failed.slice(0, 4).map((f) => f.report).join(', ');
  const more = failed.length > 4 ? ` และอีก ${failed.length - 4} ใบ` : '';
  return `${names}${more} (${failed[0]?.error.split('\n')[0] ?? ''})`;
}
const counted = (r: Counts) => `${r.passed}/${r.total}${r.fromEarlier ? ` (ใช้ไฟล์รอบก่อน ${r.fromEarlier} ใบ)` : ''}`;

/** สะสมบรรทัดของหนึ่งหัวข้อ พร้อมรายการปัญหา/สิ่งที่ต้องทำรวมของทั้งรายงาน */
class SectionBuilder {
  readonly lines: StatusLine[] = [];
  readonly #problems: string[];
  readonly #actions: string[];
  constructor(problems: string[], actions: string[]) {
    this.#problems = problems;
    this.#actions = actions;
  }
  add(level: StatusLevel, text: string): void {
    if (level === 'problem') this.#problems.push(text);
    if (level === 'action') this.#actions.push(text);
    this.lines.push({ level, text });
  }
}

type Day = { readonly clock: ThaiClock; readonly offset: (k: number) => string; readonly minutes: number };

function hoteltimeSection(runs: readonly DayRun[], day: Day, windowDays: number, out: SectionBuilder): void {
  if (runs.length === 0) {
    out.add('problem', `ยังไม่เคยมีรอบ HotelTime เลย — เช็คว่าเปิด Windmill และตั้งค่าแล้ว (node windmill/setup.mjs) แล้วดูที่ ${WINDMILL_RUNS}`);
    return;
  }
  const byDay = new Map(runs.map((r) => [r.day, r]));
  const first = [...byDay.keys()].sort()[0]!;
  const today = day.offset(0);
  const run = byDay.get(today);
  if (!run) {
    if (day.minutes < HOTELTIME_TODAY_DEADLINE_MIN) out.add('wait', `วันนี้ ${today} ยังไม่มีรอบ — รอรอบเที่ยง (12:00, ใช้ราว 1.5–2 ชม.)`);
    else out.add('problem', `วันนี้ ${today} ยังไม่มีรอบเลย ทั้งที่เลย 15:00 แล้ว — ดูที่ ${WINDMILL_RUNS} (เครื่องดับ/Windmill ไม่ทำงาน?)`);
  } else if (run.state === 'running') {
    out.add('wait', `วันนี้ ${today} กำลังรัน (เริ่มแล้ว ยังไม่จบ)`);
  } else if (run.state === 'unreadable') {
    out.add('problem', `_run.json ของวันนี้ (${today}) อ่านไม่ได้ (ไฟล์เสีย) — ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ`);
  } else if (run.failed.length === 0) {
    out.add('ok', `วันนี้ ${today}  ${counted(run)}`);
  } else if (day.minutes < HOTELTIME_CATCHUP_DONE_MIN) {
    out.add('wait', `วันนี้ ${today} ล้ม ${run.failed.length} ใบ: ${failSummary(run.failed)} — รอรอบเก็บตก 15:00/18:00`);
  } else {
    out.add('problem', `วันนี้ ${today} ยังล้ม ${run.failed.length} ใบหลังรอบเก็บตก: ${failSummary(run.failed)} — ดู _summary.txt ของวันนี้`);
  }

  const missing: string[] = [];
  let checked = 0;
  let pastProblems = 0;
  for (let k = 1; k < windowDays; k++) {
    const d = day.offset(k);
    if (d < first) break; // ก่อนรอบแรกสุด = เครื่องยังไม่ได้เริ่มเก็บ ไม่ใช่ขาด
    checked++;
    const past = byDay.get(d);
    if (!past) missing.push(d);
    else if (past.state === 'running') { pastProblems++; out.add('problem', `รอบของ ${d} ไม่จบ (ไม่มีบันทึกผล) — ดูที่ ${WINDMILL_RUNS}`); }
    else if (past.state === 'unreadable') { pastProblems++; out.add('problem', `_run.json ของ ${d} อ่านไม่ได้ (ไฟล์เสีย) — ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ`); }
    else if (past.failed.length > 0) { pastProblems++; out.add('problem', `${d} ล้ม ${past.failed.length} ใบ: ${failSummary(past.failed)}`); }
  }
  if (missing.length > 0) out.add('problem', `ไม่มีรอบของวันที่ ${missing.reverse().join(', ')} — ดูที่ ${WINDMILL_RUNS}`);
  else if (checked > 0 && pastProblems === 0) out.add('ok', `${checked} วันก่อนหน้าครบทุกวัน`);
}

function foodstoryDailySection(runs: readonly DayRun[], day: Day, windowDays: number, out: SectionBuilder): void {
  const byDay = new Map(runs.map((r) => [r.day, r]));
  const yesterday = day.offset(1);
  const run = byDay.get(yesterday);
  if (!run) out.add('action', `ยังไม่ได้ดึงของเมื่อวาน (${yesterday}) — ดับเบิลคลิก "ดึง FoodStory เมื่อวาน" บน Desktop แล้วกด captcha`);
  else if (run.state === 'running') out.add('wait', `เมื่อวาน ${yesterday} กำลังดึงอยู่ — ถ้าไม่มีหน้าต่างไหนรันอยู่ ให้ดับเบิลคลิกใหม่`);
  else if (run.state === 'unreadable') out.add('problem', `_run.json ของเมื่อวาน (${yesterday}) อ่านไม่ได้ (ไฟล์เสีย) — ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ`);
  else if (run.failed.length > 0) out.add('problem', `เมื่อวาน ${yesterday} ล้ม ${run.failed.length} ใบ: ${failSummary(run.failed)} — ดับเบิลคลิกใหม่ ถ้ายังล้มแจ้งผู้ดูแลระบบ`);
  else out.add('ok', `เมื่อวาน ${yesterday}  ${counted(run)}`);

  if (runs.length === 0) return;
  const first = [...byDay.keys()].sort()[0]!;
  const skipped: string[] = [];
  for (let k = windowDays - 1; k >= 2; k--) {
    const d = day.offset(k);
    if (d >= first && !byDay.has(d)) skipped.push(d.slice(5));
  }
  if (skipped.length > 0) out.add('info', `วันที่ไม่ได้กด: ${skipped.join(' ')} (รอบรายเดือนครอบคลุมให้)`);
  const last = [...byDay.keys()].sort().at(-1)!;
  if (!run && last < yesterday) out.add('info', `ดึงครั้งล่าสุดเป็นข้อมูลวันที่ ${last}`);
}

function foodstoryMonthlySection(runs: readonly MonthRun[], day: Day, out: SectionBuilder): void {
  const lastOfPrev = utcDate(day.clock.year, day.clock.month, 0); // วันที่ 0 ของเดือนนี้ = วันสุดท้ายของเดือนที่แล้ว
  const period = `${lastOfPrev.getUTCFullYear()}-${pad2(lastOfPrev.getUTCMonth() + 1)}`;
  const run = runs.find((m) => m.period === period);
  const command = 'ในโฟลเดอร์ exporter รัน: node src/index.ts export --site foodstory --report all --headful (ต้องกด captcha)';
  if (!run) {
    if (day.clock.day > MONTHLY_DUE_DAY) out.add('action', `ยังไม่ได้ดึงรายเดือนของ ${period} — ${command}`);
    else out.add('info', `ยังไม่ได้ดึงรายเดือนของ ${period} — ควรดึงภายในวันที่ ${MONTHLY_DUE_DAY}`);
  } else if (run.state === 'unreadable') {
    out.add('problem', `_run.json ของรายเดือน ${period} อ่านไม่ได้ (ไฟล์เสีย) — ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ`);
  } else if (run.failed.length > 0) {
    out.add('problem', `${period} มี ${run.failed.length} ใบที่ยังไม่เคยดึงสำเร็จ: ${failSummary(run.failed)} — ${command}`);
  } else {
    out.add('ok', `${period}  ${counted(run)} (ดึงล่าสุด ${run.pulledOn})`);
  }
}

export function buildStatus(snapshot: StoreSnapshot, now: Date, opts: { readonly windowDays?: number } = {}): StatusReport {
  const windowDays = opts.windowDays ?? 7;
  const clock = thaiClock(now);
  const day: Day = {
    clock,
    offset: (k) => formatISO(utcDate(clock.year, clock.month, clock.day - k)),
    minutes: clock.hour * 60 + clock.minute,
  };
  const problems: string[] = [];
  const actions: string[] = [];
  const section = (title: string, fill: (out: SectionBuilder) => void): StatusSection => {
    const out = new SectionBuilder(problems, actions);
    fill(out);
    return { title, lines: out.lines };
  };
  const sections = [
    section('HotelTime (รันเองทุกวัน 12:00 · เก็บตก 15:00/18:00)', (out) => hoteltimeSection(snapshot.hoteltime, day, windowDays, out)),
    section('FoodStory รายวัน (พนักงานกด)', (out) => foodstoryDailySection(snapshot.foodstoryDaily, day, windowDays, out)),
    section('FoodStory รายเดือน', (out) => foodstoryMonthlySection(snapshot.foodstoryMonthly, day, out)),
  ];
  return {
    at: `${day.offset(0)} ${pad2(clock.hour)}:${pad2(clock.minute)}`,
    verdict: problems.length > 0 ? 'problem' : actions.length > 0 ? 'action' : 'ok',
    problems,
    actions,
    sections,
  };
}

const MARK: Readonly<Record<StatusLevel, string>> = { ok: '✔', info: '·', wait: '⏳', action: '⚠', problem: '✘' };

export function renderStatus(report: StatusReport): string {
  const out = [`exporter status — ${report.at} (เวลาไทย)`];
  for (const s of report.sections) out.push('', s.title, ...s.lines.map((l) => `  ${MARK[l.level]} ${l.text}`));
  out.push('');
  if (report.verdict === 'ok') out.push('✅ ปกติ — ไม่ต้องทำอะไร');
  if (report.problems.length > 0) out.push(`✘ ต้องดู ${report.problems.length} เรื่อง — ทำตามข้อความด้านบน ถ้าแก้เองไม่ได้ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ`);
  if (report.actions.length > 0) out.push(`⚠ มีสิ่งที่ต้องทำ ${report.actions.length} อย่าง (ดู ⚠ ด้านบน)`);
  return `${out.join('\n')}\n`;
}

// ── อ่านคลังจริง ──

/** `exporter/data` — คำนวณจากที่อยู่ไฟล์นี้ ไม่ผ่าน config ของ Site (ไม่ต้องมี .env) */
export function defaultDataDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
}

const list = (dir: string) => readdir(dir).catch(() => [] as string[]);

/** `_run.json` ของโฟลเดอร์: ไม่มีไฟล์ = `running` · JSON เสีย/ไม่มี `reports` = `unreadable` (ไม่ให้ทั้งคำสั่งพังเพราะไฟล์เดียว) */
async function loadRecord(folder: string): Promise<RunRecord | 'running' | 'unreadable'> {
  let text: string;
  try {
    text = await readFile(path.join(folder, '_run.json'), 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'running' : 'unreadable';
  }
  try {
    const record = JSON.parse(text) as RunRecord;
    return record && typeof record.reports === 'object' && record.reports !== null && Array.isArray(record.runs) ? record : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

const EMPTY: Counts = { passed: 0, total: 0, failed: [] };

/** รวมสถานะรายใบจากหลายบันทึก (เรียงเก่า → ใหม่): ใบที่เคยผ่านที่ไหนก็ได้ = มีไฟล์แล้ว · ไม่เคยผ่านเลย = ล้ม (error ล่าสุด) */
function mergeCounts(records: readonly RunRecord[]): Counts {
  const everOk = new Set<string>();
  const latest = new Map<string, RunRecord['reports'][string]>();
  for (const r of records) {
    for (const [id, o] of Object.entries(r.reports)) {
      latest.set(id, o);
      if (o.status === 'ok' || (o.status === 'failed' && o.previousOk)) everOk.add(id);
    }
  }
  const failed: FailedReport[] = [];
  let fromEarlier = 0;
  for (const [id, o] of latest) {
    if (o.status === 'ok') continue;
    if (everOk.has(id)) fromEarlier++;
    else failed.push({ report: id, error: o.error });
  }
  return { passed: latest.size - failed.length, total: latest.size, failed, ...(fromEarlier ? { fromEarlier } : {}) };
}

function countsOf(record: RunRecord | 'running' | 'unreadable'): Counts {
  if (record === 'running' || record === 'unreadable') return { ...EMPTY, state: record };
  return mergeCounts([record]);
}

async function readDaily(dataDir: string, site: 'hoteltime' | 'foodstory'): Promise<DayRun[]> {
  const root = path.join(dataDir, site, 'daily');
  const runs: DayRun[] = [];
  for (const month of (await list(root)).filter((m) => /^\d{4}-\d{2}$/.test(m))) {
    for (const day of (await list(path.join(root, month))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
      runs.push({ day, ...countsOf(await loadRecord(path.join(root, month, day))) });
    }
  }
  return runs;
}

/** รายเดือน: หลายโฟลเดอร์ของเดือนเดียวกัน (ดึงซ้ำบางใบ/อีกวัน) รวมเป็นผลเดียว — ไม่ใช่โฟลเดอร์ล่าสุดโฟลเดอร์เดียว */
async function readMonthly(dataDir: string): Promise<MonthRun[]> {
  const root = path.join(dataDir, 'foodstory', 'monthly');
  const byPeriod = new Map<string, { records: { at: string; record: RunRecord }[]; unreadable: boolean }>();
  for (const name of (await list(root)).filter((n) => /^\d{4}-\d{2}(__\d{4}-\d{2}-\d{2})?$/.test(n))) {
    const record = await loadRecord(path.join(root, name));
    if (record === 'running') continue; // ยังดึงไม่จบ — ดูรอบถัดไป
    const entry = byPeriod.get(name.slice(0, 7)) ?? { records: [], unreadable: false };
    if (record === 'unreadable') entry.unreadable = true;
    else entry.records.push({ at: record.runs.at(-1)?.finishedAt ?? '', record });
    byPeriod.set(name.slice(0, 7), entry);
  }
  const runs: MonthRun[] = [];
  for (const [period, { records, unreadable }] of byPeriod) {
    const sorted = records.sort((a, b) => a.at.localeCompare(b.at));
    const lastAt = sorted.at(-1)?.at;
    const c = lastAt ? thaiClock(new Date(lastAt)) : null;
    const pulledOn = c ? formatISO(utcDate(c.year, c.month, c.day)) : '-';
    runs.push({ period, pulledOn, ...mergeCounts(sorted.map((s) => s.record)), ...(unreadable ? { state: 'unreadable' as const } : {}) });
  }
  return runs;
}

export async function readStoreSnapshot(dataDir: string): Promise<StoreSnapshot> {
  return {
    hoteltime: await readDaily(dataDir, 'hoteltime'),
    foodstoryDaily: await readDaily(dataDir, 'foodstory'),
    foodstoryMonthly: await readMonthly(dataDir),
  };
}
