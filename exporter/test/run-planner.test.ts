import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunRecord } from '../src/core/run-record.ts';
import { daysToRead, planBaselineRun, planDailyRun, planDateRun, planWarnings, storeStateFrom, type PlannedReport, type StoreState } from '../src/core/run-planner.ts';

/**
 * ตัววางแผนรอบ (seam S1 ของ exporter-daily-per-day-raw) — ตอบว่า "รอบนี้ต้องทำอะไร" จากภาพรวมของที่เก็บข้อมูลอย่างเดียว ไม่แตะเบราว์เซอร์/ดิสก์
 * · ADR-0008: รายงานตามวันดึง **วันของข้อมูล = เมื่อวาน** (เวลาไทย) · รายงาน snapshot ถ่ายวันละครั้งจนกว่าจะสำเร็จ
 */

const REPORTS: readonly PlannedReport[] = [
  { id: 'reservations-search', family: 'per-day' },
  { id: 'postings', family: 'per-day' },
  { id: 'arrivals', family: 'picture' },
  { id: 'trial-balance', family: 'picture' },
];
const NOON_14 = new Date('2026-10-14T05:00:00Z'); // 12:00 เวลาไทย 14 ต.ค.
const EMPTY_STORE: StoreState = new Map();
/** เฉพาะรายการงาน (ไม่รวมตัวนับ/ธง) */
const work = (p: { perDay: unknown; pictures: unknown }) => ({ perDay: p.perDay, pictures: p.pictures });

test('วันปกติ ที่เก็บข้อมูลว่าง — รายงานตามวันดึงเมื่อวาน (13) ทุกตัว และถ่ายรายงาน snapshot ของวันนี้ (14) ทุกตัว', () => {
  const plan = planDailyRun({ now: NOON_14, reports: REPORTS, state: EMPTY_STORE });
  assert.deepEqual(work(plan), {
    perDay: [
      { report: 'reservations-search', day: '2026-10-13' },
      { report: 'postings', day: '2026-10-13' },
    ],
    pictures: [
      { report: 'arrivals', day: '2026-10-14' },
      { report: 'trial-balance', day: '2026-10-14' },
    ],
  });
});

test('รอบที่สองของวันหลังรอบเที่ยงสำเร็จหมด — ไม่มีงาน (ไม่ต้องเปิดเบราว์เซอร์)', () => {
  const state: StoreState = new Map([
    ['reservations-search@2026-10-13', 'data'], ['postings@2026-10-13', 'data'],
    ['arrivals@2026-10-14', 'data'], ['trial-balance@2026-10-14', 'data'],
  ]);
  const plan = planDailyRun({ now: new Date('2026-10-14T08:00:00Z'), reports: REPORTS, state });
  assert.deepEqual(work(plan), { perDay: [], pictures: [] });
});

test('ล้มถูกดึงซ้ำ · ว่าง (ตรวจแล้วว่าไม่มีรายการ) ไม่ถูกดึงซ้ำ', () => {
  const state: StoreState = new Map([
    ['reservations-search@2026-10-13', 'failed'], ['postings@2026-10-13', 'empty'],
    ['arrivals@2026-10-14', 'failed'], ['trial-balance@2026-10-14', 'empty'],
  ]);
  const plan = planDailyRun({ now: NOON_14, reports: REPORTS, state });
  assert.deepEqual(work(plan), {
    perDay: [{ report: 'reservations-search', day: '2026-10-13' }],
    pictures: [{ report: 'arrivals', day: '2026-10-14' }],
  });
});

test('snapshot ที่ถ่ายเมื่อวานไม่นับเป็น snapshot ของวันนี้ · รายงานตามวันของวันนี้ยังไม่ถึงกำหนด (วันนี้ยังไม่จบ)', () => {
  const state: StoreState = new Map([['arrivals@2026-10-13', 'data'], ['trial-balance@2026-10-13', 'data']]);
  const plan = planDailyRun({ now: NOON_14, reports: REPORTS, state });
  assert.deepEqual(plan.pictures.map((p) => p.day), ['2026-10-14', '2026-10-14']);
  assert.ok(plan.perDay.every((p) => p.day === '2026-10-13'));
});

