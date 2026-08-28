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
#   pass                - emit a well-formed <<<AUTOPILOT-REVIEW-...>>> block on STDOUT, exit 0
#   nonzero             - print to stderr, exit 7, NOTHING on stdout
#   nonzero_with_stdout - emit the SAME well-formed block on STDOUT, THEN exit 7 —
#                         the "engine answered correctly then the process itself
#                         failed" combination (distinct from plain "nonzero": here
#                         stdout genuinely has a parseable-looking verdict, so this
#                         is the case that would slip through if fail-closed only
#                         checked "is stdout non-empty" instead of also gating on
#                         the exit code)
#   empty               - exit 0, no output at all
#   stderr_salvage      - emit the SAME well-formed block, but on STDERR, nothing on
#                         stdout, exit 0 — the no-salvage negative control
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
  nonzero_with_stdout)
    emit_block
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

# R4b — 🔵 nonzero exit + non-empty, well-formed stdout: the process itself failed
# (rc=7) AFTER printing a valid-looking verdict block. Distinct from R4 (nonzero,
# empty stdout) and R6 (exit 0, block on stderr only) — this is the combination
# where a classifier that keys off "stdout is non-empty" instead of the exit code
# would wrongly coerce a pass. Must still fail closed.
OUT="$(env CURSOR_STUB_MODE=nonzero_with_stdout "$REVIEW_SCRIPT" --runner cursor --model "$FULL_MODEL" --diff-file "$DIFF" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "review: nonzero exit with well-formed stdout fails closed (exit 1)"
assert_contains "$OUT" '"status": "no_verdict"' "review: nonzero exit with well-formed stdout yields no_verdict"
assert_not_contains "$OUT" '"status": "reviewed"' "review: nonzero exit with well-formed stdout is never reviewed"
assert_not_contains "$OUT" '"verdict": "SHIP-AS-IS"' "review: nonzero exit with well-formed stdout never authorizes shipping"

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

# A4 — fail-closed on non-zero exit FROM THE INVOKED cursor-agent process: parity with
# every other runner (codex/grok/agy/kimi/etc. all map a non-zero engine exit to
# runner_failed) — the engine ran and failed, which is a different fact from "we never
# dispatched", so this is runner_failed/exit 3, not precondition_failed/exit 2.
OUT="$(env CURSOR_STUB_MODE=nonzero "$AUTHOR_SCRIPT" --runner cursor --model "$FULL_MODEL" --prompt-file "$PROMPT" --bin "$STUB" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "3" "author: non-zero cursor exit fails closed (exit 3, runner_failed)"
assert_contains "$OUT" '"status": "runner_failed"' "author: non-zero cursor exit yields runner_failed"
assert_not_contains "$OUT" '"status": "authored"' "author: non-zero cursor exit is never authored"
assert_not_contains "$OUT" '"status": "precondition_failed"' "author: non-zero cursor exit is never precondition_failed"

# A4b — binary ABSENT is still precondition_failed/exit 2 (proves the fix did not simply
# relabel every cursor failure to runner_failed — a failure BEFORE cursor-agent is ever
# invoked stays a precondition).
OUT="$("$AUTHOR_SCRIPT" --runner cursor --model "$FULL_MODEL" --prompt-file "$PROMPT" --bin "$TEST_TMP/no-such-cursor-agent-binary" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "author: cursor binary absent exits 2 (precondition)"
assert_contains "$OUT" '"status": "precondition_failed"' "author: cursor binary absent status is precondition_failed"
assert_contains "$OUT" "cursor binary not found" "author: cursor binary absent message"

# A4c — every entry in _CURSOR_FAMILIES (the single source of truth) is rejected as a
# bare family alias, precondition_failed/exit 2. Iterated, not named, so this test
# cannot fall behind the set if a family is added or removed.
# shellcheck source=../../scripts/lib/cursor-model.sh
. "$REPO_ROOT/scripts/lib/cursor-model.sh"
for _family in $_CURSOR_FAMILIES; do
  OUT="$("$AUTHOR_SCRIPT" --runner cursor --model "$_family" --prompt-file "$PROMPT" --bin "$STUB" 2>&1)"; EXIT=$?
  assert_exit_code "$EXIT" "2" "author: bare family alias '$_family' exits 2 (precondition)"
  assert_contains "$OUT" '"status": "precondition_failed"' "author: bare family alias '$_family' status is precondition_failed"
  assert_contains "$OUT" "family alias" "author: bare family alias '$_family' message names the family-alias reason"
done

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

