#!/bin/bash
# Tests windmill/setup.mjs against a fully separate test Windmill (ticket 03 of exporter-ubuntu-deploy — seam agreed with the owner 2026-10-12)
#
#   bash windmill/test-setup-in-docker.sh
#
# Does not touch the Windmill that is running HotelTime: copies windmill/ to a temporary folder (with a fake exporter/ next to it — no real code is mounted into any container)
# · compose project `wmtest` · port 18000 · starts only db + windmill_server + caddy (setup goes through the API, so no worker is needed and no real report is run)
# · the whole stack is always removed (down -v) even on failure · a real pass must show "ALL PASSED"
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
: >"$WM/.admin-password" # an empty file (e.g. someone created it but has not put the password in yet) must count as no password, not fail with an error
PG="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG|" -e "s|^DATABASE_URL=postgres://postgres:[^@]*@|DATABASE_URL=postgres://postgres:$PG@|" \
  "$SRC/.env.example" >"$WM/.env"
echo "WM_PORT=$PORT" >>"$WM/.env"

echo "== Starting the test Windmill (project wmtest, port $PORT)"
compose up -d db windmill_server caddy >/dev/null 2>&1 || { compose logs --tail 30; fail "could not start the test stack"; }

api() { # api <METHOD> <path> [json] — uses $TOKEN
  curl -sS -X "$1" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' ${3:+--data "$3"} "$BASE/api$2"
}
login() { curl -sS -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
  --data "{\"email\":\"admin@windmill.dev\",\"password\":\"$1\"}" "$BASE/api/auth/login"; }

echo "== First run"
node "$WM/setup.mjs" --base "$BASE" | tee "$WORK/first.out" || fail "first setup run exit $?"
# GNU stat first — on Linux `stat -f` is the filesystem status, which prints several lines and then the fallback value, so comparing it with 600 can never match
perm() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
[ -s "$WM/.admin-password" ] && [ "$(perm "$WM/.admin-password")" = 600 ] \
  && pass ".admin-password created with permissions 600" || fail "no .admin-password or its permissions are not 600"
NEWPW="$(cat "$WM/.admin-password")"
[ "${#NEWPW}" -ge 24 ] && pass "the new admin password is long enough" || fail "the admin password is too short"
CODE="$(login changeme)"
[ "$CODE" != 200 ] && [ "$CODE" != 000 ] && pass "the default password changeme no longer works (HTTP $CODE)" || fail "changeme still works, or the server did not answer (HTTP $CODE)"
[ "$(login "$NEWPW")" = 200 ] && pass "login with the new password works" || fail "login with the new password failed"
TOKEN="$(curl -sS -H 'content-type: application/json' --data "{\"email\":\"admin@windmill.dev\",\"password\":\"$NEWPW\"}" "$BASE/api/auth/login")"
WHO="$(api GET /w/admins/users/whoami | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).username)')"

api GET /configs/get/worker__custom | node -e '
  const c = JSON.parse(require("fs").readFileSync(0)); if (JSON.stringify(c?.worker_tags) !== JSON.stringify(["chromium"])) process.exit(1)
' && pass "worker group custom listens on the tag chromium" || fail "the worker__custom config is wrong"

for name in pms_export_daily pms_export_daily_catchup foodstory_export_daily foodstory_export_daily_catchup; do
  api GET "/w/admins/scripts/get/p/u/$WHO/$name" >"$WORK/$name.json"
  node -e '
    const [file, json] = process.argv.slice(1); const fs = require("fs");
    const s = JSON.parse(fs.readFileSync(json)); const want = fs.readFileSync(file, "utf8");
    if (s.content !== want || s.language !== "bash" || s.tag !== "chromium") process.exit(1);
  ' "$SRC/scripts/$name.sh" "$WORK/$name.json" && pass "script u/$WHO/$name: content matches the file in the repo, bash, tag chromium" || fail "script $name is wrong"
done
# exporter-foodstory-scheduled-daily ticket 04: the FoodStory job's time cap is set on the script itself (not relying on Windmill's default) — Windmill must really store it
for name in foodstory_export_daily foodstory_export_daily_catchup; do
  node -e 'if (JSON.parse(require("fs").readFileSync(process.argv[1])).timeout !== 3600) process.exit(1)' "$WORK/$name.json" \
    && pass "script $name has a 3600-second time cap" || fail "script $name has no time cap (does Windmill not store the timeout?)"
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
  && pass "noon schedule (Asia/Bangkok) is enabled, permissioned_as the user who set it up" || fail "the noon schedule is wrong"
check_schedule "u/$WHO/pms_export_daily_catchup" "0 0 15,18 * * *" "u/$WHO/pms_export_daily_catchup" \
  && pass "catch-up schedule 15:00/18:00 is enabled" || fail "the catch-up schedule is wrong"
check_schedule "u/$WHO/foodstory_export_daily" "0 0 12 * * *" "u/$WHO/foodstory_export_daily" \
  && pass "FoodStory: noon schedule (Asia/Bangkok) is enabled" || fail "FoodStory: the noon schedule is wrong"
