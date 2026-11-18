import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATCH_UP_CAP_DAYS, DEFAULT_ROUNDS, planRound, redoId, roundId, ROUND_HOURS, type PlannedReport, type RoundHour, type StoreState } from '../src/core/run-planner.ts';

/** exporter-hoteltime-4h-rounds ticket 03: แผนต่อรอบ (seam 1 — ตัวผังรอบ) */

const REPORTS: readonly PlannedReport[] = [
  { id: 'reservations-search', family: 'per-day' },
  { id: 'postings', family: 'per-day' },
  { id: 'arrivals', family: 'picture', refreshAtHour: 18 },
  { id: 'trial-balance', family: 'picture', refreshAtHour: 18 },
];
const thai = (hhmm: string, day = '2026-11-18') => new Date(`${day}T${hhmm}:00+07:00`);
const store = (...entries: [string, 'data' | 'empty' | 'failed'][]): StoreState => new Map(entries);
const plan = (round: RoundHour, hhmm: string, state: StoreState = new Map(), extra: { goLive?: string | null; enabled?: readonly RoundHour[] } = {}) =>
  planRound({ now: thai(hhmm), round, enabled: extra.enabled ?? ROUND_HOURS, reports: REPORTS, state, goLive: extra.goLive ?? null });
const days = (items: readonly { report: string; day: string }[]) => items.map((i) => `${i.report}@${i.day}`);

const TODAY = '2026-11-18';
const YESTERDAY = '2026-11-17';

test('รอบ 04: snapshot ครบชุด + per-day ของวันนี้ · ไม่มีเมื่อวานเลย (ยังไม่ถึง 07:00)', () => {
  const p = plan('04', '04:05');
  assert.deepEqual(days(p.today), [`reservations-search@${TODAY}`, `postings@${TODAY}`]);
  assert.deepEqual(days(p.pictures), [`arrivals@${TODAY}`, `trial-balance@${TODAY}`]);
  assert.deepEqual(p.redoYesterday, []);
  assert.deepEqual(p.catchUp, []);
});

test('รอบ 08: วันนี้ + snapshot + ดึงซ้ำของเมื่อวานแม้สำเร็จแล้ว', () => {
  const done = store([`reservations-search@${YESTERDAY}`, 'data'], [`postings@${YESTERDAY}`, 'empty']);
  const p = plan('08', '08:05', done);
  assert.deepEqual(days(p.today), [`reservations-search@${TODAY}`, `postings@${TODAY}`]);
  assert.deepEqual(days(p.pictures), [`arrivals@${TODAY}`, `trial-balance@${TODAY}`]);
  assert.deepEqual(days(p.redoYesterday), [`reservations-search@${YESTERDAY}`, `postings@${YESTERDAY}`]);
  assert.deepEqual(p.catchUp, []);
});

test('รอบ 12: ดึงซ้ำเมื่อวานเหมือน 08', () => {
  const p = plan('12', '12:05', store([`reservations-search@${YESTERDAY}`, 'data'], [`postings@${YESTERDAY}`, 'data']));
  assert.deepEqual(days(p.redoYesterday), [`reservations-search@${YESTERDAY}`, `postings@${YESTERDAY}`]);
});

test('รอบ 16, 20, 23: ไม่ดึงเมื่อวานซ้ำ แต่ได้วันนี้ + snapshot', () => {
  for (const [r, t] of [['16', '16:05'], ['20', '20:05'], ['23', '23:05']] as const) {
    const p = plan(r, t, store([`reservations-search@${YESTERDAY}`, 'data'], [`postings@${YESTERDAY}`, 'data']));
    assert.deepEqual(p.redoYesterday, [], r);
    assert.equal(p.today.length, 2, r);
    assert.equal(p.pictures.length, 2, r);
  }
});

