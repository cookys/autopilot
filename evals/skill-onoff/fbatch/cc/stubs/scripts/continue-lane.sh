#!/usr/bin/env bash
# Stub of scripts/continue-lane.sh for the findings-batch eval fixture: logs the call, takes no policy decision.
set -eu
[ -n "${1:-}" ] || { echo "usage: continue-lane.sh <lane>" >&2; exit 2; }
mkdir -p runs
printf 'continue %s\n' "$1" >> runs/dispatch.log
echo "continue-lane: lane $1 sent to its next phase"
