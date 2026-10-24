#!/bin/bash
# ทดสอบ deploy/ubuntu/install.sh ของจริงใน ubuntu:24.04 ที่สะอาด (ticket 04 ของ exporter-ubuntu-deploy — seam ตกลงกับเจ้าของ 2026-10-12)
#
#   bash deploy/ubuntu/test-install-in-docker.sh          ← รันบนเครื่องพัฒนาที่มี Docker (ใช้อินเทอร์เน็ต: apt/npm/Chromium ~8 นาที)
#
# จำลองเครื่องจริง: บัญชีผู้ใช้ทั่วไปที่ใช้ sudo ได้ · ผู้ดูแลติดตั้ง Node.js 22 เองก่อน (ตามที่ตกลง — ตัวติดตั้งแค่เช็ค) · ตอบคำถาม
# รหัสผ่านผ่าน stdin · ใน container ไม่มี Docker (รัน Docker ซ้อนไม่ได้) และไม่เช็ค login (รหัสปลอม) · ส่งเฉพาะไฟล์ที่ git รู้จัก
# (ไม่มี .env/data/node_modules ของเครื่องนี้) · ผ่านจริงต้องเห็น "ALL PASSED" — exit code อย่างเดียวไม่พอ
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
BUNDLE="$(mktemp "${TMPDIR:-/tmp}/exporter-install-test.XXXXXX")"
LOG="$(mktemp "${TMPDIR:-/tmp}/exporter-install-test-log.XXXXXX")"
trap 'rm -f "$BUNDLE" "$LOG"' EXIT
{ git ls-files -- exporter windmill deploy/ubuntu docs; git ls-files --others --exclude-standard -- exporter windmill deploy/ubuntu docs; } \
  | sort -u | COPYFILE_DISABLE=1 tar --no-xattrs -cf "$BUNDLE" -T -

