import { addDaysISO, formatISO, parseISODate } from './order.ts';
import type { ReportFamily } from './raw-manifest.ts';
import type { RunRecord, SkippedReport } from './run-record.ts';
import { thaiClock, thaiDateOf, thaiToday } from './thai-time.ts';

/**
 * ตัววางแผนรอบรายวัน (ADR-0008) — ตอบว่า "รอบนี้ต้องทำอะไร" จากภาพรวมของที่เก็บข้อมูลอย่างเดียว ไม่แตะเบราว์เซอร์และไม่แตะดิสก์
 *
 * กติกาทั้งหมดของรอบรายวัน รอบเก็บตก และ (ใบ 04) การเติมวันที่ขาด อยู่ที่นี่ที่เดียว · รู้จักรายงานแค่ id กับตระกูล ไม่ผูก Site —
 * ตอนนี้ HotelTime ใช้ FoodStory ย้ายมาใช้ในใบ 06 (ADR-0009)
 * · วันทุกวันเป็นวันตามปฏิทินไทย (ISO `YYYY-MM-DD`)
 */

/** งวดของ **รายงาน snapshot** สำหรับ **snapshot ปิดงวด** (ใบ 05) — `none` = snapshot ณ ขณะนั้น พยากรณ์ หรือช่วงเลื่อน ไม่มีงวดให้ปิด */
export type ReportPeriod = 'month' | 'year' | 'none';

export type PlannedReport = {
  readonly id: string;
  readonly family: ReportFamily;
  /** ไม่ใส่ = ไม่มี snapshot ปิดงวด (รายงานตามวัน) */
  readonly period?: ReportPeriod;
  /**
   * ถ่าย snapshot ซ้ำอีกครั้งตั้งแต่ชั่วโมงนี้ (เวลาไทย) ของวัน แม้ snapshot ของวันนี้สำเร็จไปแล้ว (ADR-0011) — Site เป็นฝ่ายตั้ง (HotelTime ตั้งให้ทุก snapshot ใน
   * `toPlanned`) · ใช้ได้กับรายงาน snapshot เท่านั้น · ไม่ใส่ = ถ่ายวันละครั้งตามเดิม (รายงานตามวัน, FoodStory)
   */
  readonly refreshAtHour?: number;
};

/**
 * id ที่ใช้บันทึกผลของ **snapshot ปิดงวด** ใน `_run.json` — แยกจาก snapshot ปกติของรายงานเดียวกัน เพราะ snapshot ปิดงวดอยู่ในโฟลเดอร์ของวันสุดท้ายของงวด
 * ซึ่งมี snapshot ปกติของวันนั้นอยู่แล้ว (`_run.json` เก็บได้หนึ่งสถานะต่อ id ต่อโฟลเดอร์)
 */
export const PERIOD_CLOSE_SUFFIX = '@period-close';

export function periodCloseId(report: string): string {
  return `${report}${PERIOD_CLOSE_SUFFIX}`;
}

/**
 * id ที่ใช้บันทึกผลของ **snapshot ถ่ายซ้ำ** ใน `_run.json` — แยกจาก snapshot ปกติของรายงานเดียวกัน (เหตุผลเดียวกับ `PERIOD_CLOSE_SUFFIX`: `_run.json` เก็บได้หนึ่ง
 * สถานะและหนึ่งชุดไฟล์ต่อ id ต่อโฟลเดอร์ ถ้าใช้ id เดียวกัน ไฟล์รอบเที่ยงจะหลุดจาก `_run.json` และขาอัปโหลดหา `as_of` ของมันไม่เจอ)
 */
export const REFRESH_SUFFIX = '@refresh';

/** ชั่วโมง (เวลาไทย) ของรอบเย็นที่ snapshot ของ HotelTime ถ่ายซ้ำ — ตรงกับ `CATCHUP_CRON` รอบ 18:00 ใน `windmill/setup.mjs` และอยู่ก่อน pipeline 19:00 ของ consumer (ADR-0011) */
export const EVENING_REFRESH_HOUR = 18;

export function refreshId(report: string): string {
  return `${report}${REFRESH_SUFFIX}`;
}

/**
 * Extra snapshot rounds at fixed hours (ADR-0013, supersedes the "one re-take at 18:00" part of ADR-0011): each slot is a separate command
 * run (`export --snapshot-slot <HH>`) that takes the snapshot reports again and nothing else (no per-day reports, no back-fill, no period-close).
 * A slot records its results under its own id `<report>@refresh-<HH>` — one status per id per folder in `_run.json`, the same reason as
 * `@refresh` — while the 18:00 re-take keeps the plain `@refresh` id (no migration).
 */
