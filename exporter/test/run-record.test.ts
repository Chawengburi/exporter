import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  currentBaselineFor,
  exitCodeFor,
  readRunRecord,
  recordRun,
  type ReportOutcome,
} from '../src/core/run-record.ts';
import { publishRawFiles, type RawFileEntry } from '../src/core/raw-manifest.ts';

const ok = (report: string, rows = 3): ReportOutcome => ({
  report,
  status: 'ok',
  rows,
  range: { from: '2026-10-05', to: '2026-10-07' },
  actualRange: { from: '2026-10-05', to: '2026-10-07' },
  files: [{ file: `2026-10-05_2026-10-07__${report}.csv`, rows, sha256: 'ab'.repeat(32) }],
  attempts: 1,
});
const failed = (report: string, error = 'Timeout 60000ms exceeded'): ReportOutcome => ({
  report,
  status: 'failed',
  error,
  attempts: 1,
});

async function dayFolder(): Promise<{ kindDir: string; folder: string }> {
  const kindDir = path.join(await mkdtemp(path.join(tmpdir(), 'run-record-')), 'daily');
  return { kindDir, folder: path.join(kindDir, '2026-10', '2026-10-07') };
}

const BASE = {
  site: 'hoteltime' as const,
  kind: 'daily' as const,
  dataThrough: '2026-10-07',
  startedAt: new Date('2026-10-07T05:00:00Z'),
  finishedAt: new Date('2026-10-07T05:03:00Z'),
};

test('exit code: ผ่านหมด = 0, ผ่านบางใบ = 2, ไม่ได้อะไรเลย = 1', () => {
  assert.equal(exitCodeFor([ok('a'), ok('b')]), 0);
  assert.equal(exitCodeFor([ok('a'), failed('b')]), 2);
  assert.equal(exitCodeFor([failed('a'), failed('b')]), 1);
});

test('exit code: ไม่มีใบไหนต้องรันเลย (ข้ามหมด) = 0 — ไม่มีอะไรล้ม', () => {
  assert.equal(exitCodeFor([]), 0);
});

test('บันทึก _run.json และ _summary.txt ที่มีทุกรายงานของรอบ', async () => {
  const { kindDir, folder } = await dayFolder();
  await recordRun(folder, { ...BASE, outcomes: [ok('arrivals', 2), failed('housekeeping')], latest: path.join(kindDir, 'latest') });

  const record = await readRunRecord(folder);
  assert.equal(record?.reports['arrivals']?.status, 'ok');
  assert.equal(record?.reports['housekeeping']?.status, 'failed');

  const summary = await readFile(path.join(folder, '_summary.txt'), 'utf8');
  assert.match(summary, /✔ arrivals/);
  assert.match(summary, /✘ housekeeping/);
  assert.match(summary, /Timeout 60000ms exceeded/);
  assert.match(summary, /ผ่าน 1\/2/);
});

test('รันซ้ำในโฟลเดอร์เดิมรวมผลกับรอบก่อน — ใบที่รันใหม่แทนผลเดิม ใบอื่นคงเดิม', async () => {
  const { folder } = await dayFolder();
  await recordRun(folder, { ...BASE, outcomes: [ok('arrivals'), failed('housekeeping')] });
  await recordRun(folder, {
    ...BASE,
    startedAt: new Date('2026-10-07T08:00:00Z'),
    finishedAt: new Date('2026-10-07T08:01:00Z'),
    outcomes: [ok('housekeeping', 40)],
  });

  const record = await readRunRecord(folder);
  assert.equal(record?.reports['arrivals']?.status, 'ok');
  assert.equal(record?.reports['housekeeping']?.status, 'ok');
  assert.equal(record?.runs.length, 2);
  assert.match(await readFile(path.join(folder, '_summary.txt'), 'utf8'), /ผ่าน 2\/2/);
});

test('latest ชี้โฟลเดอร์ของรอบที่ผ่านอย่างน้อยหนึ่งใบ (path แบบ relative)', async () => {
  const { kindDir, folder } = await dayFolder();
  await recordRun(folder, { ...BASE, outcomes: [ok('arrivals'), failed('housekeeping')], latest: path.join(kindDir, 'latest') });
  assert.equal(await readlink(path.join(kindDir, 'latest')), path.join('2026-10', '2026-10-07'));
});

test('latest ไม่ถูกสร้างหรือเลื่อนไปที่รอบที่ไม่ได้อะไรเลย', async () => {
  const { kindDir, folder } = await dayFolder();
  await recordRun(folder, { ...BASE, outcomes: [failed('arrivals')], latest: path.join(kindDir, 'latest') });
  assert.equal(existsSync(path.join(kindDir, 'latest')), false);

  const earlier = path.join(kindDir, '2026-10', '2026-10-06');
  await recordRun(earlier, { ...BASE, dataThrough: '2026-10-06', outcomes: [ok('arrivals')], latest: path.join(kindDir, 'latest') });
  await recordRun(folder, { ...BASE, outcomes: [failed('arrivals')], latest: path.join(kindDir, 'latest') });
  assert.equal(await readlink(path.join(kindDir, 'latest')), path.join('2026-10', '2026-10-06'));
});

