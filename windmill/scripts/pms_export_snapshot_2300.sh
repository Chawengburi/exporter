#!/bin/bash
set -euo pipefail
# HotelTime extra snapshot round at 23:00 Thai time (ADR-0013): takes the snapshot reports again, nothing else (no per-day reports, no back-fill). A second schedule 30 minutes later
# runs this same script as the retry — it finds nothing to do (no login, no browser) when the first run took every report.
# HOTELTIME_SNAPSHOT_SLOTS in exporter/.env must list 23, otherwise the export exits at once without logging in — that setting is the on/off switch.
# the job runs as root inside the container, so files written to data/ belong to root on the host (real Ubuntu) and whoever runs the exporter from a Terminal or the FoodStory icon cannot overwrite them
# in every case (including failure) at the end, give ownership back to match the data folder itself · on a Mac (Docker Desktop) this has no effect, hence `|| true`
trap 'chown -R --reference=/workspace/exporter/data /workspace/exporter/data /workspace/exporter/recon/captures 2>/dev/null || true' EXIT
cd /workspace/exporter
# a failed report (exit 1/2) must not skip uploading the files that were taken (the same lesson as the FoodStory scripts, 2026-11-02): keep the exit code, upload, then end with it
export_rc=0
node src/index.ts export --report all --snapshot-slot 23 --json || export_rc=$?
# `|| true`: leftover/rejected files in the upload must not make Windmill see the whole job as failed — they are reported through the upload leg's Discord + the backlog of `exporter status`
node src/index.ts upload --site hoteltime --json || true
exit "$export_rc"
