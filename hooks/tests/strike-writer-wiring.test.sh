#!/usr/bin/env bash
# hooks/tests/strike-writer-wiring.test.sh
#
# Proves scripts/dispatch-hetero.sh's classify_outcome() actually CALLS the
# seat-scoped no-confidence strike writer (seat_strike_capture / writer id
# `dispatch_hetero_failclosed`, references/strike-decay.md) — not merely that
# the function is defined. Per references/evidence-discipline.md §1: "a
# module with no caller is indistinguishable from a module never written, and
# its own unit tests pass in both cases. Only an end-to-end run separates
# them."
#
# Test strategy (documented, not silently substituted):
#   - Tests 1, 2, 7 drive the REAL scripts/dispatch-hetero.sh CLI end-to-end
#     against a stub `agy`, exactly like hooks/tests/dispatch-hetero.test.sh.
#     Test 2 is the mandatory delete-the-wiring negative control.
#   - Tests 3-6, 8, 10 extract the REAL `_hetero_runner_token` /
#     `seat_strike_capture` function bodies verbatim out of the shipped
#     scripts/dispatch-hetero.sh (via sed range, not a reimplementation) and
#     invoke seat_strike_capture directly with the OUTCOME_* env vars
#     classify_outcome would have set, isolated per scenario. This is the
#     same code, just without paying full worktree/agy-stub scaffolding cost
#     per branch — legitimate because tests 1 and 2 already prove the CALL
#     SITE inside classify_outcome is real and load-bearing.
#   - Test 9 snapshots the REAL ~/.autopilot/engine-capability/strikes.jsonl
#     before/after the whole suite and asserts it never changed.

set -uo pipefail
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_STRIKE_WRITER 2>/dev/null || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/dispatch-hetero.sh"
PASS=0; FAIL=0
TESTDIR="$(mktemp -d)"
export ENGINE_CAPABILITY_DIR="$TESTDIR"
SBX="$(mktemp -d)"
PROMPT="$(mktemp)"
trap 'chmod -R u+rwx "$TESTDIR" 2>/dev/null || true; rm -rf "$TESTDIR" "$SBX" "$PROMPT"' EXIT

ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

strike_count() {
  local f="$1"
  node -e '
    const fs = require("fs");
    const f = process.argv[1];
    if (!fs.existsSync(f)) { process.stdout.write("0"); process.exit(0); }
    const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
    process.stdout.write(String(lines.length));
  ' "$f"
}
strike_field() { # file field [line_index_from_end, default last]
  local f="$1" field="$2" idx="${3:-1}"
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    const row = JSON.parse(lines[lines.length - Number(process.argv[3])]);
    process.stdout.write(String(row[process.argv[2]]));
  ' "$f" "$field" "$idx"
}

# ---------------------------------------------------------------------------
# 9a. Snapshot the REAL store BEFORE anything runs (landing assertion, §9).
# ---------------------------------------------------------------------------
REAL_STRIKES="$HOME/.autopilot/engine-capability/strikes.jsonl"
REAL_BEFORE_EXISTS=0; REAL_BEFORE_SIZE=0
if [ -f "$REAL_STRIKES" ]; then
  REAL_BEFORE_EXISTS=1
  REAL_BEFORE_SIZE="$(wc -c < "$REAL_STRIKES" | tr -d ' ')"
fi

# ---------------------------------------------------------------------------
# Sandbox git repo + agy stub builder (mirrors hooks/tests/dispatch-hetero.test.sh)
# ---------------------------------------------------------------------------
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
echo "create ok.txt" > "$PROMPT"

# D2 capability-claim precondition resolves its receipt relative to the running
# script's OWN SELF_DIR (scripts/../docs/...). Test 2 below runs a copy of the
# whole scripts/ tree from a different parent directory (so the copy's own
# lib/*.sh siblings still resolve) — pin the receipt to the real repo's file
# explicitly so that copy doesn't fail this unrelated precondition before ever
# reaching classify_outcome.
export AUTOPILOT_PLATFORM_CAPABILITY_RECEIPT="$ROOT/docs/projects/_archive/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json"

make_agy_stub_versioned() {
  local stub="$1"
  local implementation="${stub}.agy-implementation"
  mv "$stub" "$implementation"
  cat > "$stub" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf '1.1.10\n'
  exit 0
fi
exec "${0}.agy-implementation" "$@"
STUB
  chmod +x "$stub"
}

