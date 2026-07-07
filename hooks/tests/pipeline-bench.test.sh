#!/usr/bin/env bash

. "$(dirname "$0")/lib.sh"

export ORCH_TIMEOUT="2s"
export PATH="$TEST_TMP/bin:$PATH"
mkdir -p "$TEST_TMP/bin"

cat > "$TEST_TMP/bin/claude" << 'EOF'
#!/usr/bin/env bash
prompt=$(cat)
if [[ "$*" == *"--model pipeline-test"* ]]; then
  echo "fake diff content" >> foo.txt
  echo '{"usage":{"input_tokens": 10, "output_tokens": 20, "context": "verbatim_string"},"session_id":"fake"}'
  exit 0
fi
if [[ "$*" == *"--model secret-test"* ]]; then
  echo "FAKE_AWS_KEY" >> foo.txt
  echo '{"usage":{"input_tokens": 5},"session_id":"fake"}'
  exit 0
fi
if [[ "$*" == *"--model verify-pass-test"* ]]; then
  echo "verify first pass" >> foo.txt
  echo '{"usage":{"input_tokens": 7},"session_id":"fake"}'
  exit 0
fi
if [[ "$*" == *"--model verify-repair-test"* ]]; then
  if [[ "$prompt" == *"A reviewer found these issues"* ]]; then
    echo "verify repair pass" >> foo.txt
  else
    echo "verify first fail" >> foo.txt
  fi
  echo '{"usage":{"input_tokens": 8},"session_id":"fake"}'
  exit 0
fi
exit 1
EOF
chmod +x "$TEST_TMP/bin/claude"

# Mock run-pipeline-bench.sh environment
MOCK_REPO="$TEST_TMP/mock_repo"
mkdir -p "$MOCK_REPO/evals/pipeline-bench"
mkdir -p "$MOCK_REPO/evals/orchestration/tasks/t1/repo"
mkdir -p "$MOCK_REPO/scripts"

# Copy the real script to the mock repo so its REPO_ROOT resolves to MOCK_REPO
cp "$(cd "$(dirname "$0")/../../evals/pipeline-bench" && pwd)/run-pipeline-bench.sh" "$MOCK_REPO/evals/pipeline-bench/run-pipeline-bench.sh"
chmod +x "$MOCK_REPO/evals/pipeline-bench/run-pipeline-bench.sh"

# Mock task t1
echo "test task" > "$MOCK_REPO/evals/orchestration/tasks/t1/task.md"
cat > "$MOCK_REPO/evals/orchestration/tasks/t1/oracle.sh" << 'EOF'
#!/usr/bin/env bash
cp -r "$1" "$TEST_TMP/temp_repo_snap"
grep -q "fake diff content" foo.txt || grep -q "FAKE_AWS_KEY" foo.txt || grep -q "verify first pass" foo.txt || grep -q "verify repair pass" foo.txt
EOF
chmod +x "$MOCK_REPO/evals/orchestration/tasks/t1/oracle.sh"

# Mock dispatch-review via PATH-stub
export PIPELINE_BENCH_REVIEW_CMD="dispatch-review"
cat > "$TEST_TMP/bin/dispatch-review" << EOF
#!/usr/bin/env bash
count=0
if [ -f "$TEST_TMP/review_count" ]; then
  count=\$(cat "$TEST_TMP/review_count")
fi
count=\$((count + 1))
echo "\$count" > "$TEST_TMP/review_count"
touch "$TEST_TMP/review_called"
if [ "\$count" -gt 1 ]; then
  echo '{"verdict":"SHIP-AS-IS","findings":"none"}'
else
  echo '{"verdict":"FIX-THEN-SHIP","findings":"please fix it"}'
fi
EOF
chmod +x "$TEST_TMP/bin/dispatch-review"

# Mock error-path-scan
echo 'echo "{\"findings\":[],\"counts\":{}}"' > "$MOCK_REPO/scripts/error-path-scan.sh"
chmod +x "$MOCK_REPO/scripts/error-path-scan.sh"

# Mock secret-scan-diff.js
cat > "$MOCK_REPO/scripts/secret-scan-diff.js" << 'EOF'
#!/usr/bin/env node
const { execFileSync } = require('child_process');
const rangeIndex = process.argv.indexOf('--range');
const range = rangeIndex === -1 ? '--cached' : process.argv[rangeIndex + 1];
if (!range) process.exit(2);
try {
  const diff = execFileSync('git', ['diff', range], {encoding: 'utf8'});
  if (diff.includes('FAKE_AWS_KEY')) process.exit(1);
} catch (e) {
  process.exit(2);
}
process.exit(0);
EOF
chmod +x "$MOCK_REPO/scripts/secret-scan-diff.js"

TARGET_SCRIPT="$MOCK_REPO/evals/pipeline-bench/run-pipeline-bench.sh"

# 1. Bare arm
OUT_BARE="$TEST_TMP/out_bare"
bash "$TARGET_SCRIPT" --task t1 --arm bare --model pipeline-test --out "$OUT_BARE" >/dev/null 2>&1
assert_exit_code $? 0 "bare arm should exit 0"
assert_file_exists "$OUT_BARE/result.json"

