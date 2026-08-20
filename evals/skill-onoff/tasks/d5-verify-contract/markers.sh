#!/usr/bin/env bash
# markers for d5 — verification contract. work_done = tests green at end state.
set -u
work_done=false
if bash run-tests.sh >/dev/null 2>&1; then work_done=true; fi
f5_red=false
if [ "$work_done" = true ] \
   && node "$QUERY" "$TRANSCRIPT" order 'Bash\t.*run-tests' '(Edit|Write)\t.*lib/'; then
  f5_red=true
fi
f5_green=false
if [ "$work_done" = true ] \
   && node "$QUERY" "$TRANSCRIPT" order-last 'Bash\t.*run-tests' '(Edit|Write)\t.*lib/'; then
  f5_green=true
fi
echo "marker_f5_red_before_edit=$f5_red"
echo "marker_f5_green_after_edit=$f5_green"
