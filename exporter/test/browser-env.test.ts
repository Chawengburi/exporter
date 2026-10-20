import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserEnv } from '../src/core/browser-env.ts';

// code review ใบ 08: dotenv ของ Site โหลดทั้ง .env เข้า process.env ตอน export — Chromium ที่ Playwright เปิดได้ env ทั้งก้อนไปด้วย (เห็นใน `ps eww`/crash dump)
// · เปิดเบราว์เซอร์ด้วย env ที่ตัดความลับออก (URL webhook, รหัสผ่าน, token) — ที่เหลือ (PATH, HOME, DISPLAY, ภาษา) ต้องอยู่ครบ

test('🔴 env ของเบราว์เซอร์ไม่มี URL webhook รหัสผ่าน หรือ token · ตัวแปรของระบบยังอยู่', () => {
  const env = browserEnv({
    PATH: '/usr/bin', HOME: '/home/x', DISPLAY: ':0', LANG: 'th_TH.UTF-8',
    DISCORD_WEBHOOK_URL_EXPORT: 'https://discord.com/api/webhooks/1/abc', DISCORD_WEBHOOK_URL_UPLOAD: 'https://discord.com/api/webhooks/2/def',
    HOTELTIME_PASSWORD: 'p', FOODSTORY_PASSWORD: 'q',
    HOTELTIME_USERNAME: 'u', FOODSTORY_EMAIL: 'e@x', AI_TOKEN: 't', SOME_API_SECRET: 's',
  });
  assert.deepEqual(Object.keys(env).sort(), ['DISPLAY', 'HOME', 'LANG', 'PATH']);
});
