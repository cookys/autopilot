#!/usr/bin/env bash
# PM 01M7975S: bash spawn paths. Parent token test-token-A reaches the child as
# sha256(test-token-A). A declared token seat with no token exits non-zero and the
# stub is never invoked. An ordinary seat (no flag) is unchanged.
# The stub writes only the sha256. It never writes the token.
. "$(dirname "$0")/lib.sh"
unset CLAUDE_CODE_OAUTH_TOKEN AUTOPILOT_TOKEN_SEAT AUTOPILOT_ENDPOINTS_ENV
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
export TMPDIR="$TEST_TMP/tmp"
mkdir -p "$TMPDIR"
export AUTOPILOT_ACCOUNTS_DIR="$TEST_TMP/no-accounts"
export AUTOPILOT_SETTLE_MS=10 DISPATCH_QUIET=1
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1" AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
export AUTOPILOT_ENDPOINT_PREPROBE=off
REAL="$TEST_TMP/real-claude"
mkdir -p "$REAL"
printf '{"claudeAiOauth":{"accessToken":"stub"}}\n' > "$REAL/.credentials.json"
export CLAUDE_CONFIG_DIR="$REAL"
SHA_FILE="$TEST_TMP/sha"
INVOKED="$TEST_TMP/invoked"
BIN="$TEST_TMP/bin"
mkdir -p "$BIN"
cat > "$BIN/claude" <<EOF
#!/usr/bin/env bash
printf '%s' "\${CLAUDE_CODE_OAUTH_TOKEN-}" | sha256sum | awk '{print \$1}' > "$SHA_FILE"
: > "$INVOKED"
printf '%s\n' '{"verdict":"READY","findings":[]}'
printf '%s\n' '{"type":"result","is_error":false,"result":"done"}'
EOF
chmod +x "$BIN/claude"
export PATH="$BIN:$PATH"
TOKEN_A="test-token-A"
EXPECT="$(printf '%s' "$TOKEN_A" | sha256sum | awk '{print $1}')"
EMPTY_SHA="$(printf '%s' "" | sha256sum | awk '{print $1}')"
DIFF="$TEST_TMP/d.diff"
PROMPT="$TEST_TMP/p.txt"
printf 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n' > "$DIFF"
printf 'Return a small JSON object.\n' > "$PROMPT"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
PROBE="$REPO_ROOT/scripts/probe-engine-capability.sh"
FAKE_URL="http://127.0.0.1:9"
FAKE_AUTH="test-auth-not-oauth"

reset_stub() { rm -f "$SHA_FILE" "$INVOKED"; }
see_sha() { cat "$SHA_FILE" 2>/dev/null || true; }

# rail <review|author> <claude-native|cc-shim>  -- extra env is already exported
run_rail() {
  local kind="$1" runner="$2"
  if [ "$kind" = review ]; then
    local ep=()
    [ "$runner" = cc-shim ] && ep=(--endpoint TESTEP)
    "$REVIEW" --runner "$runner" --model haiku --diff-file "$DIFF" --bin "$BIN/claude" --timeout 20s "${ep[@]}" < /dev/null
  else
    "$AUTHOR" --runner "$runner" --model haiku --prompt-file "$PROMPT" --bin "$BIN/claude" --timeout 20s < /dev/null
  fi
}

