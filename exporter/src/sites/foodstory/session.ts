import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Config, Credentials } from './config.ts';
import { installInFlightTracker, settlePageRequests } from './inflight.ts';

export class LoginError extends Error {
  override readonly name = 'LoginError';
}

export type Session = {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  close(): Promise<void>;
};

export async function openSession(cfg: Config): Promise<Session> {
  const browser = await chromium.launch({
    headless: cfg.headless,
    ...(cfg.slowMoMs > 0 ? { slowMo: cfg.slowMoMs } : {}),
  });

  const context = await browser.newContext({ viewport: cfg.viewport, acceptDownloads: true });
  context.setDefaultTimeout(cfg.timeoutMs);
  context.setDefaultNavigationTimeout(cfg.timeoutMs);

  const page = await context.newPage();
  installInFlightTracker(page, new URL(cfg.baseUrl).host);

  return {
    browser,
    context,
    page,
    async close() {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

const PASSWORD_FIELD_SELECTOR = 'input[name="password"]';
const LOGIN_POLL_INTERVAL_MS = 2_000;
// ยืนขึ้นกับเวลาที่คนจริงใช้แก้ reCAPTCHA — ยาวกว่า cfg.timeoutMs (ไทม์เอาต์ของ action ปกติ)
// โดยเจตนา ไม่ใช่ตัวเลขที่ปรับตามการตั้งค่าเว็บ
const LOGIN_WAIT_TIMEOUT_MS = 5 * 60_000;
// เพดานรอ request ของหน้า landing (/th/summary) ให้จบ — สเปกต้นทาง §4.4 วัดว่าหน้านี้โหลดได้ถึง 40 วิ
const LANDING_SETTLE_TIMEOUT_MS = 90_000;

/**
 * ล็อกอินเข้า FoodStory
 *
 * 🔴 ต้องมีคนอยู่หน้าจอเสมอ — หน้า login ฝัง reCAPTCHA ไว้ตั้งแต่โหลดมาเลย (ยืนยันแล้วทั้ง
 * headless และ headful ให้ผลเหมือนกัน จึงไม่ใช่แค่ fingerprint ของ headless — ดู ticket 02
 * §Comments) ฟังก์ชันนี้กรอกอีเมล/รหัสผ่านไว้ล่วงหน้าให้ แล้ว "รอ" ให้คนแก้ captcha + กด
 * submit เอง — ไม่พยายามหลีกเลี่ยง/แก้ captcha อัตโนมัติเด็ดขาด (ตัดสินใจแล้วว่าไม่ทำ เพราะ
 * เป็นการหลบเลี่ยงระบบป้องกันบอทโดยตรง)
 *
 * เซสชันที่ได้ใช้ได้แค่ใน process นี้เท่านั้น — พิสูจน์แล้ว (ticket 02 §Comments) ว่า
 * storageState ที่ capture ไว้ใช้ซ้ำข้าม process ไม่ได้ เซิร์ฟเวอร์ปฏิเสธด้วย 302 แม้ cookie
 * ยังไม่หมดอายุ จึงต้อง login ใหม่ทุกครั้งที่ต้องการรัน โดยมีคนช่วยแก้ captcha
 */
export async function login(session: Session, cfg: Config, creds: Credentials): Promise<void> {
  const { page } = session;
  await submitAndWaitForLanding(page, cfg, creds);
  // หน้า landing (/th/summary) ยิง POST /summary/get-* ที่พกช่วงวันที่เดิมของ session — ต้องรอให้
  // จบฝั่ง server ก่อน ไม่งั้นมันเขียน session ทับช่วงวันที่ที่ caller จะตั้งต่อ ดู inflight.ts
  await settlePageRequests(page, LANDING_SETTLE_TIMEOUT_MS);
}

async function submitAndWaitForLanding(page: Page, cfg: Config, creds: Credentials): Promise<void> {
  await page.goto(cfg.baseUrl);
  await page.fill('input[name="email"]', creds.email);
  await page.fill(PASSWORD_FIELD_SELECTOR, creds.password);

  console.log(
    'เปิดเบราว์เซอร์แล้ว — กรอกอีเมล/รหัสผ่านไว้ให้ล่วงหน้า เหลือแค่แก้ reCAPTCHA แล้วกด\n' +
      `เข้าสู่ระบบเอง — จะรอจนล็อกอินสำเร็จ (สูงสุด ${LOGIN_WAIT_TIMEOUT_MS / 1000} วินาที)`,
  );

  const deadlineAt = Date.now() + LOGIN_WAIT_TIMEOUT_MS;
  for (;;) {
    const stillOnLoginForm = (await page.locator(PASSWORD_FIELD_SELECTOR).count()) > 0;
    if (!stillOnLoginForm) break;

    if (Date.now() >= deadlineAt) {
      throw new LoginError(
        `ล็อกอินไม่สำเร็จภายใน ${LOGIN_WAIT_TIMEOUT_MS / 1000} วินาที ` +
          `(ยังเจอช่องรหัสผ่านอยู่ที่ ${page.url()})`,
      );
    }
    await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
  }

  // 🔴 พังจริง 2026-09-23: ทันทีที่ช่องรหัสผ่านหายไป แอปยังไม่ได้ redirect ถึงปลายทางสุดท้าย
  // (ไป `/` ก่อนแล้ว JS ฝั่ง client ค่อย redirect ต่อไป `/th/summary`) การ goto() ต่อทันที
  // ชนกับ navigation ที่ยังค้างอยู่ ("interrupted by another navigation") — รอจน URL นิ่ง
  // ก่อนคืนการควบคุมให้ caller แทนที่จะเชื่อแค่ 'load' event เดียว (SPA push-state ไม่ยิง
  // 'load' ซ้ำ)
  let lastUrl = page.url();
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(500);
    const currentUrl = page.url();
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
  }
}
