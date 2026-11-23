# HotelTime takes a look-ahead arrival report (today..+N) as its own snapshot report, kept local and never uploaded

2026-11-23 · **Decided 2026-11-23; implemented in code the same day, rolled out and switched on at the Ubuntu machine with `HOTELTIME_LOOKAHEAD_DAYS=14` (checked in Silver and Gold on 2026-11-23).** Context: the web-app wants to show guests who are about to arrive (guest name, room type, room number, nights). Silver only held arrival files up to today, so Gold built future rows from the stay table (no guest name, no room type, room number on 9 of 363 rows). A read-only recon on 2026-11-23 showed HotelTime accepts future dates and returns guest name and room type on every row; the room number is filled only up to about +7 days (at +14 and +30 it is empty — normal for a PMS).

**Decision:** add a new report `arrival-ahead` — same page as `arrival-period` (`GuestArrivalsTerm.aspx`), but a **snapshot report** (`family: 'picture'`) whose data window is today..+N (`dataWindow`), taken in **every extraction round** that is switched on, as **one file** per round (no monthly chunks).

- **N** comes from `HOTELTIME_LOOKAHEAD_DAYS` in `exporter/.env` (unset/empty = off, starts at 14, error outside 1–60, off when `HOTELTIME_ROUNDS=off`). The window is **fixed in every round**: Gold's rule "the latest file that covers day D wins" only works when every round covers the same days — a shrinking window would leave dropped days on an old value.
- **Local leg only.** A report-level flag marks it never-upload (including the 23:00 round, whose snapshot is normally uploaded). The uploader supersedes an older file of the same report when the new range covers it and `as_of` is newer, so a today..+14 file could replace yesterday's `arrival-period` there.
- Failures and empty results get their own line in `exporter status` — not in "snapshot N/N", never a reason a day is "not complete". Empty (0 rows) follows the existing rule for empty. Guest name / room type blank on a row is a warning counted in `_run.json`, not a failure. Discord, logs and status carry row counts only, never guest names.

**Options not chosen**
1. *Per-day `arrivals` / `reservations-by-arrival-date` for each future day.* N logins-and-searches per round per report (14 × 2), needs ADR-0003 (daily-only) rewritten, and adds nothing the range report does not already return. `arrivals` also drops guests already checked in.
2. *Extend `arrival-period` with a look-ahead mode.* Gold relies on `arrival-period` staying a per-day report (a day is "decided" only after it ends); mixing a future range into it breaks that.
3. *Send the file to the uploader too.* See the supersede rule above; ask the uploader's owner first if this is ever needed.

**Consequences**
- ADR-0003 is not touched. `arrival-period`, the rounds (ADR-0014) and the uploader leg are unchanged.
- Values for future days change (guests move or cancel) — the file is never a ledger; a row missing from the latest file means moved/cancelled.
- Verified 2026-11-23 on the Ubuntu machine, and reported by the `hoteltime-schema` side for production: Gold ingests a range file that crosses today (48 rows). It was rolled out with N unset, run once by hand, checked in Silver, then N was set to 14. Switching the report off later makes `verify_coverage` on the `hoteltime-schema` side warn "stale" once the latest file is too old (9 hours as reported by that side on 2026-11-23; its threshold may change) — expected for a snapshot report.
- Out of scope: freshness of today's check-in status (comes from the `in-house-guests` / `arrivals` snapshots every round); changing round frequency is a separate decision.
