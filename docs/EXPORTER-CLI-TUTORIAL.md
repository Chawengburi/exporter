# สอนใช้ `exporter` CLI — HotelTime + FoodStory

> เขียน 2026-09-29 · เขียนใหม่ 2026-10-14 ตามโมเดลรอบรายวันแบบไฟล์ละวันของข้อมูล (`.scratch/exporter-daily-per-day-raw/`)
> · environment: **เครื่อง macOS นี้** (dev/test) · Windmill ที่ `http://localhost:8000` · เครื่อง Ubuntu ดู
> [UBUNTU-ADMIN-GUIDE.md](./UBUNTU-ADMIN-GUIDE.md)
>
> คู่มือนี้เน้น "พิมพ์อะไร ได้อะไร" ถ้าอยากรู้ว่าไฟล์ไหนคือสคริปต์หรืออยากเพิ่มรายงานใหม่
> ไปอ่าน [EXPORTER-GUIDE.md](./EXPORTER-GUIDE.md) แทน · ศัพท์ทั้งหมดอยู่ใน [CONTEXT.md](../CONTEXT.md)

---

## คำตอบสั้น ๆ ก่อน

| คำถาม | คำตอบ |
|---|---|
| Windmill ดึง HotelTime ทุกวันอยู่แล้วใช่ไหม | **ใช่** 12:00 ทุกวัน + รอบเก็บตก 15:00 / 18:00 — สามรอบรันคำสั่งเดียวกัน ทำเฉพาะที่ยังไม่สำเร็จ · ⚠️ ถ้า Mac หลับตอนเที่ยง รอบนั้นไปรันตอนเครื่องตื่น (§3.1) |
| ได้ข้อมูลของวันไหน | **รายงานตามวัน** = **เมื่อวาน** (วันที่ปิดยอดแล้ว) ไฟล์ละวัน · **รายงาน snapshot** (สถานะห้อง สต็อก ยอดสะสม) = snapshot ณ ตอนที่ดึง · วันไหนขาด รอบถัดไปเติมให้เองตั้งแต่ **วันเริ่มใช้งาน** ครั้งละ 3 วัน |
| FoodStory ดึงยังไง | ต้องมีคนกด reCAPTCHA ทุกครั้ง → Windmill ทำแทนไม่ได้ · **รายวัน**: พนักงานดับเบิลคลิกไอคอนบน Desktop · **รายเดือน**: ผู้ดูแลรันต้นเดือน (§4) |
| รู้ได้ยังไงว่าปกติ | `exporter status` สรุปหน้าเดียว · สรุปรอบ/แจ้งเตือนทาง Discord (ถ้าตั้ง `DISCORD_WEBHOOK_URL_EXPORT`) |
| ดึงวันเดิมใหม่ยังไง | วันเดียว `--date` · หลายวัน `--baseline` (§3.2) |

---

## 1. เตรียมเครื่อง (ทำครั้งเดียว — เครื่องนี้ทำไว้แล้ว)

```bash
cd ~/Work/000-chawengburi/exporter
npm install
npx playwright install chromium
cp .env.example .env      # แล้วใส่ค่าจริง (ดูตารางด้านล่าง)
npm link                  # ทำให้พิมพ์ `exporter` ได้จากทุกโฟลเดอร์
```

ค่าใน `exporter/.env`:

| ตัวแปร | ต้องมีไหม | ความหมาย |
|---|---|---|
| `HOTELTIME_USERNAME`, `HOTELTIME_PASSWORD` | ✅ | บัญชี HotelTime |
| `FOODSTORY_EMAIL`, `FOODSTORY_PASSWORD`, `FOODSTORY_BRANCH_NAME` | ✅ | บัญชี FoodStory |
| `EXPORTER_GO_LIVE=YYYY-MM-DD` | แนะนำ | **วันเริ่มใช้งาน** — วันของข้อมูลที่ขาดตั้งแต่วันนี้ รอบรายวันเติมให้เอง · ไม่ตั้ง = ดึงแค่เมื่อวาน |
| `DISCORD_WEBHOOK_URL_EXPORT` | ไม่บังคับ | สรุปรอบ/แจ้งเตือนขา export ทาง Discord · **ความลับ** (ใครมีก็โพสต์เข้าห้องได้) |
| `DISCORD_WEBHOOK_URL_UPLOAD` | ไม่บังคับ | แจ้งเตือนขาอัปโหลด (`exporter upload`) ทาง Discord — คนละ channel จากขา export · **ความลับ** |

