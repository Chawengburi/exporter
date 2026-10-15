import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RAW_MANIFEST, recordUploaded, type RawFileEntry, type RawManifest } from './core/raw-manifest.ts';
import type { SiteId } from './core/placement.ts';
import { readRunRecord } from './core/run-record.ts';
import { defaultDataDir } from './core/status.ts';
import {
  asOfStateKey,
  asRecord,
  buildIngestPayload,
  classifyIngestResponse,
  documentTypeFor,
  finalizeAfterRetries,
  isAsOfRegression,
  isEmptyReportOutcome,
  selectPendingFiles,
  type FinalOutcome,
  type IngestOutcome,
} from './core/uploader.ts';
import { loadUploaderSetup, type UploaderConfig, type UploaderCredentials } from './uploader-config.ts';

/**
 * ขาอัปโหลด — shell บาง ๆ ที่ถือ network/disk I/O ทั้งหมด มิเรอร์ `notify.ts` (ตัว orchestrator ของ Discord):
 * ฟังก์ชันบริสุทธิ์อยู่ใน `core/uploader.ts` ไฟล์นี้แค่ login, ยิง HTTP พร้อม retry, และบันทึกผลกลับเข้า
 * `_manifest.json` + state ของตัวเอง — HotelTime เท่านั้นตอนนี้ (FoodStory รอ ticket 08)
 *
 * ticket 01: happy path · **ticket 02**: retry/stuck · **ticket 03**: กัน `as_of` ย้อนหลัง (state ข้ามโฟลเดอร์) ·
 * **ticket 04**: จับรายงานว่าง (state เดียวกับ ticket 03)
 */

