import { formatISO, utcDate } from './order.ts';

/**
 * เวลาของ exporter = เวลาไทยเสมอ ไม่ขึ้นกับ TZ ของเครื่องที่รัน (ticket 27 ของ exporter-daily-expansion-and-data-store)
 *
 * "วันนี้" ของรอบ ชื่อโฟลเดอร์ baseline/backfill/monthly และเวลาใน `_summary.txt` คำนวณจากที่นี่ที่เดียว · เดิมใช้ getter แบบ local
 * ซึ่งบน Windmill เป็น UTC เพราะ Windmill ไม่ส่ง env `TZ` ของ container ต่อให้ job (เจอจริง 2026-10-08: จบ 18:48 แต่สรุปเขียน 11:48)
 * · คำนวณเองด้วย offset คงที่ แทนการตั้ง `process.env.TZ` ทั้ง process — ประเทศไทยไม่มี daylight saving (UTC+7 ตลอดปี)
 */
const THAI_OFFSET_MS = 7 * 3_600_000;

export type ThaiClock = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

export function thaiClock(at: Date): ThaiClock {
  const t = new Date(at.getTime() + THAI_OFFSET_MS);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    second: t.getUTCSeconds(),
  };
}

/** วันตามปฏิทินไทยของ `now` ในรูป `utcDate` (เที่ยงคืน UTC) แบบเดียวกับวันที่อื่น ๆ ใน exporter */
export function thaiToday(now: Date = new Date()): Date {
  const c = thaiClock(now);
  return utcDate(c.year, c.month, c.day);
}

/** วันตามปฏิทินไทย (`YYYY-MM-DD`) ของเวลาแบบ ISO ใน `_run.json` · อ่านไม่ออก = null */
export function thaiDateOf(iso: string): string | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : formatISO(thaiToday(at));
}

/** เวลาไทยแบบ ISO 8601 เต็มพร้อม offset เช่น `2026-10-13T12:00:00+07:00` — เวลาที่ถ่ายของไฟล์ใน manifest ให้คนอ่านและเครื่องอ่านได้ตรงกัน */
export function thaiIsoString(at: Date): string {
  const c = thaiClock(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${c.year}-${p(c.month)}-${p(c.day)}T${p(c.hour)}:${p(c.minute)}:${p(c.second)}+07:00`;
}
