import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import { addDaysISO, formatISO, utcDate } from './order.ts';
import {
  CATCH_UP_CAP_DAYS, GO_LIVE_ENV, PERIOD_CLOSE_SUFFIX, PERIOD_CLOSE_WINDOW_DAYS, isDone, lastDueDay, parseGoLive, periodCloseRetryUntil, planDailyRun,
  stateKey, storeStateFrom, type DayStatus, type PlannedItem, type PlannedReport,
} from './run-planner.ts';
import type { RunRecord } from './run-record.ts';
import { thaiClock, thaiDateOf, thaiToday, type ThaiClock } from './thai-time.ts';
import type { UploadBacklogView } from './uploader.ts';

/**
 * `exporter status` (Ubuntu ticket 05 → ใบ 07 ของ exporter-daily-per-day-raw) — สรุปภาษาไทยหน้าเดียวว่าระบบปกติไหม สำหรับเครื่องที่ไม่มี AI
 * ช่วยอ่าน อ่านจาก `_run.json` ในคลัง + ค่าตั้งสองค่าใน `.env` (ไม่เปิดเบราว์เซอร์ ไม่อ่านรหัสผ่าน)
 *
 * พูดภาษาของโมเดลใหม่ (ADR-0008/0009, CONTEXT.md): ต่อ Site × **วันของข้อมูล** — รายงานตามวันแต่ละตัวเป็น มีข้อมูล / ว่าง / ล้ม / ยังไม่ได้ดึง
 * (สถานะเดียวกับที่ตัววางแผนใช้ตัดสินว่าต้องดึงอะไร — `storeStateFrom`) · รายงานภาพที่ถ่ายในวันนั้น · ภาพปิดงวดแยกเป็นเรื่องของงวด
 *
 * กติกา:
 * - HotelTime รันเอง (Windmill 12:00 + เก็บตก 15:00/18:00): เมื่อวานยังไม่ได้ดึงหลัง 15:00 / ล้มหลัง 18:30 = ปัญหา (ก่อนนั้น = รอ) · วันก่อนหน้า
 *   ที่ขาด/ล้ม = ปัญหา (รอบไหนก็เติมเองได้ — ยังขาดแปลว่ารอบไม่ได้รันหรือล้มซ้ำ) · รายงานภาพของวันนี้เหมือนเมื่อวาน
 * - FoodStory คนกด: ยังไม่ได้ดึง / รายงานภาพของวันนี้ยังไม่ได้ถ่าย = สิ่งที่ต้องทำบรรทัดเดียว "กด" (บอกว่าไม่ได้กดมากี่วัน) · ล้ม = ปัญหา
 * - รายงานภาพของวันที่ผ่านไปแล้วที่หาย = บอกว่าหายถาวร เติมไม่ได้ (ไม่ใช่ปัญหา — ไม่มีอะไรให้ทำ · user story 30)
 * - วันก่อน **วันเริ่มใช้งาน** (หรือก่อนวันแรกที่มีผลแบบใหม่ ถ้ายังไม่ได้ตั้ง) ไม่นับว่าขาด · โฟลเดอร์ของรอบรูปแบบเดิมแสดงเป็นประวัติ
 * - วันขาดเกินที่รอบเดียวเติมได้ / ยังไม่ตั้ง (หรือตั้งผิด) วันเริ่มใช้งาน / ยังไม่ตั้ง URL ของ webhook = สิ่งที่ต้องทำ · `_run.json` อ่านไม่ได้ = ปัญหาเสมอ
 * - ภาพปิดงวด: แบบเดียวกับรายงานตามวัน (HotelTime รอถึง 18:30 ของวันแรกของงวดถัดไป) · พ้นช่วงลองซ้ำ = ปัญหา "หายถาวร" (เจ้าของเลือก 2026-10-14)
 * - FoodStory รายเดือนของเดือนที่แล้ว: ยังไม่มีหลังวันที่ 5 = สิ่งที่ต้องทำ · มีใบที่ไม่เคยผ่านเลย = ปัญหา
 *
 * `--json` = `StatusReport` ทั้งก้อน — `sites` (ทุกวัน/ทุกงวดมี `level` + `note` ตามกติกาข้างบน) คือโครงสร้างที่ใบ 08 ใช้สร้างข้อความ Discord
 * โดยไม่ต้องคิดกติกาเวลาซ้ำ
 */

/**
 * ชื่อตัวแปรใน `.env` ของ URL webhook ของ Discord — แยก channel ระหว่างการ export กับการ upload (เจ้าของระบบขอ
 * 2026-10-18) ใบ 08 ใช้ชื่อนี้ · status บอกแค่ว่าตั้งแล้วหรือยัง ไม่เคยแสดงค่า
 */
export const WEBHOOK_ENV_EXPORT = 'DISCORD_WEBHOOK_URL_EXPORT';
export const WEBHOOK_ENV_UPLOAD = 'DISCORD_WEBHOOK_URL_UPLOAD';
/** ชนิดของ webhook — ตัวส่ง (ใบ 08) ใช้เลือกว่าจะอ่าน URL ของ channel ไหน */
export type WebhookChannel = 'export' | 'upload';
const WEBHOOK_ENV: Readonly<Record<WebhookChannel, string>> = { export: WEBHOOK_ENV_EXPORT, upload: WEBHOOK_ENV_UPLOAD };

