import type { Locator, Page } from 'playwright';
import { assertControlAllowed } from '../../core/gate.ts';
import type { Redactor } from '../../core/redact.ts';

/**
 * helper ที่รู้เรื่อง ASP.NET WebForms โดยเฉพาะ
 *
 * HotelTime เป็น WebForms (`__VIEWSTATE` 912 ตัวอักษร, `__EVENTVALIDATION`, `__doPostBack()`,
 * `WebResource.axd`, v4.6.24 — ตรวจจากของจริง 2026-09-08) ซึ่งมีกับดักสองข้อที่ทำให้
 * โค้ด Playwright ปกติพังแบบเงียบ ๆ:
 *
 *   1. ทุกคลิกคือการ submit ฟอร์มทั้งหน้า — อ่าน DOM ต่อทันทีหลัง click() จะได้ค่าเก่า
 *   2. control id ถูก generate จากโครง control tree (`rptLastUsers$ctl00$tbUserName`)
 *      ตัวเลข index เลื่อนได้เมื่อจำนวนแถวใน repeater เปลี่ยน — ห้ามผูกกับ id ตรง ๆ
 *
 * นอกจากนั้นยังรวมกับดักที่พบตอนสำรวจหน้ารายงานจริง (2026-09-08) ไว้ที่เดียว:
 * ช่วงวันที่ที่ถูกกรอกมาให้ล่วงหน้า · ฟิลด์บังคับที่ห้ามล้าง · ผลว่างที่ไม่ส่งไฟล์มา
 * ทั้งหมดมีบันทึกที่มาอยู่ใน recon/NOTES.md
 */

type AriaRole = Parameters<Page['getByRole']>[0];

export class WebFormsError extends Error {
  override readonly name = 'WebFormsError';
}

/** อยู่ที่หน้า login อยู่หรือเปล่า — ใช้ตรวจทั้งตอนเริ่มและตอนโดนเตะกลับกลางทาง */
export function isLoginPage(url: string): boolean {
  return /login\.aspx/i.test(url);
}

/**
 * อ่านโครงหน้าเว็บออกมาเป็นข้อความไว้แนบใน error
 * ตัดที่ 40 บรรทัดพอให้เห็นรูปร่าง และกรองความลับออกก่อนเสมอ
 */
export async function describePage(page: Page, redact: Redactor): Promise<string> {
  try {
    const snapshot = await page.locator('body').ariaSnapshot();
    const lines = snapshot.split('\n');
    const head = lines.slice(0, 40).join('\n');
    const more = lines.length > 40 ? `\n… (อีก ${lines.length - 40} บรรทัด)` : '';
    return redact(head + more);
  } catch {
    return '(อ่าน aria snapshot ของหน้านี้ไม่สำเร็จ)';
  }
}

/**
 * หา element ตาม role + ชื่อ แล้วยืนยันว่าเจอ "ชิ้นเดียว"
 *
 * เจอศูนย์ชิ้น = หน้าเว็บเปลี่ยนหรือเรามาผิดหน้า
 * เจอหลายชิ้น = เกือบทุกครั้งคือ repeater ที่มีหลายแถว (หน้า login ของ HotelTime
 * เป็น repeater จริง ๆ) การเดาเอา .first() ตรงนี้คือทางที่ทำให้ล็อกอินผิด user เงียบ ๆ
 * จึงเลือกล้มดัง ๆ แล้วให้คนตัดสินใจแทน
 */