> 🔴 ห้ามใช้ `cat` หรือ `diff` กับ `.env` ต่อหน้าคนอื่น เพราะรหัสผ่านและ URL ของ webhook จะโชว์ออกมาตรง ๆ

เช็คว่าพร้อมใช้:

```bash
exporter --help                          # ต้องเห็นรายการคำสั่ง ไม่ใช่ "command not found"
exporter login --check                   # HotelTime ล็อกอินได้ไหม (ไม่ต้องมีคนช่วย)
exporter login --site foodstory --headful   # FoodStory (ต้องกด reCAPTCHA เอง)
exporter status                          # ท้ายหน้าบอกว่าตั้งวันเริ่มใช้งาน/Discord แล้วหรือยัง
```

---

## 2. คำสั่งที่มี

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `exporter export` | ดึงรายงานจริง ← ใช้บ่อยที่สุด |
| `exporter status` | สรุปภาษาไทยหน้าเดียวว่าระบบปกติไหม (อ่านคลังอย่างเดียว ไม่เปิดเบราว์เซอร์) |
| `exporter notify` | ส่ง Discord เอง (`--summary` ส่งสรุปของวันนี้ · `--dry-run` แค่แสดงข้อความ) — รอบรายวันส่งให้เองอยู่แล้ว |
| `exporter login` | ลองล็อกอินแล้วออก เพื่อเช็คว่ารหัสผ่านใน `.env` ยังใช้ได้ |
| `exporter reports` | ดูรายชื่อรายงานที่ดึงได้ (`--site foodstory` ถ้าจะดูของ FoodStory) |

ถ้าไม่ใส่ `--site` จะหมายถึง **HotelTime** เสมอ

### flag ที่ใช้ได้กับ `exporter export`

| flag | ความหมาย | HotelTime | FoodStory |
|---|---|:-:|:-:|
| `--site <hoteltime\|foodstory>` | เลือกเว็บ (ไม่ใส่ = hoteltime) | ✅ | ✅ |
| `-r, --report <id\|all>` | รายงานที่จะดึง · `all` = ทุกใบ | ✅ | ✅ |
| `--daily` | รอบรายวัน: เมื่อวาน + วันที่ขาด (ครั้งละ 3 วัน) + รายงาน snapshot ของวันนี้ + snapshot ปิดงวด ทำเฉพาะที่ยังไม่สำเร็จ | ✅ | ✅ |
| `--date YYYY-MM-DD` | ดึงรายงานตามวันของวันของข้อมูลนั้นวันเดียวใหม่ (ไม่สนว่าเคยได้แล้ว) | ✅ | ❌ |
| `--baseline` | ดึงวันที่เคยดึงแล้วใหม่ ไฟล์ละวันของข้อมูล ลง `data/hoteltime/baseline/<วันที่รัน>/` | ✅ | ❌ |
| `--from DD/MM/YYYY` `--to DD/MM/YYYY` | ช่วงวันที่ — HotelTime: back-fill หรือช่วงของ `--baseline` · FoodStory: รอบรายเดือนช่วงที่กำหนด | ✅ | ✅ ต้องใส่คู่กัน |
| `--last-days <n>` | back-fill ย้อนหลัง N วัน รวมวันนี้ | ✅ | ❌ |
| `--headful` | เปิดหน้าต่างเบราว์เซอร์ให้เห็น | ✅ | ✅ **ต้องใส่เสมอ** |
| `--slow-mo <ms>` | หน่วงทุกการกด ให้คนดูทัน | ✅ | ✅ |
| `--json` | พิมพ์ผลเป็น JSON | ✅ | ✅ |

