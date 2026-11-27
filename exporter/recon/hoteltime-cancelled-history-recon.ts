/**
 * recon แบบอ่านอย่างเดียวของ HotelTime — "การยกเลิกเก่ากว่า 2026-06 มีให้ดึงไหม" (ต่อจาก backfill 2026-11-27)
 *
 *   Q1  ค้นด้วย Cancelled from-to (ล้าง Stay) รายเดือนหลายเดือนย้อนหลัง → จำนวนแถว + ช่วงวันที่ในคอลัมน์ Cancelled
 *   Q2  ค้นด้วย Stay date range (ล้าง Cancelled) รายเดือนหลายเดือน → จำนวนแถว + ช่วงวันที่ในคอลัมน์ Cancelled
 *       (ถ้า Q1 ว่างแต่ Q2 มีแถว = ต้นทางยังมีการยกเลิกเก่า แค่ค้นด้วยแกน Cancelled ไม่เจอ)
 *
 * 🔴 อ่านอย่างเดียว: แตะได้เฉพาะ drStay / drDeleted + ปุ่ม Search (`btnFind`) ห้ามแตะปุ่มในตาราง (มี `Reinstate room` ที่เขียนข้อมูลจริง — ADR-0001)
 * ไม่ดาวน์โหลด ไม่พิมพ์/ไม่เก็บชื่อแขก — ผลเป็นตัวเลขรวมและวันที่เท่านั้น
 * ผลลัพธ์ลงไฟล์ที่ระบุใน argv[2] (ไม่ลง repo)
 *
 * ใช้: node recon/hoteltime-cancelled-history-recon.ts <ไฟล์ผลลัพธ์.json> [DD/MM/YYYY:DD/MM/YYYY,...]
 *   ใส่ช่วงเอง = ค้นด้วย Cancelled from-to เฉพาะช่วงเหล่านั้น (หาขอบวันที่เก่าสุดที่หน้ารับ) แทนชุดรายเดือนมาตรฐาน
 */
import { writeFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { createRedactor, redactError } from '../src/core/redact.ts';
import { loadConfig, loadCredentials } from '../src/sites/hoteltime/config.ts';
import { login, openSession } from '../src/sites/hoteltime/session.ts';

const OUT = process.argv[2];
if (!OUT) throw new Error('ระบุไฟล์ผลลัพธ์เป็น argv[2]');

const ALLOWED = ['ctl00$pc$drStay', 'ctl00$pc$drDeleted', 'ctl00$pc$btnFind'] as const;
const PATH = 'ResDeleteList.aspx';

async function fill(page: Page, name: string, value: string): Promise<void> {
  const base = name.split('$').slice(0, 3).join('$');
  if (!ALLOWED.some((a) => a === base || a === name)) throw new Error(`control นอกรายการที่อนุญาต: ${name}`);
  const el = page.locator(`input[name="${name}"]`);
  if ((await el.count()) !== 1) throw new Error(`ไม่พบช่อง ${name} ชิ้นเดียว`);
  await el.fill(value);
  await el.dispatchEvent('change');
}

const setRange = async (page: Page, group: string, from: string, to: string) => {
  await fill(page, `${group}$calFrom`, from);
  await fill(page, `${group}$calTo`, to);
};

async function search(page: Page): Promise<void> {
  await page.locator('[name="ctl00$pc$btnFind"]').first().click(); // ปุ่ม Search เท่านั้น
  await page.waitForLoadState('networkidle');
}

async function readGrid(page: Page): Promise<string[][] | null> {
  return page.evaluate(() => {
    const t = document.querySelector<HTMLTableElement>('table[id*="dtgItems"]');
    if (t === null) return null;
    return [...t.rows].map((r) => [...r.cells].map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()));
  });
}

const parseDMY = (s: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');
const monthRange = (y: number, m: number): [string, string] => [`01/${pad(m)}/${y}`, `${pad(lastDay(y, m))}/${pad(m)}/${y}`];

const MONTHS: ReadonlyArray<readonly [number, number]> = [
  [2026, 5], [2026, 4], [2026, 3], [2026, 1], [2025, 10], [2025, 6], [2025, 1], [2024, 9], [2024, 6],
];

const result: Record<string, unknown> = { ranAt: new Date().toISOString(), q1_byCancelledDate: [], q2_byStayDate: [] };

const cfg = loadConfig();
const creds = loadCredentials();
const redact = createRedactor([creds.username, creds.password]);
const session = await openSession(cfg);
try {
  await login(session, cfg, creds, redact);
  const { page } = session;

  async function probeRange(from: string, to: string) {
    await page.goto(new URL(PATH, `${cfg.baseUrl}/pms/`).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await setRange(page, 'ctl00$pc$drStay', '', '');
    await setRange(page, 'ctl00$pc$drDeleted', from, to);
    await search(page);
    const body = await page.locator('body').innerText();
    const grid = await readGrid(page);
    return { from, to, rows: grid === null ? 0 : Math.max(0, grid.length - 1), invalidDate: /invalid date/i.test(body), mandatory: /mandatory item/i.test(body) };
  }

  async function probe(mode: 'cancelled' | 'stay', y: number, m: number) {
    await page.goto(new URL(PATH, `${cfg.baseUrl}/pms/`).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const [from, to] = monthRange(y, m);
    if (mode === 'cancelled') {
      await setRange(page, 'ctl00$pc$drStay', '', '');
      await setRange(page, 'ctl00$pc$drDeleted', from, to);
    } else {
      await setRange(page, 'ctl00$pc$drDeleted', '', '');
      await setRange(page, 'ctl00$pc$drStay', from, to);
    }
    await search(page);
    const body = await page.locator('body').innerText();
    const mandatory = /mandatory item/i.test(body);
    const invalidDate = /invalid date/i.test(body);
    const grid = await readGrid(page);
    const header = grid?.[0] ?? [];
    const rows = grid === null ? 0 : Math.max(0, grid.length - 1);
    const ci = header.findIndex((h) => h === 'Cancelled');
    const dates = (grid ?? []).slice(1).map((r) => (ci >= 0 ? parseDMY(r[ci] ?? '') : null)).filter((d): d is string => d !== null).sort();
    return { month: `${y}-${pad(m)}`, rows, gridPresent: grid !== null, mandatory, invalidDate, cancelledMin: dates[0] ?? null, cancelledMax: dates.at(-1) ?? null };
  }

  const custom = process.argv[3];
  if (custom) {
    result.q1_byCancelledDate = [];
    for (const pair of custom.split(',')) {
      const [a, b] = pair.split(':');
      if (!a || !b) throw new Error(`ช่วงไม่ถูกรูปแบบ: ${pair}`);
      (result.q1_byCancelledDate as unknown[]).push(await probeRange(a, b));
    }
    delete result.q2_byStayDate;
  } else {
    for (const [y, m] of MONTHS) (result.q1_byCancelledDate as unknown[]).push(await probe('cancelled', y, m));
    for (const [y, m] of MONTHS) (result.q2_byStayDate as unknown[]).push(await probe('stay', y, m));
  }
} catch (err) {
  result.error = redactError(err, redact);
} finally {
  await session.close();
  await writeFile(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
