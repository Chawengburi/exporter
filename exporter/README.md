# exporter

> เดิมชื่อ `pms-export` — rename 2026-09-28 (ADR-0004): คำสั่ง `exporter`, `.env` prefix ของ HotelTime
> เปลี่ยนจาก `PMS_*` เป็น `HOTELTIME_*` · เอกสาร/ticket ก่อนวันนั้นยังเรียกชื่อเดิม

> **โมเดลรอบรายวัน (2026-10-14, `.scratch/exporter-daily-per-day-raw/`):** เก็บแค่ **ไฟล์ดิบ** (ADR-0007) · **รายงานตามวัน**
> ดึงไฟล์ละ **วันของข้อมูล** · **รายงานภาพ** ถ่าย ณ เวลาที่รัน (ADR-0008) · เติมวันที่ขาดเองตั้งแต่ **วันเริ่มใช้งาน** (ADR-0009) · แจ้งผลทาง
> Discord · ศัพท์ทั้งหมดอยู่ใน [`CONTEXT.md`](../CONTEXT.md)

ดึงรายงานจาก **HotelTime PMS** (ระบบโรงแรม) และ **FoodStory** (ระบบร้านอาหาร) ด้วย Playwright แล้วเก็บไฟล์ดิบลงดิสก์

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
| `exporter export` — ดึงไฟล์ดิบ + ตรวจ + `_manifest.json` | ✅ HotelTime 48 รายงาน · FoodStory 49 รายงาน |
| รอบรายวันแบบไฟล์ละวันของข้อมูล + เติมวันที่ขาดเอง + ภาพปิดงวด + baseline | ✅ 2026-10-14 (ใบ 01–09 ของ `exporter-daily-per-day-raw`) |
| `exporter status` + แจ้งเตือน Discord | ✅ 2026-10-14 (ใบ 07–08) |
| ชั้นตรวจไฟล์ (`sites/hoteltime/verify.ts` + `core/verify.ts`) | ✅ เสร็จ — จับบั๊กจริงไปแล้ว 1 ตัว |
| รองรับหลาย site (`src/sites/<site>/`) | ✅ HotelTime 48 รายงาน + FoodStory 49 รายงาน (FoodStory ต้องมีคนแก้ reCAPTCHA ทุกรอบ รันบน Windmill ไม่ได้) · rename เป็น `exporter` แล้ว 2026-09-28 (ADR-0004) |
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

หลัง `npm link` เรียก `exporter` ได้จากทุกโฟลเดอร์ · ไฟล์ผลลัพธ์อยู่ใต้ `exporter/data/` เสมอไม่ว่าจะรันจากที่ไหน · เวลาทั้งหมดเป็น
**เวลาไทย** ("วันนี้", ชื่อโฟลเดอร์, ชื่อไฟล์) ไม่ว่าเครื่องตั้ง TZ อะไร (`src/core/thai-time.ts`)

### รอบรายวัน `--daily` (ทั้งสอง Site — ADR-0008/0009)

- **รายงานตามวัน** (HotelTime 22 · FoodStory 42 — ledger/ยอดของวันเดียว) ขอ Site ทีละ **วันของข้อมูล** ได้ไฟล์ละวัน
  `<วันของข้อมูล>__<id>.xlsx` (เช่น `2026-10-13__postings.xlsx`) ลง `data/<site>/daily/<YYYY-MM>/<วันของข้อมูล>/` · วันของข้อมูลปกติ =
  **เมื่อวาน** (ถึงกำหนดตั้งแต่ 07:00 เวลาไทย — รายงานยกเลิกของ HotelTime ตัดวันตาม UTC)
- **รายงานภาพ** (HotelTime 26 · FoodStory 7 — สถานะห้อง แขก สต็อก ข้อมูลหลัก ยอดสะสม พยากรณ์) ถ่ายวันละครั้ง ณ เวลาที่รัน ชื่อ
  `<YYYYMMDDTHHMMSS+0700>__<id>.xlsx` ลงโฟลเดอร์ของวันนี้ · ภาพของวันที่ผ่านไปแล้ว**ดึงย้อนไม่ได้**
