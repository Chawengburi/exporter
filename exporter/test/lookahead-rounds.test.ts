import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  ROUND_HOURS,
  parseLookaheadDays,
  planRound,
  withLookahead,
  type PlannedReport,
  type StoreState,
} from '../src/core/run-planner.ts';
import { formatISO, utcDate } from '../src/core/order.ts';
import { ConfigError, loadConfig } from '../src/sites/hoteltime/config.ts';
import { REPORTS, plannedOutsideRounds, plannedReports, toPlanned } from '../src/sites/hoteltime/reports/index.ts';

/** รายงานล่วงหน้า ticket 02 (ADR-0015) — seam 1: ตัวอ่านตัวแปร `HOTELTIME_LOOKAHEAD_DAYS` + ผังรอบ */

test('parseLookaheadDays: ไม่ตั้ง/ว่าง = ปิด · จำนวนเต็ม 1–60 = N', () => {
  assert.deepEqual(parseLookaheadDays(undefined), { days: null });
  assert.deepEqual(parseLookaheadDays(''), { days: null });
  assert.deepEqual(parseLookaheadDays('   '), { days: null });
  assert.deepEqual(parseLookaheadDays('14'), { days: 14 });
  assert.deepEqual(parseLookaheadDays(' 7 '), { days: 7 });
  assert.deepEqual(parseLookaheadDays('1'), { days: 1 });
  assert.deepEqual(parseLookaheadDays('60'), { days: 60 });
});

test('🔴 parseLookaheadDays: "0", "61", "abc", "1.5", "-3", "1e1" = error ที่บอกชื่อตัวแปร (ไม่เงียบ)', () => {
  for (const bad of ['0', '61', 'abc', '1.5', '-3', '1e1', '14d', 'off']) {
    const r = parseLookaheadDays(bad);
    assert.ok('error' in r, `${bad} ต้องเป็น error`);
    assert.match((r as { error: string }).error, /HOTELTIME_LOOKAHEAD_DAYS/);
  }
});

const KEY = 'HOTELTIME_LOOKAHEAD_DAYS';
let saved: string | undefined;
beforeEach(() => { saved = process.env[KEY]; delete process.env[KEY]; });
afterEach(() => { if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved; });

test('loadConfig: lookaheadDays — ไม่ตั้ง = null · "14" = 14 · ค่าผิดโยน ConfigError ตอนเริ่ม', () => {
  assert.equal(loadConfig().lookaheadDays, null);
  process.env[KEY] = '14';
  assert.equal(loadConfig().lookaheadDays, 14);
  process.env[KEY] = '99';
  assert.throws(() => loadConfig(), (e: Error) => e instanceof ConfigError && /HOTELTIME_LOOKAHEAD_DAYS/.test(e.message));
});

const AHEAD = { id: 'arrival-ahead', family: 'picture', lookahead: true } as const satisfies PlannedReport;
const LIST: readonly PlannedReport[] = [
  { id: 'reservations-search', family: 'per-day' },
  { id: 'arrivals', family: 'picture', refreshAtHour: 18 },
  AHEAD,
];
const thai = (hhmm: string) => new Date(`2026-11-18T${hhmm}:00+07:00`);
const ids = (rs: readonly PlannedReport[]) => rs.map((r) => r.id);

test('withLookahead: ปิด (null) ตัดรายงานล่วงหน้าออก · เปิดเก็บไว้ · รายงานอื่นไม่ถูกแตะ', () => {
  assert.deepEqual(ids(withLookahead(LIST, null)), ['reservations-search', 'arrivals']);
  assert.deepEqual(ids(withLookahead(LIST, 14)), ['reservations-search', 'arrivals', 'arrival-ahead']);
});

const WINDOWS: Record<string, string> = { '04': '04:05', '08': '08:05', '12': '12:05', '16': '16:05', '20': '20:05', '23': '23:05' };
const plan = (round: (typeof ROUND_HOURS)[number], reports: readonly PlannedReport[], state: StoreState = new Map()) =>
  planRound({ now: thai(WINDOWS[round]!), round, enabled: ROUND_HOURS, reports, state });

