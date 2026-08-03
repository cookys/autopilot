#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection

json_get() { echo "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const p=process.argv[1].split('.');let v=o;for(const k of p){v=v?.[k];}console.log(v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v))}catch(e){console.log('')}})" "$2"; }

run_dispatch() {
  local out
  local rc
  out=$("$@" 2>&1)
  rc=$?
  LAST_OUT="$out"
  LAST_RC="$rc"
}

MINI_REPO="$TEST_TMP/mini_repo"
STORE="$TEST_TMP/store"
CASE_DIR="$TEST_TMP/cases"
FAKE_JS="$TEST_TMP/fake_runner.js"
RUN_MARKER="$TEST_TMP/run_marker"
PROMPT_FILE="$TEST_TMP/prompt.txt"
BREACH_TARGET="$MINI_REPO/docs/plans/spec.md"

mkdir -p "$STORE"
mkdir -p "$CASE_DIR"

cat > "$PROMPT_FILE" <<EOF
Prompt body for tests.
EOF

cat > "$FAKE_JS" <<'EOF'
#!/usr/bin/env node
const fs = require('fs');
if (process.env.RUN_MARKER_PATH) {
  try { fs.writeFileSync(process.env.RUN_MARKER_PATH, 'RAN\n'); } catch (e) {}
}
if (process.env.BREACH_TARGET) {
  try { fs.appendFileSync(process.env.BREACH_TARGET, 'BREACH\n'); } catch (e) {}
}
process.stdout.write('Fake deterministic author output.\n');
EOF

IMPL_ROW='{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
# Exact resolver tuples: implementer effort defaults to high / endpoint null;
# VA config pins verification_author_effort=high / endpoint "".
IMPL_EVENT='{"schema_version":1,"observed_at":"OLD","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}'

VA_ROW='{"engine":"glm-5.2","runner":"anthropic-compatible","family":"zhipu","role":"verification_author","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
VA_EVENT='{"schema_version":1,"observed_at":"OLD","runner":"anthropic-compatible","model":"glm-5.2","role":"verification_author","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}'

OBSERVED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
IMPL_EVENT='{"schema_version":1,"observed_at":"'"$OBSERVED_AT"'","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}'
VA_EVENT='{"schema_version":1,"observed_at":"'"$OBSERVED_AT"'","runner":"anthropic-compatible","model":"glm-5.2","role":"verification_author","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}'
printf '%s\n' "$IMPL_ROW"  > "$TEST_TMP/impl-row.json"
printf '%s\n' "$IMPL_EVENT" > "$TEST_TMP/impl-event.json"
printf '%s\n' "$VA_ROW"    > "$TEST_TMP/va-row.json"
printf '%s\n' "$VA_EVENT"  > "$TEST_TMP/va-event.json"
if ! ENGINE_SCORECARD_DIR="$STORE" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$TEST_TMP/impl-row.json" > /dev/null; then
  fail "Infrastructure error: failed to seed implementer row"
fi
if ! ENGINE_CAPABILITY_DIR="$STORE" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/impl-event.json" > /dev/null; then
  fail "Infrastructure error: failed to seed implementer event"
fi
if ! ENGINE_SCORECARD_DIR="$STORE" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$TEST_TMP/va-row.json" > /dev/null; then
  fail "Infrastructure error: failed to seed VA row"
fi
if ! ENGINE_CAPABILITY_DIR="$STORE" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/va-event.json" > /dev/null; then
  fail "Infrastructure error: failed to seed VA event"
fi

mkdir -p "$MINI_REPO"
cd "$MINI_REPO"
git init -qb main >/dev/null 2>&1
git config user.name "Test" >/dev/null 2>&1
git config user.email "test@test.com" >/dev/null 2>&1
echo "dep" > dep.txt
git add dep.txt >/dev/null 2>&1
git commit -m "A" >/dev/null 2>&1
DEP_SHA=$(git rev-parse HEAD)
mkdir -p docs/plans .claude
printf "## Unit spec\nBody line.\n" > docs/plans/spec.md
cat > .claude/review-loop-config.md <<EOF
# Review Loop Config
- implementer_engine: gpt-5.3-codex-spark
- implementer_runner: codex
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: anthropic-compatible
- verification_author_effort: high
EOF
git add . >/dev/null 2>&1
git commit -m "B" >/dev/null 2>&1
BASE_SHA=$(git rev-parse HEAD)
cd "$TEST_TMP"

