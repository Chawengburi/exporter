import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utcDate } from '../src/core/order.ts';
import { findReport } from '../src/sites/hoteltime/reports/index.ts';
import { verifyChunk } from '../src/sites/hoteltime/verify.ts';
import { makeWorkbook, sheetXml } from './_xlsx-fixture.ts';

/**
 * vat-output (ticket 01 ของ exporter-hoteltime-gold-feed) — ข้อมูลสังเคราะห์ทั้งหมด (เลขใบ/ลูกค้า/Tax ID สมมติ) ไม่ใช้ไฟล์จริง
 * ที่มีข้อมูลส่วนบุคคล · รูปไฟล์เทียบกับไฟล์จริงที่ recon สดเมื่อ 2026-11-16 (14 คอลัมน์, Issue date เป็นแกนวันที่ของฟอร์ม)
 */
const OCT = { from: utcDate(2026, 10, 1), to: utcDate(2026, 10, 31) };
const report = findReport('vat-output')!;
const HEADER = [...report.expectedColumns];
// No., Invoice number, Document type, Issue date, Tax effective date, Customer, Tax ID, Identity document no., Currency, VAT base, VAT, Total, Status, Linked documents
const row = (n: number, invoice: string, issue: string, tax: string, status = 'Issued', linked = '') =>
  [String(n), invoice, 'Invoice', issue, tax, `Customer ${n}`, `000000000000${n}`, '', 'THB', '100.00', '7.00', '107.00', status, linked];

test('ไฟล์สังเคราะห์ที่รูปเหมือนของจริง ผ่านด่านตรวจ: นับแถว และช่วงวันที่จริงอ่านจากคอลัมน์ Issue date', () => {
  const p = makeWorkbook('vat-output-ok.xlsx', [
    {
      name: 'export',
      file: 'sheet1.xml',
      xml: sheetXml([
        HEADER,
        row(1, 'DEP000001', '01/10/2026', '01/10/2026'),
        row(2, 'CLHA000002', '15/10/2026', '15/10/2026', 'Issued', 'DEP000001, DEP000003'),
        row(3, 'CORR000003', '31/10/2026', '31/10/2026', 'Cancelled'),
      ]),
    },
  ]);
  const verdict = verifyChunk(report, OCT, p, null);
  assert.equal(verdict.rowCount, 3);
  assert.equal(verdict.actualSpan.from.toISOString().slice(0, 10), '2026-10-01');
  assert.equal(verdict.actualSpan.to.toISOString().slice(0, 10), '2026-10-31');
});

test('หัวตารางเปลี่ยน (ชื่อคอลัมน์ที่ 8 กลายเป็น "Branch" แบบหน้าเว็บ) — ล้างดัง ๆ ไม่ปล่อยไฟล์ที่ Gold จะไม่รับ', () => {
  const changed = HEADER.map((h) => (h === 'Identity document no.' ? 'Branch' : h));
  const p = makeWorkbook('vat-output-bad-header.xlsx', [
    { name: 'export', file: 'sheet1.xml', xml: sheetXml([changed, row(1, 'DEP000001', '01/10/2026', '01/10/2026')]) },
  ]);
  assert.throws(() => verifyChunk(report, OCT, p, null), /หัวตารางไม่ตรง/);
});

test('วันที่ใน Issue date หลุดช่วงที่สั่ง — ล้างดัง ๆ (ใบที่ Tax effective date อยู่ในช่วงแต่ Issue date ไม่อยู่ ไม่นับ)', () => {
  const p = makeWorkbook('vat-output-out-of-range.xlsx', [
    { name: 'export', file: 'sheet1.xml', xml: sheetXml([HEADER, row(1, 'DEP000001', '30/09/2026', '01/10/2026')]) },
  ]);
  assert.throws(() => verifyChunk(report, OCT, p, null), /ช่วง|วันที่|range/i);
});
