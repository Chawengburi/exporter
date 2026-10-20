import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { RAW_MANIFEST, recordPublished, type RawFileEntry, type RawManifest } from '../src/core/raw-manifest.ts';
import { recordRun, type ReportOutcome } from '../src/core/run-record.ts';
import { describeUploadResult, readUploadBacklog, uploadFolder, uploadSite } from '../src/upload.ts';

// ── fixture: โฟลเดอร์รอบจริง (manifest + run record + ไฟล์จริงบนดิสก์) ──

const ENTRY_BASE: Omit<RawFileEntry, 'file' | 'report'> = {
  site: 'hoteltime',
  label: 'Daily Arrivals',
  family: 'picture',
  runKind: 'daily',
  range: { from: '2026-10-15', to: '2026-10-15' },
  actualRange: null,
  takenAt: '2026-10-15T13:00:00+07:00',
  rows: 1,
  sheets: ['export'],
  bytes: 11,
  sha256: 'aa'.repeat(32),
  source: 'https://th07.hoteltime.com/pms/x',
  filterColumn: 'Date',
  filterNote: 'x',
};

async function makeFolderAt(
  folder: string,
  entries: readonly RawFileEntry[],
  opts: { readonly finishedReports?: readonly string[]; readonly emptyReports?: readonly string[]; readonly finishedAt?: string } = {},
): Promise<string> {
  await mkdir(folder, { recursive: true });
  for (const e of entries) await writeFile(path.join(folder, e.file), 'raw bytes');
  await recordPublished(folder, entries, [], new Set(entries.map((e) => e.file)), '2026-10-15T06:00:00.000Z');
  // files[] ต้องอ้างชื่อไฟล์จริงของ entry ที่ report ตรงกัน (ไม่ใช่เดาเป็น `${report}.xlsx`) — upload.ts หา as_of
  // จากชื่อไฟล์จริงใน files[] (ticket: แก้บั๊ก as_of ของ baseline/ภาพปิดงวด 2026-10-19) ถ้า fixture ใช้ชื่อปลอมจะหาไม่เจอ
  const ok = (report: string, rows = 1): ReportOutcome => ({
    report,
    status: 'ok',
    rows,
    range: { from: '2026-10-15', to: '2026-10-15' },
    actualRange: rows > 0 ? { from: '2026-10-15', to: '2026-10-15' } : null,
    files: rows > 0 ? entries.filter((e) => e.report === report).map((e) => ({ file: e.file, rows, sha256: 'aa'.repeat(32) })) : [],
    attempts: 1,
  });
  const finishedReports = opts.finishedReports ?? entries.map((e) => e.report);
  await recordRun(folder, {
    site: 'hoteltime',
    kind: 'daily',
    dataThrough: '2026-10-15',
    startedAt: new Date('2026-10-15T06:00:00.000Z'),
    finishedAt: new Date(opts.finishedAt ?? '2026-10-15T06:00:05.000Z'),
    outcomes: [...finishedReports.map((r) => ok(r)), ...(opts.emptyReports ?? []).map((r) => ok(r, 0))],
  });
  return folder;
}

async function makeFolder(
  entries: readonly RawFileEntry[],
  opts: { readonly finishedReports?: readonly string[]; readonly emptyReports?: readonly string[]; readonly finishedAt?: string } = {},
): Promise<string> {
  return makeFolderAt(await mkdtemp(path.join(tmpdir(), 'upload-folder-')), entries, opts);
}

/** โฟลเดอร์รอบจริงอยู่ใต้ `<dataDir>/<site>/daily/...` — ให้ readUploadBacklog's walker เจอ (ticket 06) */
async function makeFolderUnderSite(dataDir: string, site: 'hoteltime' | 'foodstory', dayFolderName: string, entries: readonly RawFileEntry[], opts: Parameters<typeof makeFolderAt>[2] = {}): Promise<string> {
  return makeFolderAt(path.join(dataDir, site, 'daily', '2026-10', dayFolderName), entries, opts);
}

async function readManifest(folder: string): Promise<RawManifest> {
  return JSON.parse(await readFile(path.join(folder, RAW_MANIFEST), 'utf8')) as RawManifest;
}

async function readUploadStateFile(
  dataDir: string,
  site: string,
): Promise<{
  asOf: Record<string, string>;
  empty: Record<string, true>;
  stuck: Record<string, { attempts: number; lastMessage: string; at: string }>;
  announcedEmpty: Record<string, true>;
}> {
  return JSON.parse(await readFile(path.join(dataDir, '_upload', `${site}.json`), 'utf8'));
}

// ── sleep ปลอมสำหรับเทสต์ — ไม่รอจริง แค่บันทึกว่าถูกเรียกด้วยกี่ ms ──

function fakeSleep() {
  const calls: number[] = [];
  return { sleep: async (ms: number) => { calls.push(ms); }, calls };
}

// ── fake uploader server: login + document-types + ingest (multipart แบบง่าย — พอสำหรับเทสต์) ──

/** คืน `undefined` ถ้าไม่มี field นั้น (ต่างจาก `extractManifestField` เดิมที่ throw — ticket 11 ต้องเช็คว่ามี field `empty` มาด้วยไหม) */
function extractField(buf: Buffer, contentType: string, name: string): unknown {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (boundary === undefined) throw new Error('ไม่มี boundary');
  const parts = buf.toString('latin1').split(`--${boundary}`);
  const part = parts.find((p) => p.includes(`name="${name}"`));
  if (part === undefined) return undefined;
  const text = part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
  return JSON.parse(Buffer.from(text, 'latin1').toString('utf8'));
}

type IngestResponse = { readonly status: number; readonly body: unknown; readonly headers?: Record<string, string> };

type FakeUploader = {
  readonly url: string;
  readonly ingestCalls: unknown[];
  readonly emptyCalls: readonly unknown[][];
  readonly authCalls: number;
  close(): Promise<void>;
};

