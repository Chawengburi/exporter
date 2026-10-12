import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXCLUDED_FROM_PROBE,
  controlsOf,
  findDateColumns,
  judgeProbe,
  selectProbeTargets,
  type ProbeObservation,
} from '../src/sites/hoteltime/probe-classify.ts';

// การตรวจเบื้องต้น (CONTEXT.md) — ticket 09 ของ exporter-daily-expansion-and-data-store

const SWEEP = {
  hasExport: [
    { href: 'reports/RoomArrivals.aspx', title: 'Arrivals', inputNames: ['ctl00$pc$calDate', 'ctl00$pc$btnFind'], dateRangeGroups: [] },
    { href: 'reports/PostingsReport.aspx', title: 'Postings report', inputNames: ['ctl00$pc$dtr$calFrom', 'ctl00$pc$dtr$calTo', 'ctl00$pc$btnShow'], dateRangeGroups: ['ctl00$pc$dtr'] },
    { href: 'Payment/PaymentList.aspx?target=Card', title: 'Payment list', inputNames: [], dateRangeGroups: [] },
  ],
  noExport: [
    { href: 'SubjectMerge.aspx', title: 'Merge profiles', searchButton: 'ctl00$pc$btnFind', buttonNames: ['ctl00$pc$btnFind'] },
    { href: 'reports/BedSheetReport.aspx', title: 'Linen change report', searchButton: 'ctl00$pc$btnFind', buttonNames: ['ctl00$pc$btnFind'] },
    { href: 'Welcomepage.aspx', title: 'Home', buttonNames: [] },
  ],
};

test('เลือกหน้าที่จะตรวจ: หน้ามีปุ่ม export + หน้าที่มีปุ่มค้นหา · ตัดรายงานที่ทำแล้ว หน้าที่ปิดถาวร และหน้าที่ไม่มีอะไรให้ลอง', () => {
  const targets = selectProbeTargets(SWEEP, ['reports/RoomArrivals.aspx']);
  assert.deepEqual(targets.map((t) => t.href), ['reports/PostingsReport.aspx', 'reports/BedSheetReport.aspx']);
});

test('ห้ามตรวจหน้าสั่งงาน/หน้าตั้งค่า 5 หน้าเด็ดขาด แม้จะมีปุ่มค้นหา', () => {
  assert.deepEqual([...EXCLUDED_FROM_PROBE].sort(), [
    'AccountingQueuesOverview.aspx',
    'SubjectMerge.aspx',
    'payment/PaymentBookList.aspx',
    'res3/HotelPopupNotes.aspx',
    'settings/ImportantDay.aspx',
  ]);
  const targets = selectProbeTargets(SWEEP, []);
  assert.equal(targets.some((t) => EXCLUDED_FROM_PROBE.has(t.href)), false);
});

test('หน้าที่จะตรวจรู้ชื่อปุ่มค้นหา ช่วงวันที่ และช่องวันเดียวของตัวเอง', () => {
  const [postings, linen] = selectProbeTargets(SWEEP, ['reports/RoomArrivals.aspx']);
  assert.deepEqual(postings, {
    href: 'reports/PostingsReport.aspx',
    title: 'Postings report',
    searchButton: 'ctl00$pc$btnShow',
    dateRangeGroups: ['ctl00$pc$dtr'],
    singleDates: [],
  });
  assert.equal(linen?.searchButton, 'ctl00$pc$btnFind');
});

test('ช่องวันที่เดี่ยว (calDate) ถูกแยกจากคู่ calFrom/calTo ของช่วงวันที่', () => {
  const [arrivals] = selectProbeTargets(SWEEP, []);
  assert.deepEqual(arrivals?.singleDates, ['ctl00$pc$calDate']);
  assert.deepEqual(arrivals?.dateRangeGroups, []);
});

test('หาคอลัมน์วันที่จากข้อมูลจริง — คอลัมน์ที่ค่าส่วนใหญ่เป็นวันที่', () => {
  const header = ['Name', 'Created', 'Amount'];
  const rows = [
    ['A', '01/10/2026', '100'],
    ['B', '45931', '200'],
    ['C', '', '300'],
  ];
  assert.deepEqual(findDateColumns(header, rows), ['Created']);
});

