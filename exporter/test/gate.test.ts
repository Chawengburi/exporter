import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertControlAllowed, GateError } from '../src/core/gate.ts';

test('control ที่อยู่ในรายการอนุญาตผ่านได้ ไม่โยน error', () => {
  assert.doesNotThrow(() => {
    assertControlAllowed(['ctl00$pc$btnFind'], 'ctl00$pc$btnFind', 'reservations-search');
  });
});

test('control ที่ไม่อยู่ในรายการโยน GateError ทันที', () => {
  assert.throws(
    () => assertControlAllowed(['ctl00$pc$btnFind'], 'ctl00$pc$btnReinstate', 'reservations-cancelled'),
    (err: unknown) => {
      assert.ok(err instanceof GateError);
      assert.match((err as Error).message, /reservations-cancelled/);
      assert.match((err as Error).message, /ctl00\$pc\$btnReinstate/);
      return true;
    },
  );
});

test('รายการอนุญาตว่าง ปฏิเสธทุก control ไม่ใช่อนุญาตทุกอย่าง', () => {
  assert.throws(
    () => assertControlAllowed([], 'ctl00$pc$btnFind', 'reservations-search'),
    GateError,
  );
});

test('ชื่อที่ใกล้เคียงแต่ไม่ตรงเป๊ะ ไม่ผ่าน — ไม่มี fuzzy match', () => {
  assert.throws(
    () => assertControlAllowed(['ctl00$pc$btnFind'], 'ctl00$pc$btnFind2', 'reservations-search'),
    GateError,
  );
  assert.throws(
    () => assertControlAllowed(['ctl00$pc$btnFind'], 'ctl00$pc$btnfind', 'reservations-search'),
    GateError,
  );
});
