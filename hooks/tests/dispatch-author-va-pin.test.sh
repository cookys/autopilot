#!/usr/bin/env bash
# dispatch-author-va-pin -- a standing verification_author operator pin reaches the strict-contract check.
# RED at 53ddc02f (unmodified scripts):
#   FAIL V3 pinned seat admitted ... "contract checker failed: [engine: no qualified scorecard row ...]": expected '0', got '2'
#   FAIL V3 rail names the document / V3 runner executed / V3 status authored
#   FAIL V5 --resolve-live verification_author rc 0: expected '0', got '2'
#   (V1, V2, V4 pass on base: refusals unchanged by design)
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection

json_get() { echo "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const p=process.argv[1].split('.');let v=o;for(const k of p){v=v?.[k];}console.log(v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v))}catch(e){console.log('')}})" "$2"; }

run_dispatch() {
  # stdout is dispatch-author's JSON contract; stderr carries advisory notes
  # (e.g. resolve-review-loop's per-seat qc_panel admission warnings, fa2a0c50)
  # that are not gated on DISPATCH_QUIET. JSON fields are read from stdout only;
  # LAST_OUT keeps both streams for text assertions.
  local out err_file
  local rc
  err_file="$(mktemp "$TEST_TMP/run-dispatch-stderr.XXXXXX")"
  out=$("$@" 2>"$err_file")
  rc=$?
  LAST_STDOUT="$out"
  LAST_OUT="$out
$(cat "$err_file")"
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

cat > "$FAKE_JS" <<EOF
#!/usr/bin/env node
const fs = require('fs');
const {execFileSync} = require('child_process');
if (process.env.RUN_MARKER_PATH) {
  try { fs.writeFileSync(process.env.RUN_MARKER_PATH, 'RAN\\n'); } catch (e) {}
}
if (process.env.BREACH_TARGET) {
  try { fs.appendFileSync(process.env.BREACH_TARGET, 'BREACH\\n'); } catch (e) {}
}
const body = 'Fake deterministic author output.';
let markers = '';
try {
  markers = execFileSync('bash', ['-c',
    'AUTOPILOT_TEST_LIB_HELPERS_ONLY=1; . "\$1"; shift; print_autopilot_frame_markers "\$@"',
    'print_autopilot_frame_markers',
    '$REPO_ROOT/hooks/tests/lib.sh',
    'AUTOPILOT-AUTHOR',
    ...process.argv.slice(2),
  ], {encoding: 'utf8'});
} catch (e) {
  markers = '';
}
const parts = String(markers || '').trim().split('\\n').filter(Boolean);
if (parts.length >= 2) {
  process.stdout.write(parts[0] + '\\n' + body + '\\n' + parts[1] + '\\n');
} else {
  process.stdout.write(body + '\\n');
}
EOF

IMPL_ROW='{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
# Exact resolver tuples: implementer effort defaults to high / endpoint null;
# VA config pins verification_author_effort=high / endpoint "".
IMPL_EVENT='{"schema_version":1,"observed_at":"OLD","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}'

VA_ROW='{"engine":"glm-5.2","runner":"anthropic-compatible","family":"zhipu","role":"verification_author","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
VA_EVENT='{"schema_version":1,"observed_at":"OLD","runner":"anthropic-compatible","model":"glm-5.2","role":"verification_author","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}'

OBSERVED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
IMPL_EVENT='{"schema_version":1,"observed_at":"'"$OBSERVED_AT"'","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}'
VA_EVENT='{"schema_version":1,"observed_at":"'"$OBSERVED_AT"'","runner":"anthropic-compatible","model":"glm-5.2","role":"verification_author","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}'
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
# NOTE: no VA scorecard row is seeded -- the seat is admitted only by a standing pin.
if ! ENGINE_CAPABILITY_DIR="$STORE" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/va-event.json" > /dev/null; then
  fail "Infrastructure error: failed to seed VA event"
fi

mkdir -p "$MINI_REPO"
cd "$MINI_REPO"
git init -qb main >/dev/null 2>&1
git config user.name "Test" >/dev/null 2>&1
git config user.email "test@example.invalid" >/dev/null 2>&1
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
- reviewer_engine: claude-opus
- reviewer_runner: claude-native
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: anthropic-compatible
- verification_author_effort: high
- plan_review: off
- hetero_review: off
- consult_dispatch: off
- discuss_dispatch: off
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


CAPS="$STORE"
export ENGINE_SCORECARD_DIR="$STORE" ENGINE_CAPABILITY_DIR="$CAPS"
pin_va() { # engine runner
  node "$REPO_ROOT/scripts/engine-capability-state.js" pin-seat --engine "$1" --runner "$2" \
    --role verification_author --effort high --endpoint @none --reason 'va-pin test' \
    --operator cookys --store "$CAPS" >/dev/null 2>"$TEST_TMP/pin.err" || fail "pin-seat failed: $(cat "$TEST_TMP/pin.err")"
}
dispatch_va() { # case-name
  mkdir -p "$CASE_DIR/$1"
  rm -f "$RUN_MARKER"
  run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/$1" RUN_MARKER_PATH="$RUN_MARKER" \
    AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/topology-$1.json" \
    "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$CONTRACT" \
    --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
}

echo "--- V1: no pin, no qualified row -> refused as today ---"
dispatch_va V1
assert_eq "$LAST_RC" 2 "V1 refused"
assert_contains "$LAST_OUT" "no qualified scorecard row" "V1 names the missing evidence"
assert_file_absent "$RUN_MARKER" "V1 runner never ran"

echo "--- V2: pin on a DIFFERENT seat -> still refused ---"
pin_va gpt-5.3-codex-spark codex
dispatch_va V2
assert_eq "$LAST_RC" 2 "V2 mismatched pin refused"
assert_contains "$LAST_OUT" "no qualified scorecard row" "V2 refusal is the no-evidence one"
assert_file_absent "$RUN_MARKER" "V2 runner never ran"
rm -f "$CAPS/pins.jsonl"

echo "--- V3: pin on the contract's seat -> admitted via --resolved-live ---"
pin_va glm-5.2 anthropic-compatible
dispatch_va V3
assert_eq "$LAST_RC" 0 "V3 pinned seat admitted (out: $(printf '%s' "$LAST_OUT" | tail -c 400))"
assert_contains "$LAST_OUT" "resolved-live: verification_author via resolve-dispatch-topology.js (standing pin present)" "V3 rail names the document"
assert_file_exists "$RUN_MARKER" "V3 runner executed"
assert_eq "$(json_get "$LAST_STDOUT" status)" "authored" "V3 status authored"

echo "--- V4: AUTOPILOT_RESOLVED_LIVE=off restores the pre-wiring behaviour ---"
mkdir -p "$CASE_DIR/V4"; rm -f "$RUN_MARKER"
run_dispatch env DISPATCH_QUIET=1 AUTOPILOT_RESOLVED_LIVE=off AUTOPILOT_SESSION_MODE_DIR="$CASE_DIR/V4" RUN_MARKER_PATH="$RUN_MARKER" \
  "$REPO_ROOT/scripts/dispatch-author.sh" --strict-contract --contract-file "$CONTRACT" \
  --repo-root "$MINI_REPO" --prompt-file "$PROMPT_FILE" --bin "$FAKE_JS"
assert_eq "$LAST_RC" 2 "V4 knob off -> pin unreachable"
assert_file_absent "$RUN_MARKER" "V4 runner never ran"

echo "--- V5: resolver accepts verification_author for --resolve-live ---"
out=$(node "$REPO_ROOT/scripts/resolve-dispatch-topology.js" --resolve-live --role verification_author 2>&1); rc=$?
assert_eq "$rc" 0 "V5 --resolve-live verification_author rc 0"
assert_contains "$out" '"role":"verification_author"' "V5 doc carries the role"
finalize_test