ใส่ flag ที่ใช้ไม่ได้ หรือ flag ที่เลิกใช้แล้ว (`--format`, `--overlap-days`, `--retry-failed`) โปรแกรมจะปฏิเสธพร้อมเหตุผลและหยุดทันที
ไม่ข้ามไปเงียบ ๆ

---

## 3. HotelTime

### รายงาน 48 ใบ แบ่งเป็น 2 ตระกูล

| ตระกูล | ตัวอย่าง | ดึงยังไง | ดึงย้อนหลังได้ไหม |
|---|---|---|---|
| **รายงานตามวัน** (22 ใบ) | `reservations-search`, `reservations-cancelled`, `postings`, `manual-postings`, `invoices-*`, `city-tax`, `guest-profiles`, `manager-day-detail` | ทีละ **วันของข้อมูล** ไฟล์ละวัน | ✅ (`--date`, `--baseline`) |
| **รายงาน snapshot** (26 ใบ) | `arrivals`, `departures`, `in-house-guests`, `housekeeping`, `rooms-status-overview`, `manager-summary`, `trial-balance`, `reservation-stats-*` | snapshot ณ เวลาที่ดึง วันละครั้ง | ❌ snapshot ของวันที่ผ่านไปแล้วหายถาวร |

รายงาน snapshot ที่เป็นยอดสะสมเดือน/ปี (`manager-summary`, `trial-balance`, `reservation-stats-month` ฯลฯ) ได้ **snapshot ปิดงวด** ของงวดที่จบให้เอง
ในรอบแรกของเดือน/ปีใหม่ (ถ่ายได้ 7 วันแรกของงวดถัดไป) · ดูทั้งหมดด้วย `exporter reports`

### 3.1 รอบรายวันอัตโนมัติ (Windmill) — ไม่ต้องทำอะไร

Windmill รันคำสั่งนี้ให้ทุกวันตอน 12:00 และรอบเก็บตก 15:00 / 18:00 (คำสั่งเดียวกัน):

```bash
cd /workspace/exporter
node src/index.ts export --report all --daily --json
```

สิ่งที่รอบหนึ่งทำ:

1. อ่าน `_run.json` ของวันที่เกี่ยวข้อง แล้ววางแผนว่ายังขาดอะไร — ไม่มีอะไรขาด = จบทันที ไม่เปิดเบราว์เซอร์ (รอบเก็บตกส่วนใหญ่จบแบบนี้)
2. รายงานตามวันของ**เมื่อวาน** (และวันที่ขาดตั้งแต่วันเริ่มใช้งาน ใหม่สุดก่อน ไม่เกิน 3 วัน) — ไม่ดึงก่อน 07:00 เพราะรายงานยกเลิกตัดวันตาม UTC
3. รายงาน snapshot ของวันนี้ (ถ้ายังไม่ได้) และ snapshot ปิดงวด (ต้นเดือน/ต้นปี)
4. จบแล้วส่ง Discord: แจ้งเตือนถ้ามีปัญหา · ทุกรอบรายวันส่ง **สรุปรอบ** (อังกฤษ สั้น แบบ log)

ใช้เวลาราว 3–10 นาที (เพดาน 3 วันต่อรอบตั้งให้ไม่เกิน timeout 15 นาทีของ Windmill)

⚠️ **Windmill อยู่ใน Docker บน Mac เครื่องนี้** เครื่องหลับเมื่อไหร่ Windmill ก็หยุด พอเครื่องตื่นก็ค่อยรันรอบที่ค้าง —
วันที่ขาดเพราะเครื่องหลับ รอบถัดไปเติมให้เอง แต่รายงาน snapshot ของวันนั้นหายถาวร

**ดูผล:**

