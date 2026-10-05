#!/usr/bin/env bash
# lib-r4/p1w-markers.sh — AMENDMENT 4 to the frozen W2b-g marker lib (prereg/amend-4-work-done.json).
# Loaded via ONOFF_LIB_OVERRIDE (see lib-r2 header for the mechanism). Sources lib-r2 (amendment 1, which sources the
# frozen lib unchanged) and redefines ONLY p1w_l_work_done: the project README check also accepts
# docs/projects/_archive/**/README.md, because finish-flow L-5.5 moves the project there, so a complete L run
# otherwise scored work_done false and b_phase_seq/b_phase_final could never be true. All other conjuncts
# (code landed in lib/, a docs/plans/*.md plan, 'Success criteria' + 'Project Goal' in a README, session sha pinned) are unchanged.
_p1w_r4_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$_p1w_r4_dir/../lib-r2/p1w-markers.sh"

p1w_l_work_done() { # $1 = grep pattern proving the code landed in lib/
  local readmes
  readmes=$( { ls docs/projects/*/README.md; find docs/projects/_archive -type f -name README.md; } 2>/dev/null )
  if grep -rq "$1" lib/ 2>/dev/null && ls docs/plans/*.md >/dev/null 2>&1 \
     && [ -n "$readmes" ] \
     && printf '%s\n' "$readmes" | xargs grep -lq 'Success criteria' 2>/dev/null \
     && printf '%s\n' "$readmes" | xargs grep -lq 'Project Goal' 2>/dev/null \
     && [ -f .claude/session-start-sha ] && [ "$(cat .claude/session-start-sha 2>/dev/null)" = "$FROZEN_BASE_SHA" ]; then
    echo true
  else
    echo false
  fi
}