test('ยังไม่มีบันทึกในโฟลเดอร์ → อ่านได้ null', async () => {
  const { folder } = await dayFolder();
  assert.equal(await readRunRecord(folder), null);
});

test('รันรายงานใบเดียวซ้ำไม่ล้างรายการที่ข้ามไว้ของรอบก่อน', async () => {
  const { folder } = await dayFolder();
  await recordRun(folder, { ...BASE, outcomes: [ok('arrivals')], skipped: [{ report: 'housekeeping', reason: 'ทดสอบ' }] });
  await recordRun(folder, { ...BASE, outcomes: [ok('arrivals')], skipped: [] });
  assert.deepEqual((await readRunRecord(folder))?.skipped, [{ report: 'housekeeping', reason: 'ทดสอบ' }]);
});

test('ใบที่เคยข้ามแล้วรอบนี้รันจริง ไม่ค้างอยู่ในรายการที่ข้าม', async () => {
  const { folder } = await dayFolder();
  await recordRun(folder, { ...BASE, outcomes: [ok('arrivals')], skipped: [{ report: 'housekeeping', reason: 'ทดสอบ' }] });
  await recordRun(folder, { ...BASE, outcomes: [ok('housekeeping')] });
  assert.deepEqual((await readRunRecord(folder))?.skipped, []);
});

test('รันซ้ำแล้วล้ม — บันทึกว่าล้ม แต่บอกด้วยว่าไฟล์ที่ผ่านของรอบก่อนยังอยู่', async () => {
  const { folder } = await dayFolder();
  await recordRun(folder, { ...BASE, outcomes: [ok('arrivals', 5)] });
  await recordRun(folder, { ...BASE, outcomes: [failed('arrivals')] });

  const entry = (await readRunRecord(folder))?.reports['arrivals'];
  assert.equal(entry?.status, 'failed');
  assert.equal(entry?.status === 'failed' ? entry.previousOk?.rows : undefined, 5);
  assert.match(await readFile(path.join(folder, '_summary.txt'), 'utf8'), /ไฟล์ที่ผ่านของรอบก่อน.*ยังอยู่/);
});

test('baseline ปัจจุบันของ (รายงาน, วันของข้อมูล) = โฟลเดอร์ baseline ล่าสุดที่วันนั้นผ่าน ข้ามโฟลเดอร์ที่วันนั้นล้ม (ใบ 09 — บันทึกด้วย id `<รายงาน>@<วัน>`)', async () => {
  const baselineDir = path.join(await mkdtemp(path.join(tmpdir(), 'baseline-')), 'baseline');
  const B = { ...BASE, kind: 'baseline' as const, latest: path.join(baselineDir, 'latest') };
  await recordRun(path.join(baselineDir, '2026-09-01'), { ...B, outcomes: [ok('postings@2026-08-30'), ok('postings@2026-08-31')] });
  await recordRun(path.join(baselineDir, '2026-10-01'), { ...B, outcomes: [failed('postings@2026-08-30'), ok('postings@2026-08-31')] });

  assert.equal(await currentBaselineFor(baselineDir, 'postings', '2026-08-30'), path.join(baselineDir, '2026-09-01'));
  assert.equal(await currentBaselineFor(baselineDir, 'postings', '2026-08-31'), path.join(baselineDir, '2026-10-01'));
  assert.equal(await currentBaselineFor(baselineDir, 'postings', '2026-08-29'), null);
});

test('baseline รันซ้ำวันเดียวกันแล้วล้ม — ไฟล์ที่ผ่านของรอบก่อนในโฟลเดอร์นั้นยังนับเป็น baseline ปัจจุบัน', async () => {
  const baselineDir = path.join(await mkdtemp(path.join(tmpdir(), 'baseline-')), 'baseline');
  const B = { ...BASE, kind: 'baseline' as const };
  await recordRun(path.join(baselineDir, '2026-10-01'), { ...B, outcomes: [ok('postings@2026-09-30')] });
  await recordRun(path.join(baselineDir, '2026-10-01'), { ...B, outcomes: [failed('postings@2026-09-30')] });
  assert.equal(await currentBaselineFor(baselineDir, 'postings', '2026-09-30'), path.join(baselineDir, '2026-10-01'));
});

test('ยังไม่เคยมี baseline เลย → null', async () => {
  assert.equal(await currentBaselineFor(path.join(tmpdir(), 'no-such-baseline-dir'), 'x', '2026-10-01'), null);
});

