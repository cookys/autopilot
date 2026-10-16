#!/usr/bin/env bash
# run-muse.sh — Muse Spark 1.3 (opencode-go) cells, serial: consult discuss brain verification_author implementer. No reviewer.
# Launch: setsid nohup bash run-muse.sh > /dev/null 2>&1 &    Progress: out/progress-muse.log
# Same rules as run-batch2.sh: transport_fail is not a verdict (rename -attempt<N>-transport, re-sit, max 3); rc=3 stops the family;
# real verdicts are recorded with `engine-scorecard.js record --file` (owner approved); wall_truncated flagged.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"; O="$HERE/out"
P="$O/progress-muse.log"
note() { echo "$(date -Is) $*" >> "$P"; }
note "FAMILY muse START HEAD=$(git -C "$REPO" rev-parse --short HEAD)"
for r in consult discuss brain verification_author implementer; do
  d="$O/m-muse-$r"; n=1
  while :; do
    t0=$(date +%s); note "cell muse $r START sitting=$n"
    bash "$HERE/cellmuse.sh" "$r" > /dev/null 2>&1; rc=$?
    secs=$(( $(date +%s) - t0 ))
    note "cell muse $r END rc=$rc secs=$secs (out/m-muse-$r/)"
    [ "$rc" = 3 ] && { note "credential unusable, family stopped"; note "FAMILY muse DONE"; exit 0; }
    if cat "$d/stderr.log" "$d/stdout.json" 2>/dev/null | grep -q '"outcome":"transport_fail"' && [ "$n" -lt 3 ]; then
      mv "$d" "$d-attempt$n-transport"; note "cell muse $r transport_fail is not a verdict; renamed -attempt$n-transport, re-sitting"; n=$((n+1)); continue
    fi
    break
  done
  if cat "$d/stderr.log" "$d/stdout.json" "$d/emit-row.json" 2>/dev/null | grep -q 'wall_truncated":true'; then note "cell muse $r WALL_TRUNCATED"; fi
  if [ -s "$d/emit-row.json" ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$d/emit-row.json" 2>/dev/null; then
    ( cd "$REPO" && node scripts/engine-scorecard.js record --file "$d/emit-row.json" > "$d/record-out.json" 2> "$d/record-err.log" ); rrc=$?
    note "cell muse $r RECORDED rc=$rrc event=$(grep -o '"event_id":[0-9]*' "$d/record-out.json" | head -1) summary=$(node -e 'const r=require(process.argv[1]);console.log(JSON.stringify(r.quality||{}).slice(0,300),r.status)' "$d/emit-row.json" 2>/dev/null) err=$(head -c 200 "$d/record-err.log" | tr '\n' ' ')"
  else
    note "cell muse $r no emit-row (not recorded); stderr: $(head -c 300 "$d/stderr.log" | tr '\n' ' ')"
  fi
done
note "FAMILY muse DONE"
