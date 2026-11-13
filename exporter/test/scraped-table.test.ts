import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScrapeError, scrapedTableToRawFile, type ScrapeSpec } from '../src/core/scraped-table.ts';

/**
 * ไฟล์ดิบแบบ scrape (ADR-0012 · ticket 02 ของ exporter-audit-trail) — seam S1: ตารางข้อความจากหน้าเว็บ → ไบต์ CSV + สถิติ + ด่านความครบ
 * ฟังก์ชันล้วน ไม่แตะเบราว์เซอร์ · ข้อมูลใน fixture เป็นของปลอมทั้งหมด (รูปแบบเซลล์ตาม recon 2026-11-14)
 */

const HEADER = ['', '', 'Date', 'Operation', 'Object', 'Object connected with operation', 'Description', 'Data', 'User'];
const SPEC: ScrapeSpec = { expectedHeader: HEADER, rowCap: 500, dateColumn: 'Date', day: '2026-11-13' };
const row = (at: string, op: string, data = '') => ['', '', at, op, 'Reservation: 111111111', 'Room of reservation: 505', '12/11/2026-14/11/2026', data, 'FrontUserA'];
// หน้าเว็บเรียงใหม่ไปเก่า
const TABLE = [
  HEADER,
  row('13/11/2026 23:59:24', 'Room status change', 'Status: Check-out'),
  row('13/11/2026 14:15:51', 'Room status change', 'Status: Check-in'),
  row('13/11/2026 00:00:03', 'Login successful'),
];

test('ตาราง → CSV: หัวตามหน้าเว็บ แถวตามหน้าเว็บทุกตัวอักษร (วันที่ไม่แปลง) ไม่กรองแถว', () => {
  const r = scrapedTableToRawFile(TABLE, SPEC);
  assert.equal(
    r.csv,
    ',,Date,Operation,Object,Object connected with operation,Description,Data,User\n' +
      ',,13/11/2026 23:59:24,Room status change,Reservation: 111111111,Room of reservation: 505,12/11/2026-14/11/2026,Status: Check-out,FrontUserA\n' +
      ',,13/11/2026 14:15:51,Room status change,Reservation: 111111111,Room of reservation: 505,12/11/2026-14/11/2026,Status: Check-in,FrontUserA\n' +
      ',,13/11/2026 00:00:03,Login successful,Reservation: 111111111,Room of reservation: 505,12/11/2026-14/11/2026,,FrontUserA\n',
  );
  assert.equal(r.rowCount, 3);
});

test('สถิติ: เวลาแรก/สุดท้ายตามเวลาจริง ไม่ขึ้นกับลำดับแถว', () => {
  const r = scrapedTableToRawFile(TABLE, SPEC);
  assert.deepEqual([r.firstAt, r.lastAt], ['13/11/2026 00:00:03', '13/11/2026 23:59:24']);
});

test('เซลล์ที่มี comma / เครื่องหมายคำพูด / ขึ้นบรรทัดใหม่ ถูก quote แบบ CSV และค่ากลับมาเท่าเดิม', () => {
  const tricky = row('13/11/2026 10:00:00', 'Reservation edit');
  tricky[7] = 'a,b "c"\nd';
  const r = scrapedTableToRawFile([HEADER, tricky], SPEC);
  assert.ok(r.csv.includes(',"a,b ""c""\nd",'), r.csv);
});

test('ด่าน: หัวตารางต้องตรงเป๊ะ ไม่งั้นล้ม (หน้าเปลี่ยนโครงสร้าง) — ข้อความบอกคอลัมน์ที่คาดและที่ได้', () => {
  const bad = [[...HEADER.slice(0, 8), 'Operator'], row('13/11/2026 10:00:00', 'x')];
  assert.throws(() => scrapedTableToRawFile(bad, SPEC), (e: Error) => e instanceof ScrapeError && /หัวตาราง/.test(e.message) && /Operator/.test(e.message));
  assert.throws(() => scrapedTableToRawFile([HEADER.slice(0, 8), row('13/11/2026 10:00:00', 'x')], SPEC), ScrapeError);
});

