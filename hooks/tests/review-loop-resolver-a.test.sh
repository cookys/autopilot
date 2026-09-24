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

assert_r41_resolve_review_loop() {
  local SRC="$REPO_ROOT/hooks/tests/resolve-review-loop.test.sh"
  local STALE
  STALE="$(grep -E '=> no (operational capability warning|warning|demotion warning)|no demotion or native skill warning is ever emitted' "$SRC" || true)"
  # RED at 09a47301e0a811df669129ec836d663d134d868a: FAIL r41 expected '' got 7 assert_eq lines whose descriptions still said "no operational capability warning" / "no warning" / "no demotion warning" / "no demotion or native skill warning is ever emitted" while comparing capability_warnings to the three topology-fallback strings
  assert_eq "$STALE" "" "r41: resolve-review-loop.test.sh has no stale 'no warning' descriptions on topology-fallback capability_warnings asserts"
}

assert_r41_resolve_review_loop

assert_r42_normalizeagyalias_re() {
  unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR
  export ENGINE_CAPABILITY_DIR="$TEST_TMP/r42-cap"
  export ENGINE_SCORECARD_DIR="$TEST_TMP/r42-sc"
  mkdir -p "$ENGINE_CAPABILITY_DIR" "$ENGINE_SCORECARD_DIR"
  local TOPO="$TEST_TMP/r42-topology.json"
  local CFG="$TEST_TMP/r42-review-loop.md"
  cat > "$TOPO" <<'JSON'
{
  "schema_version": 1,
  "generated_at": "2026-09-25T00:00:00.000Z",
  "host": "test-host",
  "consult_ladder": [
    {
      "rung": "gemini-flash/high@agy",
      "engine": "gemini-flash",
      "effort": "high",
      "runner": "agy",
      "family": "google",
      "endpoint": "",
      "role_source": "consult"
    },
    {
      "rung": "minimax-m3/high@agy",
      "engine": "minimax-m3",
      "effort": "high",
      "runner": "agy",
      "family": "minimax",
      "endpoint": "",
      "role_source": "consult"
    }
  ]
}
JSON
  cat > "$CFG" <<'EOF'
consult_dispatch: auto
implementer_runner: grok
qc_panel: gemini-flash
qc_panel_runners: agy
qc_panel_efforts: high
qc_panel_endpoints: @none
EOF
  local ENGINE
  ENGINE="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" AUTOPILOT_TOPOLOGY_FILE="$TOPO" bash "$REPO_ROOT/scripts/resolve-review-loop.sh" --field consult_engine 2>/dev/null)" || true
  # RED at 2678cf10addf008cd9e1186f63ce59a8d5153ba2: consult_engine=gemini-flash (qc_panel alias not excluded)
  assert_neq "$ENGINE" "gemini-flash" "r42: consult auto does not pick qc_panel gemini-flash alias after normalize_agy_alias"
  assert_eq "$ENGINE" "minimax-m3" "r42: consult auto picks the next ladder seat after excluding the aliased qc_panel engine"
}

assert_r42_normalizeagyalias_re

finalize_test
