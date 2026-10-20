import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RAW_MANIFEST, recordUploaded, type RawFileEntry, type RawManifest } from './core/raw-manifest.ts';
import type { SiteId } from './core/placement.ts';
import { findOutcomeForFile, readRunRecord, type RecordedOutcome } from './core/run-record.ts';
import { defaultDataDir } from './core/status.ts';
import {
  asOfStateKey,
  asRecord,
  buildEmptyPayload,
  buildIngestPayload,
  classifyEmptyBatchResponse,
  classifyIngestResponse,
  documentTypeFor,
  unresolvedDocumentTypeReason,
  finalizeAfterRetries,
  finalizeEmptyAfterRetries,
  isAsOfRegression,
  isEmptyReportOutcome,
  selectPendingFiles,
  type EmptyIngestEntry,
  type EmptyOutcome,
  type EmptyResultEntry,
  type FinalEmptyOutcome,
  type FinalOutcome,
  type IngestOutcome,
  type UploadBacklogView,
  type UploadFileResult,
  type UploadRunResult,
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
 * ยิง `empty` array (ticket 11) — `files` ไม่ส่งเลย, `manifest` เป็น `[]` เสมอ (contract ข้อ 2) รวมได้หลายรายการ
 * ในคำขอเดียว เพราะไม่มีขั้นแปลง/LLM ต่างจากไฟล์ที่บังคับ 1 ไฟล์ต่อ request
 */
async function postEmptyBatch(
  config: UploaderConfig,
  token: string,
  entries: readonly EmptyIngestEntry[],
): Promise<{ readonly httpStatus: number; readonly body: unknown; readonly retryAfterHeader: string | null }> {
  const form = new FormData();
  form.set('manifest', '[]');
  form.set('empty', JSON.stringify(entries));
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

/**
 * ส่ง `empty` array ทั้ง batch พร้อม retry (ticket 12) — มิเรอร์ `sendWithRetries` ของไฟล์ทุกกฎ (รอ, ใช้
 * `Retry-After` ถ้ามี, สูงสุด 3 ครั้ง, 401 กลางทาง relogin ครั้งเดียว) ต่างกันแค่ "ลองซ้ำ" ที่นี่คือยิง batch
 * เดิมทั้งก้อนใหม่อีกครั้ง (รวมรายการที่สำเร็จไปแล้วด้วย) ไม่ใช่ทีละรายการ — ปลอดภัยเพราะ contract ข้อ 6 ยืนยัน
 * ว่าส่งซ้ำได้เสมอ (`superseded: []` ในครั้งที่สอง) ถ้ามีรายการใดใน batch ยัง retryable หลัง classify รอบนี้
 * ให้ลองทั้ง batch ใหม่อีกครั้ง ไม่แยกยิงเฉพาะรายการที่เหลือ
 */
async function sendEmptyBatchWithRetries(
  setup: { readonly config: UploaderConfig; readonly credentials: UploaderCredentials },
  tokenRef: { token: string },
  entries: readonly EmptyIngestEntry[],
  sleep: Sleep,
): Promise<readonly FinalEmptyOutcome[]> {
  let reloginUsed = false;
  let lastOutcomes: readonly EmptyOutcome[] = entries.map(() => ({ kind: 'retryable', message: 'ยังไม่ได้ลองส่งเลย' }));
  let attemptsUsed = 0;

  while (attemptsUsed < MAX_ATTEMPTS) {
    let response: Awaited<ReturnType<typeof postEmptyBatch>>;
    try {
      response = await postEmptyBatch(setup.config, tokenRef.token, entries);
    } catch (err) {
      attemptsUsed++;
      const message = err instanceof Error ? err.message : String(err);
      lastOutcomes = entries.map(() => ({ kind: 'retryable', message }));
      if (attemptsUsed < MAX_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS);
      continue;
    }

    if (response.httpStatus === 401 && !reloginUsed) {
      reloginUsed = true;
      tokenRef.token = await login(setup.config, setup.credentials);
      continue; // relogin ไม่กินโควตาการลองส่ง
    }

    attemptsUsed++;
    lastOutcomes = classifyEmptyBatchResponse(response.httpStatus, response.body, entries.length, response.retryAfterHeader);
    if (!lastOutcomes.some((o) => o.kind === 'retryable')) return lastOutcomes.map((o) => finalizeEmptyAfterRetries(o, attemptsUsed));
    if (attemptsUsed < MAX_ATTEMPTS) {
      const retryAfterMs = lastOutcomes.find((o): o is Extract<EmptyOutcome, { kind: 'retryable' }> => o.kind === 'retryable')?.retryAfterMs;
      await sleep(retryAfterMs ?? RETRY_BASE_DELAY_MS);
    }
  }
  return lastOutcomes.map((o) => finalizeEmptyAfterRetries(o, attemptsUsed));
}

// ── ticket 03/04: state ข้ามโฟลเดอร์ ต่อ site (as_of ล่าสุดที่ส่งสำเร็จ + รายงานที่รู้แล้วว่าว่าง + ไฟล์ที่ค้างถาวร) ──

type StuckInfo = { readonly attempts: number; readonly lastMessage: string; readonly at: string };

type UploadState = {
  readonly asOf: Readonly<Record<string, string>>;
  readonly empty: Readonly<Record<string, true>>;
  readonly stuck: Readonly<Record<string, StuckInfo>>;
  /** ticket 11: (report, range) ที่ประกาศ `empty` สำเร็จไปแล้ว — กันไม่ให้ส่งซ้ำทุกรอบที่รันคำสั่งอัปโหลด */
  readonly announcedEmpty: Readonly<Record<string, true>>;
};

const EMPTY_STATE: UploadState = { asOf: {}, empty: {}, stuck: {}, announcedEmpty: {} };

function uploadStatePath(dataDir: string, site: SiteId): string {
  return path.join(dataDir, '_upload', `${site}.json`);
}

async function readUploadState(dataDir: string, site: SiteId): Promise<UploadState> {
  try {
    const raw = JSON.parse(await readFile(uploadStatePath(dataDir, site), 'utf8')) as Partial<UploadState>;
    return { asOf: raw.asOf ?? {}, empty: raw.empty ?? {}, stuck: raw.stuck ?? {}, announcedEmpty: raw.announcedEmpty ?? {} };
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
  patch: {
    readonly asOf?: Record<string, string>;
    readonly empty?: Record<string, true>;
    readonly stuck?: Record<string, StuckInfo>;
    readonly clearStuck?: readonly string[];
    readonly announcedEmpty?: Record<string, true>;
    /** ticket 13: เคลียร์คีย์ของ ticket 04 (`${report}@${dataThrough}`) ออกจาก `state.empty` ตอนประกาศสำเร็จ
     * แล้วจริง — คนละรูป key กับ `asOfStateKey` (`${report}@${from}@${to}`) ที่ `announcedEmpty`/`asOf`/`stuck`
     * ใช้ จึงเคลียร์แยกกันคนละช่อง ไม่ใช่ key เดียวกัน */
    readonly clearEmpty?: readonly string[];
  },
): Promise<UploadState> {
  const current = await readUploadState(dataDir, site);
  const stuck = { ...current.stuck, ...patch.stuck };
  for (const key of patch.clearStuck ?? []) delete stuck[key];
  const empty = { ...current.empty, ...patch.empty };
  for (const key of patch.clearEmpty ?? []) delete empty[key];
  const next: UploadState = {
    asOf: { ...current.asOf, ...patch.asOf },
    empty,
    stuck,
    announcedEmpty: { ...current.announcedEmpty, ...patch.announcedEmpty },
  };
  await writeUploadState(dataDir, site, next);
  return next;
}

const MAX_FOLDER_SCAN_DEPTH = 4;

/**
 * หาทุกโฟลเดอร์ใต้ `root` ที่มี `_manifest.json` — ไม่ hardcode รูปโฟลเดอร์ (daily/baseline/รายเดือน ฯลฯ ต่างความลึกกัน
 * และอาจมีแบบใหม่ในอนาคต) เจอ `_manifest.json` แล้วไม่ลงลึกต่อ (โฟลเดอร์รอบไม่มีโฟลเดอร์รอบซ้อนอยู่ข้างใน) ข้ามโฟลเดอร์
 * ที่ชื่อขึ้นต้นด้วย `_` (`_superseded/`, `_downloads/` ฯลฯ ไม่ใช่โฟลเดอร์รอบ)
 */
async function findManifestFolders(root: string, depth = 0): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  if (entries.some((e) => e.isFile() && e.name === RAW_MANIFEST)) return [root];
  if (depth >= MAX_FOLDER_SCAN_DEPTH) return [];
  const found: string[] = [];
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('_')) found.push(...(await findManifestFolders(path.join(root, e.name), depth + 1)));
  }
  return found;
}

