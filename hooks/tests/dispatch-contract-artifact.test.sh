#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection

json_get() { echo "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const p=process.argv[1].split('.');let v=o;for(const k of p){v=v?.[k];}console.log(v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v))}catch(e){console.log('')}})" "$2"; }

MINI_REPO="$TEST_TMP/mini-repo"
SCORES="$TEST_TMP/scores"
CAPS="$TEST_TMP/caps"
SESSION_DIR_EMPTY="$TEST_TMP/sessions-empty"
STUBS_DIR="$TEST_TMP/stubs"
CONTRACTS_DIR="$TEST_TMP/contracts"
PROMPT_FILE="$TEST_TMP/prompt.txt"

mkdir -p "$MINI_REPO" "$SCORES" "$CAPS" "$SESSION_DIR_EMPTY" "$STUBS_DIR" "$CONTRACTS_DIR"
printf 'Do the task.\n' > "$PROMPT_FILE"

git init -q -b main "$MINI_REPO"
(
  cd "$MINI_REPO" || exit 9
  git config user.email "test@example.com"
  git config user.name "Test User"
  printf 'Dependency\n' > dep.txt
  git add dep.txt
  git commit -qm "A"
  DEP_SHA=$(git rev-parse HEAD)
  mkdir -p docs/plans
  printf '## Unit spec\nBody.\n' > docs/plans/spec.md
  mkdir -p .claude
  printf '# Review Loop Config\n- implementer_engine: gpt-5.3-codex-spark\n- implementer_runner: codex\n' > .claude/review-loop-config.md
  printf 'keep\n' > keep.txt
  git add .
  git commit -qm "B"
  printf '%s\n' "$DEP_SHA" > "$TEST_TMP/dep.sha"
  git rev-parse HEAD > "$TEST_TMP/base.sha"
)

DEP_SHA=$(cat "$TEST_TMP/dep.sha")
BASE_SHA=$(cat "$TEST_TMP/base.sha")

ENGINE_ROW='{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
printf '%s\n' "$ENGINE_ROW" > "$TEST_TMP/engine-row.json"
if ! ENGINE_SCORECARD_DIR="$SCORES" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$TEST_TMP/engine-row.json" > /dev/null; then
  fail "Infrastructure error: scorecard seeding failed"
fi

OBSERVED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Exact resolver tuple: implementer_effort defaults to high; endpoint "" → null/@none.
ENGINE_EVENT='{"schema_version":1,"observed_at":"'"$OBSERVED_AT"'","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}'
printf '%s\n' "$ENGINE_EVENT" > "$TEST_TMP/engine-event.json"
if ! ENGINE_CAPABILITY_DIR="$CAPS" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/engine-event.json" > /dev/null; then
  fail "Infrastructure error: capability seeding failed"
fi

BASE_CONTRACT=$(cat <<EOF_CONTRACT
{"schema":1,"unit_id":"c3-fixture-unit","role":"implementer","goal":"fixture","spec":{"path":"docs/plans/spec.md","section":"Unit spec"},"base_sha":"$BASE_SHA","depends_on":["$DEP_SHA"],"scope":{"allow_paths":["done.txt"],"deny_paths":["secret/**"],"max_files":1,"max_diff_lines":10},"go":{"required_paths":["docs/plans/spec.md"],"required_engine_role":"implementer","required_red_command":["bash","-n","docs/plans/spec.md"]},"no_go":{"on_missing_spec":"stop","on_dirty_base":"stop","on_unknown_engine":"stop","on_quota_unavailable":"stop","on_scope_violation":"stop","on_budget_exceeded":"stop","on_clarification_needed":"stop","forbidden_actions":["push","merge","network","dependency-change"]},"output":{"kind":"commit","paths":["done.txt"]},"acceptance":[{"argv":["test","-f","done.txt"],"exit":0}],"budget":{"wall_seconds":120,"max_attempts":1,"max_context_files":4}}
EOF_CONTRACT
)
printf '%s\n' "$BASE_CONTRACT" > "$CONTRACTS_DIR/base.json"

