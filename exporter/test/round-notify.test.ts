import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DISCORD_COLOR, snapshotSlotAlert } from '../src/core/discord.ts';
import { dailyFolder } from '../src/core/placement.ts';
import { roundId } from '../src/core/run-planner.ts';
import { loginFailureReason, recordRun, type ReportOutcome } from '../src/core/run-record.ts';
import { notifyRound } from '../src/notify.ts';
import { utcDate } from '../src/core/order.ts';

/** exporter-hoteltime-4h-rounds ticket 08 (ส่วนแจ้งเตือน): รอบล้มทั้งชุด → เตือนครั้งเดียวต่อรอบต่อวัน · ล้มบางรายงานไม่เตือน */

const NOW = new Date('2026-11-18T12:10:00+07:00');
const failed = (id: string, error: string): ReportOutcome => ({ report: id, status: 'failed', error, attempts: 3 });
const ok = (id: string): ReportOutcome => ({ report: id, status: 'ok', rows: 1, range: { from: '2026-11-18', to: '2026-11-18' }, actualRange: null, files: [], attempts: 1 });

async function dataDirWith(...outcomes: ReportOutcome[]): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'round-notify-'));
  const day = utcDate(2026, 11, 18);
  await recordRun(dailyFolder(dataDir, 'hoteltime', { from: day, to: day }), {
    site: 'hoteltime', kind: 'daily', dataThrough: '2026-11-18', startedAt: NOW, finishedAt: NOW, outcomes,
  });
  return dataDir;
}
const run = (dataDir: string, slot: string) => notifyRound({ slot, now: NOW, dataDir, envFile: path.join(dataDir, 'none.env'), dryRun: true });

test('alert ของรอบดึง: key/หัวข้อแยกจาก snapshot round เดิม', () => {
  const failedAll = [{ report: 'arrivals', error: loginFailureReason('wrong password') }];
  const a = snapshotSlotAlert({ slot: '12', day: '2026-11-18', at: '2026-11-18 12:10', total: 1, failed: failedAll, kind: 'round' })!;
  assert.match(a.content, /### HotelTime extraction round 12:00 failed/);
  assert.deepEqual(a.keys, ['round-failed@hoteltime@12@2026-11-18']);
  assert.equal(a.accentColor, DISCORD_COLOR.problem);
  assert.deepEqual(snapshotSlotAlert({ slot: '12', day: '2026-11-18', at: 'x', total: 1, failed: failedAll })!.keys, ['slot-failed@hoteltime@12@2026-11-18']);
});

test('notifyRound: ทุกรายงานของรอบล้ม → เตือน 1 ข้อความ · ล้มบางรายงาน/รอบอื่นล้ม → ไม่เตือน', async () => {
  const all = await dataDirWith(failed(roundId('arrivals', '12'), 'Timeout'), failed(roundId('postings', '12'), 'Timeout'));
  const r = await run(all, '12');
  assert.equal(r.status, 'dry-run');
  assert.equal(r.status === 'dry-run' ? r.messages.length : -1, 1);

  const partly = await dataDirWith(failed(roundId('arrivals', '12'), 'Timeout'), ok(roundId('postings', '12')));
  assert.deepEqual(await run(partly, '12'), { status: 'sent', messages: 0 });

  const otherRound = await dataDirWith(failed(roundId('arrivals', '08'), 'Timeout'));
  assert.deepEqual(await run(otherRound, '12'), { status: 'sent', messages: 0 }); // รอบ 12 ไม่มีผลเลย = ไม่เตือน (ยังไม่ถึงเวลา/ปิดไว้ไม่นับเป็นล้ม)
});

test('notifyRound: ชั่วโมงที่ไม่ใช่รอบ → skipped พร้อมเหตุผล ไม่เงียบ · redo ของเมื่อวานไม่ใช่เหตุเตือน', async () => {
  const dir = await dataDirWith(failed(roundId('arrivals', '12'), 'Timeout'));
  const r = await run(dir, '99');
  assert.equal(r.status, 'skipped');
  assert.match(r.status === 'skipped' ? r.reason : '', /unknown round "99"/);
  const redoOnly = await dataDirWith(failed('arrivals@redo-12', 'Timeout'));
  assert.deepEqual(await run(redoOnly, '12'), { status: 'sent', messages: 0 });
});
