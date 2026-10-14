import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from 'playwright';
import { assertControlAllowed } from '../../core/gate.ts';
import { formatDMY, type DateRange } from '../../core/order.ts';
import { settlePageRequests } from './inflight.ts';

/**
 * primitives คุยกับหน้าเว็บ FoodStory (jQuery DataTables) — ใช้ซ้ำได้ทุกรายงาน
 *
 * ต่างจาก HotelTime (ASP.NET WebForms, ดู webforms.ts) โดยสิ้นเชิง: ไม่มี postback,
 * ปุ่ม/เมนูอ้างอิงด้วยข้อความที่มองเห็นได้ (สเปกต้นทางไม่ได้ inspect DOM เลย เขียนจากการ
 * สังเกตมือจริง — ดู foodstory-report-export-spec.md) เกราะ allowlist ใช้ตัวเดียวกับ
 * HotelTime (`core/gate.ts::assertControlAllowed`) แต่ "control name" ที่นี่เป็น id นามธรรม
 * ของ primitive (CONTROL_*) ไม่ใช่ชื่อ ASP.NET control จริง — ตกลงกันไว้ตอน grill ว่า
 * FoodStory ต้องมีเกราะแบบเดียวกันแม้ implementation ต่างกัน (ดู ticket 02)
 */

export class InteractionError extends Error {
  override readonly name = 'InteractionError';
}

/**
 * ตั้งช่วงวันที่แล้วช่องแสดงช่วงไม่ขึ้นตามที่พิมพ์ — เป็นครั้งคราว ไม่รู้สาเหตุ (เจอ 2026-09-28 กลางรอบ ส.ค. · 2026-10-14 ครั้งแรกหลัง login
 * รันจริงใบ 06 — ทั้งสองครั้งการตั้งช่วงครั้งถัดไปผ่าน) จึงแยก type ให้ผู้เรียกลองตั้งใหม่ได้ · ด่านตรวจช่วงยังอยู่ครบ ไม่ export ผิดช่วง
 */
export class DateRangeNotAppliedError extends InteractionError {}

/** primitive ที่ปิด popup โปรโมชั่นต้องประกาศ control นี้ */
export const CONTROL_DISMISS_INTERSTITIAL = 'dismissInterstitial';
/** primitive ที่เลือก Show N rows ต้องประกาศ control นี้ */
export const CONTROL_SHOW_N_ROWS = 'showNRows';
/** primitive ที่กดปุ่ม export ต้องประกาศ control นี้ */
export const CONTROL_EXCEL_BUTTON = 'excelButton';
/** primitive ที่ตั้งปี/เดือนแทนช่วงวันที่ต้องประกาศ control นี้ (ดู setPeriodFilter) */
export const CONTROL_PERIOD_FILTER = 'periodFilter';
/** primitive ที่กดไอคอนดาวน์โหลดตรง (toolbar E) ต้องประกาศ control นี้ */
export const CONTROL_ICON_DOWNLOAD = 'iconDownload';

const PROCESSING_OVERLAY_SELECTOR = '.dataTables_processing';
// 🔴 ยืนยันจริง 2026-09-26 (ingredient — 1,097 แถว): DataTables คั่นหลักพันด้วย comma ใน
// ข้อความนี้ ("Showing 1 to 25 of 1,097 entries") — [\d,]+ กันไว้ ต้อง .replaceAll(',', '')
// ก่อนแปลงเป็นตัวเลขเสมอ (ตัวเลขเล็กที่ไม่มี comma ก็ replaceAll แล้วไม่มีผลอะไร ปลอดภัย)
const SHOWING_TEXT_PATTERN = /Showing\s+([\d,]+)\s+to\s+([\d,]+)\s+of\s+([\d,]+)\s+entries/;
// สเปกต้นทาง §4.4 สั่งตรง ๆ ว่า "generous ceiling (60s)" — ค่าคงที่ตายตัวจากสเปก
// ไม่ใช่ค่าที่ควรผูกกับ cfg.timeoutMs ของแต่ละ site
const READY_TIMEOUT_MS = 60_000;

export type ShowingInfo = {
  readonly from: number;
  readonly to: number;
  readonly total: number;
};

/**
 * แกะข้อความ "Showing X to Y of Z entries" เป็นตัวเลข — แยกออกมาเป็น pure function ทดสอบได้เอง
 * (ไม่แตะ Playwright เลย) ต่างจาก `waitForReady` ทั้งฟังก์ชันที่ทดสอบแบบ unit test ไม่ได้เพราะ
 * ต้องมี browser จริง
 */