async function fakeUploader(opts: {
  readonly catalog: readonly string[];
  readonly ingest?: (manifestEntry: unknown, callIndex: number) => IngestResponse;
  /** ticket 11 — เรียกเฉพาะ request ที่มี field `empty` (ไม่มี `ingest` ธรรมดามาด้วย) ได้ทั้ง batch ของ item */
  readonly ingestEmpty?: (emptyEntries: unknown[], callIndex: number) => IngestResponse;
  readonly authOk?: boolean;
}): Promise<FakeUploader> {
  const ingestCalls: unknown[] = [];
  const emptyCalls: unknown[][] = [];
  const state: { authCalls: number } = { authCalls: 0 };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (req.url === '/api/collections/users/auth-with-password') {
        state.authCalls++;
        if (opts.authOk === false) {
          res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'bad credentials' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token: `tok-${state.authCalls}` }));
        return;
      }
      if (req.url === '/api/document-types') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ items: opts.catalog.map((slug) => ({ slug })) }));
        return;
      }
      if (req.url === '/api/files/ingest') {
        const contentType = req.headers['content-type'] ?? '';
        const emptyField = extractField(buf, contentType, 'empty') as unknown[] | undefined;
        if (emptyField !== undefined) {
          const callIndex = emptyCalls.length;
          emptyCalls.push(emptyField);
          const { status, body, headers } = (opts.ingestEmpty ?? ((): IngestResponse => ({ status: 200, body: { empty_results: [] } })))(emptyField, callIndex);
          res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body));
          return;
        }
        const manifestArray = extractField(buf, contentType, 'manifest') as unknown[];
        const manifestEntry = manifestArray[0];
        const callIndex = ingestCalls.length;
        ingestCalls.push(manifestEntry);
        const { status, body, headers } = (opts.ingest ?? ((): IngestResponse => ({ status: 200, body: {} })))(manifestEntry, callIndex);
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body));
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    ingestCalls,
    emptyCalls,
    get authCalls() { return state.authCalls; },
    close: () => new Promise((r) => server.close(() => r(undefined))),
  };
}

const CREDENTIALS = { email: 'bot@example.invalid', password: 'secret' };
// sendEmpty default ปิด (ticket 11) — เทสต์ที่ต้องการเปิดส่ง `empty` ใช้ configFor(url, { sendEmpty: true }) แทน
const configFor = (url: string, overrides: { readonly sendEmpty?: boolean } = {}) => ({ url, sendEmpty: overrides.sendEmpty ?? false });

test('uploadFolder: happy path — ส่งไฟล์เดียวสำเร็จ บันทึก uploaded เข้า manifest และ as_of เข้า state', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry]);
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () => ({ status: 200, body: { failed: 0, succeeded: 1, results: [{ index: 0, ok: true, file_id: 'f1', status: 'embedding' }] } }),
  });
  try {
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    assert.deepEqual(result, {
      site: 'hoteltime', sent: 1, duplicate: 0, rowsMismatch: 0, rejected: 0, blocked: 0, stuck: 0,
      results: [{ file: 'arrivals.xlsx', report: 'arrivals', kind: 'sent', fileId: 'f1' }],
      emptyReports: [],
      emptyResults: [],
    });
    const manifest = await readManifest(folder);
    assert.equal(manifest.files[0]?.uploaded?.fileId, 'f1');
    const state = await readUploadStateFile(dataDir, 'hoteltime');
    assert.equal(state.asOf['arrivals@2026-10-15@2026-10-15'], '2026-10-15T06:00:05.000Z');
  } finally {
    await fake.close();
  }
});

// พบจาก production จริง 2026-10-19: baseline/ภาพปิดงวดเก็บ key ของ `_run.json` เป็นแบบผสม (`<รายงาน>@<วัน>`,
// `<รายงาน>@period-close`) ไม่ใช่ชื่อรายงานตรง ๆ — ของเดิมเทียบ key ตรงกับ `entry.report` แล้วหา as_of ไม่เจอ
// ปฏิเสธไฟล์จริง 12 ไฟล์ไปเฉย ๆ ตอนรัน backlog จริง — เทสต์นี้จำลองสถานการณ์เดียวกัน (key ผสม, entry.report สะอาด)
test('uploadFolder: _run.json ใช้ key แบบผสม (baseline `<รายงาน>@<วัน>`) ยังหา as_of เจอจากชื่อไฟล์จริง ไม่ปฏิเสธผิด ๆ', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: '2026-10-11__postings.xlsx', report: 'postings' };
  const folder = path.join(await mkdtemp(path.join(tmpdir(), 'upload-baseline-')), 'baseline', '2026-10-14');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, entry.file), 'raw bytes');
  await recordPublished(folder, [entry], [], new Set([entry.file]), '2026-10-14T06:00:00.000Z');
  await recordRun(folder, {
    site: 'hoteltime',
    kind: 'baseline',
    dataThrough: '2026-10-11',
    startedAt: new Date('2026-10-14T06:00:00.000Z'),
    finishedAt: new Date('2026-10-14T06:00:05.000Z'),
    outcomes: [{
      report: 'postings@2026-10-11', // key ผสม — ไม่ตรงกับ entry.report ("postings") เลย ตามจริงของ baseline
      status: 'ok',
      rows: 1,
      range: { from: '2026-10-11', to: '2026-10-11' },
      actualRange: { from: '2026-10-11', to: '2026-10-11' },
      files: [{ file: entry.file, rows: 1, sha256: 'aa'.repeat(32) }],
      attempts: 1,
    }],
  });
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_postings'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
  });
  try {
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    assert.deepEqual(result.results, [{ file: entry.file, report: 'postings', kind: 'sent', fileId: 'f1' }]);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: ไฟล์ที่มี uploaded แล้วถูกข้าม ไม่ยิง ingest เลย', async () => {
  const already: RawFileEntry = { ...ENTRY_BASE, file: 'done.xlsx', report: 'departures', uploaded: { at: '2026-10-15T00:00:00Z', fileId: 'old' } };
  const folder = await makeFolder([already]);
  const fake = await fakeUploader({ catalog: [], ingest: () => ({ status: 200, body: {} }) });
  try {
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result.results.length, 0);
    assert.equal(fake.ingestCalls.length, 0);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: document_type ไม่อยู่ใน catalog จริง → rejected ไม่ยิง ingest', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry]);
  const fake = await fakeUploader({ catalog: ['hoteltime_departures'], ingest: () => ({ status: 200, body: {} }) });
  try {
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result.rejected, 1);
    assert.equal(fake.ingestCalls.length, 0);
    assert.match(result.results[0]?.kind === 'rejected' ? result.results[0].reason : '', /catalog/);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: FoodStory ยังไม่มี document_type → rejected ไม่ยิง ingest (ticket 08)', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, site: 'foodstory', file: 'sale.xlsx', report: 'salebysumdate' };
  const folder = await makeFolder([entry]);
  const fake = await fakeUploader({ catalog: [], ingest: () => ({ status: 200, body: {} }) });
  try {
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result.rejected, 1);
    assert.equal(fake.ingestCalls.length, 0);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: 400 จาก uploader → rejected ทันที ไม่ retry (ยิง ingest ครั้งเดียว) ไม่บันทึก uploaded', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry]);
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () => ({ status: 400, body: { data: {}, message: 'Manifest[0]: unknown document_type.', status: 400 } }),
  });
  try {
    const { sleep, calls } = fakeSleep();
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS, sleep });
    assert.equal(result.rejected, 1);
    assert.equal(fake.ingestCalls.length, 1); // ไม่ retry
    assert.equal(calls.length, 0); // ไม่เคยรอเลย
    const manifest = await readManifest(folder);
    assert.equal(manifest.files[0]?.uploaded, undefined);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: ok:true + duplicate:true ถือเป็น duplicate และบันทึก uploaded ด้วย', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry]);
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () => ({ status: 200, body: { failed: 0, succeeded: 1, results: [{ index: 0, ok: true, file_id: 'f1', status: 'indexed', duplicate: true }] } }),
  });
  try {
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result.duplicate, 1);
    const manifest = await readManifest(folder);
    assert.equal(manifest.files[0]?.uploaded?.fileId, 'f1');
  } finally {
    await fake.close();
  }
});

