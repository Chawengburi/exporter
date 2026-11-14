#!/bin/bash
# Install the exporter on Ubuntu Desktop with a single command (ticket 04 of exporter-ubuntu-deploy)
#
#   cd <the folder where Chawengburi/exporter was cloned>
#   bash deploy/ubuntu/install.sh                      <- run in the account of the person who will use the machine, without sudo (the script asks for sudo itself when needed)
#
#   --skip-windmill    do not start Windmill (Docker)
#   --no-login-check   do not try a HotelTime login at the end
#
# Safe to re-run: values already in .env are not touched (edit them yourself with nano) — it only fills in the go-live date / Discord URLs if missing (ticket 10) · does not delete a complete node_modules (Windmill mounts this folder —
# deleting it during the noon run would break that run) · does not call apt again if Chromium already starts · does not install Node.js/Docker — the administrator
# installs those (agreed 2026-10-12); the script only checks and explains how.
set -euo pipefail

SKIP_WINDMILL=0
LOGIN_CHECK=1
for arg in "$@"; do
  case "$arg" in
    --skip-windmill) SKIP_WINDMILL=1 ;;
    --no-login-check) LOGIN_CHECK=0 ;;
    *) echo "✘ Unknown option: $arg" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXPORTER="$ROOT/exporter"
WINDMILL="$ROOT/windmill"
STEP=0
PENDING=() # things the administrator still has to do — repeated in the summary at the end so they do not get lost in the output
# temporary file used while writing .env contains passwords and .gitignore does not cover the name .env.XXXXXX — it must always be removed if we stop midway
TMP_ENV=""
trap '[ -z "$TMP_ENV" ] || rm -f "$TMP_ENV"' EXIT

step() { STEP=$((STEP + 1)); echo; echo "── $STEP. $1"; }
ok() { echo "   ✔ $1"; }
warn() { echo "   ⚠ $1"; }
stop() {
  echo "   ✘ $1" >&2
  [ -n "${2:-}" ] && echo "     $2" >&2
  # things noted before stopping (e.g. Docker) must not be lost when stopping midway
  if [ "${#PENDING[@]}" -gt 0 ]; then
    echo "     and still to do:" >&2
    for item in "${PENDING[@]}"; do echo "     - $item" >&2; done
  fi
  echo "     Fix it and re-run the same command — steps already done will not be repeated" >&2
  exit 1
}

echo "════════════════════════════════════════════════════════"
echo "  Installing the exporter (HotelTime + FoodStory) on Ubuntu"
echo "════════════════════════════════════════════════════════"

# sudo sets HOME to /root — the icon/browser/files would end up in the root account instead of the account actually used
[ "$(id -u)" -ne 0 ] || stop "Do not run this with sudo/root" "Run: bash deploy/ubuntu/install.sh in the account of the person who will use the machine (the script asks for the sudo password itself when needed)"
[ -f "$EXPORTER/package.json" ] && [ -f "$WINDMILL/docker-compose.yml" ] \
  || stop "The exporter/ or windmill/ folder next to deploy/ was not found" "Run it from the folder where the whole Chawengburi/exporter repo was cloned"
[ "$(uname -s)" = Linux ] || stop "This script is for Ubuntu only" "For macOS see exporter/README.md"
grep -qi ubuntu /etc/os-release 2>/dev/null || warn "Not Ubuntu — continuing, but it has only been tested on Ubuntu 24.04"

# ── 1. Node.js ──
step "Checking Node.js (22.18 or newer required)"
command -v node >/dev/null 2>&1 \
  || stop "Node.js not found" "Install Node.js 22 first (e.g. NodeSource or nvm — the apt version in Ubuntu itself is too old), then open a new Terminal"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || stop "Node.js $(node --version) is too old, 22.18 or newer is required" "Update Node.js and run again"
ok "Node.js $(node --version) ($(command -v node))"

# ── 2. package ──
step "Installing the exporter packages"
# npm ci deletes node_modules every time — if the install is complete (the internal lockfile is newer than package-lock.json) do not repeat it
if [ -f "$EXPORTER/node_modules/.package-lock.json" ] && [ "$EXPORTER/node_modules/.package-lock.json" -nt "$EXPORTER/package-lock.json" ]; then
  ok "Already installed, not installing again"
else
  (cd "$EXPORTER" && npm ci --no-audit --no-fund --loglevel=error) || stop "Installing the packages failed" "Check the internet connection and run again"
  ok "node_modules ready"
fi

