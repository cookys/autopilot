#!/usr/bin/env bash
# run-muse-effort.sh <low|high> — Muse Spark 1.3 explicit-effort cells, serial: consult discuss brain verification_author implementer(low only).
# Launch: setsid nohup bash run-muse-effort.sh low > /dev/null 2>&1 &    Progress: out/progress-muse-<effort>.log
# Provider is the e6d5918e one: QRP_HTTP_PROTOCOL=responses + QRP_HTTP_EFFORT=<effort>, both in --provider-env, --effort label identical.
# RULE (coordinator 2026-10-14): a QUALIFIED brain row is NOT recorded (BL-0165); a failed brain row is. Other roles record as usual.
# transport_fail is not a verdict (rename -attempt<N>-transport, re-sit, max 3). rc=3 stops the family. wall_truncated flagged.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"; O="$HERE/out"
EFF="${1:?low|high}"; case "$EFF" in low|high) ;; *) echo "bad effort" >&2; exit 2;; esac
P="$O/progress-muse-$EFF.log"; note() { echo "$(date -Is) $*" >> "$P"; }
ROLES="consult discuss brain verification_author"; [ "$EFF" = low ] && ROLES="$ROLES implementer"
note "FAMILY muse-$EFF START HEAD=$(git -C "$REPO" rev-parse --short HEAD)"
for r in $ROLES; do
  d="$O/m-muse-$EFF-$r"; n=1
  while :; do
    t0=$(date +%s); note "cell muse-$EFF $r START sitting=$n"
    bash "$HERE/cellmuse.sh" "$r" "$EFF" > /dev/null 2>&1; rc=$?
    secs=$(( $(date +%s) - t0 ))
    note "cell muse-$EFF $r END rc=$rc secs=$secs (out/m-muse-$EFF-$r/)"
    [ "$rc" = 3 ] && { note "credential/route unusable, family stopped"; note "FAMILY muse-$EFF DONE"; exit 0; }
    if cat "$d/stderr.log" "$d/stdout.json" 2>/dev/null | grep -q '"outcome":"transport_fail"' && [ "$n" -lt 3 ]; then
      mv "$d" "$d-attempt$n-transport"; note "cell muse-$EFF $r transport_fail is not a verdict; renamed, re-sitting"; n=$((n+1)); continue
    fi
    break
  done
  if cat "$d/stderr.log" "$d/stdout.json" "$d/emit-row.json" 2>/dev/null | grep -q 'wall_truncated":true'; then note "cell muse-$EFF $r WALL_TRUNCATED"; fi
  if [ -s "$d/emit-row.json" ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$d/emit-row.json" 2>/dev/null; then
    if [ "$r" = brain ] && node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status==="qualified"?0:1)' "$d/emit-row.json"; then
      note "cell muse-$EFF $r QUALIFIED brain row HELD, not recorded (BL-0165); row kept at out/m-muse-$EFF-$r/emit-row.json"
    else
      ( cd "$REPO" && node scripts/engine-scorecard.js record --file "$d/emit-row.json" > "$d/record-out.json" 2> "$d/record-err.log" ); rrc=$?
      note "cell muse-$EFF $r RECORDED rc=$rrc event=$(grep -o '"event_id":[0-9]*' "$d/record-out.json" | tail -1) summary=$(node -e 'const r=require(process.argv[1]);console.log(JSON.stringify(r.quality||{}).slice(0,300),r.status,r.effort)' "$d/emit-row.json" 2>/dev/null) err=$(head -c 200 "$d/record-err.log" | tr '\n' ' ')"
    fi
  else
    note "cell muse-$EFF $r no emit-row (not recorded); stderr: $(head -c 300 "$d/stderr.log" | tr '\n' ' ')"
  fi
done
note "FAMILY muse-$EFF DONE"