test('uploadFolder: rows_mismatch ถือเป็นสำเร็จ (บันทึก uploaded) แต่แยกนับจาก sent ธรรมดา', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry]);
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1', rows_mismatch: { manifest: 5, converted: 4 } }] } }),
  });
  try {
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result.rowsMismatch, 1);
    assert.equal(result.sent, 0);
    const manifest = await readManifest(folder);
    assert.equal(manifest.files[0]?.uploaded?.fileId, 'f1');
  } finally {
    await fake.close();
  }
});

test('uploadFolder: ไม่มี as_of (รายงานไม่อยู่ใน _run.json) → rejected ไม่ยิง ingest', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'orphan.xlsx', report: 'no-such-report-in-run-json' };
  const folder = await makeFolder([entry], { finishedReports: [] });
  const fake = await fakeUploader({ catalog: ['hoteltime_no_such_report_in_run_json'], ingest: () => ({ status: 200, body: {} }) });
  try {
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result.rejected, 1);
    assert.equal(fake.ingestCalls.length, 0);
  } finally {
    await fake.close();
  }
});

test('🔴 uploadFolder: _manifest.json รูปเดิมของ FoodStory (ไม่มี files เป็น array) fail ดังพร้อมบอกสาเหตุ ไม่ throw TypeError ดิบ ๆ', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'upload-folder-'));
  await writeFile(path.join(folder, RAW_MANIFEST), JSON.stringify({ period: '2026-09', branch: 'x', reports: {} }));
  await assert.rejects(
    uploadFolder({ folder, config: configFor('http://unused.invalid'), credentials: CREDENTIALS }),
    /รูปแบบเก่า/,
  );
});

test('uploadFolder: ไฟล์ที่ถูกแทนที่ (_superseded/) ไม่ถูกเลือกส่งเลย', async () => {
  const old: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals', sha256: 'aa'.repeat(32) };
  const replacement: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals', sha256: 'bb'.repeat(32) };
  const folder = await makeFolder([old]);
  await writeFile(path.join(folder, replacement.file), 'different bytes');
  await recordPublished(folder, [replacement], [{ from: 'arrivals.xlsx', to: '_superseded/2026-10-15/arrivals.xlsx' }], new Set(['arrivals.xlsx']), '2026-10-15T07:00:00.000Z');
  const manifestBefore = await readManifest(folder);
  assert.equal(manifestBefore.files.length, 1);
  assert.equal(manifestBefore.superseded?.length, 1);

  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'new1', status: 'embedding' }] } }),
  });
  try {
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result.sent, 1);
    assert.equal(fake.ingestCalls.length, 1);
  } finally {
    await fake.close();
  }
});

// ── ticket 02: retry/stuck ──

test('uploadFolder: stage:"llm" ลองครั้งแรกล้ม ครั้งที่สองผ่าน → sent หลังรอ 5 นาทีหนึ่งครั้ง', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry]);
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: (_e, i) =>
      i === 0
        ? { status: 200, body: { results: [{ index: 0, ok: false, stage: 'llm', error: 'LLM ไม่ตอบ' }] } }
        : { status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } },
  });
  try {
    const { sleep, calls } = fakeSleep();
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS, sleep });
    assert.equal(result.sent, 1);
    assert.equal(fake.ingestCalls.length, 2);
    assert.deepEqual(calls, [5 * 60_000]);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: stage:"save" ล้มครบ 3 ครั้ง → stuck พร้อมจำนวนครั้งและข้อความล่าสุด ไม่บันทึก uploaded แต่บันทึกไว้ใน state ให้เห็นข้ามรอบ', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry]);
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: false, stage: 'save', error: 'บันทึกไม่ได้' }] } }),
  });
  try {
    const { sleep, calls } = fakeSleep();
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url), credentials: CREDENTIALS, sleep });
    assert.equal(result.stuck, 1);
    assert.deepEqual(result.results[0], { file: 'arrivals.xlsx', report: 'arrivals', kind: 'stuck', attempts: 3, lastMessage: 'บันทึกไม่ได้' });
    assert.equal(fake.ingestCalls.length, 3);
    assert.deepEqual(calls, [5 * 60_000, 5 * 60_000]);
    const manifest = await readManifest(folder);
    assert.equal(manifest.files[0]?.uploaded, undefined);
    const state = await readUploadStateFile(dataDir, 'hoteltime');
    assert.deepEqual(state.stuck['arrivals@2026-10-15@2026-10-15'], { attempts: 3, lastMessage: 'บันทึกไม่ได้', at: state.stuck['arrivals@2026-10-15@2026-10-15']?.at });
  } finally {
    await fake.close();
  }
});