test('🔴 วันตัดตามเวลาไทย ไม่ใช่ UTC — 00:30 ของวันที่ 14 (ยังเป็น 13 ใน UTC) snapshot เป็นของวันที่ 14', () => {
  const plan = planDailyRun({ now: new Date('2026-10-13T17:30:00Z'), reports: REPORTS, state: EMPTY_STORE });
  assert.deepEqual([...new Set(plan.pictures.map((p) => p.day))], ['2026-10-14']);
});

test('🔴 ก่อน 07:00 เวลาไทย รายงานตามวันของเมื่อวานยังไม่ถึงกำหนด — รายงานยกเลิกตัดวันตาม UTC วันของเมื่อวานจบตอน 07:00 ไทย', () => {
  const at0659 = planDailyRun({ now: new Date('2026-10-13T23:59:00Z'), reports: REPORTS, state: EMPTY_STORE });
  assert.deepEqual(at0659.perDay, []);
  const at0700 = planDailyRun({ now: new Date('2026-10-14T00:00:00Z'), reports: REPORTS, state: EMPTY_STORE });
  assert.deepEqual([...new Set(at0700.perDay.map((p) => p.day))], ['2026-10-13']);
});

/** _run.json ของโฟลเดอร์หนึ่งวันแบบย่อ — มีแค่ส่วนที่ตัววางแผนอ่าน */
const record = (reports: RunRecord['reports']): RunRecord => ({
  site: 'hoteltime', kind: 'daily', dataThrough: '2026-10-13', runs: [], reports, skipped: [],
});
const ok = (from: string, to: string, rows: number) => ({
  report: 'x', status: 'ok' as const, rows, range: { from, to }, actualRange: null, files: [], attempts: 1, finishedAt: '2026-10-14T05:10:00Z',
});

test('ภาพรวมจาก _run.json: มีแถว = มีข้อมูล · 0 แถว = ว่าง · ล้ม = ล้ม (วันของรายงานตามวัน = วันของโฟลเดอร์)', () => {
  const state = storeStateFrom(
    [{
      day: '2026-10-13',
      record: record({
        'reservations-search': ok('2026-10-13', '2026-10-13', 27),
        postings: ok('2026-10-13', '2026-10-13', 0),
        arrivals: { report: 'arrivals', status: 'failed', error: 'x', attempts: 3, finishedAt: '2026-10-13T05:10:00Z' },
        'trial-balance': ok('2026-10-01', '2026-10-13', 40),
      }),
    }],
    REPORTS,
  );
  assert.deepEqual([...state].sort(), [
    ['arrivals@2026-10-13', 'failed'],
    ['postings@2026-10-13', 'empty'],
    ['reservations-search@2026-10-13', 'data'],
    ['trial-balance@2026-10-13', 'data'],
  ]);
});

test('🔴 รอบรูปแบบเดิม (ช่วงเหลื่อม 3 วัน) ไม่นับว่าวันนั้นของรายงานตามวันเสร็จแล้ว — ไฟล์ 11–13 ดึงตอนวันที่ 13 ยังไม่มีครึ่งหลังของวันที่ 13', () => {
  const state = storeStateFrom(
    [{ day: '2026-10-13', record: record({ 'reservations-search': ok('2026-10-11', '2026-10-13', 30) }) }],
    REPORTS,
  );
  assert.equal(state.get('reservations-search@2026-10-13'), undefined);
});

// ── เติมวันที่ขาด (ADR-0009, ใบ 04) ──

const days = (plan: { perDay: readonly { day: string }[] }) => [...new Set(plan.perDay.map((p) => p.day))].sort();

test('🔴 เติมวันที่ขาดตั้งแต่วันเริ่มใช้งาน — เครื่องดับไป 2 วัน รอบเดียวได้ครบ 11, 12, 13', () => {
  const plan = planDailyRun({ now: NOON_14, reports: REPORTS, state: EMPTY_STORE, goLive: '2026-10-11', cap: 14 });
  assert.deepEqual(days(plan), ['2026-10-11', '2026-10-12', '2026-10-13']);
  assert.equal(plan.perDay.length, 6);
  assert.equal(plan.backlogDays, 0);
});

