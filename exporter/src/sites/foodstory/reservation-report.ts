import type { Page } from 'playwright';
import { saveDownload } from '../../core/download.ts';
import { assertControlAllowed } from '../../core/gate.ts';
import type { DateRange } from '../../core/order.ts';

/**
 * "การจองโต๊ะ" — #55 ในสเปกต้นทาง, `https://manage.foodstory.co/th/reservation-report`
 *
 * 🔴 **ไม่ใช่ `Report` shape** โดยเจตนา (เหมือน `salebychannel.ts`) — ต่างจากรายงานอื่นทุกใบใน
 * โปรเจกต์ในหลายมิติพร้อมกัน:
 * 1. คนละ host (`manage.foodstory.co` ไม่ใช่ `owner.foodstory.co`)
 * 2. UI เป็น Element UI (Vue) ไม่ใช่ jQuery DataTables — ไม่มี "Show N rows", ไม่มีปุ่ม "Excel"
 *    ตรง ๆ, ไม่มี `.carlendar-force`/`Showing X to Y of Z entries`
 * 3. date-range picker เป็นปฏิทิน 2 เดือนแบบ**คลิกได้จริง** (ต่างจากทุกหน้าอื่นที่ต้องพิมพ์)
 *    แสดงผลเป็น `dd/mm/yy` (ปีย่อ 2 หลัก ต่างจากหน้าอื่นที่เป็น `dd/mm/yyyy`)
 * 4. export เป็น dropdown "ดาวน์โหลด" ที่มีตัวเลือก CSV/Excel/คัดลอก ไม่ใช่ปุ่ม "Excel" ตรง ๆ
 * 5. 🔴 **เมื่อไม่มีข้อมูล ระบบไม่สร้างไฟล์ header-only แบบรายงานอื่นเลย** — กด "Excel" แล้วเรียก
 *    REST API จริง (`fs-pos-bff.foodstory.co/reservation-api/report/bookings`) ถ้าไม่มีข้อมูล
 *    จะขึ้น toast "ไม่มีข้อมูลการจองให้ส่งออกตามตัวกรองปัจจุบัน" แทนการดาวน์โหลด — ยืนยันจริง
 *    2026-09-26 ด้วยการเปิด network listener ตอนคลิก Excel เห็น request จริงไปที่ endpoint นี้
 *    พร้อม `start_dt`/`end_dt` เป็น Unix timestamp ตรงกับช่วงที่ตั้งไว้ (01/09/25-30/09/26)
 *
 * 🔴 **ห้าม `page.goto()` URL ตรง ๆ** (ต่างจากกฎทั่วไปของ FoodStory ที่บอกให้ goto ตรงเสมอ — ข้อ
 * ยกเว้นเดียวในทั้งโปรเจกต์) — ยืนยันจริง 2026-09-26 ว่า `goto('https://manage.foodstory.co/th/
 * reservation-report')` ตรง ๆ (แม้ session ของ owner.foodstory.co ยัง valid อยู่ และเพิ่ง login
 * สำเร็จสด ๆ) **redirect ไป `owner.foodstory.co/login?from_url=...` เสมอ** และแม้ล็อกอินสำเร็จ
 * ตรงนั้นก็ยัง**ไม่พาไปที่ manage.foodstory.co ตามที่ from_url ควรทำ** (ไปจบที่
 * `owner.foodstory.co/th/summary` แทน) ลองซ้ำ 2 รอบ (เสีย reCAPTCHA จริง 2 ครั้ง) ได้ผลเหมือนกัน
 * ทุกครั้ง — สรุปว่า `from_url` เป็นกลไกที่ใช้งานไม่ได้จริง (หรือต้องมีเงื่อนไขอื่นที่ยังไม่รู้)
 * **ทางที่ใช้ได้จริง:** ต้องอยู่ในหน้า `owner.foodstory.co` ที่ login ค้างอยู่แล้ว แล้ว**คลิกลิงก์
 * sidebar "การจองโต๊ะ" จริง** (`href="javascript:void(0)"` — ไม่มี URL ให้ goto ตรง ๆ อยู่แล้ว)
 * ถึงจะพาไป `manage.foodstory.co/th/reservation-report` ได้สำเร็จ พร้อมเนื้อหาเต็ม — เข้าใจว่า
 * การคลิกลิงก์นี้ทำ token exchange บางอย่างที่ direct navigation ทำไม่ได้ (ไม่ทราบกลไกแน่ชัด
 * ไม่ได้ inspect network request ตอนคลิกจริง ๆ)
 *
 * 🔴 **ไม่มี `expectedColumns`/header ยืนยันจากไฟล์จริงเหมือนรายงานอื่นทุกใบ** — ยืนยันด้วยการ
 * ตั้งช่วงวันที่กว้างสุด (01/09/25-30/09/26, กว่า 1 ปี) แล้วยังว่างเปล่า (ตรงกับที่สเปกต้นทาง §5.4
 * เตือนไว้ว่าโมดูลนี้ดูเหมือนไม่ได้ใช้งานจริงที่สาขานี้) รวมกับข้อ 5 ข้างบน (ไม่มีข้อมูล = ไม่มีไฟล์
 * เลย ไม่ใช่แค่ไม่มีแถวข้อมูล) แปลว่า **ไม่เคยมีไฟล์จริงให้ตรวจสอบเลยสักครั้งในบัญชีทดสอบนี้** —
 * ตัดสินใจแล้ว (ถามผู้ใช้ตรง ๆ ก่อน) ว่าจะไม่สร้างข้อมูลจองปลอมขึ้นมาเองเพื่อให้ได้ไฟล์ตัวอย่าง
 * (เขียนข้อมูลจริงเข้าระบบธุรกิจจริงโดยไม่จำเป็น) เอกสารนี้เป็นข้อจำกัดที่รู้ตัว ไม่ใช่งานที่ทำไม่
 * ครบ — ถ้าในอนาคตมีข้อมูลจองจริงเกิดขึ้น ต้องกลับมาเติม `expectedColumns`/ฟังก์ชันอ่านไฟล์ต่อ
 *
 * 🔴 **ยังไม่ยืนยันว่า export ผ่าน API ดึงข้อมูลครบทุกแถวจริงหรือถูกจำกัดแบบเดียวกับตัวเลือก
 * "10 รายการ" ที่โชว์บนตาราง** (สเปกต้นทาง §5.4) — request ที่ยืนยันจริงมีแค่ `page=1&page_size=100`
 * ติดไปด้วยเสมอ (ดูโค้ด `triggerReservationExcelDownloadAndCapture`) แต่ยืนยันได้แค่กรณีไม่มี
 * ข้อมูลเลย (0 แถว) เท่านั้น ไม่เคยทดสอบกับข้อมูลจริงที่เกิน 100 แถวเลยว่า API จะคืนครบหรือ cap
 * ไว้ที่ page_size — ถ้าในอนาคตมีข้อมูลจองจริงเกิดขึ้นและเกิน 100 รายการ ต้องตรวจเรื่องนี้ก่อนเชื่อ
 * ว่าไฟล์ที่ได้ครบถ้วน
 */

