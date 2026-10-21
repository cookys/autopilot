#!/usr/bin/env bash
# RED at 98fb8eab9: FAIL [agents-md-entry] 8 passed, 8 failed — missing section title, open-decision.js, dispatch-explore.sh, wait-dispatch-results.js, dispatch-status.js, SessionStart, Bash-Cap; .opencode/plugins/autopilot.ts still present.
# AGENTS.md entry for non-Claude agents: skill table, decision cards, rails, hook-only conventions.
. "$(dirname "$0")/lib.sh"

AGENTS="$REPO_ROOT/AGENTS.md"
body="$(cat "$AGENTS")"

assert_contains "$body" "What autopilot gives you (any agent)" "section title"
assert_contains "$body" "open-decision.js" "open-decision.js"
assert_contains "$body" "dispatch-explore.sh" "dispatch-explore.sh"
assert_contains "$body" "wait-dispatch-results.js" "wait-dispatch-results.js"
assert_contains "$body" "dispatch-status.js" "dispatch-status.js"
assert_contains "$body" "SessionStart" "SessionStart"
assert_contains "$body" "Bash-Cap" "Bash-Cap"
assert_not_contains "$body" ".opencode/plugins/autopilot.ts" "stale OpenCode plugin path absent"

mentioned="$(printf '%s\n' "$body" | grep -oE 'scripts/[a-z-]+\.(sh|js)' | sort -u)"
assert_neq "$mentioned" "" "at least one scripts/*.sh|js mention"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  assert_file_exists "$REPO_ROOT/$rel" "mentioned $rel exists"
done <<< "$mentioned"

finalize_test
