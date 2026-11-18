import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore — plain ESM without types (windmill/plan.mjs is data for setup.mjs, tested here without a Windmill)
import { desiredSchedules, JOBS, PIPELINE_JOBS, parseRoundsRaw, ROUND_HOURS } from '../../windmill/plan.mjs';
import { DEFAULT_ROUNDS, parseRounds, ROUND_HOURS as EXPORTER_ROUND_HOURS } from '../src/core/run-planner.ts';

/** exporter-hoteltime-4h-rounds ticket 10: what Windmill runs, as plain data */

type Sched = { job: { name: string }; suffix?: string; cron: string; summary: string; enabled: boolean; create: boolean };
const plan = (rounds: string[], slots: string[] = [], pipelineInstalled = true): Sched[] => desiredSchedules({ rounds, slots, pipelineInstalled });
const find = (s: Sched[], name: string, suffix?: string) => s.find((x) => x.job.name === name && x.suffix === suffix);
const ALL = [...DEFAULT_ROUNDS] as string[];

test('ตาราง HOTELTIME_ROUNDS ของ setup ตรงกับของ exporter ทุกกรณี (ไม่ตั้ง/ว่าง/off/รายการ/เลขหลักเดียว/พิมพ์ผิด) และชั่วโมงรอบตรงกัน', () => {
  assert.deepEqual([...ROUND_HOURS], [...EXPORTER_ROUND_HOURS]);
  for (const raw of [undefined, '', '  ', 'off', 'NONE', '08,12', '04, 23', '8,12', '23,08,08', '09', '08;12', 'xx', '06,23']) {
    const a = parseRoundsRaw(raw) as { rounds?: string[]; error?: string };
    const b = parseRounds(raw) as { rounds?: string[]; error?: string };
    assert.equal('error' in a, 'error' in b, `${raw}`);
    if (a.rounds) assert.deepEqual(a.rounds, [...(b.rounds ?? [])], `${raw}`);
  }
});

test('รอบเปิด: 6 รอบ + retry ลงทะเบียนและเปิดเสมอ · pipeline ตามหลังรอบที่เปิดเท่านั้น (+20 นาที) · ของเก่า (เที่ยง/15:00/18:00/slot) ปิด', () => {
  const s = plan(ALL, ['23']);
  for (const hh of ROUND_HOURS as string[]) {
    const first = find(s, 'pms_export_round', hh === '04' ? undefined : `r${hh}`)!;
    const retry = find(s, 'pms_export_round', `r${hh}retry`)!;
    assert.equal(first.cron, `0 0 ${Number(hh)} * * *`);
    assert.equal(retry.cron, `0 30 ${Number(hh)} * * *`);
    assert.equal(first.enabled && retry.enabled, true, hh);
    const pipe = find(s, 'ht_pipeline_daily', `r${hh}`)!;
    assert.equal(pipe.cron, `0 20 ${Number(hh)} * * *`);
    assert.equal(pipe.enabled, ALL.includes(hh), `pipeline ${hh}`);
    // อีกครั้งที่ :50 หลัง retry :30 — รอบที่ login ล้มแล้ว retry สำเร็จ D1 ไม่ต้องรอรอบ pipeline ถัดไป
    const after = find(s, 'ht_pipeline_daily', `r${hh}b`)!;
    assert.equal(after.cron, `0 50 ${Number(hh)} * * *`);
    assert.equal(after.enabled, ALL.includes(hh), `pipeline ${hh}:50`);
  }
  assert.equal(find(s, 'pms_export_daily')!.enabled, false);
  assert.equal(find(s, 'pms_export_daily_catchup')!.enabled, false);
  assert.equal(find(s, 'pms_export_snapshot_2300')!.enabled, false); // slot 23 ยังตั้งอยู่ แต่ไม่เปิดรอบเดิมซ้อนรอบใหม่
  assert.equal(find(s, 'pms_export_snapshot_2300', 'retry')!.enabled, false);
  assert.equal(find(s, 'ht_pipeline_daily')!.enabled, false); // 19:00 เดิม
  assert.equal(find(s, 'ht_pipeline_daily', '1245')!.enabled, false);
  assert.equal(find(s, 'ht_pipeline_daily', '2320')!.enabled, false);
});

