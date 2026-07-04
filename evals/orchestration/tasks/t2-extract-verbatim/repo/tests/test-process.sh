#!/usr/bin/env bash
set -euo pipefail
# Run process-data.sh with logs.jsonl and check if it succeeds
./bin/process-data.sh < data/logs.jsonl > /dev/null
echo "test-process.sh passed"