export const SNAPSHOT_SLOTS = ['06', '23'] as const;
export type SnapshotSlot = (typeof SNAPSHOT_SLOTS)[number];

/**
 * Thai-time hours [from, to) in which a slot may run. Outside the window the command does nothing: a delayed or retried job must not write
 * slot 23 into the next calendar day's folder after midnight, and slot 06 must not run into the noon round (which takes the normal snapshot).
 */
export const SLOT_WINDOW: Readonly<Record<SnapshotSlot, { readonly from: number; readonly to: number }>> = {
  '06': { from: 6, to: 12 },
  '23': { from: 23, to: 24 },
};

export const isSnapshotSlot = (v: string): v is SnapshotSlot => (SNAPSHOT_SLOTS as readonly string[]).includes(v);

export function slotRefreshId(report: string, slot: SnapshotSlot): string {
  return `${report}${REFRESH_SUFFIX}-${slot}`;
}

/** `<report>@refresh` (the 18:00 re-take, slot = null) or `<report>@refresh-<HH>` (an extra round); anything else = null */
export function parseRefreshId(id: string): { readonly base: string; readonly slot: string | null } | null {
  const m = /^(.+)@refresh(?:-(\d{2}))?$/.exec(id);
  return m === null ? null : { base: m[1]!, slot: m[2] ?? null };
}

/**
 * **รอบดึง** (ADR-0014, exporter-hoteltime-4h-rounds) — ตารางเวลาเดียวของ HotelTime: 04, 08, 12, 16, 20, 23 น. เวลาไทย · แต่ละรอบมี id ผลของตัวเอง
 * `<report>@round-<HH>` ใน `_run.json` (แยกจาก `@refresh*` เดิมที่ยังอ่านได้ในโฟลเดอร์ย้อนหลัง · `parseRefreshId` ไม่เห็น id นี้)
 */
export const ROUND_HOURS = ['04', '08', '12', '16', '20', '23'] as const;
export type RoundHour = (typeof ROUND_HOURS)[number];
/** ค่าเริ่มเมื่อไม่ตั้ง `HOTELTIME_ROUNDS` — 04:00 เปิดทีหลังเมื่อดูผลจริงแล้ว */
export const DEFAULT_ROUNDS: readonly RoundHour[] = ['08', '12', '16', '20', '23'];

/** ชั่วโมงเวลาไทย [from, to) ที่รอบรันได้ — เผื่อ retry +30 นาที · รอบ 23 ต้องจบก่อนเที่ยงคืน (ไม่ข้ามไปโฟลเดอร์วันถัดไป) · หน้าต่างไม่ทับกัน */
export const ROUND_WINDOW: Readonly<Record<RoundHour, { readonly from: number; readonly to: number }>> = {
  '04': { from: 4, to: 6 },
  '08': { from: 8, to: 10 },
  '12': { from: 12, to: 14 },
  '16': { from: 16, to: 18 },
  '20': { from: 20, to: 22 },
  '23': { from: 23, to: 24 },
};

export const isRoundHour = (v: string): v is RoundHour => (ROUND_HOURS as readonly string[]).includes(v);

export function roundId(report: string, round: RoundHour): string {
  return `${report}@round-${round}`;
}

/** `<report>@round-<HH>` → ส่วนประกอบ · อย่างอื่น (รวม `@refresh*`) = null */
export function parseRoundId(id: string): { readonly base: string; readonly round: RoundHour } | null {
  const m = /^(.+)@round-(\d{2})$/.exec(id);
  return m === null || !isRoundHour(m[2]!) ? null : { base: m[1]!, round: m[2] };
}

/**
 * Parse `HOTELTIME_ROUNDS` ("08,12,16,20,23") — ไม่ตั้ง/ว่าง = {@link DEFAULT_ROUNDS} (ลืมตั้งต้องไม่ทำให้ระบบเงียบ) · `off`/`none` = ปิดทุกรอบอย่างชัดเจน ·
 * ชั่วโมงที่ไม่ใช่รอบหรือรูปแบบผิด = error (พิมพ์ผิดต้องไม่ปิดรอบเงียบ ๆ) · ไม่อ่าน `HOTELTIME_SNAPSHOT_SLOTS` เดิม จึงไม่เปิดรอบใหม่โดยไม่ตั้งใจ
 */
