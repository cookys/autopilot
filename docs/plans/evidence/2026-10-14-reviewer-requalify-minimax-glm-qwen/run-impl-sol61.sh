#!/usr/bin/env bash
# run-impl-sol61.sh -- gpt-6.1-sol implementer @ codex effort high (qualification-sweep.sh, same corpus pins as the luna runs).
# A sitting whose sweep wrote no DONE line (probe miss / transport failure) is renamed to the next free -attemptN-transport dir
# and re-sat, max 3 sittings. Progress: out/progress-impl-sol61.log.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
mkdir -p "$HERE/out"; LOG="$HERE/out/progress-impl-sol61.log"
note() { echo "$(date -Is) $*" >> "$LOG"; }
cd "$REPO" || exit 2
R="$HERE/impl-sol61-high"; n=1
while [ "$n" -le 3 ]; do
  note "ITEM impl-sol61-high START sitting=$n"
  bash scripts/qualification-sweep.sh --roster "$HERE/roster-impl-sol61-high.json" --execute --yes \
    --progress "$R/progress.txt" > "$HERE/out/impl-sol61-high-$n.log" 2>&1
  rc=$?
  if grep -q "SEAT gpt-6.1-sol-high DONE" "$R/progress.txt" 2>/dev/null; then
    note "ITEM impl-sol61-high END rc=$rc $(grep 'SEAT gpt-6.1-sol-high' "$R/progress.txt" | tail -n 1 | cut -c1-300)"; break
  fi
  note "ITEM impl-sol61-high transport_fail rc=$rc: $(tail -n 3 "$R/progress.txt" 2>/dev/null | tr '\n' ' ' | cut -c1-500)"
  k=$n; while [ -e "$R-attempt$k-transport" ]; do k=$((k+1)); done
  mv "$R" "$R-attempt$k-transport"; n=$((n+1))
done
note "CHAIN impl-sol61 DONE"