res_bare=$(cat "$OUT_BARE/result.json")
assert_contains "$res_bare" '"arm":"bare"'
assert_contains "$res_bare" '"rounds":1'
assert_contains "$res_bare" '"convergence_reason":null'
assert_contains "$res_bare" '"oracle_pass":true'
assert_contains "$res_bare" '"verbatim_string"'

# 2. Verify-first stops after round-1 oracle pass
OUT_VERIFY_PASS="$TEST_TMP/out_verify_pass"
rm -f "$TEST_TMP/review_called" "$TEST_TMP/review_count"
bash "$TARGET_SCRIPT" --task t1 --arm verify-first --model verify-pass-test --out "$OUT_VERIFY_PASS" >/dev/null 2>&1
assert_exit_code $? 0 "verify-first passing round 1 should exit 0"
res_verify_pass=$(cat "$OUT_VERIFY_PASS/result.json")
assert_contains "$res_verify_pass" '"arm":"verify-first"'
assert_contains "$res_verify_pass" '"rounds":1'
assert_contains "$res_verify_pass" '"converged":true'
assert_contains "$res_verify_pass" '"convergence_reason":"verification"'
assert_contains "$res_verify_pass" '"review_verdicts":[]'
assert_file_exists "$OUT_VERIFY_PASS/oracle_round_1.log"
assert_file_absent "$TEST_TMP/review_called" "verify-first passing round 1 should not invoke review"

# 3. Verify-first enters review once, then stops after repair oracle pass
OUT_VERIFY_REPAIR="$TEST_TMP/out_verify_repair"
rm -f "$TEST_TMP/review_called" "$TEST_TMP/review_count"
bash "$TARGET_SCRIPT" --task t1 --arm verify-first --model verify-repair-test --out "$OUT_VERIFY_REPAIR" >/dev/null 2>&1
assert_exit_code $? 0 "verify-first repair pass should exit 0"
res_verify_repair=$(cat "$OUT_VERIFY_REPAIR/result.json")
assert_contains "$res_verify_repair" '"arm":"verify-first"'
assert_contains "$res_verify_repair" '"rounds":2'
assert_contains "$res_verify_repair" '"converged":true'
assert_contains "$res_verify_repair" '"convergence_reason":"verification"'
assert_file_exists "$OUT_VERIFY_REPAIR/oracle_round_1.log"
assert_file_exists "$OUT_VERIFY_REPAIR/oracle_round_2.log"
assert_eq "$(cat "$TEST_TMP/review_count")" "1" "verify-first repair pass should invoke review exactly once"

# 4. Pipeline arm
OUT_PIPE="$TEST_TMP/out_pipe"
rm -f "$TEST_TMP/review_called" "$TEST_TMP/review_count"
bash "$TARGET_SCRIPT" --task t1 --arm pipeline --model pipeline-test --out "$OUT_PIPE" >/dev/null 2>&1
assert_exit_code $? 0 "pipeline arm should exit 0"
res_pipe=$(cat "$OUT_PIPE/result.json")
assert_contains "$res_pipe" '"arm":"pipeline"'
assert_contains "$res_pipe" '"rounds":2'
assert_contains "$res_pipe" '"converged":true'
assert_contains "$res_pipe" '"convergence_reason":"reviewer"'
assert_contains "$res_pipe" '"review_verdicts":["FIX-THEN-SHIP","SHIP-AS-IS"]'
assert_contains "$res_pipe" '"gate_blocked":false'
assert_contains "$res_pipe" '"rounds":[{'
assert_contains "$res_pipe" '"verbatim_string"'
assert_contains "$res_pipe" '"advisory_findings":0'

if [ -f "$TEST_TMP/temp_repo_snap/oracle.sh" ]; then
  echo "Assertion failed: oracle.sh exists in the temp repo"
  exit 1
fi

# 5. Secret gate block path
OUT_SECRET="$TEST_TMP/out_secret"
rm -f "$TEST_TMP/review_called" "$TEST_TMP/review_count" # reset mock reviewer to force rounds
bash "$TARGET_SCRIPT" --task t1 --arm pipeline --model secret-test --out "$OUT_SECRET" >/dev/null 2>&1
assert_exit_code $? 0 "secret pipeline arm should exit 0"
res_secret=$(cat "$OUT_SECRET/result.json")
assert_contains "$res_secret" '"gate_blocked":true'
assert_contains "$res_secret" '"convergence_reason":null'

# 6. Missing task exits 2
bash "$TARGET_SCRIPT" --task missing-task --arm bare --model pipeline-test --out "$TEST_TMP/missing" >/dev/null 2>&1
assert_exit_code $? 2 "missing task should exit 2"

# 7. Relative --out from different cwd
mkdir -p "$TEST_TMP/rel_cwd"
(
  cd "$TEST_TMP/rel_cwd"
  bash "$TARGET_SCRIPT" --task t1 --arm bare --model pipeline-test --out "rel_out" >/dev/null 2>&1
)
assert_file_exists "$TEST_TMP/rel_cwd/rel_out/result.json"

# 8. Invalid --max-rounds
bash "$TARGET_SCRIPT" --task t1 --arm bare --model pipeline-test --out "$TEST_TMP/out_invalid_rounds" --max-rounds banana >/dev/null 2>&1
assert_exit_code $? 2 "invalid --max-rounds should exit 2"

finalize_test
