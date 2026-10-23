import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLoginFailureReason, loginFailureDetail } from '../src/core/run-record.ts';
import { foodstoryDailySteps, loginFailedSteps } from '../src/sites/foodstory/daily-steps.ts';

/**
 * ลำดับงานของรอบรายวัน FoodStory ใน login เดียว (ใบ 06) — ช่วงวันที่ของ FoodStory เป็นของ session ทั้งรอบ (ตั้งครั้งเดียวใช้ได้ทุกหน้า) จึงต้อง
 * ตั้งช่วงทีละวันของข้อมูลแล้วดึงทุกรายงานของวันนั้น · reservation-report ข้ามไปอีก host แล้วไม่กลับ — ต้องอยู่ท้ายสุดเสมอ
 */

const show = (steps: ReturnType<typeof foodstoryDailySteps>) =>
  steps.map((s) => (s.kind === 'set-range' ? `range ${s.day}` : s.kind === 'reservation' ? `reservation ${s.day}` : `${s.report} ${s.day}${s.periodClose ? ' close' : ''}`));

test('🔴 เติมสองวัน + snapshot + จองโต๊ะ: ตั้งช่วงทีละวันแล้วดึงทุกรายงานของวันนั้น · snapshot หลังจากนั้นด้วยช่วงวันนี้ (วันที่ถ่าย) · จองโต๊ะทุกวันไว้ท้ายสุด', () => {
  const steps = foodstoryDailySteps({
    perDay: [
      { report: 'salebybill', day: '2026-10-12' }, { report: 'reservation-report', day: '2026-10-12' }, { report: 'salebychannel', day: '2026-10-12' },
      { report: 'salebybill', day: '2026-10-13' }, { report: 'reservation-report', day: '2026-10-13' }, { report: 'salebychannel', day: '2026-10-13' },
    ],
    pictures: [{ report: 'current_stock', day: '2026-10-14' }],
    periodCloses: [],
  });
  assert.deepEqual(show(steps), [
    'range 2026-10-12', 'salebybill 2026-10-12', 'salebychannel 2026-10-12',
    'range 2026-10-13', 'salebybill 2026-10-13', 'salebychannel 2026-10-13',
    'range 2026-10-14', 'current_stock 2026-10-14',
    'reservation 2026-10-12', 'reservation 2026-10-13',
  ]);
});

test('มีแต่ snapshot — ตั้งช่วงเป็นวันนี้ (วันที่ถ่าย) ก่อน: snapshot ไม่กรองตามวัน แต่ salebymonthsum เลือกปีจากช่วงของ session — snapshot ยอดสะสม = ต้นงวดถึงวันนี้', () => {
  const steps = foodstoryDailySteps({ perDay: [], pictures: [{ report: 'salebymonthsum', day: '2026-10-14' }], periodCloses: [] });
  assert.deepEqual(show(steps), ['range 2026-10-14', 'salebymonthsum 2026-10-14']);
});

test('snapshot ปิดงวด salebymonthsum ช่วงต้นปี — ตั้งช่วงเป็นวันสุดท้ายของงวด (31 ธ.ค.) ก่อนถ่าย', () => {
  const steps = foodstoryDailySteps({
    perDay: [{ report: 'salebybill', day: '2027-01-02' }],
    pictures: [{ report: 'salebymonthsum', day: '2027-01-03' }],
    periodCloses: [{ report: 'salebymonthsum', day: '2026-12-31' }],
  });
  assert.deepEqual(show(steps), [
    'range 2027-01-02', 'salebybill 2027-01-02', 'range 2027-01-03', 'salebymonthsum 2027-01-03',
    'range 2026-12-31', 'salebymonthsum 2026-12-31 close',
  ]);
});

test('ไม่มีงาน = ไม่มีขั้นตอน (ไม่ต้อง login ไม่ต้องกด captcha)', () => {
  assert.deepEqual(foodstoryDailySteps({ perDay: [], pictures: [], periodCloses: [] }), []);
});

test('🔴 1 ม.ค.: snapshot salebymonthsum ของวันนี้ได้ปีใหม่ (ตั้งช่วงวันนี้) ส่วนปีที่แล้วทั้งปีเป็น snapshot ปิดงวด — ไม่ซ้ำกัน (code review ใบ 06)', () => {
  const steps = foodstoryDailySteps({
    perDay: [{ report: 'salebybill', day: '2026-12-31' }],
    pictures: [{ report: 'salebymonthsum', day: '2027-01-01' }],
    periodCloses: [{ report: 'salebymonthsum', day: '2026-12-31' }],
  });
  assert.deepEqual(show(steps), [
    'range 2026-12-31', 'salebybill 2026-12-31',
    'range 2027-01-01', 'salebymonthsum 2027-01-01',
    'range 2026-12-31', 'salebymonthsum 2026-12-31 close',
  ]);
});

// exporter-foodstory-scheduled-daily ใบ 02 — login ล้ม = ทุกงานในแผนของรอบนั้นล้มด้วยเหตุผลเดียว (มีตัวบอกว่า login ล้ม) แล้วบันทึกผลตามปกติ
// ให้ status/Discord เห็นว่ารอบนี้รันแล้วแต่ login ไม่ผ่าน · รอบเก็บตกถัดไปลองใหม่เอง (ทำเฉพาะที่ยังไม่สำเร็จ)
test('🔴 login ล้ม: ทุกรายงานในแผน (ทุกวันของข้อมูล + snapshot + snapshot ปิดงวด + จองโต๊ะ) ล้มหนึ่งครั้งด้วยเหตุผลที่มีตัวบอก login ล้ม · ไม่มีขั้นตั้งช่วง', () => {
  const steps = foodstoryDailySteps({
    perDay: [{ report: 'salebybill', day: '2026-12-30' }, { report: 'reservation-report', day: '2026-12-30' }, { report: 'pay', day: '2026-12-31' }],
    pictures: [{ report: 'current_stock', day: '2027-01-01' }],
    periodCloses: [{ report: 'salebymonthsum', day: '2026-12-31' }],
  });
  const reason = 'แก้ reCAPTCHA อัตโนมัติไม่สำเร็จ: ERROR_ZERO_BALANCE';
  const failed = loginFailedSteps(steps, reason);
  const f0 = (xs: typeof failed) => xs[0]!.error;
  assert.deepEqual(show(failed.map((f) => f.step)), [
    'salebybill 2026-12-30', 'pay 2026-12-31', 'current_stock 2027-01-01', 'salebymonthsum 2026-12-31 close', 'reservation 2026-12-30',
  ]);
  for (const f of failed) {
    assert.ok(isLoginFailureReason(f.error), f.error);
    assert.equal(loginFailureDetail(f.error), reason);
  }
  assert.equal(isLoginFailureReason('Timeout 60000ms exceeded'), false);
  // ข้อความจากเว็บที่บังเอิญขึ้นต้นเหมือนกันไม่ถูกกลืนเป็น login ล้ม — ต้องมีแท็กท้ายของเราเองด้วย (code review ใบ 02)
  assert.equal(isLoginFailureReason(f0(failed).replace(/ \[[^\]]+\]$/, '')), false);
  assert.equal(loginFailureDetail('Timeout 60000ms exceeded'), null);
});

test('login ล้มแต่แผนว่าง = ไม่มีผลให้บันทึก', () => {
  assert.deepEqual(loginFailedSteps([], 'x'), []);
});
