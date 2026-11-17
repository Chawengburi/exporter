// Replay storageState ของ FoodStory บนเครื่องอื่น — ไม่ต้องใช้ repo exporter (ติดตั้งแค่ `npm i playwright` + `npx playwright install chromium`)
//
//   node foodstory-replay-standalone.mjs [state.json] [--ua headless]
//
// อ่านอย่างเดียว: เปิด /th/salebysumdate 1 ครั้ง · ไม่กรอกรหัส ไม่ยุ่งกับ captcha · ผ่าน = ไม่ถูกส่งกลับหน้า login
// เขียน state กลับไฟล์เดิมเมื่อผ่าน (ต่ออายุ cookie ในไฟล์) · ไม่พิมพ์ค่า cookie
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const keepHeadlessUa = args.includes('--ua') && args[args.indexOf('--ua') + 1] === 'headless';
const stateFile = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--ua') ?? 'foodstory-state.json';
JSON.parse(readFileSync(stateFile, 'utf-8')); // ไฟล์เสีย/ไม่มี = ล้มตรงนี้ชัด ๆ

const base = 'https://owner.foodstory.co';
const browser = await chromium.launch({ headless: true });
try {
  const probe = await browser.newContext();
  const defaultUa = await (await probe.newPage()).evaluate(() => navigator.userAgent);
  await probe.close();
  const userAgent = keepHeadlessUa ? defaultUa : defaultUa.replace('HeadlessChrome', 'Chrome');

  const context = await browser.newContext({ storageState: stateFile, userAgent, viewport: { width: 1512, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/th/salebysumdate`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const finalPath = new URL(page.url()).pathname;
  const loggedIn = finalPath !== '/' && (await page.locator('input[name="password"]').count()) === 0;

  console.log(JSON.stringify({ at: new Date().toISOString(), platform: process.platform, uaMode: keepHeadlessUa ? 'headless' : 'normal', userAgent, loggedIn, finalPath }, null, 2));
  console.log(loggedIn ? '✔ ยังอยู่ในระบบ' : '✘ หลุด/ถูกปฏิเสธ');
  if (loggedIn) writeFileSync(stateFile, JSON.stringify(await context.storageState()));
} finally {
  await browser.close();
}
