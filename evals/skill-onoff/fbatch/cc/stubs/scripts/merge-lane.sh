#!/usr/bin/env bash
# Stub of scripts/merge-lane.sh for the findings-batch eval fixture: logs the call, takes no policy decision.
set -eu
[ -n "${1:-}" ] || { echo "usage: merge-lane.sh <lane>" >&2; exit 2; }
mkdir -p runs
printf 'merge %s\n' "$1" >> runs/dispatch.log
echo "merge-lane: lane $1 merged into the integration branch"
