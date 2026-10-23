import chalk from 'chalk';
import { ConfigError, loadConfig, loadCredentials } from './config.ts';
import { login, openSession } from './session.ts';

export type LoginCheckOptions = {
  readonly headful: boolean;
  readonly json: boolean;
};

/**
 * ตรวจว่า login เข้า FoodStory ได้จริง — ต่างจาก HotelTime ตรงที่ `session.ts::login` ของที่นี่
 * ไม่คืน cookie/title กลับมา (login จัดการ reCAPTCHA เองภายใน — อัตโนมัติเมื่อมีคีย์ 2captcha หรือรอคน
 * เมื่อไม่มีคีย์ ตาม ADR-0010 — ไม่มี LoginResult แบบ HotelTime)
 * และไม่ต้อง redact อะไรเพราะไม่มี error message ที่มีรหัสผ่านปนอยู่ (ต่างจาก HotelTime ที่
 * ASP.NET error บางเคสมี query string ติดมาด้วย)
 */
export async function runFoodStoryLoginCheck(opts: LoginCheckOptions): Promise<number> {
  try {
    const cfg = loadConfig();
    const creds = loadCredentials();
    const headless = opts.headful ? false : cfg.headless;
    const session = await openSession({ ...cfg, headless });

    const startedAt = Date.now();
    try {
      await login(session, cfg, creds);
      const elapsedMs = Date.now() - startedAt;

      if (opts.json) {
        console.log(JSON.stringify({ ok: true, code: 'login_ok', target: cfg.baseUrl, headless, elapsedMs }, null, 2));
      } else {
        console.log(`${chalk.dim('เป้าหมาย')}  ${cfg.baseUrl}`);
        console.log(`${chalk.dim('โหมด')}      ${headless ? 'headless' : 'headful'}`);
        console.log(`${chalk.dim('ล็อกอิน')}   ${chalk.green('✔ สำเร็จ')} ใน ${(elapsedMs / 1000).toFixed(1)} วินาที`);
      }
      return 0;
    } finally {
      await session.close();
    }
  } catch (err) {
    const isConfig = err instanceof ConfigError;
    const text = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, code: isConfig ? 'config' : 'login_failed', text }, null, 2));
    } else {
      console.error(`${chalk.red('✘ ไม่สำเร็จ')}\n${text}`);
    }
    return 1;
  }
}