- **`exporter status`** — ต่อวันของข้อมูล: มีข้อมูล / ว่าง / ล้ม / ยังไม่ได้ดึง กี่ตัว ตัวไหน + รายงาน snapshot ครบไหม
- หน้าเว็บ: `http://localhost:8000` → workspace **Admins** → เมนู **Runs** · สำเร็จขึ้น "Successfully ran in …s" · ล้มขึ้น "Failed after …s"
- ไฟล์ของแต่ละวัน: `exporter/data/hoteltime/daily/<YYYY-MM>/<วันของข้อมูล>/` — เปิด `_summary.txt` ก่อน

**สั่งรันเองนอกเวลา** (เช่น อยากได้ทันที): คำสั่งเดียวกัน — ไม่มีงานค้างก็จบเอง ไม่ทำซ้ำ

```bash
exporter export --report all --daily
```

#### ผลที่ได้

```
exporter/data/hoteltime/daily/
├── latest → 2026-10/2026-10-14                          ← โฟลเดอร์ของวันนี้
└── 2026-10/
    ├── 2026-10-13/                                      ← วันของข้อมูล 13 ต.ค. (ดึงวันที่ 14)
    │   ├── 2026-10-13__postings.xlsx                    ← รายงานตามวัน: ไฟล์ละวันของข้อมูล
    │   ├── 2026-10-13__reservations-search.xlsx
    │   ├── 20261013T120512+0700__arrivals.xlsx          ← รายงาน snapshot ที่ถ่ายวันที่ 13
    │   ├── _manifest.json                               ← ไฟล์ไหน ครอบวันไหน กี่แถว sha256
    │   ├── _summary.txt                                 ← เปิดอันนี้ก่อน: ใบไหนผ่าน/ว่าง/ล้ม
    │   └── _run.json
    └── 2026-10-14/                                      ← วันนี้: ตอนนี้มีแค่รายงาน snapshot
```

- ไฟล์เป็น **ไฟล์ดิบ** .xlsx ตามที่ HotelTime ให้มา (ไม่แปลง ไม่มี CSV — ADR-0007)
- รายงานที่ **ว่าง** (วันนั้นไม่มีรายการจริง) ไม่มีไฟล์ แต่บันทึกใน `_run.json` / `_summary.txt` ว่าว่าง
- ดึงชื่อเดิมซ้ำแล้วไฟล์ต่าง → ฉบับเก่าย้ายไป `_superseded/` · **ไม่มีอะไรถูกลบหรือทับ** (ADR-0005)
- โฟลเดอร์ก่อน 2026-10-14 ยังมีไฟล์ CSV / `_raw/` ของรอบรูปแบบเดิม (ช่วงเหลื่อม 3 วัน) — เก็บไว้ตามเดิม `status` แสดงเป็นประวัติ

exit code: `0` ผ่านหมดหรือไม่มีงาน · `2` ผ่านบางใบ (ไฟล์ของใบที่ผ่านอยู่ครบ) · `1` ไม่ได้อะไรเลยหรือตั้งค่าผิด

### 3.2 ดึงวันเดิมใหม่

```bash
# วันเดียว — รายงานตามวันทั้ง 22 ใบของวันที่ 12 ใหม่ ลงโฟลเดอร์ของวันนั้น (ฉบับเก่าไป _superseded/) · ถึงเมื่อวาน · ไม่ถ่ายรายงาน snapshot
exporter export --report all --date 2026-10-12
exporter export --report postings --date 2026-10-12        # ใบเดียว

# baseline — หลายวัน ไฟล์ละวันของข้อมูล ชื่อเดียวกับรอบรายวัน ลง data/hoteltime/baseline/<วันที่รัน>/ (โฟลเดอร์รายวันไม่ถูกแตะ)
exporter export --report all --baseline --from 01/10/2026 --to 13/10/2026
exporter export --report all --baseline                     # ไม่ใส่ช่วง = 30 วันล่าสุดถึงเมื่อวาน
```

