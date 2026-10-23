import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Config, Credentials } from './config.ts';
import { type CaptchaSolver, selectLoginMode } from './captcha.ts';
import { installInFlightTracker, settlePageRequests } from './inflight.ts';
import { browserEnv } from '../../core/browser-env.ts';

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
    env: browserEnv(), // ไม่ส่งความลับใน .env ให้ Chromium (core/browser-env.ts)
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

/** สิ่งที่ฉีดเข้า `login()` ได้ — ตอนนี้มีแค่ตัวแก้ reCAPTCHA (ไม่ส่ง = รอคนกดเอง) */
export type LoginDeps = {
  /** บริการแก้ reCAPTCHA — มีเมื่อ `TWOCAPTCHA_API_KEY` ถูกตั้ง (ต่อจริงใน ticket 02) */
  readonly solver?: CaptchaSolver;
};

/**
 * ล็อกอินเข้า FoodStory
 *
 * หน้า login ฝัง reCAPTCHA ไว้ตั้งแต่โหลดมาเลย (ยืนยันแล้วทั้ง headless และ headful ให้ผลเหมือนกัน
 * จึงไม่ใช่แค่ fingerprint ของ headless) · มีสองเส้นทางตามการมี solver (ADR-0010):
 *   - **auto-solve** (มี `deps.solver` = ตั้ง `TWOCAPTCHA_API_KEY` ไว้): แก้ reCAPTCHA อัตโนมัติ
 *     ผ่าน 2captcha — ให้ production บน Ubuntu ที่ไม่มีคนเฝ้ารันเองได้ (ต่อจริงใน ticket 02)
 *   - **human-wait** (ไม่มี solver): กรอกอีเมล/รหัสผ่านไว้ล่วงหน้าให้ แล้ว "รอ" ให้คนแก้ captcha +
 *     กด submit เอง — ใช้ตอนพัฒนาบน Mac แบบ headful
 *
 * เซสชันที่ได้ใช้ได้แค่ใน process นี้เท่านั้น — พิสูจน์แล้วว่า storageState ที่ capture ไว้ใช้ซ้ำข้าม
 * process ไม่ได้ เซิร์ฟเวอร์ปฏิเสธด้วย 302 แม้ cookie ยังไม่หมดอายุ จึงต้อง login ใหม่ทุกครั้งที่ต้องการรัน
 * (การเลี้ยง session ให้ไม่หมดอายุเพื่อลดการแก้ captcha เป็นงานแยก — ดู spec captcha-solver §Out of Scope)
 */
export async function login(
  session: Session,
  cfg: Config,
  creds: Credentials,
  deps: LoginDeps = {},
): Promise<void> {
  const { page } = session;
  const mode = selectLoginMode({ hasSolver: deps.solver != null });

  await page.goto(cfg.baseUrl);
  await fillCredentials(page, creds);

  if (mode === 'auto-solve') {
    // ticket 02: แก้ reCAPTCHA ด้วย deps.solver (extractSitekey → solveWithRetry → ยัด token → submit)
    // แล้วค่อยรอ URL นิ่ง · ยังไม่ถูกต่อในใบ 01 และไม่มี caller ไหนส่ง solver มา จึงยังไม่มีทางเข้าถึง
    throw new LoginError(
      'FoodStory auto-solve (2captcha) ยังไม่ถูกต่อ — ดู ticket 02 ของ exporter-foodstory-captcha-solver',
    );
  }

  await waitForHumanToPassLogin(page);
  await waitForUrlToSettle(page);
  // หน้า landing (/th/summary) ยิง POST /summary/get-* ที่พกช่วงวันที่เดิมของ session — ต้องรอให้
  // จบฝั่ง server ก่อน ไม่งั้นมันเขียน session ทับช่วงวันที่ที่ caller จะตั้งต่อ ดู inflight.ts
  await settlePageRequests(page, LANDING_SETTLE_TIMEOUT_MS);
}

async function fillCredentials(page: Page, creds: Credentials): Promise<void> {
  await page.fill('input[name="email"]', creds.email);
  await page.fill(PASSWORD_FIELD_SELECTOR, creds.password);
}

/** รอให้คนแก้ reCAPTCHA + กด submit เองจนฟอร์มรหัสผ่านหายไป (เส้นทาง human-wait) */
async function waitForHumanToPassLogin(page: Page): Promise<void> {
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
}

async function waitForUrlToSettle(page: Page): Promise<void> {
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
