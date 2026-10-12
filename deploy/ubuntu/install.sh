#!/bin/bash
# ติดตั้ง exporter บน Ubuntu Desktop ด้วยคำสั่งเดียว (ticket 04 ของ exporter-ubuntu-deploy)
#
#   cd <โฟลเดอร์ที่ clone Chawengburi/exporter มา>
#   bash deploy/ubuntu/install.sh                      ← รันในบัญชีของคนที่จะใช้เครื่อง ห้ามใส่ sudo (สคริปต์ขอ sudo เองตอนจำเป็น)
#
#   --skip-windmill    ไม่เปิด Windmill (Docker)
#   --no-login-check   ไม่ลองล็อกอิน HotelTime ตอนจบ
#
# รันซ้ำได้: .env ที่มีอยู่แล้วไม่ถูกแตะ (แก้เองด้วย nano) · ไม่ลบ node_modules ที่ติดตั้งครบแล้ว (Windmill mount โฟลเดอร์นี้อยู่ —
# ลบระหว่างรอบเที่ยงจะทำให้รอบนั้นพัง) · ไม่เรียก apt ซ้ำถ้า Chromium เปิดได้แล้ว · ไม่ติดตั้ง Node.js/Docker ให้ — ผู้ดูแลระบบ
# ติดตั้งเอง (ตกลง 2026-10-12) สคริปต์แค่เช็คและบอกวิธี · ข้อความเป็นภาษาไทยทั้งหมด เพราะเครื่องปลายทางไม่มี AI ช่วยอ่าน error
set -euo pipefail

SKIP_WINDMILL=0
LOGIN_CHECK=1
for arg in "$@"; do
  case "$arg" in
    --skip-windmill) SKIP_WINDMILL=1 ;;
    --no-login-check) LOGIN_CHECK=0 ;;
    *) echo "✘ ไม่รู้จักตัวเลือก: $arg" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXPORTER="$ROOT/exporter"
WINDMILL="$ROOT/windmill"
STEP=0
PENDING=() # สิ่งที่ผู้ดูแลยังต้องทำเอง — สรุปซ้ำตอนจบ ไม่ปล่อยให้จมอยู่กลางข้อความ
# ไฟล์ชั่วคราวระหว่างเขียน .env มีรหัสผ่าน และ .gitignore ไม่ครอบชื่อ .env.XXXXXX — หยุดกลางทางต้องลบทิ้งเสมอ
TMP_ENV=""
trap '[ -z "$TMP_ENV" ] || rm -f "$TMP_ENV"' EXIT

step() { STEP=$((STEP + 1)); echo; echo "── $STEP. $1"; }
ok() { echo "   ✔ $1"; }
warn() { echo "   ⚠ $1"; }
stop() {
  echo "   ✘ $1" >&2
  [ -n "${2:-}" ] && echo "     $2" >&2
  echo "     แก้แล้วรันคำสั่งเดิมซ้ำได้เลย — ขั้นที่ทำไปแล้วจะไม่ทำซ้ำ" >&2
  exit 1
}

echo "════════════════════════════════════════════════════════"
echo "  ติดตั้ง exporter (HotelTime + FoodStory) บน Ubuntu"
echo "════════════════════════════════════════════════════════"

# sudo ตั้ง HOME เป็น /root — ไอคอน/เบราว์เซอร์/ไฟล์จะไปอยู่ในบัญชี root แทนบัญชีที่ใช้งานจริง
[ "$(id -u)" -ne 0 ] || stop "อย่ารันด้วย sudo/root" "รัน: bash deploy/ubuntu/install.sh ในบัญชีของคนที่จะใช้เครื่อง (สคริปต์ขอรหัส sudo เองตอนจำเป็น)"
[ -f "$EXPORTER/package.json" ] && [ -f "$WINDMILL/docker-compose.yml" ] \
  || stop "ไม่พบโฟลเดอร์ exporter/ หรือ windmill/ ข้าง ๆ deploy/" "รันจากโฟลเดอร์ที่ clone Chawengburi/exporter มาทั้งก้อน"
[ "$(uname -s)" = Linux ] || stop "สคริปต์นี้สำหรับ Ubuntu เท่านั้น" "macOS ดู exporter/README.md"
grep -qi ubuntu /etc/os-release 2>/dev/null || warn "ไม่ใช่ Ubuntu — ลองต่อ แต่ทดสอบมากับ Ubuntu 24.04 เท่านั้น"

