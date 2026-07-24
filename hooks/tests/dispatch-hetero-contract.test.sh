#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

echo "--- Setting up contract dispatch test environment ---"

STUB="$TEST_TMP/codex"
MINI_REPO="$TEST_TMP/consuming-repo"
ENGINE_SCORES_DIR="$TEST_TMP/engine-scores"
ENGINE_CAPS_DIR="$TEST_TMP/engine-caps"
SESSION_MODE_DIR="$TEST_TMP/session-mode"
RUN_MARKER_PATH="$TEST_TMP/run-marker"

mkdir -p "$MINI_REPO" "$ENGINE_SCORES_DIR" "$ENGINE_CAPS_DIR" "$SESSION_MODE_DIR"

cat > "$STUB" <<'EOF_STUB'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
echo done > done.txt
git add done.txt
git -c user.email=t@t -c user.name=t commit -q -m "stub work"
echo "RAN_MARKER" > "$RUN_MARKER_PATH"
exit 0
EOF_STUB
chmod +x "$STUB"

git -C "$MINI_REPO" init -b main -q
git -C "$MINI_REPO" config user.email "t@t"
git -C "$MINI_REPO" config user.name "t"

mkdir -p "$MINI_REPO/docs/plans"
mkdir -p "$MINI_REPO/.claude"

printf 'Prereq content\n' > "$MINI_REPO/preq.txt"
git -C "$MINI_REPO" add -A
git -C "$MINI_REPO" commit -q -m "A"
DEP_SHA=$(git -C "$MINI_REPO" rev-parse HEAD)

printf '## Unit spec\n' > "$MINI_REPO/docs/plans/spec.md"
printf 'Stable body\n' >> "$MINI_REPO/docs/plans/spec.md"
printf '# Review Loop Config\n- implementer_engine: gpt-5.3-codex-spark\n- implementer_runner: codex\n' > "$MINI_REPO/.claude/review-loop-config.md"
printf 'Secret\n' > "$MINI_REPO/secret.txt"
git -C "$MINI_REPO" add -A
git -C "$MINI_REPO" commit -q -m "B"
BASE_SHA=$(git -C "$MINI_REPO" rev-parse HEAD)

VALID_CONTRACT="$TEST_TMP/contract.json"
INVALID_CONTRACT="$TEST_TMP/bad-contract.json"

cat > "$VALID_CONTRACT" <<EOF_CONTRACT
{
  "schema": 1,
  "unit_id": "c2-fixture-unit",
  "role": "implementer",
  "goal": "fixture",
  "spec": {"path": "docs/plans/spec.md", "section": "Unit spec"},
  "base_sha": "$BASE_SHA",
  "depends_on": ["$DEP_SHA"],
  "scope": {"allow_paths": ["done.txt"], "deny_paths": ["secret/**"], "max_files": 2, "max_diff_lines": 50},
  "go": {"required_paths": ["docs/plans/spec.md"], "required_engine_role": "implementer", "required_red_command": ["bash", "-n", "docs/plans/spec.md"]},
  "no_go": {"on_missing_spec": "stop", "on_dirty_base": "stop", "on_unknown_engine": "stop", "on_quota_unavailable": "stop", "on_scope_violation": "stop", "on_budget_exceeded": "stop", "on_clarification_needed": "stop", "forbidden_actions": ["push", "merge", "network", "dependency-change"]},
  "output": {"kind": "commit", "paths": ["done.txt"]},
  "acceptance": [{"argv": ["true"], "exit": 0}],
  "budget": {"wall_seconds": 120, "max_attempts": 1, "max_context_files": 4}
}
EOF_CONTRACT

