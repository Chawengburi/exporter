# exporter

> เดิมชื่อ `pms-export` — rename 2026-09-28 (ADR-0004): คำสั่ง `exporter`, `.env` prefix ของ HotelTime
> เปลี่ยนจาก `PMS_*` เป็น `HOTELTIME_*` · เอกสาร/ticket ก่อนวันนั้นยังเรียกชื่อเดิม

ดึงรายงานจาก **HotelTime PMS** ด้วย Playwright แล้วเซฟลงดิสก์

สคริปต์ deterministic — **ไม่มี AI อยู่ในลูปการรัน** ใช้ AI แค่ตอนสำรวจเส้นทางครั้งแรก
และตอนซ่อมเมื่อเว็บเปลี่ยนหน้าตา ที่มาของสถาปัตยกรรมนี้อยู่ใน artifact สองใบ:
[Portal to Pipeline](https://claude.ai/code/artifact/776ec534-b87d-4500-8bb3-30f0c8485d97) (คู่มืออ้างอิงกลาง) ·
[Agent เขียน สคริปต์รัน](https://claude.ai/code/artifact/79616963-d0f3-4bb3-86cd-a4f4e07b53f9) (ข้อเสนอของเคสนี้)

## สถานะ

| ส่วน | สถานะ |
|---|---|
| โครงโปรเจกต์ + config + การกันความลับหลุด | ✅ เสร็จ |
| `exporter login` — ล็อกอินอัตโนมัติ | ✅ ทดสอบกับ credential จริงแล้ว สำเร็จ 2026-09-08 |
| Phase A — แผนที่เมนู | ✅ ได้ครบแล้ว ดู [`recon/MENU.md`](./recon/MENU.md) |
| Phase A — สำรวจ filter/export ครบ 3 รายงานแรก | ✅ เสร็จ ดู [`recon/NOTES.md`](./recon/NOTES.md) |
| `exporter export` — ดึงไฟล์ + รวมเป็น CSV รายปี | ✅ รันจริงครบ 8 รายงานแล้ว (2026-09-22) |
| ชั้นตรวจไฟล์ (`sites/hoteltime/verify.ts` + `core/verify.ts`) | ✅ เสร็จ — จับบั๊กจริงไปแล้ว 1 ตัว |
| รองรับหลาย site (`src/sites/<site>/`) | ✅ HotelTime + FoodStory (48/48 รายงาน, ticket 12 — ต้องมีคนแก้ reCAPTCHA ทุกรอบ รันบน Windmill ไม่ได้) · rename เป็น `exporter` แล้ว 2026-09-28 (ADR-0004) |
| ขาอัปโหลดเข้า uploader | ⛔ **นอกขอบเขตรอบนี้โดยเจตนา** |

## ติดตั้ง

```bash
npm install
npx playwright install chromium     # ต้องตรงเวอร์ชันกับ playwright ใน package.json
cp .env.example .env                # แล้วใส่ HOTELTIME_USERNAME / HOTELTIME_PASSWORD
npm link                            # ทำให้เรียก `exporter` ได้จากทุกที่
```

ต้องใช้ **Node >= 22.18** เพราะรัน `.ts` ตรง ๆ ด้วย native type stripping ไม่มี build step
`npm run typecheck` คือ `tsc --noEmit` ใช้ตรวจ type อย่างเดียว

## คำสั่ง

หลัง `npm link` เรียก `exporter` ได้จากทุกโฟลเดอร์ · ไฟล์ผลลัพธ์อยู่ใต้ `exporter/` เสมอไม่ว่าจะรันจากที่ไหน:

- HotelTime `--daily` (รอบของ Windmill) → `exporter/data/hoteltime/daily/<YYYY-MM>/<YYYY-MM-DD>/`
  (คลังผลลัพธ์ ADR-0005) — หนึ่งโฟลเดอร์ต่อวัน **วันที่คือวันสุดท้ายที่ข้อมูลครอบคลุม** ไม่ใช่วันที่รัน ·
  ชื่อไฟล์ขึ้นต้นด้วยช่วงข้อมูลจริง เช่น `2026-10-05_2026-10-07__reservations-search.csv`,
  `2026-10-07__arrivals.csv` · ไฟล์ดิบ + manifest อยู่ใน `_raw/<report>/` · ทุกโฟลเดอร์มี
  `_summary.txt` (สรุปภาษาไทยว่าใบไหนผ่าน/ล้ม กี่แถว) และ `_run.json` (สำหรับสคริปต์) ·
  `data/hoteltime/daily/latest` ชี้วันล่าสุดที่ผ่านอย่างน้อยหนึ่งใบ · รันซ้ำวันเดียวกันแทนไฟล์ของ
  รายงานที่รันใหม่ ใบอื่นคงเดิม และไม่มีการลบไฟล์ของวันอื่น
- เวลาทั้งหมดของ exporter เป็น**เวลาไทย**เสมอ ("วันนี้", ชื่อโฟลเดอร์, เวลาใน `_summary.txt`) ไม่ว่าเครื่องตั้ง TZ อะไร —
  job บน Windmill เป็น UTC (ticket 27, `src/core/thai-time.ts`) · เวลาใน `_run.json` เป็น ISO UTC ตามปกติของเครื่อง
- ความหมายของ "รายวัน" ของ HotelTime: รายงาน ledger (`reservations-*`, `arrival-period`, `post-master*`, `manual-postings`, `postings`, `invoices-*`, `deposit-ledger`, `gift-certificate-ledger`, `city-tax`, `*-profiles`, `manager-items`, `accounting-report*`, `deposit-journal`) ดึงย้อน 3 วัน
  ถึงวันนี้ ส่วนรายงานภาพของวันนั้น (`arrivals`, `departures`, `in-house-guests`, `housekeeping`,
  `reservations-by-arrival-date`, `housekeeping-basic`, `housekeeping-all-in-one`, `rooms-status-overview`, `rooms-ooo`,
  `rooms-available`) ดึงวันนี้วันเดียว (ADR-0003) · หน้าสถิติ (`reservation-stats-*`, `combined-forecast`, `occupancy-*`) เก็บเป็น
  ภาพของวันที่ดึง ช่วงที่ดูตั้งตามวันที่รัน (ปีนี้ / เดือนนี้ / เดือนหน้า / ย้อน 12 เดือน — ดู `reports/statistics.ts`) ชื่อไฟล์บอกช่วงนั้น
  (`2026-11-01_2026-11-30__reservation-stats-term.csv`) ส่วนโฟลเดอร์เป็นวันที่ดึง · ใบแจ้งหนี้ค้างชำระ
  (`uncharged-invoices`, `uncharged-invoices-by-customer`, `deposit-to-use`, `unpaid-invoices-by-date`) เก็บเป็นรายการค้างทั้งหมด ณ วันที่ดึง
  · ตัวเลขรวม (`manager-summary`, `trial-balance`, `nationality-revenue`, `occupancy-by-nationality*`) เก็บเป็น "เดือนนี้ถึงวันนี้" ·
  `manager-day-detail` เก็บรายได้ของเมื่อวาน
- exit code: `0` = ผ่านหมด · `2` = ผ่านบางใบ (ไฟล์ของใบที่ผ่านอยู่ครบ) · `1` = ไม่ได้อะไรเลยหรือตั้งค่าผิด
- รอบเก็บตก: `exporter export --report all --daily --retry-failed` รันซ้ำเฉพาะใบที่สถานะล่าสุดในโฟลเดอร์ของวันนี้
  ยังล้ม (ไม่มีใบล้ม = จบทันทีไม่เปิดเบราว์เซอร์ · ยังไม่มีรอบของวันนี้ = รันเหมือนรอบรายวันปกติ) — Windmill ตั้งไว้ 15:00
  และ 18:00 (`windmill/INSTALL.md` § 6) เพราะรายงานภาพของวันนั้นที่พลาดวันไหนก็หายถาวร
- ลองใหม่อัตโนมัติ (`core/retry.ts`): รายงานที่ล้มเพราะ timeout / network / เบราว์เซอร์ถูกปิด ลองใหม่ไม่เกิน 2 ครั้ง
  รอ 30 แล้ว 60 วินาที · HotelTime เปิด session + ล็อกอินใหม่ทุกครั้ง · FoodStory ลองบน page เดิม (ล็อกอินใหม่ต้องกด
  captcha) · **ไม่ลองใหม่** กับชนเพดานแถว, verify ไม่ผ่าน, ล็อกอินไม่ผ่าน (อาจเป็นรหัสผิด ลองซ้ำเสี่ยงบัญชีถูกล็อก) ·
  จำนวนครั้งที่ลองอยู่ใน `_summary.txt` / `_run.json`
- HotelTime back-fill, `--from`/`--to`, `--last-days` → `exporter/data/hoteltime/backfill/<YYYY-MM-DD_HHMMSS>/`
  โฟลเดอร์ละรอบ ไม่ทับกันเอง
- HotelTime `--baseline` → `exporter/data/hoteltime/baseline/<YYYY-MM-DD>/` ของวันที่รัน · **ทุกใบเก็บไว้**
  (ADR-0005) ใบใหม่เป็นใบอ้างอิงตามความหมายของ ADR-0002 · ใบที่ล้มไม่ทำให้ทิ้งทั้งรอบ: baseline ปัจจุบันของ
  แต่ละรายงานคือ**โฟลเดอร์ล่าสุดที่รายงานนั้นผ่าน** (`currentBaselineFor()` ใน `core/run-record.ts`) ·
  `data/hoteltime/baseline/latest` ชี้โฟลเดอร์ล่าสุดที่ผ่านอย่างน้อยหนึ่งใบ
- baseline/back-fill ครอบหลายปีจึงแยก CSV ละปี ชื่อขึ้นต้นด้วยส่วนของปีนั้นที่อยู่ในช่วงที่ขอ เช่น
  `2024-01-01_2024-12-31__reservations-ratecode.csv`, `2026-01-01_2026-10-07__reservations-ratecode.csv`
- FoodStory รายวัน `--daily` → `exporter/data/foodstory/daily/<YYYY-MM>/<เมื่อวาน>/` — ดึง**เมื่อวาน** (เวลาไทย) วันเดียว
  (วันที่ปิดยอดแล้ว ย้ายไปรันเที่ยงคืนก็ยังถูก · ไม่ไล่เก็บวันที่พลาด รอบรายเดือนครอบคลุมให้ — ADR-0006, ticket 10) ·
  `daily/latest` · ไฟล์ `<เมื่อวาน>__<กลุ่ม>__<id>.xlsx` · ข้ามการเช็คไขว้ยอดขาย (salebymonthsum เป็นยอดทั้งเดือน เทียบกับวันเดียว
  ไม่ได้ — เหตุผลอยู่ใน `crossCheckSkipped` ของ `_manifest.json`) · รายงานที่ไม่มีตัวกรองวันที่ (สต็อก พนักงาน ฯลฯ) คือภาพ ณ ตอนรัน
  · พนักงานรันด้วยการดับเบิลคลิก `exporter/launchers/foodstory-daily.command` (symlink ไว้บน Desktop — หา node เอง, เช็ค `.env`/
  `node_modules`, สรุปภาษาไทยตอนจบ; ticket 11) คู่มือ: [`docs/FOODSTORY-DAILY-STAFF-GUIDE.md`](../docs/FOODSTORY-DAILY-STAFF-GUIDE.md)
- FoodStory รายเดือน → `exporter/data/foodstory/monthly/<YYYY-MM>/` สำหรับรอบแรกของเดือนนั้น · ดึงเดือนเดิมซ้ำได้
  `monthly/<YYYY-MM>__<YYYY-MM-DD>/` (วันที่ดึง) แทนการเขียนทับ (ADR-0005 — ยอดที่ร้านแก้ย้อนหลังไม่ทับของเดิม) · ดึงซ้ำ
  **วันเดียวกัน** (เวลาไทย) ใช้โฟลเดอร์ของวันนั้นต่อ รวมถึง `<YYYY-MM>/` ถ้ารอบแรกของมันเป็นวันนี้ — ผลรวมกันใน `_run.json`/
  `_manifest.json` และไฟล์ของรายงานถูกแทนเฉพาะเมื่อรอบใหม่ผ่าน (ดาวน์โหลดลง `_downloads/<id>/` ก่อน) ·
  ในโฟลเดอร์มี xlsx `<YYYY-MM>__<กลุ่ม>__<id>.xlsx` + `_manifest.json` (ที่มา + เช็คไขว้ยอดขาย) + `_summary.txt` +
  `_run.json` · exit code 0/2/1 แบบเดียวกับ HotelTime (truncated นับเป็นล้ม) · `--json` บอกโฟลเดอร์ใน `outDir`

```bash
exporter login --check                       # ตรวจว่า credential ใช้ได้จริง
exporter reports                             # ดูรายงานที่รองรับและกติกาการแบ่งก้อน

# ── ดึงทุกรายงานในคำสั่งเดียว (--report all) ──
# hoteltime: --daily รันครบ 8 ใบ (ช่วงวันที่ 3 วันล่าสุด + รายงานรายวันของวันนี้) — ตรงกับที่ Windmill รัน
exporter export --report all --daily
# hoteltime: ไม่ใส่ flag = back-fill 01/01/2024 → วันนี้ ของรายงานช่วงวันที่ 4 ใบ
#   (reservations-search/ratecode/cancelled, arrival-period) — รายงานรายวัน 4 ใบ (arrivals,
#   departures, in-house-guests, housekeeping) ถูกข้าม ขึ้น ⏭ ไม่นับว่าล้ม (ADR-0003)
#   กติกาเดียวกันกับ --from/--to, --last-days, --baseline
exporter export --report all
# foodstory: เดือนที่แล้วทั้งเดือน 49 รายงาน (reservation-report รันใบสุดท้าย) — ต้องมีคนแก้ reCAPTCHA ตอน login
exporter export --site foodstory --report all --headful

# ดึงย้อนหลังทีละใบ (01/01/2024 → วันนี้) ลง data/hoteltime/backfill/<เวลาที่รัน>/
exporter export --report reservations-search

# เลือกว่าจะเก็บผลเป็นอะไร (ค่าเริ่มต้น both)
exporter export --report reservations-search --format raw      # .xlsx ดิบ + manifest
exporter export --report reservations-search --format csv      # CSV รายปี ลบไฟล์ดิบ

# จำกัดช่วง
exporter export --report reservations-search --from 01/07/2026 --to 08/09/2026

# ดูมันทำงานสด ๆ — เปิดหน้าต่างเบราว์เซอร์จริง หน่วงให้ตามทัน
exporter export --report reservations-search --headful --slow-mo 250

exporter export --report reservations-search --json            # ผลเป็น JSON

npm test                                     # unit test (ไม่แตะเบราว์เซอร์)
npm run typecheck
```

## เอกสาร

| อยากรู้อะไร | อ่านที่ไหน |
|---|---|
| **ใช้งานยังไงให้ปลอดภัย** (สำหรับคนที่เพิ่งมา) | [`.claude/skills/exporter/SKILL.md`](../.claude/skills/exporter/SKILL.md) |
| **เหตุผลของทุกการตัดสินใจ** | [`specs/`](./specs/README.md) — 9 ใบ (01–06 accepted · 07–09 draft) |
| สิ่งที่วัดได้จากเว็บจริง (หลักฐาน) | [`recon/NOTES.md`](./recon/NOTES.md) |
| แผนที่หน้ารายงานทั้งหมดของ HotelTime | [`recon/MENU.md`](./recon/MENU.md) |

🔴 **ก่อนแก้โค้ดใด ๆ อ่าน [`specs/02`](./specs/02-spec-hoteltime-constraints.md) ก่อน** —
ข้อจำกัด 6 ข้อของ HotelTime ที่พังแบบเงียบทั้งหมด

## ไฟล์ดิบ vs CSV — อันไหนคือ source of truth

ไฟล์ `.xlsx` ดิบถูกดาวน์โหลดทุกรอบอยู่แล้วเพราะชั้นตรวจต้องอ่านมัน `--format` จึงคุมแค่ว่า
จะ **เก็บอะไรไว้** หลังตรวจเสร็จ

| | ไฟล์ดิบ `.xlsx` | CSV |
|---|---|---|
| ที่อยู่ (`--daily`) | `data/hoteltime/daily/<เดือน>/<วัน>/_raw/<report>/` | `data/hoteltime/daily/<เดือน>/<วัน>/<ช่วงข้อมูล>__<report>.csv` (ไฟล์เดียวต่อรายงาน) |
| ที่อยู่ (back-fill ฯลฯ) | `data/hoteltime/backfill/<เวลา>/_raw/<report>/` | `data/hoteltime/backfill/<เวลา>/<ช่วงของปี>__<report>.csv` |
| ที่อยู่ (`--baseline`) | `data/hoteltime/baseline/<วัน>/_raw/<report>/` | `data/hoteltime/baseline/<วัน>/<ช่วงของปี>__<report>.csv` |
| ผ่านการแปลงของเราไหม | **ไม่เลย** — ไบต์ตรงจาก HotelTime | อ่าน → รวมก้อน → แปลงวันที่ → เขียนใหม่ |
| จำนวนไฟล์ | หนึ่งไฟล์ต่อหนึ่งก้อน (รายเดือนคือ ~33 ไฟล์) | รอบรายวัน: ไฟล์เดียว · รอบอื่น: หนึ่งไฟล์ต่อหนึ่งปี |
| Excel serial | ยังเป็น `45658` ดิบ ๆ | แปลงเป็น `01/01/2025` แล้ว (มีเวลาด้วยเป็น `01/01/2025 18:59`) |
| เปิดด้วยไลบรารีทั่วไป | ❌ `openpyxl` อ่านไม่ได้ (styles ผิดสเปก) | ✅ อ่านได้ทุกตัว |
| เหมาะกับ | **หลักฐาน/ตรวจสอบย้อนหลัง** | ใช้งานจริง · DuckDB/parquet |

**ถ้าจะเก็บเป็น source of truth ให้ใช้ `--format raw` หรือ `both`** — ไฟล์ดิบมาพร้อม
`manifest.json` ที่บันทึกว่าแต่ละไฟล์มาจากหน้าไหน กรองด้วยช่วงอะไร ดึงเมื่อไหร่ ได้กี่แถว
ช่วงวันที่จริงในไฟล์ ชื่อไฟล์ที่ HotelTime เสนอมา ขนาด และ **sha256** สำหรับยืนยันว่า
ไบต์ยังไม่ถูกแก้

⚠️ รันรายงานเดิมซ้ำลงโฟลเดอร์รอบเดิม (เช่น `--daily` สองครั้งในวันเดียว) ไฟล์ดิบถูกดึงลง `_raw/<report>.partial/`
ก่อน แล้วค่อยแทน `_raw/<report>/` + CSV ของรายงานนั้น**เฉพาะเมื่อผ่านทุกด่าน** — ล้มกลางทางของเดิมอยู่ครบ
และ manifest ตรงกับไฟล์ที่อยู่จริงเสมอ

## ข้อเท็จจริงเกี่ยวกับ HotelTime ที่กำหนดดีไซน์ทั้งหมด

ตรวจจากของจริงที่ `th07.hoteltime.com` เมื่อ 2026-09-08 — ห้าข้อนี้ไม่ใช่การเดา

1. **ไม่มี anti-bot / CAPTCHA** — headless Chromium โหลดหน้า login ผ่านฉลุย
   → Playwright บนเครื่องเราเองพอ ไม่ต้องเช่าเบราว์เซอร์จากใคร
2. **เป็น ASP.NET WebForms** (`__VIEWSTATE` 912 ตัวอักษร, `__EVENTVALIDATION`,
   `__doPostBack()`, `WebResource.axd`, v4.6.24)
   → **ยิง URL ตรง ๆ ด้วย curl ไม่ได้** viewstate ผูกกับ session และถูก validate ฝั่ง server
   นี่คือเหตุผลที่ต้องใช้เบราว์เซอร์จริง
   · **แต่การนำทางระหว่างหน้าเป็น `<a href>` ปกติ** จึง `page.goto()` เข้าหน้ารายงาน
   ได้เลยไม่ต้องไล่คลิกเมนู — ส่วนที่เป็น postback คือฟอร์ม login กับ filter/export ในหน้ารายงาน
3. **ไม่มี 2FA** — ฟอร์มมีแค่ Login / Password / Submit → ล็อกอินอัตโนมัติได้
4. **session เป็น server-side** → `storageState` / persistent profile ให้ความรู้สึกปลอมว่า
   "ล็อกอินค้างไว้แล้ว" แล้วไปพังตอนกด export · runner จึงล็อกอินใหม่ทุกรอบแทน
5. **ฟอร์ม login เป็น repeater** (`rptLastUsers$ctl00$tbUserName`) — เลข index ใน id
   เลื่อนได้เมื่อจำนวน "last used user" เปลี่ยน → ห้ามผูกกับ id ใช้ role + accessible name
   แล้ว assert ว่าเจอชิ้นเดียว (`uniqueByRole` ใน `src/sites/hoteltime/webforms.ts`)

## ความเสี่ยงอันดับ 1 และวิธีกัน

**ไฟล์ที่ "ดูปกติแต่ผิด"** อันตรายกว่าสคริปต์พัง เพราะพังแล้วรู้ แต่ดึงผิดช่วงวันที่แล้ว
สำเร็จจะไม่มีใครรู้จนกว่าจะมีคนถามตัวเลขแล้วได้คำตอบผิด — ซึ่งอาจเป็นเดือนถัดไป

สองด่านที่กันเรื่องนี้:

- `assertStillLoggedIn()` เรียก **ก่อน** กด export ทุกครั้ง — ถ้า session หลุดกลางทาง
  WebForms จะเด้งกลับหน้า login แล้วการกด export ต่อจะได้ไฟล์ว่างที่หน้าตาปกติ
- `sites/hoteltime/verify.ts` (`verifyChunk`) เทียบไฟล์ที่ได้กับ **"ใบสั่ง"** ที่ runner ถือมาตั้งแต่ก่อนเปิดเบราว์เซอร์
  — เป็นการ *เปรียบเทียบค่า* ไม่ใช่การ *ตีความ*

ชั้นตรวจนี้จับของจริงมาแล้วสองอย่าง: **เพดาน 2000 แถวที่ HotelTime ตัดเงียบ ๆ**
และ **บั๊กปัดเศษ Excel serial ของเราเอง** ที่จะทำให้วันที่ครึ่งคอลัมน์เพี้ยนไปหนึ่งวัน

## ความลับ

- `.env` ถูก gitignore ตั้งแต่ commit แรก (เคยมี `.dev.vars` หลุดขึ้น git ในเวิร์กสเปซนี้
  มาแล้ว — auth-center แก้ไป 2026-08-17)
- `data/`, `downloads*/` และ `recon/captures/` ถูก gitignore ด้วย เพราะมีชื่อผู้เข้าพัก =
  **ข้อมูลส่วนบุคคล**
- ทุกข้อความที่จะพิมพ์ออกจอหรือลงไฟล์ผ่าน `src/core/redact.ts` ก่อนเสมอ —
  Playwright ชอบแนบ HTML ของหน้ามากับ error และ WebForms echo ค่าที่ post กลับมาใน
  viewstate รหัสผ่านจึงหลุดลง log ได้ง่ายกว่าที่คิด
- credential แยกจาก `Config` ที่ระดับ type (`loadCredentials()` ต่างหาก) เพื่อให้
  `console.log(config)` ทำรหัสหลุดไม่ได้ตั้งแต่แรก

## โครงสร้าง

```
src/
  index.ts                    commander wiring · --site hoteltime | foodstory (ADR-0004)
  core/                       เฉพาะของที่พิสูจน์แล้วว่าไม่ผูกกับ site ไหนเลย
    order.ts                  ใบสั่ง · ซอยก้อนรายเดือน · ผ่าครึ่งเมื่อชนเพดาน
    csv.ts                    เขียน CSV ผลลัพธ์
    redact.ts                 กันความลับหลุดลง log
    xlsx.ts                   ตัวอ่านที่ทนไฟล์ผิดสเปกของ HotelTime
    gate.ts                   เกราะ allowlist — เช็คก่อนแตะ control ไหนก็ตาม (pure ไม่ผูก site)
    verify.ts                 ส่วนที่ generic: เทียบก้อนสะสมกับช่วงที่สั่ง, เทียบ manifest 2 รอบ
  sites/hoteltime/            ทุกอย่างที่คุยกับหน้าเว็บ HotelTime จริง
    config.ts                 shell env > .env > default (prefix HOTELTIME_*) · credential แยกจาก config
    session.ts                เปิดเบราว์เซอร์ · ล็อกอิน
    webforms.ts               helper เฉพาะ ASP.NET — รวมกับดักที่เจอจากของจริงไว้ที่เดียว
    sweep-classify.ts         ตัวจำแนกผล sweep (บริสุทธิ์ล้วน แต่ผูกกับ pattern control ของ ASP.NET)
    verify.ts                 ส่วนที่ผูกกับรูปร่าง Report ของ HotelTime (verifyChunk/RowCapError)
    export.ts / login.ts / sweep.ts   คำสั่งจริง — สั่งจาก index.ts
    reports/                  หนึ่งไฟล์ต่อหนึ่งรายงาน (8 ใบ: ช่วงวันที่ 4 + รายวัน 4 — ADR-0003)
  sites/foodstory/            FoodStory — config.ts (prefix FOODSTORY_*) · login ต้องมีคนแก้ reCAPTCHA
                              reports/ 47 ใบ + salebychannel.ts + reservation-report.ts = 49 ใบใน --report all
recon/NOTES.md          บันทึกเส้นทาง/filter/กับดักที่เจอตอนสำรวจ — ที่มาของทุกค่าในโค้ด
recon/menu-sweep.json   ผล sweep ทั้งเว็บล่าสุด (สคริปต์ล้วน ดู ADR-0001)
data/                   คลังผลลัพธ์ (ADR-0005) — ทุกโฟลเดอร์รอบมี CSV + _raw/ + _summary.txt + _run.json (gitignored)
  hoteltime/daily/<YYYY-MM>/<YYYY-MM-DD>/   รอบรายวัน (วันสุดท้ายที่ข้อมูลครอบคลุม) + daily/latest
  hoteltime/baseline/<YYYY-MM-DD>/          --baseline ทุกใบ (วันที่รัน) + baseline/latest
  hoteltime/backfill/<YYYY-MM-DD_HHMMSS>/   back-fill / --from/--to / --last-days โฟลเดอร์ละรอบ
  foodstory/daily/<YYYY-MM>/<YYYY-MM-DD>/   FoodStory --daily (เมื่อวาน) + daily/latest
  foodstory/monthly/<YYYY-MM>[__<YYYY-MM-DD>]/  FoodStory รายเดือน (ดึงซ้ำได้โฟลเดอร์ที่มีวันที่ดึง) — xlsx + _manifest.json แทน CSV/_raw/
  foodstory/_downloads/                     ที่พักไฟล์ระหว่างดาวน์โหลด (ไฟล์สุดท้ายถูกย้ายเข้าโฟลเดอร์รอบ)
downloads*/             ของเดิมก่อนคลังใหม่ — ย้ายเข้า data/ แล้ว (ticket 05) รอเจ้าของระบบลบเอง (gitignored)
```

เดิมชื่อ `pms-export` — rename เป็น `exporter` แล้ว 2026-09-28 หลัง FoodStory proven (ADR-0004,
ticket 13 ของ `.scratch/exporter-multi-site/`)

**ทำไม `reports/` เป็น TypeScript ไม่ใช่ JSON config** — filter ของแต่ละรายงานเฉพาะตัวมาก
JSON จะสู้ไม่ไหวแล้วค่อย ๆ กลายเป็นภาษาโปรแกรมครึ่งใบ · ใช้หนึ่งไฟล์ต่อหนึ่งรายงาน
ที่ implement interface เดียวกันแทน ได้ทั้งความอิสระและความสม่ำเสมอ
