import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPORTS, UNCONFIRMED_FAMILY, familyOf, periodOf } from '../src/sites/foodstory/reports/index.ts';
import { ID as SALEBYCHANNEL_ID } from '../src/sites/foodstory/salebychannel.ts';
import { ID as RESERVATION_ID } from '../src/sites/foodstory/reservation-report.ts';

/**
 * ตระกูลและงวดของรายงาน FoodStory (ADR-0008, ใบ 06) — snapshot = รายงานที่จำนวนแถวรายวันกับรายเดือนเท่ากัน (ไม่กรองตามวัน) และยอดสะสมทั้งปี
 * (salebymonthsum) ตามตารางเทียบรายงาน 2026-10-13 · ที่เหลือ (รวม salebychannel และ reservation-report) = รายงานตามวัน
 */
const PICTURES = ['costbyproduct', 'current_stock', 'ingredient', 'ingredientaddon', 'intermidiate', 'salebymonthsum', 'supplier'];

test('ทุกรายงานของ FoodStory มีตระกูล — รายงาน snapshot 7 ตัวตามตารางเทียบรายงาน ที่เหลือเป็นรายงานตามวัน', () => {
  const ids = [...REPORTS.map((r) => r.id), SALEBYCHANNEL_ID, RESERVATION_ID];
  assert.equal(ids.length, 49);
  assert.deepEqual(ids.filter((id) => familyOf(id) === 'picture').sort(), PICTURES);
  for (const id of ids) assert.ok(familyOf(id) === 'per-day' || familyOf(id) === 'picture', `${id} ไม่มีตระกูล`);
});

test('งวดของรายงาน snapshot: salebymonthsum เป็นยอดสะสมทั้งปี (มี snapshot ปิดงวดปี) · snapshot อื่นไม่มีงวด · รายงานตามวันไม่มีงวด', () => {
  assert.equal(periodOf('salebymonthsum'), 'year');
  for (const id of PICTURES.filter((p) => p !== 'salebymonthsum')) assert.equal(periodOf(id), 'none', id);
  assert.equal(periodOf('salebybill'), undefined);
  assert.equal(periodOf(SALEBYCHANNEL_ID), undefined);
});

test('🔴 id ที่ไม่รู้จักล้มดัง ๆ — ไม่เดาตระกูลให้', () => {
  assert.throws(() => familyOf('no-such-report'), /no-such-report/);
});

test('15 รายงานที่ตารางเทียบรายงานยังเขียนว่า "ต้องยืนยัน" ระบุไว้ในแคตตาล็อก — ใช้ตระกูลตามตารางไปก่อน (code review ใบ 06)', () => {
  assert.deepEqual([...UNCONFIRMED_FAMILY].sort(), [
    'crm', 'employee', 'intermidiate', 'order_by_employee', 'outputtax', 'payment_by_employee', 'promotion', 'promotion_use',
    'reservation-report', 'supplier', 'table', 'transfer', 'transfer_stock', 'used_stock', 'voucher',
  ]);
  for (const id of UNCONFIRMED_FAMILY) assert.doesNotThrow(() => familyOf(id), id);
});
