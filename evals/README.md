# Autopilot Eval Framework

Test harness for verifying skill triggers, behavioral markers, and hook logic.

## Test Categories

### 1. Hook Unit Tests (fast, no API cost)

```bash
# Run all hook unit tests
node evals/test-hooks/test-failure-escalation.js
bash evals/test-hooks/test-state-checkpoint.sh
bash evals/test-hooks/test-hooks-json-valid.sh
```

These tests mock stdin/file I/O and verify hook logic in isolation. They run in
milliseconds and cost nothing.

### 2. Integration Tests (API cost, opt-in)

```bash
# Requires: AUTOPILOT_EVAL_INTEGRATION=1, claude CLI
AUTOPILOT_EVAL_INTEGRATION=1 bash evals/run-trigger-test.sh
AUTOPILOT_EVAL_INTEGRATION=1 bash evals/test-behavior.sh
```

These tests invoke `claude -p` with the plugin loaded and check for expected
skill triggers and behavioral markers in the output.

**Expected cost per run**: ~12 `claude -p` calls x ~$0.02 = ~$0.24
**Expected time**: ~2-3 minutes (60-120s per call, parallelized where possible)

### 3. Running Everything

```bash
# Unit tests only (default, CI-safe)
bash evals/run-all.sh

# Unit + integration tests
AUTOPILOT_EVAL_INTEGRATION=1 bash evals/run-all.sh
```

## Exit Code Convention

- `0` = all tests pass
- `1` = one or more tests failed

## Adding Tests

- Hook unit tests: add to `test-hooks/`
- Trigger prompts: add to `trigger-prompts/should-trigger.txt` or `should-not-trigger.txt`
- Behavior tests: add test functions to `test-behavior.sh`
