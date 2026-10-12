import chalk from 'chalk';
import { createRedactor, redactError } from '../../core/redact.ts';
import { ConfigError, loadConfig, loadCredentials } from './config.ts';
import { login, openSession } from './session.ts';
import type { CookieInfo, LoginResult } from './session.ts';

export type LoginCheckOptions = {
  readonly headful: boolean;
  readonly json: boolean;
};

function describeCookie(c: CookieInfo): string {
  const kind = c.isSessionCookie
    ? 'session cookie (หายเมื่อปิดเบราว์เซอร์)'
    : `หมดอายุ ${c.expiresAt}`;
  const flags = [c.httpOnly ? 'httpOnly' : null, c.secure ? 'secure' : null]
    .filter(Boolean)
    .join(' ');
  return `${c.name} — ${kind}${flags ? ` · ${flags}` : ''}`;
}

function printHuman(target: string, headless: boolean, result: LoginResult): void {
  const seconds = (result.elapsedMs / 1000).toFixed(1);

  console.log(`${chalk.dim('เป้าหมาย')}  ${target}`);
  console.log(`${chalk.dim('โหมด')}      ${headless ? 'headless' : 'headful'}`);
  console.log(`${chalk.dim('ล็อกอิน')}   ${chalk.green('✔ สำเร็จ')} ใน ${seconds} วินาที`);
  console.log(`${chalk.dim('ปลายทาง')}   ${result.finalUrl}`);
  console.log(`${chalk.dim('ชื่อหน้า')}   ${result.title}`);

  if (result.cookies.length === 0) {
    console.log(`${chalk.dim('cookie')}    ${chalk.yellow('ไม่มีเลย — ผิดปกติ ควรตรวจดู')}`);
    return;
  }

  console.log(`${chalk.dim('cookie')}    ${describeCookie(result.cookies[0]!)}`);
  for (const c of result.cookies.slice(1)) {
    console.log(`           ${describeCookie(c)}`);
  }

  // ตอบคำถามที่ค้างอยู่ในแผน: session อยู่ได้นานแค่ไหน
  if (result.cookies.every((c) => c.isSessionCookie)) {
    console.log(
      chalk.dim(
        '\ncookie ทุกใบเป็น session cookie — ฝั่ง server (ASP.NET) ยังหมดอายุเองได้อีกชั้น\n' +
          'จะรู้อายุจริงต้องทิ้งไว้แล้วลองเรียกหน้า protected ซ้ำ ดูตาราง Verification ในแผน',
      ),
    );
  }
}

export async function runLoginCheck(opts: LoginCheckOptions): Promise<number> {
  let redact = createRedactor([]);

  try {
    const cfg = loadConfig();
    const creds = loadCredentials();
    redact = createRedactor([creds.password, creds.username]);

    const headless = opts.headful ? false : cfg.headless;
    const session = await openSession({ ...cfg, headless });

    try {
      const result = await login(session, cfg, creds, redact);

      if (opts.json) {
        console.log(
          JSON.stringify(
            { ok: true, code: 'login_ok', target: cfg.loginUrl, headless, ...result },
            null,
            2,
          ),
        );
      } else {
        printHuman(cfg.loginUrl, headless, result);
      }
      return 0;
    } finally {
      await session.close();
    }
  } catch (err) {
    const isConfig = err instanceof ConfigError;
    const code = isConfig ? 'config' : 'login_failed';
    // ปัญหา config เป็นเรื่องที่คนแก้ได้เองจากข้อความ ไม่ต้องมี stack มารบกวน
    const text = isConfig ? redact(err.message) : redactError(err, redact);

    if (opts.json) {
      console.log(JSON.stringify({ ok: false, code, text }, null, 2));
    } else {
      console.error(`${chalk.red('✘ ไม่สำเร็จ')}\n${text}`);
    }
    return 1;
  }
}