export type FailedReport = { readonly report: string; readonly error: string };
/** `running` = มีโฟลเดอร์แต่ยังไม่มี `_run.json` (กำลังรัน หรือรอบนั้นตายกลางทาง) · `unreadable` = `_run.json` เสีย/ผิดรูป */
export type RunState = 'running' | 'unreadable';
/** โฟลเดอร์รายวันหนึ่งโฟลเดอร์ · `day` = วันของโฟลเดอร์ (วันของข้อมูล / วันที่ถ่ายรายงานภาพ / วันสุดท้ายของงวด) */
export type Folder = { readonly day: string; readonly record: RunRecord | RunState };
type Counts = {
  readonly passed: number;
  readonly total: number;
  readonly failed: readonly FailedReport[];
  /** ใบที่ล้มรอบหลังสุดแต่ไฟล์ที่ผ่านของรอบก่อนยังอยู่ — นับว่าได้ */
  readonly fromEarlier?: number;
  readonly state?: 'unreadable';
};
/** รอบรายเดือนของเดือนหนึ่ง รวมทุกโฟลเดอร์ของเดือนนั้น · `pulledOn` = วันที่ดึงล่าสุด (เวลาไทย) */
export type MonthRun = Counts & { readonly period: string; readonly pulledOn: string };
export type StoreSnapshot = {
  readonly hoteltime: readonly Folder[];
  readonly foodstoryDaily: readonly Folder[];
  readonly foodstoryMonthly: readonly MonthRun[];
};
/** แคตตาล็อก (ตระกูล/งวด) ของแต่ละ Site + ค่าตั้งของเครื่อง · `goLiveError` = ตั้งไว้แต่อ่านไม่ออก */
export type StatusSetup = {
  readonly catalog: { readonly hoteltime: readonly PlannedReport[]; readonly foodstory: readonly PlannedReport[] };
  readonly goLive: string | null;
  readonly goLiveError?: string;
  readonly webhookExport: boolean;
  readonly webhookUpload: boolean;
};

export type StatusLevel = 'ok' | 'info' | 'wait' | 'action' | 'problem';
/** ระดับตามกติกาของ status + คำแนะนำสั้น ๆ (ว่าง = ไม่มี) — ใบ 08 ใช้ตัดสินว่าต้องแจ้งเตือนไหม */
type Judged = { readonly level: StatusLevel; readonly note: string };

/** รายงานตามวันของวันของข้อมูลหนึ่งวัน — รายชื่อเรียงตามแคตตาล็อก */
export type PerDayView = {
  readonly total: number;
  readonly data: number;
  readonly empty: readonly string[];
  readonly failed: readonly FailedReport[];
  readonly notFetched: readonly string[];
};
/** รายงานภาพที่ถ่ายในวันหนึ่ง · `taken` = มีข้อมูล + ว่าง */
export type PictureView = {
  readonly total: number;
  readonly taken: number;
  readonly empty: readonly string[];
  readonly failed: readonly FailedReport[];
  readonly missing: readonly string[];
};
/** หนึ่งวันในช่วงที่ดู · `perDay` null = ยังไม่ถึงกำหนด / ก่อนวันเริ่ม · `legacy` = มีแต่ผลของรอบรูปแบบเดิม (ประวัติ) */
export type DayView = Judged & {
  readonly day: string;
  readonly state?: RunState;
  readonly legacy: boolean;
  readonly perDay: PerDayView | null;
  readonly pictures: PictureView | null;
};
/** ภาพปิดงวดของงวดหนึ่ง (โฟลเดอร์ของวันสุดท้ายของงวด) · `retryUntil` = วันสุดท้ายที่รอบรายวันยังลองถ่ายซ้ำ */
export type CloseView = Judged & {
  readonly periodEnd: string;
  readonly period: 'month' | 'year';
  readonly total: number;
  readonly ok: number;
  readonly failed: readonly FailedReport[];
  /** ยังไม่ได้ถ่าย (รวมงวดที่ถึงกำหนดแต่ยังไม่มีรอบไหนลองเลย) */
  readonly missing: readonly string[];
  readonly retryUntil: string;
};
export type SiteView = {
  readonly site: 'hoteltime' | 'foodstory';
  /** วันของข้อมูลแรกที่นับสถานะ — วันเริ่มใช้งาน หรือวันแรกที่มีผลแบบใหม่ · null = ยังไม่มีเลย */
  readonly start: string | null;
  readonly days: readonly DayView[];
  readonly closes: readonly CloseView[];
  /** วันของข้อมูลที่ขาดเกินที่รอบเดียวเติมได้ (ต้องมีวันเริ่มใช้งาน) */
  readonly backlogDays: number;
  /** วันที่ (เวลาไทย) ของรอบล่าสุด และห่างจากวันนี้กี่วัน (FoodStory: ไม่ได้กดมากี่วัน) */
  readonly lastRunDay: string | null;
  readonly daysSinceLastRun: number | null;
};

export type StatusLine = { readonly level: StatusLevel; readonly text: string };
export type StatusSection = { readonly title: string; readonly lines: readonly StatusLine[] };
export type StatusReport = {
  /** เวลาไทย `YYYY-MM-DD HH:MM` */
  readonly at: string;
  readonly verdict: 'ok' | 'action' | 'problem';
  readonly problems: readonly string[];
  readonly actions: readonly string[];
  readonly sections: readonly StatusSection[];
  readonly sites: readonly SiteView[];
  readonly setup: { readonly goLive: string | null; readonly goLiveError?: string; readonly webhookExport: boolean; readonly webhookUpload: boolean };
};

