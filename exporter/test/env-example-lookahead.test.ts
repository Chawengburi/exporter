import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLookaheadDays } from '../src/core/run-planner.ts';

/**
 * รายงานล่วงหน้า ticket 06 (ADR-0015): `.env.example` คือไฟล์พร้อมใช้ที่ตัวติดตั้งคัดลอกเป็น `.env` ของ Ubuntu — `HOTELTIME_LOOKAHEAD_DAYS` ต้องว่าง
 * ไม่งั้นติดตั้งใหม่แล้วเปิดรายงานล่วงหน้าเองก่อนที่ Gold จะรองรับ · (ตัวติดตั้งจริงทดสอบใน deploy/ubuntu/test-install-in-docker.sh)
 */
const lines = readFileSync(new URL('../.env.example', import.meta.url), 'utf8').split('\n');

test('🔴 .env.example มี HOTELTIME_LOOKAHEAD_DAYS บรรทัดเดียว และ**ว่าง** (ตัวติดตั้งไม่เปิดรายงานล่วงหน้าเอง)', () => {
  const mine = lines.filter((l) => /^\s*#?\s*HOTELTIME_LOOKAHEAD_DAYS\s*=/.test(l));
  assert.deepEqual(mine, ['HOTELTIME_LOOKAHEAD_DAYS='], 'ต้องเป็นบรรทัดจริงที่ว่าง ไม่ใช่ค่า 14 และไม่ใช่บรรทัดคอมเมนต์');
  assert.deepEqual(parseLookaheadDays(''), { days: null }); // ว่าง = ปิด
});

test('คำอธิบายใต้หัวข้ออยู่บรรทัดก่อนตัวแปร และบอกว่าว่าง = ปิด', () => {
  const i = lines.indexOf('HOTELTIME_LOOKAHEAD_DAYS=');
  const above = lines.slice(Math.max(0, i - 4), i).join('\n');
  assert.match(above, /look-ahead|ล่วงหน้า/i);
  assert.match(above, /empty|ว่าง/i);
});
