# สอนใช้ `exporter` CLI — HotelTime + FoodStory

> เขียน 2026-09-29 · environment: **เครื่อง macOS นี้** (dev/test) · Windmill ที่ `http://localhost:8000`
>
> คู่มือนี้เน้น "พิมพ์อะไร ได้อะไร" ถ้าอยากรู้ว่าไฟล์ไหนคือสคริปต์หรืออยากเพิ่มรายงานใหม่
> ไปอ่าน [EXPORTER-GUIDE.md](./EXPORTER-GUIDE.md) แทน

---

## คำตอบสั้น ๆ ก่อน

| คำถาม | คำตอบ |
|---|---|
| Windmill ตั้งให้ดึง HotelTime ทุกวันอยู่แล้วใช่ไหม | **ใช่** schedule `u/admin/pms_export_daily` เปิดอยู่ ตั้งไว้ `0 0 12 * * *` (เที่ยงทุกวัน, `Asia/Bangkok`) รอบถัดไปคือ 30/09/2026 12:00 · ⚠️ ถ้า Mac หลับตอนเที่ยง รอบนั้นจะไปรันตอนเครื่องตื่นแทน (ดู §3.1) |
| FoodStory ดึงยังไง | ต้อง**รันเองจากเครื่องนี้** เพราะต้องมีคนกด reCAPTCHA ตอนล็อกอินทุกครั้ง → Windmill ทำแทนไม่ได้ · รันเดือนละครั้งด้วย `exporter export --site foodstory --report all --headful` (ดู §4) |
| ดึง HotelTime ย้อนหลังยังไง | `exporter export --report all` (ได้ตั้งแต่ 01/01/2024 → วันนี้) หรือกำหนดช่วงเองด้วย `--from` / `--to` · ผลลงโฟลเดอร์ของตัวเองที่ `data/hoteltime/backfill/<วันเวลาที่รัน>/` แยกจากรอบรายวัน ไม่โดนเขียนทับ (ดู §3.2) |

---

## 1. เตรียมเครื่อง (ทำครั้งเดียว — เครื่องนี้ทำไว้แล้ว)

```bash
cd ~/Work/000-chawengburi/exporter
npm install
npx playwright install chromium
cp .env.example .env      # แล้วใส่ค่าจริง (ดูตารางด้านล่าง)
npm link                  # ทำให้พิมพ์ `exporter` ได้จากทุกโฟลเดอร์
```

ค่าที่ต้องมีใน `exporter/.env`:

| site | ตัวแปรที่ต้องใส่ |
|---|---|
| HotelTime | `HOTELTIME_USERNAME`, `HOTELTIME_PASSWORD` |
| FoodStory | `FOODSTORY_EMAIL`, `FOODSTORY_PASSWORD`, `FOODSTORY_BRANCH_NAME` |

> 🔴 ห้ามใช้ `cat` หรือ `diff` กับ `.env` ต่อหน้าคนอื่น เพราะรหัสผ่านจะโชว์ออกมาตรง ๆ

เช็คว่าพร้อมใช้:

```bash
exporter --help                          # ต้องเห็นรายการคำสั่ง ไม่ใช่ "command not found"
exporter login --check                   # HotelTime ล็อกอินได้ไหม (ไม่ต้องมีคนช่วย)
exporter login --site foodstory --headful   # FoodStory (ต้องกด reCAPTCHA เอง)
```

---

## 2. คำสั่งที่มี

`exporter` มีอยู่ 3 คำสั่ง:

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `exporter login` | ลองล็อกอินแล้วออก เพื่อเช็คว่ารหัสผ่านใน `.env` ยังใช้ได้ |
| `exporter reports` | ดูรายชื่อรายงานที่ดึงได้ (`--site foodstory` ถ้าจะดูของ FoodStory) |
| `exporter export` | ดึงรายงานจริง ← ใช้บ่อยที่สุด |

ถ้าไม่ใส่ `--site` จะหมายถึง **HotelTime** เสมอ

```bash
exporter reports                    # รายงาน HotelTime 8 ใบ
exporter reports --site foodstory   # รายงาน FoodStory
exporter export --help              # ดู flag ทั้งหมด
```

### flag ที่ใช้ได้กับ `exporter export`

