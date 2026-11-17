// ทดลองเฉพาะกิจ: ลดจำนวนครั้งที่ต้องกด captcha ของ FoodStory — ใช้ captcha สดรอบเดียวตอบหลายคำถาม
//
//   node recon/foodstory-session-experiment.ts run            # headful · คนกด captcha เอง · ตอบ A–D ในรอบเดียว
//   node recon/foodstory-session-experiment.ts check [หมายเหตุ]  # headless · เปิด profile ทดลองเดิม เช็คว่ายังอยู่ในระบบไหม (ไม่ต้อง captcha)
//
// ไม่แก้/หลบ captcha — คนกดเอง (session.ts:57) · ทุกอย่างหลัง login อ่านอย่างเดียว (GET) · ไม่เก็บค่า cookie ลงไฟล์ผล
//
// คำถามที่ตอบในรอบ `run`:
//   A. หน้า login มี checkbox "จดจำฉัน" ไหม (เจ้าของยืนยันว่าไม่มี — บันทึก input ทั้งหมดไว้เป็นหลักฐาน)
//   B. storageState + UA ปกติ (ไม่ใช่ HeadlessChrome) replay ใน headless ได้ไหม — ถ้าได้ คนล็อกอินที่ Mac แล้วส่งไฟล์ไป Ubuntu ได้
//      (ticket 02 โดน 302 แต่ตอนนั้นใช้ UA "HeadlessChrome" — ยังไม่เคยแยกสาเหตุ) · ข้อนี้ทดสอบจาก IP เดียวกันเท่านั้น
//   C. persistent profile เปิดใหม่ใน headless ยังอยู่ในระบบไหม (ticket 12 เคยยืนยันแล้ว — ใช้เป็นตัวควบคุม)
//   D. เมนู/หน้า settings ของ FoodStory มีรายงานส่งอีเมล / export ตั้งเวลา / API / integration ไหม (อ่านอย่างเดียว)
//
// แต่ละข้อห่อ try/catch แยก — ข้อหนึ่งพังไม่ทำให้เสียรอบ captcha (memory: feedback_minimize_live_captcha_rounds)
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { browserEnv } from '../src/core/browser-env.ts';
import { PROJECT_ROOT, loadConfig, loadCredentials } from '../src/sites/foodstory/config.ts';
import { installInFlightTracker } from '../src/sites/foodstory/inflight.ts';
import { login } from '../src/sites/foodstory/session.ts';

const cfg = loadConfig();
const PROFILE_DIR = path.join(PROJECT_ROOT, '.auth', 'foodstory-profile-exp');
const RESULT_LOG = path.join(PROJECT_ROOT, 'recon', 'foodstory-session-experiment.jsonl');
const PROBE_PATH = '/th/salebysumdate'; // หน้าอ่านอย่างเดียวที่ ticket 12 ใช้เช็ค
const HOST = new URL(cfg.baseUrl).host;

const SETTINGS_KEYWORDS = /อีเมล|email|mail|ตั้งเวลา|กำหนดเวลา|schedule|auto|อัตโนมัติ|แจ้งเตือน|notif|line|api|token|integration|เชื่อมต่อ|webhook|ตั้งค่า|setting/i;
const NEVER_VISIT = /logout|signout|sign-out|ออกจากระบบ|delete|remove|ลบ|destroy/i;
const MAX_SETTINGS_PAGES = 14;

type Step = { readonly step: string; readonly ok: boolean; readonly detail: unknown };
const steps: Step[] = [];

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const detail = await fn();
    steps.push({ step: name, ok: true, detail });
    console.log(`✔ ${name}`, JSON.stringify(detail));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push({ step: name, ok: false, detail: message });
    console.log(`✘ ${name}: ${message}`);
  }
}