export function parseShowingText(bodyText: string): ShowingInfo | null {
  const m = SHOWING_TEXT_PATTERN.exec(bodyText);
  if (!m) return null;
  return {
    from: Number(m[1]!.replaceAll(',', '')),
    to: Number(m[2]!.replaceAll(',', '')),
    total: Number(m[3]!.replaceAll(',', '')),
  };
}

/**
 * รอให้ตารางพร้อมใช้งานจริง — ไม่ใช่แค่ navigation เสร็จ
 *
 * รอสองสัญญาณตามสเปกต้นทาง §4.4: overlay "Processing…" หาย **และ** ข้อความ
 * "Showing X to Y of Z entries" ปรากฏ — `/th/summary` วัดได้ถึง 40 วิ ต้องรอด้วย poll
 * ไม่ใช่ sleep คงที่ (5000 แถวยังใช้เวลา re-render อีก 6-10 วิ ดู selectShowNRows)
 *
 * 🔴 ยืนยันจริง 2026-09-26: `document.body` เป็น `null` ชั่วคราวได้ตอนหน้ากำลัง full-page reload
 * (ต่างจาก AJAX filter ของ date-range ที่ document.body ไม่หายไปเลย — เจอตอน setPeriodFilter
 * กด "ตกลง" ของ salebymonthsum/salebyproductmonthly ซึ่ง reload หนักกว่า) เดิม `.innerText`
 * ตรง ๆ พังด้วย TypeError ตรงนี้ แก้ด้วย optional chaining ให้ถือว่า "ยังไม่พร้อม" แล้ว poll ต่อ
 * แทนที่จะ throw
 *
 * 🔴 ยืนยันจริงอีกจุด 2026-09-27 (`payment_by_employee`): overlay "Processing…" หายไปแล้ว "ก่อน"
 * ที่ข้อความ "Showing ..." จะอัปเดตเป็นค่าใหม่จริง มีช่วงสั้น ๆ ที่ข้อความเก่ายังค้างอยู่แต่ตรงกับ
 * pattern พอดี (เช่น "Showing 1 to 25 of 230" ค้างอยู่ทั้งที่เพิ่งสั่ง Show 5000 rows ไป) —
 * ถ้า poll ไปเจอจังหวะนั้นพอดีจะคืนค่าเก่าที่ผิดโดยไม่รู้ตัว (ดูถูกต้องตามรูปแบบ แต่เป็นค่าค้าง)
 * แก้ด้วยการ debounce: ต้องอ่านค่าเดิมซ้ำกัน 2 ครั้งติดกัน (ห่างกัน 500ms) ก่อนถึงจะเชื่อว่านิ่งจริง
 * 🔴 trade-off ที่ตั้งใจรับ: การ debounce นี้ทำให้ "ทุก" การเรียก `waitForReady()` ช้าขึ้นอย่างน้อย
 * ~500ms (ต้อง poll 2 รอบขั้นต่ำเสมอ) ไม่ใช่แค่กรณีที่เจอ race condition จริง — ยอมรับได้เพราะเทียบ
 * กับเพดานเวลารอทั้งหมด (`READY_TIMEOUT_MS` 60s) และเวลาที่ `selectShowNRows` เองก็กิน 6-10s
 * อยู่แล้วตอน re-render 5000 แถว ถือว่าน้อยมาก ไม่คุ้มที่จะแยก debounce ไว้เฉพาะบางกรณี (เพิ่ม
 * ความซับซ้อนแลกกับเวลาที่ประหยัดได้ไม่คุ้ม)
 */
