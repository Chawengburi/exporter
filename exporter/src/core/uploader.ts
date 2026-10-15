import type { RawFileEntry } from './raw-manifest.ts';
import type { RecordedOutcome } from './run-record.ts';
import type { SiteId } from './placement.ts';

/**
 * ขาอัปโหลด exporter → uploader (`POST /api/files/ingest`, คู่มือ `exporter-manual.md`) — ฟังก์ชันบริสุทธิ์ล้วน
 * ไม่มี network หรือ disk I/O ในไฟล์นี้เลย — มิเรอร์โครงของ `core/discord.ts` (ฟังก์ชันบริสุทธิ์) + `src/upload.ts`
 * (shell บาง ๆ ที่ถือ HTTP) ตาม seam ที่ตกลงกันไว้ใน `.scratch/exporter-upload-to-uploader/spec.md`
 *
 * ticket 01: HotelTime happy path · **ticket 02**: แยก retryable/non-retryable + `rows_mismatch` + `stuck` ·
 * **ticket 03**: กัน `as_of` ย้อนหลัง · **ticket 04**: จับรายงานว่างไม่ให้ค้างเป็น backlog · ticket 08 เพิ่มตาราง
 * `document_type` ของ FoodStory
 */

/** `source_system` ตามคู่มือ — ยืนยันจาก catalog จริงแล้วว่า FoodStory ใช้ `wongnai_pos` (2026-10-15) */
export const SOURCE_SYSTEM: Readonly<Record<SiteId, string>> = {
  hoteltime: 'hoteltime',
  foodstory: 'wongnai_pos',
};

/**
 * ข้อยกเว้น 3 ตัวที่ `document_type` ต่างจากสูตร `hoteltime_` + ชื่อรายงาน (manual §6) — ยืนยันตรงกับ catalog จริง
 * ของ uploader แล้วทั้งหมด (102 รายการ, เช็ค 2026-10-15)
 */
const HOTELTIME_DOCUMENT_TYPE_EXCEPTIONS: Readonly<Record<string, string>> = {
  'reservations-search': 'hoteltime_reservation_search',
  'reservations-ratecode': 'hoteltime_reservation_ratecode',
  'reservations-cancelled': 'hoteltime_reservation_cancelled',
};

/**
 * แปลง report id → `document_type` — FoodStory ยังไม่มีตารางจริง (รอทีม uploader ตาม § 9 ของ
 * `UPLOADER-TEAM-REQUESTS.md` — ticket 08) คืน `undefined` ไปก่อน ผู้เรียกต้องปฏิเสธส่งไฟล์ที่ได้ `undefined`
 * ไม่เดา type ใกล้เคียง (manual §6: "อย่าเดา type ที่ใกล้เคียง")
 */
export function documentTypeFor(site: SiteId, report: string): string | undefined {
  if (site === 'foodstory') return undefined;
  return HOTELTIME_DOCUMENT_TYPE_EXCEPTIONS[report] ?? `hoteltime_${report.replaceAll('-', '_')}`;
}

export type IngestManifestEntry = {
  readonly source_system: string;
  readonly document_type: string;
  readonly report: string;
  readonly range_from: string;
  readonly range_to: string;
  readonly as_of: string;
  readonly rows?: number;
  readonly report_label: string;
  readonly filter_column: string;
  readonly filter_note: string;
};

/**
 * แปลง `RawFileEntry` หนึ่งตัว + `as_of` ระดับรอบ (`reports[<report>].finishedAt` ของ `_run.json` — มีอยู่แล้ว
 * ไม่ต้องเพิ่ม field ใหม่) เป็น field ตามที่คู่มือ uploader ต้องการ · ไม่มี logic พิเศษต่อตระกูลรายงาน เพราะ
 * `entry.range` ครอบ semantics ของทุกตระกูล (วันเดียว/ยอดสะสม/งวดคงที่/ภาพปิดงวด) ไว้แล้วตาม spec
 * `exporter-daily-per-day-raw`
 */
export function buildIngestPayload(entry: RawFileEntry, asOf: string, documentType: string): IngestManifestEntry {
  return {
    source_system: SOURCE_SYSTEM[entry.site],
    document_type: documentType,
    report: entry.report,
    range_from: entry.range.from,
    range_to: entry.range.to,
    as_of: asOf,
    ...(entry.rows !== undefined ? { rows: entry.rows } : {}),
    report_label: entry.label,
    filter_column: entry.filterColumn,
    filter_note: entry.filterNote,
  };
}