# Fail-closed stub: commits cleanly, then exits non-zero → OUTCOME_STATUS=failure
# (post-dispatcher_called fail-closed; cause_class maps to "ambiguous").
STUB_FAIL="$(mktemp)"
cat > "$STUB_FAIL" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: committed then errored"
exit 3
EOF
chmod +x "$STUB_FAIL"
make_agy_stub_versioned "$STUB_FAIL"

# =========================================================================
# 1. End-to-end: real fail-closed dispatch lands a strike row.
# =========================================================================
E2E1_DIR="$TESTDIR/e2e-1"
mkdir -p "$E2E1_DIR"
OUT1="$(cd "$SBX" && "$SCRIPT" --branch feat/strike-e2e-1 --prompt-file "$PROMPT" \
  --agy-bin "$STUB_FAIL" --model "strike-engine-1" --runner agy --store "$E2E1_DIR" 2>&1)"
EXIT1=$?
WT1="$(printf '%s' "$OUT1" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
[ "$EXIT1" = "1" ] && ok "1: dispatch exit code is 1 (failure)" || bad "1: dispatch exit code is 1 (failure), got $EXIT1"
[ -n "$(printf '%s' "$OUT1" | grep -o '"status": "failure"')" ] && ok "1: status is failure" || bad "1: status is failure"

STRIKES1="$E2E1_DIR/strikes.jsonl"
if [ -f "$STRIKES1" ]; then
  ok "1: strikes.jsonl created under the isolated store"
  [ "$(strike_count "$STRIKES1")" = "1" ] && ok "1: exactly one strike row" || bad "1: exactly one strike row (got $(strike_count "$STRIKES1"))"
  [ "$(strike_field "$STRIKES1" writer)" = "dispatch_hetero_failclosed" ] && ok "1: writer=dispatch_hetero_failclosed" || bad "1: writer field wrong: $(strike_field "$STRIKES1" writer)"
  [ "$(strike_field "$STRIKES1" engine)" = "strike-engine-1" ] && ok "1: engine field" || bad "1: engine field wrong: $(strike_field "$STRIKES1" engine)"
  [ "$(strike_field "$STRIKES1" runner)" = "agy" ] && ok "1: runner field" || bad "1: runner field wrong: $(strike_field "$STRIKES1" runner)"
  [ "$(strike_field "$STRIKES1" role)" = "implementer" ] && ok "1: role field" || bad "1: role field wrong: $(strike_field "$STRIKES1" role)"
  [ "$(strike_field "$STRIKES1" class)" = "ordinary_strike" ] && ok "1: class=ordinary_strike" || bad "1: class field wrong: $(strike_field "$STRIKES1" class)"
  SHA1="$(strike_field "$STRIKES1" artifact_sha256)"
  printf '%s' "$SHA1" | grep -qE '^[0-9a-f]{64}$' && ok "1: artifact_sha256 is a real 64-hex digest" || bad "1: artifact_sha256 malformed: $SHA1"
  RECEIPT1="$(strike_field "$STRIKES1" receipt_ref)"
  [ -n "$RECEIPT1" ] && [ "$RECEIPT1" != "undefined" ] && ok "1: receipt_ref non-empty" || bad "1: receipt_ref empty/missing"
else
  bad "1: strikes.jsonl created under the isolated store"
  bad "1: exactly one strike row"
  bad "1: writer field"
  bad "1: engine field"
  bad "1: runner field"
  bad "1: role field"
  bad "1: class=ordinary_strike"
  bad "1: artifact_sha256 is a real 64-hex digest"
  bad "1: receipt_ref non-empty"
fi
[ -n "$WT1" ] && git -C "$SBX" worktree remove --force "$WT1" >/dev/null 2>&1 || true