CHECKER_OUT=$(ENGINE_SCORECARD_DIR="$SCORES" ENGINE_CAPABILITY_DIR="$CAPS" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACTS_DIR/base.json" --repo "$MINI_REPO" --json 2>&1)
CHECK_VERDICT=$(json_get "$CHECKER_OUT" "verdict")
assert_eq "$CHECK_VERDICT" "GO" || fail "Contract checker failed to return GO. Output: $CHECKER_OUT"

CONTRACT_ACC_FAIL=$(cat <<EOF_CONTRACT
{"schema":1,"unit_id":"c3-fixture-unit","role":"implementer","goal":"fixture","spec":{"path":"docs/plans/spec.md","section":"Unit spec"},"base_sha":"$BASE_SHA","depends_on":["$DEP_SHA"],"scope":{"allow_paths":["done.txt"],"deny_paths":["secret/**"],"max_files":1,"max_diff_lines":10},"go":{"required_paths":["docs/plans/spec.md"],"required_engine_role":"implementer","required_red_command":["bash","-n","docs/plans/spec.md"]},"no_go":{"on_missing_spec":"stop","on_dirty_base":"stop","on_unknown_engine":"stop","on_quota_unavailable":"stop","on_scope_violation":"stop","on_budget_exceeded":"stop","on_clarification_needed":"stop","forbidden_actions":["push","merge","network","dependency-change"]},"output":{"kind":"commit","paths":["done.txt"]},"acceptance":[{"argv":["false"],"exit":0}],"budget":{"wall_seconds":120,"max_attempts":1,"max_context_files":4}}
EOF_CONTRACT
)
printf '%s\n' "$CONTRACT_ACC_FAIL" > "$CONTRACTS_DIR/acc_fail.json"

CONTRACT_ACC_ALT=$(cat <<EOF_CONTRACT
{"schema":1,"unit_id":"c3-fixture-unit","role":"implementer","goal":"fixture","spec":{"path":"docs/plans/spec.md","section":"Unit spec"},"base_sha":"$BASE_SHA","depends_on":["$DEP_SHA"],"scope":{"allow_paths":["done.txt"],"deny_paths":["secret/**"],"max_files":1,"max_diff_lines":10},"go":{"required_paths":["docs/plans/spec.md"],"required_engine_role":"implementer","required_red_command":["bash","-n","docs/plans/spec.md"]},"no_go":{"on_missing_spec":"stop","on_dirty_base":"stop","on_unknown_engine":"stop","on_quota_unavailable":"stop","on_scope_violation":"stop","on_budget_exceeded":"stop","on_clarification_needed":"stop","forbidden_actions":["push","merge","network","dependency-change"]},"output":{"kind":"commit","paths":["done.txt"]},"acceptance":[{"argv":["test","-f","done.txt"],"exit":0},{"argv":["true"],"exit":0}],"budget":{"wall_seconds":120,"max_attempts":1,"max_context_files":4}}
EOF_CONTRACT
)
printf '%s\n' "$CONTRACT_ACC_ALT" > "$CONTRACTS_DIR/acc_alt.json"

CONTRACT_MISS=$(cat <<EOF_CONTRACT
{"schema":1,"unit_id":"c3-fixture-unit","role":"implementer","goal":"fixture","spec":{"path":"docs/plans/spec.md","section":"Unit spec"},"base_sha":"$BASE_SHA","depends_on":["$DEP_SHA"],"scope":{"allow_paths":["done.txt","other.txt"],"deny_paths":["secret/**"],"max_files":2,"max_diff_lines":10},"go":{"required_paths":["docs/plans/spec.md"],"required_engine_role":"implementer","required_red_command":["bash","-n","docs/plans/spec.md"]},"no_go":{"on_missing_spec":"stop","on_dirty_base":"stop","on_unknown_engine":"stop","on_quota_unavailable":"stop","on_scope_violation":"stop","on_budget_exceeded":"stop","on_clarification_needed":"stop","forbidden_actions":["push","merge","network","dependency-change"]},"output":{"kind":"commit","paths":["done.txt"]},"acceptance":[{"argv":["test","-f","done.txt"],"exit":0}],"budget":{"wall_seconds":120,"max_attempts":1,"max_context_files":4}}
EOF_CONTRACT
)
printf '%s\n' "$CONTRACT_MISS" > "$CONTRACTS_DIR/miss.json"

CONTRACT_MIRROR=$(cat <<EOF_CONTRACT
{"schema":1,"unit_id":"c3-fixture-unit","role":"implementer","goal":"fixture","spec":{"path":"docs/plans/spec.md","section":"Unit spec"},"base_sha":"$BASE_SHA","depends_on":["$DEP_SHA"],"scope":{"allow_paths":["done.txt"],"deny_paths":["secret/**"],"max_files":2,"max_diff_lines":10,"generated_mirrors":{"command":["true"],"allow_paths":["mirror/copy.txt"]}},"go":{"required_paths":["docs/plans/spec.md"],"required_engine_role":"implementer","required_red_command":["bash","-n","docs/plans/spec.md"]},"no_go":{"on_missing_spec":"stop","on_dirty_base":"stop","on_unknown_engine":"stop","on_quota_unavailable":"stop","on_scope_violation":"stop","on_budget_exceeded":"stop","on_clarification_needed":"stop","forbidden_actions":["push","merge","network","dependency-change"]},"output":{"kind":"commit","paths":["done.txt"]},"acceptance":[{"argv":["test","-f","done.txt"],"exit":0}],"budget":{"wall_seconds":120,"max_attempts":1,"max_context_files":4}}
EOF_CONTRACT
)
printf '%s\n' "$CONTRACT_MIRROR" > "$CONTRACTS_DIR/mirror.json"

write_stub_head() {
  local f="$1"
  cat > "$f" <<'EOF_STUB'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
EOF_STUB
}

write_stub_head "$STUBS_DIR/ok.sh"
cat >> "$STUBS_DIR/ok.sh" <<'EOF_STUB'
echo hi > done.txt
git add -A
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF_STUB
chmod +x "$STUBS_DIR/ok.sh"

write_stub_head "$STUBS_DIR/extra.sh"
cat >> "$STUBS_DIR/extra.sh" <<'EOF_STUB'
echo hi > done.txt
echo stray > stray.txt
git add -A
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF_STUB
chmod +x "$STUBS_DIR/extra.sh"

write_stub_head "$STUBS_DIR/deny.sh"
cat >> "$STUBS_DIR/deny.sh" <<'EOF_STUB'
echo hi > done.txt
mkdir -p secret
echo leak > secret/leak.txt
git add -A
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF_STUB
chmod +x "$STUBS_DIR/deny.sh"

write_stub_head "$STUBS_DIR/big.sh"
cat >> "$STUBS_DIR/big.sh" <<'EOF_STUB'
for i in $(seq 1 30); do
  echo "line $i" >> done.txt
done
git add -A
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF_STUB
chmod +x "$STUBS_DIR/big.sh"

write_stub_head "$STUBS_DIR/missing.sh"
cat >> "$STUBS_DIR/missing.sh" <<'EOF_STUB'
echo hi > other.txt
git add -A
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF_STUB
chmod +x "$STUBS_DIR/missing.sh"

write_stub_head "$STUBS_DIR/mirror.sh"
cat >> "$STUBS_DIR/mirror.sh" <<'EOF_STUB'
echo hi > done.txt
mkdir -p mirror
echo mirror > mirror/copy.txt
git add -A
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF_STUB
chmod +x "$STUBS_DIR/mirror.sh"

run_dispatch() {
  local case_name="$1"
  local stub="$2"
  local contract="$3"
  local case_tmp="$TEST_TMP/$case_name"
  mkdir -p "$case_tmp"
  (
    cd "$MINI_REPO" || exit 9
    ENGINE_SCORECARD_DIR="$SCORES" ENGINE_CAPABILITY_DIR="$CAPS" \
    AUTOPILOT_DISPATCH_MANIFEST=0 DISPATCH_QUIET=1 \
    AUTOPILOT_SESSION_MODE_DIR="$SESSION_DIR_EMPTY" \
    TMPDIR="$case_tmp" \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" --branch "br-$case_name" --prompt-file "$PROMPT_FILE" \
      --runner codex --model gpt-5.3-codex-spark --codex-bin "$stub" \
      --strict-contract --contract-file "$contract" 2>&1
  ) > "$case_tmp/out.txt"
  DISPATCH_RC=$?
  DISPATCH_OUT=$(cat "$case_tmp/out.txt" 2>/dev/null || echo "")
  if [ -z "$DISPATCH_OUT" ]; then
    fail "Dispatch returned empty output for case $case_name (rc=$DISPATCH_RC)"
  fi
  LAST_JSON=$(echo "$DISPATCH_OUT" | grep -E '^\{.*\}' | tail -n 1)
  if [ -z "$LAST_JSON" ]; then
    fail "Failed to extract last JSON line for case $case_name. Output: $DISPATCH_OUT"
  fi
}

# Case 1: Clean pass
run_dispatch "case1" "$STUBS_DIR/ok.sh" "$CONTRACTS_DIR/base.json"
assert_eq "$DISPATCH_RC" "0"
STATUS1=$(json_get "$LAST_JSON" "status")
assert_eq "$STATUS1" "committed"
assert_contains "$LAST_JSON" '"boundary": "ok"'
assert_contains "$LAST_JSON" '"acceptance": "ok"'
UNIT_ID1=$(json_get "$LAST_JSON" "unit_id")
assert_eq "$UNIT_ID1" "c3-fixture-unit"
GO_VERDICT1=$(json_get "$LAST_JSON" "go")
assert_eq "$GO_VERDICT1" "GO"

# Case 2: Out-of-allowlist
run_dispatch "case2" "$STUBS_DIR/extra.sh" "$CONTRACTS_DIR/base.json"
assert_eq "$DISPATCH_RC" "1"
STATUS2=$(json_get "$LAST_JSON" "status")
assert_eq "$STATUS2" "boundary_rejected"
assert_contains "$DISPATCH_OUT" "stray.txt"
assert_not_contains "$LAST_JSON" '"acceptance": "ok"'

# Case 3: Deny-path
run_dispatch "case3" "$STUBS_DIR/deny.sh" "$CONTRACTS_DIR/base.json"
assert_eq "$DISPATCH_RC" "1"
STATUS3=$(json_get "$LAST_JSON" "status")
assert_eq "$STATUS3" "boundary_rejected"
assert_contains "$DISPATCH_OUT" "secret/leak.txt"

# Case 4: Budget
run_dispatch "case4" "$STUBS_DIR/big.sh" "$CONTRACTS_DIR/base.json"
assert_eq "$DISPATCH_RC" "1"
STATUS4=$(json_get "$LAST_JSON" "status")
assert_eq "$STATUS4" "boundary_rejected"
assert_contains "$DISPATCH_OUT" "diff"
assert_contains "$DISPATCH_OUT" "budget"

# Case 5: Missing declared output
run_dispatch "case5" "$STUBS_DIR/missing.sh" "$CONTRACTS_DIR/miss.json"
assert_eq "$DISPATCH_RC" "1"
STATUS5=$(json_get "$LAST_JSON" "status")
assert_eq "$STATUS5" "boundary_rejected"
assert_contains "$DISPATCH_OUT" "done.txt"

# Case 6: Acceptance failure
run_dispatch "case6" "$STUBS_DIR/ok.sh" "$CONTRACTS_DIR/acc_fail.json"
assert_eq "$DISPATCH_RC" "1"
STATUS6=$(json_get "$LAST_JSON" "status")
assert_eq "$STATUS6" "acceptance_failed"

# Case 7: Acceptance pass alt
run_dispatch "case7" "$STUBS_DIR/ok.sh" "$CONTRACTS_DIR/acc_alt.json"
assert_eq "$DISPATCH_RC" "0"
STATUS7=$(json_get "$LAST_JSON" "status")
assert_eq "$STATUS7" "committed"

# Case 8: Mirror allow-paths permitted
run_dispatch "case8" "$STUBS_DIR/mirror.sh" "$CONTRACTS_DIR/mirror.json"
assert_eq "$DISPATCH_RC" "0"
STATUS8=$(json_get "$LAST_JSON" "status")
assert_eq "$STATUS8" "committed"
assert_contains "$LAST_JSON" '"boundary": "ok"'
assert_not_contains "$LAST_JSON" "boundary_rejected"

# Case 9: frozen_four_tuple digest immutability (autonomous-brain P1 / KR1 wiring).
# check must name a modified frozen surface; a fresh digest must not raise it.
FFT_BASE_SHA=$(git -C "$MINI_REPO" rev-parse HEAD)
SPEC_SHA=$(sha256sum "$MINI_REPO/docs/plans/spec.md" | cut -d' ' -f1)
DAG_JSON='{"schema":1,"deliverables":[{"id":"c3-fixture-unit","paths":["done.txt"],"churn_budget":{"max_files":1,"max_lines":10}}]}'
printf '%s\n' "$DAG_JSON" > "$MINI_REPO/dag.json"
( cd "$MINI_REPO" && git add dag.json && git commit -qm dag )
FFT_BASE_SHA=$(git -C "$MINI_REPO" rev-parse HEAD)
DAG_SHA=$(sha256sum "$MINI_REPO/dag.json" | cut -d' ' -f1)
fft_contract() { # $1 out, $2 dag digest
  node -e "
const fs=require('fs');
const c=JSON.parse(fs.readFileSync('$CONTRACTS_DIR/base.json','utf8'));
c.base_sha='$FFT_BASE_SHA';
c.frozen_four_tuple={granularity_path:'dag.json',granularity_digest:'$2',
  gate_set:['defect-review'],rubric_path:'docs/plans/spec.md',rubric_digest:'$SPEC_SHA',
  control_plane_pins:{'docs/plans/spec.md':'$SPEC_SHA'}};
fs.writeFileSync('$1',JSON.stringify(c));"
}
fft_contract "$CONTRACTS_DIR/fft-bad.json" "0000000000000000000000000000000000000000000000000000000000000000"
FFT_OUT=$(ENGINE_SCORECARD_DIR="$SCORES" ENGINE_CAPABILITY_DIR="$CAPS" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACTS_DIR/fft-bad.json" --repo "$MINI_REPO" --json 2>&1 || true)
assert_contains "$FFT_OUT" "frozen surface was modified" "stale granularity digest is named by check"
fft_contract "$CONTRACTS_DIR/fft-ok.json" "$DAG_SHA"
FFT_OUT=$(ENGINE_SCORECARD_DIR="$SCORES" ENGINE_CAPABILITY_DIR="$CAPS" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACTS_DIR/fft-ok.json" --repo "$MINI_REPO" --json 2>&1 || true)
assert_not_contains "$FFT_OUT" "frozen surface was modified" "fresh digests raise no frozen-surface reason"

# Case 10: first-use qualification override (autonomous-brain P7, KR6).
# No evidence + no override → refusal; valid override → GO with the reason
# recorded (never silent); expired override → refusal. Empty scorecard dir
# simulates an engine with no evidence at all.
EMPTY_SCORES="$TEST_TMP/scores-empty"; mkdir -p "$EMPTY_SCORES"
KR6_OUT=$(ENGINE_SCORECARD_DIR="$EMPTY_SCORES" ENGINE_CAPABILITY_DIR="$CAPS" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACTS_DIR/base.json" --repo "$MINI_REPO" --json 2>&1 || true)
assert_contains "$KR6_OUT" "no qualified scorecard row" "no evidence + no override refused"
assert_contains "$KR6_OUT" "qualification-override is the only evidence-free path" "the only bypass is named"
cat > "$TEST_TMP/override.json" <<'JSON'
{"schema":1,"overrides":[{"engine":"gpt-5.3-codex-spark","runner":"codex","role":"implementer","reason":"first-use audition, operator accepts risk","operator":"cookys","expires":"2099-01-01"}]}
JSON
KR6_OUT=$(ENGINE_SCORECARD_DIR="$EMPTY_SCORES" ENGINE_CAPABILITY_DIR="$CAPS" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACTS_DIR/base.json" --repo "$MINI_REPO" --qualification-override "$TEST_TMP/override.json" --json 2>&1 || true)
assert_contains "$KR6_OUT" '"verdict":"GO"' "valid override admits"
assert_contains "$KR6_OUT" '"assurance":"operator-override"' "evidence-free admission named"
assert_contains "$KR6_OUT" "first-use audition" "override reason recorded in the GO output"
cat > "$TEST_TMP/override-expired.json" <<'JSON'
{"schema":1,"overrides":[{"engine":"gpt-5.3-codex-spark","runner":"codex","role":"implementer","reason":"stale","operator":"cookys","expires":"2020-01-01"}]}
JSON
KR6_OUT=$(ENGINE_SCORECARD_DIR="$EMPTY_SCORES" ENGINE_CAPABILITY_DIR="$CAPS" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACTS_DIR/base.json" --repo "$MINI_REPO" --qualification-override "$TEST_TMP/override-expired.json" --json 2>&1 || true)
assert_contains "$KR6_OUT" "no qualified scorecard row" "expired override refused"

finalize_test
