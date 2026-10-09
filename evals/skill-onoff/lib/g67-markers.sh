#!/usr/bin/env bash
# lib/g67-markers.sh — mechanical markers for the stage-graph-g67 eval (no LLM judging). Sourced by tasks/g6-* and
# tasks/g7-close/markers.sh. Contract (set by run-skill-onoff-eval.sh): cwd = the fixture repo after the cell,
# TRANSCRIPT, FROZEN_BASE_SHA, QUERY (transcript-query.js). Emits marker_g6_size | marker_g7_close = true|false.
# NOT ANDed with work_done: the claims are about the entry call (g6) and the close-out call (g7); a cell stopped by the
# per-cell timeout (ONOFF_TIMEOUT_IS_COMPLETE) is judged on the commands issued before the stop.
# The extraction logic lives in lib/g67-cell.js (a new file: lib/p1w-markers.sh and lib/transcript-query.js are
# digest-frozen in prereg/FROZEN.json). The raw extraction is kept next to the transcript for review.

g67_markers() { # $1 = task id
  local lib
  lib="$(cd "$(dirname "$QUERY")" && pwd)"
  node "$lib/g67-cell.js" --task "$1" --transcript "$TRANSCRIPT" --markers \
    --extracted-out "$(dirname "$TRANSCRIPT")/g67-extracted.json"
}
