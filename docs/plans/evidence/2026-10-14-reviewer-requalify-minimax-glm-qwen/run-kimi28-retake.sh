#!/usr/bin/env bash
# run-kimi-retake.sh -- BL-0167 serial retake. Launch: setsid nohup bash run-kimi-retake.sh > /dev/null 2>&1 &  Progress: out/progress-kimi28-retake.log
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"; O="$HERE/out"; P="$O/progress-kimi28-retake.log"
note() { echo "$(date -Is) $*" >> "$P"; }
credfail=0
for c in kimi28:reviewer kimi28:discuss kimi28:brain kimi28:consult; do
  l="${c%%:*}"; r="${c##*:}"
  [ "$credfail" = 1 ] && { note "cell $c SKIPPED (credential unusable)"; continue; }
  if [ "$r" = reviewer ]; then t=k3; [ "$l" = kimi28 ] && t=k28; d="$O/rv6-kimi-$t-high"; else d="$O/m-$l-$r"; fi
  n=1
  while :; do
    t0=$(date +%s); note "cell $c START sitting=$n"
    if [ "$r" = reviewer ]; then bash "$HERE/cell-kimi-rv6.sh" "$l" > /dev/null 2>&1; rc=$?
    elif [ "$l" = kimi28 ]; then bash "$HERE/cellk28.sh" "$r" > /dev/null 2>&1; rc=$?
    else bash "$HERE/cellx.sh" "$l" "$r" > /dev/null 2>&1; rc=$?; fi
    note "cell $c END rc=$rc secs=$(( $(date +%s) - t0 )) dir=${d#$O/}"
    [ "$rc" = 3 ] && { credfail=1; break; }
    if cat "$d/stderr.log" "$d/stdout.json" 2>/dev/null | grep -q '"outcome":"transport_fail"' && [ "$n" -lt 3 ]; then
      mv "$d" "$d-attempt$n-transport"; note "cell $c transport_fail, renamed -attempt$n-transport, re-sitting"; n=$((n+1)); continue
    fi
    break
  done
  [ "$credfail" = 1 ] && continue
  if [ -s "$d/emit-row.json" ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$d/emit-row.json" 2>/dev/null; then
    ( cd "$REPO" && node scripts/engine-scorecard.js record --file "$d/emit-row.json" > "$d/record-out.json" 2> "$d/record-err.log" ); rrc=$?
    note "cell $c RECORDED rc=$rrc event=$(grep -o '"event_id":[0-9]*' "$d/record-out.json" | head -1) summary=$(node -e 'const r=require(process.argv[1]);console.log(JSON.stringify(r.quality||{}).slice(0,300),r.status)' "$d/emit-row.json" 2>/dev/null) err=$(head -c 200 "$d/record-err.log" | tr '\n' ' ')"
  else note "cell $c no emit-row; stderr: $(head -c 300 "$d/stderr.log" 2>/dev/null | tr '\n' ' ')"; fi
done
note "RETAKE DONE"
