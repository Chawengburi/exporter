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
};

/**
 * id ที่ใช้บันทึกผลของ **snapshot ปิดงวด** ใน `_run.json` — แยกจาก snapshot ปกติของรายงานเดียวกัน เพราะ snapshot ปิดงวดอยู่ในโฟลเดอร์ของวันสุดท้ายของงวด
 * ซึ่งมี snapshot ปกติของวันนั้นอยู่แล้ว (`_run.json` เก็บได้หนึ่งสถานะต่อ id ต่อโฟลเดอร์)
 */
export const PERIOD_CLOSE_SUFFIX = '@period-close';

export function periodCloseId(report: string): string {
  return `${report}${PERIOD_CLOSE_SUFFIX}`;
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
 * (spec เดิมตั้ง 14 วัน ≈ 33 นาที โดน Windmill ตัดกลางรอบ) · วันละ 3 รอบจึงเติมได้ 9 วันของข้อมูลต่อวัน · ถ้าขยาย timeout ของ Windmill ค่อยเพิ่ม
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
  return {
    perDay: [...taken].sort().flatMap((day) => due('per-day', day)),
    pictures: due('picture', today),
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
  return { perDay, pictures: [], periodCloses: [] };
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
      const isClose = id.endsWith(PERIOD_CLOSE_SUFFIX);
      const f = isClose ? (family.has(id.slice(0, -PERIOD_CLOSE_SUFFIX.length)) ? 'picture' : undefined) : family.get(id);
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