export async function waitForReady(page: Page): Promise<ShowingInfo> {
  await page
    .locator(PROCESSING_OVERLAY_SELECTOR)
    .waitFor({ state: 'hidden' })
    .catch(() => undefined);

  const deadlineAt = Date.now() + READY_TIMEOUT_MS;
  let lastReading: ShowingInfo | null = null;
  for (;;) {
    // 🔴 พังจริง 2026-09-26 (ticket 12, batch run รอบแรก): `page.evaluate()` โยน "Execution
    // context was destroyed, most likely because of a navigation" ถ้าเรียกชนจังหวะที่หน้ากำลัง
    // reload พอดี (เช่นหลัง setDateRangeByTyping กด "ตกลง" ซึ่งกระตุ้น reload) — เดิมโยนออกไป
    // ตรง ๆ ทำให้ session ทั้งก้อนล้มทั้งที่แค่ชนจังหวะสั้น ๆ ไม่ใช่ปัญหาจริง ต่างจาก
    // `document.body === null` ที่จับไว้แล้ว (optional chaining) นี่คือ context ทั้งตัวถูกทำลาย
    // ระหว่าง evaluate ไม่ใช่แค่ body เป็น null — ต้องจับแยกแล้วถือว่า "ยังไม่พร้อม" แล้ว poll ต่อ
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch((err) => {
      if (err instanceof Error && err.message.includes('Execution context was destroyed')) return '';
      throw err;
    });
    const showing = parseShowingText(bodyText);
    if (showing) {
      if (
        lastReading &&
        lastReading.from === showing.from &&
        lastReading.to === showing.to &&
        lastReading.total === showing.total
      ) {
        return showing;
      }
      lastReading = showing;
    }
    if (Date.now() >= deadlineAt) {
      throw new InteractionError(
        `ไม่เจอข้อความ "Showing X to Y of Z entries" ที่นิ่งแล้วภายใน ${READY_TIMEOUT_MS / 1000} วินาที (${page.url()})`,
      );
    }
    await page.waitForTimeout(500);
  }
}

/**
 * ปิด popup โปรโมชั่นที่บังจอ ถ้ามี — ยืนยันจริง 2026-09-23 ว่าโผล่มาหลัง login ทันที
 * เจตนาเป็น no-op ถ้าไม่เจอ (สังเกตว่าอาจไม่โผล่ทุกครั้ง เช่นเคยปิดไปแล้วในเซสชันนี้)
 *
 * ผ่าน allowlist gate เหมือน selectShowNRows/triggerExportAndCaptureDownload — เป็นการคลิก
 * จริงบนหน้าเว็บ (แก้ตาม code review: เดิมไม่ผ่าน gate ทั้งที่เขียน DOM เหมือนกัน)
 */
export async function dismissInterstitial(
  page: Page,
  allowedControls: readonly string[],
  reportId: string,
): Promise<void> {
  assertControlAllowed(allowedControls, CONTROL_DISMISS_INTERSTITIAL, reportId);

  const button = page.getByRole('button', { name: 'เข้าใจแล้ว' });
  if ((await button.count()) > 0 && (await button.first().isVisible())) {
    await button.first().click();
  }
}

/**
 * ยืนยันว่าสาขาที่กำลังดูตรงกับที่ตั้งไว้ ก่อนดึงข้อมูลทุกครั้ง (สเปกต้นทาง §4.1.5: "assert
 * rather than assume" — สาขาถูกเลือกไว้ล่วงหน้าตลอดการรันมือ แต่ห้ามเชื่อเฉย ๆ)
 *
 * 🔴 เช็คแบบหยาบ (ค้นข้อความทั้งหน้า) เพราะยังไม่เคย live-verify ตำแหน่ง DOM ที่แท้จริงของ
 * ชิป "สาขา" — แม่นยำน้อยกว่าการเจาะจง selector แต่ปลอดภัยกว่าไม่เช็คเลย และไม่เสี่ยงพังถ้า
 * โครงหน้าเปลี่ยนตำแหน่ง
 */
export async function assertBranch(page: Page, expectedBranchName: string): Promise<void> {
  const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
  if (!bodyText.includes(expectedBranchName)) {
    throw new InteractionError(
      `ไม่พบชื่อสาขา "${expectedBranchName}" บนหน้า (${page.url()})\n` +
        `  อาจเลือกสาขาผิด หรือหน้าเว็บเปลี่ยนตำแหน่งแสดงชื่อสาขา — ตรวจด้วยตาก่อนเชื่อไฟล์ที่ได้`,
    );
  }
}

const SHOW_N_ROWS_BUTTON_PATTERN = /^Show \d+ rows$/;
const LARGEST_OPTION_PATTERN = /5000|Show all|ทั้งหมด/;

