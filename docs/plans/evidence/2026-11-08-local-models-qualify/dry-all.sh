#!/usr/bin/env bash
# dry-all.sh — parameter-layer dry run of all 8 cells (no network, no spend). Prints rc and any stderr.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; export DRY_RUN=1
for c in "$HERE"/cell-qwen-*.sh "$HERE"/cell-glm-*.sh; do
  n="$(basename "$c" .sh)"; bash "$c" < /dev/null > /dev/null 2>&1; rc=$?
  l="${n#cell-}"; l="${l%%-*}"; r="${n##*-}"; [ "$r" = author ] && r=verification_author
  echo "$n dry-rc=$rc"
  f="$HERE/out/dry-$l-$r/stderr.log"; [ -s "$f" ] && { echo "  stderr: $(head -c 400 "$f" | tr '\n' ' ')"; grep -il "effort.*mismatch" "$f" > /dev/null && echo "  !! effort mismatch"; }
done
