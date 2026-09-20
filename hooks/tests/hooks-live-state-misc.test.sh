#!/usr/bin/env bash
# Shared suite for backlog bundle hooks-live-state-misc. Append-only per row.
set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
HOOK="$REPO_ROOT/hooks/context-budget.js"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL — %s\n' "$1"; }

# assert_r12_context_budget_no_mo
# Row 12: no live file. Transcript `message.model` is not a window source
# ([1m] is live-file-only). Documented limitation, not a fabricated env/parser.
#
# # RED at cc404356: FAIL — wrapper documents transcript message.model has no [1m] window signal
assert_r12_context_budget_no_mo() {
  if grep -q 'message.model' "$HOOK" && grep -q '\[1m\]' "$HOOK"; then
    ok "wrapper documents transcript message.model has no [1m] window signal"
  else
    bad "wrapper documents transcript message.model has no [1m] window signal"
  fi
  if grep -qE 'CLAUDE_[A-Z0-9_]*WINDOW' "$HOOK"; then
    bad "must not invent a CLAUDE_* window env var"
  else
    ok "no fabricated CLAUDE_* window env var"
  fi

  local TMP SID LIVE TRANSCRIPT PAYLOAD RC ERR
  TMP="$(mktemp -d "/dev/shm/r12-context-budget-no-mo-XXXXXX")"
  SID="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  LIVE="$TMP/live"
  mkdir -p "$LIVE/context" "$TMP/state"
  TRANSCRIPT="$TMP/transcript.jsonl"
  # Real Claude JSONL shape: message.model has no [1m] even on 1M sessions.
  printf '%s\n' \
    '{"timestamp":"2026-09-21T00:00:00.000Z","message":{"model":"claude-opus-5","usage":{"input_tokens":2,"cache_read_input_tokens":160000,"cache_creation_input_tokens":411,"output_tokens":10}}}' \
    > "$TRANSCRIPT"
  PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID\"}"
  export AUTOPILOT_LIVE_DIR="$LIVE"
  export AUTOPILOT_CONTEXT_BUDGET_DIR="$TMP/state"
  export CLAUDE_CODE_SESSION_ID="$SID"
  printf '%s' "$PAYLOAD" | node "$HOOK" 2>"$TMP/err.txt"
  RC=$?
  ERR="$(cat "$TMP/err.txt")"
  rm -rf "$TMP"
  # 160k is past unscaled T2 (150k) and still under 200k, so the ratchet path fires.
  case "$ERR" in
    *"Context budget T2"*)
      ok "no-live-file path still ratchets off observed tokens (T2 at 160k)" ;;
    *)
      bad "expected T2 on no-live-file 160k usage, got rc=$RC stderr=[$ERR]" ;;
  esac
}

assert_r12_context_budget_no_mo

# assert_r59_foreman_model_is_har
# Row 59: level-front-door.md must keep `--tree --role sub-orchestrator` but must
# not frame its model as a fixed `(→ opus)`. TREE_DEFAULTS opus is the table
# default; a project routing-config override wins (same file § Dispatching the
# foreman).
assert_r59_foreman_model_is_har() {
  local DOC="$REPO_ROOT/skills/ceo-agent/references/level-front-door.md"
  local RESOLVE_LINE
  RESOLVE_LINE="$(grep -n 'resolve-dispatch.sh --tree --role sub-orchestrator' "$DOC" | head -1)"
  if [ -z "$RESOLVE_LINE" ]; then
    bad "must keep resolve-dispatch.sh --tree --role sub-orchestrator instruction"
  else
    ok "keeps --tree --role sub-orchestrator instruction (${RESOLVE_LINE%%:*})"
  fi
  if echo "$RESOLVE_LINE" | grep -qE '\(→[[:space:]]*`?opus`?\)'; then
    bad "absolute (→ opus) framing still on resolve-dispatch instruction"
  else
    ok "no absolute (→ opus) framing on resolve-dispatch instruction"
  fi
  if grep -q 'TREE_DEFAULTS' "$DOC" && grep -qiE 'routing-config override' "$DOC"; then
    ok "role-table TREE_DEFAULTS opus + project routing-config override documented"
  else
    bad "must cite TREE_DEFAULTS default and routing-config override"
  fi
}

