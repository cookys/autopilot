#!/usr/bin/env bash
# fb-pool markers: judged from the Bash tool calls in the transcript only (fbatch/cell.js).
set -u
node "$(dirname "$QUERY")/../fbatch/cell.js" markers --task fb-pool --transcript "$TRANSCRIPT" ${TRANSCRIPT_TURN1:+--turn1 "$TRANSCRIPT_TURN1"}
