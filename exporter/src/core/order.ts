/**
 * "ใบสั่ง" — โครงสร้างที่ถือความจริงว่ารอบนี้ขออะไร
 *
 * runner สร้างใบสั่งขึ้นมา *ก่อน* เปิดเบราว์เซอร์ แล้วชั้นตรวจจะ **เทียบ** ไฟล์ที่ได้
 * กับใบสั่งนี้ ไม่ใช่ตีความจากไฟล์เอาเอง — เปลี่ยนปัญหาใช้วิจารณญาณให้เป็นปัญหาเปรียบเทียบค่า
 *
 * ไฟล์นี้เป็น logic ล้วน ไม่แตะเบราว์เซอร์ ทดสอบได้ด้วย node --test
 */

/**
 * เพดานจำนวนแถวของ HotelTime — ค้นพบ 2026-09-08
 *
 * 🔴 ถ้าผลลัพธ์ออกมา "เท่ากับ" ค่านี้พอดี ให้ถือว่า **ชนเพดานและข้อมูลถูกตัด**
 * ไม่ใช่ผลลัพธ์ที่ถูกต้อง · HotelTime ตัดเงียบ ๆ ไม่มี error ไม่มีตัวแบ่งหน้า
 * และตัวเลขสรุปท้ายหน้าก็ถูกคำนวณหลังตัดแล้ว จึงตรงกับไฟล์เสมอ
 * รายละเอียดการวัดอยู่ใน recon/NOTES.md
 */
export const ROW_CAP = 2000;

/** ช่วงวันที่แบบรวมปลายทั้งสองข้าง (inclusive) — เก็บเป็น UTC midnight เพื่อไม่ให้ timezone เลื่อนวัน */
export type DateRange = {
  readonly from: Date;
  readonly to: Date;
};

export type Order = {
  readonly reportId: string;
  /** ช่วง created date ที่ก้อนนี้ขอ */
  readonly range: DateRange;
  /** id ของการรันทั้งชุด ใช้ผูก log กับไฟล์ที่ได้ */
  readonly runId: string;
};

export class OrderError extends Error {
  override readonly name = 'OrderError';
}

export function utcDate(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/** `DD/MM/YYYY` — รูปแบบที่ช่องวันที่ของ HotelTime ใช้ (ยืนยันจากค่า default ของหน้าเว็บ) */
export function formatDMY(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

export function parseDMY(s: string): Date {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) throw new OrderError(`วันที่ต้องอยู่ในรูปแบบ DD/MM/YYYY — ได้มา ${JSON.stringify(s)}`);
  const [, dd, mm, yyyy] = m;
  const d = utcDate(Number(yyyy), Number(mm), Number(dd));
  if (formatDMY(d) !== s.trim()) throw new OrderError(`ไม่มีวันที่นี้อยู่จริง: ${s}`);
  return d;
}

/** `YYYY-MM-DD` — ใช้ตั้งชื่อไฟล์ เรียงตามตัวอักษรแล้วได้ลำดับเวลาพอดี */
export function formatISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → วันที่ (เที่ยงคืน UTC แบบ `utcDate`) · ไม่ใช่วันที่จริงแบบนี้ (เช่น `2026-02-30`, `14/10/2026`) = null */
export function parseISODate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(Date.parse(`${s}T00:00:00Z`));
  return formatISO(d) === s ? d : null;
}

/** บวก/ลบวันของวันที่ ISO (`YYYY-MM-DD`) — ผู้เรียกรับประกันว่าเป็นวันที่ถูกต้องแล้ว */
export function addDaysISO(day: string, n: number): string {
  return formatISO(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));
}

/** ค่าเริ่มต้นของวันเริ่ม เมื่อไม่ได้ระบุ `--from` และไม่ได้ใช้ `--last-days` */
export const DEFAULT_FROM_DMY = '01/01/2024';

/**
 * ช่วง N วันล่าสุดนับถึงวันนี้ รวมวันนี้ด้วย — `n=1` ได้แค่วันนี้วันเดียว
 *
 * 🔴 `n=0` ถูกปฏิเสธเหมือนค่าติดลบ ไม่ใช่คืนช่วงว่างเงียบ ๆ — "0 วันล่าสุด" ไม่มีความหมาย
 * ที่ชัดเจนพอจะเดาแทนผู้ใช้ได้ (ช่วงกลับด้าน from > to จะไหลเข้าโค้ดส่วนอื่นที่ไม่รองรับ)
 */
