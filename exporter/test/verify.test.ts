import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDMY, type DateRange } from '../src/core/order.ts';
import { verifyMerged, type ChunkVerdict } from '../src/core/verify.ts';

const R = (a: string, b: string): DateRange => ({ from: parseDMY(a), to: parseDMY(b) });
const sheet = { header: ['a'], rows: [['1']] };
const V = (a: string, b: string, rows = 1): ChunkVerdict => ({
  range: R(a, b), filePath: 'x.xlsx', rowCount: rows, sheet,
  actualSpan: { from: parseDMY(a), to: parseDMY(b) },
});

test('ก้อนที่ปูเต็มช่วงพอดีผ่าน และรวมจำนวนแถวถูกต้อง', () => {
  const got = verifyMerged(
    [V('01/01/2025', '31/01/2025', 10), V('01/02/2025', '28/02/2025', 20)],
    [],
    R('01/01/2025', '28/02/2025'),
  );
  assert.equal(got.totalRows, 30);
  assert.equal(got.coveredChunks, 2);
});

test('ก้อนว่างนับเป็นครอบคลุมด้วย — ช่วงที่ไม่มีข้อมูลจริงไม่ถือว่าขาด', () => {
  const got = verifyMerged(
    [V('01/02/2025', '28/02/2025', 5)],
    [R('01/01/2025', '31/01/2025')],
    R('01/01/2025', '28/02/2025'),
  );
  assert.equal(got.totalRows, 5);
  assert.equal(got.coveredChunks, 2);
});

test('🔴 จับก้อนที่หายไปกลางช่วง', () => {
  assert.throws(
    () => verifyMerged(
      [V('01/01/2025', '31/01/2025'), V('01/03/2025', '31/03/2025')],
      [],
      R('01/01/2025', '31/03/2025'),
    ),
    /มีช่วงที่ไม่ได้ดึง[\s\S]*ขาดไป 28 วัน/,
  );
});

test('🔴 จับก้อนที่ทับกัน', () => {
  assert.throws(
    () => verifyMerged(
      [V('01/01/2025', '20/01/2025'), V('15/01/2025', '31/01/2025')],
      [],
      R('01/01/2025', '31/01/2025'),
    ),
    /ก้อนทับกัน/,
  );
});

test('🔴 จับกรณีที่ก้อนไม่ถึงปลายช่วงที่สั่ง', () => {
  assert.throws(
    () => verifyMerged([V('01/01/2025', '31/01/2025')], [], R('01/01/2025', '28/02/2025')),
    /ไม่ครอบคลุมช่วงที่สั่ง/,
  );
});

test('ก้อนที่ถูกผ่าครึ่งแล้วยังปูเต็มได้ (จำลองการชนเพดานแล้วผ่า)', () => {
  const got = verifyMerged(
    [V('01/01/2025', '16/01/2025', 900), V('17/01/2025', '31/01/2025', 800)],
    [],
    R('01/01/2025', '31/01/2025'),
  );
  assert.equal(got.totalRows, 1700);
});

test('ไม่มีก้อนเลยถือว่าล้มเหลว', () => {
  assert.throws(() => verifyMerged([], [], R('01/01/2025', '31/01/2025')), /ไม่มีก้อนใดถูกดึงเลย/);
});
