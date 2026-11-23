# Scripts Usage Guide

This guide describes every script shipped with the exporter system, the tags and options each one accepts, and how to use them. It is organised into separate parts, one per script family:

| Part | Scope |
|---|---|
| [1. Terminology](#1-terminology) | What "tag" means in this system |
| [2. Windmill tag](#2-windmill-tag) | The worker tag `chromium` |
| [3. `exporter` CLI](#3-exporter-cli) | Commands, options and report identifiers |
| [4. Windmill job scripts](#4-windmill-job-scripts) | Scheduled `.sh` scripts and their schedules |
| [5. `windmill/setup.mjs`](#5-windmillsetupmjs) | Windmill provisioning script |
| [6. `deploy/ubuntu/install.sh`](#6-deployubuntuinstallsh) | Ubuntu installer |
| [7. Desktop launchers](#7-desktop-launchers) | Operator-facing FoodStory launcher |
| [8. Recon scripts](#8-recon-scripts) | Standalone investigation scripts |
| [9. Environment variables](#9-environment-variables) | Settings that change script behaviour |

All paths are relative to the repository root (`exporter-system/`) unless stated otherwise.

---

## 1. Terminology

The word "tag" is used in three distinct senses in this project:

| Sense | Meaning | Where it appears |
|---|---|---|
| **Windmill worker tag** | A routing label that decides which worker executes a job | [Part 2](#2-windmill-tag) |
| **Round** | A two-digit hour (`04`, `08`, `12`, `16`, `20`, `23`, Thai time) identifying a HotelTime extraction round (ADR-0014) | `--round`, `HOTELTIME_ROUNDS` |
| **Snapshot slot** | A two-digit hour (`06` or `23`) identifying an extra HotelTime snapshot round of the old schedule (`HOTELTIME_ROUNDS=off` only) | `--snapshot-slot`, `HOTELTIME_SNAPSHOT_SLOTS` |
| **Report identifier** | A string identifying one report (e.g. `arrivals`, `salebysumdate`) | `--report` |

Only the first is a "tag" in the strict sense. The other three are included because they are the selectors operators most often need.

---

## 2. Windmill tag

### Defined tags

There is exactly one tag in use:

| Tag | Purpose |
|---|---|
| `chromium` | Routes a job to the worker group `custom`, whose container provides Node.js, Playwright, Chromium and the mounted `exporter/` directory |

### How it is applied

1. **Worker side.** The worker group `custom` (Windmill worker group `worker__custom`) must be configured to listen on `chromium`. `windmill/setup.mjs` does this automatically and preserves any other tags an administrator added through the web UI.
2. **Script side.** Every Windmill script must be created with tag `chromium`. A script without this tag is picked up by a default worker, which has no browser and no `exporter/` mount, and will fail.

Both sides are applied to all scripts listed in [Part 4](#4-windmill-job-scripts) by `windmill/setup.mjs`. Manual configuration is only required if the setup script cannot be used; see `windmill/INSTALL.md`, section 4.

### Verification

Open `http://localhost:8000/workers?workspace=admins` and confirm that the group `custom` displays `Tags: chromium`.

---

## 3. `exporter` CLI

Location: `exporter/` (entry point `src/index.ts`). Requires Node.js 22.18 or newer. Run from the `exporter/` directory:

```bash
node src/index.ts <command> [options]
# or, after `npm link`:
exporter <command> [options]
```

### 3.1 Commands

| Command | Purpose |
|---|---|
| `login` | Verify that the credentials in `.env` can log in |
| `export` | Download reports and store the raw `.xlsx` files with a `_manifest.json` |
| `upload` | Send exported files to the uploader |
| `status` | One-page health summary, read from the local data store only |
| `notify` | Send pending alerts to Discord |
| `reports` | List every supported report |
| `sweep` | Read-only crawl of the site menu (reconnaissance) |
| `probe` | Read-only probe of HotelTime pages (reconnaissance) |
| `migrate-legacy` | Move legacy `downloads*/` folders into the `data/` store |

### 3.2 Common options

| Option | Applies to | Description |
|---|---|---|
| `--site <id>` | `login`, `export`, `upload`, `reports`, `sweep` | `hoteltime` (default) or `foodstory` |
| `--headful` | `login`, `export`, `sweep`, `probe` | Show the browser window |
| `--json` | most commands | Print the result as JSON |
| `--slow-mo <ms>` | `export` | Delay each browser action (use with `--headful`) |

### 3.3 `export`

```bash
node src/index.ts export --report <id|all> [mode options] [--site <id>]
```

`--report` (`-r`) is required.

| Option | Description |
|---|---|
| `--daily` | Daily round. Fetches yesterday (one file per data day), back-fills missing days since `EXPORTER_GO_LIVE`, and takes today's snapshot reports. Only incomplete work is repeated, so the command is safe to run several times a day |
| `--from <DD/MM/YYYY>` / `--to <DD/MM/YYYY>` | Explicit date range (defaults: `01/01/2024` to today) |
| `--last-days <n>` | Fetch the last *n* days including today. Cannot be combined with `--from`/`--to` |
| `--date <YYYY-MM-DD>` | HotelTime only. Re-fetch per-day reports for a single data day. Snapshot reports are not taken |
| `--baseline` | HotelTime only. Re-fetch per-day reports for previously fetched days into `baseline/<run date>/` |
| `--baseline-interval-days <n>` | Interval covered by a baseline round (default is defined in `core/order.ts`; not yet confirmed against real data) |
| `--round <04\|08\|12\|16\|20\|23>` | HotelTime only. One extraction round (ADR-0014); see [Rounds](#rounds) |
| `--snapshot-slot <06\|23>` | HotelTime only. Extra snapshot-only round of the old schedule; see [Snapshot slots](#snapshot-slots) |

**Mode compatibility**

| Mode | HotelTime | FoodStory |
|---|---|---|
| Date range (`--from`/`--to`) | ✔ | ✔ (monthly) |
| `--last-days` | ✔ | ✘ |
| `--daily` | ✔ | ✔ (cannot be combined with `--from`/`--to`) |
| `--date` | ✔ | ✘ |
| `--baseline` | ✔ | ✘ |
| `--round` | ✔ | ✘ |
| `--snapshot-slot` | ✔ | ✘ |

Incompatible combinations are rejected with an error message and exit code 1.

**Removed options.** `--format`, `--overlap-days` and `--retry-failed` are no longer supported and exit with an explanatory error.

**Examples**

```bash
# Daily round for HotelTime
node src/index.ts export --report all --daily

# Daily round for FoodStory (a captcha must be solved unless TWOCAPTCHA_API_KEY is set)
node src/index.ts export --site foodstory --report all --daily

# One HotelTime extraction round (hour = Thai time; exits at once, without login, if the round is off or its window has passed)
node src/index.ts export --report all --round 12

# One report, explicit range
node src/index.ts export --report arrivals --from 01/10/2026 --to 31/10/2026

# Re-fetch one data day for HotelTime
node src/index.ts export --report all --date 2026-10-15

# Watch the browser while debugging
node src/index.ts export --report postings --last-days 3 --headful --slow-mo 300
```

#### Rounds

From 2026-11-18 HotelTime is pulled in up to six **extraction rounds** a day (ADR-0014, replaces the daily run, the 15:00/18:00 catch-ups and the snapshot slots). Each round logs in **once** (one shared session; a lost session means one new login, then the task is retried) and, in that session:

- takes the snapshot reports,
- takes today's per-day reports (an incomplete copy, re-fetched every round),
- re-takes yesterday's per-day reports, **only in rounds 08 and 12**,
- fills any data day that has not succeeded yet (catch-up, capped at 3 days).

| Item | Behaviour |
|---|---|
| Hours | `04`, `08`, `12`, `16`, `20`, `23` (Asia/Bangkok). `04` exists but is not on by default |
| Switch | `HOTELTIME_ROUNDS` in `exporter/.env`: unset = `08,12,16,20,23`; a list = those rounds; `off` = no rounds, the old schedule runs |
| Off or late | A round that is not listed, or whose time window has passed, exits at once without logging in |
| Run ids in `_run.json` | `<report>@round-HH` (today's data / snapshot of that round), `<report>@redo-HH` (yesterday's re-take at 08/12), plain `<report>` (a catch-up day that succeeded) |
| Identical bytes | A re-fetch with the same bytes creates no new work; the existing entry and its `uploaded` flag are kept |
| Upload | Only the 12:00 round uploads: yesterday's per-day files and the 23:00 snapshot. Other snapshots are flagged `upload: skip` in `_manifest.json`; today's per-day files and the 23:00 snapshot are held until the next day |
| Login failure | Two fatal login failures in a row lock the rest of the round |
| `status` | "snapshot N/N" counts the 23:00 round |
| Discord | A daily summary is sent from rounds 12 and 23 only |

#### Look-ahead arrival report (`arrival-ahead`)

*Decided in ADR-0015. A **snapshot report** that reads the arrival page for today..+N days. Local only — never uploaded.*

| Item | Behaviour |
|---|---|
| Switch | `HOTELTIME_LOOKAHEAD_DAYS` in `exporter/.env`: **empty or unset = off** (the default, and what `.env.example` ships); a whole number `1`-`60` = N days ahead. Anything else (`0`, `61`, `abc`, `1.5`) is an error at start-up. `HOTELTIME_ROUNDS=off` also turns it off |
| When | Every extraction round that is on, once per round, always the **same window** (today..+N) so the latest file covering a day is the current value for it. Recorded as `arrival-ahead@round-HH`. No catch-up, no yesterday re-take, no baseline, no period close |
| File | One file per round, even when the window crosses a month end. A page that reaches the 2000-row cap fails loudly (it is never split or truncated). 0 rows is "empty", not a failure |
| Upload | Never — `_manifest.json` carries `neverUpload`, so `upload: skip` in every round including 23:00 (the uploader could otherwise let a today..+N file supersede yesterday's `arrival-period` file) |
| `status` | Its own line under HotelTime: last result (rows, window, time), and the last success when the latest failed. It is **not** counted in "snapshot N/N" and a failure never makes a day "incomplete" |
| Warnings | `_run.json` holds `blankRows` = rows whose guest name or room type is blank (a warning, not a failure). Discord, logs and `status` show row counts and dates only, never guest names |
| By hand | `exporter export --report arrival-ahead --round HH` — one file, today..+N (N from `HOTELTIME_LOOKAHEAD_DAYS`, or 14 when it is empty). Works while rounds are off and outside the round's time window; it uses the same one login |

**Roll-out (done in this order — the feature stays off until step 5). Status 2026-11-23: all five steps are done and the look-ahead report is on at the Ubuntu machine with `HOTELTIME_LOOKAHEAD_DAYS=14`.**

1. Deploy the code with `HOTELTIME_LOOKAHEAD_DAYS` empty (nothing changes by itself).
2. On the Ubuntu machine run `exporter export --report arrival-ahead --round HH` once by hand.
3. Check the file in Silver: header, row count, `range` in `_manifest.json` = today..+N.
4. Gold side confirmed: `hoteltime-schema` supports the report (Silver table `hoteltime_arrival_ahead`; Gold `ht_gold_arrival` reads `source='arrival_ahead'`), and a range file that crosses today was ingested on production on 2026-11-23 (48 rows). Before that support existed, `arrival-ahead` would have been unrecognised — it has the same header as `arrival-period` and Gold classifies files by header — so keep this step in mind if the report is ever rebuilt or its columns change.
5. The owner decides the final N (7 / 14 / 30), puts it in `exporter/.env` as `HOTELTIME_LOOKAHEAD_DAYS=14`, and the next round takes it (chosen: 14).

**Things to expect:**

- **Switching it off later** (clear `HOTELTIME_LOOKAHEAD_DAYS` in `.env`): `verify_coverage` on the `hoteltime-schema` side warns that `arrival-ahead` is "stale" once its latest file is older than 9 hours, because it treats the report as a snapshot. This is expected, not an error. The same warning shows between the single manual run (step 2) and the moment N is set (step 5).
- **A manual run** (`exporter export --report arrival-ahead --round HH`) only writes the file to Bronze. It does not start the data pipeline into Silver: wait for the next `run_daily.py` run, or press Run Now on `ht_pipeline_daily`.

#### Snapshot slots

*Old schedule only: in effect while `HOTELTIME_ROUNDS=off`.* Replaced by rounds otherwise.

Snapshot slots are extra HotelTime rounds that re-take snapshot reports only (no per-day reports, no back-fill).

| Slot | Time (Asia/Bangkok) | Retry |
|---|---|---|
| `06` | 06:00 | 06:30 |
| `23` | 23:00 | 23:30 |

A slot runs only if it is listed in `HOTELTIME_SNAPSHOT_SLOTS` in `exporter/.env`. If it is not listed, the command exits immediately without logging in. This is the on/off switch for these rounds.

### 3.4 Report identifiers

Run `node src/index.ts reports [--site foodstory]` for the authoritative list with labels and paths. Valid values for `--report` are the identifiers below, or `all`.

**HotelTime (48 reports, plus the look-ahead report `arrival-ahead`)**

| Group | Identifiers |
|---|---|
| Reservations | `reservations-search`, `reservations-ratecode`, `reservations-cancelled`, `arrival-period`, `reservations-by-arrival-date`, `arrival-ahead` (look-ahead, rounds only) |
| Guests and movements | `arrivals`, `departures`, `in-house-guests`, `guest-profiles`, `foreign-police-profiles` |
| Housekeeping and rooms | `housekeeping`, `housekeeping-basic`, `housekeeping-all-in-one`, `rooms-status-overview`, `rooms-ooo`, `rooms-available` |
| Statistics | `reservation-stats-month`, `reservation-stats-day`, `reservation-stats-term`, `reservation-stats-segment`, `combined-forecast`, `occupancy-annual`, `occupancy-room-type`, `nationality-revenue`, `occupancy-by-nationality`, `occupancy-by-nationality-stay-reason` |
| Postings and invoices | `post-masters`, `post-master-history`, `manual-postings`, `postings`, `invoices-advance`, `invoices-annul`, `invoices-closed-account`, `invoices-report`, `uncharged-invoices`, `uncharged-invoices-by-customer`, `unpaid-invoices-by-date`, `city-tax` |
| Deposits and ledgers | `deposit-ledger`, `gift-certificate-ledger`, `deposit-to-use`, `deposit-journal` |
| Management and accounting | `manager-day-detail`, `manager-summary`, `manager-items`, `accounting-report`, `accounting-report-detail`, `trial-balance`, `accounts-open`, `audit-trail` |

With `--report all`, `--daily` runs every report except `arrival-ahead` (it only runs in extraction rounds, or by hand with `--report arrival-ahead --round HH`); other modes skip the per-day reports (ADR-0003).

**FoodStory (49 reports)**

| Group | Identifiers |
|---|---|
| Sales | `salebysumdate`, `salebydate`, `salebybill`, `salebybilldetail`, `salebymonthsum`, `salebychannel`, `pay`, `sale-claim` |
| Tax | `outputtax`, `fulltaxinvoice` |
| Product | `salebyproduct`, `salebyproducthourly`, `salebyproductdaily`, `salebycategory`, `salebygroup`, `salebyoption`, `costbyproduct`, `intermidiate`, `ingredient`, `ingredientaddon`, `order`, `option`, `option_by_date` |
| Staff | `order_by_employee`, `payment_by_employee`, `employee`, `working` |
| Inventory | `current_stock`, `check_stock`, `activity`, `supplier`, `purchase_stock`, `purchase-detail`, `add_waste`, `used_stock`, `used_stock_by_date`, `transfer_stock`, `transfer-detail`, `transfer`, `inv_movement`, `summary_stock_movement` |
| CRM and promotions | `crm`, `promotion`, `promotion_use`, `voucher` |
| Cash and tables | `drawer`, `drawer_paid`, `table`, `reservation-report` |

`reservation-report` is not printed by `reports` but is accepted by `--report`; with `all` it runs last.

### 3.5 `upload`

```bash
node src/index.ts upload --site <hoteltime|foodstory>      # every pending folder of a site
node src/index.ts upload --folder <path>                   # one folder
```

Exactly one of `--folder` and `--site` is required (exit code 2 otherwise).

| Option | Description |
|---|---|
| `--folder <path>` | A single run folder containing `_manifest.json`/`_run.json`, e.g. `data/hoteltime/daily/2026-10/2026-10-15` |
| `--site <id>` | All pending folders of the site (the form used by Windmill) |
| `--data <dir>` | Data store directory (default `exporter/data`) |
| `--json` | JSON output |

Exit codes: `0` success; `1` files remain pending or were rejected; `2` incorrect usage.

Requires `UPLOADER_URL`, `UPLOADER_EMAIL` and `UPLOADER_PASSWORD`.

### 3.6 `status`

```bash
node src/index.ts status [--days 7] [--at 2026-10-12T20:00] [--data <dir>] [--json]
```

| Option | Description |
|---|---|
| `--days <n>` | Look-back window; integer ≥ 2 (default 7) |
| `--at <time>` | Evaluate as if it were this time. Without a timezone, Thai time is assumed |
| `--data <dir>` | Data store directory |
| `--json` | JSON output |

Exit codes: `0` healthy (or action pending); `1` problem detected; `2` incorrect usage. It does not open a browser.

### 3.7 `notify`

```bash
node src/index.ts notify [--summary] [--dry-run] [--data <dir>]
```

| Option | Description |
|---|---|
| `--summary` | Also send today's summary (sent at most once per day) |
| `--dry-run` | Print the messages without sending or recording them |

The `export --daily` command already calls this automatically.

### 3.8 `login`, `reports`, `sweep`, `probe`, `migrate-legacy`

```bash
node src/index.ts login --site foodstory --headful       # credential check
node src/index.ts reports --site hoteltime               # list reports
node src/index.ts sweep --site hoteltime --out recon/menu-sweep.json
node src/index.ts probe --only reports/PostingsReport.aspx --keep-dates
node src/index.ts migrate-legacy            # plan only
node src/index.ts migrate-legacy --apply    # copy and verify sha256; originals are not deleted
```

---

## 4. Windmill job scripts

Location: `windmill/scripts/*.sh`. All scripts use Windmill tag `chromium` and run inside the `custom` worker with the repository mounted at `/workspace`. Times are Asia/Bangkok.

| Script | Schedule | Action |
|---|---|---|
| `pms_export_round` | 04:00, 08:00, 12:00, 16:00, 20:00, 23:00, each with a retry at :30 | `export --report all --round <HH>` (the round is worked out from the Thai clock), then `upload --site hoteltime` **in round 12 only** and only if the round really ran. All six pairs are always registered; a round that is off exits at once. Active when `HOTELTIME_ROUNDS` is not `off` |
| `pms_export_daily` | 12:00 daily | Old schedule (`HOTELTIME_ROUNDS=off`): `export --report all --daily`, then `upload --site hoteltime`. Disabled while rounds are on |
| `pms_export_daily_catchup` | 15:00 and 18:00 daily | Old schedule only: same as above; completes whatever the previous round did not. Disabled while rounds are on |
| `foodstory_export_daily` | 12:00 daily | `export --site foodstory --report all --daily` (headless forced), then `upload --site foodstory`. Time limit 1 hour |
| `foodstory_export_daily_catchup` | 15:00 and 18:00 daily | Same as above |
| `pms_export_snapshot_0600` | 06:00, retry 06:30 | `export --report all --snapshot-slot 06`, then upload. Active only if `06` is in `HOTELTIME_SNAPSHOT_SLOTS` and rounds are off |
| `pms_export_snapshot_2300` | 23:00, retry 23:30 | `export --report all --snapshot-slot 23`, then upload. Active only if `23` is in `HOTELTIME_SNAPSHOT_SLOTS` and rounds are off |
| `ht_pipeline_daily` | Rounds on: 20 and 50 minutes after each enabled round (:20 and :50). Old schedule: 12:45 and 19:00; 06:20 and 23:20 when the matching slot is enabled | Data pipeline: Bronze → Silver → checks → Gold → D1. Time limit 1 hour |
| `ht_pipeline_weekly_verify` | Sunday 00:30 | Verifies Silver against every source `.xlsx`; does not write to D1 (`--no-d1 --full-verify`). Time limit 1 hour |

Scripts are deployed under the path `u/<user who ran setup>/<script name>`.

### Behavioural notes

- **Upload never fails the job.** The upload step ends with `|| true`. Pending or rejected files are reported to Discord and appear in `exporter status` for the next run.
- **Export failure is preserved.** The FoodStory and snapshot scripts record the export's exit code, still run the upload, and then exit with the recorded code, so Windmill still shows the job as failed when an export failed.
- **Pipeline exit codes** (`run_daily.py`): `0` pass; `1` pass with warnings (the job still succeeds, warnings go to Discord); `2` a step failed; `3` another run is active. Codes 2 and 3 fail the job.
- **Pipeline scripts are registered only when `pipeline/.env` exists.** After installing the pipeline bundle, re-run `windmill/setup.mjs`.
- **File ownership.** Jobs run as root inside the container; each script restores ownership of `data/` on exit so that operators can overwrite the files later.
- **Switching regimes.** Edit `HOTELTIME_ROUNDS` in `exporter/.env`, then re-run `node windmill/setup.mjs`. Schedules of the other regime are switched off, never deleted, so going back is one re-run. The summary line shows `HotelTime runs in ROUNDS` or `runs the OLD schedule`. FoodStory schedules are not affected.
- **Round number.** It comes from the Thai clock when the script starts. If Windmill's queue delays a run past the round's window, that run and its retry do nothing and no alert is sent.
- **Single worker.** One `chromium` worker executes all jobs, so overlapping jobs run one after another.

### Changing a script

Edit the file in `windmill/scripts/` and re-run `node windmill/setup.mjs`. A new version is deployed only if the content changed.

---

## 5. `windmill/setup.mjs`

Provisions Windmill after `docker compose up -d`. It is idempotent: when nothing has changed, nothing is touched.

```bash
node windmill/setup.mjs
node windmill/setup.mjs --base http://127.0.0.1:18000
```

| Option / variable | Description |
|---|---|
| `--base <url>` | Windmill base URL. Default: `http://127.0.0.1:<WM_PORT>` |
| `WM_PORT` | Port, from the environment or `windmill/.env` (default `8000`) |
| `WM_ADMIN_EMAIL` | Admin e-mail if it differs from `admin@windmill.dev` |
| `HOTELTIME_SNAPSHOT_SLOTS` | Read from the environment, then `exporter/.env`, to decide which snapshot schedules to register |

It performs four actions:

1. Replaces the default admin password `changeme` with a random one, stored in `windmill/.admin-password` (mode 600, not in git).
2. Adds the tag `chromium` to the worker group `custom`.
3. Deploys every script in [Part 4](#4-windmill-job-scripts) with tag `chromium`.
4. Registers the schedules, with "permissioned as" set to the user running the script. Re-run it if that user is ever deleted, otherwise schedules fail silently.

After switching a snapshot slot on or off, re-run the script so that the dependent schedules are added or removed.

Secrets are never printed. A full test against a disposable Windmill instance is available through `bash windmill/test-setup-in-docker.sh`.

---

## 6. `deploy/ubuntu/install.sh`

Installs the exporter on Ubuntu Desktop in one command.

```bash
bash deploy/ubuntu/install.sh [--skip-windmill] [--no-login-check]
```

| Option | Description |
|---|---|
| `--skip-windmill` | Do not start Windmill (Docker) |
| `--no-login-check` | Do not attempt a HotelTime login at the end |

Requirements and behaviour:

- Run it as the user who will operate the machine, **not** with `sudo`. The script requests `sudo` itself when needed.
- Node.js 22.18+ and Docker must already be installed by the administrator; the script only checks them and explains what is missing.
- It is safe to re-run. Existing `.env` values are left untouched; only missing values (go-live date, Discord URLs) are filled in.
- It calls `windmill/setup.mjs` after Windmill starts.
- Unknown options cause exit code 1.

`deploy/ubuntu/test-install-in-docker.sh` tests the installer in a container.

---

## 7. Desktop launchers

Location: `exporter/launchers/`.

| Script | Purpose |
|---|---|
| `foodstory-daily.command` | Operator-facing launcher. Pulls yesterday's FoodStory reports, back-fills missing days and takes today's snapshot reports in a single login. The operator solves the captcha once; the remainder runs unattended and ends with a summary |
| `install-desktop-launcher.sh` | Places the launcher on the current user's Desktop |

```bash
bash exporter/launchers/install-desktop-launcher.sh
```

- macOS: creates a symbolic link to `foodstory-daily.command`.
- Ubuntu: creates a `.desktop` file on the Desktop and in the application menu.
- Run it in the operator's own account, not with `sudo`. It refuses to overwrite a file it did not create.

The operator guide is `docs/FOODSTORY-DAILY-STAFF-GUIDE.md`.

---

## 8. Recon scripts

Location: `exporter/recon/`. These scripts are for investigation and are not part of the scheduled system.

### `foodstory-replay-standalone.mjs`

Checks whether a saved FoodStory `storageState` can be replayed on another machine. It requires only `playwright`; it does not need the exporter repository.

```bash
npm i playwright && npx playwright install chromium
node foodstory-replay-standalone.mjs [state.json] [--ua headless]
```

| Argument | Description |
|---|---|
| `state.json` | Path to the saved state (default `foodstory-state.json`) |
| `--ua headless` | Keep the `HeadlessChrome` user agent; by default it is replaced with `Chrome` |

The script performs a single read-only page load. It does not enter credentials or interact with the captcha. It prints a JSON result and, on success, writes the refreshed state back to the same file. Cookie values are never printed.

---

## 9. Environment variables

Defined in `exporter/.env` (copy from `exporter/.env.example`). Precedence: shell environment, then `exporter/.env`, then the defaults in `src/sites/<site>/config.ts`.

| Variable | Used by | Description |
|---|---|---|
| `HOTELTIME_USERNAME`, `HOTELTIME_PASSWORD` | HotelTime export | Required |
| `HOTELTIME_BASE_URL`, `HOTELTIME_LOGIN_PATH` | HotelTime export | Endpoint (shard `th07`) |
| `HOTELTIME_HEADLESS`, `HOTELTIME_TIMEOUT_MS`, `HOTELTIME_SLOW_MO` | HotelTime export | Runtime behaviour |
| `FOODSTORY_EMAIL`, `FOODSTORY_PASSWORD` | FoodStory export | Required |
| `FOODSTORY_BASE_URL`, `FOODSTORY_BRANCH_NAME` | FoodStory export | Endpoint and branch assertion |
| `FOODSTORY_HEADLESS`, `FOODSTORY_TIMEOUT_MS`, `FOODSTORY_SLOW_MO`, `FOODSTORY_VIEWPORT_WIDTH`, `FOODSTORY_VIEWPORT_HEIGHT` | FoodStory export | Runtime behaviour (the viewport must stay fixed during a run) |
| `TWOCAPTCHA_API_KEY` | FoodStory export | Solves the captcha automatically. Required for unattended runs; if unset, a person must solve it in a headful browser |
| `EXPORTER_GO_LIVE` | `--daily` | First day to back-fill from (`YYYY-MM-DD`). Unset means yesterday only |
| `HOTELTIME_ROUNDS` | `--round`, `setup.mjs` | Rounds that are on, from `04,08,12,16,20,23`. Unset = `08,12,16,20,23`; `off` = none (old schedule runs) |
| `HOTELTIME_LOOKAHEAD_DAYS` | `--round` | Look-ahead arrival report (ADR-0015): days ahead of today, `1`-`60`. **Empty = off** (keep it empty until the roll-out check is done). Invalid = error at start-up |
| `HOTELTIME_SNAPSHOT_SLOTS` | `--snapshot-slot`, `setup.mjs` | Old schedule only. Enabled slots, e.g. `06,23`. Empty means off |
| `HOTELTIME_SNAPSHOT_SLOT_REPORTS` | Snapshot rounds | Optional comma-separated report identifiers to take in extra rounds |
| `DISCORD_WEBHOOK_URL_EXPORT`, `DISCORD_WEBHOOK_URL_UPLOAD` | `notify`, `export`, `upload` | Webhook URLs. Unset means that notification is skipped |
| `UPLOADER_URL`, `UPLOADER_EMAIL`, `UPLOADER_PASSWORD` | `upload` | All three are required; there are no defaults |
| `UPLOADER_SEND_EMPTY` | `upload` | Enable the `empty` array contract. Leave off until the uploader endpoint is confirmed as deployed |

Secrets (passwords, API keys, webhook URLs) must never be committed or pasted into chat.

---

## Quick reference

```bash
# One-off runs (from exporter/)
node src/index.ts export --report all --round 12
node src/index.ts export --report all --daily   # old schedule
node src/index.ts export --site foodstory --report all --daily
node src/index.ts upload --site hoteltime
node src/index.ts status

# Provisioning (from the repository root)
bash deploy/ubuntu/install.sh
node windmill/setup.mjs
```
