# Worker group "custom" — ใบ 02 ของ windmill-trial-pms-export-daily
#
# ต่อจาก image ของ Windmill เอง (ไม่ใช่ image เปล่า) เพราะตัว binary ที่ทำให้ container นี้
# เป็น Windmill worker จริง (ลงทะเบียนกับ Postgres, ดึงงานจากคิว) อยู่ใน image นี้อยู่แล้ว —
# ถ้าเริ่มจาก node เปล่าจะไม่มีตัว worker เลย
#
# Node.js มาพร้อม image อยู่แล้ว (v24.20.0 ที่ตรวจแล้ว) ซึ่ง >= exporter/package.json ที่ต้องการ
# (engines.node >=22.18.0) จึงไม่ต้องติดตั้งซ้ำ/downgrade
#
# ดึงเวอร์ชัน base image จาก ${WM_IMAGE} เดียวกับ service อื่นทั้งหมดใน docker-compose.yml
# (ส่งผ่าน build.args) ไม่เขียนเลขเวอร์ชันซ้ำเป็นค่าคงที่ที่นี่ — กันไม่ให้ worker กลุ่มนี้
# ค้างอยู่เวอร์ชันเก่าเงียบ ๆ ถ้ามีคนอัป WM_IMAGE ใน .env แล้วลืมแก้ไฟล์นี้
ARG WM_IMAGE
FROM ${WM_IMAGE}

# ปักหมุด playwright ให้ตรงกับเวอร์ชันที่ exporter ใช้จริง (resolve จาก ^1.60.0 ใน
# exporter/package.json ได้ 1.63.0 ตอนเขียนไฟล์นี้) ไม่ใช่ latest — เพื่อให้ browser build
# ที่ดาวน์โหลด/cache ไว้ในอิมเมจตอนนี้ตรงกับที่ exporter ต้องการจริงตอนใบ 03 เรียกใช้ node_modules
# ของมันเอง ไม่ต้องดาวน์โหลดซ้ำ ถ้า exporter อัป playwright เวอร์ชัน ต้องแก้เลขนี้ให้ตรงกันด้วย
ARG PLAYWRIGHT_VERSION=1.63.0

# ติดตั้ง playwright แยกไว้ใน /opt/playwright-probe (ไม่ปนกับโค้ดของ exporter เอง ซึ่งจะถูก
# mount เข้ามาต่างหากในใบ 03) มีไว้แค่พิสูจน์ว่า Node + Playwright + Chromium ในอิมเมจนี้ใช้งานได้จริง
RUN mkdir -p /opt/playwright-probe \
    && cd /opt/playwright-probe \
    && npm init -y >/dev/null \
    && npm install --no-save "playwright@${PLAYWRIGHT_VERSION}" \
    && npx playwright install --with-deps chromium