export function parseRounds(raw: string | undefined): { readonly rounds: readonly RoundHour[] } | { readonly error: string } {
  if (raw === undefined || raw.trim() === '') return { rounds: DEFAULT_ROUNDS };
  if (['off', 'none'].includes(raw.trim().toLowerCase())) return { rounds: [] };
  const picked = new Set<RoundHour>();
  for (const part of raw.split(',').map((x) => x.trim()).filter((x) => x !== '')) {
    const hh = /^\d$/.test(part) ? `0${part}` : part;
    if (!isRoundHour(hh)) return { error: `HOTELTIME_ROUNDS has an unknown round ${JSON.stringify(part)} — allowed: ${ROUND_HOURS.join(', ')} or "off" (e.g. HOTELTIME_ROUNDS=08,12,16,20,23)` };
    picked.add(hh);
  }
  return { rounds: ROUND_HOURS.filter((h) => picked.has(h)) };
}

/** ด่านแรกของรอบ: ไม่อยู่ในรายการที่เปิด หรือนอกหน้าต่างเวลาไทย → ไม่รัน (ผู้เรียกออกทันทีโดยไม่ login) */
export function gateRound(input: {
  readonly now: Date;
  readonly round: RoundHour;
  readonly enabled: readonly RoundHour[];
}): { readonly run: boolean; readonly reason: 'disabled' | 'outside_window' | null } {
  if (!input.enabled.includes(input.round)) return { run: false, reason: 'disabled' };
  const hour = thaiClock(input.now).hour;
  const w = ROUND_WINDOW[input.round];
  return hour >= w.from && hour < w.to ? { run: true, reason: null } : { run: false, reason: 'outside_window' };
}

/** Parse `HOTELTIME_SNAPSHOT_SLOTS` ("06,23") — empty/unset = no extra rounds · an unknown slot is an error (a typo must not silently turn a round off) */
export function parseSnapshotSlots(raw: string | undefined): { readonly slots: readonly SnapshotSlot[] } | { readonly error: string } {
  if (raw === undefined || raw.trim() === '') return { slots: [] };
  const slots: SnapshotSlot[] = [];
  for (const part of raw.split(',').map((x) => x.trim()).filter((x) => x !== '')) {
    if (!isSnapshotSlot(part)) return { error: `HOTELTIME_SNAPSHOT_SLOTS has an unknown slot ${JSON.stringify(part)} — allowed: ${SNAPSHOT_SLOTS.join(', ')} (e.g. HOTELTIME_SNAPSHOT_SLOTS=06,23)` };
    if (!slots.includes(part)) slots.push(part);
  }
  return { slots };
}

/**
 * Plan of an extra snapshot round: every snapshot report that can be re-taken (`refreshAtHour` set — the same set as the 18:00 re-take) whose slot result for
 * today is not done yet, optionally narrowed to `only` (a subset of report ids). Outside the slot's window the plan is empty and `inWindow` is false.
 * Pure: never plans per-day reports, back-fill, period-close or the normal snapshot.
 */
export function planSnapshotSlot(input: {
  readonly now: Date;
  readonly reports: readonly PlannedReport[];
  readonly state: StoreState;
  readonly slot: SnapshotSlot;
  readonly only?: readonly string[];
}): { readonly items: readonly PlannedItem[]; readonly inWindow: boolean; readonly today: string } {
  const today = formatISO(thaiToday(input.now));
  const hour = thaiClock(input.now).hour;
  const w = SLOT_WINDOW[input.slot];
  const inWindow = hour >= w.from && hour < w.to;
  if (!inWindow) return { items: [], inWindow, today };
  const items = input.reports
    .filter(
      (r) =>
        r.family === 'picture' && r.refreshAtHour !== undefined && (input.only === undefined || input.only.includes(r.id)) &&
        !isDone(input.state.get(stateKey(slotRefreshId(r.id, input.slot), today))),
    )
    .map((r) => ({ report: r.id, day: today }));
  return { items, inWindow, today };
}

/** สถานะล่าสุดของรายงานหนึ่งในวันหนึ่ง (CONTEXT.md: มีข้อมูล / ว่าง / ล้ม) · ไม่มีในภาพรวม = ยังไม่ได้ดึง */
export type DayStatus = 'data' | 'empty' | 'failed';

/**
 * ภาพรวมของที่เก็บข้อมูล: (รายงาน, วัน) → สถานะล่าสุด · วัน = วันของข้อมูลสำหรับรายงานตามวัน วันที่ดึงสำหรับรายงาน snapshot และวันสุดท้ายของงวด
 * สำหรับ snapshot ปิดงวด (id `<รายงาน>@period-close`) — ตรงกับโฟลเดอร์รายวันของวันนั้นพอดี (ADR-0005/0008) · key จาก `stateKey`
 */
export type StoreState = ReadonlyMap<string, DayStatus>;

export function stateKey(report: string, day: string): string {
  return `${report}@${day}`;
}

