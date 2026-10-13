#!/usr/bin/env bash
# BL-0136: dispatch-author keeps a bounded, redacted runner stderr excerpt on runner_failed and
# classifies quota exhaustion (transport_status vocabulary shared with dispatch-plan-review.js).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s\n' 'Return a small JSON object.' > "$PROMPT"

# make_fake <path> <stderr text> <exit code>
make_fake() {
  cat > "$1" <<STUB
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
printf '%s\n' "$2" >&2
exit $3
STUB
  chmod +x "$1"
}

run_author() { # <runner> <model> <fake>
  DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=10 "$SCRIPT" --runner "$1" --model "$2" \
    --prompt-file "$PROMPT" --bin "$3" --timeout 10s 2>/dev/null
}

raw_log_of() { printf '%s' "$1" | grep -o '"raw_log": "[^"]*"' | sed 's/.*: "//;s/"$//'; }

for spec in "claude-native:claude-fable-5" "qoderclicn:qwen3.8-max"; do
  runner="${spec%%:*}"; model="${spec#*:}"

  # 1. quota: HTTP 402 / balance exhausted on stderr, non-zero exit
  F="$TEST_TMP/fake-quota-$runner"
  make_fake "$F" 'Error: HTTP 402 Payment Required: balance exhausted, please top up' 1
  OUT="$(run_author "$runner" "$model" "$F")"
  assert_contains "$OUT" '"status": "runner_failed"' "$runner quota: runner_failed"
  assert_contains "$OUT" 'balance exhausted' "$runner quota: stderr excerpt in error"
  assert_contains "$OUT" '"transport_status": "quota"' "$runner quota: classified quota"
  RAW="$(raw_log_of "$OUT")"
  assert_contains "$(cat "$RAW" 2>/dev/null)" 'balance exhausted' "$runner quota: excerpt kept in raw log"

  # 2. secret in stderr is redacted everywhere
  F="$TEST_TMP/fake-key-$runner"
  make_fake "$F" 'auth failed for key sk-abcdefghijklmnopqrstuvwxyz0123456789 on request' 1
  OUT="$(run_author "$runner" "$model" "$F")"
  assert_contains "$OUT" 'auth failed' "$runner secret: excerpt present"
  assert_not_contains "$OUT" 'sk-abcdefghijklmnop' "$runner secret: key not in JSON"
  assert_contains "$OUT" '<REDACTED>' "$runner secret: redaction marker"
  RAW="$(raw_log_of "$OUT")"
  assert_not_contains "$(cat "$RAW" 2>/dev/null)" 'sk-abcdefghijklmnop' "$runner secret: key not in raw log"

  # 3. ordinary failure is NOT quota
  F="$TEST_TMP/fake-plain-$runner"
  make_fake "$F" 'Error: model crashed with segfault in tokenizer' 1
  OUT="$(run_author "$runner" "$model" "$F")"
  assert_contains "$OUT" 'segfault in tokenizer' "$runner plain: excerpt present"
  assert_contains "$OUT" '"transport_status": "exit_failure"' "$runner plain: exit_failure"
  assert_not_contains "$OUT" '"transport_status": "quota"' "$runner plain: not quota"
done

# 4. excerpt is bounded (tail 2 KB)
F="$TEST_TMP/fake-big"
cat > "$F" <<'STUB'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
head -c 6000 /dev/zero | tr '\0' 'A' >&2
printf ' TAIL-MARKER\n' >&2
exit 1
STUB
chmod +x "$F"
OUT="$(run_author claude-native claude-fable-5 "$F")"
assert_contains "$OUT" 'TAIL-MARKER' "big stderr: tail retained"
if [ "${#OUT}" -lt 3500 ]; then pass_big=1; else pass_big=0; fi
assert_eq "1" "$pass_big" "big stderr: result JSON bounded"

finalize_test