docker run --rm -i -v "$BUNDLE:/tmp/repo.tar:ro" ubuntu:24.04 bash -s <<'IN_CONTAINER' 2>&1 | tee "$LOG"
set -euo pipefail
fail() { echo "✘ FAIL: $*"; exit 1; }
pass() { echo "✔ $*"; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq sudo ca-certificates curl gnupg xdg-user-dirs >/dev/null </dev/null
# ผู้ดูแลติดตั้ง Node.js เอง (นอกตัวติดตั้ง) — จำลองด้วย NodeSource 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x </dev/null | bash - >/dev/null 2>&1
apt-get install -y -qq nodejs >/dev/null </dev/null
useradd -m -s /bin/bash shopuser
echo 'shopuser ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/shopuser
mkdir -p /home/shopuser/exporter-repo && tar -xf /tmp/repo.tar -C /home/shopuser/exporter-repo
chown -R shopuser:shopuser /home/shopuser/exporter-repo
R=/home/shopuser/exporter-repo
# stdin ของทุกคำสั่งในนี้ต้องไม่ใช่ตัวสคริปต์ test เอง (heredoc) — ไม่งั้นคำสั่งลูกอ่านกลืนบรรทัดที่เหลือแล้ว test จบแบบ "ผ่าน" เงียบ ๆ
as_user() { sudo -u shopuser -H bash -c "cd $R && $*" </dev/null; }
as_user_answering() { local answers="$1"; shift; printf '%s' "$answers" | sudo -u shopuser -H bash -c "cd $R && $*"; }
INSTALL="bash deploy/ubuntu/install.sh --no-login-check"

echo "== ติดตั้งรอบแรก — รหัสมีช่องว่างหัวท้าย, มี ' (ทางเลือก \"...\"), สาขาเว้นว่าง = ค่าเริ่มต้นจาก .env.example · URL ของ Discord webhook คนละ channel (export/upload, ใบ 10 + เจ้าของระบบขอ 2026-10-18)"
HOOK='https://discord.com/api/webhooks/123456789/fake-webhook-token-for-install-test'
HOOK2='https://discord.com/api/webhooks/987654321/fake-upload-hook-test'
TODAY="$(TZ=Asia/Bangkok date +%F)"
CAPKEY='0123456789abcdef0123456789abcdef' # คีย์ 2captcha ปลอม (32 ตัว) — ใบ 04 ของ exporter-foodstory-scheduled-daily
ANSWERS=$'hotel-user\n p#ss w0rd!$x \nfood@example.com\nit\'s f00d $$ #1\n\n'"$HOOK"$'\n'"$HOOK2"$'\n'"$CAPKEY"$'\n'
as_user_answering "$ANSWERS" "$INSTALL" >/tmp/first.out 2>&1 || { cat /tmp/first.out; fail "ติดตั้งรอบแรก exit"; }
cat /tmp/first.out
[ -d $R/exporter/node_modules/playwright ] && pass "node_modules" || fail "ไม่มี node_modules"
ls -d /home/shopuser/.cache/ms-playwright/chromium* >/dev/null 2>&1 && pass "Chromium" || fail "ไม่มี Chromium"
[ "$(stat -c %a $R/exporter/.env)" = 600 ] && pass "exporter/.env 600" || fail "exporter/.env สิทธิ์ไม่ใช่ 600"
as_user "cd exporter && node -e '
  const v = require(\"dotenv\").config({ quiet: true }).parsed;
  const want = { HOTELTIME_USERNAME: \"hotel-user\", HOTELTIME_PASSWORD: \" p#ss w0rd!\$x \", FOODSTORY_EMAIL: \"food@example.com\",
    FOODSTORY_PASSWORD: \"it\\x27s f00d \$\$ #1\", FOODSTORY_BRANCH_NAME: \"Chaweng Buri Resort\" };
  for (const [k, w] of Object.entries(want)) if (v[k] !== w) { console.error(k, JSON.stringify(v[k]), \"!=\", JSON.stringify(w)); process.exit(1); }
  if (!v.HOTELTIME_BASE_URL) process.exit(1);
'" && pass ".env อ่านกลับได้ตรงทุกตัว (ช่องว่างหัวท้าย, ', #, \$) + สาขาค่าเริ่มต้น + ค่าอื่นจาก .env.example ยังอยู่" || fail ".env ค่าไม่ตรง"
as_user "cd exporter && node -e '
  const v = require(\"dotenv\").config({ quiet: true }).parsed;
  if (v.EXPORTER_GO_LIVE !== \"$TODAY\") { console.error(\"go-live\", v.EXPORTER_GO_LIVE); process.exit(1); }
  if (v.DISCORD_WEBHOOK_URL_EXPORT !== \"$HOOK\") { console.error(\"webhook export ไม่ตรง\"); process.exit(1); }
  if (v.DISCORD_WEBHOOK_URL_UPLOAD !== \"$HOOK2\") { console.error(\"webhook upload ไม่ตรง\"); process.exit(1); }
'" && pass "วันเริ่มใช้งาน = วันที่ติดตั้ง ($TODAY) · URL ของ webhook ทั้งสอง channel อ่านกลับได้ตรง" || fail "วันเริ่มใช้งาน/URL ของ webhook ไม่ถูกตั้ง"
if grep -q "fake-webhook-token-for-install-test\|fake-webhook-token-upload-for-install-test" /tmp/first.out; then fail "URL ของ webhook โผล่บนจอ"; fi
pass "URL ของ webhook ไม่แสดงบนจอ (ทั้งสอง channel)"
as_user "cd exporter && node -e '
  if (require(\"dotenv\").config({ quiet: true }).parsed.TWOCAPTCHA_API_KEY !== \"$CAPKEY\") process.exit(1);
'" && pass "คีย์ 2captcha อ่านกลับได้ตรง" || fail "คีย์ 2captcha ไม่ถูกบันทึก"
if grep -q "$CAPKEY" /tmp/first.out; then fail "คีย์ 2captcha โผล่บนจอ"; fi
pass "คีย์ 2captcha ไม่แสดงบนจอ"
[ "$(stat -c %a $R/windmill/.env)" = 600 ] && pass "windmill/.env 600" || fail "windmill/.env สิทธิ์ไม่ใช่ 600"
PG="$(grep '^POSTGRES_PASSWORD=' $R/windmill/.env | cut -d= -f2-)"
[ -n "$PG" ] && [ "$PG" != changeme ] && grep -q "^DATABASE_URL=postgres://postgres:$PG@" $R/windmill/.env \
  && pass "รหัส Postgres สุ่มใหม่และตรงกับ DATABASE_URL" || fail "รหัส Postgres ไม่ถูกตั้ง"
ls /home/shopuser/Desktop/*.desktop >/dev/null 2>&1 && pass "ไอคอนบน Desktop" || fail "ไม่มีไอคอนบน Desktop"
grep -q "ยังต้องทำ" /tmp/first.out && grep -q "Docker" /tmp/first.out \
  && pass "ไม่มี Docker: สรุปตอนจบบอกว่ายังต้องติดตั้ง Docker" || fail "สรุปตอนจบไม่บอกสิ่งที่ยังต้องทำ"
if grep -q "✅ ติดตั้งเสร็จ" /tmp/first.out; then fail "ไม่มี Docker แต่ขึ้นว่าติดตั้งเสร็จ"; fi
as_user "cd exporter && npm test 2>&1 | grep -E '^# (pass|fail)'" | tee /tmp/t
grep -q '^# fail 0' /tmp/t && pass "npm test ผ่านบนเครื่องที่ติดตั้ง (รวม test ที่เปิด Chromium จริง)" || fail "npm test ไม่ผ่าน"

echo "== รันซ้ำ: ไม่ถาม ไม่แตะ .env ไม่ลบ node_modules ไม่เรียก apt"
BEFORE="$(sha256sum $R/exporter/.env $R/windmill/.env)"
INODE="$(stat -c %i $R/exporter/node_modules/playwright/package.json)"
as_user "$INSTALL" >/tmp/rerun.out 2>&1 || { cat /tmp/rerun.out; fail "รันซ้ำ exit"; }
[ "$BEFORE" = "$(sha256sum $R/exporter/.env $R/windmill/.env)" ] && pass "ไม่แตะ .env" || fail "รันซ้ำเปลี่ยน .env"
[ "$INODE" = "$(stat -c %i $R/exporter/node_modules/playwright/package.json)" ] \
  && pass "ไม่ลบ/สร้าง node_modules ใหม่ (Windmill mount อยู่)" || fail "รันซ้ำสร้าง node_modules ใหม่"
if grep -qi "apt-get\|Installing dependencies" /tmp/rerun.out; then cat /tmp/rerun.out; fail "รันซ้ำเรียก apt"; fi
pass "ไม่เรียก apt ซ้ำ (library ของ Chromium ครบแล้ว)"

echo "== เครื่องที่ติดตั้งก่อนใบ 10 / ก่อนมีคีย์ 2captcha: รันซ้ำเติมวันเริ่มใช้งาน ไม่แตะค่าอื่น · ข้าม URL และคีย์ได้ (บอกในสิ่งที่ยังต้องทำ)"
sed -i -e '/^EXPORTER_GO_LIVE=/d' -e '/^DISCORD_WEBHOOK_URL_EXPORT=/d' -e '/^DISCORD_WEBHOOK_URL_UPLOAD=/d' -e '/^TWOCAPTCHA_API_KEY=/d' $R/exporter/.env
OLD_PASS="$(grep '^HOTELTIME_PASSWORD=' $R/exporter/.env)"
as_user_answering $'\n\n\n' "$INSTALL" >/tmp/upgrade.out 2>&1 || { cat /tmp/upgrade.out; fail "รันซ้ำบนเครื่องเก่า exit"; }
if grep -q '^TWOCAPTCHA_API_KEY=' $R/exporter/.env; then fail "ข้ามคีย์ 2captcha แล้วยังเขียน TWOCAPTCHA_API_KEY"; fi
grep -q "TWOCAPTCHA_API_KEY" /tmp/upgrade.out && pass "ข้ามคีย์ 2captcha: สรุปตอนจบบอกวิธีใส่ทีหลัง" || fail "ข้ามคีย์ 2captcha แล้วไม่บอกในสิ่งที่ยังต้องทำ"
grep -qx "EXPORTER_GO_LIVE=$TODAY" $R/exporter/.env && pass "เติมวันเริ่มใช้งาน = วันนี้" || fail "ไม่เติมวันเริ่มใช้งาน"
if grep -q '^DISCORD_WEBHOOK_URL_EXPORT=\|^DISCORD_WEBHOOK_URL_UPLOAD=' $R/exporter/.env; then fail "ข้าม URL แล้วยังเขียน DISCORD_WEBHOOK_URL_*"; fi
[ "$OLD_PASS" = "$(grep '^HOTELTIME_PASSWORD=' $R/exporter/.env)" ] && pass "ค่าอื่นใน .env ไม่ถูกแตะ" || fail "รหัสผ่านเดิมเปลี่ยน"
grep -q "ยังต้องทำ" /tmp/upgrade.out && grep -q "DISCORD_WEBHOOK_URL_EXPORT" /tmp/upgrade.out && grep -q "DISCORD_WEBHOOK_URL_UPLOAD" /tmp/upgrade.out \
  && pass "ข้าม URL ทั้งสอง channel: สรุปตอนจบบอกวิธีตั้งทีหลัง" || fail "ข้าม URL แล้วไม่บอกในสิ่งที่ยังต้องทำ"
[ "$(stat -c %a $R/exporter/.env)" = 600 ] && pass "exporter/.env ยัง 600" || fail "exporter/.env สิทธิ์เปลี่ยน"
sed -i "s/^EXPORTER_GO_LIVE=.*/EXPORTER_GO_LIVE=2026-01-02/" $R/exporter/.env
as_user_answering $'\n\nnot-a-2captcha-key\n' "$INSTALL" >/tmp/keep.out 2>&1 || { cat /tmp/keep.out; fail "รันซ้ำ exit"; }
if grep -q '^TWOCAPTCHA_API_KEY=' $R/exporter/.env; then fail "คีย์ 2captcha ผิดรูปแบบแต่ยังถูกบันทึก"; fi
grep -q "32 ตัว" /tmp/keep.out && pass "คีย์ 2captcha ผิดรูปแบบ: ไม่บันทึก และบอกรูปแบบที่ถูก" || fail "คีย์ผิดรูปแบบแล้วไม่บอก"
grep -qx "EXPORTER_GO_LIVE=2026-01-02" $R/exporter/.env && pass "รันซ้ำไม่ทับวันเริ่มใช้งานที่ตั้งไว้" || fail "รันซ้ำทับวันเริ่มใช้งาน"
[ "$(grep -c '^EXPORTER_GO_LIVE=' $R/exporter/.env)" = 1 ] && pass "ไม่มีบรรทัดซ้ำ" || fail "EXPORTER_GO_LIVE ซ้ำหลายบรรทัด"

echo "== หยุดหลังสร้างไฟล์ชั่วคราวแล้ว: ต้องไม่เหลือไฟล์ที่มีรหัสผ่าน"
rm -f $R/exporter/.env
chmod 000 $R/exporter/.env.example
if as_user_answering $'u\np\ne@x\np\nb\n' "$INSTALL" >/tmp/half.out 2>&1; then chmod 644 $R/exporter/.env.example; fail "อ่าน .env.example ไม่ได้แต่ยังผ่าน"; fi
chmod 644 $R/exporter/.env.example
LEFT="$(ls -A $R/exporter | grep -E '^\.env' | grep -vx '\.env\.example' || true)"
[ -z "$LEFT" ] && pass "ไม่เหลือ .env* ค้าง" || fail "เหลือไฟล์ค้าง: $LEFT"

echo "== ห้ามรันด้วย root"
if bash $R/deploy/ubuntu/install.sh --no-login-check </dev/null >/tmp/root.out 2>&1; then fail "root รันได้"; fi
grep -q sudo /tmp/root.out && pass "root ถูกปฏิเสธ" || fail "ข้อความตอนปฏิเสธ root ไม่บอกเรื่อง sudo"

echo "ALL PASSED"
IN_CONTAINER

tail -1 "$LOG" | grep -qx "ALL PASSED" || { echo "✘ ไม่เห็น ALL PASSED เป็นบรรทัดสุดท้าย — ถือว่าไม่ผ่าน" >&2; exit 1; }