export type PlannedItem = { readonly report: string; readonly day: string };

/** งานของรอบหนึ่ง */
export type WorkPlan = {
  /** รายงานตามวัน × วันของข้อมูลที่ต้องดึง */
  readonly perDay: readonly PlannedItem[];
  /** รายงาน snapshot ที่ต้องถ่าย (day = วันนี้) */
  readonly pictures: readonly PlannedItem[];
  /** snapshot ที่ถ่ายซ้ำรอบเย็น (day = วันนี้ · `report` = id ของรายงาน ไม่ใช่ `refreshId`) — ถ่ายเฉพาะเมื่อ snapshot ปกติของวันนี้สำเร็จแล้ว */
  readonly refreshes: readonly PlannedItem[];
  /** snapshot ปิดงวดที่ต้องถ่าย (day = วันสุดท้ายของงวด — ถ่ายด้วยการค้นวันนั้น ซึ่งได้ทั้งงวดของรายงานยอดสะสม) */
  readonly periodCloses: readonly PlannedItem[];
};

/** งานของรอบรายวัน พร้อมสิ่งที่คนต้องรู้ */
export type DailyPlan = WorkPlan & {
  /** จำนวนวันของข้อมูลที่ยังขาดแต่เกินจำนวนวันสูงสุดต่อรอบ — รอรอบถัดไป (ต้องแจ้งเตือน) */
  readonly backlogDays: number;
  /** ยังไม่ได้ตั้งวันเริ่มใช้งาน — เติมวันที่ขาดไม่ได้ ดึงแค่เมื่อวาน (ต้องบอกวิธีตั้ง ไม่เดาวัน) */
  readonly goLiveMissing: boolean;
  /** วันเริ่มใช้งานอยู่หลังวันนี้ — ยังไม่ดึงรายงานตามวันเลย (ต้องบอก เผื่อพิมพ์ผิด ไม่ให้หยุดเก็บข้อมูลเงียบ ๆ) */
  readonly goLiveInFuture: boolean;
  /** snapshot ปิดงวดที่รอบก่อนล้มและยังอยู่ในช่วงที่ถ่ายได้ (`<รายงาน>@<วันสุดท้ายของงวด>`) — ต้องบอก เพราะพ้นช่วงแล้วจะหายถาวร */
  readonly failingCloses: readonly string[];
};

/**
 * snapshot ปิดงวดถ่ายได้ในกี่วันแรกของงวดถัดไป — "รอบแรกหลังงวดจบ" (ADR-0008) เผื่อวันที่ 1 พลาดหรือล้ม · พ้นแล้วไม่ถ่าย: snapshot ที่ถ่ายช้ากว่านี้คือ snapshot
 * ณ วันที่ถ่าย ไม่ใช่ snapshot ปิดงวด (และไม่ให้เครื่องที่เพิ่งติดตั้งย้อนถ่ายปีที่แล้ว — ใบ 05 code review) · วันละ 3 รอบ = ลองได้ราว 21 ครั้ง
 */
export const PERIOD_CLOSE_WINDOW_DAYS = 7;

/**
 * จำนวนวันของข้อมูลสูงสุดที่รอบเก็บตกเติมในรอบเดียว (ADR-0009) — วัดจริง 2026-10-14: รายงานตามวันหนึ่งวัน ≈ 142 วินาที (22 รายงาน × 6.4 วินาที) ·
 * รายงาน snapshot ≈ 177 วินาที · timeout ค่าเริ่มต้นของ job บน Windmill คือ 15 นาที — snapshot + 3 วัน ≈ 10 นาที เหลือที่ให้การลองใหม่
 * (spec เดิมตั้ง 14 วัน ≈ 33 นาที โดน Windmill ตัดกลางรอบ) · วันละ 3 รอบจึงเติมได้ 9 วันของข้อมูลต่อวัน · รอบ 18:00 ของ HotelTime มี snapshot ถ่ายซ้ำด้วย (ADR-0011) แต่แทนที่ snapshot ที่ถ่ายรอบแรกทีละใบ ไม่ใช่เพิ่มจากกรณีหนักสุดของรอบเที่ยง · ถ้าขยาย timeout ของ Windmill ค่อยเพิ่ม
 */
export const CATCH_UP_CAP_DAYS = 3;

/**
 * เวลาไทยที่วันของข้อมูล "เมื่อวาน" จบครบทุกรายงาน — รายงานยกเลิกของ HotelTime ตัดวันตาม UTC (spec 02 §6) วันของเมื่อวานจึงจบตอน 07:00 ไทย
 * ก่อนเวลานี้รายงานตามวันยังไม่ถึงกำหนด ไม่งั้นรอบที่รันตอนเช้ามืดจะบันทึกว่าวันนั้นเสร็จทั้งที่ยังขาดรายการช่วง 00:00–06:59
 */
