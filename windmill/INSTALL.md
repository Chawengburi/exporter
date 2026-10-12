# windmill — คู่มือติดตั้ง

บันทึกขั้นตอนจริงที่ทำสำเร็จแล้วบนเครื่อง dev (macOS) ตอนทำใบ 01–04 ของ
`.scratch/windmill-trial-pms-export-daily/` — ไม่ใช่แผนสมมติ ทุกคำสั่งรันจริงมาแล้วอย่างน้อยหนึ่ง
รอบ ใช้ไฟล์นี้ตอนย้ายขึ้น**เครื่องกลาง** (โน้ตบุ๊กของบริษัทที่อาจลง Linux OS — คนละเครื่องกับโฮสต์
Hostinger ที่รัน openClaw) หรือติดตั้งซ้ำบนเครื่องอื่น

**สถานะ:** ทดลอง (trial) — ดู [`.scratch/windmill-trial-pms-export-daily/spec.md`](../.scratch/windmill-trial-pms-export-daily/spec.md)
สำหรับขอบเขตและเหตุผลของการตัดสินใจแต่ละข้อ

---

## 0. สิ่งที่ต้องแก้เมื่อย้ายเครื่อง vs สิ่งที่ใช้ได้เลย

**ต้องแก้ก่อนใช้บนเครื่องใหม่:**

| อะไร | อยู่ตรงไหน | แก้ยังไง |
|---|---|---|
| `WM_IMAGE`, `POSTGRES_PASSWORD`, `DATABASE_URL` | `windmill/.env` (ไม่ commit) | copy จาก `.env.example` แล้วตั้งรหัสผ่านใหม่ถ้าเครื่องนั้นไม่ใช่เครื่องส่วนตัว |
| path ของ mount `../exporter` | `windmill/docker-compose.yml` service `windmill_worker_custom` | สมมติว่า `exporter/` เป็น sibling directory ของ `windmill/` ที่ root เดียวกันของ repo — ถ้า clone repo ทั้งก้อนไปที่เดียวกันจะใช้ได้เลย ไม่ต้องแก้ |
| credential ของ HotelTime | `exporter/.env` (ไม่ commit, คนละไฟล์กับ `windmill/.env`) | copy จาก `exporter/.env.example` แล้วใส่ค่าจริง — ดู [`exporter/specs/06`](../exporter/specs/06-spec-credentials-and-session.md) |
| Windmill admin login | ตั้งตอน First Time Setup (§ 3) ไม่ได้ commit ที่ไหน | จำ credential ที่ตั้งไว้เอง — 🔴 ดูหมายเหตุ § 6 เรื่อง `permissioned_as` |
| `permissioned_as` ของ schedule | เก็บใน Postgres ของ Windmill เอง ไม่ใช่ git | ต้องเท่ากับ user ที่ล็อกอินตอนตั้ง schedule จริง (§ 6 อธิบายว่าทำไม) |
| worker group "custom" ต้องฟัง tag `chromium` | เก็บใน Postgres ของ Windmill เอง ไม่ใช่ git | ตั้งใหม่ทุกครั้งที่ขึ้นเครื่องใหม่ (§ 4) — `docker compose up` อย่างเดียวไม่พอ |
| เนื้อหา script `pms_export_daily` | เก็บใน Postgres ของ Windmill เอง ไม่ใช่ git | สร้างใหม่ตาม § 5 (มีเนื้อหาสคริปต์แปะให้ทั้งก้อน) |

**ใช้ได้เลยไม่ต้องแก้:** `docker-compose.yml` ทั้งไฟล์ (นอกจาก path ด้านบน), `Caddyfile`,
`worker-custom/Dockerfile` — ทั้งหมด version-pinned และไม่มีอะไรเฉพาะเครื่องนี้

---

## 1. Prerequisites

- Docker + Docker Compose v2 (ทดสอบกับ Docker Desktop บน macOS) — `docker compose version`
- `exporter` ต้อง `npm install` เสร็จแล้วบน host เดียวกัน (มี `exporter/node_modules/`
  พร้อมใช้) — windmill ไม่ได้ตั้งค่าโปรเจกต์นั้นให้ ดู [`exporter/README.md`](../exporter/README.md)
