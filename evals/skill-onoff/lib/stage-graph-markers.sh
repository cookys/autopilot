#!/usr/bin/env bash
# lib/stage-graph-markers.sh — mechanical markers for the stage-graph eval (no LLM judging).
# Sourced by tasks/stage-graph-*/markers.sh. Contract (set by run-skill-onoff-eval.sh):
#   cwd = the fixture repo after the cell · TRANSCRIPT · FROZEN_BASE_SHA · QUERY (transcript-query.js)
# Emits marker_sg_{size,bug,urgent,walk,rung,work,pass}=true|false. Every marker is ANDed with work_done
# (the repo moved: HEAD != frozen base, or the tree is dirty), so a no-op cell is all false.
#
# Why a NEW file and not p1w-markers.sh: lib/p1w-markers.sh and lib/transcript-query.js are digest-frozen in
# prereg/FROZEN.json (hooks/tests/skill-onoff-p1w-score.test.sh fails on any byte change). The extraction
# logic lives in lib/stage-graph-cell.js; the answer keys (tasks/<id>/answer.json) are keyed on
# hooks/tests/fixtures/stage-graph/expected.json.
# Env: ONOFF_SG_EXPECTED (override the expected.json path; tests).

sg_work_done() {
  if [ "$(git rev-parse HEAD 2>/dev/null)" != "${FROZEN_BASE_SHA:-}" ] || [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo true
  else
    echo false
  fi
}

sg_markers() { # $1 = task id (tasks/<id>/answer.json)
  local lib extra=()
  lib="$(cd "$(dirname "$QUERY")" && pwd)"
  [ -z "${ONOFF_SG_EXPECTED:-}" ] || extra=(--expected "$ONOFF_SG_EXPECTED")
  # --repo/--base-sha: rung-consistency derivation on the frozen base tree; --extracted-out: raw extraction kept next to
  # the transcript (the matrix retains the cell dir when ONOFF_KEEP_CELLS_DIR is set) — amend-2-instrument fixes 1 and 3
  node "$lib/stage-graph-cell.js" --task "$1" --transcript "$TRANSCRIPT" --work-done "$(sg_work_done)" --markers \
    --repo "$PWD" --base-sha "${FROZEN_BASE_SHA:-}" --extracted-out "$(dirname "$TRANSCRIPT")/stage-graph-extracted.json" "${extra[@]+"${extra[@]}"}"
}