# ── 3. Browser ──
step "Installing the Chromium browser"
(cd "$EXPORTER" && npx --no-install playwright install chromium) || stop "Downloading Chromium failed" "Check the internet connection and run again"
chromium_starts() { (cd "$EXPORTER" && node --input-type=module -e "import { chromium } from 'playwright'; await (await chromium.launch()).close();") >/dev/null 2>&1; }
if chromium_starts; then
  ok "Chromium ready"
else
  # system libraries are incomplete — apt (sudo) is needed once per machine
  sudo -n true 2>/dev/null || sudo -v 2>/dev/null \
    || stop "This account cannot use sudo, but Chromium is missing system libraries" \
      "Ask the administrator to run this once: cd $EXPORTER && sudo npx --no-install playwright install-deps chromium, then run this command again"
  echo "   Installing the system libraries for Chromium (once per machine — uses sudo)"
  (cd "$EXPORTER" && sudo npx --no-install playwright install-deps chromium) || stop "Installing the Chromium libraries failed" "Check the internet connection and run again"
  chromium_starts || stop "Installed, but Chromium still cannot start" "Take a screenshot of this screen and send it to the administrator"
  ok "Chromium ready"
fi

# ── helper for writing secret files: write to a temporary 600 file first, then move it into place (the real file is never readable by others or left half-written) ──
write_secret_file() { # write_secret_file <destination> — reads the content from stdin
  TMP_ENV="$(mktemp "$1.XXXXXX")"
  chmod 600 "$TMP_ENV"
  cat >"$TMP_ENV"
  mv "$TMP_ENV" "$1"
  TMP_ENV=""
}
keep_private() { # an existing .env (may have been created by another account) — force 600 if possible
  chmod 600 "$1" 2>/dev/null || warn "Could not make $1 readable by the owner only (is the file owned by another account?) — ask the administrator to run: sudo chown $USER $1"
}

# ── 4. exporter/.env ──
step "Setting the passwords (exporter/.env)"
# values are quoted so dotenv reads them literally: '...' converts nothing · a ' in the value -> "..." (if there is no " and no \) · otherwise edit the file by hand
quote_env() {
  case "$1" in
    *$'\n'*) return 1 ;;
    *"'"*) case "$1" in *'"'* | *'\'*) return 1 ;; esac; printf '"%s"' "$1" ;;
    *) printf "'%s'" "$1" ;;
  esac
}
ask() { # ask <variable> <prompt> [secret|default] — IFS= keeps leading/trailing spaces of passwords from being trimmed
  local value="" mode="${3:-}"
  if [ "$mode" = secret ]; then
    IFS= read -r -s -p "   $2: " value || true; echo
  elif [ -n "$mode" ]; then
    IFS= read -r -p "   $2 [Enter = $mode]: " value || true
    [ -n "$value" ] || value="$mode"
  else
    IFS= read -r -p "   $2: " value || true
  fi
  [ -n "$value" ] || stop "No value was entered for $2"
  quote_env "$value" >/dev/null || stop "$2 contains characters that cannot be filled in automatically (both ' and \" or \\)" "Edit it yourself with: nano exporter/.env (created from .env.example)"
  printf -v "$1" '%s' "$value"
}
if [ -e "$EXPORTER/.env" ]; then
  ok "Already exists, not touching it — you can edit it yourself with: nano exporter/.env"
else
  DEFAULT_BRANCH="$(sed -n 's/^FOODSTORY_BRANCH_NAME=//p' "$EXPORTER/.env.example" | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
  echo "   Fill in one field at a time (passwords are not shown on screen while you type):"
  ask HT_USER "HotelTime username"
  ask HT_PASS "HotelTime password" secret
  ask FS_EMAIL "FoodStory email"
  ask FS_PASS "FoodStory password" secret
  ask FS_BRANCH "FoodStory branch name (as shown on the website)" "$DEFAULT_BRANCH"
  # pass the values to awk through the environment, not as arguments (process arguments are visible to other accounts via ps)
  HOTELTIME_USERNAME="$(quote_env "$HT_USER")" HOTELTIME_PASSWORD="$(quote_env "$HT_PASS")" \
    FOODSTORY_EMAIL="$(quote_env "$FS_EMAIL")" FOODSTORY_PASSWORD="$(quote_env "$FS_PASS")" \
    FOODSTORY_BRANCH_NAME="$(quote_env "$FS_BRANCH")" \
    awk -F= '
      BEGIN { split("HOTELTIME_USERNAME HOTELTIME_PASSWORD FOODSTORY_EMAIL FOODSTORY_PASSWORD FOODSTORY_BRANCH_NAME", keys, " ")
              for (i in keys) want[keys[i]] = 1 }
      /^[A-Z_]+=/ && ($1 in want) { print $1 "=" ENVIRON[$1]; seen[$1] = 1; next }
      { print }
      END { for (k in want) if (!(k in seen)) { print "Not found: " k " in .env.example" > "/dev/stderr"; exit 1 } }
    ' "$EXPORTER/.env.example" | write_secret_file "$EXPORTER/.env" \
    || stop "Writing exporter/.env failed" "Check that exporter/.env.example is readable and has every field"
  ok "Wrote exporter/.env (readable by this account only)"
