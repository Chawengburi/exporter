import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { UploaderConfigError, loadUploaderSetup } from '../src/uploader-config.ts';

// ticket 01 ของ exporter-upload-to-uploader (Q1/Q6 ของ grilling): UPLOADER_URL/EMAIL/PASSWORD ไม่มี default ในโค้ด
const NAMES = ['UPLOADER_URL', 'UPLOADER_EMAIL', 'UPLOADER_PASSWORD', 'UPLOADER_SEND_EMPTY'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
});

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

test('loadUploaderSetup: อ่านครบทั้ง 3 ตัวจาก env — url (ไม่ลับ) แยก type จาก email/password (ลับ) · sendEmpty default ปิด', () => {
  process.env.UPLOADER_URL = 'https://uploader.test';
  process.env.UPLOADER_EMAIL = 'bot@example.invalid';
  process.env.UPLOADER_PASSWORD = 'secret';
  assert.deepEqual(loadUploaderSetup(), {
    config: { url: 'https://uploader.test', sendEmpty: false },
    credentials: { email: 'bot@example.invalid', password: 'secret' },
  });
});

// ticket 11: UPLOADER_SEND_EMPTY ปิดโดย default (ยืนยันสดกับ production 2026-10-19 ว่า uploader ยังไม่ deploy contract นี้)
test('loadUploaderSetup: UPLOADER_SEND_EMPTY=true → sendEmpty เปิด', () => {
  process.env.UPLOADER_URL = 'https://uploader.test';
  process.env.UPLOADER_EMAIL = 'bot@example.invalid';
  process.env.UPLOADER_PASSWORD = 'secret';
  process.env.UPLOADER_SEND_EMPTY = 'true';
  assert.equal(loadUploaderSetup().config.sendEmpty, true);
});

test('loadUploaderSetup: UPLOADER_SEND_EMPTY ค่าอื่นที่ไม่ใช่ "true" (รวมค่าว่าง/พิมพ์ผิด) → ปิดเสมอ ไม่ error', () => {
  process.env.UPLOADER_URL = 'https://uploader.test';
  process.env.UPLOADER_EMAIL = 'bot@example.invalid';
  process.env.UPLOADER_PASSWORD = 'secret';
  process.env.UPLOADER_SEND_EMPTY = 'yes';
  assert.equal(loadUploaderSetup().config.sendEmpty, false);
});

test('loadUploaderSetup: ไม่ตั้งอะไรเลย → throw บอกทั้ง 3 ตัวที่ขาด', () => {
  assert.throws(
    () => loadUploaderSetup(),
    (err: unknown) =>
      err instanceof UploaderConfigError &&
      /UPLOADER_URL/.test(err.message) &&
      /UPLOADER_EMAIL/.test(err.message) &&
      /UPLOADER_PASSWORD/.test(err.message),
  );
});

test('loadUploaderSetup: ขาดแค่ตัวเดียว → บรรทัดแรกบอกเฉพาะตัวที่ขาด', () => {
  process.env.UPLOADER_URL = 'https://uploader.test';
  process.env.UPLOADER_EMAIL = 'bot@example.invalid';
  assert.throws(
    () => loadUploaderSetup(),
    (err: unknown) => err instanceof UploaderConfigError && err.message.split('\n')[0] === 'ยังไม่ได้ตั้ง UPLOADER_PASSWORD',
  );
});

test('loadUploaderSetup: ค่าว่าง/เว้นวรรคอย่างเดียว ถือว่าไม่ได้ตั้ง', () => {
  process.env.UPLOADER_URL = '   ';
  process.env.UPLOADER_EMAIL = 'bot@example.invalid';
  process.env.UPLOADER_PASSWORD = 'secret';
  assert.throws(() => loadUploaderSetup(), /UPLOADER_URL/);
});
