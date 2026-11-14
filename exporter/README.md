# exporter

> Formerly named `pms-export` — renamed 2026-09-28 (ADR-0004): the command is `exporter`, and the HotelTime `.env` prefix
> changed from `PMS_*` to `HOTELTIME_*` · documents/tickets from before that date still use the old name.

> **Daily-run model (2026-10-14, `.scratch/exporter-daily-per-day-raw/`):** stores **raw files only** (ADR-0007) · **per-day reports**
> are pulled one file per **data day** · **snapshot reports** are taken at the time of the run (ADR-0008) · missing days are back-filled automatically from the **go-live date** (ADR-0009) · results are reported on
> Discord · all terminology is in [`CONTEXT.md`](../CONTEXT.md)

Pulls reports from **HotelTime PMS** (the hotel system) and **FoodStory** (the restaurant system) with Playwright and stores the raw files on disk.

Deterministic scripts — **there is no AI in the run loop**. AI is used only for the first exploration of the paths
and for repairs when a website changes its pages. The origin of this architecture is in two artifacts:
[Portal to Pipeline](https://claude.ai/code/artifact/776ec534-b87d-4500-8bb3-30f0c8485d97) (the general reference guide) ·
[Agent writes, scripts run](https://claude.ai/code/artifact/79616963-d0f3-4bb3-86cd-a4f4e07b53f9) (the proposal for this case)

## Status

| Part | Status |
|---|---|
| Project skeleton + config + keeping secrets from leaking | ✅ Done |
| `exporter login` — automatic login | ✅ Tested with real credentials, succeeded 2026-09-08 |
| Phase A — menu map | ✅ Complete, see [`recon/MENU.md`](./recon/MENU.md) |
| Phase A — filter/export exploration for the first 3 reports | ✅ Done, see [`recon/NOTES.md`](./recon/NOTES.md) |
| `exporter export` — pull raw files + verify + `_manifest.json` | ✅ HotelTime 50 reports · FoodStory 49 reports |
| Daily run with one file per data day + automatic back-fill of missing days + period-close snapshots + baseline | ✅ 2026-10-14 (tickets 01–09 of `exporter-daily-per-day-raw`) |
| `exporter status` + Discord alerts | ✅ 2026-10-14 (tickets 07–08) |
| File verification layer (`sites/hoteltime/verify.ts` + `core/verify.ts`) | ✅ Done — has caught 1 real bug |
| Multi-site support (`src/sites/<site>/`) | ✅ HotelTime 50 reports + FoodStory 49 reports (FoodStory solves the reCAPTCHA itself with 2captcha when `TWOCAPTCHA_API_KEY` is set, so it can run on Windmill — ADR-0010 · no key = a person solves the captcha as before) · renamed to `exporter` on 2026-09-28 (ADR-0004) |
| Upload leg into the uploader (`exporter upload`) | ✅ HotelTime + FoodStory (2026-10-24 runs on a schedule on Ubuntu) · announcing empty reports (`empty`) is still off (`UPLOADER_SEND_EMPTY`) — see ticket 14 |

## Install

```bash
npm install
npx playwright install chromium     # must match the playwright version in package.json
cp .env.example .env                # then fill in HOTELTIME_USERNAME / HOTELTIME_PASSWORD
npm link                            # makes `exporter` callable from anywhere
```

Requires **Node >= 22.18** because `.ts` is run directly with native type stripping — there is no build step.
`npm run typecheck` is `tsc --noEmit` and only checks types.

## Commands

After `npm link`, `exporter` can be called from any folder · output files are always under `exporter/data/` wherever it is run from · all times are
**Thai time** ("today", folder names, file names) regardless of the machine's TZ (`src/core/thai-time.ts`)

### Daily run `--daily` (both Sites — ADR-0008/0009)

- **Per-day reports** (HotelTime 23 · FoodStory 42 — ledgers/totals for a single day) ask the Site for one **data day** at a time, giving one file per day
  `<data day>__<id>.xlsx` (e.g. `2026-10-13__postings.xlsx`) in `data/<site>/daily/<YYYY-MM>/<data day>/` · the data day is normally
  **yesterday** (due from 07:00 Thai time — HotelTime's cancellation report cuts days by UTC)
- **Snapshot reports** (HotelTime 27 · FoodStory 7 — room status, guests, stock, master data, running totals, forecasts) are taken once a day at the time of the run, named
  `<YYYYMMDDTHHMMSS+0700>__<id>.xlsx`, in today's folder · snapshots of days that have passed **cannot be pulled retroactively**
- **Period-close snapshots**: in the first 7 days of a month/year, the running totals of the period that just ended are taken, named `<period start>--<period end>__<id>.xlsx`, in the folder of the period's last day
- **Automatic back-fill of missing days**: every run re-pulls the (report, data day) pairs that have not succeeded since the **go-live date** (`EXPORTER_GO_LIVE` in `.env`), newest first,
  at most 3 days per run (a cap from Windmill's 15-minute timeout) · no go-live date = only yesterday is pulled · **empty** (the site has no rows) counts as success ·
  nothing to do = finishes immediately without opening a browser — so Windmill's 15:00/18:00 catch-up runs are the same command as the noon run
- FoodStory: logs in once (solves the reCAPTCHA itself with 2captcha if a key exists, otherwise a person does) and then sets the date range one day at a time within the same run · Windmill runs it every day at 12:00 (+ catch-up 15:00/18:00) · the Desktop icon is a fallback
  (`exporter/launchers/foodstory-daily.command` — place it with `bash exporter/launchers/install-desktop-launcher.sh`) guide:
  [`docs/FOODSTORY-DAILY-STAFF-GUIDE.md`](../docs/FOODSTORY-DAILY-STAFF-GUIDE.md)
- After every daily run a Discord message is sent (below) · `data/<site>/daily/latest` points to today's folder
- exit code: `0` = everything passed (or nothing to do) · `2` = some reports passed · `1` = nothing obtained or misconfigured
- Automatic retries (`core/retry.ts`): timeout / network / browser closed are retried at most 2 times · **not retried** for hitting the row cap, failed verification,
  or failed login (retrying risks locking the account)

### Data store (ADR-0005/0007)

- Stores only the **raw files** exactly as the Site provides them (no conversion, no CSV) — conversion/column trimming/hiding personal data is the uploader's job
- Every folder has `_manifest.json` (per file: report, family, data-day range, time obtained, row count, sheet names, size, **sha256**, source page) ·
  `_run.json` (the latest status per report — the planner and `status` read from this) · `_summary.txt` (a summary in Thai)
- **Never delete, never overwrite**: pulling the same name again with different bytes → the old version moves to `_superseded/` (recorded in the manifest's `superseded[]`) · identical bytes → a single copy is kept
- ⚠ The sha256 of the whole file changes every download even when the data is the same (xlsx stores the creation time in `docProps/core.xml`) — use it to check the file is not corrupt,
  not to tell whether the data changed

### Other commands

- `--date YYYY-MM-DD` (HotelTime): re-pulls the per-day reports for that single day regardless of prior status · up to yesterday · does not take snapshot reports
- `--baseline` (HotelTime, ticket 09): re-pulls data days that were already pulled, one file per day with the same names as the daily run, into `data/hoteltime/baseline/<run date>/`
  (daily folders are untouched · `_run.json` uses the id `<report>@<day>`) · `--from/--to`, or omitted = the latest `--baseline-interval-days` (30) days up to yesterday ·
  snapshot reports have no baseline
- Back-fill `--from`/`--to`/`--last-days` (HotelTime): multi-day chunks, range name `<from>--<to>__<id>.xlsx`, into `data/hoteltime/backfill/<run time>/`
  · dailyOnly reports (ADR-0003) are skipped
- FoodStory monthly (without `--daily`): the whole previous month into `data/foodstory/monthly/<YYYY-MM>/` · pulling the same month again on another day gives
  `monthly/<YYYY-MM>__<pull date>/` · over 5,000 rows the range is split into `<id>_part<n>.xlsx` (the parts must be joined to cover the month)
- `status`: a one-page summary per Site × data day (has data / empty / failed / not pulled yet + snapshot reports + period-close snapshots + things to do), read-only on the store ·
  `--json` is the structure used to build the Discord messages · exit 0 normal/has things to do · 1 has a problem · 2 misused
- `notify`: send Discord manually (`--summary` sends this run's summary · `--dry-run` only displays) — daily runs already call it: a summary every run (English, log-style messages)
  · immediate alerts when status has a problem / a gap over the cap / FoodStory not pressed for 2 days · no repeats within the same day ·
  URLs are in `.env` — separate channels for the export leg (`DISCORD_WEBHOOK_URL_EXPORT`) and the upload leg (`DISCORD_WEBHOOK_URL_UPLOAD`); missing = that leg is skipped ·
  a failed send does not fail the run (recorded in `data/_notify/discord.json`)
- Retired flags (passing them = exit 1 with a reason): `--format`, `--overlap-days`, `--retry-failed`

```bash
exporter status                              # a Thai summary of whether the system is healthy (read-only on the store · --json · --days 14)
exporter login --check                       # check that the HotelTime credentials really work
exporter reports                             # list the supported reports

exporter export --report all --daily                          # HotelTime daily run — the same command Windmill runs at all 3 times
exporter export --site foodstory --report all --daily --headful   # FoodStory daily run (no 2captcha key = a person solves the reCAPTCHA) — what the Desktop icon runs
exporter export --report all --date 2026-10-12                # re-pull a single data day (HotelTime)
exporter export --report all --baseline --from 01/10/2026 --to 13/10/2026   # baseline, one file per day (HotelTime)
exporter export --report reservations-search --from 01/07/2026 --to 08/09/2026   # back-fill
exporter export --site foodstory --report all --headful       # FoodStory monthly (previous month)
exporter notify --dry-run --summary                           # see the Discord message that would be sent, without sending

exporter export --report postings --date 2026-10-12 --headful --slow-mo 250   # watch it work live
exporter export --report all --daily --json                  # JSON output (--daily reports folders as outDirs)

npm test                                     # unit tests
npm run typecheck
```

## Documentation

| What you want to know | Where to read |
|---|---|
| **How to use it safely** (for newcomers) | [`.claude/skills/exporter/SKILL.md`](../.claude/skills/exporter/SKILL.md) |
| **The reasons for every decision** | [`specs/`](./specs/README.md) — 9 specs (01–06 accepted · 07–09 draft) |
| What was measured on the real sites (evidence) | [`recon/NOTES.md`](./recon/NOTES.md) |
| Map of all HotelTime report pages | [`recon/MENU.md`](./recon/MENU.md) |

🔴 **Before changing any code, read [`specs/02`](./specs/02-spec-hoteltime-constraints.md) first** —
the 6 HotelTime constraints that all fail silently.

## Raw files are the source of truth (ADR-0007)

The exporter passes on only the raw files exactly as the Site provides them — the bytes straight from the source, not passed through any conversion of ours · the verification layer still reads every file before placing it (every sheet — counting rows,
row cap, date range of every sheet that has a date column) · a file that fails is not counted as "has data" · `_manifest.json` records which page the file came from, which column it was filtered by,
which days it covers, when it was obtained, how many rows, and the sha256 · worth knowing if you open the files yourself: HotelTime's xlsx has a non-compliant `styles.xml` (`openpyxl` cannot read it directly —
the uploader's converter repairs it) and dates are Excel serials.

CSV files and `_raw/` in folders from before 2026-10-14 belong to the earlier format — they are kept as they are (not deleted) and `status` shows them as history.

## Facts about HotelTime that determine the whole design

Verified against the real `th07.hoteltime.com` on 2026-09-08 — these five are not guesses.

1. **No anti-bot / CAPTCHA** — headless Chromium loads the login page without trouble
   → Playwright on our own machine is enough; no need to rent a browser from anyone
2. **It is ASP.NET WebForms** (`__VIEWSTATE` of 912 characters, `__EVENTVALIDATION`,
   `__doPostBack()`, `WebResource.axd`, v4.6.24)
   → **URLs cannot be hit directly with curl**; the viewstate is bound to the session and validated server-side —
   this is why a real browser is required
   · **but navigation between pages uses ordinary `<a href>`**, so `page.goto()` can enter a report page
   directly without clicking through the menu — the postbacks are the login form and the filter/export in the report page
3. **No 2FA** — the form has only Login / Password / Submit → login can be automated
4. **The session is server-side** → `storageState` / a persistent profile gives the false impression
   of "already logged in" and then breaks when export is clicked · so the runner logs in again every run
5. **The login form is a repeater** (`rptLastUsers$ctl00$tbUserName`) — the index number in the id
   shifts when the number of "last used users" changes → never bind to the id; use role + accessible name
   and assert that exactly one is found (`uniqueByRole` in `src/sites/hoteltime/webforms.ts`)

## The number-one risk and how it is guarded against

**A file that "looks normal but is wrong"** is more dangerous than a broken script, because a broken script is noticed, but a pull over the wrong date range
that succeeds goes unnoticed until someone asks for a number and gets the wrong answer — which could be next month.

Two gates guard against this:

- `assertStillLoggedIn()` is called **before** every export click — if the session drops midway,
  WebForms bounces back to the login page and the next export click would produce an empty file that looks normal
- `sites/hoteltime/verify.ts` (`verifyChunk`) compares the resulting file against the **"order"** the runner has held since before opening the browser
  — a *comparison of values*, not an *interpretation*

This verification layer has caught two real things: **the 2000-row cap that HotelTime cuts silently**
and **our own Excel-serial rounding bug**, which would have shifted the dates of half a column by one day.

## Secrets

- `.env` has been gitignored since the first commit (a `.dev.vars` once leaked into git in this workspace —
  auth-center fixed it on 2026-08-17)
- `data/`, `downloads*/` and `recon/captures/` are also gitignored because they contain guest names =
  **personal data**
- Every message printed to the screen or written to a file goes through `src/core/redact.ts` first —
  Playwright likes to attach the page's HTML to errors, and WebForms echoes the posted values back in the
  viewstate, so passwords leak into logs more easily than you would think
- Credentials are separated from `Config` at the type level (`loadCredentials()` is separate) so that
  `console.log(config)` cannot leak a password in the first place

## Structure

```
src/
  index.ts                    commander wiring · --site hoteltime | foodstory (ADR-0004)
  core/                       only things proven not to be tied to any site
    order.ts                  the order · splitting into monthly chunks · halving on hitting the cap · back-fill/baseline ranges
    run-planner.ts            the run planner (pure functions): which days/reports to pull · back-fill missing days · period-close snapshots · baseline
    run-record.ts             _run.json / _summary.txt · placement.ts ISO file names + folders · raw-manifest.ts _manifest.json + _superseded/
    status.ts                 exporter status · discord.ts Discord messages + sender · browser-env.ts browser env without secrets
    redact.ts                 keeps secrets out of logs
    xlsx.ts                   a reader tolerant of HotelTime's non-compliant files
    gate.ts                   the allowlist guard — checked before touching any control (pure, not tied to a site)
    verify.ts                 the generic part: compare accumulated chunks against the ordered range, compare 2 manifests
  sites/hoteltime/            everything that talks to the real HotelTime pages
    config.ts                 shell env > .env > default (prefix HOTELTIME_*) · credentials separate from config
    session.ts                opens the browser · logs in
    webforms.ts               ASP.NET-specific helpers — all the traps found on the real site in one place
    sweep-classify.ts         classifier of sweep results (purely pure, but tied to ASP.NET control patterns)
    verify.ts                 the part tied to HotelTime's Report shape (verifyChunk/RowCapError)
    export.ts / login.ts / sweep.ts   the actual commands — invoked from index.ts
    reports/                  one file per report — 50 reports, each stating its family (per-day/snapshot) and period
  sites/foodstory/            FoodStory — config.ts (prefix FOODSTORY_*) · login solves the reCAPTCHA with 2captcha (or a person if there is no key) · daily.ts daily run in a single login
                              reports/ 47 reports + salebychannel.ts + reservation-report.ts = 49 reports in --report all
  notify.ts                   Discord notification after a daily run / exporter notify (assembles status + discord + a record of what was sent)
recon/NOTES.md          notes on paths/filters/traps found during exploration — the source of every value in the code
recon/menu-sweep.json   the latest sweep of the whole site (pure script, see ADR-0001)
data/                   the output store (ADR-0005) — every run folder has the raw files + _manifest.json + _summary.txt + _run.json (gitignored)
  hoteltime/daily/<YYYY-MM>/<YYYY-MM-DD>/   daily run: the folder = the data day (and the snapshot reports taken that day) + daily/latest
  hoteltime/baseline/<YYYY-MM-DD>/          --baseline (run date) one file per data day + baseline/latest
  hoteltime/backfill/<YYYY-MM-DD_HHMMSS>/   back-fill / --from/--to / --last-days, one folder per run
  foodstory/daily/<YYYY-MM>/<YYYY-MM-DD>/   FoodStory --daily: the folder = the data day + daily/latest
  foodstory/monthly/<YYYY-MM>[__<YYYY-MM-DD>]/  FoodStory monthly (re-pulls get a folder with the pull date) — xlsx + _manifest.json instead of CSV/_raw/
  foodstory/_downloads/                     staging for files during download (the final file is moved into the run folder)
  _notify/discord.json                      what has been sent to Discord / could not be sent (prevents repeats)
downloads*/             legacy from before the new store — moved into data/ (ticket 05), awaiting deletion by the system owner (gitignored)
```

Formerly named `pms-export` — renamed to `exporter` on 2026-09-28 after FoodStory was proven (ADR-0004,
ticket 13 of `.scratch/exporter-multi-site/`)

**Why `reports/` is TypeScript and not JSON config** — each report's filters are very individual;
JSON would not keep up and would slowly turn into half a programming language · using one file per report
that implements the same interface gives both freedom and consistency.
