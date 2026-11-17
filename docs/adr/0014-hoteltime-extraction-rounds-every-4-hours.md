# HotelTime runs six extraction rounds a day; per-day reports are re-fetched each round and only the final version goes to the uploader (supersedes ADR-0011 and ADR-0013, amends ADR-0008)

2026-11-17 · **Decided 2026-11-17; takes effect when the new Windmill schedule is deployed (4h-rounds ticket 10).** Until then ADR-0011 and ADR-0013 stay in force and
the code path they describe (`--daily`, `--snapshot-slot`) keeps working. Code for the new rounds is in place (`export --report all --round HH`, `HOTELTIME_ROUNDS`) but no schedule calls it yet.

**Context.** The consumer's D1 is only as fresh as the last export that reached Silver → Gold. The upload leg and the local leg (Silver → Gold → D1) are separate, and Silver keeps
every version of a file (its key includes `as_of`) while Gold takes the latest. ADR-0008 rejected overlapping per-day files because the uploader might count them twice; ADR-0011 and
ADR-0013 added snapshot re-takes at 18:00, 06:00 and 23:00 on top of the noon and 15:00/18:00 catch-up rounds.

**Decision:** one schedule for HotelTime — **extraction rounds** at 04:00, 08:00, 12:00, 16:00, 20:00 and 23:00 Asia/Bangkok.

- Every round takes **all snapshot reports** and the per-day reports of **today** (an incomplete version, re-fetched every round), plus catch-up of missing per-day days (ADR-0009, cap 3 days).
- Rounds **08:00 and 12:00** also **re-fetch yesterday's** per-day reports even though they are already done (08:00 gives the first complete file once the cancellation report's
  day cut has passed; 12:00 is the confirming version that goes to the uploader). The 04:00 round has no work for yesterday: `PER_DAY_DUE_HOUR = 7` stays. Yesterday is not
  re-fetched after 12:00, so a file that was uploaded is not replaced (and does not lose its `uploaded` flag); late corrections are caught by the 30-day baseline (ADR-0008).
- **Local leg** gets every file of every round. **Upload leg** runs only in the 12:00 round's script and sends the folder of **yesterday (D)**: the per-day files of D (the 12:00
  version) and, of the snapshots, only the 23:00 one of D. Snapshots of other rounds get a not-to-upload marker in the manifest. The upload leg computes yesterday's folder from the date
  and never reads `daily/latest`.
- **One result id per round** in `_run.json` (one status and one set of files per id per folder): `<report>@round-<HH>` for today's per-day and the snapshots of a round,
  `<report>@redo-<HH>` for the re-fetch of yesterday at 08/12 (its own id because yesterday's folder already holds that round's `@round-<HH>` from when yesterday was "today"),
  and the plain `<report>` id for catch-up — the plain id is what says a day is **done**; `@round-<HH>` of today is an incomplete version and never counts as done; a failed `@redo` while the plain
  id exists is extra information, not a gap. The old ids (`@refresh`, `@refresh-06`, `@refresh-23`, `@period-close`) stay readable in past folders.
- **Switch:** `HOTELTIME_ROUNDS` in `exporter/.env` lists the hours that are on (default `08,12,16,20,23`; `off` = none; a typo is an error). Windmill registers all six rounds always;
  a round that is not listed, or is outside its Thai-time window, exits at once without logging in. The old `HOTELTIME_SNAPSHOT_SLOTS` never turns a round on. The 23:00 round
  may only run between 23:00 and 23:59 (no round crosses midnight); other rounds have a two-hour window. The 30-minute retry and the "pipeline follows each round by ~20 minutes" rule of ADR-0013 are kept.
- `daily/latest` moves to today's folder in every round that writes at least one file there.
- Period-close snapshots stay with the existing daily round logic (`planDailyRun`) until the schedule is switched over.

**Options not chosen**
1. *Keep ADR-0011/0013 and only add 08/16/20.* Two mechanisms for the same job; per-day would still be once a day.
2. *Send every per-day version to the uploader.* Risks double counting until Row-Level Deduplication exists and its location is decided.
3. *Hourly rounds.* ~1 600 logins a day (rough); `007_room_status_snapshot.sql` and `push_gold` reads need fixing first.
4. *Last round at 23:30.* A retry could cross midnight and land in the next day's folder.

**Consequences / verified and unverified**
- The exporter logs in once **per report**, so logins rise to about 310 a day (was ~77) — an estimate. Measured 2026-11-17 (ticket 06): 15 logins in a row were not limited, one session
  per round would be ~2.1× faster, a session lives ~120 minutes. One session per round is separate follow-up work.
- The uploader (answered 2026-11-17): `as_of` is the value the exporter POSTs and nothing else; document search for day D uses `range_from`/`range_to`; a file supersedes an older one with the same
  `source_system + document_type + report` when its range covers the old one and its `as_of` is strictly newer; the same bytes with the same report/range are answered `duplicate`. A HotelTime
  report is either per-day or snapshot, never both, so per-day and snapshot files do not supersede each other.
- Per-day files reach the uploader at 12:00 of the next day, as today; the 23:00 snapshot about 13 hours after it was taken.
- The day cut of the cancelled-invoices report lies between 05:12 and 06:15 Thai time (measured 2026-11-17), not at 07:00 as ADR-0008 inferred; 07:00 stays as the safe due hour.
- Today's per-day file can be fetched without error (proven for postings, reservations-cancelled, vat-output); that its row count grows through the day is not yet shown.
- Today's amounts in D1 may be incomplete until the 08:00 round of the next day.
- Gold keeps rows missing from later files (invoices) — a hoteltime-schema matter, unchanged.
- Rollout order: five rounds first (08, 12, 16, 20, 23), watch `build_gold`/`push_gold` for a week, then add 04:00 after its night-audit risk is observed. `HOTELTIME_ROUNDS=off` on the Ubuntu machine until the schedule is deployed.