const WINDMILL_RUNS = 'http://localhost:8000/runs';
const HOTELTIME_TODAY_DEADLINE_MIN = 15 * 60; // รอบเที่ยงใช้ไม่ถึง 15 นาที (เพดาน 3 วัน) — 15:00 แล้วยังไม่มี = รอบเที่ยงไม่ได้รัน
const HOTELTIME_CATCHUP_DONE_MIN = 18 * 60 + 30; // รอบเก็บตกสุดท้าย 18:00
const MONTHLY_DUE_DAY = 5;
const NAMES_SHOWN = 6;

const pad2 = (n: number) => String(n).padStart(2, '0');
const SEVERITY: readonly StatusLevel[] = ['ok', 'info', 'wait', 'action', 'problem'];
const worst = (levels: readonly StatusLevel[]): StatusLevel =>
  levels.reduce((a, b) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a), 'ok' as StatusLevel);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

function names(ids: readonly string[]): string {
  const more = ids.length > NAMES_SHOWN ? ` และอีก ${ids.length - NAMES_SHOWN}` : '';
  return `${ids.slice(0, NAMES_SHOWN).join(', ')}${more}`;
}
function failSummary(failed: readonly FailedReport[]): string {
  return `${names(failed.map((f) => f.report))} — ${failed[0]?.error.split('\n')[0] ?? ''}`;
}
const counted = (r: Counts) => `${r.passed}/${r.total}${r.fromEarlier ? ` (ใช้ไฟล์รอบก่อน ${r.fromEarlier} ใบ)` : ''}`;

type Clock = { readonly clock: ThaiClock; readonly today: string; readonly due: string; readonly minutes: number };
/** HotelTime รันเองตามเวลา · FoodStory รอคนกด */
type Mode = 'auto' | 'manual';

// ── ระดับของแต่ละเรื่อง (กติกาที่หัวไฟล์) ──

function perDayLevel(v: PerDayView, day: string, mode: Mode, now: Clock): Judged {
  if (v.failed.length === 0 && v.notFetched.length === 0) return { level: 'ok', note: '' };
  if (mode === 'manual') {
    return v.failed.length > 0
      ? { level: 'problem', note: 'ดับเบิลคลิกใหม่ ถ้ายังล้มแจ้งผู้ดูแลระบบ' }
      : { level: 'info', note: 'กดครั้งถัดไปเติมให้' };
  }
  if (day === now.due) {
    if (v.notFetched.length > 0) {
      return now.minutes < HOTELTIME_TODAY_DEADLINE_MIN
        ? { level: 'wait', note: 'รอรอบเที่ยง (12:00)' }
        : { level: 'problem', note: `รอบเที่ยงไม่ได้ดึง — ดู Windmill ที่ ${WINDMILL_RUNS}` };
    }
    return now.minutes < HOTELTIME_CATCHUP_DONE_MIN
      ? { level: 'wait', note: 'รอรอบเก็บตก 15:00/18:00' }
      : { level: 'problem', note: 'ยังล้มหลังรอบเก็บตก — ดู _summary.txt ของวันนั้น' };
  }
  return v.notFetched.length > 0
    ? { level: 'problem', note: `รอบถัดไปเติมเอง (ไม่เกิน ${CATCH_UP_CAP_DAYS} วันต่อรอบ) — ถ้ายังขาดดู Windmill ที่ ${WINDMILL_RUNS}` }
    : { level: 'problem', note: 'รอบถัดไปลองซ้ำเอง — ถ้ายังล้มดู _summary.txt ของวันนั้น' };
}

/** รายงานภาพที่ถ่ายในวันหนึ่ง — วันที่ผ่านไปแล้ว = หายถาวร (บอกเฉย ๆ) */
function pictureLevel(v: PictureView, day: string, mode: Mode, now: Clock): Judged {
  if (v.failed.length === 0 && v.missing.length === 0) return { level: 'ok', note: '' };
  if (day < now.today) return { level: 'info', note: '' };
  if (mode === 'manual') {
    return v.failed.length > 0 ? { level: 'problem', note: 'ดับเบิลคลิกใหม่ — รายงานภาพของวันนี้ถ่ายได้ถึงสิ้นวัน' } : { level: 'info', note: '' };
  }
  if (v.missing.length > 0 && now.minutes < HOTELTIME_TODAY_DEADLINE_MIN) return { level: 'wait', note: 'รอรอบเที่ยง (12:00)' };
  if (v.missing.length === 0 && now.minutes < HOTELTIME_CATCHUP_DONE_MIN) return { level: 'wait', note: 'รอรอบเก็บตก 15:00/18:00' };
  return { level: 'problem', note: `ถ้าไม่ได้ภายในวันนี้จะหายถาวร — ดู Windmill ที่ ${WINDMILL_RUNS}` };
}

function dayLevel(d: Omit<DayView, keyof Judged>, mode: Mode, now: Clock): Judged {
  if (d.state === 'unreadable') return { level: 'problem', note: '_run.json อ่านไม่ได้ (ไฟล์เสีย) — ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ' };
  if (d.state === 'running') {
    if (d.day >= now.due) {
      return { level: 'wait', note: `กำลังรัน (เริ่มแล้ว ยังไม่จบ)${mode === 'manual' ? ' — ถ้าไม่มีหน้าต่างไหนรันอยู่ ให้ดับเบิลคลิกใหม่' : ''}` };
    }
    return { level: 'problem', note: `รอบไม่จบ (ไม่มีบันทึกผล) — ${mode === 'auto' ? `ดู Windmill ที่ ${WINDMILL_RUNS}` : 'ดับเบิลคลิกใหม่'}` };
  }
  const parts = [
    ...(d.perDay !== null ? [perDayLevel(d.perDay, d.day, mode, now)] : []),
    ...(d.pictures !== null ? [pictureLevel(d.pictures, d.day, mode, now)] : []),
  ];
  if (parts.length === 0) return { level: 'info', note: '' }; // มีแต่ประวัติของรอบรูปแบบเดิม
  const level = worst(parts.map((p) => p.level));
  return { level, note: parts.find((p) => p.level === level)?.note ?? '' };
}