const BASE: ProbeObservation = {
  href: 'reports/PostingsReport.aspx',
  exportLinkCount: 1,
  exportLinkCountBeforeSearch: 1,
  formRejected: false,
  downloaded: true,
  rows: 12,
  dateColumns: ['Posting date'],
  dateRangeGroups: ['ctl00$pc$dtr'],
  singleDates: [],
  error: null,
};

test('ผ่าน + ledger: กรองด้วยช่วงวันที่ได้ และผลมีคอลัมน์วันที่ให้ตรวจว่าปูเต็ม', () => {
  assert.deepEqual(judgeProbe(BASE), { verdict: 'pass', dailyMode: 'ledger', reason: 'กรองช่วงวันที่ได้ และผลมีคอลัมน์วันที่ Posting date' });
});

test('ผ่าน + ภาพของวันนั้น: มีช่องวันเดียว ไม่มีช่วงวันที่', () => {
  const got = judgeProbe({ ...BASE, dateRangeGroups: [], singleDates: ['ctl00$pc$calDate'], dateColumns: [] });
  assert.equal(got.verdict, 'pass');
  assert.equal(got.dailyMode, 'snapshot');
});

test('ผ่าน + ภาพรวม: ไม่มีตัวกรองวันที่เลย เก็บเป็นภาพรวมของวันนั้นทุกวัน', () => {
  const got = judgeProbe({ ...BASE, dateRangeGroups: [], singleDates: [], dateColumns: [] });
  assert.equal(got.verdict, 'pass');
  assert.equal(got.dailyMode, 'whole');
});

test('บอกแบบรอบรายวันไม่ได้: กรองช่วงวันที่ได้แต่ผลไม่มีคอลัมน์วันที่ให้ตรวจว่าปูเต็ม', () => {
  assert.equal(judgeProbe({ ...BASE, dateColumns: [] }).verdict, 'undetermined');
});

test('บอกแบบรอบรายวันไม่ได้: ฟอร์มถูกปฏิเสธเพราะฟิลด์บังคับ หรือมี error ระหว่างตรวจ', () => {
  assert.equal(judgeProbe({ ...BASE, formRejected: true }).verdict, 'undetermined');
  assert.equal(judgeProbe({ ...BASE, downloaded: false, rows: null, error: 'XlsxError: แตกไฟล์ไม่สำเร็จ' }).verdict, 'undetermined');
});

test('ไม่มีปุ่ม export ทั้งก่อนและหลังกดค้นหา', () => {
  assert.equal(
    judgeProbe({ ...BASE, exportLinkCount: 0, exportLinkCountBeforeSearch: 0, downloaded: false, rows: null }).verdict,
    'no-export',
  );
});

test('ปุ่ม export มีตอนเปิดหน้าแต่หายหลังกดค้นหา 90 วัน — นับเป็นไม่มีข้อมูล ไม่ใช่ export ไม่ได้', () => {
  const got = judgeProbe({ ...BASE, exportLinkCount: 0, exportLinkCountBeforeSearch: 1, downloaded: false, rows: null });
  assert.equal(got.verdict, 'no-data');
  assert.match(got.reason, /หายหลังกดค้นหา/);
});

test('ไม่มีข้อมูลใน 90 วัน: กด export แล้วไม่มีไฟล์มา หรือไฟล์ว่าง', () => {
  assert.equal(judgeProbe({ ...BASE, downloaded: false, rows: null }).verdict, 'no-data');
  assert.equal(judgeProbe({ ...BASE, rows: 0 }).verdict, 'no-data');
});

test('ช่องวันที่ที่มีแค่ calFrom (ไม่มี calTo คู่) เป็นช่องวันเดี่ยว ไม่ใช่ช่วงวันที่', () => {
  const got = controlsOf(['ctl00$pc$calFrom', 'ctl00$pc$btnFind']);
  assert.deepEqual(got.dateRangeGroups, []);
  assert.deepEqual(got.singleDates, ['ctl00$pc$calFrom']);
});