# ── 1. Node.js ──
step "เช็ค Node.js (ต้อง 22.18 ขึ้นไป)"
command -v node >/dev/null 2>&1 \
  || stop "ไม่พบ Node.js" "ติดตั้ง Node.js 22 ก่อน (เช่น NodeSource หรือ nvm — apt ของ Ubuntu เองเก่าเกินไป) แล้วเปิด Terminal ใหม่"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || stop "Node.js รุ่น $(node --version) เก่าเกินไป ต้อง 22.18 ขึ้นไป" "อัปเดต Node.js แล้วรันใหม่"
ok "Node.js $(node --version) ($(command -v node))"

# ── 2. package ──
step "ติดตั้ง package ของ exporter"
# npm ci ลบ node_modules ทิ้งก่อนทุกครั้ง — ติดตั้งครบแล้ว (lockfile ภายในใหม่กว่า package-lock.json) ไม่ต้องทำซ้ำ
if [ -f "$EXPORTER/node_modules/.package-lock.json" ] && [ "$EXPORTER/node_modules/.package-lock.json" -nt "$EXPORTER/package-lock.json" ]; then
  ok "มีอยู่แล้ว ไม่ติดตั้งซ้ำ"
else
  (cd "$EXPORTER" && npm ci --no-audit --no-fund --loglevel=error) || stop "ติดตั้ง package ไม่สำเร็จ" "เช็คอินเทอร์เน็ต แล้วรันใหม่"
  ok "node_modules พร้อม"
fi

# ── 3. เบราว์เซอร์ ──
step "ติดตั้งเบราว์เซอร์ Chromium"
(cd "$EXPORTER" && npx --no-install playwright install chromium) || stop "ดาวน์โหลด Chromium ไม่สำเร็จ" "เช็คอินเทอร์เน็ต แล้วรันใหม่"
chromium_starts() { (cd "$EXPORTER" && node --input-type=module -e "import { chromium } from 'playwright'; await (await chromium.launch()).close();") >/dev/null 2>&1; }
if chromium_starts; then
  ok "Chromium พร้อม"
else
  # library ของระบบยังไม่ครบ — ต้องใช้ apt (sudo) ครั้งเดียวต่อเครื่อง
  sudo -n true 2>/dev/null || sudo -v 2>/dev/null \
    || stop "บัญชีนี้ใช้ sudo ไม่ได้ แต่ Chromium ยังขาด library ของระบบ" \
      "ให้ผู้ดูแลระบบรันครั้งเดียว: cd $EXPORTER && sudo npx --no-install playwright install-deps chromium แล้วรันคำสั่งนี้ใหม่"
  echo "   ติดตั้ง library ของระบบให้ Chromium (ครั้งเดียวต่อเครื่อง — ใช้ sudo)"
  (cd "$EXPORTER" && sudo npx --no-install playwright install-deps chromium) || stop "ติดตั้ง library ของ Chromium ไม่สำเร็จ" "เช็คอินเทอร์เน็ต แล้วรันใหม่"
  chromium_starts || stop "ติดตั้งแล้วแต่ Chromium ยังเปิดไม่ได้" "ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ"
  ok "Chromium พร้อม"
fi

# ── ตัวช่วยเขียนไฟล์ลับ: เขียนลงไฟล์ชั่วคราว 600 ก่อน แล้วค่อยย้ายเข้าที่ (ไม่มีจังหวะที่ไฟล์จริงเปิดให้คนอื่นอ่าน/เขียนค้างครึ่ง) ──
write_secret_file() { # write_secret_file <ปลายทาง> — อ่านเนื้อหาจาก stdin
  TMP_ENV="$(mktemp "$1.XXXXXX")"
  chmod 600 "$TMP_ENV"
  cat >"$TMP_ENV"
  mv "$TMP_ENV" "$1"
  TMP_ENV=""
}
keep_private() { # .env ที่มีอยู่แล้ว (อาจสร้างโดยบัญชีอื่น) — บังคับ 600 ถ้าทำได้
  chmod 600 "$1" 2>/dev/null || warn "ตั้งสิทธิ์ $1 ให้อ่านได้เฉพาะเจ้าของไม่ได้ (ไฟล์เป็นของบัญชีอื่น?) — ให้ผู้ดูแลรัน: sudo chown $USER $1"
}

