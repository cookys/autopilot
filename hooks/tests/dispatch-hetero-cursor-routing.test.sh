#!/usr/bin/env bash
# dispatch-hetero-cursor-routing.test.sh — the `--runner cursor` / `auto` fail-closed
# model-name guard. Pace may select the broker for an unpinned implementer;
# a named legacy Cursor-hosted id still cannot be disambiguated by vendor name.
#
# Match semantics under test (defined once in dispatch-hetero.sh's set_runner_flags):
#   (a) prefix-open — ANY "cursor-" prefixed id fails closed, in or out of the Phase 1
#       table. Message names --runner cursor only.
#   (b) table-closed — a non-prefixed id fails closed IFF cursor_is_enabled_id(id).
#       Message names BOTH --runner codex and --runner cursor.
#
# 🔴 PROCESS-LEVEL ORACLE: an exit-2-with-the-right-string assertion alone would pass
# against an implementation that dispatched to a rail FIRST and failed after. This
# suite shadows grok/codex/agy/cursor-agent with recording stubs and asserts
# NONE of them are ever invoked across every guard-refusal case.
. "$(dirname "$0")/lib.sh"

# Ambient mission harness env must not poison hermetic unit tests (see
# dispatch-hetero.test.sh for the same isolation rationale).
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
CURSOR_MODEL_LIB="$REPO_ROOT/scripts/lib/cursor-model.sh"
assert_file_exists "$CURSOR_MODEL_LIB" "cursor-model.sh exists"
# shellcheck source=/dev/null
. "$CURSOR_MODEL_LIB"

# --- store isolation (evidence-discipline §9 — see dispatch-hetero.test.sh for the
# 2026-08-22 incident this guards against). lib.sh already isolates
# ENGINE_CAPABILITY_DIR/ENGINE_SCORECARD_DIR globally; nothing further needed here. ---

# --- sandbox git repo (never touch the real repo with worktrees/branches) ---
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"
EMPTY_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"
mkdir -p "$EMPTY_SESSION_MODE_DIR"

# ---------------------------------------------------------------------------
# Process-level oracle fixture: recording stubs for EVERY rail binary,
# including cursor-agent's own. Each touches a sentinel file if ever invoked,
# then fails loudly — the guard must refuse before any of these ever run.
# ---------------------------------------------------------------------------
SENTINEL_DIR="$TEST_TMP/sentinels"
mkdir -p "$SENTINEL_DIR"
POISON_DIR="$TEST_TMP/poison-bin"
mkdir -p "$POISON_DIR"
for railbin in grok codex agy cursor-agent; do
  cat > "$POISON_DIR/$railbin" <<STUB
#!/usr/bin/env bash
touch "$SENTINEL_DIR/$railbin.invoked"
echo "unexpected invocation of $railbin: \$*" >&2
exit 1
STUB
  chmod +x "$POISON_DIR/$railbin"
done
POISON_PATH="$POISON_DIR:/usr/bin:/bin"

