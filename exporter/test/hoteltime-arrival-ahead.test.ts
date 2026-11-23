import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatISO, utcDate } from '../src/core/order.ts';
import { REPORTS, findReport } from '../src/sites/hoteltime/reports/index.ts';
import { lookaheadWindow, DEFAULT_LOOKAHEAD_DAYS } from '../src/sites/hoteltime/reports/arrival-ahead.ts';
import { verifyMerged } from '../src/core/verify.ts';
import { RowCapError, rowCapHalves, verifyChunk } from '../src/sites/hoteltime/verify.ts';
import { makeWorkbook, sheetXml } from './_xlsx-fixture.ts';

/**
 * รายงานล่วงหน้า `arrival-ahead` (ADR-0015, ticket 01) — หน้าเดียวกับ arrival-period แต่เป็น snapshot ช่วง วันนี้ถึง +N ไฟล์เดียวต่อรอบ
 * ไม่ login HotelTime จริง: ทดสอบนิยามรายงาน, ช่วงข้อมูล และด่านตรวจไฟล์ด้วย workbook จำลอง (ไม่มีชื่อแขกจริง)
 */

const ahead = findReport('arrival-ahead')!;
const period = findReport('arrival-period')!;
const TODAY = utcDate(2026, 11, 23);

test('arrival-ahead ลงทะเบียนเป็น snapshot ที่หน้า/คอลัมน์/ด่านวันที่เหมือน arrival-period', () => {
  assert.ok(ahead, 'ยังไม่ลงทะเบียน arrival-ahead');
  assert.equal(ahead.family, 'picture');
  assert.equal(ahead.period, 'none');
  assert.equal(ahead.path, period.path);
  assert.deepEqual(ahead.expectedColumns, period.expectedColumns);
  assert.deepEqual(ahead.allowedControls, period.allowedControls);
  assert.equal(ahead.dateColumn, 'Arrival');
  assert.equal(ahead.boundaryToleranceDays, 0);
  assert.equal(ahead.skipDateCoverageCheck, false);
  assert.equal(ahead.hasRowCap, true);
  assert.equal(ahead.chunk.kind, 'whole');
});

test('ช่วงข้อมูล: วันนี้ถึง +14 ข้ามเดือน = ช่วงเดียว (ไฟล์เดียว) และ manifest/_run.json ใช้ช่วงเดียวกัน', () => {
  const w = lookaheadWindow(TODAY, 14);
  assert.equal(formatISO(w.from), '2026-11-23');
  assert.equal(formatISO(w.to), '2026-12-07');
  assert.equal(DEFAULT_LOOKAHEAD_DAYS, 14);
  // ช่วงที่ขอ (requestWindow) กับช่วงข้อมูลที่ลง manifest (dataWindow) ต้องเป็นอันเดียวกัน
  assert.deepEqual(ahead.requestWindow!(TODAY), ahead.dataWindow!(TODAY));
  assert.equal(formatISO(ahead.requestWindow!(TODAY).to), '2026-12-07');
});

const HEADER = [...ahead.expectedColumns];
const row = (arrival: string) => HEADER.map((c) => (c === 'Arrival' ? arrival : c === '' ? '' : 'x'));
const WINDOW = lookaheadWindow(TODAY, 14);
const book = (name: string, rows: string[][]) =>
  makeWorkbook(name, [{ name: 'Sheet1', file: 'sheet1.xml', xml: sheetXml([HEADER, ...rows]) }]);

test('ด่านวันที่: แถวที่ Arrival อยู่ในช่วงผ่าน และบอกช่วงจริงของไฟล์', () => {
  const v = verifyChunk(ahead, WINDOW, book('ahead-ok.xlsx', [row('23/11/2026'), row('30/11/2026'), row('07/12/2026')]), null);
  assert.equal(v.rowCount, 3);
  assert.equal(formatISO(v.actualSpan.to), '2026-12-07');
});

test('🔴 ด่านวันที่จับ "filter ไม่ทำงาน": มีแถวที่ Arrival นอกช่วง (ไม่มีค่าเผื่อขอบ) = ล้ม', () => {
  assert.throws(() => verifyChunk(ahead, WINDOW, book('ahead-after.xlsx', [row('23/11/2026'), row('08/12/2026')]), null), /หลุดออกนอกที่สั่ง/);
  assert.throws(() => verifyChunk(ahead, WINDOW, book('ahead-before.xlsx', [row('22/11/2026'), row('24/11/2026')]), null), /หลุดออกนอกที่สั่ง/);
});

test('🔴 ชนเพดาน 2000 แถว = RowCapError', () => {
  const rows = Array.from({ length: 2000 }, () => row('25/11/2026'));
  assert.throws(() => verifyChunk(ahead, WINDOW, book('ahead-cap.xlsx', rows), null), (err: Error) => err instanceof RowCapError);
});

test('🔴 ชนเพดานของ arrival-ahead ไม่ผ่าครึ่ง (ล้มดัง ๆ ข้อความชัด) · รายงานอื่นยังผ่าครึ่งตามเดิม', () => {
  assert.throws(() => rowCapHalves(ahead, WINDOW), /arrival-ahead[\s\S]*2000/);
  const halves = rowCapHalves(period, { from: utcDate(2026, 11, 1), to: utcDate(2026, 11, 30) });
  assert.equal(halves.length, 2);
});

test('0 แถว = "ว่าง" ไม่ใช่ล้ม: ช่วงข้ามเดือนทั้งช่วงที่ว่างปูครบพอดี ได้ 0 แถว · ช่วงที่ไม่ครบยังล้ม', () => {
  assert.deepEqual(verifyMerged([], [WINDOW], WINDOW), { totalRows: 0, coveredChunks: 1 });
  const half = { from: WINDOW.from, to: utcDate(2026, 11, 30) };
  assert.throws(() => verifyMerged([], [half], WINDOW));
});