test('uploadFolder: ไฟล์ที่เคยค้างถาวรแล้วส่งสำเร็จในรอบถัดไป (คนละโฟลเดอร์) → เครื่องหมายค้างถาวรใน state ถูกเคลียร์ออก', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  let shouldFail = true;
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () =>
      shouldFail
        ? { status: 200, body: { results: [{ index: 0, ok: false, stage: 'save', error: 'บันทึกไม่ได้' }] } }
        : { status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } },
  });
  try {
    const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
    const folder1 = await makeFolder([entry]);
    const { sleep } = fakeSleep();
    const result1 = await uploadFolder({ folder: folder1, dataDir, config: configFor(fake.url), credentials: CREDENTIALS, sleep });
    assert.equal(result1.stuck, 1);
    assert.notEqual((await readUploadStateFile(dataDir, 'hoteltime')).stuck['arrivals@2026-10-15@2026-10-15'], undefined);

    shouldFail = false;
    const folder2 = await makeFolder([entry]);
    const result2 = await uploadFolder({ folder: folder2, dataDir, config: configFor(fake.url), credentials: CREDENTIALS, sleep });
    assert.equal(result2.sent, 1);
    assert.equal((await readUploadStateFile(dataDir, 'hoteltime')).stuck['arrivals@2026-10-15@2026-10-15'], undefined);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: 429 รอตาม Retry-After ไม่ใช่ 5 นาทีเริ่มต้น', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry]);
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: (_e, i) =>
      i === 0
        ? { status: 429, body: { message: 'rate limited' }, headers: { 'Retry-After': '42' } }
        : { status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } },
  });
  try {
    const { sleep, calls } = fakeSleep();
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS, sleep });
    assert.equal(result.sent, 1);
    assert.deepEqual(calls, [42_000]);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: 401 กลางรอบ re-login ครั้งเดียว ไม่กินโควตา retry แล้วลองไฟล์เดิมต่อทันทีโดยไม่รอ', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry]);
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: (_e, i) => (i === 0 ? { status: 401, body: {} } : { status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
  });
  try {
    const { sleep, calls } = fakeSleep();
    const result = await uploadFolder({ folder, dataDir: await mkdtemp(path.join(tmpdir(), 'x-')), config: configFor(fake.url), credentials: CREDENTIALS, sleep });
    assert.equal(result.sent, 1);
    assert.equal(fake.authCalls, 2); // login ตอนเริ่ม + relogin หนึ่งครั้งตอนเจอ 401
    assert.equal(calls.length, 0); // relogin ไม่ต้องรอ
  } finally {
    await fake.close();
  }
});

// ── ticket 03: กัน as_of ย้อนหลังข้ามรอบ ──

test('uploadFolder: as_of เก่ากว่าที่ส่งสำเร็จไปแล้วในรอบก่อน (คนละโฟลเดอร์) → blocked-as-of ไม่ยิง ingest', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_manager_summary'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
  });
  try {
    // รอบแรก: as_of ใหม่กว่า ส่งสำเร็จ
    const newerEntry: RawFileEntry = { ...ENTRY_BASE, file: 'manager-summary.xlsx', report: 'manager-summary' };
    const folderNew = await makeFolder([newerEntry], { finishedAt: '2026-10-15T18:00:00.000Z' });
    const result1 = await uploadFolder({ folder: folderNew, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result1.sent, 1);

    // รอบ backfill ที่มาทีหลังจริง แต่ as_of เก่ากว่า (เช่น รอบเที่ยงของวันเดียวกันที่พลาดไป)
    const olderEntry: RawFileEntry = { ...ENTRY_BASE, file: 'manager-summary.xlsx', report: 'manager-summary' };
    const folderOld = await makeFolder([olderEntry], { finishedAt: '2026-10-15T12:00:00.000Z' });
    const result2 = await uploadFolder({ folder: folderOld, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result2.blocked, 1);
    assert.deepEqual(result2.results[0], {
      file: 'manager-summary.xlsx', report: 'manager-summary', kind: 'blocked-as-of',
      asOf: '2026-10-15T12:00:00.000Z', lastKnownAsOf: '2026-10-15T18:00:00.000Z',
    });
    assert.equal(fake.ingestCalls.length, 1); // แค่รอบแรก — รอบสองไม่ยิงเลย
  } finally {
    await fake.close();
  }
});

test('uploadFolder: as_of เท่ากับค่าที่เคยส่งสำเร็จเป๊ะ (resend) ไม่ถูกบล็อก', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_manager_summary'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1', duplicate: true }] } }),
  });
  try {
    const entry: RawFileEntry = { ...ENTRY_BASE, file: 'manager-summary.xlsx', report: 'manager-summary' };
    const folder1 = await makeFolder([entry], { finishedAt: '2026-10-15T18:00:00.000Z' });
    await uploadFolder({ folder: folder1, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });

    const folder2 = await makeFolder([entry], { finishedAt: '2026-10-15T18:00:00.000Z' });
    const result = await uploadFolder({ folder: folder2, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result.blocked, 0);
    assert.equal(result.duplicate, 1);
  } finally {
    await fake.close();
  }
});

// ── ticket 04: รายงานว่าง ──

test('uploadFolder: รายงานว่าง (ok, 0 แถว, ไม่มีไฟล์) ไม่ขึ้นใน results แต่ขึ้นใน emptyReports และบันทึก state', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry], { emptyReports: ['departures'] });
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
  });
  try {
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    assert.deepEqual(result.emptyReports, [{ report: 'departures' }]);
    assert.equal(result.results.some((r) => r.report === 'departures'), false);
    const state = await readUploadStateFile(dataDir, 'hoteltime');
    assert.equal(state.empty['departures@2026-10-15'], true);
  } finally {
    await fake.close();
  }
});