| flag | ความหมาย | HotelTime | FoodStory |
|---|---|:-:|:-:|
| `--site <hoteltime\|foodstory>` | เลือกเว็บ (ไม่ใส่ = hoteltime) | ✅ | ✅ |
| `-r, --report <id\|all>` | รายงานที่จะดึง · `all` = ทุกใบ | ✅ | ✅ |
| `--from DD/MM/YYYY` `--to DD/MM/YYYY` | ช่วงวันที่ | ✅ | ✅ ต้องใส่คู่กัน |
| `--last-days <n>` | ย้อนหลัง N วัน รวมวันนี้ | ✅ | ❌ |
| `--daily` | รอบรายวัน — HotelTime: 3 วันล่าสุด + รายงานรายวันของวันนี้ · FoodStory: เมื่อวานวันเดียว (ใช้คู่ `--from/--to` ไม่ได้) | ✅ | ✅ |
| `--baseline` | ดึงทั้งช่วงใหม่หมด ลง `data/hoteltime/baseline/<วันที่รัน>/` (ใบเก่าเก็บไว้ ใบล่าสุดที่ผ่านเป็นใบอ้างอิง) | ✅ | ❌ |
| `-f, --format <raw\|csv\|both>` | เก็บผลเป็นอะไร (ค่าเริ่มต้น `both`) | ✅ | ❌ |
| `--headful` | เปิดหน้าต่างเบราว์เซอร์ให้เห็น | ✅ | ✅ **ต้องใส่เสมอ** |
| `--slow-mo <ms>` | หน่วงทุกการกด ให้คนดูทัน | ✅ | ✅ |
| `--json` | พิมพ์ผลเป็น JSON | ✅ | ✅ |

ถ้าใส่ flag ที่ใช้ไม่ได้ (เช่น `--baseline` กับ FoodStory หรือ `--daily` คู่ `--from` กับ FoodStory) โปรแกรมจะปฏิเสธและหยุดทันที ไม่ข้ามไปเงียบ ๆ

---

## 3. HotelTime

### รายงาน 8 ใบ แบ่งเป็น 2 แบบ

| แบบ | id | ดึงย้อนหลังได้ไหม |
|---|---|---|
| **รายงานแบบช่วงวันที่** (4 ใบ) | `reservations-search` (รายการจอง) · `reservations-ratecode` (จองตาม rate code) · `reservations-cancelled` (การจองที่ยกเลิก) · `arrival-period` (แขกเข้าพักตามช่วงวันที่) | ✅ ได้ ตั้งแต่ 01/01/2024 |
| **รายงานรายวัน** (4 ใบ) | `arrivals` (แขกเข้า) · `departures` (แขกออก) · `in-house-guests` (แขกที่พักอยู่) · `housekeeping` (งานแม่บ้าน) | ❌ ได้แค่ของ**วันนี้** ต้องใช้กับ `--daily` เท่านั้น |

เพราะแบบนี้ `--report all` ที่ไม่ได้ใส่ `--daily` จะ**ข้าม**รายงานรายวัน 4 ใบ (บนจอขึ้น `⏭ ข้าม`)
ไม่นับว่าล้ม และจบด้วย exit 0

### 3.1 รอบรายวันอัตโนมัติ (Windmill) — ไม่ต้องทำอะไร

Windmill รันคำสั่งนี้ให้ทุกวันตอน 12:00:

```bash
cd /workspace/exporter
node src/index.ts export --report all --daily --json
# ผลลงโฟลเดอร์ของวันนั้นใน exporter/data/hoteltime/daily/ เอง (ไม่มีขั้นก๊อปเก็บแล้ว ตั้งแต่ 2026-10-07)
```

**ตรวจสถานะที่เช็คเมื่อ 29/09/2026:**

| รอบ | ผล |
|---|---|
| 23–26/09 | ✅ สำเร็จ ใช้ ~60–90 วินาที |
| 27/09 (รอบที่ตั้งไว้ 26/09) | ❌ ล้ม — ล็อกอิน HotelTime ไม่ขึ้นจนหมดเวลา (รอบเดียว รอบถัดมาผ่าน) |
| 28/09, 29/09 | ✅ สำเร็จ |
| ถัดไป | 30/09/2026 12:00 |