- `exporter/.env` ต้องมี credential จริงของ HotelTime อยู่แล้ว (ดูตาราง § 0)
- พอร์ต `8000` ว่างบนเครื่อง (หรือแก้ `docker-compose.yml` service `caddy` เป็นพอร์ตอื่น)

## 2. ตั้งค่า `.env`

```bash
cd windmill
cp .env.example .env
```

ค่าเริ่มต้นใช้ได้เลยสำหรับ trial บนเครื่องส่วนตัว (`POSTGRES_PASSWORD=changeme` — Postgres ไม่ถูก
publish ออก host เลย ดู § 7) เปลี่ยนได้ถ้าต้องการ แต่ต้องแก้ทั้ง `POSTGRES_PASSWORD` และ
`DATABASE_URL` ให้ตรงกัน (คอมเมนต์ในไฟล์อธิบายไว้แล้ว)

## 3. เปิด stack หลัก + ล็อกอินครั้งแรก

```bash
docker compose up -d
docker compose ps   # ต้องเห็น 7 service ขึ้นครบ: db (healthy), windmill_server,
                     # windmill_worker, windmill_worker_custom, windmill_worker_native,
                     # windmill_extra, caddy
```

🔴 **`windmill_worker_custom` ขึ้นเองตั้งแต่ก้าวนี้แล้ว** ไม่ต้องรอ § 4 — เพราะมันไม่มี
`replicas: 0`/`profiles` กันไว้เหมือน `windmill_indexer` คำสั่งเดียวกันนี้จะ build image ของมัน
(ตาม `worker-custom/Dockerfile`) และเริ่ม container ให้เลย (อาจใช้เวลานานกว่าตัวอื่นรอบแรก
เพราะต้องดาวน์โหลด Chromium) § 4 มีไว้แค่ขั้นตอน UI ที่ยังไม่เกิดขึ้นอัตโนมัติ (ผูก tag
`chromium`) ไม่ใช่การ build/start ซ้ำ

เปิด `http://localhost:8000` — หน้า login จะ prefill credential เริ่มต้น
`admin@windmill.dev` / `changeme` ให้เอง กด "Log in" แล้วจะเจอหน้า **First Time Setup** — กด
**"Skip"** (trial นี้ไม่ต้องตั้งค่า instance-level ใด ๆ) จากนั้นเลือก workspace **"Admins"**

🔴 **เปลี่ยน credential เริ่มต้นทันทีถ้าเครื่องนี้ไม่ใช่เครื่องส่วนตัวคนเดียว** — ดู § 6 ด้วยว่า
การเปลี่ยน/ลบ user ภายหลังจะกระทบ schedule ที่ตั้งไว้แล้วยังไง

## 4. ผูก tag `chromium` ให้ custom worker

`windmill_worker_custom` ควรขึ้นมาแล้วตั้งแต่ § 3 (ถ้ายังไม่ขึ้นหรือแก้ Dockerfile ใหม่ ค่อยสั่ง
`docker compose up -d --build windmill_worker_custom` เพื่อ build/start ซ้ำ) — ส่วนที่เหลือของ
ขั้นนี้เป็นขั้นตอน **UI ล้วน ๆ ที่ต้องทำผ่านมือทุกครั้งที่ขึ้นเครื่องใหม่ ไม่มีทางทำให้อัตโนมัติ
ผ่าน docker compose ได้เลย:**

1. เข้า `http://localhost:8000/workers?workspace=admins`
2. คลิก tab **"custom"** (จะโผล่มาเองหลัง container ขึ้นแล้ว)
3. กด **"Create config"**
4. ที่ "Tags to listen to" กด **"Select items"** แล้วเลือก **`chromium`** (เป็น tag สำเร็จรูป
   ที่ Windmill เตรียมไว้สำหรับ worker ที่มี browser ติดมาด้วย ไม่ต้องพิมพ์เอง)
5. กด **"Apply changes"** — ต้องเห็น toast "Configuration set" และกลุ่ม "custom" แสดง
   `Tags: chromium`