test('ด่าน: 0 แถว = ล้ม ไม่ใช่ "ว่าง" (ระบบที่ใช้งานอยู่มี login ทุกวัน — ADR-0012)', () => {
  assert.throws(() => scrapedTableToRawFile([HEADER], SPEC), (e: Error) => e instanceof ScrapeError && /0 แถว/.test(e.message));
  assert.throws(() => scrapedTableToRawFile([], SPEC), ScrapeError);
});

test('ด่าน: จำนวนแถวถึงเพดาน = ล้ม (หน้าตัดข้อมูลที่เก่าที่สุดทิ้งเงียบ ๆ) · ต่ำกว่าเพดาน 1 แถวยังผ่าน', () => {
  const rows = (n: number) => Array.from({ length: n }, () => row('13/11/2026 10:00:00', 'Login successful'));
  const spec = { ...SPEC, rowCap: 3 };
  assert.equal(scrapedTableToRawFile([HEADER, ...rows(2)], spec).rowCount, 2);
  assert.throws(() => scrapedTableToRawFile([HEADER, ...rows(3)], spec), (e: Error) => e instanceof ScrapeError && /เพดาน 3/.test(e.message));
});

test('ด่าน: ทุกแถวต้องอยู่ในวันที่สั่ง ไม่งั้นล้ม (ฟิลเตอร์ไม่ทำงาน) — ข้อความไม่มีเนื้อแถว', () => {
  const t = [HEADER, row('13/11/2026 10:00:00', 'x'), row('14/11/2026 00:00:00', 'x')];
  assert.throws(() => scrapedTableToRawFile(t, SPEC), (e: Error) => {
    assert.ok(e instanceof ScrapeError && /นอกวัน 2026-11-13/.test(e.message), e.message);
    assert.doesNotMatch(e.message, /FrontUserA|111111111|505/); // ไม่มีชื่อผู้ใช้/เลขจอง/ห้องในข้อความ
    return true;
  });
});

test('ด่าน: วันที่ในเซลล์อ่านไม่ออก = ล้ม และข้อความไม่มีเนื้อเซลล์', () => {
  const t = [HEADER, row('ไม่ใช่วันที่ FrontUserA', 'x')];
  assert.throws(() => scrapedTableToRawFile(t, SPEC), (e: Error) => e instanceof ScrapeError && !/FrontUserA/.test(e.message));
});

test('🔴 ไม่มีแถวหัวตาราง (แถวแรกเป็นแถวข้อมูล): ข้อความล้มไม่มีเนื้อแถว (ชื่อผู้ใช้/เลขจอง/ห้อง) — รั่วลง log, _run.json, Discord ได้', () => {
  const noHeader = [row('13/11/2026 14:15:51', 'Room status change', 'Status: Check-in'), row('13/11/2026 10:00:00', 'x')];
  assert.throws(() => scrapedTableToRawFile(noHeader, SPEC), (e: Error) => {
    assert.ok(e instanceof ScrapeError && /หัวตาราง/.test(e.message), e.message);
    assert.doesNotMatch(e.message, /FrontUserA|111111111|505|Check-in/);
    return true;
  });
});

test('เพดานจริง 500: 499 แถวผ่าน · 500 แถวล้ม', () => {
  const rows = (n: number) => Array.from({ length: n }, () => row('13/11/2026 10:00:00', 'Login successful'));
  assert.equal(scrapedTableToRawFile([HEADER, ...rows(499)], SPEC).rowCount, 499);
  assert.throws(() => scrapedTableToRawFile([HEADER, ...rows(500)], SPEC), (e: Error) => e instanceof ScrapeError && /เพดาน 500/.test(e.message));
});