/**
 * ภาพปิดงวด (เจ้าของเลือก 2026-10-14: แบบเดียวกับรายงานตามวัน) — ครบ = ok · HotelTime วันแรกของงวดถัดไป: ยังไม่มีรอบไหนลองก่อน 15:00 / ล้มก่อน
 * 18:30 = รอ หลังจากนั้นและวันต่อ ๆ ไป = ปัญหา (รอบรายวันยังลองซ้ำเองถึง `retryUntil`) · FoodStory ล้ม = ปัญหา (กดซ้ำ) ยังไม่มีใครกด = รวมในบรรทัด "กด" ·
 * พ้นช่วงลองซ้ำ = ปัญหา "หายถาวร" ให้คนเห็นว่าหายจริง (แสดงอยู่ในช่วงที่ดู)
 */
function closeLevel(c: Omit<CloseView, keyof Judged>, mode: Mode, now: Clock): Judged {
  if (c.failed.length === 0 && c.missing.length === 0) return { level: 'ok', note: '' };
  if (now.today > c.retryUntil) return { level: 'problem', note: `หายถาวร — พ้นช่วงลองซ้ำ (ถึง ${c.retryUntil}) แล้ว` };
  const untried = c.failed.length === 0 && c.ok === 0;
  if (mode === 'manual') {
    return untried ? { level: 'info', note: `กดครั้งถัดไปถ่ายให้ (ได้ถึง ${c.retryUntil})` } : { level: 'problem', note: `กดซ้ำได้ถึง ${c.retryUntil} พ้นแล้วหายถาวร` };
  }
  if (now.today === addDaysISO(c.periodEnd, 1)) {
    if (untried && now.minutes < HOTELTIME_TODAY_DEADLINE_MIN) return { level: 'wait', note: 'รอรอบเที่ยง (12:00)' };
    if (now.minutes < HOTELTIME_CATCHUP_DONE_MIN) return { level: 'wait', note: 'รอรอบเก็บตก 15:00/18:00' };
  }
  return { level: 'problem', note: `รอบรายวันลองซ้ำเองถึง ${c.retryUntil} พ้นแล้วหายถาวร — ถ้ายังล้มดู _summary.txt ของวันนั้น` };
}

// ── มุมมองต่อ Site (ข้อมูลล้วน + ระดับ — ใช้ทั้งสรุปบนจอและ JSON ของใบ 08) ──

function siteView(
  site: SiteView['site'], mode: Mode, folders: readonly Folder[], catalog: readonly PlannedReport[], at: Date, now: Clock, windowDays: number,
  goLive: string | null,
): SiteView {
  const readable = folders.flatMap((f) => (typeof f.record === 'object' ? [{ day: f.day, record: f.record }] : []));
  const recordOf = new Map(readable.map((f) => [f.day, f.record]));
  const folderOf = new Map(folders.map((f) => [f.day, f]));
  const state = storeStateFrom(readable, catalog);
  const perDayIds = catalog.filter((r) => r.family === 'per-day').map((r) => r.id);
  const pictureIds = catalog.filter((r) => r.family === 'picture').map((r) => r.id);
  const firstWith = (ids: readonly string[]) => readable.map((f) => f.day).filter((d) => ids.some((id) => state.has(stateKey(id, d)))).sort()[0] ?? null;
  const perDayStart = goLive ?? firstWith(perDayIds);
  const pictureStart = goLive ?? firstWith(pictureIds);

  const split = (ids: readonly string[], day: string) => {
    const of = (s: DayStatus) => ids.filter((id) => state.get(stateKey(id, day)) === s);
    const error = (id: string) => {
      const o = recordOf.get(day)?.reports[id];
      return o?.status === 'failed' ? o.error : '';
    };
    return {
      data: of('data').length,
      empty: of('empty'),
      failed: of('failed').map((id) => ({ report: id, error: error(id) })),
      notDone: ids.filter((id) => !state.has(stateKey(id, day))),
    };
  };

  const days: DayView[] = [];
  for (let k = windowDays - 1; k >= 0; k--) {
    const day = addDaysISO(now.today, -k);
    const f = folderOf.get(day);
    let view: Omit<DayView, keyof Judged> | null = null;
    if (f !== undefined && typeof f.record === 'string') {
      view = { day, state: f.record, legacy: false, perDay: null, pictures: null };
    } else {
      let perDay: PerDayView | null = null;
      if (perDayStart !== null && day >= perDayStart && day <= now.due) {
        const s = split(perDayIds, day);
        perDay = { total: perDayIds.length, data: s.data, empty: s.empty, failed: s.failed, notFetched: s.notDone };
      }
      let pictures: PictureView | null = null;
      if (pictureStart !== null && day >= pictureStart) {
        const s = split(pictureIds, day);
        pictures = { total: pictureIds.length, taken: s.data + s.empty.length, empty: s.empty, failed: s.failed, missing: s.notDone };
      }
      const record = recordOf.get(day);
      const legacy = perDay === null && day <= now.due && record !== undefined && Object.keys(record.reports).some((id) => perDayIds.includes(id));
      if (perDay !== null || pictures !== null || legacy) view = { day, legacy, perDay, pictures };
    }
    if (view !== null) days.push({ ...view, ...dayLevel(view, mode, now) });
  }

  const plan = planDailyRun({ now: at, reports: catalog, state, goLive });
  const lastRunDay = readable.flatMap((f) => f.record.runs.map((r) => thaiDateOf(r.startedAt) ?? '')).sort().at(-1) || null;
  return {
    site,
    start: perDayStart,
    days,
    closes: closesOf(readable, catalog, state, plan.periodCloses, now.today, windowDays).map((c) => ({ ...c, ...closeLevel(c, mode, now) })),
    backlogDays: goLive === null ? 0 : plan.backlogDays,
    lastRunDay,
    daysSinceLastRun: lastRunDay === null ? null : daysBetween(lastRunDay, now.today),
  };
}

