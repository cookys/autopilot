#!/usr/bin/env bash
# grok-effort.test.sh — wires scripts/test-grok-effort.sh into the L2 suite.
#
# scripts/test-grok-effort.sh existed since 2026-08-19 but is named `test-*.sh`, while
# hooks/tests/run.sh only collects `hooks/tests/*.test.sh` + `scripts/*.test.sh` — so it had
# zero executions in CI. Its live-probe section only asked the CLI's DEFAULT model, and the
# per-model enum bug (grok-4.5 rejects xhigh; 4.6+ accept) shipped under it (2026-09-23).
. "$(dirname "$0")/lib.sh"

TEST_NAME="grok-effort"
OUT="$(bash "$REPO_ROOT/scripts/test-grok-effort.sh" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "scripts/test-grok-effort.sh passes"
assert_contains "$OUT" "test-grok-effort: PASS" "scripts/test-grok-effort.sh reached its PASS line"

finalize_test