check_schedule "u/$WHO/foodstory_export_daily_catchup" "0 0 15,18 * * *" "u/$WHO/foodstory_export_daily_catchup" \
  && pass "FoodStory: catch-up schedule 15:00/18:00 is enabled" || fail "FoodStory: the catch-up schedule is wrong"
HASH1="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).hash)' "$WORK/pms_export_daily.json")"

echo "== Re-run: nothing may change"
node "$WM/setup.mjs" --base "$BASE" | tee "$WORK/second.out" || fail "second setup run exit $?"
[ "$(cat "$WM/.admin-password")" = "$NEWPW" ] && pass "the admin password is unchanged" || fail "the re-run changed the admin password"
HASH2="$(api GET /w/admins/scripts/get/p/u/$WHO/pms_export_daily | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).hash)')"
[ "$HASH1" = "$HASH2" ] && pass "no new script version is created" || fail "the re-run created a new script version"
grep -q "Changed [0-9]" "$WORK/second.out" && ! grep -q "Nothing changed" "$WORK/second.out" && fail "the re-run reports that something changed" || true
grep -q "Nothing changed" "$WORK/second.out" && pass "reports that nothing changed" || fail "the re-run does not say that nothing changed"

echo "== Edit a script in the repo and run again: it must get a new version (update the machine with git pull + re-run)"
printf '\n# changed\n' >>"$WM/scripts/pms_export_daily.sh"
node "$WM/setup.mjs" --base "$BASE" >/dev/null || fail "third setup run exit $?"
api GET /w/admins/scripts/get/p/u/$WHO/pms_export_daily | node -e '
  const s = JSON.parse(require("fs").readFileSync(0)); if (!s.content.endsWith("# changed\n")) process.exit(1)
' && pass "the script edited in the repo is deployed as a new version" || fail "no new version was deployed"

echo "== Self-repair: a schedule was disabled + the administrator added another tag to the worker -> a re-run must re-enable the schedule and not remove the added tag"
api POST "/w/admins/schedules/setenabled/u/$WHO/pms_export_daily" '{"enabled":false}' >/dev/null
api POST /configs/update/worker__custom '{"worker_tags":["chromium","extra-tag"]}' >/dev/null
node "$WM/setup.mjs" --base "$BASE" >/dev/null || fail "repair setup run exit $?"
api GET "/w/admins/schedules/get/u/$WHO/pms_export_daily" | node -e 'if (JSON.parse(require("fs").readFileSync(0)).enabled !== true) process.exit(1)' \
  && pass "the disabled schedule was re-enabled" || fail "the schedule is still disabled"
api GET /configs/get/worker__custom | node -e '
  const t = JSON.parse(require("fs").readFileSync(0)).worker_tags; if (!(t.includes("chromium") && t.includes("extra-tag"))) process.exit(1)
' && pass "the tag the administrator added is still there" || fail "the added tag is gone"

echo "== Data pipeline jobs: registered only when pipeline/.env exists (this check once let an invalid weekly cron through)"
[ ! -e "$WORK/pipeline/.env" ] || fail "the fixture unexpectedly has a pipeline/.env already"
api GET "/w/admins/schedules/exists/u/$WHO/ht_pipeline_daily" | grep -qx false \
  && pass "no pipeline job exists while pipeline/.env is missing" || fail "pipeline jobs exist without pipeline/.env"
mkdir -p "$WORK/pipeline" && echo "HT_D1_DATABASE=dummy" >"$WORK/pipeline/.env"
node "$WM/setup.mjs" --base "$BASE" | tee "$WORK/pipeline.out" || fail "setup run with pipeline/.env exit $?"
check_pipeline_schedule() { # <name> <cron>
  api GET "/w/admins/schedules/get/u/$WHO/$1" | node -e '
    const [cron, who] = process.argv.slice(1); const s = JSON.parse(require("fs").readFileSync(0));
    const ok = s.schedule === cron && s.timezone === "Asia/Bangkok" && s.script_path === "u/" + who + "/" + s.path.split("/").pop() && s.enabled === true && s.permissioned_as === "u/" + who;
    if (!ok) { console.error(JSON.stringify(s)); process.exit(1); }
  ' "$2" "$WHO"
}
check_pipeline_schedule ht_pipeline_daily "0 0 19 * * *" \
  && pass "ht_pipeline_daily: 19:00 schedule is enabled" || fail "the ht_pipeline_daily schedule is wrong or missing"
check_pipeline_schedule ht_pipeline_weekly_verify "0 0 20 * * SUN" \
  && pass "ht_pipeline_weekly_verify: Sunday 20:00 schedule is accepted by Windmill and enabled" || fail "the ht_pipeline_weekly_verify schedule is wrong or missing"
node "$WM/setup.mjs" --base "$BASE" | tee "$WORK/pipeline-second.out" || fail "second setup run with pipeline/.env exit $?"
grep -q "Nothing changed" "$WORK/pipeline-second.out" && pass "the re-run with the pipeline jobs reports that nothing changed" || fail "the re-run with the pipeline jobs is not idempotent"

echo "ALL PASSED"