/**
 * เปิดเมนู "Show N rows" แล้วเลือกตัวเลือกที่มากที่สุด — **อ่านตัวเลือกจริงจากเมนู ไม่เดา index**
 *
 * สเปกต้นทาง §3.1: ชุดตัวเลือกต่างกันไปตามหน้า (ส่วนใหญ่มี `5000 rows`, แต่
 * `/th/salebyproductmonthly` มีแค่ `Show all`) การ export โดยไม่เปลี่ยนค่านี้จะได้ไฟล์แค่ 25
 * แถวแรก — เป็นสาเหตุความผิดพลาดอันดับ 1 ตามสเปก
 *
 * ยืนยันจริงครบทั้งสองรอบ (2026-09-23): ปุ่ม ("Show 25 rows", class
 * `buttons-collection buttons-page-length`) และการเลือกตัวเลือกในเมนู (`.dt-button-collection`)
 * ทำงานได้จริง — เมนูเปิดสำเร็จและเลือกตัวเลือกที่มากที่สุดได้จริง ผ่าน live-verify รอบ 3
 * (ดู ticket 02 §Comments "อัปเดต (4)")
 */
export async function selectShowNRows(
  page: Page,
  allowedControls: readonly string[],
  reportId: string,
): Promise<void> {
  assertControlAllowed(allowedControls, CONTROL_SHOW_N_ROWS, reportId);

  const trigger = page.getByRole('button', { name: SHOW_N_ROWS_BUTTON_PATTERN });
  await trigger.click();

  const options = page.locator('.dt-button-collection button, .dt-button-collection a');
  await options.first().waitFor({ state: 'visible' });
  const texts = await options.allTextContents();
  const largestIndex = texts.findIndex((t) => LARGEST_OPTION_PATTERN.test(t));

  if (largestIndex === -1) {
    throw new InteractionError(
      `เมนู "Show N rows" เปิดมาแต่ไม่เจอตัวเลือกที่ตรงกับ ${LARGEST_OPTION_PATTERN}\n` +
        `  ตัวเลือกที่เจอจริง: ${JSON.stringify(texts)}`,
    );
  }

  await options.nth(largestIndex).click();
  await page
    .locator(PROCESSING_OVERLAY_SELECTOR)
    .waitFor({ state: 'hidden' })
    .catch(() => undefined);
}

/**
 * รอจน URL นิ่งก่อนคืนการควบคุมให้ caller — ใช้หลังคลิกปุ่มที่กระตุ้น navigation/reload
 * (พบซ้ำแล้ว 3 จุด: login, setDateRangeByTyping, setPeriodFilter — ทุกจุดพังแบบเดียวกันคือ
 * caller ทำงานต่อทันทีแล้วชน navigation ที่ยังค้างอยู่ เช่น ERR_ABORTED หรือ
 * "Execution context was destroyed")
 */
async function waitForUrlSettle(page: Page): Promise<void> {
  let lastUrl = page.url();
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    const currentUrl = page.url();
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
  }
}

const DATE_RANGE_DISPLAY_PATTERN = /\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}/;

/**
 * หา element ที่แสดงช่วงวันที่ปัจจุบัน (รูปแบบ `dd/mm/yyyy - dd/mm/yyyy`)
 *
 * รอบแรก (2026-09-23) ลองแค่ `getByText()` แล้วหาไม่เจอเลยภายใน 60s แม้แต่ตัวเดียว —
 * สาเหตุที่เป็นไปได้มากที่สุด: `getByText()` ค้นเฉพาะ text node ที่ render จริง ไม่ค้น `value`
 * ของ `<input>` เพิ่ม fallback สแกนค่า `<input>` ทุกตัวแล้ว **หาเจอสำเร็จในรอบ 3** (ไม่ throw
 * ตรงนี้อีก — ปัญหาที่เหลืออยู่ที่ขั้นถัดไป ดู `setDateRangeByTyping`) ยังไม่ทราบว่าเจอผ่าน
 * branch ไหน (text node หรือ input value) เพราะไม่ได้ log แยกไว้
 */
async function findDateRangeTrigger(page: Page): Promise<Locator> {
  const textTrigger = page.getByText(DATE_RANGE_DISPLAY_PATTERN).first();
  if ((await textTrigger.count()) > 0) return textTrigger;

  const inputs = page.locator('input');
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    const value = await inputs.nth(i).inputValue().catch(() => '');
    if (DATE_RANGE_DISPLAY_PATTERN.test(value)) {
      return inputs.nth(i);
    }
  }

  throw new InteractionError(
    'หาช่องแสดงช่วงวันที่ (รูปแบบ dd/mm/yyyy - dd/mm/yyyy) ไม่เจอเลย ทั้งแบบ text node และแบบ ' +
      '<input value="..."> — ลองทั้งสองวิธีแล้ว (ดูคอมเมนต์ของ findDateRangeTrigger)\n' +
      `  URL ตอนนี้: ${page.url()}`,
  );
}