/**
 * ภาพปิดงวดของงวดที่ยังอยู่ในช่วงที่ดู (นับรวมช่วงที่ยังลองซ้ำได้) — จากผลในโฟลเดอร์ของวันสุดท้ายของงวด และงวดที่ตัววางแผนบอกว่าถึงกำหนดแต่ยังไม่มี
 * ผลเลย (เครื่องดับวันที่ 1) · สิ้นปีมีทั้งงวดเดือน ธ.ค. และงวดปี
 */
function closesOf(
  folders: readonly { readonly day: string; readonly record: RunRecord }[],
  catalog: readonly PlannedReport[],
  state: ReadonlyMap<string, DayStatus>,
  due: readonly PlannedItem[],
  today: string,
  windowDays: number,
): Omit<CloseView, keyof Judged>[] {
  const oldest = addDaysISO(today, -(windowDays - 1 + PERIOD_CLOSE_WINDOW_DAYS));
  const ends = new Set([
    ...folders.filter((f) => f.day >= oldest && Object.keys(f.record.reports).some((id) => id.endsWith(PERIOD_CLOSE_SUFFIX))).map((f) => f.day),
    ...due.map((i) => i.day),
  ]);
  const out: Omit<CloseView, keyof Judged>[] = [];
  for (const end of [...ends].sort()) {
    for (const period of ['month', 'year'] as const) {
      if (period === 'year' && !end.endsWith('-12-31')) continue;
      const ids = catalog.filter((r) => r.period === period).map((r) => r.id);
      const s = (id: string) => state.get(stateKey(`${id}${PERIOD_CLOSE_SUFFIX}`, end));
      const tried = ids.some((id) => s(id) !== undefined);
      const isDue = due.some((i) => i.day === end && ids.includes(i.report));
      if (ids.length === 0 || (!tried && !isDue)) continue;
      const record = folders.find((f) => f.day === end)?.record;
      out.push({
        periodEnd: end,
        period,
        total: ids.length,
        ok: ids.filter((id) => isDone(s(id))).length,
        failed: ids.filter((id) => s(id) === 'failed').map((id) => {
          const o = record?.reports[`${id}${PERIOD_CLOSE_SUFFIX}`];
          return { report: id, error: o?.status === 'failed' ? o.error : '' };
        }),
        missing: ids.filter((id) => s(id) === undefined),
        retryUntil: periodCloseRetryUntil(end),
      });
    }
  }
  return out;
}

// ── สรุปบนจอ ──

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

function perDayPart(v: PerDayView): string {
  return (
    `ตามวัน ${v.total}: มีข้อมูล ${v.data}` +
    (v.empty.length > 0 ? ` · ว่าง ${v.empty.length} (${names(v.empty)})` : '') +
    (v.failed.length > 0 ? ` · ล้ม ${v.failed.length} (${failSummary(v.failed)})` : '') +
    (v.notFetched.length > 0 ? ` · ยังไม่ได้ดึง ${v.notFetched.length} (${names(v.notFetched)})` : '')
  );
}
function picturePart(v: PictureView, lost: boolean): string {
  if (v.failed.length === 0 && v.missing.length === 0) return `ภาพ ครบ ${v.taken}/${v.total}`;
  return (
    `ภาพ ได้ ${v.taken}/${v.total}` +
    (v.failed.length > 0 ? ` · ล้ม ${v.failed.length} (${failSummary(v.failed)})` : '') +
    (v.missing.length > 0 ? ` · ยังไม่ได้ถ่าย ${v.missing.length} (${names(v.missing)})` : '') +
    (lost ? ' — หายถาวร เติมไม่ได้' : '')
  );
}

function dayLabel(day: string, now: Clock): string {
  if (day === now.today) return `วันนี้ ${day}`;
  if (day === addDaysISO(now.today, -1)) return `เมื่อวาน ${day}`;
  return day;
}

function siteLines(view: SiteView, now: Clock, out: SectionBuilder): void {
  for (const d of view.days) {
    const parts = d.state !== undefined
      ? []
      : [
          ...(d.legacy ? ['ตามวัน: รอบรูปแบบเดิม (ช่วงเหลื่อม 3 วัน) — เก็บไว้เป็นประวัติ ไม่นับสถานะ'] : []),
          ...(d.perDay !== null ? [perDayPart(d.perDay)] : []),
          ...(d.pictures !== null ? [picturePart(d.pictures, d.day < now.today)] : []),
        ];
    out.add(d.level, `${dayLabel(d.day, now)}  ${[parts.join(' · '), d.note].filter((x) => x !== '').join(' — ')}`);
  }
  for (const c of view.closes) {
    const label = c.period === 'year' ? `ภาพปิดงวดปี ${c.periodEnd.slice(0, 4)}` : `ภาพปิดงวดเดือน ${c.periodEnd.slice(0, 7)}`;
    const bad = [...c.failed, ...c.missing.map((report) => ({ report, error: 'ยังไม่ได้ถ่าย' }))];
    const body = bad.length === 0 ? `ครบ ${c.ok}/${c.total}` : `ได้ ${c.ok}/${c.total} · ไม่ได้ ${bad.length} (${failSummary(bad)})`;
    out.add(c.level, `${label}  ${body}${c.note ? ` — ${c.note}` : ''}`);
  }
}