fi
keep_private "$EXPORTER/.env"

# ── 4b. Go-live date + Discord (ticket 10 of exporter-daily-per-day-raw) — only fills in what is missing, never overwrites existing values (machines installed earlier can re-run it) ──
step "Setting the go-live date and Discord alerts (exporter/.env)"
env_has() { grep -qE "^$1=.+" "$EXPORTER/.env"; }
env_key() { grep -qE "^$1=" "$EXPORTER/.env"; } # the line for this key exists (an empty value counts — it was left blank on purpose)
append_env() { # append_env <line> — printf is a builtin (the value does not show up in ps) · if the file does not end with a newline, add one first, otherwise it would be appended to the last line
  [ -w "$EXPORTER/.env" ] || stop "Cannot write exporter/.env (is the file owned by another account?)" "Ask the administrator to run: sudo chown $USER $EXPORTER/.env and run again"
  [ -z "$(tail -c1 "$EXPORTER/.env")" ] || printf '\n' >>"$EXPORTER/.env"
  printf '%s\n' "$1" >>"$EXPORTER/.env"
}
if env_key EXPORTER_GO_LIVE; then
  GO_LIVE="$(sed -n 's/^EXPORTER_GO_LIVE=//p' "$EXPORTER/.env" | tail -1)"
  if [ -n "$GO_LIVE" ]; then ok "Go-live date $GO_LIVE (already set, not touching it)"
  else warn "EXPORTER_GO_LIVE is empty (left blank on purpose?), not touching it — the system pulls only yesterday and does not back-fill missing days"; fi
else
  GO_LIVE="$(TZ=Asia/Bangkok date +%F)"
  append_env "EXPORTER_GO_LIVE=$GO_LIVE"
  ok "Set the go-live date to today, $GO_LIVE — from today on, any missing day is back-filled automatically (change it with EXPORTER_GO_LIVE in exporter/.env)"
fi
# ask_optional_secret <KEY> <regex> <prompt> <already set> <skipped> <saved> <invalid> <still to do> — an optional secret (webhook URL,
# 2captcha key): asked only when it is missing, never overwrites an existing value · not shown while typing and not echoed back · the value goes only through builtins/stdin (never in argv, so not in ps) ·
# empty/invalid = not saved, and how to do it later is noted in the summary at the end (code review of ticket 04 of exporter-foodstory-scheduled-daily: it used to be written out once per secret)
ask_optional_secret() {
  local key="$1" pattern="$2" prompt="$3" have="$4" skipped="$5" saved="$6" invalid="$7" todo="$8"
  if env_has "$key"; then
    ok "$have"
    return
  fi
  local value=""
  IFS= read -r -s -p "   $prompt (paste it and press Enter — not shown on screen · just press Enter = skip for now): " value || true
  echo
  value="$(printf '%s' "$value" | tr -d '[:space:]')"
  if [ -z "$value" ]; then
    warn "$skipped"
    PENDING+=("$todo")
  elif printf '%s' "$value" | grep -qE "$pattern"; then
    append_env "$key=$value"
    ok "$saved"
  else
    warn "$invalid"
    PENDING+=("$todo")
  fi
}
# the system owner asked on 2026-10-18 to separate the Discord channels of the export leg and the upload leg — asked one at a time, separate variables · a webhook URL is a secret (anyone who has it can post to the channel)
ask_webhook() { # ask_webhook <ENV_KEY> <leg label>
  ask_optional_secret "$1" '^https://((ptb|canary)\.)?(discord|discordapp)\.com/api/(v[0-9]+/)?webhooks/[0-9]+/[A-Za-z0-9_-]+$' \
    "Discord webhook URL for the $2 leg" \
    "The Discord webhook URL for the $2 leg is already set, not touching it" \
    "Skipped for now — there are no Discord alerts for the $2 leg yet" \
    "Saved the Discord webhook URL for the $2 leg (not shown on screen)" \
    "Not a Discord webhook URL (it must start with https://discord.com/api/webhooks/) — not saved" \
    "Set up Discord alerts for the $2 leg: nano exporter/.env and add the line $1=<webhook URL>"
}
ask_webhook DISCORD_WEBHOOK_URL_EXPORT "export"
ask_webhook DISCORD_WEBHOOK_URL_UPLOAD "upload"
# ── 4c. 2captcha key (ADR-0010 · ticket 04 of exporter-foodstory-scheduled-daily) — with a key, the FoodStory login solves the reCAPTCHA itself, so it can run on a schedule
# on Windmill · a secret + a paid service · a 2captcha key is 32 letters/digits (invalid format = not saved; it can always be added by hand with nano)
ask_optional_secret TWOCAPTCHA_API_KEY '^[A-Za-z0-9]{32}$' \
  "2captcha key so FoodStory can solve the reCAPTCHA itself" \
  "The 2captcha key is already set, not touching it — FoodStory runs by itself every day on Windmill" \
  "Skipped for now — the scheduled FoodStory run on Windmill will fail immediately (Discord is told the key is missing) until a key is added · the FoodStory icon on the Desktop still works" \
  "Saved the 2captcha key (not shown on screen) — FoodStory runs by itself every day on Windmill" \
  "The 2captcha key must be 32 letters/digits (see the Dashboard on 2captcha.com) — not saved" \
  "Add the 2captcha key so FoodStory runs on a schedule: nano exporter/.env and add the line TWOCAPTCHA_API_KEY=<key from 2captcha.com>"
