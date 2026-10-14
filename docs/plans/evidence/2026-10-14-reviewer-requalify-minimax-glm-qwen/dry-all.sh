#!/usr/bin/env bash
# dry-all.sh — parameter-layer dry run of every planned matrix cell (no network, no staging, no spend).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DRY_RUN=1
CELLS="glm:consult glm:discuss glm:brain minimax:verification_author minimax:discuss minimax:brain
minimax31:verification_author minimax31:consult minimax31:discuss minimax31:brain minimax31:implementer
qwen:verification_author qwen:discuss qwen:brain
kimi:reviewer kimi:verification_author kimi:discuss kimi:brain kimi:implementer"
for c in $CELLS; do
  l="${c%%:*}"; r="${c##*:}"
  bash "$HERE/cellx.sh" "$l" "$r" > /dev/null 2>&1; rc=$?
  echo "$l $r dry-rc=$rc :: $(tail -3 "$HERE/out/dry-m-$l-$r/run.log" 2>/dev/null | head -c 300 | tr '\n' '|')"
  [ -s "$HERE/out/dry-m-$l-$r/stderr.log" ] && echo "   stderr: $(head -c 300 "$HERE/out/dry-m-$l-$r/stderr.log" | tr '\n' ' ')"
done
