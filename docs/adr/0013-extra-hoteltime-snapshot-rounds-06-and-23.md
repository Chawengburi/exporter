# HotelTime snapshots are also taken at 06:00 and 23:00 (supersedes the "one re-take at 18:00" part of ADR-0011)

2026-11-15 · In-house state in the consumer's Gold layer (`hoteltime-schema`) is only as fresh as the last snapshot: the noon round and the 18:00 re-take of ADR-0011. A guest who
checks out at 21:41, or at 05:48 the next morning, still shows as in-house until the next noon snapshot reaches Gold (the pipeline runs at 19:00 the day after), 13 to 21 hours later.
The audit-trail document type (ADR-0012) is not accepted by the uploader yet, and the consumer accepts that snapshots give state, not event time.

**Decision:** add two snapshot-only rounds for HotelTime, at 06:00 and 23:00 Asia/Bangkok. Each takes every HotelTime snapshot report that the 18:00 re-take takes, and nothing
else: no per-day reports, no back-fill, no period-close snapshots. The 12:00, 15:00 and 18:00 rounds and the 18:30 status/deadline logic stay exactly as they are.

- **A separate command mode**, `exporter export --report all --snapshot-slot 06|23`, with its own planner entry point (`planSnapshotSlot`). It is not a variant of `--daily`.
- **One id per slot.** Results are recorded in the folder of the Thai calendar day at the start of the run under `<report>@refresh-06` and `<report>@refresh-23` (the 18:00
  re-take keeps `<report>@refresh`, so nothing is migrated). `_run.json` keeps one status and one set of files per id per folder, so the rounds never overwrite each other.
  A slot's report is done when its slot id has status data or empty; a failed or missing one is planned again.
- **Folders.** The 06:00 round belongs to the new day D+1 (the folder of D+1), the 23:00 round to the day D that is ending. File names carry the capture time (Thai, +0700), so
  files never collide, and the manifest `takenAt` is the capture time. `daily/latest` is **not** moved by a slot round (at 06:00 the folder holds no normal snapshot yet).
- **Windows.** A slot only runs inside its Thai-time window: 06 in [06:00, 12:00), 23 in [23:00, 24:00). Outside it the command exits 0 without logging in, so a delayed or
  retried job can never write slot 23 into the next day's folder after midnight, and slot 06 can never run into the noon round.
- **Retry.** Each slot has a second schedule 30 minutes later (06:30, 23:30) running the same script; it finds nothing to do (no login, no browser) when the first run took every report.
- **On/off switch.** `HOTELTIME_SNAPSHOT_SLOTS` in `exporter/.env` (e.g. `06,23`; empty or unset = off). With a slot not listed, the command exits at once without logging in. The
  Windmill jobs are always registered; `setup.mjs` re-enables schedules that were disabled in the web UI, so the setting in `.env` is the switch that survives it.
  `HOTELTIME_SNAPSHOT_SLOT_REPORTS` optionally narrows the rounds to a few snapshot reports (fewer logins); the default is every snapshot report.
- **Status and Discord.** "snapshot N/N" still counts the normal ids only, so there is no double counting. A failed extra round is not an alert on its own: the summary names it
  (`23:00 re-take failed: ...`), like the 18:00 re-take. If **every** report of an extra round failed (login or browser problem), `exporter status` reports a problem and, right after
  the round, one Discord alert is sent (`HotelTime snapshot round 23:00 failed`, once per slot per day). Extra rounds send no summary and do not repeat other alerts.
  A slot-only run does not count as "the day ran" for the `lastRunDay` of a site.
- **Upload leg.** Slot ids are re-take ids like `@refresh`: an empty snapshot of a slot does not create an "empty not announced" backlog.
- **Windmill.** Two new HotelTime-only scripts (`pms_export_snapshot_0600.sh`, `pms_export_snapshot_2300.sh`), each with its schedule and the 30-minute retry. The consumer's pipeline
  schedules follow each round about 20 minutes later; `setup.mjs` registers several schedules for the one pipeline script (the first keeps the script's own path, the others are
  `<script>_<suffix>`), and the 06:20 and 23:20 ones only while the matching slot is enabled in `.env`.

**Options not chosen**

1. *Run `--daily` at the new times.* It would back-fill per-day reports (up to 3 days per run), and at 06:00 it would take the day's **normal** snapshot early; the planner would then
   consider the normal snapshot done and the noon round would take nothing.
2. *Generalize `refreshAtHour` to a list of hours.* It keeps the precondition "the normal snapshot of today is done", which is false at 06:00, and still plans per-day work.
3. *One id per day with later rounds overwriting.* `_run.json` would lose the files of earlier rounds and the upload leg could not find their `as_of` (the reason ADR-0011 gave).
4. *Hourly snapshots.* About 27 logins per round (one login per report), about 650 a day; HotelTime's tolerance is unknown.
5. *A subset of snapshot reports only (the few that Gold reads for in-house state).* Cheaper (about 8 logins a round) and kept available as `HOTELTIME_SNAPSHOT_SLOT_REPORTS`, but not the
   default, because the consumer asked for the same set as the 18:00 re-take.
6. *Wait for the audit-trail document type.* Not wanted: it needs the uploader team.
7. *A per-slot table in status and Discord.* Larger change for little value; failures already show in the existing re-take line.

**Consequences**

- Logins: the exporter logs in once **per report**, not once per round. Today about 77 logins a day (noon: 23 per-day + 27 snapshots; 18:00: 27; plus back-fill); two full extra rounds add
  54, about 131 a day. Whether HotelTime tolerates that is not confirmed. Each round takes about 3.5 minutes (27 reports at about 7.5 s, consistent with ADR-0009's 177 s);
  not yet measured on the server.
- The uploader receives about 54 more snapshot files a day (every snapshot xlsx differs in bytes each time). Whether the uploader charges per file or limits the rate is not
  confirmed. The `as_of` guard may mark an older, still-unsent file as blocked when a later file of the same report goes first; same intended behaviour as in ADR-0011.
- The 06:00 round must not run while the hotel's night audit is still closing the day: the end time is **not confirmed** with the front office, so turn slot 06 on only after it is.
  Turn 23 on first and watch it for a night or two.
- A dead slot job (Windmill down) is not alerted on, the same as the 18:00 re-take today: "not run yet" is not a failure.
