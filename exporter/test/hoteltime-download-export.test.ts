import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { WebFormsError, downloadExport } from '../src/sites/hoteltime/webforms.ts';

// 🔴 พังจริง 2026-11-17 (Windmill chromium worker, job 01a1e886-…): process ตายด้วย unhandled rejection
// `page.waitForEvent: Timeout 30000ms exceeded while waiting for event "download"` จาก downloadExport —
// ตัวดักดาวน์โหลด (`pending`) ถูกสร้างก่อน `await link.click()` แต่ยังไม่มีใคร await มัน · ถ้า click ค้างนานกว่า timeout
// ของ `pending` (ลิงก์โดนทับ/หน้าช้า) `pending` reject ระหว่างนั้น Node 24 ถือเป็น uncaught exception ฆ่าทั้ง process
// ก่อนที่ withRetry จะลองใหม่หรือ _run.json จะบันทึกว่าล้ม — รายงานที่เหลือในรอบนั้นไม่ถูกทำเลย
// จำลองด้วยหน้า local + Chromium จริง (ไม่ต้อง login HotelTime): ลิงก์ export ถูก overlay ทับ → click รอ actionability
// นานกว่า timeout ของการรอดาวน์โหลด

const LINK_ID = 'ctl00_pc_btnExportXLS';

test('ลิงก์ export โดนทับจน click ค้างเกิน timeout ของดาวน์โหลด — ล้มเป็น WebFormsError ไม่มี unhandled rejection', { timeout: 30_000 }, async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(2_000); // click รอได้ 2 วินาที > timeout ของดาวน์โหลด (0.5 วินาที) ด้านล่าง
    await page.setContent(`
      <a id="${LINK_ID}" href="data:application/octet-stream;base64,${Buffer.from('xlsx-bytes').toString('base64')}" download="report.xlsx">Export: MS Excel</a>
      <div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:10;background:white"></div>
    `);
    const dir = await mkdtemp(path.join(tmpdir(), 'ht-download-'));

    await assert.rejects(
      downloadExport(page, path.join(dir, 'out.xlsx'), 500, LINK_ID),
      (err: unknown) => err instanceof WebFormsError,
    );

    // รอให้ click ที่ค้างอยู่หมดเวลาเองด้วย — rejection ที่หลุดจากฝั่ง click ก็ต้องไม่มี
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await browser.close();
  }
});

test('ลิงก์ export ที่ดาวน์โหลดสำเร็จ — ได้ไฟล์ตามที่ส่งมา', { timeout: 30_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.setContent(
      `<a id="${LINK_ID}" href="data:application/octet-stream;base64,${Buffer.from('xlsx-bytes').toString('base64')}" download="report.xlsx">Export: MS Excel</a>`,
    );
    const dir = await mkdtemp(path.join(tmpdir(), 'ht-download-'));
    const dest = path.join(dir, 'out.xlsx');

    const result = await downloadExport(page, dest, 5_000, LINK_ID);

    assert.equal(result.suggestedFilename, 'report.xlsx');
    assert.equal(await readFile(dest, 'utf8'), 'xlsx-bytes');
  } finally {
    await browser.close();
  }
});
