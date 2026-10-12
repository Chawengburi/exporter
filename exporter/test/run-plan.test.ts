import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_BASELINE_INTERVAL_DAYS,
  DEFAULT_DAILY_OVERLAP_DAYS,
  formatDMY,
  partitionForRunAll,
  resolveDailyOnlyRange,
  resolveRunPlan,
  utcDate,
} from '../src/core/order.ts';

const TODAY = utcDate(2026, 9, 18);

test('--daily ค่าเริ่มต้น — ได้ช่วงเหลื่อม DEFAULT_DAILY_OVERLAP_DAYS วันรวมวันนี้', () => {
  const plan = resolveRunPlan({ daily: true }, TODAY);
  assert.equal(plan.kind, 'daily');
  assert.equal(formatDMY(plan.range.to), '18/09/2026');
  const expectedFrom = new Date(TODAY);
  expectedFrom.setUTCDate(expectedFrom.getUTCDate() - (DEFAULT_DAILY_OVERLAP_DAYS - 1));
  assert.equal(formatDMY(plan.range.from), formatDMY(expectedFrom));
});

test('--daily --overlap-days 5 — ปรับช่วงเหลื่อมได้', () => {
  const plan = resolveRunPlan({ daily: true, overlapDays: 5 }, TODAY);
  assert.equal(formatDMY(plan.range.from), '14/09/2026');
  assert.equal(formatDMY(plan.range.to), '18/09/2026');
});

test('--baseline ค่าเริ่มต้น — ได้ทั้งช่วงเหมือน back-fill พร้อม baselineIntervalDays เริ่มต้น', () => {
  const plan = resolveRunPlan({ baseline: true }, TODAY);
  assert.equal(plan.kind, 'baseline');
  assert.equal(formatDMY(plan.range.from), '01/01/2024');
  assert.equal(formatDMY(plan.range.to), '18/09/2026');
  assert.equal(plan.baselineIntervalDays, DEFAULT_BASELINE_INTERVAL_DAYS);
});

test('--baseline --baseline-interval-days 14 — ปรับความถี่ที่บันทึกได้', () => {
  const plan = resolveRunPlan({ baseline: true, baselineIntervalDays: 14 }, TODAY);
  assert.equal(plan.baselineIntervalDays, 14);
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

test('--overlap-days โดยไม่มี --daily ต้องถูกปฏิเสธ', () => {
  assert.throws(() => resolveRunPlan({ overlapDays: 5 }, TODAY));
  assert.throws(() => resolveRunPlan({ baseline: true, overlapDays: 5 }, TODAY));
});

test('--baseline-interval-days โดยไม่มี --baseline ต้องถูกปฏิเสธ', () => {
  assert.throws(() => resolveRunPlan({ baselineIntervalDays: 10 }, TODAY));
  assert.throws(() => resolveRunPlan({ daily: true, baselineIntervalDays: 10 }, TODAY));
});

// resolveDailyOnlyRange — รายงาน dailyOnly (ADR-0003)

test('dailyOnly: --daily ได้วันนี้วันเดียว ไม่ใช่ช่วงเหลื่อม overlap แบบรายงานปกติ', () => {
  const range = resolveDailyOnlyRange({ daily: true }, TODAY);
  assert.equal(formatDMY(range.from), '18/09/2026');
  assert.equal(formatDMY(range.to), '18/09/2026');
});

test('dailyOnly: ไม่ระบุ --daily เลยต้องถูกปฏิเสธ (manual mode ใช้ไม่ได้)', () => {
  assert.throws(() => resolveDailyOnlyRange({}, TODAY));
  assert.throws(() => resolveDailyOnlyRange({ lastDays: 3 }, TODAY));
});

test('dailyOnly: --baseline ต้องถูกปฏิเสธ — ไม่มี concept back-fill', () => {
  assert.throws(() => resolveDailyOnlyRange({ baseline: true }, TODAY));
});

test('dailyOnly: --from/--to ต้องถูกปฏิเสธแม้จะส่งมาพร้อม --daily ก็ตาม', () => {
  assert.throws(() => resolveDailyOnlyRange({ daily: true, from: '01/06/2026' }, TODAY));
});

test('dailyOnly: --overlap-days ต้องถูกปฏิเสธ แม้ค่าจะใช้ได้กับ --daily ปกติก็ตาม', () => {
  assert.throws(() => resolveDailyOnlyRange({ daily: true, overlapDays: 5 }, TODAY));
});

// ── --report all กับรายงานรายวันอย่างเดียว (ADR-0003) ──
// เดิม --report all แบบไม่ใส่ --daily ส่งรายงาน dailyOnly เข้าไปด้วยแล้วโดน OrderError นับเป็น
// "ล้ม" ทั้ง 4 ใบ exit ไม่เป็นศูนย์ — ทั้งที่ไม่มีอะไรผิด แค่รอบนั้นไม่ใช่รอบรายวัน ตอนนี้ข้ามพร้อมเหตุผล

const RANGE_A = { id: 'reservations-search', dailyOnly: false };
const DAILY_A = { id: 'arrivals', dailyOnly: true };
const RANGE_B = { id: 'arrival-period', dailyOnly: false };
const ALL = [RANGE_A, DAILY_A, RANGE_B];

test('--report all ไม่มี flag (back-fill) — รันเฉพาะรายงานช่วงวันที่ ข้าม dailyOnly พร้อมเหตุผล', () => {
  const { run, skipped } = partitionForRunAll(ALL, {}, TODAY);
  assert.deepEqual(run.map((r) => r.id), ['reservations-search', 'arrival-period']);
  assert.deepEqual(skipped.map((s) => s.report), ['arrivals']);
  assert.match(skipped[0]!.reason, /--daily/);
});

test('--report all --daily — รันครบทุกใบ ไม่ข้ามอะไร', () => {
  const { run, skipped } = partitionForRunAll(ALL, { daily: true }, TODAY);
  assert.deepEqual(run.map((r) => r.id), ['reservations-search', 'arrivals', 'arrival-period']);
  assert.deepEqual(skipped, []);
});

test('--report all --from/--to และ --baseline — ข้าม dailyOnly เหมือนกัน', () => {
  for (const opts of [{ from: '01/08/2026', to: '31/08/2026' }, { baseline: true }, { lastDays: 7 }]) {
    const { run, skipped } = partitionForRunAll(ALL, opts, TODAY);
    assert.equal(run.length, 2);
    assert.deepEqual(skipped.map((s) => s.report), ['arrivals']);
  }
});

test('flag ขัดแย้งกันยังโยนเหมือนเดิม — ไม่ถูกกลืนเป็น "ข้าม"', () => {
  assert.throws(() => partitionForRunAll(ALL, { daily: true, baseline: true }, TODAY));
});
