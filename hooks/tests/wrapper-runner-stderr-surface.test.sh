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

# RED at ec3693750: cut: wrapper stderr / JSON had no key fragment -> 2 FAIL (unexpected AAAAAAAA); 22 passed, 2 failed.
# --- redact BEFORE the byte cut (independent-verify finding: cutting ahead of masking strands a key
# fragment with no recognisable prefix, and the fragment reached the wrapper stderr and the JSON) ---
run_author_payload() { # $1 = case name, $2 = payload file
  local stub="$TEST_TMP/stub-$1" errf="$TEST_TMP/$1.err"
  printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\ncat "%s" >&2\nexit 1\n' "$2" > "$stub"; chmod +x "$stub"
  AOUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=10 "$AUTHOR" --runner qoderclicn --model bad \
    --prompt-file "$PROMPT" --bin "$stub" --timeout 10s 2>"$errf" < /dev/null)"; ARC=$?
  AERR="$(cat "$errf")"
  printf '%s' "$AERR" | iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1; AERR_UTF8=$?
  printf '%s' "$AOUT" | iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1; AOUT_UTF8=$?
}
pyout() { python3 -c "import sys;sys.stdout.write($1)"; }

# key just before the 2048-byte cut point: the old order cut inside the A run
pyout "'sk-'+'A'*100+' '+'中😀'*278" > "$TEST_TMP/p-cut.txt"
run_author_payload cut "$TEST_TMP/p-cut.txt"
assert_eq "3" "$ARC" "cut: exit code 3"
assert_not_contains "$AERR" 'AAAAAAAA' "cut: wrapper stderr has no key fragment"
assert_not_contains "$AOUT" 'AAAAAAAA' "cut: JSON has no key fragment"
assert_eq "0" "$AERR_UTF8" "cut: wrapper stderr is valid UTF-8"
assert_eq "0" "$AOUT_UTF8" "cut: JSON is valid UTF-8"

# key straddling the start of the 8000-byte work window
pyout "'sk-'+'B'*100+' '+'ab '*2640" > "$TEST_TMP/p-win.txt"
run_author_payload win "$TEST_TMP/p-win.txt"
assert_not_contains "$AERR" 'BBBBBBBB' "window: wrapper stderr has no key fragment"
assert_not_contains "$AOUT" 'BBBBBBBB' "window: JSON has no key fragment"

# 4-byte emoji at every cut boundary: both surfaces stay strictly decodable, no U+FFFD
pyout "'中😀'*1000" > "$TEST_TMP/p-emoji.txt"
run_author_payload emoji "$TEST_TMP/p-emoji.txt"
assert_eq "0" "$AERR_UTF8" "emoji: wrapper stderr is valid UTF-8"
assert_eq "0" "$AOUT_UTF8" "emoji: JSON is valid UTF-8"
assert_not_contains "$AERR" $'\xef\xbf\xbd' "emoji: no replacement char on wrapper stderr"
assert_not_contains "$AOUT" $'\xef\xbf\xbd' "emoji: no replacement char in JSON"

finalize_test