/**
 * ภาพรวม backlog ของขาอัปโหลด ต่อ site (ticket 06) — อ่านจากดิสก์ล้วน ๆ ไม่ยิง network เลย (ไม่เช็ค catalog จริง
 * ไม่ login) เดินทุกโฟลเดอร์ใต้ `data/<site>/` ที่มี `_manifest.json` แล้วเทียบ `as_of` ของไฟล์ที่ยังไม่อัปโหลดกับ
 * state ที่จำไว้ (ตรรกะเดียวกับที่ `uploadFolder` ใช้ตัดสินก่อนยิงจริง — เพื่อให้เลขตรงกับที่จะเกิดขึ้นจริงถ้ารันตอนนี้)
 * `stuck`/`empty` อ่านตรงจาก state (มีอยู่แล้ว ไม่ต้องสแกนไฟล์)
 */
export async function readUploadBacklog(dataDir: string, site: SiteId): Promise<UploadBacklogView> {
  const state = await readUploadState(dataDir, site);
  const folders = await findManifestFolders(path.join(dataDir, site));
  let pending = 0;
  let blocked = 0;
  for (const folder of folders) {
    const manifestRaw = await readFile(path.join(folder, RAW_MANIFEST), 'utf8').catch(() => null);
    if (manifestRaw === null) continue;
    const manifest = JSON.parse(manifestRaw) as Partial<RawManifest>;
    // `_manifest.json` รูปเดิมของ FoodStory ก่อนย้ายมาใช้รูปเดียวกัน (per-day-raw ticket 06) ไม่มี `files` เป็น
    // array ของ RawFileEntry — ไฟล์เก่าพวกนี้ยังอยู่บนดิสก์ตาม ADR-0005 (ไม่ลบไม่ทับ) ข้ามไปเงียบ ๆ ไม่ใช่ error
    if (!Array.isArray(manifest.files)) continue;
    const runRecord = await readRunRecord(folder);
    for (const entry of selectPendingFiles(manifest.files)) {
      const asOf = runRecord?.reports[entry.report]?.finishedAt;
      if (asOf !== undefined && isAsOfRegression(asOf, state.asOf[asOfStateKey(entry)])) blocked++;
      else pending++;
    }
  }
  return { site, pending, blocked, stuck: Object.keys(state.stuck).length, empty: Object.keys(state.empty).length };
}

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
  const manifest = JSON.parse(manifestRaw) as Partial<RawManifest>;
  // รูปเดิมของ FoodStory ก่อนย้ายมาใช้รูปเดียวกัน (per-day-raw ticket 06) ไม่มี `files` เป็น array — เจอจริงกับ
  // คลัง 2026-10-18 (readUploadBacklog เจอก่อน) ที่นี่ชี้โฟลเดอร์เดียวตรง ๆ อยู่แล้ว จึง fail ดังพร้อมบอกสาเหตุ
  // ดีกว่าข้ามไปเงียบ ๆ แบบ readUploadBacklog ที่สแกนกว้าง
  if (!Array.isArray(manifest.files)) throw new Error(`${RAW_MANIFEST} ใน ${opts.folder} เป็นรูปแบบเก่า (ไม่มี files เป็น array) — ขาอัปโหลดใช้กับโฟลเดอร์นี้ไม่ได้`);
  const runRecord = await readRunRecord(opts.folder);
  if (runRecord === null) throw new Error(`ไม่มี _run.json ใน ${opts.folder}`);

  const site = runRecord.site;
  const state = await readUploadState(dataDir, site); // อ่านครั้งเดียวสำหรับตัดสินใจ — การเขียนทุกจุดอ่านสดใหม่เองใน mergeUploadState

  // ticket 04: รายงานที่ว่าง (ok, 0 แถว, ไม่มีไฟล์) — บันทึกไว้ครั้งเดียว ไม่พยายามส่งซ้ำทุกรอบที่รันคำสั่งนี้
  const emptyReports: { readonly report: string }[] = [];
  for (const [report, outcome] of Object.entries(runRecord.reports)) {
    if (outcome.status !== 'ok' || !isEmptyReportOutcome(outcome)) continue;
    emptyReports.push({ report });
    // ticket 13: ประกาศสำเร็จไปแล้ว (รอบก่อน หรือรอบนี้ยังไม่ถึงตรงนั้น) ไม่ต้องตั้ง backlog กลับมาใหม่ — ไม่งั้น
    // รันซ้ำโฟลเดอร์เดิมหลังประกาศสำเร็จแล้วจะไปตั้ง state.empty คืนทุกครั้ง ทั้งที่ไม่มีการพยายามส่งใหม่เลยใน
    // รอบนั้น (candidate loop ข้างล่างข้ามไปเพราะเจอ announcedEmpty แล้ว ไม่มีทางได้ final.kind==='announced'
    // มาเคลียร์คืนให้ — พบจาก code review ของ ticket นี้)
    if (state.announcedEmpty[asOfStateKey({ report, range: outcome.range })] === true) continue;
    const key = `${report}@${runRecord.dataThrough}`;
    if (state.empty[key] !== true) await mergeUploadState(dataDir, site, { empty: { [key]: true } });
  }

  const tokenRef = { token: await login(setup.config, setup.credentials) };
  const catalog = await fetchDocumentTypeCatalog(setup.config, tokenRef.token);

  // ticket 11/12: ส่งประกาศ `empty` จริงเมื่อเปิด flag ไว้เท่านั้น — ปิด (default) แล้วพฤติกรรมเหมือนเดิมทุกประการ
  // (แค่ track local แบบ ticket 04 ข้างบน)
  const emptyResults: EmptyResultEntry[] = [];
  if (setup.config.sendEmpty) {
    type OkOutcome = Extract<RecordedOutcome, { status: 'ok' }>;
    const candidates: { readonly report: string; readonly outcome: OkOutcome; readonly documentType: string }[] = [];
    for (const [report, outcome] of Object.entries(runRecord.reports)) {
      if (outcome.status !== 'ok' || !isEmptyReportOutcome(outcome)) continue;
      // key ของ _run.json ไม่ใช่ชื่อรายงานเสมอไป (baseline เก็บเป็น `<รายงาน>@<วัน>`, snapshot ปิดงวดเก็บเป็น
      // `<รายงาน>@period-close`) — ไม่มีไฟล์ให้เทียบแบบไฟล์ปกติ (เพราะว่างจริง ไม่มีไฟล์เลย) จึงไม่มีทางรู้ชื่อ
      // รายงานที่ถูกต้องจาก key แบบผสมนี้ได้ ข้ามไปอย่างปลอดภัย (ไม่ส่ง ไม่เดา) แทนการแก้ให้ถูก — ชื่อรายงานจริง
      // ไม่มี "@" ปนอยู่เลย (เช็คแล้ว) ใช้เป็นตัวจับได้ตรง (พบช่องโหว่นี้พร้อมกับบั๊ก as_of ของไฟล์จริง 2026-10-19)
      if (report.includes('@')) continue;
      const key = asOfStateKey({ report, range: outcome.range });
      if (state.announcedEmpty[key] === true) continue; // ประกาศสำเร็จไปแล้วรอบก่อน ไม่ส่งซ้ำทุกรอบ
      const documentType = documentTypeFor(site, report);
      // document_type หาไม่ได้ (FoodStory จนกว่า ticket 08) หรือไม่อยู่ใน catalog จริง — fallback เงียบ ๆ เป็น
      // ticket 04 เดิม (track local อย่างเดียว) ไม่ error ไม่ reject เพราะยังไม่ใช่ความผิดพลาดของ "ครั้งนี้"
      if (documentType === undefined || !catalog.has(documentType)) continue;
      candidates.push({ report, outcome, documentType });
    }

    // ticket 12: กัน as_of ย้อนหลังข้ามรอบ — ใช้ state.asOf ตัวเดียวกับไฟล์ปกติ (ticket 03) เพื่อให้ไฟล์กับ
    // `empty` ของ (รายงาน, ช่วง) เดียวกันเช็คกันถูกทั้งสองทิศทาง · พก key ไว้กับ candidate เลย ไม่ต้องคำนวณซ้ำ
    // ตอนเขียน state ด้านล่าง
    const sendable: ((typeof candidates)[number] & { readonly key: string })[] = [];
    for (const c of candidates) {
      const key = asOfStateKey({ report: c.report, range: c.outcome.range });
      const lastKnownAsOf = state.asOf[key];
      if (isAsOfRegression(c.outcome.finishedAt, lastKnownAsOf)) {
        emptyResults.push({ report: c.report, kind: 'blocked-as-of', asOf: c.outcome.finishedAt, lastKnownAsOf: lastKnownAsOf as string });
      } else {
        sendable.push({ ...c, key });
      }
    }

    if (sendable.length > 0) {
      const payloads = sendable.map((c) => buildEmptyPayload(site, c.report, c.outcome.range, c.outcome.finishedAt, c.documentType));
      const finals = await sendEmptyBatchWithRetries(setup, tokenRef, payloads, sleep);
      for (let i = 0; i < sendable.length; i++) {
        const c = sendable[i];
        const final = finals[i];
        if (c === undefined || final === undefined) continue;
        emptyResults.push({ report: c.report, ...final });
        const key = c.key;
        if (final.kind === 'announced') {
          // ticket 12: เขียน state.asOf คู่กับฝั่งเช็คข้างบนแล้ว — ไฟล์ปกติรอบถัดไปของ (รายงาน, ช่วง) เดียวกัน
          // เช็คกับค่านี้ได้ถูก (และกลับกัน — ไฟล์ที่ส่งสำเร็จก็อัปเดตค่าที่ `empty` ใช้เช็คเหมือนกัน)
          // ticket 13: เคลียร์คีย์ของ ticket 04 ด้วย — ประกาศสำเร็จแล้วไม่ใช่ backlog ที่ "รอทีม uploader เพิ่ม
          // ช่องทาง" อีกต่อไป (`readUploadBacklog` นับจาก `state.empty` ตรง ๆ ไม่ต้องแก้ตรงนั้นเลย)
          await mergeUploadState(dataDir, site, {
            asOf: { [key]: c.outcome.finishedAt },
            announcedEmpty: { [key]: true },
            clearStuck: [key],
            clearEmpty: [`${c.report}@${runRecord.dataThrough}`],
          });
        } else if (final.kind === 'stuck') {
          await mergeUploadState(dataDir, site, { stuck: { [key]: { attempts: final.attempts, lastMessage: final.lastMessage, at: new Date().toISOString() } } });
        }
      }
    }
  }

  const results: UploadFileResult[] = [];
  for (const entry of selectPendingFiles(manifest.files)) {
    const documentType = documentTypeFor(entry.site, entry.report);
    if (documentType === undefined) {
      results.push({ file: entry.file, report: entry.report, kind: 'rejected', reason: unresolvedDocumentTypeReason(entry.site, entry.report) });
      continue;
    }
    if (!catalog.has(documentType)) {
      results.push({ file: entry.file, report: entry.report, kind: 'rejected', reason: `document_type "${documentType}" ไม่อยู่ใน catalog จริงของ uploader — ไม่ส่ง ไม่เดา` });
      continue;
    }
    // key ของ _run.json ไม่ใช่ชื่อรายงานเสมอไป (baseline/snapshot ปิดงวดเก็บเป็น `<รายงาน>@<วัน>`/`<รายงาน>@period-close`)
    // หาจากชื่อไฟล์จริงแทน ไม่ใช่เทียบ key ตรงกับ entry.report (พบจาก production จริง 2026-10-19: 12 ไฟล์ถูกปฏิเสธผิด ๆ)
    const asOf = findOutcomeForFile(runRecord, entry.file)?.finishedAt;
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
    site,
    sent: results.filter((r) => r.kind === 'sent').length,
    duplicate: results.filter((r) => r.kind === 'duplicate').length,
    rowsMismatch: results.filter((r) => r.kind === 'rows-mismatch').length,
    rejected: results.filter((r) => r.kind === 'rejected').length,
    blocked: results.filter((r) => r.kind === 'blocked-as-of').length,
    stuck: results.filter((r) => r.kind === 'stuck').length,
    results,
    emptyReports,
    emptyResults,
  };
}

