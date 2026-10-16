#!/usr/bin/env bash
# lib/qs-markers.sh — mechanical markers for the qs row (BL-0001 stage 2 ON/OFF). Sourced by tasks/qs-*/markers.sh.
# Contract (run-skill-onoff-eval.sh): cwd = the fixture repo after the cell, TRANSCRIPT, QUERY (transcript-query.js).
# The stub suites append their own path to <git-common-dir>/run.log; lib/qs-cell.js reads that log, the task's answer.json and the verdict file.
qs_markers() { # $1 = task id
  local lib
  lib="$(cd "$(dirname "$QUERY")" && pwd)"
  node "$lib/qs-cell.js" --task "$1" --transcript "$TRANSCRIPT" --repo "$PWD" \
    --extracted-out "$(dirname "$TRANSCRIPT")/qs-extracted.json" --markers
}
