import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareManifestFiles, type ManifestFileEntry } from '../src/core/verify.ts';

const F = (file: string, rows: number, sha256: string): ManifestFileEntry => ({ file, rows, sha256 });

test('สองรอบเหมือนกันเป๊ะ — ทุกก้อนเป็น unchanged', () => {
  const oldFiles = [F('2026-08-01_2026-08-31.xlsx', 308, 'aaa')];
  const newFiles = [F('2026-08-01_2026-08-31.xlsx', 308, 'aaa')];
  const drift = compareManifestFiles(oldFiles, newFiles);
  assert.deepEqual(drift, [{ kind: 'unchanged', file: '2026-08-01_2026-08-31.xlsx' }]);
});

test('ก้อนที่ลายนิ้วมือต่าง — เป็น changed พร้อมค่าทั้งเก่าและใหม่', () => {
  const oldFiles = [F('2026-08-01_2026-08-31.xlsx', 308, 'aaa')];
  const newFiles = [F('2026-08-01_2026-08-31.xlsx', 290, 'bbb')];
  const drift = compareManifestFiles(oldFiles, newFiles);
  assert.deepEqual(drift, [{
    kind: 'changed',
    file: '2026-08-01_2026-08-31.xlsx',
    oldRows: 308,
    newRows: 290,
    oldSha256: 'aaa',
    newSha256: 'bbb',
  }]);
});

test('ก้อนที่หายไปในรอบใหม่ — เป็น missing', () => {
  const oldFiles = [F('2026-09-01_2026-09-08.xlsx', 75, 'ccc')];
  const newFiles: ManifestFileEntry[] = [];
  const drift = compareManifestFiles(oldFiles, newFiles);
  assert.deepEqual(drift, [{ kind: 'missing', file: '2026-09-01_2026-09-08.xlsx', oldRows: 75 }]);
});

test('ก้อนที่เพิ่มมาใหม่ — เป็น added', () => {
  const oldFiles: ManifestFileEntry[] = [];
  const newFiles = [F('2026-09-01_2026-09-17.xlsx', 120, 'ddd')];
  const drift = compareManifestFiles(oldFiles, newFiles);
  assert.deepEqual(drift, [{ kind: 'added', file: '2026-09-01_2026-09-17.xlsx', newRows: 120 }]);
});

test('ผสมกันทั้งสี่แบบในการเทียบครั้งเดียว', () => {
  const oldFiles = [
    F('same.xlsx', 10, 'x'),
    F('changed.xlsx', 20, 'x'),
    F('gone.xlsx', 30, 'x'),
  ];
  const newFiles = [
    F('same.xlsx', 10, 'x'),
    F('changed.xlsx', 25, 'y'),
    F('new.xlsx', 5, 'z'),
  ];
  const drift = compareManifestFiles(oldFiles, newFiles);
  const byFile = new Map(drift.map((d) => [d.file, d.kind]));
  assert.equal(byFile.get('same.xlsx'), 'unchanged');
  assert.equal(byFile.get('changed.xlsx'), 'changed');
  assert.equal(byFile.get('gone.xlsx'), 'missing');
  assert.equal(byFile.get('new.xlsx'), 'added');
  assert.equal(drift.length, 4);
});