test('เติมเฉพาะ (รายงาน, วัน) ที่ยังไม่สำเร็จ — วันที่ครบแล้วไม่ถูกดึงซ้ำ · วันที่ล้มบางรายงานดึงแค่รายงานนั้น', () => {
  const state: StoreState = new Map([
    ['reservations-search@2026-10-12', 'data'], ['postings@2026-10-12', 'empty'],
    ['reservations-search@2026-10-11', 'data'], ['postings@2026-10-11', 'failed'],
  ]);
  const plan = planDailyRun({ now: NOON_14, reports: REPORTS, state, goLive: '2026-10-11', cap: 14 });
  assert.deepEqual(plan.perDay, [
    { report: 'postings', day: '2026-10-11' },
    { report: 'reservations-search', day: '2026-10-13' },
    { report: 'postings', day: '2026-10-13' },
  ]);
});

test('🔴 เพดานต่อรอบ: ขาด 20 วัน เพดาน 14 → เอา 14 วันที่ใหม่ที่สุด (เมื่อวานได้เสมอ) ที่เหลือ 6 วันนับเป็นค้าง', () => {
  const plan = planDailyRun({ now: NOON_14, reports: REPORTS, state: EMPTY_STORE, goLive: '2026-09-24', cap: 14 });
  assert.deepEqual(days(plan)[0], '2026-09-30');
  assert.deepEqual(days(plan).at(-1), '2026-10-13');
  assert.equal(days(plan).length, 14);
  assert.equal(plan.backlogDays, 6);
});

test('ไม่ย้อนก่อนวันเริ่มใช้งาน · วันเริ่มใช้งานเป็นวันนี้ = ยังไม่มีวันของข้อมูลถึงกำหนด (snapshot ของวันนี้ยังถ่าย)', () => {
  const plan = planDailyRun({ now: NOON_14, reports: REPORTS, state: EMPTY_STORE, goLive: '2026-10-14', cap: 14 });
  assert.deepEqual(plan.perDay, []);
  assert.equal(plan.pictures.length, 2);
  assert.equal(plan.goLiveMissing, false);
});

test('ยังไม่ได้ตั้งวันเริ่มใช้งาน — ดึงแค่เมื่อวาน ไม่เดาวันย้อนหลัง และบอกว่ายังไม่ได้ตั้ง', () => {
  const plan = planDailyRun({ now: NOON_14, reports: REPORTS, state: EMPTY_STORE, goLive: null, cap: 14 });
  assert.deepEqual(days(plan), ['2026-10-13']);
  assert.equal(plan.goLiveMissing, true);
});

test('ก่อน 07:00 พร้อมวันเริ่มใช้งาน — เติมวันก่อนเมื่อวานได้ แต่เมื่อวานยังไม่ถึงกำหนด', () => {
  const plan = planDailyRun({ now: new Date('2026-10-13T23:00:00Z'), reports: REPORTS, state: EMPTY_STORE, goLive: '2026-10-11', cap: 14 });
  assert.deepEqual(days(plan), ['2026-10-11', '2026-10-12']);
});

// ── --date: คนสั่งดึงวันของข้อมูลวันเดียว (ใบ 04) ──

test('--date ดึงรายงานตามวันทุกตัวของวันนั้นใหม่ ไม่สนสถานะเดิม และไม่ถ่ายรายงาน snapshot', () => {
  const plan = planDateRun({ now: NOON_14, reports: REPORTS, day: '2026-10-10' });
  assert.deepEqual(plan.perDay, [
    { report: 'reservations-search', day: '2026-10-10' },
    { report: 'postings', day: '2026-10-10' },
  ]);
  assert.deepEqual(plan.pictures, []);
});

test('🔴 --date ปฏิเสธวันที่ยังไม่ถึงกำหนด: วันนี้ วันอนาคต และเมื่อวานก่อน 07:00 เวลาไทย · ปฏิเสธรูปแบบที่ไม่ใช่ YYYY-MM-DD', () => {
  assert.throws(() => planDateRun({ now: NOON_14, reports: REPORTS, day: '2026-10-14' }), /ยังไม่ถึงกำหนด/);
  assert.throws(() => planDateRun({ now: NOON_14, reports: REPORTS, day: '2026-10-20' }), /ยังไม่ถึงกำหนด/);
  assert.throws(() => planDateRun({ now: new Date('2026-10-13T23:00:00Z'), reports: REPORTS, day: '2026-10-13' }), /ยังไม่ถึงกำหนด/);
  assert.throws(() => planDateRun({ now: NOON_14, reports: REPORTS, day: '13/10/2026' }), /YYYY-MM-DD/);
  assert.throws(() => planDateRun({ now: NOON_14, reports: REPORTS, day: '2026-02-30' }), /YYYY-MM-DD/);
});

