#!/bin/bash
set -euo pipefail
# FoodStory daily/catch-up run on Windmill (exporter-foodstory-scheduled-daily ticket 04) — the same pattern as HotelTime's pms_export_daily.sh
# TWOCAPTCHA_API_KEY must be in exporter/.env (ADR-0010) — if it is missing, login fails immediately (ticket 03), then the failure is recorded and Discord is told that login failed (ticket 02)
# the job runs as root inside the container, so files written to data/ belong to root on the host (real Ubuntu) and whoever runs the exporter from a Terminal or the FoodStory icon cannot overwrite them
# in every case (including failure) at the end, give ownership back to match the data folder itself · on a Mac (Docker Desktop) this has no effect, hence `|| true`
trap 'chown -R --reference=/workspace/exporter/data /workspace/exporter/data /workspace/exporter/recon/captures 2>/dev/null || true' EXIT
cd /workspace/exporter
# the worker has no display — force headless over the value in .env (FOODSTORY_HEADLESS=false, used for debugging, would stop Chromium from opening in the container) · the shell's env wins over .env
# 🔴 an export that fails some reports (exit 1) must not skip uploading the files that were exported successfully (really broke on 2026-11-02: reservation-report failed ->
# set -e stopped before upload -> nothing reached the uploader for several days) · keep the exit code and end the job with that value so Windmill still sees that this run had a problem
export_rc=0
FOODSTORY_HEADLESS=true node src/index.ts export --site foodstory --report all --daily --json || export_rc=$?
# `|| true`: the upload has files left over/rejected
# that must not make Windmill see the whole job as failed — it is reported through the upload leg's Discord + the backlog of `exporter status` for the next run to handle (same as HotelTime)
node src/index.ts upload --site foodstory --json || true
exit "$export_rc"
