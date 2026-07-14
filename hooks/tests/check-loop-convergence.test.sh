#!/usr/bin/env bash
# check-loop-convergence.test.sh — gate 1 (zero-execution streak) + gate 3 (generation cap).
# Ironlaw-to-gate proof: accident-replay fixtures must TRIP both gates (red case);
# healthy-convergence fixtures must PASS (negative control); boundary-single-zero-exec
# proves the >=2-consecutive threshold and that a converged final clears gate 3.
. "$(dirname "$0")/lib.sh"

GATE="$REPO_ROOT/scripts/check-loop-convergence.js"
ACC="$REPO_ROOT/hooks/tests/fixtures/loop-convergence/accident-replay-driver"
HEALTHY="$REPO_ROOT/hooks/tests/fixtures/loop-convergence/healthy-convergence"
BOUNDARY="$REPO_ROOT/hooks/tests/fixtures/loop-convergence/boundary-single-zero-exec"

# 1. RED — accident dir with --json: must TRIP both gates; max_generation parses float 3.4.
node "$GATE" --artifacts-dir "$ACC" --json >"$TEST_TMP/case1.json" 2>/dev/null
rc=$?
assert_exit_code "$rc" 0 "accident --json must exit 0 in data mode"
out=$(cat "$TEST_TMP/case1.json")
verdict=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.verdict))')
g1=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.gate1_zero_execution.tripped))')
g3t=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.gate3_generation_cap.tripped))')
g3max=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.gate3_generation_cap.max_generation))')
assert_eq "$verdict" "TRIP" "accident verdict must be TRIP"
assert_eq "$g1" "true" "accident gate1_zero_execution must be tripped"
assert_eq "$g3t" "true" "accident gate3_generation_cap must be tripped"
assert_eq "$g3max" "3.4" "accident gate3 max_generation must parse float 3.4"

# 2. RED — accident dir with --enforce: exit code 3 on TRIP.
node "$GATE" --artifacts-dir "$ACC" --enforce >"$TEST_TMP/case2.json" 2>/dev/null
rc=$?
assert_exit_code "$rc" 3 "accident --enforce must exit 3 on TRIP"

# 3. NEGATIVE — healthy dir with --json: PASS, neither gate trips.
node "$GATE" --artifacts-dir "$HEALTHY" --json >"$TEST_TMP/case3.json" 2>/dev/null
rc=$?
assert_exit_code "$rc" 0 "healthy --json must exit 0"
out=$(cat "$TEST_TMP/case3.json")
verdict=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.verdict))')
g1=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.gate1_zero_execution.tripped))')
g3t=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.gate3_generation_cap.tripped))')
assert_eq "$verdict" "PASS" "healthy verdict must be PASS"
assert_eq "$g1" "false" "healthy gate1 must NOT be tripped"
assert_eq "$g3t" "false" "healthy gate3 must NOT be tripped"

# 4. NEGATIVE — healthy dir with --enforce: exit 0 on PASS.
node "$GATE" --artifacts-dir "$HEALTHY" --enforce >"$TEST_TMP/case4.json" 2>/dev/null
rc=$?
assert_exit_code "$rc" 0 "healthy --enforce must exit 0 on PASS"

# 5. BOUNDARY — single isolated zero-exec round must NOT trip gate1 (>=2-consecutive
# threshold); final artifact is ship_ready:true so gate3 cannot trip either.
node "$GATE" --artifacts-dir "$BOUNDARY" --json >"$TEST_TMP/case5.json" 2>/dev/null
rc=$?
assert_exit_code "$rc" 0 "boundary --json must exit 0"
out=$(cat "$TEST_TMP/case5.json")
verdict=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.verdict))')
g1=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.gate1_zero_execution.tripped))')
assert_eq "$verdict" "PASS" "boundary verdict must be PASS"
assert_eq "$g1" "false" "boundary gate1 must NOT trip on single isolated zero-exec"

# 6. GENERATION-CAP KNOB — --generation-cap 5 with accident dir:
# gate3 must NOT trip (3.4 < 5) while gate1 STILL trips.
node "$GATE" --artifacts-dir "$ACC" --generation-cap 5 --json >"$TEST_TMP/case6.json" 2>/dev/null
rc=$?
assert_exit_code "$rc" 0 "accident --generation-cap 5 --json must exit 0"
out=$(cat "$TEST_TMP/case6.json")
g1=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.gate1_zero_execution.tripped))')
g3t=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.gate3_generation_cap.tripped))')
assert_eq "$g1" "true" "accident --cap 5 gate1 must STILL be tripped"
assert_eq "$g3t" "false" "accident --cap 5 gate3 must NOT trip (3.4 < 5)"

# 7. USAGE — empty dir with no *.json: exit 2 (usage error).
empty_dir="$TEST_TMP/empty-fixtures"
mkdir -p "$empty_dir"
node "$GATE" --artifacts-dir "$empty_dir" --json >"$TEST_TMP/case7.json" 2>/dev/null
rc=$?
assert_exit_code "$rc" 2 "empty artifacts dir must exit 2"

finalize_test