const PER_DAY_DUE_HOUR = 7;

/** สำเร็จแล้ว ไม่ต้องทำซ้ำ — ว่าง (ตรวจแล้วว่าไม่มีรายการ) นับเป็นสำเร็จ */
export const isDone = (s: DayStatus | undefined): boolean => s === 'data' || s === 'empty';

/** วันของข้อมูลล่าสุดที่ถึงกำหนดแล้ว ณ `now` — เมื่อวาน ตั้งแต่ 07:00 เวลาไทย ก่อนหน้านั้นวันก่อนเมื่อวาน (`exporter status` ใช้กติกาเดียวกัน) */
export function lastDueDay(now: Date): string {
  const today = formatISO(thaiToday(now));
  return addDaysISO(today, thaiClock(now).hour >= PER_DAY_DUE_HOUR ? -1 : -2);
}

/**
 * แผนของรอบรายวัน: รายงานตามวันของทุกวันของข้อมูลที่ถึงกำหนดแล้วแต่ยังไม่สำเร็จ ตั้งแต่ **วันเริ่มใช้งาน** (ADR-0009 — รอบไหนก็ซ่อมวันที่
 * เครื่องดับไปได้เอง) ไม่เกิน `cap` วันต่อรอบ (ค่าเริ่มต้น `CATCH_UP_CAP_DAYS`) เอาวันใหม่ที่สุดก่อน (เมื่อวานได้เสมอ) ที่เหลือนับเป็น `backlogDays` · ไม่ได้ตั้งวันเริ่มใช้งาน
 * = ดูแค่เมื่อวาน · รายงาน snapshot: ของวันนี้ที่ยังไม่สำเร็จ (snapshot ของวันที่ผ่านไปแล้วเติมไม่ได้)
 */
export function planDailyRun(input: {
  readonly now: Date;
  readonly reports: readonly PlannedReport[];
  readonly state: StoreState;
  /** วันเริ่มใช้งาน (ISO) · ไม่ใส่/null = ยังไม่ได้ตั้ง */
  readonly goLive?: string | null;
  /** จำนวนวันของข้อมูลสูงสุดที่เติมในรอบเดียว — ไม่ใส่ = `CATCH_UP_CAP_DAYS` */
  readonly cap?: number;
}): DailyPlan {
  const today = formatISO(thaiToday(input.now));
  const due = (family: ReportFamily, day: string) =>
    input.reports
      .filter((r) => r.family === family && !isDone(input.state.get(stateKey(r.id, day))))
      .map((r) => ({ report: r.id, day }));

  const last = lastDueDay(input.now);
  const goLive = input.goLive ?? null;
  const first = goLive ?? addDaysISO(today, -1); // ไม่มีวันเริ่มใช้งาน = ดูแค่เมื่อวาน (ก่อน 07:00 ยังไม่ถึงกำหนด ลูปจึงว่าง)
  const missing: string[] = []; // ใหม่ไปเก่า
  for (let day = last; day >= first; day = addDaysISO(day, -1)) {
    if (due('per-day', day).length > 0) missing.push(day);
  }
  const taken = missing.slice(0, input.cap ?? CATCH_UP_CAP_DAYS);
  // snapshot ปิดงวดของงวดที่จบล่าสุดที่ยังไม่มี — ภายใน PERIOD_CLOSE_WINDOW_DAYS วันแรกของงวดถัดไป (วันที่ 1 พลาดหรือล้มก็ลองรอบถัดไป) ·
  // ไม่ย้อนไปงวดที่จบก่อนวันเริ่มใช้งาน
  const periodCloses: PlannedItem[] = [];
  const failingCloses: string[] = [];
  for (const r of input.reports) {
    if (r.family !== 'picture' || r.period === undefined || r.period === 'none') continue;
    const end = lastClosedPeriodEnd(today, r.period);
    if (!closeStillDue(end, today) || (goLive !== null && end < goLive)) continue;
    const status = input.state.get(stateKey(periodCloseId(r.id), end));
    if (isDone(status)) continue;
    periodCloses.push({ report: r.id, day: end });
    if (status === 'failed') failingCloses.push(`${r.id}@${end}`);
  }
  // ถ่ายซ้ำ: ถึงชั่วโมงที่ขอ + snapshot ปกติของวันนี้สำเร็จแล้ว (ยังไม่สำเร็จ = รอบนี้ถ่ายใหม่อยู่แล้ว ไม่ถ่ายสองใบ) + ผลถ่ายซ้ำของวันนี้ยังไม่สำเร็จ
  const hour = thaiClock(input.now).hour;
  const refreshes = input.reports
    .filter(
      (r) =>
        r.family === 'picture' && r.refreshAtHour !== undefined && hour >= r.refreshAtHour &&
        isDone(input.state.get(stateKey(r.id, today))) && !isDone(input.state.get(stateKey(refreshId(r.id), today))),
    )
    .map((r) => ({ report: r.id, day: today }));
  return {
    perDay: [...taken].sort().flatMap((day) => due('per-day', day)),
    pictures: due('picture', today),
    refreshes,
    periodCloses,
    backlogDays: missing.length - taken.length,
    goLiveMissing: goLive === null,
    goLiveInFuture: goLive !== null && goLive > today,
    failingCloses,
  };
}

