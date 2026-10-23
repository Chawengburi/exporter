import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { GO_LIVE_ENV, parseGoLive } from '../../core/run-planner.ts';

/** รากของโปรเจกต์ — ไฟล์นี้อยู่ที่ src/sites/foodstory/config.ts จึงถอยขึ้นสามชั้น */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// .env ไฟล์เดียวกับ HotelTime (ADR-0004 — เครื่องมือเดียว ไม่แยก repo/ไฟล์ต่อ site)
loadDotenv({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

const DEFAULT_BASE_URL = 'https://owner.foodstory.co';
const DEFAULT_BRANCH_NAME = 'Chaweng Buri Resort';
// สเปกต้นทางวัดจริงว่าบางหน้าโหลดถึง 40 วิ (/th/summary) และ re-render 5000 แถวกินอีก 6-10 วิ
// (foodstory-report-export-spec.md §4.4) — ตั้งสูงกว่า default ของ HotelTime (30s) ตั้งใจ
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_VIEWPORT_WIDTH = 1512;
const DEFAULT_VIEWPORT_HEIGHT = 900;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export type Config = {
  readonly projectRoot: string;
  readonly baseUrl: string;
  readonly branchName: string;
  readonly headless: boolean;
  readonly timeoutMs: number;
  readonly slowMoMs: number;
  readonly viewport: { readonly width: number; readonly height: number };
  /** ที่พักไฟล์ระหว่างดาวน์โหลด (ไฟล์สุดท้ายย้ายไปโฟลเดอร์รอบในคลัง) — `data/foodstory/_downloads` */
  readonly downloadDir: string;
  /** รากของคลังผลลัพธ์ `data/` (ADR-0005) — รอบรายเดือนลง `data/foodstory/monthly/<YYYY-MM>/` (ticket 03) */
  readonly dataDir: string;
  /** **วันเริ่มใช้งาน** (`EXPORTER_GO_LIVE`, ค่าเดียวกับ HotelTime) — วันของข้อมูลที่ขาดหลังวันนี้ทุกรอบเติมให้เอง (ADR-0009) · null = ไม่ได้ตั้ง */
  readonly goLive: string | null;
  /** session ที่ login ค้างไว้ (ดู session.ts) — .auth/ ถูก gitignore ทั้งโฟลเดอร์ */
  readonly authStatePath: string;
  /** คีย์ 2captcha (`TWOCAPTCHA_API_KEY`, ADR-0010) — มี → login แก้ reCAPTCHA เองอัตโนมัติ · null = ไม่มี → รอคนกด */
  readonly captchaApiKey: string | null;
};

export type Credentials = {
  readonly email: string;
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
  return {
    projectRoot: PROJECT_ROOT,
    baseUrl: envStr('FOODSTORY_BASE_URL', DEFAULT_BASE_URL).replace(/\/+$/, ''),
    branchName: envStr('FOODSTORY_BRANCH_NAME', DEFAULT_BRANCH_NAME),
    headless: envBool('FOODSTORY_HEADLESS', true),
    timeoutMs: envInt('FOODSTORY_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    slowMoMs: envInt('FOODSTORY_SLOW_MO', 0),
    viewport: {
      width: envInt('FOODSTORY_VIEWPORT_WIDTH', DEFAULT_VIEWPORT_WIDTH),
      height: envInt('FOODSTORY_VIEWPORT_HEIGHT', DEFAULT_VIEWPORT_HEIGHT),
    },
    downloadDir: path.join(PROJECT_ROOT, 'data', 'foodstory', '_downloads'),
    dataDir: path.join(PROJECT_ROOT, 'data'),
    goLive: goLiveFromEnv(),
    authStatePath: path.join(PROJECT_ROOT, '.auth', 'foodstory.json'),
    captchaApiKey: envStr('TWOCAPTCHA_API_KEY', '') || null,
  };
}

/** อ่าน credential แยกจาก Config โดยเจตนา — เรียกเฉพาะตอนจะใช้จริงเท่านั้น (เหมือน HotelTime) */
export function loadCredentials(): Credentials {
  const email = envStr('FOODSTORY_EMAIL', '');
  const password = envStr('FOODSTORY_PASSWORD', '');

  const missing: string[] = [];
  if (email === '') missing.push('FOODSTORY_EMAIL');
  if (password === '') missing.push('FOODSTORY_PASSWORD');

  if (missing.length > 0) {
    throw new ConfigError(
      `ยังไม่ได้ตั้ง ${missing.join(' และ ')}\n` +
        `  แก้โดยใส่ค่าจริงลงใน ${path.join(PROJECT_ROOT, '.env')} (ดูตัวอย่างใน .env.example)`,
    );
  }

  return { email, password };
}
