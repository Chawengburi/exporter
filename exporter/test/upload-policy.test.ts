import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { RAW_MANIFEST, applyUploadPolicy, recordPublished, recordUploaded, uploadPolicyFor, type RawFileEntry, type RawManifest } from '../src/core/raw-manifest.ts';
import { selectPendingFiles } from '../src/core/uploader.ts';

/** exporter-hoteltime-4h-rounds ticket 07: ขาอัปโหลดส่งเฉพาะ per-day ที่จบวันแล้ว + snapshot ฉบับ 23:00 (seam 2/3) */

const base = (over: Partial<RawFileEntry>): RawFileEntry => ({
  file: 'f.xlsx', site: 'hoteltime', report: 'r', label: 'r', family: 'per-day', runKind: 'daily', range: { from: '2026-11-17', to: '2026-11-17' },
  actualRange: null, takenAt: '2026-11-17T12:00:00+07:00', sheets: [], bytes: 1, sha256: 'aa', source: 'x', filterColumn: 'x', filterNote: 'x', ...over,
});
const perDay = (day: string, over: Partial<RawFileEntry> = {}) => base({ family: 'per-day', range: { from: day, to: day }, ...over });
const snapshot = (takenAt: string, over: Partial<RawFileEntry> = {}) => base({ family: 'picture', file: `snap-${takenAt}.xlsx`, takenAt, ...over });
const TODAY = '2026-11-18';

test('นโยบายอัปโหลดของไฟล์จากรอบดึง: per-day ของวันนี้ถือไว้ถึงพรุ่งนี้ · ของเมื่อวานส่งได้', () => {
  assert.deepEqual(uploadPolicyFor(perDay('2026-11-18'), TODAY), { notBefore: '2026-11-19' });
  assert.equal(uploadPolicyFor(perDay('2026-11-17'), TODAY), undefined);
});

test('นโยบาย snapshot: เฉพาะฉบับ 23:00 ส่ง (ถือไว้ถึงพรุ่งนี้) · ฉบับรอบอื่นไม่ส่ง · snapshot ปิดงวดไม่ติดธงเลย', () => {
  assert.deepEqual(uploadPolicyFor(snapshot('2026-11-18T23:00:05+07:00'), TODAY), { notBefore: '2026-11-19' });
  assert.equal(uploadPolicyFor(snapshot('2026-11-18T12:00:05+07:00'), TODAY), 'skip');
  assert.equal(uploadPolicyFor(snapshot('2026-11-18T08:00:05+07:00'), TODAY), 'skip');
  assert.equal(uploadPolicyFor(snapshot('2026-11-18T08:00:05+07:00', { periodClose: true }), TODAY), undefined);
});

test('selectPendingFiles: ไม่ส่งไฟล์ที่ไม่ส่ง/ยังถือไว้ · ไฟล์เก่าที่ไม่มีนโยบาย (ก่อนตารางใหม่) ส่งตามเดิม · ที่ส่งแล้วไม่ส่งซ้ำ', () => {
  const sendable = perDay('2026-11-17', { file: 'a.xlsx' });
  const held = perDay('2026-11-18', { file: 'b.xlsx', upload: { notBefore: '2026-11-19' } });
  const skipped = snapshot('2026-11-17T12:00:05+07:00', { file: 'c.xlsx', upload: 'skip' });
  const legacy = snapshot('2026-11-10T12:00:05+07:00', { file: 'd.xlsx' }); // ไม่มี upload = ของเก่า ส่งตามเดิม
  const sent = perDay('2026-11-16', { file: 'e.xlsx', uploaded: { at: 'x', fileId: 'y' } });
  const releasedLater = perDay('2026-11-17', { file: 'f2.xlsx', upload: { notBefore: '2026-11-18' } }); // วันนี้ปลดแล้ว
  assert.deepEqual(selectPendingFiles([sendable, held, skipped, legacy, sent, releasedLater], TODAY).map((f) => f.file), ['a.xlsx', 'd.xlsx', 'f2.xlsx']);
});

test('applyUploadPolicy: ตั้ง/ล้างธงบนรายการที่รอบนี้แตะ · ไม่แตะรายการที่ส่งแล้ว · รอบ 12 ของ D+1 ปลดไฟล์ของ D', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'upload-policy-'));
  const today = perDay('2026-11-18', { file: 'today.xlsx', report: 'postings' });
  const snapNoon = snapshot('2026-11-18T12:00:05+07:00', { file: 'noon.xlsx', report: 'arrivals' });
  const snap23 = snapshot('2026-11-18T23:00:05+07:00', { file: 'n23.xlsx', report: 'arrivals' });
  await recordPublished(folder, [today, snapNoon, snap23], [], new Set(['today.xlsx', 'noon.xlsx', 'n23.xlsx']), '2026-11-18T05:00:00.000Z');
  await recordUploaded(folder, 'today.xlsx', { at: 'x', fileId: 'y' });
  await applyUploadPolicy(folder, ['today.xlsx', 'noon.xlsx', 'n23.xlsx'], '2026-11-18');
  const read = async () => (JSON.parse(await readFile(path.join(folder, RAW_MANIFEST), 'utf8')) as RawManifest).files;
  let files = await read();
  const by = (n: string) => files.find((f) => f.file === n)!;
  assert.equal(by('today.xlsx').upload, undefined); // ส่งแล้ว ไม่แตะ
  assert.equal(by('noon.xlsx').upload, 'skip');
  assert.deepEqual(by('n23.xlsx').upload, { notBefore: '2026-11-19' });
  // วันถัดไป รอบที่แตะไฟล์ n23 อีก (ไบต์เดิม) ได้ธงใหม่ตามวัน — per-day ของเมื่อวานที่ถูกดึงซ้ำถูกปลด
  const d = perDay('2026-11-18', { file: 'd.xlsx', report: 'invoices' });
  await recordPublished(folder, [d], [], new Set(['today.xlsx', 'noon.xlsx', 'n23.xlsx', 'd.xlsx']), '2026-11-18T05:00:00.000Z');
  await applyUploadPolicy(folder, ['d.xlsx'], '2026-11-18');
  files = await read();
  assert.deepEqual(by('d.xlsx').upload, { notBefore: '2026-11-19' });
  await applyUploadPolicy(folder, ['d.xlsx'], '2026-11-19');
  files = await read();
  assert.equal(files.find((f) => f.file === 'd.xlsx')!.upload, undefined);
});