# =========================================================================
# 2. THE DELETE-THE-WIRING NEGATIVE CONTROL (mandatory).
#    Copy dispatch-hetero.sh, mechanically remove the seat_strike_capture
#    CALL (not the function) from classify_outcome, run the SAME scenario,
#    assert no strike lands. Then re-run the unmodified script and assert
#    one DOES land.
# =========================================================================
# dispatch-hetero.sh is not self-contained: it resolves scripts/lib/*.sh
# siblings AND repo-relative paths (../src/engine/work-order.js,
# ../docs/projects/_archive/.../platform-capabilities.json) off its OWN
# SELF_DIR. A copy dropped in an unrelated tmp dir cannot see any of that
# and dies on an unrelated precondition before ever reaching
# classify_outcome — which would make this negative control vacuous (it
# must fail on the ACTUAL removed call, not on a missing-sibling error).
# So the mutated copy is placed IN PLACE as a scratch sibling of the real
# script (dotfile-prefixed, git-ignorable, always removed by the trap below
# even on failure) — this is the ONLY way its own relative resolution
# matches production. It is never left behind: STRICT FILE OWNERSHIP still
# holds for what this session leaves in the working tree.
UNWIRED_SCRIPT="$ROOT/scripts/.strike-writer-wiring-unwired-test.sh"
rm -f "$UNWIRED_SCRIPT"
trap 'rm -f "$UNWIRED_SCRIPT"; chmod -R u+rwx "$TESTDIR" 2>/dev/null || true; rm -rf "$TESTDIR" "$SBX" "$PROMPT"' EXIT
cp "$SCRIPT" "$UNWIRED_SCRIPT"
chmod +x "$UNWIRED_SCRIPT"
# The call site is a single standalone line "  seat_strike_capture" right
# before classify_outcome's closing brace — NOT the function definition line
# "seat_strike_capture() {". Verify uniqueness before mutating, so this test
# fails loudly instead of silently no-op'ing if the call site's shape ever
# changes.
CALL_SITE_COUNT="$(grep -c '^  seat_strike_capture$' "$SCRIPT")"
if [ "$CALL_SITE_COUNT" = "1" ]; then
  ok "2: exactly one seat_strike_capture call site found to remove"
else
  bad "2: expected exactly one '  seat_strike_capture' call line, found $CALL_SITE_COUNT — negative control cannot proceed reliably"
fi
sed -i '/^  seat_strike_capture$/d' "$UNWIRED_SCRIPT"
if grep -q '^  seat_strike_capture$' "$UNWIRED_SCRIPT"; then
  bad "2: call site still present in the mutated copy (sed removal failed)"
else
  ok "2: call site removed from the mutated copy (function definition left intact)"
fi
grep -q '^seat_strike_capture() {' "$UNWIRED_SCRIPT" && ok "2: seat_strike_capture FUNCTION definition still present (only the call was cut)" \
  || bad "2: function definition was accidentally removed too — negative control invalid"

E2E2_UNWIRED_DIR="$TESTDIR/e2e-2-unwired"
E2E2_WIRED_DIR="$TESTDIR/e2e-2-wired"
mkdir -p "$E2E2_UNWIRED_DIR" "$E2E2_WIRED_DIR"

echo "=== delete-the-wiring negative control: UNWIRED copy run ==="
OUT2_UNWIRED="$(cd "$SBX" && "$UNWIRED_SCRIPT" --branch feat/strike-e2e-2-unwired --prompt-file "$PROMPT" \
  --agy-bin "$STUB_FAIL" --model "strike-engine-1" --runner agy --store "$E2E2_UNWIRED_DIR" 2>&1)"
EXIT2_UNWIRED=$?
echo "$OUT2_UNWIRED"
echo "exit=$EXIT2_UNWIRED"
WT2U="$(printf '%s' "$OUT2_UNWIRED" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
[ -n "$WT2U" ] && git -C "$SBX" worktree remove --force "$WT2U" >/dev/null 2>&1 || true

echo "=== delete-the-wiring negative control: WIRED (unmodified) run ==="
OUT2_WIRED="$(cd "$SBX" && "$SCRIPT" --branch feat/strike-e2e-2-wired --prompt-file "$PROMPT" \
  --agy-bin "$STUB_FAIL" --model "strike-engine-1" --runner agy --store "$E2E2_WIRED_DIR" 2>&1)"
EXIT2_WIRED=$?
echo "$OUT2_WIRED"
echo "exit=$EXIT2_WIRED"
WT2W="$(printf '%s' "$OUT2_WIRED" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
[ -n "$WT2W" ] && git -C "$SBX" worktree remove --force "$WT2W" >/dev/null 2>&1 || true

[ "$EXIT2_UNWIRED" = "1" ] && ok "2: unwired run still classifies as failure/exit 1 (only the strike write is cut)" \
  || bad "2: unwired run exit code changed ($EXIT2_UNWIRED) — mutation touched more than the call site"
if [ -f "$E2E2_UNWIRED_DIR/strikes.jsonl" ]; then
  bad "2: strike row LANDED with the wiring removed — negative control failed to detect the removal"
else
  ok "2: NO strike row with the wiring removed (deleting the call turns this red, as required)"
