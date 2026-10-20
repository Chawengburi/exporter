import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { PlannedReport } from '../src/core/run-planner.ts';
import type { RunRecord } from '../src/core/run-record.ts';
import { buildStatus, renderStatus, type Folder, type MonthRun, type StatusSetup, type StoreSnapshot } from '../src/core/status.ts';

// `exporter status` (Ubuntu ticket 05 → ใบ 07 ของ exporter-daily-per-day-raw) — สรุปภาษาไทยหน้าเดียว ตามโมเดลใหม่: สถานะต่อ **วันของข้อมูล**
// (มีข้อมูล / ว่าง / ล้ม / ยังไม่ได้ดึง) + รายงาน snapshot ของแต่ละวัน + snapshot ปิดงวดแยก + สิ่งที่ต้องทำ (seam S2: ฟังก์ชันล้วน "คลัง + เวลา + ค่าตั้ง" → สรุป
// และรันคำสั่งจริงกับคลังปลอม) · HotelTime รันเอง: ขาด/ล้ม = ปัญหา · FoodStory คนกด: ยังไม่ได้กด = สิ่งที่ต้องทำ · snapshot ของวันที่ผ่านไปแล้วหาย =
// บอกว่าหายถาวร (เติมไม่ได้ ไม่มีอะไรให้ทำ)

/** เวลาไทย → instant (UTC+7) */
const thai = (iso: string) => new Date(`${iso}+07:00`);

const HT: readonly PlannedReport[] = [
  { id: 'postings', family: 'per-day' }, { id: 'invoices', family: 'per-day' }, { id: 'cancelled', family: 'per-day' },
  { id: 'arrivals', family: 'picture', period: 'none' }, { id: 'trial-balance', family: 'picture', period: 'month' },
];
const FS: readonly PlannedReport[] = [
  { id: 'salebybill', family: 'per-day' }, { id: 'pay', family: 'per-day' },
  { id: 'current_stock', family: 'picture', period: 'none' }, { id: 'salebymonthsum', family: 'picture', period: 'year' },
];
const SETUP: StatusSetup = { catalog: { hoteltime: HT, foodstory: FS }, goLive: '2026-10-08', webhookExport: true, webhookUpload: true };

type Result = 'data' | 'empty' | readonly ['failed', string];
const outcome = (id: string, r: Result, from: string, to: string): RunRecord['reports'][string] =>
  r === 'data' || r === 'empty'
    ? { report: id, status: 'ok', rows: r === 'data' ? 5 : 0, range: { from, to }, actualRange: null, files: [], attempts: 1, finishedAt: `${to}T06:00:00.000Z` }
    : { report: id, status: 'failed', error: r[1], attempts: 3, finishedAt: `${to}T06:00:00.000Z` };
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * โฟลเดอร์ของวัน D ตามโมเดลใหม่: รายงานตามวันของ D ดึงตอนเที่ยงของ D+1 · snapshot ถ่ายตอนเที่ยงของ D · snapshot ปิดงวด (`<id>@period-close`) ถ่ายตอน D+1
 * · `sameDay` = รอบรูปแบบเดิมที่ดึงรายงานตามวันในวันนั้นเอง (ได้ครึ่งวัน — เป็นประวัติ ไม่นับ)
 */
