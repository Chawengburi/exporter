import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDMY } from '../src/core/order.ts';
import { VerifyError } from '../src/core/verify.ts';
import { checkOverlapCoverage } from '../src/sites/hoteltime/verify.ts';

// รายงานแบบ "ช่วงพักที่คร่อมช่วงที่ขอ" (City tax, Profiles, Rooms OOO): แถวต้องมีวันเริ่ม ≤ ปลายช่วง และวันจบ ≥ ต้นช่วง
// — ต่างจากด่านเดิมที่บังคับให้วันที่ของแถวอยู่ในช่วงพอดี
const RANGE = { from: parseDMY('01/10/2026'), to: parseDMY('07/10/2026') };

test('แถวที่คร่อมช่วงผ่าน แม้วันเริ่มอยู่ก่อนช่วงหรือวันจบอยู่หลังช่วง · ช่วงจริงคือวันเริ่มต่ำสุด–วันจบสูงสุด', () => {
  const span = checkOverlapCoverage(
    [['25/09/2026', '02/10/2026'], ['05/10/2026', '12/10/2026'], ['01/10/2026', '07/10/2026']],
    RANGE,
    { from: 'Reservation from', to: 'Reservation to' },
  );
  assert.equal(span.from.toISOString().slice(0, 10), '2026-09-25');
  assert.equal(span.to.toISOString().slice(0, 10), '2026-10-12');
});

test('🔴 แถวที่ไม่แตะช่วงที่ขอเลย = filter ไม่ทำงาน', () => {
  assert.throws(
    () => checkOverlapCoverage([['01/09/2026', '20/09/2026']], RANGE, { from: 'Reservation from', to: 'Reservation to' }),
    (e: unknown) => e instanceof VerifyError && /ไม่คร่อมช่วงที่สั่ง/.test(e.message),
  );
});

test('🔴 วันเริ่มหรือวันจบว่าง = ตรวจไม่ได้ ต้องล้ม', () => {
  assert.throws(
    () => checkOverlapCoverage([['', '05/10/2026']], RANGE, { from: 'Reservation from', to: 'Reservation to' }),
    (e: unknown) => e instanceof VerifyError && /ค่าว่าง/.test(e.message),
  );
});