/**
 * ไฟล์ที่ยังไม่เคยอัปโหลดสำเร็จ (ไม่มี `uploaded`) — ไม่กรอง `as_of` ย้อนหลัง (ticket 03 ทำที่ `upload.ts` เพราะต้อง
 * เทียบกับ state ข้ามโฟลเดอร์) และไม่เกี่ยวกับรายงานว่าง (ticket 04 — รายงานว่างไม่มี `RawFileEntry` ให้กรองอยู่แล้ว)
 */
export function selectPendingFiles(files: readonly RawFileEntry[]): readonly RawFileEntry[] {
  return files.filter((f) => f.uploaded === undefined);
}

/** แคบ `unknown` ลงเป็น record ให้เช็ค field ต่อได้ — ใช้ร่วมกันที่นี่และใน `upload.ts` กันโค้ดแคบ JSON ซ้ำ ๆ แบบมือ */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = record?.[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * ผลตอบของ `POST /api/files/ingest` **หนึ่งครั้ง** (manual §7.1/§7.2) — `retryable` เป็นสถานะชั่วคราวเท่านั้น
 * ผู้เรียก (`upload.ts`) ต้องลองใหม่หรือแปลงเป็น `stuck` ด้วย `finalizeAfterRetries` ก่อนรายงานผลสุดท้าย ไม่ใช่ kind
 * ที่ควรติดอยู่ในผลลัพธ์ที่โชว์ให้คนเห็น
 */
export type IngestOutcome =
  | { readonly kind: 'sent'; readonly fileId: string }
  | { readonly kind: 'duplicate'; readonly fileId: string }
  | { readonly kind: 'rows-mismatch'; readonly fileId: string }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'retryable'; readonly message: string; readonly retryAfterMs?: number };

/** ผลลัพธ์สุดท้ายของไฟล์หนึ่ง หลังลองตามนโยบาย retry จบแล้ว (ไม่มี `retryable` หลงเหลืออยู่) */
export type FinalOutcome = Exclude<IngestOutcome, { kind: 'retryable' }> | { readonly kind: 'stuck'; readonly attempts: number; readonly lastMessage: string };

/**
 * แยกผลตอบของ `POST /api/files/ingest` หนึ่งครั้ง (manual §7.1/§7.2/§7.3) เป็น retryable กับไม่ retryable —
 * **ไม่ถือเป็นผลสุดท้าย** ผู้เรียกต้องลองใหม่ตามนโยบาย (รอ, ใช้ `retryAfterMs` ถ้ามีสำหรับ 429) ก่อนจะปิดเป็น
 * ผลสุดท้ายด้วย `finalizeAfterRetries`
 *
 * กฎตามคู่มือ: 400 และ `stage:"convert"` ไม่ retry (ผลจะเหมือนเดิม) · 429/5xx/`stage:"read"|"llm"|"save"` retry ได้ ·
 * รหัสอื่นที่ไม่รู้จัก (เช่น 413) ปลอดภัยไว้ก่อน ถือเป็นไม่ retry แทนการเดาว่าลองใหม่แล้วจะผ่าน
 */
