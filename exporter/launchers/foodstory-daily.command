#!/bin/bash
# Double-click from the Desktop (macOS: Finder · Ubuntu: the .desktop icon) -> pulls all of "yesterday's" FoodStory reports (ticket 11, ADR-0006)
# and also fills in the days not yet pulled and takes today's snapshot reports in a single login (ticket 06 of exporter-daily-per-day-raw, ADR-0008/0009)
#
# The staff member solves the captcha once, the rest runs by itself to the end and then prints a summary · can be placed on the Desktop as an alias/symlink — the script follows the
# symlink back to the exporter folder itself, so it is not tied to any machine's path · guide: docs/FOODSTORY-DAILY-STAFF-GUIDE.md
#
# Does not rely on the Terminal's PATH: when opened from Finder, PATH may not have node (e.g. installed through nvm) — finds node >= 22.18 itself, in order
# · the final summary is read from the `_run.json` of every folder this run wrote (only the reports this run ran), not by parsing what the exporter prints — after a re-run
#   where the folder is complete it says complete, even if this run failed some reports (the files that passed in the earlier run are still there) · nothing outstanding = the exporter ends with 0 without logging in and without writing `_run.json`
set -u

pause_and_exit() {
  echo
  printf '%s' "Press any key to close this window ..." # not read -p — bash shows the prompt only when stdin is a terminal
  read -r -n 1 -s || true
  echo
  exit "$1"
}

stop_with() {
  echo
  echo "❌ $1"
  [ -n "${2:-}" ] && echo "   $2"
  echo "   Take a screenshot of this screen and send it to the administrator"
  pause_and_exit 1
}

# ── find the exporter folder: follow the symlink (e.g. the file on the Desktop) back to the real one in <exporter>/launchers/ ──
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

# ── find node >= 22.18 (the exporter runs .ts directly, which needs the type stripping of this node version or newer) ──
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
# macOS: Homebrew (/opt/homebrew, /usr/local) · Ubuntu: apt/NodeSource (/usr/bin) or unpacked by hand in ~/.local/node (no sudo needed) · both: the nvm default below
for candidate in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$HOME/.local/node/bin/node"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && node_ok "$candidate"; then NODE="$candidate"; break; fi
done
if [ -z "$NODE" ]; then
  candidate="$(nvm_default_node)" # load nvm only when nothing else is found — it is slow
  if [ -n "$candidate" ] && [ -x "$candidate" ] && node_ok "$candidate"; then NODE="$candidate"; fi
fi

echo "════════════════════════════════════════════════════════"
echo "  Pulling FoodStory reports (yesterday + missing days + snapshot reports)"
echo "════════════════════════════════════════════════════════"

[ -n "$NODE" ] || stop_with "Node.js (version 22.18 or newer) was not found on this machine" \
  "Administrator: install Node.js and try again (see the guide, first-time installation)"
[ -e "$EXPORTER_DIR/.env" ] || stop_with "The .env settings file was not found in the folder $EXPORTER_DIR" \
  "Administrator: create it from .env.example and fill in the FoodStory email/password"
[ -d "$EXPORTER_DIR/node_modules" ] || stop_with "The program is not fully installed (there is no node_modules folder)" \
  "Administrator: run npm install in the folder $EXPORTER_DIR"
mkdir -p "$STORE" || stop_with "Could not create the file folder $STORE"

# ── a lock per exporter folder: double-clicking again while the previous run is still going = two browser windows, two captchas, fighting over the same folder ──
# the lock stores a pid — if that process is dead (e.g. the window was closed midway) the lock is stale and can be taken over
LOCK="$STORE/.daily-launcher.pid"
take_lock() { ( set -o noclobber; echo "$$" >"$LOCK" ) 2>/dev/null; }
# remove only this run's lock — an old window that was just closed must not remove the lock of a new run that has already taken it
release_lock() { [ "$(cat "$LOCK" 2>/dev/null)" = "$$" ] && rm -f "$LOCK"; return 0; }
if ! take_lock; then
  OTHER="$(cat "$LOCK" 2>/dev/null)"
  if [ -n "$OTHER" ] && kill -0 "$OTHER" 2>/dev/null; then
    echo
    echo "⏳ A FoodStory pull is already running in another window — wait for that window to finish, then open this again if needed"
    pause_and_exit 1
  fi
  rm -f "$LOCK"
  take_lock || stop_with "Could not take the run lock ($LOCK)"
