/**
 * What Windmill should run, as plain data — separated from `setup.mjs` (which talks to the REST API) so it can be tested without Windmill (exporter/test/windmill-plan.test.ts)
 *
 * Two regimes for HotelTime (ADR-0014):
 *  - **rounds** (`HOTELTIME_ROUNDS` lists at least one hour): the six extraction-round schedules + the pipeline 20 minutes after each enabled round run; the legacy HotelTime schedules
 *    (noon / 15:00 / 18:00 / the 06:00 and 23:00 snapshot slots and their pipeline schedules) are **disabled** (kept registered so switching back is one re-run)
 *  - **legacy** (`HOTELTIME_ROUNDS=off`): exactly the old behaviour; the round schedules stay registered but every run exits at once without logging in
 * FoodStory and the weekly check are unaffected.
 */
export const ROUND_HOURS = ['04', '08', '12', '16', '20', '23'];
export const DEFAULT_ROUNDS = ['08', '12', '16', '20', '23'];

/** Same rules as `parseRounds` in exporter/src/core/run-planner.ts (a test keeps them identical): unset/blank = default · off/none = no rounds · unknown hour = error */
export function parseRoundsRaw(raw) {
  if (raw === undefined || raw.trim() === '') return { rounds: [...DEFAULT_ROUNDS] };
  if (['off', 'none'].includes(raw.trim().toLowerCase())) return { rounds: [] };
  const picked = new Set();
  for (const part of raw.split(',').map((x) => x.trim()).filter((x) => x !== '')) {
    const hh = /^\d$/.test(part) ? `0${part}` : part;
    if (!ROUND_HOURS.includes(hh)) return { error: `HOTELTIME_ROUNDS has an unknown round ${JSON.stringify(part)} — allowed: ${ROUND_HOURS.join(', ')} or "off"` };
    picked.add(hh);
  }
  return { rounds: ROUND_HOURS.filter((h) => picked.has(h)) };
}

// Both Sites use the same times for the legacy runs — status/Discord use a single set of time rules (core/status.ts: deadline 15:00 / the last run is evaluated at 18:30)
const DAILY_CRON = '0 0 12 * * *';
const CATCHUP_CRON = '0 0 15,18 * * *';
// Time cap of the FoodStory job (seconds), set on the script itself rather than relying on Windmill's default (about 20 minutes in the heavy case, 1 hour allowed)
export const FOODSTORY_TIMEOUT_S = 3600;
// Data pipeline (hoteltime-schema) timeout: 1 hour
export const PIPELINE_TIMEOUT_S = 3600;
const dot = (hhmm) => hhmm.replace(':', '.');
const cronAt = (hh, minute) => `0 ${minute} ${Number(hh)} * * *`;

/**
 * Naming of what the Windmill UI shows (the "summary"): `[<tool>] <system> (<times>) <what it does>` — sorted by name the list groups by tool, system, then time of day.
 * NEVER rename `name` (it is the path of the script and of its schedule: a new path would create a second copy while the old schedule keeps running).
 * Each schedule: `legacy` = HotelTime schedule of the old regime (disabled while rounds are on) · `slot` = the old snapshot slot it belongs to · `round` = the round it belongs to.
 */
export const JOBS = [
  { name: 'pms_export_daily', summary: '[Exporter] HotelTime (12.00) Daily', schedules: [{ cron: DAILY_CRON, legacy: true }] },
  { name: 'pms_export_daily_catchup', summary: '[Exporter] HotelTime (15.00, 18.00) Catch-up', schedules: [{ cron: CATCHUP_CRON, legacy: true }] },
  { name: 'foodstory_export_daily', summary: '[Exporter] FoodStory (12.00) Daily', timeout: FOODSTORY_TIMEOUT_S, schedules: [{ cron: DAILY_CRON }] },
  { name: 'foodstory_export_daily_catchup', summary: '[Exporter] FoodStory (15.00, 18.00) Catch-up', timeout: FOODSTORY_TIMEOUT_S, schedules: [{ cron: CATCHUP_CRON }] },
  // Extra HotelTime snapshot rounds (ADR-0013) — the old regime. Always registered; each run exits at once (no login) unless the slot is listed in HOTELTIME_SNAPSHOT_SLOTS
  {
    name: 'pms_export_snapshot_0600',
    summary: '[Exporter] HotelTime (06.00, 06.30) Extra snapshots',
    schedules: [
      { cron: '0 0 6 * * *', legacy: true, summary: '[Exporter] HotelTime (06.00) Extra snapshots' },
      { suffix: 'retry', cron: '0 30 6 * * *', legacy: true, summary: '[Exporter] HotelTime (06.30) Extra snapshots, retry' },
    ],
  },
  {
    name: 'pms_export_snapshot_2300',
    summary: '[Exporter] HotelTime (23.00, 23.30) Extra snapshots',
    schedules: [
      { cron: '0 0 23 * * *', legacy: true, summary: '[Exporter] HotelTime (23.00) Extra snapshots' },
      { suffix: 'retry', cron: '0 30 23 * * *', legacy: true, summary: '[Exporter] HotelTime (23.30) Extra snapshots, retry' },
    ],
  },
  // Extraction rounds (ADR-0014): ONE script, a schedule per round + a retry 30 minutes later (the retry finds nothing to do when the first run took everything).
  // The script works out which round it is from the Thai clock; only the 12:00 round runs the upload step.
  {
    name: 'pms_export_round',
    summary: '[Exporter] HotelTime (04.00–23.00) Extraction rounds',
    schedules: ROUND_HOURS.flatMap((hh, i) => [
      { ...(i === 0 ? {} : { suffix: `r${hh}` }), cron: cronAt(hh, 0), round: hh, always: true, summary: `[Exporter] HotelTime (${hh}.00) Extraction round` },
      { suffix: `r${hh}retry`, cron: cronAt(hh, 30), round: hh, always: true, summary: `[Exporter] HotelTime (${hh}.30) Extraction round, retry` },
    ]),
  },
];

