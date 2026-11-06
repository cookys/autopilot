#!/usr/bin/env bash
# dispatch-hetero --runner claude-native: after the wall timeout (TERM ignored by the child, then group SIGKILL)
# no seeded claude-config-* dir may remain under the parent (PM gap, seedclean g2). Only `claude` is stubbed.
# The config, TMPDIR and credentials are fixtures; the real config dir is never read.
. "$(dirname "$0")/lib.sh"
SCRIPT="${HETERO_SCRIPT:-$REPO_ROOT/scripts/dispatch-hetero.sh}"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"; printf 'update repo file\n' > "$PROMPT"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export DISPATCH_QUIET=1
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
REAL_CLAUDE="$TEST_TMP/real-claude"; mkdir -p "$REAL_CLAUDE"
printf '{"claudeAiOauth":{"accessToken":"FAKE-token"}}\n' > "$REAL_CLAUDE/.credentials.json"
export CLAUDE_CONFIG_DIR="$REAL_CLAUDE"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_CONFIG_FILE
node "$REPO_ROOT/scripts/run-approval.js" confirm-claude-native >/dev/null
PIDFILE="$TEST_TMP/stub.pid"
BIN_DIR="$TEST_TMP/bin"; mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/claude" <<EOF2
#!/usr/bin/env bash
echo "\$\$" > "$PIDFILE"
trap '' TERM
while :; do sleep 1; done
EOF2
chmod +x "$BIN_DIR/claude"
export PATH="$BIN_DIR:$PATH"

START="$(date +%s)"
OUT="$(cd "$SBX" && timeout 60 "$SCRIPT" --runner claude-native --model claude-sonnet-4-6 --effort low \
  --prompt-file "$PROMPT" --context-window off --branch feat/cn-timeout --timeout 3s 2>&1)"
ELAPSED=$(( $(date +%s) - START ))
JSON="$(printf '%s\n' "$OUT" | grep '^{' | tail -n 1)"
assert_contains "$JSON" '"timed_out": true' "run ended by the wall timeout (${ELAPSED}s): $OUT"
STUBPID="$(cat "$PIDFILE" 2>/dev/null || true)"
[ -n "$STUBPID" ] || fail "stub did not start"
kill -0 "$STUBPID" 2>/dev/null && fail "stub pid $STUBPID survived the group SIGKILL"
assert_eq "0" "$(find "$TMPDIR" -maxdepth 1 -name 'claude-config-*' | wc -l)" "no claude-config-* dir left after timeout + group SIGKILL"
finalize_test