test('เปิดแล้ว ทุกรอบมี arrival-ahead ของวันนี้ใน snapshot ของรอบ', () => {
  for (const r of ROUND_HOURS) {
    const p = plan(r, withLookahead(LIST, 14));
    assert.ok(p.pictures.some((i) => i.report === 'arrival-ahead' && i.day === '2026-11-18'), `รอบ ${r}`);
  }
});

test('🔴 ปิดอยู่ (ไม่ตั้งตัวแปร) ไม่มี arrival-ahead ในรอบใดเลย', () => {
  for (const r of ROUND_HOURS) assert.ok(!plan(r, withLookahead(LIST, null)).pictures.some((i) => i.report === 'arrival-ahead'), `รอบ ${r}`);
});

test('🔴 รอบ 04/08/12 ที่ดึงซ้ำ/เก็บตกของเมื่อวาน ไม่มี arrival-ahead ของเมื่อวาน · HOTELTIME_ROUNDS=off (enabled ว่าง) = ไม่มีแผนเลย', () => {
  for (const r of ['04', '08', '12'] as const) {
    const p = plan(r, withLookahead(LIST, 14));
    assert.ok(![...p.redoYesterday, ...p.catchUp, ...p.today].some((i) => i.report === 'arrival-ahead'), `รอบ ${r}`);
  }
  const off = planRound({ now: thai('08:05'), round: '08', enabled: [], reports: withLookahead(LIST, 14), state: new Map() });
  assert.equal(off.run, false);
  assert.deepEqual(off.pictures, []);
});

test('ผลของรอบก่อนหน้าไม่บังรอบถัดไป: arrival-ahead ของรอบ 08 สำเร็จแล้ว รอบ 12 ยังถ่ายใหม่ (id ต่อรอบ)', () => {
  const state: StoreState = new Map([['arrival-ahead@round-08@2026-11-18', 'data']]);
  assert.ok(plan('12', withLookahead(LIST, 14), state).pictures.some((i) => i.report === 'arrival-ahead'));
});

test('แคตตาล็อกจริง: arrival-ahead ติดธง lookahead ใน toPlanned แต่ plannedReports() (ใช้กับ status) ไม่นับ', () => {
  const real = REPORTS.find((r) => r.id === 'arrival-ahead')!;
  assert.equal(toPlanned(real).lookahead, true);
  assert.ok(!plannedReports().some((r) => r.id === 'arrival-ahead'));
  assert.ok(REPORTS.filter((r) => r.id !== 'arrival-ahead').every((r) => toPlanned(r).lookahead !== true));
});

test('ช่วงคงที่ทุกรอบ: ช่วงของ arrival-ahead ขึ้นกับวันของรอบ + N เท่านั้น (ไม่ขึ้นกับรอบ)', () => {
  const real = REPORTS.find((r) => r.id === 'arrival-ahead')!;
  process.env[KEY] = '14';
  const day = utcDate(2026, 11, 18);
  const w = real.requestWindow!(day);
  assert.equal(formatISO(w.from), '2026-11-18');
  assert.equal(formatISO(w.to), '2026-12-02');
});

test('ธง lookahead ประกาศชัดเจนในนิยามรายงาน (ไม่อนุมานจาก requestWindow) · จุดกรองจุดเดียว plannedOutsideRounds ใช้ร่วมกับ plannedReports', () => {
  assert.deepEqual(REPORTS.filter((r) => r.lookahead === true).map((r) => r.id), ['arrival-ahead']);
  // รายงานที่มี requestWindow แต่ไม่ประกาศ lookahead จะไม่ถูกปฏิบัติเป็นรายงานล่วงหน้า
  const real = REPORTS.find((r) => r.id === 'arrival-ahead')!;
  const withoutFlag = { ...real, id: 'x', lookahead: undefined };
  assert.equal(toPlanned(withoutFlag).lookahead, undefined);
  assert.ok(!plannedOutsideRounds().some((r) => r.id === 'arrival-ahead'));
  assert.deepEqual(plannedOutsideRounds().map((r) => r.id), plannedReports().map((r) => r.id));
  assert.deepEqual(plannedOutsideRounds([real]), []); // ส่งรายการที่ขอเองก็ถูกกรองเหมือนกัน
});
