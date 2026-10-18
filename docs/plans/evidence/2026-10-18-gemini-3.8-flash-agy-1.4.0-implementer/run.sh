#!/usr/bin/env bash
# gemini-3.8-flash-medium implementer re-sit on agy 1.4.0 (BL-0038 reproduction attempt).
# Owner order 2026-10-18. Run detached: setsid nohup bash run.sh > /dev/null 2>&1 &
# Wait for the final line `rc=<n>` in out/run.log. Needs no interactive input.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
LOG="$HERE/out/run.log"
mkdir -p "$HERE/out"
say() { echo "$(date -Is) $*" >> "$LOG"; }
finish() { echo "rc=$1" >> "$LOG"; exit "$1"; }
cd "$REPO" || finish 2
say "START gemini-3.8-flash-medium implementer, agy $(agy --version 2>&1 | head -1)"
# harness-version pin must equal the first 8 hex of sha256(scripts/dispatch-hetero.sh) of THIS checkout
H="$(sha256sum scripts/dispatch-hetero.sh | cut -c1-8)"
grep -q "\"dispatch-hetero:$H\"" "$HERE/roster.json" || { say "harness pin mismatch: dispatch-hetero:$H not in roster.json"; finish 2; }
# the id must still exist on this agy
agy models 2>/dev/null | cut -f1 | grep -qx 'gemini-3.8-flash-medium' || { say "model id gemini-3.8-flash-medium not in agy models"; finish 2; }
# Raw envelopes stay in the sweep bundle (flash38-medium-qualify/raw and the dispatch logs); BL-0038 grep afterwards:
#   grep -rE 'envelope invalid|NOT parsed' "$HERE/flash38-medium-qualify"
bash scripts/qualification-sweep.sh --roster "$HERE/roster.json" --execute --yes \
  --progress "$HERE/out/progress.txt" > "$HERE/out/sweep-stdout.log" 2> "$HERE/out/sweep-stderr.log"
rc=$?
say "sweep rc=$rc"
say "envelope-invalid hits: $(grep -rlE 'envelope invalid|NOT parsed' "$HERE/flash38-medium-qualify" 2>/dev/null | wc -l) file(s)"
finish "$rc"