/** อยู่ในระบบ = เปิดหน้าอ่านอย่างเดียวแล้วไม่ถูกส่งกลับหน้า login (`/`) และไม่มีช่องรหัสผ่าน */
async function stillLoggedIn(page: Page): Promise<{ loggedIn: boolean; finalPath: string }> {
  await page.goto(`${cfg.baseUrl}${PROBE_PATH}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3_000);
  const finalPath = new URL(page.url()).pathname;
  const hasPassword = (await page.locator('input[name="password"]').count()) > 0;
  return { loggedIn: finalPath !== '/' && !hasPassword, finalPath };
}

async function cookieMeta(context: BrowserContext): Promise<unknown> {
  const cookies = await context.cookies();
  return cookies.map((c) => ({
    name: c.name,
    domain: c.domain,
    expiresUtc: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : 'session',
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
  }));
}

function appendLog(entry: Record<string, unknown>): void {
  appendFileSync(RESULT_LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

async function runCheck(note: string): Promise<void> {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    env: browserEnv(),
    headless: true,
    viewport: cfg.viewport,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const result = await stillLoggedIn(page);
    appendLog({ mode: 'check', note, ...result });
    console.log(result.loggedIn ? `✔ ยังอยู่ในระบบ (${note})` : `✘ หลุดแล้ว (${note}) → ${result.finalPath}`);
  } finally {
    await context.close();
  }
}

async function inspectLoginForm(page: Page): Promise<unknown> {
  // ดูก่อน login: เปิดหน้าแรกแล้วอ่าน input/label ทั้งหมด (ไม่แตะ captcha)
  await page.goto(cfg.baseUrl);
  const inputs = await page.$$eval('input', (els) =>
    els.map((e) => ({
      type: e.getAttribute('type'),
      name: e.getAttribute('name'),
      id: e.getAttribute('id'),
      checked: e.checked,
    })),
  );
  const hasRememberLike = inputs.some((i) => i.type === 'checkbox') ||
    inputs.some((i) => /remember|จำ/i.test(`${i.name ?? ''}${i.id ?? ''}`));
  return { inputs, hasRememberLike };
}

async function replayStorageState(
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
  userAgent: string,
): Promise<unknown> {
  const browser = await chromium.launch({ env: browserEnv(), headless: true });
  try {
    const context = await browser.newContext({ storageState, userAgent, viewport: cfg.viewport });
    const page = await context.newPage();
    return { userAgent, ...(await stillLoggedIn(page)) };
  } finally {
    await browser.close();
  }
}

async function recon(page: Page, outDir: string): Promise<unknown> {
  await page.goto(`${cfg.baseUrl}/th/summary`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5_000);

  const links = await page.$$eval('a[href]', (els) =>
    els.map((a) => ({ text: (a.textContent ?? '').replace(/\s+/g, ' ').trim(), href: (a as HTMLAnchorElement).href })),
  );
  const sameHost = links.filter((l) => {
    try {
      return new URL(l.href).host === HOST;
    } catch {
      return false;
    }
  });
  const unique = [...new Map(sameHost.map((l) => [l.href, l])).values()];
  writeFileSync(path.join(outDir, 'nav-links.json'), JSON.stringify(unique, null, 2));

  const candidates = unique
    .filter((l) => SETTINGS_KEYWORDS.test(`${l.text} ${l.href}`) && !NEVER_VISIT.test(`${l.text} ${l.href}`))
    .slice(0, MAX_SETTINGS_PAGES);

  const visited: Array<{ text: string; href: string; finalUrl: string; file: string }> = [];
  for (const [i, c] of candidates.entries()) {
    try {
      await page.goto(c.href, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3_000);
      const file = `settings-${String(i).padStart(2, '0')}-aria.yml`;
      writeFileSync(path.join(outDir, file), await page.locator('body').ariaSnapshot());
      visited.push({ text: c.text, href: c.href, finalUrl: page.url(), file });
    } catch (err) {
      visited.push({ text: c.text, href: c.href, finalUrl: 'ERR', file: err instanceof Error ? err.message : String(err) });
    }
  }
  return { totalLinks: unique.length, candidates: candidates.length, visited };
}

async function runFull(): Promise<void> {
  const outDir = path.join(PROJECT_ROOT, 'recon', 'captures', `foodstory-exp-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    env: browserEnv(),
    headless: false,
    viewport: cfg.viewport,
    acceptDownloads: true,
  });
  context.setDefaultTimeout(cfg.timeoutMs);
  context.setDefaultNavigationTimeout(cfg.timeoutMs);
  const page = context.pages()[0] ?? (await context.newPage());
  installInFlightTracker(page, HOST);

  try {
    await step('A. หน้า login: input ทั้งหมด / มี checkbox จดจำฉันไหม', () => inspectLoginForm(page));

    // login() ใช้แค่ session.page — persistent context ไม่มี Browser object (context.browser() เป็น null)
    const session = { browser: null as unknown as Browser, context, page, close: async () => {} };
    await login(session, cfg, loadCredentials());
    console.log('login สำเร็จ — เริ่มตรวจต่อ (ไม่ต้องกดอะไรอีก)');

    const ua = await page.evaluate(() => navigator.userAgent);
    await step('cookie หลัง login (ไม่มีค่า)', () => cookieMeta(context));
    const storageState = await context.storageState();

    await step('D. recon เมนู/หน้า settings (อ่านอย่างเดียว)', () => recon(page, outDir));

    await step('B. storageState + UA ปกติ replay ใน headless (browser ใหม่)', () => replayStorageState(storageState, ua));

    // ปิด persistent context ก่อนเปิดใหม่ — ถ้าไม่ปิด profile ถูกล็อก
    await context.close();
    const reopened = await chromium.launchPersistentContext(PROFILE_DIR, { env: browserEnv(), headless: true, viewport: cfg.viewport });
    try {
      const p = reopened.pages()[0] ?? (await reopened.newPage());
      await step('C. persistent profile เปิดใหม่ headless (ตัวควบคุม)', () => stillLoggedIn(p));
    } finally {
      await reopened.close();
    }
  } finally {
    await context.close().catch(() => undefined);
    writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(steps, null, 2));
    appendLog({ mode: 'run', outDir: path.relative(PROJECT_ROOT, outDir), steps });
    console.log(`\nผลทั้งหมด: ${path.relative(PROJECT_ROOT, outDir)}/results.json`);
    console.log('เช็คต่อไม่ต้อง captcha: node recon/foodstory-session-experiment.ts check "+N ชม."');
  }
}

