# exporter

ดึงรายงานจากเว็บที่ไม่มี API ด้วย Playwright แล้วเก็บลงดิสก์ — **HotelTime** (PMS โรงแรม, รันอัตโนมัติทุกวันผ่าน Windmill) และ
**FoodStory** (POS ร้านอาหาร, พนักงานดับเบิลคลิกแล้วกด reCAPTCHA เองวันละครั้ง)

> repo นี้เป็นสำเนาสำหรับติดตั้ง — ต้นทางอยู่ใน monorepo ภายใน แล้ว sync มาด้วย `scripts/sync-exporter-repo.sh`
> **อย่าแก้โค้ดในนี้ตรง ๆ** (ครั้งถัดไปที่ sync จะถูกเขียนทับ) — แก้ที่ต้นทางแล้ว sync ใหม่

## โครงสร้าง

| โฟลเดอร์ | คืออะไร |
|---|---|
| `exporter/` | ตัวโปรแกรม (Node.js ≥ 22.18 + Playwright) — เริ่มที่ [`exporter/README.md`](exporter/README.md) |
| `exporter/launchers/` | ไฟล์ดับเบิลคลิกสำหรับพนักงาน (FoodStory รายวัน) |
| `windmill/` | ตัวตั้งเวลาให้ HotelTime รันทุกวัน (Docker) — [`windmill/INSTALL.md`](windmill/INSTALL.md) |
| `docs/` | คู่มือผู้ใช้, สอนใช้ CLI, คู่มือพนักงาน FoodStory (ภาษาไทย) |

## ติดตั้งบน Ubuntu Desktop

ผู้ดูแลระบบติดตั้ง **Node.js 22.18+** และ **Docker (มี docker compose)** เองก่อน แล้วในบัญชีของคนที่จะใช้เครื่อง (ห้ามใส่ sudo):

```bash
git clone https://github.com/Chawengburi/exporter.git
cd exporter
bash deploy/ubuntu/install.sh
```

สคริปต์ติดตั้ง package + Chromium, ถามรหัสผ่าน HotelTime/FoodStory แล้วเขียน `exporter/.env`, สุ่มรหัสฐานข้อมูล Windmill,
วางไอคอน "ดึง FoodStory เมื่อวาน" บน Desktop, เปิด Windmill และลองล็อกอิน HotelTime · รันซ้ำได้เสมอ (ไม่แตะ `.env` ที่มีแล้ว)

| โฟลเดอร์ | คืออะไร |
|---|---|
| `deploy/ubuntu/` | สคริปต์ติดตั้ง (`install.sh`) และตัวทดสอบใน Docker |

## สิ่งที่ไม่อยู่ใน repo นี้ (ตั้งใจ)

- `exporter/.env`, `windmill/.env` — รหัสผ่าน/ค่าตั้ง สร้างจาก `.env.example` บนเครื่องที่ติดตั้ง **ห้าม commit**
- `exporter/data/` — ไฟล์ที่ดึงมา มีข้อมูลลูกค้าและยอดขาย **ห้าม commit / ห้ามส่งต่อ**
- `exporter/.auth/` — session ของเบราว์เซอร์
- บันทึกการสำรวจเว็บ (recon) และเอกสารการตัดสินใจ (ADR) — อยู่ใน monorepo ต้นทาง