/** วันสุดท้ายที่รอบรายวันยังถ่าย/ลองถ่าย snapshot ปิดงวดของงวดที่จบวันที่ `end` — พ้นแล้วหายถาวร (`exporter status` ใช้กติกาเดียวกัน) */
export function periodCloseRetryUntil(end: string): string {
  return addDaysISO(end, PERIOD_CLOSE_WINDOW_DAYS);
}

/** ยังอยู่ในช่วงที่ถ่าย snapshot ปิดงวดของงวดที่จบวันที่ `end` ได้ไหม */
function closeStillDue(end: string, today: string): boolean {
  return today <= periodCloseRetryUntil(end);
}

/**
 * วันของโฟลเดอร์ที่ตัววางแผนต้องอ่าน `_run.json` — ตั้งแต่วันเริ่มใช้งาน (ถ้าก่อนเมื่อวาน) หรือเมื่อวาน ถึงวันนี้ · ผู้เรียกอ่านตามนี้แล้วส่ง
 * ภาพรวมกลับมา กติกาช่วงวันจึงอยู่ที่ตัววางแผนที่เดียว
 */
export function daysToRead(input: { readonly now: Date; readonly goLive: string | null }): string[] {
  const today = formatISO(thaiToday(input.now));
  const yesterday = addDaysISO(today, -1);
  // วันสุดท้ายของงวดที่จบล่าสุดที่ยังถ่าย snapshot ปิดงวดได้ — ที่อยู่ของ snapshot ปิดงวด (ใบ 05)
  const out = [lastClosedPeriodEnd(today, 'year'), lastClosedPeriodEnd(today, 'month')].filter((end) => closeStillDue(end, today));
  for (let day = input.goLive !== null && input.goLive < yesterday ? input.goLive : yesterday; day <= today; day = addDaysISO(day, 1)) {
    out.push(day);
  }
  return [...new Set(out)].sort();
}

/** วันสุดท้ายของงวด (เดือน/ปี) ที่จบล่าสุดก่อน `today` — เดือนที่แล้ว หรือปีที่แล้ว */
function lastClosedPeriodEnd(today: string, period: Exclude<ReportPeriod, 'none'>): string {
  return period === 'month' ? addDaysISO(`${today.slice(0, 7)}-01`, -1) : `${Number(today.slice(0, 4)) - 1}-12-31`;
}

/** คำสั่งที่ทำตามไม่ได้ (เช่น `--date` ที่ยังไม่ถึงกำหนด) — ข้อความบอกเหตุผลและวิธีแก้ */
export class PlanError extends Error {
  override readonly name = 'PlanError';
}

/**
 * `--date`: คนสั่งดึงวันของข้อมูลวันเดียวใหม่ ไม่สนสถานะเดิม (ฉบับเก่าไม่หาย — ย้ายไป `_superseded/` ถ้าชื่อชน ADR-0005) · ไม่ถ่ายรายงาน snapshot
 * เพราะ snapshot ของวันที่ผ่านไปแล้วดึงไม่ได้ · ปฏิเสธวันที่ยังไม่ถึงกำหนด (วันนี้ อนาคต เมื่อวานก่อน 07:00) — ดึงตอนนั้นได้ข้อมูลไม่ครบวัน
 */
