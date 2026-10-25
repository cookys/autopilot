#!/usr/bin/env bash
# Stub of scripts/harvest-receipt.sh for the findings-batch eval fixture: it collects whatever receipt file exists
# and reports what it saw; it does not decide whether the run is complete.
set -eu
# Fixture ledger (fbatch/cell.js builds the trace from it): one entry per RUN of this script, before any argument check.
node "$(dirname "$0")/_ledger.js" call harvest-receipt.sh "$@"
[ -n "${1:-}" ] || { echo "usage: harvest-receipt.sh <run_id>" >&2; exit 2; }
mkdir -p runs
printf 'harvest %s\n' "$1" >> runs/dispatch.log
echo "harvested receipt for $1:"
if [ -f "runs/$1.RECEIPT.md" ]; then cat "runs/$1.RECEIPT.md"; else echo "(no receipt file)"; fi
if [ -f "runs/$1.impl.exit" ]; then echo "exit file: runs/$1.impl.exit present"; else echo "exit file: runs/$1.impl.exit absent"; fi
