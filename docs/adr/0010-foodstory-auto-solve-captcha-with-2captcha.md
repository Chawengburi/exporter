# FoodStory แก้ reCAPTCHA อัตโนมัติด้วย 2captcha (เลิกให้คนกด)

2026-10-23 · ก่อนหน้านี้ตัดสินไว้ชัดว่า **ไม่แก้ reCAPTCHA อัตโนมัติเด็ดขาด** เพราะเป็นการหลบเลี่ยง
ระบบกันบอทโดยตรง แม้เป็น account ของเจ้าของเอง (ticket 02 ของ `.scratch/exporter-multi-site/`
§Comments, และคอมเมนต์ใน `src/sites/foodstory/session.ts`) · ADR-0006 จึงให้**พนักงานกด
reCAPTCHA เอง**ทุกครั้งโดยรันจาก Mac ที่มีหน้าจอ · แต่เครื่อง production จริงตอนนี้คือ Ubuntu ที่
รัน Windmill worker แบบ container **ไม่มีหน้าจอ ไม่มีคนนั่งเฝ้า** — มีแต่พนักงานคอยดู Discord
notification กลไก "รอคนกด" ของ ADR-0006 จึงใช้บนเครื่องนี้ไม่ได้เลย

**ทางที่เลือก (กลับคำตัดสินเดิม):** ใช้บริการ solver `@2captcha/captcha-solver` แก้ reCAPTCHA **v2**
ของหน้า login FoodStory อัตโนมัติใน `session.ts::login()` — ดึง sitekey จาก `src` ของ anchor iframe
(`…/api2/anchor?…&k=`) ส่ง sitekey+pageurl ให้ 2captcha ได้ token → ยัดลง `#g-recaptcha-response`
+ เรียก callback → submit (อ้างตัวอย่างที่พิสูจน์แล้ว 2026-10-22 ที่
`~/Work/foodstory-pos/examples/03-node-captcha-service`) · **เลือก path ตามการมี
`TWOCAPTCHA_API_KEY`**: มี key → แก้อัตโนมัติ (retry 2–3 ครั้ง ล้มแล้ว fail เร็ว + แจ้ง Discord
เพราะไม่มีคนรอ) · ไม่มี key → คงลูป "รอคนกด 5 นาที" เดิมไว้สำหรับ Mac dev (headful) · token ของ
reCAPTCHA v2 ผูกกับ sitekey+domain ไม่ผูก fingerprint จึงยัดใน headless bundled chromium ได้
(worker บน Ubuntu ไม่มี Google Chrome จริง ใช้ `channel:'chrome'`/headful ไม่ได้) เสริม stealth
init-script ราคาถูก (`navigator.webdriver=undefined`, languages, `disable-blink-features`) กันเหนียว

**ทางที่ไม่เลือก:** (1) คงให้คนกด (ADR-0006) — ใช้บน Ubuntu ไม่ได้ · (2) session-watch อย่างเดียว
(เลี้ยง session ที่คน login ไว้ให้ไม่หมดอายุ โดยไม่แก้ captcha — งานทดลองใน ticket 12 ของ
`.scratch/exporter-daily-expansion-and-data-store/`) — ยังต้องมีคนกดตอน cold-start/หลัง session
ตาย ไม่ unattended เต็ม · (3) ขอให้ FoodStory/LMWN exempt reCAPTCHA ของ account นี้ — ควบคุมเอง
ไม่ได้และยังไม่มีคำตอบ

**ผลที่ตามมา:** ยอมรับว่านี่คือการแก้ระบบกันบอทผ่านบริการที่สามบนบัญชีเจ้าของร้านเอง — เจ้าของรับ
ความเสี่ยงบัญชีถูกล็อก/แบนเอง ซึ่งถ้าเกิดจะล้ม exporter ฝั่ง FoodStory **ทั้งระบบ** ไม่ใช่แค่ feature นี้ ·
เพื่อลดความเสี่ยงนั้น เป้าหมายปลายทางคือ **session-watch (เส้นหลัก ไม่แตะ captcha) + 2captcha
(เฉพาะ cold-start/recovery)** แต่ **เริ่มด้วย 2captcha อย่างเดียวก่อน** ให้ unattended ได้ทันที แล้ว
เลเยอร์ session-watch ทับเมื่อการทดลองเพดานอายุ session จบ · ก่อนเลเยอร์ต้องรู้ว่า FoodStory ยอมให้
1 บัญชีมีหลาย session พร้อมกันไหม (รอบ 2captcha รอบแรกเป็นตัวเทสต์: ถ้า session-watch ยังอยู่หลัง
login สด = multi-session) — ถ้าเป็น single-session ต้องเปลี่ยนเป็น export reuse state file ของ watch ·
2captcha เป็น dependency + ต้นทุนใหม่ (เสียเงิน ต้องดู balance) · ใช้ได้เฉพาะ reCAPTCHA **v2** —
ถ้า FoodStory เปลี่ยนเป็น v3/Enterprise ต้องแก้ method · `TWOCAPTCHA_API_KEY` เป็นความลับใน `.env`
(solver รันฝั่ง Node อ่าน `process.env` ตรง ๆ `core/browser-env.ts` ที่กันความลับไม่ให้ส่งเข้า
Chromium จึงไม่กระทบ) · **แทนที่เฉพาะกลไก "คนกด captcha" ของ ADR-0006** ส่วนที่ว่า FoodStory มีรอบ
รายวันยังอยู่

**เพิ่มเติม 2026-10-24 (exporter-foodstory-scheduled-daily):** เมื่อ login แก้ captcha เองได้ การเริ่ม **รอบรายวัน** ของ FoodStory ย้ายจาก
พนักงานกดไอคอนไปเป็น Windmill schedule เวลาเดียวกับ HotelTime (12:00 + เก็บตก 15:00/18:00) ตามด้วยการอัปโหลดเข้า uploader ·
ไอคอนบน Desktop เหลือเป็นทางสำรองเมื่อ Discord แจ้งว่ารอบอัตโนมัติล้ม · login ล้มถูกบันทึกเป็นผลของรอบและแจ้งบรรทัดเดียว · ไม่ทำ ADR
ใหม่ เพราะถอยกลับง่าย: ถอด job FoodStory ออกจาก `windmill/setup.mjs` แล้วอัปเดตเครื่อง (การปิดสวิตช์ใน Windmill อย่างเดียวอยู่ได้แค่ถึง
การอัปเดตครั้งถัดไป — setup.mjs เปิด schedule ที่ถูกปิดคืนให้เองโดยตั้งใจ)
