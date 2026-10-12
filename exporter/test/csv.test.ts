import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOM, parseCsv, toCsv } from '../src/core/csv.ts';

test('เขียน CSV พื้นฐาน พร้อม BOM และ CRLF', () => {
  const out = toCsv(['a', 'b'], [['1', '2']]);
  assert.equal(out, `${BOM}a,b\r\n1,2\r\n`);
});

test('ปิด BOM ได้เมื่อไม่ต้องการ', () => {
  assert.equal(toCsv(['a'], [['1']], { bom: false }), 'a\r\n1\r\n');
});

test('ใส่เครื่องหมายคำพูดเฉพาะช่องที่จำเป็น', () => {
  const out = toCsv(['x'], [['ไม่มีอะไรพิเศษ'], ['มี,คอมมา'], ['มี"คำพูด'], ['มี\nขึ้นบรรทัด']]);
  const lines = out.slice(1).split('\r\n');
  assert.equal(lines[1], 'ไม่มีอะไรพิเศษ');
  assert.equal(lines[2], '"มี,คอมมา"');
  assert.equal(lines[3], '"มี""คำพูด"');
  assert.ok(out.includes('"มี\nขึ้นบรรทัด"'));
});

test('🔴 ปฏิเสธการเขียนเมื่อจำนวนช่องไม่ตรงกับหัวตาราง', () => {
  assert.throws(() => toCsv(['a', 'b', 'c'], [['1', '2']]), /คอลัมน์เลื่อน/);
});

test('ไป-กลับได้ค่าเดิม รวมถึงช่องที่มีอักขระพิเศษ', () => {
  const header = ['Reservation number', 'Guest', 'Reserved:'];
  const rows = [
    ['603203966', 'DECHA KANOKLAK, TODOROV TONI', '01/09/2026'],
    ['603212749', 'ชื่อ "ในเครื่องหมาย"', '03/09/2026'],
    ['603212750', 'บรรทัด\r\nที่สอง', '04/09/2026'],
    ['603212751', '', ''],
  ];
  // ขึ้นบรรทัดที่อยู่ในเครื่องหมายคำพูดถูกเก็บไว้ตามเดิม ไม่ถูกแปลง
  const parsed = parseCsv(toCsv(header, rows));
  assert.deepEqual(parsed[0], header);
  assert.deepEqual(parsed.slice(1), rows);
});

test('parseCsv ข้าม BOM ให้เอง', () => {
  assert.deepEqual(parseCsv(`${BOM}a,b\r\n1,2\r\n`), [['a', 'b'], ['1', '2']]);
});

test('parseCsv รองรับไฟล์ที่ใช้ LF ล้วน', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('parseCsv ล้มเมื่อไฟล์ขาดกลางเครื่องหมายคำพูด', () => {
  assert.throws(() => parseCsv('a,b\r\n"ยังไม่ปิด,2\r\n'), /ไม่ครบ/);
});

test('ตารางว่าง (มีแต่หัว) เขียนได้', () => {
  assert.deepEqual(parseCsv(toCsv(['a', 'b'], [])), [['a', 'b']]);
});
