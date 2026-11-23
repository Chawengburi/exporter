#!/bin/bash
# Tests the real deploy/ubuntu/install.sh in a clean ubuntu:24.04 (ticket 04 of exporter-ubuntu-deploy — seam agreed with the owner 2026-10-12)
#
#   bash deploy/ubuntu/test-install-in-docker.sh          <- run on a development machine that has Docker (needs the internet: apt/npm/Chromium ~8 minutes)
#
# Simulates a real machine: an ordinary user account that can use sudo · the administrator installs Node.js 22 first (as agreed — the installer only checks) · the password
# questions are answered through stdin · there is no Docker in the container (Docker cannot be nested) and the login check is skipped (fake passwords) · only files git knows about are sent
# (none of this machine's .env/data/node_modules) · a real pass must show "ALL PASSED" — the exit code alone is not enough
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
# the administrator installs Node.js themselves (outside the installer) — simulated with NodeSource 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x </dev/null | bash - >/dev/null 2>&1
apt-get install -y -qq nodejs >/dev/null </dev/null
useradd -m -s /bin/bash shopuser
echo 'shopuser ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/shopuser
mkdir -p /home/shopuser/exporter-repo && tar -xf /tmp/repo.tar -C /home/shopuser/exporter-repo
chown -R shopuser:shopuser /home/shopuser/exporter-repo
R=/home/shopuser/exporter-repo
# the stdin of every command here must not be the test script itself (the heredoc) — otherwise a child command swallows the remaining lines and the test ends with a silent "pass"
as_user() { sudo -u shopuser -H bash -c "cd $R && $*" </dev/null; }
as_user_answering() { local answers="$1"; shift; printf '%s' "$answers" | sudo -u shopuser -H bash -c "cd $R && $*"; }
INSTALL="bash deploy/ubuntu/install.sh --no-login-check"

