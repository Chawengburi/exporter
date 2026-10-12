import assert from 'node:assert/strict';
import { test } from 'node:test';
import { endDayPanel, monthDiff } from '../src/sites/foodstory/reservation-report.ts';

test('เดือน/ปีเดียวกัน = 0', () => {
  assert.equal(monthDiff({ year: 2026, month: 9 }, { year: 2026, month: 9 }), 0);
});

test('เดือนถัดไปในปีเดียวกัน = 1', () => {
  assert.equal(monthDiff({ year: 2026, month: 8 }, { year: 2026, month: 9 }), 1);
});

test('🔴 ข้ามปี — บั๊กจริงที่เคยเจอ (เข้าใจผิดว่า panel ขวา = ซ้าย+1 เดือนเสมอ)', () => {
  assert.equal(monthDiff({ year: 2025, month: 12 }, { year: 2026, month: 1 }), 1);
});

test('ย้อนหลังหลายเดือนข้ามปี', () => {
  assert.equal(monthDiff({ year: 2026, month: 3 }, { year: 2025, month: 9 }), -6);
});

// 🔴 พังจริง 2026-09-28 (batch ส.ค. ครั้งแรกที่ต่อเข้า CLI): ช่วงเดือนเดียว (01/08–31/08) — เลื่อน
// panel ขวามาเดือนเดียวกับ panel ซ้ายไม่ได้ (ปุ่มเลื่อนย้อนของ panel ขวา disabled เมื่อชิดกับซ้าย)
// ticket 11 ทดสอบแค่ช่วงข้ามเดือน (01/08–26/09) เลยไม่เคยเจอ ทั้งที่รอบรายเดือนปกติคือเดือนเดียวเสมอ
test('endDayPanel: วันสิ้นสุดเดือนเดียวกับวันเริ่ม → คลิกใน panel ซ้าย', () => {
  assert.equal(endDayPanel({ year: 2026, month: 8 }, { year: 2026, month: 8 }), 'left');
});

test('endDayPanel: คนละเดือน (รวมข้ามปี) → panel ขวา', () => {
  assert.equal(endDayPanel({ year: 2026, month: 8 }, { year: 2026, month: 9 }), 'right');
  assert.equal(endDayPanel({ year: 2025, month: 12 }, { year: 2026, month: 1 }), 'right');
});

test('endDayPanel: วันสิ้นสุดก่อนวันเริ่ม → โยน', () => {
  assert.throws(() => endDayPanel({ year: 2026, month: 9 }, { year: 2026, month: 8 }));
});