⚠️ **รอบวันนี้ (29/09) เสร็จตอน 14:11 ไม่ใช่ 12:00** — log ของ macOS (`pmset -g log`) บอกว่าเครื่อง
หลับอยู่ช่วงเที่ยง Windmill อยู่ใน Docker บน Mac เครื่องนี้ เครื่องหลับเมื่อไหร่ Windmill ก็หยุด
พอเครื่องตื่นก็ค่อยรันรอบที่ค้าง ถ้าอยากให้ตรงเวลาต้องตั้งเครื่องไม่ให้หลับตอนเสียบปลั๊ก
(System Settings → Battery/Energy) — ยังไม่ได้ตั้ง ตัดสินใจเองได้

**ดูผลย้อนหลัง:**

- ผ่านหน้าเว็บ: เปิด `http://localhost:8000` → workspace **Admins** → เมนู **Runs** → กรอง path
  `u/admin/pms_export_daily` · สำเร็จจะขึ้น "Successfully ran in …s" · ล้มขึ้น "Failed after …s"
- ผ่าน terminal:

```bash
cd ~/Work/000-chawengburi/windmill
docker compose exec -T db psql -U postgres -d windmill -c \
  "SELECT c.completed_at AT TIME ZONE 'Asia/Bangkok' AS done, c.status
   FROM v2_job j JOIN v2_job_completed c ON c.id = j.id
   WHERE j.runnable_path = 'u/admin/pms_export_daily'
   ORDER BY c.completed_at DESC LIMIT 7;"
```

- ไฟล์ของแต่ละวัน: `exporter/data/hoteltime/daily/<YYYY-MM>/<YYYY-MM-DD>/` — เปิด `_summary.txt` ดูก่อนว่าใบไหนผ่าน/ล้ม
  (ก่อน 2026-10-07 อยู่ที่ `exporter/downloads-archive/<YYYY-MM-DD>/`)

**สั่งรันเองนอกเวลา** (เช่น รอบเที่ยงล้ม): เข้าหน้า script `u/admin/pms_export_daily` ใน Windmill → กด **Run**
หรือรันจาก terminal ด้วยคำสั่งเดียวกัน:

```bash
exporter export --report all --daily
```

### 3.2 ดึงย้อนหลัง (back-fill)

#### ผลลงโฟลเดอร์แยก ไม่โดนรอบรายวันเขียนทับ

ตั้งแต่ 29/09/2026 รอบย้อนหลัง, `--from`/`--to` และ `--last-days` จะเขียนผลลงโฟลเดอร์ใหม่ของตัวเอง
ตั้งชื่อตามวันเวลาที่รัน (ส่วน `--baseline` มีที่ของตัวเอง ดูข้อสุดท้ายด้านล่าง):

```
exporter/data/hoteltime/backfill/2026-09-29_150856/
```

รอบรายวันมีโฟลเดอร์ของแต่ละวันใน `exporter/data/hoteltime/daily/` ของตัวเอง ก่อนหน้านี้ใช้โฟลเดอร์ร่วมกัน รอบ 12:00
เลยเขียนทับผลย้อนหลังจนเหลือแค่ 3 วัน ตอนนี้ไม่เป็นแล้ว รันย้อนหลังซ้ำกี่รอบก็ไม่ทับกันเอง
บรรทัดสุดท้ายของผลจะบอกว่าไฟล์อยู่โฟลเดอร์ไหน (`ไฟล์อยู่ที่  data/hoteltime/backfill/…/`)

- ข้อมูลครบทุกช่วงคือโฟลเดอร์ของ **back-fill เต็มช่วงรอบล่าสุด** โปรแกรมไม่รวมหลายโฟลเดอร์เข้าด้วยกันให้
- ไม่มีการลบไฟล์ที่ export มาเลย (ADR-0005)
- ยังควรเลี่ยงการรันช่วง 11:50–12:15 เพราะจะล็อกอิน HotelTime พร้อมกับ Windmill
- `--baseline` ลง `exporter/data/hoteltime/baseline/<วันที่รัน>/` ทุกใบเก็บไว้ (ADR-0005) ใบล่าสุดเป็นใบอ้างอิง
  (`baseline/latest` ชี้ให้) · ถ้ามีใบล้ม ใบที่ผ่านใช้ได้ทันที ส่วนใบที่ล้มใช้ baseline ของโฟลเดอร์ก่อนหน้าไปก่อน
  (ขึ้น `⚠ baseline ของใบที่ล้มยังเป็นของรอบก่อน`) รันใหม่วันเดียวกันได้เลย ผลจะรวมเข้าโฟลเดอร์เดิม