test('HOTELTIME_ROUNDS=off: ตารางเดิมทำงานเหมือนเดิม (slot ตาม HOTELTIME_SNAPSHOT_SLOTS) · รอบใหม่ลงทะเบียนไว้แต่ pipeline ของรอบไม่เปิด', () => {
  const s = plan([], ['23']);
  assert.equal(find(s, 'pms_export_daily')!.enabled, true);
  assert.equal(find(s, 'pms_export_daily_catchup')!.enabled, true);
  assert.equal(find(s, 'pms_export_snapshot_2300')!.enabled, true);
  assert.equal(find(s, 'pms_export_snapshot_0600')!.enabled, true); // เหมือนเดิม: เปิดเสมอ แต่รันแล้วออกทันทีถ้า slot 06 ไม่ได้ตั้งใน HOTELTIME_SNAPSHOT_SLOTS
  assert.equal(find(s, 'ht_pipeline_daily')!.enabled, true);
  assert.equal(find(s, 'ht_pipeline_daily', '1245')!.enabled, true);
  assert.equal(find(s, 'ht_pipeline_daily', '2320')!.enabled, true);
  assert.equal(find(s, 'ht_pipeline_daily', '0620')!.enabled, false);
  assert.equal(find(s, 'ht_pipeline_daily', '0620')!.create, false); // slot ไม่เคยเปิด = ไม่ลงทะเบียน (เหมือนเดิม)
  assert.equal(find(s, 'pms_export_round', 'r12')!.enabled, true); // ลงทะเบียนเสมอ — รันแล้วออกทันทีเพราะ HOTELTIME_ROUNDS ไม่มีรอบนี้
  assert.equal(find(s, 'ht_pipeline_daily', 'r12')!.enabled, false);
  assert.equal(find(s, 'ht_pipeline_daily', 'r12')!.create, false); // ปิดและไม่เคยลงทะเบียน = ไม่สร้าง
  assert.equal(find(s, 'ht_pipeline_daily', 'r12b')!.enabled, false);
  assert.equal(find(s, 'ht_pipeline_daily', 'r12b')!.create, false);
});

test('FoodStory และ weekly verify ไม่เปลี่ยนตามโหมด · weekly verify (อาทิตย์ 00:30) ไม่ชนเวลาใดของรอบหรือ pipeline', () => {
  for (const s of [plan(ALL), plan([])]) {
    assert.equal(find(s, 'foodstory_export_daily')!.enabled, true);
    assert.equal(find(s, 'foodstory_export_daily_catchup')!.enabled, true);
    assert.equal(find(s, 'ht_pipeline_weekly_verify')!.enabled, true);
  }
  const times = plan(ALL).filter((x) => x.job.name !== 'ht_pipeline_weekly_verify' && x.job.name.startsWith('pms_export_round') || x.job.name === 'ht_pipeline_daily').map((x) => x.cron);
  assert.ok(!times.includes('0 30 0 * * *'));
  assert.ok(!times.some((c) => /^0 30 0 /.test(c)));
});

test('ไม่ติดตั้ง pipeline = ไม่มีงาน pipeline เลย · ชื่อ (path) ของสคริปต์เก่าไม่เปลี่ยน · ไม่มีชื่อสคริปต์/สรุปซ้ำ · summary แบบ "[Tool] System (times) What"', () => {
  assert.equal(plan(ALL, [], false).some((x) => x.job.name.startsWith('ht_pipeline')), false);
  const names = [...JOBS, ...PIPELINE_JOBS].map((j: { name: string }) => j.name);
  for (const old of ['pms_export_daily', 'pms_export_daily_catchup', 'foodstory_export_daily', 'foodstory_export_daily_catchup', 'pms_export_snapshot_0600', 'pms_export_snapshot_2300', 'ht_pipeline_daily', 'ht_pipeline_weekly_verify']) {
    assert.ok(names.includes(old), old);
  }
  assert.equal(new Set(names).size, names.length);
  const all = plan(ALL);
  const paths = all.map((x) => `${x.job.name}_${x.suffix ?? ''}`);
  assert.equal(new Set(paths).size, paths.length); // ไม่มี schedule path ซ้ำ
  for (const x of all) assert.match(x.summary, /^\[(Exporter|Pipeline)\] (HotelTime|FoodStory) \(/, x.summary);
});

test('สคริปต์รอบ: ชั่วโมงรอบในลูป shell ตรงกับ ROUND_HOURS · อัปโหลดเฉพาะรอบ 12 และไม่เมื่อรอบปิด/นอกหน้าต่าง (รหัสที่ export พิมพ์จริง)', async () => {
  const { readFileSync } = await import('node:fs');
  const script = readFileSync(new URL('../../windmill/scripts/pms_export_round.sh', import.meta.url), 'utf8');
  const loop = /for r in ([0-9 ]+); do/.exec(script)?.[1]?.trim().split(/\s+/);
  assert.deepEqual(loop, [...(ROUND_HOURS as string[])]);
  const exportSrc = readFileSync(new URL('../src/sites/hoteltime/export.ts', import.meta.url), 'utf8');
  for (const code of ['round_disabled', 'round_window_passed']) {
    assert.ok(script.includes(code), `script must not upload on ${code}`);
    assert.ok(exportSrc.includes(`'${code}'`), `export.ts no longer emits ${code}`);
  }
  assert.match(script, /\[ "\$ROUND" = "12" \]/);
});