export type UploadSiteResult = UploadRunResult & {
  /** โฟลเดอร์ที่ข้ามไป (เช่น `_manifest.json` รูปแบบเก่า) — ไม่ทำให้ทั้งรอบล้ม แค่ไม่นับโฟลเดอร์นั้น */
  readonly skippedFolders: readonly string[];
};

/**
 * อัปโหลดไฟล์ที่ยังไม่สำเร็จ**ทุกโฟลเดอร์**ของ site หนึ่ง (ticket 07) — ต่างจาก `uploadFolder` ที่ทำโฟลเดอร์เดียวตามที่
 * ผู้เรียกชี้ · ใช้ตัวเดินโฟลเดอร์เดียวกับ `readUploadBacklog` (ticket 06) เพื่อให้ Windmill เรียกครั้งเดียวต่อรอบแล้ว
 * ได้ backlog ทั้งหมดของ site นั้น ไม่ใช่แค่โฟลเดอร์ของวันนี้ (รอบเก็บตกอาจสร้างหลายโฟลเดอร์ในรอบเดียว และยังมี
 * backlog เก่าจากก่อนต่อ ticket นี้ด้วย) · โฟลเดอร์ที่พัง (เช่นรูปแบบเก่า) ถูกข้ามไปเฉย ๆ ไม่ทำให้โฟลเดอร์อื่นไม่ได้ส่ง —
 * ต่างจาก `uploadFolder` ที่ fail ดังเพราะที่นั่นมีโฟลเดอร์เดียวให้ทำ ไม่มี "โฟลเดอร์อื่น" ให้ไปต่อ
 */
