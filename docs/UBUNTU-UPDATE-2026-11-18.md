# อัปเดตเครื่อง Ubuntu — รอบดึงทุก 4 ชั่วโมง (HotelTime) · อัปเดตแบบ**ยังไม่เปิดใช้** แล้วค่อยเปิด

เครื่องนี้ = เครื่อง production เครื่องเดียว ถ้าอะไรไม่ตรงกับ "ควรเห็น" ให้**หยุด**แล้วส่งรูปหน้าจอให้ผู้พัฒนา (ห้ามส่งไฟล์ข้อมูล, `.env`, `.admin-password`, token)

## ในการอัปเดตนี้มีอะไร (ADR-0014)
HotelTime ดึงเป็น **6 รอบต่อวัน** (04:00 08:00 12:00 16:00 20:00 23:00) แทนรอบเที่ยง/15:00/18:00 และ snapshot เสริม 06:00/23:00 · login ครั้งเดียวต่อรอบ · ส่งเข้า uploader วันละครั้งที่รอบ 12:00 (per-day ของเมื่อวาน + snapshot ฉบับ 23:00) · pipeline รันตามหลังแต่ละรอบ 20 นาที
**แผนเปิดใช้:** 5 รอบก่อน (08 12 16 20 23) เฝ้าดูสัปดาห์แรก แล้วค่อยเพิ่ม 04:00

## ขั้นที่ 1 — อัปเดตโดย**ไม่เปิดรอบใหม่** (ทำก่อน pull)
1. เปิดไฟล์ `exporter/.env` เติมบรรทัด `HOTELTIME_ROUNDS=off` (ถ้าไม่ตั้ง ค่าเริ่มคือเปิด 5 รอบทันที)
2. จดเลขเวอร์ชันเดิม: `cd ~/chawengburi-exporter && git rev-parse --short HEAD`
3. เลือกเวลาที่ไม่ใกล้รอบทำงาน (เช่น 13:00–14:45) แล้วรัน:
```bash
cd ~/chawengburi-exporter && git pull && bash deploy/ubuntu/install.sh
```
**ผลของ `setup.mjs` ที่ควรเห็น:** `Created the script … pms_export_round` และ `Set the schedule of …` ใหม่หลายรายการ (รอบ 6 ตัว + retry + pipeline รอบละ 1) · บรรทัดสรุปปิดท้ายต้องเขียนว่า **`HotelTime runs the OLD schedule … because HOTELTIME_ROUNDS=off`** · schedule เดิม (เที่ยง, 15:00/18:00, snapshot, pipeline 19:00/12:45) ต้อง**ยังเปิด** และไม่มี `Switched off` ของตัวเดิม
**หยุดทันทีถ้า:** เห็น `Switched off the schedule of … pms_export_daily` หรือบรรทัดสรุปบอกว่า "runs in ROUNDS" ทั้งที่ตั้ง `off` แล้ว (แปลว่าอ่าน `.env` ไม่ถูก)
รันซ้ำอีกรอบต้องได้ `Nothing changed — everything is already set up`

## ขั้นที่ 2 — เปิด 5 รอบ (เมื่อพร้อมเฝ้า)
1. แก้ `exporter/.env`: `HOTELTIME_ROUNDS=08,12,16,20,23`
2. `node windmill/setup.mjs` → ต้องเห็น `Switched off the schedule of …` ของ schedule เดิมของ HotelTime (เที่ยง, 15:00/18:00, snapshot 06/23, pipeline 19:00/12:45/…) และบรรทัดสรุป **`HotelTime runs in ROUNDS`** · FoodStory ไม่เปลี่ยน
3. อย่าทำช่วงที่รอบกำลังรัน (นาที :00–:20 ของ 08/12/16/20/23)

## เฝ้าสัปดาห์แรก
- เวลาต่อรอบ (ใน Windmill → Runs) ต้องไม่ใกล้ 15 นาที · `exporter status` ไม่ขึ้น ✘ ใหม่ · Discord: รอบที่ล้มทั้งชุดเตือนครั้งเดียวต่อรอบต่อวัน
- ก่อนเพิ่ม 04:00: ดูผลจริงว่า night audit ของ HotelTime ไม่ทำให้รอบ 04:00 ช้า/ล้ม แล้วค่อยใส่ `04` ใน `HOTELTIME_ROUNDS` (ต้องมี index ขั้น 007 ของ hoteltime-schema ก่อนเปิดครบ 6 รอบ)

## ย้อนกลับ
แก้ `exporter/.env` เป็น `HOTELTIME_ROUNDS=off` แล้วรัน `node windmill/setup.mjs` → schedule เดิมกลับมาเปิด รอบใหม่ออกทันทีโดยไม่ login (ไฟล์ที่ดึงแล้วไม่หาย)