const STATE_FILE = path.join(PROJECT_ROOT, '.auth', 'foodstory-state.json');

/** Mac: เปิด profile ทดลอง (headless) → เช็คว่ายังอยู่ในระบบ → เขียน storageState ลงไฟล์ (สิทธิ์ 600) เพื่อส่งไปเครื่องอื่น */
async function runExportState(): Promise<void> {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { env: browserEnv(), headless: true, viewport: cfg.viewport });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const result = await stillLoggedIn(page);
    if (!result.loggedIn) throw new Error(`profile หลุดแล้ว (${result.finalPath}) — ต้องรัน run + กด captcha ใหม่ก่อน`);
    writeFileSync(STATE_FILE, JSON.stringify(await context.storageState()), { mode: 0o600 });
    console.log(`✔ เขียน ${path.relative(PROJECT_ROOT, STATE_FILE)} แล้ว (ไฟล์นี้เทียบเท่ารหัสผ่าน — ห้าม commit/วางในแชต)`);
  } finally {
    await context.close();
  }
}

/**
 * เครื่องไหนก็ได้: โหลด storageState → เปิดหน้าอ่านอย่างเดียว → รายงานผล → เขียน state กลับ (ต่ออายุ cookie ในไฟล์)
 * `--ua headless` = ใช้ UA "HeadlessChrome" ตามค่าเดิมของ Playwright (ตัวควบคุมเทียบกับ ticket 02) · ค่าเริ่มต้น = ตัดคำว่า Headless ออกจาก UA จริงของเครื่องนั้น
 */
async function runReplay(args: string[]): Promise<void> {
  const keepHeadlessUa = args.includes('--ua') && args[args.indexOf('--ua') + 1] === 'headless';
  const note = args.filter((a, i) => a !== '--ua' && args[i - 1] !== '--ua').join(' ') || 'manual';
  const browser = await chromium.launch({ env: browserEnv(), headless: true });
  try {
    const probe = await browser.newContext();
    const defaultUa = await (await probe.newPage()).evaluate(() => navigator.userAgent);
    await probe.close();
    const userAgent = keepHeadlessUa ? defaultUa : defaultUa.replace('HeadlessChrome', 'Chrome');

    const context = await browser.newContext({ storageState: STATE_FILE, userAgent, viewport: cfg.viewport });
    const page = await context.newPage();
    const result = await stillLoggedIn(page);
    appendLog({ mode: 'replay', note, platform: process.platform, uaMode: keepHeadlessUa ? 'headless' : 'normal', ...result });
    console.log(result.loggedIn ? `✔ ยังอยู่ในระบบ (${note}, ua=${keepHeadlessUa ? 'headless' : 'normal'})` : `✘ หลุด/ถูกปฏิเสธ (${note}) → ${result.finalPath}`);
    if (result.loggedIn) writeFileSync(STATE_FILE, JSON.stringify(await context.storageState()), { mode: 0o600 });
  } finally {
    await browser.close();
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'run') await runFull();
else if (cmd === 'check') await runCheck(rest.join(' ') || 'manual');
else if (cmd === 'export-state') await runExportState();
else if (cmd === 'replay') await runReplay(rest);
else {
  console.error('ใช้: run | check [หมายเหตุ] | export-state | replay [--ua headless] [หมายเหตุ]');
  process.exit(2);
}
