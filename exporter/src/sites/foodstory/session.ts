import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Config, Credentials } from './config.ts';
import { type CaptchaSolver, DEFAULT_SOLVE_ATTEMPTS, extractSitekey, selectLoginMode, solveWithRetry } from './captcha.ts';
import { captchaSolverFromConfig } from './two-captcha.ts';
import { installInFlightTracker, settlePageRequests } from './inflight.ts';
import { browserEnv } from '../../core/browser-env.ts';
import { TWOCAPTCHA_KEY_ENV } from '../../core/status.ts';

export class LoginError extends Error {
  override readonly name = 'LoginError';
}

export type Session = {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  /** เบราว์เซอร์ที่เปิดจริงไม่มีหน้าจอ — `login()` ใช้ตัดสินว่ามีคนแก้ captcha ได้ไหม (ค่าใน config อาจถูก `--headful` เปลี่ยนตอนเปิด session) */
  readonly headless: boolean;
  close(): Promise<void>;
};

export async function openSession(cfg: Config): Promise<Session> {
  const browser = await chromium.launch({
    env: browserEnv(), // ไม่ส่งความลับใน .env ให้ Chromium (core/browser-env.ts)
    headless: cfg.headless,
    // ซ่อนร่องรอย automation ราคาถูก ๆ กันหน้า login เช็ค navigator.webdriver แล้วปฏิเสธ token ที่ solve มา (ADR-0010)
    args: ['--disable-blink-features=AutomationControlled'],
    ...(cfg.slowMoMs > 0 ? { slowMo: cfg.slowMoMs } : {}),
  });

  const context = await browser.newContext({ viewport: cfg.viewport, acceptDownloads: true });
  context.setDefaultTimeout(cfg.timeoutMs);
  context.setDefaultNavigationTimeout(cfg.timeoutMs);
  // stealth เบา ๆ — คู่กับ arg ด้านบน · ตั้งใจใช้ browser config เดียวทั้งสองโหมด (story 12 scope ไว้แค่
  // auto-solve แต่ stealth ราคาถูกและไร้พิษกับ human-wait บน Mac จึงไม่แยก branch openSession)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['th-TH', 'th', 'en-US', 'en'] });
  });

  const page = await context.newPage();
  installInFlightTracker(page, new URL(cfg.baseUrl).host);

  return {
    browser,
    context,
    page,
    headless: cfg.headless,
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
// อ่าน sitekey จาก data-sitekey ก่อน — FoodStory ไม่มี attribute นี้ (เป็นแค่ fallback เผื่อ markup เปลี่ยน)
// ตั้งสั้น ๆ แล้วตกไปอ่าน anchor iframe แทน ไม่ต้องรอครบนานทุก login
const SITEKEY_ATTR_TIMEOUT_MS = 2_000;
// anchor iframe ของ reCAPTCHA คือที่มา sitekey จริงของ FoodStory — ให้เวลาโหลดนานกว่า attribute
const ANCHOR_IFRAME_TIMEOUT_MS = 15_000;
// รอปุ่ม "เข้าสู่ระบบ" เลิก disabled หลังยัด token (reCAPTCHA ปลดล็อกปุ่มเมื่อมี response)
const SUBMIT_BUTTON_ENABLE_TIMEOUT_MS = 30_000;

/** สิ่งที่ฉีดเข้า `login()` ได้ — ตอนนี้มีแค่ตัวแก้ reCAPTCHA (ไม่ส่ง = หาจาก config เอง) */
export type LoginDeps = {
  /** บริการแก้ reCAPTCHA — มีเมื่อ `TWOCAPTCHA_API_KEY` ถูกตั้ง (ไม่ส่ง deps เลย = สร้างจาก config) */
  readonly solver?: CaptchaSolver;
};

/**
 * ล็อกอินเข้า FoodStory
 *
 * หน้า login ฝัง reCAPTCHA ไว้ตั้งแต่โหลดมาเลย (ยืนยันแล้วทั้ง headless และ headful ให้ผลเหมือนกัน
 * จึงไม่ใช่แค่ fingerprint ของ headless) · มีสามเส้นทางตามการมี solver + เบราว์เซอร์มีหน้าจอไหม (ADR-0010):
 *   - **auto-solve** (มี `TWOCAPTCHA_API_KEY`): แก้ reCAPTCHA อัตโนมัติผ่าน 2captcha — ให้ production
 *     บน Ubuntu ที่ไม่มีคนเฝ้ารันเองได้ · solve ล้มครบ → `LoginError` (รอบรายวันแจ้ง Discord)
 *   - **human-wait** (ไม่มีคีย์): กรอกอีเมล/รหัสผ่านไว้ล่วงหน้าให้ แล้ว "รอ" ให้คนแก้ captcha +
 *     กด submit เอง — ใช้ตอนพัฒนาบน Mac แบบ headful
 *   - **cannot-solve** (ไม่มีคีย์ + headless — exporter-foodstory-scheduled-daily ใบ 03): ไม่มีใครเห็นหน้าจอ → `LoginError` ทันที
 *     ก่อนเปิดหน้าเว็บ แทนการรอคน 5 นาทีแล้วค่อยล้ม
 *
 * ไม่ส่ง `deps` = หา solver จาก config (ดู `captchaSolverFromConfig`) · ส่ง `deps` เอง = คุมเต็มที่
 *
 * เซสชันที่ได้ใช้ได้แค่ใน process นี้เท่านั้น — พิสูจน์แล้วว่า storageState ที่ capture ไว้ใช้ซ้ำข้าม
 * process ไม่ได้ เซิร์ฟเวอร์ปฏิเสธด้วย 302 แม้ cookie ยังไม่หมดอายุ จึงต้อง login ใหม่ทุกครั้งที่ต้องการรัน
 * (การเลี้ยง session ให้ไม่หมดอายุเพื่อลดการแก้ captcha เป็นงานแยก — ดู spec captcha-solver §Out of Scope)
 */
export async function login(
  session: Session,
  cfg: Config,
  creds: Credentials,
  deps?: LoginDeps,
): Promise<void> {
  const { page } = session;
  const resolved: LoginDeps = deps ?? { solver: captchaSolverFromConfig(cfg) };
  const { solver } = resolved;
  const mode = selectLoginMode({ hasSolver: solver != null, headless: session.headless });
  if (mode === 'cannot-solve') {
    throw new LoginError(
      `ไม่มีคีย์ 2captcha (${TWOCAPTCHA_KEY_ENV}) และเบราว์เซอร์ไม่มีหน้าจอ (headless) — ไม่มีใครแก้ reCAPTCHA ได้ · ` +
        `ตั้ง ${TWOCAPTCHA_KEY_ENV} ใน exporter/.env หรือรันใหม่ด้วย --headful แล้วแก้ captcha เอง`,
    );
  }

  await page.goto(cfg.baseUrl);
  await fillCredentials(page, creds);

  // `&& solver` คงไว้เพื่อให้ TS narrow เป็น non-null — mode มาจาก `solver != null` อยู่แล้ว
  if (mode === 'auto-solve' && solver) {
    await solveCaptchaAndSubmit(page, solver, cfg.timeoutMs);
  } else if (mode === 'human-wait') {
    await waitForHumanToPassLogin(page);
  } else {
    // cannot-solve โยนไปแล้วก่อนเปิดหน้าเว็บ — มาถึงตรงนี้ = มีเส้นทางใหม่ที่ยังไม่ได้จัดการ: ล้มดัง ๆ ไม่ตกไปรอคน 5 นาทีเงียบ ๆ (code review ใบ 03)
    throw new LoginError(`เส้นทาง login ที่ยังไม่ได้จัดการ: ${mode}`);
  }

  await waitForUrlToSettle(page);
  // หน้า landing (/th/summary) ยิง POST /summary/get-* ที่พกช่วงวันที่เดิมของ session — ต้องรอให้
  // จบฝั่ง server ก่อน ไม่งั้นมันเขียน session ทับช่วงวันที่ที่ caller จะตั้งต่อ ดู inflight.ts
  await settlePageRequests(page, LANDING_SETTLE_TIMEOUT_MS);
}

async function fillCredentials(page: Page, creds: Credentials): Promise<void> {
  await page.fill('input[name="email"]', creds.email);
  await page.fill(PASSWORD_FIELD_SELECTOR, creds.password);
}

/**
 * เส้นทาง auto-solve (ADR-0010): อ่าน sitekey จากหน้า → ให้ 2captcha แก้ (retry) → ยัด token → กดเข้าสู่ระบบ
 * ความล้มเหลวของการแก้ captcha ถูกแปลงเป็น `LoginError` ที่ขอบนี้ (orchestrator บริสุทธิ์โยน `CaptchaError`)
 */
async function solveCaptchaAndSubmit(page: Page, solver: CaptchaSolver, timeoutMs: number): Promise<void> {
  const sitekey = extractSitekey({
    // FoodStory ไม่มี data-sitekey → timeout สั้นแล้วตกไปอ่าน src ของ anchor iframe (ดู captcha.ts)
    dataSitekeyAttr: await page
      .locator('[data-sitekey]')
      .first()
      .getAttribute('data-sitekey', { timeout: SITEKEY_ATTR_TIMEOUT_MS })
      .catch(() => null),
    anchorSrc: await page
      .locator('iframe[src*="api2/anchor"]')
      .first()
      .getAttribute('src', { timeout: ANCHOR_IFRAME_TIMEOUT_MS })
      .catch(() => null),
  });

  let token: string;
  try {
    token = await solveWithRetry(
      () => solver.solve({ sitekey, pageurl: page.url() }),
      { attempts: DEFAULT_SOLVE_ATTEMPTS },
    );
  } catch (err) {
    throw new LoginError(`แก้ reCAPTCHA อัตโนมัติไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
  }

  await injectRecaptchaToken(page, token);
  await submitLoginForm(page);
  await waitForPasswordGone(page, timeoutMs);
}

/** ยัด token ที่ solve ได้ลง `#g-recaptcha-response` + เรียก callback ที่ reCAPTCHA ลงทะเบียนไว้ */
async function injectRecaptchaToken(page: Page, token: string): Promise<void> {
  // tsx/esbuild แทรก helper `__name` ให้ฟังก์ชันมีชื่อ แต่ browser ไม่มี → ใส่ shim ก่อน evaluate
  // ไม่งั้นเจอ `ReferenceError: __name is not defined` ฝั่ง browser (gotcha จากตัวอย่าง 03)
  await page.evaluate(() => {
    const w = window as unknown as { __name?: (f: unknown) => unknown };
    if (!w.__name) w.__name = (f) => f;
  });

  await page.evaluate((tok) => {
    const set = (el: HTMLTextAreaElement) => {
      el.value = tok;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document
      .querySelectorAll<HTMLTextAreaElement>('textarea#g-recaptcha-response, textarea[name="g-recaptcha-response"]')
      .forEach((el) => {
        el.style.display = 'block';
        set(el);
      });

    const grecaptchaCfg = (
      window as unknown as { ___grecaptcha_cfg?: { clients?: Record<string, unknown> } }
    ).___grecaptcha_cfg;
    const clients = grecaptchaCfg?.clients ?? {};
    const walk = (obj: unknown) => {
      if (!obj || typeof obj !== 'object') return;
      for (const v of Object.values(obj as Record<string, unknown>)) {
        if (v && typeof v === 'object') {
          const candidate = v as Record<string, unknown>;
          if (typeof candidate.callback === 'function') {
            try {
              (candidate.callback as (t: string) => void)(tok);
            } catch {
              /* ไม่สนใจ callback ที่โยน */
            }
          }
          walk(v);
        }
      }
    };
    for (const client of Object.values(clients)) walk(client);
  }, token);
}

/** กดปุ่ม "เข้าสู่ระบบ" — รอให้ปุ่มเลิก disabled (reCAPTCHA มี token แล้ว) ก่อน */
async function submitLoginForm(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'เข้าสู่ระบบ');
        return btn != null && !(btn as HTMLButtonElement).disabled;
      },
      { timeout: SUBMIT_BUTTON_ENABLE_TIMEOUT_MS },
    )
    .catch(() => undefined);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
}

/** รอให้คนแก้ reCAPTCHA + กด submit เองจนฟอร์มรหัสผ่านหายไป (เส้นทาง human-wait) */
async function waitForHumanToPassLogin(page: Page): Promise<void> {
  console.log(
    'เปิดเบราว์เซอร์แล้ว — กรอกอีเมล/รหัสผ่านไว้ให้ล่วงหน้า เหลือแค่แก้ reCAPTCHA แล้วกด\n' +
      `เข้าสู่ระบบเอง — จะรอจนล็อกอินสำเร็จ (สูงสุด ${LOGIN_WAIT_TIMEOUT_MS / 1000} วินาที)`,
  );
  await waitForPasswordGone(page, LOGIN_WAIT_TIMEOUT_MS);
}

/** รอจนช่องรหัสผ่านหายไป (= ผ่าน login) ภายใน `timeoutMs` ไม่งั้นโยน `LoginError` */
async function waitForPasswordGone(page: Page, timeoutMs: number): Promise<void> {
  const deadlineAt = Date.now() + timeoutMs;
  for (;;) {
    const stillOnLoginForm = (await page.locator(PASSWORD_FIELD_SELECTOR).count()) > 0;
    if (!stillOnLoginForm) break;

    if (Date.now() >= deadlineAt) {
      throw new LoginError(
        `ล็อกอินไม่สำเร็จภายใน ${Math.round(timeoutMs / 1000)} วินาที (ยังเจอช่องรหัสผ่านอยู่ที่ ${page.url()})`,
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
