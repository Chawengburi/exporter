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
];

test('ทุกรายงานของ HotelTime มีตระกูล และรายงานตามวันตรงกับตารางเทียบรายงาน (22 ตัว ที่เหลือเป็น snapshot 27 ตัว)', () => {
  assert.equal(REPORTS.length, 49);
  for (const r of REPORTS) assert.ok(r.family === 'per-day' || r.family === 'picture', `${r.id} ไม่มีตระกูล`);
  assert.deepEqual(REPORTS.filter((r) => r.family === 'per-day').map((r) => r.id).sort(), [...PER_DAY].sort());
  assert.equal(REPORTS.filter((r) => r.family === 'picture').length, 27);
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

test('ADR-0011: snapshot ทุกใบของ HotelTime ถ่ายซ้ำรอบ 18:00 · รายงานตามวันไม่ถ่ายซ้ำ', () => {
  const planned = plannedReports();
  assert.equal(planned.length, REPORTS.length);
  for (const r of planned) {
    assert.equal(r.refreshAtHour, r.family === 'picture' ? 18 : undefined, `${r.id} (${r.family})`);
  }
});