fi
if [ -f "$E2E2_WIRED_DIR/strikes.jsonl" ] && [ "$(strike_count "$E2E2_WIRED_DIR/strikes.jsonl")" = "1" ]; then
  ok "2: exactly one strike row with the unmodified (wired) script"
else
  bad "2: expected exactly one strike row with the unmodified script"
fi

# =========================================================================
# Extracted-function harness for tests 3-6, 8, 10 (see header comment).
# =========================================================================
FN_FRAGMENT="$TESTDIR/strike-fns.sh"
{
  sed -n '/^_hetero_runner_token() {/,/^}/p' "$SCRIPT"
  echo
  sed -n '/^STRIKE_DETECTOR_VERSION=/p' "$SCRIPT"
  echo
  sed -n '/^seat_strike_capture() {/,/^}/p' "$SCRIPT"
} > "$FN_FRAGMENT"
FRAGMENT_LINES="$(wc -l < "$FN_FRAGMENT" | tr -d ' ')"
if [ "$FRAGMENT_LINES" -ge 20 ] && grep -q 'seat_strike_capture' "$FN_FRAGMENT" && grep -q '_hetero_runner_token' "$FN_FRAGMENT"; then
  ok "setup: extracted the real seat_strike_capture/_hetero_runner_token bodies ($FRAGMENT_LINES lines)"
else
  bad "setup: function extraction from dispatch-hetero.sh looks empty/wrong ($FRAGMENT_LINES lines) — unit-style tests below are not trustworthy"
fi
# shellcheck disable=SC1090
. "$FN_FRAGMENT"

SELF_DIR="$ROOT/scripts"

# run_scenario STORE_DIR OUTCOME_STATUS DISPATCHER_CALLED RUN_ID [STRIKE_WRITER_ENV]
run_scenario() {
  local store="$1" status="$2" dcalled="$3" run_id="$4" writer_env="${5:-on}"
  mkdir -p "$store"
  local logf="$store/agent.log"
  printf 'fixture agent log for scenario %s (status=%s)\n' "$run_id" "$status" > "$logf"
  (
    SELF_DIR="$ROOT/scripts"
    MODEL="strike-engine-1"
    IS_CODEX=0; IS_GROK=0; IS_CCSHIM=0; IS_PI=0; IS_QODER=0
    OUTCOME_STATUS="$status"
    OUTCOME_DISPATCHER_CALLED="$dcalled"
    OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT=""; OUTCOME_ERR="unit-test scenario"
    LOG="$logf"
    DISPATCH_RUN_ID="$run_id"
    BASE_SHA="0000000000000000000000000000000000base"
    HEAD_SHA="1111111111111111111111111111111111head"
    ENGINE_CAPABILITY_DIR="$store"
    AUTOPILOT_STRIKE_WRITER="$writer_env"
    seat_strike_capture
  )
}

# --- 3. Exclusion: engine_unavailable-shaped outcome appends NO strike. ---
D3="$TESTDIR/unit-3-engine-unavailable"
run_scenario "$D3" "engine_unavailable" 1 "run-3"
if [ -f "$D3/strikes.jsonl" ]; then
  bad "3: engine_unavailable appended a strike (must be excluded — external cause enum)"
else
  ok "3: engine_unavailable appends NO strike"
fi

# --- 4. Pre-dispatch abort: OUTCOME_DISPATCHER_CALLED=0 appends NO strike. ---
D4="$TESTDIR/unit-4-predispatch-abort"
# status is deliberately "failure" (which WOULD strike) to prove the
# dispatcher_called=0 guard is checked independently of OUTCOME_STATUS.
run_scenario "$D4" "failure" 0 "run-4"
if [ -f "$D4/strikes.jsonl" ]; then
  bad "4: dispatcher_called=0 appended a strike (nothing was routed — must be excluded)"
else
  ok "4: OUTCOME_DISPATCHER_CALLED=0 appends NO strike (pre-dispatch host abort)"
fi

# --- 5. Success appends nothing. ---
D5="$TESTDIR/unit-5-success"
run_scenario "$D5" "committed" 1 "run-5"
if [ -f "$D5/strikes.jsonl" ]; then
  bad "5: a successful (committed) outcome appended a strike"
else
  ok "5: success (committed) appends nothing"
fi
D5B="$TESTDIR/unit-5b-noop"
run_scenario "$D5B" "no_op" 1 "run-5b"
[ -f "$D5B/strikes.jsonl" ] && bad "5b: no_op appended a strike" || ok "5b: no_op appends nothing"
D5C="$TESTDIR/unit-5c-question"
run_scenario "$D5C" "question_suspected" 1 "run-5c"
[ -f "$D5C/strikes.jsonl" ] && bad "5c: question_suspected appended a strike" || ok "5c: question_suspected appends nothing"

