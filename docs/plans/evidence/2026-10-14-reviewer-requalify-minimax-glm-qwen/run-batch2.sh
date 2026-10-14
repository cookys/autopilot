#!/usr/bin/env bash
# run-batch2.sh <glm|minimax|qwen|kimi> — consult/discuss/brain cells, after develop 1bfcc42d (run-to-completion). Serial within a family.
# Launch: setsid nohup bash run-batch2.sh <family> > /dev/null 2>&1 &    Progress: out/progress2-<family>.log
# A real verdict (rc 0/1, no transport_fail) with an emit-row is recorded with `engine-scorecard.js record --file` (owner approved).
# transport_fail is not a verdict: dir renamed -attempt<N>-transport and the cell re-sat (max 3). rc=3 (credential) skips the rest of the family.
# wall_truncated rows are recorded as-is and flagged WALL_TRUNCATED in the progress file.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"; O="$HERE/out"
FAM="${1:?family}"; P="$O/progress2-$FAM.log"
note() { echo "$(date -Is) $*" >> "$P"; }
case "$FAM" in
  glm)     CELLS="glm:consult glm:discuss glm:brain";;
  minimax) CELLS="minimax:discuss minimax:brain minimax31:consult minimax31:discuss minimax31:brain";;
  qwen)    CELLS="qwen:discuss qwen:brain";;
  kimi)    CELLS="kimi:discuss kimi:brain kimi28:consult kimi28:discuss kimi28:brain";;
  *) echo "bad family" >&2; exit 2;;
esac
note "FAMILY $FAM START cells=[$CELLS] HEAD=$(git -C "$REPO" rev-parse --short HEAD)"
credfail=0
for c in $CELLS; do
  l="${c%%:*}"; r="${c##*:}"; d="$O/m-$l-$r"
  [ "$credfail" = 1 ] && { note "cell $l $r SKIPPED (credential unusable)"; continue; }
  n=1
  while :; do
    t0=$(date +%s); note "cell $l $r START sitting=$n"
    if [ "$l" = kimi28 ]; then bash "$HERE/cellk28.sh" "$r" > /dev/null 2>&1; rc=$?; else bash "$HERE/cellx.sh" "$l" "$r" > /dev/null 2>&1; rc=$?; fi
    secs=$(( $(date +%s) - t0 ))
    note "cell $l $r END rc=$rc secs=$secs (out/m-$l-$r/)"
    [ "$rc" = 3 ] && { credfail=1; break; }
    if cat "$d/stderr.log" "$d/stdout.json" 2>/dev/null | grep -q '"outcome":"transport_fail"' && [ "$n" -lt 3 ]; then
      mv "$d" "$d-attempt$n-transport"; note "cell $l $r transport_fail is not a verdict; renamed -attempt$n-transport, re-sitting"; n=$((n+1)); continue
    fi
    break
  done
  [ "$credfail" = 1 ] && continue
  if cat "$d/stderr.log" "$d/stdout.json" "$d/emit-row.json" 2>/dev/null | grep -q 'wall_truncated":true'; then note "cell $l $r WALL_TRUNCATED"; fi
  if [ -s "$d/emit-row.json" ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$d/emit-row.json" 2>/dev/null; then
    ( cd "$REPO" && node scripts/engine-scorecard.js record --file "$d/emit-row.json" > "$d/record-out.json" 2> "$d/record-err.log" ); rrc=$?
    note "cell $l $r RECORDED rc=$rrc event=$(grep -o '"event_id":[0-9]*' "$d/record-out.json" | head -1) summary=$(node -e 'const r=require(process.argv[1]);console.log(JSON.stringify(r.quality||{}).slice(0,300),r.status)' "$d/emit-row.json" 2>/dev/null)"
  else
    note "cell $l $r no emit-row (not recorded); stderr: $(head -c 300 "$d/stderr.log" | tr '\n' ' ')"
  fi
done
note "FAMILY $FAM DONE"
