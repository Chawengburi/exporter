/**
 * env สำหรับเปิดเบราว์เซอร์ (Playwright `launch({ env })`) — ตัดความลับออก (code review ใบ 08)
 *
 * dotenv ของ Site โหลดทั้ง `exporter/.env` เข้า `process.env` (บัญชีของ Site, URL webhook ของ Discord) และ Playwright ส่ง `process.env` ทั้งก้อนให้
 * Chromium เป็นค่าเริ่มต้น — เห็นได้ใน `ps eww` และ crash dump ของเบราว์เซอร์ · เบราว์เซอร์ไม่ต้องใช้ค่าพวกนี้เลย (บัญชีกรอกผ่าน page ไม่ใช่ env)
 */
const SECRET_KEYS = /PASSWORD|SECRET|TOKEN|WEBHOOK|_USERNAME$|_EMAIL$/i;

export function browserEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string' && !SECRET_KEYS.test(e[0])),
  );
}
