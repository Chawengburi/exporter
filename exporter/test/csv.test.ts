import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOM, parseCsv } from '../src/core/csv.ts';

test('อ่านช่องที่มีอักขระพิเศษในเครื่องหมายคำพูด รวมถึงขึ้นบรรทัดในช่อง', () => {
  const text = `${BOM}Reservation number,Guest,Reserved:\r\n` +
    '603203966,"DECHA KANOKLAK, TODOROV TONI",01/09/2026\r\n' +
    '603212749,"ชื่อ ""ในเครื่องหมาย""",03/09/2026\r\n' +
    '603212750,"บรรทัด\r\nที่สอง",04/09/2026\r\n' +
    '603212751,,\r\n';
  assert.deepEqual(parseCsv(text), [
    ['Reservation number', 'Guest', 'Reserved:'],
    ['603203966', 'DECHA KANOKLAK, TODOROV TONI', '01/09/2026'],
    ['603212749', 'ชื่อ "ในเครื่องหมาย"', '03/09/2026'],
    ['603212750', 'บรรทัด\r\nที่สอง', '04/09/2026'],
    ['603212751', '', ''],
  ]);
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

test('ตารางว่าง (มีแต่หัว) อ่านได้', () => {
  assert.deepEqual(parseCsv(`${BOM}a,b\r\n`), [['a', 'b']]);
});