export function lastDaysRange(n: number, today: Date): DateRange {
  if (!Number.isInteger(n) || n < 1) {
    throw new OrderError(`--last-days ต้องเป็นจำนวนเต็มบวก (>= 1) — ได้มา ${n}`);
  }
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - (n - 1));
  return { from, to: today };
}

export type DateRangeOptions = {
  readonly from?: string;
  readonly to?: string;
  readonly lastDays?: number;
};

/**
 * แปลง flag ดิบจาก CLI เป็นช่วงวันที่ช่วงเดียว — จุดเดียวที่ตัดสินว่า `--last-days` ใช้คู่กับ
 * `--from`/`--to` ไม่ได้ · สั่งพร้อมกันคือสั่งขัดแย้งกันเอง ต้องล้มดัง ๆ ไม่ใช่ให้ตัวใดตัวหนึ่ง
 * ชนะเงียบ ๆ โดยผู้ใช้ไม่รู้ตัว
 */
export function resolveDateRange(opts: DateRangeOptions, today: Date): DateRange {
  if (opts.lastDays !== undefined) {
    if (opts.from !== undefined || opts.to !== undefined) {
      throw new OrderError(
        'ใช้ --last-days พร้อมกับ --from หรือ --to ไม่ได้ — เลือกอย่างใดอย่างหนึ่ง',
      );
    }
    return lastDaysRange(opts.lastDays, today);
  }
  return {
    from: parseDMY(opts.from ?? DEFAULT_FROM_DMY),
    to: opts.to === undefined ? today : parseDMY(opts.to),
  };
}

export type RunKind = 'daily' | 'baseline' | 'manual';

/**
 * ความถี่ **baseline** เริ่มต้น (วัน) — ค่าตั้งต้นจากสเปกตอน grill-with-docs (เดือนละครั้ง)
 * 🔴 ยังไม่ได้ยืนยันด้วยข้อมูลจริง — ตัดสินใจ 2026-09-17 ให้รอวัด drift ให้ครบทั้ง 3 รายงาน
 * ก่อนฟันธง (ดู `recon/drift-measurement-2026-09-17.md`) ค่านี้จึงเป็นค่าชั่วคราว ไม่ใช่ค่าสุดท้าย
 */
export const DEFAULT_BASELINE_INTERVAL_DAYS = 30;

export type RunPlan = {
  readonly kind: RunKind;
  readonly range: DateRange;
  /** มีค่าเฉพาะ kind === 'baseline' — ระยะที่ baseline รอบนี้ตั้งใจครอบคลุมจนกว่าจะมีรอบถัดไป */
  readonly baselineIntervalDays?: number;
};

export type RunPlanOptions = {
  readonly daily?: boolean;
  readonly baseline?: boolean;
  /** ใช้ได้เฉพาะกับ baseline */
  readonly baselineIntervalDays?: number;
  readonly from?: string;
  readonly to?: string;
  readonly lastDays?: number;
};

/**
 * แปลง flag ดิบจาก CLI เป็นแผนการรันเดียว (ชนิด + ช่วงวัน) — จุดเดียวที่ตัดสินว่า
 * `--daily`/`--baseline`/(`--from`,`--to`,`--last-days`) ใช้ปนกันไม่ได้ · ทุกโหมดต่างกันแค่
 * ช่วงวันที่ขอ ไม่ใช่กลไกคนละตัว (ตามสเปก) — ทั้งสองโหมดยังคงเรียก `lastDaysRange`/
 * `parseDMY` เดียวกับโหมด manual เป๊ะ ๆ
 */
