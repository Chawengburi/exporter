# Setup Exporter Production (Ubuntu) — ขาอัปโหลด (upload leg)

> 🗄️ **สำเนา static ของ Claude Docs artifact** (backup กันเผลอแก้ในหน้า artifact) —
> ต้นฉบับที่แก้ไขได้จริงอยู่ที่ https://claude.ai/code/artifact/aab2e0b5-d07a-4a49-a4c9-ed6ef5073945
> สำเนานี้ไม่ sync อัตโนมัติ ถ้าแก้ artifact แล้วอยากอัปเดตไฟล์นี้ต้องมาคัดลอกเพิ่มเอง
> (สร้าง 2026-10-19)

เอกสารนี้เป็น **ส่วนเสริม** ของคู่มือหลัก `docs/UBUNTU-ADMIN-GUIDE.md` — เจาะเฉพาะ
**ขาอัปโหลดเข้า uploader** (`exporter upload`) ที่พัฒนาเสร็จวันนี้ (2026-10-19)
ตัวติดตั้ง (`deploy/ubuntu/install.sh`) ของคู่มือหลัก **ยังไม่รู้จักขานี้** —
ต้องเพิ่ม `.env` เองตามเอกสารนี้

ขาอัปโหลดส่งไฟล์ดิบที่ `exporter export` ดึงมาแล้ว เข้า uploader service
(`https://uploader.chawengbot.cloud`) แยกจากขา export เดิมโดยสิ้นเชิง —
รันคนละคำสั่ง (`exporter upload`), แจ้งผลคนละ Discord channel

## 1. ข้อมูลเบื้องต้น

- ต้องมีโค้ดที่ commit แล้วตั้งแต่ `bc57ce2` เป็นต้นไป (unblock FoodStory
  document_type/source_system) และ `73f8a5b`/`11b10a0` (notification +
  .env.example) — เช็คด้วย `git log --oneline -5` หลัง `git pull`
- ต้องได้ credential ของ uploader ล่วงหน้าจากเจ้าของระบบ: **UPLOADER_URL,
  UPLOADER_EMAIL, UPLOADER_PASSWORD** — ไม่มี default ในโค้ด ขาดตัวใดตัวหนึ่ง
  `exporter upload` จะปฏิเสธทันทีพร้อมบอกตัวที่ขาด
- (ไม่บังคับ) URL ของ Discord webhook ห้องแยกสำหรับขาอัปโหลด — ขอวิธีได้จาก
  หัวข้อ "แจ้งเตือนทาง Discord" ของคู่มือหลัก (วิธีเดียวกัน แค่ env var คนละตัว)

## 2. ตัวแปรใน .env

เพิ่มใน `exporter/.env` (ไม่มีใน installer เดิม ต้องเติมเอง — ดู
`exporter/.env.example` เป็นตัวอย่างที่อัปเดตแล้ว):

| ตัวแปร | จำเป็น? | ค่า |
|---|---|---|
| `UPLOADER_URL` | ✅ ต้องมี | `https://uploader.chawengbot.cloud` (production) |
| `UPLOADER_EMAIL` | ✅ ต้องมี | อีเมลบัญชี uploader ของเครื่องนี้ |
| `UPLOADER_PASSWORD` | ✅ ต้องมี | รหัสผ่านบัญชีเดียวกัน |
| `DISCORD_WEBHOOK_URL_UPLOAD` | ไม่บังคับ | ไม่ตั้ง = ข้ามการแจ้งเตือนขานี้ ไม่ทำให้รอบล้ม |
| `UPLOADER_SEND_EMPTY` | ไม่บังคับ | **ปล่อยเป็น false (ค่าเริ่มต้น) ไปก่อน** — ทีม uploader ยังไม่ deploy endpoint สำหรับรายงานว่าง (ยิงไปตอนนี้ได้ 400) |

🔴 ทั้ง 3 ตัวบน (`UPLOADER_URL/EMAIL/PASSWORD`) เป็นความลับเหมือน
`HOTELTIME_PASSWORD`/`FOODSTORY_PASSWORD` — ห้าม commit/วางในแชท

## 3. ขั้นตอน setup