test('--date กับรายงาน snapshot ตัวเดียว — ไม่มีอะไรให้ดึง (snapshot ของวันที่ผ่านไปแล้วดึงไม่ได้) ล้มดัง ๆ', () => {
  assert.throws(() => planDateRun({ now: NOON_14, reports: [{ id: 'arrivals', family: 'picture' }], day: '2026-10-10' }), /รายงาน snapshot/);
});

test('🔴 วันเริ่มใช้งานอยู่ในอนาคต (เช่น พิมพ์ปีผิด) — ไม่ดึงรายงานตามวัน และบอกให้รู้ ไม่หยุดเก็บข้อมูลเงียบ ๆ', () => {
  const plan = planDailyRun({ now: NOON_14, reports: REPORTS, state: EMPTY_STORE, goLive: '2027-10-14', cap: 14 });
  assert.deepEqual(plan.perDay, []);
  assert.equal(plan.goLiveInFuture, true);
  assert.equal(planDailyRun({ now: NOON_14, reports: REPORTS, state: EMPTY_STORE, goLive: '2026-10-14', cap: 14 }).goLiveInFuture, false);
});

test('daysToRead: โฟลเดอร์ที่ตัววางแผนต้องอ่าน = ตั้งแต่วันเริ่มใช้งาน (หรือเมื่อวาน) ถึงวันนี้', () => {
  // วันที่ 14 พ้น 7 วันแรกของเดือนแล้ว ไม่มี snapshot ปิดงวดให้ดู — ดูแค่ช่วงวันของข้อมูล (ใบ 05)
  assert.deepEqual(daysToRead({ now: NOON_14, goLive: '2026-10-11' }), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  assert.deepEqual(daysToRead({ now: NOON_14, goLive: null }), ['2026-10-13', '2026-10-14']);
  assert.deepEqual(daysToRead({ now: NOON_14, goLive: '2027-01-01' }), ['2026-10-13', '2026-10-14']);
});

// ── snapshot ปิดงวด (ADR-0008, ใบ 05) ──

const WITH_PERIODS: readonly PlannedReport[] = [
  { id: 'reservations-search', family: 'per-day' },
  { id: 'arrivals', family: 'picture', period: 'none' },
  { id: 'trial-balance', family: 'picture', period: 'month' },
  { id: 'occupancy-annual', family: 'picture', period: 'year' },
];
const closes = (plan: { periodCloses: readonly { report: string; day: string }[] }) =>
  plan.periodCloses.map((p) => `${p.report}@${p.day}`);

const OCT_2_NOON = new Date('2026-10-02T05:00:00Z');

test('🔴 snapshot ปิดงวด: งวดที่จบล่าสุดยังไม่มี snapshot ปิดงวด → ถ่าย (วันของงวด = วันสุดท้ายของงวด) · รายงานไม่มีงวดไม่มี snapshot ปิดงวด', () => {
  const plan = planDailyRun({ now: OCT_2_NOON, reports: WITH_PERIODS, state: EMPTY_STORE, goLive: null });
  assert.deepEqual(closes(plan), ['trial-balance@2026-09-30']);
});

test('snapshot ปิดงวดที่มีแล้วไม่ถ่ายซ้ำ', () => {
  const state: StoreState = new Map([['trial-balance@period-close@2026-09-30', 'data']]);
  assert.deepEqual(closes(planDailyRun({ now: OCT_2_NOON, reports: WITH_PERIODS, state, goLive: null })), []);
});

test('🔴 snapshot ปิดงวดถ่ายได้แค่ 7 วันแรกของงวดถัดไป — หลังจากนั้นไม่ใช่ snapshot ปิดงวดแล้ว (ไม่ย้อนถ่ายปี 2025 ในเดือนตุลาคม)', () => {
  assert.deepEqual(closes(planDailyRun({ now: new Date('2026-10-07T05:00:00Z'), reports: WITH_PERIODS, state: EMPTY_STORE, goLive: null })), ['trial-balance@2026-09-30']);
  assert.deepEqual(closes(planDailyRun({ now: new Date('2026-10-08T05:00:00Z'), reports: WITH_PERIODS, state: EMPTY_STORE, goLive: null })), []);
  assert.deepEqual(closes(planDailyRun({ now: NOON_14, reports: WITH_PERIODS, state: EMPTY_STORE, goLive: null })), []);
});

test('🔴 snapshot ปิดงวดที่ล้มถูกลองซ้ำรอบถัดไปภายใน 7 วัน และบอกให้รู้ว่ายังไม่สำเร็จ', () => {
  const state: StoreState = new Map([['trial-balance@period-close@2026-09-30', 'failed']]);
  const plan = planDailyRun({ now: OCT_2_NOON, reports: WITH_PERIODS, state, goLive: null });
  assert.deepEqual(closes(plan), ['trial-balance@2026-09-30']);
  assert.deepEqual(plan.failingCloses, ['trial-balance@2026-09-30']);
});

test('1 ม.ค. ได้ทั้ง snapshot ปิดงวดเดือนธันวาคมและปีที่แล้ว (วันสุดท้ายของงวดเดียวกัน)', () => {
  const plan = planDailyRun({ now: new Date('2027-01-01T05:00:00Z'), reports: WITH_PERIODS, state: EMPTY_STORE, goLive: null });
  assert.deepEqual(closes(plan), ['trial-balance@2026-12-31', 'occupancy-annual@2026-12-31']);
});

test('วันที่ 1 พลาด (เครื่องดับ) — วันที่ 2 ถ่ายแทน', () => {
  const plan = planDailyRun({ now: new Date('2026-11-02T05:00:00Z'), reports: WITH_PERIODS, state: EMPTY_STORE, goLive: null });
  assert.deepEqual(closes(plan).slice(0, 1), ['trial-balance@2026-10-31']);
});

test('ไม่ย้อนไปงวดที่จบก่อนวันเริ่มใช้งาน', () => {
  const plan = planDailyRun({ now: OCT_2_NOON, reports: WITH_PERIODS, state: EMPTY_STORE, goLive: '2026-10-01' });
  assert.deepEqual(closes(plan), []);
});

test('daysToRead รวมวันสุดท้ายของงวดที่จบล่าสุดที่ยังอยู่ใน 7 วันแรก — ตัววางแผนต้องเห็นว่าถ่าย snapshot ปิดงวดไปแล้วหรือยัง', () => {
  assert.deepEqual(daysToRead({ now: OCT_2_NOON, goLive: null }), ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(daysToRead({ now: new Date('2027-01-02T05:00:00Z'), goLive: null }), ['2026-12-31', '2027-01-01', '2027-01-02']);
});

test('ภาพรวมจาก _run.json: ผล snapshot ปิดงวดบันทึกด้วย id "<รายงาน>@period-close" ในโฟลเดอร์ของวันสุดท้ายของงวด · รายงานนอกแคตตาล็อกไม่นับ', () => {
  const state = storeStateFrom(
    [{
      day: '2026-09-30',
      record: record({
        'trial-balance@period-close': ok('2026-09-01', '2026-09-30', 40),
        'trial-balance': ok('2026-09-01', '2026-09-30', 38),
        'no-such-report@period-close': ok('2026-09-01', '2026-09-30', 1),
      }),
    }],
    WITH_PERIODS,
  );
  assert.equal(state.get('trial-balance@period-close@2026-09-30'), 'data');
  assert.equal(state.get('trial-balance@2026-09-30'), 'data');
  assert.equal(state.get('no-such-report@period-close@2026-09-30'), undefined);
});

test('คำเตือนวันขาดเกินเพดานแนะนำ --date เฉพาะ Site ที่สั่ง --date ได้ (FoodStory ไม่มี --date — code review ใบ 06)', () => {
  const plan = { perDay: [], pictures: [], periodCloses: [], backlogDays: 4, goLiveMissing: false, goLiveInFuture: false, failingCloses: [] };
  const [hoteltime] = planWarnings(plan, '2026-10-01', { dateOption: true });
  const [foodstory] = planWarnings(plan, '2026-10-01', { dateOption: false });
  assert.match(hoteltime!, /ยังขาดอีก 4 วัน.*--date/);
  assert.match(foodstory!, /ยังขาดอีก 4 วัน/);
  assert.doesNotMatch(foodstory!, /--date/);
});

test('🔴 รอบรูปแบบเดิมที่ดึงวันนั้นของตัวเอง (ช่วงวันเดียวตรงกับโฟลเดอร์ แต่รันในวันเดียวกัน = ได้ครึ่งวัน) ไม่นับ — ทั้งผ่านและล้ม (ใบ 07)', () => {
  // โมเดลใหม่ดึงรายงานตามวันของวัน D ตั้งแต่ D+1 เสมอ · รอบเดิม 12:00 ของวันที่ 13 ใส่ผลของวันที่ 13 ลงโฟลเดอร์ 13 เอง
  const sameDay = (reports: RunRecord['reports'], startedAt: string): RunRecord => ({
    ...record(reports), runs: [{ startedAt, finishedAt: startedAt, reports: Object.keys(reports) }],
  });
  const failedOld = { report: 'postings', status: 'failed' as const, error: 'x', attempts: 1, finishedAt: '2026-10-13T05:30:00Z' };
  const old = storeStateFrom(
    [{ day: '2026-10-13', record: sameDay({ 'reservations-search': ok('2026-10-13', '2026-10-13', 5), postings: failedOld }, '2026-10-13T05:00:00Z') }],
    REPORTS,
  );
  assert.equal(old.get('reservations-search@2026-10-13'), undefined);
  assert.equal(old.get('postings@2026-10-13'), undefined);
  // 23:30 ของวันที่ 13 เวลาไทย = 16:30Z ยังเป็นวันที่ 13 — ยังไม่นับ · 00:10 ของวันที่ 14 เวลาไทย = 17:10Z ของวันที่ 13 — นับ
  const late = storeStateFrom([{ day: '2026-10-13', record: sameDay({ 'reservations-search': ok('2026-10-13', '2026-10-13', 5) }, '2026-10-13T16:30:00Z') }], REPORTS);
  assert.equal(late.get('reservations-search@2026-10-13'), undefined);
  const next = storeStateFrom([{ day: '2026-10-13', record: sameDay({ 'reservations-search': ok('2026-10-13', '2026-10-13', 5) }, '2026-10-13T17:10:00Z') }], REPORTS);
  assert.equal(next.get('reservations-search@2026-10-13'), 'data');
});

// ── baseline (ใบ 09) ──

test('🔴 baseline: รายงานตามวันทุกตัว × ทุกวันของข้อมูลในช่วง (ไฟล์ละวัน — key เดียวกับรอบรายวัน) · รายงาน snapshot ข้ามพร้อมเหตุผล', () => {
  const plan = planBaselineRun({ reports: REPORTS, from: '2026-10-11', to: '2026-10-13' });
  assert.deepEqual(plan.items, [
    { report: 'reservations-search', day: '2026-10-11' }, { report: 'postings', day: '2026-10-11' },
    { report: 'reservations-search', day: '2026-10-12' }, { report: 'postings', day: '2026-10-12' },
    { report: 'reservations-search', day: '2026-10-13' }, { report: 'postings', day: '2026-10-13' },
  ]);
  assert.deepEqual(plan.skipped.map((s) => s.report), ['arrivals', 'trial-balance']);
  assert.match(plan.skipped[0]!.reason, /รายงาน snapshot/);
});

test('baseline วันเดียวก็ได้ — ทุกรายงานตามวันของวันนั้น (ไม่รับภาพรวมของที่เก็บข้อมูลเลย: ดึงวันที่เคยดึงแล้วใหม่หมดคือหน้าที่ของมัน)', () => {
  assert.deepEqual(planBaselineRun({ reports: REPORTS, from: '2026-10-12', to: '2026-10-12' }).items.map((i) => i.day), ['2026-10-12', '2026-10-12']);
});

test('🔴 ผลของ baseline (id `<รายงาน>@<วัน>`) ไม่มีผลกับภาพรวมของตัววางแผน — ต่อให้มีใครส่งโฟลเดอร์ baseline เข้ามา รอบรายวันก็ไม่ดึงซ้ำ/ไม่ข้ามเพราะมัน', () => {
  const baselineRecord: RunRecord = {
    site: 'hoteltime', kind: 'baseline', dataThrough: '2026-10-13', skipped: [],
    runs: [{ startedAt: '2026-10-14T15:00:00Z', finishedAt: '2026-10-14T15:01:00Z', reports: ['postings@2026-10-13'] }],
    reports: {
      'postings@2026-10-13': { report: 'postings@2026-10-13', status: 'failed', error: 'x', attempts: 1, finishedAt: '2026-10-14T15:01:00Z' },
      'reservations-search@2026-10-13': ok('2026-10-13', '2026-10-13', 4),
    },
  };
  assert.equal(storeStateFrom([{ day: '2026-10-14', record: baselineRecord }], REPORTS).size, 0);
});
