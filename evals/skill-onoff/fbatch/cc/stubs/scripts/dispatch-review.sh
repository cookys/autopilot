#!/usr/bin/env bash
# Stub of scripts/dispatch-review.sh for the findings-batch eval fixture.
set -eu
# Fixture ledger (fbatch/cell.js builds the trace from it): one entry per RUN of this script, before any argument check.
node "$(dirname "$0")/_ledger.js" call dispatch-review.sh "$@"
mode=review; sha=""
while [ $# -gt 0 ]; do
  case "$1" in
    --re-review) mode=re-review; shift ;;
    --blind) shift ;;
    --sha) sha="${2:-}"; shift 2 ;;
    *) echo "usage: dispatch-review.sh [--re-review --blind] --sha <sha>" >&2; exit 2 ;;
  esac
done
[ -n "$sha" ] || { echo "usage: dispatch-review.sh [--re-review --blind] --sha <sha>" >&2; exit 2; }
mkdir -p runs
label=$(node "$(dirname "$0")/_land.js" register --kind "$mode" --sha "$sha")
printf '%s %s\n' "$mode" "$sha" >> runs/dispatch.log
echo "$mode dispatched on $sha (results land at runs/$label.exit)"