function hoteltimeSection(view: SiteView, now: Clock, out: SectionBuilder): void {
  if (view.lastRunDay === null && view.days.every((d) => d.state === undefined)) {
    out.add('problem', `ยังไม่เคยมีรอบ HotelTime เลย — เช็คว่าเปิด Windmill และตั้งค่าแล้ว (node windmill/setup.mjs) แล้วดู Windmill ที่ ${WINDMILL_RUNS}`);
    return;
  }
  siteLines(view, now, out);
  if (view.backlogDays > 0) {
    out.add('action', `HotelTime ขาดอีก ${view.backlogDays} วันของข้อมูล เกินที่รอบเดียวเติมได้ (${CATCH_UP_CAP_DAYS}) — รอบ Windmill ถัดไปเติมต่อเอง ` +
      `(วันละ 3 รอบ) ถ้าต้องการเร็วกว่านั้นสั่ง --date ทีละวัน`);
  }
}

function foodstoryDailySection(view: SiteView, now: Clock, out: SectionBuilder): void {
  siteLines(view, now, out);
  const todayView = view.days.find((d) => d.day === now.today);
  const notFetched = view.days.some((d) => (d.perDay?.notFetched.length ?? 0) > 0);
  const todayPictures = todayView?.pictures ?? null;
  const noPictures = view.start !== null && (todayPictures === null || todayPictures.missing.length > 0);
  const closesWaiting = view.closes.some((c) => c.level === 'info' && c.note.startsWith('กดครั้งถัดไป'));
  if (view.lastRunDay === null || notFetched || noPictures || closesWaiting) {
    const since = view.daysSinceLastRun;
    const when = since === null ? 'ยังไม่เคยกด FoodStory เลย'
      : since >= 2 ? `FoodStory ไม่ได้กดมา ${since} วัน (ครั้งล่าสุด ${view.lastRunDay})`
      : since === 1 ? 'FoodStory ยังไม่ได้กดวันนี้'
      : notFetched ? 'FoodStory กดวันนี้แล้วแต่ยังมีวันที่ขาด'
      : 'FoodStory กดวันนี้แล้วแต่รายงานภาพ/ภาพปิดงวดยังไม่ครบ';
    out.add('action', `${when} — ดับเบิลคลิก "ดึง FoodStory" บน Desktop แล้วกด captcha (กดครั้งเดียวได้วันที่ขาดไม่เกิน ${CATCH_UP_CAP_DAYS} วัน ` +
      '+ รายงานภาพของวันนี้)');
  }
  if (view.backlogDays > 0) {
    out.add('action', `FoodStory ขาดอีก ${view.backlogDays} วันของข้อมูล เกินที่กดครั้งเดียวเติมได้ (${CATCH_UP_CAP_DAYS}) — กดซ้ำได้เลย ครั้งละ ${CATCH_UP_CAP_DAYS} วัน`);
  }
}

function foodstoryMonthlySection(runs: readonly MonthRun[], now: Clock, out: SectionBuilder): void {
  const lastOfPrev = utcDate(now.clock.year, now.clock.month, 0); // วันที่ 0 ของเดือนนี้ = วันสุดท้ายของเดือนที่แล้ว
  const period = `${lastOfPrev.getUTCFullYear()}-${pad2(lastOfPrev.getUTCMonth() + 1)}`;
  const run = runs.find((m) => m.period === period);
  const command = 'ในโฟลเดอร์ exporter รัน: node src/index.ts export --site foodstory --report all --headful (ต้องกด captcha)';
  if (!run) {
    if (now.clock.day > MONTHLY_DUE_DAY) out.add('action', `ยังไม่ได้ดึงรายเดือนของ ${period} — ${command}`);
    else out.add('info', `ยังไม่ได้ดึงรายเดือนของ ${period} — ควรดึงภายในวันที่ ${MONTHLY_DUE_DAY}`);
  } else if (run.state === 'unreadable') {
    out.add('problem', `_run.json ของรายเดือน ${period} อ่านไม่ได้ (ไฟล์เสีย) — ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ`);
  } else if (run.failed.length > 0) {
    out.add('problem', `${period} มี ${run.failed.length} ใบที่ยังไม่เคยดึงสำเร็จ: ${failSummary(run.failed)} — ${command}`);
  } else {
    out.add('ok', `${period}  ${counted(run)} (ดึงล่าสุด ${run.pulledOn})`);
  }
}

