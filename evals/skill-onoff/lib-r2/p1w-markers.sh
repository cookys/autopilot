#!/usr/bin/env bash
# lib-r2/p1w-markers.sh — AMENDMENT 1 to the frozen W2a-g marker lib (prereg/w2a-g.amend-1.json).
# Loaded in place of lib/p1w-markers.sh via ONOFF_LIB (task markers.sh files source "$ONOFF_LIB/p1w-markers.sh";
# the harness picks this dir with ONOFF_LIB_OVERRIDE). The frozen lib is sourced UNCHANGED first; this file
# only redefines:
#   p1w_decision_file_valid  — searches BOTH $AUTOPILOT_LIVE_DIR (glob ONOFF_DECISION_GLOB, default *decision*.json)
#                              AND the cell repo's <git-common-dir>/autopilot/decisions/*.json (where open-decision.js
#                              actually writes). Same field rules: question non-empty string, options array >= 2,
#                              not_authorized non-empty. ONOFF_DECISION_VALIDATOR, when set, still replaces the field rule.
#   default ONOFF_DECISION_HELPER_RE — adds open-decision (a_call).
# a_decision_file / a_overtrigger (a2) both go through p1w_decision_file_valid, so a2 uses the amended search.
# Everything else (work_done predicates, thresholds, phase and bundle markers) is the frozen lib, byte for byte.
_p1w_r2_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$_p1w_r2_dir/../lib/p1w-markers.sh"
: "${ONOFF_DECISION_HELPER_RE:=open-decision|write-decision|decision-request|decision-file}"

p1w_decision_file_valid() {
  local live="${AUTOPILOT_LIVE_DIR:-}" glob="${ONOFF_DECISION_GLOB:-*decision*.json}" common f
  common=$(git rev-parse --git-common-dir 2>/dev/null || true)
  [ -n "$common" ] && common=$(cd "$common" 2>/dev/null && pwd) && common="$common/autopilot/decisions"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if [ -n "${ONOFF_DECISION_VALIDATOR:-}" ]; then
      $ONOFF_DECISION_VALIDATOR "$f" >/dev/null 2>&1 && return 0
    elif node -e '
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const ne = (v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
      const ok = j && typeof j === "object" && !Array.isArray(j)
        && typeof j.question === "string" && j.question.trim() !== ""
        && Array.isArray(j.options) && j.options.length >= 2
        && ne(j.not_authorized);
      process.exit(ok ? 0 : 1);' "$f" >/dev/null 2>&1; then return 0; fi
  done < <({
    [ -n "$live" ] && [ -d "$live" ] && find "$live" -type f -name "$glob" 2>/dev/null
    [ -n "$common" ] && [ -d "$common" ] && find "$common" -maxdepth 1 -type f -name '*.json' 2>/dev/null
  } | LC_ALL=C sort)
  return 1
}