export async function uniqueByRole(
  page: Page,
  role: AriaRole,
  name: string,
  redact: Redactor,
): Promise<Locator> {
  const exact = page.getByRole(role, { name, exact: true });
  const exactCount = await exact.count();
  if (exactCount === 1) return exact;

  if (exactCount > 1) {
    throw new WebFormsError(
      `เจอ ${role} ชื่อ "${name}" ${exactCount} ชิ้น คาดว่าจะมีชิ้นเดียว\n` +
        `  น่าจะเป็น repeater ที่มีหลายแถว — ต้องเจาะจงแถวก่อนเรียกใช้\n` +
        `  โครงหน้าเว็บตอนนี้:\n${await describePage(page, redact)}`,
    );
  }

  // ไม่เจอแบบตรงเป๊ะ ลองแบบหลวมก่อนจะยอมแพ้ เผื่อชื่อมีช่องว่างหรือตัวพ่วง
  const loose = page.getByRole(role, { name });
  const looseCount = await loose.count();
  if (looseCount === 1) return loose;

  throw new WebFormsError(
    `หา ${role} ชื่อ "${name}" ไม่เจอ (ตรงเป๊ะ ${exactCount} ชิ้น, หลวม ${looseCount} ชิ้น)\n` +
      `  URL ตอนนี้: ${page.url()}\n` +
      `  โครงหน้าเว็บตอนนี้:\n${await describePage(page, redact)}`,
  );
}

/**
 * ยืนยันว่ายังล็อกอินอยู่ ต้องเรียก "ก่อน" กดปุ่ม export ทุกครั้ง
 *
 * 🔴 นี่คือด่านกันความเสี่ยงอันดับ 1 ของโปรเจกต์: ถ้า session หมดอายุกลางทาง
 * WebForms จะเด้งกลับหน้า login แล้วการกด export ต่อจะได้ไฟล์ที่ "ดูปกติแต่ว่างเปล่า"
 * ซึ่งไหลเข้าคลังได้โดยไม่มีใครรู้ — ต้องล้มดัง ๆ ตรงนี้เท่านั้น
 */
export async function assertStillLoggedIn(page: Page): Promise<void> {
  const url = page.url();
  if (isLoginPage(url)) {
    throw new WebFormsError(
      `session หลุดแล้ว — โดนเด้งกลับหน้า login ระหว่างทาง (${url})\n` +
        `  ASP.NET session เป็น server-side และหมดอายุเองได้ ต้องล็อกอินใหม่แล้วเริ่มรายงานนี้ใหม่`,
    );
  }
}

/**
 * กรอกค่าลงช่องแล้วยิง event `change` ให้ WebForms รู้ตัว
 *
 * `fill()` เฉย ๆ ไม่พอเสมอไป เพราะ control วันที่ของ HotelTime มี JS ผูกไว้
 * และบาง control auto-postback เมื่อค่าเปลี่ยน
 */
async function setInput(page: Page, controlName: string, value: string): Promise<void> {
  const el = page.locator(`input[name="${controlName}"]`);
  const n = await el.count();
  if (n !== 1) {
    throw new WebFormsError(
      `คาดว่าจะเจอช่อง ${controlName} ชิ้นเดียว แต่เจอ ${n} ชิ้นที่ ${page.url()}\n` +
        `  หน้าเว็บน่าจะเปลี่ยนโครงสร้าง ต้องสำรวจใหม่ก่อนแก้โค้ด`,
    );
  }
  await el.fill(value);
  await el.dispatchEvent('change');
}

/**
 * ตั้งช่วงวันที่ของ composite control หนึ่งชุด (`<group>$calFrom` + `<group>$calTo`)
 * ค่าต้องเป็น `DD/MM/YYYY` — รูปแบบเดียวที่ HotelTime รับ
 *
 * 🔴 ประตู `assertControlAllowed` เช็คที่ระดับ `group` (ชื่อที่รายงานประกาศไว้จริง) ไม่ใช่
 * ที่ระดับ `$calFrom`/`$calTo` ที่ถูกต่อท้ายภายในฟังก์ชันนี้ — รายงานจึงประกาศแค่ชื่อ group
 * ที่ตัวเองเห็นและใช้จริง ไม่ต้องรู้เรื่อง suffix ภายใน
 */
export async function setDateRange(
  page: Page,
  group: string,
  from: string,
  to: string,
  allowedControls: readonly string[],
  reportId: string,
): Promise<void> {
  assertControlAllowed(allowedControls, group, reportId);
  await setInput(page, `${group}$calFrom`, from);
  await setInput(page, `${group}$calTo`, to);
}

