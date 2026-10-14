#!/bin/bash
# ดับเบิลคลิกจาก Desktop (macOS: Finder · Ubuntu: ไอคอน .desktop) → ดึงรายงาน FoodStory ของ "เมื่อวาน" ทั้งหมด (ticket 11, ADR-0006)
# พร้อมเติมวันที่ยังไม่ได้กดและถ่ายรายงานภาพของวันนี้ใน login เดียว (ใบ 06 ของ exporter-daily-per-day-raw, ADR-0008/0009)
#
# พนักงานกด reCAPTCHA ครั้งเดียว ที่เหลือรันเองจนจบ แล้วสรุปเป็นภาษาไทย · วางบน Desktop เป็น alias/symlink ได้ — สคริปต์ตาม
# symlink กลับมาหาโฟลเดอร์ exporter เอง ไม่ผูกกับ path ของเครื่องไหน · คู่มือ: docs/FOODSTORY-DAILY-STAFF-GUIDE.md
#
# ไม่พึ่ง PATH ของ Terminal: เปิดจาก Finder แล้ว PATH อาจไม่มี node (เช่น ติดตั้งผ่าน nvm) — หา node >= 22.18 เองตามลำดับ
# · สรุปตอนจบอ่านจาก `_run.json` ทุกโฟลเดอร์ที่รอบนี้เขียน (เฉพาะรายงานที่รอบนี้รัน) ไม่แกะข้อความที่ exporter พิมพ์ — รันซ้ำแล้ว
#   โฟลเดอร์ครบก็ขึ้นว่าครบ แม้รอบนี้จะล้มบางใบ (ไฟล์ที่ผ่านของรอบก่อนยังอยู่) · ไม่มีงานค้าง = exporter จบ 0 โดยไม่ login ไม่เขียน `_run.json`
set -u

pause_and_exit() {
  echo
  printf '%s' "กดปุ่มใดก็ได้เพื่อปิดหน้าต่างนี้ ..." # ไม่ใช้ read -p — bash แสดง prompt เฉพาะเมื่อ stdin เป็น terminal
  read -r -n 1 -s || true
  echo
  exit "$1"
}

stop_with() {
  echo
  echo "❌ $1"
  [ -n "${2:-}" ] && echo "   $2"
  echo "   ถ่ายรูปหน้าจอนี้ส่งให้ผู้ดูแลระบบ"
  pause_and_exit 1
}