function folder(day: string, parts: {
  perDay?: Record<string, Result>; pictures?: Record<string, Result>; closes?: Record<string, Result>; sameDay?: Record<string, Result>;
}): Folder {
  const runs: { startedAt: string; finishedAt: string; reports: string[] }[] = [];
  const reports: Record<string, RunRecord['reports'][string]> = {};
  const add = (on: string, entries: Record<string, Result> | undefined, range: (id: string) => [string, string], key = (id: string) => id) => {
    if (!entries) return;
    for (const [id, r] of Object.entries(entries)) reports[key(id)] = outcome(key(id), r, ...range(id));
    runs.push({ startedAt: `${on}T05:00:00.000Z`, finishedAt: `${on}T06:00:00.000Z`, reports: Object.keys(entries).map(key) });
  };
  add(day, parts.sameDay, () => [day, day]);
  add(day, parts.pictures, () => [`${day.slice(0, 8)}01`, day]);
  add(nextDay(day), parts.perDay, () => [day, day]);
  add(nextDay(day), parts.closes, () => [`${day.slice(0, 8)}01`, day], (id) => `${id}@period-close`);
  runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return { day, record: { site: 'hoteltime', kind: 'daily', dataThrough: day, runs, reports, skipped: [] } };
}
const ALL_HT = { postings: 'data', invoices: 'data', cancelled: 'empty' } as const;
const PICS_HT = { arrivals: 'data', 'trial-balance': 'data' } as const;
const ALL_FS = { salebybill: 'data', pay: 'data' } as const;
const PICS_FS = { current_stock: 'data', salebymonthsum: 'data' } as const;
const month = (period: string, failures = 0): MonthRun => ({
  period, pulledOn: '2026-10-12', passed: 49 - failures, total: 49,
  failed: Array.from({ length: failures }, (_, i) => ({ report: `r${i}`, error: 'x' })),
});
/** 8–13 ครบทั้งสอง Site · snapshot ของวันนี้ (14) ถ่ายแล้ว · รายเดือน ก.ย. มีแล้ว */
const healthy = (): StoreSnapshot => ({
  hoteltime: [
    ...['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].map((d) => folder(d, { perDay: ALL_HT, pictures: PICS_HT })),
    folder('2026-10-14', { pictures: PICS_HT }),
  ],
  foodstoryDaily: [
    ...['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].map((d) => folder(d, { perDay: ALL_FS, pictures: PICS_FS })),
    folder('2026-10-14', { pictures: PICS_FS }),
  ],
  foodstoryMonthly: [month('2026-09')],
});
const replace = (folders: readonly Folder[], f: Folder) => [...folders.filter((x) => x.day !== f.day), f];
const without = (folders: readonly Folder[], day: string) => folders.filter((x) => x.day !== day);
const text = (r: ReturnType<typeof buildStatus>) => r.sections.flatMap((s) => [s.title, ...s.lines.map((l) => l.text)]).join('\n');
const EVENING_14 = thai('2026-10-14T20:05');

test('ทุกอย่างปกติ: ปกติ ไม่มีปัญหา ไม่มีสิ่งต้องทำ · แสดงต่อวันของข้อมูลว่ามีข้อมูล/ว่างกี่รายงาน (ว่างบอกชื่อ) และ snapshot ของวันนั้นครบ', () => {
  const r = buildStatus(healthy(), EVENING_14, SETUP);
  assert.equal(r.verdict, 'ok', text(r));
  assert.deepEqual([r.problems, r.actions], [[], []]);
  assert.match(text(r), /2026-10-13[^\n]*มีข้อมูล 2[^\n]*ว่าง 1 \(cancelled\)[^\n]*snapshot ครบ 2\/2/);
  assert.match(text(r), /2026-10-14[^\n]*snapshot ครบ 2\/2/);
});

test('🔴 สี่สถานะต่อวันของข้อมูล: ล้ม (บอกชื่อและสาเหตุ) และยังไม่ได้ดึง (บอกชื่อ) ของ HotelTime วันที่ผ่านมา = ปัญหา', () => {
  const s = healthy();
  const r = buildStatus({
    ...s,
    hoteltime: replace(replace(s.hoteltime,
      folder('2026-10-12', { perDay: { postings: 'data', invoices: ['failed', 'Timeout 60000ms exceeded'] }, pictures: PICS_HT })),
    folder('2026-10-11', { perDay: { postings: 'data' }, pictures: PICS_HT })),
  }, EVENING_14, SETUP);
  assert.equal(r.verdict, 'problem');
  const problems = r.problems.join('\n');
  assert.match(problems, /2026-10-12[^\n]*ล้ม 1 \(invoices[^\n]*Timeout[^\n]*ยังไม่ได้ดึง 1 \(cancelled\)/);
  assert.match(problems, /2026-10-11[^\n]*ยังไม่ได้ดึง 2 \(invoices, cancelled\)/);
});

test('HotelTime เมื่อวานยังไม่ได้ดึง: ก่อน 15:00 = รอรอบเที่ยง · หลัง 15:00 = ปัญหา ชี้ไปดู Windmill · ล้มก่อน 18:30 = รอรอบเก็บตก', () => {
  const s = healthy();
  const noYesterday = { ...s, hoteltime: replace(without(s.hoteltime, '2026-10-14'), folder('2026-10-13', { pictures: PICS_HT })) };
  const early = buildStatus(noYesterday, thai('2026-10-14T11:00'), SETUP);
  assert.equal(early.verdict, 'ok', text(early));
  assert.match(text(early), /รอ/);
  const late = buildStatus(noYesterday, thai('2026-10-14T15:30'), SETUP);
  assert.equal(late.verdict, 'problem');
  assert.match(late.problems.join('\n'), /2026-10-13[\s\S]*Windmill/);
  const failing = { ...s, hoteltime: replace(s.hoteltime, folder('2026-10-13', { perDay: { ...ALL_HT, postings: ['failed', 'x'] }, pictures: PICS_HT })) };
  assert.equal(buildStatus(failing, thai('2026-10-14T16:00'), SETUP).verdict, 'ok');
  assert.match(buildStatus(failing, thai('2026-10-14T19:00'), SETUP).problems.join('\n'), /postings/);
});

test('🔴 รายงาน snapshot: ของวันนี้ยังไม่ได้ถ่าย HotelTime หลัง 15:00 = ปัญหา · snapshot ของวันที่ผ่านไปแล้วหาย = บอกว่าหายถาวร เติมไม่ได้ (ไม่ใช่ปัญหาที่แก้ได้)', () => {
  const s = healthy();
  const r = buildStatus({
    ...s,
    hoteltime: replace(replace(s.hoteltime, folder('2026-10-14', { pictures: { arrivals: 'data' } })),
      folder('2026-10-11', { perDay: ALL_HT, pictures: { arrivals: 'data', 'trial-balance': ['failed', 'x'] } })),
  }, thai('2026-10-14T16:00'), SETUP);
  assert.match(r.problems.join('\n'), /2026-10-14[^\n]*snapshot[^\n]*trial-balance/);
  assert.doesNotMatch(r.problems.join('\n'), /2026-10-11/);
  assert.match(text(r), /2026-10-11[^\n]*snapshot[^\n]*trial-balance[^\n]*หายถาวร[^\n]*เติมไม่ได้/);
  const early = buildStatus({ ...s, hoteltime: without(s.hoteltime, '2026-10-14') }, thai('2026-10-14T11:00'), SETUP);
  assert.equal(early.verdict, 'ok', text(early));
});

test('🔴 FoodStory ไม่ได้กดมา 3 วัน = สิ่งที่ต้องทำ บอกจำนวนวันและให้ดับเบิลคลิก · วันที่ยังไม่ได้ดึงบอกชื่อ (กดครั้งถัดไปเติมให้) ไม่ใช่ปัญหา', () => {
  const s = healthy();
  const fs = s.foodstoryDaily.filter((f) => f.day <= '2026-10-10'); // กดล่าสุดวันที่ 11 (ได้ข้อมูลวันที่ 10) — หลังจากนั้นไม่มีใครกด
  const r = buildStatus({ ...s, foodstoryDaily: fs }, EVENING_14, SETUP);
  assert.equal(r.verdict, 'action', text(r));
  assert.deepEqual(r.problems, []);
  assert.match(r.actions.join('\n'), /ไม่ได้กดมา 3 วัน[\s\S]*ดับเบิลคลิก/);
  assert.match(text(r), /2026-10-13[^\n]*ยังไม่ได้ดึง 2 \(salebybill, pay\)/);
  assert.match(text(r), /2026-10-12[^\n]*snapshot[^\n]*หายถาวร/);
});

test('FoodStory ดึงแล้วแต่มีรายงานล้ม = ปัญหา (ให้กดใหม่)', () => {
  const s = healthy();
  const r = buildStatus({ ...s, foodstoryDaily: replace(s.foodstoryDaily, folder('2026-10-13', { perDay: { ...ALL_FS, pay: ['failed', 'x'] }, pictures: PICS_FS })) }, EVENING_14, SETUP);
  assert.equal(r.verdict, 'problem');
  assert.match(r.problems.join('\n'), /2026-10-13[^\n]*pay/);
});

test('🔴 สิ่งที่ต้องทำ: ยังไม่ตั้งวันเริ่มใช้งาน · ยังไม่ตั้ง URL ของ webhook · วันขาดเกินที่รอบเดียวเติมได้', () => {
  const s = healthy();
  const unset = buildStatus(s, EVENING_14, { ...SETUP, goLive: null, webhookExport: false, webhookUpload: false });
  assert.equal(unset.verdict, 'action');
  assert.match(unset.actions.join('\n'), /EXPORTER_GO_LIVE/);
  assert.match(unset.actions.join('\n'), /DISCORD_WEBHOOK_URL/);
  // ตั้งวันเริ่มใช้งานย้อนไปวันที่ 1 แต่คลังมีตั้งแต่วันที่ 8 — HotelTime ขาด 1–7 (7 วัน) รอบเดียวเติม 3 → เกิน 4
  const backlog = buildStatus(s, EVENING_14, { ...SETUP, goLive: '2026-10-01' });
  assert.match(backlog.actions.join('\n'), /HotelTime[^\n]*ขาดอีก 4 วัน/);
  assert.match(backlog.actions.join('\n'), /FoodStory[^\n]*ขาดอีก 4 วัน/);
});

test('🔴 คลังที่มีรอบรูปแบบเดิม (ช่วงเหลื่อม 3 วัน, ดึงวันนั้นเอง) อ่านได้ไม่ล้ม — แสดงเป็นประวัติ ไม่นับเป็นขาด/ล้ม ก่อนวันเริ่มใช้งาน', () => {
  const s = healthy();
  const old = folder('2026-10-07', { sameDay: { postings: 'data', invoices: ['failed', 'Timeout'] }, pictures: PICS_HT });
  const r = buildStatus({ ...s, hoteltime: [old, ...s.hoteltime] }, EVENING_14, SETUP, { windowDays: 8 });
  assert.equal(r.verdict, 'ok', text(r));
  assert.match(text(r), /2026-10-07[^\n]*รูปแบบเดิม[^\n]*ประวัติ/);
  // ไม่ตั้งวันเริ่มใช้งาน: วันแรกที่มีผลแบบใหม่เป็นจุดเริ่ม — วันก่อนหน้านั้นเป็นประวัติ ไม่ใช่ "ยังไม่ได้ดึง"
  const fresh = buildStatus({ ...s, hoteltime: [old, ...s.hoteltime.filter((f) => f.day >= '2026-10-12')] }, EVENING_14, { ...SETUP, goLive: null }, { windowDays: 8 });
  assert.deepEqual(fresh.problems, [], text(fresh));
});

test('🔴 snapshot ปิดงวดแยกจากรายงาน snapshot ที่ถ่ายในวันนั้น: ล้ม = เรื่องของงวด (บอกว่าลองซ้ำได้ถึงวันไหน) ไม่ใช่ความล้มของวันที่ 30', () => {
  const s = healthy();
  const sep30 = folder('2026-09-30', { closes: { 'trial-balance': ['failed', 'Timeout'] } });
  const r = buildStatus({ ...s, hoteltime: [sep30, ...s.hoteltime] }, thai('2026-10-03T20:00'), { ...SETUP, goLive: '2026-09-01' });
  assert.match(r.problems.join('\n'), /snapshot ปิดงวด[^\n]*2026-09[^\n]*trial-balance[^\n]*2026-10-07/);
  const ht = r.sites.find((x) => x.site === 'hoteltime')!;
  assert.deepEqual(ht.days.find((d) => d.day === '2026-09-30')!.pictures!.failed, []);
  assert.deepEqual(ht.closes.map((c) => [c.periodEnd, c.failed.map((f) => f.report)]), [['2026-09-30', ['trial-balance']]]);
  const done = buildStatus({ ...s, hoteltime: [folder('2026-09-30', { closes: { 'trial-balance': 'data' } }), ...s.hoteltime] },
    thai('2026-10-03T20:00'), { ...SETUP, goLive: '2026-09-01' });
  assert.match(text(done), /snapshot ปิดงวด[^\n]*2026-09[^\n]*ครบ 1\/1/);
});

test('🔴 --json: ต่อ Site × วันของข้อมูล มีรายชื่อว่าง/ล้ม/ยังไม่ได้ดึง และ snapshot หาย — โครงสร้างที่ใบ 08 ใช้สร้างข้อความ Discord', () => {
  const s = healthy();
  const r = buildStatus({ ...s, hoteltime: replace(s.hoteltime, folder('2026-10-13', { perDay: { postings: ['failed', 'x'], invoices: 'data' }, pictures: { arrivals: 'data' } })) },
    EVENING_14, SETUP);
  const ht = r.sites.find((x) => x.site === 'hoteltime')!;
  const d13 = ht.days.find((d) => d.day === '2026-10-13')!;
  assert.deepEqual(d13.perDay, { total: 3, data: 1, empty: [], failed: [{ report: 'postings', error: 'x' }], notFetched: ['cancelled'] });
  assert.deepEqual(d13.pictures, { total: 2, taken: 1, empty: [], failed: [], missing: ['trial-balance'] });
  assert.equal(ht.days.find((d) => d.day === '2026-10-14')!.perDay, null); // วันนี้ยังไม่ถึงกำหนด
  assert.deepEqual(r.setup, { goLive: '2026-10-08', webhookExport: true, webhookUpload: true });
});

test('FoodStory รายเดือนของเดือนที่แล้ว: ยังไม่มีก่อนวันที่ 5 = แสดงเฉย ๆ · หลังวันที่ 5 = ต้องทำ · มีแต่ล้ม = ปัญหา', () => {
  const s = healthy();
  const noMonth = { ...s, foodstoryMonthly: [] };
  const early = buildStatus(noMonth, thai('2026-10-04T10:00'), SETUP);
  assert.doesNotMatch(early.actions.join('\n'), /2026-09/);
  assert.match(text(early), /ยังไม่ได้ดึงรายเดือนของ 2026-09/);
  assert.match(buildStatus(noMonth, thai('2026-10-14T10:00'), SETUP).actions.join('\n'), /2026-09/);
  assert.equal(buildStatus({ ...s, foodstoryMonthly: [month('2026-09', 2)] }, EVENING_14, SETUP).verdict, 'problem');
});

test('ตัดวันตามเวลาไทย: 00:30 ของวันที่ 15 (ยังเป็นวันที่ 14 ใน UTC) วันนี้คือ 15 — ข้อมูลวันที่ 14 ยังไม่ถึงกำหนด (07:00) ไม่ใช่ขาด', () => {
  const r = buildStatus(healthy(), thai('2026-10-15T00:30'), SETUP);
  assert.match(text(r), /2026-10-15/);
  assert.doesNotMatch(r.problems.join('\n'), /2026-10-14/);
});

test('ยังไม่เคยมีรอบ HotelTime เลย = ปัญหา บอกให้ตั้งค่า Windmill · โฟลเดอร์ที่ยังไม่มีบันทึกผล (กำลังรัน) วันนี้ = รอ · _run.json อ่านไม่ได้ = ปัญหา', () => {
  const none = buildStatus({ hoteltime: [], foodstoryDaily: [], foodstoryMonthly: [] }, EVENING_14, SETUP);
  assert.equal(none.verdict, 'problem');
  assert.match(none.problems.join('\n'), /Windmill/);
  const s = healthy();
  const running = buildStatus({ ...s, hoteltime: replace(s.hoteltime, { day: '2026-10-14', record: 'running' }) }, thai('2026-10-14T13:00'), SETUP);
  assert.match(text(running), /กำลังรัน/);
  assert.equal(running.verdict, 'ok', text(running));
  const bad = buildStatus({ ...s, hoteltime: replace(s.hoteltime, { day: '2026-10-11', record: 'unreadable' }), foodstoryMonthly: [{ ...month('2026-09'), state: 'unreadable' }] },
    EVENING_14, SETUP);
  assert.equal(bad.problems.filter((p) => /อ่านไม่ได้/.test(p)).length, 2);
});

test('มีทั้งปัญหาและสิ่งที่ต้องทำ: บรรทัดสุดท้ายต้องเป็น ✘ (คนอ่านแค่บรรทัดท้ายต้องไม่พลาดปัญหา)', () => {
  const out = renderStatus(buildStatus({ hoteltime: [], foodstoryDaily: [], foodstoryMonthly: [] }, EVENING_14, { ...SETUP, webhookExport: false, webhookUpload: false })).trimEnd().split('\n');
  assert.match(out.at(-1)!, /^✘/);
});

// ── คำสั่งจริงกับคลังปลอม ──
const EXPORTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs: string[] = [];
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
async function writeFolder(dataDir: string, site: string, f: Folder): Promise<void> {
  const dir = path.join(dataDir, site, 'daily', f.day.slice(0, 7), f.day);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '_run.json'), typeof f.record === 'string' ? '{}' : JSON.stringify({ ...f.record, site }));
}
function status(dataDir: string, at: string, env: Record<string, string>, json = false) {
  const r = spawnSync(process.execPath, ['src/index.ts', 'status', '--data', dataDir, '--at', at, ...(json ? ['--json'] : [])],
    { cwd: EXPORTER, encoding: 'utf8', env: { ...process.env, EXPORTER_GO_LIVE: '', DISCORD_WEBHOOK_URL_EXPORT: '', DISCORD_WEBHOOK_URL_UPLOAD: '', ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('exporter status กับคลังปลอม: แคตตาล็อกจริงของทั้งสอง Site · ค่าตั้งจาก env · exit 1 เมื่อมีปัญหา · --json ไม่มี URL ของ webhook', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'status-data-'));
  dirs.push(dataDir);
  await writeFolder(dataDir, 'hoteltime', folder('2026-10-13', { perDay: { postings: 'data' } }));
  const env = { EXPORTER_GO_LIVE: '2026-10-13', DISCORD_WEBHOOK_URL_EXPORT: 'https://discord.com/api/webhooks/1/secret-token' };
  const r = status(dataDir, '2026-10-14T20:00', env, true);
  assert.equal(r.code, 1, r.out); // HotelTime วันที่ 13 ยังไม่ได้ดึงเกือบทุกรายงานของแคตตาล็อกจริง
  const parsed = JSON.parse(r.out);
  assert.deepEqual(parsed.setup, { goLive: '2026-10-13', webhookExport: true, webhookUpload: false });
  assert.doesNotMatch(r.out, /secret-token/);
  const d13 = parsed.sites[0].days.find((d: { day: string }) => d.day === '2026-10-13');
  assert.equal(d13.perDay.total, 22);
  assert.equal(d13.perDay.data, 1); // postings เป็นรายงานตามวันจริงของ HotelTime

  await writeFolder(dataDir, 'hoteltime', { day: '2026-10-12', record: 'unreadable' });
  const shaped = status(dataDir, '2026-10-14T20:00', env);
  assert.match(shaped.out, /2026-10-12[\s\S]*อ่านไม่ได้/);
  assert.doesNotMatch(shaped.out, /TypeError|at .*\.ts:/);
});

test('exporter status: โฟลเดอร์คลังไม่มีอยู่ = บอกว่าหาไม่เจอ (ไม่โทษ Windmill) exit 2 · option ผิด exit 2 · --at ไม่มี timezone = เวลาไทย', async () => {
  const missing = status('/nonexistent/exporter-data', '2026-10-12T13:05:00Z', {});
  assert.equal(missing.code, 2, missing.out);
  assert.match(missing.out, /ไม่พบโฟลเดอร์/);
  assert.doesNotMatch(missing.out, /Windmill/);
  const dataDir = await mkdtemp(path.join(tmpdir(), 'status-data-'));
  dirs.push(dataDir);
  const badOpt = spawnSync(process.execPath, ['src/index.ts', 'status', '--data', dataDir, '--days', '1'], { cwd: EXPORTER, encoding: 'utf8' });
  assert.equal(badOpt.status, 2);
  const local = status(dataDir, '2026-10-12T00:30', {}, true);
  assert.equal(JSON.parse(local.out).at, '2026-10-12 00:30');
});

// ── จาก code review ใบ 07 ──

test('🔴 --json: ทุกวันและทุกงวดมี level + note ตามกติกาเวลา — ใบ 08 ไม่ต้องคิดกติกา 15:00/18:30 ซ้ำ · บอกว่าไม่ได้กดมากี่วันเป็นตัวเลข', () => {
  const s = healthy();
  const failing = { ...s, hoteltime: replace(s.hoteltime, folder('2026-10-13', { perDay: { ...ALL_HT, postings: ['failed', 'x'] }, pictures: PICS_HT })) };
  const afternoon = buildStatus(failing, thai('2026-10-14T16:00'), SETUP).sites[0]!.days.find((d) => d.day === '2026-10-13')!;
  assert.equal(afternoon.level, 'wait');
  assert.match(afternoon.note, /เก็บตก/);
  const evening = buildStatus(failing, thai('2026-10-14T19:00'), SETUP).sites[0]!.days.find((d) => d.day === '2026-10-13')!;
  assert.equal(evening.level, 'problem');
  const fs = buildStatus({ ...s, foodstoryDaily: s.foodstoryDaily.filter((f) => f.day <= '2026-10-10') }, EVENING_14, SETUP).sites[1]!;
  assert.equal(fs.daysSinceLastRun, 3);
});

test('🔴 FoodStory กดวันนี้แล้วแต่ยังขาดเกินที่กดครั้งเดียวเติมได้ — ไม่บอกว่า "ยังไม่ได้กดวันนี้"', () => {
  const s = healthy();
  // กดวันนี้ (14) ได้ snapshot ของวันนี้ + วันที่ 13 แต่วันที่ 9–12 ยังขาด
  const fs = [folder('2026-10-08', { perDay: ALL_FS }), { ...folder('2026-10-13', { perDay: ALL_FS }) }, folder('2026-10-14', { pictures: PICS_FS })];
  const r = buildStatus({ ...s, foodstoryDaily: fs }, EVENING_14, SETUP);
  assert.doesNotMatch(r.actions.join('\n'), /ยังไม่ได้กดวันนี้/);
  assert.match(r.actions.join('\n'), /กดวันนี้แล้วแต่ยังมีวันที่ขาด/);
});

test('🔴 วันเริ่มใช้งานอยู่หลังวันนี้ = สิ่งที่ต้องทำ (พิมพ์ผิด? ยังไม่ดึงรายงานตามวันเลย) · ตั้งผิดรูปแบบ = สิ่งที่ต้องทำ บอกค่าที่อ่านไม่ออก', () => {
  const future = buildStatus(healthy(), EVENING_14, { ...SETUP, goLive: '2027-01-01' });
  assert.match(future.actions.join('\n'), /2027-01-01[^\n]*หลังวันนี้/);
  const typo = buildStatus(healthy(), EVENING_14, { ...SETUP, goLive: null, goLiveError: 'EXPORTER_GO_LIVE ต้องเป็นวันที่จริง — ได้มา "2026-13-01"' });
  assert.match(typo.actions.join('\n'), /2026-13-01/);
  assert.equal(typo.setup.goLiveError !== undefined, true);
});

test('🔴 snapshot ปิดงวดที่ถึงกำหนดแต่ยังไม่มีรอบไหนลองเลย (เครื่องดับวันที่ 1) ไม่เงียบ — HotelTime ก่อนรอบเที่ยงของวันที่ 1 = รอ · หลังจากนั้น = ปัญหา', () => {
  const s = { ...healthy(), hoteltime: [folder('2026-09-30', { perDay: ALL_HT, pictures: PICS_HT })] };
  const setup = { ...SETUP, goLive: '2026-09-01' };
  const morning = buildStatus(s, thai('2026-10-01T10:00'), setup).sites[0]!.closes;
  assert.deepEqual(morning.map((c) => [c.periodEnd, c.level, c.missing]), [['2026-09-30', 'wait', ['trial-balance']]]);
  const later = buildStatus(s, thai('2026-10-02T20:00'), setup);
  assert.match(later.problems.join('\n'), /snapshot ปิดงวดเดือน 2026-09[^\n]*trial-balance[^\n]*2026-10-07/);
});

test('ข้ามปี: 2027-01-02 — ข้อมูลวันที่ 1 ม.ค. ถึงกำหนด · snapshot ปิดงวดของ ธ.ค. และปี 2026 อยู่ในโฟลเดอร์ 2026-12-31 · รายเดือนที่ต้องมีคือ 2026-12', () => {
  const s: StoreSnapshot = {
    hoteltime: [folder('2026-12-31', { perDay: ALL_HT, pictures: PICS_HT, closes: { 'trial-balance': 'data' } }), folder('2027-01-01', { perDay: ALL_HT, pictures: PICS_HT })],
    foodstoryDaily: [folder('2026-12-31', { perDay: ALL_FS, pictures: PICS_FS, closes: { salebymonthsum: 'data' } }), folder('2027-01-01', { perDay: ALL_FS, pictures: PICS_FS })],
    foodstoryMonthly: [],
  };
  const r = buildStatus(s, thai('2027-01-02T20:00'), { ...SETUP, goLive: '2026-12-31' });
  assert.match(text(r), /เมื่อวาน 2027-01-01[^\n]*มีข้อมูล 2/);
  assert.match(text(r), /snapshot ปิดงวดเดือน 2026-12[^\n]*ครบ 1\/1/);
  assert.match(text(r), /snapshot ปิดงวดปี 2026[^\n]*ครบ 1\/1/);
  assert.match(text(r), /ยังไม่ได้ดึงรายเดือนของ 2026-12/); // ก่อนวันที่ 5 = แสดงเฉย ๆ
});

test('โฟลเดอร์ของวันที่ผ่านมาที่ไม่มีบันทึกผล (รอบตายกลางทาง) = ปัญหา · HotelTime', () => {
  const s = healthy();
  const r = buildStatus({ ...s, hoteltime: replace(s.hoteltime, { day: '2026-10-10', record: 'running' }) }, EVENING_14, SETUP);
  assert.match(r.problems.join('\n'), /2026-10-10[^\n]*ไม่จบ/);
});

test('🔴 คลังรอบรูปแบบเดิมจริง (ไฟล์ CSV, ช่วงเหลื่อม 3 วัน, runs ว่างของ ticket 11, ใบที่ไม่อยู่ในแคตตาล็อก) อ่านได้ไม่ล้ม — เป็นประวัติ', () => {
  const csvEra: Folder = {
    day: '2026-10-05',
    record: {
      site: 'hoteltime', kind: 'daily', dataThrough: '2026-10-05', skipped: [], runs: [],
      reports: {
        postings: { report: 'postings', status: 'ok', rows: 30, range: { from: '2026-10-03', to: '2026-10-05' }, actualRange: { from: '2026-10-03', to: '2026-10-05' },
          files: [{ file: '2026-10-03_2026-10-05__postings.csv', rows: 30, sha256: 'ab'.repeat(32) }], attempts: 1, finishedAt: '2026-10-05T06:00:00.000Z' },
        'retired-report': { report: 'retired-report', status: 'failed', error: 'x', attempts: 1, finishedAt: '2026-10-05T06:00:00.000Z' },
      },
    },
  };
  const s = healthy();
  const r = buildStatus({ ...s, hoteltime: [csvEra, ...s.hoteltime] }, thai('2026-10-10T20:00'), { ...SETUP, goLive: '2026-10-08' });
  assert.match(text(r), /2026-10-05[^\n]*รูปแบบเดิม[^\n]*ประวัติ/);
  assert.doesNotMatch(r.problems.join('\n'), /2026-10-05|retired-report/);
});

test('🔴 snapshot ปิดงวดแบบรายงานตามวัน (เจ้าของเลือก 2026-10-14): HotelTime ล้มวันที่ 1 ก่อน 18:30 = รอรอบเก็บตก หลังจากนั้น = ปัญหา · พ้นช่วงลองซ้ำ = ปัญหา "หายถาวร" (ให้คนเห็นว่าหายจริง)', () => {
  const s = { ...healthy(), hoteltime: [folder('2026-09-30', { perDay: ALL_HT, pictures: PICS_HT, closes: { 'trial-balance': ['failed', 'Timeout'] } })] };
  const setup = { ...SETUP, goLive: '2026-09-01' };
  const close = (at: string) => buildStatus(s, thai(at), setup).sites[0]!.closes[0]!;
  assert.equal(close('2026-10-01T16:00').level, 'wait');
  assert.equal(close('2026-10-01T19:00').level, 'problem');
  assert.equal(close('2026-10-03T10:00').level, 'problem');
  const lost = buildStatus(s, thai('2026-10-09T10:00'), setup);
  assert.match(lost.problems.join('\n'), /snapshot ปิดงวดเดือน 2026-09[^\n]*หายถาวร/);
});

// ticket 06 ของ exporter-upload-to-uploader: backlog ของขาอัปโหลด — `opts.uploadBacklog` เป็น optional โดยตั้งใจ
// (เรียกแบบเดิมไม่ใส่ต้องให้ผลเหมือนเดิมทุกตัวอักษร ไม่ใช่แค่ไม่พัง)

test('ไม่ใส่ uploadBacklog เลย (เรียกแบบเดิม) → ไม่มี section ใหม่ ผลเหมือนก่อนมี ticket 06 ทุกตัวอักษร', () => {
  const withOpt = buildStatus(healthy(), EVENING_14, SETUP, {});
  const withoutOpt = buildStatus(healthy(), EVENING_14, SETUP);
  assert.deepEqual(withOpt, withoutOpt);
  assert.doesNotMatch(text(withOpt), /อัปโหลด/);
});

test('uploadBacklog: ไม่มีไฟล์ค้างเลยทั้งสอง site → section บอกว่าไม่มีไฟล์ค้าง ไม่กระทบ verdict', () => {
  const r = buildStatus(healthy(), EVENING_14, SETUP, {
    uploadBacklog: [
      { site: 'hoteltime', pending: 0, blocked: 0, stuck: 0, empty: 0 },
      { site: 'foodstory', pending: 0, blocked: 0, stuck: 0, empty: 0 },
    ],
  });
  assert.equal(r.verdict, 'ok');
  assert.match(text(r), /HotelTime: ไม่มีไฟล์ค้าง/);
  assert.match(text(r), /FoodStory: ไม่มีไฟล์ค้าง/);
});

test('uploadBacklog: มีไฟล์รอส่ง/ว่างเฉย ๆ (ไม่ผิดปกติ) → โชว์ตัวเลขแยกกัน แต่ไม่ดึง verdict ให้แย่ลง', () => {
  const r = buildStatus(healthy(), EVENING_14, SETUP, {
    uploadBacklog: [
      { site: 'hoteltime', pending: 5, blocked: 0, stuck: 0, empty: 3 },
      { site: 'foodstory', pending: 0, blocked: 0, stuck: 0, empty: 0 },
    ],
  });
  assert.equal(r.verdict, 'ok');
  assert.deepEqual([r.problems, r.actions], [[], []]);
  assert.match(text(r), /HotelTime: รอส่ง 5[^\n]*ว่าง-ยังไม่ประกาศ 3/);
});

test('uploadBacklog: ไฟล์ค้างถาวร (stuck) → เป็นปัญหา (ปนไปที่ verdict) แยกตัวเลขจากรอส่งชัดเจน', () => {
  const r = buildStatus(healthy(), EVENING_14, SETUP, {
    uploadBacklog: [
      { site: 'hoteltime', pending: 2, blocked: 0, stuck: 1, empty: 0 },
      { site: 'foodstory', pending: 0, blocked: 0, stuck: 0, empty: 0 },
    ],
  });
  assert.equal(r.verdict, 'problem');
  assert.match(r.problems.join('\n'), /HotelTime[^\n]*ค้างถาวร 1/);
  assert.match(text(r), /รอส่ง 2[^\n]*ค้างถาวร 1/); // ตัวเลขแยกกัน ไม่ปนเป็นก้อนเดียว
});

test('uploadBacklog: ไฟล์ถูกบล็อกเพราะ as_of ย้อนหลัง (ไม่มี stuck) → เป็นสิ่งที่ต้องทำ ไม่ใช่ปัญหาหนักสุด', () => {
  const r = buildStatus(healthy(), EVENING_14, SETUP, {
    uploadBacklog: [
      { site: 'hoteltime', pending: 0, blocked: 2, stuck: 0, empty: 0 },
      { site: 'foodstory', pending: 0, blocked: 0, stuck: 0, empty: 0 },
    ],
  });
  assert.equal(r.verdict, 'action');
  assert.match(r.actions.join('\n'), /HotelTime[^\n]*บล็อก\(as_of\) 2[^\n]*คุยกับทีม uploader/);
});