#### ตัวอย่าง

```bash
# ① ทั้งหมด: รายงานช่วงวันที่ 4 ใบ ตั้งแต่ 01/01/2024 ถึงวันนี้ (รายงานรายวัน 4 ใบถูกข้าม)
exporter export --report all

# ② ใบเดียว ทั้งช่วง (01/01/2024 → วันนี้)
exporter export --report reservations-search

# ③ กำหนดช่วงเอง — ทั้งปี 2025
exporter export --report all --from 01/01/2025 --to 31/12/2025

# ④ เดือนเดียว — ก.ค. 2026 เฉพาะการจองที่ยกเลิก
exporter export --report reservations-cancelled --from 01/07/2026 --to 31/07/2026

# ⑤ 30 วันล่าสุด (รวมวันนี้)
exporter export --report all --last-days 30

# ⑥ เอาแค่ CSV ไม่เก็บ .xlsx ดิบ (ประหยัดพื้นที่)
exporter export --report all --from 01/01/2024 --to 31/12/2024 --format csv

# ⑦ อยากดูมันทำงานสด ๆ (เหมาะกับ demo)
exporter export --report reservations-search --last-days 3 --headful --slow-mo 250
```

กติกาของช่วงวันที่:

- วันที่ใช้รูปแบบ **DD/MM/YYYY** (วัน/เดือน/ปี ค.ศ.) เช่น `31/07/2026`
- ไม่ใส่ `--from` = เริ่ม 01/01/2024 · ไม่ใส่ `--to` = วันนี้
- `--last-days` ใช้คู่กับ `--from` / `--to` ไม่ได้
- ช่วงยาว ๆ โปรแกรมแบ่งดึงทีละเดือนให้เอง (เว็บจำกัดจำนวนแถวต่อครั้ง) — ไม่ต้องแบ่งเอง
  แต่ช่วงยาวใช้เวลานานกว่ารอบรายวันมาก

#### ผลที่ได้

```
exporter/data/hoteltime/backfill/2026-09-29_150856/   ← รอบ --daily หน้าตาต่างออกไป ดูด้านล่าง
├── _summary.txt
├── 2024-01-01_2024-12-31__reservations-search.csv   ← รวมทั้งปี 1 ไฟล์ต่อปี
├── 2025-01-01_2025-12-31__reservations-search.csv
├── 2026-01-01_2026-09-29__reservations-search.csv
├── ...
├── _run.json
└── _raw/
    └── reservations-search/            ← .xlsx ดิบทีละก้อน + manifest.json (ถ้า --format raw/both)
```

รอบ `--daily` ลงคลังผลลัพธ์ (ADR-0005) หนึ่งโฟลเดอร์ต่อวัน ตั้งชื่อตาม**วันสุดท้ายที่ข้อมูลครอบคลุม**:

```
exporter/data/hoteltime/daily/
├── latest → 2026-10/2026-10-07                       ← วันล่าสุดที่ผ่านอย่างน้อยหนึ่งใบ
└── 2026-10/
    └── 2026-10-07/
        ├── _summary.txt                              ← เปิดอันนี้ก่อน: ใบไหนผ่าน/ล้ม กี่แถว
        ├── 2026-10-05_2026-10-07__reservations-search.csv   ← ledger ย้อน 3 วันถึงวันนี้
        ├── 2026-10-07__arrivals.csv                  ← ภาพของวันนี้
        ├── ...
        ├── _run.json
        └── _raw/<รายงาน>/                            ← .xlsx ดิบ + manifest.json
```

exit code: `0` ผ่านหมด · `2` ผ่านบางใบ (ไฟล์ของใบที่ผ่านอยู่ครบ) · `1` ไม่ได้อะไรเลยหรือตั้งค่าผิด

- `--format csv` = ได้แค่ CSV รายปี (ลบ .xlsx ดิบทิ้ง)
- `--format raw` = ได้แค่ .xlsx ดิบ + `manifest.json`
- `--format both` (ค่าเริ่มต้น) = ได้ทั้งคู่

#### อ่านผลว่าสำเร็จไหม

บนจอจะขึ้น ✔ ต่อรายงาน · ถ้าใส่ `--json` จะได้ JSON ที่มี:

| field | ความหมาย |
|---|---|
| `ok` | `true` = ทุกรายงานผ่าน |
| `failed` | รายชื่อรายงานที่ล้ม (ว่าง = ไม่มี) |
| `skipped` | รายงานรายวันที่ถูกข้าม (ปกติ ไม่ใช่ error) |
| `totalRows` | จำนวนแถวรวม |
| `outDir` | โฟลเดอร์ที่รอบนี้เขียนผลลง |

exit code `0` = สำเร็จ · `1` = มีอย่างน้อยหนึ่งรายงานล้ม
ทุกไฟล์ผ่านการเทียบจำนวนแถวกับตัวเลข "ทั้งหมด X รายการ" ที่หน้าเว็บบอกแล้ว ถ้าไม่ตรงจะนับเป็นล้ม
ไม่เซฟไฟล์ที่ข้อมูลขาดไว้เงียบ ๆ

---

## 4. FoodStory

### ทำไมต้องรันเอง

หน้าล็อกอินของ FoodStory มี **reCAPTCHA ทุกครั้ง** และเราตัดสินใจแล้วว่า**จะไม่หลบหรือแก้ captcha อัตโนมัติ**
(เท่ากับหลบระบบกันบอทของเขาตรง ๆ) การเซฟ cookie ไว้ใช้รอบหน้าก็ลองแล้ว เซิร์ฟเวอร์ไม่ยอมรับ
ดังนั้นทุกครั้งที่รัน **ต้องมีคนนั่งหน้าจอเครื่องนี้** ตอนเริ่ม และ Windmill (ซึ่งรันใน Docker
ไม่มีหน้าจอ) ทำแทนไม่ได้

### ขั้นตอนประจำเดือน (แนะนำทุกวันที่ 1–3 ของเดือน)

```bash
cd ~/Work/000-chawengburi/exporter
exporter export --site foodstory --report all --headful
```

ไม่ใส่ `--from` / `--to` = ดึง**ทั้งเดือนที่แล้ว** (เช่น รันวันที่ 1 ต.ค. จะได้ 01/09–30/09)

สิ่งที่จะเกิดขึ้น:

1. หน้าต่าง Chromium เปิดขึ้นมา อีเมลกับรหัสผ่านกรอกไว้ให้แล้ว
2. **คุณกด reCAPTCHA** (ถ้ามีรูปให้เลือกก็เลือก) แล้วกด **เข้าสู่ระบบ** — มีเวลา 5 นาที
3. บน terminal ขึ้น `✔ login สำเร็จ — เริ่มตั้งช่วงวันที่ (…)` → จากนี้**ปล่อยมือ**
4. โปรแกรมไล่ดึงทีละรายงานจนครบ 49 ใบ (รายงานจองโต๊ะเป็นใบสุดท้าย) แล้วปิดเบราว์เซอร์เอง

🔴 **ห้ามคลิกหรือเปลี่ยนหน้าในหน้าต่างนั้นเด็ดขาด** ทั้งระหว่างรอกด captcha และระหว่างดึง
เคยพลาดมาแล้ว ฟอร์มล็อกอินหายต้องกด captcha ใหม่ และถ้าเปลี่ยนหน้าระหว่างดึง ช่วงวันที่อาจเพี้ยน
จอพับได้ ย่อหน้าต่างได้ แต่อย่าปิด Mac หรือปล่อยให้เครื่องหลับจนกว่าจะเสร็จ

### ตัวอย่างอื่น

```bash
# ① เดือนที่เจาะจง — ก.ค. 2026 (ต้องใส่คู่กันทั้ง --from และ --to)
exporter export --site foodstory --report all --from 01/07/2026 --to 31/07/2026 --headful

# ② รายงานใบเดียว ของเดือนที่แล้ว (เร็ว เหมาะกับ demo หรือเช็คว่ายังใช้ได้)
exporter export --site foodstory --report salebysumdate --headful

# ③ ดูรายชื่อ id ของทุกรายงาน
exporter reports --site foodstory

# ④ แค่เช็คว่ายังล็อกอินได้ (ต้องกด captcha 1 ครั้ง)
exporter login --site foodstory --headful
```

**ดึงย้อนหลังหลายเดือน:** รัน**เดือนละครั้ง** (โฟลเดอร์ผลตั้งชื่อตามเดือนของ `--from` ถ้าใส่ช่วง
ข้ามเดือน ไฟล์จะไปรวมอยู่ในโฟลเดอร์เดือนแรกและตั้งชื่อผิดเดือน) แต่ละรอบต้องกด captcha ใหม่ 1 ครั้ง

