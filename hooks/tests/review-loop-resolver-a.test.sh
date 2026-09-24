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

assert_r43_resolve_review_loop() {
  unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR
  local TOPO="$TEST_TMP/r43-topology.json"
  local CFG="$TEST_TMP/r43-review-loop.md"
  cat > "$TOPO" <<'JSON'
{
  "schema_version": 1,
  "generated_at": "2026-09-25T00:00:00.000Z",
  "host": "test-host",
  "implementer_ladder": [
    {
      "engine": "gpt-5.6-sol",
      "effort": "high",
      "runner": "codex",
      "family": "openai"
    }
  ]
}
JSON
  cat > "$CFG" <<'EOF'
consult_dispatch: auto
EOF
  local WARN
  WARN="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" AUTOPILOT_TOPOLOGY_FILE="$TOPO" bash "$REPO_ROOT/scripts/resolve-review-loop.sh" --field capability_warnings 2>/dev/null)" || true
  # RED at e4c3e1dc1fafab6c282bd879f201a269f35c70be: WARN='["consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]'
  assert_contains "$WARN" "consult_ladder" "r43: stale-cache warning names the missing consult_ladder key"
  assert_contains "$WARN" "scripts/resolve-dispatch-topology.js" "r43: stale-cache warning names resolve-dispatch-topology.js"
  assert_not_contains "$WARN" "no qualified consult seat on this host after qc_panel exclusion" \
    "r43: missing consult_ladder key does not use the generic empty-ladder warning"
}

assert_r43_resolve_review_loop

assert_r44_contract_parity_reso() {
  local SRC="$REPO_ROOT/hooks/tests/contract-parity.test.sh"
  local FIRST_CALL EXPORT_LINE
  FIRST_CALL="$(awk '/resolve-review-loop\.sh/{print NR; exit}' "$SRC")"
  EXPORT_LINE="$(awk '/^export AUTOPILOT_TOPOLOGY_FILE=/{print NR; exit}' "$SRC")"
  # RED at 65527b8625b6f32ac90703c3b8ed7d66d7007471: FAIL r44 expected a file-level export AUTOPILOT_TOPOLOGY_FILE=... before the first resolve-review-loop.sh call; got EXPORT_LINE='' FIRST_CALL='74'
  [[ -n "$EXPORT_LINE" ]] || fail "r44: contract-parity.test.sh must export AUTOPILOT_TOPOLOGY_FILE (hermetic pin like the switch test)"
  [[ "$EXPORT_LINE" -lt "$FIRST_CALL" ]] || fail "r44: AUTOPILOT_TOPOLOGY_FILE export must appear before the first resolve-review-loop.sh call"
}

assert_r44_contract_parity_reso

assert_r54_resolve_review_loop() {
  local SCRATCH="$TEST_TMP/r54-consult-corpus.json"
  local OUT="$TEST_TMP/r54-scope.json"
  cat > "$SCRATCH" <<'JSON'
{
  "applicability_scope": {
    "task_classes": ["r54-consult-scratch-marker"],
    "domains": ["r54-domain"],
    "languages": ["r54-lang"],
    "tool_surface": ["r54-tools"]
  }
}
JSON
  unset AUTOPILOT_CONSULT_CORPUS_FILE AUTOPILOT_DISCUSS_CORPUS_FILE
  AUTOPILOT_CONSULT_CORPUS_FILE="$SCRATCH" \
    node "$REPO_ROOT/scripts/lib/qualification-applicability-scope.js" \
    write-scope --role consult --out "$OUT" >/dev/null 2>&1 || true
  local GOT=""
  [ -f "$OUT" ] && GOT="$(cat "$OUT")"
  # RED at 28b25cb8819ef011eeb2ee47e07c3cb691223ea9: FAIL r54: consult write-scope honors AUTOPILOT_CONSULT_CORPUS_FILE: 'r54-consult-scratch-marker' not found in output; FAIL r54: case (xix) does not chmod 000 the tracked evals/consult-capability-evidence-corpus.json: expected '', got 'yes'; FAIL r54: case (xix) still chmod 000s a $TEST_TMP-scoped path: expected != '', got ''
  assert_contains "$GOT" "r54-consult-scratch-marker" \
    "r54: consult write-scope honors AUTOPILOT_CONSULT_CORPUS_FILE"

  local GATE="$REPO_ROOT/hooks/tests/resolve-review-loop-consult-discuss-gate.test.sh"
  local XIX_REGION
  XIX_REGION="$(awk '/^# \(xix\)/,/^# \(xx\)/' "$GATE")"
  local TRACKED_AND_CHMOD=""
  if printf '%s\n' "$XIX_REGION" | grep -q 'evals/consult-capability-evidence-corpus.json' \
    && printf '%s\n' "$XIX_REGION" | grep -Eq 'chmod 000 "\$CONSULT_CORPUS"|chmod 000 .*evals/consult-capability-evidence-corpus'; then
    TRACKED_AND_CHMOD="yes"
  fi
  assert_eq "$TRACKED_AND_CHMOD" "" \
    "r54: case (xix) does not chmod 000 the tracked evals/consult-capability-evidence-corpus.json"
  local TMP_CHMOD
  TMP_CHMOD="$(printf '%s\n' "$XIX_REGION" | grep 'chmod 000' | grep 'TEST_TMP' || true)"
  assert_neq "$TMP_CHMOD" "" \
    "r54: case (xix) still chmod 000s a \$TEST_TMP-scoped path"
}

assert_r54_resolve_review_loop

finalize_test
