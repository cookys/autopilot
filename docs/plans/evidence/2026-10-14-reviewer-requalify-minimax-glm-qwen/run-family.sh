#!/usr/bin/env bash
# run-family.sh <minimax|qwen|kimi|glm> — one provider family, cells strictly serial, implementer last.
# Launch: setsid nohup bash run-family.sh <family> > /dev/null 2>&1 &
# Progress file: out/progress-<family>.log (one line per event; final line 'FAMILY DONE'). Each cell has its own
# out/m-<lane>-<role>/{run.log,rc,emit-row.json}. Never records to the scorecard.
# consult/discuss/brain cells are deliberately NOT scheduled here (coordinator: wait for the run-all-questions fix, new checkout).
# A cell failing (rc!=0) does not stop the family; rc=3 on kimi (credential) skips the remaining kimi cells, uncharged.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAM="${1:?family}"
P="$HERE/out/progress-$FAM.log"; mkdir -p "$HERE/out"
note() { echo "$(date -Is) $*" >> "$P"; }
wait_rc() { # wait_rc <run.log> : until a line 'rc=' appears (reviewer cells write rc= at the end)
  until grep -q '^rc=' "$1" 2>/dev/null; do sleep 20; done; }
case "$FAM" in
  minimax) WAIT="$HERE/out/minimax31/run.log"; CELLS="minimax:verification_author minimax31:verification_author minimax31:implementer";;
  qwen)    WAIT=""; CELLS="qwen:verification_author";;
  kimi)    WAIT="$HERE/out/kimi/run.log"; CELLS="kimi:verification_author kimi:implementer";;   # reviewer = the already-running out/kimi lane
  glm)     WAIT=""; CELLS="";;   # nothing to run now: reviewer sat today, VA/implementer passed; consult/discuss/brain deferred
  *) echo "bad family" >&2; exit 2;;
esac
note "FAMILY $FAM START cells=[$CELLS] wait=[$WAIT]"
if [ -n "$WAIT" ]; then note "waiting for $WAIT rc="; wait_rc "$WAIT"; note "wait over: $(grep '^rc=' "$WAIT" | tail -1)"; fi
credfail=0
for c in $CELLS; do
  l="${c%%:*}"; r="${c##*:}"
  if [ "$FAM" = kimi ] && [ "$credfail" = 1 ]; then note "cell $l $r SKIPPED (kimi credential unusable)"; continue; fi
  note "cell $l $r START"
  bash "$HERE/cellx.sh" "$l" "$r" > /dev/null 2>&1; rc=$?
  note "cell $l $r END rc=$rc (out/m-$l-$r/)"
  [ "$rc" = 3 ] && credfail=1
done
note "FAMILY $FAM DONE"