export function planDateRun(input: { readonly now: Date; readonly reports: readonly PlannedReport[]; readonly day: string }): WorkPlan {
  const { day } = input;
  if (parseISODate(day) === null) {
    throw new PlanError(`--date ต้องเป็นวันที่จริงแบบ YYYY-MM-DD (เช่น 2026-10-12) — ได้มา ${JSON.stringify(day)}`);
  }
  const last = lastDueDay(input.now);
  if (day > last) {
    throw new PlanError(
      `--date ${day} ยังไม่ถึงกำหนด — วันของข้อมูลล่าสุดที่จบครบแล้วคือ ${last} ` +
        '(เมื่อวานถึงกำหนดตั้งแต่ 07:00 เวลาไทย เพราะรายงานยกเลิกตัดวันตาม UTC)',
    );
  }
  const perDay = input.reports.filter((r) => r.family === 'per-day').map((r) => ({ report: r.id, day }));
  if (perDay.length === 0) {
    throw new PlanError('--date ใช้กับรายงานตามวันเท่านั้น — รายงาน snapshot เป็น snapshot ณ เวลาที่ถ่าย ดึงย้อนเป็น snapshot ของวันที่ผ่านไปแล้วไม่ได้');
  }
  return { perDay, pictures: [], refreshes: [], periodCloses: [] };
}

/**
 * แผนของ **baseline** (ใบ 09, ADR-0008) — ดึงวันของข้อมูลในช่วงใหม่หมดทีละวัน (ไฟล์ละวัน ชื่อ/key เดียวกับรอบรายวัน ฉบับใหม่แทนฉบับเก่าได้ในขาอัปโหลด)
 * ไม่สนสถานะในที่เก็บข้อมูล · เรียงตามวัน (เก่าไปใหม่) แล้วตามแคตตาล็อก · **รายงาน snapshot**ไม่มี baseline — snapshot ณ เวลาที่ถ่าย ดึงย้อนหลังไม่ได้ (ADR-0003/0008)
 */
export function planBaselineRun(input: { readonly reports: readonly PlannedReport[]; readonly from: string; readonly to: string }): {
  readonly items: readonly PlannedItem[];
  readonly skipped: readonly SkippedReport[];
} {
  const perDay = input.reports.filter((r) => r.family === 'per-day');
  const items: PlannedItem[] = [];
  for (let day = input.from; day <= input.to; day = addDaysISO(day, 1)) {
    for (const r of perDay) items.push({ report: r.id, day });
  }
  const skipped = input.reports
    .filter((r) => r.family === 'picture')
    .map((r) => ({ report: r.id, reason: 'รายงาน snapshot ไม่มี baseline — เป็น snapshot ณ เวลาที่ถ่าย ดึงย้อนหลังไม่ได้ (ADR-0003/0008)' }));
  return { items, skipped };
}

/**
 * ภาพรวมของที่เก็บข้อมูลจาก `_run.json` ของโฟลเดอร์รายวัน (`day` = วันของโฟลเดอร์) · มีแถว = มีข้อมูล · 0 แถว = ว่าง · ล้ม = ล้ม
 * (**ว่าง** บันทึกเป็นผล `ok` ที่ 0 แถวและไม่มีไฟล์ — ได้มาจากการตรวจหน้าผลลัพธ์ก่อนกด export เท่านั้น การล้มทุกแบบบันทึกเป็น `failed` เสมอ)
 *
 * 🔴 รายงานตามวันนับเฉพาะผลที่ขอ**วันนั้นวันเดียว** — รอบรูปแบบเดิม (ช่วงเหลื่อม 3 วัน ถึงวันที่ดึง) ไม่มีครึ่งหลังของวันสุดท้าย และ
 * `manager-day-detail` แบบเดิมเก็บของเมื่อวานไว้ในโฟลเดอร์ของวันที่ดึง — นับไม่ได้ว่าวันนั้นเสร็จ · รายงานที่ไม่อยู่ในแคตตาล็อกไม่นับ
 * · รายงานตามวันที่รอบของมันเริ่ม**ในวันนั้นเอง**หรือก่อน (เวลาไทย) ไม่นับทั้งผ่านและล้ม — โมเดลใหม่ดึงวัน D ตั้งแต่ D+1 เสมอ ผลที่ดึงในวัน D คือรอบ
 *   รูปแบบเดิมที่ได้ครึ่งวัน (ใบ 07) · ไม่มีรายการรอบที่บอกได้ (บันทึกเก่าบางรูป) = ใช้กติกาช่วงวันอย่างเดียว
 */
