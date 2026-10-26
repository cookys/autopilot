#!/usr/bin/env bash
# run-all.sh : probes a, b, c in order, then summary.json. Stops launching new claude calls once the cumulative
# total_cost_usd reaches PROBE_MAX_USD (default 1.0).
#   real run (depth-0 only):  PROBE_PAID=1 OUT=/abs/dir bash run-all.sh
#   dry run:                  PROBE_CLAUDE_BIN=<fake claude> PROBE_CREDS_SRC=<fake creds> OUT=<dir> bash run-all.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OUT="${OUT:-$HERE/raw}"
for p in a b c; do
  bash "$HERE/probe.sh" "$p"; rc=$?
  [ "$rc" -ge 3 ] && { echo "probe $p aborted rc=$rc" >&2; exit "$rc"; }
done
node "$HERE/summarize.js" "$OUT" > /dev/null && echo "summary: $OUT/summary.json"
