#!/usr/bin/env bash
# run-retry-va.sh — re-sit the MiniMax VA cells that died as transport_fail on malformed model JSON, using cellx2.sh (qrp-lenient.js).
# Launch: setsid nohup bash run-retry-va.sh > /dev/null 2>&1 &     Progress: out/progress-minimax-retry.log
# Waits for the first minimax runner to finish (same provider: serial). Old out dirs are renamed *-attempt1-transport, only when
# their stderr shows transport_fail. A cell that already produced a real verdict is left alone.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; O="$HERE/out"; P="$O/progress-minimax-retry.log"
note() { echo "$(date -Is) $*" >> "$P"; }
note "RETRY START (waiting for FAMILY minimax DONE)"
until grep -q 'FAMILY minimax DONE' "$O/progress-minimax.log" 2>/dev/null; do sleep 20; done
for l in minimax minimax31; do
  d="$O/m-$l-verification_author"
  if grep -q '"outcome":"transport_fail"' "$d/stderr.log" 2>/dev/null; then
    mv "$d" "$d-attempt1-transport"; note "renamed $d -> $d-attempt1-transport"
    note "cell $l verification_author START (cellx2)"
    bash "$HERE/cellx2.sh" "$l" verification_author > /dev/null 2>&1; rc=$?
    note "cell $l verification_author END rc=$rc (out/m-$l-verification_author/)"
  else
    note "cell $l verification_author kept (no transport_fail in attempt 1)"
  fi
done
note "RETRY DONE"
