#!/usr/bin/env bash
# NOTE: keep this file name short: TEST_TMP is derived from it and the per-case Unix socket path under it has a 108-byte limit (a long name makes every case a transport failure).
# The fake provider only counts its calls and fails them, so each exam that is allowed to start stops at its first case.
# BL-0166, PM ruling 2026-11-08: the --effort label is checked against the effort the provider is told to send
# BEFORE any provider call. mismatch -> rc=2 and the fake provider is never invoked (call-count file);
# --allow-effort-mismatch -> runs, row carries effort_check=mismatch + effort_check_override=true; match -> runs.
# Each case has a negative control: a sed_mutant of engine-qualify.js that must turn that case red.
. "$(dirname "$0")/lib.sh"
SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"
. "$(dirname "$0")/lib/engine-qualify-setup.sh"

ADAPTER="$TEST_TMP/effort-gate-adapter.js"
cat >"$ADAPTER" <<'NODE'
'use strict';
const fs = require('fs');
fs.appendFileSync(process.env.QUAL_COUNT_FILE, 'call\n');
process.exit(1);   // count the call, then fail it: the exam stops at its first case (cheap, load-independent)
NODE
export QUAL_FAKE_NODE="$NODE_BIN" QUAL_FAKE_PANEL="$PANEL" QUAL_FAKE_PROVIDER="fake-review-provider" QUAL_FAKE_MODEL="eng-review-exact"
PCMD="$(printf '%q ' "$NODE_BIN" "$ADAPTER")"
COUNT="$TEST_TMP/effort-gate-count"

# run <engine-qualify entry> <label> [extra flags...]  (the wire effort is unlisted, QRP_MODEL puts the provider "in play": label high -> sent default = mismatch, label default = match)  -> sets OUT RC ERR NCALLS
run() {
  local entry="$1" label="$2"; shift 2
  : >"$COUNT"; RAWN=$((${RAWN:-0}+1)); mkdir -p "$TEST_TMP/raw-$RAWN"; ERR="$TEST_TMP/effort-gate.err"
  OUT="$(QUAL_COUNT_FILE="$COUNT" QRP_MODEL=fake-model $entry "${QUALIFY_REMOTE_ARGS[@]}" --effort "$label" \
    --remote-provider-cmd "$PCMD" --remote-provider "$QUAL_FAKE_PROVIDER" \
    --provider-env QUAL_FAKE_NODE --provider-env QUAL_FAKE_PANEL --provider-env QUAL_FAKE_PROVIDER \
    --provider-env QUAL_FAKE_MODEL --provider-env QUAL_COUNT_FILE --provider-env QRP_MODEL --raw-dir "$TEST_TMP/raw-$RAWN" \
    "$@" --emit-row 2>"$ERR")"
  RC=$?
  NCALLS="$(wc -l <"$COUNT" | tr -d ' ')"
}

# --- (1) mismatch: refused before any provider call
run "$SCRIPT" high
assert_exit_code "$RC" "2" "mismatch: rc=2"
assert_eq "0" "$NCALLS" "mismatch: the fake provider was never called"
assert_contains "$(cat "$ERR")" "does not match the effort sent" "mismatch: stderr names the reason"
# --- (2) mismatch + override: runs and is recorded
run "$SCRIPT" high --allow-effort-mismatch
[ "$NCALLS" -gt 0 ]; assert_eq "0" "$?" "override: the fake provider was called"
assert_contains "$OUT" '"effort_check_override":true' "override: row carries effort_check_override=true"
assert_contains "$OUT" '"status":"mismatch"' "override: row keeps effort_check=mismatch"
# --- (3) match: normal run, no override field
run "$SCRIPT" default
[ "$NCALLS" -gt 0 ]; assert_eq "0" "$?" "match: the fake provider was called"
assert_not_contains "$OUT" "effort_check_override" "match: no override field"

# --- negative controls (mutants live in scripts/ so their relative requires resolve; moved out afterwards)
MUT="$REPO_ROOT/scripts/engine-qualify-effortgate-mutant.js"
mutate() { sed_mutant "$REPO_ROOT/scripts/engine-qualify.js" "$MUT" "$1"; }
retire() { mv -f "$MUT" "$TEST_TMP/mutant-retired.js"; }
# M1: the gate never refuses -> case (1) must go red (provider called)
if mutate "s/if (!options.allowEffortMismatch) {/if (false) {/"; then
  run "node $MUT" high
  retire
  [ "$NCALLS" -gt 0 ] && [ "$RC" != 2 ]; assert_eq "0" "$?" "negative control M1: without the refusal a mismatch reaches the provider"
fi
# M2: the override is not recorded -> case (2) must go red
if mutate "s/if (effortOverride \&\& /if (false \&\& /"; then
  run "node $MUT" high --allow-effort-mismatch
  retire
  case "$OUT" in *effort_check_override*) assert_eq "red" "green" "negative control M2: override field still present";; *) assert_eq "ok" "ok" "negative control M2: override field missing is detectable";; esac
fi
# M3: the gate also refuses a match -> case (3) must go red
if mutate "s/if (effortCheck.status === 'mismatch') {\$/if (effortCheck.status !== 'unverifiable') {/"; then
  run "node $MUT" default
  retire
  [ "$RC" = 2 ] && [ "$NCALLS" = 0 ]; assert_eq "0" "$?" "negative control M3: refusing a match is detectable (rc=2, no call)"
fi
finalize_test
