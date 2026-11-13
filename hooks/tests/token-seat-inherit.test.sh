#!/usr/bin/env bash
# PM 01M7975S: a seat token must reach a claude child, and a declared token seat
# with no token must refuse before the child starts.
# Red first: against the unmodified hetero unset list, case (inherit) fails because
# the stub's sha256 is the empty string, not sha256(test-token-A).
# The stub writes only the sha256. It never writes the token.
. "$(dirname "$0")/lib.sh"
unset CLAUDE_CODE_OAUTH_TOKEN AUTOPILOT_TOKEN_SEAT
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export DISPATCH_QUIET=1
export TMPDIR="$TEST_TMP/tmp"
mkdir -p "$TMPDIR"
export AUTOPILOT_ACCOUNTS_DIR="$TEST_TMP/no-accounts"
REAL_CLAUDE="$TEST_TMP/real-claude"
mkdir -p "$REAL_CLAUDE"
printf '{"claudeAiOauth":{"accessToken":"stub"}}\n' > "$REAL_CLAUDE/.credentials.json"
export CLAUDE_CONFIG_DIR="$REAL_CLAUDE"
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
unset AUTOPILOT_CONFIG_FILE
SHA_FILE="$TEST_TMP/sha"
INVOKED="$TEST_TMP/invoked"
BIN_DIR="$TEST_TMP/bin"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/claude" <<EOF
#!/usr/bin/env bash
printf '%s' "\${CLAUDE_CODE_OAUTH_TOKEN-}" | sha256sum | awk '{print \$1}' > "$SHA_FILE"
: > "$INVOKED"
echo cn-edited > cn_out.txt
printf '{"type":"result","is_error":false,"result":"done"}\n'
EOF
chmod +x "$BIN_DIR/claude"
export PATH="$BIN_DIR:$PATH"
TOKEN_A="test-token-A"
EXPECT="$(printf '%s' "$TOKEN_A" | sha256sum | awk '{print $1}')"
EMPTY_SHA="$(printf '%s' "" | sha256sum | awk '{print $1}')"

node "$REPO_ROOT/scripts/run-approval.js" confirm-claude-native >/dev/null

run() { (cd "$SBX" && "$SCRIPT" --runner claude-native --model claude-sonnet-4-6 --effort low --prompt-file "$PROMPT" --context-window off "$@" 2>&1); }

rm -f "$SHA_FILE" "$INVOKED"
OUT="$(CLAUDE_CODE_OAUTH_TOKEN="$TOKEN_A" run --branch feat/tok-inherit)"; RC=$?
assert_eq "0" "$RC" "(inherit) confirmed claude-native exits 0"
assert_file_exists "$INVOKED" "(inherit) stub was invoked"
GOT="$(cat "$SHA_FILE" 2>/dev/null || true)"
assert_eq "$GOT" "$EXPECT" "(inherit) child sha256 is sha256 of the parent token (prefix ${EXPECT:0:8})"
assert_neq "$GOT" "$EMPTY_SHA" "(inherit) child token is not empty"

rm -f "$SHA_FILE" "$INVOKED"
OUT="$(AUTOPILOT_TOKEN_SEAT=1 run --branch feat/tok-missing)"; RC=$?
assert_neq "0" "$RC" "(missing) declared token seat without a token exits non-zero"
assert_contains "$OUT" "token seat refused" "(missing) refusal names the token seat"
assert_file_absent "$INVOKED" "(missing) stub never invoked"

rm -f "$SHA_FILE" "$INVOKED"
OUT="$(run --branch feat/tok-ordinary)"; RC=$?
assert_eq "0" "$RC" "(ordinary) seat with no token declaration still exits 0"
assert_file_exists "$INVOKED" "(ordinary) stub was invoked"
assert_eq "$EMPTY_SHA" "$(cat "$SHA_FILE")" "(ordinary) no token was injected"

finalize_test