test('ธง neverUpload (ticket 03) อยู่ในนิยามรายงาน: มีเฉพาะ arrival-ahead · arrival-period และรายงานอื่นไม่ติด', () => {
  assert.equal(ahead.neverUpload, true);
  assert.deepEqual(REPORTS.filter((r) => r.neverUpload === true).map((r) => r.id), ['arrival-ahead']);
  assert.equal(period.neverUpload, undefined);
});

/** ticket 05 (seam 3, ด่านตรวจไฟล์): นับแถวที่ชื่อแขกหรือ room type ว่าง — เตือนแต่ไม่ล้ม · ข้อความไม่มีค่าเซลล์ */

const named = (arrival: string, name: string, roomType = 'Deluxe') =>
  HEADER.map((c, i) => (c === 'Arrival' ? arrival : c === 'Name' ? name : c === 'Room type' ? roomType : c === '' ? '' : `v${i}`));
const GUEST = 'Somchai Testname-Zeta';

test('🔴 แถวชื่อว่าง 2 แถว (หนึ่งแถว room type ว่าง) → ยังผ่าน และ verdict นับ blankRows = จำนวนแถวที่ชื่อหรือ room type ว่าง (นับแถวละครั้ง)', () => {
  const p = book('ahead-blank.xlsx', [named('24/11/2026', GUEST), named('25/11/2026', ''), named('26/11/2026', '', ''), named('27/11/2026', GUEST, '')]);
  const v = verifyChunk(ahead, WINDOW, p, null);
  assert.equal(v.rowCount, 4);
  assert.equal(v.blankRows, 3);
});

test('ไฟล์ปกติ → blankRows = 0 · รายงานอื่นที่ไม่ได้ขอเตือน → ไม่มีค่า (ไม่เพิ่ม field ให้ _run.json ของรายงานอื่น)', () => {
  assert.equal(verifyChunk(ahead, WINDOW, book('ahead-clean.xlsx', [named('24/11/2026', GUEST)]), null).blankRows, 0);
  const periodBook = makeWorkbook('period-clean.xlsx', [{ name: 'Sheet1', file: 'sheet1.xml', xml: sheetXml([[...period.expectedColumns], row('24/11/2026')]) }]);
  assert.equal(verifyChunk(period, WINDOW, periodBook, null).blankRows, undefined);
});

test('🔴 ข้อความล้มของด่านตรวจไม่มีค่าเซลล์ (ชื่อแขก): นอกช่วงวัน · ชนเพดาน · เพดานไม่ผ่าครึ่ง', () => {
  const messages: string[] = [];
  const catchMsg = (fn: () => unknown) => { try { fn(); } catch (e) { messages.push((e as Error).message); } };
  catchMsg(() => verifyChunk(ahead, WINDOW, book('pii-out.xlsx', [named('01/01/2027', GUEST)]), null));
  catchMsg(() => verifyChunk(ahead, WINDOW, book('pii-cap.xlsx', Array.from({ length: 2000 }, () => named('25/11/2026', GUEST))), null));
  catchMsg(() => verifyChunk(ahead, WINDOW, book('pii-blank-arrival.xlsx', [named('', GUEST)]), null));
  catchMsg(() => rowCapHalves(ahead, WINDOW));
  assert.equal(messages.length, 4);
  for (const m of messages) assert.ok(!m.includes('Somchai') && !m.includes('Testname'), `ข้อความมีค่าเซลล์: ${m.slice(0, 80)}`);
});

test('blankRows ลง _run.json ของรอบ: recordRun เก็บจำนวนไว้กับผลของ arrival-ahead@round-HH · ไม่ทำให้ผลเป็นล้ม', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { recordRun } = await import('../src/core/run-record.ts');
  const folder = await mkdtemp(path.join(tmpdir(), 'ahead-run-'));
  await recordRun(folder, {
    site: 'hoteltime', kind: 'daily', dataThrough: '2026-11-23', startedAt: new Date(), finishedAt: new Date(),
    outcomes: [{ report: 'arrival-ahead@round-12', status: 'ok', rows: 48, range: { from: '2026-11-23', to: '2026-12-07' }, actualRange: null, files: [], blankRows: 2, attempts: 1 }],
  });
  const rec = JSON.parse(await readFile(path.join(folder, '_run.json'), 'utf8'));
  assert.equal(rec.reports['arrival-ahead@round-12'].status, 'ok');
  assert.equal(rec.reports['arrival-ahead@round-12'].blankRows, 2);
});

test('currentDays ใช้ตัวอ่านตัวเดียวกับ config: ค่าผิดโยน error (ไม่ถอยเงียบไป 14) · ว่าง = 14 สำหรับสั่งมือ · "7" = 7', () => {
  const saved = process.env.HOTELTIME_LOOKAHEAD_DAYS;
  try {
    process.env.HOTELTIME_LOOKAHEAD_DAYS = '';
    assert.equal(formatISO(ahead.requestWindow!(TODAY).to), '2026-12-07');
    process.env.HOTELTIME_LOOKAHEAD_DAYS = '7';
    assert.equal(formatISO(ahead.requestWindow!(TODAY).to), '2026-11-30');
    for (const bad of ['61', 'abc', '0']) {
      process.env.HOTELTIME_LOOKAHEAD_DAYS = bad;
      assert.throws(() => ahead.requestWindow!(TODAY), /HOTELTIME_LOOKAHEAD_DAYS/);
    }
  } finally {
    if (saved === undefined) delete process.env.HOTELTIME_LOOKAHEAD_DAYS; else process.env.HOTELTIME_LOOKAHEAD_DAYS = saved;
  }
});