echo "== First install — passwords with leading/trailing spaces, with ' (the \"...\" alternative), branch left empty = default from .env.example · Discord webhook URLs for separate channels (export/upload, ticket 10 + requested by the owner 2026-10-18)"
HOOK='https://discord.com/api/webhooks/123456789/fake-webhook-token-for-install-test'
HOOK2='https://discord.com/api/webhooks/987654321/fake-upload-hook-test'
TODAY="$(TZ=Asia/Bangkok date +%F)"
# a fresh install keeps the go-live date written in exporter/.env.example (the Ubuntu machine's install date); the installer only writes today's date when the line is missing
FIXED_GO_LIVE="$(sed -n 's/^EXPORTER_GO_LIVE=//p' "$R/exporter/.env.example")" # this script runs inside the test container (piped in), so read the repo copy there
[ -n "$FIXED_GO_LIVE" ] || fail "exporter/.env.example has no EXPORTER_GO_LIVE line"
CAPKEY='0123456789abcdef0123456789abcdef' # a fake 2captcha key (32 characters) — ticket 04 of exporter-foodstory-scheduled-daily
UPPASS='upl0ad p#ss $x'
ANSWERS=$'hotel-user\n p#ss w0rd!$x \nfood@example.com\nit\'s f00d $$ #1\n\n'"$HOOK"$'\n'"$HOOK2"$'\n'"$CAPKEY"$'\n\nuploader@example.com\n'"$UPPASS"$'\n'
as_user_answering "$ANSWERS" "$INSTALL" >/tmp/first.out 2>&1 || { cat /tmp/first.out; fail "first install exit"; }
cat /tmp/first.out
[ -d $R/exporter/node_modules/playwright ] && pass "node_modules" || fail "no node_modules"
ls -d /home/shopuser/.cache/ms-playwright/chromium* >/dev/null 2>&1 && pass "Chromium" || fail "no Chromium"
[ "$(stat -c %a $R/exporter/.env)" = 600 ] && pass "exporter/.env 600" || fail "exporter/.env permissions are not 600"
as_user "cd exporter && node -e '
  const v = require(\"dotenv\").config({ quiet: true }).parsed;
  const want = { HOTELTIME_USERNAME: \"hotel-user\", HOTELTIME_PASSWORD: \" p#ss w0rd!\$x \", FOODSTORY_EMAIL: \"food@example.com\",
    FOODSTORY_PASSWORD: \"it\\x27s f00d \$\$ #1\", FOODSTORY_BRANCH_NAME: \"Chaweng Buri Resort\" };
  for (const [k, w] of Object.entries(want)) if (v[k] !== w) { console.error(k, JSON.stringify(v[k]), \"!=\", JSON.stringify(w)); process.exit(1); }
  if (!v.HOTELTIME_BASE_URL) process.exit(1);
'" && pass ".env reads back exactly for every value (leading/trailing spaces, ', #, \$) + default branch + other values from .env.example are still there" || fail ".env values do not match"
as_user "cd exporter && ! grep -E '^[A-Z_]+=' .env | cut -d= -f1 | sort | uniq -d | grep -q ." \
  && pass "every key appears once in .env: the installer filled the empty lines of .env.example in place, no duplicate lines" || fail ".env has duplicate keys"
as_user "cd exporter && node -e '
  const v = require(\"dotenv\").config({ quiet: true }).parsed;
  if (v.EXPORTER_GO_LIVE !== \"$FIXED_GO_LIVE\") { console.error(\"go-live\", v.EXPORTER_GO_LIVE); process.exit(1); }
  if (v.DISCORD_WEBHOOK_URL_EXPORT !== \"$HOOK\") { console.error(\"webhook export does not match\"); process.exit(1); }
  if (v.DISCORD_WEBHOOK_URL_UPLOAD !== \"$HOOK2\") { console.error(\"webhook upload does not match\"); process.exit(1); }
'" && pass "go-live date = the one in .env.example ($FIXED_GO_LIVE) · both channels' webhook URLs read back exactly" || fail "go-live date/webhook URLs were not set"
if grep -q "fake-webhook-token-for-install-test\|fake-webhook-token-upload-for-install-test" /tmp/first.out; then fail "the webhook URL appeared on screen"; fi
pass "webhook URLs are not shown on screen (both channels)"
as_user "cd exporter && node -e '
  if (require(\"dotenv\").config({ quiet: true }).parsed.TWOCAPTCHA_API_KEY !== \"$CAPKEY\") process.exit(1);
'" && pass "2captcha key reads back exactly" || fail "the 2captcha key was not saved"
if grep -q "$CAPKEY" /tmp/first.out; then fail "the 2captcha key appeared on screen"; fi
# look-ahead arrival report (ADR-0015): a fresh install must leave it OFF — an empty value, not a number
as_user "cd exporter && grep -qx 'HOTELTIME_LOOKAHEAD_DAYS=' .env" \
  && pass "HOTELTIME_LOOKAHEAD_DAYS is present and empty after a fresh install (the look-ahead report stays off until the owner sets N)" || fail "HOTELTIME_LOOKAHEAD_DAYS is missing or not empty in the new .env"
pass "the 2captcha key is not shown on screen"
as_user "cd exporter && node -e '
  const v = require(\"dotenv\").config({ quiet: true }).parsed;
  if (v.UPLOADER_URL !== \"https://uploader.chawengbot.cloud\") { console.error(\"url\", v.UPLOADER_URL); process.exit(1); }
  if (v.UPLOADER_EMAIL !== \"uploader@example.com\") { console.error(\"email\", v.UPLOADER_EMAIL); process.exit(1); }
  if (v.UPLOADER_PASSWORD !== \"$UPPASS\") { console.error(\"password does not match\"); process.exit(1); }
'" && pass "the uploader account reads back exactly (default URL = production, password has # and \$)" || fail "the uploader account was not saved"
if grep -q "$UPPASS" /tmp/first.out; then fail "the uploader password appeared on screen"; fi
pass "the uploader password is not shown on screen"
[ "$(stat -c %a $R/windmill/.env)" = 600 ] && pass "windmill/.env 600" || fail "windmill/.env permissions are not 600"
PG="$(grep '^POSTGRES_PASSWORD=' $R/windmill/.env | cut -d= -f2-)"
[ -n "$PG" ] && [ "$PG" != changeme ] && grep -q "^DATABASE_URL=postgres://postgres:$PG@" $R/windmill/.env \
  && pass "the Postgres password is freshly random and matches DATABASE_URL" || fail "the Postgres password was not set"
ls /home/shopuser/Desktop/*.desktop >/dev/null 2>&1 && pass "icon on the Desktop" || fail "no icon on the Desktop"
grep -q "still to do" /tmp/first.out && grep -q "Docker" /tmp/first.out \
  && pass "no Docker: the final summary says Docker still has to be installed" || fail "the final summary does not say what is still to do"
if grep -q "✅ Installation complete" /tmp/first.out; then fail "no Docker but it says the installation is complete"; fi
as_user "cd exporter && npm test 2>&1 | grep -E '^# (pass|fail)'" | tee /tmp/t
grep -q '^# fail 0' /tmp/t && pass "npm test passes on the installed machine (including tests that open a real Chromium)" || fail "npm test failed"

echo "== Re-run: no questions, does not touch .env, does not delete node_modules, does not call apt"
BEFORE="$(sha256sum $R/exporter/.env $R/windmill/.env)"
INODE="$(stat -c %i $R/exporter/node_modules/playwright/package.json)"
as_user "$INSTALL" >/tmp/rerun.out 2>&1 || { cat /tmp/rerun.out; fail "re-run exit"; }
[ "$BEFORE" = "$(sha256sum $R/exporter/.env $R/windmill/.env)" ] && pass ".env is not touched" || fail "the re-run changed .env"
[ "$INODE" = "$(stat -c %i $R/exporter/node_modules/playwright/package.json)" ] \
  && pass "node_modules is not deleted/recreated (Windmill mounts it)" || fail "the re-run recreated node_modules"
if grep -qi "apt-get\|Installing dependencies" /tmp/rerun.out; then cat /tmp/rerun.out; fail "the re-run called apt"; fi
pass "apt is not called again (the Chromium libraries are complete)"

echo "== A machine installed before ticket 10 / before the 2captcha key existed: a re-run fills in the go-live date and leaves other values alone · the URLs and key can be skipped (reported in what is still to do)"
sed -i -e '/^EXPORTER_GO_LIVE=/d' -e '/^DISCORD_WEBHOOK_URL_EXPORT=/d' -e '/^DISCORD_WEBHOOK_URL_UPLOAD=/d' -e '/^TWOCAPTCHA_API_KEY=/d' -e '/^UPLOADER_URL=/d' -e '/^UPLOADER_EMAIL=/d' -e '/^UPLOADER_PASSWORD=/d' $R/exporter/.env
OLD_PASS="$(grep '^HOTELTIME_PASSWORD=' $R/exporter/.env)"
as_user_answering $'\n\n\n' "$INSTALL" >/tmp/upgrade.out 2>&1 || { cat /tmp/upgrade.out; fail "re-run on the older machine exit"; }
if grep -q '^TWOCAPTCHA_API_KEY=' $R/exporter/.env; then fail "the 2captcha key was skipped but TWOCAPTCHA_API_KEY was still written"; fi
grep -q "TWOCAPTCHA_API_KEY" /tmp/upgrade.out && pass "2captcha key skipped: the final summary says how to add it later" || fail "the 2captcha key was skipped but it is not listed in what is still to do"
grep -qx "EXPORTER_GO_LIVE=$TODAY" $R/exporter/.env && pass "go-live date filled in = today" || fail "the go-live date was not filled in"
if grep -q '^UPLOADER_EMAIL=\|^UPLOADER_PASSWORD=' $R/exporter/.env; then fail "the uploader account was skipped but UPLOADER_* was still written"; fi
grep -q "UPLOADER_EMAIL" /tmp/upgrade.out && pass "uploader account skipped: the final summary says how to add it later" || fail "the uploader account was skipped but it is not listed in what is still to do"
if grep -q '^DISCORD_WEBHOOK_URL_EXPORT=\|^DISCORD_WEBHOOK_URL_UPLOAD=' $R/exporter/.env; then fail "the URLs were skipped but DISCORD_WEBHOOK_URL_* was still written"; fi
[ "$OLD_PASS" = "$(grep '^HOTELTIME_PASSWORD=' $R/exporter/.env)" ] && pass "other values in .env are not touched" || fail "the existing password changed"
grep -q "still to do" /tmp/upgrade.out && grep -q "DISCORD_WEBHOOK_URL_EXPORT" /tmp/upgrade.out && grep -q "DISCORD_WEBHOOK_URL_UPLOAD" /tmp/upgrade.out \
  && pass "both channels' URLs skipped: the final summary says how to set them later" || fail "the URLs were skipped but they are not listed in what is still to do"
[ "$(stat -c %a $R/exporter/.env)" = 600 ] && pass "exporter/.env is still 600" || fail "exporter/.env permissions changed"
sed -i "s/^EXPORTER_GO_LIVE=.*/EXPORTER_GO_LIVE=2026-01-02/" $R/exporter/.env
as_user_answering $'\n\nnot-a-2captcha-key\n' "$INSTALL" >/tmp/keep.out 2>&1 || { cat /tmp/keep.out; fail "re-run exit"; }
if grep -q '^TWOCAPTCHA_API_KEY=' $R/exporter/.env; then fail "a malformed 2captcha key was still saved"; fi
grep -q "32 letters/digits" /tmp/keep.out && pass "malformed 2captcha key: not saved, and the correct format is stated" || fail "malformed key but the correct format is not stated"
grep -qx "EXPORTER_GO_LIVE=2026-01-02" $R/exporter/.env && pass "the re-run does not overwrite the go-live date that was set" || fail "the re-run overwrote the go-live date"
[ "$(grep -c '^EXPORTER_GO_LIVE=' $R/exporter/.env)" = 1 ] && pass "no duplicate lines" || fail "EXPORTER_GO_LIVE appears on several lines"

echo "== Stopped after the temporary file was created: no file containing a password may be left behind"
rm -f $R/exporter/.env
chmod 000 $R/exporter/.env.example
if as_user_answering $'u\np\ne@x\np\nb\n' "$INSTALL" >/tmp/half.out 2>&1; then chmod 644 $R/exporter/.env.example; fail "could not read .env.example but it still passed"; fi
chmod 644 $R/exporter/.env.example
LEFT="$(ls -A $R/exporter | grep -E '^\.env' | grep -vx '\.env\.example' || true)"
[ -z "$LEFT" ] && pass "no .env* left behind" || fail "files left behind: $LEFT"

echo "== Must not run as root"
if bash $R/deploy/ubuntu/install.sh --no-login-check </dev/null >/tmp/root.out 2>&1; then fail "root was allowed to run it"; fi
grep -q sudo /tmp/root.out && pass "root was refused" || fail "the message refusing root does not mention sudo"

echo "ALL PASSED"
IN_CONTAINER

tail -1 "$LOG" | grep -qx "ALL PASSED" || { echo "✘ ALL PASSED was not the last line — treated as a failure" >&2; exit 1; }