# ==================================================================================
# R8 — fail-CLOSED sourcing of lib/cursor-model.sh (the asymmetry fix): an unreadable
# copy must hard-error before any runner is spawned, not silently disable the
# family-alias rejection guard (which is what `[ -r ... ] && . ... || true` did before
# this fix — the alias check reads `command -v cursor_is_family_alias`, so a lib that
# failed to source made that guard a silent no-op). dispatch-author.sh:111-112 and
# dispatch-hetero.sh's own cursor-model.sh source were already unconditional
# (fail-closed by ordinary bash `.` semantics); dispatch-review.sh was the outlier.
#
# Exercised against a COPY of scripts/ with lib/cursor-model.sh made unreadable —
# never mutates the real repo tree.
# ---------------------------------------------------------------------------
SCRIPTS_COPY="$TEST_TMP/scripts-copy"
mkdir -p "$SCRIPTS_COPY"
cp -r "$REPO_ROOT/scripts/." "$SCRIPTS_COPY/"
UNREADABLE_LIB="$SCRIPTS_COPY/lib/cursor-model.sh"
chmod 000 "$UNREADABLE_LIB"

R8_STUB_ARGV="$TEST_TMP/r8-stub-argv.txt"
: > "$R8_STUB_ARGV"
OUT="$(env CURSOR_STUB_MODE=pass CURSOR_ARGV_FILE="$R8_STUB_ARGV" \
  "$SCRIPTS_COPY/dispatch-review.sh" --runner cursor --model "$FULL_MODEL" --diff-file "$DIFF" --bin "$STUB" 2>&1)"; EXIT=$?
chmod 644 "$UNREADABLE_LIB"   # restore before any later use/cleanup of the copy

assert_neq "0" "$EXIT" "review: unreadable lib/cursor-model.sh hard-errors (nonzero exit)"
assert_contains "$OUT" "$UNREADABLE_LIB" "review: unreadable-lib error names the exact lib path"
assert_not_contains "$OUT" '"status": "reviewed"' "review: unreadable-lib run never reaches reviewed"
if [ -s "$R8_STUB_ARGV" ]; then
  fail "review: unreadable-lib run must not have written any cursor-agent argv (no runner spawned)"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# ==================================================================================
# R8b — fail-CLOSED on a READABLE lib that fails to source (returns nonzero). This is
# the gap R8 alone did not cover: `[ -r "$lib" ] && . "$lib"` only guards readability —
# if the file is readable but its own top-level `return 1` (or a syntax error under
# some shells) makes the `.` itself fail, the OLD code (`. "$lib" || true`, i.e. no
# check at all on the source's own exit status) would fall through to arg parsing with
# cursor_is_family_alias silently undefined, same as the unreadable case. Distinct
# failure mode from R8 (readability), so needs its own oracle.
#
# Exercised against a SECOND copy of scripts/ with lib/cursor-model.sh REPLACED by a
# readable stub that immediately `return 1`s — never mutates the real repo tree.
# ---------------------------------------------------------------------------
SCRIPTS_COPY_B="$TEST_TMP/scripts-copy-b"
mkdir -p "$SCRIPTS_COPY_B"
cp -r "$REPO_ROOT/scripts/." "$SCRIPTS_COPY_B/"
FAILING_LIB="$SCRIPTS_COPY_B/lib/cursor-model.sh"
cat > "$FAILING_LIB" <<'EOF'
# stub cursor-model.sh: readable, but fails to source (simulates a corrupt/truncated lib)
return 1
EOF
chmod 644 "$FAILING_LIB"

R8B_STUB_ARGV="$TEST_TMP/r8b-stub-argv.txt"
: > "$R8B_STUB_ARGV"
OUT="$(env CURSOR_STUB_MODE=pass CURSOR_ARGV_FILE="$R8B_STUB_ARGV" \
  "$SCRIPTS_COPY_B/dispatch-review.sh" --runner cursor --model "$FULL_MODEL" --diff-file "$DIFF" --bin "$STUB" 2>&1)"; EXIT=$?

assert_neq "0" "$EXIT" "review: readable-but-failing lib/cursor-model.sh hard-errors (nonzero exit)"
assert_contains "$OUT" "$FAILING_LIB" "review: readable-but-failing lib error names the exact lib path"
assert_not_contains "$OUT" '"status": "reviewed"' "review: readable-but-failing lib run never reaches reviewed"
if [ -s "$R8B_STUB_ARGV" ]; then
  fail "review: readable-but-failing lib run must not have written any cursor-agent argv (no runner spawned)"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

finalize_test