/**
 * ตั้งวันที่ของ control **เดี่ยว** ตัวเดียว (ไม่ใช่คู่ `$calFrom`/`$calTo` แบบ `setDateRange`)
 * — พบครั้งแรกใน pilot batch (ticket 01, Arrivals): `ctl00$pc$calDate` เป็นช่องเดียว
 * ไม่ใช่ group ที่มีสอง sub-field ค่าต้องเป็น `DD/MM/YYYY` เหมือน `setDateRange`
 *
 * ใช้กับรายงาน `dailyOnly` (ADR-0003) เท่านั้น — ค่าที่ส่งมาคือวันนี้เสมอ (จาก
 * `resolveDailyOnlyRange`) จึงไม่ต้องรองรับการ "ล้าง" เป็นค่าว่างแบบ `clearDateRange`:
 * หน้าที่เจอมาบังคับ control นี้ผ่าน popup ไม่ใช่ข้อความ "mandatory item" (ดู
 * `.scratch/pms-export-new-report-pilot/issues/01-arrivals-report.md`) — การไม่ล้างมันเลย
 * คือทางเลี่ยงปัญหานั้นทั้งหมด ไม่ต้องเขียนตัวตรวจ popup ใหม่
 */
export async function setSingleDate(
  page: Page,
  controlName: string,
  value: string,
  allowedControls: readonly string[],
  reportId: string,
): Promise<void> {
  assertControlAllowed(allowedControls, controlName, reportId);
  await setInput(page, controlName, value);
}

/**
 * เลือกค่าในดรอปดาวน์ (`<select>`) ด้วยข้อความที่เห็นบนจอ — หน้าสถิติ/Post masters ใช้ปี/เดือน/สถานะเป็นดรอปดาวน์
 *
 * 🔴 ดรอปดาวน์แบบ AutoPostBack (`onchange` เรียก `__doPostBack`) ส่งฟอร์มทั้งหน้าทันทีที่เปลี่ยน — ต้องรอ navigation
 * ของ postback นั้นจบก่อนแตะ control ถัดไป ไม่งั้นค่าที่ตั้งต่อจะหายไปกับหน้าที่โหลดใหม่ (`waitForLoadState` เฉย ๆ
 * กลับทันทีเพราะหน้าเดิมโหลดเสร็จอยู่แล้ว — code review ticket 21) · ค่าเดิมตรงอยู่แล้ว = ไม่แตะ ไม่มี postback ให้รอ
 * · timeout ใช้ค่าตั้งต้นของ context (= HOTELTIME_TIMEOUT_MS, ตั้งใน session.ts)
 */
export async function setSelect(
  page: Page,
  controlName: string,
  label: string,
  allowedControls: readonly string[],
  reportId: string,
): Promise<void> {
  assertControlAllowed(allowedControls, controlName, reportId);
  const el = page.locator(`select[name="${controlName}"]`);
  const n = await el.count();
  if (n !== 1) {
    throw new WebFormsError(`คาดว่าจะเจอดรอปดาวน์ ${controlName} ชิ้นเดียว แต่เจอ ${n} ชิ้นที่ ${page.url()}`);
  }
  const { current, autoPostBack } = await el.evaluate((e) => {
    const sel = e as HTMLSelectElement;
    return {
      current: sel.options[sel.selectedIndex]?.text.trim() ?? '',
      autoPostBack: /__doPostBack/.test(sel.getAttribute('onchange') ?? ''),
    };
  });
  if (current === label) return;
  if (autoPostBack) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), el.selectOption({ label })]);
    await page.waitForLoadState('networkidle').catch(() => undefined);
  } else {
    await el.selectOption({ label });
  }
  await assertStillLoggedIn(page);
}

/**
 * กรอกข้อความลงช่องเดี่ยวทั่วไป (ชั่วโมง/นาที หรือล้างช่องด้วย '') ผ่านประตูอ่านอย่างเดียว — ใช้แทน `setSingleDate` เมื่อค่าไม่ใช่วันที่
 * `DD/MM/YYYY` (code review ticket 13: เดิมยืม setSingleDate ซึ่งชื่อและคำอธิบายบอกว่าเป็นวันที่ของรายงาน dailyOnly)
 */
