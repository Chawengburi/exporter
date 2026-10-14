import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_BASELINE_INTERVAL_DAYS,
  formatDMY,
  partitionForRunAll,
  resolveRunPlan,
  utcDate,
} from '../src/core/order.ts';

const TODAY = utcDate(2026, 9, 18);

test('--daily — ชนิดรอบรายวัน (วันจริงมาจากตัววางแผน ไม่มีช่วงเหลื่อมแล้ว ADR-0008)', () => {
  const plan = resolveRunPlan({ daily: true }, TODAY);
  assert.equal(plan.kind, 'daily');
  assert.equal(formatDMY(plan.range.from), '18/09/2026');
  assert.equal(formatDMY(plan.range.to), '18/09/2026');
});

test('🔴 --baseline ค่าเริ่มต้น (ใบ 09 — เจ้าของเลือก 2026-10-14) — 30 วันของข้อมูลล่าสุดถึงเมื่อวาน ไม่รวมวันนี้ (ยังไม่ครบ)', () => {
  const plan = resolveRunPlan({ baseline: true }, TODAY);
  assert.equal(plan.kind, 'baseline');
  assert.equal(formatDMY(plan.range.from), '19/08/2026'); // 19/08–17/09 = 30 วัน
  assert.equal(formatDMY(plan.range.to), '17/09/2026');
  assert.equal(plan.baselineIntervalDays, DEFAULT_BASELINE_INTERVAL_DAYS);
});

test('--baseline --baseline-interval-days 14 — ปรับความถี่ที่บันทึกได้ และช่วงเริ่มต้นเป็น 14 วันถึงเมื่อวาน', () => {
  const plan = resolveRunPlan({ baseline: true, baselineIntervalDays: 14 }, TODAY);
  assert.equal(plan.baselineIntervalDays, 14);
  assert.equal(formatDMY(plan.range.from), '04/09/2026');
  assert.equal(formatDMY(plan.range.to), '17/09/2026');
});

test('🔴 --baseline --from --to — ดึงวันของข้อมูลช่วงที่สั่ง · ถึงวันนี้หรืออนาคต = ปฏิเสธ (วันนี้ยังไม่ครบ)', () => {
  const plan = resolveRunPlan({ baseline: true, from: '11/09/2026', to: '13/09/2026' }, TODAY);
  assert.equal(plan.kind, 'baseline');
  assert.equal(formatDMY(plan.range.from), '11/09/2026');
  assert.equal(formatDMY(plan.range.to), '13/09/2026');
  assert.throws(() => resolveRunPlan({ baseline: true, from: '11/09/2026', to: '18/09/2026' }, TODAY), /วันนี้/);
  assert.throws(() => resolveRunPlan({ baseline: true, from: '11/09/2026' }, TODAY), /--to/);
});

test('ไม่ระบุโหมดเลย — เป็น manual เหมือนพฤติกรรมเดิมทั้งหมด', () => {
  const plan = resolveRunPlan({}, TODAY);
  assert.equal(plan.kind, 'manual');
  assert.equal(formatDMY(plan.range.from), '01/01/2024');
  assert.equal(formatDMY(plan.range.to), '18/09/2026');
  assert.equal(plan.baselineIntervalDays, undefined);
});

test('manual ยังรับ --last-days ได้ตามเดิม', () => {
  const plan = resolveRunPlan({ lastDays: 7 }, TODAY);
  assert.equal(plan.kind, 'manual');
  assert.equal(formatDMY(plan.range.from), '12/09/2026');
});

test('--daily พร้อมกับ --from ต้องถูกปฏิเสธ', () => {
  assert.throws(() => resolveRunPlan({ daily: true, from: '01/06/2026' }, TODAY));
});

test('--baseline พร้อมกับ --last-days ต้องถูกปฏิเสธ', () => {
  assert.throws(() => resolveRunPlan({ baseline: true, lastDays: 7 }, TODAY));
});

test('--daily กับ --baseline พร้อมกันต้องถูกปฏิเสธ', () => {
  assert.throws(() => resolveRunPlan({ daily: true, baseline: true }, TODAY));
});

test('--baseline-interval-days โดยไม่มี --baseline ต้องถูกปฏิเสธ', () => {
  assert.throws(() => resolveRunPlan({ baselineIntervalDays: 10 }, TODAY));
  assert.throws(() => resolveRunPlan({ daily: true, baselineIntervalDays: 10 }, TODAY));
});

// ── --report all กับรายงานรายวันอย่างเดียว (ADR-0003) ──
// เดิม --report all แบบไม่ใส่ --daily ส่งรายงาน dailyOnly เข้าไปด้วยแล้วโดน OrderError นับเป็น
// "ล้ม" ทั้ง 4 ใบ exit ไม่เป็นศูนย์ — ทั้งที่ไม่มีอะไรผิด แค่รอบนั้นไม่ใช่รอบรายวัน ตอนนี้ข้ามพร้อมเหตุผล

const RANGE_A = { id: 'reservations-search', dailyOnly: false };
const DAILY_A = { id: 'arrivals', dailyOnly: true };
const RANGE_B = { id: 'arrival-period', dailyOnly: false };
const ALL = [RANGE_A, DAILY_A, RANGE_B];

test('--report all ที่ไม่ใช่รายวัน (back-fill, --from/--to, --baseline) — รันเฉพาะรายงานช่วงวันที่ ข้าม dailyOnly พร้อมเหตุผล', () => {
  const { run, skipped } = partitionForRunAll(ALL);
  assert.deepEqual(run.map((r) => r.id), ['reservations-search', 'arrival-period']);
  assert.deepEqual(skipped.map((s) => s.report), ['arrivals']);
  assert.match(skipped[0]!.reason, /--daily/);
});
