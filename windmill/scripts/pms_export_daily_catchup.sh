#!/bin/bash
set -euo pipefail
# the job runs as root inside the container, so files written to data/ belong to root on the host (real Ubuntu) and whoever runs the exporter from a Terminal or the FoodStory icon cannot overwrite them
# in every case (including failure) at the end, give ownership back to match the data folder itself · on a Mac (Docker Desktop) this has no effect, hence `|| true`
trap 'chown -R --reference=/workspace/exporter/data /workspace/exporter/data /workspace/exporter/recon/captures 2>/dev/null || true' EXIT
cd /workspace/exporter
node src/index.ts export --report all --daily --json
# ticket 07 of exporter-upload-to-uploader — a separate command with its own exit path from the export step above (decided in the spec)
# `|| true`: if the export fails, set -e stops the script before reaching this line (correct — that is still an export problem), but if the export
# passed and the upload has files left over/rejected (exit is not 0), that must not make Windmill see the whole job as failed — those files go into the
# backlog (ticket 06, exporter status) for the next run or a person's manual run to handle; it is not a problem of this run
node src/index.ts upload --site hoteltime --json || true