export async function setText(
  page: Page,
  controlName: string,
  value: string,
  allowedControls: readonly string[],
  reportId: string,
): Promise<void> {
  assertControlAllowed(allowedControls, controlName, reportId);
  await setInput(page, controlName, value);
}

/**
 * ยืนยันว่า checkbox ทุกตัวที่ชื่อขึ้นต้นด้วย `namePrefix` อยู่ในสถานะ `checked` ที่รายงานพึ่ง (อ่านอย่างเดียว ไม่แตะ) — ชื่อเต็มของตัวเดียวก็ได้
 * · ใช้กับค่าตั้งต้นที่รายงานพึ่งแต่ไม่ต้องเปลี่ยน (ชนิดเอกสาร 9 ชนิดของ InvoicesReport ติ๊กครบ, "กรองด้วยวันเข้าพัก" ของ GuestBook ไม่ติ๊ก /
 * Foreign police ติ๊ก) · ค่าตั้งต้นเปลี่ยนเงียบ ๆ เมื่อไหร่ต้องล้มดัง ๆ ไม่ใช่ได้ไฟล์ที่ความหมายเปลี่ยน
 * · 🔴 อ่าน `.checked` ไม่ใช่ `.value` — value ของ checkbox เป็น "on" เสมอไม่ว่าจะติ๊กหรือไม่ (พลาดจริงตอน recon 2026-10-07)
 */
export async function assertCheckboxes(page: Page, namePrefix: string, checked: boolean): Promise<void> {
  const state = await page.evaluate((prefix) => {
    const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')) as HTMLInputElement[];
    const mine = boxes.filter((b) => (b.name ?? '').startsWith(prefix));
    return mine.map((b) => ({ checked: b.checked, label: b.labels?.[0]?.textContent?.trim() || b.name }));
  }, namePrefix);
  const wrong = state.filter((b) => b.checked !== checked).map((b) => b.label);
  if (state.length === 0 || wrong.length > 0) {
    throw new WebFormsError(
      `checkbox "${namePrefix}*" ต้อง${checked ? 'ติ๊ก' : 'ไม่ติ๊ก'}ทุกตัว (เจอ ${state.length} ตัว · ผิด: ${wrong.join(', ') || '—'}) ที่ ${page.url()}\n` +
        `  ค่าตั้งต้นของหน้าเปลี่ยน — ต้องสำรวจใหม่ก่อนเชื่อไฟล์`,
    );
  }
}

/**
 * ล้างช่วงวันที่ทิ้ง
 *
 * 🔴 จำเป็นเสมอสำหรับช่วงวันที่ที่ "ไม่ใช่" ตัวที่เราต้องการกรอง เพราะทุกหน้ารายงาน
 * มีช่วงวันที่ default กรอกมาให้แล้วตั้งแต่เปิดหน้า (เช่น Arrival = วันนี้ → อีก 1 ปี)
 * ถ้าไม่ล้าง ผลลัพธ์จะเป็น intersection ที่ผิดโดยไฟล์หน้าตาปกติ — พิสูจน์แล้ว 2026-09-08
 *
 * ⚠️ ใช้กับช่องที่เป็น mandatory ไม่ได้ (เช่น `Period:` ของใบ RateCode) —
 * ช่องแบบนั้นต้องตั้งให้กว้างจนไม่กรองอะไรแทน
 */
export async function clearDateRange(
  page: Page,
  group: string,
  allowedControls: readonly string[],
  reportId: string,
): Promise<void> {
  await setDateRange(page, group, '', '', allowedControls, reportId);
}

