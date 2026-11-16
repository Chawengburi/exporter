import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utcDate } from '../src/core/order.ts';
import { documentTypeFor } from '../src/core/uploader.ts';
import { findReport } from '../src/sites/hoteltime/reports/index.ts';
import { verifyChunk } from '../src/sites/hoteltime/verify.ts';
import { makeWorkbook, sheetXml } from './_xlsx-fixture.ts';

/**
 * vat-inspection (ticket 04 ของ exporter-hoteltime-gold-feed) — ข้อมูลสังเคราะห์ทั้งหมด ไม่ใช้ไฟล์จริงที่มีข้อมูลส่วนบุคคล
 * รูปไฟล์เทียบกับไฟล์จริงที่ recon สดเมื่อ 2026-11-16: สองชีต `a4` (ว่าง) กับ `a5` (ข้อมูล) · แกนวันที่ของฟอร์ม = Tax effective day
 */
const OCT = { from: utcDate(2026, 10, 1), to: utcDate(2026, 10, 31) };
const report = findReport('vat-inspection')!;
const HEADER = [...report.expectedColumns];
const row = (n: number, invoice: string, day: string, with7 = true) =>
  [invoice, `Customer ${n}`, '', day, '100.00', '84.89', '15.11', with7 ? '10.00' : '', with7 ? '0.70' : ''];

test('ลงทะเบียนเป็นรายงานตามวัน รายเดือน หัวตาราง 9 คอลัมน์ตามที่ Silver ของ hoteltime-schema รอ · document type ไม่ต้องมีข้อยกเว้น', () => {
  assert.equal(report.family, 'per-day');
  assert.equal(report.dailyOnly, false);
  assert.equal(report.chunk.kind, 'monthly');
  assert.equal(report.dateColumn, 'Tax effective day');
  assert.equal(report.path, 'invoices/AccontancyInvoiceReport.aspx');
  assert.deepEqual(report.expectedColumns, [
    'Invoice number', 'Customer', 'Tax ID', 'Tax effective day', 'Total in invoice currency',
    'VAT base 17.7%', 'VAT 17.7%', 'VAT base 7%', 'VAT 7%',
  ]);
  assert.ok(report.allowedControls.every((c) => c.startsWith('ctl00$pc$')), 'ปุ่ม/ช่องที่อนุญาตต้องอยู่ใน panel ของฟอร์มเท่านั้น');
  assert.equal(documentTypeFor('hoteltime', 'vat-inspection'), 'hoteltime_vat_inspection');
});

test('ไฟล์สองชีตแบบของจริง (a4 ว่าง + a5 ข้อมูล) ผ่านด่านตรวจ: นับแถวเฉพาะชีตที่มีข้อมูล และคู่ 7% ว่างได้', () => {
  const p = makeWorkbook('vat-inspection-ok.xlsx', [
    { name: 'a4', file: 'sheet1.xml', xml: '<worksheet><sheetData></sheetData></worksheet>' },
    {
      name: 'a5',
      file: 'sheet2.xml',
      xml: sheetXml([HEADER, row(1, 'DEP000001', '01/10/2026'), row(2, 'CLHA000002', '15/10/2026', false), row(3, 'CORR000003', '31/10/2026')]),
    },
  ]);
  const verdict = verifyChunk(report, OCT, p, null);
  assert.equal(verdict.rowCount, 3);
  assert.deepEqual(verdict.sheets.map((s) => s.name), ['a4', 'a5']);
  assert.equal(verdict.actualSpan.from.toISOString().slice(0, 10), '2026-10-01');
  assert.equal(verdict.actualSpan.to.toISOString().slice(0, 10), '2026-10-31');
});

test('หัวตารางเปลี่ยน (อัตราภาษีเปลี่ยน 17.7% → อย่างอื่น) — ล้างดัง ๆ ตามที่ตั้งใจ ไม่ปล่อยไฟล์ที่ Silver ไม่รับ', () => {
  const changed = HEADER.map((h) => h.replace('17.7%', '18%'));
  const p = makeWorkbook('vat-inspection-bad-header.xlsx', [
    { name: 'a5', file: 'sheet1.xml', xml: sheetXml([changed, row(1, 'DEP000001', '01/10/2026')]) },
  ]);
  assert.throws(() => verifyChunk(report, OCT, p, null), /หัวตารางไม่ตรง/);
});

test('วันที่ใน Tax effective day หลุดช่วงที่สั่ง — ล้างดัง ๆ', () => {
  const p = makeWorkbook('vat-inspection-out-of-range.xlsx', [
    { name: 'a5', file: 'sheet1.xml', xml: sheetXml([HEADER, row(1, 'DEP000001', '30/09/2026')]) },
  ]);
  assert.throws(() => verifyChunk(report, OCT, p, null), /ช่วง|วันที่|range/i);
});
