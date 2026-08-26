#!/usr/bin/env bash
# dispatch-review-author-cursor.test.sh — oracle for the `--runner cursor` branches
# added to scripts/dispatch-review.sh (~L955-991) and scripts/dispatch-author.sh
# (~L987-1013). Per docs/plans/2026-08-26-cursor-cli-adaptor.md §4 Phase 3.
#
# A stale comment in dispatch-hetero-cursor-routing.test.sh claimed the reviewer-class
# cursor cases were "covered instead by Phase 3's dispatch-review.sh / dispatch-author.sh
# allowlist tests". No such tests existed — this file is that missing oracle.
#
# Contract under test (both scripts, cursor rail only):
#   - BIN defaults to cursor-agent, overridable by --bin. No --cursor-bin.
#   - --model MUST be a full cursor-agent model id: missing model or a bare family
#     alias (grok46/codex53) is die_precondition. No default, no alias resolution
#     on this rail (that lives only in dispatch-hetero.sh's lib/cursor-model.sh).
#   - Transport, exact: "$BIN" -p --trust --mode ask --model "$MODEL"
#     --output-format text < "$PROMPT", scratch cwd, no --force.
#   - stdout and stderr captured to SEPARATE files; parser/authored-check reads
#     stdout ONLY — a well-formed VERDICT block on stderr must NOT be salvaged.
#   - Fail-closed on non-zero exit / empty stdout / missing verdict block.
#
# 🔴 NEVER invokes the real cursor-agent — every case below shadows it with a stub
# on an explicit --bin path (never PATH), matching hooks/tests/dispatch-review.test.sh's
# STUB_MARKER convention (extract the review nonce markers straight out of the prompt
# text the script already wrote — see "how the review verdict format was derived" in
# the worker report; the format is NOT guessed).
. "$(dirname "$0")/lib.sh"

# Ambient mission/env isolation — same rationale as dispatch-hetero-cursor-routing.test.sh
# and dispatch-hetero.test.sh: a hermetic unit test must not be poisoned by whatever
# mission/session-mode/context-window env the invoking shell happens to carry.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_CONTEXT_WINDOW_GATE AUTOPILOT_SESSION_MODE_DIR 2>/dev/null || true
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"

REVIEW_SCRIPT="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR_SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
assert_file_exists "$REVIEW_SCRIPT" "dispatch-review.sh exists"
assert_file_exists "$AUTHOR_SCRIPT" "dispatch-author.sh exists"

DIFF="$TEST_TMP/d.diff"
printf '+def f(): return x[::1]\n' > "$DIFF"

PROMPT="$TEST_TMP/p.txt"
printf 'Author a fix for the off-by-one in f().\n' > "$PROMPT"

FULL_MODEL="cursor-grok-4.6-high-fast"

# --- shared cursor-agent stub ------------------------------------------------------
# One executable stub used for BOTH scripts (dispatch-author never requires the
# review nonce block — it only requires non-empty stdout — so the same stub's
# well-formed-block "pass"/"stderr_salvage" bodies satisfy both contracts).
#
# Modes (via CURSOR_STUB_MODE env, default "pass"):
#   pass            - emit a well-formed <<<AUTOPILOT-REVIEW-...>>> block on STDOUT, exit 0
#   nonzero         - print to stderr, exit 7
#   empty           - exit 0, no output at all
#   stderr_salvage  - emit the SAME well-formed block, but on STDERR, nothing on
#                     stdout, exit 0 — the no-salvage negative control
# If CURSOR_ARGV_FILE is set, argv is recorded there (one arg per line) on every call.
STUB="$TEST_TMP/cursor-agent-stub"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
[ -z "${CURSOR_ARGV_FILE:-}" ] || printf '%s\n' "$@" > "$CURSOR_ARGV_FILE"
PROMPT_TEXT="$(cat)"
BEGIN="$(printf '%s\n' "$PROMPT_TEXT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
END="$(printf '%s\n' "$PROMPT_TEXT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
emit_block() {
  echo "$BEGIN"
  echo "VERDICT: SHIP-AS-IS"
  echo "FINDINGS: none"
  echo "NO-FINDING-PROOF: checked=diff and supplied acceptance criteria; evidence=the changed slice was traced against the fixture; conclusion=no concrete blocking discrepancy was observed"
  echo "$END"
}
case "${CURSOR_STUB_MODE:-pass}" in
  pass)
    emit_block
    exit 0
    ;;
  nonzero)
    echo "cursor-agent: fixture failure" >&2
    exit 7
    ;;
  empty)
    exit 0
    ;;
  stderr_salvage)
    emit_block >&2
    exit 0
    ;;
  *)
    echo "unknown CURSOR_STUB_MODE: ${CURSOR_STUB_MODE:-}" >&2
    exit 99
    ;;
esac
EOF
chmod +x "$STUB"

extract_json_string() {
  # extract_json_string <json> <key>
  printf '%s' "$1" | sed -n "s/.*\"$2\": \"\\([^\"]*\\)\".*/\\1/p" | sed -n '1p'
}