# ── 4. exporter/.env ──
step "ตั้งค่ารหัสผ่าน (exporter/.env)"
# ค่าใส่ quote ให้ dotenv อ่านตรงตัว: '...' ไม่แปลงอะไรเลย · มี ' ในค่า → "..." (ถ้าไม่มี " และ \) · ไม่งั้นให้แก้ไฟล์เอง
quote_env() {
  case "$1" in
    *$'\n'*) return 1 ;;
    *"'"*) case "$1" in *'"'* | *'\'*) return 1 ;; esac; printf '"%s"' "$1" ;;
    *) printf "'%s'" "$1" ;;
  esac
}
ask() { # ask <ตัวแปร> <ข้อความ> [secret|ค่าเริ่มต้น] — IFS= กันไม่ให้ตัดช่องว่างหัวท้ายของรหัสผ่าน
  local value="" mode="${3:-}"
  if [ "$mode" = secret ]; then
    IFS= read -r -s -p "   $2: " value || true; echo
  elif [ -n "$mode" ]; then
    IFS= read -r -p "   $2 [Enter = $mode]: " value || true
    [ -n "$value" ] || value="$mode"
  else
    IFS= read -r -p "   $2: " value || true
  fi
  [ -n "$value" ] || stop "ไม่ได้ใส่ $2"
  quote_env "$value" >/dev/null || stop "$2 มีอักขระที่ใส่อัตโนมัติไม่ได้ (มีทั้ง ' และ \" หรือ \\)" "แก้เองด้วย: nano exporter/.env (สร้างจาก .env.example)"
  printf -v "$1" '%s' "$value"
}
if [ -e "$EXPORTER/.env" ]; then
  ok "มีอยู่แล้ว ไม่แตะ — แก้เองได้ด้วย: nano exporter/.env"
else
  DEFAULT_BRANCH="$(sed -n 's/^FOODSTORY_BRANCH_NAME=//p' "$EXPORTER/.env.example" | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
  echo "   กรอกทีละช่อง (รหัสผ่านจะไม่แสดงบนจอระหว่างพิมพ์):"
  ask HT_USER "HotelTime ชื่อผู้ใช้"
  ask HT_PASS "HotelTime รหัสผ่าน" secret
  ask FS_EMAIL "FoodStory อีเมล"
  ask FS_PASS "FoodStory รหัสผ่าน" secret
  ask FS_BRANCH "FoodStory ชื่อสาขา (ตามที่ขึ้นในหน้าเว็บ)" "$DEFAULT_BRANCH"
  # ส่งค่าเข้า awk ทาง environment ไม่ใช่ argument (argument ของ process เห็นได้จาก ps ของบัญชีอื่น)
  HOTELTIME_USERNAME="$(quote_env "$HT_USER")" HOTELTIME_PASSWORD="$(quote_env "$HT_PASS")" \
    FOODSTORY_EMAIL="$(quote_env "$FS_EMAIL")" FOODSTORY_PASSWORD="$(quote_env "$FS_PASS")" \
    FOODSTORY_BRANCH_NAME="$(quote_env "$FS_BRANCH")" \
    awk -F= '
      BEGIN { split("HOTELTIME_USERNAME HOTELTIME_PASSWORD FOODSTORY_EMAIL FOODSTORY_PASSWORD FOODSTORY_BRANCH_NAME", keys, " ")
              for (i in keys) want[keys[i]] = 1 }
      /^[A-Z_]+=/ && ($1 in want) { print $1 "=" ENVIRON[$1]; seen[$1] = 1; next }
      { print }
      END { for (k in want) if (!(k in seen)) { print "ไม่พบ " k " ใน .env.example" > "/dev/stderr"; exit 1 } }
    ' "$EXPORTER/.env.example" | write_secret_file "$EXPORTER/.env" \
    || stop "เขียน exporter/.env ไม่สำเร็จ" "เช็คว่า exporter/.env.example อ่านได้และมีครบทุกช่อง"
  ok "เขียน exporter/.env แล้ว (อ่านได้เฉพาะบัญชีนี้)"
fi
keep_private "$EXPORTER/.env"

# ── 5. windmill/.env ──
step "ตั้งค่า Windmill (windmill/.env)"
WINDMILL_FRESH=0
if [ -e "$WINDMILL/.env" ]; then
  ok "มีอยู่แล้ว ไม่แตะ"
else
  PG_PASS="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" # รหัส Postgres สุ่มใหม่ (hex) — ไม่ใช้ changeme ของตัวอย่าง
  sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG_PASS|" \
    -e "s|^DATABASE_URL=postgres://postgres:[^@]*@|DATABASE_URL=postgres://postgres:$PG_PASS@|" \
    "$WINDMILL/.env.example" | write_secret_file "$WINDMILL/.env" || stop "เขียน windmill/.env ไม่สำเร็จ"
  grep -q "^POSTGRES_PASSWORD=$PG_PASS$" "$WINDMILL/.env" && grep -q "^DATABASE_URL=postgres://postgres:$PG_PASS@" "$WINDMILL/.env" \
    || { rm -f "$WINDMILL/.env"; stop "รูปแบบ windmill/.env.example ไม่ตรงที่สคริปต์รู้จัก" "ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ"; }
  WINDMILL_FRESH=1
  ok "เขียน windmill/.env แล้ว (รหัสฐานข้อมูลสุ่มใหม่)"
