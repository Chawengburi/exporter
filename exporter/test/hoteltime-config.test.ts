import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { ConfigError, loadConfig, loadCredentials } from '../src/sites/hoteltime/config.ts';

// ADR-0004 / ticket 13: prefix ของ HotelTime ย้ายจาก PMS_* เป็น HOTELTIME_* ตอน rename เป็น exporter
// config.ts โหลด .env จริงตอน import — เทสต์นี้ตั้งทุกตัวแปรที่เกี่ยวเองแล้วคืนค่าเดิมหลังจบ
// และตั้ง PMS_* เป็นค่าหลอกไว้เสมอ กัน credential จริงหลุดลง assertion diff ถ้าโค้ดยังอ่าน prefix เก่า
const KEYS = ['USERNAME', 'PASSWORD', 'BASE_URL', 'LOGIN_PATH', 'HEADLESS', 'TIMEOUT_MS', 'SLOW_MO'];
const NAMES = [...KEYS.flatMap((k) => [`HOTELTIME_${k}`, `PMS_${k}`]), 'EXPORTER_GO_LIVE'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
  process.env.PMS_USERNAME = 'legacy-user';
  process.env.PMS_PASSWORD = 'legacy-pass';
  process.env.PMS_BASE_URL = 'https://legacy.example';
  process.env.PMS_TIMEOUT_MS = '1';
});

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

test('loadConfig อ่านค่าจาก HOTELTIME_* ทุกตัว', () => {
  process.env.HOTELTIME_BASE_URL = 'https://th99.hoteltime.test/';
  process.env.HOTELTIME_LOGIN_PATH = '/pms/login/x.aspx';
  process.env.HOTELTIME_HEADLESS = 'false';
  process.env.HOTELTIME_TIMEOUT_MS = '45000';
  process.env.HOTELTIME_SLOW_MO = '250';

  const cfg = loadConfig();
  assert.equal(cfg.baseUrl, 'https://th99.hoteltime.test');
  assert.equal(cfg.loginUrl, 'https://th99.hoteltime.test/pms/login/x.aspx');
  assert.equal(cfg.headless, false);
  assert.equal(cfg.timeoutMs, 45_000);
  assert.equal(cfg.slowMoMs, 250);
});

test('loadConfig ไม่อ่าน PMS_* แล้ว — ไม่ตั้ง HOTELTIME_* ได้ค่า default', () => {
  const cfg = loadConfig();
  assert.equal(cfg.baseUrl, 'https://th07.hoteltime.com');
  assert.equal(cfg.timeoutMs, 30_000);
});

test('loadCredentials อ่าน HOTELTIME_USERNAME / HOTELTIME_PASSWORD', () => {
  process.env.HOTELTIME_USERNAME = 'u-test';
  process.env.HOTELTIME_PASSWORD = 'p-test';
  assert.deepEqual(loadCredentials(), { username: 'u-test', password: 'p-test' });
});

test('loadCredentials บอกชื่อตัวแปรใหม่ที่ขาด ไม่สนค่าใน PMS_* เดิม', () => {
  assert.throws(
    () => loadCredentials(),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.match((err as Error).message, /HOTELTIME_USERNAME และ HOTELTIME_PASSWORD/);
      return true;
    },
  );
});

test('loadConfig ตั้งคลังผลลัพธ์ data/ ไว้ที่รากโปรเจกต์ (ADR-0005)', () => {
  const cfg = loadConfig();
  assert.equal(cfg.dataDir, `${cfg.projectRoot}/data`);
});

test('URL หลังล็อกอินสำเร็จ = หน้าของ HotelTime เองที่ไม่ใช่ login · chrome-error/โดเมนอื่น/หน้า login ไม่นับ', async () => {
  const { isSignedInUrl } = await import('../src/sites/hoteltime/session.ts');
  const base = 'https://th07.hoteltime.com';
  assert.equal(isSignedInUrl('https://th07.hoteltime.com/pms/Welcomepage.aspx', base), true);
  assert.equal(isSignedInUrl('https://th07.hoteltime.com/pms/login/login.aspx?ReturnUrl=x', base), false);
  assert.equal(isSignedInUrl('chrome-error://chromewebdata/', base), false);
  assert.equal(isSignedInUrl('https://evil.example/pms/Welcomepage.aspx', base), false);
});

// ── วันเริ่มใช้งาน (ADR-0009, ใบ 04) — ค่าเดียวใช้ทั้งสอง Site จึงไม่มี prefix ของ Site ──

test('EXPORTER_GO_LIVE: ไม่ตั้ง = null (ไม่เดาวัน) · ตั้งเป็น YYYY-MM-DD = วันนั้น', () => {
  assert.equal(loadConfig().goLive, null);
  process.env.EXPORTER_GO_LIVE = '2026-10-20';
  assert.equal(loadConfig().goLive, '2026-10-20');
});

test('🔴 EXPORTER_GO_LIVE ที่ไม่ใช่วันที่จริงแบบ YYYY-MM-DD ล้มดัง ๆ — ไม่ปล่อยให้เติมย้อนผิดช่วงเงียบ ๆ', () => {
  for (const bad of ['20/10/2026', '2026-02-30', 'tomorrow']) {
    process.env.EXPORTER_GO_LIVE = bad;
    assert.throws(() => loadConfig(), (err: Error) => err instanceof ConfigError && /EXPORTER_GO_LIVE/.test(err.message));
  }
});