// ── ticket 11: ส่งประกาศ `empty` จริงเมื่อเปิด flag (sendEmpty) ──

test('uploadFolder: flag ปิด (default) → ไม่ยิง request empty เลย แม้มีรายงานว่างจริง', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry], { emptyReports: ['departures'] });
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals', 'hoteltime_departures'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
  });
  try {
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(fake.emptyCalls.length, 0);
    assert.deepEqual(result.emptyResults, []);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: flag เปิด → ส่งรายงานว่างจริงเป็น empty array พร้อม field ครบ 6 ตัว และบันทึก state', async () => {
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolder([entry], { emptyReports: ['departures'] });
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals', 'hoteltime_departures'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
    ingestEmpty: (entries) => ({ status: 200, body: { empty_results: entries.map((_, i) => ({ index: i, ok: true, superseded: ['old1'] })) } }),
  });
  try {
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS });
    assert.equal(fake.emptyCalls.length, 1);
    assert.deepEqual(fake.emptyCalls[0], [
      { source_system: 'hoteltime', document_type: 'hoteltime_departures', report: 'departures', range_from: '2026-10-15', range_to: '2026-10-15', as_of: '2026-10-15T06:00:05.000Z' },
    ]);
    assert.deepEqual(result.emptyResults, [{ report: 'departures', kind: 'announced', superseded: ['old1'] }]);
    const state = await readUploadStateFile(dataDir, 'hoteltime');
    assert.equal(state.announcedEmpty['departures@2026-10-15@2026-10-15'], true);
    // ticket 12: announce สำเร็จอัปเดต state.asOf ตัวเดียวกับที่ไฟล์ปกติ (ticket 03) ใช้เช็ค as_of regression —
    // มาคู่กับฝั่งเช็ค as_of ของ empty เองแล้ว (เทสต์ด้านล่าง) ไม่ใช่ครึ่งทางแบบ ticket 11
    assert.equal(state.asOf['departures@2026-10-15@2026-10-15'], '2026-10-15T06:00:05.000Z');
  } finally {
    await fake.close();
  }
});

// ── ticket 12: as_of guard ร่วมกับไฟล์ + retry policy เดียวกับไฟล์ ──

test('uploadFolder: empty item ที่ as_of เก่ากว่าไฟล์จริงที่ส่งสำเร็จไปแล้วของ (รายงาน, ช่วง) เดียวกัน → blocked-as-of ไม่ถูกส่ง', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_departures'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
  });
  try {
    // รอบใหม่: ไฟล์จริงของ departures ส่งสำเร็จก่อน (as_of ใหม่กว่า)
    const newEntry: RawFileEntry = { ...ENTRY_BASE, file: 'departures.xlsx', report: 'departures' };
    const freshFolder = await makeFolder([newEntry], { finishedAt: '2026-10-15T18:00:00.000Z' });
    await uploadFolder({ folder: freshFolder, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });

    // รอบเก็บตกเก่า: พยายามประกาศ departures ว่างด้วย as_of เก่ากว่า
    const staleFolder = await makeFolder([], { finishedReports: [], emptyReports: ['departures'], finishedAt: '2026-10-15T12:00:00.000Z' });
    const result = await uploadFolder({ folder: staleFolder, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS });

    assert.equal(fake.emptyCalls.length, 0); // ไม่ยิงเลย ถูกบล็อกตั้งแต่ก่อนส่ง
    assert.deepEqual(result.emptyResults, [
      { report: 'departures', kind: 'blocked-as-of', asOf: '2026-10-15T12:00:00.000Z', lastKnownAsOf: '2026-10-15T18:00:00.000Z' },
    ]);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: empty ประกาศสำเร็จแล้ว ไฟล์จริงรอบถัดไปที่ as_of เก่ากว่าของ (รายงาน, ช่วง) เดียวกัน → blocked-as-of (ทิศตรงข้าม)', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_departures'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
    ingestEmpty: (entries) => ({ status: 200, body: { empty_results: entries.map((_, i) => ({ index: i, ok: true, superseded: [] })) } }),
  });
  try {
    // รอบใหม่: ประกาศ departures ว่างสำเร็จก่อน (as_of ใหม่กว่า)
    const freshFolder = await makeFolder([], { finishedReports: [], emptyReports: ['departures'], finishedAt: '2026-10-15T18:00:00.000Z' });
    await uploadFolder({ folder: freshFolder, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS });

    // รอบเก็บตกเก่า: ไฟล์จริงของ departures ด้วย as_of เก่ากว่า
    const staleEntry: RawFileEntry = { ...ENTRY_BASE, file: 'departures.xlsx', report: 'departures' };
    const staleFolder = await makeFolder([staleEntry], { finishedAt: '2026-10-15T12:00:00.000Z' });
    const result = await uploadFolder({ folder: staleFolder, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });

    assert.equal(fake.ingestCalls.length, 0); // ไม่ยิงไฟล์เลย ถูกบล็อกตั้งแต่ก่อนส่ง
    assert.deepEqual(result.results, [
      { file: 'departures.xlsx', report: 'departures', kind: 'blocked-as-of', asOf: '2026-10-15T12:00:00.000Z', lastKnownAsOf: '2026-10-15T18:00:00.000Z' },
    ]);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: empty item เจอ 503 ก่อน แล้วสำเร็จรอบที่สอง → retry แบบเดียวกับไฟล์ (รอ แล้วลองซ้ำ)', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  let attempts = 0;
  const fake = await fakeUploader({
    catalog: ['hoteltime_departures'],
    ingestEmpty: (entries) => {
      attempts++;
      if (attempts === 1) return { status: 503, body: { message: 'service unavailable' } };
      return { status: 200, body: { empty_results: entries.map((_, i) => ({ index: i, ok: true, superseded: [] })) } };
    },
  });
  try {
    const folder = await makeFolder([], { finishedReports: [], emptyReports: ['departures'] });
    const { sleep, calls } = fakeSleep();
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS, sleep });
    assert.equal(fake.emptyCalls.length, 2);
    assert.deepEqual(calls, [5 * 60_000]);
    assert.deepEqual(result.emptyResults, [{ report: 'departures', kind: 'announced', superseded: [] }]);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: empty item เจอ 503 ครบ 3 ครั้ง → stuck (ไม่ใช่ rejected เงียบ ๆ)', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_departures'],
    ingestEmpty: () => ({ status: 503, body: { message: 'service unavailable' } }),
  });
  try {
    const folder = await makeFolder([], { finishedReports: [], emptyReports: ['departures'] });
    const { sleep } = fakeSleep();
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS, sleep });
    assert.equal(fake.emptyCalls.length, 3);
    assert.deepEqual(result.emptyResults, [{ report: 'departures', kind: 'stuck', attempts: 3, lastMessage: 'service unavailable' }]);
    const state = await readUploadStateFile(dataDir, 'hoteltime');
    assert.equal(state.stuck['departures@2026-10-15@2026-10-15']?.attempts, 3);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: รายงานว่างที่ประกาศสำเร็จไปแล้วรอบก่อน (announcedEmpty) → ไม่ส่งซ้ำรอบถัดไป', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_departures'],
    ingestEmpty: (entries) => ({ status: 200, body: { empty_results: entries.map((_, i) => ({ index: i, ok: true, superseded: [] })) } }),
  });
  try {
    const folder1 = await makeFolder([], { finishedReports: [], emptyReports: ['departures'] });
    await uploadFolder({ folder: folder1, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS });
    assert.equal(fake.emptyCalls.length, 1);

    const folder2 = await makeFolder([], { finishedReports: [], emptyReports: ['departures'] });
    const result = await uploadFolder({ folder: folder2, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS });
    assert.equal(fake.emptyCalls.length, 1); // ไม่เพิ่ม — ไม่ยิงซ้ำ
    assert.deepEqual(result.emptyResults, []);
    // ticket 13 (พบจาก code review): รอบที่สองไม่ได้ลองส่งอะไรเลย (ข้ามเพราะ announcedEmpty แล้ว) จึงไม่มี
    // final.kind==='announced' ให้ clearEmpty — ตรวจว่า ticket-04 loop เองไม่ไปตั้ง state.empty กลับคืนมา
    const state = await readUploadStateFile(dataDir, 'hoteltime');
    assert.equal(state.empty['departures@2026-10-15'], undefined);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: document_type หาไม่ได้ (FoodStory จนกว่า ticket 08) → fallback เงียบ ๆ เป็น ticket 04 เดิม ไม่ยิง ไม่ error', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({ catalog: [] });
  try {
    const folder = await makeFolderAt(
      path.join(dataDir, 'foodstory-scratch'),
      [],
      { finishedReports: [], emptyReports: ['salebysumdate'] },
    );
    // makeFolderAt ปักไว้ site: 'hoteltime' เสมอ (ENTRY_BASE) — สร้าง run record มือสำหรับ foodstory โดยเฉพาะ
    const runRecordRaw = JSON.parse(await readFile(path.join(folder, '_run.json'), 'utf8'));
    runRecordRaw.site = 'foodstory';
    await writeFile(path.join(folder, '_run.json'), JSON.stringify(runRecordRaw));
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS });
    assert.equal(fake.emptyCalls.length, 0);
    assert.deepEqual(result.emptyResults, []);
    assert.deepEqual(result.emptyReports, [{ report: 'salebysumdate' }]);
  } finally {
    await fake.close();
  }
});