cat > "$TEST_TMP/contract.json" <<EOF
{"schema":1,"unit_id":"c4b-fixture-unit","role":"verification-author","goal":"fixture","spec":{"path":"docs/plans/spec.md","section":"Unit spec"},"base_sha":"$BASE_SHA","depends_on":["$DEP_SHA"],"scope":{"allow_paths":["oracle.out.sh"],"deny_paths":["secret/**"],"max_files":1,"max_diff_lines":900},"go":{"required_paths":["docs/plans/spec.md"],"required_engine_role":"verification-author","required_red_command":["bash","-n","docs/plans/spec.md"]},"no_go":{"on_missing_spec":"stop","on_dirty_base":"stop","on_unknown_engine":"stop","on_quota_unavailable":"stop","on_scope_violation":"stop","on_budget_exceeded":"stop","on_clarification_needed":"stop","forbidden_actions":["push","merge","network","dependency-change"]},"output":{"kind":"raw-artifact","paths":["oracle.out.sh"]},"acceptance":[{"argv":["true"],"exit":0}],"budget":{"wall_seconds":120,"max_attempts":1,"max_context_files":4}}
EOF

cat > "$TEST_TMP/invalid_contract.json" <<EOF
{"schema":1,"role":"verification-author","goal":"fixture","spec":{"path":"docs/plans/spec.md","section":"Unit spec"},"base_sha":"$BASE_SHA","depends_on":["$DEP_SHA"],"scope":{"allow_paths":["oracle.out.sh"],"deny_paths":["secret/**"],"max_files":1,"max_diff_lines":900},"go":{"required_paths":["docs/plans/spec.md"],"required_engine_role":"verification-author","required_red_command":["bash","-n","docs/plans/spec.md"]},"no_go":{"on_missing_spec":"stop","on_dirty_base":"stop","on_unknown_engine":"stop","on_quota_unavailable":"stop","on_scope_violation":"stop","on_budget_exceeded":"stop","on_clarification_needed":"stop","forbidden_actions":["push","merge","network","dependency-change"]},"output":{"kind":"raw-artifact","paths":["oracle.out.sh"]},"acceptance":[{"argv":["true"],"exit":0}],"budget":{"wall_seconds":120,"max_attempts":1,"max_context_files":4}}
EOF

CONTRACT="$TEST_TMP/contract.json"
INVALID_CONTRACT="$TEST_TMP/invalid_contract.json"