fi
keep_private "$WINDMILL/.env"

# ── 6. โฟลเดอร์ข้อมูล + ไอคอน ──
step "เตรียมโฟลเดอร์เก็บไฟล์ และวางไอคอน FoodStory บน Desktop"
mkdir -p "$EXPORTER/data"
ok "ไฟล์ที่ดึงมาจะอยู่ที่ exporter/data/"
bash "$EXPORTER/launchers/install-desktop-launcher.sh" | sed 's/^/   /' || stop "วางไอคอนไม่สำเร็จ (ดูข้อความด้านบน)"

# ── 7. Windmill ──
step "เปิด Windmill (ตัวตั้งเวลาให้ HotelTime รันทุกวัน)"
WINDMILL_UP=0
if [ "$SKIP_WINDMILL" = 1 ]; then
  warn "ข้ามตามที่สั่ง (--skip-windmill)"
  PENDING+=("เปิด Windmill: รันคำสั่งนี้ซ้ำโดยไม่ใส่ --skip-windmill")
elif ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  warn "ยังไม่มี Docker (พร้อม docker compose)"
  PENDING+=("ติดตั้ง Docker Engine + docker compose ตามคู่มือ Docker สำหรับ Ubuntu แล้วรันคำสั่งนี้ซ้ำ")
elif DOCKER_ERR="$(docker info 2>&1 >/dev/null)"; then
  (cd "$WINDMILL" && docker compose up -d) || stop "เปิด Windmill ไม่สำเร็จ" "ดูสาเหตุ: cd windmill && docker compose logs"
  WINDMILL_UP=1
  ok "Windmill เปิดแล้วที่ http://localhost:8000"
elif printf '%s' "$DOCKER_ERR" | grep -qi "permission denied"; then
  warn "บัญชีนี้ยังไม่มีสิทธิ์ใช้ Docker"
  PENDING+=("ให้สิทธิ์ Docker: sudo usermod -aG docker $USER แล้ว logout/login ใหม่ แล้วรันคำสั่งนี้ซ้ำ")
else
  warn "Docker ไม่ได้ทำงานอยู่"
  PENDING+=("เปิด Docker: sudo systemctl enable --now docker แล้วรันคำสั่งนี้ซ้ำ")
fi
if [ "$WINDMILL_UP" = 1 ] && [ "$WINDMILL_FRESH" = 1 ]; then
  PENDING+=("ตั้งค่า Windmill ครั้งแรกที่ http://localhost:8000 ตาม windmill/INSTALL.md ข้อ 3–6: เปลี่ยนรหัส admin (ค่าเริ่มต้นของ Windmill), ผูก tag chromium ให้ worker \"custom\", สร้างสคริปต์ pms_export_daily และตั้ง schedule 12:00 / 15:00 / 18:00")
fi

# ── 8. ลองล็อกอิน HotelTime ──
step "ลองล็อกอิน HotelTime (ไม่ต้องกดอะไร)"
if [ "$LOGIN_CHECK" = 0 ]; then
  warn "ข้ามตามที่สั่ง (--no-login-check)"
  PENDING+=("ลองล็อกอิน HotelTime: cd exporter && node src/index.ts login --site hoteltime --check")
elif (cd "$EXPORTER" && node src/index.ts login --site hoteltime --check); then
  ok "ล็อกอิน HotelTime ได้"
else
  stop "ล็อกอิน HotelTime ไม่ได้" "เช็คชื่อผู้ใช้/รหัสผ่านใน exporter/.env (nano exporter/.env) แล้วรันใหม่"
fi

echo
echo "════════════════════════════════════════════════════════"
if [ "${#PENDING[@]}" -eq 0 ]; then
  echo "✅ ติดตั้งเสร็จ"
else
  echo "⚠️  ติดตั้งส่วนของโปรแกรมแล้ว — ยังต้องทำอีก ${#PENDING[@]} อย่าง:"
  i=0
  for item in "${PENDING[@]}"; do i=$((i + 1)); echo "   $i. $item"; done
fi
echo
echo "   • FoodStory: ดับเบิลคลิกไอคอน \"ดึง FoodStory เมื่อวาน\" บน Desktop (ครั้งแรกอาจต้องคลิกขวา → Allow Launching)"
echo "   • คู่มือพนักงาน: docs/FOODSTORY-DAILY-STAFF-GUIDE.md"
echo "════════════════════════════════════════════════════════"
