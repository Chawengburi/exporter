import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
  InFlightError,
  installInFlightTracker,
  settlePageRequests,
  trackInFlightRequests,
  waitForInFlightToSettle,
} from '../src/sites/foodstory/inflight.ts';

// หน้า landing หลัง login (/th/summary) ยิง POST /summary/get-* ที่พกช่วงวันที่เดิมของ session ไว้
// ถ้าออกจากหน้าก่อนมันจบ ฝั่ง server ยังรันต่อแล้วเขียน laravel_session ทับ setDate ที่เราตั้งทีหลัง
// (diagnose 2026-09-28) — tracker นี้คือสิ่งที่ login() และ setDateRangeByTyping ใช้รอให้ request
// ที่ค้างจบก่อนแตะช่วงวันที่
const HOST = 'owner.foodstory.co';
const req = (url: string, type = 'xhr') => ({ url: () => url, resourceType: () => type });

test('นับเฉพาะ xhr/fetch ที่ไป host ของเว็บ — ไม่นับ analytics/static', () => {
  const page = new EventEmitter();
  const t = trackInFlightRequests(page, HOST);
  page.emit('request', req('https://owner.foodstory.co/summary/get-bill'));
  page.emit('request', req('https://owner.foodstory.co/summary/get-product', 'fetch'));
  page.emit('request', req('https://analytics.google.com/g/collect', 'fetch'));
  page.emit('request', req('https://owner.foodstory.co/js/app.js', 'script'));
  assert.deepEqual(t.pendingPaths(), ['/summary/get-bill', '/summary/get-product']);
  t.stop();
});

test('requestfinished และ requestfailed ต่างก็ปลด request ออก — event ซ้ำไม่ทำให้ติดลบ', () => {
  const page = new EventEmitter();
  const t = trackInFlightRequests(page, HOST);
  const a = req('https://owner.foodstory.co/summary/get-bill');
  const b = req('https://owner.foodstory.co/summary/get-table');
  page.emit('request', a);
  page.emit('request', b);
  page.emit('requestfinished', a);
  page.emit('requestfinished', a);
  page.emit('requestfailed', b);
  assert.deepEqual(t.pendingPaths(), []);
  t.stop();
});

test('stop() ถอด listener ออกหมด', () => {
  const page = new EventEmitter();
  const t = trackInFlightRequests(page, HOST);
  t.stop();
  for (const e of ['request', 'requestfinished', 'requestfailed']) assert.equal(page.listenerCount(e), 0);
});

test('waitForInFlightToSettle คืนค่าเมื่อ request ที่ค้างจบหมด', async () => {
  const page = new EventEmitter();
  const t = trackInFlightRequests(page, HOST);
  const a = req('https://owner.foodstory.co/summary/get-bill');
  page.emit('request', a);
  setTimeout(() => page.emit('requestfinished', a), 30);
  await waitForInFlightToSettle(t, 1_000, 5);
  assert.deepEqual(t.pendingPaths(), []);
  t.stop();
});

test('waitForInFlightToSettle โยน InFlightError พร้อมชื่อ path ที่ยังค้าง ถ้าไม่จบภายในเวลา', async () => {
  const page = new EventEmitter();
  const t = trackInFlightRequests(page, HOST);
  page.emit('request', req('https://owner.foodstory.co/summary/get-bill?token=secret'));
  await assert.rejects(waitForInFlightToSettle(t, 30, 5), (err: unknown) => {
    assert.ok(err instanceof InFlightError);
    assert.match((err as Error).message, /\/summary\/get-bill/);
    assert.doesNotMatch((err as Error).message, /secret/);
    return true;
  });
  t.stop();
});

// 🔴 พังจริง 2026-09-28 (batch ส.ค. รอบแรกหลังแก้ race): request ของหน้าเดิมที่ถูกทิ้งตอน navigate
// ไม่ได้ event requestfinished/requestfailed จาก Playwright เสมอไป → ค้างใน tracker ตลอดไป → ใบถัดไป
// ที่ต้อง setDate (salebybilldetail แบ่งช่วง) รอ 90 วิแล้วล้ม InFlightError เพราะ /th/salebymonthsum/getdata
const mainFrame = { parentFrame: () => null };
const childFrame = { parentFrame: () => mainFrame };

test('main frame navigate → ล้าง request ค้างของหน้าเดิม (ไม่ค้างเป็นผีข้ามหน้า)', () => {
  const page = new EventEmitter();
  const t = trackInFlightRequests(page, HOST);
  page.emit('request', req('https://owner.foodstory.co/th/salebymonthsum/getdata'));
  page.emit('framenavigated', mainFrame);
  assert.deepEqual(t.pendingPaths(), []);
  page.emit('request', req('https://owner.foodstory.co/th/salebybilldetail/getdata'));
  assert.deepEqual(t.pendingPaths(), ['/th/salebybilldetail/getdata']);
  t.stop();
});

test('iframe navigate ไม่ล้าง request ของหน้าหลัก', () => {
  const page = new EventEmitter();
  const t = trackInFlightRequests(page, HOST);
  page.emit('request', req('https://owner.foodstory.co/summary/get-bill'));
  page.emit('framenavigated', childFrame);
  assert.deepEqual(t.pendingPaths(), ['/summary/get-bill']);
  t.stop();
  assert.equal(page.listenerCount('framenavigated'), 0);
});

test('settlePageRequests ใช้ tracker ที่ติดตั้งไว้กับ page นั้น', async () => {
  const page = new EventEmitter();
  installInFlightTracker(page, HOST);
  const a = req('https://owner.foodstory.co/th/salebysumdate/getdata');
  page.emit('request', a);
  setTimeout(() => page.emit('requestfinished', a), 30);
  await settlePageRequests(page, 1_000, 5);
});

test('settlePageRequests โยน InFlightError ถ้า page ไม่มี tracker — ไม่ข้ามเงียบ ๆ', async () => {
  await assert.rejects(settlePageRequests(new EventEmitter(), 1_000, 5), InFlightError);
});
