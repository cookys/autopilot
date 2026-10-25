#!/usr/bin/env bash
# fb-deadman markers: judged from the Bash tool calls in the transcript only (fbatch/cell.js).
set -u
node "$(dirname "$QUERY")/../fbatch/cell.js" markers --task fb-deadman --transcript "$TRANSCRIPT" --git-dir "$(git rev-parse --absolute-git-dir 2>/dev/null)" --require-counter --emit-refusal ${TRANSCRIPT_TURN1:+--turn1 "$TRANSCRIPT_TURN1"}
