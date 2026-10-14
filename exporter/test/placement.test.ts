import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { utcDate } from '../src/core/order.ts';
import { dailyFolder, dataFileName, latestPointer, foodstoryFileName, monthlyFolder, monthlyRoot, pictureFileName, runFolder, supersededPath } from '../src/core/placement.ts';

// คลังผลลัพธ์ (ADR-0005): data/<site>/daily/<YYYY-MM>/<YYYY-MM-DD>/ · วันที่ = วันสุดท้ายที่ข้อมูลครอบคลุม
const ROOT = '/p/data';

test('รอบรายวันลงโฟลเดอร์ของวันสุดท้ายที่ข้อมูลครอบคลุม จัดกลุ่มเป็นรายเดือน', () => {
  const range = { from: utcDate(2026, 10, 5), to: utcDate(2026, 10, 7) };
  assert.equal(dailyFolder(ROOT, 'hoteltime', range), '/p/data/hoteltime/daily/2026-10/2026-10-07');
});

test('FoodStory ดึงเมื่อวาน → โฟลเดอร์ของเมื่อวาน ไม่ใช่วันที่รัน', () => {
  const yesterday = { from: utcDate(2026, 10, 6), to: utcDate(2026, 10, 6) };
  assert.equal(dailyFolder(ROOT, 'foodstory', yesterday), '/p/data/foodstory/daily/2026-10/2026-10-06');
});

test('ข้อมูลข้ามปีอยู่ในเดือนของวันสุดท้าย', () => {
  const range = { from: utcDate(2025, 12, 30), to: utcDate(2026, 1, 1) };
  assert.equal(dailyFolder(ROOT, 'hoteltime', range), '/p/data/hoteltime/daily/2026-01/2026-01-01');
});

test('ชื่อไฟล์ของวันของข้อมูลวันเดียว: YYYY-MM-DD__<รายงาน> (ISO)', () => {
  const day = { from: utcDate(2026, 10, 12), to: utcDate(2026, 10, 12) };
  assert.equal(dataFileName(day, 'reservations-search', 'xlsx'), '2026-10-12__reservations-search.xlsx');
});

test('🔴 ชื่อไฟล์หลายวันใช้ตัวคั่นช่วงแบบ ISO 8601 "--" (แทน "/" ที่ใช้ในชื่อไฟล์ไม่ได้) ไม่ใช่ "_"', () => {
  const range = { from: utcDate(2026, 10, 1), to: utcDate(2026, 10, 31) };
  assert.equal(dataFileName(range, 'reservations-search', 'xlsx'), '2026-10-01--2026-10-31__reservations-search.xlsx');
});

test('🔴 ชื่อไฟล์รายงานภาพ: เวลาที่ถ่ายแบบ ISO ย่อ YYYYMMDDTHHMMSS+0700 (ไม่มี ":" — เปิดบน Windows ได้)', () => {
  // 05:00:00Z = เที่ยงวันเวลาไทย
  assert.equal(pictureFileName(new Date('2026-10-13T05:00:00Z'), 'arrivals', 'xlsx'), '20261013T120000+0700__arrivals.xlsx');
});

test('🔴 ชื่อไฟล์รายงานภาพตัดวันตามเวลาไทย — 17:00Z คือเที่ยงคืนของวันถัดไปในไทย', () => {
  assert.equal(pictureFileName(new Date('2026-10-12T17:00:00Z'), 'arrivals', 'xlsx'), '20261013T000000+0700__arrivals.xlsx');
  assert.equal(pictureFileName(new Date('2026-10-12T16:59:59Z'), 'arrivals', 'xlsx'), '20261012T235959+0700__arrivals.xlsx');
});

test('ตัวชี้ latest ของรอบรายวันอยู่ที่ data/<site>/daily/latest', () => {
  assert.equal(latestPointer(ROOT, 'hoteltime', 'daily'), '/p/data/hoteltime/daily/latest');
});

