import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { RAW_MANIFEST, recordPublished, type RawFileEntry, type RawManifest } from '../src/core/raw-manifest.ts';
import { recordRun, type ReportOutcome } from '../src/core/run-record.ts';
import { describeUploadResult, uploadFolder } from '../src/upload.ts';

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

async function makeFolder(
  entries: readonly RawFileEntry[],
  opts: { readonly finishedReports?: readonly string[]; readonly emptyReports?: readonly string[]; readonly finishedAt?: string } = {},
): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'upload-folder-'));
  for (const e of entries) await writeFile(path.join(folder, e.file), 'raw bytes');
  await recordPublished(folder, entries, [], new Set(entries.map((e) => e.file)), '2026-10-15T06:00:00.000Z');
  const ok = (report: string, rows = 1): ReportOutcome => ({
    report,
    status: 'ok',
    rows,
    range: { from: '2026-10-15', to: '2026-10-15' },
    actualRange: rows > 0 ? { from: '2026-10-15', to: '2026-10-15' } : null,
    files: rows > 0 ? [{ file: `${report}.xlsx`, rows, sha256: 'aa'.repeat(32) }] : [],
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

async function readManifest(folder: string): Promise<RawManifest> {
  return JSON.parse(await readFile(path.join(folder, RAW_MANIFEST), 'utf8')) as RawManifest;
}

async function readUploadStateFile(
  dataDir: string,
  site: string,
): Promise<{ asOf: Record<string, string>; empty: Record<string, true>; stuck: Record<string, { attempts: number; lastMessage: string; at: string }> }> {
  return JSON.parse(await readFile(path.join(dataDir, '_upload', `${site}.json`), 'utf8'));
}

// ── sleep ปลอมสำหรับเทสต์ — ไม่รอจริง แค่บันทึกว่าถูกเรียกด้วยกี่ ms ──

function fakeSleep() {
  const calls: number[] = [];
  return { sleep: async (ms: number) => { calls.push(ms); }, calls };
}

// ── fake uploader server: login + document-types + ingest (multipart แบบง่าย — พอสำหรับเทสต์) ──

function extractManifestField(buf: Buffer, contentType: string): unknown {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (boundary === undefined) throw new Error('ไม่มี boundary');
  const parts = buf.toString('latin1').split(`--${boundary}`);
  const part = parts.find((p) => p.includes('name="manifest"'));
  if (part === undefined) throw new Error('ไม่มี field manifest');
  const text = part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
  return JSON.parse(Buffer.from(text, 'latin1').toString('utf8'));
}

type IngestResponse = { readonly status: number; readonly body: unknown; readonly headers?: Record<string, string> };

type FakeUploader = {
  readonly url: string;
  readonly ingestCalls: unknown[];
  readonly authCalls: number;
  close(): Promise<void>;
};

async function fakeUploader(opts: {
  readonly catalog: readonly string[];
  readonly ingest: (manifestEntry: unknown, callIndex: number) => IngestResponse;
  readonly authOk?: boolean;
}): Promise<FakeUploader> {
  const ingestCalls: unknown[] = [];
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
        const manifestArray = extractManifestField(buf, req.headers['content-type'] ?? '') as unknown[];
        const manifestEntry = manifestArray[0];
        const callIndex = ingestCalls.length;
        ingestCalls.push(manifestEntry);
        const { status, body, headers } = opts.ingest(manifestEntry, callIndex);
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
    get authCalls() { return state.authCalls; },
    close: () => new Promise((r) => server.close(() => r(undefined))),
  };
}

const CREDENTIALS = { email: 'bot@example.invalid', password: 'secret' };
const configFor = (url: string) => ({ url });

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
      sent: 1, duplicate: 0, rowsMismatch: 0, rejected: 0, blocked: 0, stuck: 0,
      results: [{ file: 'arrivals.xlsx', report: 'arrivals', kind: 'sent', fileId: 'f1' }],
      emptyReports: [],
    });
    const manifest = await readManifest(folder);
    assert.equal(manifest.files[0]?.uploaded?.fileId, 'f1');
    const state = await readUploadStateFile(dataDir, 'hoteltime');
    assert.equal(state.asOf['arrivals@2026-10-15@2026-10-15'], '2026-10-15T06:00:05.000Z');
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

test('describeUploadResult: สรุปจำนวนและรายละเอียดของที่ไม่ผ่าน', () => {
  const text = describeUploadResult({
    sent: 1, duplicate: 0, rowsMismatch: 0, rejected: 1, blocked: 1, stuck: 1,
    results: [
      { file: 'a.xlsx', report: 'a', kind: 'sent', fileId: 'f1' },
      { file: 'b.xlsx', report: 'b', kind: 'rejected', reason: 'เหตุผล' },
      { file: 'c.xlsx', report: 'c', kind: 'stuck', attempts: 3, lastMessage: 'timeout' },
      { file: 'd.xlsx', report: 'd', kind: 'blocked-as-of', asOf: '2026-10-15T12:00:00.000Z', lastKnownAsOf: '2026-10-15T18:00:00.000Z' },
    ],
    emptyReports: [{ report: 'e' }],
  });
  assert.match(text, /สำเร็จ 1/);
  assert.match(text, /ว่าง\(ไม่มีอะไรต้องส่ง\) 1/);
  assert.match(text, /b\.xlsx.*เหตุผล/);
  assert.match(text, /c\.xlsx.*ค้างถาวรหลังลอง 3 ครั้ง/);
  assert.match(text, /d\.xlsx.*as_of ย้อนหลัง|d\.xlsx.*เก่ากว่า/);
});
