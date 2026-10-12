import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildStatus, type DayRun, type MonthRun, type StoreSnapshot } from '../src/core/status.ts';

// Ubuntu ticket 05: `exporter status` — สรุปภาษาไทยหน้าเดียวให้คนที่ไม่มี AI ช่วยรู้ว่าระบบปกติไหม (seam ตกลงกับเจ้าของ 2026-10-12:
// ฟังก์ชันล้วน "รายการรอบ + เวลาตอนนี้" → สรุป และรันคำสั่งจริงกับคลังปลอม) · กติกาที่เจ้าของเลือก: HotelTime (รันเอง) ขาด/ล้ม = ปัญหา
// · FoodStory (คนกด) เมื่อวานยังไม่ได้ดึง = เตือนให้กด วันก่อนหน้าที่ขาดแค่แสดง · รายเดือนเดือนที่แล้วยังไม่มีหลังวันที่ 5 = เตือนให้ดึง

/** เวลาไทย → instant (UTC+7) */
const thai = (iso: string) => new Date(`${iso}+07:00`);
const ok = (day: string, total = 48): DayRun => ({ day, passed: total, total, failed: [] });
const failed = (day: string, report = 'arrivals'): DayRun => ({ day, passed: 47, total: 48, failed: [{ report, error: 'Timeout 60000ms exceeded' }] });
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-10-${String(from + i).padStart(2, '0')}`);
const month = (period: string, failures = 0): MonthRun => ({
  period, pulledOn: '2026-10-12', passed: 49 - failures, total: 49,
  failed: Array.from({ length: failures }, (_, i) => ({ report: `r${i}`, error: 'x' })),
});
const store = (s: Partial<StoreSnapshot>): StoreSnapshot => ({ hoteltime: [], foodstoryDaily: [], foodstoryMonthly: [], ...s });
const healthy = () => store({
  hoteltime: days(1, 12).map((d) => ok(d)),
  foodstoryDaily: [ok('2026-10-05', 49), ok('2026-10-11', 49)],
  foodstoryMonthly: [month('2026-09')],
});
const text = (r: ReturnType<typeof buildStatus>) => r.sections.flatMap((s) => [s.title, ...s.lines.map((l) => l.text)]).join('\n');

test('ทุกอย่างปกติ: ปกติ ไม่มีปัญหา ไม่มีสิ่งต้องทำ · วันที่ FoodStory ไม่ได้กดแสดงเฉย ๆ', () => {
  const r = buildStatus(healthy(), thai('2026-10-12T20:05'));
  assert.equal(r.verdict, 'ok');
  assert.deepEqual([r.problems, r.actions], [[], []]);
  assert.match(text(r), /2026-10-12[\s\S]*48\/48/);
  assert.match(text(r), /ไม่ได้กด[\s\S]*10-06[\s\S]*10-10/);
});

test('HotelTime ขาดวันที่ผ่านมาแล้ว = ปัญหา บอกวันที่', () => {
  const s = healthy();
  const r = buildStatus({ ...s, hoteltime: s.hoteltime.filter((d) => d.day !== '2026-10-09') }, thai('2026-10-12T20:05'));
  assert.equal(r.verdict, 'problem');
  assert.match(r.problems.join('\n'), /2026-10-09/);
});

test('HotelTime วันนี้ยังไม่มีรอบ: ก่อน 15:00 = รอ · หลัง 15:00 = ปัญหา ชี้ไปดู Windmill', () => {
  const s = healthy();
  const noToday = { ...s, hoteltime: s.hoteltime.filter((d) => d.day !== '2026-10-12') };
  const early = buildStatus(noToday, thai('2026-10-12T11:00'));
  assert.equal(early.verdict, 'ok');
  assert.match(text(early), /รอ/);
  const late = buildStatus(noToday, thai('2026-10-12T15:30'));
  assert.equal(late.verdict, 'problem');
  assert.match(late.problems.join('\n'), /Windmill/);
});

test('HotelTime วันนี้มีใบล้ม: ก่อน 18:30 = รอรอบเก็บตก · หลังจากนั้น = ปัญหา บอกชื่อใบ', () => {
  const s = healthy();
  const withFail = { ...s, hoteltime: [...s.hoteltime.filter((d) => d.day !== '2026-10-12'), failed('2026-10-12', 'housekeeping')] };
  const afternoon = buildStatus(withFail, thai('2026-10-12T16:00'));
  assert.equal(afternoon.verdict, 'ok');
  assert.match(text(afternoon), /เก็บตก/);
  const evening = buildStatus(withFail, thai('2026-10-12T19:00'));
  assert.equal(evening.verdict, 'problem');
  assert.match(evening.problems.join('\n'), /housekeeping/);
});

test('HotelTime วันที่ผ่านมาแล้วมีใบล้ม = ปัญหา (รอบเก็บตกของวันนั้นจบไปแล้ว)', () => {
  const s = healthy();
  const r = buildStatus({ ...s, hoteltime: [...s.hoteltime.filter((d) => d.day !== '2026-10-10'), failed('2026-10-10')] }, thai('2026-10-12T20:05'));
  assert.equal(r.verdict, 'problem');
  assert.match(r.problems.join('\n'), /2026-10-10[\s\S]*arrivals/);
});

test('เครื่องใหม่: วันก่อนรอบแรกสุดไม่นับว่าขาด · ยังไม่เคยมีรอบ HotelTime เลย = ปัญหา บอกให้ตั้งค่า Windmill', () => {
  const fresh = buildStatus(store({ hoteltime: [ok('2026-10-11'), ok('2026-10-12')], foodstoryDaily: [ok('2026-10-11', 49)] }), thai('2026-10-12T20:05'));
  assert.deepEqual(fresh.problems, []);
  assert.doesNotMatch(text(fresh), /ไม่ได้กด/);
  const none = buildStatus(store({}), thai('2026-10-12T20:05'));
  assert.equal(none.verdict, 'problem');
  assert.match(none.problems.join('\n'), /Windmill/);
});

test('FoodStory เมื่อวานยังไม่ได้ดึง = สิ่งที่ต้องทำ (ไม่ใช่ปัญหาระบบ) บอกให้ดับเบิลคลิก', () => {
  const s = healthy();
  const r = buildStatus({ ...s, foodstoryDaily: [ok('2026-10-05', 49)] }, thai('2026-10-12T20:05'));
  assert.equal(r.verdict, 'action');
  assert.deepEqual(r.problems, []);
  assert.match(r.actions.join('\n'), /2026-10-11[\s\S]*ดับเบิลคลิก/);
});

test('FoodStory เมื่อวานดึงแล้วแต่มีใบล้ม = ปัญหา', () => {
  const s = healthy();
  const r = buildStatus({ ...s, foodstoryDaily: [ok('2026-10-05', 49), failed('2026-10-11', 'pay')] }, thai('2026-10-12T20:05'));
  assert.equal(r.verdict, 'problem');
  assert.match(r.problems.join('\n'), /pay/);
});

test('FoodStory รายเดือนของเดือนที่แล้ว: ยังไม่มีก่อนวันที่ 5 = แสดงเฉย ๆ · หลังวันที่ 5 = ต้องทำ · มีแต่ล้ม = ปัญหา', () => {
  const s = healthy();
  const noMonth = { ...s, foodstoryMonthly: [] };
  const early = buildStatus(noMonth, thai('2026-10-04T10:00'));
  assert.doesNotMatch(early.actions.join('\n'), /2026-09/);
  assert.match(text(early), /ยังไม่ได้ดึงรายเดือนของ 2026-09/);
  const late = buildStatus(noMonth, thai('2026-10-06T10:00'));
  assert.match(late.actions.join('\n'), /2026-09/);
  const bad = buildStatus({ ...s, foodstoryMonthly: [month('2026-09', 2)] }, thai('2026-10-12T20:05'));
  assert.equal(bad.verdict, 'problem');
});

test('ตัดวันตามเวลาไทย: 00:30 ของวันที่ 13 (ยังเป็นวันที่ 12 ใน UTC) วันนี้คือ 13 และเมื่อวานคือ 12', () => {
  const s = healthy();
  const r = buildStatus({ ...s, foodstoryDaily: [ok('2026-10-11', 49)] }, thai('2026-10-13T00:30'));
  assert.match(r.actions.join('\n'), /2026-10-12/);
  assert.match(text(r), /2026-10-13/);
});

test('ข้ามปี: 2027-01-02 เมื่อวานคือ 2027-01-01 และรายเดือนที่ต้องมีคือ 2026-12', () => {
  const r = buildStatus(store({ hoteltime: [ok('2027-01-02')] }), thai('2027-01-02T20:00'));
  assert.match(r.actions.join('\n'), /2027-01-01/);
  assert.match(text(r), /2026-12/);
});

test('วันนี้มีโฟลเดอร์แต่ยังไม่มีบันทึกผล (กำลังรัน) = รอ ไม่ใช่ "ยังไม่มีรอบ" · วันที่ผ่านมาที่ไม่จบ = ปัญหา', () => {
  const s = healthy();
  const running = { ...s, hoteltime: [...s.hoteltime.filter((d) => d.day !== '2026-10-12'), { day: '2026-10-12', passed: 0, total: 0, failed: [], state: 'running' as const }] };
  const r = buildStatus(running, thai('2026-10-12T16:00'));
  assert.equal(r.verdict, 'ok');
  assert.match(text(r), /กำลังรัน/);
  const stuck = { ...s, hoteltime: [...s.hoteltime.filter((d) => d.day !== '2026-10-10'), { day: '2026-10-10', passed: 0, total: 0, failed: [], state: 'running' as const }] };
  assert.match(buildStatus(stuck, thai('2026-10-12T20:05')).problems.join('\n'), /2026-10-10[\s\S]*ไม่จบ/);
});

test('_run.json อ่านไม่ได้ = ปัญหา บอกว่าไฟล์เสีย (ทั้งรายวันและรายเดือน)', () => {
  const s = healthy();
  const bad = { ...s,
    hoteltime: [...s.hoteltime.filter((d) => d.day !== '2026-10-11'), { day: '2026-10-11', passed: 0, total: 0, failed: [], state: 'unreadable' as const }],
    foodstoryMonthly: [{ ...month('2026-09'), state: 'unreadable' as const }] };
  const r = buildStatus(bad, thai('2026-10-12T20:05'));
  assert.equal(r.problems.filter((p) => /อ่านไม่ได้/.test(p)).length, 2);
});

test('ใบที่ล้มรอบนี้แต่ใช้ไฟล์ของรอบก่อน: นับว่าได้ และบอกจำนวนไว้ (ไม่ขัดกับ _summary.txt ที่ยังแสดง ✘)', () => {
  const s = healthy();
  const r = buildStatus({ ...s, foodstoryDaily: [{ ...ok('2026-10-11', 49), fromEarlier: 2 }] }, thai('2026-10-12T20:05'));
  assert.equal(r.verdict, 'ok');
  assert.match(text(r), /49\/49[\s\S]*รอบก่อน 2 ใบ/);
});

// ── คำสั่งจริงกับคลังปลอม ──
const EXPORTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs: string[] = [];
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
async function writeRun(dataDir: string, rel: string, record: object): Promise<void> {
  await mkdir(path.join(dataDir, rel), { recursive: true });
  await writeFile(path.join(dataDir, rel, '_run.json'), JSON.stringify(record));
}
const record = (site: string, kind: string, dataThrough: string, reports: Record<string, object>) => ({
  site, kind, dataThrough, skipped: [],
  runs: [{ startedAt: `${dataThrough}T05:00:00.000Z`, finishedAt: `${dataThrough}T06:00:00.000Z`, reports: Object.keys(reports) }],
  reports,
});
function status(dataDir: string, at: string, json = false) {
  const r = spawnSync(process.execPath, ['src/index.ts', 'status', '--data', dataDir, '--at', at, ...(json ? ['--json'] : [])],
    { cwd: EXPORTER, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('exporter status กับคลังปลอม: อ่าน _run.json (ใบที่ล้มแต่ไฟล์รอบก่อนยังอยู่นับว่าได้) · ไม่ต้องมี .env · exit 1 เมื่อมีปัญหา · --json', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'status-data-'));
  dirs.push(dataDir);
  const okR = { status: 'ok', rows: 1 };
  for (const d of ['2026-10-10', '2026-10-11', '2026-10-12']) {
    await writeRun(dataDir, `hoteltime/daily/2026-10/${d}`, record('hoteltime', 'daily', d, { a: okR, b: okR }));
  }
  await writeRun(dataDir, 'foodstory/daily/2026-10/2026-10-11', record('foodstory', 'daily', '2026-10-11', {
    a: okR, b: { status: 'failed', error: 'Timeout', previousOk: { status: 'ok', rows: 1 } },
  }));
  await writeRun(dataDir, 'foodstory/monthly/2026-09', record('foodstory', 'monthly', '2026-09-30', { a: okR }));

  const good = status(dataDir, '2026-10-12T13:05:00Z');
  assert.equal(good.code, 0, good.out);
  assert.match(good.out, /ปกติ/);
  assert.match(good.out, /2026-10-11[\s\S]*2\/2/);

  await writeRun(dataDir, 'hoteltime/daily/2026-10/2026-10-12', record('hoteltime', 'daily', '2026-10-12', {
    a: okR, b: { status: 'failed', error: 'Timeout 60000ms exceeded' },
  }));
  const bad = status(dataDir, '2026-10-12T13:05:00Z');
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /2026-10-12[\s\S]*\bb\b/);

  // รายเดือนดึงซ้ำบางใบอีกวัน (ล้ม) — ผลของเดือนคือรวมทุกโฟลเดอร์ของเดือนนั้น ไม่ใช่โฟลเดอร์ล่าสุดโฟลเดอร์เดียว
  const late = (d: string, reports: Record<string, object>) => ({ ...record('foodstory', 'monthly', '2026-09-30', reports),
    runs: [{ startedAt: `${d}T05:00:00.000Z`, finishedAt: `${d}T06:00:00.000Z`, reports: Object.keys(reports) }] });
  await writeRun(dataDir, 'foodstory/monthly/2026-09__2026-10-03', late('2026-10-03', { a: { status: 'failed', error: 'Timeout' } }));
  const merged = status(dataDir, '2026-10-12T13:05:00Z', true);
  const monthLine = JSON.parse(merged.out).sections[2].lines[0];
  assert.equal(monthLine.level, 'ok', merged.out);
  assert.match(monthLine.text, /1\/1/);

  // _run.json รูปแบบผิด (ไม่มี reports) ต้องไม่ทำให้ทั้งคำสั่งพัง
  await writeRun(dataDir, 'hoteltime/daily/2026-10/2026-10-09', {});
  const shaped = status(dataDir, '2026-10-12T13:05:00Z');
  assert.match(shaped.out, /2026-10-09[\s\S]*อ่านไม่ได้/);
  assert.doesNotMatch(shaped.out, /TypeError|at .*\.ts:/);

  const json = status(dataDir, '2026-10-12T13:05:00Z', true);
  const parsed = JSON.parse(json.out);
  assert.equal(parsed.verdict, 'problem');
  assert.ok(Array.isArray(parsed.problems) && parsed.problems.length === 2); // วันนี้ล้ม + 10-09 อ่านไม่ได้
});

test('exporter status: โฟลเดอร์คลังไม่มีอยู่ = บอกว่าหาไม่เจอ (ไม่โทษ Windmill) exit 2 · option ผิด exit 2 · --at ไม่มี timezone = เวลาไทย', async () => {
  const missing = status('/nonexistent/exporter-data', '2026-10-12T13:05:00Z');
  assert.equal(missing.code, 2, missing.out);
  assert.match(missing.out, /ไม่พบโฟลเดอร์/);
  assert.doesNotMatch(missing.out, /Windmill/);
  const dataDir = await mkdtemp(path.join(tmpdir(), 'status-data-'));
  dirs.push(dataDir);
  const badOpt = spawnSync(process.execPath, ['src/index.ts', 'status', '--data', dataDir, '--days', '1'], { cwd: EXPORTER, encoding: 'utf8' });
  assert.equal(badOpt.status, 2);
  const local = spawnSync(process.execPath, ['src/index.ts', 'status', '--data', dataDir, '--at', '2026-10-12T00:30', '--json'], { cwd: EXPORTER, encoding: 'utf8' });
  assert.equal(JSON.parse(local.stdout).at, '2026-10-12 00:30');
});

test('มีทั้งปัญหาและสิ่งที่ต้องทำ: บรรทัดสุดท้ายต้องเป็น ✘ (คนอ่านแค่บรรทัดท้ายต้องไม่พลาดปัญหา)', async () => {
  const { renderStatus } = await import('../src/core/status.ts');
  const out = renderStatus(buildStatus(store({}), thai('2026-10-12T20:05'))).trimEnd().split('\n');
  assert.match(out.at(-1)!, /^✘/);
});