no_sentinels_tripped() {
  local f
  for f in "$SENTINEL_DIR"/*.invoked; do
    [ -e "$f" ] && return 1
  done
  return 0
}

# no_cursor_rail_sentinels_tripped — SAME strict oracle as no_sentinels_tripped
# (codex.invoked included). Previously this tolerated a codex.invoked sentinel
# on the premise that case 3b (auto + gpt-5.2, below) "legitimately dispatches
# to codex" and leaves that sentinel as expected residue. That premise was
# FALSE: case 3b runs under $POISON_PATH (so a system-installed codex is never
# reachable either — codex must be unreachable BY CONSTRUCTION, not by an
# assumption about what happens to be on this host's PATH) AND passes an
# explicit, unresolvable NAME-form --codex-bin, which `command -v` fails to
# resolve — it asserts "codex binary not found: <name>" and dies at the
# precondition, never reaching exec. Since the unresolvable name is not
# "codex", the codex STUB in $POISON_DIR is never looked up by 3b either, so
# it is IMPOSSIBLE for 3b to produce a codex.invoked sentinel. No legitimate
# codex.invoked sentinel can ever exist in this suite, so no tolerance is
# warranted: any codex.invoked sentinel found here means some OTHER case in
# this file actually dispatched to (poisoned) codex instead of refusing —
# exactly the failure mode this oracle exists to catch.
no_cursor_rail_sentinels_tripped() {
  [ ! -e "$SENTINEL_DIR/cursor-agent.invoked" ] \
    && [ ! -e "$SENTINEL_DIR/grok.invoked" ] \
    && [ ! -e "$SENTINEL_DIR/agy.invoked" ] \
    && [ ! -e "$SENTINEL_DIR/codex.invoked" ]
}

run_guard_case() {
  # run_guard_case <branch-suffix> <model>  — runs with the POISONED PATH (every
  # rail binary, including cursor-agent, is a recording stub). Use this for
  # every case that MUST refuse without dispatching anywhere.
  local suffix="$1" model="$2"
  ( cd "$SBX" && PATH="$POISON_PATH" \
    AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
    "$SCRIPT" --no-verify-tip --branch "t-cursor-guard-$suffix" --prompt-file "$PROMPT" \
    --runner auto --pin-reason "test fixture" --model "$model" 2>&1 )
}

FULL_LOG="$TEST_TMP/full-guard-log.txt"
: > "$FULL_LOG"

# ---------------------------------------------------------------------------
# 1. ENUMERATE cursor_enabled_ids — every id the mapper table can produce.
# Adding a mapper row extends this loop automatically (no restated list).
# Each id must: exit 2, name the right runner(s) in the message, and (checked
# once at the end) never touch a rail binary.
# ---------------------------------------------------------------------------
n=0
while IFS= read -r id; do
  [ -n "$id" ] || continue
  n=$((n + 1))
  OUT="$(run_guard_case "enum-$n" "$id")"; EXIT=$?
  printf '%s\n' "$OUT" >> "$FULL_LOG"
  assert_eq "2" "$EXIT" "auto + enumerated id '$id' → exit 2"
  case "$id" in
    cursor-*)
      # class (a): prefix-open — message names --runner cursor only.
      assert_contains "$OUT" "--runner cursor" "auto + '$id' (cursor- prefix) names --runner cursor"
      ;;
    *)
      # class (b): table-closed — message names BOTH --runner codex and --runner cursor.
      assert_contains "$OUT" "--runner codex" "auto + '$id' (table-closed) names --runner codex"
      assert_contains "$OUT" "--runner cursor" "auto + '$id' (table-closed) names --runner cursor"
      ;;
  esac
done < <(cursor_enabled_ids)
assert_neq "0" "$n" "cursor_enabled_ids enumerated at least one id (loop actually ran)"

# ---------------------------------------------------------------------------
# 2. class (a), OUT-OF-TABLE: cursor-grok-4.5-high is NOT in the Phase 1 table
# (cursor_is_enabled_id would say false) but the cursor- prefix alone must
# still fail closed — prefix-open, in or out of the table.
# ---------------------------------------------------------------------------
if cursor_is_enabled_id "cursor-grok-4.5-high"; then
  fail "test fixture invalid: cursor-grok-4.5-high must NOT be in cursor_enabled_ids"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
OUT="$(run_guard_case "out-of-table" "cursor-grok-4.5-high")"; EXIT=$?
printf '%s\n' "$OUT" >> "$FULL_LOG"
assert_eq "2" "$EXIT" "auto + out-of-table cursor-grok-4.5-high → exit 2 (prefix-open)"
assert_contains "$OUT" "--runner cursor" "out-of-table cursor id names --runner cursor"

# ---------------------------------------------------------------------------
# 2b. 🟠 FINDING 1 — the refusal must emit TRUE runner provenance, not a false
# "agy" (agy is the else-case with no IS_AGY flag, so "no IS_* set" is
# ambiguous between "agy selected" and "resolution never happened" unless
# RUNNER_RESOLVED disambiguates it). A guard refusal fires INSIDE
# set_runner_flags, before RUNNER_RESOLVED is ever set to 1, so its emitted
# JSON must report "runner": "unresolved" — never "agy". Checked for BOTH
# guard arms: a cursor-prefixed id (prefix-open) and an enabled non-prefixed
# id (table-closed).
# ---------------------------------------------------------------------------
OUT="$(run_guard_case "provenance-prefix-open" "cursor-grok-4.6-high")"; EXIT=$?
printf '%s\n' "$OUT" >> "$FULL_LOG"
assert_eq "2" "$EXIT" "auto + cursor-grok-4.6-high (prefix-open) → exit 2"
assert_contains "$OUT" '"runner": "unresolved"' \
  "cursor auto-guard refusal (prefix-open) emits runner: unresolved"
assert_not_contains "$OUT" '"runner": "agy"' \
  "cursor auto-guard refusal (prefix-open) does NOT emit runner: agy"

OUT="$(run_guard_case "provenance-table-closed" "gpt-5.3-codex-low")"; EXIT=$?
printf '%s\n' "$OUT" >> "$FULL_LOG"
assert_eq "2" "$EXIT" "auto + gpt-5.3-codex-low (table-closed) → exit 2"
assert_contains "$OUT" '"runner": "unresolved"' \
  "cursor auto-guard refusal (table-closed) emits runner: unresolved"
assert_not_contains "$OUT" '"runner": "agy"' \
  "cursor auto-guard refusal (table-closed) does NOT emit runner: agy"

# General case (NOT cursor-specific): an early precondition failure raised
# BEFORE runner resolution — here, a missing --branch — must ALSO emit
# runner: unresolved. Proves the fix is general, not cursor-special-cased.
OUT="$(cd "$SBX" && PATH="$POISON_PATH" AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
  "$SCRIPT" --no-verify-tip --prompt-file "$PROMPT" --runner auto --pin-reason "test fixture" --model gpt-5.3-codex-low 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing --branch → exit 2"
assert_contains "$OUT" "--branch is required" "missing --branch precondition message"
assert_contains "$OUT" '"runner": "unresolved"' \
  "missing --branch (pre-runner-resolution) emits runner: unresolved — general case, not cursor-special-cased"
assert_not_contains "$OUT" '"runner": "agy"' \
  "missing --branch does NOT emit runner: agy"

# ---------------------------------------------------------------------------
# 3a. 🔴 PROCESS-LEVEL ORACLE (guard-refusal cases only): across the enumeration
# plus the out-of-table case above, NO rail binary was ever invoked — including
# cursor-agent's own. An exit-2-with-message assertion alone would pass an
# implementation that dispatched first and failed after; this is the point of
# the test. Checked HERE, before the non-over-capture case below deliberately
# DOES let codex run (that is what "does not over-capture" means).
# ---------------------------------------------------------------------------
if no_sentinels_tripped; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "process-level oracle: a rail binary was invoked during a guard refusal: $(ls "$SENTINEL_DIR" 2>/dev/null | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 3b. NON-OVER-CAPTURE: a bare non-prefixed, non-table id (gpt-5.2) must still
# route to codex as before — proving the guard does NOT swallow every
# gpt-shaped id, only the ones the table actually enables. Codex must be
# unreachable BY CONSTRUCTION, not by host assumption: run under $POISON_PATH
# (so no real rail binary is reachable at all — including a system-installed
# codex, which would make this case invoke a REAL agent on such a host) AND
# pass an explicit, unresolvable NAME-form --codex-bin (no "/", so it falls
# through the path-form feature-detection at ~1937-1949 straight to
# `command -v`, which dies with "codex binary not found: <name>" — the same
# assertion shape as before, and it names OUR bin, proving the run really
# went down the codex branch instead of tripping the cursor guard).
# ---------------------------------------------------------------------------
if cursor_is_enabled_id "gpt-5.2"; then
  fail "test fixture invalid: gpt-5.2 must NOT be in cursor_enabled_ids"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
UNRESOLVABLE_CODEX_BIN="codex-definitely-not-installed-9f3c7a1b"
OUT="$(cd "$SBX" && PATH="$POISON_PATH" AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
  "$SCRIPT" --no-verify-tip --branch t-cursor-guard-non-over-capture --prompt-file "$PROMPT" \
  --runner auto --pin-reason "test fixture" --model gpt-5.2 --codex-bin "$UNRESOLVABLE_CODEX_BIN" 2>&1)"; EXIT=$?
printf '%s\n' "$OUT" >> "$FULL_LOG"
assert_eq "2" "$EXIT" "auto + gpt-5.2 → exit 2 (codex precondition, not the cursor guard)"
assert_contains "$OUT" "codex binary not found: $UNRESOLVABLE_CODEX_BIN" \
  "gpt-5.2 routes to codex (not swallowed by the cursor guard); codex unreachable by construction"
assert_not_contains "$OUT" "auto-routing refuses" "gpt-5.2 does not trip the cursor guard at all"

# ---------------------------------------------------------------------------
# 4. Model-name guard refusals never select cursor: no case above produced
# "runner": "cursor" in its stdout. (implicit: every guard case exits 2 via
# die_precondition before emit() runs, so no "runner" field is ever produced
# at all under a guard refusal — the strongest form of "never selects".
# Spot-check literal absence across the full accumulated log anyway.)
# ---------------------------------------------------------------------------
assert_not_contains "$(cat "$FULL_LOG")" '"runner": "cursor"' \
  "--runner auto never produces runner: cursor across every guard case"

# ---------------------------------------------------------------------------
# 5. Re-affirm the process-level oracle after the non-over-capture case: 3b
# ran under $POISON_PATH with an explicit, unresolvable NAME-form
# --codex-bin, so `command -v` never resolves to the "codex" stub in
# $POISON_DIR and cannot have touched $SENTINEL_DIR/codex.invoked — codex is
# unreachable there BY CONSTRUCTION (that is precisely why 3b dies at "codex
# binary not found: <name>" instead of executing). No sentinel, including
# codex's, should exist here.
# ---------------------------------------------------------------------------
if no_cursor_rail_sentinels_tripped; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "process-level oracle: a non-codex rail binary was invoked unexpectedly: $(ls "$SENTINEL_DIR" 2>/dev/null | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 6. cursor rejected in an EXPLICIT reviewer-class-shaped call too: not
# applicable to dispatch-hetero.sh (implementer-only dispatcher, no
# reviewer-class role concept). Covered instead by a NAMED, EXISTING artifact:
# hooks/tests/dispatch-review-author-cursor.test.sh — alias rejection, missing
# --model, fail-closed on non-zero exit and on empty stdout, the no-stderr-
# salvage case, and the argv shape, for both wrappers. Cite the file so this
# claim is checkable: an earlier revision asserted this coverage while no such
# test existed, which is worse than an admitted gap because it stops the next
# reader looking. This suite stays scoped to base-dispatch auto-routing only
# (§3a / Phase 2 acceptance).
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 7. Negative: --cursor-fast with a non-cursor runner → die_precondition.
# ---------------------------------------------------------------------------
OUT="$(cd "$SBX" && PATH="$POISON_PATH" AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
  "$SCRIPT" --no-verify-tip --branch t-cursor-fast-wrong-runner --prompt-file "$PROMPT" \
  --runner grok --pin-reason "test fixture" --model grok-4.5 --cursor-fast 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "--cursor-fast with --runner grok → exit 2"
assert_contains "$OUT" "--cursor-fast applies only to --runner cursor" \
  "--cursor-fast + non-cursor runner die_precondition message"

# ---------------------------------------------------------------------------
# 8. Negative: broker model + legacy --cursor-fast → die_precondition.
# ---------------------------------------------------------------------------
OUT="$(cd "$SBX" && PATH="$POISON_PATH" AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
  "$SCRIPT" --no-verify-tip --branch t-cursor-fast-full-id --prompt-file "$PROMPT" \
  --runner cursor --pin-reason "test fixture" --model composer-2.5 --cursor-fast 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "--cursor-fast with a full-id --model → exit 2"
assert_contains "$OUT" "--cursor-fast is unavailable on the cursor broker" \
  "--cursor-fast + full-id die_precondition message"

# Sentinel check must still hold after the two negative-control cases above
# (both run on $POISON_PATH; no rail binary, including codex, should ever be
# touched — codex.invoked is NOT tolerated, see no_cursor_rail_sentinels_tripped
# above for why no legitimate codex.invoked sentinel can ever exist here).
if no_cursor_rail_sentinels_tripped; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "process-level oracle (post --cursor-fast negatives): a rail binary was invoked: $(ls "$SENTINEL_DIR" 2>/dev/null | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 9. Broker-backed committed dispatch supersedes the retired local CLI cases.
# The dedicated fixture checks wire keys, sharing, patch application and cleanup.
# ---------------------------------------------------------------------------
CURSOR_BROKER_TEST_CASE=a bash "$REPO_ROOT/hooks/tests/cursor-broker-runner.test.sh" < /dev/null
assert_eq "$?" 0 "broker end-to-end committed dispatch"

finalize_test