export async function uploadSite(opts: {
  readonly site: SiteId;
  readonly dataDir?: string;
  readonly config?: UploaderConfig;
  readonly credentials?: UploaderCredentials;
  readonly sleep?: Sleep;
}): Promise<UploadSiteResult> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const setup = opts.config !== undefined && opts.credentials !== undefined ? { config: opts.config, credentials: opts.credentials } : loadUploaderSetup();
  const folders = await findManifestFolders(path.join(dataDir, opts.site));

  const results: UploadFileResult[] = [];
  const emptyReports: { readonly report: string }[] = [];
  const emptyResults: EmptyResultEntry[] = [];
  const skippedFolders: string[] = [];
  for (const folder of folders) {
    let r: UploadRunResult;
    try {
      r = await uploadFolder({ folder, dataDir, config: setup.config, credentials: setup.credentials, sleep: opts.sleep });
    } catch {
      skippedFolders.push(folder);
      continue;
    }
    results.push(...r.results);
    emptyReports.push(...r.emptyReports);
    emptyResults.push(...r.emptyResults);
  }

  return {
    site: opts.site,
    sent: results.filter((r) => r.kind === 'sent').length,
    duplicate: results.filter((r) => r.kind === 'duplicate').length,
    rowsMismatch: results.filter((r) => r.kind === 'rows-mismatch').length,
    rejected: results.filter((r) => r.kind === 'rejected').length,
    blocked: results.filter((r) => r.kind === 'blocked-as-of').length,
    stuck: results.filter((r) => r.kind === 'stuck').length,
    results,
    emptyReports,
    emptyResults,
    skippedFolders,
  };
}

/** บรรทัดสรุปสำหรับท้ายคำสั่ง `exporter upload` — รับทั้งผลของ `uploadFolder` และ `uploadSite` (superset) */
export function describeUploadResult(r: UploadRunResult | UploadSiteResult): string {
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
  if ('skippedFolders' in r) for (const folder of r.skippedFolders) lines.push(`  ⚠ ข้ามโฟลเดอร์ ${folder}: _manifest.json อ่านไม่ได้/รูปแบบเก่า`);
  return `${lines.join('\n')}\n`;
}
