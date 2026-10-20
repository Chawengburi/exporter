import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// ใบ 09: `--baseline` ปฏิเสธดัง ๆ ก่อนเปิดเบราว์เซอร์และก่อนแตะบัญชี — รายงาน snapshot (แบบ ADR-0003) และช่วงที่ถึงวันนี้ (ยังไม่ครบ)
const EXPORTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, ['src/index.ts', 'export', '--site', 'hoteltime', ...args], {
    cwd: EXPORTER, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, HOTELTIME_USERNAME: '', HOTELTIME_PASSWORD: '' }, // ไม่มีบัญชีก็ต้องปฏิเสธได้ — ยืนยันว่าไม่ไปถึงขั้น login
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('🔴 --baseline กับรายงาน snapshot ใบเดียว = ปฏิเสธ บอกเหตุผล (ไม่มี stack)', () => {
  const r = run('--report', 'arrivals', '--baseline', '--from', '11/10/2026', '--to', '13/10/2026');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /arrivals[\s\S]*รายงาน snapshot ไม่มี baseline/);
  assert.doesNotMatch(r.out, /at .*\.ts:\d+/);
});

test('🔴 --baseline ที่ช่วงถึงวันนี้ = ปฏิเสธ บอกว่าดึงได้ถึงเมื่อวาน (ไม่มี stack)', () => {
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('/');
  const r = run('--report', 'postings', '--baseline', '--from', '01/10/2026', '--to', today);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ดึงได้ถึงเมื่อวาน/);
  assert.doesNotMatch(r.out, /at .*\.ts:\d+/);
});