for kind in review author; do
  for runner in claude-native cc-shim; do
    reset_stub
    if [ "$runner" = cc-shim ]; then
      OUT="$(CLAUDE_CODE_OAUTH_TOKEN="$TOKEN_A" ANTHROPIC_BASE_URL="$FAKE_URL" ANTHROPIC_AUTH_TOKEN="$FAKE_AUTH" run_rail "$kind" "$runner" 2>&1)"; RC=$?
    else
      OUT="$(CLAUDE_CODE_OAUTH_TOKEN="$TOKEN_A" run_rail "$kind" "$runner" 2>&1)"; RC=$?
    fi
    assert_file_exists "$INVOKED" "($kind $runner inherit) stub was invoked (rc=$RC)"
    assert_eq "$(see_sha)" "$EXPECT" "($kind $runner inherit) child sha prefix ${EXPECT:0:8}"

    reset_stub
    if [ "$runner" = cc-shim ]; then
      OUT="$(AUTOPILOT_TOKEN_SEAT=1 ANTHROPIC_BASE_URL="$FAKE_URL" ANTHROPIC_AUTH_TOKEN="$FAKE_AUTH" run_rail "$kind" "$runner" 2>&1)"; RC=$?
    else
      OUT="$(AUTOPILOT_TOKEN_SEAT=1 run_rail "$kind" "$runner" 2>&1)"; RC=$?
    fi
    assert_neq "$RC" "0" "($kind $runner missing) exits non-zero"
    assert_contains "$OUT" "token seat refused" "($kind $runner missing) refusal"
    assert_file_absent "$INVOKED" "($kind $runner missing) stub never invoked"

    reset_stub
    if [ "$runner" = cc-shim ]; then
      OUT="$(ANTHROPIC_BASE_URL="$FAKE_URL" ANTHROPIC_AUTH_TOKEN="$FAKE_AUTH" run_rail "$kind" "$runner" 2>&1)"; RC=$?
    else
      OUT="$(run_rail "$kind" "$runner" 2>&1)"; RC=$?
    fi
    assert_file_exists "$INVOKED" "($kind $runner ordinary) stub was invoked"
    assert_eq "$(see_sha)" "$EMPTY_SHA" "($kind $runner ordinary) no token injected"
  done
done

# probe: the guard is before claude --version, so a missing token never starts the stub.
for runner in claude-native cc-shim; do
  reset_stub
  OUT="$(CLAUDE_CODE_OAUTH_TOKEN="$TOKEN_A" bash "$PROBE" quota --runner "$runner" --model claude-test --live-spend --store "$TEST_TMP/store-$runner" 2>&1)"; RC=$?
  assert_file_exists "$INVOKED" "(probe $runner inherit) stub was invoked (rc=$RC)"
  assert_eq "$(see_sha)" "$EXPECT" "(probe $runner inherit) child sha prefix ${EXPECT:0:8}"

  reset_stub
  OUT="$(AUTOPILOT_TOKEN_SEAT=1 bash "$PROBE" quota --runner "$runner" --model claude-test --live-spend --store "$TEST_TMP/store-$runner-miss" 2>&1)"; RC=$?
  assert_neq "$RC" "0" "(probe $runner missing) exits non-zero"
  assert_contains "$OUT" "token seat refused" "(probe $runner missing) refusal"
  assert_file_absent "$INVOKED" "(probe $runner missing) stub never invoked"
done

# kimi is not a token seat path: the flag must not refuse it.
reset_stub
OUT="$(AUTOPILOT_TOKEN_SEAT=1 bash "$PROBE" quota --runner kimi --model fixture --store "$TEST_TMP/store-kimi" 2>&1)"; RC=$?
assert_not_contains "$OUT" "token seat refused" "(probe kimi) flag does not refuse a non-claude runner"

# hetero cc-shim: same unset-list class as claude-native, guarded before command -v.
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
run_cc() { (cd "$SBX" && ANTHROPIC_BASE_URL="$FAKE_URL" ANTHROPIC_AUTH_TOKEN="$FAKE_AUTH" "$HETERO" --runner cc-shim --model claude-sonnet-4-6 --effort low --prompt-file "$PROMPT" --context-window off --branch "$1" 2>&1); }
reset_stub
OUT="$(CLAUDE_CODE_OAUTH_TOKEN="$TOKEN_A" run_cc feat/cc-inherit)"; RC=$?
assert_file_exists "$INVOKED" "(hetero cc-shim inherit) stub was invoked (rc=$RC)"
assert_eq "$(see_sha)" "$EXPECT" "(hetero cc-shim inherit) child sha prefix ${EXPECT:0:8}"
reset_stub
OUT="$(AUTOPILOT_TOKEN_SEAT=1 run_cc feat/cc-missing)"; RC=$?
assert_neq "$RC" "0" "(hetero cc-shim missing) exits non-zero"
assert_contains "$OUT" "token seat refused" "(hetero cc-shim missing) refusal"
assert_file_absent "$INVOKED" "(hetero cc-shim missing) stub never invoked"

