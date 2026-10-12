import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utcDate } from '../src/core/order.ts';
import { checkSessionDateRange, parseShowingText } from '../src/sites/foodstory/interactions.ts';

test('แกะข้อความ "Showing X to Y of Z entries" ปกติ (ตัวเลขน้อยกว่าพัน)', () => {
  assert.deepEqual(parseShowingText('Showing 1 to 25 of 217 entries'), { from: 1, to: 25, total: 217 });
});

test('🔴 ตัวเลขที่คั่นด้วย comma หลักพัน (ยืนยันจริง 2026-09-26 — ingredient มี 1,097 แถว)', () => {
  assert.deepEqual(
    parseShowingText('Showing 1 to 25 of 1,097 entries'),
    { from: 1, to: 25, total: 1097 },
  );
});

test('ตัวเลขมี comma มากกว่าหนึ่งตำแหน่ง (หลักล้าน)', () => {
  assert.deepEqual(
    parseShowingText('Showing 1 to 5,000 of 1,234,567 entries'),
    { from: 1, to: 5000, total: 1234567 },
  );
});

test('ผลว่าง (0 of 0) แกะได้ปกติ', () => {
  assert.deepEqual(parseShowingText('Showing 0 to 0 of 0 entries'), { from: 0, to: 0, total: 0 });
});

test('ข้อความอื่นที่ไม่ตรงรูปแบบคืน null ไม่ throw', () => {
  assert.equal(parseShowingText('Processing...'), null);
  assert.equal(parseShowingText(''), null);
});

// ── ช่วงวันที่ระดับ session ที่หน้าแสดง (diagnose 2026-09-28 — session ถูกเขียนทับย้อนหลังได้) ──
// sweep 48 หน้า: ทุกหน้ามี input[name="daterange"] อย่างน้อยหนึ่งช่อง (#dateranges ที่มองเห็น
// หรือ #calendar ที่ซ่อน) และค่าตรงกับช่วงของ session เสมอ

const AUG_2026 = { from: utcDate(2026, 8, 1), to: utcDate(2026, 8, 31) };

test('ทุกช่อง daterange ตรงช่วงที่คาด → ผ่าน (null)', () => {
  assert.equal(checkSessionDateRange(['01/08/2026 - 31/08/2026', '01/08/2026 - 31/08/2026'], AUG_2026), null);
});

test('🔴 ช่องใดช่องหนึ่งย้อนเป็นวันนี้ (session ถูกเขียนทับ) → คืนข้อความที่บอกค่าจริง', () => {
  const msg = checkSessionDateRange(['28/09/2026 - 28/09/2026', '01/08/2026 - 31/08/2026'], AUG_2026);
  assert.ok(msg);
  assert.match(msg, /28\/09\/2026 - 28\/09\/2026/);
  assert.match(msg, /01\/08\/2026 - 31\/08\/2026/);
});

test('ไม่มีช่อง daterange เลย (เว็บเปลี่ยน) → ไม่ถือว่าผ่าน', () => {
  assert.ok(checkSessionDateRange([], AUG_2026));
});