test('รันซ้ำในโฟลเดอร์เดิม: ใบที่รันใหม่แทนผลเดิมของใบนั้น ใบอื่นคงเดิม', async () => {
  const { folder } = await dayFolder();
  await recordRun(folder, { ...BASE, outcomes: [ok('arrivals'), failed('housekeeping')] });
  const retry = [ok('housekeeping')];
  await recordRun(folder, { ...BASE, outcomes: retry });
  assert.equal(exitCodeFor(retry), 0);
  const record = (await readRunRecord(folder))!;
  assert.deepEqual(Object.values(record.reports).map((r) => [r.report, r.status]).sort(), [['arrivals', 'ok'], ['housekeeping', 'ok']]);
});

// ticket 03: FoodStory รายเดือนไม่มี _raw/ — manifest อยู่ที่ _manifest.json ในโฟลเดอร์รอบ บรรทัดท้ายต้องชี้ถูกที่
test('_summary.txt ของรอบรายเดือน FoodStory ชี้ _manifest.json ไม่ใช่ _raw/', async () => {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), 'run-record-')), 'monthly', '2026-09');
  await recordRun(folder, { ...BASE, site: 'foodstory', kind: 'monthly', dataThrough: '2026-09-30', outcomes: [ok('salebysumdate')] });
  const summary = await readFile(path.join(folder, '_summary.txt'), 'utf8');
  assert.match(summary, /FoodStory · รอบรายเดือน/);
  assert.match(summary, /_manifest\.json/);
  assert.doesNotMatch(summary, /_raw\//);
});

// ticket 10: FoodStory รอบรายวันก็ไม่มี _raw/ เหมือนรายเดือน — บรรทัดท้ายตัดสินตาม Site ไม่ใช่ชนิดรอบ · daily/latest เลื่อนตาม
test('_summary.txt ของรอบรายวัน FoodStory ชี้ _manifest.json และ daily/latest ชี้โฟลเดอร์ของเมื่อวาน', async () => {
  const kindDir = path.join(await mkdtemp(path.join(tmpdir(), 'run-record-')), 'foodstory', 'daily');
  const folder = path.join(kindDir, '2026-10', '2026-10-11');
  await recordRun(folder, { ...BASE, site: 'foodstory', dataThrough: '2026-10-11', outcomes: [ok('salebysumdate')], latest: path.join(kindDir, 'latest') });
  const summary = await readFile(path.join(folder, '_summary.txt'), 'utf8');
  assert.match(summary, /FoodStory · รอบรายวัน/);
  assert.match(summary, /_manifest\.json/);
  assert.doesNotMatch(summary, /_raw\//);
  assert.equal(await readlink(path.join(kindDir, 'latest')), path.join('2026-10', '2026-10-11'));
});

test('🔴 วางไฟล์ดิบลงโฟลเดอร์วันของข้อมูลที่ยังไม่มี — สร้างโฟลเดอร์เอง (FoodStory พักไฟล์นอกโฟลเดอร์รอบ · รันจริงใบ 06 rename ENOENT)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'publish-raw-'));
  const staged = path.join(root, '_downloads', 'salebybill.xlsx');
  await mkdir(path.dirname(staged), { recursive: true });
  await writeFile(staged, 'raw bytes');
  const sha256 = createHash('sha256').update('raw bytes').digest('hex');
  const outDir = path.join(root, 'daily', '2026-10', '2026-10-12');
  const entry: RawFileEntry = {
    file: '2026-10-12__salebybill.xlsx', site: 'foodstory', report: 'salebybill', label: 'salebybill', family: 'per-day',
    runKind: 'daily', range: { from: '2026-10-12', to: '2026-10-12' }, actualRange: null, takenAt: '2026-10-13T12:00:00+07:00',
    sheets: [], bytes: 9, sha256, source: 'https://example.invalid', filterColumn: 'x', filterNote: 'x',
  };
  assert.deepEqual(await publishRawFiles(outDir, [{ staged, entry }], new Date()), []);
  assert.equal(await readFile(path.join(outDir, entry.file), 'utf8'), 'raw bytes');
  assert.equal(existsSync(staged), false);
});

test('🔴 _summary.txt ของโฟลเดอร์ที่มีแต่ภาพปิดงวด ไม่เขียนว่า "ข้อมูลถึง" (ชวนเข้าใจว่าเป็นรอบรายวันของวันนั้น — ใบ 05 → 07)', async () => {
  const { folder } = await dayFolder();
  const close = { ...ok('trial-balance@period-close'), range: { from: '2026-09-01', to: '2026-09-30' } };
  await recordRun(folder, { ...BASE, dataThrough: '2026-09-30', outcomes: [close] });
  const summary = await readFile(path.join(folder, '_summary.txt'), 'utf8');
  assert.doesNotMatch(summary.split('\n')[0]!, /ข้อมูลถึง/);
  assert.match(summary.split('\n')[0]!, /ภาพปิดงวด[\s\S]*2026-09-30/);
});