# ==================================================================================
# dispatch-review.sh cursor branch
# ==================================================================================

# R1 — alias rejection: --model grok46 must die_precondition, never reach the runner.
OUT="$(env CURSOR_STUB_MODE=pass "$REVIEW_SCRIPT" --runner cursor --model grok46 --diff-file "$DIFF" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "review: alias model 'grok46' exits 2 (precondition)"
assert_contains "$OUT" '"status": "precondition_failed"' "review: alias model status is precondition_failed"
assert_contains "$OUT" "family alias" "review: alias-rejection message names the family-alias reason"

# R2 — missing --model.
OUT="$("$REVIEW_SCRIPT" --runner cursor --diff-file "$DIFF" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "review: missing --model exits 2 (precondition)"
assert_contains "$OUT" '"status": "precondition_failed"' "review: missing --model status is precondition_failed"
assert_contains "$OUT" "--model is required" "review: missing --model message"

# R3 — happy path: well-formed block on stdout parses to a ratified reviewed verdict.
OUT="$(env CURSOR_STUB_MODE=pass "$REVIEW_SCRIPT" --runner cursor --model "$FULL_MODEL" --diff-file "$DIFF" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "0" "review: happy path exits 0"
assert_contains "$OUT" '"status": "reviewed"' "review: happy path status is reviewed"
assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "review: happy path parses the SHIP-AS-IS verdict"

# R4 — fail-closed on non-zero exit: never a coerced pass.
OUT="$(env CURSOR_STUB_MODE=nonzero "$REVIEW_SCRIPT" --runner cursor --model "$FULL_MODEL" --diff-file "$DIFF" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "review: non-zero cursor exit fails closed (exit 1)"
assert_contains "$OUT" '"status": "no_verdict"' "review: non-zero cursor exit yields no_verdict"
assert_not_contains "$OUT" '"status": "reviewed"' "review: non-zero cursor exit is never reviewed"

# R5 — fail-closed on empty stdout (exit 0, nothing printed).
OUT="$(env CURSOR_STUB_MODE=empty "$REVIEW_SCRIPT" --runner cursor --model "$FULL_MODEL" --diff-file "$DIFF" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "review: empty stdout fails closed (exit 1)"
assert_contains "$OUT" '"status": "no_verdict"' "review: empty stdout yields no_verdict"

# R6 — 🔴 no stderr salvage: a perfectly well-formed VERDICT block on STDERR, empty
# stdout, exit 0 — must still fail closed, never parsed into a pass.
OUT="$(env CURSOR_STUB_MODE=stderr_salvage "$REVIEW_SCRIPT" --runner cursor --model "$FULL_MODEL" --diff-file "$DIFF" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "review: stderr-only verdict block fails closed (exit 1)"
assert_contains "$OUT" '"status": "no_verdict"' "review: stderr-only verdict block yields no_verdict"
assert_not_contains "$OUT" '"verdict": "SHIP-AS-IS"' "review: stderr-only verdict is never parsed as SHIP-AS-IS"

# R7 — argv shape: exact transport, no --force / --reasoning-effort / --cwd.
REVIEW_ARGV="$TEST_TMP/review-argv.txt"
: > "$REVIEW_ARGV"
OUT="$(env CURSOR_STUB_MODE=pass CURSOR_ARGV_FILE="$REVIEW_ARGV" "$REVIEW_SCRIPT" --runner cursor --model "$FULL_MODEL" --diff-file "$DIFF" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "0" "review: argv-capture run exits 0"
assert_file_exists "$REVIEW_ARGV" "review: cursor-agent stub was actually invoked (argv captured)"
REVIEW_ARGV_CONTENT="$(cat "$REVIEW_ARGV")"
assert_contains "$REVIEW_ARGV_CONTENT" "-p" "review argv: contains -p"
assert_contains "$REVIEW_ARGV_CONTENT" "--trust" "review argv: contains --trust"
assert_contains "$(printf '%s\n' "$REVIEW_ARGV_CONTENT" | tr '\n' ' ')" "--mode ask" "review argv: contains --mode ask"
assert_contains "$(printf '%s\n' "$REVIEW_ARGV_CONTENT" | tr '\n' ' ')" "--output-format text" "review argv: contains --output-format text"
assert_not_contains "$REVIEW_ARGV_CONTENT" "--force" "review argv: does NOT contain --force"
assert_not_contains "$REVIEW_ARGV_CONTENT" "--reasoning-effort" "review argv: does NOT contain --reasoning-effort"
assert_not_contains "$REVIEW_ARGV_CONTENT" "--cwd" "review argv: does NOT contain --cwd"

# ==================================================================================
# dispatch-author.sh cursor branch
# ==================================================================================

