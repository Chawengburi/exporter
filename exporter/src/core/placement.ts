import path from 'node:path';
import { formatISO, type DateRange, type RunKind } from './order.ts';
import { thaiClock } from './thai-time.ts';

/**
 * ตัววางไฟล์ของคลังผลลัพธ์ (ADR-0005) — ตัดสินว่าผลของรอบหนึ่งลงโฟลเดอร์ไหน ชื่อไฟล์อะไร
 *
 * ฟังก์ชันล้วนไม่แตะดิสก์ ใช้ร่วมทุก Site · โครงคือ `data/<site>/<ชนิดรอบ>/…` และ **วันที่บนโฟลเดอร์
 * รายวันคือวันสุดท้ายที่ข้อมูลครอบคลุม** ไม่ใช่วันที่รัน — คนที่อยากดูข้อมูลวันที่ 6 เปิดโฟลเดอร์ 6 ได้
 * ทั้งสอง Site แม้ FoodStory จะดึงของเมื่อวานในวันที่ 7
 */

export type SiteId = 'hoteltime' | 'foodstory';

/** ชื่อโฟลเดอร์ของชนิดรอบบนดิสก์ — `manual` (back-fill, `--from`/`--to`, `--last-days`) ใช้คำว่า backfill */
const KIND_DIR: Readonly<Record<RunKind, string>> = { daily: 'daily', baseline: 'baseline', manual: 'backfill' };

/** `data/<site>/<ชนิดรอบ>/` — รากของโฟลเดอร์รอบทั้งหมดของชนิดนั้น (และที่อยู่ของตัวชี้ `latest`) */
export function kindRoot(root: string, site: SiteId, kind: RunKind): string {
  return path.join(root, site, KIND_DIR[kind]);
}

/** `data/<site>/daily/<YYYY-MM>/<YYYY-MM-DD>/` — จัดเป็นรายเดือนให้แต่ละชั้นมีไม่เกิน 31 รายการ */
export function dailyFolder(root: string, site: SiteId, range: DateRange): string {
  const day = formatISO(range.to);
  return path.join(kindRoot(root, site, 'daily'), day.slice(0, 7), day);
}

function localStamp(d: Date): { readonly day: string; readonly time: string } {
  const p = (n: number) => String(n).padStart(2, '0');
  const c = thaiClock(d);
  return {
    day: `${c.year}-${p(c.month)}-${p(c.day)}`,
    time: `${p(c.hour)}${p(c.minute)}${p(c.second)}`,
  };
}

/**
 * โฟลเดอร์ของรอบหนึ่ง — ที่เดียวที่ตัดสินว่าชนิดรอบไหนลงที่ไหน
 *
 *  - `daily`    → `<site>/daily/<YYYY-MM>/<YYYY-MM-DD>/` ของวันสุดท้ายที่ข้อมูลครอบคลุม
 *  - `baseline` → `<site>/baseline/<YYYY-MM-DD>/` ของวันที่รัน — ไฟล์ละวันของข้อมูล (ใบ 09) ทุกโฟลเดอร์เก็บไว้ ฉบับล่าสุดของ (รายงาน, วัน) เป็นฉบับอ้างอิง (ADR-0002/0005)
 *  - `manual`   → `<site>/backfill/<YYYY-MM-DD_HHMMSS>/` โฟลเดอร์ละรอบ ไม่ทับกันเอง
 *
 * เวลาในชื่อโฟลเดอร์เป็นเวลาไทย ให้ตรงกับนาฬิกาที่คนรันเห็น ไม่ว่าเครื่องตั้ง TZ อะไร (ticket 27)
 */
export function runFolder(root: string, site: SiteId, kind: RunKind, range: DateRange, runAt: Date): string {
  if (kind === 'daily') return dailyFolder(root, site, range);
  const { day, time } = localStamp(runAt);
  return path.join(kindRoot(root, site, kind), kind === 'baseline' ? day : `${day}_${time}`);
}

/**
 * FoodStory รายเดือน — `<site>/monthly/<YYYY-MM>/` สำหรับรอบแรกของเดือนนั้น · ดึงเดือนเดิมซ้ำได้ `<YYYY-MM>__<วันที่ดึง>/` แทนการเขียนทับ
 * (ADR-0005 — ยอดที่ดึงครั้งก่อนไม่หายเมื่อร้านแก้ยอดย้อนหลัง) · ดึงซ้ำ**วันเดียวกัน** (เวลาไทย) ใช้โฟลเดอร์ของวันนั้นต่อ
 * (รวมผลกัน แทนเฉพาะรายงานที่ผ่าน) รวมถึง `<YYYY-MM>/` เองถ้ารอบแรกของมันเป็นวันนี้ — เจ้าของระบบตัดสิน 2026-10-08
 * ไม่ให้วันเดียวกันแตกเป็นสองโฟลเดอร์ (รอบแรกได้ 2/49 เพราะบั๊กปุ่ม Excel แล้วต้องดึงใหม่ทั้งเดือนในวันเดียวกัน)
 * · `existing` = ชื่อโฟลเดอร์ที่มีอยู่แล้วใต้ `monthly/` · `periodFolderFirstRun` = เวลาเริ่มรอบแรกของ `<YYYY-MM>/`
 * (จาก `_run.json`, ไม่รู้ = null → ถือว่าเป็นวันอื่น) — ผู้เรียกอ่านจากดิสก์ ฟังก์ชันนี้ไม่แตะดิสก์
 */