// พบพร้อมกับบั๊ก as_of ของไฟล์จริง 2026-10-19: loop ของ empty array ใช้ key ของ _run.json ตรง ๆ เป็น "ชื่อรายงาน"
// — ถ้าเป็น key แบบผสม (baseline/ภาพปิดงวด) จะส่ง report ผิดเข้า documentTypeFor/payload ได้ ยังไม่เคยเกิดจริง
// (flag ปิดอยู่ ticket 14 ยัง block) แต่กันไว้ล่วงหน้าเพราะรู้ต้นเหตุแล้วและแก้ไฟล์เดียวกับบั๊ก as_of
test('uploadFolder: รายงานว่างที่ _run.json ใช้ key แบบผสม (ภาพปิดงวด) → ข้ามอย่างปลอดภัย ไม่ส่ง ไม่เดา report', async () => {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), 'upload-period-close-')), 'daily', '2026-09', '2026-09-30');
  await mkdir(folder, { recursive: true });
  await recordPublished(folder, [], [], new Set(), '2026-10-14T06:00:00.000Z');
  await recordRun(folder, {
    site: 'hoteltime',
    kind: 'daily',
    dataThrough: '2026-09-30',
    startedAt: new Date('2026-10-14T06:00:00.000Z'),
    finishedAt: new Date('2026-10-14T06:00:05.000Z'),
    outcomes: [{
      report: 'trial-balance@period-close', // key ผสม — isEmptyReportOutcome ยังตัดสินว่า "ว่าง" ได้ปกติ (rows:0, files:[])
      status: 'ok',
      rows: 0,
      range: { from: '2026-09-01', to: '2026-09-30' },
      actualRange: null,
      files: [],
      attempts: 1,
    }],
  });
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_trial_balance'],
    ingestEmpty: (entries) => ({ status: 200, body: { empty_results: entries.map((_, i) => ({ index: i, ok: true, superseded: [] })) } }),
  });
  try {
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS });
    assert.equal(fake.emptyCalls.length, 0); // ไม่ยิงเลย ไม่เดา report จาก key ผสม
    assert.deepEqual(result.emptyResults, []);
  } finally {
    await fake.close();
  }
});

test('uploadFolder: uploader ปฏิเสธ (400) → ไม่ announced ไม่บันทึก state ไว้ลองใหม่รอบหน้าได้', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_departures'],
    ingestEmpty: () => ({ status: 400, body: { message: 'unknown document_type' } }),
  });
  try {
    const folder = await makeFolder([], { finishedReports: [], emptyReports: ['departures'] });
    const result = await uploadFolder({ folder, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS });
    assert.deepEqual(result.emptyResults, [{ report: 'departures', kind: 'rejected', reason: 'unknown document_type' }]);
    const state = await readUploadStateFile(dataDir, 'hoteltime');
    assert.equal(state.announcedEmpty['departures@2026-10-15@2026-10-15'], undefined);
  } finally {
    await fake.close();
  }
});

