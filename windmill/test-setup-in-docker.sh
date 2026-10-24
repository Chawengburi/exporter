#!/bin/bash
# ทดสอบ windmill/setup.mjs กับ Windmill ชุดทดสอบที่แยกขาด (ticket 03 ของ exporter-ubuntu-deploy — seam ตกลงกับเจ้าของ 2026-10-12)
#
#   bash windmill/test-setup-in-docker.sh
#
# ไม่แตะ Windmill ตัวที่รัน HotelTime อยู่: ก๊อป windmill/ ไปโฟลเดอร์ชั่วคราว (มี exporter/ ปลอมข้าง ๆ — ไม่ mount รหัสจริงเข้า container ใด)
# · compose project `wmtest` · พอร์ต 18000 · เปิดแค่ db + windmill_server + caddy (ตั้งค่าผ่าน API ไม่ต้องใช้ worker และไม่รันรายงานจริง)
# · ลบทิ้งทั้งชุด (down -v) เสมอแม้ล้ม · ผ่านจริงต้องเห็น "ALL PASSED"
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=18000
BASE="http://127.0.0.1:$PORT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wmtest.XXXXXX")"
WM="$WORK/windmill"
compose() { (cd "$WM" && docker compose -p wmtest "$@"); }
cleanup() { compose down -v >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "✘ FAIL: $*"; exit 1; }
pass() { echo "✔ $*"; }

mkdir -p "$WM" "$WORK/exporter/data" "$WORK/exporter/recon/captures"
cp -R "$SRC/." "$WM/"
rm -f "$WM/.env"
: >"$WM/.admin-password" # ไฟล์ว่าง (เช่น คนสร้างไว้แต่ยังไม่ได้ใส่รหัส) ต้องถือว่าไม่มีรหัส ไม่ใช่ล้มด้วย error ภาษาอังกฤษ
PG="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG|" -e "s|^DATABASE_URL=postgres://postgres:[^@]*@|DATABASE_URL=postgres://postgres:$PG@|" \
  "$SRC/.env.example" >"$WM/.env"
echo "WM_PORT=$PORT" >>"$WM/.env"

echo "== เปิด Windmill ชุดทดสอบ (project wmtest, พอร์ต $PORT)"
compose up -d db windmill_server caddy >/dev/null 2>&1 || { compose logs --tail 30; fail "เปิด stack ทดสอบไม่ได้"; }

api() { # api <METHOD> <path> [json] — ใช้ $TOKEN
  curl -sS -X "$1" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' ${3:+--data "$3"} "$BASE/api$2"
}
login() { curl -sS -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
  --data "{\"email\":\"admin@windmill.dev\",\"password\":\"$1\"}" "$BASE/api/auth/login"; }

echo "== รอบแรก"
node "$WM/setup.mjs" --base "$BASE" | tee "$WORK/first.out" || fail "setup รอบแรก exit $?"
# GNU stat ก่อน — บน Linux `stat -f` คือสถานะ filesystem พิมพ์หลายบรรทัดแล้วค่า fallback ต่อท้าย เทียบ 600 ไม่มีวันตรง
perm() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
[ -s "$WM/.admin-password" ] && [ "$(perm "$WM/.admin-password")" = 600 ] \
  && pass ".admin-password สร้างแล้ว สิทธิ์ 600" || fail "ไม่มี .admin-password หรือสิทธิ์ไม่ใช่ 600"
NEWPW="$(cat "$WM/.admin-password")"
[ "${#NEWPW}" -ge 24 ] && pass "รหัส admin ใหม่ยาวพอ" || fail "รหัส admin สั้นเกินไป"
CODE="$(login changeme)"
[ "$CODE" != 200 ] && [ "$CODE" != 000 ] && pass "รหัสเริ่มต้น changeme ใช้ไม่ได้แล้ว (HTTP $CODE)" || fail "changeme ยังใช้ได้ หรือเซิร์ฟเวอร์ไม่ตอบ (HTTP $CODE)"
[ "$(login "$NEWPW")" = 200 ] && pass "ล็อกอินด้วยรหัสใหม่ได้" || fail "ล็อกอินด้วยรหัสใหม่ไม่ได้"
TOKEN="$(curl -sS -H 'content-type: application/json' --data "{\"email\":\"admin@windmill.dev\",\"password\":\"$NEWPW\"}" "$BASE/api/auth/login")"
WHO="$(api GET /w/admins/users/whoami | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).username)')"

api GET /configs/get/worker__custom | node -e '
  const c = JSON.parse(require("fs").readFileSync(0)); if (JSON.stringify(c?.worker_tags) !== JSON.stringify(["chromium"])) process.exit(1)
' && pass "worker group custom ฟัง tag chromium" || fail "config worker__custom ไม่ถูก"

for name in pms_export_daily pms_export_daily_catchup foodstory_export_daily foodstory_export_daily_catchup; do
  api GET "/w/admins/scripts/get/p/u/$WHO/$name" >"$WORK/$name.json"
  node -e '
    const [file, json] = process.argv.slice(1); const fs = require("fs");
    const s = JSON.parse(fs.readFileSync(json)); const want = fs.readFileSync(file, "utf8");
    if (s.content !== want || s.language !== "bash" || s.tag !== "chromium") process.exit(1);
  ' "$SRC/scripts/$name.sh" "$WORK/$name.json" && pass "สคริปต์ u/$WHO/$name: เนื้อหาตรงไฟล์ใน repo, bash, tag chromium" || fail "สคริปต์ $name ไม่ถูก"