- **ภาพปิดงวด**: 7 วันแรกของเดือน/ปีใหม่ ถ่ายยอดสะสมของงวดที่จบ ชื่อ `<ต้นงวด>--<สิ้นงวด>__<id>.xlsx` ลงโฟลเดอร์ของวันสุดท้ายของงวด
- **เติมวันที่ขาดเอง**: ทุกรอบดึง (รายงาน, วันของข้อมูล) ที่ยังไม่สำเร็จตั้งแต่ **วันเริ่มใช้งาน** (`EXPORTER_GO_LIVE` ใน `.env`) ใหม่สุดก่อน
  ไม่เกิน 3 วันต่อรอบ (เพดานจาก timeout 15 นาทีของ Windmill) · ไม่ตั้งวันเริ่มใช้งาน = ดึงแค่เมื่อวาน · **ว่าง** (เว็บไม่มีรายการ) นับว่าสำเร็จ ·
  ไม่มีงาน = จบทันทีไม่เปิดเบราว์เซอร์ — รอบเก็บตก 15:00/18:00 ของ Windmill จึงเป็นคำสั่งเดียวกับรอบเที่ยง
- FoodStory: login ครั้งเดียว (คนกด reCAPTCHA) แล้วตั้งช่วงวันที่ทีละวันในรอบเดียว · พนักงานกดผ่านไอคอนบน Desktop
  (`exporter/launchers/foodstory-daily.command` — วางด้วย `bash exporter/launchers/install-desktop-launcher.sh`) คู่มือ:
  [`docs/FOODSTORY-DAILY-STAFF-GUIDE.md`](../docs/FOODSTORY-DAILY-STAFF-GUIDE.md)
- หลังจบรอบรายวันทุกครั้งส่ง Discord (ด้านล่าง) · `data/<site>/daily/latest` ชี้โฟลเดอร์ของวันนี้
- exit code: `0` = ผ่านหมด (หรือไม่มีงาน) · `2` = ผ่านบางใบ · `1` = ไม่ได้อะไรเลยหรือตั้งค่าผิด
- ลองใหม่อัตโนมัติ (`core/retry.ts`): timeout / network / เบราว์เซอร์ถูกปิด ลองใหม่ไม่เกิน 2 ครั้ง · **ไม่ลองใหม่** กับชนเพดานแถว, verify
  ไม่ผ่าน, ล็อกอินไม่ผ่าน (ลองซ้ำเสี่ยงบัญชีถูกล็อก)

### ที่เก็บข้อมูล (ADR-0005/0007)

- เก็บแค่ **ไฟล์ดิบ** ตามที่ Site ให้มา (ไม่แปลง ไม่เขียน CSV) — การแปลง/ตัดคอลัมน์/ซ่อนข้อมูลส่วนตัวเป็นของ uploader
- ทุกโฟลเดอร์มี `_manifest.json` (ต่อไฟล์: รายงาน ตระกูล ช่วงวันของข้อมูล เวลาที่ได้ จำนวนแถว ชื่อชีต ขนาด **sha256** หน้าต้นทาง) ·
  `_run.json` (สถานะล่าสุดต่อรายงาน — ตัววางแผนกับ `status` อ่านจากนี้) · `_summary.txt` (สรุปภาษาไทย)
- **ไม่ลบ ไม่ทับ**: ดึงชื่อเดิมซ้ำแล้วไบต์ต่าง → ฉบับเก่าย้ายไป `_superseded/` (บันทึกใน `superseded[]` ของ manifest) · ไบต์เหมือนเดิม → เก็บชุดเดียว
- ⚠ sha256 ของทั้งไฟล์เปลี่ยนทุกครั้งที่ดาวน์โหลด แม้ข้อมูลเหมือนเดิม (xlsx มีเวลาที่สร้างไฟล์ใน `docProps/core.xml`) — ใช้ตรวจว่าไฟล์ไม่เสีย
  ไม่ใช่ใช้บอกว่าข้อมูลเปลี่ยน

### คำสั่งอื่น

- `--date YYYY-MM-DD` (HotelTime): ดึงรายงานตามวันของวันนั้นวันเดียวใหม่ ไม่สนสถานะเดิม · ถึงเมื่อวาน · ไม่ถ่ายรายงานภาพ
- `--baseline` (HotelTime, ใบ 09): ดึงวันของข้อมูลที่เคยดึงแล้วใหม่ ไฟล์ละวันชื่อเดียวกับรอบรายวัน ลง `data/hoteltime/baseline/<วันที่รัน>/`
  (โฟลเดอร์รายวันไม่ถูกแตะ · `_run.json` ใช้ id `<รายงาน>@<วัน>`) · `--from/--to` หรือไม่ใส่ = `--baseline-interval-days` (30) วันล่าสุดถึงเมื่อวาน ·
  รายงานภาพไม่มี baseline