/**
 * พิมพ์ช่วงวันที่ในช่อง date-range แบบ backspace-then-type — ช่วงเป็น **global session state**
 * ตั้งครั้งเดียวแล้วคงอยู่ข้ามหน้ารายงาน (สเปกต้นทาง §4.2 ยืนยันข้าม ~50 การนำทางในรอบมือจริง)
 *
 * ทำไมพิมพ์แทนคลิกปฏิทิน: สเปกต้นทางบันทึกไว้ชัดว่าคลิก cell ปฏิทินไม่นิ่ง คลิกที่สองทับค่า
 * เริ่มต้นที่เพิ่งกรอกไป และ Ctrl+A เคลียร์ช่องไม่ได้ (ค่าเดิมยังอยู่แล้วต่อท้าย) ต้องกด
 * Backspace ทีละตัวแทน
 *
 * ไม่ผ่าน allowlist gate โดยเจตนา ต่างจาก selectShowNRows/triggerExportAndCaptureDownload —
 * ช่วงวันที่เป็น session state ระดับ "รอบการรัน" ไม่ใช่ระดับรายงาน จึงเรียกครั้งเดียวจาก runner
 * ก่อนวนลูปรายงาน ไม่ใช่ primitive ที่นิยามรายงานแต่ละใบเป็นคนเรียกเอง (ไม่มี "reportId" ที่จะ
 * เอาไปเทียบ allowedControls ของใบไหนใบหนึ่งให้สมเหตุสมผล)
 *
 * ยืนยันจริง 2026-09-23 (ticket 03 recon รอบแรก) ว่ากลไกหลักทำงานถูกต้อง: อ่านค่ากลับจาก
 * `trigger.inputValue()` หลังกด "ตกลง" ตรงกับที่พิมพ์ไปเป๊ะ ("25/08/2026 - 23/09/2026") และ
 * `Showing ... entries` เปลี่ยนจริงหลังตั้งช่วง (1 → 30 รายการ) — **การตรวจ header เดิมที่เช็คผ่าน
 * `document.body.innerText` เป็นบั๊กปลอม**: ช่องแสดงช่วงวันที่เป็น `<input>` ซึ่ง `innerText` ไม่รวม
 * ค่า `value` ของ input เลย (ปัญหาคลาสเดียวกับที่เคยเจอตอนหา trigger — ดู `findDateRangeTrigger`)
 * แก้แล้วให้อ่านจาก `trigger.inputValue()` ตรง ๆ แทน
 *
 * ยังพบด้วยว่ากดปุ่ม "ตกลง" กระตุ้น navigation/reload ที่ยังไม่จบตอน `waitForReady` คืนค่า (เจอ
 * `page.goto()` ถัดไปพัง `net::ERR_ABORTED` เพราะชนกับ navigation ที่ยังค้างอยู่ — ปัญหาคลาสเดียวกับ
 * race condition ที่เคยแก้ใน session.ts::login()) แก้โดยรอ URL นิ่งก่อนคืนค่าจากฟังก์ชันนี้ด้วย
 */
const SETTLE_BEFORE_SET_DATE_TIMEOUT_MS = 90_000;

