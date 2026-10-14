import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPORTS } from '../src/sites/hoteltime/reports/index.ts';

/**
 * ตระกูลของรายงาน HotelTime (ADR-0008, CONTEXT.md: รายงานตามวัน / รายงานภาพ) — ตัดสินชื่อไฟล์ และในใบ 03 ตัดสินว่าดึงอย่างไร
 * รายชื่อตามตารางเทียบรายงาน (2026-10-13): ledger 21 + manager-day-detail (ยอดรวมของเมื่อวานวันเดียว) = ตามวัน · ที่เหลือ = ภาพ
 */
const PER_DAY = [
  'reservations-search', 'reservations-ratecode', 'reservations-cancelled', 'arrival-period',
  'post-masters', 'post-master-history', 'manual-postings', 'postings',
  'invoices-advance', 'invoices-annul', 'invoices-closed-account', 'deposit-ledger', 'gift-certificate-ledger', 'invoices-report',
  'city-tax', 'guest-profiles', 'foreign-police-profiles',
  'manager-day-detail', 'manager-items', 'accounting-report', 'accounting-report-detail', 'deposit-journal',
];

test('ทุกรายงานของ HotelTime มีตระกูล และรายงานตามวันตรงกับตารางเทียบรายงาน (22 ตัว ที่เหลือเป็นภาพ 26 ตัว)', () => {
  assert.equal(REPORTS.length, 48);
  for (const r of REPORTS) assert.ok(r.family === 'per-day' || r.family === 'picture', `${r.id} ไม่มีตระกูล`);
  assert.deepEqual(REPORTS.filter((r) => r.family === 'per-day').map((r) => r.id).sort(), [...PER_DAY].sort());
  assert.equal(REPORTS.filter((r) => r.family === 'picture').length, 26);
});

test('งวดของรายงานภาพ (ใบ 05): ทุกรายงานภาพบอกงวด — เดือน / ปี / ไม่มี ตามรายชื่อใน spec · รายงานตามวันไม่มีงวด', () => {
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
