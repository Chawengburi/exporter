# pms-export → exporter: build the Site abstraction first, rename last

2026-09-22 · เจ้าของระบบต้องการรวม HotelTime กับ FoodStory (เว็บใหม่ทั้งหมด คนละ tech stack —
ASP.NET WebForms vs. jQuery DataTables ที่ export เป็น client-side blob) ไว้ใน **เครื่องมือเดียว**
ชื่อ `exporter` แทนที่จะแยกเป็นคนละโปรเจกต์ต่อเว็บ (`/grill-with-docs` 2026-09-22)

**สิ่งที่ตัดสินใจแล้ว:**

1. **โครงสร้างเป้าหมาย** — แพ็กเกจเดียว `exporter/` มีชั้น `sites/<site>/` แยกกลไกคุยกับหน้าเว็บ
   ต่อ site (login, wait-for-ready, trigger-export, verify) · `core/` เก็บเฉพาะของที่พิสูจน์แล้ว
   ว่าไม่ผูกกับ site ไหนเลย (date range/chunk logic, CSV writer, manifest, xlsx reader)
2. **`Report` ไม่มี type เดียวร่วมกันข้าม site** — field ของ HotelTime (`dailyOnly`,
   `skipDateCoverageCheck`) ไม่มีความหมายกับ FoodStory (toolbar variant, row-cap split,
   multi-tab) และกลับกัน บีบให้เป็น interface เดียวคือเดาความต้องการล่วงหน้าโดยไม่มีมูล
3. **rename `pms-export` → `exporter` เกิดขึ้นเป็นขั้นสุดท้าย** หลัง Site abstraction +
   FoodStory adapter เสร็จและทดสอบผ่านแล้วเท่านั้น — ไม่ทำพร้อมกับงานออกแบบที่ยังไม่นิ่ง
4. **`.env` ยังใช้ prefix `PMS_*` เดิมไปก่อน** ไม่เปลี่ยนเป็น `HOTELTIME_*` จนกว่าจะถึงขั้น rename
   เดียวกับข้อ 3 — FoodStory ใช้ `FOODSTORY_*` แยกไปเลยระหว่างนี้ ไม่ต้อง coordinate กับ HotelTime

**เหตุผล:** `pms-export` มี daily cron job รันจริงบน Windmill อยู่แล้ว (mount path ตรงชื่อ
`pms-export`, script ที่ deploy ไว้ก็ `cd /workspace/pms-export`, `.env` ที่ใช้จริงก็ prefix
`PMS_*`) — การ rename/restructure พร้อมกับงานออกแบบที่ยังไม่ proven จะเอาความเสี่ยงสองก้อน
(โค้ดใหม่ที่ยังไม่ทดสอบ + การย้าย production pointer) มาซ้อนกัน ทั้งที่แยกออกจากกันได้ฟรี — ทำ
ให้เสร็จก่อนค่อยย้าย ความเสี่ยงเหลือแค่ "ย้าย path/ชื่อของที่พิสูจน์แล้วว่าทำงานถูก" ซึ่งเป็น
งาน mechanical ล้วน ไม่ใช่งานออกแบบ

**ทางที่ไม่เลือก:** rename ทันทีแล้วสร้างต่อบนชื่อใหม่เลย — ปฏิเสธเพราะไม่มีประโยชน์เพิ่มที่
คุ้มกับความเสี่ยงต่อ daily job ที่รันจริงอยู่ทุกวัน

**ยังไม่ปิด:** รูปร่างที่แน่นอนของ `Site` interface (มีเมธอดอะไรบ้าง) ยังไม่ได้เขียนเป็นโค้ด
รอ `/to-spec` ถัดจากนี้ · scope ของ FoodStory ตัดสินใจแล้วว่าเอาทั้ง 55 รายงานตาม spec ต้นทาง
(`foodstory-export/`) แต่เอาเฉพาะ tab แรก (ทั้งหมด/total) ของรายงานที่มี tab ซ้อน, เขียนไฟล์
header-only เมื่อผลว่างเสมอ, และรายงาน master data (ไม่กรองวันที่) ดึงพร้อมรอบเดียวกับรายงานอื่น
ทุกเดือนไม่แยก schedule

**สถานะ 2026-09-28 — rename ทำแล้ว** (ticket 13 ของ `.scratch/exporter-multi-site/`) หลัง HotelTime
(ticket 01) และ FoodStory (ticket 12, 48/48 รายงาน) proven: `pms-export/` → `exporter/`, คำสั่ง CLI
และ skill เป็น `exporter`, `PMS_*` → `HOTELTIME_*` (ไม่มี fallback อ่าน prefix เก่า), Windmill mount
ชี้ `../exporter` · script Windmill `pms_export_daily` คง path เดิม แก้แค่บรรทัด `cd` · เนื้อหา ADR
ข้างบนคงไว้ตามที่เขียนตอนตัดสินใจ
