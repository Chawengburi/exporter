import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPORTS, plannedReports } from '../src/sites/hoteltime/reports/index.ts';

/**
 * ตระกูลของรายงาน HotelTime (ADR-0008, CONTEXT.md: รายงานตามวัน / รายงาน snapshot) — ตัดสินชื่อไฟล์ และในใบ 03 ตัดสินว่าดึงอย่างไร
 * รายชื่อตามตารางเทียบรายงาน (2026-10-13): ledger 21 + manager-day-detail (ยอดรวมของเมื่อวานวันเดียว) = ตามวัน · ที่เหลือ = snapshot
 */
const PER_DAY = [
  'reservations-search', 'reservations-ratecode', 'reservations-cancelled', 'arrival-period',
  'post-masters', 'post-master-history', 'manual-postings', 'postings',
  'invoices-advance', 'invoices-annul', 'invoices-closed-account', 'deposit-ledger', 'gift-certificate-ledger', 'invoices-report',
  'city-tax', 'guest-profiles', 'foreign-police-profiles',
  'manager-day-detail', 'manager-items', 'accounting-report', 'accounting-report-detail', 'deposit-journal',
  'audit-trail', 'vat-output', 'vat-inspection',
];

test('ทุกรายงานของ HotelTime มีตระกูล และรายงานตามวันตรงกับตารางเทียบรายงาน (25 ตัว ที่เหลือเป็น snapshot 28 ตัว รวมรายงานล่วงหน้า arrival-ahead)', () => {
  assert.equal(REPORTS.length, 53);
  for (const r of REPORTS) assert.ok(r.family === 'per-day' || r.family === 'picture', `${r.id} ไม่มีตระกูล`);
  assert.deepEqual(REPORTS.filter((r) => r.family === 'per-day').map((r) => r.id).sort(), [...PER_DAY].sort());
  assert.equal(REPORTS.filter((r) => r.family === 'picture').length, 28);
});

test('งวดของรายงาน snapshot (ใบ 05): ทุกรายงาน snapshot บอกงวด — เดือน / ปี / ไม่มี ตามรายชื่อใน spec · รายงานตามวันไม่มีงวด', () => {
  const pictures = REPORTS.filter((r) => r.family === 'picture');
  for (const r of pictures) assert.ok(r.period === 'month' || r.period === 'year' || r.period === 'none', `${r.id} ไม่ได้บอกงวด`);
  const of = (p: string) => pictures.filter((r) => r.period === p).map((r) => r.id).sort();
  assert.deepEqual(of('month'), [
    'manager-summary', 'nationality-revenue', 'occupancy-by-nationality', 'occupancy-by-nationality-stay-reason',
    'reservation-stats-day', 'trial-balance',
  ]);
  assert.deepEqual(of('year'), ['occupancy-annual', 'reservation-stats-month', 'reservation-stats-segment']);
  for (const r of REPORTS.filter((x) => x.family === 'per-day')) assert.equal(r.period, undefined, `${r.id} เป็นรายงานตามวัน`);
});

test('accounts-open (ticket 02 ของ exporter-hoteltime-gold-feed): snapshot รายวันอย่างเดียว ไม่มีงวด ไม่มี back-fill · หัวตาราง 16 คอลัมน์ รวม "Open balance" ซ้ำสองคอลัมน์', () => {
  const r = REPORTS.find((x) => x.id === 'accounts-open');
  assert.ok(r, 'ยังไม่ลงทะเบียน accounts-open');
  assert.equal(r.family, 'picture');
  assert.equal(r.dailyOnly, true);
  assert.equal(r.period, 'none');
  assert.deepEqual(r.expectedColumns, [
    'Account number', 'Reservation no.', 'Group', 'Room', 'Opened from', 'Departure to', 'Customer', 'Account type',
    'Currency', 'Account total', 'Future revenue', 'Open balance', 'Deposits', 'Closed', 'Audited revenue', 'Open balance',
  ]);
});

test('ADR-0011: snapshot ถ่ายซ้ำรอบ 18:00 (ตรงกับ cron รอบเย็น) · รายงานตามวันไม่ถ่ายซ้ำ', () => {
  const byId = new Map(plannedReports().map((r) => [r.id, r]));
  for (const id of ['in-house-guests', 'rooms-status-overview', 'arrivals', 'departures', 'trial-balance', 'accounts-open']) {
    assert.equal(byId.get(id)?.refreshAtHour, 18, id);
  }
  for (const id of ['reservations-search', 'postings', 'manager-day-detail']) assert.equal(byId.get(id)?.refreshAtHour, undefined, id);
  assert.ok(plannedReports().filter((r) => r.family === 'picture').every((r) => r.refreshAtHour === 18));
});

test('vat-output (ticket 01 ของ exporter-hoteltime-gold-feed): รายงานตามวัน รายเดือน หัวตาราง 14 คอลัมน์ตามที่ Gold ของ hoteltime-schema รับ · ไม่ตัดคอลัมน์ PII', () => {
  const r = REPORTS.find((x) => x.id === 'vat-output');
  assert.ok(r, 'ยังไม่ลงทะเบียน vat-output');
  assert.equal(r.family, 'per-day');
  assert.equal(r.dailyOnly, false);
  assert.equal(r.chunk.kind, 'monthly');
  assert.equal(r.path, 'invoices/invoicesVatOutputReport.aspx');
  assert.deepEqual(r.expectedColumns, [
    'No.', 'Invoice number', 'Document type', 'Issue date', 'Tax effective date', 'Customer', 'Tax ID', 'Identity document no.',
    'Currency', 'VAT base', 'VAT', 'Total', 'Status', 'Linked documents',
  ]);
  assert.ok(r.allowedControls.every((c) => c.startsWith('ctl00$pc')), 'ปุ่ม/ช่องที่อนุญาตต้องอยู่ใน panel ของฟอร์มเท่านั้น');
});
