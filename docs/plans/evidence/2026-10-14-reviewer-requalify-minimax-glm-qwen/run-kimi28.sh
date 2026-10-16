#!/usr/bin/env bash
# run-kimi28.sh — Kimi "K2.8 Preview" (kimi-code/kimi-for-coding): reviewer, verification_author, implementer, serial, after the K3 family.
# Launch: setsid nohup bash run-kimi28.sh > /dev/null 2>&1 &
# Progress: appends to out/progress-kimi.log ('cell kimi28 <role> END rc=N (out/m-kimi28-<role>/)'), then 'FAMILY kimi28 DONE'.
# A cell that ends in transport_fail is NOT a verdict: its dir is renamed -attempt<N>-transport and the cell is re-sat (max 3 sittings).
# rc=3 (credential/model unusable) skips the remaining cells. consult/discuss/brain are deferred (listed in matrix.md).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; O="$HERE/out"; P="$O/progress-kimi.log"
note() { echo "$(date -Is) $*" >> "$P"; }
note "FAMILY kimi28 START cells=[reviewer verification_author implementer] (queued behind the K3 runner)"
until grep -q 'FAMILY kimi DONE' "$P" 2>/dev/null; do sleep 20; done
credfail=0
for r in reviewer verification_author implementer; do
  [ "$credfail" = 1 ] && { note "cell kimi28 $r SKIPPED (credential/model unusable)"; continue; }
  n=1
  while :; do
    d="$O/m-kimi28-$r"
    note "cell kimi28 $r START sitting=$n"
    bash "$HERE/cellk28.sh" "$r" > /dev/null 2>&1; rc=$?
    note "cell kimi28 $r END rc=$rc (out/m-kimi28-$r/)"
    [ "$rc" = 3 ] && { credfail=1; break; }
    if grep -q '"outcome":"transport_fail"' "$d/stderr.log" 2>/dev/null && [ "$n" -lt 3 ]; then
      mv "$d" "$d-attempt$n-transport"; note "cell kimi28 $r transport_fail: not a verdict, renamed -attempt$n-transport, re-sitting"
      n=$((n+1)); continue
    fi
    break
  done
done
note "FAMILY kimi28 DONE"
