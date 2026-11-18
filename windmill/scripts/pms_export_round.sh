#!/bin/bash
set -euo pipefail
# HotelTime extraction round (ADR-0014): snapshot reports + today's per-day reports (+ yesterday's re-take at 08/12, + catch-up) in ONE browser session.
# Windmill runs this at 04, 08, 12, 16, 20 and 23 Thai time, and again 30 minutes later as the retry (the retry finds nothing to do — no login — when the first run took everything).
# The round is worked out from the Thai clock (the latest round hour that has started), so a run that Windmill starts late (queue) still belongs to its own round.
# HOTELTIME_ROUNDS in exporter/.env is the on/off switch: a round that is not listed exits at once without logging in, and a run outside the round's time window does nothing.
# Only the 12:00 round runs the upload step (yesterday's per-day files, and only the 23:00 snapshot of yesterday) — see core/raw-manifest.ts `upload` flags.
# the job runs as root inside the container, so files written to data/ belong to root on the host (real Ubuntu) and whoever runs the exporter from a Terminal or the FoodStory icon cannot overwrite them
# in every case (including failure) at the end, give ownership back to match the data folder itself · on a Mac (Docker Desktop) this has no effect, hence `|| true`
trap 'chown -R --reference=/workspace/exporter/data /workspace/exporter/data /workspace/exporter/recon/captures 2>/dev/null || true' EXIT
cd /workspace/exporter
HH=$(TZ=Asia/Bangkok date +%H)
ROUND=23 # 00:00–03:59 can only be a late run of the 23:00 round (its window has closed, so the export exits at once)
for r in 04 08 12 16 20 23; do
  if [ "$((10#$HH))" -ge "$((10#$r))" ]; then ROUND=$r; fi
done
# a failed report (exit 1/2) must not skip uploading the files that were taken: keep the exit code, upload, then end with it
export_rc=0
out=$(node src/index.ts export --report all --round "$ROUND" --json) || export_rc=$?
printf '%s\n' "$out"
# the upload belongs to the 12:00 round only AND only when that round really ran: a round that is switched off (HOTELTIME_ROUNDS=off while the old schedule is still in use, or 12 not listed)
# or outside its time window must not upload — the old regime has its own upload
if [ "$ROUND" = "12" ] && ! printf '%s' "$out" | grep -qE '"code": *"(round_disabled|round_window_passed)"'; then
  # `|| true`: leftover/rejected files in the upload must not make Windmill see the whole job as failed — they are reported through the upload leg's Discord + the backlog of `exporter status`
  node src/index.ts upload --site hoteltime --json || true
fi
exit "$export_rc"
