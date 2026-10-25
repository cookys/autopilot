#!/usr/bin/env bash
# Stub of scripts/dispatch-hetero.sh for the findings-batch eval fixture: logs the dispatch, does nothing else.
set -eu
# Fixture ledger (fbatch/cell.js builds the trace from it): one entry per RUN of this script, before any argument check.
node "$(dirname "$0")/_ledger.js" call dispatch-hetero.sh "$@"
[ "${1:-}" = "--repair" ] && [ -n "${2:-}" ] && [ -n "${3:-}" ] || { echo "usage: dispatch-hetero.sh --repair <lane|pool> <finding-ids>" >&2; exit 2; }
mkdir -p runs
n=$(( $(grep -c . runs/dispatch.log 2>/dev/null || true) + 1 ))
printf 'repair %s %s\n' "$2" "$3" >> runs/dispatch.log
echo "repair dispatched: target=$2 ids=$3 (results land at runs/repair-$n.exit)"
