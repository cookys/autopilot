#!/usr/bin/env bash
# check-redispatch-prompt.sh integration test — the leaky-phrase linter that
# catches round-cycle meta-signal in a round-2+ re-dispatch prompt (round
# numbers, prior-finding anchors, fixer-applied markers, severity glyphs,
# quoted-code excerpts). Mirrors its anti-gaming sibling
# check-dispatch-suppression.test.sh; closes the pre-existing zero-coverage gap
# tracked in BACKLOG (v2.25.0 Ops review).
#
# Contract under test: 0 = blind-safe, 1 = leaky, 2 = usage error.
. "$(dirname "$0")/lib.sh"

TEST_NAME="check-redispatch-prompt"
SCRIPT="$REPO_ROOT/scripts/check-redispatch-prompt.sh"

# 1. --help exits 0 and documents the leaky-phrase purpose
HELP_OUT="$("$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit code"
assert_contains "$HELP_OUT" "leaky" "--help documents the leaky-phrase class"

# 2. usage error on no args → exit 2
"$SCRIPT" >/dev/null 2>&1; assert_eq "2" "$?" "no-arg → usage exit 2"

# 3. usage error on a nonexistent file → exit 2
"$SCRIPT" "$TEST_TMP/does-not-exist.txt" >/dev/null 2>&1; assert_eq "2" "$?" "missing file → usage exit 2"

# 4. CLEAN — an honest round-1 / re-derive-from-scratch prompt → exit 0
CLEAN_PROMPT="Review the diff for correctness, security, and scope creep. Cite every finding at file:line with a severity. Be exhaustive."
echo "$CLEAN_PROMPT" | "$SCRIPT" - >/dev/null 2>&1; assert_eq "0" "$?" "honest prompt → blind-safe exit 0"

# helper: run a prompt through the linter via stdin, echo its exit code
redis_rc() { printf '%s' "$1" | "$SCRIPT" - >/dev/null 2>&1; echo $?; }

# ── POSITIVE — leaky markers that MUST be caught (exit 1) ─────────────────────
# Each input is SINGLE-TRIGGER (trips exactly one detector) so a regression in
# any one marker cannot hide behind a co-occurring marker in the same input.
assert_eq "1" "$(redis_rc 'Examine the auth flow in round 2.')" \
  "round indicator ('round 2') caught"
assert_eq "1" "$(redis_rc 'Re-check the connection teardown.')" \
  "re-check cue caught"
assert_eq "1" "$(redis_rc 'Previously flagged a null deref here.')" \
  "prior-review marker ('previously flagged') caught"
assert_eq "1" "$(redis_rc 'A defect remained in the previous review.')" \
  "prior-review marker ('previous review') caught"
assert_eq "1" "$(redis_rc 'Verify the fix in the connection handler.')" \
  "verify-fix cue ('verify the fix') caught"
assert_eq "1" "$(redis_rc 'Confirm the patch landed cleanly.')" \
  "confirm-the-patch cue caught"
assert_eq "1" "$(redis_rc 'Focus on the race condition near startup.')" \
  "anchor-to-prior-finding ('focus on ... race') caught"
assert_eq "1" "$(redis_rc 'The fixer applied a guard here.')" \
  "fixer-applied marker caught"
assert_eq "1" "$(redis_rc 'This was noted last cycle.')" \
  "last-cycle marker caught"
assert_eq "1" "$(redis_rc 'Note: this is a re-review of the work.')" \
  "round-cycle meta-signal ('this is a re-review') caught"
assert_eq "1" "$(redis_rc '🔴 here.')" \
  "severity glyph caught"

# 5. POSITIVE via file mode — a quoted fenced code block (copied finding excerpt)
FENCED_FILE="$TEST_TMP/fenced-prompt.txt"
printf 'Re-review this:\n```js\nconst x = 1;\nconst y = 2;\nconst z = 3;\n```\n' > "$FENCED_FILE"
"$SCRIPT" "$FENCED_FILE" >/dev/null 2>&1; assert_eq "1" "$?" "quoted fenced code block (file mode) caught"

# ── NEGATIVE — honest re-dispatch language that MUST pass (exit 0) ─────────────
assert_eq "0" "$(redis_rc 'Audit the new handler for injection and missing validation.')" \
  "real security instruction (no 'focus on' anchor) passes"
assert_eq "0" "$(redis_rc 'Check the boundary conditions and error handling exhaustively.')" \
  "'check' (not 're-check') in an honest prompt passes"
assert_eq "0" "$(redis_rc 'Grade each finding critical / major / minor / suggestion at file:line.')" \
  "stating the severity vocabulary (not tied to a prior round) passes"
assert_eq "0" "$(redis_rc 'Assess whether the diff fully closes the stated goal.')" \
  "plain closure check passes"

finalize_test