- back-fill `--from`/`--to`/`--last-days` (HotelTime): ก้อนหลายวัน ชื่อช่วง `<from>--<to>__<id>.xlsx` ลง `data/hoteltime/backfill/<เวลาที่รัน>/`
  · รายงาน dailyOnly (ADR-0003) ถูกข้าม
- FoodStory รายเดือน (ไม่ใส่ `--daily`): เดือนที่แล้วทั้งเดือน ลง `data/foodstory/monthly/<YYYY-MM>/` · ดึงเดือนเดิมซ้ำวันอื่นได้
  `monthly/<YYYY-MM>__<วันที่ดึง>/` · เกิน 5,000 แถวผ่าช่วงเป็น `<id>_part<n>.xlsx` (part ต้องต่อกันจึงครบเดือน)
- `status`: สรุปหน้าเดียวต่อ Site × วันของข้อมูล (มีข้อมูล / ว่าง / ล้ม / ยังไม่ได้ดึง + รายงานภาพ + ภาพปิดงวด + สิ่งที่ต้องทำ) อ่านคลังอย่างเดียว ·
  `--json` คือโครงสร้างที่ใช้สร้างข้อความ Discord · exit 0 ปกติ/มีสิ่งต้องทำ · 1 มีปัญหา · 2 ใช้ผิด
- `notify`: ส่ง Discord เอง (`--summary` ส่งสรุปของวันนี้ · `--dry-run` แค่แสดง) — รอบรายวันเรียกเองอยู่แล้ว: สรุปวันละครั้งหลังรอบ
  HotelTime ที่จบหลัง 18:00 · แจ้งเตือนทันทีเมื่อ status มีปัญหา/ขาดเกินเพดาน/FoodStory ไม่ได้กดมา 2 วัน · ไม่ซ้ำในวันเดียว ·
  URL อยู่ใน `.env` (`DISCORD_WEBHOOK_URL`) ไม่มี = ข้าม · ส่งไม่ได้ไม่ทำให้รอบล้ม (บันทึกใน `data/_notify/discord.json`)
- flag ที่เลิกใช้ (ใส่มา = exit 1 พร้อมเหตุผล): `--format`, `--overlap-days`, `--retry-failed`

