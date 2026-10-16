#!/usr/bin/env bash
# dry-k28.sh — parameter-layer dry run of the kimi28 cells (all six roles; no network, no spend).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; export DRY_RUN=1
for r in reviewer verification_author implementer consult discuss brain; do
  bash "$HERE/cellk28.sh" "$r" > /dev/null 2>&1; rc=$?
  echo "kimi28 $r dry-rc=$rc :: $(tail -3 "$HERE/out/dry-m-kimi28-$r/run.log" | head -c 420 | tr '\n' '|')"
  [ -s "$HERE/out/dry-m-kimi28-$r/stderr.log" ] && echo "   stderr: $(head -c 260 "$HERE/out/dry-m-kimi28-$r/stderr.log" | tr '\n' ' ')"
done
