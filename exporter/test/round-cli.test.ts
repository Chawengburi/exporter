import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

/**
 * exporter-hoteltime-4h-rounds ticket 04: `export --round HH` ผ่าน CLI จริง — เฉพาะทางที่ไม่ต้องใช้เบราว์เซอร์/credential/นาฬิกาจริง
 * (กติกาหน้าต่าง/แผนอยู่ที่ rounds.test.ts และ round-plan.test.ts)
 */
const run = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, ['src/index.ts', 'export', ...args], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, HOTELTIME_USERNAME: '', HOTELTIME_PASSWORD: '', DISCORD_WEBHOOK_URL_EXPORT: '', ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('รอบที่ไม่อยู่ในรายการ: ออก 0 ทันทีโดยไม่ login (ไม่มี credential ก็ไม่ล้ม)', () => {
  const r = run(['--report', 'all', '--round', '12'], { HOTELTIME_ROUNDS: '08,16' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /round 12 is switched off/);
});

test('HOTELTIME_ROUNDS=off ปิดทุกรอบ · --json บอกเหตุผล', () => {
  const r = run(['--report', 'all', '--round', '08', '--json'], { HOTELTIME_ROUNDS: 'off' });
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(r.out.slice(0, r.out.indexOf('}\n') + 1)).code, 'round_disabled');
});

test('ชั่วโมงที่ไม่ใช่รอบถูกปฏิเสธ (หน้าต่างเวลาทดสอบที่ gateRound ใน rounds.test.ts)', () => {
  const r = run(['--report', 'all', '--round', '99'], { HOTELTIME_ROUNDS: 'off' });
  assert.equal(r.code, 1);
  assert.match(r.out, /--round must be one of/);
});

test('HOTELTIME_ROUNDS พิมพ์ผิด = ปฏิเสธ (exit 1) ไม่เงียบ · ใช้ร่วมกับโหมดอื่นไม่ได้ · FoodStory ไม่มีรอบ', () => {
  const typo = run(['--report', 'all', '--round', '12'], { HOTELTIME_ROUNDS: '08,09' });
  assert.equal(typo.code, 1);
  assert.match(typo.out, /unknown round "09"/);
  const combined = run(['--report', 'all', '--round', '12', '--daily'], { HOTELTIME_ROUNDS: '12' });
  assert.equal(combined.code, 1);
  assert.match(combined.out, /cannot be combined/);
  const both = run(['--report', 'all', '--round', '12', '--snapshot-slot', '23'], { HOTELTIME_ROUNDS: '12' });
  assert.equal(both.code, 1);
  const fs = run(['--site', 'foodstory', '--report', 'all', '--round', '12']);
  assert.equal(fs.code, 1);
  assert.match(fs.out, /HotelTime only/);
});

test('--round รับเฉพาะ --report all (รอบดึงคือชุดเต็ม)', () => {
  const r = run(['--report', 'postings', '--round', '12'], { HOTELTIME_ROUNDS: '12' });
  assert.equal(r.code, 1);
  assert.match(r.out, /--report all/);
});
