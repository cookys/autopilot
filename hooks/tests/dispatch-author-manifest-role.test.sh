#!/usr/bin/env bash
# BL-0149: dispatch-author stamps the run manifest role from the caller (AUTOPILOT_DISPATCH_ROLE);
# plan review's seats are "plan-review", never "author". Unset or malformed falls back to "author".
. "$(dirname "$0")/lib.sh"

SCRIPT="${DISPATCH_AUTHOR_SCRIPT_OVERRIDE:-$REPO_ROOT/scripts/dispatch-author.sh}"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s\n' 'Return a small JSON object.' > "$PROMPT"
FAKE="$TEST_TMP/fake"
printf '%s\n' '#!/usr/bin/env bash' 'cat >/dev/null 2>&1 || true' 'echo ok' 'exit 0' > "$FAKE"
chmod +x "$FAKE"

# manifest_role <run-id> [role env value; "-" = unset]
manifest_role() {
  local dir="$TEST_TMP/runs-$1"; mkdir -p "$dir"
  if [ "${2:--}" = "-" ]; then
    env -u AUTOPILOT_DISPATCH_ROLE AUTOPILOT_DISPATCH_RUNS_DIR="$dir" DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=10 "$SCRIPT" --runner claude-native --model claude-fable-5 --prompt-file "$PROMPT" --bin "$FAKE" --timeout 10s --run-id "$1" >/dev/null 2>&1
  else
    AUTOPILOT_DISPATCH_ROLE="$2" AUTOPILOT_DISPATCH_RUNS_DIR="$dir" DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=10 "$SCRIPT" --runner claude-native --model claude-fable-5 --prompt-file "$PROMPT" --bin "$FAKE" --timeout 10s --run-id "$1" >/dev/null 2>&1
  fi
  grep -o '"role": "[^"]*"' "$dir/$1.manifest.json" 2>/dev/null | head -1
}

assert_eq "$(manifest_role r1 plan-review)" '"role": "plan-review"' "caller role is stamped"
assert_eq "$(manifest_role r2 -)" '"role": "author"' "unset role defaults to author"
assert_eq "$(manifest_role r3 'bad"role')" '"role": "author"' "malformed role falls back to author"

# plan review stamps its seats (source pin, so the caller cannot silently lose the env)
assert_contains "$(cat "$REPO_ROOT/scripts/dispatch-plan-review.js")" "AUTOPILOT_DISPATCH_ROLE: 'plan-review'" "dispatch-plan-review passes the role"

# Freeze dispatch time and run the stub immediately to cover same-second finalization.
FIXED_BIN="$TEST_TMP/fixed-bin"
mkdir -p "$FIXED_BIN"
cat > "$FIXED_BIN/date" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  '-u +%Y-%m-%dT%H:%M:%SZ') printf '2026-11-21T00:00:00Z\n' ;;
  '+%s') printf '1795228800\n' ;;
  *) exec /usr/bin/date "$@" ;;
esac
EOF
chmod +x "$FIXED_BIN/date"
ZERO_DIR="$TEST_TMP/runs-zero-delay"
mkdir -p "$ZERO_DIR"
env -u AUTOPILOT_DISPATCH_ROLE PATH="$FIXED_BIN:$PATH" \
  AUTOPILOT_DISPATCH_RUNS_DIR="$ZERO_DIR" DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 \
  "$SCRIPT" --runner claude-native --model claude-fable-5 --prompt-file "$PROMPT" \
  --bin "$FAKE" --timeout 10s --run-id author-zero-delay >/dev/null 2>&1
node - "$ZERO_DIR/author-zero-delay.manifest.json" <<'NODE'
const fs = require('fs');
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!(Date.parse(m.ended_at) > Date.parse(m.started_at))) {
  throw new Error(`started_at ${m.started_at} must precede ended_at ${m.ended_at}`);
}
NODE
assert_eq "0" "$?" "zero-delay author manifest ends after it starts"

finalize_test