test('describeUploadResult: สรุปจำนวนและรายละเอียดของที่ไม่ผ่าน', () => {
  const text = describeUploadResult({
    site: 'hoteltime', sent: 1, duplicate: 0, rowsMismatch: 0, rejected: 1, blocked: 1, stuck: 1,
    results: [
      { file: 'a.xlsx', report: 'a', kind: 'sent', fileId: 'f1' },
      { file: 'b.xlsx', report: 'b', kind: 'rejected', reason: 'เหตุผล' },
      { file: 'c.xlsx', report: 'c', kind: 'stuck', attempts: 3, lastMessage: 'timeout' },
      { file: 'd.xlsx', report: 'd', kind: 'blocked-as-of', asOf: '2026-10-15T12:00:00.000Z', lastKnownAsOf: '2026-10-15T18:00:00.000Z' },
    ],
    emptyReports: [{ report: 'e' }],
    emptyResults: [],
  });
  assert.match(text, /สำเร็จ 1/);
  assert.match(text, /ว่าง\(ไม่มีอะไรต้องส่ง\) 1/);
  assert.match(text, /b\.xlsx.*เหตุผล/);
  assert.match(text, /c\.xlsx.*ค้างถาวรหลังลอง 3 ครั้ง/);
  assert.match(text, /d\.xlsx.*as_of ย้อนหลัง|d\.xlsx.*เก่ากว่า/);
});

// ── ticket 06: readUploadBacklog อ่านจากดิสก์ล้วน ๆ ไม่ยิง network — โฟลเดอร์ต้องอยู่ใต้ <dataDir>/<site>/...
// จริง ให้ตัวเดินโฟลเดอร์เจอ (ไม่ใช่ tmp dir เปล่า ๆ แบบ makeFolder ของเทสต์อื่นด้านบน) ──

test('readUploadBacklog: ไฟล์ที่ยังไม่อัปโหลดเลย (ไม่เคยลองส่ง) → นับเป็น pending', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  await makeFolderUnderSite(dataDir, 'hoteltime', '2026-10-15', [entry]);
  const backlog = await readUploadBacklog(dataDir, 'hoteltime');
  assert.deepEqual(backlog, { site: 'hoteltime', pending: 1, blocked: 0, stuck: 0, empty: 0 });
});

test('readUploadBacklog: ไฟล์ที่อัปโหลดสำเร็จแล้ว (มี uploaded) ไม่ถูกนับเลย', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals', uploaded: { at: '2026-10-15T00:00:00Z', fileId: 'f1' } };
  await makeFolderUnderSite(dataDir, 'hoteltime', '2026-10-15', [entry]);
  const backlog = await readUploadBacklog(dataDir, 'hoteltime');
  assert.deepEqual(backlog, { site: 'hoteltime', pending: 0, blocked: 0, stuck: 0, empty: 0 });
});

test('readUploadBacklog: หลังรันจริงแล้วค้างถาวร (stuck) → นับจาก state ไม่ต้องสแกนไฟล์ซ้ำ', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolderUnderSite(dataDir, 'hoteltime', '2026-10-15', [entry]);
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: false, stage: 'save', error: 'บันทึกไม่ได้' }] } }),
  });
  try {
    const { sleep } = fakeSleep();
    await uploadFolder({ folder, dataDir, config: configFor(fake.url), credentials: CREDENTIALS, sleep });
    const backlog = await readUploadBacklog(dataDir, 'hoteltime');
    // ไฟล์เดิมยังไม่มี `uploaded` (ล้ม) → ยังนับเป็น pending ด้วย *และ* มี stuck 1 จาก state แยกกัน — ไม่ใช่ either/or
    assert.deepEqual(backlog, { site: 'hoteltime', pending: 1, blocked: 0, stuck: 1, empty: 0 });
  } finally {
    await fake.close();
  }
});

test('readUploadBacklog: รายงานว่าง (ticket 04) → นับจาก state.empty', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const entry: RawFileEntry = { ...ENTRY_BASE, file: 'arrivals.xlsx', report: 'arrivals' };
  const folder = await makeFolderUnderSite(dataDir, 'hoteltime', '2026-10-15', [entry], { emptyReports: ['departures'] });
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
  });
  try {
    await uploadFolder({ folder, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    const backlog = await readUploadBacklog(dataDir, 'hoteltime');
    assert.equal(backlog.empty, 1);
    assert.equal(backlog.pending, 0); // arrivals.xlsx สำเร็จแล้ว ไม่นับ
  } finally {
    await fake.close();
  }
});

test('readUploadBacklog: รายงานว่างที่ประกาศ empty สำเร็จแล้ว (ticket 11-13) → ไม่นับเป็น backlog อีก', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const folder = await makeFolderUnderSite(dataDir, 'hoteltime', '2026-10-15', [], { finishedReports: [], emptyReports: ['departures'] });
  const fake = await fakeUploader({
    catalog: ['hoteltime_departures'],
    ingestEmpty: (entries) => ({ status: 200, body: { empty_results: entries.map((_, i) => ({ index: i, ok: true, superseded: [] })) } }),
  });
  try {
    await uploadFolder({ folder, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS });
    assert.equal((await readUploadBacklog(dataDir, 'hoteltime')).empty, 0); // ประกาศสำเร็จแล้ว ไม่ใช่ backlog ที่รออีกต่อไป

    // ticket 13 (พบจาก code review): รันโฟลเดอร์เดิมซ้ำ (เช่น รอบเก็บตกที่แตะโฟลเดอร์เดียวกัน) ต้องไม่ทำให้
    // backlog โผล่กลับมาใหม่ ทั้งที่ไม่มีการพยายามส่งอะไรเพิ่มเลยในรอบนี้ (ticket-04 loop เองต้องไม่ไปตั้ง
    // state.empty คืน เพราะรู้แล้วว่ารายงานนี้ announcedEmpty อยู่)
    await uploadFolder({ folder, dataDir, config: configFor(fake.url, { sendEmpty: true }), credentials: CREDENTIALS });
    assert.equal((await readUploadBacklog(dataDir, 'hoteltime')).empty, 0);
  } finally {
    await fake.close();
  }
});

