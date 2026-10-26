#!/usr/bin/env bash
# chain.sh <lane:role>...  -- serial sittings (never two exams at once); one summary line per sitting in chain.log.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for lr in "$@"; do
  l="${lr%%:*}"; r="${lr#*:}"
  bash "$HERE/sit.sh" "$l" "$r"; rc=$?
  log="$HERE/out/$l-$r/intake.log"
  echo "$(date -Is) $l $r rc=$rc $(grep -oE 'engine-qualify exit [0-9]+ \([a-z_]+\)|publish exit [0-9]+' "$log" | tr '\n' ' ')" >> "$HERE/chain.log"
done
echo "$(date -Is) CHAIN DONE" >> "$HERE/chain.log"
