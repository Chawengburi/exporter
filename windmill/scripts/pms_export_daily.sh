#!/bin/bash
set -euo pipefail
cd /workspace/exporter
node src/index.ts export --report all --daily --json
# ticket 07 ของ exporter-upload-to-uploader — คนละคำสั่ง คนละ exit path จากขั้น export ข้างบน (ตัดสินใจไว้ใน spec)
# `|| true`: export ล้มแล้ว set -e หยุดสคริปต์ก่อนถึงบรรทัดนี้อยู่แล้ว (ถูกต้อง — ยังเป็นปัญหาของ export) แต่ถ้า export
# ผ่านแล้วอัปโหลดมีไฟล์ค้าง/ปฏิเสธ (exit ไม่ใช่ 0) ต้องไม่ทำให้ Windmill เห็นว่าทั้ง job ล้ม — ไฟล์พวกนั้นไปอยู่ใน
# backlog (ticket 06 exporter status) ให้รอบถัดไปหรือคนสั่งมือมาจัดการ ไม่ใช่ปัญหาของรอบนี้
node src/index.ts upload --site hoteltime --json || true
