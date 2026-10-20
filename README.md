# exporter

ดึงรายงานจากเว็บที่ไม่มี API ด้วย Playwright แล้วเก็บลงดิสก์ — **HotelTime** (PMS โรงแรม, รันอัตโนมัติทุกวันผ่าน Windmill) และ
**FoodStory** (POS ร้านอาหาร, พนักงานดับเบิลคลิกแล้วกด reCAPTCHA เองวันละครั้ง)

> repo นี้คือต้นทางของโปรเจกต์ (พัฒนาและ commit ที่นี่โดยตรง) · ผู้ดูแลเครื่อง Ubuntu อัปเดตด้วย `git pull` ตามคู่มือ

## โครงสร้าง

| โฟลเดอร์ | คืออะไร |
|---|---|
| `exporter/` | ตัวโปรแกรม (Node.js ≥ 22.18 + Playwright) — เริ่มที่ [`exporter/README.md`](exporter/README.md) |
| `exporter/launchers/` | ไฟล์ดับเบิลคลิกสำหรับพนักงาน (FoodStory รายวัน) |
| `windmill/` | ตัวตั้งเวลาให้ HotelTime รันทุกวัน (Docker) — [`windmill/INSTALL.md`](windmill/INSTALL.md) |
| `docs/` | คู่มือผู้ดูแลระบบ Ubuntu, คู่มือพนักงาน FoodStory, คู่มือผู้ใช้, สอนใช้ CLI (ภาษาไทย) |

## ติดตั้งบน Ubuntu Desktop

ผู้ดูแลระบบติดตั้ง **Node.js 22.18+** และ **Docker (มี docker compose)** เองก่อน และเพิ่ม **deploy key** ของเครื่อง (repo นี้ private —
ขั้นตอนอยู่ใน [`docs/UBUNTU-ADMIN-GUIDE.md`](docs/UBUNTU-ADMIN-GUIDE.md) หัวข้อก่อนติดตั้ง) แล้วในบัญชีของคนที่จะใช้เครื่อง (ห้ามใส่ sudo):

```bash
git clone git@github.com:Chawengburi/exporter.git ~/chawengburi-exporter
cd ~/chawengburi-exporter
bash deploy/ubuntu/install.sh
```

สคริปต์ติดตั้ง package + Chromium, ถามรหัสผ่าน HotelTime/FoodStory แล้วเขียน `exporter/.env`, ตั้งวันเริ่มใช้งานเป็นวันที่ติดตั้ง และถาม
URL ของ Discord webhook (ข้ามได้), สุ่มรหัสฐานข้อมูล Windmill, วางไอคอน "Exporter - FoodStory Daily" บน Desktop, เปิดและตั้งค่า Windmill และลอง
ล็อกอิน HotelTime · รันซ้ำได้เสมอ (ไม่แตะค่าที่มีแล้วใน `.env` — เติมแค่ที่ยังไม่มี)

**คู่มือผู้ดูแลระบบ (ติดตั้ง งานประจำ เช็คสถานะ แก้ปัญหา อัปเดต): [`docs/UBUNTU-ADMIN-GUIDE.md`](docs/UBUNTU-ADMIN-GUIDE.md)**

| โฟลเดอร์ | คืออะไร |
|---|---|
| `deploy/ubuntu/` | สคริปต์ติดตั้ง (`install.sh`) และตัวทดสอบใน Docker |

## สิ่งที่ไม่อยู่ใน repo นี้ (ตั้งใจ)

- `exporter/.env`, `windmill/.env` — รหัสผ่าน/ค่าตั้ง สร้างจาก `.env.example` บนเครื่องที่ติดตั้ง **ห้าม commit**
- `exporter/data/` — ไฟล์ที่ดึงมา มีข้อมูลลูกค้าและยอดขาย **ห้าม commit / ห้ามส่งต่อ**
- `exporter/.auth/` — session ของเบราว์เซอร์
- บันทึกการสำรวจเว็บ (recon) ที่มี path ส่วนตัว — เก็บแยกในที่เก็บเอกสารภายใน ไม่อยู่ใน repo นี้ (เอกสารการตัดสินใจ ADR อยู่ใน `docs/adr/`)