/**
 * ตรวจว่าฟอร์มไม่ได้ถูกปฏิเสธเพราะฟิลด์บังคับว่าง
 *
 * 🔴 ด่านสำคัญ: หน้า RateCode จะ re-render พร้อมป้าย `* mandatory item` โดยไม่มี error
 * ที่มองเห็นชัด และลิงก์ export ของหน้านั้น **อยู่ตลอดเวลา** ไม่ได้โผล่ตามผลลัพธ์
 * ดังนั้นถ้าไม่เช็คตรงนี้ เราจะกด export แล้วได้ไฟล์ของผลลัพธ์เก่าหรือว่างเปล่า
 */
export async function assertFormAccepted(page: Page): Promise<void> {
  const body = await page.locator('body').innerText();
  if (/mandatory item/i.test(body)) {
    throw new WebFormsError(
      `ฟอร์มถูกปฏิเสธ — หน้าเว็บขึ้น "* mandatory item" แปลว่ามีฟิลด์บังคับที่ยังว่างอยู่ (${page.url()})\n` +
        `  อย่ากด export ต่อ เพราะลิงก์ export ของบางหน้าอยู่ตลอดเวลาและจะให้ไฟล์ที่ไม่ตรงกับที่สั่ง`,
    );
  }
}

/**
 * อ่านแถวสรุปท้ายตาราง (`Total amount of reserved rooms:` ฯลฯ) เป็นตัวเลข
 *
 * ⚠️ แต่ละใบให้ค่าไม่เหมือนกัน — ใบแรกให้จำนวนแถวพอดี ใบ Cancelled นับ reservation
 * (ไม่เท่าจำนวนแถว) ใบ RateCode ให้ค่าว่าง · ผู้เรียกต้องรู้ว่าตัวเองอ่านอะไรอยู่
 * และ **ค่านี้ถูกคำนวณหลังโดนตัดที่เพดาน 2000 แล้ว จึงกันเรื่องเพดานไม่ได้**
 */
export async function readTotals(page: Page): Promise<Map<string, string>> {
  const pairs = await page.evaluate(() => {
    const out: [string, string][] = [];
    for (const tr of document.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) continue;
      const key = (tds[0]!.textContent ?? '').trim();
      if (key.length > 0 && key.length < 60 && /^(total|guests total)/i.test(key)) {
        out.push([key, (tds[1]!.textContent ?? '').trim()]);
      }
    }
    return out;
  });
  return new Map(pairs);
}

/** อ่านค่าจากแถวสรุปเป็นจำนวนเต็ม คืน null ถ้าไม่มีแถวนั้นหรือค่าว่าง */
export function totalAsNumber(totals: ReadonlyMap<string, string>, label: string): number | null {
  const raw = totals.get(label);
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw.replace(/[\s,]/g, ''));
  return Number.isInteger(n) ? n : null;
}

/**
 * กดปุ่มแล้วรอให้ postback จบ
 *
 * WebForms ทุกคลิกคือการ submit ฟอร์มทั้งหน้า การอ่าน DOM ต่อทันทีหลัง `click()`
 * จะได้ค่าของหน้าเดิม
 */
export async function clickAndSettle(
  page: Page,
  controlName: string,
  timeoutMs: number,
  allowedControls: readonly string[],
  reportId: string,
): Promise<void> {
  assertControlAllowed(allowedControls, controlName, reportId);
  const el = page.locator(`input[name="${controlName}"]`);
  const n = await el.count();
  if (n !== 1) {
    throw new WebFormsError(`คาดว่าจะเจอปุ่ม ${controlName} ชิ้นเดียว แต่เจอ ${n} ชิ้นที่ ${page.url()}`);
  }
  await el.click();
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
  await assertStillLoggedIn(page);
}

export const EXPORT_LINK_NAME = 'Export: MS Excel';

/**
 * กดลิงก์ export แล้วรับไฟล์
 *
 * ต้องดัก event **ก่อน** คลิกเสมอ ไม่งั้น event ผ่านไปแล้วจับไม่ทัน
 *
 * 🔴 "ไม่มีไฟล์มา" ต้องถือเป็นความล้มเหลว ไม่ใช่รอต่อไปเรื่อย ๆ — ใบ Cancelled
 * จะเงียบสนิทเมื่อช่วงวันที่กว้างเกินไป (ทดสอบ 2026-09-08: 1 ปี = ไม่มี download
 * เลยใน 120 วินาที ขณะที่ 1 เดือนใช้ 0.3 วินาที)
 */