SANITY_OUT=$(ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT" --repo "$MINI_REPO" --json 2>&1)
SANITY_RC=$?
if [ "$SANITY_RC" -ne 0 ]; then
  fail "Sanity gate failed with rc=$SANITY_RC and output: $SANITY_OUT"
fi
SANITY_VERDICT=$(json_get "$SANITY_OUT" verdict)
if [ "$SANITY_VERDICT" != "GO" ]; then
  fail "Sanity gate expected GO, got $SANITY_VERDICT"
fi

EXPECTED_MODEL=$(json_get "$SANITY_OUT" resolved_engine.model)
EXPECTED_RUNNER=$(json_get "$SANITY_OUT" resolved_engine.runner)
EXPECTED_CONTRACT_SHA=$(json_get "$SANITY_OUT" contract_sha256)
EXPECTED_SPEC_SHA=$(json_get "$SANITY_OUT" spec_sha256)

write_marker() {
  local dir="$1"
  local type="$2"
  mkdir -p "$dir"
  local past expires repo
  past=$(date -u -d "1 hour ago" +%Y-%m-%dT%H:%M:%SZ)
  repo=$(cd "$MINI_REPO" && pwd)
  if [ "$type" = "active" ]; then
    expires=$(date -u -d "1 hour" +%Y-%m-%dT%H:%M:%SZ)
    cat > "$dir/active.json" <<EOF
{"level":"l6","repo_root":"$repo","started_at":"$past","expires_at":"$expires"}
EOF
  elif [ "$type" = "expired" ]; then
    expires=$(date -u -d "1 hour ago" +%Y-%m-%dT%H:%M:%SZ)
    cat > "$dir/expired.json" <<EOF
{"level":"l6","repo_root":"$repo","started_at":"$past","expires_at":"$expires"}
EOF
  elif [ "$type" = "foreign" ]; then
    expires=$(date -u -d "1 hour" +%Y-%m-%dT%H:%M:%SZ)
    cat > "$dir/foreign.json" <<EOF
{"level":"l6","repo_root":"/elsewhere","started_at":"$past","expires_at":"$expires"}
EOF
  fi
}

DISPATCH_BASE=(env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A1_1" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh")
STRICT_FLAGS=(--strict-contract --contract-file "$CONTRACT" --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS")

mkdir -p "$CASE_DIR/A1_1" "$CASE_DIR/A1_2" "$CASE_DIR/A1_3"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A1_1" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$CONTRACT" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
assert_eq "$LAST_RC" 2 "A1 missing repo_root should rc=2"

run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A1_2" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
assert_eq "$LAST_RC" 2 "A1 missing contract_file should rc=2"

run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A1_3" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --contract-file "$CONTRACT" --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
assert_eq "$LAST_RC" 2 "A1 missing strict-contract should rc=2"

mkdir -p "$CASE_DIR/A2_block"
write_marker "$CASE_DIR/A2_block" active
rm -f "$RUN_MARKER"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A2_block" ANTHROPIC_COMPATIBLE_BASE_URL=http://127.0.0.1:9 RUN_MARKER_PATH="$RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --runner anthropic-compatible --model glm-5.2 --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS" --repo-root "$MINI_REPO"
assert_eq "$LAST_RC" 2 "A2 l6 blocks non-strict"
assert_contains "$LAST_OUT" "l6" "A2 block should name level"
assert_file_absent "$RUN_MARKER" "A2 block runner must not run"

mkdir -p "$CASE_DIR/A2_expired"
write_marker "$CASE_DIR/A2_expired" expired
rm -f "$RUN_MARKER"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A2_expired" ANTHROPIC_COMPATIBLE_BASE_URL=http://127.0.0.1:9 RUN_MARKER_PATH="$RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --runner anthropic-compatible --model glm-5.2 --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS" --repo-root "$MINI_REPO"
assert_eq "$LAST_RC" 0 "A2 expired proceeds"
assert_contains "$LAST_OUT" "authored" "A2 expired should author"

mkdir -p "$CASE_DIR/A2_foreign"
write_marker "$CASE_DIR/A2_foreign" foreign
rm -f "$RUN_MARKER"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A2_foreign" ANTHROPIC_COMPATIBLE_BASE_URL=http://127.0.0.1:9 RUN_MARKER_PATH="$RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --runner anthropic-compatible --model glm-5.2 --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS" --repo-root "$MINI_REPO"
assert_eq "$LAST_RC" 0 "A2 foreign proceeds"
assert_contains "$LAST_OUT" "authored" "A2 foreign should author"

mkdir -p "$CASE_DIR/A3"
rm -f "$RUN_MARKER"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A3" RUN_MARKER_PATH="$RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$INVALID_CONTRACT" --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
assert_eq "$LAST_RC" 2 "A3 invalid contract should rc=2"
assert_file_absent "$RUN_MARKER" "A3 fake runner must not run"

mkdir -p "$CASE_DIR/A4"
rm -f "$RUN_MARKER"
A4_RUN_MARKER="$TEST_TMP/a4_run_marker"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A4" RUN_MARKER_PATH="$A4_RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$CONTRACT" --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
assert_eq "$LAST_RC" 0 "A4 valid GO should rc=0"
assert_file_exists "$A4_RUN_MARKER" "A4 runner must execute"
A4_STATUS=$(json_get "$LAST_OUT" status)
A4_UNIT=$(json_get "$LAST_OUT" unit_id)
A4_GO=$(json_get "$LAST_OUT" go)
A4_CONT=$(json_get "$LAST_OUT" containment)
A4_CSHA=$(json_get "$LAST_OUT" contract_sha256)
A4_SSHA=$(json_get "$LAST_OUT" spec_sha256)
A4_RUNNER=$(json_get "$LAST_OUT" runner)
A4_MODEL=$(json_get "$LAST_OUT" model)
assert_eq "$A4_STATUS" "authored" "A4 status authored"
assert_eq "$A4_UNIT" "c4b-fixture-unit" "A4 unit_id matches"
assert_eq "$A4_GO" "GO" "A4 go matches"
assert_eq "$A4_CONT" "clean" "A4 containment clean"
assert_eq "$A4_CSHA" "$EXPECTED_CONTRACT_SHA" "A4 contract_sha matches"
assert_eq "$A4_SSHA" "$EXPECTED_SPEC_SHA" "A4 spec_sha matches"
assert_eq "$A4_RUNNER" "anthropic-compatible" "A4 runner matches"
assert_eq "$A4_MODEL" "glm-5.2" "A4 model matches"

mkdir -p "$CASE_DIR/A5_model"
rm -f "$RUN_MARKER"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A5_model" RUN_MARKER_PATH="$RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$CONTRACT" --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS" --model wrong-model
assert_eq "$LAST_RC" 2 "A5 model disagreement should rc=2"

mkdir -p "$CASE_DIR/A5_timeout"
rm -f "$RUN_MARKER"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A5_timeout" RUN_MARKER_PATH="$RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$CONTRACT" --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS" --timeout 999
assert_eq "$LAST_RC" 2 "A5 timeout disagreement should rc=2"

mkdir -p "$CASE_DIR/A5_runner"
rm -f "$RUN_MARKER"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A5_runner" RUN_MARKER_PATH="$RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$CONTRACT" --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS" --runner codex
assert_eq "$LAST_RC" 2 "A5 runner disagreement should rc=2"
assert_file_absent "$RUN_MARKER" "A5 runner runner must not execute"

mkdir -p "$CASE_DIR/A6"
rm -f "$RUN_MARKER"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A6" RUN_MARKER_PATH="$RUN_MARKER" BREACH_TARGET="$BREACH_TARGET" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$CONTRACT" --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
if [ "$LAST_RC" -eq 0 ]; then fail "A6 breach should have nonzero exit"; fi
A6_STATUS=$(json_get "$LAST_OUT" status)
assert_eq "$A6_STATUS" "containment_breach" "A6 status breach"
assert_not_contains "$LAST_OUT" "authored" "A6 must not be authored"
cd "$MINI_REPO" && git checkout -- . >/dev/null 2>&1 && cd "$TEST_TMP"

mkdir -p "$CASE_DIR/A7"
rm -f "$RUN_MARKER"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A7" ANTHROPIC_COMPATIBLE_BASE_URL=http://127.0.0.1:9 RUN_MARKER_PATH="$RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --runner anthropic-compatible --model glm-5.2 --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS" --repo-root "$MINI_REPO"
assert_eq "$LAST_RC" 0 "A7 legacy should rc=0"
A7_STATUS=$(json_get "$LAST_OUT" status)
assert_eq "$A7_STATUS" "authored" "A7 legacy status authored"
assert_not_contains "$LAST_OUT" "unit_id" "A7 no unit_id"
assert_not_contains "$LAST_OUT" "go" "A7 no go"
assert_not_contains "$LAST_OUT" "containment" "A7 no containment"

# A8: native provisional verification-author (no legacy scorecard rewrite).
# Disk projects evidence-backed qualified → provisional; strict author must GO
# for raw-artifact only and still spawn the author runner.
mkdir -p "$CASE_DIR/A8"
rm -f "$RUN_MARKER"
A8_RUN_MARKER="$TEST_TMP/a8_run_marker"
run_dispatch env NODE_OPTIONS="" DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A8" \
  RUN_MARKER_PATH="$A8_RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" \
  "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$CONTRACT" \
  --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
assert_eq "$LAST_RC" 0 "A8 provisional VA strict GO should rc=0"
assert_file_exists "$A8_RUN_MARKER" "A8 provisional VA runner must execute"
A8_STATUS=$(json_get "$LAST_OUT" status)
A8_GO=$(json_get "$LAST_OUT" go)
A8_RUNNER=$(json_get "$LAST_OUT" runner)
A8_MODEL=$(json_get "$LAST_OUT" model)
assert_eq "$A8_STATUS" "authored" "A8 status authored"
assert_eq "$A8_GO" "GO" "A8 go matches"
assert_eq "$A8_RUNNER" "anthropic-compatible" "A8 runner matches"
assert_eq "$A8_MODEL" "glm-5.2" "A8 model matches"

# A8b: provisional VA with non-raw-artifact unit remains pre-spend NO-GO.
cat > "$TEST_TMP/va_verdict_contract.json" <<EOF
{"schema":1,"unit_id":"c4b-va-verdict","role":"verification-author","goal":"fixture","spec":{"path":"docs/plans/spec.md","section":"Unit spec"},"base_sha":"$BASE_SHA","depends_on":["$DEP_SHA"],"scope":{"allow_paths":["oracle.out.sh"],"deny_paths":["secret/**"],"max_files":1,"max_diff_lines":900},"go":{"required_paths":["docs/plans/spec.md"],"required_engine_role":"verification-author","required_red_command":["bash","-n","docs/plans/spec.md"]},"no_go":{"on_missing_spec":"stop","on_dirty_base":"stop","on_unknown_engine":"stop","on_quota_unavailable":"stop","on_scope_violation":"stop","on_budget_exceeded":"stop","on_clarification_needed":"stop","forbidden_actions":["push","merge","network","dependency-change"]},"output":{"kind":"verdict","paths":["oracle.out.sh"]},"acceptance":[{"argv":["true"],"exit":0}],"budget":{"wall_seconds":120,"max_attempts":1,"max_context_files":4}}
EOF
mkdir -p "$CASE_DIR/A8b"
rm -f "$RUN_MARKER"
run_dispatch env NODE_OPTIONS="" DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/A8b" \
  RUN_MARKER_PATH="$RUN_MARKER" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" \
  "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract \
  --contract-file "$TEST_TMP/va_verdict_contract.json" \
  --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
assert_eq "$LAST_RC" 2 "A8b non-raw-artifact provisional VA should rc=2"
assert_file_absent "$RUN_MARKER" "A8b fake runner must not run"

# A trusted schema declaration, independent of acceptance argv spelling, requires exact polarity evidence.
POLARITY_CONTRACT="$TEST_TMP/polarity-contract.json"
jq '.unit_id="polarity-fixture" | .deliberate_polarity=true | .acceptance += [{argv:["tools/equivalent-polarity-wrapper","check"],exit:0}]' "$CONTRACT" > "$POLARITY_CONTRACT"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/polarity" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$POLARITY_CONTRACT" --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
assert_eq "$LAST_RC" 2 "trusted polarity workflow rejects omitted receipt"
assert_contains "$LAST_OUT" "requires --polarity-receipt" "trusted polarity omission names required receipt"

BAD_POLARITY_CONTRACT="$TEST_TMP/bad-polarity-contract.json"
jq '.unit_id="bad-polarity-fixture" | .deliberate_polarity="yes"' "$CONTRACT" > "$BAD_POLARITY_CONTRACT"
run_dispatch env ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$BAD_POLARITY_CONTRACT" --repo "$MINI_REPO" --json
assert_eq "$LAST_RC" 2 "manual contract checker rejects non-boolean deliberate polarity declaration"
assert_contains "$LAST_OUT" "deliberate_polarity" "manual checker names invalid polarity declaration"

ARGV_ONLY_CONTRACT="$TEST_TMP/argv-only-polarity-contract.json"
jq '.unit_id="argv-only-polarity" | .acceptance += [{argv:["scripts/verify-red-green.sh","--validate"],exit:0}]' "$CONTRACT" > "$ARGV_ONLY_CONTRACT"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/argv-only" ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$STORE" "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$ARGV_ONLY_CONTRACT" --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
assert_eq "$LAST_RC" 0 "acceptance argv text cannot self-declare deliberate polarity"

finalize_test