# eval-batch wrapper: the generated claude on PATH is the spawn.
EVAL_STUB="$TEST_TMP/eval-stub.sh"
cat > "$EVAL_STUB" <<EOF
#!/usr/bin/env bash
claude -p hi
printf '%s' "\$?" > "$TEST_TMP/wrap-rc"
EOF
chmod +x "$EVAL_STUB"
reset_stub
CLAUDE_CODE_OAUTH_TOKEN="$TOKEN_A" RUN_EVAL_CMD="$EVAL_STUB" bash "$REPO_ROOT/scripts/run-eval-batch.sh" --selftest >/dev/null 2>&1 || true
assert_file_exists "$INVOKED" "(eval-batch inherit) wrapper reached the stub"
assert_eq "$(see_sha)" "$EXPECT" "(eval-batch inherit) child sha prefix ${EXPECT:0:8}"
reset_stub
rm -f "$TEST_TMP/wrap-rc"
AUTOPILOT_TOKEN_SEAT=1 RUN_EVAL_CMD="$EVAL_STUB" bash "$REPO_ROOT/scripts/run-eval-batch.sh" --selftest >/dev/null 2>&1 || true
assert_file_absent "$INVOKED" "(eval-batch missing) stub never invoked"
assert_eq "$(cat "$TEST_TMP/wrap-rc" 2>/dev/null || true)" "78" "(eval-batch missing) wrapper exits 78"

# eval-account wrapper, the same guard the account-inactive eval path installs.
WRAP_DIR="$TEST_TMP/ea-wrap"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/eval-account.sh"
export EVAL_ACCOUNT_SH="$REPO_ROOT/scripts/lib/eval-account.sh"
export EVAL_ACCOUNT_ACTIVE=0
eval_account_install_wrapper "$WRAP_DIR" "$BIN/claude"
reset_stub
CLAUDE_CODE_OAUTH_TOKEN="$TOKEN_A" "$WRAP_DIR/claude" -p hi >/dev/null
assert_eq "$(see_sha)" "$EXPECT" "(eval-account wrapper inherit) child sha prefix ${EXPECT:0:8}"
reset_stub
EA_OUT="$(AUTOPILOT_TOKEN_SEAT=1 "$WRAP_DIR/claude" -p hi 2>&1)" && EA_RC=0 || EA_RC=$?
assert_eq "$EA_RC" "78" "(eval-account wrapper missing) exits 78"
assert_contains "$EA_OUT" "token seat refused" "(eval-account wrapper missing) refusal"
assert_file_absent "$INVOKED" "(eval-account wrapper missing) pinned claude never invoked"
reset_stub
"$WRAP_DIR/claude" -p hi >/dev/null
assert_eq "$(see_sha)" "$EMPTY_SHA" "(eval-account wrapper ordinary) no token injected"

# skill-opt: a declared seat must not open the host credentials file.
reset_stub
OUT="$(AUTOPILOT_TOKEN_SEAT=1 bash "$REPO_ROOT/scripts/run-skill-opt.sh" tokseat-no-such 2>&1)" && SK_RC=0 || SK_RC=$?
assert_eq "$SK_RC" "78" "(skill-opt missing) exits 78"
assert_contains "$OUT" "token seat refused" "(skill-opt missing) refusal"
assert_not_contains "$OUT" "credentials.json" "(skill-opt missing) did not look for a credentials file"
assert_file_absent "$INVOKED" "(skill-opt missing) stub never invoked"
OUT="$(CLAUDE_CODE_OAUTH_TOKEN="$TOKEN_A" AUTOPILOT_TOKEN_SEAT=1 bash "$REPO_ROOT/scripts/run-skill-opt.sh" tokseat-no-such 2>&1)" && SK_RC=0 || SK_RC=$?
assert_neq "$SK_RC" "0" "(skill-opt token present) still stops on the missing eval file"
assert_not_contains "$OUT" "credentials.json" "(skill-opt token present) did not open a credentials file"
assert_not_contains "$OUT" "$TOKEN_A" "(skill-opt token present) does not print the token"

finalize_test
