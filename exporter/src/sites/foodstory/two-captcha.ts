import type { Solver } from '@2captcha/captcha-solver';
import type { Config } from './config.ts';
import type { CaptchaSolver } from './captcha.ts';

/**
 * ตัวแก้ reCAPTCHA จริงด้วยบริการ 2captcha (ADR-0010) — ห่อ `@2captcha/captcha-solver`
 *
 * แยกจาก `captcha.ts` ที่บริสุทธิ์โดยเจตนา: ไฟล์นี้พึ่ง SDK ภายนอก + ยิงเครือข่าย + **เสียเงินต่อการเรียก**
 * จึงไม่ถูก import เข้าชุดเทสต์ (เทสต์ของ captcha.ts ใช้ fake solver) · ยืนยันกับ owner.foodstory.co แล้ว
 * 2026-10-22 (ดู `~/Work/foodstory-pos/examples/03-node-captcha-service`)
 *
 * 🔴 import `@2captcha` แบบ **lazy (dynamic import ตอน solve ครั้งแรก)** โดยเจตนา — ไม่งั้น static import
 * graph ของ `src/index.ts` จะลาก dep นี้ติดมาตั้งแต่ startup ทุกการรัน (รวม HotelTime ที่ไม่ได้ใช้ captcha เลย)
 * ทำให้ `git pull` ที่ลืม `npm ci` พัง HotelTime ไปด้วย · lazy แล้ว เฉพาะเส้น FoodStory auto-solve เท่านั้นที่
 * ต้องมี dep (ถ้าหายจะ error ชัดเจนตอน solve แล้วถูกห่อเป็น LoginError — ดู `session.ts::solveCaptchaAndSubmit`)
 */
export function createTwoCaptchaSolver(apiKey: string): CaptchaSolver {
  let solver: Solver | undefined;
  return {
    async solve({ sitekey, pageurl }) {
      if (!solver) {
        const { Solver } = await import('@2captcha/captcha-solver');
        solver = new Solver(apiKey);
      }
      const res = await solver.recaptcha({ googlekey: sitekey, pageurl });
      return res.data;
    },
  };
}

/** สร้าง solver จาก config — ไม่มีคีย์ = undefined (login จะรอคนกดเอง ตาม `selectLoginMode`) */
export function captchaSolverFromConfig(cfg: Config): CaptchaSolver | undefined {
  return cfg.captchaApiKey ? createTwoCaptchaSolver(cfg.captchaApiKey) : undefined;
}
