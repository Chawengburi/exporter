# อัปเดตเครื่อง Ubuntu — 2026-11-16 (หน้าเดียว)

เครื่องนี้ = เครื่อง production เครื่องเดียวที่ export + upload ทำตามทีละขั้น ถ้าอะไรไม่ตรงกับ "ควรเห็น" ให้**หยุด**แล้วส่งรูปหน้าจอให้ผู้พัฒนา (ห้ามส่งไฟล์ข้อมูล .csv/.xlsx, `.env`, `.admin-password`, token)

## ในการอัปเดตนี้มีอะไร
1. **รายงานใหม่ 2 ตัวของ HotelTime:** `vat-output` (ใบกำกับภาษีขาออก) และ `vat-inspection` (ภาษีแยกรายอัตรา) — เป็นรายงานตามวัน HotelTime จึงมี **25** รายงานตามวัน (เดิม 23) รวม 52 รายงาน
2. **ชื่อใน Windmill เปลี่ยน** เป็นรูป `[Exporter] HotelTime (12.00) Daily` / `[Pipeline] HotelTime (19.00) …` ให้เรียงตามชื่อแล้วอ่านง่าย — เปลี่ยนเฉพาะชื่อที่แสดง เวลาและการทำงานเหมือนเดิม path ไม่เปลี่ยน
3. **เอกสาร/ข้อความ:** FoodStory login เป็น Cloudflare Turnstile (ระบบแก้ผ่าน 2captcha เหมือนเดิม ไม่ต้องทำอะไร)

## ก่อนเริ่ม (2 นาที)
- เลือกเวลา **13:00–14:45** (ห้ามช่วง 11:55–12:45, 12:45–13:00 ที่ pipeline รัน, 15:00, 18:00 และ 19:00)
- จดเลขเวอร์ชันปัจจุบันไว้เผื่อย้อนกลับ: `cd ~/chawengburi-exporter && git rev-parse --short HEAD`

## ขั้นตอน
```bash
cd ~/chawengburi-exporter && git pull && bash deploy/ubuntu/install.sh
```
ตัวติดตั้งรันซ้ำได้ปลอดภัย (ไม่ถามรหัสซ้ำ ไม่แตะ `.env`) และรัน `windmill/setup.mjs` ให้เอง
> รอบนี้ไม่มีไฟล์ package เปลี่ยน จึงรัน `git pull` แล้วตามด้วย `node windmill/setup.mjs` อย่างเดียวได้เช่นกัน (ที่เครื่อง production ทำไปแล้ว ผลถูกต้อง) แต่ปกติให้ใช้ `install.sh` เสมอ

**ผลของ `setup.mjs` ที่ควรเห็น (ตรงกับที่เกิดขึ้นจริงรอบแรก ทั้งหมด 19 อย่าง):**
- `Deployed a new version of the script …` + `Updated the schedule of …` สำหรับ script เดิม 6 ตัว: `pms_export_daily`, `pms_export_daily_catchup`, `foodstory_export_daily`, `foodstory_export_daily_catchup`, `ht_pipeline_daily`, `ht_pipeline_weekly_verify` (เปลี่ยนชื่อ/เวลาในที่เดิม)
- `Created the script …` / `Set the schedule of …` ได้เฉพาะที่**เพิ่งมีใหม่ในรอบนี้**เท่านั้น: `pms_export_snapshot_0600`, `pms_export_snapshot_2300` (+ `_retry` ของทั้งสอง — รอบ snapshot เสริม ADR-0013 ซึ่งออกทันทีไม่ login เมื่อไม่ได้เปิดใน `.env`) และ `ht_pipeline_daily_1245` (pipeline รอบ 12:45)
- รันซ้ำอีกรอบต้องได้ `Nothing changed — everything is already set up`

**หยุดทันทีถ้า:** เห็น `Created the script` / `Set the schedule of` กับ script ที่ใช้งานอยู่เดิมข้างบน (= ถูกสร้างซ้ำ จะดึง/อัปโหลดซ้ำสองรอบ) หรือบรรทัดที่ขึ้นต้นด้วย `✘`

