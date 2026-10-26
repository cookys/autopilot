#!/usr/bin/env bash
# Stub of scripts/dispatch-acceptance.sh for the findings-batch eval fixture.
set -eu
# Fixture ledger (fbatch/cell.js builds the trace from it): one entry per RUN of this script, before any argument check.
node "$(dirname "$0")/_ledger.js" call dispatch-acceptance.sh "$@"
[ "${1:-}" = "--sha" ] && [ -n "${2:-}" ] || { echo "usage: dispatch-acceptance.sh --sha <sha>" >&2; exit 2; }
mkdir -p runs
label=$(node "$(dirname "$0")/_land.js" register --kind acceptance --sha "$2")
printf 'acceptance %s\n' "$2" >> runs/dispatch.log
echo "acceptance dispatched on $2 (results land at runs/$label.exit)"
