import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utcDate } from '../src/core/order.ts';
import type { Report } from '../src/sites/hoteltime/reports/_types.ts';
import {
  combinedForecast,
  occupancyAnnual,
  occupancyByRoomType,
  reservationStatsDay,
  reservationStatsMonth,
  reservationStatsSegment,
  reservationStatsTerm,
} from '../src/sites/hoteltime/reports/statistics.ts';
import { unchargedInvoices } from '../src/sites/hoteltime/reports/uncharged-invoices.ts';

// ช่วงข้อมูลจริงของรายงานภาพรวม (ticket 26) — ใช้ทั้งตั้งตัวกรองและตั้งชื่อไฟล์ · ค่าคาดหวังคิดจากปฏิทินโดยตรง
const iso = (d: Date) => d.toISOString().slice(0, 10);
function windowOf(report: Report, day: Date): string {
  assert.ok(report.dataWindow, `${report.id} ต้องมี dataWindow`);
  const w = report.dataWindow(day);
  return `${iso(w.from)}..${iso(w.to)}`;
}

const OCT_7 = utcDate(2026, 10, 7);
const DEC_15 = utcDate(2026, 12, 15);
const FEB_29 = utcDate(2028, 2, 29);

test('สถิติรายเดือน/รายปี = ทั้งปีนี้', () => {
  assert.equal(windowOf(reservationStatsMonth, OCT_7), '2026-01-01..2026-12-31');
  assert.equal(windowOf(reservationStatsSegment, OCT_7), '2026-01-01..2026-12-31');
  assert.equal(windowOf(occupancyAnnual, OCT_7), '2026-01-01..2026-12-31');
});

test('สถิติรายวัน = ทั้งเดือนนี้', () => {
  assert.equal(windowOf(reservationStatsDay, OCT_7), '2026-10-01..2026-10-31');
  assert.equal(windowOf(reservationStatsDay, FEB_29), '2028-02-01..2028-02-29');
});

test('term และ forecast = เดือนหน้าทั้งเดือน — ธันวาคมข้ามไปมกราคมปีหน้า', () => {
  assert.equal(windowOf(reservationStatsTerm, OCT_7), '2026-11-01..2026-11-30');
  assert.equal(windowOf(reservationStatsTerm, DEC_15), '2027-01-01..2027-01-31');
  assert.equal(windowOf(combinedForecast, DEC_15), '2027-01-01..2027-01-31');
});

test('occupancy ตามประเภทห้อง = ย้อน 12 เดือนถึงวันนี้ (29 ก.พ. → 1 มี.ค. ปีก่อน)', () => {
  assert.equal(windowOf(occupancyByRoomType, OCT_7), '2025-10-07..2026-10-07');
  assert.equal(windowOf(occupancyByRoomType, FEB_29), '2027-03-01..2028-02-29');
});

test('ใบแจ้งหนี้ค้างชำระ = ตั้งแต่วันแรกที่มีข้อมูลถึงวันนี้', () => {
  assert.equal(windowOf(unchargedInvoices, OCT_7), '2024-01-01..2026-10-07');
});

test('เดือนนี้ถึงวันนี้ (ticket 25) — วันที่ 1 ได้ช่วงวันเดียว · manager summary ใช้ช่วงเดียวกัน', async () => {
  const { trialBalance } = await import('../src/sites/hoteltime/reports/month-to-date.ts');
  const { managerSummary, managerDayDetail } = await import('../src/sites/hoteltime/reports/manager-reports.ts');
  assert.equal(windowOf(trialBalance, OCT_7), '2026-10-01..2026-10-07');
  assert.equal(windowOf(trialBalance, utcDate(2026, 10, 1)), '2026-10-01..2026-10-01');
  assert.equal(windowOf(managerSummary, OCT_7), '2026-10-01..2026-10-07');
  // manager day detail เป็นรายงานตามวัน (ADR-0008) — ช่วงที่ขอคือวันของข้อมูลเอง ตัววางแผนส่งเมื่อวานมา ไม่ต้องเลื่อนวันในนิยามแล้ว
  assert.equal(managerDayDetail.dataWindow, undefined);
  assert.equal(managerDayDetail.family, 'per-day');
});
