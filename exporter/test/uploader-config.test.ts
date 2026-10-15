import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { UploaderConfigError, loadUploaderSetup } from '../src/uploader-config.ts';

// ticket 01 ของ exporter-upload-to-uploader (Q1/Q6 ของ grilling): UPLOADER_URL/EMAIL/PASSWORD ไม่มี default ในโค้ด
const NAMES = ['UPLOADER_URL', 'UPLOADER_EMAIL', 'UPLOADER_PASSWORD'];
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

test('loadUploaderSetup: อ่านครบทั้ง 3 ตัวจาก env — url (ไม่ลับ) แยก type จาก email/password (ลับ)', () => {
  process.env.UPLOADER_URL = 'https://uploader.test';
  process.env.UPLOADER_EMAIL = 'bot@example.invalid';
  process.env.UPLOADER_PASSWORD = 'secret';
  assert.deepEqual(loadUploaderSetup(), { config: { url: 'https://uploader.test' }, credentials: { email: 'bot@example.invalid', password: 'secret' } });
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
