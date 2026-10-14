#!/usr/bin/env bash
# run-impl-luna.sh -- gpt-6-luna implementer re-exams (codex), medium then low, serial. Latest corpus pins
# (16b45e1a / d8af5290 / 2c1042fc, unchanged since 2026-09-03). Sweep probes, administers and records each seat.
# Progress: out/progress-impl-luna.log. Run detached: setsid nohup bash run-impl-luna.sh > /dev/null 2>&1 &
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
mkdir -p "$HERE/out"; LOG="$HERE/out/progress-impl-luna.log"
note() { echo "$(date -Is) $*" >> "$LOG"; }
cd "$REPO" || exit 2
for e in medium low; do
  note "ITEM impl-luna-$e START"
  bash scripts/qualification-sweep.sh --roster "$HERE/roster-impl-luna-$e.json" --execute --yes \
    --progress "$HERE/impl-luna-$e/progress.txt" > "$HERE/out/impl-luna-$e.log" 2>&1
  rc=$?
  note "ITEM impl-luna-$e END rc=$rc $(tail -n 1 "$HERE/impl-luna-$e/progress.txt" 2>/dev/null | cut -c1-300)"
done
note "CHAIN impl-luna DONE"
