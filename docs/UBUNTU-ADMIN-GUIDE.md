# คู่มือผู้ดูแลระบบ: exporter บน Ubuntu

เครื่อง Ubuntu นี้ดึงรายงานจากเว็บที่ไม่มี API มาเก็บไว้เองทุกวัน: **HotelTime** (ระบบโรงแรม) และ **FoodStory** (ระบบร้านอาหาร) รันเอง
ตอนเที่ยงผ่าน Windmill แล้วอัปโหลดเข้า uploader ต่อ (FoodStory แก้ captcha เองด้วย 2captcha — ไม่ต้องมีคนกด) · ไอคอน FoodStory บน
Desktop เหลือไว้เป็นทางสำรองเมื่อ Discord แจ้งว่ารอบอัตโนมัติล้ม · คู่มือนี้สำหรับผู้ดูแลเครื่อง — ไม่ต้องเขียนโปรแกรม
แค่พิมพ์คำสั่งใน Terminal ตามที่เขียนไว้ (ก๊อปวางได้ทั้งบรรทัด)

> **เครื่องไหน:** เครื่อง Ubuntu Desktop ที่ใช้งานจริง (ข้อมูลจริงของโรงแรมและร้าน) · เป็นเครื่องเดียวที่ export/อัปโหลดขึ้น production · Mac ของผู้พัฒนาเป็นเครื่อง dev/test แยกกัน (อย่าเปิด schedule ของ Windmill บน Mac — จะอัปโหลดซ้ำ)
> **สถานะ (2026-10-27):** ใช้งานจริงตั้งแต่ 2026-10-20 · HotelTime และ FoodStory รันเองตามเวลา (12:00 + เก็บตก 15:00 / 18:00) พร้อมอัปโหลด ตรวจแล้วเขียวต่อเนื่อง 25–27 ต.ค. · ยังไม่ได้ประกาศรายงานว่าง (`empty`) ไปที่ uploader — ปิดอยู่จนกว่าจะยืนยันกับทีม uploader
> **ทุกคำสั่งใช้โฟลเดอร์ `~/chawengburi-exporter`** (ที่ clone มา — ข้างในมี `exporter/`, `windmill/`, `deploy/ubuntu/`, `docs/`)

## ภาพรวม

| งาน | ใครทำ | เมื่อไหร่ | ไฟล์ไปอยู่ที่ |
| --- | --- | --- | --- |
| HotelTime รายวัน — **รายงานตามวัน** 22 ตัวของเมื่อวาน + **รายงาน snapshot** 26 ตัว ณ ตอนนั้น | Windmill รันเอง | ทุกวัน 12:00 (ราว 3–10 นาที) · เก็บตก 15:00 / 18:00 | `exporter/data/hoteltime/daily/<เดือน>/<วันของข้อมูล>/` |
| FoodStory รายวัน — รายงานตามวัน 42 ตัวของเมื่อวาน + รายงาน snapshot 7 ตัว | Windmill รันเอง (แก้ captcha ด้วย 2captcha) · ไอคอน "Exporter - FoodStory Daily" ไว้เป็นทางสำรอง | ทุกวัน 12:00 · เก็บตก 15:00 / 18:00 | `exporter/data/foodstory/daily/<เดือน>/<วันของข้อมูล>/` |
| FoodStory รายเดือน = **เดือนที่แล้ว** | ผู้ดูแลระบบ (คำสั่ง · มีคีย์ 2captcha = ไม่ต้องกด captcha) | ต้นเดือน ภายในวันที่ 5 | `exporter/data/foodstory/monthly/<เดือน>/` |
| เช็คว่าระบบปกติไหม | ผู้ดูแลระบบ — หรืออ่านสรุปใน Discord | ทุกวัน หลัง 19:00 | — |

- **รายงานตามวัน** (รายการจอง, โพสต์บัญชี, ยอดขาย ฯลฯ) ได้ไฟล์ละ **วันของข้อมูล** เช่น `2026-10-13__postings.xlsx` · **รายงาน snapshot** (สถานะห้อง
  สต็อก ยอดสะสม) เป็น snapshot ณ เวลาที่ดึง ชื่อไฟล์เป็นเวลาที่ถ่าย เช่น `20261014T120512+0700__arrivals.xlsx` — snapshot ของวันที่ผ่านไปแล้ว**ดึงย้อนไม่ได้**
- **เติมวันที่ขาดเอง:** วันไหนเครื่องดับหรือรอบนั้นล้ม รอบถัดไป (HotelTime/FoodStory เก็บตก 15:00 / 18:00 หรือรอบเที่ยงวันถัดไป) ดึงวันที่ขาดให้เองตั้งแต่**วันเริ่มใช้งาน**
  (ตัวติดตั้งตั้งให้เป็นวันที่ติดตั้ง) ครั้งละไม่เกิน 3 วัน