fi
# start time — used to find the `_run.json` files this run wrote · the template must contain XXXXXX itself: GNU mktemp (Ubuntu) rejects macOS-style `-t name`
MARK="$(mktemp "${TMPDIR:-/tmp}/foodstory-daily.XXXXXX")" || stop_with "Could not create a temporary file"
trap 'release_lock; rm -f "$MARK"' EXIT

echo
echo "  1. A browser window will open (the email and password are already filled in)"
echo "  2. Tick the \"I'm not a robot\" box, do what it asks until it passes, then press the login button — within 5 minutes"
echo "  3. Then leave it alone — do not click anything in the browser — until this window shows a summary (about 5-10 minutes per day to pull)"
echo "     If the reports are already complete, no browser window opens and there is nothing to click"
echo

cd "$EXPORTER_DIR" || stop_with "Could not enter the folder $EXPORTER_DIR"
"$NODE" src/index.ts export --site foodstory --report all --daily --headful
EXPORT_RC=$?
# release the lock as soon as the pull finishes — a window left waiting at "Press any key" overnight must not make tomorrow's run say "already running" (tried for real 2026-10-12)
release_lock

# ── summary from the latest per-report status in the `_run.json` of every folder this run wrote (several days back-filled + today's snapshots — ticket 06) · counts only the reports this run ran
#    (the folder's last run entry; no run entry = every report) · passed = ok, or failed this time but the file that passed in an earlier run is still there (previousOk) ──
SUMMARY="$(find "$STORE/daily" -name _run.json -newer "$MARK" 2>/dev/null | sort | xargs "$NODE" -e '
  const fs = require("fs");
  // the Thai-time day of the run start time — per-day reports are never pulled on their own data day, so the folder whose day equals the run start day is the folder of the snapshot reports
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
      passed++; // the days/snapshots shown on screen = only what was really obtained (a day that failed entirely is not shown as "got data")
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
# what was obtained (only what was really obtained) — in every case where this run wrote at least one folder (all passed / partial / all failed = this line is not shown)
what_was_fetched() {
  [ -n "$DAYS" ] && echo "   Per-day reports: data for $DAYS"
  if [ "$PICTURES" -gt 0 ] || [ "$CLOSES" -gt 0 ]; then
    line="   Snapshot reports: took $PICTURES report(s)"
    [ "$CLOSES" -gt 0 ] && line="$line · period-close snapshots $CLOSES report(s)"
    echo "$line"
  fi
  return 0
}

echo
echo "════════════════════════════════════════════════════════"
if [ "$TOTAL" -eq 0 ] && [ "$EXPORT_RC" -eq 0 ]; then
  RESULT=0
  echo "✅ Nothing outstanding — the reports were already complete from an earlier run, no captcha needed"
  echo "   You can close this window"
elif [ "$TOTAL" -gt 0 ] && [ "$PASSED" -eq "$TOTAL" ]; then
  RESULT=0
  echo "✅ Done — got all $PASSED/$TOTAL reports"
  what_was_fetched
  echo "   Nothing more to do, you can close this window"
elif [ "$PASSED" -gt 0 ]; then
  RESULT=2
  echo "⚠️  Partial — got $PASSED of $TOTAL reports · $((TOTAL - PASSED)) reports failed"
  what_was_fetched
  echo "   1. Double-click the same file again and solve the captcha again — reports already obtained are not lost"
  echo "   2. If the second run still shows this message, take a screenshot of this screen and send it to the administrator"
elif [ "$TOTAL" -gt 0 ]; then
  RESULT=1
  echo "❌ Failed — logged in, but not a single report was obtained"
  what_was_fetched
  echo "   Take a screenshot of this screen and send it to the administrator"
else
  RESULT=1
  echo "❌ Failed — no reports were obtained yet"
  echo "   Common causes: the captcha/login was not completed within 5 minutes, or the internet dropped"
  echo "   1. Double-click the same file again"
  echo "   2. If it still does not work, take a screenshot of this screen and send it to the administrator"
fi
[ -n "$WARNINGS" ] && printf '%s\n' "$WARNINGS" | sed 's/^/⚠️  /'
echo "════════════════════════════════════════════════════════"
pause_and_exit "$RESULT"
