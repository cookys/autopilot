#!/usr/bin/env bash
# fb-deadman markers: the trace comes from the fixture's own execution ledger and the repository's git state; the transcript
# only supplies Write/Edit target paths and the cost (fbatch/cell-v3.js). A cell whose evidence cannot be read emits
# marker_cell_error=true instead of markers (the campaign turns that into an infra_fail row).
set -u
node "$(dirname "$QUERY")/../fbatch/cell-v3.js" markers --task fb-deadman --transcript "$TRANSCRIPT" --git-dir "$(git rev-parse --absolute-git-dir 2>/dev/null)" --repo "$PWD" --home "${ONOFF_CELL_HOME:-}" || echo marker_cell_error=true
