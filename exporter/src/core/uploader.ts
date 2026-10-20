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

/** `source_system` ตามคู่มือ — FoodStory เปลี่ยนจาก `wongnai_pos` เป็น `foodstory` (migration
 * `1786900000`, ยืนยันจากทีม uploader 2026-10-19 — ไฟล์เก่าที่ ingest ไว้แล้วถูกย้ายค่าให้อัตโนมัติ) */
export const SOURCE_SYSTEM: Readonly<Record<SiteId, string>> = {
  hoteltime: 'hoteltime',
  foodstory: 'foodstory',
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
 * ทีม uploader ยืนยัน 2026-10-19 ว่าสูตรคือ `wongnai_X` → `foodstory_X` เหมือนเดิมทุกตัว (ไม่มีชื่อ
 * เปลี่ยนรูป แค่สับ prefix) — ตารางข้างล่างจับคู่เองจากความหมายของ label ไทยเทียบกับ slug จริงใน catalog
 * (เช็คสด 2026-10-19) 2 ตัวอย่างที่ส่งไปถาม (`salebybill`, `crm`) ตรงกับที่ทีม uploader ยืนยันกลับมาเป๊ะ
 * แต่ **ที่เหลือยังไม่ได้ยืนยันทีละตัว** ยังไม่ใช่แหล่งความจริงแบบเดียวกับ
 * `HOTELTIME_DOCUMENT_TYPE_EXCEPTIONS` — ticket 08 ยังไม่ปิดจนกว่าทีม uploader จะยืนยันทั้งตาราง
 * `purchase-detail`/`purchase_stock` ปลดบล็อกแล้ว (เทียบคอลัมน์จริงกับคำตอบทีม uploader 2026-10-19):
 * `purchase_stock` (คอลัมน์: วันที่/สถานะ/ผู้จัดจำหน่าย/PR/PO/GR/สาขา) ตรงกับ header ระดับเอกสารของ
 * `foodstory_purchase_orders`; `purchase-detail` (คอลัมน์: วันที่/รหัสวัตถุดิบ/PR/ค่าใช้จ่าย/PO/วันที่ออก PO)
 * มี PR ของตัวเองและลิงก์ไปที่ PO (ไม่ใช่ GR) ตรงกับ `foodstory_purchase_request_lines`
 */
const FOODSTORY_DOCUMENT_TYPE: Readonly<Record<string, string>> = {
  add_waste: 'foodstory_stock_waste',
  check_stock: 'foodstory_stock_count',
  costbyproduct: 'foodstory_menu_cost',
  crm: 'foodstory_customer_spend_by_phone',
  current_stock: 'foodstory_stock_on_hand',
  drawer_paid: 'foodstory_drawer_cash_in_out',
  drawer: 'foodstory_drawer_shifts',
  employee: 'foodstory_employee_activity',
  fulltaxinvoice: 'foodstory_full_tax_invoices',
  ingredient: 'foodstory_recipe_ingredients',
  ingredientaddon: 'foodstory_option_ingredients',
  intermidiate: 'foodstory_intermediate_recipes',
  inv_movement: 'foodstory_stock_movement_log',
  activity: 'foodstory_stock_activity_log',
  supplier: 'foodstory_suppliers',
  option_by_date: 'foodstory_option_orders_daily',
  option: 'foodstory_option_orders',
  order_by_employee: 'foodstory_orders_by_employee',
  order: 'foodstory_order_item_status',
  outputtax: 'foodstory_output_tax',
  pay: 'foodstory_sales_by_payment_type',
  payment_by_employee: 'foodstory_payments_by_employee',
  promotion_use: 'foodstory_promotion_usage',
  promotion: 'foodstory_promotions',
  'purchase-detail': 'foodstory_purchase_request_lines',
  purchase_stock: 'foodstory_purchase_orders',
  'reservation-report': 'foodstory_table_reservations',
  'sale-claim': 'foodstory_lineman_claims',
  salebybill: 'foodstory_sales_by_bill',
  salebychannel: 'foodstory_sales_by_channel',
  salebybilldetail: 'foodstory_sales_bill_lines',
  salebycategory: 'foodstory_sales_by_category',
  salebydate: 'foodstory_sales_by_drawer_daily',
  salebygroup: 'foodstory_sales_by_group',
  salebymonthsum: 'foodstory_sales_by_month',
  salebyoption: 'foodstory_sales_by_option',
  salebyproduct: 'foodstory_sales_by_product',
  salebyproductdaily: 'foodstory_sales_by_product_daily',
  salebyproducthourly: 'foodstory_sales_by_product_hourly',
  salebysumdate: 'foodstory_sales_by_day',
  summary_stock_movement: 'foodstory_stock_movement_summary',
  table: 'foodstory_table_usage_daily',
  'transfer-detail': 'foodstory_stock_transfer_lines',
  transfer_stock: 'foodstory_stock_transfers',
  transfer: 'foodstory_delivery_picking',
  used_stock_by_date: 'foodstory_stock_restock',
  used_stock: 'foodstory_stock_usage',
  voucher: 'foodstory_voucher_usage',
  working: 'foodstory_working_hours',
};

/**
 * แปลง report id → `document_type` — HotelTime ยืนยันแล้วทั้งหมด FoodStory จับคู่เองจาก label (ดู
 * `FOODSTORY_DOCUMENT_TYPE`) ยังรอทีม uploader ยืนยันทั้งตาราง (ticket 08) รายงานที่ไม่อยู่ในตาราง
 * คืน `undefined` ผู้เรียกต้องปฏิเสธส่งไฟล์ที่ได้ `undefined` ไม่เดา type ใกล้เคียง (manual §6: "อย่าเดา
 * type ที่ใกล้เคียง")
 */
export function documentTypeFor(site: SiteId, report: string): string | undefined {
  if (site === 'foodstory') return FOODSTORY_DOCUMENT_TYPE[report];
  return HOTELTIME_DOCUMENT_TYPE_EXCEPTIONS[report] ?? `hoteltime_${report.replaceAll('-', '_')}`;
}

/** prefix คงที่ของเหตุผล `rejected` ที่เกิดจาก `documentTypeFor` คืน `undefined` (FoodStory จนกว่า ticket 08) — จุด
 * เดียวที่สร้างข้อความนี้ (`unresolvedDocumentTypeReason`) และจุดเดียวที่เช็คว่าเป็นข้อความนี้ (`isUnresolvedDocumentTypeReason`)
 * เพื่อไม่ให้ต้อง duplicate string literal ข้ามไฟล์ (upload.ts สร้าง, discord.ts เช็ค) — เรื่องนี้ต่างจาก `rejected`
 * แบบอื่น (catalog ไม่ตรง, as_of หาไม่เจอ, uploader ปฏิเสธจริง) ตรงที่ **รู้สาเหตุอยู่แล้วและทำอะไรไม่ได้จนกว่า
 * ticket 08 จะปลดบล็อก** ไม่ควรแจ้งเตือนแบบเร่งด่วนซ้ำ ๆ ทุกไฟล์ (พบว่าสร้าง spam 57 ข้อความจริงกับ FoodStory 2026-10-19) */
const UNRESOLVED_DOCUMENT_TYPE_PREFIX = 'ยังไม่มี document_type ของ site "';
/** เลขอ้างอิง ticket ภายในของเราเอง — uploader (ฝั่งเซิร์ฟเวอร์จริง) ไม่มีทางรู้จักเลขนี้ จึงไม่มีทางส่ง reason
 * ที่ตรงกับทั้ง prefix และ suffix นี้มาเองโดยบังเอิญ (เทียบกับเช็ค prefix อย่างเดียว ซึ่งในทางทฤษฎี server อาจส่ง
 * ข้อความที่ขึ้นต้นคล้ายกันมาเองก็ได้ — พบจาก code review ว่าเสี่ยงกลืนปัญหาจริงแบบเงียบ ๆ ถ้าแค่เช็ค prefix) */
const UNRESOLVED_DOCUMENT_TYPE_SUFFIX = '(ticket 08 ถ้าเป็น FoodStory)';

export function unresolvedDocumentTypeReason(site: SiteId, report: string): string {
  return `${UNRESOLVED_DOCUMENT_TYPE_PREFIX}${site}" รายงาน "${report}" ${UNRESOLVED_DOCUMENT_TYPE_SUFFIX}`;
}

export function isUnresolvedDocumentTypeReason(reason: string): boolean {
  return reason.startsWith(UNRESOLVED_DOCUMENT_TYPE_PREFIX) && reason.endsWith(UNRESOLVED_DOCUMENT_TYPE_SUFFIX);
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
 * `entry.range` ครอบ semantics ของทุกตระกูล (วันเดียว/ยอดสะสม/งวดคงที่/snapshot ปิดงวด) ไว้แล้วตาม spec
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

/**
 * คีย์สถานะ as_of ต่อ (รายงาน, ช่วง) — ไม่รวม site เพราะ state ของ ticket 03 แยกไฟล์ต่อ site อยู่แล้ว · รับแค่
 * `report`/`range` (ไม่ใช่ `RawFileEntry` เต็ม) ตั้งแต่ ticket 11 เพื่อให้ `empty` item (ไม่มี `RawFileEntry`
 * เพราะไม่มีไฟล์) ใช้ key เดียวกับไฟล์ปกติได้ — ไฟล์กับ `empty` ของ (รายงาน, ช่วง) เดียวกันต้องเช็ค/อัปเดต
 * "as_of ล่าสุดที่ส่งสำเร็จ" ตัวเดียวกัน ไม่ใช่สอง tracker ที่แยกกัน (spec `empty` array ข้อ Implementation Decisions)
 */
export function asOfStateKey(entry: { readonly report: string; readonly range: { readonly from: string; readonly to: string } }): string {
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

// ── ผลลัพธ์ของทั้งรอบ — อยู่ที่นี่ (ไม่ใช่ `upload.ts`) เพื่อให้ `core/discord.ts` สร้างข้อความจากมันได้โดยไม่ต้อง
// import ข้าม I/O shell (ticket 05) ──

export type UploadFileResult =
  | ({ readonly file: string; readonly report: string } & FinalOutcome)
  | { readonly file: string; readonly report: string; readonly kind: 'blocked-as-of'; readonly asOf: string; readonly lastKnownAsOf: string };

export type UploadRunResult = {
  readonly site: SiteId;
  readonly sent: number;
  readonly duplicate: number;
  readonly rowsMismatch: number;
  readonly rejected: number;
  readonly blocked: number;
  readonly stuck: number;
  readonly results: readonly UploadFileResult[];
  readonly emptyReports: readonly { readonly report: string }[];
  /** ผลของการพยายามส่งประกาศ `empty` จริง (ticket 11) — แยกจาก `results`/`emptyReports` ตามที่ contract เอง
   * แยก `empty_results` จาก `results` (ไม่นับเข้า `succeeded`/`failed` ของไฟล์) */
  readonly emptyResults: readonly EmptyResultEntry[];
};

/**
 * ภาพรวม backlog ของขาอัปโหลด ต่อ site — ของ `exporter status` (ticket 06) ไม่ใช่ผลของการรันครั้งเดียวแบบ
 * `UploadRunResult` แต่เป็นภาพรวมสะสมของทุกโฟลเดอร์ ณ เวลาที่ดู (อ่านจากดิสก์ล้วน ๆ ไม่ยิง network):
 * - `pending` ยังรอส่ง — ปล่อยไว้เฉย ๆ ได้ รอบอัปโหลดถัดไปหยิบไปส่งเอง
 * - `blocked` ติด `as_of` ย้อนหลัง (ticket 03) — ต้องคุยกับทีม uploader ก่อนถ้าตั้งใจส่งจริง
 * - `stuck` ค้างถาวรหลังลองครบ 3 ครั้ง (ticket 02) — ต้องดูสาเหตุ
 * - `empty` รายงานว่างที่ไม่มีไฟล์ให้ส่ง (ticket 04) **ที่ยังไม่ถูกประกาศ `empty` สำเร็จ** (ticket 11-13) —
 *   ถ้า flag ปิด หรือ document_type ยัง resolve ไม่ได้ (FoodStory จนกว่า ticket 08) หรือลองส่งแล้วแต่ยังไม่ผ่าน
 *   (ไม่นับที่ค้างถาวร — นั่นอยู่ใน `stuck` ด้วย เพราะ state.stuck ใช้ร่วมกับไฟล์) ยังนับที่นี่ · รายงานที่ประกาศ
 *   สำเร็จแล้วถูกเคลียร์ออกจากตัวนับนี้ (ดู `clearEmpty` ใน `upload.ts`) ไม่ต้องทำอะไรต่อจริง ๆ
 */
export type UploadBacklogView = {
  readonly site: SiteId;
  readonly pending: number;
  readonly blocked: number;
  readonly stuck: number;
  readonly empty: number;
};

// ── ticket 11: ส่งประกาศรายงานว่างจริงเข้า uploader ด้วย `empty` array ──

export type EmptyIngestEntry = {
  readonly source_system: string;
  readonly document_type: string;
  readonly report: string;
  readonly range_from: string;
  readonly range_to: string;
  readonly as_of: string;
};

/** แปลง (site, report, ช่วงที่ว่าง, as_of, document_type) เป็น item ของ `empty` array ตาม contract — ทุก field บังคับจริง */
export function buildEmptyPayload(
  site: SiteId,
  report: string,
  range: { readonly from: string; readonly to: string },
  asOf: string,
  documentType: string,
): EmptyIngestEntry {
  return { source_system: SOURCE_SYSTEM[site], document_type: documentType, report, range_from: range.from, range_to: range.to, as_of: asOf };
}

/**
 * ผลตอบของรายการเดียวใน `empty_results` (manual ส่วน "ส่ง `empty` array") — คนละ shape จาก `IngestOutcome` ของ
 * ไฟล์ (ไม่มี `file_id`/`duplicate`/`rows_mismatch`) จึงแยก type แต่ reuse การแยก retryable/ไม่ retryable ระดับ
 * HTTP status เดียวกับ `classifyIngestResponse`
 */
export type EmptyOutcome =
  | { readonly kind: 'announced'; readonly superseded: readonly string[] }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'retryable'; readonly message: string; readonly retryAfterMs?: number };

export type FinalEmptyOutcome = Exclude<EmptyOutcome, { kind: 'retryable' }> | { readonly kind: 'stuck'; readonly attempts: number; readonly lastMessage: string };

/**
 * แยกผลตอบของ `POST /api/files/ingest` หนึ่งครั้งที่มีแต่ `empty` (ไม่มี `files`) เป็น retryable/ไม่ retryable —
 * ระดับ HTTP status (400/429/5xx) ใช้กฎเดียวกับไฟล์เป๊ะ · ระดับรายการ: `ok:true` → `announced` พร้อม `superseded`
 * ที่ได้มา (ว่างได้ ไม่ใช่ error — แปลว่าไม่มีไฟล์เก่าให้ซ่อน) · `ok:false, stage:"save"` → retryable ตาม manual ·
 * `ok:false` อื่น ๆ (ไม่มี stage หรือ stage ที่ไม่รู้จัก) → ปลอดภัยไว้ก่อน ถือเป็น rejected ไม่เดาว่า retry ได้
 */
/** ปิดผลเป็นผลสุดท้าย — มิเรอร์ `finalizeAfterRetries` ของไฟล์ */
export function finalizeEmptyAfterRetries(outcome: EmptyOutcome, attempts: number): FinalEmptyOutcome {
  if (outcome.kind === 'retryable') return { kind: 'stuck', attempts, lastMessage: outcome.message };
  return outcome;
}

function classifyEmptyResultItem(result: Record<string, unknown> | undefined): EmptyOutcome {
  if (result === undefined) return { kind: 'rejected', reason: 'คำตอบไม่มี empty_results[i] ตามที่คาด' };
  if (result.ok !== true) {
    const stage = stringField(result, 'stage');
    const message = stringField(result, 'error') ?? `stage:"${stage ?? 'unknown'}"`;
    return stage === 'save' ? { kind: 'retryable', message } : { kind: 'rejected', reason: message };
  }
  const supersededRaw = result.superseded;
  const superseded = Array.isArray(supersededRaw) ? supersededRaw.filter((s): s is string => typeof s === 'string') : [];
  return { kind: 'announced', superseded };
}

/**
 * แยกผลตอบของ `POST /api/files/ingest` ที่มีแต่ `empty` (ไม่มี `files`) เป็น retryable/ไม่ retryable ต่อรายการ —
 * รองรับหลายรายการ `empty` ในคำขอเดียว (contract อนุญาต เพราะไม่มีขั้นแปลง/LLM ต่างจากไฟล์ที่บังคับ 1 ไฟล์ต่อ
 * request) — ความล้มเหลวระดับ HTTP status (400/429/5xx)
 * กระทบทุกรายการในคำขอเท่า ๆ กันเสมอ (ยังไม่มีรายการไหนถูกบันทึกเลยถ้าทั้ง request ได้ 400) ส่วนระดับรายการ
 * (`ok`/`stage`) อ่านจาก `empty_results[i]` ตรงตามลำดับ · ปลอดภัยที่จะ retry ทั้ง batch ซ้ำได้เสมอ (รวมรายการที่
 * สำเร็จไปแล้ว) เพราะ contract ข้อ 6 ยืนยันว่าส่งซ้ำได้ปลอดภัย (`superseded: []` ในครั้งที่สอง)
 */
export function classifyEmptyBatchResponse(httpStatus: number, body: unknown, count: number, retryAfterHeader?: string | null): readonly EmptyOutcome[] {
  const repeat = (outcome: EmptyOutcome): readonly EmptyOutcome[] => Array.from({ length: count }, () => outcome);

  if (httpStatus === 400) return repeat({ kind: 'rejected', reason: stringField(asRecord(body), 'message') ?? 'คำขอไม่ถูกต้อง (400) — ไม่มีรายละเอียดเพิ่ม' });
  if (httpStatus === 429) {
    const seconds = retryAfterHeader === undefined || retryAfterHeader === null ? NaN : Number(retryAfterHeader);
    return repeat({
      kind: 'retryable',
      message: stringField(asRecord(body), 'message') ?? 'HTTP 429',
      ...(Number.isFinite(seconds) && seconds >= 0 ? { retryAfterMs: seconds * 1000 } : {}),
    });
  }
  if (httpStatus >= 500) return repeat({ kind: 'retryable', message: stringField(asRecord(body), 'message') ?? `HTTP ${httpStatus}` });
  if (httpStatus !== 200) return repeat({ kind: 'rejected', reason: stringField(asRecord(body), 'message') ?? `HTTP ${httpStatus}` });

  const items = asRecord(body)?.empty_results;
  const arr = Array.isArray(items) ? items : [];
  return Array.from({ length: count }, (_, i) => classifyEmptyResultItem(asRecord(arr[i])));
}

/** ผลของ `empty` item เดียว หลังจบกระบวนการ (retry แล้ว หรือถูกบล็อกตั้งแต่ก่อนยิง) — เข้า `UploadRunResult.emptyResults` */
export type EmptyResultEntry =
  | ({ readonly report: string } & FinalEmptyOutcome)
  | { readonly report: string; readonly kind: 'blocked-as-of'; readonly asOf: string; readonly lastKnownAsOf: string };