1. `cd ~/chawengburi-exporter && git pull` ให้ได้โค้ดขาอัปโหลดล่าสุด
2. `nano ~/chawengburi-exporter/exporter/.env` เพิ่ม 3 ตัวแปรที่จำเป็นจากหัวข้อ 2
   (และ `DISCORD_WEBHOOK_URL_UPLOAD` ถ้าต้องการ)
3. **ทดสอบทีละโฟลเดอร์ก่อน** อย่ารัน `--site` เต็มทันที:
   ```bash
   cd ~/chawengburi-exporter/exporter
   node src/index.ts upload --folder data/hoteltime/daily/2026-10/<วันล่าสุด>
   ```
4. เห็น `สำเร็จ N ไฟล์ · ปฏิเสธ 0` แล้วค่อยรันเต็ม site:
   `node src/index.ts upload --site hoteltime` (และ `--site foodstory` แยกอีกคำสั่ง)
5. ยังไม่ต้องตั้ง cron/Windmill ให้รันเองอัตโนมัติในรอบนี้ — รันมือก่อนจนกว่าจะมั่นใจ
   (เจ้าของระบบตัดสินใจเรื่อง automation เอง)

## 4. ตรวจสอบว่า setup ถูกต้อง

- ผลลัพธ์ทันทีจากคำสั่ง: บรรทัด `อัปโหลด: สำเร็จ N · ซ้ำ ... · ปฏิเสธ N · ...` —
  **ปฏิเสธต้องเป็น 0** ถ้าไม่ใช่ 0 อ่านเหตุผลที่ขึ้นต่อท้ายแต่ละไฟล์
- เช็คว่าไฟล์ถูกบันทึกว่าอัปโหลดแล้วจริง: เปิด `<โฟลเดอร์>/_manifest.json`
  แต่ละไฟล์ต้องมี key `uploaded: { at, fileId }`
- เช็ค Discord: ควรเห็นข้อความสรุปในห้องที่ตั้ง `DISCORD_WEBHOOK_URL_UPLOAD`
  ไว้ (ถ้าตั้ง)
- ดูข้อความที่จะส่งโดยไม่ส่งจริงไม่มีสำหรับขาอัปโหลด (ต่างจากขา export ที่มี
  `notify --dry-run`) — ทดสอบด้วยโฟลเดอร์เดียวจริงแทน

## 5. ข้อควรรู้ / ความเสี่ยงที่ยังเปิดอยู่

- 🔴 **FoodStory `document_type` 42 จาก 46 รายการยังไม่ยืนยันจากทีม uploader** —
  จับคู่เองจาก label ไทย ผิดได้แบบไม่มีอาการ (catalog เช็คแค่ว่า slug มีอยู่จริง
  ไม่เช็คว่าตรงกับรายงานไหม) ขอยืนยันไว้แล้วที่
  `docs/runbooks/UPLOADER-TEAM-REQUESTS.md` § 10 — ยังไม่ปิด ticket 08
- 🔴 **sha256 ของไฟล์ HotelTime ไม่คงที่** — dedupe อาจไม่ทำงานแม้เนื้อหาเดียวกัน
  เสี่ยง retry ซ้ำ (ไม่ใช่ข้อมูลซ้ำ แค่เปลืองรอบ) ยังไม่ได้รับคำตอบจากทีม uploader
- 🟡 **UPLOADER_SEND_EMPTY ปิดไว้ตั้งใจ** — รายงานว่างแท้ ๆ จะยังไม่ถูกประกาศไปที่
  uploader จนกว่า endpoint ฝั่งนั้นจะพร้อม (ticket 14)
- 🟡 **ไม่มี batch สำหรับไฟล์จริง** — ยิง `POST /api/files/ingest` ทีละไฟล์
  1 request ต่อไฟล์เสมอ (batch มีแค่ฝั่งรายงานว่าง) รอบที่มีไฟล์เยอะจะใช้เวลา
  ตามจำนวนไฟล์
- เอกสารอ้างอิงเพิ่ม: `.scratch/exporter-upload-to-uploader/issues/08-foodstory-support.md`
  (สถานะล่าสุด), `docs/runbooks/UPLOADER-TEAM-REQUESTS.md` § 10