- ไฟล์เป็น **ไฟล์ดิบ** ตามที่เว็บต้นทางให้มา (.xlsx) ไม่แปลง — ทุกโฟลเดอร์มี `_manifest.json` (ไฟล์ไหนมาจากหน้าไหน ครอบวันไหน กี่แถว sha256),
  `_summary.txt` (สรุปภาษาไทย อ่านได้) และ `_run.json` (สำหรับโปรแกรม) · **ไม่มีอะไรถูกลบอัตโนมัติ** ข้อมูลสะสมไปเรื่อย ๆ · ดึงวันเดิมซ้ำ
  ฉบับเก่าย้ายไป `_superseded/` ในโฟลเดอร์เดียวกัน

## ก่อนติดตั้ง (ผู้ดูแลระบบทำเอง)

1. บัญชีผู้ใช้ปกติที่ใช้ `sudo` ได้ — ติดตั้งและใช้งานด้วยบัญชีนี้ **ไม่ใช่ root**
2. **Node.js 22.18 ขึ้นไป** — `apt` ของ Ubuntu เองเก่าเกินไป ใช้ [NodeSource](https://github.com/nodesource/distributions) (สาย 22.x) หรือ
   ตัวติดตั้งจาก [nodejs.org](https://nodejs.org/en/download) · เช็ค: `node --version`
3. **Docker Engine + docker compose** ตาม [คู่มือ Docker สำหรับ Ubuntu](https://docs.docker.com/engine/install/ubuntu/) แล้วทำ
   [ขั้นหลังติดตั้ง](https://docs.docker.com/engine/install/linux-postinstall/): `sudo usermod -aG docker $USER` แล้ว **logout/login ใหม่** ·
   เช็ค: `docker compose version` และ `docker info` (ต้องไม่ขึ้น permission denied)
4. `git` และ `ssh`: `sudo apt install git openssh-client`
5. **สิทธิ์อ่าน repo `Chawengburi/exporter` (private)** — GitHub ไม่รับรหัสผ่านบัญชีตอน clone แล้ว ใช้ **deploy key** (กุญแจของเครื่องนี้
   อ่านได้อย่างเดียว เฉพาะ repo นี้):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/chawengburi_exporter -N "" -C "exporter-ubuntu"
   cat ~/.ssh/chawengburi_exporter.pub
   ```

   ส่งบรรทัดที่ขึ้น (ขึ้นต้นด้วย `ssh-ed25519`) ให้เจ้าของ repo เพิ่มที่ GitHub → repo → Settings → Deploy keys → Add deploy key
   (**ไม่ติ๊ก** Allow write access) · แล้วบอก git ให้ใช้กุญแจนี้:

   ```bash
   printf 'Host github.com\n  IdentityFile ~/.ssh/chawengburi_exporter\n  IdentitiesOnly yes\n' >> ~/.ssh/config
   ssh -T git@github.com     # ครั้งแรกตอบ yes · ต้องขึ้น "...successfully authenticated..."
   ```

   ส่งได้เฉพาะไฟล์ `.pub` · **ห้ามส่งไฟล์ `~/.ssh/chawengburi_exporter` (ไม่มี .pub) ให้ใคร**
6. รหัส HotelTime และ FoodStory (อีเมล/รหัสผ่าน/ชื่อสาขา) — ตัวติดตั้งจะถาม · และ **คีย์ 2captcha** (ตัวติดตั้งถามให้ ข้ามได้ แต่ไม่มีคีย์ FoodStory จะรันเองไม่ได้ — ดูหัวข้อ "FoodStory รันเองทุกวันบน Windmill")
7. (ไม่บังคับ) URL ของ **Discord webhook** ของห้องที่จะรับสรุปรายวัน/แจ้งเตือน — Discord → ตั้งค่าห้อง → Integrations → Webhooks → New Webhook
   → Copy Webhook URL · ข้ามไปก่อนได้ ตั้งทีหลังได้ (หัวข้อ "แจ้งเตือนทาง Discord")

## ติดตั้ง

```bash
git clone git@github.com:Chawengburi/exporter.git ~/chawengburi-exporter
bash ~/chawengburi-exporter/deploy/ubuntu/install.sh
```

ตัวติดตั้งทำ 9 ขั้นเอง: เช็ค Node.js → ติดตั้ง package → ติดตั้ง Chromium (ถามรหัส sudo ครั้งแรก) → **ถามรหัส HotelTime/FoodStory**
(รหัสผ่านไม่แสดงบนจอ · ชื่อสาขากด Enter = ใช้ค่าตั้งต้น "Chaweng Buri Resort") → **ตั้งวันเริ่มใช้งานเป็นวันนี้ และถาม URL ของ Discord
webhook** (ไม่แสดงบนจอ · กด Enter เฉย ๆ = ข้าม) → สุ่มรหัสฐานข้อมูล Windmill → วางไอคอน FoodStory บน Desktop → เปิดและตั้งค่า Windmill
(รหัส admin, ตารางเวลา 12:00 / 15:00 / 18:00) → ลองล็อกอิน HotelTime

- จบครบทุกขั้น: ขึ้น **✅ ติดตั้งเสร็จ** หรือ **⚠️ ติดตั้งส่วนของโปรแกรมแล้ว — ยังต้องทำอีก N อย่าง** พร้อมรายการ
- หยุดกลางทาง: ขึ้น **✘ …** พร้อมวิธีแก้ (และรายการที่ยังต้องทำ ถ้ามี)
- ทั้งสองแบบ: ทำตามที่บอก แล้ว **รันคำสั่งติดตั้งเดิมซ้ำ** — รันซ้ำปลอดภัย ไม่ถามรหัสซ้ำ ไม่แตะค่าที่ตั้งไว้แล้ว (เติมแค่วันเริ่มใช้งาน/URL ของ
  Discord ถ้ายังไม่มี — เครื่องที่ติดตั้งก่อนมีสองค่านี้ รันซ้ำครั้งเดียวก็ได้ครบ)
- ครั้งแรกที่เปิด Windmill จะ build ตัวรันที่มี Chromium ใช้หลายนาที — ปกติ
- ตัวเลือกสำหรับกรณีพิเศษ: `--skip-windmill` (ยังไม่เปิด Windmill) · `--no-login-check` (ไม่ลองล็อกอิน HotelTime)

**หลังติดตั้งเสร็จ (ครั้งแรกเท่านั้น)**
1. ทดสอบ login FoodStory: `cd ~/chawengburi-exporter/exporter && node src/index.ts login --site foodstory --check --json` ต้องเห็น `"ok": true` (เสียเครดิต 2captcha 1 ครั้ง) · ไอคอน "Exporter - FoodStory Daily" บน Desktop เป็นทางสำรองเมื่อรอบอัตโนมัติล้ม (ครั้งแรกอาจต้องคลิกขวา → **Allow Launching**) ดู
   [คู่มือพนักงาน](FOODSTORY-DAILY-STAFF-GUIDE.md)
2. ดึง FoodStory รายเดือนของเดือนที่แล้วหนึ่งรอบ (หัวข้อ "FoodStory รายเดือน") — เครื่องใหม่เริ่มเก็บข้อมูลจากศูนย์ · ตั้งค่าขาอัปโหลดตาม [UPLOAD-SETUP-UBUNTU.md](UPLOAD-SETUP-UBUNTU.md) (`UPLOADER_*` ใน `.env` — ตัวติดตั้งถามให้ตอนติดตั้ง/อัปเดตถ้ายังไม่มี)
3. เช็คสถานะ (หัวข้อถัดไป) — **วันแรกจะขึ้น ✘ "ยังไม่เคยมีรอบ HotelTime เลย" เป็นเรื่องปกติ** จนกว่ารอบเที่ยงจะรัน · เช็คอีกครั้ง
   หลัง 15:00 ต้องเห็น ✔ · วันเริ่มใช้งาน = วันที่ติดตั้ง ข้อมูลวันแรกที่ระบบดูแลจึงเป็นของวันนี้ (ดึงพรุ่งนี้เที่ยง) — ข้อมูลก่อนหน้านั้นดึงย้อน
   ได้ทีละวันด้วย `--date` (หัวข้อ "ดึงวันเดิมใหม่")

## เช็คว่าระบบปกติไหม

```bash
cd ~/chawengburi-exporter/exporter && node src/index.ts status
```

สรุปหน้าเดียว: ต่อระบบ บรรทัดละ**วันของข้อมูล** (ย้อน 7 วัน) — รายงานตามวัน **มีข้อมูล** กี่ตัว · **ว่าง** ตัวไหน (เว็บไม่มีรายการวันนั้นจริง ไม่ใช่
ปัญหา) · **ล้ม** ตัวไหน (พร้อมสาเหตุ) · **ยังไม่ได้ดึง** ตัวไหน — และรายงาน snapshot ของวันนั้นครบไหม · snapshot ปิดงวด (ยอดทั้งเดือน/ปีที่จบแล้ว) แยกบรรทัด ·
ท้ายสุดคือค่าตั้งของเครื่อง (วันเริ่มใช้งาน, Discord)

✔ ปกติ · ⏳ รอ (ยังไม่ถึงรอบเที่ยง, กำลังรัน, รอรอบเก็บตก) · ⚠ สิ่งที่ต้องทำ (เครื่องที่ไม่มีคีย์ 2captcha: FoodStory ไม่ได้กดมา N วัน; เครื่องที่มีคีย์: login FoodStory ล้ม, รายเดือนเลยวันที่ 5 แล้ว, ขาดเกินที่รอบ
เดียวเติมได้, ยังไม่ตั้งวันเริ่มใช้งาน/Discord) · ✘ ปัญหา (HotelTime ยังขาด/ล้มหลังรอบเก็บตก, snapshot ปิดงวดล้ม) · `·` ข้อมูลเฉย ๆ (เช่น
รายงาน snapshot ของวันที่ผ่านไปแล้วที่หาย — **หายถาวร เติมไม่ได้** ไม่มีอะไรให้ทำ)

**บรรทัดสุดท้ายบอกเรื่องที่หนักที่สุด:** ✅ ปกติ / ⚠ มีสิ่งที่ต้องทำ / ✘ ต้องดู · ย้อนดูมากกว่า 7 วัน: เติม `--days 14` ท้ายคำสั่ง ·
exit code (สำหรับต่อกับระบบแจ้งเตือนภายหลัง): 0 = ปกติหรือมีแค่สิ่งที่ต้องทำ, 1 = มีปัญหา, 2 = พิมพ์คำสั่งผิด

**ดูรายละเอียดเพิ่ม**
- รายงานไหนล้มด้วยข้อความอะไร: `cat ~/chawengburi-exporter/exporter/data/hoteltime/daily/latest/_summary.txt` (HotelTime วันล่าสุด) ·
  วันอื่น/FoodStory: เปิดโฟลเดอร์ตามตารางภาพรวมแล้วอ่าน `_summary.txt`
- ประวัติการรันของ HotelTime: เปิด <http://localhost:8000/runs> บนเครื่องนี้ · ล็อกอิน `admin@windmill.dev` รหัสดูด้วย
  `cat ~/chawengburi-exporter/windmill/.admin-password`
- log ของ Windmill: `cd ~/chawengburi-exporter/windmill && docker compose logs --tail 100`

## แจ้งเตือนทาง Discord

- **สรุปรอบ** ทุกรอบรายวัน (12:00 / 15:00 / 18:00 ของทั้ง HotelTime และ FoodStory + ตอนกดไอคอน FoodStory สำรอง) เป็นข้อความภาษาอังกฤษสั้น ๆ แบบ log: เวลา · ที่มาของรอบ · ระยะเวลา · แต่ละระบบ ok/ว่าง/ล้ม กี่รายงาน + snapshot ของวันนี้ — **รอบไหนไม่มีข้อความสรุป แปลว่ารอบนั้นไม่ได้รัน** ให้เช็คสถานะ
- **แจ้งเตือนทันที** เมื่อ: รายงานยังล้ม/ขาดหลังรอบเก็บตก · รายงาน snapshot ของวันนี้ถ่ายไม่ได้ · snapshot ปิดงวดล้ม · วันขาดเกินที่รอบเดียวเติมได้ ·
  FoodStory ไม่ได้กดมา 2 วันขึ้นไป (เครื่องไม่มีคีย์ 2captcha) หรือ login FoodStory ล้ม — เรื่องเดียวกันไม่ส่งซ้ำในวันเดียว (ยังไม่หาย = เตือนอีกวันละครั้ง)
- ตั้ง/เปลี่ยน URL: `nano ~/chawengburi-exporter/exporter/.env` บรรทัด `DISCORD_WEBHOOK_URL_EXPORT=` (สรุป/แจ้งเตือนขา export ด้านบน) และ
  `DISCORD_WEBHOOK_URL_UPLOAD=` (แจ้งเตือนขาอัปโหลด `exporter upload` — คนละ channel, เจ้าของระบบขอ 2026-10-18) · **ทั้งสอง URL เป็นความลับ**
  (ใครมีก็โพสต์เข้าห้องได้) ไม่มี URL = ข้ามการส่งของขานั้น ไม่ทำให้รอบล้ม
- ดูข้อความที่จะส่งโดยไม่ส่งจริง: `cd ~/chawengburi-exporter/exporter && node src/index.ts notify --dry-run --summary` · ส่งสรุปของวันนี้เอง:
  `node src/index.ts notify --summary`
- ส่งไม่ได้ (Discord ล่ม) ไม่ทำให้รอบล้ม — บันทึกไว้ใน `exporter/data/_notify/discord.json` แล้วส่งต่อในรอบถัดไปเอง

## ดึงวันเดิมใหม่ (HotelTime)

- **วันเดียว:** `cd ~/chawengburi-exporter/exporter && node src/index.ts export --report all --date 2026-10-12` — ดึงรายงานตามวันของวันนั้นใหม่
  ทั้ง 22 ตัว (ไม่สนว่าเคยได้แล้ว) ฉบับเก่าย้ายไป `_superseded/` · ใช้ได้ถึงเมื่อวาน · รายงาน snapshot ดึงย้อนไม่ได้
- **หลายวัน (baseline):** `node src/index.ts export --report all --baseline --from 01/10/2026 --to 13/10/2026` — ไฟล์ละวันของข้อมูลชื่อเดียวกับ
  รอบรายวัน ลงโฟลเดอร์ `data/hoteltime/baseline/<วันที่รัน>/` (โฟลเดอร์รายวันไม่ถูกแตะ) ไว้เทียบว่ามีการแก้ข้อมูลย้อนหลัง · ไม่ใส่ `--from/--to`
  = 30 วันล่าสุดถึงเมื่อวาน · ใช้เวลาราววันละ 2–3 นาที — **อย่ารันช่วงที่ Windmill รันอยู่**
- FoodStory ไม่มีคำสั่งดึงย้อนรายวัน — รอบถัดไป (หรือการกดไอคอนสำรอง) เติมวันที่ขาดให้เอง (ครั้งละ 3 วัน) และรอบรายเดือนเก็บการแก้ย้อนหลัง

## FoodStory รายเดือน (ต้นเดือน)

```bash
cd ~/chawengburi-exporter/exporter && node src/index.ts export --site foodstory --report all --headful
```

เครื่องที่ตั้งคีย์ 2captcha ไว้แล้ว: **ไม่ต้องมี `--headful`** (login แก้ captcha เอง — `exporter status` ก็แสดงคำสั่งแบบไม่มี `--headful`) · ถ้ายังไม่มีคีย์: เบราว์เซอร์เปิดขึ้นมา → กด captcha + เข้าสู่ระบบภายใน 5 นาที → ปล่อยไว้จนจบ (~5 นาที) · ดึงเดือนเดิมซ้ำวันอื่นได้โฟลเดอร์ใหม่
(`<เดือน>__<วันที่ดึง>`) ไม่ทับของเดิม · สถานะรวมผลทุกโฟลเดอร์ของเดือนให้

## เมื่อมีปัญหา

| ขึ้นข้อความ | ทำอย่างนี้ |
| --- | --- |
| ตัวติดตั้ง: `อย่ารันด้วย sudo/root` | รันใหม่โดยไม่ใส่ `sudo` ในบัญชีผู้ใช้ปกติ |
| ตัวติดตั้ง: `ไม่พบ Node.js` / `Node.js รุ่น ... เก่าเกินไป` | ติดตั้ง/อัปเดต Node.js ตามหัวข้อก่อนติดตั้ง แล้วเปิด Terminal ใหม่ |
| ตัวติดตั้ง: `ติดตั้ง package ไม่สำเร็จ` / `ดาวน์โหลด Chromium ไม่สำเร็จ` | เช็คอินเทอร์เน็ต แล้วรันตัวติดตั้งซ้ำ |
| ตัวติดตั้ง: `บัญชีนี้ใช้ sudo ไม่ได้ แต่ Chromium ยังขาด library ของระบบ` | ผู้ที่มี sudo รันคำสั่งที่ขึ้นบนจอครั้งเดียว แล้วรันตัวติดตั้งซ้ำ |
| ตัวติดตั้ง: `ติดตั้งแล้วแต่ Chromium ยังเปิดไม่ได้` | ถ่ายรูปหน้าจอส่งผู้พัฒนา |
| ตัวติดตั้ง: `ยังต้องทำ ... ติดตั้ง Docker` / `ให้สิทธิ์ Docker` / `เปิด Docker` | ทำตามคำสั่งในบรรทัดนั้น (ให้สิทธิ์แล้วต้อง logout/login) แล้วรันตัวติดตั้งซ้ำ |
| ตัวติดตั้ง: `เปิด Windmill ไม่สำเร็จ` | พอร์ต 8000 อาจมีโปรแกรมอื่นใช้อยู่ (`sudo ss -ltnp \| grep 8000`) หรือ build ล้ม — ดู `cd ~/chawengburi-exporter/windmill && docker compose logs --tail 50` |
| ตัวติดตั้ง: `ล็อกอิน HotelTime ไม่ได้` | เช็คชื่อผู้ใช้/รหัสผ่าน (หัวข้อ "เปลี่ยนรหัสผ่าน") แล้วรันซ้ำ |
| ตัวติดตั้ง: `ตั้งค่า Windmill ไม่สำเร็จ` | อ่านข้อความด้านบนบรรทัดนั้น แก้แล้วรัน `node ~/chawengburi-exporter/windmill/setup.mjs` |
| `setup.mjs`: `ต่อ Windmill ที่ ... ไม่ได้ภายใน 3 นาที` | `cd ~/chawengburi-exporter/windmill && docker compose ps` — ทุก service ต้อง Up · ไม่ขึ้น: `docker compose up -d` |
| `setup.mjs`: `ล็อกอิน admin@windmill.dev ด้วยรหัสใน windmill/.admin-password ไม่ได้` หรือ `... ไม่ใช่ค่าเริ่มต้นแล้ว แต่ไม่มีไฟล์ windmill/.admin-password` | มีคนเปลี่ยนรหัสในหน้าเว็บ — ใส่รหัสปัจจุบันลงไฟล์ `~/chawengburi-exporter/windmill/.admin-password` (บรรทัดเดียว) แล้วรัน `setup.mjs` ซ้ำ |
| ไอคอน FoodStory: `ไม่พบไฟล์ตั้งค่า .env` / `โปรแกรมยังติดตั้งไม่ครบ` / `ไม่พบโปรแกรม Node.js` | รันตัวติดตั้งซ้ำ |
| ไอคอน FoodStory: `⚠️ ได้บางส่วน` | ดับเบิลคลิกใหม่ (รายงานที่ได้แล้วไม่หาย) · ซ้ำสองรอบ: ดู `_summary.txt` ของเมื่อวาน แจ้งผู้พัฒนา |
| ไอคอน FoodStory: `❌ ไม่สำเร็จ — ยังไม่ได้รายงาน` | ส่วนใหญ่กด captcha ไม่ทัน 5 นาที หรือเน็ตหลุด — ดับเบิลคลิกใหม่ |
| ไอคอน FoodStory: `❌ ไม่สำเร็จ — เข้าสู่ระบบได้ แต่ไม่ได้รายงานเลย` | เว็บ FoodStory อาจเปลี่ยนหน้าตา — ถ่ายรูปหน้าจอ แจ้งผู้พัฒนา |
| ไอคอน FoodStory: `⏳ มีการดึงรายงาน FoodStory รันอยู่แล้ว` | มีหน้าต่างอื่นรันอยู่ — รอให้จบ (ถ้าไม่มีจริง ๆ ระบบจะปลดล็อกเองตอนดับเบิลคลิกครั้งถัดไป) |
| สถานะ: `รอบเที่ยงไม่ได้ดึง — ดู Windmill` / `... ยังไม่ได้ดึง N (...) — รอบถัดไปเติมเอง` / `รอบไม่จบ` | เครื่องดับ/Docker ไม่ทำงานตอนนั้น — เช็ค <http://localhost:8000/runs> และ `docker compose ps` · เปิดกลับมาแล้ว รอบถัดไปเติมวันที่ขาดให้เอง (ครั้งละ 3 วัน) |
| สถานะ: `... ล้ม N (...)` | ดู `_summary.txt` ของวันนั้น (ตารางถัดไป) · HotelTime และ FoodStory: รอบเก็บตกถัดไป (15:00 / 18:00 / เที่ยงพรุ่งนี้) ลองซ้ำเอง · FoodStory ล้มทั้งวัน: ดูหัวข้อ "FoodStory รันเองทุกวัน" (คีย์/ยอดเงิน 2captcha) แล้วค่อยดับเบิลคลิกไอคอนสำรอง |
| สถานะ: `snapshot ... หายถาวร เติมไม่ได้` | วันนั้นไม่มีรอบไหนถ่ายรายงาน snapshot ได้ — ไม่มีอะไรให้ทำ (ดึงย้อนไม่ได้) · ถ้าเป็นทุกวันให้เช็คว่า Windmill/การกดทำงาน |
| สถานะ: `ขาดอีก N วันของข้อมูล เกินที่รอบเดียวเติมได้` | HotelTime: รอได้ (วันละ 3 รอบ × 3 วัน) หรือดึงเองทีละวันด้วย `--date` · FoodStory: รอรอบเก็บตกถัดไป หรือดับเบิลคลิกไอคอนสำรอง ครั้งละ 3 วัน |
| สถานะ: `ยังไม่ได้ตั้งวันเริ่มใช้งาน` / `วันเริ่มใช้งาน ... อยู่หลังวันนี้` | รันตัวติดตั้งซ้ำ (ตั้งเป็นวันนี้ให้) หรือแก้ `EXPORTER_GO_LIVE=YYYY-MM-DD` ใน `exporter/.env` |
| สถานะ: `ยังไม่ได้ตั้ง URL ของ Discord webhook` | หัวข้อ "แจ้งเตือนทาง Discord" |
| สถานะ: `_run.json ของ ... อ่านไม่ได้ (ไฟล์เสีย)` | อย่าลบไฟล์ — ถ่ายรูปหน้าจอส่งผู้พัฒนา |

**ข้อความที่พบบ่อยใน `_summary.txt`**

| ข้อความ | หมายความว่า |
| --- | --- |
| `Timeout 60000ms exceeded` | เว็บต้นทางช้า — ระบบลองใหม่ให้เองแล้ว ล้มครั้งเดียวมักหายวันถัดไป · ล้มทุกวัน = แจ้งผู้พัฒนา |
| `ล็อกอินไม่สำเร็จ — ยังอยู่ที่หน้า login หลังกด Submit` | รหัส HotelTime ผิด หรือบัญชีถูกล็อก — เช็ครหัส อย่าลองซ้ำหลายรอบ (บัญชีอาจถูกล็อก) |
| `... ยังชนเพดาน 2000 แถว` | ข้อมูลวันเดียวเยอะเกินที่ดึงได้ — แจ้งผู้พัฒนา |

แจ้งผู้พัฒนาทุกครั้ง: ส่งรูปหน้าจอ + `_summary.txt` ของวันนั้น · **ห้ามส่งไฟล์ข้อมูล (.csv / .xlsx) หรือไฟล์ .env / .admin-password**

## อัปเดตโปรแกรม

```bash
cd ~/chawengburi-exporter && git pull && bash deploy/ubuntu/install.sh
```

- **อย่าอัปเดตช่วง 11:55–12:45 และช่วง 15:00 / 18:00** (HotelTime และ FoodStory กำลังรัน — เข้าคิวต่อกัน) หรือตอนมีคนกดไอคอนสำรองของ FoodStory อยู่
- ตัวติดตั้งรันซ้ำปลอดภัย: ไม่ถามรหัสซ้ำ ไม่แตะค่าใน `.env` (เติมแค่ที่ยังไม่มี) ติดตั้ง package ใหม่เฉพาะเมื่อเปลี่ยน และ deploy สคริปต์ Windmill
  ที่เปลี่ยนให้เอง
- 🔴 **ต้องรัน `bash deploy/ubuntu/install.sh` ทุกครั้งหลัง `git pull`** — ไม่ใช่ `git pull` เฉย ๆ แล้วไปตั้ง Windmill ต่อเลย · install.sh เป็น
  ตัวที่ติดตั้ง package ใหม่ให้ (เช่นรอบที่เพิ่ม `@2captcha` สำหรับ FoodStory) · ถ้าลืม HotelTime **ยังรันได้** (ออกแบบให้ไม่ผูกกับ package
  ของ FoodStory) แต่ FoodStory จะ error จนกว่าจะรัน install.sh
- ถ้าผู้พัฒนาบอกว่าตัวรัน Windmill เปลี่ยน: `cd ~/chawengburi-exporter/windmill && docker compose up -d --build`
- อย่าแก้ไฟล์ใน `~/chawengburi-exporter` เอง (ยกเว้น `.env`) — `git pull` ครั้งต่อไปจะชนกัน

## FoodStory รันเองทุกวันบน Windmill (2captcha)

Windmill รัน FoodStory **เวลาเดียวกับ HotelTime**: รอบรายวัน 12:00 และรอบเก็บตก 15:00 / 18:00 (job `foodstory_export_daily` และ
`foodstory_export_daily_catchup` — ตัวติดตั้งตั้งให้เอง) · แต่ละรอบดึงรายงานรายวันของ FoodStory แล้วอัปโหลดเข้า uploader ต่อ · login แก้
reCAPTCHA เองด้วยบริการ 2captcha (ADR-0010) จึงต้องมีคีย์ — ตัวติดตั้งถามให้ตอนติดตั้ง/อัปเดตถ้ายังไม่มี หรือใส่เอง:

```bash
nano ~/chawengburi-exporter/exporter/.env
```

เพิ่ม/แก้บรรทัด `TWOCAPTCHA_API_KEY=` ใส่คีย์จาก 2captcha.com (เติมเงินแล้ว) · 🔴 เป็นความลับ + บริการเสียเงิน ห้ามส่งให้ใครหรือ commit

- ทดสอบ: `cd ~/chawengburi-exporter/exporter && node src/index.ts login --site foodstory --check --json` → เห็น `"ok": true` = แก้ captcha เองได้
- ไม่มีคีย์ = รอบตามเวลาของ FoodStory **ล้มทันที** แล้ว Discord แจ้งว่า "FoodStory login failed — ไม่มีคีย์ 2captcha …" (ไม่ค้างรอ) ·
  ไอคอน FoodStory บน Desktop ยังใช้ได้ (คนแก้ captcha เอง)
- ยอดเงิน 2captcha ต่ำกว่า $1: Discord ขา export เตือน "2captcha balance low" วันละครั้ง (เช็คหลังรอบ FoodStory ที่รันเอง) — เติมเงินที่ 2captcha.com
- login ล้มด้วยเหตุผลอื่น (เช่น ยอดเงิน 2captcha หมด) = Discord แจ้งบรรทัดเดียวพร้อมเหตุผล · รอบเก็บตกถัดไปลองใหม่เอง · ล้มทั้งวัน = เช็คยอดเงินที่
  2captcha.com และดู log ของรอบใน Windmill
- อัปโหลดล้ม **ไม่ทำให้ job ใน Windmill ขึ้นแดง** — ไฟล์ที่ uploader ปฏิเสธแจ้งทีละไฟล์ใน Discord ขา upload · ไฟล์ค้างดูได้ที่ `exporter status`

### หยุด FoodStory รอบอัตโนมัติชั่วคราว

เข้า http://localhost:8000/schedules → ปิดสวิตช์ของ `foodstory_export_daily` และ `foodstory_export_daily_catchup` · 🔴 การรันตัวติดตั้ง
(อัปเดตโปรแกรม) หรือ `node windmill/setup.mjs` ครั้งถัดไป **เปิดคืนให้เอง** (ตั้งใจ — ซ่อม schedule ที่ถูกปิดโดยไม่ตั้งใจ) ถ้าจะหยุดยาวให้แจ้งผู้พัฒนา

### ครั้งแรกหลังอัปเดตเป็นเวอร์ชันที่มี FoodStory รันเอง

1. อัปเดตตามหัวข้อ "อัปเดตโปรแกรม" (ใส่คีย์ 2captcha เมื่อถูกถาม) · ทดสอบ login ตามข้างบน
2. **อัปโหลด FoodStory เองหนึ่งครั้งก่อน** — รอบแรกส่งไฟล์ค้างทั้งหมดตั้งแต่วันเริ่มใช้งาน: `cd ~/chawengburi-exporter/exporter && node src/index.ts upload --site foodstory`
   แล้วดู Discord ขา upload ว่ามีไฟล์ถูกปฏิเสธไหม
3. ดูรอบ 12:00 แรกที่ http://localhost:8000/runs (ต้องขึ้นเขียวทั้ง HotelTime และ FoodStory) และสรุปใน Discord ขา export

## เปลี่ยนรหัสผ่าน HotelTime / FoodStory

```bash
nano ~/chawengburi-exporter/exporter/.env
```

แก้บรรทัด `HOTELTIME_PASSWORD=` หรือ `FOODSTORY_PASSWORD=` แล้ว Ctrl+O, Enter, Ctrl+X

- ตัวติดตั้งเขียนค่าไว้ในเครื่องหมายคำพูด เช่น `HOTELTIME_PASSWORD='p#ss word'` — **แก้แค่ข้างในเครื่องหมาย เก็บเครื่องหมายไว้**
- รหัสที่มี `'` อยู่ข้างใน ให้ครอบด้วย `"..."` แทน · มีทั้ง `'` และ `"` → แจ้งผู้พัฒนา
- เช็ค HotelTime: `cd ~/chawengburi-exporter/exporter && node src/index.ts login --site hoteltime --check` (ไม่ต้องกดอะไร) ·
  FoodStory เช็คด้วย `node src/index.ts login --site foodstory --check --json` (เสียเครดิต 2captcha 1 ครั้ง) หรือรอรอบตามเวลาถัดไป · Windmill อ่าน `.env` ใหม่เองทุกรอบ ไม่ต้องรีสตาร์ท

## ข้อมูล พื้นที่ดิสก์ และการสำรอง

- ข้อมูลทั้งหมดอยู่ใน `~/chawengburi-exporter/exporter/data/` — **มีชื่อแขก ข้อมูลติดต่อ และยอดขาย**: ห้ามส่งต่อออกนอกองค์กร
  ห้ามอัปโหลดขึ้นที่อื่น
- โปรแกรมไม่ลบไฟล์เก่าเลย (ตั้งใจ) — ดูขนาด: `du -sh ~/chawengburi-exporter/exporter/data` (วันละราว 3–4 MB + รายเดือนราว 22 MB)
- สำรองข้อมูล: ก๊อปทั้งโฟลเดอร์ `data/` ไปดิสก์ที่เข้ารหัส (เช่น `rsync -a ~/chawengburi-exporter/exporter/data/ <ปลายทาง>/`) — ความถี่และที่เก็บ
  ให้เจ้าของระบบตัดสิน
- การลบข้อมูลเก่าเป็นการตัดสินใจของเจ้าของระบบเท่านั้น

## ความปลอดภัย

- ไฟล์ลับ อ่านได้เฉพาะบัญชีที่ติดตั้ง (สิทธิ์ 600) และไม่อยู่ใน git: `exporter/.env` (รหัส HotelTime/FoodStory, URL ของ Discord webhook), `windmill/.env`
  (รหัสฐานข้อมูล), `windmill/.admin-password` (รหัส admin ของ Windmill), `~/.ssh/chawengburi_exporter` (กุญแจ deploy) — ห้ามส่งต่อ ห้าม commit
- หน้าเว็บ Windmill เปิดเฉพาะบนเครื่องนี้ (`127.0.0.1:8000`) เครื่องอื่นในวงแลนเข้าไม่ได้
- โฟลเดอร์ `exporter/.auth/` (ถ้ามี) เก็บ session ของเบราว์เซอร์ — ปฏิบัติเหมือนไฟล์ลับ