export class UploaderHttpError extends Error {
  override readonly name = 'UploaderHttpError';
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000;

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login(config: UploaderConfig, creds: UploaderCredentials): Promise<string> {
  const res = await fetch(`${config.url}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: creds.email, password: creds.password }),
  });
  const body: unknown = await res.json().catch(() => null);
  const token = asRecord(body)?.token;
  if (!res.ok || typeof token !== 'string') throw new UploaderHttpError(`login เข้า uploader ไม่ผ่าน (HTTP ${res.status})`);
  return token;
}

async function fetchDocumentTypeCatalog(config: UploaderConfig, token: string): Promise<ReadonlySet<string>> {
  const res = await fetch(`${config.url}/api/document-types`, { headers: { Authorization: token } });
  const body: unknown = await res.json().catch(() => null);
  const items = asRecord(body)?.items;
  if (!res.ok || !Array.isArray(items)) throw new UploaderHttpError(`อ่าน catalog ของ document_type ไม่ได้ (HTTP ${res.status})`);
  return new Set(items.map((i) => asRecord(i)?.slug).filter((s): s is string => typeof s === 'string'));
}

async function postIngest(
  config: UploaderConfig,
  token: string,
  filePath: string,
  manifestEntry: unknown,
): Promise<{ readonly httpStatus: number; readonly body: unknown; readonly retryAfterHeader: string | null }> {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.set('files', new Blob([bytes]), path.basename(filePath));
  form.set('manifest', JSON.stringify([manifestEntry]));
  const res = await fetch(`${config.url}/api/files/ingest`, {
    method: 'POST',
    headers: { Authorization: token },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => null);
  return { httpStatus: res.status, body, retryAfterHeader: res.headers.get('retry-after') };
}

/**
 * ส่งไฟล์เดียวพร้อม retry ตามนโยบายของคู่มือ (ticket 02): รออย่างน้อย 5 นาทีก่อนลองซ้ำ (ใช้ `Retry-After` แทนถ้าเป็น
 * 429) สูงสุด 3 ครั้ง ด้วยไฟล์/manifest เดิมไม่เปลี่ยนแม้แต่ byte เดียว · 401 กลางรอบ re-login ครั้งเดียวแล้วลองไฟล์
 * เดิมต่อทันที (ไม่รอ ไม่กินโควตา 3 ครั้ง เพราะยังไม่ได้ลองส่งจริงด้วย token ใหม่) — เจอ 401 อีกหลัง relogin ไปแล้ว
 * ถือเป็นปฏิเสธถาวร ไม่ relogin ซ้ำสอง · `tokenRef` เป็นกล่องที่ปรับ token ให้ไฟล์ถัดไปในรอบเดียวกันใช้ต่อได้ด้วย
 */
async function sendWithRetries(
  setup: { readonly config: UploaderConfig; readonly credentials: UploaderCredentials },
  tokenRef: { token: string },
  folder: string,
  entry: RawFileEntry,
  payload: ReturnType<typeof buildIngestPayload>,
  sleep: Sleep,
): Promise<FinalOutcome> {
  let reloginUsed = false;
  let lastOutcome: IngestOutcome = { kind: 'retryable', message: 'ยังไม่ได้ลองส่งเลย' };
  let attemptsUsed = 0;

  while (attemptsUsed < MAX_ATTEMPTS) {
    let response: Awaited<ReturnType<typeof postIngest>>;
    try {
      response = await postIngest(setup.config, tokenRef.token, path.join(folder, entry.file), payload);
    } catch (err) {
      attemptsUsed++;
      lastOutcome = { kind: 'retryable', message: err instanceof Error ? err.message : String(err) };
      if (attemptsUsed < MAX_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS);
      continue;
    }

    if (response.httpStatus === 401 && !reloginUsed) {
      reloginUsed = true;
      tokenRef.token = await login(setup.config, setup.credentials);
      continue; // relogin ไม่กินโควตาการลองส่ง
    }

    attemptsUsed++;
    lastOutcome = classifyIngestResponse(response.httpStatus, response.body, response.retryAfterHeader);
    if (lastOutcome.kind !== 'retryable') return lastOutcome;
    if (attemptsUsed < MAX_ATTEMPTS) await sleep(lastOutcome.retryAfterMs ?? RETRY_BASE_DELAY_MS);
  }
  return finalizeAfterRetries(lastOutcome, attemptsUsed);
}

// ── ticket 03/04: state ข้ามโฟลเดอร์ ต่อ site (as_of ล่าสุดที่ส่งสำเร็จ + รายงานที่รู้แล้วว่าว่าง + ไฟล์ที่ค้างถาวร) ──

type StuckInfo = { readonly attempts: number; readonly lastMessage: string; readonly at: string };

type UploadState = {
  readonly asOf: Readonly<Record<string, string>>;
  readonly empty: Readonly<Record<string, true>>;
  readonly stuck: Readonly<Record<string, StuckInfo>>;
};

const EMPTY_STATE: UploadState = { asOf: {}, empty: {}, stuck: {} };

function uploadStatePath(dataDir: string, site: SiteId): string {
  return path.join(dataDir, '_upload', `${site}.json`);
}

async function readUploadState(dataDir: string, site: SiteId): Promise<UploadState> {
  try {
    const raw = JSON.parse(await readFile(uploadStatePath(dataDir, site), 'utf8')) as Partial<UploadState>;
    return { asOf: raw.asOf ?? {}, empty: raw.empty ?? {}, stuck: raw.stuck ?? {} };
  } catch {
    return EMPTY_STATE;
  }
}

async function writeUploadState(dataDir: string, site: SiteId, state: UploadState): Promise<void> {
  const file = uploadStatePath(dataDir, site);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.partial`, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(`${file}.partial`, file);
}

/**
 * อ่านไฟล์สดจากดิสก์แล้วค่อย merge patch เข้าไปทันทีก่อนเขียน (เหมือน `writeNotifyLog` ของ `core/discord.ts` และ
 * `recordUploaded` ของ `core/raw-manifest.ts`) — กัน process อื่นที่เขียน state ไฟล์เดียวกันพร้อมกัน (เช่น รันมือ
 * ทับรอบ cron) ถูกเขียนทับหาย ไม่ใช่แค่ rename ทับไฟล์ชั่วคราวเฉย ๆ
 */
async function mergeUploadState(
  dataDir: string,
  site: SiteId,
  patch: { readonly asOf?: Record<string, string>; readonly empty?: Record<string, true>; readonly stuck?: Record<string, StuckInfo>; readonly clearStuck?: readonly string[] },
): Promise<UploadState> {
  const current = await readUploadState(dataDir, site);
  const stuck = { ...current.stuck, ...patch.stuck };
  for (const key of patch.clearStuck ?? []) delete stuck[key];
  const next: UploadState = { asOf: { ...current.asOf, ...patch.asOf }, empty: { ...current.empty, ...patch.empty }, stuck };
  await writeUploadState(dataDir, site, next);
  return next;
}

export type UploadFileResult =
  | ({ readonly file: string; readonly report: string } & FinalOutcome)
  | { readonly file: string; readonly report: string; readonly kind: 'blocked-as-of'; readonly asOf: string; readonly lastKnownAsOf: string };

export type UploadRunResult = {
  readonly sent: number;
  readonly duplicate: number;
  readonly rowsMismatch: number;
  readonly rejected: number;
  readonly blocked: number;
  readonly stuck: number;
  readonly results: readonly UploadFileResult[];
  readonly emptyReports: readonly { readonly report: string }[];
};

/**
 * อัปโหลดไฟล์ที่ยังไม่เคยสำเร็จในโฟลเดอร์รอบหนึ่งเข้า uploader — login ครั้งเดียว ใช้ catalog เดียวตรวจทุกไฟล์ของรอบนี้
 * บันทึกผลสำเร็จ/ซ้ำกลับเข้า `_manifest.json` ทันทีต่อไฟล์ (เหมือนขา export ที่บันทึกทันทีไม่รอจบรอบ) และปรับ state
 * ของ as_of/รายงานว่างทันทีด้วย
 */
export async function uploadFolder(opts: {
  readonly folder: string;
  readonly dataDir?: string;
  readonly config?: UploaderConfig;
  readonly credentials?: UploaderCredentials;
  readonly sleep?: Sleep;
}): Promise<UploadRunResult> {
  const setup = opts.config !== undefined && opts.credentials !== undefined ? { config: opts.config, credentials: opts.credentials } : loadUploaderSetup();
  const sleep = opts.sleep ?? realSleep;
  const dataDir = opts.dataDir ?? defaultDataDir();

  const manifestRaw = await readFile(path.join(opts.folder, RAW_MANIFEST), 'utf8').catch(() => null);
  if (manifestRaw === null) throw new Error(`ไม่มี ${RAW_MANIFEST} ใน ${opts.folder}`);
  const manifest = JSON.parse(manifestRaw) as RawManifest;
  const runRecord = await readRunRecord(opts.folder);
  if (runRecord === null) throw new Error(`ไม่มี _run.json ใน ${opts.folder}`);

  const site = runRecord.site;
  const state = await readUploadState(dataDir, site); // อ่านครั้งเดียวสำหรับตัดสินใจ — การเขียนทุกจุดอ่านสดใหม่เองใน mergeUploadState

  // ticket 04: รายงานที่ว่าง (ok, 0 แถว, ไม่มีไฟล์) — บันทึกไว้ครั้งเดียว ไม่พยายามส่งซ้ำทุกรอบที่รันคำสั่งนี้
  const emptyReports: { readonly report: string }[] = [];
  for (const [report, outcome] of Object.entries(runRecord.reports)) {
    if (!isEmptyReportOutcome(outcome)) continue;
    emptyReports.push({ report });
    const key = `${report}@${runRecord.dataThrough}`;
    if (state.empty[key] !== true) await mergeUploadState(dataDir, site, { empty: { [key]: true } });
  }

  const tokenRef = { token: await login(setup.config, setup.credentials) };
  const catalog = await fetchDocumentTypeCatalog(setup.config, tokenRef.token);

  const results: UploadFileResult[] = [];
  for (const entry of selectPendingFiles(manifest.files)) {
    const documentType = documentTypeFor(entry.site, entry.report);
    if (documentType === undefined) {
      results.push({ file: entry.file, report: entry.report, kind: 'rejected', reason: `ยังไม่มี document_type ของ site "${entry.site}" รายงาน "${entry.report}" (ticket 08 ถ้าเป็น FoodStory)` });
      continue;
    }
    if (!catalog.has(documentType)) {
      results.push({ file: entry.file, report: entry.report, kind: 'rejected', reason: `document_type "${documentType}" ไม่อยู่ใน catalog จริงของ uploader — ไม่ส่ง ไม่เดา` });
      continue;
    }
    const asOf = runRecord.reports[entry.report]?.finishedAt;
    if (asOf === undefined) {
      results.push({ file: entry.file, report: entry.report, kind: 'rejected', reason: `หา as_of ของ "${entry.report}" จาก _run.json ไม่เจอ` });
      continue;
    }

    // ticket 03: กัน as_of ย้อนหลังข้ามรอบ — เช็คก่อนยิง request จริงเสมอ
    const key = asOfStateKey(entry);
    const lastKnownAsOf = state.asOf[key];
    if (isAsOfRegression(asOf, lastKnownAsOf)) {
      results.push({ file: entry.file, report: entry.report, kind: 'blocked-as-of', asOf, lastKnownAsOf: lastKnownAsOf as string });
      continue;
    }

    const payload = buildIngestPayload(entry, asOf, documentType);
    const outcome = await sendWithRetries(setup, tokenRef, opts.folder, entry, payload, sleep);
    if (outcome.kind === 'sent' || outcome.kind === 'duplicate' || outcome.kind === 'rows-mismatch') {
      await recordUploaded(opts.folder, entry.file, { at: new Date().toISOString(), fileId: outcome.fileId });
      // ผ่านแล้ว — ถ้าเคยค้างถาวรมาก่อน (รอบที่แล้ว) เคลียร์เครื่องหมายนั้นออกด้วย
      await mergeUploadState(dataDir, site, { asOf: { [key]: asOf }, clearStuck: [key] });
    } else if (outcome.kind === 'stuck') {
      // ticket 02: "ค้างถาวร" ต้องเห็นได้ข้ามรอบ ไม่ใช่แค่ผลของการรันครั้งนี้ — ไม่งั้นรอบถัดไปจะลองใหม่สดอีก 3 ครั้ง
      // เงียบ ๆ ทุกครั้งโดยไม่มีใครเห็นว่าไฟล์นี้มีปัญหาซ้ำ ๆ
      await mergeUploadState(dataDir, site, { stuck: { [key]: { attempts: outcome.attempts, lastMessage: outcome.lastMessage, at: new Date().toISOString() } } });
    }
    results.push({ file: entry.file, report: entry.report, ...outcome });
  }

  return {
    sent: results.filter((r) => r.kind === 'sent').length,
    duplicate: results.filter((r) => r.kind === 'duplicate').length,
    rowsMismatch: results.filter((r) => r.kind === 'rows-mismatch').length,
    rejected: results.filter((r) => r.kind === 'rejected').length,
    blocked: results.filter((r) => r.kind === 'blocked-as-of').length,
    stuck: results.filter((r) => r.kind === 'stuck').length,
    results,
    emptyReports,
  };
}

/** บรรทัดสรุปสำหรับท้ายคำสั่ง `exporter upload` */
export function describeUploadResult(r: UploadRunResult): string {
  const lines = [
    `อัปโหลด: สำเร็จ ${r.sent} · ซ้ำ(ไม่เปลือง LLM) ${r.duplicate} · แถวไม่ตรง(เข้าแล้ว) ${r.rowsMismatch} · ` +
      `ปฏิเสธ ${r.rejected} · บล็อก(as_of ย้อนหลัง) ${r.blocked} · ค้างถาวร ${r.stuck} · ว่าง(ไม่มีอะไรต้องส่ง) ${r.emptyReports.length}`,
  ];
  for (const item of r.results) {
    if (item.kind === 'rejected') lines.push(`  ✘ ${item.file} (${item.report}): ${item.reason}`);
    if (item.kind === 'stuck') lines.push(`  ✘ ${item.file} (${item.report}): ค้างถาวรหลังลอง ${item.attempts} ครั้ง — ${item.lastMessage}`);
    if (item.kind === 'rows-mismatch') lines.push(`  ⚠ ${item.file} (${item.report}): จำนวนแถวไม่ตรงกับที่ manifest บอก (ไฟล์เข้าระบบแล้ว ไม่ใช่ความล้มเหลว)`);
    if (item.kind === 'blocked-as-of') {
      lines.push(`  ⚠ ${item.file} (${item.report}): as_of (${item.asOf}) เก่ากว่าที่ส่งสำเร็จล่าสุด (${item.lastKnownAsOf}) — คุยกับทีม uploader ก่อนถ้าตั้งใจส่งจริง`);
    }
  }
  return `${lines.join('\n')}\n`;
}