export async function setDateRangeByTyping(page: Page, range: DateRange): Promise<void> {
  const trigger = await findDateRangeTrigger(page);
  await trigger.click();

  const fromText = formatDMY(range.from);
  const toText = formatDMY(range.to);

  const scoped = page.locator('.daterangepicker input[type="text"]:visible');
  const inputs = (await scoped.count()) >= 2 ? scoped : page.locator('input[type="text"]:visible');
  const pairs: readonly [Locator, string][] = [
    [inputs.first(), fromText],
    [inputs.nth(1), toText],
  ];

  for (const [input, text] of pairs) {
    await input.click();
    await input.press('End');
    for (let i = 0; i < 30; i++) {
      await input.press('Backspace');
    }
    await input.type(text);

    const actual = await input.inputValue();
    if (actual !== text) {
      throw new InteractionError(
        `พิมพ์ "${text}" ลงช่องแล้ว แต่อ่านค่ากลับมาได้ "${actual}" — ` +
          `พิมพ์ผิดช่อง (input[type="text"]:visible เจอมากกว่าที่คาด) หรือ widget ไม่รับค่าที่พิมพ์\n` +
          `  URL ตอนนี้: ${page.url()}`,
      );
    }
  }

  // "ตกลง" ยิง POST /api/setDate — request อื่นที่ยังค้างฝั่ง server (เช่น getdata ของหน้านี้เอง)
  // จะเขียน session ทับย้อนหลังถ้าจบทีหลัง setDate ต้องรอให้จบก่อน ดู inflight.ts
  await settlePageRequests(page, SETTLE_BEFORE_SET_DATE_TIMEOUT_MS);
  await page.getByRole('button', { name: 'เลือก' }).click();
  await page.getByRole('button', { name: 'ตกลง' }).click();
  await waitForReady(page);

  const expectedHeader = `${fromText} - ${toText}`;
  const triggerValueNow =
    (await trigger.inputValue().catch(() => undefined)) ?? (await trigger.textContent().catch(() => undefined));
  if (triggerValueNow !== expectedHeader) {
    // ค่าที่อ่านได้อยู่บรรทัดแรก — log ต่อรายงาน/ข้อความลองใหม่แสดงแค่บรรทัดแรก (ครั้งก่อน ๆ ค่านี้หายไปจากหลักฐานทุกครั้ง)
    throw new DateRangeNotAppliedError(
      `ตั้งช่วงวันที่แล้วแต่ช่องแสดงช่วงวันที่ไม่ขึ้น "${expectedHeader}" ตามที่คาด — อ่านได้ ${JSON.stringify(triggerValueNow)} (${page.url()})\n` +
        `  อาจกรอกผิดช่อง หรือปฏิทินไม่รับค่าที่พิมพ์ไป — ตรวจด้วยตาก่อนเชื่อไฟล์ที่ได้`,
    );
  }

  // กด "ตกลง" กระตุ้น navigation/reload ที่อาจยังไม่จบตอนนี้ (waitForReady เช็คแค่เนื้อหาตาราง
  // ไม่ใช่สถานะ navigation) — รอ URL นิ่งก่อนคืนค่า กัน caller ที่ navigate ต่อทันทีชน ERR_ABORTED
  await waitForUrlSettle(page);
}

/**
 * กดปุ่ม export (`Excel` หรือ `Export Excel` ตาม toolbar — สเปกต้นทาง §3.1) แล้วจับไฟล์ที่
 * ดาวน์โหลด — พิสูจน์แล้วจริง 2026-09-23 ว่า `page.waitForEvent('download')` จับ client-side
 * blob download ของ DataTables ได้ (ไม่ยิง network request ตามที่สเปกเตือนไว้ — ต้องใช้เบราว์เซอร์
 * จริง ใช้ HTTP client ธรรมดาดึงไม่ได้)
 *
 * 🔴 หน้าเดียวมีปุ่มข้อความ "Excel" ซ้ำกันได้หลายตัว — ปุ่มของแท็บตารางอื่นที่ซ่อนอยู่ (0×0 px, `aria-controls`
 * = `show_table_success`/`_refund`/...) · ตัวจริงคือ `<button class="... buttons-excel buttons-html5"
 * aria-controls="show_table"><span>Excel</span></button>` (DOM จริงจากเจ้าของระบบ 2026-10-12)
 *
 * 🔴 พังจริง 2026-10-08 → 10-12 (45 ใบที่ปุ่มชื่อ "Excel" ไม่ได้ไฟล์ ทั้งที่คนกดเองได้ปกติ): เดิมหา `a, button` ที่ข้อความ
 * *มีคำว่า* Excel แล้ว `.first()` — FoodStory เพิ่ม side panel (`<a class="list-group-item" onclick="openSidenav(..)">`
 * ข่าว/แจ้งเตือน) ที่ข้อความมีคำว่า Excel มาก่อนปุ่มจริงใน DOM มีขนาดแต่ถูกเนื้อหาหน้าทับ bot จึงรอคลิกมันจน timeout ·
 * แก้: ข้อความทั้งปุ่มต้องเป็น `buttonText` พอดี (ไม่สนช่องว่าง/ไอคอนรอบ ๆ) + มองเห็น — ดู test/foodstory-export-button.test.ts
 */