ทดสอบว่า Node + Playwright + Chromium ใช้งานได้จริงในตัว worker นี้ (ไม่ต้องพึ่ง exporter):
สร้าง script ใหม่ ภาษา Bash ตั้ง tag เป็น `chromium` แล้ววาง

```bash
#!/bin/bash
set -euo pipefail
echo "node version:"
node --version
echo "chromium launch test:"
node -e "
const { chromium } = require('/opt/playwright-probe/node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  console.log('chromium launched, version:', browser.version());
  await browser.close();
})();
"
```

กด Test — ควรเห็น `node version: v24.20.0` (หรือใหม่กว่า ดู engines.node ของ
`exporter/package.json`) และ `chromium launched, version: ...` ใน log ภายในไม่ถึง 1 วินาที
(ไม่มีการดาวน์โหลดซ้ำ เพราะ browser ถูก bake ไว้ในอิมเมจตอน build แล้ว)

## 5. Deploy script ที่เรียก exporter จริง

Mount ของ `exporter` เข้ามาอยู่ใน `docker-compose.yml` แล้ว (service `windmill_worker_custom`)
— ตรวจสอบก่อนว่า worker มองเห็นไฟล์จริง:

```bash
docker compose exec -T windmill_worker_custom sh -c "
cd /workspace/exporter &&
test -f .env && echo '.env: OK' || echo '.env: MISSING' &&
test -d node_modules && echo 'node_modules: OK' || echo 'node_modules: MISSING — รัน npm install ใน exporter/ บน host ก่อน'
"
```

สร้าง script ใหม่ในหน้า Windmill: ภาษา **Bash**, tag **`chromium`**, path
`u/<your-username>/pms_export_daily` (ปรับ owner ตาม user จริงของเครื่องนั้น) เนื้อหา:

> ชื่อ path `pms_export_daily` คงชื่อเดิมไว้โดยตั้งใจหลัง rename `pms-export` → `exporter`
> (2026-09-28) — แก้แค่เนื้อหาบรรทัด `cd` ไม่เปลี่ยน path เพราะ schedule ผูกกับ path นี้ ถ้าเปลี่ยน
> ต้องสร้าง schedule ใหม่และเสี่ยงกับดัก "Permissioned as" ใน § 6

```bash
#!/bin/bash
set -euo pipefail
cd /workspace/exporter
node src/index.ts export --report all --daily --json
```

ผลของแต่ละวันลงคลังผลลัพธ์ `exporter/data/hoteltime/daily/<YYYY-MM>/<YYYY-MM-DD>/` บน host ตรง ๆ
(ADR-0005 — mount `data/` แบบ `:rw` ใน docker-compose) · **เดิมสคริปต์มีขั้น `cp -r downloads/.` ไป
`downloads-archive/<วันที่>/` ท้ายสคริปต์ — เลิกแล้ว 2026-10-07** เพราะก๊อปไฟล์ที่ไม่เปลี่ยนซ้ำทุกวัน (337MB
ใน 15 วัน) และไม่รันเลยถ้ามีใบล้มแม้ใบเดียว ถ้าสคริปต์บน Windmill ของเครื่องไหนยังมีสองบรรทัดนั้น ต้องลบออก
**ก่อน** recreate worker ด้วย mount ชุดใหม่ ไม่งั้น `cp` จะเขียนลง mount ที่เป็น `:ro` แล้ว job ล้ม

การเรียก `exporter` เป็น black-box ไม่มีการแปลงผลลัพธ์ — exit code ที่ตัดสินสถานะ job ของ Windmill มาจาก
`node src/index.ts export ...` โดยตรง: `0` = ผ่านหมด, `2` = ผ่านบางใบ (ไฟล์ของใบที่ผ่านอยู่ครบในโฟลเดอร์
ของวันนั้น ดูใบที่ล้มใน `_summary.txt`), `1` = ไม่ได้อะไรเลยหรือตั้งค่าผิด · 2 กับ 1 ทำให้ job ขึ้นล้ม
โดยตั้งใจ เพื่อให้มีคนเห็น

กด **Deploy** (ไม่ใช่แค่ Test) เพื่อให้มี deployed path ถาวรให้ schedule (§ 6) ชี้ไปหาได้

