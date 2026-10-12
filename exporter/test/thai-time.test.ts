import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { utcDate } from '../src/core/order.ts';
import { runFolder } from '../src/core/placement.ts';
import { recordRun } from '../src/core/run-record.ts';
import { thaiToday } from '../src/core/thai-time.ts';

// ticket 27 — Windmill รัน job เป็น UTC (ไม่ส่ง TZ ของ container ต่อ) · เวลาทุกจุดต้องเป็นเวลาไทยโดยไม่ขึ้นกับ TZ ของเครื่อง
// เคสเลือกช่วง 00:00–07:00 เวลาไทย ที่วันไทยกับวัน UTC ต่างกัน

test('00:30 วันที่ 1 ต.ค. เวลาไทย (ยังเป็น 30 ก.ย. ตาม UTC) — วันนี้คือ 1 ต.ค.', () => {
  assert.deepEqual(thaiToday(new Date('2026-09-30T17:30:00Z')), utcDate(2026, 10, 1));
});

test('รอบ baseline ตอน 00:30 เวลาไทย ได้โฟลเดอร์ของวันใหม่ ไม่ใช่เมื่อวานตาม UTC', () => {
  const folder = runFolder('/p/data', 'hoteltime', 'baseline', null as never, new Date('2026-10-07T17:30:00Z'));
  assert.equal(folder, '/p/data/hoteltime/baseline/2026-10-08');
});

test('รอบที่จบ 11:48 UTC สรุปเขียน "รันล่าสุด" เป็น 18:48 เวลาไทย (เหตุการณ์จริง 2026-10-08)', async () => {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), 'thai-time-')), '2026-10-08');
  await recordRun(folder, {
    site: 'hoteltime',
    kind: 'daily',
    dataThrough: '2026-10-08',
    startedAt: new Date('2026-10-08T05:11:49Z'),
    finishedAt: new Date('2026-10-08T11:48:15Z'),
    outcomes: [],
  });
  const summary = await readFile(path.join(folder, '_summary.txt'), 'utf8');
  assert.match(summary, /รันล่าสุด 2026-10-08 18:48 /);
});
