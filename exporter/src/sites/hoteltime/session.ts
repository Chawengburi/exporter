import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Redactor } from '../../core/redact.ts';
import type { Config, Credentials } from './config.ts';
import { describePage, isLoginPage, uniqueByRole } from './webforms.ts';

export class LoginError extends Error {
  override readonly name = 'LoginError';
  readonly capturePath: string | undefined;

  constructor(message: string, capturePath?: string) {
    super(message);
    this.capturePath = capturePath;
  }
}

export type Session = {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  close(): Promise<void>;
};

export type CookieInfo = {
  readonly name: string;
  /** true = cookie หายเมื่อปิดเบราว์เซอร์ (Playwright คืน expires เป็น -1) */
  readonly isSessionCookie: boolean;
  /** ISO string ถ้ามีวันหมดอายุ, null ถ้าเป็น session cookie */
  readonly expiresAt: string | null;
  readonly httpOnly: boolean;
  readonly secure: boolean;
};

export type LoginResult = {
  readonly finalUrl: string;
  readonly title: string;
  readonly elapsedMs: number;
  readonly cookies: readonly CookieInfo[];
};

/**
 * เปิดเบราว์เซอร์ใหม่หนึ่งตัว
 *
 * 🔴 ไม่ใช้ persistent profile / storageState โดยเจตนา — HotelTime เก็บ session
 * ไว้ฝั่ง server (ASP.NET) ซึ่งหมดอายุเองแม้ cookie ฝั่งเราจะยังอยู่ การเก็บโปรไฟล์ไว้
 * จึงให้ความรู้สึกปลอมว่า "ล็อกอินค้างไว้แล้ว" แล้วไปพังตอนกด export
 * runner ล็อกอินใหม่ทุกรอบแทน ซึ่งทำได้เพราะไม่มี 2FA
 */
export async function openSession(cfg: Config): Promise<Session> {
  const browser = await chromium.launch({
    headless: cfg.headless,
    ...(cfg.slowMoMs > 0 ? { slowMo: cfg.slowMoMs } : {}),
  });

  const context = await browser.newContext({ acceptDownloads: true });
  context.setDefaultTimeout(cfg.timeoutMs);
  context.setDefaultNavigationTimeout(cfg.timeoutMs);

  const page = await context.newPage();

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

async function capture(session: Session, cfg: Config, label: string): Promise<string | undefined> {
  try {
    await mkdir(cfg.captureDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(cfg.captureDir, `${label}-${stamp}.png`);
    await session.page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return undefined;
  }
}

/**
 * ล็อกอินเข้า HotelTime
 *
 * ฟอร์ม login เป็น ASP.NET repeater (control จริงชื่อ `rptLastUsers$ctl00$tbUserName`)
 * จึงหาด้วย role + accessible name แทน id เพราะเลข index ใน id เลื่อนได้
 * เมื่อจำนวน "last used user" เปลี่ยน — ดู uniqueByRole() ใน webforms.ts
 */
export async function login(
  session: Session,
  cfg: Config,
  creds: Credentials,
  redact: Redactor,
): Promise<LoginResult> {
  const { page } = session;
  const startedAt = Date.now();

  await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded' });

  if (!isLoginPage(page.url())) {
    throw new LoginError(
      `คาดว่าจะได้หน้า login แต่ถูกพาไป ${page.url()}\n` +
        `  ตรวจ HOTELTIME_BASE_URL / HOTELTIME_LOGIN_PATH ใน .env ว่าชี้ถูก shard หรือเปล่า`,
    );
  }

  const userBox = await uniqueByRole(page, 'textbox', 'Login', redact);
  const passBox = await uniqueByRole(page, 'textbox', 'Password', redact);
  const submit = await uniqueByRole(page, 'button', 'Submit', redact);

  await userBox.fill(creds.username);
  await passBox.fill(creds.password);

  await submit.click();

  try {
    // ล็อกอินสำเร็จ = หลุดออกจาก login.aspx ไปหน้าอื่น
    // ล็อกอินไม่สำเร็จ = WebForms post กลับมาที่ login.aspx เหมือนเดิม → ตรงนี้จะ timeout
    // 🔴 waitUntil 'commit' — แค่ URL เปลี่ยนก็พอ ไม่ต้องรอหน้าใหม่โหลดจบ · พังจริง 2026-10-07: Welcomepage
    // โหลดช้าเกิน timeout ทั้งที่ล็อกอินผ่านแล้ว (URL เป็น Welcomepage.aspx เมนูครบ) แต่ถูกรายงานว่า "ล็อกอินไม่สำเร็จ"
    await page.waitForURL((url) => !isLoginPage(url.href), { timeout: cfg.timeoutMs, waitUntil: 'commit' });
  } catch {
    // เช็คซ้ำจาก URL จริงก่อนตัดสินว่าล้ม — ต้องเป็นหน้าของ HotelTime เองที่ไม่ใช่ login (ไม่ใช่แค่ "ไม่ใช่ login" —
    // chrome-error:// ตอนเน็ตหลุด หรือหน้าอื่นนอกโดเมน ต้องยังนับว่าล้ม)
    if (isSignedInUrl(page.url(), cfg.baseUrl)) return loginResult(session, startedAt);
    const capturePath = await capture(session, cfg, 'login-failed');
    throw new LoginError(
      `ล็อกอินไม่สำเร็จ — ยังอยู่ที่หน้า login หลังกด Submit (${page.url()})\n` +
        `  สาเหตุที่เป็นไปได้: รหัสผิด / บัญชีถูกล็อก / หน้าเว็บเปลี่ยน\n` +
        `  โครงหน้าเว็บตอนนี้:\n${await describePage(page, redact)}` +
        (capturePath ? `\n  screenshot: ${capturePath}` : ''),
      capturePath,
    );
  }

  return loginResult(session, startedAt);
}

/** URL หลังล็อกอินสำเร็จ: http(s) บน host เดียวกับ HOTELTIME_BASE_URL และไม่ใช่หน้า login */
export function isSignedInUrl(url: string, baseUrl: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.host === new URL(baseUrl).host && !isLoginPage(url);
  } catch {
    return false;
  }
}

async function loginResult(session: Session, startedAt: number): Promise<LoginResult> {
  const { page } = session;
  // หน้าหลังล็อกอินโหลดช้าไม่ใช่ความล้มเหลวของการล็อกอิน — ขั้นถัดไป (goto หน้ารายงาน) รอโหลดเองอยู่แล้ว
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);

  const cookies = await session.context.cookies();

  return {
    finalUrl: page.url(),
    title: await page.title(),
    elapsedMs: Date.now() - startedAt,
    cookies: cookies.map((c) => ({
      name: c.name,
      isSessionCookie: c.expires === -1,
      expiresAt: c.expires === -1 ? null : new Date(c.expires * 1000).toISOString(),
      httpOnly: c.httpOnly,
      secure: c.secure,
    })),
  };
}
