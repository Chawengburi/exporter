# คู่มือผู้ดูแลระบบ: exporter บน Ubuntu

เครื่อง Ubuntu นี้ดึงรายงานจากเว็บที่ไม่มี API มาเก็บไว้เองทุกวัน: **HotelTime** (ระบบโรงแรม) รันเองตอนเที่ยงผ่าน Windmill ส่วน
**FoodStory** (ระบบร้านอาหาร) พนักงานดับเบิลคลิกไอคอนแล้วกด captcha วันละครั้ง · คู่มือนี้สำหรับผู้ดูแลเครื่อง — ไม่ต้องเขียนโปรแกรม
แค่พิมพ์คำสั่งใน Terminal ตามที่เขียนไว้ (ก๊อปวางได้ทั้งบรรทัด)

> **เครื่องไหน:** เครื่อง Ubuntu Desktop ที่ใช้ทดลองใช้งานจริง (ข้อมูลจริงของโรงแรมและร้าน) · Mac ของผู้พัฒนาเป็นเครื่อง dev/test แยกกัน
> **สถานะ (2026-10):** ตัวติดตั้งทดสอบแล้วใน Ubuntu 24.04 แบบ container — ยังไม่ได้ลองบนเครื่องจริง คู่มือนี้จะอัปเดตหลังทดลอง
> **ทุกคำสั่งใช้โฟลเดอร์ `~/chawengburi-exporter`** (ที่ clone มา — ข้างในมี `exporter/`, `windmill/`, `deploy/ubuntu/`, `docs/`)

## ภาพรวม

| งาน | ใครทำ | เมื่อไหร่ | ไฟล์ไปอยู่ที่ |
| --- | --- | --- | --- |
| HotelTime รายวัน (48 รายงาน) | Windmill รันเอง | ทุกวัน 12:00 (ใช้ราว 1.5–2 ชม.) · เก็บตก 15:00 / 18:00 | `exporter/data/hoteltime/daily/<เดือน>/<วัน>/` |
| FoodStory รายวัน = **เมื่อวาน** (49 รายงาน) | พนักงานดับเบิลคลิก "ดึง FoodStory เมื่อวาน" + กด captcha | วันละครั้ง เวลาไหนก็ได้ | `exporter/data/foodstory/daily/<เดือน>/<เมื่อวาน>/` |
| FoodStory รายเดือน = **เดือนที่แล้ว** | ผู้ดูแลระบบ (คำสั่ง + กด captcha) | ต้นเดือน ภายในวันที่ 5 | `exporter/data/foodstory/monthly/<เดือน>/` |
| เช็คว่าระบบปกติไหม | ผู้ดูแลระบบ | ทุกวัน หลัง 19:00 | — |

ทุกโฟลเดอร์รอบมี `_summary.txt` (สรุปภาษาไทย อ่านได้) และ `_run.json` (สำหรับโปรแกรม) · **ไม่มีอะไรถูกลบอัตโนมัติ** ข้อมูลสะสมไปเรื่อย ๆ

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
6. รหัส HotelTime และ FoodStory (อีเมล/รหัสผ่าน/ชื่อสาขา) — ตัวติดตั้งจะถาม

## ติดตั้ง

```bash
git clone git@github.com:Chawengburi/exporter.git ~/chawengburi-exporter
bash ~/chawengburi-exporter/deploy/ubuntu/install.sh
```

ตัวติดตั้งทำ 8 ขั้นเอง: เช็ค Node.js → ติดตั้ง package → ติดตั้ง Chromium (ถามรหัส sudo ครั้งแรก) → **ถามรหัส HotelTime/FoodStory**
(รหัสผ่านไม่แสดงบนจอ · ชื่อสาขากด Enter = ใช้ค่าตั้งต้น "Chaweng Buri Resort") → สุ่มรหัสฐานข้อมูล Windmill → วางไอคอน FoodStory บน
Desktop → เปิดและตั้งค่า Windmill (รหัส admin, ตารางเวลา 12:00 / 15:00 / 18:00) → ลองล็อกอิน HotelTime

- จบครบทุกขั้น: ขึ้น **✅ ติดตั้งเสร็จ** หรือ **⚠️ ติดตั้งส่วนของโปรแกรมแล้ว — ยังต้องทำอีก N อย่าง** พร้อมรายการ
- หยุดกลางทาง: ขึ้น **✘ …** พร้อมวิธีแก้ (และรายการที่ยังต้องทำ ถ้ามี)
- ทั้งสองแบบ: ทำตามที่บอก แล้ว **รันคำสั่งติดตั้งเดิมซ้ำ** — รันซ้ำปลอดภัย ไม่ถามรหัสซ้ำ ไม่แตะไฟล์ตั้งค่าที่มีแล้ว
- ครั้งแรกที่เปิด Windmill จะ build ตัวรันที่มี Chromium ใช้หลายนาที — ปกติ
- ตัวเลือกสำหรับกรณีพิเศษ: `--skip-windmill` (ยังไม่เปิด Windmill) · `--no-login-check` (ไม่ลองล็อกอิน HotelTime)