function setupSection(setup: StatusSetup, now: Clock, out: SectionBuilder): void {
  if (setup.goLiveError !== undefined) out.add('action', `${setup.goLiveError} — แก้ใน exporter/.env`);
  else if (setup.goLive === null) {
    out.add('action', `ยังไม่ได้ตั้งวันเริ่มใช้งาน — ระบบไม่เติมวันที่ขาด (ดึงแค่เมื่อวาน) · ตั้ง ${GO_LIVE_ENV}=YYYY-MM-DD ใน exporter/.env ` +
      'เป็นวันแรกที่ต้องมีข้อมูลครบ');
  } else if (setup.goLive > now.today) {
    out.add('action', `วันเริ่มใช้งาน ${setup.goLive} อยู่หลังวันนี้ — ยังไม่ดึงรายงานตามวันเลยจนถึงวันนั้น ตรวจ ${GO_LIVE_ENV} ใน exporter/.env ว่าพิมพ์ถูก`);
  } else out.add('ok', `วันเริ่มใช้งาน ${setup.goLive}`);
  if (!setup.webhookExport) out.add('action', `ยังไม่ได้ตั้ง URL ของ Discord webhook ขา export (${WEBHOOK_ENV_EXPORT} ใน exporter/.env) — ไม่มีสรุปรายวัน/แจ้งเตือนทาง Discord`);
  else out.add('ok', 'ตั้ง Discord webhook ขา export แล้ว');
  if (!setup.webhookUpload) out.add('action', `ยังไม่ได้ตั้ง URL ของ Discord webhook ขา upload (${WEBHOOK_ENV_UPLOAD} ใน exporter/.env) — ไม่มีแจ้งเตือนขาอัปโหลดทาง Discord`);
  else out.add('ok', 'ตั้ง Discord webhook ขา upload แล้ว');
}

const UPLOAD_SITE_LABEL: Readonly<Record<UploadBacklogView['site'], string>> = { hoteltime: 'HotelTime', foodstory: 'FoodStory' };

/**
 * ticket 06 ของ exporter-upload-to-uploader — แยกตัวเลขตามสถานะ ไม่ปนเป็นก้อนเดียว เพื่อให้รู้ว่าต้องทำอะไรต่อ:
 * รอส่ง/ว่าง = ปล่อยไว้เฉย ๆ (ไม่กระทบ verdict) · บล็อกเพราะ as_of ย้อนหลัง = ต้องคุยกับทีม uploader (action) ·
 * ค้างถาวร = ต้องดูสาเหตุ (problem — หนักสุดในสาม)
 *
 * ticket 13: `b.empty` ไม่ได้แปลว่า "ไม่ต้องส่ง" เสมอไปอีกแล้วตั้งแต่มีทางประกาศจริง (ticket 11) — อาจเป็นได้ทั้ง
 * flag ปิด/document_type ยัง resolve ไม่ได้ (จริง ๆ "ไม่ต้องส่ง" ตอนนี้) **หรือ** ลองส่งแล้วแต่ uploader ปฏิเสธ
 * ถาวร (400 — ลองแล้วแต่ไม่ผ่าน ไม่เหมือนกับ "ไม่ต้องส่ง" เสีย แต่ยังไม่มี state แยกให้บอกต่างจากกันได้ ณ จุดนี้ —
 * ช่องโหว่เดียวกับที่ไฟล์ rejected ก็ไม่มี state แยกเหมือนกัน) จึงใช้คำกลาง ๆ "ยังไม่ประกาศ" แทน
 */
function uploadBacklogSection(backlog: readonly UploadBacklogView[], out: SectionBuilder): void {
  for (const b of backlog) {
    const label = UPLOAD_SITE_LABEL[b.site];
    if (b.pending === 0 && b.blocked === 0 && b.stuck === 0 && b.empty === 0) {
      out.add('ok', `${label}: ไม่มีไฟล์ค้าง`);
      continue;
    }
    const parts: string[] = [];
    const levels: StatusLevel[] = [];
    if (b.pending > 0) { parts.push(`รอส่ง ${b.pending}`); levels.push('info'); }
    if (b.empty > 0) { parts.push(`ว่าง-ยังไม่ประกาศ ${b.empty}`); levels.push('info'); }
    if (b.blocked > 0) { parts.push(`บล็อก(as_of) ${b.blocked} — คุยกับทีม uploader ก่อนถ้าตั้งใจส่งจริง`); levels.push('action'); }
    if (b.stuck > 0) { parts.push(`ค้างถาวร ${b.stuck} — ดูสาเหตุที่ data/_upload/${b.site}.json`); levels.push('problem'); }
    out.add(worst(levels), `${label}: ${parts.join(' · ')}`);
  }
}

export function buildStatus(
  snapshot: StoreSnapshot,
  at: Date,
  setup: StatusSetup,
  opts: { readonly windowDays?: number; readonly uploadBacklog?: readonly UploadBacklogView[] } = {},
): StatusReport {
  const windowDays = opts.windowDays ?? 7;
  const clock = thaiClock(at);
  const now: Clock = { clock, today: formatISO(thaiToday(at)), due: lastDueDay(at), minutes: clock.hour * 60 + clock.minute };
  const hoteltime = siteView('hoteltime', 'auto', snapshot.hoteltime, setup.catalog.hoteltime, at, now, windowDays, setup.goLive);
  const foodstory = siteView('foodstory', 'manual', snapshot.foodstoryDaily, setup.catalog.foodstory, at, now, windowDays, setup.goLive);
  const problems: string[] = [];
  const actions: string[] = [];
  const section = (title: string, fill: (out: SectionBuilder) => void): StatusSection => {
    const out = new SectionBuilder(problems, actions);
    fill(out);
    return { title, lines: out.lines };
  };
  const sections = [
    section('HotelTime (รันเองทุกวัน 12:00 · เก็บตก 15:00/18:00) — ต่อวันของข้อมูล', (out) => hoteltimeSection(hoteltime, now, out)),
    section('FoodStory รายวัน (พนักงานกด) — ต่อวันของข้อมูล', (out) => foodstoryDailySection(foodstory, now, out)),
    section('FoodStory รายเดือน', (out) => foodstoryMonthlySection(snapshot.foodstoryMonthly, now, out)),
    section('ค่าตั้งของเครื่องนี้', (out) => setupSection(setup, now, out)),
    // ticket 06 ของ exporter-upload-to-uploader — ไม่ใส่ `opts.uploadBacklog` = ไม่มี section นี้เลย (เผื่อผู้เรียกเดิม
    // ที่ยังไม่พร้อมอ่านดิสก์ของขาอัปโหลด เช่นเทสต์เก่า)
    ...(opts.uploadBacklog !== undefined ? [section('ขาอัปโหลด (uploader)', (out) => uploadBacklogSection(opts.uploadBacklog!, out))] : []),
  ];
  return {
    at: `${now.today} ${pad2(clock.hour)}:${pad2(clock.minute)}`,
    verdict: problems.length > 0 ? 'problem' : actions.length > 0 ? 'action' : 'ok',
    problems,
    actions,
    sections,
    sites: [hoteltime, foodstory],
    setup: {
      goLive: setup.goLive, ...(setup.goLiveError !== undefined ? { goLiveError: setup.goLiveError } : {}),
      webhookExport: setup.webhookExport, webhookUpload: setup.webhookUpload,
    },
  };
}

