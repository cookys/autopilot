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

