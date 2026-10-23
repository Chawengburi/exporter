/**
 * Seam การแก้ reCAPTCHA ของ FoodStory (ADR-0010)
 *
 * 🔴 กลับคำตัดสินเดิม "ไม่แก้ captcha อัตโนมัติ" — เครื่อง production (Ubuntu/Windmill) ไม่มีคนเฝ้า
 * จึงต้องแก้ reCAPTCHA v2 ด้วยบริการ solver อัตโนมัติ ดู `docs/adr/0010-...`
 *
 * โมดูลนี้เป็น **ตรรกะบริสุทธิ์** โดยเจตนา — ไม่ import playwright/เปิดเบราว์เซอร์/ยิงเครือข่าย เพื่อให้
 * เทสต์ได้เร็วด้วย fake solver โดยไม่จ่ายเครดิต 2captcha · implementation จริงของ port + การยัด token
 * ลงหน้าเว็บอยู่ที่ ticket 02
 */

/** จำนวนครั้งที่ลองแก้ reCAPTCHA ก่อนยอมแพ้ (ตกลงไว้ 2–3 — ดู spec/ticket 01) */
export const DEFAULT_SOLVE_ATTEMPTS = 3;

export class CaptchaError extends Error {
  override readonly name = 'CaptchaError';
}

/**
 * Port ของบริการแก้ reCAPTCHA — รับ sitekey + URL ของหน้า คืน token `g-recaptcha-response`
 * implementation จริงห่อ `@2captcha/captcha-solver` (ticket 02) · เทสต์ใช้ fake
 */
export type CaptchaSolver = {
  solve(input: { readonly sitekey: string; readonly pageurl: string }): Promise<string>;
};

export type LoginMode = 'auto-solve' | 'human-wait' | 'cannot-solve';

/**
 * เลือกเส้นทาง login จาก **การมี solver** (= มี `TWOCAPTCHA_API_KEY` ตั้งไว้ไหม) + **เบราว์เซอร์มีหน้าจอไหม** — ไม่ใช่ flag ตายตัว
 * โค้ดชุดเดียวจึงรันได้ทั้งบน Mac (ไม่มี key + headful → รอคนกด) และ Ubuntu (มี key → แก้อัตโนมัติ)
 *
 * ไม่มี solver + headless = `cannot-solve` (exporter-foodstory-scheduled-daily ใบ 03) — ไม่มีใครเห็นหน้าจอให้แก้ captcha (เช่น worker ของ
 * Windmill ที่ยังไม่ได้ใส่คีย์) จึงล้มทันที แทนการรอคน 5 นาทีแล้วค่อยล้ม · `headless` ต้องเป็นของเบราว์เซอร์ที่เปิดจริง ไม่ใช่ค่าใน config
 * (`--headful` เปลี่ยนค่าตอนเปิด session)
 */
export function selectLoginMode(opts: { readonly hasSolver: boolean; readonly headless: boolean }): LoginMode {
  if (opts.hasSolver) return 'auto-solve';
  return opts.headless ? 'cannot-solve' : 'human-wait';
}

/**
 * หา sitekey ของ reCAPTCHA v2 จากสิ่งที่อ่านมาจากหน้า login — ลำดับ: `data-sitekey` attribute ก่อน
 * (บางเว็บมี) ไม่งั้นอ่านพารามิเตอร์ `k` จาก src ของ anchor iframe (`…/api2/anchor?…&k=`)
 * FoodStory ไม่มี `data-sitekey` จึงใช้ทาง anchor เป็นหลัก (ยืนยันจากตัวอย่างที่พิสูจน์แล้ว 2026-10-22)
 *
 * แยกส่วนอ่าน DOM (getAttribute) ออกไว้ที่ฝั่งเบราว์เซอร์ — ฟังก์ชันนี้รับแต่ค่าดิบที่อ่านมาแล้ว จึงบริสุทธิ์
 */
export function extractSitekey(input: {
  readonly dataSitekeyAttr: string | null;
  readonly anchorSrc: string | null;
}): string {
  const attr = input.dataSitekeyAttr?.trim();
  if (attr) return attr;

  if (input.anchorSrc) {
    let k: string | null = null;
    try {
      k = new URL(input.anchorSrc).searchParams.get('k');
    } catch {
      k = null;
    }
    if (k && k.trim() !== '') return k.trim();
  }

  throw new CaptchaError(
    'หา sitekey ของ reCAPTCHA ไม่เจอ (ทั้ง data-sitekey attribute และ k ใน src ของ anchor iframe)',
  );
}

/**
 * เรียก `solve` ซ้ำได้สูงสุด `attempts` ครั้ง — token ที่ว่าง/มีแต่ช่องว่างนับว่าใช้ไม่ได้และลองต่อ
 * เหมือนกับการ throw · ครบแล้วยังไม่ได้ token ที่ใช้ได้ → โยน `CaptchaError` พร้อมสาเหตุล่าสุด
 *
 * รับ `solve` เป็น thunk (ฝั่งเรียกผูก sitekey/pageurl ไว้แล้ว) เพื่อให้โมดูลนี้ไม่ต้องรู้จักเบราว์เซอร์
 */
export async function solveWithRetry(
  solve: () => Promise<string>,
  opts: { readonly attempts: number },
): Promise<string> {
  let lastReason = 'ไม่มีข้อมูลสาเหตุ';
  for (let i = 0; i < opts.attempts; i += 1) {
    try {
      const token = await solve();
      if (token.trim() !== '') return token;
      lastReason = '2captcha คืน token ว่าง';
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
    }
  }
  throw new CaptchaError(`แก้ reCAPTCHA ไม่สำเร็จหลังลอง ${opts.attempts} ครั้ง — สาเหตุล่าสุด: ${lastReason}`);
}
