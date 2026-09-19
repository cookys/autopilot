#!/usr/bin/env bash
# dispatch-author claude-native transport regression test. No network.
. "$(dirname "$0")/lib.sh"

SOURCE_ROOT="$REPO_ROOT"
git clone -q --no-local "$SOURCE_ROOT" "$TEST_TMP/hermetic-repo"
git -C "$SOURCE_ROOT" diff --binary HEAD | git -C "$TEST_TMP/hermetic-repo" apply
REPO_ROOT="$TEST_TMP/hermetic-repo"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
FAKE_CLAUDE="$TEST_TMP/claude"
CAPTURE="$TEST_TMP/captured-prompt.txt"

printf '%s\n' 'Return a small JSON object.' > "$PROMPT"

export AUTOPILOT_TEST_LIB="$REPO_ROOT/hooks/tests/lib.sh"
cat <<EOF > "$FAKE_CLAUDE"
#!/usr/bin/env bash
$(declare -f read_fake_runner_prompt extract_autopilot_frame_markers print_autopilot_frame_markers)
PROMPT="\$(read_fake_runner_prompt "\$@")"
printf '%s' "\$PROMPT" > "\$CAPTURE"
BODY='{"verdict":"READY","findings":[]}'
if MARKERS="\$(extract_autopilot_frame_markers AUTOPILOT-AUTHOR "\$PROMPT")"; then
  BEGIN="\$(printf '%s\\n' "\$MARKERS" | sed -n '1p')"
  END="\$(printf '%s\\n' "\$MARKERS" | sed -n '2p')"
  printf '%s\\n%s\\n%s\\n' "\$BEGIN" "\$BODY" "\$END"
else
  printf '%s\\n' "\$BODY"
fi
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
CAPTURED_PROMPT="$(cat "$CAPTURE")"
ORIGINAL_PROMPT="$(cat "$PROMPT")"
assert_contains "$CAPTURED_PROMPT" "<<<AUTOPILOT-AUTHOR-" "native transport receives exact prompt content: wrapped AUTHOR marker"
suffix_ok=0
if [ "${#CAPTURED_PROMPT}" -ge "${#ORIGINAL_PROMPT}" ]; then
  if [ "${CAPTURED_PROMPT: -${#ORIGINAL_PROMPT}}" = "$ORIGINAL_PROMPT" ]; then
    suffix_ok=1
  fi
fi
assert_eq "1" "$suffix_ok" "native transport receives exact prompt content"

RAW_LOG="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(o.raw_log)' "$OUT")"
assert_file_exists "$RAW_LOG" "native authored result exposes raw log"
assert_contains "$(cat "$RAW_LOG")" '"verdict":"READY"' "raw log contains model response"

finalize_test