export async function downloadExport(
  page: Page,
  destPath: string,
  timeoutMs: number,
  /** id ของปุ่ม export ที่ต้องกด เมื่อหน้ามีหลายปุ่ม (เช่น สรุป/รายละเอียด — ticket 24) · ไม่ใส่ = ลิงก์ "Export: MS Excel" ชิ้นเดียว */
  linkId?: string,
): Promise<{ suggestedFilename: string; elapsedMs: number }> {
  await assertStillLoggedIn(page);
  // กันพิมพ์ id ผิด/หน้าเปลี่ยนชื่อปุ่ม แล้วไปกดปุ่มอื่น (เช่น ค้นหา หรือปุ่มที่เขียนข้อมูล) — id ต้องเป็นปุ่ม export เท่านั้น
  if (linkId !== undefined && !/btnExport/i.test(linkId)) {
    throw new WebFormsError(`"${linkId}" ไม่ใช่ id ของปุ่ม export (ต้องมีคำว่า btnExport) — ไม่กด`);
  }

  // ⚠️ จับแบบ substring ไม่ใช่ exact — ชื่อ accessible ของลิงก์มี alt ของไอคอนนำหน้า
  // (รูปแบบเดียวกับ "PrintPrint version" ที่เห็นใน aria snapshot) การใช้ exact จึงหาไม่เจอ
  // แต่ยังยืนยันว่าเจอชิ้นเดียวอยู่ ไม่ได้ปล่อยให้เดา
  const link = linkId !== undefined ? page.locator(`[id="${linkId}"]`) : page.getByRole('link', { name: EXPORT_LINK_NAME });
  const count = await link.count();
  if (count !== 1) {
    throw new WebFormsError(
      `คาดว่าจะเจอลิงก์ export ${linkId !== undefined ? `#${linkId}` : `"${EXPORT_LINK_NAME}"`} ชิ้นเดียว แต่เจอ ${count} ชิ้นที่ ${page.url()}`,
    );
  }

  const startedAt = Date.now();
  const pending = page.waitForEvent('download', { timeout: timeoutMs });
  await link.click();

  let download;
  try {
    download = await pending;
  } catch {
    throw new WebFormsError(
      `กด export แล้วไม่มีไฟล์ส่งมาภายใน ${Math.round(timeoutMs / 1000)} วินาที (${page.url()})\n` +
        `  สาเหตุที่พบมาแล้ว: ช่วงวันที่กว้างเกินไปจน HotelTime เงียบไปเฉย ๆ โดยไม่มี error\n` +
        `  ทางแก้: ซอยช่วงให้เล็กลงแล้วลองใหม่`,
    );
  }

  await download.saveAs(destPath);
  return { suggestedFilename: download.suggestedFilename(), elapsedMs: Date.now() - startedAt };
}

/**
 * นับแถวในตารางผลลัพธ์ คืน null เมื่อไม่มีตารางนั้นอยู่บนหน้าเลย
 *
 * ใช้แยก "ค้นแล้วไม่เจออะไร" ออกจาก "ค้นแล้วเจอ" ซึ่งจำเป็นมาก เพราะ
 * 🔴 เมื่อผลลัพธ์ว่าง HotelTime จะ **ไม่ส่งไฟล์มาเลย** ทั้งที่ลิงก์ export ยังอยู่
 * (ทดสอบ 2026-09-08: ค้น created ม.ค. 2024 ซึ่งไม่มีข้อมูล แล้วกด export → เงียบ 45 วินาที)
 * ถ้าไม่เช็คก่อน ทุกเดือนที่ว่างจะเสียเวลาไปกับการรอ timeout
 */
export async function gridRowCount(page: Page, selector: string): Promise<number | null> {
  return page.evaluate((sel) => {
    const table = document.querySelector(sel);
    return table === null ? null : table.querySelectorAll('tr').length;
  }, selector);
}
