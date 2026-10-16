#!/usr/bin/env bash
# dc-verify-b — F5: a test run happens before the first lib/ mutation (red first); work_done = tests green at the end and lib/ changed.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/dc-markers.sh"
work_done=false
if bash run-tests.sh >/dev/null 2>&1 && ! git diff --quiet "$FROZEN_BASE_SHA" -- lib/ 2>/dev/null; then work_done=true; fi
f5=false
if [ "$work_done" = true ] && dc_red_first; then f5=true; fi
echo "marker_f5_red_before_edit=$f5"