```bash
exporter status                              # สรุปภาษาไทยว่าระบบปกติไหม (อ่านคลังอย่างเดียว · --json · --days 14)
exporter login --check                       # ตรวจว่า credential ของ HotelTime ใช้ได้จริง
exporter reports                             # ดูรายงานที่รองรับ

exporter export --report all --daily                          # HotelTime รอบรายวัน — คำสั่งเดียวกับที่ Windmill รันทั้ง 3 เวลา
exporter export --site foodstory --report all --daily --headful   # FoodStory รอบรายวัน (คนกด reCAPTCHA) — สิ่งที่ไอคอนบน Desktop รัน
exporter export --report all --date 2026-10-12                # ดึงวันของข้อมูลวันเดียวใหม่ (HotelTime)
exporter export --report all --baseline --from 01/10/2026 --to 13/10/2026   # baseline ไฟล์ละวัน (HotelTime)
exporter export --report reservations-search --from 01/07/2026 --to 08/09/2026   # back-fill
exporter export --site foodstory --report all --headful       # FoodStory รายเดือน (เดือนที่แล้ว)
exporter notify --dry-run --summary                           # ดูข้อความ Discord ที่จะส่ง ไม่ส่งจริง

exporter export --report postings --date 2026-10-12 --headful --slow-mo 250   # ดูมันทำงานสด ๆ
exporter export --report all --daily --json                  # ผลเป็น JSON (--daily บอกโฟลเดอร์เป็น outDirs)

npm test                                     # unit test
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

## ไฟล์ดิบคือ source of truth (ADR-0007)

exporter ส่งต่อแค่ไฟล์ดิบตามที่ Site ให้มา — ไบต์ตรงจากต้นทาง ไม่ผ่านการแปลงของเรา · ชั้นตรวจยังอ่านไฟล์ทุกไฟล์ก่อนวาง (ทุกชีต — นับแถว,
เพดานแถว, ช่วงวันที่ทุกชีตที่มีคอลัมน์วันที่) ไฟล์ที่ไม่ผ่านไม่ถูกนับเป็น "มีข้อมูล" · `_manifest.json` บอกว่าไฟล์มาจากหน้าไหน กรองด้วยคอลัมน์อะไร
ครอบวันไหน ได้เมื่อไหร่ กี่แถว และ sha256 · ข้อควรรู้สำหรับคนเปิดไฟล์เอง: xlsx ของ HotelTime มี `styles.xml` ผิดสเปก (`openpyxl` อ่านตรง ๆ ไม่ได้ —
ตัวแปลงของ uploader ซ่อมให้แล้ว) และวันที่เป็น Excel serial

ไฟล์ CSV และ `_raw/` ในโฟลเดอร์ก่อน 2026-10-14 เป็นของรอบรูปแบบเดิม — เก็บไว้ตามเดิม (ไม่ลบ) `status` แสดงเป็นประวัติ

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
    order.ts                  ใบสั่ง · ซอยก้อนรายเดือน · ผ่าครึ่งเมื่อชนเพดาน · ช่วงของ back-fill/baseline
    run-planner.ts            ตัววางแผนรอบ (ฟังก์ชันล้วน): วันไหน/รายงานไหนต้องดึง · เติมวันที่ขาด · ภาพปิดงวด · baseline
    run-record.ts             _run.json / _summary.txt · placement.ts ชื่อไฟล์ ISO + โฟลเดอร์ · raw-manifest.ts _manifest.json + _superseded/
    status.ts                 exporter status · discord.ts ข้อความ + ตัวส่ง Discord · browser-env.ts env ของเบราว์เซอร์ไม่มีความลับ
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
    reports/                  หนึ่งไฟล์ต่อหนึ่งรายงาน — 48 ใบ แต่ละใบบอกตระกูล (ตามวัน/ภาพ) และงวด
  sites/foodstory/            FoodStory — config.ts (prefix FOODSTORY_*) · login ต้องมีคนแก้ reCAPTCHA · daily.ts รอบรายวันใน login เดียว
                              reports/ 47 ใบ + salebychannel.ts + reservation-report.ts = 49 ใบใน --report all
  notify.ts                   แจ้ง Discord หลังรอบรายวัน / exporter notify (ประกอบ status + discord + บันทึกที่ส่งแล้ว)
recon/NOTES.md          บันทึกเส้นทาง/filter/กับดักที่เจอตอนสำรวจ — ที่มาของทุกค่าในโค้ด
recon/menu-sweep.json   ผล sweep ทั้งเว็บล่าสุด (สคริปต์ล้วน ดู ADR-0001)
data/                   คลังผลลัพธ์ (ADR-0005) — ทุกโฟลเดอร์รอบมีไฟล์ดิบ + _manifest.json + _summary.txt + _run.json (gitignored)
  hoteltime/daily/<YYYY-MM>/<YYYY-MM-DD>/   รอบรายวัน: โฟลเดอร์ = วันของข้อมูล (และรายงานภาพที่ถ่ายวันนั้น) + daily/latest
  hoteltime/baseline/<YYYY-MM-DD>/          --baseline (วันที่รัน) ไฟล์ละวันของข้อมูล + baseline/latest
  hoteltime/backfill/<YYYY-MM-DD_HHMMSS>/   back-fill / --from/--to / --last-days โฟลเดอร์ละรอบ
  foodstory/daily/<YYYY-MM>/<YYYY-MM-DD>/   FoodStory --daily: โฟลเดอร์ = วันของข้อมูล + daily/latest
  foodstory/monthly/<YYYY-MM>[__<YYYY-MM-DD>]/  FoodStory รายเดือน (ดึงซ้ำได้โฟลเดอร์ที่มีวันที่ดึง) — xlsx + _manifest.json แทน CSV/_raw/
  foodstory/_downloads/                     ที่พักไฟล์ระหว่างดาวน์โหลด (ไฟล์สุดท้ายถูกย้ายเข้าโฟลเดอร์รอบ)
  _notify/discord.json                      เรื่องที่ส่ง Discord แล้ว / ส่งไม่ได้ (กันส่งซ้ำ)
downloads*/             ของเดิมก่อนคลังใหม่ — ย้ายเข้า data/ แล้ว (ticket 05) รอเจ้าของระบบลบเอง (gitignored)
```

เดิมชื่อ `pms-export` — rename เป็น `exporter` แล้ว 2026-09-28 หลัง FoodStory proven (ADR-0004,
ticket 13 ของ `.scratch/exporter-multi-site/`)

**ทำไม `reports/` เป็น TypeScript ไม่ใช่ JSON config** — filter ของแต่ละรายงานเฉพาะตัวมาก
JSON จะสู้ไม่ไหวแล้วค่อย ๆ กลายเป็นภาษาโปรแกรมครึ่งใบ · ใช้หนึ่งไฟล์ต่อหนึ่งรายงาน
ที่ implement interface เดียวกันแทน ได้ทั้งความอิสระและความสม่ำเสมอ