**หลังติดตั้งเสร็จ (ครั้งแรกเท่านั้น)**
1. ลองดับเบิลคลิกไอคอน "ดึง FoodStory เมื่อวาน" หนึ่งรอบ (ครั้งแรกอาจต้องคลิกขวา → **Allow Launching**) ตาม
   [คู่มือพนักงาน](FOODSTORY-DAILY-STAFF-GUIDE.md)
2. ดึง FoodStory รายเดือนของเดือนที่แล้วหนึ่งรอบ (หัวข้อ "FoodStory รายเดือน") — เครื่องใหม่เริ่มเก็บข้อมูลจากศูนย์
3. เช็คสถานะ (หัวข้อถัดไป) — **วันแรกจะขึ้น ✘ "ยังไม่เคยมีรอบ HotelTime เลย" เป็นเรื่องปกติ** จนกว่ารอบเที่ยงวันถัดไปจะรัน · เช็คอีกครั้ง
   หลัง 15:00 ของวันถัดไป ต้องเห็น ✔

## เช็คว่าระบบปกติไหม

```bash
cd ~/chawengburi-exporter/exporter && node src/index.ts status
```

สรุปหน้าเดียวต่อระบบ · ✔ ปกติ · ⏳ รอ (ยังไม่ถึงเวลารอบเที่ยง, กำลังรัน, รอรอบเก็บตก) · ⚠ สิ่งที่ต้องทำ (FoodStory เมื่อวานยังไม่ได้ดึง,
รายเดือนเลยวันที่ 5 แล้ว) · ✘ ปัญหา (HotelTime ขาดวัน, มีรายงานล้มหลังรอบเก็บตก) · `·` ข้อมูลเฉย ๆ

**บรรทัดสุดท้ายบอกเรื่องที่หนักที่สุด:** ✅ ปกติ / ⚠ มีสิ่งที่ต้องทำ / ✘ ต้องดู · ย้อนดูมากกว่า 7 วัน: เติม `--days 14` ท้ายคำสั่ง ·
exit code (สำหรับต่อกับระบบแจ้งเตือนภายหลัง): 0 = ปกติหรือมีแค่สิ่งที่ต้องทำ, 1 = มีปัญหา, 2 = พิมพ์คำสั่งผิด

**ดูรายละเอียดเพิ่ม**
- รายงานไหนล้มด้วยข้อความอะไร: `cat ~/chawengburi-exporter/exporter/data/hoteltime/daily/latest/_summary.txt` (HotelTime วันล่าสุด) ·
  วันอื่น/FoodStory: เปิดโฟลเดอร์ตามตารางภาพรวมแล้วอ่าน `_summary.txt`
- ประวัติการรันของ HotelTime: เปิด <http://localhost:8000/runs> บนเครื่องนี้ · ล็อกอิน `admin@windmill.dev` รหัสดูด้วย
  `cat ~/chawengburi-exporter/windmill/.admin-password`
- log ของ Windmill: `cd ~/chawengburi-exporter/windmill && docker compose logs --tail 100`

## FoodStory รายเดือน (ต้นเดือน)

```bash
cd ~/chawengburi-exporter/exporter && node src/index.ts export --site foodstory --report all --headful
```

เบราว์เซอร์เปิดขึ้นมา → กด captcha + เข้าสู่ระบบภายใน 5 นาที → ปล่อยไว้จนจบ (~5 นาที) · ดึงเดือนเดิมซ้ำวันอื่นได้โฟลเดอร์ใหม่
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
| ไอคอน FoodStory: `❌ ไม่สำเร็จ — ยังไม่ได้รายงานของเมื่อวาน` | ส่วนใหญ่กด captcha ไม่ทัน 5 นาที หรือเน็ตหลุด — ดับเบิลคลิกใหม่ |
| ไอคอน FoodStory: `❌ ไม่สำเร็จ — เข้าสู่ระบบได้ แต่ไม่ได้รายงานเลย` | เว็บ FoodStory อาจเปลี่ยนหน้าตา — ถ่ายรูปหน้าจอ แจ้งผู้พัฒนา |
| ไอคอน FoodStory: `⏳ มีการดึงรายงาน FoodStory รันอยู่แล้ว` | มีหน้าต่างอื่นรันอยู่ — รอให้จบ (ถ้าไม่มีจริง ๆ ระบบจะปลดล็อกเองตอนดับเบิลคลิกครั้งถัดไป) |
| สถานะ: `ไม่มีรอบของวันที่ ...` / `วันนี้ ... ยังไม่มีรอบเลย ทั้งที่เลย 15:00 แล้ว` / `รอบของ ... ไม่จบ` | เครื่องดับ/Docker ไม่ทำงานตอนนั้น — เช็ค <http://localhost:8000/runs> และ `docker compose ps` · วันที่ขาดของ HotelTime ดึงย้อนได้ แจ้งผู้พัฒนา |
| สถานะ: `... ล้ม N ใบ: ...` | ดู `_summary.txt` ของวันนั้น (ตารางถัดไป) · FoodStory เมื่อวาน: ดับเบิลคลิกใหม่ก่อน |
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