# ── หาโฟลเดอร์ exporter: ตาม symlink (เช่น ไฟล์บน Desktop) กลับไปหาตัวจริงใน <exporter>/launchers/ ──
SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do
  TARGET="$(readlink "$SELF")"
  case "$TARGET" in
    /*) SELF="$TARGET" ;;
    *) SELF="$(dirname "$SELF")/$TARGET" ;;
  esac
done
EXPORTER_DIR="$(cd "$(dirname "$SELF")/.." && pwd)"
STORE="$EXPORTER_DIR/data/foodstory"

# ── หา node >= 22.18 (exporter รัน .ts ตรง ๆ ต้องใช้ type stripping ของ node รุ่นนี้ขึ้นไป) ──
node_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' >/dev/null 2>&1
}
nvm_default_node() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] || return 0
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 && nvm which default 2>/dev/null
}
NODE=""
# macOS: Homebrew (/opt/homebrew, /usr/local) · Ubuntu: apt/NodeSource (/usr/bin) · ทั้งคู่: nvm default ข้างล่าง
for candidate in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && node_ok "$candidate"; then NODE="$candidate"; break; fi
done
if [ -z "$NODE" ]; then
  candidate="$(nvm_default_node)" # โหลด nvm เฉพาะเมื่อหาแบบอื่นไม่เจอ — ช้า
  if [ -n "$candidate" ] && [ -x "$candidate" ] && node_ok "$candidate"; then NODE="$candidate"; fi
fi

echo "════════════════════════════════════════════════════════"
echo "  ดึงรายงาน FoodStory (เมื่อวาน + วันที่ยังขาด + รายงานภาพ)"
echo "════════════════════════════════════════════════════════"

[ -n "$NODE" ] || stop_with "ไม่พบโปรแกรม Node.js (ต้องเป็นรุ่น 22.18 ขึ้นไป) บนเครื่องนี้" \
  "ผู้ดูแลระบบ: ติดตั้ง Node.js แล้วลองใหม่ (ดูคู่มือ ส่วนติดตั้งครั้งแรก)"
[ -e "$EXPORTER_DIR/.env" ] || stop_with "ไม่พบไฟล์ตั้งค่า .env ในโฟลเดอร์ $EXPORTER_DIR" \
  "ผู้ดูแลระบบ: สร้างจาก .env.example แล้วใส่อีเมล/รหัสผ่าน FoodStory"
[ -d "$EXPORTER_DIR/node_modules" ] || stop_with "โปรแกรมยังติดตั้งไม่ครบ (ไม่มีโฟลเดอร์ node_modules)" \
  "ผู้ดูแลระบบ: รัน npm install ในโฟลเดอร์ $EXPORTER_DIR"
mkdir -p "$STORE" || stop_with "สร้างโฟลเดอร์เก็บไฟล์ $STORE ไม่ได้"

# ── ล็อกต่อโฟลเดอร์ exporter: ดับเบิลคลิกซ้ำระหว่างรอบก่อนยังรัน = เบราว์เซอร์สองหน้าต่าง กด captcha สองครั้ง แย่งเขียนโฟลเดอร์เดียวกัน ──
# ล็อกเก็บ pid — ถ้า process นั้นตายไปแล้ว (เช่น ปิดหน้าต่างกลางคัน) ถือว่าล็อกค้าง ยึดต่อได้
LOCK="$STORE/.daily-launcher.pid"
take_lock() { ( set -o noclobber; echo "$$" >"$LOCK" ) 2>/dev/null; }
# ลบเฉพาะล็อกของรอบนี้ — หน้าต่างเก่าที่เพิ่งถูกปิดต้องไม่ลบล็อกของรอบใหม่ที่ยึดไปแล้ว
release_lock() { [ "$(cat "$LOCK" 2>/dev/null)" = "$$" ] && rm -f "$LOCK"; return 0; }
if ! take_lock; then
  OTHER="$(cat "$LOCK" 2>/dev/null)"
  if [ -n "$OTHER" ] && kill -0 "$OTHER" 2>/dev/null; then
    echo
    echo "⏳ มีการดึงรายงาน FoodStory รันอยู่แล้วในอีกหน้าต่างหนึ่ง — รอให้หน้าต่างนั้นจบก่อน แล้วค่อยเปิดใหม่ถ้าจำเป็น"
    pause_and_exit 1
  fi
  rm -f "$LOCK"
  take_lock || stop_with "ล็อกการรันไม่ได้ ($LOCK)"
fi
# เวลาเริ่ม — ใช้หา `_run.json` ที่รอบนี้เขียน · template ต้องมี XXXXXX เอง: GNU mktemp (Ubuntu) ปฏิเสธ `-t ชื่อ` แบบ macOS
MARK="$(mktemp "${TMPDIR:-/tmp}/foodstory-daily.XXXXXX")" || stop_with "สร้างไฟล์ชั่วคราวไม่ได้"
trap 'release_lock; rm -f "$MARK"' EXIT

echo
echo "  1. จะมีหน้าต่างเบราว์เซอร์เปิดขึ้นมา (อีเมลกับรหัสผ่านกรอกไว้ให้แล้ว)"
echo "  2. ติ๊กช่อง \"ฉันไม่ใช่โปรแกรมอัตโนมัติ\" ทำตามที่ขึ้นมาจนผ่าน แล้วกดปุ่มเข้าสู่ระบบ — ภายใน 5 นาที"
echo "  3. จากนั้นปล่อยไว้ ไม่ต้องกดอะไรในเบราว์เซอร์ จนหน้าต่างนี้ขึ้นสรุป (ราว 5-10 นาทีต่อวันที่ต้องดึง)"
echo "     ถ้ารายงานได้ครบแล้ว จะไม่มีหน้าต่างเบราว์เซอร์ และไม่ต้องกดอะไร"
echo

cd "$EXPORTER_DIR" || stop_with "เข้าโฟลเดอร์ $EXPORTER_DIR ไม่ได้"
"$NODE" src/index.ts export --site foodstory --report all --daily --headful
EXPORT_RC=$?
# ปลดล็อกทันทีที่ดึงเสร็จ — หน้าต่างที่ค้างรอ "กดปุ่มใดก็ได้" ข้ามวันต้องไม่ทำให้รอบพรุ่งนี้ขึ้นว่า "รันอยู่แล้ว" (ลองจริง 2026-10-12)
release_lock

# ── สรุปจากสถานะล่าสุดรายใบใน `_run.json` ทุกโฟลเดอร์ที่รอบนี้เขียน (เติมหลายวัน + ภาพของวันนี้ — ใบ 06) · นับเฉพาะรายงานที่รอบนี้รัน
#    (รายการรอบสุดท้ายของโฟลเดอร์ ไม่มีรายการรอบ = ทุกใบ) · ผ่าน = ok หรือรอบนี้ล้มแต่ไฟล์ที่ผ่านของรอบก่อนยังอยู่ (previousOk) ──
SUMMARY="$(find "$STORE/daily" -name _run.json -newer "$MARK" 2>/dev/null | sort | xargs "$NODE" -e '
  const fs = require("fs");
  // วันตามเวลาไทยของเวลาเริ่มรอบ — รายงานตามวันไม่เคยถูกดึงในวันของข้อมูลเอง โฟลเดอร์ที่วันตรงกับวันเริ่มรอบจึงเป็นโฟลเดอร์รายงานภาพ
  const thaiDay = (iso) => { const d = new Date(iso); return isNaN(d) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d); };
  let passed = 0, total = 0, pictures = 0, closes = 0; const days = []; let warnings = [];
  for (const f of process.argv.slice(1)) {
    const r = JSON.parse(fs.readFileSync(f, "utf8"));
    const last = (r.runs ?? []).at(-1);
    const ids = last ? last.reports : Object.keys(r.reports ?? {});
    const pictureFolder = last !== undefined && thaiDay(last.startedAt) === r.dataThrough;
    let perDay = false;
    for (const id of ids) {
      const x = (r.reports ?? {})[id];
      if (!x) continue;
      total++;
      if (!(x.status === "ok" || x.previousOk)) continue;
      passed++; // วัน/ภาพที่บอกบนจอ = เฉพาะที่ได้จริง (วันที่ล้มทั้งวันไม่ขึ้นว่า "ได้ข้อมูล")
      if (id.endsWith("@period-close")) closes++;
      else if (pictureFolder) pictures++;
      else perDay = true;
    }
    if (perDay) days.push(r.dataThrough);
    if (last && last.warnings) warnings = last.warnings;
  }
  console.log(passed, total);
  console.log(days.join(", "));
  console.log(pictures, closes);
  for (const w of warnings) console.log(w);
' 2>/dev/null)"
read -r PASSED TOTAL <<<"$(printf '%s\n' "$SUMMARY" | sed -n 1p)"
PASSED="${PASSED:-0}"; TOTAL="${TOTAL:-0}"
DAYS="$(printf '%s\n' "$SUMMARY" | sed -n 2p)"
read -r PICTURES CLOSES <<<"$(printf '%s\n' "$SUMMARY" | sed -n 3p)"
PICTURES="${PICTURES:-0}"; CLOSES="${CLOSES:-0}"
WARNINGS="$(printf '%s\n' "$SUMMARY" | sed -n '4,$p')"
# ได้อะไรมาบ้าง (เฉพาะที่ได้จริง) — ทุกกรณีที่รอบนี้เขียนอย่างน้อยหนึ่งโฟลเดอร์ (ผ่านครบ / บางส่วน / ล้มหมด = ไม่ขึ้นบรรทัดนี้)
what_was_fetched() {
  [ -n "$DAYS" ] && echo "   รายงานตามวัน: ข้อมูลวันที่ $DAYS"
  if [ "$PICTURES" -gt 0 ] || [ "$CLOSES" -gt 0 ]; then
    line="   รายงานภาพ: ถ่าย $PICTURES รายงาน"
    [ "$CLOSES" -gt 0 ] && line="$line · ภาพปิดงวด $CLOSES รายงาน"
    echo "$line"
  fi
  return 0
}

echo
echo "════════════════════════════════════════════════════════"
if [ "$TOTAL" -eq 0 ] && [ "$EXPORT_RC" -eq 0 ]; then
  RESULT=0
  echo "✅ ไม่มีงานค้าง — รายงานได้ครบแล้วตั้งแต่รอบก่อน ไม่ต้องกด captcha"
  echo "   ปิดหน้าต่างนี้ได้เลย"
elif [ "$TOTAL" -gt 0 ] && [ "$PASSED" -eq "$TOTAL" ]; then
  RESULT=0
  echo "✅ เสร็จเรียบร้อย — ได้รายงานครบ $PASSED/$TOTAL รายงาน"
  what_was_fetched
  echo "   ไม่ต้องทำอะไรต่อ ปิดหน้าต่างนี้ได้เลย"
elif [ "$PASSED" -gt 0 ]; then
  RESULT=2
  echo "⚠️  ได้บางส่วน — ได้ $PASSED จาก $TOTAL รายงาน · ไม่ผ่าน $((TOTAL - PASSED)) รายงาน"
  what_was_fetched
  echo "   1. ดับเบิลคลิกไฟล์เดิมอีกครั้ง แล้วกด captcha ใหม่ — รายงานที่ได้แล้วจะไม่หาย"
  echo "   2. ถ้ารอบที่สองยังขึ้นข้อความนี้ ถ่ายรูปหน้าจอนี้ส่งให้ผู้ดูแลระบบ"
elif [ "$TOTAL" -gt 0 ]; then
  RESULT=1
  echo "❌ ไม่สำเร็จ — เข้าสู่ระบบได้ แต่ไม่ได้รายงานเลยสักรายงาน"
  what_was_fetched
  echo "   ถ่ายรูปหน้าจอนี้ส่งให้ผู้ดูแลระบบ"
else
  RESULT=1
  echo "❌ ไม่สำเร็จ — ยังไม่ได้รายงาน"
  echo "   สาเหตุที่พบบ่อย: กด captcha/เข้าสู่ระบบไม่ทันใน 5 นาที หรืออินเทอร์เน็ตหลุด"
  echo "   1. ดับเบิลคลิกไฟล์เดิมอีกครั้ง"
  echo "   2. ถ้ายังไม่ได้ ถ่ายรูปหน้าจอนี้ส่งให้ผู้ดูแลระบบ"
fi
[ -n "$WARNINGS" ] && printf '%s\n' "$WARNINGS" | sed 's/^/⚠️  /'
echo "════════════════════════════════════════════════════════"
pause_and_exit "$RESULT"
