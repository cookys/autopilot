#!/usr/bin/env bash
# lib-gdorm/gdorm-markers.sh — gdorm markers. ONOFF_LIB_OVERRIDE points here.
# A marker is true only from a Bash tool_use in the transcript, or from a real
# file in the cell. The agent's own prose never counts.
# Requires: TRANSCRIPT, QUERY. Optional: ONOFF_OUT, ONOFF_CELL_HOME.
# run-skill-onoff-eval-gdorm.sh exports both before this file runs. The shared
# runner does not, so gdorm cells must use the gdorm runner.
set -u

gdorm_emit() { echo "marker_$1=$([ "$2" = true ] && echo true || echo false)"; }

# $1 regex matched against the Bash command text (transcript-query detail).
gdorm_bash_hit() {
  local re="$1"
  [ -n "${TRANSCRIPT:-}" ] && [ -n "${QUERY:-}" ] && [ -f "$TRANSCRIPT" ] || return 1
  node "$QUERY" "$TRANSCRIPT" tool-events | while IFS=$'\t' read -r _idx name detail; do
    [ "$name" = "Bash" ] || continue
    printf '%s\n' "$detail"
  done | grep -Eq "$re"
}

# tree.js init writes <projects>/tree/events.jsonl. The cell repo is cwd.
# ONOFF_OUT is the kept cell directory, searched the same way.
gdorm_tree_event() {
  local root
  for root in . ${ONOFF_OUT:-}; do
    [ -n "$root" ] && [ -d "$root" ] || continue
    if find "$root" -type f -name events.jsonl -path '*/tree/*' -print -quit 2>/dev/null | grep -q .; then
      return 0
    fi
  done
  return 1
}

gdorm_tree_markers() {
  local hit=false
  if gdorm_bash_hit 'scripts/tree\.js'; then hit=true; fi
  if [ "$hit" != true ] && gdorm_tree_event; then hit=true; fi
  gdorm_emit t_tree_run "$hit"
}

gdorm_qc_markers() {
  local hit=false
  if gdorm_bash_hit 'qc-panel\.js'; then hit=true; fi
  gdorm_emit q_qcpanel_run "$hit"
}

# Archive dir is review_ledger_archive.dir in the scratch HOME config.
gdorm_archive_dir() {
  [ -n "${ONOFF_CELL_HOME:-}" ] || return 1
  node -e '
    const fs = require("fs");
    const path = require("path");
    const home = process.argv[1];
    const cfgPath = path.join(home, ".autopilot", "config.json");
    let dir = "";
    try {
      const j = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      dir = j && j.review_ledger_archive && typeof j.review_ledger_archive.dir === "string"
        ? j.review_ledger_archive.dir : "";
    } catch { dir = ""; }
    if (!dir) process.exit(1);
    process.stdout.write(dir);
  ' "$ONOFF_CELL_HOME"
}

gdorm_archive_file() {
  local dir
  dir="$(gdorm_archive_dir)" || return 1
  [ -d "$dir" ] || return 1
  # A real ledger copy is a regular file under the archive root.
  find "$dir" -type f -print -quit 2>/dev/null | grep -q .
}

gdorm_archive_markers() {
  local imp=false file=false
  # Same Bash command must name the script and the import subcommand.
  if gdorm_bash_hit 'review-ledger-archive\.js([^[:alnum:]_]|$).*import([^[:alnum:]_]|$)'; then
    imp=true
  fi
  if gdorm_archive_file; then file=true; fi
  gdorm_emit r_archive_import "$imp"
  gdorm_emit r_archive_file "$file"
}