/**
 * Data pipeline (hoteltime-schema): registered only when the pipeline bundle is installed. One script, several schedules; the first schedule keeps the script's own path.
 * Legacy: 19:00 (after the 18:00 re-take), 12:45, and the slot ones 06:20 / 23:20. Rounds: 20 and 50 minutes after each enabled round — the second covers the :30 retry (the pipeline has nothing new to ingest from a round that is off).
 * Windmill's cron parser counts days of the week 1-7 with Sunday = 1, so a classic `0` is rejected — use names (SUN).
 */
export const PIPELINE_JOBS = [
  {
    name: 'ht_pipeline_daily',
    summary: '[Pipeline] HotelTime (every round + 20 min) Bronze→Silver→Gold→D1',
    timeout: PIPELINE_TIMEOUT_S,
    schedules: [
      { cron: '0 0 19 * * *', legacy: true, summary: '[Pipeline] HotelTime (19.00) Bronze→Silver→Gold→D1' },
      { suffix: '1245', cron: '0 45 12 * * *', legacy: true, summary: '[Pipeline] HotelTime (12.45) Bronze→Silver→Gold→D1' },
      { suffix: '0620', cron: '0 20 6 * * *', legacy: true, slot: '06', summary: '[Pipeline] HotelTime (06.20) Bronze→Silver→Gold→D1, after the 06.00 round' },
      { suffix: '2320', cron: '0 20 23 * * *', legacy: true, slot: '23', summary: '[Pipeline] HotelTime (23.20) Bronze→Silver→Gold→D1, after the 23.00 round' },
      // +20 minutes after each round, and again at +50 (after the :30 retry): a round whose first run failed and whose retry succeeded would otherwise wait for the next round's pipeline
      ...ROUND_HOURS.flatMap((hh) => [
        { suffix: `r${hh}`, cron: cronAt(hh, 20), round: hh, summary: `[Pipeline] HotelTime (${hh}.20) Bronze→Silver→Gold→D1, after the ${hh}.00 round` },
        { suffix: `r${hh}b`, cron: cronAt(hh, 50), round: hh, summary: `[Pipeline] HotelTime (${hh}.50) Bronze→Silver→Gold→D1, after the ${hh}.30 retry` },
      ]),
    ],
  },
  { name: 'ht_pipeline_weekly_verify', summary: '[Pipeline] HotelTime (Sun 00.30) Weekly full check of Silver', timeout: PIPELINE_TIMEOUT_S, schedules: [{ cron: '0 30 0 * * SUN' }] },
];

/**
 * Every schedule Windmill should have, with whether it must be enabled · `create: false` = do not create it when it does not exist yet (a schedule that is off and was never registered)
 * `rounds` = hours switched on (HOTELTIME_ROUNDS) · `slots` = HOTELTIME_SNAPSHOT_SLOTS · `pipelineInstalled` = the pipeline bundle exists on this machine
 */
export function desiredSchedules({ rounds, slots, pipelineInstalled }) {
  const out = [];
  for (const job of [...JOBS, ...(pipelineInstalled ? PIPELINE_JOBS : [])]) {
    for (const s of job.schedules) {
      let enabled = true;
      if (s.legacy) enabled = rounds.length === 0 && (s.slot === undefined || slots.includes(s.slot));
      else if (s.round !== undefined && !s.always) enabled = rounds.includes(s.round);
      out.push({ job, suffix: s.suffix, cron: s.cron, summary: s.summary ?? job.summary, enabled, // a legacy slot schedule that is off is not created (as before: a pipeline schedule for a slot that was never switched on is never registered); off + already registered = switched off
      create: enabled || s.always === true || (s.legacy === true && s.slot === undefined) });
    }
  }
  return out;
}
