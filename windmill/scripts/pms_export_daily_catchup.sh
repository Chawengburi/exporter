#!/bin/bash
set -euo pipefail
cd /workspace/exporter
node src/index.ts export --report all --daily --retry-failed --json
