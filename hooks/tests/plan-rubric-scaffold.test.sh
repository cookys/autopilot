#!/usr/bin/env bash
# plan-rubric-scaffold.test.sh — contract test for scripts/plan-rubric-scaffold.js
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/plan-rubric-scaffold.js"
FIXTURE="$REPO_ROOT/hooks/tests/fixtures/plan-rubric-scaffold-fixture.md"

# ─────────────────────────────────────────────────────────────────────────────
# Optional: --help exits 0
# ─────────────────────────────────────────────────────────────────────────────
HELP_OUT=$(node "$SCRIPT" --help 2>&1); HELP_RC=$?
assert_exit_code "$HELP_RC" "0" "--help exits 0"
assert_contains "$HELP_OUT" "Usage:" "--help outputs usage instructions"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Run against fixture with --out $TEST_TMP/case1/out.rubric.md
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$TEST_TMP/case1"
CASE1_OUT="$TEST_TMP/case1/out.rubric.md"

RUN_OUT=$(node "$SCRIPT" --plan "$FIXTURE" --out "$CASE1_OUT" 2>&1); RC=$?
assert_exit_code "$RC" "0" "case 1 exits 0"
assert_file_exists "$CASE1_OUT" "case 1 output file exists"

EXPECTED_CONTENT=$(cat <<EXPECTED
# Rubric — plan-rubric-scaffold-fixture.md

> Source plan: $FIXTURE

R1: First key result for testing rubric generation
R2: Second key result verifying deterministic extraction
R3: Third key result ensuring proper order
R4: Constraint alpha on built-in dependencies only
R5: **Knob transition table** ensures deterministic output format
R6: Constraint gamma on error handling
R7: Risk of file collision handled via exit code 2
R8: Risk of missing sections detected cleanly
EXPECTED
)

ACTUAL_CONTENT=$(cat "$CASE1_OUT")
assert_eq "$ACTUAL_CONTENT" "$EXPECTED_CONTENT" "case 1 output matches exact hand-crafted expected rubric"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Determinism check: re-run against fresh path and compare byte contents
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$TEST_TMP/case2"
CASE2_OUT="$TEST_TMP/case2/out.rubric.md"

RUN2_OUT=$(node "$SCRIPT" --plan "$FIXTURE" --out "$CASE2_OUT" 2>&1); RC2=$?
assert_exit_code "$RC2" "0" "case 2 exits 0"
assert_file_exists "$CASE2_OUT" "case 2 output file exists"

ACTUAL_CONTENT_2=$(cat "$CASE2_OUT")
assert_eq "$ACTUAL_CONTENT_2" "$ACTUAL_CONTENT" "case 2 output is byte-identical to case 1"

SHA1=$(sha256sum "$CASE1_OUT" | cut -d' ' -f1)
SHA2=$(sha256sum "$CASE2_OUT" | cut -d' ' -f1)
assert_eq "$SHA1" "$SHA2" "case 1 and case 2 have identical sha256"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Collision check: pre-existing sentinel file triggers exit code 2
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$TEST_TMP/case3"
CASE3_OUT="$TEST_TMP/case3/out.rubric.md"
SENTINEL="SENTINEL-DO-NOT-TOUCH"
printf '%s' "$SENTINEL" > "$CASE3_OUT"

RUN3_OUT=$(node "$SCRIPT" --plan "$FIXTURE" --out "$CASE3_OUT" 2>&1); RC3=$?
assert_exit_code "$RC3" "2" "case 3 exits 2 when output file exists"
assert_contains "$RUN3_OUT" "already exists" "case 3 error message mentions output file already exists"

AFTER_SENTINEL=$(cat "$CASE3_OUT")
assert_eq "$AFTER_SENTINEL" "$SENTINEL" "case 3 sentinel file is completely untouched"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Missing section: fixture missing "6." heading exits 1 and mentions section
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$TEST_TMP/case4"
CASE4_PLAN="$TEST_TMP/case4/plan-missing-6.md"
CASE4_OUT="$TEST_TMP/case4/out.rubric.md"

# Build plan without section 6
cat <<'PLAN_EOF' > "$CASE4_PLAN"
# Incomplete Plan

## 2. KRs
- KR1: Only KR

## 2.5 Global constraints
- Only constraint

## 3. Other section
- Unrelated
PLAN_EOF

RUN4_OUT=$(node "$SCRIPT" --plan "$CASE4_PLAN" --out "$CASE4_OUT" 2>&1); RC4=$?
assert_exit_code "$RC4" "1" "case 4 exits 1 on missing section"
assert_contains "$RUN4_OUT" "missing section: 6" "case 4 stderr/output mentions missing section 6"
assert_file_absent "$CASE4_OUT" "case 4 writes no output file"

# ─────────────────────────────────────────────────────────────────────────────
# 5. Exclusive-create check: running twice against the same path exits 0 then 2
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$TEST_TMP/case5"
CASE5_OUT="$TEST_TMP/case5/out.rubric.md"

RUN5A_OUT=$(node "$SCRIPT" --plan "$FIXTURE" --out "$CASE5_OUT" 2>&1); RC5A=$?
assert_exit_code "$RC5A" "0" "case 5: first run exits 0"
assert_file_exists "$CASE5_OUT" "case 5: file created on first run"
CONTENT_AFTER_FIRST=$(cat "$CASE5_OUT")

RUN5B_OUT=$(node "$SCRIPT" --plan "$FIXTURE" --out "$CASE5_OUT" 2>&1); RC5B=$?
assert_exit_code "$RC5B" "2" "case 5: second run against same path exits 2"
CONTENT_AFTER_SECOND=$(cat "$CASE5_OUT")
assert_eq "$CONTENT_AFTER_SECOND" "$CONTENT_AFTER_FIRST" "case 5: file contents after second run are identical to first run"

finalize_test