cat > "$INVALID_CONTRACT" <<EOF_BAD_CONTRACT
{
  "schema": 1,
  "role": "implementer",
  "goal": "fixture",
  "spec": {"path": "docs/plans/spec.md", "section": "Unit spec"},
  "base_sha": "$BASE_SHA",
  "depends_on": ["$DEP_SHA"],
  "scope": {"allow_paths": ["done.txt"], "deny_paths": ["secret/**"], "max_files": 2, "max_diff_lines": 50},
  "go": {"required_paths": ["docs/plans/spec.md"], "required_engine_role": "implementer"},
  "no_go": {"on_missing_spec": "stop", "on_dirty_base": "stop", "on_unknown_engine": "stop", "on_quota_unavailable": "stop", "on_scope_violation": "stop", "on_budget_exceeded": "stop", "on_clarification_needed": "stop", "forbidden_actions": ["push", "merge", "network", "dependency-change"]},
  "output": {"kind": "commit", "paths": ["done.txt"]},
  "acceptance": [{"argv": ["true"], "exit": 0}],
  "budget": {"wall_seconds": 120, "max_attempts": 1, "max_context_files": 4}
}
EOF_BAD_CONTRACT

ENGINE_ROW='{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
RUNTIME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ENGINE_EVENT="{\"schema_version\":1,\"observed_at\":\"$RUNTIME_UTC\",\"runner\":\"codex\",\"model\":\"gpt-5.3-codex-spark\",\"role\":\"implementer\",\"runner_version\":\"v1.0.0\",\"capability\":{\"quota\":{\"status\":\"available\",\"confidence\":\"high\",\"ttl_seconds\":3600,\"reset_at\":null,\"evidence\":\"test\"}}}"

printf '%s\n' "$ENGINE_ROW" > "$TEST_TMP/engine-row.json"
printf '%s\n' "$ENGINE_EVENT" > "$TEST_TMP/engine-event.json"
if ! ENGINE_SCORECARD_DIR="$ENGINE_SCORES_DIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$TEST_TMP/engine-row.json" > /dev/null; then
    fail "Infrastructure error: scorecard seeding failed"
fi
if ! ENGINE_CAPABILITY_DIR="$ENGINE_CAPS_DIR" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/engine-event.json" > /dev/null; then
    fail "Infrastructure error: capability seeding failed"
fi

json_get() {
    local json="$1"
    local key="$2"
    echo "$json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);console.log(o['$key']===undefined?'':o['$key'])}catch(e){console.log('')}})"
}

