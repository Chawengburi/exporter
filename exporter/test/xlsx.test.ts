import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { makeWorkbook, makeXlsx, sheetXml, tmpPath } from './_xlsx-fixture.ts';
import {
  columnIndex,
  excelSerialToDate,
  findColumn,
  parseCellDate,
  readSheets,
  readSheetNames,
  readWorkbook,
  requireColumn,
} from '../src/core/xlsx.ts';

test('columnIndex แปลงอ้างอิงเซลล์เป็นดัชนีคอลัมน์', () => {
  assert.equal(columnIndex('A1'), 0);
  assert.equal(columnIndex('B2'), 1);
  assert.equal(columnIndex('Z10'), 25);
  assert.equal(columnIndex('AA1'), 26);
  assert.equal(columnIndex('AB100'), 27);
  assert.throws(() => columnIndex('1A'));
});

test('🔴 เซลล์ว่างที่ถูกตัดออกไม่ทำให้ค่าเลื่อนคอลัมน์', () => {
  // header 4 ช่อง · แถวข้อมูลเขียนเฉพาะ A กับ D — B, C หายไปจาก XML
  const p = makeXlsx('sparse.xlsx',
    `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
      <row r="2"><c r="A2"><v>111</v></c><c r="D2"><v>444</v></c></row>
    </sheetData></worksheet>`,
    { shared: ['ID', 'Reserved:', 'Group name', 'Arrival'] });

  const s = readSheets(p)[0]!;
  assert.deepEqual([...s.header], ['ID', 'Reserved:', 'Group name', 'Arrival']);
  // ถ้าอ่านตามลำดับที่เจอ จะได้ ['111','444','',''] ซึ่งผิด
  assert.deepEqual([...s.rows[0]!], ['111', '', '', '444']);
});

test('styles.xml ที่ผิดสเปกต้องไม่ทำให้อ่านไม่ได้ (openpyxl ล้มตรงนี้)', () => {
  const p = makeXlsx('badstyles.xlsx',
    `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c></row>
      <row r="2"><c r="A2"><v>1</v></c></row>
    </sheetData></worksheet>`,
    { shared: ['Col'], styles: '<styleSheet><alignment vertical="ไม่มีค่านี้ใน enum"/></styleSheet>' });
  assert.deepEqual([...readSheets(p)[0]!.header], ['Col']);
});

test('รองรับ inline string และ entity ที่ถูก escape', () => {
  const p = makeXlsx('inline.xlsx',
    `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>A &amp; B</t></is></c><c r="B1" t="inlineStr"><is><t>&lt;tag&gt;</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>ห้อง 101</t></is></c></row>
    </sheetData></worksheet>`);
  const s = readSheets(p)[0]!;
  assert.deepEqual([...s.header], ['A & B', '<tag>']);
  assert.deepEqual([...s.rows[0]!], ['ห้อง 101', '']);
});

test('rich text ที่แตกเป็นหลาย run ถูกต่อกลับเป็นข้อความเดียว', () => {
  // makeXlsx เขียน <si><t> ชั้นเดียว จึงส่ง sharedStrings.xml แบบ rich text เองสำหรับเคสนี้
  const p = makeXlsx('rich.xlsx',
    `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`,
    { sharedXml: `<sst><si><r><t>Reserv</t></r><r><t>ation</t></r></si></sst>` });
  assert.deepEqual([...readSheets(p)[0]!.header], ['Reservation']);
});

test('ชื่อคอลัมน์ซ้ำ — findColumn คืนตัวแรก (ไฟล์จริงมี Reservation number สองที่)', () => {
  const p = makeXlsx('dup.xlsx',
    `<worksheet><sheetData><row r="1">
      <c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>0</v></c>
    </row><row r="2"><c r="A2"><v>1</v></c></row></sheetData></worksheet>`,
    { shared: ['Reservation number', 'Reserved:'] });
  const s = readSheets(p)[0]!;
  assert.equal(findColumn(s, 'Reservation number'), 0);
  assert.equal(requireColumn(s, 'Reserved:'), 1);
});

test('requireColumn ล้มพร้อมบอกว่ามีคอลัมน์อะไรบ้าง', () => {
  const p = makeXlsx('missing.xlsx',
    `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2"><v>1</v></c></row></sheetData></worksheet>`,
    { shared: ['Something else'] });
  assert.throws(() => requireColumn(readSheets(p)[0]!, 'Reserved:'), /ไม่พบคอลัมน์ "Reserved:"[\s\S]*Something else/);
});