## 6. ตั้ง schedule

เข้า `/schedules` → **New schedule** → เลือก script จาก § 5 → ตั้ง cron ตามที่ต้องการ (ตัวอย่างที่
ใช้จริง: `0 0 12 * * *` = เที่ยงวันทุกวัน, timezone `Asia/Bangkok`) → **Save**

🔴 **กับดักที่เจอจริง — schedule เงียบ ๆ ไม่ deploy สำเร็จ (404 โดยไม่บอกเหตุผลใน UI):**
ฟิลด์ **"Permissioned as"** ของ schedule ผูกกับ user ที่ล็อกอินตอนสร้าง/แก้ schedule ครั้งล่าสุด
ถ้า user คนนั้นถูกลบ/เปลี่ยนภายหลัง (เช่น สร้าง admin account ใหม่ทับของเดิม) **ทุกการแก้
schedule นั้นในอนาคตจะ fail ด้วย `404`** โดย error ใน browser console/UI ไม่บอกสาเหตุ ต้องเช็ค
`docker compose logs windmill_server` หา log บรรทัด `Not found: user <ชื่อ> not found in
workspace <ชื่อ>` ถึงจะรู้ — และที่ร้ายกว่านั้นคือ **schedule ที่ permissioned_as ชี้ไปหา user
ที่หายไปแล้ว จะรันไม่สำเร็จเองด้วย** ไม่ใช่แค่ตอนแก้ไข

วิธีแก้เมื่อเจอ: เปิด edit schedule → คลิก dropdown "Permissioned as" → เลือก user ปัจจุบันที่
ล็อกอินอยู่ (จะมีป้าย "(me)" กำกับ) → Save ใหม่

**ยืนยันว่า deploy สำเร็จจริง อย่าเชื่อแค่หน้า UI** เพราะเคยเจอเคสที่ UI ค้างสถานะ "unsaved
changes" ทั้งที่กด Save ไปแล้วหลายรอบ — เช็คตรงจาก Postgres ของ Windmill เองให้ชัวร์:

```bash
docker compose exec -T db psql -U postgres -d windmill -c \
  "SELECT path, schedule, enabled, edited_by, permissioned_as FROM schedule WHERE path = '<schedule path>';"
# ตัวอย่างจริงจาก trial นี้: path = 'u/admin/pms_export_daily'
```

### ทดสอบเส้นทางล้มเหลว (ทำก่อนปล่อยจริงเสมอ)

1. สำรอง `.env` ของ `exporter`: `cp exporter/.env /tmp/exporter-env-backup`
2. แก้ credential ผิดชั่วคราว เช่น `sed -i.bak 's/^HOTELTIME_PASSWORD=.*/HOTELTIME_PASSWORD=wrong-for-test/' exporter/.env`
3. เข้าหน้า script ที่ deploy แล้ว (ไม่ใช่หน้า schedule) กด **"Run"** จริง (ไม่ใช่ "Test" ซึ่งเป็น
   preview run) — ควรเห็นผล `ok:false` พร้อม `LoginError` ต่อรายงาน และหน้า run แสดง
   **"Failed after ..."**
4. คืนค่า `.env` กลับทันที: `cp /tmp/exporter-env-backup exporter/.env` แล้วยืนยันด้วย
   `cmp exporter/.env /tmp/exporter-env-backup` (**อย่าใช้ `diff`** — มันพิมพ์รหัสผ่านจริง
   ออกมาเป็น plaintext ให้เห็น `cmp` บอกแค่ว่าไฟล์เหมือน/ต่างกันพอ)
5. ลบไฟล์ backup: `rm -f /tmp/exporter-env-backup`

### รอบเก็บตก 15:00 / 18:00 (เพิ่ม 2026-10-07)

