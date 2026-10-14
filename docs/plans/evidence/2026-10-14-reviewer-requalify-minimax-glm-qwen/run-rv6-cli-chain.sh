#!/usr/bin/env bash
# run-rv6-cli-chain.sh <chain-name> <item>...   items: <codex|grok>:<model>:<effort>
# Serial reviewer v6 administrations (generator reviewer-metamorphic-v6) via cell-cli-rv6.sh, each recorded with engine-scorecard.js record.
# Launch: setsid nohup bash run-rv6-cli-chain.sh <name> <items...> > /dev/null 2>&1 &    Progress: out/progress-rv6-cli-<name>.log
# Effort is sent for real through QRP_CLI_EFFORT. transport_fail is not a verdict: rename -attempt<N>-transport, re-sit (max 3).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"; O="$HERE/out"
NAME="${1:?name}"; shift
P="$O/progress-rv6-cli-$NAME.log"; note() { echo "$(date -Is) $*" >> "$P"; }
for item in "$@"; do
  IFS=: read -r kind a b <<< "$item"
  d="$O/rv6-$a-$b"; CMD=(bash "$HERE/cell-cli-rv6.sh" "$kind" "$a" "$b")
  n=1
  while :; do
    t0=$(date +%s); note "ITEM $item START sitting=$n generator=$(grep -o 'reviewer-metamorphic-v[0-9]*' "$REPO/evals/reviewer-eval-generator.js" | head -1)"
    "${CMD[@]}" > /dev/null 2>&1; rc=$?; secs=$(( $(date +%s) - t0 ))
    note "ITEM $item END rc=$rc secs=$secs dir=${d#$O/}"
    if cat "$d/stderr.log" "$d/stdout.json" 2>/dev/null | grep -q '"outcome":"transport_fail"' && [ "$n" -lt 3 ]; then
      k=$n; while [ -e "$d-attempt$k-transport" ]; do k=$((k+1)); done; mv "$d" "$d-attempt$k-transport"; note "ITEM $item transport_fail is not a verdict; renamed, re-sitting"; n=$((n+1)); continue
    fi
    break
  done
  if cat "$d/stderr.log" "$d/stdout.json" 2>/dev/null | grep -q 'wall_truncated":true'; then note "ITEM $item WALL_TRUNCATED"; fi
  if [ -s "$d/emit-row.json" ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$d/emit-row.json" 2>/dev/null; then
    ( cd "$REPO" && node scripts/engine-scorecard.js record --file "$d/emit-row.json" > "$d/record-out.json" 2> "$d/record-err.log" ); rrc=$?
    note "ITEM $item RECORDED rc=$rrc event=$(grep -o '"event_id":[0-9]*' "$d/record-out.json" | tail -1) summary=$(node -e 'const r=require(process.argv[1]);console.log(JSON.stringify(r.quality||{}).slice(0,400),r.status,r.effort)' "$d/emit-row.json" 2>/dev/null) err=$(head -c 200 "$d/record-err.log" | tr '\n' ' ')"
  else
    note "ITEM $item no emit-row (not recorded); stderr: $(head -c 300 "$d/stderr.log" | tr '\n' ' ')"
  fi
done
note "CHAIN $NAME DONE"
