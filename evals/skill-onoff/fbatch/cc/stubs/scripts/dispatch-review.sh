#!/usr/bin/env bash
# Stub of scripts/dispatch-review.sh for the findings-batch eval fixture.
set -eu
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
printf '%s %s\n' "$mode" "$sha" >> runs/dispatch.log
echo "$mode dispatched on $sha (results land at runs/$mode-$sha.exit)"
