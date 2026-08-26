#!/usr/bin/env bash
# dispatch-hetero-cursor-routing.test.sh — the `--runner cursor` / `auto` fail-closed
# guard, Phase 2 acceptance test. Per docs/plans/2026-08-26-cursor-cli-adaptor.md §3a/§5:
# "The auto-never-selects-cursor negative control is the single most important test
# here." R-1: every cursor model id contains grok/gpt/codex/claude, so auto-selection
# cannot disambiguate a vendor-hosted (Cursor) id from a vendor-native one.
#
# Match semantics under test (defined once in dispatch-hetero.sh's set_runner_flags):
#   (a) prefix-open — ANY "cursor-" prefixed id fails closed, in or out of the Phase 1
#       table. Message names --runner cursor only.
#   (b) table-closed — a non-prefixed id fails closed IFF cursor_is_enabled_id(id).
#       Message names BOTH --runner codex and --runner cursor.
#
# 🔴 PROCESS-LEVEL ORACLE: an exit-2-with-the-right-string assertion alone would pass
# against an implementation that dispatched to a rail FIRST and failed after. This
# suite shadows grok/codex/agy/qoderclicn/cursor-agent with recording stubs and asserts
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
for railbin in grok codex agy qoderclicn cursor-agent; do
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

# no_cursor_rail_sentinels_tripped — same oracle, but tolerant of the codex
# sentinel: once case 3b legitimately dispatches to codex (proving the guard
# does NOT over-capture), a codex.invoked sentinel is EXPECTED to exist for
# the remainder of the suite. cursor-agent/grok/agy/qoderclicn must still
# never be touched by anything in this file.
no_cursor_rail_sentinels_tripped() {
  [ ! -e "$SENTINEL_DIR/cursor-agent.invoked" ] \
    && [ ! -e "$SENTINEL_DIR/grok.invoked" ] \
    && [ ! -e "$SENTINEL_DIR/agy.invoked" ] \
    && [ ! -e "$SENTINEL_DIR/qoderclicn.invoked" ]
}

run_guard_case() {
  # run_guard_case <branch-suffix> <model>  — runs with the POISONED PATH (every
  # rail binary, including cursor-agent, is a recording stub). Use this for
  # every case that MUST refuse without dispatching anywhere.
  local suffix="$1" model="$2"
  ( cd "$SBX" && PATH="$POISON_PATH" \
    AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
    "$SCRIPT" --branch "t-cursor-guard-$suffix" --prompt-file "$PROMPT" \
    --runner auto --model "$model" 2>&1 )
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
# gpt-shaped id, only the ones the table actually enables. Deliberately run
# WITHOUT the poison stubs (plain PATH, codex genuinely absent) — same
# convention as dispatch-hetero.test.sh's existing codex/qoder auto-routing
# cases — so this is excluded from the process-level oracle above: routing to
# codex here is the CORRECT, expected behavior, not a guard violation.
# ---------------------------------------------------------------------------
if cursor_is_enabled_id "gpt-5.2"; then
  fail "test fixture invalid: gpt-5.2 must NOT be in cursor_enabled_ids"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
OUT="$(cd "$SBX" && PATH=/usr/bin:/bin AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
  "$SCRIPT" --branch t-cursor-guard-non-over-capture --prompt-file "$PROMPT" \
  --runner auto --model gpt-5.2 2>&1)"; EXIT=$?
printf '%s\n' "$OUT" >> "$FULL_LOG"
assert_eq "2" "$EXIT" "auto + gpt-5.2 → exit 2 (codex precondition, not the cursor guard)"
assert_contains "$OUT" "codex binary not found" "gpt-5.2 routes to codex (not swallowed by the cursor guard)"
assert_not_contains "$OUT" "auto-routing refuses" "gpt-5.2 does not trip the cursor guard at all"

# ---------------------------------------------------------------------------
# 4. `--runner auto` NEVER selects cursor: no case above ever produced
# "runner": "cursor" in its stdout. (implicit: every guard case exits 2 via
# die_precondition before emit() runs, so no "runner" field is ever produced
# at all under a guard refusal — the strongest form of "never selects".
# Spot-check literal absence across the full accumulated log anyway.)
# ---------------------------------------------------------------------------
assert_not_contains "$(cat "$FULL_LOG")" '"runner": "cursor"' \
  "--runner auto never produces runner: cursor across every guard case"

# ---------------------------------------------------------------------------
# 5. Re-affirm the process-level oracle after the non-over-capture case: the
# codex sentinel from 3b is EXPECTED to exist now (that run legitimately used
# a plain PATH, not the poison one — no cursor-agent/grok/agy/qoderclicn
# sentinel should exist regardless, since nothing in this suite ever selects
# those rails for gpt-5.2 either).
# ---------------------------------------------------------------------------
if no_cursor_rail_sentinels_tripped; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "process-level oracle: a non-codex rail binary was invoked unexpectedly: $(ls "$SENTINEL_DIR" 2>/dev/null | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 6. cursor rejected in an EXPLICIT reviewer-class-shaped call too: not
# applicable to dispatch-hetero.sh (implementer-only dispatcher, no
# reviewer-class role concept) — covered instead by Phase 3's
# dispatch-review.sh / dispatch-author.sh allowlist tests per the plan's
# admission matrix. Left as a documented boundary, not a gap: this suite is
# scoped to base-dispatch auto-routing only (§3a / Phase 2 acceptance).
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 7. Negative: --cursor-fast with a non-cursor runner → die_precondition.
# ---------------------------------------------------------------------------
OUT="$(cd "$SBX" && PATH="$POISON_PATH" AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
  "$SCRIPT" --branch t-cursor-fast-wrong-runner --prompt-file "$PROMPT" \
  --runner grok --model grok-4.5 --cursor-fast 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "--cursor-fast with --runner grok → exit 2"
assert_contains "$OUT" "--cursor-fast applies only to --runner cursor" \
  "--cursor-fast + non-cursor runner die_precondition message"

# ---------------------------------------------------------------------------
# 8. Negative: --cursor-fast together with a full-id --model → die_precondition
# (the mapper is bypassed on that path, so the flag would otherwise no-op).
# ---------------------------------------------------------------------------
OUT="$(cd "$SBX" && PATH="$POISON_PATH" AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
  "$SCRIPT" --branch t-cursor-fast-full-id --prompt-file "$PROMPT" \
  --runner cursor --model cursor-grok-4.6-high --cursor-fast 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "--cursor-fast with a full-id --model → exit 2"
assert_contains "$OUT" "--cursor-fast applies only when --model names a family alias" \
  "--cursor-fast + full-id die_precondition message"

# Sentinel check must still hold after the two negative-control cases above
# (codex.invoked is tolerated — it is the expected residue of case 3b).
if no_cursor_rail_sentinels_tripped; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "process-level oracle (post --cursor-fast negatives): a rail binary was invoked: $(ls "$SENTINEL_DIR" 2>/dev/null | tr '\n' ' ')"
fi

finalize_test