export async function triggerExportAndCaptureDownload(
  page: Page,
  allowedControls: readonly string[],
  reportId: string,
  buttonText: string,
  downloadDir: string,
  destFileName: string,
): Promise<string> {
  assertControlAllowed(allowedControls, CONTROL_EXCEL_BUTTON, reportId);

  // ไม่มีหลักฐาน DOM ของปุ่ม "Export Excel" (toolbar C/D) ว่าข้อความพอดี — ไม่เจอแบบพอดีในไม่กี่วินาทีก็ถอยไปแบบ "มีคำนี้"
  // ที่มองเห็น (เดิมใช้ได้กับหน้ากลุ่มนี้ และรายการใน side panel ไม่มีวลีนี้) กันพังใหม่โดยไม่ได้ตั้งใจ
  const candidates = page.locator('a, button');
  const exact = candidates.filter({ hasText: exactText(buttonText), visible: true }).first();
  const button = await exact.waitFor({ timeout: EXACT_BUTTON_WAIT_MS }).then(
    () => exact,
    () => candidates.filter({ hasText: buttonText, visible: true }).first(),
  );

  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);

  await mkdir(downloadDir, { recursive: true });
  const destPath = path.join(downloadDir, destFileName);
  await download.saveAs(destPath);
  return destPath;
}

export type PeriodFilter = { readonly year: number } | { readonly year: number; readonly month: number };

/**
 * ตั้งปี (หรือปี+เดือน) แทนช่วงวันที่ — ใช้กับรายงานที่ไม่มีตัวกรองวันที่เลย เช่น
 * `salebymonthsum` (แค่ปี) และ `salebyproductmonthly` (ปี+เดือน) สเปกต้นทาง §5.1/§5.2 ยืนยันว่า
 * เป็น `<select>` จริง (ไม่ใช่ widget กำหนดเองแบบช่วงวันที่) จึงใช้ `selectOption()` ตรง ๆ ได้ —
 * ยืนยันจริง 2026-09-25/26: `#control_year` (ตัวเลขปี ค.ศ. ตรง ๆ) และ `#control_month`
 * (value เป็นเลขเดือน 1-12 แม้ label ที่โชว์จะเป็นชื่อเดือนภาษาอังกฤษ)
 *
 * ต้องกด "ตกลง" เสมอหลังเปลี่ยนค่า (ไม่ refresh อัตโนมัติ) — ปุ่มเดียวกับที่
 * `setDateRangeByTyping` ใช้ (class `apply-c`) ยืนยันว่าเป็นปุ่ม apply ร่วมของแผงตัวกรองทั้งกรอบ
 * ไม่ใช่ปุ่มเฉพาะช่วงวันที่
 *
 * 🔴 live-verify ครั้งแรก (2026-09-26) ดาวน์โหลดได้ไฟล์ที่มีแค่ header ไม่มีข้อมูลเลย — root
 * cause คือ race condition เดียวกับที่เจอใน `setDateRangeByTyping`/`login()`: โค้ดกด "ตกลง" แล้ว
 * ดาวน์โหลดทันทีโดยไม่รอ navigation/reload ให้จบก่อน แก้แล้วด้วย `waitForUrlSettle()` ก่อน
 * `waitForReady()` (สลับลำดับจาก `setDateRangeByTyping` — ที่นี่ reload เริ่มเร็วกว่าเพราะไม่มี
 * ขั้นตอนพิมพ์ที่กินเวลาคั่นไว้ก่อนหน้า) ยังไม่เคย live-verify การแก้นี้
 */
export async function setPeriodFilter(
  page: Page,
  allowedControls: readonly string[],
  reportId: string,
  period: PeriodFilter,
): Promise<void> {
  assertControlAllowed(allowedControls, CONTROL_PERIOD_FILTER, reportId);

  await page.locator('#control_year').selectOption(String(period.year));
  if ('month' in period) {
    await page.locator('#control_month').selectOption(String(period.month));
  }

  await page.locator('button.apply-c', { hasText: 'ตกลง' }).click();
  await waitForUrlSettle(page);
  await waitForReady(page);
}

/**
 * กดไอคอนดาวน์โหลดตรง ๆ (toolbar E — สเปกต้นทาง §3E) แล้วจับไฟล์ที่ดาวน์โหลด — ต่างจาก
 * `triggerExportAndCaptureDownload` ตรงที่ไม่มีเมนู/ปุ่มข้อความให้กด แค่ไอคอนตัวเดียว กดแล้ว
 * ดาวน์โหลดทันที ไม่ต้องรอ `waitForReady()`/`selectShowNRows` ก่อน (หน้านี้ไม่ใช่ DataTables
 * ธรรมดา เป็น dashboard ที่มีกราฟ ไม่มี pagination ให้ตั้ง)
 *
 * `iconSelector` รับมาจากผู้เรียกแทนที่จะ hardcode ไว้ในนี้ — ยืนยันจริง 2026-09-26 ว่า
 * `salebychannel` ใช้ `button.button-download:has(img[src*="download_channel"])` (ปุ่ม
 * ข้าง ๆ ใช้ class เดียวกันทุกตัวแต่ img src ต่างกัน — ต้องเจาะจงด้วย src ไม่ใช่แค่ class)
 * primitive อื่นที่ใช้ toolbar E ในอนาคตอาจมี selector ต่างกัน จึงไม่ hardcode ไว้ตรงนี้
 */
