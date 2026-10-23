import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CaptchaError,
  DEFAULT_SOLVE_ATTEMPTS,
  extractSitekey,
  selectLoginMode,
  solveWithRetry,
} from '../src/sites/foodstory/captcha.ts';

/**
 * Seam ของ ticket 01: ตรรกะการตัดสินใจ login ของ FoodStory ที่เทสต์ได้โดยไม่เปิดเบราว์เซอร์จริง
 * และไม่จ่ายเครดิต 2captcha — port `CaptchaSolver` ถูก fake ทั้งหมด
 */

test('selectLoginMode: มี solver → auto-solve, ไม่มี → human-wait', () => {
  assert.equal(selectLoginMode({ hasSolver: true }), 'auto-solve');
  assert.equal(selectLoginMode({ hasSolver: false }), 'human-wait');
});

// --- extractSitekey: data-sitekey attribute ชนะ, ไม่งั้นอ่าน k จาก src ของ anchor iframe ---

test('extractSitekey: มี data-sitekey attribute → ใช้ค่านั้นเลย (ชนะ anchor)', () => {
  const key = extractSitekey({
    dataSitekeyAttr: '6LdATTR_key',
    anchorSrc: 'https://www.google.com/recaptcha/api2/anchor?ar=1&k=6LdANCHOR_key&co=xyz',
  });
  assert.equal(key, '6LdATTR_key');
});

test('extractSitekey: ไม่มี attribute → อ่าน k จาก src ของ anchor iframe', () => {
  const key = extractSitekey({
    dataSitekeyAttr: null,
    anchorSrc: 'https://www.google.com/recaptcha/api2/anchor?ar=1&k=6LdANCHOR_key&co=xyz&hl=th',
  });
  assert.equal(key, '6LdANCHOR_key');
});

test('extractSitekey: ไม่มีทั้ง attribute และ anchor → error ชัด', () => {
  assert.throws(() => extractSitekey({ dataSitekeyAttr: null, anchorSrc: null }), /sitekey/i);
});

test('extractSitekey: anchor src ไม่มี k → error ชัด', () => {
  assert.throws(
    () => extractSitekey({ dataSitekeyAttr: null, anchorSrc: 'https://www.google.com/recaptcha/api2/anchor?ar=1&co=xyz' }),
    /sitekey/i,
  );
});

// --- solveWithRetry: ลองซ้ำตามเพดาน, token ว่าง = ใช้ไม่ได้ ---

/** fake solver นับจำนวนครั้งที่ถูกเรียก ตามสคริปต์ผลลัพธ์ที่กำหนด */
function fakeSolve(results: Array<string | Error>): { solve: () => Promise<string>; calls: () => number } {
  let i = 0;
  return {
    calls: () => i,
    solve: async () => {
      const r = results[Math.min(i, results.length - 1)]!;
      i += 1;
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

test('solveWithRetry: สำเร็จครั้งแรก → คืน token เรียก solve ครั้งเดียว', async () => {
  const f = fakeSolve(['tok-123']);
  assert.equal(await solveWithRetry(f.solve, { attempts: 3 }), 'tok-123');
  assert.equal(f.calls(), 1);
});

test('solveWithRetry: โยนสองครั้งแล้วค่อยสำเร็จ → คืน token หยุดเรียก', async () => {
  const f = fakeSolve([new Error('503'), new Error('503'), 'tok-ok']);
  assert.equal(await solveWithRetry(f.solve, { attempts: 3 }), 'tok-ok');
  assert.equal(f.calls(), 3);
});

test('solveWithRetry: token ว่าง = ใช้ไม่ได้ ลองต่อ', async () => {
  const f = fakeSolve(['', '  ', 'tok-ok']);
  assert.equal(await solveWithRetry(f.solve, { attempts: 3 }), 'tok-ok');
  assert.equal(f.calls(), 3);
});

test('solveWithRetry: ล้มครบทุกครั้ง → โยน CaptchaError เรียกครบตามเพดาน', async () => {
  const f = fakeSolve([new Error('boom')]);
  await assert.rejects(() => solveWithRetry(f.solve, { attempts: 3 }), CaptchaError);
  assert.equal(f.calls(), 3);
});

test('DEFAULT_SOLVE_ATTEMPTS อยู่ในช่วง 2–3 ตามที่ตกลงไว้', () => {
  assert.ok(DEFAULT_SOLVE_ATTEMPTS >= 2 && DEFAULT_SOLVE_ATTEMPTS <= 3);
});
