import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ROW_CAP,
  assertContiguous,
  formatDMY,
  formatISO,
  groupByYear,
  monthChunks,
  parseDMY,
  spanOf,
  splitRange,
  utcDate,
} from '../src/core/order.ts';

const R = (a: string, b: string) => ({ from: parseDMY(a), to: parseDMY(b) });
const show = (rs: { from: Date; to: Date }[]) => rs.map((r) => `${formatDMY(r.from)}-${formatDMY(r.to)}`);

test('เพดานของ HotelTime คือ 2000', () => {
  assert.equal(ROW_CAP, 2000);
});

test('formatDMY / parseDMY ไป-กลับได้ค่าเดิม', () => {
  assert.equal(formatDMY(utcDate(2024, 1, 5)), '05/01/2024');
  assert.equal(formatDMY(parseDMY('23/05/2024')), '23/05/2024');
  assert.equal(formatISO(parseDMY('23/05/2024')), '2024-05-23');
});

test('parseDMY ปฏิเสธรูปแบบผิดและวันที่ที่ไม่มีอยู่จริง', () => {
  assert.throws(() => parseDMY('2024-05-23'));
  assert.throws(() => parseDMY('5/1/2024'));
  assert.throws(() => parseDMY('31/02/2024'));
});

test('ซอยช่วงเต็มเป็นก้อนรายเดือน ตัดหัวท้ายให้พอดีกับที่ขอ', () => {
  const chunks = monthChunks(R('15/01/2024', '10/03/2024'));
  assert.deepEqual(show(chunks), [
    '15/01/2024-31/01/2024',
    '01/02/2024-29/02/2024', // 2024 เป็นปีอธิกสุรทิน
    '01/03/2024-10/03/2024',
  ]);
});

test('ช่วงที่อยู่ในเดือนเดียวได้ก้อนเดียว', () => {
  assert.deepEqual(show(monthChunks(R('03/09/2026', '08/09/2026'))), ['03/09/2026-08/09/2026']);
});

test('ก้อนรายเดือนไม่มีทางคร่อมปี', () => {
  const chunks = monthChunks(R('01/12/2025', '31/01/2026'));
  assert.deepEqual(show(chunks), ['01/12/2025-31/12/2025', '01/01/2026-31/01/2026']);
  for (const c of chunks) assert.equal(c.from.getUTCFullYear(), c.to.getUTCFullYear());
});

test('ช่วงจริงของโปรเจกต์ 01/01/2024 ถึง 08/09/2026 ได้ 33 ก้อน ต่อกันสนิท', () => {
  const want = R('01/01/2024', '08/09/2026');
  const chunks = monthChunks(want);
  assert.equal(chunks.length, 33);
  assertContiguous(chunks, want);
});

test('ช่วงกลับหัวถูกปฏิเสธ', () => {
  assert.throws(() => monthChunks(R('01/03/2024', '01/01/2024')));
});

test('splitRange ผ่าครึ่งได้ช่วงที่ต่อกันสนิท', () => {
  const [a, b] = splitRange(R('01/01/2025', '31/01/2025'))!;
  assert.deepEqual(show([a, b]), ['01/01/2025-16/01/2025', '17/01/2025-31/01/2025']);
  assertContiguous([a, b], R('01/01/2025', '31/01/2025'));
});

test('splitRange คืน null เมื่อเหลือวันเดียว — ผ่าต่อไม่ได้', () => {
  assert.equal(splitRange(R('05/05/2025', '05/05/2025')), null);
});

test('splitRange ผ่าสองวันได้วันละก้อน', () => {
  assert.deepEqual(show(splitRange(R('05/05/2025', '06/05/2025'))!), [
    '05/05/2025-05/05/2025',
    '06/05/2025-06/05/2025',
  ]);
});

test('groupByYear จัดก้อนเป็นรายปีสำหรับไฟล์ผลลัพธ์', () => {
  const g = groupByYear(monthChunks(R('01/11/2024', '15/02/2026')));
  assert.deepEqual([...g.keys()], [2024, 2025, 2026]);
  assert.equal(g.get(2024)!.length, 2);
  assert.equal(g.get(2025)!.length, 12);
  assert.equal(g.get(2026)!.length, 2);
});

test('spanOf คืนช่วงที่ครอบทุกก้อน', () => {
  const s = spanOf(monthChunks(R('15/01/2024', '10/03/2024')));
  assert.equal(formatDMY(s.from), '15/01/2024');
  assert.equal(formatDMY(s.to), '10/03/2024');
});

test('assertContiguous จับรูที่หายไประหว่างก้อน', () => {
  const chunks = monthChunks(R('01/01/2025', '31/03/2025'));
  const missingMiddle = [chunks[0]!, chunks[2]!];
  assert.throws(() => assertContiguous(missingMiddle, R('01/01/2025', '31/03/2025')), /มีรูระหว่างก้อน/);
});

test('assertContiguous จับก้อนที่ทับกัน', () => {
  assert.throws(
    () => assertContiguous([R('01/01/2025', '20/01/2025'), R('15/01/2025', '31/01/2025')], R('01/01/2025', '31/01/2025')),
    /ทับกัน/,
  );
});

test('assertContiguous จับกรณีก้อนไม่ครอบคลุมปลายช่วงที่สั่ง', () => {
  const chunks = monthChunks(R('01/01/2025', '31/03/2025'));
  assert.throws(() => assertContiguous(chunks.slice(0, 2), R('01/01/2025', '31/03/2025')), /ก้อนสุดท้ายจบที่/);
  assert.throws(() => assertContiguous(chunks.slice(1), R('01/01/2025', '31/03/2025')), /ก้อนแรกเริ่มที่/);
});

test('ก้อนที่ผ่าครึ่งแล้วยังต่อกันสนิทกับก้อนข้างเคียง', () => {
  // จำลองสถานการณ์จริง: เดือน ม.ค. ชนเพดาน เลยผ่าครึ่ง แล้วเอาไปต่อกับเดือนอื่น
  const all = monthChunks(R('01/01/2025', '28/02/2025'));
  const [a, b] = splitRange(all[0]!)!;
  assertContiguous([a, b, all[1]!], R('01/01/2025', '28/02/2025'));
});