// ชนิดรอบอื่น — ย้ายมาจาก output-dir.test.ts (ticket 02): เดิมทุกรอบใช้ downloads/ ร่วมกัน รอบ 12:00 ของ
// Windmill (--daily) เขียนทับ back-fill จนเหลือแค่ 3 วันล่าสุด (เจอ 2026-09-29) — แต่ละชนิดรอบต้องคนละที่
const RANGE = { from: utcDate(2024, 1, 1), to: utcDate(2026, 9, 29) };
const AT = new Date('2026-09-29T08:04:05Z'); // 15:04:05 เวลาไทย — ชื่อโฟลเดอร์ต้องเป็นเวลาไทยไม่ว่าเครื่องตั้ง TZ อะไร (ticket 27)

test('runFolder ของรอบรายวันเท่ากับ dailyFolder', () => {
  const day = { from: utcDate(2026, 9, 27), to: utcDate(2026, 9, 29) };
  assert.equal(runFolder(ROOT, 'hoteltime', 'daily', day, AT), dailyFolder(ROOT, 'hoteltime', day));
});

test('baseline ลงโฟลเดอร์ของวันที่รัน — ใบเก่าไม่ถูกแทนที่ (ADR-0005)', () => {
  assert.equal(runFolder(ROOT, 'hoteltime', 'baseline', RANGE, AT), '/p/data/hoteltime/baseline/2026-09-29');
  assert.equal(runFolder(ROOT, 'hoteltime', 'baseline', RANGE, new Date('2026-10-29T02:00:00Z')), '/p/data/hoteltime/baseline/2026-10-29');
});

test('back-fill / --from/--to / --last-days ลงโฟลเดอร์ของรอบนั้นตามเวลาที่รัน', () => {
  assert.equal(runFolder(ROOT, 'hoteltime', 'manual', RANGE, AT), '/p/data/hoteltime/backfill/2026-09-29_150405');
  assert.notEqual(
    runFolder(ROOT, 'hoteltime', 'manual', RANGE, AT),
    runFolder(ROOT, 'hoteltime', 'manual', RANGE, new Date('2026-09-29T08:04:06Z')),
  );
});

test('ชนิดรอบต่างกันได้ path ไม่ซ้ำกันเลย แม้ช่วงข้อมูลและเวลาเดียวกัน', () => {
  const paths = (['daily', 'baseline', 'manual'] as const).map((k) => runFolder(ROOT, 'hoteltime', k, RANGE, AT));
  assert.equal(new Set(paths).size, 3);
});

test('ตัวชี้ latest ของ baseline อยู่ที่ data/<site>/baseline/latest', () => {
  assert.equal(latestPointer(ROOT, 'hoteltime', 'baseline'), '/p/data/hoteltime/baseline/latest');
});

// FoodStory รายเดือน (ticket 03): รอบแรกของเดือนได้ monthly/<YYYY-MM>/ · ดึงเดือนเดิมซ้ำได้โฟลเดอร์รอบใหม่ ไม่เขียนทับ (ADR-0005)
test('FoodStory รายเดือน: รอบแรกของเดือนได้ monthly/<YYYY-MM>/', () => {
  assert.equal(monthlyFolder(ROOT, 'foodstory', '2026-08', new Date('2026-09-03T03:00:00Z'), []), '/p/data/foodstory/monthly/2026-08');
});

test('FoodStory รายเดือน: ดึงเดือนเดิมซ้ำได้ <YYYY-MM>__<วันที่ดึง>/ · ดึงซ้ำวันเดียวกันใช้โฟลเดอร์รอบนั้นต่อ', () => {
  const at = new Date('2026-10-07T03:00:00Z'); // 10:00 เวลาไทย — instant ตายตัว ไม่ขึ้นกับ TZ เครื่อง (ticket 27)
  assert.equal(monthlyFolder(ROOT, 'foodstory', '2026-08', at, ['2026-08']), '/p/data/foodstory/monthly/2026-08__2026-10-07');
  assert.equal(
    monthlyFolder(ROOT, 'foodstory', '2026-08', at, ['2026-08', '2026-08__2026-10-07']),
    '/p/data/foodstory/monthly/2026-08__2026-10-07',
  );
  // เดือนอื่นไม่เกี่ยว
  assert.equal(monthlyFolder(ROOT, 'foodstory', '2026-09', at, ['2026-08']), '/p/data/foodstory/monthly/2026-09');
});

