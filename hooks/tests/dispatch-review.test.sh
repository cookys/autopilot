#!/usr/bin/env bash
# dispatch-review.sh test — READ-ONLY reviewer dispatch with PATH/--bin-stubbed
# engines (no network, no live LLM). Covers: preconditions (exit 2), verdict parse
# (codex + agy paths), FAIL-CLOSED no_verdict on empty capture, and the read-only
# invariant (no repo mutation, no worktree).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-review.sh"

DIFF="$TEST_TMP/d.diff"
printf '+def f(): return x[::1]\n' > "$DIFF"

# --- stub engine: emits a real verdict (ignores args, reads+discards the prompt) ---
STUB_VERDICT="$TEST_TMP/eng-verdict"
cat > "$STUB_VERDICT" <<'EOF'
#!/usr/bin/env bash
# codex path pipes the prompt on stdin; agy path passes it via -p. Drain stdin if any.
cat >/dev/null 2>&1 || true
echo "VERDICT: FIX-THEN-SHIP"
echo "FINDINGS: the slice does not reverse"
EOF
chmod +x "$STUB_VERDICT"

# --- stub engine: emits NOTHING (proxy for agy stdout-drop / a dead reviewer) ---
STUB_EMPTY="$TEST_TMP/eng-empty"
printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\nexit 0\n' > "$STUB_EMPTY"
chmod +x "$STUB_EMPTY"

# --- stub engine: emits a clean SHIP verdict ---
STUB_SHIP="$TEST_TMP/eng-ship"
printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\necho "VERDICT: SHIP-AS-IS"\necho "FINDINGS: none"\n' > "$STUB_SHIP"
chmod +x "$STUB_SHIP"

# 1. --help
HELP_OUT="$("$SCRIPT" --help 2>&1)"; assert_eq "0" "$?" "--help exit code"
assert_contains "$HELP_OUT" "READ-ONLY" "--help states read-only"

# 2. preconditions → exit 2
OUT="$("$SCRIPT" --model x --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing --runner exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "missing runner precondition"
OUT="$("$SCRIPT" --runner bogus --model x --diff-file "$DIFF" 2>&1)"; assert_eq "2" "$?" "bad runner exit 2"
OUT="$("$SCRIPT" --runner codex --model x --diff-file /nonexistent-diff 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing diff-file exit 2"
OUT="$("$SCRIPT" --runner codex --model x --diff-file "$DIFF" --effort turbo 2>&1)"; assert_eq "2" "$?" "bad effort exit 2"

# 3. codex path: verdict parsed → reviewed, exit 0
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "codex reviewed exit 0"
assert_contains "$OUT" '"status": "reviewed"' "codex reviewed status"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "codex verdict parsed"
assert_contains "$OUT" 'does not reverse' "codex findings captured"

# 4. FAIL-CLOSED: empty capture → no_verdict, exit 1 (NEVER a pass)
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_EMPTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "empty capture exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "empty → no_verdict"
assert_contains "$OUT" '"verdict": null' "no_verdict has null verdict"
assert_not_contains "$OUT" 'SHIP-AS-IS' "empty capture is NEVER read as a ship verdict"

# 4b. FAIL-TOWARD-BLOCK: prose mentioning 'VERDICT: SHIP-AS-IS' mid-sentence must NOT flip a
# real 'VERDICT: FIX-THEN-SHIP' line into a pass (unanchored first-match grep was fail-OPEN).
STUB_TRICKY="$TEST_TMP/eng-tricky"
cat > "$STUB_TRICKY" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
echo "This is not a VERDICT: SHIP-AS-IS situation; the code is broken."
echo "VERDICT: FIX-THEN-SHIP"
echo "FINDINGS: null deref"
EOF
chmod +x "$STUB_TRICKY"
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_TRICKY" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "tricky reviewed exit 0"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "prose SHIP token does not flip a real FIX verdict (fail-toward-block)"

# 5. agy path (through the script -qec pseudo-TTY wrapper) with a stub engine
if command -v script >/dev/null 2>&1; then
  OUT="$("$SCRIPT" --runner agy --model "Gemini 3.5 Flash (High)" --diff-file "$DIFF" --bin "$STUB_SHIP" 2>&1)"; EXIT=$?
  assert_eq "0" "$EXIT" "agy reviewed exit 0 (pseudo-TTY capture)"
  assert_contains "$OUT" '"runner": "agy"' "agy runner provenance"
  assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "agy verdict parsed through script -qec"
else
  echo "  (skip agy pseudo-TTY case: 'script' not available)"
fi

# 6. read-only invariant: running inside a git repo mutates NOTHING
RO="$TEST_TMP/ro-repo"; mkdir -p "$RO"
git -C "$RO" init -q -b develop
git -C "$RO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
BEFORE="$(git -C "$RO" rev-parse HEAD)"
( cd "$RO" && "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" >/dev/null 2>&1 )
assert_eq "$BEFORE" "$(git -C "$RO" rev-parse HEAD)" "read-only: HEAD unchanged"
assert_eq "" "$(git -C "$RO" status --porcelain)" "read-only: working tree clean"
assert_eq "" "$(ls "$RO/.git/worktrees" 2>/dev/null)" "read-only: no worktree created"

finalize_test