- baseline ไว้เก็บ **การแก้ย้อนหลัง** ที่รอบรายวัน (ดึงตอนเที่ยงของวันถัดไป) มองไม่เห็น — เทียบไฟล์ของวันเดียวกันในสองโฟลเดอร์ได้เลย
  · ⚠ sha256 ของทั้งไฟล์ต่างกันทุกครั้งที่ดาวน์โหลด แม้ข้อมูลเหมือนเดิม (มีเวลาที่สร้างไฟล์อยู่ในไฟล์) ต้องเทียบเนื้อหา
- ใช้เวลาราววันละ 2–3 นาที (22 ใบ × ~6 วินาที) — 30 วัน ≈ 70 นาที · รายงาน snapshot ไม่มี baseline (ใส่มาใบเดียว = ปฏิเสธ · `all` = ข้าม)
- **เลี่ยงรันช่วง 11:50–12:15, 15:00, 18:00** เพราะจะล็อกอิน HotelTime พร้อมกับ Windmill

### 3.3 back-fill (ก้อนหลายวัน)

```bash
exporter export --report reservations-cancelled --from 01/07/2026 --to 31/07/2026
exporter export --report all --last-days 30
```

- ลง `exporter/data/hoteltime/backfill/<วันเวลาที่รัน>/` โฟลเดอร์ละรอบ ไม่ทับกันเอง · ชื่อไฟล์เป็นช่วง `2026-07-01--2026-07-31__reservations-cancelled.xlsx`
  (ช่วงยาวแบ่งดึงทีละเดือนให้เอง — เว็บจำกัด 2,000 แถวต่อครั้ง)
- วันที่ใช้รูปแบบ **DD/MM/YYYY** · ไม่ใส่ `--from` = เริ่ม 01/01/2024 · ไม่ใส่ `--to` = วันนี้ · `--last-days` ใช้คู่กับ `--from`/`--to` ไม่ได้
- รายงาน dailyOnly (รายงาน snapshot ของวันนี้อย่าง `arrivals` และ `manager-day-detail`) ถูกข้าม (บนจอขึ้น `⏭ ข้าม`) ไม่นับว่าล้ม — ดึงย้อนด้วย `--date`/`--baseline` แทน
- ⚠ ไฟล์แบบช่วงเป็นคนละ key กับไฟล์ละวัน — อยากได้ข้อมูลที่แทนที่ไฟล์รายวันได้ ใช้ `--baseline` แทน

#### อ่านผลว่าสำเร็จไหม

บนจอจะขึ้น ✔ ต่อรายงาน · ถ้าใส่ `--json` จะได้ JSON ที่มี `ok`, `reports`, `failed`, `skipped`, `totalRows`, `warnings` และโฟลเดอร์
(`outDirs` สำหรับ `--daily`/`--date` ซึ่งเขียนได้หลายโฟลเดอร์ · `outDir` สำหรับรอบอื่น) · ทุกไฟล์ผ่านการเทียบจำนวนแถวกับที่หน้าเว็บบอก
ช่วงวันที่ในไฟล์ และทุกชีต ถ้าไม่ตรงจะนับเป็นล้ม ไม่เซฟไฟล์ที่ข้อมูลขาดไว้เงียบ ๆ

---

## 4. FoodStory

### ทำไมต้องรันเอง

หน้าล็อกอินของ FoodStory มี **reCAPTCHA ทุกครั้ง** และเราตัดสินใจแล้วว่า**จะไม่หลบหรือแก้ captcha อัตโนมัติ**
(เท่ากับหลบระบบกันบอทของเขาตรง ๆ) การเซฟ cookie ไว้ใช้รอบหน้าก็ลองแล้ว เซิร์ฟเวอร์ไม่ยอมรับ
ดังนั้นทุกครั้งที่รัน **ต้องมีคนนั่งหน้าจอเครื่องนี้** ตอนเริ่ม และ Windmill (ซึ่งรันใน Docker
ไม่มีหน้าจอ) ทำแทนไม่ได้

### 4.1 รายวัน (พนักงาน — วันละครั้ง)

