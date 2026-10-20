#!/bin/bash
set -euo pipefail
# job รันเป็น root ใน container ไฟล์ที่เขียนลง data/ จึงเป็นของ root บน host (Ubuntu จริง) คนที่รัน exporter จาก Terminal หรือไอคอน FoodStory เขียนทับไม่ได้
# จบงานทุกกรณี (รวมตอนล้ม) คืนเจ้าของให้เท่ากับของโฟลเดอร์ data เอง · บน Mac (Docker Desktop) ไม่มีผล จึง `|| true`
trap 'chown -R --reference=/workspace/exporter/data /workspace/exporter/data /workspace/exporter/recon/captures 2>/dev/null || true' EXIT
cd /workspace/exporter
node src/index.ts export --report all --daily --json
# ticket 07 ของ exporter-upload-to-uploader — คนละคำสั่ง คนละ exit path จากขั้น export ข้างบน (ตัดสินใจไว้ใน spec)
# `|| true`: export ล้มแล้ว set -e หยุดสคริปต์ก่อนถึงบรรทัดนี้อยู่แล้ว (ถูกต้อง — ยังเป็นปัญหาของ export) แต่ถ้า export
# ผ่านแล้วอัปโหลดมีไฟล์ค้าง/ปฏิเสธ (exit ไม่ใช่ 0) ต้องไม่ทำให้ Windmill เห็นว่าทั้ง job ล้ม — ไฟล์พวกนั้นไปอยู่ใน
# backlog (ticket 06 exporter status) ให้รอบถัดไปหรือคนสั่งมือมาจัดการ ไม่ใช่ปัญหาของรอบนี้
node src/index.ts upload --site hoteltime --json || true
