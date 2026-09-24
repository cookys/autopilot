#!/usr/bin/env bash
# review-loop-resolver-a.test.sh — classify must spawn resolve-review-loop.sh once
. "$(dirname "$0")/lib.sh"

assert_r23_probe_unknown_js_cla() {
  local TREE="$TEST_TMP/r23-tree"
  local COUNTER="$TEST_TMP/r23-resolver-invocations"
  mkdir -p "$TREE/scripts" "$TEST_TMP/k" "$TEST_TMP/m"
  : > "$COUNTER"
  cp "$REPO_ROOT/scripts/probe-unknown.js" "$TREE/scripts/probe-unknown.js"

  cat > "$TREE/scripts/resolve-review-loop.sh" <<EOF
#!/usr/bin/env bash
echo 1 >> "$COUNTER"
if [ "\${1:-}" = "--field" ]; then
  case "\${2:-}" in
    unknown_escalation) echo auto ;;
    unknown_resolved_from) echo default ;;
    unknown_budget_u1) echo 2 ;;
    unknown_budget_u2) echo 1 ;;
    unknown_budget_u3) echo 1 ;;
    consult_resolved_from) echo topology ;;
    consult_dispatch) echo auto ;;
    *) echo "" ;;
  esac
  exit 0
fi
cat <<'JSON'
{"unknown_escalation":"auto","unknown_resolved_from":"default","unknown_budget_u1":"2","unknown_budget_u2":"1","unknown_budget_u3":"1","consult_resolved_from":"topology","consult_dispatch":"auto"}
JSON
EOF
  chmod +x "$TREE/scripts/resolve-review-loop.sh"

  local LEDGER="$TEST_TMP/r23-ledger.jsonl"
  : > "$LEDGER"
  node "$TREE/scripts/probe-unknown.js" classify \
    --ledger "$LEDGER" \
    --repo-root "$TREE" \
    --knowledge-dir "$TEST_TMP/k" \
    --memory-dir "$TEST_TMP/m" >/dev/null

  local COUNT
  COUNT="$(wc -l < "$COUNTER" | tr -d ' ')"
  # RED at 56189ee6: count=7 (one spawn per resolverField)
  assert_eq "$COUNT" "1" "r23: classify spawns resolve-review-loop.sh exactly once"
}

assert_r23_probe_unknown_js_cla

assert_r36_resolve_review_loop() {
  unset REVIEW_LOOP_CONFIG_OVERRIDE
  export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/r36-no-topology.json"
  local SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
  local SCDIR="$TEST_TMP/r36-scorecard"
  local CFG="$TEST_TMP/r36-impl-codex.md"
  mkdir -p "$SCDIR"
  printf -- '- implementer_engine: gpt-5.3-codex-spark\n- implementer_runner: codex\n- allow_same_runner_dual_seat: on\n' > "$CFG"
  cat > "$SCDIR/rec.json" <<'JSON'
{"engine":"gpt-5.3-codex-spark","runner":"codex-cli","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"ph","date":"2026-06-30","quality":{"corpus_pass":"2/2","false_pass_critical":0},"capability_score":1,"cost":{"source":"manual","usd_per_mtok_input":0.0,"usd_per_mtok_output":0.0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
JSON
  ENGINE_SCORECARD_DIR="$SCDIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$SCDIR/rec.json" > /dev/null
  local OUT
  OUT="$(ENGINE_SCORECARD_DIR="$SCDIR" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --check-scorecard 2>/dev/null)" || true
  [[ -n "$OUT" ]] || fail "r36: resolver produced empty stdout"
  local WARN
  WARN="$(printf '%s' "$OUT" | node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(p.capability_warnings || []));
')"
  # RED at 56189ee6: unexpected 'implementer seat (gpt-5.3-codex-spark/codex) is not admissible' in output
  assert_not_contains "$WARN" "implementer seat (gpt-5.3-codex-spark/codex) is not admissible" \
    "r36: scorecard runner codex-cli matches query runner codex"
}

assert_r36_resolve_review_loop

finalize_test
