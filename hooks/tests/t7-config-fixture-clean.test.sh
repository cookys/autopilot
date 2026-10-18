#!/usr/bin/env bash
# Running the t7 task test in place must not rewrite the committed config fixture.
# RED at fdafefaf910fb073d749edcefe69475965d78872: FAIL [t7-config-fixture-clean] 2 passed, 1 failed — porcelain expected '', got ' M evals/orchestration/tasks/t7-config-rename/repo/config.json' (pretty fixture rewritten to compact {"timeout":5}); task test itself exited 0.
. "$(dirname "$0")/lib.sh"

TASK_REL="evals/orchestration/tasks/t7-config-rename"
TASK_DIR="$REPO_ROOT/$TASK_REL"

# Porcelain of the task tree, ignoring the task test source itself. That file is
# the change under review and is dirty until the harness commits it; every other
# path, including the committed config.json, must stay clean. A pre-existing
# dirty fixture would make this check a false red, so refuse to run in that case.
fixture_porcelain() {
  git -C "$REPO_ROOT" status --porcelain -- "$TASK_REL" \
    | grep -v 'evals/orchestration/tasks/t7-config-rename/repo/tests/tool.test.js' || true
}

before="$(fixture_porcelain)"
if [ -n "$before" ]; then
  fail "t7-config-rename is already dirty before the task test (config fixture or another tracked file); refusing a false red: ${before}"
  finalize_test
fi
__TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))

set +e
task_out="$(cd "$TASK_DIR/repo" && bash run-tests.sh 2>&1)"
task_rc=$?

assert_exit_code "$task_rc" "0" "t7 task test (run-tests.sh) exits 0: ${task_out}"
after="$(fixture_porcelain)"
assert_eq "$after" "" "running the t7 task test leaves ${TASK_REL} with empty git status --porcelain (got: ${after})"

finalize_test
