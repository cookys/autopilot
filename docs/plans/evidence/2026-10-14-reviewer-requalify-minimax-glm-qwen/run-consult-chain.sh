#!/usr/bin/env bash
# run-consult-chain.sh -- waits for the luna implementer chain, then sits gpt-6.1-sol consult @ codex low (max 3 sittings).
# A sitting with no emit-row (transport failure) is renamed to the next free -attemptN-transport dir and re-sat. Records real rows.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
LOG="$HERE/out/progress-consult.log"
note() { echo "$(date -Is) $*" >> "$LOG"; }
until grep -q "CHAIN impl-luna DONE" "$HERE/out/progress-impl-luna.log" 2>/dev/null; do sleep 20; done
M=gpt-6.1-sol; E=low; d="$HERE/out/consult-$M-$E"
n=1
while [ "$n" -le 3 ]; do
  note "ITEM consult-$M-$E START sitting=$n"
  bash "$HERE/cell-cli-consult.sh" "$M" "$E"; rc=$?
  if [ -s "$d/emit-row.json" ] && node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(r&&r.quality?0:1)' "$d/emit-row.json" 2>/dev/null; then
    note "ITEM consult-$M-$E END rc=$rc"
    cd "$REPO" && node scripts/engine-scorecard.js record --file "$d/emit-row.json" > "$d/record-out.json" 2> "$d/record-err.log"
    note "ITEM consult-$M-$E RECORDED rc=$? $(tr -d '\n' < "$d/record-out.json" | cut -c1-200) summary=$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(JSON.stringify(r.quality),r.status)' "$d/emit-row.json")"
    break
  fi
  note "ITEM consult-$M-$E transport_fail rc=$rc: $(tail -c 600 "$d/stderr.log" 2>/dev/null | tr '\n' ' ')"
  k=$n; while [ -e "$d-attempt$k-transport" ]; do k=$((k+1)); done
  mv "$d" "$d-attempt$k-transport"; n=$((n+1))
done
note "CHAIN consult DONE"