พนักงานดับเบิลคลิกไอคอน **"Exporter - FoodStory Daily"** บน Desktop แล้วกด captcha ตาม
[คู่มือพนักงาน](./FOODSTORY-DAILY-STAFF-GUIDE.md) — ไอคอนรันคำสั่งนี้:

```bash
exporter export --site foodstory --report all --daily --headful
```

login ครั้งเดียว แล้วดึงรายงานตามวัน 42 ใบของเมื่อวาน (+ วันที่ยังไม่ได้กดตั้งแต่วันเริ่มใช้งาน ครั้งละ 3 วัน) และรายงาน snapshot 7 ใบของวันนี้
(สต็อก ยอดสะสมทั้งปี ข้อมูลหลัก) · ได้ครบแล้ว = ขึ้น "ไม่มีงานค้าง" ไม่ต้องกด captcha · ไฟล์ลง `exporter/data/foodstory/daily/<YYYY-MM>/<วันของข้อมูล>/`
ชื่อแบบเดียวกับ HotelTime (`2026-10-13__salebybill.xlsx`, `20261014T175436+0700__current_stock.xlsx`)

### 4.2 รายเดือน (ผู้ดูแล — แนะนำทุกวันที่ 1–3 ของเดือน)

```bash
cd ~/Work/000-chawengburi/exporter
exporter export --site foodstory --report all --headful
```

ไม่ใส่ `--from` / `--to` = ดึง**ทั้งเดือนที่แล้ว** (เช่น รันวันที่ 1 ต.ค. จะได้ 01/09–30/09) — รอบรายเดือนเก็บการแก้ยอดย้อนหลังของร้าน

สิ่งที่จะเกิดขึ้น:

1. หน้าต่าง Chromium เปิดขึ้นมา อีเมลกับรหัสผ่านกรอกไว้ให้แล้ว
2. **คุณกด reCAPTCHA** (ถ้ามีรูปให้เลือกก็เลือก) แล้วกด **เข้าสู่ระบบ** — มีเวลา 5 นาที
3. บน terminal ขึ้น `✔ login สำเร็จ — เริ่มตั้งช่วงวันที่ (…)` → จากนี้**ปล่อยมือ**
4. โปรแกรมไล่ดึงทีละรายงานจนครบ 49 ใบ (รายงานจองโต๊ะเป็นใบสุดท้าย) แล้วปิดเบราว์เซอร์เอง

🔴 **ห้ามคลิกหรือเปลี่ยนหน้าในหน้าต่างนั้นเด็ดขาด** ทั้งระหว่างรอกด captcha และระหว่างดึง
เคยพลาดมาแล้ว ฟอร์มล็อกอินหายต้องกด captcha ใหม่ และถ้าเปลี่ยนหน้าระหว่างดึง ช่วงวันที่อาจเพี้ยน
จอพับได้ ย่อหน้าต่างได้ แต่อย่าปิด Mac หรือปล่อยให้เครื่องหลับจนกว่าจะเสร็จ

```bash
# เดือนที่เจาะจง — ก.ค. 2026 (ต้องใส่คู่กันทั้ง --from และ --to · รันเดือนละครั้ง ไม่ข้ามเดือน)
exporter export --site foodstory --report all --from 01/07/2026 --to 31/07/2026 --headful
# รายงานใบเดียว ของเดือนที่แล้ว (เร็ว เหมาะกับเช็คว่ายังใช้ได้)
exporter export --site foodstory --report salebysumdate --headful
```

#### ผลที่ได้

```
exporter/data/foodstory/monthly/
├── 2026-09/                                          ← รอบแรกของเดือนนั้น
│   ├── 2026-09__sales__salebysumdate.xlsx
│   ├── 2026-09__inventory__inv_movement_part1.xlsx   ← เกิน 5,000 แถวถูกผ่าช่วงเป็น _part1, _part2 — ต้องต่อกันจึงครบเดือน
│   ├── 2026-09__inventory__inv_movement_part2.xlsx
│   ├── _manifest.json · _summary.txt · _run.json
└── 2026-09__2026-10-12/                              ← ดึงเดือนเดิมซ้ำวันอื่น (วันที่ดึง) — ไม่ทับรอบแรก
```