export function storeStateFrom(
  folders: readonly { readonly day: string; readonly record: RunRecord }[],
  reports: readonly PlannedReport[],
): Map<string, DayStatus> {
  const family = new Map(reports.map((r) => [r.id, r.family]));
  const state = new Map<string, DayStatus>();
  for (const { day, record } of folders) {
    for (const [id, o] of Object.entries(record.reports)) {
      // snapshot ปิดงวดนับเป็น snapshot (ไม่มีกติกาช่วงวันเดียวของรายงานตามวัน) — แต่รายงานต้นทางต้องอยู่ในแคตตาล็อก
      // snapshot ถ่ายซ้ำก็เป็นแบบเดียวกัน (ADR-0011)
      const isClose = id.endsWith(PERIOD_CLOSE_SUFFIX);
      const retake = parseRefreshId(id); // `@refresh` and the extra rounds `@refresh-<HH>` (ADR-0013)
      const baseId = isClose ? id.slice(0, -PERIOD_CLOSE_SUFFIX.length) : retake !== null ? retake.base : null;
      const f = baseId !== null ? (family.has(baseId) ? 'picture' : undefined) : family.get(id);
      if (f === undefined) continue;
      if (f === 'per-day' && !isClose && fetchedOnOrBefore(record, id, day)) continue;
      if (o.status === 'failed') {
        state.set(stateKey(id, day), 'failed');
        continue;
      }
      if (f === 'per-day' && (o.range.from !== day || o.range.to !== day)) continue;
      state.set(stateKey(id, day), o.rows > 0 ? 'data' : 'empty');
    }
  }
  return state;
}

/** รอบล่าสุดที่มีรายงานนี้เริ่มในวัน `day` หรือก่อน (เวลาไทย) · ไม่มีรอบที่บอกได้ = false */
function fetchedOnOrBefore(record: RunRecord, id: string, day: string): boolean {
  const run = record.runs.findLast((r) => r.reports.includes(id));
  if (run === undefined) return false;
  const started = thaiDateOf(run.startedAt);
  return started !== null && started <= day;
}

/**
 * ค่า **วันเริ่มใช้งาน** จาก `.env` (`EXPORTER_GO_LIVE` — ค่าเดียวใช้ทั้งสอง Site) · ว่าง/ไม่ตั้ง = null (ไม่เดาวัน) · ไม่ใช่วันที่จริงแบบ YYYY-MM-DD =
 * คืนข้อความผิดให้ config ของแต่ละ Site โยนเป็น error ของตัวเอง
 */
export const GO_LIVE_ENV = 'EXPORTER_GO_LIVE';

export function parseGoLive(raw: string | undefined): { readonly goLive: string | null } | { readonly error: string } {
  if (raw === undefined || raw.trim() === '') return { goLive: null };
  const v = raw.trim();
  if (parseISODate(v) === null) {
    return { error: `${GO_LIVE_ENV} ต้องเป็นวันที่จริงแบบ YYYY-MM-DD (เช่น 2026-10-20) — ได้มา ${JSON.stringify(raw)}` };
  }
  return { goLive: v };
}

/** คำเตือนของแผนรอบรายวัน — ภาษาคนอ่าน ใช้ทั้งบนจอ ใน JSON และใน `_run.json` / `_summary.txt` */
export function planWarnings(plan: DailyPlan, goLive: string | null, site: { readonly dateOption: boolean }): string[] {
  const out: string[] = [];
  if (plan.backlogDays > 0) {
    // แนะนำ --date เฉพาะ Site ที่สั่งได้ — FoodStory ไม่มี --date (กด captcha ต่อรอบ · ADR-0006)
    out.push(
      `ยังขาดอีก ${plan.backlogDays} วันของข้อมูล เกินจำนวนวันสูงสุดต่อรอบ (${CATCH_UP_CAP_DAYS}) — รอบถัดไปเติมต่อเอง` +
        (site.dateOption ? ' (หรือสั่ง --date ทีละวันถ้าต้องการเร็วกว่านั้น)' : ''),
    );
  }
  if (plan.goLiveMissing) {
    out.push(
      'ยังไม่ได้ตั้งวันเริ่มใช้งาน — ดึงแค่เมื่อวาน ไม่เติมวันที่ขาด · ตั้งใน exporter/.env เป็นวันแรกที่ระบบต้องมีข้อมูลครบ ' +
        'เช่น EXPORTER_GO_LIVE=2026-10-20',
    );
  }
  for (const c of plan.failingCloses) {
    out.push(`snapshot ปิดงวด ${c} ยังไม่สำเร็จ — ลองซ้ำทุกรอบภายใน ${PERIOD_CLOSE_WINDOW_DAYS} วันแรกของงวดถัดไป พ้นแล้วจะไม่มี snapshot ปิดงวดนี้`);
  }
  if (plan.goLiveInFuture) {
    out.push(`วันเริ่มใช้งาน (EXPORTER_GO_LIVE=${goLive}) ยังไม่มาถึง — ยังไม่ดึงรายงานตามวันเลย · ถ้าพิมพ์ผิดให้แก้ใน exporter/.env`);
  }
  return out;
}