# A1 — alias rejection.
OUT="$(env CURSOR_STUB_MODE=pass "$AUTHOR_SCRIPT" --runner cursor --model codex53 --prompt-file "$PROMPT" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "author: alias model 'codex53' exits 2 (precondition)"
assert_contains "$OUT" '"status": "precondition_failed"' "author: alias model status is precondition_failed"
assert_contains "$OUT" "family alias" "author: alias-rejection message names the family-alias reason"

# A2 — missing --model.
OUT="$("$AUTHOR_SCRIPT" --runner cursor --prompt-file "$PROMPT" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "author: missing --model exits 2 (precondition)"
assert_contains "$OUT" '"status": "precondition_failed"' "author: missing --model status is precondition_failed"
assert_contains "$OUT" "--model is required" "author: missing --model message"

# A3 — happy path: non-empty authored stdout.
OUT="$(env CURSOR_STUB_MODE=pass "$AUTHOR_SCRIPT" --runner cursor --model "$FULL_MODEL" --prompt-file "$PROMPT" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "0" "author: happy path exits 0"
assert_contains "$OUT" '"status": "authored"' "author: happy path status is authored"
A3_RAW_LOG="$(extract_json_string "$OUT" "raw_log")"
assert_neq "$A3_RAW_LOG" "" "author: happy path raw_log path is present"
if [ -n "$A3_RAW_LOG" ] && [ -s "$A3_RAW_LOG" ]; then
  assert_eq "0" "0" "author: happy path raw_log file is non-empty"
else
  fail "author: happy-path raw_log file '$A3_RAW_LOG' is missing or empty"
fi

# A4 — fail-closed on non-zero exit. Note: the cursor branch calls die_precondition
# directly on non-zero rc (a deliberate choice per the branch's own comment — "not
# runner_failed" — so this rail's non-zero-exit failure surfaces as
# precondition_failed/exit 2, not the runner_failed/exit 3 other rails use). Assert
# the actual documented behavior, and that it is never coerced into authored.
OUT="$(env CURSOR_STUB_MODE=nonzero "$AUTHOR_SCRIPT" --runner cursor --model "$FULL_MODEL" --prompt-file "$PROMPT" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "author: non-zero cursor exit fails closed (exit 2, precondition_failed)"
assert_contains "$OUT" '"status": "precondition_failed"' "author: non-zero cursor exit yields precondition_failed"
assert_not_contains "$OUT" '"status": "authored"' "author: non-zero cursor exit is never authored"
assert_contains "$OUT" "no salvage from stderr" "author: non-zero cursor exit message names no-salvage posture"

# A5 — fail-closed on empty stdout.
OUT="$(env CURSOR_STUB_MODE=empty "$AUTHOR_SCRIPT" --runner cursor --model "$FULL_MODEL" --prompt-file "$PROMPT" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "author: empty stdout fails closed (exit 1)"
assert_contains "$OUT" '"status": "empty_output"' "author: empty stdout yields empty_output"

# A6 — 🔴 no stderr salvage: authored-looking text on STDERR only, empty stdout, exit 0
# — must still fail closed as empty_output, never coerced into authored.
OUT="$(env CURSOR_STUB_MODE=stderr_salvage "$AUTHOR_SCRIPT" --runner cursor --model "$FULL_MODEL" --prompt-file "$PROMPT" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "author: stderr-only content fails closed (exit 1)"
assert_contains "$OUT" '"status": "empty_output"' "author: stderr-only content yields empty_output"
assert_not_contains "$OUT" '"status": "authored"' "author: stderr-only content is never authored"

# A7 — argv shape.
AUTHOR_ARGV="$TEST_TMP/author-argv.txt"
: > "$AUTHOR_ARGV"
OUT="$(env CURSOR_STUB_MODE=pass CURSOR_ARGV_FILE="$AUTHOR_ARGV" "$AUTHOR_SCRIPT" --runner cursor --model "$FULL_MODEL" --prompt-file "$PROMPT" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "0" "author: argv-capture run exits 0"
assert_file_exists "$AUTHOR_ARGV" "author: cursor-agent stub was actually invoked (argv captured)"
AUTHOR_ARGV_CONTENT="$(cat "$AUTHOR_ARGV")"
assert_contains "$AUTHOR_ARGV_CONTENT" "-p" "author argv: contains -p"
assert_contains "$AUTHOR_ARGV_CONTENT" "--trust" "author argv: contains --trust"
assert_contains "$(printf '%s\n' "$AUTHOR_ARGV_CONTENT" | tr '\n' ' ')" "--mode ask" "author argv: contains --mode ask"
assert_contains "$(printf '%s\n' "$AUTHOR_ARGV_CONTENT" | tr '\n' ' ')" "--output-format text" "author argv: contains --output-format text"
assert_not_contains "$AUTHOR_ARGV_CONTENT" "--force" "author argv: does NOT contain --force"
assert_not_contains "$AUTHOR_ARGV_CONTENT" "--reasoning-effort" "author argv: does NOT contain --reasoning-effort"
assert_not_contains "$AUTHOR_ARGV_CONTENT" "--cwd" "author argv: does NOT contain --cwd"

finalize_test