```bash
exporter export --site foodstory --report all --from 01/06/2026 --to 30/06/2026 --headful
exporter export --site foodstory --report all --from 01/07/2026 --to 31/07/2026 --headful
```

### ผลที่ได้

```
exporter/downloads/foodstory/
└── 2026-08/
    ├── 2026-08__sales__salebysumdate.xlsx
    ├── 2026-08__tax__outputtax.xlsx
    ├── 2026-08__inventory__inv_movement_part1.xlsx   ← รายงานใหญ่จะถูกแบ่งเป็น _part1, _part2, …
    ├── 2026-08__inventory__inv_movement_part2.xlsx
    └── ...
```

- ชื่อไฟล์คือ `<ปี-เดือน>__<หมวด>__<รายงาน>.xlsx` · หมวด: `sales` `tax` `product-detail` `inventory` ฯลฯ
- รันเดือนเดิมซ้ำ = ไฟล์ของเดือนนั้นถูกแทนที่ด้วยของใหม่ (เดือนอื่นไม่โดน)
- FoodStory **ไม่มี**การก๊อปเก็บอัตโนมัติแบบ Windmill แต่รอบ HotelTime ก็ไม่แตะโฟลเดอร์ `foodstory/`

สรุปท้ายรอบบนจอจะบอกว่าแต่ละรายงาน `ok` (มีข้อมูล), `empty` (เดือนนั้นไม่มีข้อมูล — ไม่ใช่ error)
หรือ `failed` · มีการเช็คไขว้ยอดขายรวมระหว่างรายงานรายวันกับรายเดือนให้อัตโนมัติด้วย
รอบ ส.ค. 2026 ได้ 49/49 ไม่มีใบไหนล้ม

---

## 5. ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `command not found: exporter` | ยังไม่ได้ `npm link` ในโฟลเดอร์ `exporter/` |
| HotelTime ล้มด้วย `LoginError` | รหัสผ่านใน `.env` ผิดหรือหมดอายุ → เช็คด้วย `exporter login --check` |
| HotelTime ล้มเพราะหน้า Welcome โหลดไม่ขึ้นจนหมดเวลา | เว็บ HotelTime ช้าหรือล่มชั่วคราว (เคยเกิด 1 ครั้งเมื่อ 26/09) → รอแล้วรันใหม่ |
| FoodStory ค้างรอ 5 นาทีแล้ว error | ไม่ได้กด captcha / กดเข้าสู่ระบบไม่ทัน → รันใหม่ |
| FoodStory บอกว่า flag ใช้ไม่ได้ | ใส่ `--daily` / `--last-days` / `--format` ซึ่ง FoodStory ไม่มี → ใช้ `--from` / `--to` แทน |
| หาไฟล์ back-fill ใน `downloads/` ไม่เจอ | ย้ายไปอยู่ `data/hoteltime/backfill/<วันเวลาที่รัน>/` แล้ว (§3.2) |
| Windmill รันช้ากว่า 12:00 | Mac หลับตอนเที่ยง (§3.1) |

---

## 6. สรุปคำสั่งที่ใช้บ่อย (cheat sheet)

```bash
# HotelTime
exporter login --check                                              # เช็ค credential
exporter export --report all --daily                                # รอบรายวัน (เหมือน Windmill)
exporter export --report all --daily --retry-failed                 # รอบเก็บตก: รันซ้ำเฉพาะใบที่ล้มของวันนี้ (Windmill 15:00/18:00)
exporter export --report all                                        # ย้อนหลังทั้งหมด 2024 → วันนี้
exporter export --report all --from 01/01/2025 --to 31/12/2025      # ย้อนหลังช่วงที่กำหนด
ls data/hoteltime/backfill/                                         # ผลย้อนหลังแต่ละรอบ
exporter export --report all --baseline                             # baseline → data/hoteltime/baseline/<วันนี้>/

# FoodStory (ต้องมีคนกด reCAPTCHA ทุกครั้ง)
exporter export --site foodstory --report all --headful             # เดือนที่แล้วทั้ง 49 ใบ
exporter export --site foodstory --report all --from 01/07/2026 --to 31/07/2026 --headful
exporter export --site foodstory --report salebysumdate --headful   # ใบเดียว
```
