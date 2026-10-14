import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utcDate } from '../src/core/order.ts';
import { findReport } from '../src/sites/hoteltime/reports/index.ts';
import { verifyChunk } from '../src/sites/hoteltime/verify.ts';
import { makeWorkbook, sheetXml } from './_xlsx-fixture.ts';

/**
 * ด่านตรวจของ HotelTime กับ workbook หลายชีต (ticket 01 ของ exporter-daily-per-day-raw) — เดิมอ่านแค่ชีตแรก
 * ชีตที่เหลือจึงไม่เคยถูกนับหรือตรวจ · ไฟล์จริงที่เป็นแบบนี้: occupancy-by-nationality-stay-reason (หนึ่งชีตต่อกลุ่ม)
 */

const OCT = { from: utcDate(2026, 10, 1), to: utcDate(2026, 10, 13) };
const stayReason = findReport('occupancy-by-nationality-stay-reason')!;
const HEADER = [...stayReason.expectedColumns];
const row = (nat: string) => [nat, '1', '2', '3', '4', '3', '10%'];

test('🔴 นับแถวรวมทุกชีต และ verdict บอกชื่อชีตครบ (เดิมนับแค่ชีตแรก)', () => {
  const p = makeWorkbook('stay-reason.xlsx', [
    { name: 'No group', file: 'sheet1.xml', xml: sheetXml([HEADER, row('Thailand')]) },
    { name: 'LEI - Leisure', file: 'sheet2.xml', xml: sheetXml([HEADER, row('Poland'), row('USA')]) },
  ]);

  const verdict = verifyChunk(stayReason, OCT, p, null);

  assert.equal(verdict.rowCount, 3);
  assert.deepEqual(verdict.sheets.map((s) => s.name), ['No group', 'LEI - Leisure']);
  assert.deepEqual(verdict.sheets.map((s) => s.rows.length), [1, 2]);
});

test('🔴 ชีตที่สองหัวตารางไม่ตรง — ล้มพร้อมบอกชื่อชีต (เดิมไม่เคยถูกเปิดดูเลย)', () => {
  const p = makeWorkbook('stay-reason-bad.xlsx', [
    { name: 'No group', file: 'sheet1.xml', xml: sheetXml([HEADER, row('Thailand')]) },
    { name: 'LEI - Leisure', file: 'sheet2.xml', xml: sheetXml([['Nationality', 'Something else'], ['Poland', '5']]) },
  ]);
  assert.throws(() => verifyChunk(stayReason, OCT, p, null), /หัวตารางไม่ตรง[\s\S]*ชีต "LEI - Leisure"/);
});

test('ชีตที่ไม่มีแถวเลยไม่ทำให้ด่านล้ม แต่ยังอยู่ในรายชื่อชีต', () => {
  const p = makeWorkbook('stay-reason-empty-tab.xlsx', [
    { name: 'No group', file: 'sheet1.xml', xml: sheetXml([HEADER, row('Thailand')]) },
    { name: 'BUS - Business', file: 'sheet2.xml', xml: '<worksheet><sheetData></sheetData></worksheet>' },
  ]);
  const verdict = verifyChunk(stayReason, OCT, p, null);
  assert.equal(verdict.rowCount, 1);
  assert.deepEqual(verdict.sheets.map((s) => s.name), ['No group', 'BUS - Business']);
});

test('ทุกชีตไม่มีแถวเลย = ไฟล์ว่าง ล้มดัง ๆ', () => {
  const p = makeWorkbook('all-empty.xlsx', [
    { name: 'A', file: 'sheet1.xml', xml: '<worksheet><sheetData></sheetData></worksheet>' },
    { name: 'B', file: 'sheet2.xml', xml: '<worksheet><sheetData></sheetData></worksheet>' },
  ]);
  assert.throws(() => verifyChunk(stayReason, OCT, p, null), /ไม่พบแถวใดเลย/);
});

