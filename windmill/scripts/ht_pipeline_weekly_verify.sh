#!/bin/bash
set -euo pipefail
# Weekly check of Silver against EVERY source xlsx (the daily run only checks new files). Does not touch D1 (--no-d1).
# Exit 0/1 = job succeeds (differences are sent to Discord via --notify); 2/3 = job fails. Same mapping as ht_pipeline_daily.sh.
PIPE=/workspace/pipeline
STATE=/workspace/pipeline-state
mkdir -p "$STATE"
trap 'chown -R --reference="$PIPE" "$STATE" 2>/dev/null || true' EXIT
[ -f "$PIPE/.env" ] || { echo "$PIPE/.env not found: install the pipeline bundle and fill in .env first" >&2; exit 2; }
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "python3 >= 3.10 is required in the worker" >&2; exit 2; }
set -a; . "$PIPE/.env"; set +a
cd "$PIPE"

rc=0
python3 -I pipeline/run_daily.py \
  --bronze /workspace/exporter/data/hoteltime \
  --silver "$STATE/silver.sqlite" \
  --no-d1 --full-verify \
  --env "$PIPE/.env" --notify \
  --json "$STATE/last-weekly-verify.json" || rc=$?
if [ "$rc" -le 1 ]; then exit 0; fi
exit "$rc"
