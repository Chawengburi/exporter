import { Solver } from '@2captcha/captcha-solver';
import type { Config } from './config.ts';
import type { CaptchaSolver } from './captcha.ts';

/**
 * ตัวแก้ reCAPTCHA จริงด้วยบริการ 2captcha (ADR-0010) — ห่อ `@2captcha/captcha-solver`
 *
 * แยกจาก `captcha.ts` ที่บริสุทธิ์โดยเจตนา: ไฟล์นี้พึ่ง SDK ภายนอก + ยิงเครือข่าย + **เสียเงินต่อการเรียก**
 * จึงไม่ถูก import เข้าชุดเทสต์ (เทสต์ของ captcha.ts ใช้ fake solver) · ยืนยันกับ owner.foodstory.co แล้ว
 * 2026-10-22 (ดู `~/Work/foodstory-pos/examples/03-node-captcha-service`)
 */
export function createTwoCaptchaSolver(apiKey: string): CaptchaSolver {
  const solver = new Solver(apiKey);
  return {
    async solve({ sitekey, pageurl }) {
      const res = await solver.recaptcha({ googlekey: sitekey, pageurl });
      return res.data;
    },
  };
}

/** สร้าง solver จาก config — ไม่มีคีย์ = undefined (login จะรอคนกดเอง ตาม `selectLoginMode`) */
export function captchaSolverFromConfig(cfg: Config): CaptchaSolver | undefined {
  return cfg.captchaApiKey ? createTwoCaptchaSolver(cfg.captchaApiKey) : undefined;
}