## ตรวจหลังอัปเดต (5 นาที)
1. เปิด Windmill (`http://localhost:8000`): ชื่อ `[Exporter] …` / `[Pipeline] …` เรียงตามกลุ่ม **จำนวน schedule เท่าเดิม + 4 ใหม่ (snapshot 0600/2300 และ retry) + 1 (pipeline 12:45)** ไม่มีชื่อซ้ำ
2. `exporter status` รันได้ ไม่ error: ตอนนี้จะขึ้น ✘ "ยังไม่ได้ดึง 2 (vat-output, vat-inspection)" ทุกวันตั้งแต่ 2026-10-20 เป็นปกติ ยังเป็นรายงานใหม่ที่รอเติม
3. คิวใน Windmill: FoodStory ขึ้นคำเตือน "waiting for an executor" ราว 7 นาที เป็นปกติ (worker chromium ตัวเดียว รอ HotelTime ก่อน)

## 3 วันหลังจากนั้น (ปกติ ไม่ต้องทำอะไร)
- รอบรายวันเติม `vat-output`, `vat-inspection`, `deposit-journal` ตั้งแต่ **2026-10-20** ถึงเมื่อวาน รอบละ 3 วัน (27 วัน ≈ 9 รอบ ≈ 3 วัน) ระหว่างนั้น Discord ขึ้น "ขาดอีก N วัน / action needed" — หายเมื่อเติมครบ
- ไฟล์ใหม่ถูกอัปโหลดเข้า uploader อัตโนมัติ (ชนิดเอกสารมีใน catalog แล้ว) — `vat-output` มีชื่อลูกค้า/เลขผู้เสียภาษี uploader ยังไม่จำกัดสิทธิ์การเห็น เจ้าของระบบรับทราบและยอมรับแล้ว (2026-11-16)

## pipeline → D1 (ทำงานอยู่แล้วบนเครื่องนี้)
pipeline (bundle `20261115-21e7b6b`) รันที่ **12:45 และ 19:00** แล้ว push `ht_gold_*` ขึ้น D1 production `chaweng-db` (พบเมื่อ 2026-11-16: รอบ 15 พ.ย. สำเร็จ push 13.6 วินาที) เมื่อไฟล์ `vat-output` เข้า `daily/` ครั้งแรก ตาราง Invoice จะมีแถวใน D1 เป็นครั้งแรก — ตารางมีอยู่แล้ว เป็นแค่ INSERT จำนวนน้อย (หลักร้อยแถว) แต่มีชื่อลูกค้า/เลขผู้เสียภาษี (PII) ซึ่งเว็บแอปอ่านได้ ตรวจหลังรอบแรกที่มี Invoice:
1. การ์ด Discord ของ pipeline + `pipeline-state/last-run.json`: `push_gold` ok และจำนวนแถวที่เขียน
2. `ht_gold_build.oracle_status` ไม่ใช่ fail
3. แถวใน `ht_gold_invoice` ≈ จำนวนเลขใบไม่ซ้ำของ `vat-output` ที่ดึงแล้ว

## ถ้ามีปัญหา
| อาการ | ทำ |
|---|---|
| ตัวติดตั้งขึ้น `✘` | อ่านข้อความบรรทัดนั้น แล้วรันคำสั่งเดิมซ้ำอีกครั้ง ยังไม่หายให้ส่งรูปหน้าจอ |
| Windmill มี script/schedule ซ้ำ | หยุด อย่ารันอะไรเพิ่ม แจ้งผู้พัฒนา (ปิด schedule ที่ซ้ำในหน้าเว็บไม่พอ ตัวติดตั้งเปิดคืนให้) |
| รอบ export ล้มหลังอัปเดต (Discord แดง) | ย้อนกลับ: `cd ~/chawengburi-exporter && git checkout <เลขเวอร์ชันที่จดไว้> && bash deploy/ubuntu/install.sh` แล้วแจ้งผู้พัฒนา ข้อมูลที่ดึงไว้ไม่หาย |
| รอบ pipeline แดง | ดูการ์ด Discord ของ pipeline แล้วแจ้งผู้พัฒนา D1 เดิมไม่ถูกเปลี่ยนเมื่อ push ล้ม (atomic) |

## ยังไม่รวมในการอัปเดตนี้
- **อัปเกรด bundle ของ pipeline** (ตัวบนเครื่องยังไม่มีการแก้ `@refresh` ใน `ingest.py`; ต้อง `--reset-silver` สร้าง Silver ใหม่จาก Bronze ไม่มีข้อมูลหาย) — ทำตามคู่มือของ repo hoteltime-schema แยกรอบ
- ดึงข้อมูลย้อนหลังก่อน 2026-10-20 ของรายงานใหม่ — เลื่อนไว้ก่อน
