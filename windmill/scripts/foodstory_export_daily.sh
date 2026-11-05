#!/bin/bash
set -euo pipefail
# FoodStory รอบรายวัน/รอบเก็บตกบน Windmill (exporter-foodstory-scheduled-daily ใบ 04) — แบบเดียวกับ pms_export_daily.sh ของ HotelTime
# ต้องมี TWOCAPTCHA_API_KEY ใน exporter/.env (ADR-0010) — ไม่มี = login ล้มทันที (ใบ 03) แล้วบันทึก + แจ้ง Discord ว่า login ล้ม (ใบ 02)
# job รันเป็น root ใน container ไฟล์ที่เขียนลง data/ จึงเป็นของ root บน host (Ubuntu จริง) คนที่รัน exporter จาก Terminal หรือไอคอน FoodStory เขียนทับไม่ได้
# จบงานทุกกรณี (รวมตอนล้ม) คืนเจ้าของให้เท่ากับของโฟลเดอร์ data เอง · บน Mac (Docker Desktop) ไม่มีผล จึง `|| true`
trap 'chown -R --reference=/workspace/exporter/data /workspace/exporter/data /workspace/exporter/recon/captures 2>/dev/null || true' EXIT
cd /workspace/exporter
# worker ไม่มีหน้าจอ — บังคับ headless ทับค่าใน .env (FOODSTORY_HEADLESS=false ไว้ดูตอน debug จะทำให้ Chromium เปิดไม่ขึ้นใน container) · env ของ shell ชนะ .env
# 🔴 export ล้มบางรายงาน (exit 1) ต้องไม่ข้ามการอัปโหลดไฟล์ที่ export สำเร็จแล้ว (พังจริง 2026-11-02: reservation-report ล้ม ->
# set -e หยุดก่อนถึง upload -> ไม่มีอะไรขึ้น uploader เลยหลายวัน) · เก็บ exit code ไว้แล้วจบ job ด้วยค่านั้น Windmill จะยังเห็นว่ารอบนี้มีปัญหา
export_rc=0
FOODSTORY_HEADLESS=true node src/index.ts export --site foodstory --report all --daily --json || export_rc=$?
# `|| true`: อัปโหลดมีไฟล์ค้าง/ปฏิเสธ
# ต้องไม่ทำให้ Windmill เห็นว่าทั้ง job ล้ม — แจ้งผ่าน Discord ขา upload + backlog ของ `exporter status` ให้รอบถัดไปจัดการ (เหมือน HotelTime)
node src/index.ts upload --site foodstory --json || true
exit "$export_rc"