# --- 6. Dedup: same root incident twice ⇒ exactly ONE line. ---
D6="$TESTDIR/unit-6-dedup"
run_scenario "$D6" "failure" 1 "run-6-same-incident"
run_scenario "$D6" "failure" 1 "run-6-same-incident"
if [ -f "$D6/strikes.jsonl" ]; then
  [ "$(strike_count "$D6/strikes.jsonl")" = "1" ] && ok "6: two appends of the same root incident dedup to exactly one line" \
    || bad "6: expected exactly one line after dedup, got $(strike_count "$D6/strikes.jsonl")"
else
  bad "6: dedup scenario produced no strike row at all (expected exactly one)"
fi
# Distinct incident (different DISPATCH_RUN_ID) must NOT collide with the above.
run_scenario "$D6" "failure" 1 "run-6-different-incident"
[ -f "$D6/strikes.jsonl" ] && [ "$(strike_count "$D6/strikes.jsonl")" = "2" ] \
  && ok "6b: a genuinely different root incident is NOT collapsed by dedup" \
  || bad "6b: expected 2 rows after a distinct incident, got $(strike_count "$D6/strikes.jsonl" 2>/dev/null || echo missing)"

# --- 8. Escape hatch: AUTOPILOT_STRIKE_WRITER=off appends nothing. ---
D8="$TESTDIR/unit-8-escape-hatch"
run_scenario "$D8" "failure" 1 "run-8" "off"
if [ -f "$D8/strikes.jsonl" ]; then
  bad "8: AUTOPILOT_STRIKE_WRITER=off still wrote a strike"
else
  ok "8: AUTOPILOT_STRIKE_WRITER=off appends nothing (operator escape hatch)"
fi
# Sanity: the SAME scenario with the escape hatch off (default 'on') DOES strike,
# proving 8's absence is the flag, not a broken scenario.
D8B="$TESTDIR/unit-8b-control"
run_scenario "$D8B" "failure" 1 "run-8b" "on"
[ -f "$D8B/strikes.jsonl" ] && ok "8b: control (writer=on) appends a strike, confirming 8 is the flag's effect" \
  || bad "8b: control (writer=on) unexpectedly appended nothing"

# --- 10. Replay fixture: agy envelope corruption (2026-08) ⇒ ordinary_strike,
#     cause_class runner_delivery, and it STILL ACCRUES (not excluded). ---
D10="$TESTDIR/unit-10-envelope-corruption"
run_scenario "$D10" "no_verdict" 1 "run-10-envelope-corruption"
if [ -f "$D10/strikes.jsonl" ]; then
  ok "10: envelope-corruption-shaped outcome (no_verdict) DOES accrue a strike"
  [ "$(strike_field "$D10/strikes.jsonl" cause_class)" = "runner_delivery" ] \
    && ok "10: cause_class is runner_delivery (diagnostic, not exclusionary)" \
    || bad "10: cause_class wrong: $(strike_field "$D10/strikes.jsonl" cause_class)"
  [ "$(strike_field "$D10/strikes.jsonl" class)" = "ordinary_strike" ] \
    && ok "10: class is ordinary_strike (dispatch-hetero never emits critical_reexam_trigger)" \
    || bad "10: class wrong: $(strike_field "$D10/strikes.jsonl" class)"
else
  bad "10: envelope-corruption-shaped outcome (no_verdict) did not accrue a strike"
  bad "10: cause_class is runner_delivery"
  bad "10: class is ordinary_strike"
fi

# =========================================================================
# 7. Fail-soft: unwritable store never changes exit code or stdout.
# =========================================================================
E7_WRITABLE_DIR="$TESTDIR/e2e-7-writable"
E7_UNWRITABLE_DIR="$TESTDIR/e2e-7-unwritable"
mkdir -p "$E7_WRITABLE_DIR" "$E7_UNWRITABLE_DIR"

OUT7_WRITABLE="$(cd "$SBX" && "$SCRIPT" --branch feat/strike-e2e-7-writable --prompt-file "$PROMPT" \
  --agy-bin "$STUB_FAIL" --model "strike-engine-1" --runner agy --store "$E7_WRITABLE_DIR" \
  --run-id strike-e2e-7-fixed-run-id 2>/dev/null)"
