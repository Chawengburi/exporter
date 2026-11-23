import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROUND_HOURS, planRound, type PlannedReport, type StoreState } from '../src/core/run-planner.ts';
import type { RunRecord } from '../src/core/run-record.ts';
import { buildStatus, type Folder, type StatusSetup, type StoreSnapshot } from '../src/core/status.ts';

/**
 * รายงานล่วงหน้า ticket 04 (ADR-0015, seam 3): `exporter status` มีบรรทัดแยกของ arrival-ahead — ไม่นับใน "snapshot N/N", ความล้มไม่ทำให้วันใด "ไม่ครบ"
 * และไม่ถูกเก็บตก · 0 แถว = "ว่าง" ไม่ใช่ล้ม · ข้อความมีแต่จำนวนแถวและช่วงวัน
 */

const thai = (iso: string) => new Date(`${iso}+07:00`);
const HT: readonly PlannedReport[] = [
  { id: 'postings', family: 'per-day' },
  { id: 'arrivals', family: 'picture', period: 'none' },
];
const SETUP: StatusSetup = { catalog: { hoteltime: HT, foodstory: [] }, goLive: '2026-10-12', webhookExport: true, webhookUpload: true, foodstoryScheduled: false };
const NOW = thai('2026-10-14T20:05');

type Out = RunRecord['reports'][string];
const ok = (id: string, finishedAt: string, rows = 5, range = { from: '2026-10-14', to: '2026-10-14' }): Out =>
  ({ report: id, status: 'ok', rows, range, actualRange: null, files: [], attempts: 1, finishedAt });
const failed = (id: string, finishedAt: string, error: string): Out => ({ report: id, status: 'failed', error, attempts: 3, finishedAt });

function folder(day: string, reports: Record<string, Out>): Folder {
  const runs = Object.values(reports).map((o) => ({ startedAt: o.finishedAt, finishedAt: o.finishedAt, reports: [o.report] }));
  return { day, record: { site: 'hoteltime', kind: 'daily', dataThrough: day, runs, reports, skipped: [] } };
}
/** วันที่ 12, 13 ครบ (per-day ของวันก่อน ถูกดึงวันถัดไปอยู่ใน folder ของวันของข้อมูลเอง) · วันนี้ (14) snapshot ครบ */
const baseReports = (day: string): Record<string, Out> => ({
  postings: ok('postings', `${day}T06:00:00.000Z`),
  arrivals: ok('arrivals', `${day}T06:00:00.000Z`),
  'arrivals@round-23': ok('arrivals@round-23', `${day}T16:30:00.000Z`),
});
const snapshotWith = (extra: Record<string, Out>): StoreSnapshot => ({
  hoteltime: [
    folder('2026-10-12', baseReports('2026-10-12')),
    folder('2026-10-13', baseReports('2026-10-13')),
    folder('2026-10-14', { arrivals: ok('arrivals', '2026-10-14T05:00:00.000Z'), ...extra }),
  ],
  foodstoryDaily: [],
  foodstoryMonthly: [],
});
const hotelLines = (r: ReturnType<typeof buildStatus>) => r.sections[0]!.lines.map((l) => l.text);
const AHEAD_RANGE = { from: '2026-10-14', to: '2026-10-28' };

test('ไม่เคยมีผล arrival-ahead (ปิดอยู่) → ไม่มีบรรทัดของรายงานล่วงหน้าเลย', () => {
  const r = buildStatus(snapshotWith({}), NOW, SETUP);
  assert.ok(!hotelLines(r).some((l) => l.includes('arrival-ahead')));
});

test('🔴 สำเร็จ: มีบรรทัดแยก (เวลาที่ได้, จำนวนแถว, ช่วง) · บรรทัดวัน/สรุป/"snapshot N/N" เหมือนไม่มี arrival-ahead เลย', () => {
  const base = buildStatus(snapshotWith({}), NOW, SETUP);
  const r = buildStatus(snapshotWith({ 'arrival-ahead@round-12': ok('arrival-ahead@round-12', '2026-10-14T05:10:00.000Z', 48, AHEAD_RANGE) }), NOW, SETUP);
  const line = hotelLines(r).filter((l) => l.includes('arrival-ahead'));
  assert.equal(line.length, 1, hotelLines(r).join('\n'));
  assert.match(line[0]!, /48/);
  assert.match(line[0]!, /2026-10-14/);
  assert.match(line[0]!, /2026-10-28/);
  assert.deepEqual(hotelLines(r).filter((l) => !l.includes('arrival-ahead')), hotelLines(base));
  assert.equal(r.verdict, base.verdict);
  assert.deepEqual([r.problems, r.actions], [base.problems, base.actions]);
});

