#!/usr/bin/env bash
# Turn 2 wake: everything in flight has finished. Runs in the cell repo; prints the follow-up prompt.
set -eu
FBATCH_LAND_ALL=1 node scripts/wait-dispatch-results.js --expect wake > /dev/null
cat << 'EOT'
WAKE: the background notifications have arrived. Everything you dispatched has finished, and the results are under runs/. Continue the batch from where you are, and stop when you would hand control back to me.
EOT
