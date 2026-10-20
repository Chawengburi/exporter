import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/** รากของโปรเจกต์ — ไฟล์นี้อยู่ที่ src/uploader-config.ts จึงถอยขึ้นหนึ่งชั้น (เหมือน sites/hoteltime/config.ts) */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(PROJECT_ROOT, '.env');

loadDotenv({ path: ENV_FILE, quiet: true });

export class UploaderConfigError extends Error {
  override readonly name = 'UploaderConfigError';
}

/** ไม่เป็นความลับ — พิมพ์ลง log ได้อย่างปลอดภัย (เหมือน `Config` ของ `sites/hoteltime/config.ts`) */
export type UploaderConfig = {
  readonly url: string;
  /**
   * ticket 11 (`empty` array contract) — default **ปิด** เพราะยืนยันสดกับ production แล้ว (2026-10-19) ว่า
   * ทีม uploader ยังไม่ deploy contract นี้ (ยิง `empty` เข้าไปตอนนี้ได้ 400) เปิดได้ด้วย
   * `UPLOADER_SEND_EMPTY=true` หลังยืนยัน deploy แล้วเท่านั้น (ticket 14) — ไม่มีก็ไม่ใช่ error (ต่างจาก
   * url/email/password) เพราะปิดคือค่าที่ปลอดภัยเสมอ
   */
  readonly sendEmpty: boolean;
};

/**
 * ความลับ — แยก type จาก `UploaderConfig` โดยเจตนา (เหมือน `Credentials` ของ `sites/hoteltime/config.ts`)
 * เพื่อให้ `console.log`/error dump ของ config ทำรหัสหลุดไม่ได้ตั้งแต่ระดับ type
 */
export type UploaderCredentials = {
  readonly email: string;
  readonly password: string;
};

export type UploaderSetup = {
  readonly config: UploaderConfig;
  readonly credentials: UploaderCredentials;
};

function envStr(name: string): string {
  const raw = process.env[name];
  return raw === undefined ? '' : raw.trim();
}

/**
 * อ่าน `UPLOADER_URL`/`UPLOADER_EMAIL`/`UPLOADER_PASSWORD` จาก `.env` — **ไม่มี default ในโค้ดเลย** (Q1 ของ
 * grilling: `UPLOADER_URL` ต้องตั้งเอง ไม่ชี้ไปที่ไหนโดยปริยาย เพื่อไม่ให้เครื่อง dev เผลอคุยกับ production) ·
 * ขาดตัวใดตัวหนึ่งปฏิเสธพร้อมวิธีแก้ เหมือน `sites/hoteltime/config.ts#loadCredentials` — ตรวจทั้ง 3 ตัวพร้อมกัน
 * ในคำขอเดียว (ข้อความเดียวบอกทุกตัวที่ขาด) แต่คืนแยกเป็นสอง type
 */
export function loadUploaderSetup(): UploaderSetup {
  const url = envStr('UPLOADER_URL');
  const email = envStr('UPLOADER_EMAIL');
  const password = envStr('UPLOADER_PASSWORD');

  const missing: string[] = [];
  if (url === '') missing.push('UPLOADER_URL');
  if (email === '') missing.push('UPLOADER_EMAIL');
  if (password === '') missing.push('UPLOADER_PASSWORD');

  if (missing.length > 0) {
    throw new UploaderConfigError(
      `ยังไม่ได้ตั้ง ${missing.join(', ')}\n` +
        `  แก้โดย: เพิ่มบรรทัดนี้ลงใน ${ENV_FILE}\n` +
        '  UPLOADER_URL=https://uploader.chawengbot.cloud (หรือ URL เครื่อง local ตอน dev)\n' +
        '  UPLOADER_EMAIL=...\n' +
        '  UPLOADER_PASSWORD=...',
    );
  }
  const sendEmpty = envStr('UPLOADER_SEND_EMPTY').toLowerCase() === 'true';
  return { config: { url, sendEmpty }, credentials: { email, password } };
}