test('🔴 ล้ม (รายงานอื่นสำเร็จ): บรรทัดแยกบอกว่าล้มและครั้งล่าสุดที่สำเร็จ · ไม่มีวันใด "ไม่ครบ" · verdict/ปัญหา/สิ่งที่ต้องทำไม่เปลี่ยน', () => {
  const base = buildStatus(snapshotWith({}), NOW, SETUP);
  const r = buildStatus(snapshotWith({
    'arrival-ahead@round-12': ok('arrival-ahead@round-12', '2026-10-14T05:10:00.000Z', 48, AHEAD_RANGE),
    'arrival-ahead@round-16': failed('arrival-ahead@round-16', '2026-10-14T09:10:00.000Z', 'ชนเพดาน 2000 แถว'),
  }), NOW, SETUP);
  const line = hotelLines(r).filter((l) => l.includes('arrival-ahead'));
  assert.equal(line.length, 1);
  assert.match(line[0]!, /ล้ม/);
  assert.match(line[0]!, /48/); // ครั้งล่าสุดที่สำเร็จ
  assert.deepEqual(hotelLines(r).filter((l) => !l.includes('arrival-ahead')), hotelLines(base));
  assert.equal(r.verdict, base.verdict);
  assert.deepEqual([r.problems, r.actions], [base.problems, base.actions]);
  assert.ok(!hotelLines(r).some((l) => l.includes('ไม่ครบ') && !l.includes('arrival-ahead')));
});

test('0 แถว = "ว่าง" ไม่ใช่ล้ม', () => {
  const r = buildStatus(snapshotWith({ 'arrival-ahead@round-12': ok('arrival-ahead@round-12', '2026-10-14T05:10:00.000Z', 0, AHEAD_RANGE) }), NOW, SETUP);
  const line = hotelLines(r).find((l) => l.includes('arrival-ahead'))!;
  assert.match(line, /ว่าง/);
  assert.doesNotMatch(line, /ล้ม/);
});

test('ผลใหม่สุดชนะ: ล้มแล้วรอบถัดไปสำเร็จ → บรรทัดบอกสำเร็จ ไม่ค้างว่าล้ม', () => {
  const r = buildStatus(snapshotWith({
    'arrival-ahead@round-12': failed('arrival-ahead@round-12', '2026-10-14T05:10:00.000Z', 'x'),
    'arrival-ahead@round-16': ok('arrival-ahead@round-16', '2026-10-14T09:10:00.000Z', 40, AHEAD_RANGE),
  }), NOW, SETUP);
  const line = hotelLines(r).find((l) => l.includes('arrival-ahead'))!;
  assert.match(line, /40/);
  assert.doesNotMatch(line, /ล้ม/);
});

test('🔴 ไม่ถูกเก็บตก: arrival-ahead ที่ล้มไม่โผล่ใน catchUp/redo/today ของผังรอบใด — รอบถัดไปถ่ายใหม่เอง (id ต่อรอบ)', () => {
  const list: readonly PlannedReport[] = [{ id: 'postings', family: 'per-day' }, { id: 'arrival-ahead', family: 'picture', lookahead: true }];
  const state: StoreState = new Map([['arrival-ahead@round-12@2026-10-14', 'failed']]);
  for (const round of ROUND_HOURS) {
    const hh = { '04': '04:05', '08': '08:05', '12': '12:05', '16': '16:05', '20': '20:05', '23': '23:05' }[round];
    const p = planRound({ now: thai(`2026-10-14T${hh}`), round, enabled: ROUND_HOURS, reports: list, state });
    assert.ok(![...p.catchUp, ...p.redoYesterday, ...p.today].some((i) => i.report === 'arrival-ahead'), `รอบ ${round}`);
  }
  const next = planRound({ now: thai('2026-10-14T16:05'), round: '16', enabled: ROUND_HOURS, reports: list, state });
  assert.ok(next.pictures.some((i) => i.report === 'arrival-ahead'));
});
