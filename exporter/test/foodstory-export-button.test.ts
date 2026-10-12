import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { CONTROL_EXCEL_BUTTON, triggerExportAndCaptureDownload } from '../src/sites/foodstory/interactions.ts';

// 🔴 พังจริง 2026-10-08 (ticket 03 รอบจริง ก.ย.): 45 ใบที่ปุ่มชื่อ "Excel" ไม่ได้ไฟล์เลย — หน้า DataTables มีสำเนาปุ่ม
// Excel ที่ซ่อนอยู่ (responsive) และสำเนาซ่อนมาก่อนใน DOM `.first()` จึงรอคลิกปุ่มที่มองไม่เห็นจน timeout ทั้งที่คนกดปุ่มที่เห็นแล้วได้ไฟล์ปกติ
// จำลองด้วยหน้า local + Chromium จริง (ไม่ต้อง login FoodStory)
test('ปุ่ม Excel: มีสำเนาซ่อนมาก่อนใน DOM — กดตัวที่มองเห็นแล้วได้ไฟล์', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.setContent(`
      <div style="display:none"><button class="buttons-excel buttons-html5">Excel</button></div>
      <a class="buttons-excel buttons-html5" download="report.xlsx" href="data:application/octet-stream;base64,${Buffer.from('xlsx-bytes').toString('base64')}">Excel</a>
    `);
    const dir = await mkdtemp(path.join(tmpdir(), 'fs-excel-'));
    const file = await triggerExportAndCaptureDownload(page, [CONTROL_EXCEL_BUTTON], 'pay', 'Excel', dir, 'pay__tmp.xlsx');
    assert.equal(await readFile(file, 'utf8'), 'xlsx-bytes');
  } finally {
    await browser.close();
  }
});

// 🔴 พังจริง 2026-10-12 (รอบจริงครั้งที่สอง, DOM จริงจากเจ้าของระบบ copy ผ่าน DevTools): หน้ามี side panel ใหม่
// (`<a class="list-group-item" onclick="openSidenav(..)">` ข่าว/แจ้งเตือน) ที่ข้อความข้างในมีคำว่า Excel — มาก่อนปุ่มจริงใน DOM
// มีขนาด (Playwright ถือว่า visible) แต่ถูกเนื้อหาหน้าทับ คลิกไม่ได้ → bot รอจน timeout · หน้า "Export Excel" ไม่โดนเพราะ
// ข้อความในแผงไม่มีวลีนั้น
test('ปุ่ม Excel: มีรายการใน side panel ที่ข้อความมีคำว่า Excel และถูกทับ — กดปุ่มที่ข้อความเป็น "Excel" พอดี', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.setContent(`
      <div style="position:fixed;top:0;left:0;width:100%;z-index:1">
        <a href="javascript:void(0)" class="list-group-item" style="display:block;height:73px">ฟีเจอร์ใหม่: ส่งออก Excel ได้แล้ว</a>
      </div>
      <div style="position:relative;z-index:2;background:white;min-height:200px;padding-top:100px">
        <button class="btn btn-default buttons-excel buttons-html5" style="display:none"><span>Excel</span></button>
        <a class="btn btn-default buttons-excel buttons-html5" download="report.xlsx"
           href="data:application/octet-stream;base64,${Buffer.from('xlsx-bytes').toString('base64')}"><span>Excel</span></a>
      </div>
    `);
    const dir = await mkdtemp(path.join(tmpdir(), 'fs-excel-'));
    const file = await triggerExportAndCaptureDownload(page, [CONTROL_EXCEL_BUTTON], 'salebybill', 'Excel', dir, 'salebybill__tmp.xlsx');
    assert.equal(await readFile(file, 'utf8'), 'xlsx-bytes');
  } finally {
    await browser.close();
  }
});

test('ปุ่ม Export Excel: ข้อความมีช่องว่าง/ไอคอนรอบ ๆ ยังตรงพอดี', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.setContent(`<a download="r.xlsx" href="data:application/octet-stream;base64,${Buffer.from('x').toString('base64')}">
      <i class="fa fa-file-excel-o"></i>  Export Excel
    </a>`);
    const dir = await mkdtemp(path.join(tmpdir(), 'fs-excel-'));
    await triggerExportAndCaptureDownload(page, [CONTROL_EXCEL_BUTTON], 'outputtax', 'Export Excel', dir, 'outputtax__tmp.xlsx');
  } finally {
    await browser.close();
  }
});

test('ปุ่มที่ข้อความไม่ตรงพอดี (มีคำอื่นต่อท้าย) — ไม่เจอแบบพอดีแล้วถอยไปหาแบบ "มีคำนี้" ที่มองเห็น', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await page.setContent(`<a download="r.xlsx" href="data:application/octet-stream;base64,${Buffer.from('x').toString('base64')}">Export Excel (xlsx)</a>`);
    const dir = await mkdtemp(path.join(tmpdir(), 'fs-excel-'));
    await triggerExportAndCaptureDownload(page, [CONTROL_EXCEL_BUTTON], 'outputtax', 'Export Excel', dir, 'outputtax__tmp.xlsx');
  } finally {
    await browser.close();
  }
});
