#!/usr/bin/env bash
# run-chain.sh <lane>...  -- sit the given lanes serially; on transport_fail rename the dir -attemptN-transport and re-sit (max 3 sittings).
# Progress: out/progress.log. Launch: setsid nohup bash run-chain.sh <lanes> > /dev/null 2>&1 < /dev/null &
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; O="$HERE/out"; mkdir -p "$O"; P="$O/progress.log"
note() { echo "$(date -Is) $*" >> "$P"; }
for lane in "$@"; do
  n=1
  while :; do
    t0=$(date +%s); note "$lane START sitting=$n"
    bash "$HERE/cell-owner.sh" "$lane" > /dev/null 2>&1; rc=$?
    d="$O/$lane"
    note "$lane END rc=$rc secs=$(( $(date +%s) - t0 ))"
    if [ "$rc" = 3 ]; then note "$lane credential unusable"; break; fi
    if cat "$d/stderr.log" "$d/stdout.json" 2>/dev/null | grep -q 'transport failure on\|"outcome":"transport_fail"' && [ "$n" -lt 3 ]; then
      mv "$d" "$d-attempt$n-transport"; note "$lane transport_fail, renamed -attempt$n-transport"; n=$((n+1)); continue
    fi
    break
  done
done
note "chain done: $*"