# ── 4d. uploader account (the upload leg `exporter upload`) — all three values are required, there is no default in the code · asked only when none exist, never overwrites existing values ·
# some set and some missing = do not guess, do not touch, report it in what is still to do · an empty email = skip everything · the password is not shown on screen and is quoted so dotenv reads it literally
ask_uploader() {
  local todo="Set up the upload leg: nano exporter/.env and add UPLOADER_URL=https://uploader.chawengbot.cloud · UPLOADER_EMAIL=<email> · UPLOADER_PASSWORD=<password> (see docs/UPLOAD-SETUP-UBUNTU.md)"
  local have=0 k
  for k in UPLOADER_URL UPLOADER_EMAIL UPLOADER_PASSWORD; do env_has "$k" && have=$((have + 1)); done
  if [ "$have" -eq 3 ]; then ok "The uploader account is complete, not touching it"; return; fi
  if [ "$have" -gt 0 ]; then
    warn "The uploader settings are incomplete ($have of 3) — not touching them, not guessing"
    PENDING+=("$todo")
    return
  fi
  local url="" email="" pass=""
  IFS= read -r -p "   Uploader URL [Enter = https://uploader.chawengbot.cloud]: " url || true
  [ -n "$url" ] || url="https://uploader.chawengbot.cloud"
  IFS= read -r -p "   Email of this machine's uploader account (just press Enter = skip for now): " email || true
  email="$(printf '%s' "$email" | tr -d '[:space:]')"
  if [ -z "$email" ]; then
    warn "Skipped for now — uploading to the uploader is not possible until the account is set up"
    PENDING+=("$todo")
    return
  fi
  IFS= read -r -s -p "   Uploader account password (not shown on screen): " pass || true
  echo
  local quoted_pass
  if ! printf '%s' "$url" | grep -qE '^https?://[^[:space:]]+$'; then
    warn "The uploader URL is not in the form https://... — not saved"; PENDING+=("$todo")
  elif ! printf '%s' "$email" | grep -qE '^[^@]+@[^@]+$'; then
    warn "The uploader email is not in email format — not saved"; PENDING+=("$todo")
  elif [ -z "$pass" ]; then
    warn "No uploader password was entered — not saved"; PENDING+=("$todo")
  elif ! quoted_pass="$(quote_env "$pass")"; then
    warn "The uploader password contains characters that cannot be filled in automatically (both ' and \" or \\) — not saved"; PENDING+=("$todo")
  else
    append_env "UPLOADER_URL=$url"
    append_env "UPLOADER_EMAIL=$email"
    append_env "UPLOADER_PASSWORD=$quoted_pass"
    ok "Saved the uploader account (the password is not shown on screen)"
  fi
}
ask_uploader
keep_private "$EXPORTER/.env"

# ── 5. windmill/.env ──
step "Setting up Windmill (windmill/.env)"
if [ -e "$WINDMILL/.env" ]; then
  ok "Already exists, not touching it"