test('FoodStory รายเดือน: เลยเที่ยงคืนเวลาไทยแต่ยังเป็นวันก่อนใน UTC → วันที่ดึงเป็นวันไทย', () => {
  const at = new Date('2026-10-07T18:30:00Z'); // 01:30 ของ 8 ต.ค. เวลาไทย
  assert.equal(monthlyFolder(ROOT, 'foodstory', '2026-08', at, ['2026-08']), '/p/data/foodstory/monthly/2026-08__2026-10-08');
});

test('FoodStory รายเดือน: รากของรอบรายเดือนและชื่อไฟล์ <ช่วง>__<กลุ่ม>__<id>.<ext> มาจากตัววางไฟล์ที่เดียว', () => {
  assert.equal(monthlyRoot(ROOT, 'foodstory'), '/p/data/foodstory/monthly');
  assert.equal(foodstoryFileName('2026-09', 'sales', 'salebybilldetail_part2', 'xlsx'), '2026-09__sales__salebybilldetail_part2.xlsx');
  assert.equal(foodstoryFileName('2026-10-11', 'sales', 'salebysumdate', 'xlsx'), '2026-10-11__sales__salebysumdate.xlsx');
});

// เจ้าของระบบตัดสิน 2026-10-08: รอบแรกของเดือนเป็นวันนี้ → ดึงซ้ำวันนี้เขียนกลับ <YYYY-MM>/ (รวมผลกับรอบแรก แทนเฉพาะใบที่ผ่าน)
// แทนการแตกเป็นสองโฟลเดอร์ของวันเดียวกัน · วันอื่นยังได้โฟลเดอร์ที่มีวันที่ดึงเหมือนเดิม (ADR-0005)
test('FoodStory รายเดือน: รอบแรกของ <YYYY-MM>/ เป็นวันนี้ (เวลาไทย) → ดึงซ้ำวันนี้ใช้ <YYYY-MM>/ ต่อ', () => {
  const firstRun = new Date('2026-10-08T13:51:00Z'); // 20:51 เวลาไทย
  const at = new Date('2026-10-08T15:30:00Z'); // 22:30 เวลาไทย วันเดียวกัน
  assert.equal(monthlyFolder(ROOT, 'foodstory', '2026-09', at, ['2026-09'], firstRun), '/p/data/foodstory/monthly/2026-09');
});

test('FoodStory รายเดือน: รอบแรกเป็นวันอื่น (ตัดวันตามเวลาไทย) หรือไม่รู้ว่ารอบแรกเมื่อไหร่ → โฟลเดอร์ที่มีวันที่ดึง', () => {
  const at = new Date('2026-10-07T17:30:00Z'); // 00:30 ของ 8 ต.ค. เวลาไทย
  const firstRunLateOnThe7th = new Date('2026-10-07T16:30:00Z'); // 23:30 ของ 7 ต.ค. เวลาไทย (ใน UTC วันเดียวกัน)
  assert.equal(monthlyFolder(ROOT, 'foodstory', '2026-09', at, ['2026-09'], firstRunLateOnThe7th), '/p/data/foodstory/monthly/2026-09__2026-10-08');
  assert.equal(monthlyFolder(ROOT, 'foodstory', '2026-09', at, ['2026-09'], null), '/p/data/foodstory/monthly/2026-09__2026-10-08');
});

test('🔴 ไฟล์ที่ถูกแทนย้ายไป _superseded/ ขึ้นต้นด้วยเวลาที่ย้าย (ISO ย่อเวลาไทย) ตามด้วยชื่อเดิม — ไม่ลบ ไม่ทับ (ADR-0005)', () => {
  assert.equal(
    supersededPath(new Date('2026-10-14T05:00:00Z'), '2026-10-13__reservations-search.xlsx'),
    path.join('_superseded', '20261014T120000+0700__2026-10-13__reservations-search.xlsx'),
  );
});