test('วันนี้ที่ดึงสำเร็จในรอบก่อนยังถูกดึงซ้ำในรอบถัดไป (ต่างจากเก็บตก) · แต่ผลของรอบนี้เองที่สำเร็จแล้วไม่ทำซ้ำ (cron สำรอง +30)', () => {
  const prev = store([`reservations-search@${TODAY}`, 'data'], [`${roundId('reservations-search', '08')}@${TODAY}`, 'data']);
  assert.equal(plan('12', '12:05', prev).today.some((i) => i.report === 'reservations-search'), true);
  const own = store(
    [`${roundId('reservations-search', '12')}@${TODAY}`, 'data'], [`${roundId('arrivals', '12')}@${TODAY}`, 'data'],
    [`${roundId('reservations-search', '12')}@${YESTERDAY}`, 'data'],
  );
  const p = plan('12', '12:35', own);
  assert.deepEqual(days(p.today), [`postings@${TODAY}`]);
  assert.deepEqual(days(p.pictures), [`trial-balance@${TODAY}`]);
  assert.equal(p.redoYesterday.some((i) => i.report === 'reservations-search'), false);
});

test('วันค้างเก่าถูกเติมตาม cap 3 วัน เอาใหม่ที่สุดก่อน · ที่เหลือนับเป็น backlog', () => {
  const p = plan('16', '16:05', new Map(), { goLive: '2026-11-10' });
  assert.equal(CATCH_UP_CAP_DAYS, 3);
  assert.deepEqual([...new Set(p.catchUp.map((i) => i.day))], ['2026-11-15', '2026-11-16', '2026-11-17']); // เรียงเก่า→ใหม่ เหมือน planDailyRun
  assert.equal(p.backlogDays, 5); // 10..14 ยังค้าง
});

test('รอบ 08/12: เมื่อวานที่ยังขาดอยู่เติมครั้งเดียว ไม่ซ้ำกับดึงซ้ำ', () => {
  const p = plan('08', '08:05', new Map());
  assert.deepEqual(days(p.catchUp), [`reservations-search@${YESTERDAY}`, `postings@${YESTERDAY}`]);
  assert.deepEqual(p.redoYesterday, []);
});

test('รอบ 04 เก็บตกวันก่อนเมื่อวานที่ขาดได้ (เมื่อวานยังไม่ถึงกำหนด)', () => {
  const p = plan('04', '04:05', new Map(), { goLive: '2026-11-16' });
  assert.deepEqual([...new Set(p.catchUp.map((i) => i.day))], ['2026-11-16']);
});

test('ค่า "ถึงกำหนด" ตรงกับ status: เมื่อวานถึงกำหนดที่ 07:00 (06:59 ไม่ใช่)', () => {
  assert.deepEqual(plan('08', '06:59').redoYesterday, []); // นอกหน้าต่าง
  assert.equal(plan('08', '07:00').run, false);
});

test('รอบนอกหน้าต่างหรือไม่อยู่ในรายการ → ไม่มีแผนเลย', () => {
  for (const p of [plan('08', '11:00'), plan('08', '08:05', new Map(), { enabled: ['12'] }), plan('23', '00:10')]) {
    assert.equal(p.run, false);
    assert.deepEqual([p.today, p.pictures, p.redoYesterday, p.catchUp], [[], [], [], []]);
  }
  assert.equal(plan('08', '08:05', new Map(), { enabled: DEFAULT_ROUNDS }).run, true);
});

test('storeStateFrom อ่านผลต่อรอบ (@round-HH) ทั้ง per-day ของวันนี้และ snapshot · id รอบไม่ทำให้ id ปกติของวันนั้นเสร็จ', async () => {
  const { storeStateFrom } = await import('../src/core/run-planner.ts');
  const out = (report: string, rows: number, day = TODAY) => ({
    report, status: 'ok' as const, rows, range: { from: day, to: day }, actualRange: null, files: [], attempts: 1, finishedAt: `${day}T05:00:00.000Z`,
  });
  const record = {
    site: 'hoteltime', kind: 'daily', dataThrough: TODAY,
    runs: [{ startedAt: `${TODAY}T05:00:00.000Z`, finishedAt: `${TODAY}T05:05:00.000Z`, reports: [] }],
    reports: { [roundId('postings', '12')]: out('x', 4), [redoId('postings', '12')]: out('x', 2), [roundId('arrivals', '12')]: out('x', 0), 'ghost@round-12': out('x', 1) },
    skipped: [],
  } as unknown as Parameters<typeof storeStateFrom>[0][number]['record'];
  const state = storeStateFrom([{ day: TODAY, record }], REPORTS);
  assert.equal(state.get(`postings@round-12@${TODAY}`), 'data');
  assert.equal(state.get(`arrivals@round-12@${TODAY}`), 'empty');
  assert.equal(state.get(`postings@redo-12@${TODAY}`), 'data');
  assert.equal(state.has(`postings@${TODAY}`), false);
  assert.equal(state.has(`ghost@round-12@${TODAY}`), false); // รายงานนอกแคตตาล็อกไม่นับ
});