else
  PG_PASS="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" # a fresh random Postgres password (hex) — not the example's changeme
  sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG_PASS|" \
    -e "s|^DATABASE_URL=postgres://postgres:[^@]*@|DATABASE_URL=postgres://postgres:$PG_PASS@|" \
    "$WINDMILL/.env.example" | write_secret_file "$WINDMILL/.env" || stop "Writing windmill/.env failed"
  grep -q "^POSTGRES_PASSWORD=$PG_PASS$" "$WINDMILL/.env" && grep -q "^DATABASE_URL=postgres://postgres:$PG_PASS@" "$WINDMILL/.env" \
    || { rm -f "$WINDMILL/.env"; stop "The format of windmill/.env.example is not what the script expects" "Take a screenshot of this screen and send it to the administrator"; }
  ok "Wrote windmill/.env (a new random database password)"
fi
keep_private "$WINDMILL/.env"

# ── 6. Data folder + icon ──
step "Preparing the file folder and placing the FoodStory icon on the Desktop"
mkdir -p "$EXPORTER/data"
ok "Pulled files will be in exporter/data/"
# Mount points of the data pipeline (docker-compose.yml): must exist on the host before `docker compose up`, otherwise docker creates them empty and owned by root.
# They stay empty until the pipeline bundle is installed with install.py from the hoteltime-schema repo.
mkdir -p "$ROOT/pipeline" "$ROOT/pipeline-state"
bash "$EXPORTER/launchers/install-desktop-launcher.sh" | sed 's/^/   /' || stop "Placing the icon failed (see the messages above)"

# ── 7. Windmill ──
step "Starting Windmill (the scheduler that runs HotelTime and FoodStory every day)"
WINDMILL_UP=0
if [ "$SKIP_WINDMILL" = 1 ]; then
  warn "Skipped as requested (--skip-windmill)"
  PENDING+=("Start Windmill: run this command again without --skip-windmill")
elif ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  warn "Docker (with docker compose) is not installed yet"
  PENDING+=("Install Docker Engine + docker compose following the Docker guide for Ubuntu, then run this command again")
elif DOCKER_ERR="$(docker info 2>&1 >/dev/null)"; then
  # the first time, building the worker that includes Chromium can take several minutes
  (cd "$WINDMILL" && docker compose up -d) || stop "Starting Windmill failed" "See the cause: cd windmill && docker compose logs"
  WINDMILL_UP=1
  ok "Windmill is up at http://localhost:8000"
  # set the admin password / chromium tag / scripts / schedules through the API instead of clicking through the web UI (ticket 03) — safe to re-run, nothing changed = nothing touched
  # failure = note it in what is still to do and carry on with the other steps (trying the HotelTime login is still useful)
  node "$WINDMILL/setup.mjs" | sed 's/^/   /' \
    || PENDING+=("Setting up Windmill failed (see the messages above) — fix it and run: node windmill/setup.mjs or run this command again")
elif printf '%s' "$DOCKER_ERR" | grep -qi "permission denied"; then
  warn "This account does not have permission to use Docker yet"
  PENDING+=("Grant Docker permission: sudo usermod -aG docker $USER, then log out and in again, then run this command again")
else
  warn "Docker is not running"
  PENDING+=("Start Docker: sudo systemctl enable --now docker, then run this command again")
fi

# ── 8. Try a HotelTime login ──
step "Trying a HotelTime login (nothing to click)"
if [ "$LOGIN_CHECK" = 0 ]; then
  warn "Skipped as requested (--no-login-check)"
  PENDING+=("Try the HotelTime login: cd exporter && node src/index.ts login --site hoteltime --check")
elif (cd "$EXPORTER" && node src/index.ts login --site hoteltime --check); then
  ok "HotelTime login works"
else
  stop "HotelTime login failed" "Check the username/password in exporter/.env (nano exporter/.env) and run again"
fi

echo
echo "════════════════════════════════════════════════════════"
if [ "${#PENDING[@]}" -eq 0 ]; then
  echo "✅ Installation complete"
else
  echo "⚠️  The program part is installed — ${#PENDING[@]} more thing(s) still to do:"
  i=0
  for item in "${PENDING[@]}"; do i=$((i + 1)); echo "   $i. $item"; done
fi
echo
[ "$WINDMILL_UP" = 1 ] && echo "   • HotelTime + FoodStory: run by themselves every day at 12:00 (catch-up 15:00/18:00) — see the history at http://localhost:8000/runs · log in as admin@windmill.dev, the password is in windmill/.admin-password"
echo "   • FoodStory fallback: double-click the \"Exporter - FoodStory Daily\" icon on the Desktop when Discord says the automatic run failed (the first time you may need to right-click → Allow Launching)"
echo "   • Staff guide: docs/FOODSTORY-DAILY-STAFF-GUIDE.md"
echo "════════════════════════════════════════════════════════"