export const ID = 'reservation-report';
export const LABEL = 'การจองโต๊ะ';
export const HOST = 'https://manage.foodstory.co';
export const PATH = '/th/reservation-report';

export class ReservationReportError extends Error {
  override readonly name = 'ReservationReportError';
}

/** primitive ที่คลิกลิงก์ sidebar เพื่อข้าม host ต้องประกาศ control นี้ */
export const CONTROL_SIDEBAR_RESERVATION_LINK = 'sidebarReservationLink';
/** primitive ที่ตั้งช่วงวันที่ผ่านปฏิทินคลิกต้องประกาศ control นี้ */
export const CONTROL_DATE_RANGE_CALENDAR = 'dateRangeCalendar';
/** primitive ที่กด dropdown ดาวน์โหลดต้องประกาศ control นี้ */
export const CONTROL_DOWNLOAD_DROPDOWN = 'downloadDropdown';

const ALLOWED_CONTROLS = [
  CONTROL_SIDEBAR_RESERVATION_LINK,
  CONTROL_DATE_RANGE_CALENDAR,
  CONTROL_DOWNLOAD_DROPDOWN,
];

/**
 * ไปหน้า reservation-report จากหน้า owner.foodstory.co ที่ login ค้างอยู่แล้ว โดยคลิกลิงก์
 * sidebar จริง — ห้าม `page.goto()` ปลายทางตรง ๆ (ดูคอมเมนต์หัวไฟล์)
 *
 * ต้องเรียกตอนที่ `page` มี session ของ owner.foodstory.co ที่ login ค้างอยู่แล้วเท่านั้น (ฟังก์ชัน
 * นี้ไม่ login เอง) — เช็คก่อนว่ายังไม่ถูกเด้งไปหน้า login เพื่อโยน error ที่อ่านออกได้ทันที แทนที่
 * จะปล่อยให้ locator หาลิงก์ไม่เจอแล้ว timeout แบบไม่รู้สาเหตุ
 */
