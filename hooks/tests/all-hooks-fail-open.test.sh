#!/usr/bin/env bash
# P5 baseline — every hook script in hooks/ must fail-open (exit 0) on an
# empty `{}` payload. Catches regression-class bugs: syntax errors, uncaught
# exceptions on missing fields, accidentally-required env vars.
#
# Two of the Node hooks (state-checkpoint, intent-capture) are exhaustively
# covered by their own suites; included here too because the fail-open contract
# applies uniformly.
. "$(dirname "$0")/lib.sh"

cd "$REPO_ROOT"

# Hook script files to probe. Order doesn't matter; failures aggregate.
HOOK_FILES=(
  hooks/accumulator.js
  hooks/audit-log.js
  hooks/batch-format.js
  hooks/branch-protection.js
  hooks/capture-payload.js
  hooks/check-console.js
  hooks/commit-secret-scan.js
  hooks/config-protection.js
  hooks/cost-tracker.js
  hooks/design-quality.js
  hooks/failure-escalation.js
  hooks/intent-capture.js
  hooks/large-file-warner.js
  hooks/log-error.js
  hooks/mcp-health.js
  hooks/reload-watch.js
  hooks/session-handoff.js
  hooks/session-summary.js
  hooks/state-checkpoint.js
  hooks/suggest-compact.js
  hooks/test-runner.js
  hooks/session-start.js
)

for hook in "${HOOK_FILES[@]}"; do
  if [ ! -f "$REPO_ROOT/$hook" ]; then
    fail "missing expected hook file: $hook"
    continue
  fi
  rel="${hook#hooks/}"
  run_hook "$rel" '{}'
  # Fail-open contract: every hook MUST exit 0 regardless of input shape.
  assert_exit_code "$__RUN_EXIT" 0 "$rel fail-open on '{}'"
done

finalize_test
