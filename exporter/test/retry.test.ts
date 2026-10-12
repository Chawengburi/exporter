import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GateError } from '../src/core/gate.ts';
import { VerifyError } from '../src/core/verify.ts';
import { isTransientBrowserError, isTransientOnSamePage, withRetry } from '../src/core/retry.ts';
import { RowCapError } from '../src/sites/hoteltime/verify.ts';

/** error แบบที่ Playwright โยนจริง — แยกด้วย name ไม่ใช่ class เพราะ core ไม่ import playwright */
function timeoutError(msg = 'page.goto: Timeout 30000ms exceeded.'): Error {
  const e = new Error(msg);
  e.name = 'TimeoutError';
  return e;
}

/** งานปลอมที่โยน error ตามลำดับที่กำหนด แล้วคืนค่าเมื่อหมดคิว */
function scripted<T>(errors: Error[], value: T): { task: () => Promise<T>; calls: () => number } {
  let n = 0;
  return {
    task: async () => {
      const e = errors[n++];
      if (e) throw e;
      return value;
    },
    calls: () => n,
  };
}

const POLICY = { maxRetries: 2, baseDelayMs: 1000 };

function fakeSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return { sleep: async (ms) => void waits.push(ms), waits };
}

test('ผ่านตั้งแต่ครั้งแรก — ไม่รอ ไม่ลองซ้ำ attempts = 1', async () => {
  const { sleep, waits } = fakeSleep();
  const r = await withRetry(scripted([], 'ok').task, { policy: POLICY, isRetryable: isTransientBrowserError, sleep });
  assert.deepEqual(r, { ok: true, value: 'ok', attempts: 1 });
  assert.deepEqual(waits, []);
});

test('timeout ชั่วคราวแล้วผ่าน — ลองใหม่ และนับจำนวนครั้ง', async () => {
  const { sleep } = fakeSleep();
  const job = scripted([timeoutError()], 'ok');
  const r = await withRetry(job.task, { policy: POLICY, isRetryable: isTransientBrowserError, sleep });
  assert.deepEqual(r, { ok: true, value: 'ok', attempts: 2 });
});

test('ลองใหม่ไม่เกิน 2 ครั้ง (รวม 3) แล้วคืนความล้มเหลวพร้อม error สุดท้าย', async () => {
  const { sleep } = fakeSleep();
  const last = timeoutError('ครั้งที่ 3');
  const job = scripted([timeoutError(), timeoutError(), last, timeoutError()], 'never');
  const r = await withRetry(job.task, { policy: POLICY, isRetryable: isTransientBrowserError, sleep });
  assert.equal(job.calls(), 3);
  assert.deepEqual(r, { ok: false, error: last, attempts: 3 });
});

test('ระยะรอเพิ่มขึ้นทุกครั้ง', async () => {
  const { sleep, waits } = fakeSleep();
  await withRetry(scripted([timeoutError(), timeoutError(), timeoutError()], 'x').task, {
    policy: POLICY,
    isRetryable: isTransientBrowserError,
    sleep,
  });
  assert.deepEqual(waits, [1000, 2000]);
});

test('ไม่ลองใหม่กับความผิดพลาดที่บอกว่าข้อมูลผิดจริง เช่น ชนเพดานแถว', async () => {
  const { sleep, waits } = fakeSleep();
  const capped = new RowCapError('ได้ 2000 แถวพอดี');
  const job = scripted([capped], 'never');
  const r = await withRetry(job.task, { policy: POLICY, isRetryable: isTransientBrowserError, sleep });
  assert.equal(job.calls(), 1);
  assert.deepEqual(r, { ok: false, error: capped, attempts: 1 });
  assert.deepEqual(waits, []);
});

test('แยกประเภท: timeout / network / browser ถูกปิด = ชั่วคราว · error อื่นทั้งหมด = ไม่ลองใหม่', () => {
  assert.equal(isTransientBrowserError(timeoutError()), true);
  assert.equal(isTransientBrowserError(new Error('page.goto: net::ERR_CONNECTION_RESET at https://x')), true);
  assert.equal(isTransientBrowserError(new Error('page.click: Target page, context or browser has been closed')), true);

  assert.equal(isTransientBrowserError(new RowCapError('cap')), false);
  assert.equal(isTransientBrowserError(new VerifyError('ช่วงวันไม่ตรง')), false);
  assert.equal(isTransientBrowserError(new GateError('ไม่อยู่ใน allowlist')), false);
  assert.equal(isTransientBrowserError(Object.assign(new Error('captcha'), { name: 'LoginError' })), false);
  assert.equal(isTransientBrowserError(Object.assign(new Error('ล็อกอินไม่สำเร็จ'), { name: 'LoginError' })), false);
  assert.equal(isTransientBrowserError(Object.assign(new Error('HOTELTIME_USERNAME'), { name: 'ConfigError' })), false);
  assert.equal(isTransientBrowserError('ไม่ใช่ Error'), false);
});

test('ลองบน page เดิม (FoodStory): เบราว์เซอร์ถูกปิดแล้ว = ลองซ้ำไปก็เปล่า ไม่ลองใหม่', () => {
  // ลองบน page เดิมเพราะล็อกอินใหม่ต้องมีคนกด captcha — page ตายแล้วทุกใบที่เหลือจะรอ 90 วินาทีฟรี ๆ
  assert.equal(isTransientOnSamePage(new Error('page.click: Target page, context or browser has been closed')), false);
  assert.equal(isTransientOnSamePage(timeoutError()), true);
  assert.equal(isTransientOnSamePage(new Error('page.goto: net::ERR_CONNECTION_RESET')), true);
});