export function resolveRunPlan(opts: RunPlanOptions, today: Date): RunPlan {
  if (opts.daily && opts.baseline) {
    throw new OrderError('เลือกได้แค่ --daily หรือ --baseline อย่างใดอย่างหนึ่ง');
  }

  if (opts.daily) {
    if (opts.from !== undefined || opts.to !== undefined || opts.lastDays !== undefined) {
      throw new OrderError('ใช้ --daily พร้อมกับ --from/--to/--last-days ไม่ได้');
    }
    if (opts.baselineIntervalDays !== undefined) {
      throw new OrderError('--baseline-interval-days ใช้ได้เฉพาะกับ --baseline');
    }
    // วันที่จริงของรอบรายวันมาจากตัววางแผน (core/run-planner.ts, ADR-0008) — ตรงนี้ตัดสินแค่ชนิดรอบและ flag ที่ขัดกัน
    return { kind: 'daily', range: lastDaysRange(1, today) };
  }

  if (opts.baseline) {
    // baseline ดึงวันของข้อมูลใหม่ทีละวัน (ใบ 09, ADR-0008) — วันนี้ยังไม่ครบจึงไม่อยู่ในช่วง · ไม่สั่งช่วง = `baselineIntervalDays` วันล่าสุดถึงเมื่อวาน
    // (เจ้าของเลือก 2026-10-14 — ช่วงเดิมตั้งแต่ปี 2024 ทีละวันใช้หลายสิบชั่วโมง)
    if (opts.lastDays !== undefined) throw new OrderError('ใช้ --baseline พร้อมกับ --last-days ไม่ได้ — ใช้ --from/--to หรือไม่ใส่ (ได้ช่วงเริ่มต้น)');
    if ((opts.from === undefined) !== (opts.to === undefined)) {
      throw new OrderError('--baseline ต้องใส่ทั้ง --from และ --to หรือไม่ใส่ทั้งคู่ (ได้ช่วงเริ่มต้นถึงเมื่อวาน)');
    }
    const intervalDays = opts.baselineIntervalDays ?? DEFAULT_BASELINE_INTERVAL_DAYS;
    const yesterday = addDays(today, -1);
    const range = opts.from !== undefined && opts.to !== undefined
      ? { from: parseDMY(opts.from), to: parseDMY(opts.to) }
      : { from: addDays(today, -intervalDays), to: yesterday };
    if (range.to.getTime() > yesterday.getTime()) {
      throw new OrderError(`--baseline ดึงได้ถึงเมื่อวาน (${formatDMY(yesterday)}) — วันนี้ยังไม่ครบ ได้มา --to ${formatDMY(range.to)}`);
    }
    if (range.from.getTime() > range.to.getTime()) throw new OrderError('--from ต้องไม่หลัง --to');
    return { kind: 'baseline', range, baselineIntervalDays: intervalDays };
  }

  if (opts.baselineIntervalDays !== undefined) {
    throw new OrderError('--baseline-interval-days ใช้ได้เฉพาะกับ --baseline');
  }

  return {
    kind: 'manual',
    range: resolveDateRange({ from: opts.from, to: opts.to, lastDays: opts.lastDays }, today),
  };
}

export type SkippedReport = { readonly report: string; readonly reason: string };

/**
 * แบ่งรายงานของรอบ `--report all` ที่ไม่ใช่รายวัน (back-fill, `--from`/`--to`, `--last-days`, `--baseline`) เป็น "รัน" กับ "ข้าม" —
 * รายงาน dailyOnly (ADR-0003, ตัวกรองเป็นวันเดียว) ดึงหลายวันในรอบเดียวไม่ได้ จึงข้ามพร้อมเหตุผลแทนที่จะนับเป็น "ล้ม" · รอบรายวันไม่ผ่าน
 * ฟังก์ชันนี้ (ตัววางแผนตัดสินเอง — core/run-planner.ts)
 */
export function partitionForRunAll<R extends { readonly id: string; readonly dailyOnly: boolean }>(
  reports: readonly R[],
): { readonly run: R[]; readonly skipped: SkippedReport[] } {
  const run: R[] = [];
  const skipped: SkippedReport[] = [];
  for (const r of reports) {
    if (r.dailyOnly) {
      skipped.push({ report: r.id, reason: 'รายงานรายวันอย่างเดียว (ADR-0003) — ดึงได้เฉพาะรอบ --daily ไม่มี back-fill' });
    } else {
      run.push(r);
    }
  }
  return { run, skipped };
}

export function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * ซอยช่วงยาวเป็นก้อนรายเดือนตามปฏิทิน
 *
 * ทำไมรายเดือน: วัดจริง 2026-09-08 พบว่าเดือนที่หนาที่สุด 662 แถว (เหลือ headroom 3 เท่า)
 * ขณะที่รายไตรมาสหนาสุด 1353 (เหลือ 32%) และรายครึ่งปีชนเพดานแล้ว
 *
 * ก้อนแรกกับก้อนสุดท้ายถูกตัดให้พอดีกับช่วงที่ขอ ไม่เลยออกไป
 */