const MARK: Readonly<Record<StatusLevel, string>> = { ok: '✔', info: '·', wait: '⏳', action: '⚠', problem: '✘' };

export function renderStatus(report: StatusReport): string {
  const out = [`exporter status — ${report.at} (เวลาไทย)`];
  for (const s of report.sections) out.push('', s.title, ...s.lines.map((l) => `  ${MARK[l.level]} ${l.text}`));
  out.push('');
  // บรรทัดท้ายสุด = เรื่องที่หนักที่สุด (คนมักอ่านแค่บรรทัดสุดท้าย)
  if (report.verdict === 'ok') out.push('✅ ปกติ — ไม่ต้องทำอะไร');
  if (report.actions.length > 0) out.push(`⚠ มีสิ่งที่ต้องทำ ${report.actions.length} อย่าง (ดู ⚠ ด้านบน)`);
  if (report.problems.length > 0) out.push(`✘ ต้องดู ${report.problems.length} เรื่อง — ทำตามข้อความด้านบน ถ้าแก้เองไม่ได้ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ`);
  return `${out.join('\n')}\n`;
}

// ── อ่านคลังจริง ──

/** `exporter/data` — คำนวณจากที่อยู่ไฟล์นี้ ไม่ผ่าน config ของ Site (ไม่ต้องมี .env) */
export function defaultDataDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
}

/**
 * ค่าตั้งสองค่าที่ status ต้องรู้ — env ของ shell ชนะ `exporter/.env` (เหมือน dotenv ของ Site) · อ่านเฉพาะสองคีย์นี้ ไม่โหลดทั้งไฟล์เข้า env
 * (ไม่แตะรหัสผ่าน) · URL ของ webhook คืนแค่ว่ามีหรือไม่ ไม่เคยคืนค่า
 */
export function readSetupValues(
  envFile: string, env: NodeJS.ProcessEnv = process.env,
): Pick<StatusSetup, 'goLive' | 'goLiveError' | 'webhookExport' | 'webhookUpload'> {
  const pick = envPicker(envFile, env);
  const goLive = parseGoLive(pick(GO_LIVE_ENV));
  return {
    ...('error' in goLive ? { goLive: null, goLiveError: goLive.error } : { goLive: goLive.goLive }),
    webhookExport: (pick(WEBHOOK_ENV.export) ?? '').trim() !== '',
    webhookUpload: (pick(WEBHOOK_ENV.upload) ?? '').trim() !== '',
  };
}

/** URL ของ webhook สำหรับตัวส่ง (ใบ 08) ของ channel ที่ระบุ — ความลับ: ผู้เรียกห้ามพิมพ์/บันทึก ใช้ส่งอย่างเดียว · ไม่ได้ตั้ง = null */
export function readWebhookUrl(envFile: string, channel: WebhookChannel, env: NodeJS.ProcessEnv = process.env): string | null {
  const url = (envPicker(envFile, env)(WEBHOOK_ENV[channel]) ?? '').trim();
  return url === '' ? null : url;
}

/**
 * env ของ shell ชนะ `exporter/.env` (เหมือน dotenv ของ Site) — อ่านทีละคีย์ ไม่โหลดทั้งไฟล์เข้า env (เฉพาะทาง status/notify — รอบ export โหลดทั้งไฟล์
 * ผ่าน config ของ Site และกันความลับไม่ให้ถึงเบราว์เซอร์ด้วย `browserEnv`)
 */
function envPicker(envFile: string, env: NodeJS.ProcessEnv): (key: string) => string | undefined {
  const file = existsSync(envFile) ? parseDotenv(readFileSync(envFile)) : {};
  return (key) => (Object.prototype.hasOwnProperty.call(env, key) ? env[key] : file[key]);
}

const list = (dir: string) => readdir(dir).catch(() => [] as string[]);

/** `_run.json` ของโฟลเดอร์: ไม่มีไฟล์ = `running` · JSON เสีย/ไม่มี `reports` = `unreadable` (ไม่ให้ทั้งคำสั่งพังเพราะไฟล์เดียว) */
async function loadRecord(folder: string): Promise<RunRecord | RunState> {
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

async function readDaily(dataDir: string, site: 'hoteltime' | 'foodstory'): Promise<Folder[]> {
  const root = path.join(dataDir, site, 'daily');
  const folders: Folder[] = [];
  for (const month of (await list(root)).filter((m) => /^\d{4}-\d{2}$/.test(m))) {
    for (const day of (await list(path.join(root, month))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
      folders.push({ day, record: await loadRecord(path.join(root, month, day)) });
    }
  }
  return folders;
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