สรุปท้ายรอบบนจอบอกว่าแต่ละรายงาน `ok` (มีข้อมูล), `empty` (**ว่าง** — เดือนนั้นเว็บไม่มีรายการจริง ไม่ใช่ error) หรือ `failed` ·
มีการเช็คไขว้ยอดขายรวมระหว่างยอดขายแยกวัน (`salebysumdate`) กับยอดรายเดือน (`salebymonthsum`) ให้อัตโนมัติ

---

## 5. ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `command not found: exporter` | ยังไม่ได้ `npm link` ในโฟลเดอร์ `exporter/` |
| `--retry-failed เลิกใช้แล้ว` (job ของ Windmill ล้ม) | สคริปต์ใน Windmill เป็นของเก่า → แก้เนื้อหาเป็น `node src/index.ts export --report all --daily --json` (เหมือน `windmill/scripts/*.sh`) |
| HotelTime ล้มด้วย `LoginError` | รหัสผ่านใน `.env` ผิดหรือหมดอายุ → เช็คด้วย `exporter login --check` |
| HotelTime ล้มเพราะหน้า Welcome โหลดไม่ขึ้นจนหมดเวลา | เว็บ HotelTime ช้าหรือล่มชั่วคราว → รอบถัดไปลองซ้ำเอง |
| `status` บอก `ยังไม่ได้ดึง` วันเก่า ๆ | เครื่องดับ/หลับ — รอบถัดไปเติมเอง ครั้งละ 3 วัน · เกินนั้นขึ้น `ขาดอีก N วัน` (รอ หรือ `--date` ทีละวัน) |
| `status` บอก snapshot `หายถาวร เติมไม่ได้` | วันนั้นไม่มีรอบไหนถ่ายรายงาน snapshot — ดึงย้อนไม่ได้ ไม่มีอะไรให้ทำ |
| FoodStory ค้างรอ 5 นาทีแล้ว error | ไม่ได้กด captcha / กดเข้าสู่ระบบไม่ทัน → รันใหม่ |
| FoodStory บอกว่า flag ใช้ไม่ได้ | ใส่ `--date` / `--baseline` / `--last-days` ซึ่ง FoodStory ไม่มี |
| ไม่มีข้อความสรุปใน Discord | ยังไม่ตั้ง `DISCORD_WEBHOOK_URL_EXPORT` (`status` บอก) หรือรอบนั้นไม่ได้รัน · ส่งไม่ได้ดูที่ `data/_notify/discord.json` |
| Windmill รันช้ากว่า 12:00 | Mac หลับตอนเที่ยง (§3.1) |

---

## 6. สรุปคำสั่งที่ใช้บ่อย (cheat sheet)

```bash
exporter status                                                     # ระบบปกติไหม (ทุกอย่าง)
exporter notify --dry-run --summary                                 # ดูข้อความ Discord ที่จะส่ง

# HotelTime
exporter login --check                                              # เช็ค credential
exporter export --report all --daily                                # รอบรายวัน (เหมือน Windmill ทั้ง 3 เวลา)
exporter export --report all --date 2026-10-12                      # ดึงวันของข้อมูลวันเดียวใหม่
exporter export --report all --baseline --from 01/10/2026 --to 13/10/2026   # baseline ไฟล์ละวัน
exporter export --report all --from 01/01/2025 --to 31/12/2025      # back-fill ก้อนหลายวัน

# FoodStory (ต้องมีคนกด reCAPTCHA ทุกครั้ง)
exporter export --site foodstory --report all --daily --headful     # รายวัน (สิ่งที่ไอคอนบน Desktop รัน)
exporter export --site foodstory --report all --headful             # รายเดือน: เดือนที่แล้วทั้ง 49 ใบ
exporter export --site foodstory --report salebysumdate --headful   # ใบเดียว
```