export function monthlyFolder(
  root: string,
  site: SiteId,
  period: string,
  runAt: Date,
  existing: readonly string[],
  periodFolderFirstRun: Date | null = null,
): string {
  const base = monthlyRoot(root, site);
  const today = localStamp(runAt).day;
  if (!existing.includes(period)) return path.join(base, period);
  if (periodFolderFirstRun && localStamp(periodFolderFirstRun).day === today) return path.join(base, period);
  return path.join(base, `${period}__${today}`);
}

/** `<site>/monthly/` — ผู้เรียกอ่านรายชื่อโฟลเดอร์ใต้นี้ส่งให้ `monthlyFolder` */
export function monthlyRoot(root: string, site: SiteId): string {
  return path.join(root, site, 'monthly');
}

/**
 * FoodStory: `<site>__<ช่วง>__<กลุ่ม>__<id>.<ext>` — คงกลุ่มรายงานไว้ในชื่อตามแบบเดิม (spec) · `label` = `YYYY-MM`
 * (รายเดือน) หรือ `YYYY-MM-DD` (รายวัน = เมื่อวาน, ticket 10) · `slug` = id หรือ `<id>_part<n>` · `site` นำหน้าเสมอ
 * (เจ้าของระบบขอ 2026-10-18 — ไฟล์ที่ถูกก๊อปออกไปจากโฟลเดอร์ `<site>/` เดิม เช่น ไฟล์ที่ส่งเข้า uploader แล้ว
 * ยังบอกได้เองว่ามาจาก source system ไหนโดยไม่ต้องดูโฟลเดอร์ประกอบ)
 */
export function foodstoryFileName(site: SiteId, label: string, group: string, slug: string, ext: string): string {
  return `${site}__${label}__${group}__${slug}.${ext}`;
}

/**
 * `<site>__<ช่วงข้อมูล>__<id>.<ext>` — ไฟล์ที่ถูกก๊อปออกไปส่งต่อยังบอกได้เองว่าเป็นของ site ไหนและข้อมูลวันไหน ·
 * วันเดียว `YYYY-MM-DD` หลายวัน `YYYY-MM-DD--YYYY-MM-DD` (ตัวคั่นช่วงที่ ISO 8601 อนุญาตแทน `/` ซึ่งใช้ในชื่อไฟล์
 * ไม่ได้) — ชื่อบนดิสก์เป็นชื่อเดียวกับที่ส่งต่อ
 */
export function dataFileName(site: SiteId, range: DateRange, reportId: string, ext: string): string {
  const from = formatISO(range.from);
  const to = formatISO(range.to);
  const span = from === to ? from : `${from}--${to}`;
  return `${site}__${span}__${reportId}.${ext}`;
}

/**
 * รายงานภาพ: `<site>__<เวลาที่ถ่าย>__<id>.<ext>` เป็น ISO ย่อเวลาไทย `YYYYMMDDTHHMMSS+0700` — ภาพของรายงานเดียวกัน
 * หลายฉบับในวันเดียวไม่ทับกัน · ไม่มี `:` เพราะไฟล์อาจถูกดาวน์โหลดไปเปิดบน Windows (ADR-0008)
 */
export function pictureFileName(site: SiteId, takenAt: Date, reportId: string, ext: string): string {
  return `${site}__${basicStamp(takenAt)}__${reportId}.${ext}`;
}

/**
 * ที่ของไฟล์ที่ถูกแทน (path สัมพัทธ์จากโฟลเดอร์รอบ) — ผลใหม่ได้ชื่อเดียวกันแต่ไบต์ต่างกัน ไฟล์เดิมย้ายมาที่นี่ ขึ้นต้นด้วยเวลาที่ย้าย
 * ไฟล์ที่ export มาจึงไม่ถูกลบหรือทับเลย (ADR-0005)
 */
export function supersededPath(movedAt: Date, fileName: string): string {
  return path.join('_superseded', `${basicStamp(movedAt)}__${fileName}`);
}

/** เวลาไทยแบบ ISO ย่อ `YYYYMMDDTHHMMSS+0700` — ใช้ในชื่อไฟล์ (ไม่มี `:`) */
function basicStamp(at: Date): string {
  const { day, time } = localStamp(at);
  return `${day.replaceAll('-', '')}T${time}+0700`;
}

/** ตัวชี้รอบล่าสุดของชนิดรอบหนึ่ง เช่น `data/hoteltime/daily/latest` — ปลายทางใช้แทนการไล่เรียงชื่อโฟลเดอร์ */
export function latestPointer(root: string, site: SiteId, kind: 'daily' | 'baseline'): string {
  return path.join(kindRoot(root, site, kind), 'latest');
}