export async function navigateToReservationReport(page: Page, ownerBaseUrl: string): Promise<void> {
  assertControlAllowed(ALLOWED_CONTROLS, CONTROL_SIDEBAR_RESERVATION_LINK, ID);

  await page.goto(`${ownerBaseUrl}/th/summary`);
  if ((await page.locator('input[name="password"]').count()) > 0) {
    throw new ReservationReportError(
      `ยังไม่ได้ login เข้า owner.foodstory.co (เจอฟอร์ม login ที่ ${page.url()}) — ฟังก์ชันนี้ต้องมี ` +
        'session ที่ login ค้างอยู่แล้วเท่านั้น ไม่ได้ login ให้เอง',
    );
  }

  const link = page.locator('a', { hasText: 'จองโต๊ะ' }).first();
  await link.click();
  await page.waitForTimeout(1500);

  if (!page.url().startsWith(HOST)) {
    throw new ReservationReportError(
      `คลิกลิงก์ sidebar "การจองโต๊ะ" แล้วแต่ไม่ไปถึง ${HOST} จริง — อยู่ที่ ${page.url()} แทน`,
    );
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type MonthPos = { readonly year: number; readonly month: number };
type PanelSide = 'left' | 'right';

/** จำนวนเดือนจาก `a` ไป `b` (บวก = ต้องเลื่อนไปข้างหน้า, ลบ = ย้อนหลัง) — แยกเป็น pure function
 * เพราะเลขคำนวณนี้เคยมีบั๊กจริงมาแล้ว (ดูคอมเมนต์ `navigatePanelToMonth`) — ทดสอบแยกได้ที่
 * test/foodstory-reservation-report.test.ts */
export function monthDiff(a: MonthPos, b: MonthPos): number {
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/**
 * panel ที่ต้องคลิกวันสิ้นสุด — 🔴 พังจริง 2026-09-28: panel ขวาเลื่อนมาเดือนเดียวกับ panel ซ้าย
 * ไม่ได้ (ปุ่มเลื่อนย้อนของ panel ขวา disabled เมื่อชิดกับซ้าย — Element UI แบบ unlink-panels) ช่วงที่
 * จบในเดือนเดียวกับวันเริ่ม (รอบรายเดือนปกติทุกรอบ) ต้องคลิกวันสิ้นสุดใน panel ซ้ายเดียวกัน
 */
export function endDayPanel(from: MonthPos, to: MonthPos): PanelSide {
  const diff = monthDiff(from, to);
  if (diff < 0) {
    throw new ReservationReportError(`วันสิ้นสุด (${to.year}-${to.month}) อยู่ก่อนวันเริ่ม (${from.year}-${from.month})`);
  }
  return diff === 0 ? 'left' : 'right';
}

async function readPanelMonth(page: Page, side: PanelSide): Promise<MonthPos> {
  const header = page.locator(`.el-date-range-picker__content.is-${side} .el-date-range-picker__header`);
  const text = ((await header.textContent()) ?? '').trim();
  const m = /(\d{4})\s+([A-Za-z]+)/.exec(text);
  if (!m) {
    throw new ReservationReportError(`อ่าน header ปฏิทิน panel "${side}" ไม่ได้ — ได้ข้อความ "${text}"`);
  }
  const month = MONTH_NAMES.indexOf(m[2]!) + 1;
  if (month === 0) {
    throw new ReservationReportError(`ไม่รู้จักชื่อเดือน "${m[2]}" ใน header ปฏิทิน (panel "${side}")`);
  }
  return { year: Number(m[1]), month };
}

/**
 * เลื่อน panel (ซ้ายหรือขวา) ไปยังเดือน/ปีเป้าหมาย ทีละเดือน
 *
 * 🔴 ยืนยันจริง 2026-09-26 ว่า panel ซ้าย/ขวา**เป็นปฏิทินอิสระจากกันคนละตัว ไม่ได้ล็อกเป็น
 * ซ้าย+1เดือน=ขวาเสมอ**อย่างที่เข้าใจผิดตอนแรก (ตอนแรกเห็น default อยู่ที่ก.ย./ต.ค. 2026 ซึ่ง
 * บังเอิญห่างกันแค่ 1 เดือน เลยเข้าใจผิดว่าเป็นกฎตายตัว) — พิสูจน์แล้วว่าหลังเลื่อน panel ซ้ายไป
 * ส.ค. 2026 (คลิกลูกศรของ panel ซ้ายเอง) panel ขวายังค้างอยู่ที่ ต.ค. 2026 เหมือนเดิม ไม่ขยับตาม
 * เลย — ต้องเลื่อนแต่ละ panel แยกกันเองด้วยลูกศรของ panel นั้น ๆ เท่านั้น
 */
const MAX_CALENDAR_NAV_STEPS = 60;

async function navigatePanelToMonth(page: Page, side: PanelSide, target: MonthPos): Promise<void> {
  for (let i = 0; i < MAX_CALENDAR_NAV_STEPS; i++) {
    const current = await readPanelMonth(page, side);
    const diff = monthDiff(current, target);
    if (diff === 0) return;

    const direction = diff > 0 ? 'right' : 'left';
    const arrow = page.locator(`.el-date-range-picker__content.is-${side} .el-icon-arrow-${direction}`);
    const cls = (await arrow.first().getAttribute('class')) ?? '';
    if ((await arrow.count()) === 0 || cls.includes('is-disabled')) {
      throw new ReservationReportError(
        `ปุ่มเลื่อนเดือนปฏิทิน (${direction}, panel "${side}") กดต่อไม่ได้ (ติด disabled) ก่อนถึง ` +
          `เดือนเป้าหมาย ${target.year}-${target.month} — อยู่ที่ ${current.year}-${current.month}`,
      );
    }
    await arrow.first().click();
    await page.waitForTimeout(200);
  }
  throw new ReservationReportError(
    `เลื่อนปฏิทิน panel "${side}" ไม่ถึงเดือนเป้าหมาย ${target.year}-${target.month} ภายใน ` +
      `${MAX_CALENDAR_NAV_STEPS} ครั้ง`,
  );
}

async function clickCalendarDay(page: Page, side: PanelSide, day: number): Promise<void> {
  // 🔴 ยืนยันจริง 2026-09-26: cell text ดิบมี whitespace/newline ล้อมรอบเสมอ (เช่น
  // "\n          1\n        ") — regex ต้องทน whitespace รอบ ๆ ไม่ใช่ anchor ตรง ๆ (^1$ ไม่แมตช์)
  const cell = page
    .locator(`.el-date-range-picker__content.is-${side} td.available:not(.prev-month):not(.next-month)`)
    .filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) });

  if ((await cell.count()) === 0) {
    throw new ReservationReportError(`หา day cell "${day}" ใน panel "${side}" ไม่เจอ (อาจถูก disabled)`);
  }
  await cell.first().click();
}