test('ไฟล์ที่ไม่ใช่ zip ล้มพร้อมข้อความที่บอกวิธีตรวจ', () => {
  const p = tmpPath('notzip.xlsx');
  writeFileSync(p, '<html>Sorry, an error occurred</html>');
  assert.throws(() => readSheets(p)[0]!, /แตกไฟล์ xlsx ไม่สำเร็จ[\s\S]*magic bytes/);
});

test('🔴 readWorkbook ไม่ตัดข้อมูลทิ้งเมื่อแถวแรกแคบกว่าแถวหลัง (รูปแบบไฟล์ของ FoodStory)', () => {
  // รูปทรงจำลองแบบเดียวกับที่เจอจริงใน salebysumdate (ดู test/foodstory-xlsx.test.ts สำหรับ
  // ไฟล์จริงที่ยืนยันแล้วครบทั้ง 17 คอลัมน์) — ที่นี่ตั้งใจย่อคอลัมน์ให้อ่านง่าย เพราะจุดที่ต้อง
  // พิสูจน์คือกลไก "แถวแรกแคบกว่าแถวหลังต้องไม่ถูกตัด" ไม่ใช่ความถูกต้องของชื่อคอลัมน์จริง
  const p = makeXlsx('foodstory-shape.xlsx',
    `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>รายงานสรุปยอดขายแยกตามวัน</t></is></c></row>
      <row r="2">
        <c r="A2" t="inlineStr"><is><t>วันที่</t></is></c>
        <c r="B2" t="inlineStr"><is><t>ยอดรวม</t></is></c>
        <c r="C2" t="inlineStr"><is><t>สาขา</t></is></c>
      </row>
      <row r="3">
        <c r="A3" t="inlineStr"><is><t>23/09/2026</t></is></c>
        <c r="B3"><v>7530</v></c>
        <c r="C3" t="inlineStr"><is><t>Chaweng Buri Resort</t></is></c>
      </row>
      <row r="4">
        <c r="A4" t="inlineStr"><is><t>Total</t></is></c>
        <c r="B4"><v>7530</v></c>
      </row>
    </sheetData></worksheet>`);

  const rows = readWorkbook(p)[0]!.rows;
  assert.equal(rows.length, 4);
  assert.deepEqual([...rows[0]!], ['รายงานสรุปยอดขายแยกตามวัน', '', '']);
  assert.deepEqual([...rows[1]!], ['วันที่', 'ยอดรวม', 'สาขา']);
  assert.deepEqual([...rows[2]!], ['23/09/2026', '7530', 'Chaweng Buri Resort']);
  assert.deepEqual([...rows[3]!], ['Total', '7530', '']);
});

test('🔴 readWorkbook คืนทุกชีตตามลำดับใน workbook พร้อมชื่อชีต (ไม่ใช่แค่ชีตแรก ไม่เดาลำดับจากชื่อไฟล์)', () => {
  // รูปเดียวกับ occupancy-by-nationality-stay-reason จริง: หนึ่งชีตต่อกลุ่มเหตุผลการเข้าพัก หัวตารางเดียวกัน
  const p = makeWorkbook('groups.xlsx', [
    { name: 'No group', file: 'sheet2.xml', xml: sheetXml([['Nationality', 'Nights'], ['Thailand', '3']]) },
    { name: 'LEI - Leisure', file: 'sheet1.xml', xml: sheetXml([['Nationality', 'Nights'], ['Poland', '5'], ['USA', '2']]) },
  ]);

  const sheets = readWorkbook(p);

  assert.deepEqual(sheets.map((s) => s.name), ['No group', 'LEI - Leisure']);
  assert.deepEqual(sheets[0]!.rows.map((r) => [...r]), [['Nationality', 'Nights'], ['Thailand', '3']]);
  assert.deepEqual(sheets[1]!.rows.map((r) => [...r]), [['Nationality', 'Nights'], ['Poland', '5'], ['USA', '2']]);
  assert.deepEqual(readSheetNames(p), ['No group', 'LEI - Leisure']);
});

