import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPage, findDateRangeGroups, type PageProbe } from '../src/sites/hoteltime/sweep-classify.ts';

const REACHABLE: PageProbe = {
  href: '/pms/reports/GuestArrivals.aspx',
  reachable: true,
  title: 'Guest Arrivals',
  exportLinkCount: 0,
  hasMandatoryMarker: false,
  inputNames: [],
};

test('หน้าที่มีลิงก์ export — hasExportLink เป็นจริง', () => {
  const got = classifyPage({ ...REACHABLE, exportLinkCount: 1 });
  assert.equal(got.hasExportLink, true);
});

test('หน้าที่ไม่มีลิงก์ export — hasExportLink เป็นเท็จ', () => {
  const got = classifyPage({ ...REACHABLE, exportLinkCount: 0 });
  assert.equal(got.hasExportLink, false);
});

test('หน้าที่มีป้ายฟิลด์บังคับ — hasMandatoryField เป็นจริง', () => {
  const got = classifyPage({ ...REACHABLE, hasMandatoryMarker: true });
  assert.equal(got.hasMandatoryField, true);
});

test('หน้าที่เปิดได้ — บันทึกชื่อ control ในฟอร์มเต็มรายการ ไม่ใช่แค่จำนวน', () => {
  const got = classifyPage({
    ...REACHABLE,
    inputNames: ['ctl00$pc$btnFind', 'ctl00$pc$calArrival$calFrom'],
  });
  assert.deepEqual(got.inputNames, ['ctl00$pc$btnFind', 'ctl00$pc$calArrival$calFrom']);
  assert.equal(got.inputCount, 2);
});

test('ฟิลด์ระบบของ WebForms (__VIEWSTATE ฯลฯ) ถูกกรองออก — มีเหมือนกันทุกหน้า ไม่ใช่ control เฉพาะ', () => {
  const got = classifyPage({
    ...REACHABLE,
    inputNames: [
      '__VIEWSTATE',
      '__EVENTTARGET',
      '__EVENTARGUMENT',
      '__VIEWSTATE_KEY',
      '__EVENTVALIDATION',
      '__SessionHotelToken',
      'ctl00$pc$btnFind',
    ],
  });
  assert.deepEqual(got.inputNames, ['ctl00$pc$btnFind']);
  assert.equal(got.inputCount, 1);
});

test('หน้าที่เปิดไม่ได้ — บันทึก reachable เท็จ พร้อมเหตุผล ไม่เดาข้อมูลอื่น', () => {
  const got = classifyPage({
    href: '/pms/reports/Broken.aspx',
    reachable: false,
    errorMessage: 'timeout หลัง 15000ms',
  });
  assert.equal(got.reachable, false);
  assert.equal(got.errorMessage, 'timeout หลัง 15000ms');
  assert.equal(got.hasExportLink, false);
  assert.equal(got.hasMandatoryField, false);
  assert.deepEqual(got.dateRangeGroups, []);
  assert.deepEqual(got.inputNames, []);
  assert.equal(got.inputCount, 0);
});

test('findDateRangeGroups: จับคู่ $calFrom/$calTo แล้วตัด suffix เหลือแค่ชื่อ group', () => {
  const got = findDateRangeGroups([
    'ctl00$pc$calArrival$calFrom',
    'ctl00$pc$calArrival$calTo',
    'ctl00$pc$btnFind',
  ]);
  assert.deepEqual(got, ['ctl00$pc$calArrival']);
});

test('findDateRangeGroups: หลาย group ไม่ซ้ำกัน', () => {
  const got = findDateRangeGroups([
    'ctl00$pc$calArrival$calFrom',
    'ctl00$pc$calArrival$calTo',
    'ctl00$pc$calDeparture$calFrom',
    'ctl00$pc$calDeparture$calTo',
  ]);
  assert.deepEqual(got, ['ctl00$pc$calArrival', 'ctl00$pc$calDeparture']);
});

test('findDateRangeGroups: ไม่มีช่องวันที่เลย คืน array ว่าง', () => {
  assert.deepEqual(findDateRangeGroups(['ctl00$pc$btnFind', 'ctl00$pc$tbSearch']), []);
});

// ── ชื่อปุ่ม (2026-09-28): หน้าที่ปุ่ม export โผล่หลังกด Search/Display เท่านั้น ถูกนับเป็น "ไม่มี
// export" เพราะตัวกวาดไม่กดอะไร (ADR-0001) — เก็บชื่อปุ่มไว้ให้เห็นว่าหน้าไหนน่าสงสัย ไม่ใช่หลักฐาน ──

test('buttonNames: เอาเฉพาะชื่อที่ส่วนท้ายขึ้นต้นด้วย btn ทั้งจาก input และลิงก์ postback ไม่ซ้ำ', () => {
  const got = classifyPage({
    ...REACHABLE,
    inputNames: ['__VIEWSTATE', 'ctl00$pc$btnFind', 'ctl00$pc$tbName', 'ctl00$pc$calArrival$calFrom'],
    postbackTargets: ['ctl00$pc$btnFind', 'ctl00$pc$btnExportPDF', 'ctl00$pc$grid$ctl02$lnkEdit'],
  });
  assert.deepEqual(got.buttonNames, ['ctl00$pc$btnFind', 'ctl00$pc$btnExportPDF']);
});

test('searchButton: ปุ่มชื่อคล้ายค้นหา (Find/Show/Search/Display/Refresh/View/Filter) ตัวแรก', () => {
  assert.equal(classifyPage({ ...REACHABLE, inputNames: ['ctl00$pc$btnSave', 'ctl00$pc$btnShow'] }).searchButton, 'ctl00$pc$btnShow');
  assert.equal(classifyPage({ ...REACHABLE, postbackTargets: ['ctl00$pc$btnDisplayReport'] }).searchButton, 'ctl00$pc$btnDisplayReport');
  assert.equal(classifyPage({ ...REACHABLE, inputNames: ['ctl00$pc$btnSave', 'ctl00$pc$btnDelete'] }).searchButton, null);
});

test('หน้าที่เปิดไม่ได้ — ไม่มีปุ่ม ไม่เดา', () => {
  const got = classifyPage({ href: 'x.aspx', reachable: false, errorMessage: 'timeout' });
  assert.deepEqual(got.buttonNames, []);
  assert.equal(got.searchButton, null);
});

test('findDateRangeGroups นับเป็นช่วงเฉพาะเมื่อมีครบทั้ง calFrom และ calTo — ครึ่งเดียวไม่ใช่ช่วง', () => {
  assert.deepEqual(findDateRangeGroups(['ctl00$pc$calFrom', 'ctl00$pc$btnFind']), []);
  assert.deepEqual(findDateRangeGroups(['ctl00$pc$dr$calFrom', 'ctl00$pc$dr$calTo']), ['ctl00$pc$dr']);
});