/** `DD/MM/YY` — ปีย่อ 2 หลัก ต่างจาก `formatDMY` ของ `core/order.ts` (4 หลัก) ที่หน้าอื่นใช้ */
export function formatDMYShortYear(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  return `${dd}/${mm}/${yy}`;
}

/**
 * ตั้งช่วงวันที่ผ่านปฏิทิน 2 เดือนแบบคลิก (ต่างจาก `setDateRangeByTyping` ของรายงานอื่นทั้งหมด
 * ที่พิมพ์ข้อความ) — เปิด popup, เลื่อน panel ซ้ายไปเดือนของ `from` แล้วคลิกวันเริ่ม, แล้วคลิกวันสิ้นสุด
 * ใน panel ที่ `endDayPanel` เลือก: เดือนเดียวกัน = panel ซ้ายเดิม, คนละเดือน = เลื่อน panel ขวาไปเดือน
 * ของ `to` แยกต่างหาก (คนละปฏิทิน ไม่ผูกกัน — ดูคอมเมนต์ `navigatePanelToMonth`)
 *
 * ยืนยันจริง 2026-09-26: รอบแรกลองสมมติว่า panel ขวา = panel ซ้าย+1 เดือนเสมอ (branch ตาม
 * เดือนเดียวกัน/เดือนถัดไป) แล้วพังจริง — ตั้งช่วง 01/08/26-26/09/26 ได้ค่าสิ้นสุดผิดเป็น 26/10/26
 * เพราะ panel ขวาค้างอยู่ที่เดือนเดิม (ต.ค.) จากสถานะก่อนหน้า ไม่ได้ขยับตาม panel ซ้ายเลย แก้แล้ว
 * ด้วยการเลื่อนแต่ละ panel อิสระกัน ทดสอบซ้ำด้วยช่วงเดิมได้ค่าตรงเป๊ะทั้งคู่ (`inputValue()`
 * กลับมาตรงกับ `dd/mm/yy` ที่คาด)
 */