- **อย่าอัปเดตช่วง 11:55–14:30 และช่วง 15:00 / 18:00** (HotelTime กำลังรัน) หรือตอนพนักงานกำลังดึง FoodStory
- ตัวติดตั้งรันซ้ำปลอดภัย: ไม่ถามรหัสซ้ำ ไม่แตะ `.env` ติดตั้ง package ใหม่เฉพาะเมื่อเปลี่ยน และ deploy สคริปต์ Windmill ที่เปลี่ยนให้เอง
- ถ้าผู้พัฒนาบอกว่าตัวรัน Windmill เปลี่ยน: `cd ~/chawengburi-exporter/windmill && docker compose up -d --build`
- อย่าแก้ไฟล์ใน `~/chawengburi-exporter` เอง (ยกเว้น `.env`) — `git pull` ครั้งต่อไปจะชนกัน

## เปลี่ยนรหัสผ่าน HotelTime / FoodStory

```bash
nano ~/chawengburi-exporter/exporter/.env
```

แก้บรรทัด `HOTELTIME_PASSWORD=` หรือ `FOODSTORY_PASSWORD=` แล้ว Ctrl+O, Enter, Ctrl+X

- ตัวติดตั้งเขียนค่าไว้ในเครื่องหมายคำพูด เช่น `HOTELTIME_PASSWORD='p#ss word'` — **แก้แค่ข้างในเครื่องหมาย เก็บเครื่องหมายไว้**
- รหัสที่มี `'` อยู่ข้างใน ให้ครอบด้วย `"..."` แทน · มีทั้ง `'` และ `"` → แจ้งผู้พัฒนา
- เช็ค HotelTime: `cd ~/chawengburi-exporter/exporter && node src/index.ts login --site hoteltime --check` (ไม่ต้องกดอะไร) ·
  FoodStory เช็คด้วยการดับเบิลคลิกรอบถัดไป · Windmill อ่าน `.env` ใหม่เองทุกรอบ ไม่ต้องรีสตาร์ท

## ข้อมูล พื้นที่ดิสก์ และการสำรอง

- ข้อมูลทั้งหมดอยู่ใน `~/chawengburi-exporter/exporter/data/` — **มีชื่อแขก ข้อมูลติดต่อ และยอดขาย**: ห้ามส่งต่อออกนอกองค์กร
  ห้ามอัปโหลดขึ้นที่อื่น
- โปรแกรมไม่ลบไฟล์เก่าเลย (ตั้งใจ) — ดูขนาด: `du -sh ~/chawengburi-exporter/exporter/data` (วันละราว 3–4 MB + รายเดือนราว 22 MB)
- สำรองข้อมูล: ก๊อปทั้งโฟลเดอร์ `data/` ไปดิสก์ที่เข้ารหัส (เช่น `rsync -a ~/chawengburi-exporter/exporter/data/ <ปลายทาง>/`) — ความถี่และที่เก็บ
  ให้เจ้าของระบบตัดสิน
- การลบข้อมูลเก่าเป็นการตัดสินใจของเจ้าของระบบเท่านั้น

## ความปลอดภัย

- ไฟล์ลับ อ่านได้เฉพาะบัญชีที่ติดตั้ง (สิทธิ์ 600) และไม่อยู่ใน git: `exporter/.env` (รหัส HotelTime/FoodStory), `windmill/.env`
  (รหัสฐานข้อมูล), `windmill/.admin-password` (รหัส admin ของ Windmill), `~/.ssh/chawengburi_exporter` (กุญแจ deploy) — ห้ามส่งต่อ ห้าม commit
- หน้าเว็บ Windmill เปิดเฉพาะบนเครื่องนี้ (`127.0.0.1:8000`) เครื่องอื่นในวงแลนเข้าไม่ได้
- โฟลเดอร์ `exporter/.auth/` (ถ้ามี) เก็บ session ของเบราว์เซอร์ — ปฏิบัติเหมือนไฟล์ลับ