export function monthChunks(range: DateRange): DateRange[] {
  if (range.to < range.from) {
    throw new OrderError(`ช่วงวันที่กลับหัว: ${formatDMY(range.from)} → ${formatDMY(range.to)}`);
  }

  const chunks: DateRange[] = [];
  let year = range.from.getUTCFullYear();
  let month = range.from.getUTCMonth() + 1;

  for (;;) {
    const monthStart = utcDate(year, month, 1);
    const monthEnd = utcDate(year, month, lastDayOfMonth(year, month));
    const from = monthStart < range.from ? range.from : monthStart;
    const to = monthEnd > range.to ? range.to : monthEnd;
    chunks.push({ from, to });

    if (monthEnd >= range.to) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }

  return chunks;
}

/**
 * ผ่าช่วงเป็นสองครึ่ง — ใช้ตอนก้อนหนึ่งชนเพดาน 2000 แล้วต้องดึงใหม่แบบละเอียดขึ้น
 *
 * คืน null เมื่อช่วงเหลือวันเดียวแล้วผ่าต่อไม่ได้ ซึ่งแปลว่าวันเดียวมีเกิน 2000 แถว
 * — กรณีนั้นเราดึงข้อมูลให้ครบไม่ได้ด้วยเครื่องมือนี้ ต้องล้มแล้วเรียกคน
 */
export function splitRange(range: DateRange): [DateRange, DateRange] | null {
  const span = daysBetween(range.from, range.to);
  if (span < 1) return null;
  const mid = addDays(range.from, Math.floor(span / 2));
  return [
    { from: range.from, to: mid },
    { from: addDays(mid, 1), to: range.to },
  ];
}

/** จัดกลุ่มก้อนตามปีปฏิทิน — ใช้ตอนรวมผลเป็นไฟล์รายปี */
export function groupByYear(chunks: readonly DateRange[]): Map<number, DateRange[]> {
  const out = new Map<number, DateRange[]>();
  for (const c of chunks) {
    // ก้อนรายเดือนไม่มีทางคร่อมปี เพราะ monthChunks ตัดตามปฏิทินอยู่แล้ว
    const y = c.from.getUTCFullYear();
    const list = out.get(y);
    if (list) list.push(c);
    else out.set(y, [c]);
  }
  return out;
}

/** ช่วงที่ครอบทุกก้อน ใช้ตั้งชื่อไฟล์รวมและใส่ใน metadata */
export function spanOf(chunks: readonly DateRange[]): DateRange {
  if (chunks.length === 0) throw new OrderError('ไม่มีก้อนให้คำนวณช่วง');
  let from = chunks[0]!.from;
  let to = chunks[0]!.to;
  for (const c of chunks) {
    if (c.from < from) from = c.from;
    if (c.to > to) to = c.to;
  }
  return { from, to };
}

/**
 * ยืนยันว่าก้อนทั้งหมดต่อกันสนิทไม่มีรูและไม่ทับกัน
 *
 * ป้องกันความผิดพลาดที่ร้ายแรงที่สุดของการแบ่งก้อน: เดือนหนึ่งหายไปเงียบ ๆ
 * แล้วไฟล์รวมขาดข้อมูลโดยไม่มีอะไรฟ้อง
 */
export function assertContiguous(chunks: readonly DateRange[], expected: DateRange): void {
  if (chunks.length === 0) throw new OrderError('ไม่มีก้อนเลย');

  const sorted = [...chunks].sort((a, b) => a.from.getTime() - b.from.getTime());

  if (sorted[0]!.from.getTime() !== expected.from.getTime()) {
    throw new OrderError(
      `ก้อนแรกเริ่มที่ ${formatDMY(sorted[0]!.from)} แต่ใบสั่งขอเริ่ม ${formatDMY(expected.from)}`,
    );
  }
  const last = sorted[sorted.length - 1]!;
  if (last.to.getTime() !== expected.to.getTime()) {
    throw new OrderError(
      `ก้อนสุดท้ายจบที่ ${formatDMY(last.to)} แต่ใบสั่งขอจบ ${formatDMY(expected.to)}`,
    );
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const gap = daysBetween(prev.to, cur.from);
    if (gap !== 1) {
      throw new OrderError(
        gap > 1
          ? `มีรูระหว่างก้อน: ${formatDMY(prev.to)} → ${formatDMY(cur.from)} ห่างกัน ${gap} วัน`
          : `ก้อนทับกัน: ${formatDMY(prev.to)} กับ ${formatDMY(cur.from)}`,
      );
    }
  }
}