export async function setReservationDateRange(page: Page, range: DateRange): Promise<void> {
  assertControlAllowed(ALLOWED_CONTROLS, CONTROL_DATE_RANGE_CALENDAR, ID);

  await page.locator('input[placeholder="ตั้งแต่วันที่"]').click();
  await page.waitForTimeout(400);

  const fromPos: MonthPos = { year: range.from.getUTCFullYear(), month: range.from.getUTCMonth() + 1 };
  const toPos: MonthPos = { year: range.to.getUTCFullYear(), month: range.to.getUTCMonth() + 1 };

  await navigatePanelToMonth(page, 'left', fromPos);
  await clickCalendarDay(page, 'left', range.from.getUTCDate());
  await page.waitForTimeout(300);

  const endPanel = endDayPanel(fromPos, toPos);
  if (endPanel === 'right') await navigatePanelToMonth(page, 'right', toPos);
  await clickCalendarDay(page, endPanel, range.to.getUTCDate());
  await page.waitForTimeout(500);

  const startValue = await page.locator('input[placeholder="ตั้งแต่วันที่"]').inputValue();
  const endValue = await page.locator('input[placeholder="ถึงวันที่"]').inputValue();
  const expectedStart = formatDMYShortYear(range.from);
  const expectedEnd = formatDMYShortYear(range.to);
  if (startValue !== expectedStart || endValue !== expectedEnd) {
    throw new ReservationReportError(
      `ตั้งช่วงวันที่แล้วแต่ค่าที่อ่านได้ไม่ตรงที่คาด — คาด ${expectedStart} ถึง ${expectedEnd} ` +
        `ได้จริง ${startValue} ถึง ${endValue}`,
    );
  }
}

export type ReservationDownloadResult =
  | { readonly status: 'ok'; readonly destPath: string }
  | { readonly status: 'empty' };

const EMPTY_TOAST_TEXT = 'ไม่มีข้อมูลการจองให้ส่งออกตามตัวกรองปัจจุบัน';

/**
 * กด dropdown "ดาวน์โหลด" แล้วเลือก "Excel" — 🔴 ต้อง race ระหว่าง download event กับ toast
 * "ไม่มีข้อมูล..." เพราะเมื่อไม่มีข้อมูล ระบบไม่ยิง download event เลย (ต่างจากรายงาน DataTables
 * ทุกใบที่ยังได้ header-only file เสมอ) — ไม่ race ไว้จะ hang รอ download ที่ไม่มีวันมาถึง
 */
export async function triggerReservationExcelDownloadAndCapture(
  page: Page,
  downloadDir: string,
  destFileName: string,
): Promise<ReservationDownloadResult> {
  assertControlAllowed(ALLOWED_CONTROLS, CONTROL_DOWNLOAD_DROPDOWN, ID);

  await page.locator('button.reservation-report__download-btn').click();
  await page.waitForTimeout(400);

  const excelItem = page
    .locator('.reservation-report__download-dropdown li, .reservation-report__download-dropdown .el-dropdown-menu__item')
    .filter({ hasText: 'Excel' })
    .first();
  const emptyToast = page.locator('.el-message', { hasText: EMPTY_TOAST_TEXT });

  const [outcome] = await Promise.all([
    Promise.race([
      page.waitForEvent('download', { timeout: 15_000 }).then((download) => ({ kind: 'download' as const, download })),
      emptyToast.waitFor({ state: 'visible', timeout: 15_000 }).then(() => ({ kind: 'empty' as const })),
    ]),
    excelItem.click(),
  ]);

  if (outcome.kind === 'empty') {
    return { status: 'empty' };
  }

  const destPath = await saveDownload(outcome.download, downloadDir, destFileName);
  return { status: 'ok', destPath };
}