test('🔴 ดึงซ้ำเมื่อวานที่ 08/12 ไม่ถูกกลบด้วยผล @round-HH ที่รอบเดียวกันบันทึกไว้ตอนเมื่อวานยังเป็น "วันนี้"', () => {
  // เมื่อวาน (D) รอบ 08 และ 12 ดึง per-day ของ D ในฐานะวันนี้ → บันทึก @round-08/@round-12 ของ D · id ปกติของ D ถูกเติมโดยเก็บตกที่ 08 ของ D+1
  const yesterdayAsToday = store(
    ...['08', '12'].flatMap((h) => ['reservations-search', 'postings'].map((r): [string, 'data'] => [`${roundId(r, h as RoundHour)}@${YESTERDAY}`, 'data'])),
    [`reservations-search@${YESTERDAY}`, 'data'], [`postings@${YESTERDAY}`, 'data'],
  );
  for (const [r, t] of [['08', '08:05'], ['12', '12:05']] as const) {
    assert.deepEqual(days(plan(r, t, yesterdayAsToday).redoYesterday), [`reservations-search@${YESTERDAY}`, `postings@${YESTERDAY}`], r);
  }
  // รอบเดียวกันที่ดึงซ้ำสำเร็จแล้ว (id redo ของรอบนี้) ไม่ทำซ้ำ — cron สำรอง +30 นาที
  const redone = store(...yesterdayAsToday, [`${redoId('reservations-search', '12')}@${YESTERDAY}`, 'data']);
  assert.deepEqual(days(plan('12', '12:35', redone).redoYesterday), [`postings@${YESTERDAY}`]);
});

test('shouldSendRoundSummary: รอบ 12/23 เท่านั้น · ครั้งแรกของรอบ หรือ retry ที่ซ่อมจนไม่เหลือที่ล้ม · ไม่ส่งเมื่อล้มทุกรายงาน (แจ้งเตือนรอบล้มแทน) · retry ที่ยังล้มอยู่ไม่ส่งซ้ำ', async () => {
  const { shouldSendRoundSummary } = await import('../src/core/run-planner.ts');
  const ok = { round: '12', firstRun: true, total: 52, failed: 0 };
  assert.equal(shouldSendRoundSummary(ok), true);
  assert.equal(shouldSendRoundSummary({ ...ok, round: '23' }), true);
  for (const r of ['04', '08', '16', '20']) assert.equal(shouldSendRoundSummary({ ...ok, round: r }), false, r);
  assert.equal(shouldSendRoundSummary({ ...ok, failed: 3 }), true); // ครั้งแรก ล้มบางรายงาน = สรุปบอกชื่อ
  assert.equal(shouldSendRoundSummary({ ...ok, failed: 52 }), false); // ล้มทุกรายงาน = ไม่ซ้ำกับแจ้งเตือนรอบล้ม
  assert.equal(shouldSendRoundSummary({ ...ok, firstRun: false, failed: 2 }), false); // retry ที่ยังล้มอยู่
  assert.equal(shouldSendRoundSummary({ ...ok, firstRun: false, total: 3, failed: 0 }), true); // retry ที่ซ่อมสำเร็จ
  assert.equal(shouldSendRoundSummary({ ...ok, total: 0, failed: 0 }), false); // ไม่มีงานจริง
});
