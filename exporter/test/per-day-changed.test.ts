import assert from 'node:assert/strict';
import { test } from 'node:test';
import { perDayChangedNote, type RawFileEntry, type RawManifest } from '../src/core/raw-manifest.ts';

/** exporter-hoteltime-4h-rounds ticket 09: บรรทัดสรุป "per-day เปลี่ยนจากรอบก่อน" จาก `superseded` ของ manifest (seam 4) */

const was = (report: string, day: string, family: 'per-day' | 'picture' = 'per-day'): RawFileEntry => ({
  file: `${day}__${report}.xlsx`, site: 'hoteltime', report, label: report, family, runKind: 'daily', range: { from: day, to: day }, actualRange: null,
  takenAt: `${day}T08:00:00+07:00`, sheets: [], bytes: 1, sha256: 'aa', source: 'x', filterColumn: 'x', filterNote: 'x',
});
const sup = (entry: RawFileEntry | null, at: string) => ({ file: `_superseded/${at}__x.xlsx`, supersededAt: at, was: entry });
const manifest = (...superseded: ReturnType<typeof sup>[]): RawManifest => ({ version: 1, files: [], superseded });
const SINCE = new Date('2026-11-18T12:00:00+07:00');

test('ไฟล์ per-day ถูกแทนในรอบนี้ → บรรทัดเดียวบอกรายงานกับจำนวนวัน (ไม่มีเนื้อหาไฟล์)', () => {
  const a = manifest(sup(was('postings', '2026-11-17'), '2026-11-18T12:05:00+07:00'), sup(was('arrivals', '2026-11-17'), '2026-11-18T12:06:00+07:00'));
  const b = manifest(sup(was('postings', '2026-11-16'), '2026-11-18T12:07:00+07:00'));
  assert.equal(perDayChangedNote([a, b], SINCE), 'per-day เปลี่ยนจากรอบก่อน: arrivals 1 วัน, postings 2 วัน');
});

test('ไม่มีการเปลี่ยน → ไม่มีบรรทัด · ฉบับที่ถูกแทนก่อนรอบนี้ไม่นับ · snapshot ไม่นับ · was=null ไม่นับ', () => {
  assert.equal(perDayChangedNote([], SINCE), null);
  assert.equal(perDayChangedNote([{ version: 1, files: [] }], SINCE), null);
  const m = manifest(
    sup(was('postings', '2026-11-17'), '2026-11-18T08:05:00+07:00'), // รอบก่อน
    sup(was('arrivals', '2026-11-18', 'picture'), '2026-11-18T12:05:00+07:00'),
    sup(null, '2026-11-18T12:05:00+07:00'),
  );
  assert.equal(perDayChangedNote([m], SINCE), null);
});

test('วันเดียวกันถูกแทนหลายครั้งในรอบเดียวนับเป็น 1 วัน', () => {
  const m = manifest(sup(was('postings', '2026-11-17'), '2026-11-18T12:05:00+07:00'), sup(was('postings', '2026-11-17'), '2026-11-18T12:10:00+07:00'));
  assert.equal(perDayChangedNote([m], SINCE), 'per-day เปลี่ยนจากรอบก่อน: postings 1 วัน');
});
