import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDMY, lastDaysRange, resolveDateRange, utcDate } from '../src/core/order.ts';

test('--last-days ค่าปกติ ได้ช่วง N วันรวมวันนี้', () => {
  const today = utcDate(2026, 9, 17);
  const r = lastDaysRange(7, today);
  assert.equal(formatDMY(r.from), '11/09/2026');
  assert.equal(formatDMY(r.to), '17/09/2026');
});

test('--last-days 1 ได้แค่วันนี้วันเดียว', () => {
  const today = utcDate(2026, 9, 17);
  const r = lastDaysRange(1, today);
  assert.equal(formatDMY(r.from), '17/09/2026');
  assert.equal(formatDMY(r.to), '17/09/2026');
});

test('--last-days ข้ามเดือนข้ามปีได้ถูกต้อง', () => {
  const today = utcDate(2026, 1, 5);
  const r = lastDaysRange(10, today);
  assert.equal(formatDMY(r.from), '27/12/2025');
  assert.equal(formatDMY(r.to), '05/01/2026');
});

test('--last-days ค่าศูนย์ถูกปฏิเสธ — "0 วันล่าสุด" ไม่มีความหมาย', () => {
  assert.throws(() => lastDaysRange(0, utcDate(2026, 9, 17)));
});

test('--last-days ค่าติดลบถูกปฏิเสธ', () => {
  assert.throws(() => lastDaysRange(-3, utcDate(2026, 9, 17)));
});

test('resolveDateRange: ไม่ระบุอะไรเลย ได้ค่าเริ่มต้น 01/01/2024 ถึงวันนี้', () => {
  const today = utcDate(2026, 9, 17);
  const r = resolveDateRange({}, today);
  assert.equal(formatDMY(r.from), '01/01/2024');
  assert.equal(formatDMY(r.to), '17/09/2026');
});

test('resolveDateRange: --last-days พร้อมกับ --from ต้องถูกปฏิเสธ ไม่ใช่ให้ตัวใดตัวหนึ่งชนะเงียบ ๆ', () => {
  const today = utcDate(2026, 9, 17);
  assert.throws(() => resolveDateRange({ from: '01/06/2026', lastDays: 7 }, today));
});

test('resolveDateRange: --last-days พร้อมกับ --to ต้องถูกปฏิเสธ', () => {
  const today = utcDate(2026, 9, 17);
  assert.throws(() => resolveDateRange({ to: '01/06/2026', lastDays: 7 }, today));
});
