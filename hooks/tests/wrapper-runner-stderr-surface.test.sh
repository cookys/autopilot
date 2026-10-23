#!/usr/bin/env bash
# BL-0229: when a qoderclicn runner rejects a model name, the wrapper must surface the runner's
# (masked, bounded) stderr on ITS OWN stderr and in the result JSON failure field. Before: the
# wrapper exited non-zero with an empty stderr, so a bad model tuple looked like a dead runner.
# Covers dispatch-author.sh (the plan-review transport: runner_failed, exit 3) and the
# dispatch-review.sh qoderclicn branch (no_verdict, exit 1). Stubs only; no real qodercli.
. "$(dirname "$0")/lib.sh"

AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
PROMPT="$TEST_TMP/prompt.txt"; printf '%s\n' 'Return a small JSON object.' > "$PROMPT"
DIFF="$TEST_TMP/d.diff"; printf '+def f(): return 1\n' > "$DIFF"
MSG='model not found: qwen3.8-max-preview'

STUB="$TEST_TMP/fake-qodercli"
cat > "$STUB" <<STUB
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
printf '%s\n' "$MSG" >&2
printf '%s\n' 'auth key sk-abcdefghijklmnopqrstuvwxyz0123456789 rejected' >&2
exit 1
STUB
chmod +x "$STUB"

export ENGINE_CAPABILITY_DIR="$TEST_TMP/ecd"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_STRIKE_WRITER=off

# --- dispatch-author.sh ---------------------------------------------------------------
ERR="$TEST_TMP/author.err"
OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=10 "$AUTHOR" --runner qoderclicn --model qwen3.8-max-preview \
  --prompt-file "$PROMPT" --bin "$STUB" --timeout 10s 2>"$ERR" < /dev/null)"; RC=$?
assert_eq "3" "$RC" "author: exit code unchanged (3)"
assert_contains "$OUT" '"status": "runner_failed"' "author: runner_failed"
assert_contains "$OUT" "$MSG" "author: JSON error carries the runner stderr"
assert_contains "$(cat "$ERR")" "$MSG" "author: wrapper stderr carries the runner stderr"
assert_not_contains "$(cat "$ERR")" 'sk-abcdefghijklmnop' "author: wrapper stderr masks the key"
assert_not_contains "$OUT" 'sk-abcdefghijklmnop' "author: JSON masks the key"

# --- dispatch-review.sh (qoderclicn) ----------------------------------------------------
ERR="$TEST_TMP/review.err"
OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=10 "$REVIEW" --runner qoderclicn --model qwen3.8-max-preview \
  --diff-file "$DIFF" --bin "$STUB" 2>"$ERR" < /dev/null)"; RC=$?
assert_eq "1" "$RC" "review: exit code unchanged (1)"
assert_contains "$OUT" '"status": "no_verdict"' "review: no_verdict"
assert_contains "$OUT" '"exit_code": 1' "review: exit_code recorded"
assert_contains "$OUT" "$MSG" "review: JSON stderr_tail carries the runner stderr"
assert_contains "$(cat "$ERR")" "$MSG" "review: wrapper stderr carries the runner stderr"
assert_not_contains "$(cat "$ERR")" 'sk-abcdefghijklmnop' "review: wrapper stderr masks the key"
assert_not_contains "$OUT" 'sk-abcdefghijklmnop' "review: JSON masks the key"

finalize_test
