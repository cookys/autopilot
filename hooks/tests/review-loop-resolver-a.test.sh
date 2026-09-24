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

finalize_test