รายงานภาพของวันนั้น (arrivals, departures, in-house-guests, housekeeping) ถ้าล้มตอนเที่ยงแล้วไม่ดึงซ้ำในวันเดียวกัน
จะหายถาวร (ADR-0003) จึงมีรอบเก็บตกที่ **รันเฉพาะใบที่สถานะล่าสุดในโฟลเดอร์ของวันนี้ยังล้ม** — ถ้าไม่มีใบล้ม
จะจบทันทีโดยไม่เปิดเบราว์เซอร์ (exit 0) · ถ้ายังไม่มีรอบของวันนี้เลย (เช่น เครื่องหลับตอนเที่ยง) จะทำเหมือนรอบ
รายวันปกติ

1. สร้าง script ใหม่ (Bash, tag `chromium`) path `u/<your-username>/pms_export_daily_catchup`:

   ```bash
   #!/bin/bash
   set -euo pipefail
   cd /workspace/exporter
   node src/index.ts export --report all --daily --retry-failed --json
   ```

2. กด **Deploy** แล้วตั้ง schedule ให้ script นี้: cron `0 0 15,18 * * *` timezone `Asia/Bangkok`
   (ระวังกับดัก "Permissioned as" ด้านบน — สร้าง/แก้ด้วย user ที่ยังอยู่จริงใน workspace)
3. ตรวจว่า schedule ใช้งานได้จริง (UI ไม่บอกเหตุผลเวลา deploy schedule ไม่สำเร็จ — ดูกับดักด้านบน):

   ```bash
   docker compose exec -T db psql -U postgres -d windmill -c \
     "SELECT path, schedule, timezone, enabled FROM schedule WHERE script_path LIKE '%pms_export_daily_catchup';"
   ```

4. กด **Run** script เก็บตกเองหนึ่งครั้งหลังรอบเที่ยงที่ผ่านหมด — ต้องจบเร็ว (ไม่กี่วินาที ไม่เปิดเบราว์เซอร์) และผล
   JSON เป็น `"code": "nothing_to_retry"`

**รอบเก็บตกกับรอบเที่ยงไม่รันซ้อนกัน:** `windmill_worker_custom` มี `replicas: 1` worker ทำงานทีละ job — ถ้า
เครื่องหลับข้ามหลายรอบแล้วตื่นมา job ที่ค้างจะเข้าคิวรันต่อกัน ไม่เขียน `_run.json` ของวันเดียวกันพร้อมกัน ·
ถ้าวันหนึ่งจะเพิ่ม replica ต้องจำกัด concurrency ของสอง script นี้ให้เหลือ 1 ก่อน

## 7. ความปลอดภัยที่ตั้งใจไว้ (ตรวจซ้ำได้)

- ไม่มี service ไหนของ Windmill เปิดออก LAN เลย — มีแค่ `caddy` ตัวเดียวที่ publish port สู่ host
  และ bind ที่ `127.0.0.1:8000` เท่านั้น ตรวจได้ด้วย `docker port <container>` หรือ
  `lsof -nP -iTCP:8000 -sTCP:LISTEN`
- mount ของ `exporter` เข้า `windmill_worker_custom` แบ่งเป็น `:ro` สำหรับตัวโปรเจกต์ (`src/`,
  `.env`, `node_modules`) และ `:rw` เฉพาะ `downloads/` กับ `recon/captures/` ที่ exporter
  เขียนจริง (`sites/hoteltime/config.ts` — `downloadDir`/`captureDir`) — ตรวจได้ด้วย
  `docker compose exec windmill_worker_custom sh -c "touch /workspace/exporter/src/.t 2>&1"`
  ต้องได้ `Read-only file system` (ทดสอบยืนยันจริงแล้ว)
- ใช้ Windmill Community Edition เท่านั้น (`WM_IMAGE` ไม่มี `-ee`) — Error/success handler และ
  Critical alerts เป็น EE feature ที่ปิดใช้งานอยู่โดยธรรมชาติ ไม่ต้องปิดเอง

## 8. ทำลายทิ้ง (เมื่อเลิกใช้ trial)

```bash
docker compose down          # เก็บ volume ไว้ (ข้อมูล script/schedule ยังอยู่ถ้ากลับมาใหม่)
docker compose down -v       # ลบ volume ด้วย — เสีย config ที่ตั้งไว้ใน UI ทั้งหมด (§ 4-6)
                              # ต้องทำซ้ำใหม่ทั้งหมดถ้าจะใช้ต่อ
```