export function classifyIngestResponse(httpStatus: number, body: unknown, retryAfterHeader?: string | null): IngestOutcome {
  if (httpStatus === 400) return { kind: 'rejected', reason: stringField(asRecord(body), 'message') ?? 'คำขอไม่ถูกต้อง (400) — ไม่มีรายละเอียดเพิ่ม' };
  if (httpStatus === 429) {
    const seconds = retryAfterHeader === undefined || retryAfterHeader === null ? NaN : Number(retryAfterHeader);
    return {
      kind: 'retryable',
      message: stringField(asRecord(body), 'message') ?? 'HTTP 429',
      ...(Number.isFinite(seconds) && seconds >= 0 ? { retryAfterMs: seconds * 1000 } : {}),
    };
  }
  if (httpStatus >= 500) return { kind: 'retryable', message: stringField(asRecord(body), 'message') ?? `HTTP ${httpStatus}` };
  if (httpStatus !== 200) return { kind: 'rejected', reason: stringField(asRecord(body), 'message') ?? `HTTP ${httpStatus}` };

  const results = asRecord(body)?.results;
  const result = asRecord(Array.isArray(results) ? results[0] : undefined);
  if (result === undefined) return { kind: 'rejected', reason: 'คำตอบไม่มี results[0] ตามที่คาด' };

  if (result.ok !== true) {
    const stage = stringField(result, 'stage');
    const message = stringField(result, 'error') ?? `stage:"${stage ?? 'unknown'}"`;
    return stage === 'convert' ? { kind: 'rejected', reason: message } : { kind: 'retryable', message };
  }

  // ok:true ต้องมี file_id เป็นสตริงไม่ว่าง — ไม่งั้นบันทึก uploaded.fileId ว่างเปล่าไปเงียบ ๆ ดีกว่าถือเป็นปฏิเสธ
  const fileId = stringField(result, 'file_id');
  if (fileId === undefined || fileId === '') return { kind: 'rejected', reason: 'ok:true แต่ไม่มี file_id ในคำตอบ' };
  if (result.rows_mismatch !== undefined) return { kind: 'rows-mismatch', fileId };
  // `retried:true` มาคู่กับ `duplicate:true` เสมอตามคู่มือ (§7.2) แต่เช็คแยกไว้ด้วยเผื่อวันหนึ่งมาโดดๆ — ทั้งคู่ถือว่าซ้ำ
  return result.duplicate === true || result.retried === true ? { kind: 'duplicate', fileId } : { kind: 'sent', fileId };
}

/** ปิดผลเป็นผลสุดท้าย — `retryable` ที่ลองจนครบจำนวนครั้งแล้วกลายเป็น `stuck` (ค้างถาวร แยกจาก "รอส่ง" ธรรมดา) */
export function finalizeAfterRetries(outcome: IngestOutcome, attempts: number): FinalOutcome {
  if (outcome.kind === 'retryable') return { kind: 'stuck', attempts, lastMessage: outcome.message };
  return outcome;
}

// ── ticket 03: กัน as_of ย้อนหลังข้ามรอบ ──

/** คีย์สถานะ as_of ต่อ (รายงาน, ช่วง) — ไม่รวม site เพราะ state ของ ticket 03 แยกไฟล์ต่อ site อยู่แล้ว */
export function asOfStateKey(entry: RawFileEntry): string {
  return `${entry.report}@${entry.range.from}@${entry.range.to}`;
}

/**
 * `as_of` ใหม่เก่ากว่าค่าล่าสุดที่เคยส่งสำเร็จของ (รายงาน, ช่วง) เดียวกันไหม (manual §5.3) — เทียบแบบ string เพราะ
 * `as_of` เป็น UTC ISO (`toISOString()`) เสมอ เรียงตามตัวอักษรตรงกับเรียงตามเวลาจริงพอดี · ไม่มีค่าเดิม (ยังไม่เคยส่ง)
 * หรือเท่ากันเป๊ะ (ส่งซ้ำ/retry) ไม่ถือเป็นย้อนหลัง
 */
export function isAsOfRegression(asOf: string, lastKnownAsOf: string | undefined): boolean {
  return lastKnownAsOf !== undefined && asOf < lastKnownAsOf;
}

// ── ticket 04: รายงานว่างไม่ให้ค้างเป็น backlog ──

/**
 * รายงานนี้ "ว่าง" ตามนิยามของ spec `exporter-daily-per-day-raw` (ผล `ok`, 0 แถว, ไม่มีไฟล์) — Site ต้นทางไม่คืนไฟล์
 * ให้เลย ไม่ใช่ไฟล์หัวตารางเปล่า จึงไม่มี `RawFileEntry` ให้ขาอัปโหลดส่งได้ในตอนนี้ (รอทีม uploader ตาม § 9 ของ
 * `UPLOADER-TEAM-REQUESTS.md`) — ใช้จุดนี้จุดเดียวตัดสิน "ว่าง" ไม่กระจายไปหลายที่ ให้แก้ได้ที่เดียวเมื่อ uploader
 * เพิ่มทางให้ประกาศว่าง
 */
export function isEmptyReportOutcome(outcome: RecordedOutcome): boolean {
  return outcome.status === 'ok' && outcome.rows === 0 && outcome.files.length === 0;
}