test('readUploadBacklog: as_of ของไฟล์ที่ยังไม่ส่งเก่ากว่าค่าที่เคยส่งสำเร็จไปแล้ว (คนละโฟลเดอร์) → นับเป็น blocked ไม่ใช่ pending', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({
    catalog: ['hoteltime_manager_summary'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
  });
  try {
    const newerEntry: RawFileEntry = { ...ENTRY_BASE, file: 'manager-summary.xlsx', report: 'manager-summary' };
    const folderNew = await makeFolderUnderSite(dataDir, 'hoteltime', '2026-10-15-rerun', [newerEntry], { finishedAt: '2026-10-15T18:00:00.000Z' });
    await uploadFolder({ folder: folderNew, dataDir, config: configFor(fake.url), credentials: CREDENTIALS });

    const olderEntry: RawFileEntry = { ...ENTRY_BASE, file: 'manager-summary.xlsx', report: 'manager-summary' };
    await makeFolderUnderSite(dataDir, 'hoteltime', '2026-10-15', [olderEntry], { finishedAt: '2026-10-15T12:00:00.000Z' });
    const backlog = await readUploadBacklog(dataDir, 'hoteltime');
    // folderNew: สำเร็จแล้ว ไม่นับ · folder (older): ยังไม่ได้ลองส่งเลยแต่ as_of เก่ากว่าที่เคยสำเร็จ → blocked
    assert.deepEqual(backlog, { site: 'hoteltime', pending: 0, blocked: 1, stuck: 0, empty: 0 });
  } finally {
    await fake.close();
  }
});

test('🔴 readUploadBacklog: _manifest.json รูปเดิมของ FoodStory ก่อนย้ายมาใช้รูปเดียวกัน (ไม่มี files เป็น array) ข้ามไปเงียบ ๆ ไม่ throw (เจอจริงกับคลัง 2026-10-18)', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const legacyFolder = path.join(dataDir, 'foodstory', 'monthly', '2026-09');
  await mkdir(legacyFolder, { recursive: true });
  await writeFile(path.join(legacyFolder, RAW_MANIFEST), JSON.stringify({ period: '2026-09', branch: 'x', reports: {} }));
  const backlog = await readUploadBacklog(dataDir, 'foodstory');
  assert.deepEqual(backlog, { site: 'foodstory', pending: 0, blocked: 0, stuck: 0, empty: 0 });
});

test('readUploadBacklog: ไม่มีโฟลเดอร์ของ site นั้นเลย (ยังไม่เคย export) → ทุกตัวเป็นศูนย์ ไม่ throw', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const backlog = await readUploadBacklog(dataDir, 'foodstory');
  assert.deepEqual(backlog, { site: 'foodstory', pending: 0, blocked: 0, stuck: 0, empty: 0 });
});

// ── ticket 07: uploadSite — เวอร์ชันที่ Windmill เรียก กวาดทุกโฟลเดอร์ของ site เดียว ไม่ใช่โฟลเดอร์เดียวแบบ uploadFolder ──

test('uploadSite: กวาดหลายโฟลเดอร์ของ site เดียว รวมผลเป็นก้อนเดียว', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  await makeFolderUnderSite(dataDir, 'hoteltime', '2026-10-15', [{ ...ENTRY_BASE, file: 'a.xlsx', report: 'arrivals' }]);
  await makeFolderUnderSite(dataDir, 'hoteltime', '2026-10-16', [{ ...ENTRY_BASE, file: 'b.xlsx', report: 'departures', range: { from: '2026-10-16', to: '2026-10-16' } }], { finishedAt: '2026-10-16T06:00:05.000Z' });
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals', 'hoteltime_departures'],
    ingest: (e) => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: `f-${(e as { report: string }).report}` }] } }),
  });
  try {
    const result = await uploadSite({ site: 'hoteltime', dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result.site, 'hoteltime');
    assert.equal(result.sent, 2);
    assert.deepEqual(new Set(result.results.map((r) => r.file)), new Set(['a.xlsx', 'b.xlsx']));
  } finally {
    await fake.close();
  }
});

test('uploadSite: โฟลเดอร์หนึ่งพังเพราะ _manifest.json รูปแบบเก่า ไม่ทำให้ขาดการส่งโฟลเดอร์อื่นที่ดี', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const legacyFolder = path.join(dataDir, 'hoteltime', 'daily', '2026-10', '2026-10-10');
  await mkdir(legacyFolder, { recursive: true });
  await writeFile(path.join(legacyFolder, RAW_MANIFEST), JSON.stringify({ period: 'x', reports: {} }));
  await makeFolderUnderSite(dataDir, 'hoteltime', '2026-10-15', [{ ...ENTRY_BASE, file: 'a.xlsx', report: 'arrivals' }]);
  const fake = await fakeUploader({
    catalog: ['hoteltime_arrivals'],
    ingest: () => ({ status: 200, body: { results: [{ index: 0, ok: true, file_id: 'f1' }] } }),
  });
  try {
    const result = await uploadSite({ site: 'hoteltime', dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    assert.equal(result.sent, 1);
    assert.deepEqual(result.skippedFolders, [legacyFolder]);
  } finally {
    await fake.close();
  }
});

test('uploadSite: ไม่มีโฟลเดอร์เลย → ผลว่างทุกตัว ไม่ throw', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'upload-state-'));
  const fake = await fakeUploader({ catalog: [], ingest: () => ({ status: 200, body: {} }) });
  try {
    const result = await uploadSite({ site: 'foodstory', dataDir, config: configFor(fake.url), credentials: CREDENTIALS });
    assert.deepEqual(result, { site: 'foodstory', sent: 0, duplicate: 0, rowsMismatch: 0, rejected: 0, blocked: 0, stuck: 0, results: [], emptyReports: [], emptyResults: [], skippedFolders: [] });
  } finally {
    await fake.close();
  }
});
