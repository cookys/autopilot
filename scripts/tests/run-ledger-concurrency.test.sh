#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$SCRIPT_ROOT/scripts/run-ledger.sh"
TEST_TMP="$(mktemp -d -t "run-ledger-concurrency-test-XXXXXX")"

trap 'rm -rf "$TEST_TMP"' EXIT

PASS_COUNT=0
FAILS=()
CMD_RC=0
CMD_OUT=""
CMD_ERR=""
TEST_NAME="run-ledger-concurrency"

assert_eq() {
  local got="$1"
  local expect="$2"
  local msg="$3"
  if [ "$got" = "$expect" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAILS+=("$msg: expected '$expect', got '$got'")
  fi
}

assert_ne() {
  local got="$1"
  local bad="$2"
  local msg="$3"
  if [ "$got" != "$bad" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAILS+=("$msg: expected not '$bad'")
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAILS+=("$msg: missing '$needle'")
  fi
}

assert_json_eq() {
  local payload="$1"
  local jq_path="$2"
  local expect="$3"
  local msg="$4"
  local got
  got="$(jq -r "$jq_path" <<<"$payload")"
  if [ "$got" = "$expect" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAILS+=("$msg: $jq_path expected '$expect', got '$got'")
  fi
}

assert_cmd_rc() {
  assert_eq "$CMD_RC" "$1" "$2"
}

assert_eq "$(grep -c '^atomic_append_ledger() {' "$SCRIPT")" "1" "single atomic_append_ledger definition exists in script"
assert_eq "$(grep -c '^atomic_write_temp() {' "$SCRIPT")" "1" "single atomic_write_temp definition exists in script"
assert_eq "$(grep -c '^audit_resource_contention() {' "$SCRIPT")" "1" "single audit_resource_contention definition exists in script"
assert_eq "$(grep -c '^has_applied_journal_key() {' "$SCRIPT")" "1" "single has_applied_journal_key definition exists in script"
assert_eq "$(grep -c '^latest_stage_record() {' "$SCRIPT")" "1" "single latest_stage_record definition exists in script"

run_cmd() {
  local out_file="$TEST_TMP/out.$$"
  local err_file="$TEST_TMP/err.$$"
  set +e
  bash "$SCRIPT" "$@" >"$out_file" 2>"$err_file"
  CMD_RC=$?
  set -e
  CMD_OUT="$(cat "$out_file")"
  CMD_ERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"
}

# 1. Concurrent cross-run append durability (Critical C1)
LEDGER_1="$TEST_TMP/ledger-1.jsonl"
run_cmd init --ledger "$LEDGER_1"

for i in {1..20}; do
  (
    bash "$SCRIPT" stage-acquire --ledger "$LEDGER_1" --run-id "run-$i" --stage build --pid "$$" >/dev/null 2>&1
  ) &
done
wait

COUNT="$(jq -s '[.[] | select(.kind=="stage" and .stage=="build")] | length' "$LEDGER_1")"
assert_eq "$COUNT" "20" "no lost concurrent stage-acquire rows across distinct run_ids"

VALID_JSONL_1=true
while read -r line; do
  if [ -n "$line" ] && ! jq -e . <<<"$line" >/dev/null 2>&1; then
    VALID_JSONL_1=false
  fi
done < "$LEDGER_1"
assert_eq "$VALID_JSONL_1" "true" "ledger 1 remains valid JSONL end-to-end"

# 1b. init is serialized and cannot race with append (Critical)
LEDGER_INIT_RACE="$TEST_TMP/ledger-init-race.jsonl"
INIT_RACE_ATTEMPTS=12
INIT_RACE_INITIALIZED=0
INIT_RACE_EXISTS=0

for i in $(seq 1 "$INIT_RACE_ATTEMPTS"); do
  (
    bash "$SCRIPT" init --ledger "$LEDGER_INIT_RACE" >"$TEST_TMP/init-race-$i.init.out" 2>/dev/null
  ) &
  (
    bash "$SCRIPT" stage-acquire --ledger "$LEDGER_INIT_RACE" --run-id "init-race-$i" --stage build --pid "$$" --allow-reopen >/dev/null 2>&1
  ) &
done
wait

for i in $(seq 1 "$INIT_RACE_ATTEMPTS"); do
  INIT_RACE_STATUS="$(jq -r '.status // empty' <"$TEST_TMP/init-race-$i.init.out" 2>/dev/null || echo '')"
  if [ "$INIT_RACE_STATUS" = "initialized" ]; then
    INIT_RACE_INITIALIZED=$((INIT_RACE_INITIALIZED + 1))
  elif [ "$INIT_RACE_STATUS" = "exists" ]; then
    INIT_RACE_EXISTS=$((INIT_RACE_EXISTS + 1))
  fi
done

assert_ne "$INIT_RACE_INITIALIZED" "0" "at least one init path initializes a new ledger"
assert_ne "$INIT_RACE_EXISTS" "0" "serialized init calls observe already-initialized ledger"
assert_eq "$((INIT_RACE_INITIALIZED + INIT_RACE_EXISTS))" "$INIT_RACE_ATTEMPTS" "every concurrent init returns a recognized status"

VALID_JSONL_INIT_RACE=true
while read -r line; do
  if [ -n "$line" ] && ! jq -e . <<<"$line" >/dev/null 2>&1; then
    VALID_JSONL_INIT_RACE=false
  fi
done < "$LEDGER_INIT_RACE"
assert_eq "$VALID_JSONL_INIT_RACE" "true" "ledger init race remains valid JSONL"

INIT_RACE_COUNT="$(jq -s '[.[] | select(.kind=="stage" and .stage=="build")] | length' "$LEDGER_INIT_RACE")"
assert_eq "$INIT_RACE_COUNT" "$INIT_RACE_ATTEMPTS" "no inits truncate concurrent stage-acquire writes"


# 2. Crash-ordering false-success on retry (Critical C2)
LEDGER_2="$TEST_TMP/ledger-2.jsonl"
run_cmd init --ledger "$LEDGER_2"
run_cmd stage-acquire --ledger "$LEDGER_2" --run-id r1 --stage deploy --pid "$$"
GEN_2="$(jq -r '.generation' <<<"$CMD_OUT")"
NONCE_2="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"

run_cmd journal-add --ledger "$LEDGER_2" --run-id r1 --stage deploy --generation "$GEN_2" --nonce "$NONCE_2" --idempotency-key K1 --status applied

run_cmd stage-apply --ledger "$LEDGER_2" --run-id r1 --stage deploy --generation "$GEN_2" --nonce "$NONCE_2" --to-state committed --idempotency-key K1

run_cmd query-latest --ledger "$LEDGER_2" --run-id r1 --stage deploy
assert_json_eq "$CMD_OUT" '.state' "committed" "retry after simulated crash must still advance stage to to-state, not just report already_applied"

run_cmd stage-apply --ledger "$LEDGER_2" --run-id r1 --stage deploy --generation "$GEN_2" --nonce "$NONCE_2" --to-state committed --idempotency-key K1
assert_cmd_rc 0 "second stage-apply must succeed idempotently"

run_cmd query-latest --ledger "$LEDGER_2" --run-id r1 --stage deploy
assert_json_eq "$CMD_OUT" '.state' "committed" "second stage-apply keeps committed state"


# 3. Double-apply on concurrent identical idempotency key (Major)
LEDGER_3="$TEST_TMP/ledger-3.jsonl"
run_cmd init --ledger "$LEDGER_3"
run_cmd stage-acquire --ledger "$LEDGER_3" --run-id r2 --stage payout --pid "$$"
GEN_3="$(jq -r '.generation' <<<"$CMD_OUT")"
NONCE_3="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"

for i in {1..10}; do
  (
    bash "$SCRIPT" journal-add --ledger "$LEDGER_3" --run-id r2 --stage payout --generation "$GEN_3" --nonce "$NONCE_3" --idempotency-key SAME-KEY --status applied >/dev/null 2>&1
  ) &
done
wait

COUNT_3="$(jq -s '[.[] | select(.kind=="journal" and .idempotency_key=="SAME-KEY" and .status=="applied")] | length' "$LEDGER_3")"
assert_eq "$COUNT_3" "1" "concurrent identical idempotency-key journal-add must not double-apply"


# 4. Resource-lock partial-acquire fd leak (Major)
LEDGER_4="$TEST_TMP/ledger-4.jsonl"
run_cmd init --ledger "$LEDGER_4"

bash "$SCRIPT" resource-lock --ledger "$LEDGER_4" --resource-id resB --run-id holder --stage x --hold-seconds 4 >/dev/null 2>&1 &
HOLDER_PID=$!
sleep 0.3

(
  bash "$SCRIPT" stage-acquire --ledger "$LEDGER_4" --run-id r3 --stage combo --resources "resA,resB" --timeout 1 >/dev/null 2>&1
  sleep 3
) &
LEAKER_PID=$!
sleep 1.5

set +e
timeout 1.5 bash "$SCRIPT" resource-lock --ledger "$LEDGER_4" --resource-id resA --run-id checker --stage x --timeout 1 >/dev/null 2>&1
CHECKER_RC=$?
set -e

assert_eq "$CHECKER_RC" "0" "resource-lock of resA succeeds quickly, showing no fd leak on partial acquire failure"

wait "$HOLDER_PID" 2>/dev/null || true
wait "$LEAKER_PID" 2>/dev/null || true


# 5. Ledger remains parseable and stage-transition fencing survives concurrent stale writers (Major, TOCTOU check)
LEDGER_5="$TEST_TMP/ledger-5.jsonl"
run_cmd init --ledger "$LEDGER_5"
run_cmd stage-acquire --ledger "$LEDGER_5" --run-id r4 --stage ship --pid "$$"
GEN_5_1="$(jq -r '.generation' <<<"$CMD_OUT")"
NONCE_5_1="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"

run_cmd stage-acquire --ledger "$LEDGER_5" --run-id r4 --stage ship --pid "$$" --allow-reopen
GEN_5_2="$(jq -r '.generation' <<<"$CMD_OUT")"
NONCE_5_2="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"

OUT_A="$TEST_TMP/out.a.$$"
OUT_B="$TEST_TMP/out.b.$$"

set +e
bash "$SCRIPT" stage-transition --ledger "$LEDGER_5" --run-id r4 --stage ship --generation "$GEN_5_1" --nonce "$NONCE_5_1" --to-state committed >"$OUT_A" 2>&1 &
PID_A=$!
bash "$SCRIPT" stage-transition --ledger "$LEDGER_5" --run-id r4 --stage ship --generation "$GEN_5_2" --nonce "$NONCE_5_2" --to-state committed >"$OUT_B" 2>&1 &
PID_B=$!
wait "$PID_A"
RC_A=$?
wait "$PID_B"
RC_B=$?
set -e

assert_eq "$RC_A" "11" "stale writer transition returns 11"
VAL_A="$(cat "$OUT_A")"
assert_json_eq "$VAL_A" '.state' "stale_ignored" "stale writer output shows state stale_ignored"
VAL_B="$(cat "$OUT_B")"
assert_json_eq "$VAL_B" '.state' "committed" "fresh writer output shows state committed"

VALID_JSONL_5=true
while read -r line; do
  if [ -n "$line" ] && ! jq -e . <<<"$line" >/dev/null 2>&1; then
    VALID_JSONL_5=false
  fi
done < "$LEDGER_5"
assert_eq "$VALID_JSONL_5" "true" "ledger 5 remains valid JSONL end-to-end"

rm -f "$OUT_A" "$OUT_B"

# 5b. Deterministic generation-scoped stale writer fencing (non-racy repro)
LEDGER_5B="$TEST_TMP/ledger-5b.jsonl"
run_cmd init --ledger "$LEDGER_5B"
run_cmd stage-acquire --ledger "$LEDGER_5B" --run-id r5b --stage ship --pid "$$"
GEN_5B_1="$(jq -r '.generation' <<<"$CMD_OUT")"
NONCE_5B_1="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"

run_cmd stage-acquire --ledger "$LEDGER_5B" --run-id r5b --stage ship --pid "$$" --allow-reopen
GEN_5B_2="$(jq -r '.generation' <<<"$CMD_OUT")"
NONCE_5B_2="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"

run_cmd stage-transition --ledger "$LEDGER_5B" --run-id r5b --stage ship --generation "$GEN_5B_1" --nonce "$NONCE_5B_1" --to-state committed
assert_cmd_rc 11 "sequential stale generation transition is fenced"
assert_json_eq "$CMD_OUT" '.state' "stale_ignored" "sequential stale writer output shows stale_ignored"
assert_json_eq "$CMD_OUT" '.generation' "$GEN_5B_1" "stale marker preserves caller generation"

run_cmd stage-transition --ledger "$LEDGER_5B" --run-id r5b --stage ship --generation "$GEN_5B_2" --nonce "$NONCE_5B_2" --to-state committed
assert_cmd_rc 0 "fresh generation transition succeeds"
assert_json_eq "$CMD_OUT" '.state' "committed" "fresh writer reaches target state in deterministic repro"

# 8. TOCTOU-safe transition validation: stale transition is fenced after concurrent lease bump
LEDGER_8="$TEST_TMP/ledger-8.jsonl"
run_cmd init --ledger "$LEDGER_8"

run_cmd stage-acquire --ledger "$LEDGER_8" --run-id r9 --stage ship --pid "$$" --resources race-resource
GEN8_A="$(jq -r '.generation' <<<"$CMD_OUT")"
NONCE8_A="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"

ACQ8_OUT_A="$TEST_TMP/out8-acq.a.$$"
ACQ8_OUT_B="$TEST_TMP/out8-acq.b.$$"
OUT8_A="$TEST_TMP/out8.a.$$"
OUT8_B="$TEST_TMP/out8.b.$$"

set +e
bash "$SCRIPT" stage-acquire --ledger "$LEDGER_8" --run-id r9 --stage ship --pid "$$" --allow-reopen >"$ACQ8_OUT_A" 2>&1 &
PID8_ACQ_A=$!
bash "$SCRIPT" stage-acquire --ledger "$LEDGER_8" --run-id r9 --stage ship --pid "$$" --allow-reopen >"$ACQ8_OUT_B" 2>&1 &
PID8_ACQ_B=$!

wait "$PID8_ACQ_A"
RC8_ACQ_A=$?
wait "$PID8_ACQ_B"
RC8_ACQ_B=$?
set -e

assert_eq "$RC8_ACQ_A" "0" "concurrent lease bumps for TOCTOU setup must all succeed"
assert_eq "$RC8_ACQ_B" "0" "concurrent lease bumps for TOCTOU setup must all succeed"

GEN8_B="$(jq -r '.generation' <"$ACQ8_OUT_A")"
GEN8_C="$(jq -r '.generation' <"$ACQ8_OUT_B")"
NONCE8_B="$(jq -r '.nonce // empty' <"$ACQ8_OUT_A")"
NONCE8_C="$(jq -r '.nonce // empty' <"$ACQ8_OUT_B")"

assert_ne "$GEN8_B" "$GEN8_C" "concurrent lease bumps must observe distinct generations"
if [ "$GEN8_B" -gt "$GEN8_C" ]; then
  GEN8_FRESH="$GEN8_B"
  NONCE8_FRESH="$NONCE8_B"
else
  GEN8_FRESH="$GEN8_C"
  NONCE8_FRESH="$NONCE8_C"
fi

set +e
bash "$SCRIPT" stage-transition --ledger "$LEDGER_8" --run-id r9 --stage ship --generation "$GEN8_FRESH" --nonce "$NONCE8_FRESH" --to-state committed >"$OUT8_B" 2>&1 &
PID8_B=$!
bash -c "sleep 0.05; \"$SCRIPT\" stage-transition --ledger \"$LEDGER_8\" --run-id r9 --stage ship --generation \"$GEN8_A\" --nonce \"$NONCE8_A\" --to-state committed >\"$OUT8_A\" 2>&1" &
PID8_A=$!

wait "$PID8_A"
RC8_A=$?
wait "$PID8_B"
RC8_B=$?
set -e

VALID_JSONL_8=true
while read -r line; do
  if [ -n "$line" ] && ! jq -e . <<<"$line" >/dev/null 2>&1; then
    VALID_JSONL_8=false
  fi
done < "$LEDGER_8"
assert_eq "$VALID_JSONL_8" "true" "ledger 8 remains valid JSONL during TOCTOU test"
assert_eq "$RC8_B" "0" "current transition with fresh lease succeeds"
assert_eq "$RC8_A" "11" "superseded transition is fenced with return 11"
VAL8_A="$(cat "$OUT8_A")"
VAL8_B="$(cat "$OUT8_B")"
assert_json_eq "$VAL8_A" '.state' "stale_ignored" "superseded transition writes stale_ignored state"
assert_json_eq "$VAL8_B" '.state' "committed" "fresh transition still commits"

rm -f "$OUT8_A" "$OUT8_B" "$ACQ8_OUT_A" "$ACQ8_OUT_B"

# 9. Concurrent stage-acquire must allocate distinct generations
LEDGER_9="$TEST_TMP/ledger-9.jsonl"
run_cmd init --ledger "$LEDGER_9"

for i in {1..10}; do
  (
    bash "$SCRIPT" stage-acquire --ledger "$LEDGER_9" --run-id r10 --stage ship --pid "$$" --allow-reopen >/dev/null 2>&1
  ) &
done
wait

ACQ9_TOTAL="$(jq -s --arg rid "r10" --arg stg "ship" '[.[] | select(.kind=="stage" and .run_id==$rid and .stage==$stg)] | length' "$LEDGER_9")"
ACQ9_DISTINCT="$(jq -s --arg rid "r10" --arg stg "ship" '[.[] | select(.kind=="stage" and .run_id==$rid and .stage==$stg) | .generation] | unique | length' "$LEDGER_9")"
assert_eq "$ACQ9_TOTAL" "10" "all concurrent stage-acquire calls appended"
assert_eq "$ACQ9_DISTINCT" "10" "concurrent stage-acquire calls claim distinct generations"


# 6. Self-deadlock on resource-bearing stages
L6="$TEST_TMP/ledger6.jsonl"
run_cmd init --ledger "$L6"
run_cmd stage-acquire --ledger "$L6" --run-id r6 --stage payout --pid "$$" --resources "acct-42"
GEN_6="$(jq -r '.generation' <<<"$CMD_OUT")"
NONCE_6="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"

set +e
OUT_6="$("$SCRIPT" journal-add --ledger "$L6" --run-id r6 --stage payout --generation "$GEN_6" --nonce "$NONCE_6" --idempotency-key JK1 --status applied --timeout 3 2>&1)"
RC_6=$?
set -e
assert_eq "$RC_6" "0" "journal-add on a resource-bearing stage must not self-deadlock on its own resource lock"

COUNT_6="$(jq -s --arg rid r6 '[.[] | select(.kind=="journal" and .run_id==$rid and .idempotency_key=="JK1" and .status=="applied")] | length' "$L6")"
assert_eq "$COUNT_6" "1" "journal row actually landed for resource-bearing stage"

L7="$TEST_TMP/ledger7.jsonl"
run_cmd init --ledger "$L7"
run_cmd stage-acquire --ledger "$L7" --run-id r7 --stage ship --pid "$$" --resources "acct-99"
GEN_7="$(jq -r '.generation' <<<"$CMD_OUT")"
NONCE_7="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"

set +e
OUT_7="$("$SCRIPT" stage-apply --ledger "$L7" --run-id r7 --stage ship --generation "$GEN_7" --nonce "$NONCE_7" --to-state committed --idempotency-key JK2 --timeout 3 2>&1)"
RC_7=$?
set -e
assert_eq "$RC_7" "0" "stage-apply on a resource-bearing stage must not self-deadlock on its own resource lock"

run_cmd query-latest --ledger "$L7" --run-id r7 --stage ship
assert_json_eq "$CMD_OUT" '.state' "committed" "stage state ends up committed after stage-apply"


# 7. Duplicate dead-code atomic_append_ledger fd-release divergence
L8="$TEST_TMP/ledger8.jsonl"
run_cmd init --ledger "$L8"

set +e
bash "$SCRIPT" stage-acquire --ledger "$L8" --run-id r8 --stage test --pid "$$" >/dev/null 2>&1
RC1=$?
bash "$SCRIPT" stage-acquire --ledger "$L8" --run-id r8b --stage test --pid "$$" --allow-reopen >/dev/null 2>&1
RC2=$?
bash "$SCRIPT" stage-acquire --ledger "$L8" --run-id r8c --stage test --pid "$$" --allow-reopen --timeout 2 >/dev/null 2>&1
RC3=$?
set -e

assert_eq "$RC1" "0" "first stage-acquire succeeds"
assert_eq "$RC2" "0" "second stage-acquire succeeds"
assert_eq "$RC3" "0" "sequential stage-acquire calls must not leave any lock held afterward (guards duplicate atomic_append_ledger fd-release drift)"

# Print results
if [ "${#FAILS[@]}" -eq 0 ]; then
  echo "PASS [$TEST_NAME] $PASS_COUNT assertions"
  exit 0
else
  echo "FAIL [$TEST_NAME] $PASS_COUNT passed, ${#FAILS[@]} failed" >&2
  for msg in "${FAILS[@]}"; do
    echo "  - $msg" >&2
  done
  exit 1
fi