done
# exporter-foodstory-scheduled-daily ใบ 04: เพดานเวลาของ job FoodStory ตั้งที่สคริปต์เอง (ไม่พึ่งค่าตั้งต้นของ Windmill) — Windmill ต้องเก็บไว้จริง
for name in foodstory_export_daily foodstory_export_daily_catchup; do
  node -e 'if (JSON.parse(require("fs").readFileSync(process.argv[1])).timeout !== 3600) process.exit(1)' "$WORK/$name.json" \
    && pass "สคริปต์ $name มีเพดานเวลา 3600 วินาที" || fail "สคริปต์ $name ไม่มีเพดานเวลา (Windmill ไม่เก็บ timeout?)"
done

check_schedule() { # <path> <cron> <script_path>
  api GET "/w/admins/schedules/get/$1" | node -e '
    const [cron, script, who] = process.argv.slice(1);
    const s = JSON.parse(require("fs").readFileSync(0));
    const ok = s.schedule === cron && s.timezone === "Asia/Bangkok" && s.script_path === script && s.enabled === true
      && !s.is_flow && s.permissioned_as === `u/${who}`;
    if (!ok) { console.error(JSON.stringify(s)); process.exit(1); }
  ' "$2" "$3" "$WHO"
}
check_schedule "u/$WHO/pms_export_daily" "0 0 12 * * *" "u/$WHO/pms_export_daily" \
  && pass "schedule เที่ยง (Asia/Bangkok) เปิดอยู่ permissioned_as ผู้ที่ตั้ง" || fail "schedule เที่ยงไม่ถูก"
check_schedule "u/$WHO/pms_export_daily_catchup" "0 0 15,18 * * *" "u/$WHO/pms_export_daily_catchup" \
  && pass "schedule เก็บตก 15:00/18:00 เปิดอยู่" || fail "schedule เก็บตกไม่ถูก"
check_schedule "u/$WHO/foodstory_export_daily" "0 0 12 * * *" "u/$WHO/foodstory_export_daily" \
  && pass "FoodStory: schedule เที่ยง (Asia/Bangkok) เปิดอยู่" || fail "FoodStory: schedule เที่ยงไม่ถูก"
check_schedule "u/$WHO/foodstory_export_daily_catchup" "0 0 15,18 * * *" "u/$WHO/foodstory_export_daily_catchup" \
  && pass "FoodStory: schedule เก็บตก 15:00/18:00 เปิดอยู่" || fail "FoodStory: schedule เก็บตกไม่ถูก"
HASH1="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).hash)' "$WORK/pms_export_daily.json")"

echo "== รันซ้ำ: ต้องไม่เปลี่ยนอะไร"
node "$WM/setup.mjs" --base "$BASE" | tee "$WORK/second.out" || fail "setup รอบสอง exit $?"
[ "$(cat "$WM/.admin-password")" = "$NEWPW" ] && pass "รหัส admin เดิม" || fail "รันซ้ำเปลี่ยนรหัส admin"
HASH2="$(api GET /w/admins/scripts/get/p/u/$WHO/pms_export_daily | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).hash)')"
[ "$HASH1" = "$HASH2" ] && pass "ไม่สร้างสคริปต์เวอร์ชันใหม่" || fail "รันซ้ำสร้างสคริปต์เวอร์ชันใหม่"
grep -q "เปลี่ยน" "$WORK/second.out" && ! grep -q "ไม่มีอะไรเปลี่ยน" "$WORK/second.out" && fail "รันซ้ำรายงานว่ามีการเปลี่ยน" || true
grep -q "ไม่มีอะไรเปลี่ยน" "$WORK/second.out" && pass "รายงานว่าไม่มีอะไรเปลี่ยน" || fail "รันซ้ำไม่บอกว่าไม่มีอะไรเปลี่ยน"

echo "== แก้สคริปต์ใน repo แล้วรันใหม่: ต้องได้เวอร์ชันใหม่ (อัปเดตเครื่องด้วย git pull + รันซ้ำ)"
printf '\n# changed\n' >>"$WM/scripts/pms_export_daily.sh"
node "$WM/setup.mjs" --base "$BASE" >/dev/null || fail "setup รอบสาม exit $?"
api GET /w/admins/scripts/get/p/u/$WHO/pms_export_daily | node -e '
  const s = JSON.parse(require("fs").readFileSync(0)); if (!s.content.endsWith("# changed\n")) process.exit(1)
' && pass "สคริปต์ที่แก้ใน repo ถูก deploy เป็นเวอร์ชันใหม่" || fail "ไม่ deploy เวอร์ชันใหม่"

echo "== ซ่อมเอง: schedule ถูกปิด + ผู้ดูแลเพิ่ม tag อื่นให้ worker → รันซ้ำต้องเปิด schedule คืน และไม่ลบ tag ที่เพิ่ม"
api POST "/w/admins/schedules/setenabled/u/$WHO/pms_export_daily" '{"enabled":false}' >/dev/null
api POST /configs/update/worker__custom '{"worker_tags":["chromium","extra-tag"]}' >/dev/null
node "$WM/setup.mjs" --base "$BASE" >/dev/null || fail "setup รอบซ่อม exit $?"
api GET "/w/admins/schedules/get/u/$WHO/pms_export_daily" | node -e 'if (JSON.parse(require("fs").readFileSync(0)).enabled !== true) process.exit(1)' \
  && pass "schedule ที่ถูกปิดถูกเปิดคืน" || fail "schedule ยังปิดอยู่"
api GET /configs/get/worker__custom | node -e '
  const t = JSON.parse(require("fs").readFileSync(0)).worker_tags; if (!(t.includes("chromium") && t.includes("extra-tag"))) process.exit(1)
' && pass "tag ที่ผู้ดูแลเพิ่มเองยังอยู่" || fail "tag ที่เพิ่มเองหายไป"

echo "ALL PASSED"