// ledger ที่มีด่านช่วงวันและเพดานแถว — ย่อคอลัมน์ให้เหลือสองช่องเพื่อให้อ่านง่าย (สิ่งที่พิสูจน์คือ "ตรวจทุกชีต")
const ledger = { ...findReport('reservations-search')!, expectedColumns: ['Reserved:', 'Guest'], dateColumns: ['Reserved:'] };
const DAY = { from: utcDate(2026, 10, 12), to: utcDate(2026, 10, 12) };

test('🔴 ด่านช่วงวันตรวจแถวของทุกชีต — วันที่หลุดช่วงอยู่ในชีตที่สองก็ต้องจับได้', () => {
  const p = makeWorkbook('ledger-two-tabs.xlsx', [
    { name: 'Sheet1', file: 'sheet1.xml', xml: sheetXml([['Reserved:', 'Guest'], ['12/10/2026', 'a']]) },
    { name: 'Sheet2', file: 'sheet2.xml', xml: sheetXml([['Reserved:', 'Guest'], ['14/10/2026', 'b']]) },
  ]);
  assert.throws(() => verifyChunk(ledger, DAY, p, null), /ช่วงวันที่ในไฟล์หลุดออกนอกที่สั่ง[\s\S]*14\/10\/2026/);
});

test('🔴 เพดานแถวนับรวมทุกชีต — 1,000 + 1,000 = 2,000 คือชนเพดาน', () => {
  const rows = (n: number) => Array.from({ length: n }, () => ['12/10/2026', 'x']);
  const p = makeWorkbook('ledger-cap.xlsx', [
    { name: 'Sheet1', file: 'sheet1.xml', xml: sheetXml([['Reserved:', 'Guest'], ...rows(1000)]) },
    { name: 'Sheet2', file: 'sheet2.xml', xml: sheetXml([['Reserved:', 'Guest'], ...rows(1000)]) },
  ]);
  assert.throws(() => verifyChunk(ledger, DAY, p, null), (err: Error) => err.name === 'RowCapError');
});

// ── รายงานที่คอลัมน์ท้ายเปลี่ยนตามข้อมูล (ใบ 05: ภาพปิดงวดปี 2025 ของ reservation-stats-segment) ──
// หัวตารางคือชื่อ segment ที่มีการจองในช่วงนั้น — ปี 2025 กับ 2026 มีคนละชุด จึงตรวจแค่คอลัมน์นำที่คงที่
const segment = findReport('reservation-stats-segment')!;
const YEAR_2025 = { from: utcDate(2025, 1, 1), to: utcDate(2025, 12, 31) };

test('🔴 คอลัมน์ segment ต่างปีกันได้ — ตรวจแค่คอลัมน์นำที่คงที่ ไม่ล้มเพราะปีก่อนมี segment คนละชุด', () => {
  const p = makeWorkbook('segment-2025.xlsx', [{
    name: 'Sheet1', file: 'sheet1.xml',
    xml: sheetXml([['Region', '&nbsp;', 'F.I.T. - Longstay', 'OTA', 'F.I.T. - Package'], ['Europe', 'Germany', '3', '5', '1']]),
  }]);
  assert.equal(verifyChunk(segment, YEAR_2025, p, null).rowCount, 1);
});

test('🔴 คอลัมน์นำผิด = รายงานเปลี่ยนจริง ยังล้มดัง ๆ', () => {
  const p = makeWorkbook('segment-bad.xlsx', [{
    name: 'Sheet1', file: 'sheet1.xml', xml: sheetXml([['Country', '&nbsp;', 'OTA'], ['Europe', 'Germany', '5']]),
  }]);
  assert.throws(() => verifyChunk(segment, YEAR_2025, p, null), /หัวตารางไม่ตรง/);
});

test('คอลัมน์นำถูกแต่ไม่มีคอลัมน์ segment เลย = ไม่ใช่รายงานที่ตั้งใจ ล้มดัง ๆ', () => {
  const p = makeWorkbook('segment-empty-cols.xlsx', [{
    name: 'Sheet1', file: 'sheet1.xml', xml: sheetXml([['Region', '&nbsp;'], ['Europe', 'Germany']]),
  }]);
  assert.throws(() => verifyChunk(segment, YEAR_2025, p, null), /หัวตารางไม่ตรง/);
});
