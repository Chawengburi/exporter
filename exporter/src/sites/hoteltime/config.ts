import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { GO_LIVE_ENV, parseGoLive } from '../../core/run-planner.ts';

/**
 * รากของโปรเจกต์ — ไฟล์นี้อยู่ที่ src/sites/hoteltime/config.ts จึงถอยขึ้นสามชั้น
 * (ไม่มี build step ดู tsconfig.json ประกอบ เส้นทางนี้จึงมีความหมายเดียวเสมอ)
 */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * dotenv จะ "ไม่" ทับตัวแปรที่ตั้งมาจาก shell อยู่แล้วเป็นค่า default
 * ซึ่งให้ precedence ที่เราต้องการพอดี:  shell env  >  exporter/.env  >  ค่า default ข้างล่าง
 * (รูปแบบเดียวกับ bobby-cli/src/core/config.ts)
 */
loadDotenv({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

const DEFAULT_BASE_URL = 'https://th07.hoteltime.com';
const DEFAULT_LOGIN_PATH = '/pms/login/login.aspx?ReturnUrl=%2fpms%2fWelcomepage.aspx';
const DEFAULT_TIMEOUT_MS = 30_000;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * ค่าที่ไม่เป็นความลับ — พิมพ์ลง log ได้อย่างปลอดภัย
 *
 * 🔴 credential ไม่ได้อยู่ในนี้โดยเจตนา ดู loadCredentials() ข้างล่าง —
 * แยกกันที่ระดับ type เพื่อให้ console.log(config) ทำรหัสหลุดไม่ได้ตั้งแต่แรก
 */
export type Config = {
  readonly projectRoot: string;
  readonly baseUrl: string;
  readonly loginPath: string;
  readonly loginUrl: string;
  readonly headless: boolean;
  readonly timeoutMs: number;
  readonly slowMoMs: number;
  /** รากของคลังผลลัพธ์ `data/` (ADR-0005) — โฟลเดอร์ของแต่ละรอบตัดสินที่ `runFolder()` ใน core/placement.ts */
  readonly dataDir: string;
  readonly captureDir: string;
  /**
   * **วันเริ่มใช้งาน** (ISO, `EXPORTER_GO_LIVE`) — วันของข้อมูลที่ขาดหลังวันนี้ทุกรอบเติมให้เอง (ADR-0009) · null = ยังไม่ได้ตั้ง:
   * ดึงแค่เมื่อวาน ไม่เดาวันย้อนหลัง · ค่าเดียวใช้ทั้งสอง Site จึงไม่มี prefix ของ Site · ตัวติดตั้งบน Ubuntu ตั้งเป็นวันที่ติดตั้ง
   */
  readonly goLive: string | null;
};

export type Credentials = {
  readonly username: string;
  readonly password: string;
};

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  throw new ConfigError(`${name} ต้องเป็น true/false — ได้มา ${JSON.stringify(raw)}`);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new ConfigError(`${name} ต้องเป็นตัวเลข >= 0 — ได้มา ${JSON.stringify(raw)}`);
  }
  return Math.trunc(n);
}

function goLiveFromEnv(): string | null {
  const parsed = parseGoLive(process.env[GO_LIVE_ENV]);
  if ('error' in parsed) throw new ConfigError(parsed.error);
  return parsed.goLive;
}

export function loadConfig(): Config {
  const baseUrl = envStr('HOTELTIME_BASE_URL', DEFAULT_BASE_URL).replace(/\/+$/, '');
  const loginPath = envStr('HOTELTIME_LOGIN_PATH', DEFAULT_LOGIN_PATH);

  return {
    projectRoot: PROJECT_ROOT,
    baseUrl,
    loginPath,
    loginUrl: new URL(loginPath, `${baseUrl}/`).toString(),
    headless: envBool('HOTELTIME_HEADLESS', true),
    timeoutMs: envInt('HOTELTIME_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    slowMoMs: envInt('HOTELTIME_SLOW_MO', 0),
    dataDir: path.join(PROJECT_ROOT, 'data'),
    captureDir: path.join(PROJECT_ROOT, 'recon', 'captures'),
    goLive: goLiveFromEnv(),
  };
}

/**
 * อ่าน credential แยกจาก Config โดยเจตนา — เรียกเฉพาะตอนจะใช้จริงเท่านั้น
 * โยน ConfigError พร้อมวิธีแก้ ถ้ายังไม่ได้ตั้ง
 */
export function loadCredentials(): Credentials {
  const username = envStr('HOTELTIME_USERNAME', '');
  const password = envStr('HOTELTIME_PASSWORD', '');

  const missing: string[] = [];
  if (username === '') missing.push('HOTELTIME_USERNAME');
  if (password === '') missing.push('HOTELTIME_PASSWORD');

  if (missing.length > 0) {
    throw new ConfigError(
      `ยังไม่ได้ตั้ง ${missing.join(' และ ')}\n` +
        `  แก้โดย: cp ${path.join(PROJECT_ROOT, '.env.example')} ${path.join(PROJECT_ROOT, '.env')}\n` +
        `  แล้วใส่ค่าจริงลงไป (.env ถูก gitignore ไว้แล้ว)`,
    );
  }

  return { username, password };
}
