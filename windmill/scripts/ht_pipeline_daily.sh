#!/bin/bash
set -euo pipefail
# Daily run of the data pipeline (repo hoteltime-schema), following the exporter:
# Bronze (xlsx) -> Silver -> checks -> Gold (local) -> D1 (Gold only) -> completeness check.
# Scheduled at 19:00, after the 15:00/18:00 catch-up runs and the 18:30 status (see setup.mjs).
#
# Paths inside the "custom" worker container (mounted in docker-compose.yml):
#   /workspace/pipeline        = pipeline code (read-only) + the real .env (chmod 600): CLOUDFLARE_API_TOKEN, DISCORD_WEBHOOK_URL, HT_D1_DATABASE
#   /workspace/pipeline-state  = silver.sqlite + last-run.json (read-write, on the host)
#   /workspace/exporter/data/hoteltime = Bronze (the pipeline only reads it)
# Windmill does not pass the container's env to jobs, so the values are read from the .env file here.
PIPE=/workspace/pipeline
STATE=/workspace/pipeline-state
mkdir -p "$STATE"
# The job runs as root, so files in pipeline-state would be owned by root on the host. On every exit, give them back
# to the owner of the pipeline folder (the installer). No effect on Mac, hence `|| true`.
trap 'chown -R --reference="$PIPE" "$STATE" 2>/dev/null || true' EXIT
[ -f "$PIPE/.env" ] || { echo "$PIPE/.env not found: install the pipeline bundle and fill in .env first" >&2; exit 2; }
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "python3 >= 3.10 is required in the worker" >&2; exit 2; }
set -a; . "$PIPE/.env"; set +a
cd "$PIPE"

rc=0
python3 -I pipeline/run_daily.py \
  --bronze /workspace/exporter/data/hoteltime \
  --silver "$STATE/silver.sqlite" \
  --database "$HT_D1_DATABASE" \
  --env "$PIPE/.env" --notify \
  --json "$STATE/last-run.json" || rc=$?

# run_daily exit codes: 0 pass | 1 pass with warnings (oracle / completeness; already sent to Discord) | 2 a step failed | 3 another run is active.
# Warnings must not turn the job red (otherwise it is red every day while the exporter still has days it cannot back-fill),
# so 0/1 = job succeeds, 2/3 = job fails.
if [ "$rc" -le 1 ]; then exit 0; fi
exit "$rc"
