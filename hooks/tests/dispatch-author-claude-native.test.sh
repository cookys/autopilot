#!/usr/bin/env bash
# dispatch-author claude-native transport regression test. No network.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
FAKE_CLAUDE="$TEST_TMP/claude"
CAPTURE="$TEST_TMP/captured-prompt.txt"

printf '%s\n' 'Return a small JSON object.' > "$PROMPT"

cat <<'EOF' > "$FAKE_CLAUDE"
#!/usr/bin/env bash
cat > "$CAPTURE"
printf '%s\n' '{"verdict":"READY","findings":[]}'
EOF
chmod +x "$FAKE_CLAUDE"
export CAPTURE

OUT="$(
  DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=10 \
    "$SCRIPT" \
      --runner claude-native \
      --model claude-fable-5 \
      --prompt-file "$PROMPT" \
      --bin "$FAKE_CLAUDE" \
      --timeout 5s
)"
EXIT=$?

assert_eq "0" "$EXIT" "claude-native author transport exits zero"
assert_contains "$OUT" '"runner": "claude-native"' "result preserves claude-native identity"
assert_contains "$OUT" '"model": "claude-fable-5"' "result preserves requested model"
assert_contains "$OUT" '"status": "authored"' "non-empty native output is authored"
assert_eq "$(cat "$PROMPT")" "$(cat "$CAPTURE")" "native transport receives exact prompt content"

RAW_LOG="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(o.raw_log)' "$OUT")"
assert_file_exists "$RAW_LOG" "native authored result exposes raw log"
assert_contains "$(cat "$RAW_LOG")" '"verdict":"READY"' "raw log contains model response"

finalize_test