EXIT7_WRITABLE=$?
WT7W="$(printf '%s' "$OUT7_WRITABLE" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
[ -n "$WT7W" ] && git -C "$SBX" worktree remove --force "$WT7W" >/dev/null 2>&1 || true

chmod 000 "$E7_UNWRITABLE_DIR"
OUT7_UNWRITABLE="$(cd "$SBX" && "$SCRIPT" --branch feat/strike-e2e-7-unwritable --prompt-file "$PROMPT" \
  --agy-bin "$STUB_FAIL" --model "strike-engine-1" --runner agy --store "$E7_UNWRITABLE_DIR" \
  --run-id strike-e2e-7-fixed-run-id 2>/dev/null)"
EXIT7_UNWRITABLE=$?
chmod 700 "$E7_UNWRITABLE_DIR"
WT7U="$(printf '%s' "$OUT7_UNWRITABLE" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
[ -n "$WT7U" ] && git -C "$SBX" worktree remove --force "$WT7U" >/dev/null 2>&1 || true

[ "$EXIT7_WRITABLE" = "$EXIT7_UNWRITABLE" ] && ok "7: exit code identical, writable vs unwritable store ($EXIT7_WRITABLE)" \
  || bad "7: exit code differs — writable=$EXIT7_WRITABLE unwritable=$EXIT7_UNWRITABLE"

# Normalize the fields that are inherently per-run (mktemp log path, worktree
# path, branch name — two different branch names were used deliberately so
# reusing one branch's leftover worktree/failure state can't contaminate the
# other run — the fresh commit sha each run produces, and wall-clock
# seconds). Everything else must match exactly.
normalize() {
  sed -E \
    -e 's#"agent_log": "[^"]*"#"agent_log": "<LOG>"#' \
    -e 's#"worktree": "[^"]*"#"worktree": "<WT>"#' \
    -e 's#"branch": "[^"]*"#"branch": "<BRANCH>"#' \
    -e 's#"commit": "[^"]*"#"commit": "<COMMIT>"#' \
    -e 's#"wall_secs": [0-9]+#"wall_secs": <N>#'
}
NORM7_WRITABLE="$(printf '%s' "$OUT7_WRITABLE" | normalize)"
NORM7_UNWRITABLE="$(printf '%s' "$OUT7_UNWRITABLE" | normalize)"
if [ "$NORM7_WRITABLE" = "$NORM7_UNWRITABLE" ]; then
  ok "7: stdout byte-identical after normalizing only the inherently per-run mktemp/branch/wall_secs fields"
else
  bad "7: stdout diverged beyond the normalized per-run fields"
  echo "  writable:   $NORM7_WRITABLE"
  echo "  unwritable: $NORM7_UNWRITABLE"
fi

[ -f "$E7_WRITABLE_DIR/strikes.jsonl" ] && ok "7: strike landed in the writable store" \
  || bad "7: expected a strike in the writable store"
if [ -f "$E7_UNWRITABLE_DIR/strikes.jsonl" ]; then
  bad "7: a strike row landed despite the unwritable store (should have failed soft with nothing written)"
else
  ok "7: no strike row under the unwritable store — write failed soft, dispatch outcome unaffected"
fi

# =========================================================================
# 9b. Landing assertion: the REAL ~/.autopilot/engine-capability/strikes.jsonl
#     was NOT created or grown by anything in this suite.
# =========================================================================
REAL_AFTER_EXISTS=0; REAL_AFTER_SIZE=0
if [ -f "$REAL_STRIKES" ]; then
  REAL_AFTER_EXISTS=1
  REAL_AFTER_SIZE="$(wc -c < "$REAL_STRIKES" | tr -d ' ')"
fi
if [ "$REAL_BEFORE_EXISTS" = "$REAL_AFTER_EXISTS" ] && [ "$REAL_BEFORE_SIZE" = "$REAL_AFTER_SIZE" ]; then
  ok "9: real ~/.autopilot/engine-capability/strikes.jsonl untouched (exists=$REAL_AFTER_EXISTS size=$REAL_AFTER_SIZE)"
else
  bad "9: real ~/.autopilot/engine-capability/strikes.jsonl CHANGED — before(exists=$REAL_BEFORE_EXISTS,size=$REAL_BEFORE_SIZE) after(exists=$REAL_AFTER_EXISTS,size=$REAL_AFTER_SIZE)"
fi

# =========================================================================
printf '\n%s: %d passed, %d failed\n' "strike-writer-wiring" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
