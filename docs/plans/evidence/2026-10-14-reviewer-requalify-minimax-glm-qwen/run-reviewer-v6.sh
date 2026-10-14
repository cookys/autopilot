#!/usr/bin/env bash
# run-reviewer-v6.sh <muse-low|muse-high|qwen> — one reviewer v6 (reviewer-metamorphic-v6) administration, then record the row.
# Launch: setsid nohup bash run-reviewer-v6.sh <seat> > /dev/null 2>&1 &    Progress: out/progress-rv6-<seat>.log
# Effort is sent for real: muse via QRP_HTTP_EFFORT (responses), qwen via QRP_CLI_EFFORT (--reasoning-effort). --raw-dir keeps reviewer-exchanges.jsonl.
# transport_fail is not a verdict: rename -attempt<N>-transport and re-sit (max 3). rc=3 stops. wall_truncated flagged.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"; O="$HERE/out"
SEAT="${1:?seat}"; P="$O/progress-rv6-$SEAT.log"; note() { echo "$(date -Is) $*" >> "$P"; }
case "$SEAT" in
  muse-low)  CMD=(bash "$HERE/cellmuse.sh" reviewer low);  d="$O/m-muse-low-reviewer";;
  muse-high) CMD=(bash "$HERE/cellmuse.sh" reviewer high); d="$O/m-muse-high-reviewer";;
  qwen)      CMD=(bash "$HERE/cellx.sh" qwen reviewer);    d="$O/m-qwen-reviewer";;
  *) echo "bad seat" >&2; exit 2;;
esac
note "SEAT $SEAT START HEAD=$(git -C "$REPO" rev-parse --short HEAD) generator=$(grep -o "reviewer-metamorphic-v[0-9]*" "$REPO/evals/reviewer-eval-generator.js" | head -1)"
n=1
while :; do
  t0=$(date +%s); note "SEAT $SEAT sitting=$n"
  "${CMD[@]}" > /dev/null 2>&1; rc=$?; secs=$(( $(date +%s) - t0 ))
  note "SEAT $SEAT END rc=$rc secs=$secs"
  [ "$rc" = 3 ] && { note "SEAT $SEAT credential/route unusable"; exit 0; }
  if cat "$d/stderr.log" "$d/stdout.json" 2>/dev/null | grep -q '"outcome":"transport_fail"' && [ "$n" -lt 3 ]; then
    mv "$d" "$d-attempt$n-transport"; note "SEAT $SEAT transport_fail is not a verdict; renamed, re-sitting"; n=$((n+1)); continue
  fi
  break
done
if cat "$d/stderr.log" "$d/stdout.json" "$d/emit-row.json" 2>/dev/null | grep -q 'wall_truncated":true'; then note "SEAT $SEAT WALL_TRUNCATED"; fi
if [ -s "$d/emit-row.json" ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$d/emit-row.json" 2>/dev/null; then
  ( cd "$REPO" && node scripts/engine-scorecard.js record --file "$d/emit-row.json" > "$d/record-out.json" 2> "$d/record-err.log" ); rrc=$?
  note "SEAT $SEAT RECORDED rc=$rrc event=$(grep -o '"event_id":[0-9]*' "$d/record-out.json" | tail -1) summary=$(node -e 'const r=require(process.argv[1]);console.log(JSON.stringify(r.quality||{}).slice(0,400),r.status,r.effort)' "$d/emit-row.json" 2>/dev/null) err=$(head -c 200 "$d/record-err.log" | tr '\n' ' ')"
else
  note "SEAT $SEAT no emit-row (not recorded); stderr: $(head -c 300 "$d/stderr.log" | tr '\n' ' ')"
fi
note "SEAT $SEAT DONE"
