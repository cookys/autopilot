#!/usr/bin/env bash
# Codex "model is not supported when using Codex" is a caller model pick, not a login failure.
# RED before the classifier: the exact ERROR line is unknown (error_category null) or, when the
# log also contains an auth phrase, auth_failed. GREEN: error_category model_unsupported, and a
# real auth line stays auth_failed.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID \
  AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT \
  AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
export AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap"
mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" config user.email "t@t"
git -C "$SBX" config user.name "t"
git -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"

last_json() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }

write_codex_stub() {
  local path="$1" body="$2"
  cat > "$path" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*) echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
cat >/dev/null
cat <<'MSG'
EOF
  printf '%s\n' "$body" >> "$path"
  cat >> "$path" <<'EOF'
MSG
exit 1
EOF
  chmod +x "$path"
}

run_codex() {
  local stub="$1" branch="$2"
  (cd "$SBX" && AUTOPILOT_STRIKE_WRITER=off ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
    "$SCRIPT" --no-verify-tip --runner codex --pin-reason "test fixture" --model gpt-6-terra \
    --codex-bin "$stub" --branch "$branch" --prompt-file "$PROMPT" --context-window off 2>&1)
}

# 1. Exact worker line from run hetero-1795218395-1983640-6fa8. Also pins precedence:
# the same log plus an auth phrase must still be model_unsupported.
STUB_MODEL="$TEST_TMP/codex-model"
write_codex_stub "$STUB_MODEL" "ERROR: The 'gpt-6-terra' model is not supported when using Codex with a ChatGPT account."
OUT="$(run_codex "$STUB_MODEL" feat/model-unsupported)"
JSON="$(last_json "$OUT")"
node -e '
  const o = JSON.parse(process.argv[1]);
  if (o.error_category !== "model_unsupported") {
    console.error("error_category", JSON.stringify(o.error_category), "status", o.status, "error", o.error);
    process.exit(1);
  }
  if (o.status === "engine_unavailable") {
    console.error("model_unsupported must not escalate", o.status);
    process.exit(1);
  }
  const want = "codex model gpt-6-terra is not available for this account (models_cache: unavailable)";
  if (o.error !== want) {
    console.error("error", JSON.stringify(o.error));
    process.exit(1);
  }
' "$JSON" || fail "codex unsupported-model line is model_unsupported, not an auth escalation"

BOTH="$(node "$REPO_ROOT/scripts/engine-capability-state.js" classify-error --string "ERROR: The 'gpt-6-terra' model is not supported when using Codex with a ChatGPT account. invalid API key authorization failed")"
assert_eq "$BOTH" "model_unsupported" "model_unsupported wins over auth_failed when both phrases match"

# 2. A real auth failure line stays auth_failed (same rail, different stub).
STUB_AUTH="$TEST_TMP/codex-auth"
write_codex_stub "$STUB_AUTH" "ERROR: invalid API key authorization failed"
OUT="$(run_codex "$STUB_AUTH" feat/auth-failed)"
JSON="$(last_json "$OUT")"
node -e '
  const o = JSON.parse(process.argv[1]);
  if (o.error_category !== "auth_failed" || o.status !== "engine_unavailable") {
    console.error(JSON.stringify({error_category:o.error_category, status:o.status, error:o.error}));
    process.exit(1);
  }
' "$JSON" || fail "codex auth line stays auth_failed engine_unavailable"

finalize_test