export async function triggerIconDownloadAndCapture(
  page: Page,
  allowedControls: readonly string[],
  reportId: string,
  iconSelector: string,
  downloadDir: string,
  destFileName: string,
): Promise<string> {
  assertControlAllowed(allowedControls, CONTROL_ICON_DOWNLOAD, reportId);

  const button = page.locator(iconSelector);
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);

  await mkdir(downloadDir, { recursive: true });
  const destPath = path.join(downloadDir, destFileName);
  await download.saveAs(destPath);
  return destPath;
}

/**
 * เทียบค่าของทุกช่อง `input[name="daterange"]` บนหน้ากับช่วงที่คาด — คืนข้อความอธิบายถ้าไม่ตรง
 * (หรือไม่มีช่องเลย) คืน null ถ้าผ่าน · แยกเป็นฟังก์ชันบริสุทธิ์ให้เทสต์ได้ ตัวอ่าน DOM อยู่ที่
 * `assertSessionDateRange`
 */
export function checkSessionDateRange(values: readonly string[], range: DateRange): string | null {
  const expected = `${formatDMY(range.from)} - ${formatDMY(range.to)}`;
  if (values.length === 0) return `ไม่เจอช่อง input[name="daterange"] บนหน้าเลย (คาด "${expected}") — เว็บอาจเปลี่ยน`;
  const wrong = values.filter((v) => v !== expected);
  if (wrong.length === 0) return null;
  return `ช่วงวันที่ของ session บนหน้าเป็น ${JSON.stringify(wrong[0])} ไม่ใช่ "${expected}" ที่ตั้งไว้`;
}

/** อ่านทุกช่อง `input[name="daterange"]` บนหน้าแล้วเทียบกับช่วงที่คาด — null = ตรง */
export async function sessionDateRangeProblem(page: Page, range: DateRange): Promise<string | null> {
  const values = await page
    .locator('input[name="daterange"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  return checkSessionDateRange(values, range);
}

/**
 * 🔴 ด่านสุดท้ายก่อน export ทุกไฟล์ (diagnose 2026-09-28): ช่วงวันที่เป็น state ใน laravel_session
 * ที่ request ซึ่งค้างฝั่ง server (เช่นที่ถูก abort ฝั่ง client ตอน navigate ออก — tracker ใน
 * inflight.ts มองไม่เห็นแล้ว) เขียนทับย้อนหลังได้ทุกเมื่อ ถ้าไม่ดักตรงนี้ไฟล์จะเป็นข้อมูลผิดช่วงแบบเงียบ ๆ
 * (verify.ts เทียบแค่จำนวนแถว) — sweep 48 หน้า 2026-09-28 ยืนยันว่าทุกหน้ามีช่องนี้และค่าตรงกับ session
 */
export async function assertSessionDateRange(page: Page, range: DateRange): Promise<void> {
  const problem = await sessionDateRangeProblem(page, range);
  if (problem) {
    throw new InteractionError(
      `${problem} (${page.url()})\n` +
        `  session ถูก request ที่ค้างฝั่ง server เขียนทับย้อนหลัง — ไฟล์ที่จะได้เป็นข้อมูลผิดช่วง ไม่ export`,
    );
  }
}

/** ข้อความทั้ง element ต้องเป็น `text` พอดี (ยอมช่องว่างรอบ ๆ) — `hasText` แบบ string คือ "มีคำนี้อยู่ข้างใน" ซึ่งจับรายการใน side panel ด้วย */
function exactText(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
}

/** รอปุ่มที่ข้อความตรงพอดีนานเท่านี้ก่อนถอยไปแบบ "มีคำนี้" — หน้าที่ปุ่มตรงพอดีเจอทันทีหลัง waitForReady อยู่แล้ว */
const EXACT_BUTTON_WAIT_MS = 5_000;
