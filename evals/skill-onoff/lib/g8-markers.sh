#!/usr/bin/env bash
# lib/g8-markers.sh — mechanical marker for the stage-graph-g8 eval (no LLM judging). Sourced by tasks/g8-*/markers.sh.
# Contract (set by run-skill-onoff-eval.sh): cwd = the fixture repo after the cell, TRANSCRIPT, FROZEN_BASE_SHA, QUERY
# (transcript-query.js). Emits marker_g8_new_task = true|false. NOT ANDed with work_done: the claim is about the
# second-task call; a cell stopped by the per-cell timeout (ONOFF_TIMEOUT_IS_COMPLETE) is judged on the commands issued
# before the stop. The extraction is lib/g8-cell.js (which reuses lib/g67-cell.js; the g67 files are digest-frozen).

g8_markers() { # $1 = task id
  local lib
  lib="$(cd "$(dirname "$QUERY")" && pwd)"
  node "$lib/g8-cell.js" --task "$1" --transcript "$TRANSCRIPT" --markers \
    --extracted-out "$(dirname "$TRANSCRIPT")/g8-extracted.json"
}
