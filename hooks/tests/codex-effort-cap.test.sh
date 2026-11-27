#!/usr/bin/env bash
# dispatch-hetero Codex effort regression; no live runner or network.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session"
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
fresh_pace_fixture "$REPO_ROOT/scripts/fixtures/pace-select/quota-default.json" "$TEST_TMP/quota-default.fresh.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/quota-default.fresh.json"
# engine-preflight skips codex without a non-empty auth file; a placeholder keeps the test independent of the host login
mkdir -p "$TEST_TMP/codex-home"; echo '{}' > "$TEST_TMP/codex-home/auth.json"; export CODEX_HOME="$TEST_TMP/codex-home"
export DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'Create codex-argv.txt.\n' > "$PROMPT"

# Same probe responses and argv capture as dispatch-hetero.test.sh.
STUB_CODEX="$TEST_TMP/codex"
export CODEX_ARGV="$TEST_TMP/codex.argv"
cat > "$STUB_CODEX" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*) echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
printf '%s\n' "$@" > "$CODEX_ARGV"
printf 'codex argv\n' > codex-argv.txt
EOF
chmod +x "$STUB_CODEX"

run_codex() {
  local label="$1"
  shift
  # Each case must produce its own capture; a failed dispatch cannot reuse argv.
  : > "$CODEX_ARGV"
  OUT="$(cd "$SBX" && "$SCRIPT" --no-verify-tip \
    --branch "feat/$label" --prompt-file "$PROMPT" --codex-bin "$STUB_CODEX" \
    --timeout 30s "$@" 2>&1)"
  local code=$?
  assert_eq 0 "$code" "$label dispatch exit ($OUT)"
}

# 1. An unpinned Codex call defaults to low, never xhigh.
run_codex codex-default --runner codex --model gpt-5.3-codex-spark
ARGV="$(cat "$CODEX_ARGV")"
assert_contains "$ARGV" 'model_reasoning_effort="low"' 'case 1: default codex effort is low (impl default, scorecard event 38)'
assert_not_contains "$ARGV" 'xhigh' 'case 1: default codex effort excludes xhigh'

# 2. An explicit xhigh request wins over the default cap.
run_codex codex-explicit --runner codex --model gpt-5.3-codex-spark --effort xhigh
assert_contains "$(cat "$CODEX_ARGV")" 'model_reasoning_effort="xhigh"' 'case 2: explicit xhigh wins'

# 3. Auto with no named model takes Codex from the pace fixture, then caps effort.
run_codex codex-auto --runner auto
assert_contains "$OUT" 'pace: chose codex' 'case 3: pace input selects codex'
assert_contains "$(cat "$CODEX_ARGV")" 'model_reasoning_effort="low"' 'case 3: auto codex effort is low'

finalize_test