assert_r59_foreman_model_is_har

# assert_r79_cc_shim_framing_chro
# Row 79: generate_session_title chrome prepends an exact unrecognized_model
# line ahead of an intact wrapped block. Launch-env
# CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT (v2.34.7) does not
# cover this sub-call; claude --help has no session-title disable. Locator
# skips that one line by exact match; truncated blocks stay no_verdict.
assert_r79_cc_shim_framing_chro() {
  local SCRIPT="$REPO_ROOT/scripts/dispatch-review.sh"
  local CHROME='[claude-code:unrecognized_model] {"query_source":"generate_session_title"}'
  if grep -qF "$CHROME" "$SCRIPT"; then
    ok "locator names generate_session_title chrome by exact string"
  else
    bad "locator names generate_session_title chrome by exact string"
  fi
  if grep -q 'claude --help' "$SCRIPT" && grep -q 'generate_session_title' "$SCRIPT"; then
    ok "documents why launch-env cannot disable session-title generation"
  else
    bad "documents why launch-env cannot disable session-title generation"
  fi

  local TMP STUB DIFF OUT RC ERR
  TMP="$(mktemp -d "/dev/shm/r79-cc-shim-framing-XXXXXX")"
  DIFF="$TMP/d.diff"
  printf '+def f(): return x[::1]\n' > "$DIFF"
  STUB="$TMP/stub"
  cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
set +eu
PROMPT="$(cat || true)"
begin="$(printf '%s\n' "$PROMPT" | grep -E '^<<<AUTOPILOT-REVIEW-[0-9a-f]{32}>>>$' | head -n 1)"
end="$(printf '%s\n' "$PROMPT" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n 1)"
printf '%s\n' '[claude-code:unrecognized_model] {"query_source":"generate_session_title"}'
printf '%s\n' "$begin"
printf '%s\n' "VERDICT: FIX-THEN-SHIP"
printf '%s\n' "FINDINGS: the slice does not reverse"
if [ "${R79_TRUNCATE:-0}" != 1 ]; then
  printf '%s\n' "$end"
fi
exit 0
EOF
  chmod +x "$STUB"

  OUT="$(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u AUTOPILOT_LIVE_DIR \
    AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
    "$SCRIPT" --runner cc-shim --model MiniMax-M3 --endpoint minimax \
    --diff-file "$DIFF" --bin "$STUB" 2>/dev/null)"
  RC=$?
  ERR="$(printf '%s' "$OUT" | sed -n 's/.*"error": "\([^"]*\)".*/\1/p')"
  if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"status": "reviewed"'; then
    ok "chrome + complete block parses to reviewed (rc=$RC)"
  else
    bad "chrome + complete block expected reviewed, got rc=$RC status-line=[$OUT] reason=[$ERR]"
  fi

  OUT="$(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u AUTOPILOT_LIVE_DIR \
    AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
    R79_TRUNCATE=1 "$SCRIPT" --runner cc-shim --model MiniMax-M3 --endpoint minimax \
    --diff-file "$DIFF" --bin "$STUB" 2>/dev/null)"
  RC=$?
  ERR="$(printf '%s' "$OUT" | sed -n 's/.*"error": "\([^"]*\)".*/\1/p')"
  if [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -q '"status": "no_verdict"'; then
    ok "chrome + truncated block stays no_verdict (rc=$RC reason=[$ERR])"
  else
    bad "chrome + truncated block expected no_verdict, got rc=$RC out=[$OUT]"
  fi
  rm -rf "$TMP"
}

assert_r79_cc_shim_framing_chro

printf '\n%s\n' "hooks-live-state-misc: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