test('ชีตที่ไม่มีแถวเลยได้ header และแถวว่าง — ตัวอ่านไม่ตัดสินว่าทั้งไฟล์ว่าง (ด่านตรวจของแต่ละ Site ตัดสิน)', () => {
  const p = makeXlsx('empty.xlsx', `<worksheet><sheetData></sheetData></worksheet>`);
  const [s] = readSheets(p);
  assert.deepEqual([...s!.header], []);
  assert.equal(s!.rows.length, 0);
});

test('🔴 Excel serial แปลงเป็นวันที่ถูกต้อง (ใบ RateCode เก็บวันที่แบบนี้)', () => {
  // ค่าจริงที่วัดมาจาก ratecode-revenue.xlsx เมื่อสั่ง created 01/01/2025-31/12/2025
  assert.equal(excelSerialToDate(45658).toISOString().slice(0, 10), '2025-01-01');
  assert.equal(excelSerialToDate(46022).toISOString().slice(0, 10), '2025-12-31');
  assert.equal(excelSerialToDate(1).toISOString().slice(0, 10), '1899-12-31');
  assert.throws(() => excelSerialToDate(0));
  assert.throws(() => excelSerialToDate(Number.NaN));
});

test('🔴 เศษเวลาต้องถูกตัดทิ้ง ไม่ใช่ปัดขึ้น (บั๊กที่ชั้นตรวจจับได้ 2026-09-08)', () => {
  // ค่าจริงจากคอลัมน์ Cancelled: 46142.757265625 = 30/04/2026 18:10
  // ถ้าปัดเศษจะกลายเป็น 01/05/2026 ซึ่งหลุดออกนอกช่วงที่สั่ง
  assert.equal(excelSerialToDate(46142.757265625).toISOString().slice(0, 10), '2026-04-30');
  assert.equal(excelSerialToDate(46140.9100576389).toISOString().slice(0, 10), '2026-04-28');
  assert.equal(excelSerialToDate(46141.2781521643).toISOString().slice(0, 10), '2026-04-29');
  // เที่ยงตรงพอดีก็ยังต้องเป็นวันเดิม
  assert.equal(excelSerialToDate(45658.5).toISOString().slice(0, 10), '2025-01-01');
  assert.equal(excelSerialToDate(45658.9999).toISOString().slice(0, 10), '2025-01-01');
});

test('parseCellDate รองรับทั้งข้อความ DD/MM/YYYY และ serial', () => {
  assert.equal(parseCellDate('01/09/2026')!.toISOString().slice(0, 10), '2026-09-01');
  assert.equal(parseCellDate('45658')!.toISOString().slice(0, 10), '2025-01-01');
  assert.equal(parseCellDate('46142.757265625')!.toISOString().slice(0, 10), '2026-04-30');
  assert.equal(parseCellDate('  '), null);
  assert.equal(parseCellDate(''), null);
  assert.throws(() => parseCellDate('ไม่ใช่วันที่'));
  assert.throws(() => parseCellDate('2025-01-01'));
});

test('ชีตใหญ่ระดับ baseline (หลายหมื่นแถว) อ่านได้ ไม่ stack overflow', () => {
  // เจอจริง 2026-10-07: --baseline ของ reservations-ratecode (~9,700 แถว × หลายคอลัมน์) ล้มด้วย
  // "Maximum call stack size exceeded" เพราะเคยหาความกว้างด้วย Math.max(...ทุกเซลล์)
  const rows = Array.from({ length: 30_000 }, (_, r) =>
    `<row r="${r + 1}">${['A', 'B', 'C', 'D', 'E', 'F'].map((c) => `<c r="${c}${r + 1}" t="inlineStr"><is><t>x</t></is></c>`).join('')}</row>`,
  ).join('');
  const p = makeXlsx('big.xlsx', `<worksheet><sheetData>${rows}</sheetData></worksheet>`);
  const out = readWorkbook(p)[0]!.rows;
  assert.equal(out.length, 30_000);
  assert.equal(out[0]!.length, 6);
});

test('parseCellDate รับ DD.MM.YY ของ Housekeeping all-in-one และถือ "---" (ไม่มีค่า) เป็นช่องว่าง', () => {
  assert.equal(parseCellDate('07.10.26')?.toISOString(), '2026-10-07T00:00:00.000Z');
  assert.equal(parseCellDate('31.12.2025')?.toISOString(), '2025-12-31T00:00:00.000Z');
  assert.equal(parseCellDate('---'), null);
  assert.throws(() => parseCellDate('7/10/26'));
});