CHECKER_OUT=$(ENGINE_SCORECARD_DIR="$ENGINE_SCORES_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPS_DIR" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$VALID_CONTRACT" --repo "$MINI_REPO" --json 2>&1)
CHECKER_JSON=$(echo "$CHECKER_OUT" | grep '^{' | tail -n 1)
GATE_VERDICT=$(json_get "$CHECKER_JSON" "verdict")
if [ "$GATE_VERDICT" != "GO" ]; then
    fail "Infrastructure error: valid contract did not produce exact GO from checker. Out: $CHECKER_OUT"
fi

EXPECTED_CONTRACT_SHA=$(json_get "$CHECKER_JSON" "contract_sha256")
EXPECTED_SPEC_SHA=$(json_get "$CHECKER_JSON" "spec_sha256")

run_dispatch() {
    local branch_name="$1"
    shift
    rm -f "$RUN_MARKER_PATH"
    printf 'Do the needful.\n' > "$TEST_TMP/prompt-$branch_name.txt"
    (
        cd "$MINI_REPO" || exit 9
        ENGINE_SCORECARD_DIR="$ENGINE_SCORES_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPS_DIR" \
        AUTOPILOT_DISPATCH_MANIFEST=0 DISPATCH_QUIET=1 \
        AUTOPILOT_SESSION_MODE_DIR="$SESSION_MODE_DIR" \
        RUN_MARKER_PATH="$RUN_MARKER_PATH" \
        TMPDIR="$CASE_TMP" \
        "$REPO_ROOT/scripts/dispatch-hetero.sh" \
            --branch "$branch_name" \
            --prompt-file "$TEST_TMP/prompt-$branch_name.txt" \
            --runner codex \
            --model gpt-5.3-codex-spark \
            --codex-bin "$STUB" \
            "$@" 2>&1
    )
}

get_last_json() {
    echo "$1" | grep '^{' | tail -n 1
}

assert_no_hetero_worktrees() {
    local dir="$CASE_TMP"
    local count
    count=$(find "$dir" -maxdepth 1 -name 'hetero-*' 2>/dev/null | grep -c . || true)
    assert_eq "0" "$count"
}


echo "--- R1: Strict contract flags alone fail (precondition) ---"
CASE_TMP="$TEST_TMP/case-r1a"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t1a" --strict-contract)
rc=$?
assert_eq "$rc" 2
assert_contains "$out" "precondition_failed"
assert_file_absent "$RUN_MARKER_PATH"
assert_no_hetero_worktrees

echo "--- R1: Contract file alone fails (precondition) ---"
CASE_TMP="$TEST_TMP/case-r1b"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t1b" --contract-file "$VALID_CONTRACT" --base main)
rc=$?
assert_eq "$rc" 2
assert_contains "$out" "precondition_failed"
assert_file_absent "$RUN_MARKER_PATH"
assert_no_hetero_worktrees


echo "--- R5: Active session marker blocks ---"
PAST_TS=$(date -u -d "-1 hour" +%Y-%m-%dT%H:%M:%SZ)
FUTURE_TS=$(date -u -d "+1 hour" +%Y-%m-%dT%H:%M:%SZ)
cat > "$SESSION_MODE_DIR/s1.json" <<EOF_MARKER
{"level":"l6","repo_root":"$MINI_REPO","started_at":"$PAST_TS","expires_at":"$FUTURE_TS"}
EOF_MARKER

CASE_TMP="$TEST_TMP/case-r5a"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t2a" --base main)
rc=$?
assert_eq "$rc" 2
assert_contains "$out" "precondition_failed"
assert_contains "$out" "l6"
assert_file_absent "$RUN_MARKER_PATH"
assert_no_hetero_worktrees

echo "--- R5: Active l5 marker blocks non-strict ---"
cat > "$SESSION_MODE_DIR/s1.json" <<EOF_MARKER
{"level":"l5","repo_root":"$MINI_REPO","started_at":"$PAST_TS","expires_at":"$FUTURE_TS"}
EOF_MARKER

CASE_TMP="$TEST_TMP/case-r5b"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t2b" --base main)
rc=$?
assert_eq "$rc" 2
assert_contains "$out" "precondition_failed"
assert_contains "$out" "l5"
assert_file_absent "$RUN_MARKER_PATH"
assert_no_hetero_worktrees

echo "--- R5: Expired session marker does not block ---"
PAST_TS_EXPIRED=$(date -u -d "-2 hours" +%Y-%m-%dT%H:%M:%SZ)
cat > "$SESSION_MODE_DIR/s1.json" <<EOF_MARKER
{"level":"l6","repo_root":"$MINI_REPO","started_at":"$PAST_TS","expires_at":"$PAST_TS_EXPIRED"}
EOF_MARKER

CASE_TMP="$TEST_TMP/case-r5c"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t2c" --base main)
rc=$?
assert_eq "$rc" 0
json=$(get_last_json "$out")
assert_contains "$json" '"status": "committed"'
assert_file_exists "$RUN_MARKER_PATH"

echo "--- R5: Foreign repo marker does not block ---"
cat > "$SESSION_MODE_DIR/s1.json" <<EOF_MARKER
{"level":"l6","repo_root":"/some/other/path","started_at":"$PAST_TS","expires_at":"$FUTURE_TS"}
EOF_MARKER

CASE_TMP="$TEST_TMP/case-r5d"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t2d" --base main)
rc=$?
assert_eq "$rc" 0
json=$(get_last_json "$out")
assert_contains "$json" '"status": "committed"'
assert_file_exists "$RUN_MARKER_PATH"
rm -f "$SESSION_MODE_DIR/s1.json"


echo "--- R2: Strict NO-GO (invalid contract) ---"
CASE_TMP="$TEST_TMP/case-r2"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t3" --strict-contract --contract-file "$INVALID_CONTRACT")
rc=$?
assert_eq "$rc" 2
assert_contains "$out" "precondition_failed"
assert_contains "$out" "unit_id"
assert_file_absent "$RUN_MARKER_PATH"
assert_no_hetero_worktrees


echo "--- R3: Strict GO (valid contract, omitted details) ---"
CASE_TMP="$TEST_TMP/case-r3"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t4" --strict-contract --contract-file "$VALID_CONTRACT")
rc=$?
assert_eq "$rc" 0
json=$(get_last_json "$out")
assert_contains "$json" '"status": "committed"'
assert_contains "$json" '"unit_id": "c2-fixture-unit"'
assert_contains "$json" '"go": "GO"'

CONTRACT_SHA=$(json_get "$json" "contract_sha256")
assert_eq "$CONTRACT_SHA" "$EXPECTED_CONTRACT_SHA"

SPEC_SHA=$(json_get "$json" "spec_sha256")
assert_eq "$SPEC_SHA" "$EXPECTED_SPEC_SHA"

assert_file_exists "$RUN_MARKER_PATH"


echo "--- R4: Disagreement on --base ---"
CASE_TMP="$TEST_TMP/case-r4a"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t5a" --strict-contract --contract-file "$VALID_CONTRACT" --base "$DEP_SHA")
rc=$?
assert_eq "$rc" 2
assert_contains "$out" "precondition_failed"
assert_file_absent "$RUN_MARKER_PATH"

echo "--- R4: Disagreement on --model ---"
CASE_TMP="$TEST_TMP/case-r4b"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t5b" --strict-contract --contract-file "$VALID_CONTRACT" --model gpt-5.5)
rc=$?
assert_eq "$rc" 2
assert_contains "$out" "precondition_failed"
assert_file_absent "$RUN_MARKER_PATH"

echo "--- R4: Disagreement on --timeout ---"
CASE_TMP="$TEST_TMP/case-r4c"
mkdir -p "$CASE_TMP"
out=$(run_dispatch "t5c" --strict-contract --contract-file "$VALID_CONTRACT" --timeout 9m)
rc=$?
assert_eq "$rc" 2
assert_contains "$out" "precondition_failed"
assert_file_absent "$RUN_MARKER_PATH"


echo "--- R6: Legacy dispatch byte-compat ---"
CASE_TMP="$TEST_TMP/case-r6"
mkdir -p "$CASE_TMP"
rm -f "$SESSION_MODE_DIR/s1.json"
out=$(run_dispatch "t6" --base main)
rc=$?
assert_eq "$rc" 0
json=$(get_last_json "$out")
assert_contains "$json" '"status": "committed"'
assert_not_contains "$json" "unit_id"
assert_not_contains "$json" '"go"'
assert_not_contains "$json" "contract_sha256"
assert_not_contains "$json" "spec_sha256"
assert_file_exists "$RUN_MARKER_PATH"


echo "--- R9: acceptance argv that cannot execute fails BEFORE the runner ---"
# spawnSync does not throw on ENOENT — it returns status=null with .error set — so the
# post-run acceptance check reports a generic "exit-code mismatch" only AFTER the engine
# has been paid for. Executability is provable at base, for free.
sed 's|"acceptance": \[{"argv": \["true"\], "exit": 0}\]|"acceptance": [{"argv": ["definitely-not-a-real-command-xyz"], "exit": 0}]|' \
  "$VALID_CONTRACT" > "$TEST_TMP/unrunnable-acceptance.json"
rm -f "$RUN_MARKER_PATH"
out=$(run_dispatch "r9" --strict-contract --contract-file "$TEST_TMP/unrunnable-acceptance.json")
json=$(get_last_json "$out")
assert_contains "$json" "precondition_failed"
assert_contains "$json" "acceptance"
# The decisive property: the engine must NEVER have been started.
assert_file_absent "$RUN_MARKER_PATH"

echo "--- R9b: negative control — a runnable acceptance still dispatches ---"
rm -f "$RUN_MARKER_PATH"
out=$(run_dispatch "r9b" --strict-contract --contract-file "$VALID_CONTRACT")
json=$(get_last_json "$out")
assert_not_contains "$json" "precondition_failed"

finalize_test