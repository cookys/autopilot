#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$SCRIPT_ROOT/scripts/run-ledger.sh"
TEST_TMP="$(mktemp -d -t "run-ledger-concurrency-test-XXXXXX")"

cleanup_r6_workers() {
  for worker_pid in "${R6_PID:-}" "${R6_REPLACEMENT_PID:-}" "${R6_ACK_PID:-}"; do
    if [[ "$worker_pid" =~ ^[1-9][0-9]*$ ]]; then
      kill "$worker_pid" 2>/dev/null || true
      wait "$worker_pid" 2>/dev/null || true
    fi
  done
}
trap 'cleanup_r6_workers; rm -rf "$TEST_TMP"' EXIT

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

# 5c. Wrong nonce for current generation is fenced as stale_ignored
LEDGER_5C="$TEST_TMP/ledger-5c.jsonl"
run_cmd init --ledger "$LEDGER_5C"
run_cmd stage-acquire --ledger "$LEDGER_5C" --run-id r5c --stage ship --pid "$$"
GEN_5C="$(jq -r '.generation' <<<"$CMD_OUT")"
NONCE_5C="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"

run_cmd stage-transition --ledger "$LEDGER_5C" --run-id r5c --stage ship --generation "$GEN_5C" --nonce "${NONCE_5C}bad" --to-state committed
assert_cmd_rc 11 "wrong nonce transition is fenced with return 11"
assert_json_eq "$CMD_OUT" '.state' "stale_ignored" "wrong nonce output shows stale_ignored"
assert_json_eq "$CMD_OUT" '.generation' "$GEN_5C" "wrong nonce stale marker preserves caller generation"

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

# 9. Stage-3 typed conditions and fail-closed recovery controls (R6)
R6_LEDGER="$TEST_TMP/ledger-r6.jsonl"
run_cmd init --ledger "$R6_LEDGER"
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-working --stage work --pid "$$"
assert_json_eq "$(bash "$SCRIPT" stage-condition --ledger "$R6_LEDGER" --run-id r6-working --stage work)" '.condition' "working" "fresh exact lease is working"
run_cmd stage-event --ledger "$R6_LEDGER" --run-id r6-working --stage work --condition waiting --reason child-boundary
assert_json_eq "$(bash "$SCRIPT" stage-condition --ledger "$R6_LEDGER" --run-id r6-working --stage work)" '.condition' "waiting" "explicit wait event is waiting"

# A stale explicit wait is not an indefinite waiting verdict: without a fresh
# exact heartbeat it falls back to the bounded inquiry/unknown rail.
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-stale-wait --stage work --pid "$$" --heartbeat-ts 1
run_cmd stage-event --ledger "$R6_LEDGER" --run-id r6-stale-wait --stage work --condition waiting --reason child-boundary --progress-ts 1
STALE_WAIT_CONDITION="$(bash "$SCRIPT" stage-condition --ledger "$R6_LEDGER" --run-id r6-stale-wait --stage work --stale-seconds 1)"
assert_json_eq "$STALE_WAIT_CONDITION" '.condition' "unknown" "stale explicit wait requires fresh heartbeat"
assert_json_eq "$STALE_WAIT_CONDITION" '.reason' "stale_without_bounded_inquiry" "stale explicit wait names bounded inquiry fallback"

# Mismatched identity is unknown and cannot be signalled or replaced.
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-unknown --stage work --pid "$$" --start-time 1 --heartbeat-ts 1
UNKNOWN_COORD="$(AUTOPILOT_ADAPTIVE_INTERVENTION=1 bash "$SCRIPT" stage-coordinate --ledger "$R6_LEDGER" --run-id r6-unknown --stage work --action intervene --stale-seconds 1 --wait-seconds 0 --idempotency-key r6-unknown-key)"
assert_json_eq "$UNKNOWN_COORD" '.status' "unknown" "identity mismatch blocks intervention"
assert_json_eq "$(bash "$SCRIPT" stage-condition --ledger "$R6_LEDGER" --run-id r6-unknown --stage work --stale-seconds 1)" '.condition' "unknown" "identity mismatch remains unknown"

# Feature-off rollback is report-only.
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-off --stage work --pid "$$" --heartbeat-ts 1
OFF_COORD="$(bash "$SCRIPT" stage-coordinate --ledger "$R6_LEDGER" --run-id r6-off --stage work --action intervene --stale-seconds 1 --wait-seconds 0 --idempotency-key r6-off-key)"
assert_json_eq "$OFF_COORD" '.status' "feature_disabled" "adaptive recovery is disabled by default"
assert_eq "$(jq -s --arg rid r6-off '[.[]|select(.kind=="directive" and .run_id==$rid)]|length' "$R6_LEDGER")" "0" "feature-off emits no directive"

# Legacy argv remains valid outside the guarded recovery lineage; omission inside one fails closed.
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-ordinary --stage work --pid "$$"; ORD_GEN="$(jq -r .generation <<<"$CMD_OUT")"; ORD_NONCE="$(jq -r .nonce <<<"$CMD_OUT")"
run_cmd stage-transfer --ledger "$R6_LEDGER" --run-id r6-ordinary --stage work --generation "$ORD_GEN" --nonce "$ORD_NONCE" --pid "$$"; assert_cmd_rc 0 "ordinary prior-argv transfer remains compatible"
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-guarded --stage work --pid "$$"; GUARD_GEN="$(jq -r .generation <<<"$CMD_OUT")"; GUARD_NONCE="$(jq -r .nonce <<<"$CMD_OUT")"
jq -nc --arg gen "$GUARD_GEN" --arg nonce "$GUARD_NONCE" '{kind:"coordination",run_id:"r6-guarded",stage:"work",generation:($gen|tonumber),nonce:$nonce,action:"intervene",status:"reserved",idempotency_key:"guard"}' >> "$R6_LEDGER"
run_cmd stage-transfer --ledger "$R6_LEDGER" --run-id r6-guarded --stage work --generation "$GUARD_GEN" --nonce "$GUARD_NONCE" --pid "$$"; assert_cmd_rc 1 "guarded recovery cannot omit authorization"

# A quiet worker is killed only after inquiry, but incomplete reconciliation never
# authorizes a coordinator-owned replacement. A real replacement must explicitly
# claim the exact old tuple through stage-transfer.
cat > "$TEST_TMP/r6-quiet-worker.sh" <<'R6WORKER'
#!/usr/bin/env bash
while :; do sleep 1; done
R6WORKER
chmod +x "$TEST_TMP/r6-quiet-worker.sh"
setsid "$TEST_TMP/r6-quiet-worker.sh" >/dev/null 2>&1 &
R6_PID=$!
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-blocked --stage work --pid "$R6_PID" --heartbeat-ts 1 --campaign-id campaign-r6 --ticket-id ticket-r6 --lineage-id lineage-r6
run_cmd stage-transfer --ledger "$R6_LEDGER" --run-id r6-blocked --stage work --generation 1 --nonce missing --pid "$R6_PID" --timeout 5
assert_cmd_rc 1 "direct transfer without ledger authorization is rejected"
BLOCKED_COORD="$(AUTOPILOT_ADAPTIVE_INTERVENTION=1 bash "$SCRIPT" stage-coordinate --ledger "$R6_LEDGER" --run-id r6-blocked --stage work --action intervene --stale-seconds 1 --wait-seconds 0 --grace-seconds 0 --idempotency-key r6-replace-key)"
R6_COORD_STATUS="$(jq -r '.status' <<<"$BLOCKED_COORD")"
case "$R6_COORD_STATUS" in
  blocked|quarantined) PASS_COUNT=$((PASS_COUNT + 1)) ;;
  *) FAILS+=("quiet nonresponsive worker requires explicit reconciliation before replacement: unexpected status $R6_COORD_STATUS") ;;
esac
assert_eq "$(jq -s --arg rid r6-blocked '[.[]|select(.kind=="coordination" and .run_id==$rid and .status=="replacement_authorized")]|length' "$R6_LEDGER")" "0" "incomplete reconciliation emits no replacement receipt"
assert_eq "$(jq -s --arg rid r6-blocked '[.[]|select(.kind=="stage" and .run_id==$rid and .reason=="replacement")]|length' "$R6_LEDGER")" "0" "coordinator never leases a short-lived replacement"
OLD_GEN="$(jq -s --arg rid r6-blocked --arg stg work '[.[]|select(.kind=="stage" and .run_id==$rid and .stage==$stg)]|sort_by(.generation)|.[0].generation' "$R6_LEDGER")"
OLD_NONCE="$(jq -sr --arg rid r6-blocked --arg stg work '[.[]|select(.kind=="stage" and .run_id==$rid and .stage==$stg)]|sort_by(.generation)|.[0].nonce' "$R6_LEDGER")"
R6_LEASE="$(jq -sc --arg rid r6-blocked --arg stg work '[.[]|select(.kind=="stage" and .run_id==$rid and .stage==$stg)]|sort_by(.generation)|.[-1]' "$R6_LEDGER")"
jq -nc --argjson l "$R6_LEASE" '{run_id:$l.run_id,stage:$l.stage,generation:$l.generation,nonce:$l.nonce,campaign_id:$l.campaign_id,ticket_id:$l.ticket_id,lineage_id:$l.lineage_id,git_ref:($l.git_ref//""),git_sha:($l.git_sha//""),worktree:($l.worktree//""),status:"no_effect",effects:[]}' > "$TEST_TMP/r6-no-effect.json"
AUTHORIZED_COORD="$(AUTOPILOT_ADAPTIVE_INTERVENTION=1 bash "$SCRIPT" stage-coordinate --ledger "$R6_LEDGER" --run-id r6-blocked --stage work --action intervene --stale-seconds 1 --wait-seconds 0 --grace-seconds 0 --idempotency-key r6-authorize-key --authorize-transfer --result-json "$TEST_TMP/r6-no-effect.json")"
assert_json_eq "$AUTHORIZED_COORD" '.status' "transfer_authorized" "safe no-effect reconciliation authorizes explicit handoff"
AUTH_KEY="$(jq -r '.authorization_key' <<<"$AUTHORIZED_COORD")"
setsid "$TEST_TMP/r6-quiet-worker.sh" >/dev/null 2>&1 &
R6_REPLACEMENT_PID=$!
TRANSFERRED="$(bash "$SCRIPT" stage-transfer --ledger "$R6_LEDGER" --run-id r6-blocked --stage work --generation "$OLD_GEN" --nonce "$OLD_NONCE" --authorization-key "$AUTH_KEY" --pid "$R6_REPLACEMENT_PID" --timeout 5)"
assert_json_eq "$TRANSFERRED" '.generation' "2" "real replacement worker advances the exact tuple explicitly"
assert_eq "$(jq -s --arg rid r6-blocked --arg stg work '[.[]|select(.kind=="stage" and .run_id==$rid and .stage==$stg)]|map(.generation)|unique|length' "$R6_LEDGER")" "2" "one explicit replacement generation only"
assert_eq "$(jq -sr --arg rid r6-blocked '[.[]|select(.kind=="stage" and .run_id==$rid and .reason=="ownership_transfer")][0].campaign_id' "$R6_LEDGER")" "campaign-r6" "explicit handoff preserves campaign lineage"
run_cmd stage-transfer --ledger "$R6_LEDGER" --run-id r6-blocked --stage work --generation "$OLD_GEN" --nonce "$OLD_NONCE" --authorization-key "$AUTH_KEY" --pid "$R6_REPLACEMENT_PID" --timeout 5
assert_cmd_rc 1 "consumed transfer authorization cannot be replayed"
NEXT_GEN="$(jq -sr --arg rid r6-blocked '[.[]|select(.kind=="stage" and .run_id==$rid)]|sort_by(.generation)|.[-1].generation' "$R6_LEDGER")"; NEXT_NONCE="$(jq -sr --arg rid r6-blocked '[.[]|select(.kind=="stage" and .run_id==$rid)]|sort_by(.generation)|.[-1].nonce' "$R6_LEDGER")"
run_cmd stage-transfer --ledger "$R6_LEDGER" --run-id r6-blocked --stage work --generation "$NEXT_GEN" --nonce "$NEXT_NONCE" --authorization-key "$AUTH_KEY" --pid "$R6_REPLACEMENT_PID" --timeout 5
assert_cmd_rc 1 "consumed transfer key cannot operate on successor generation"

# Committed/advanced Git truth is adopted, never handed off as no-effect.
ADV_REPO="$TEST_TMP/r6-advanced-git"; git init -q "$ADV_REPO"; git -C "$ADV_REPO" branch -M main; git -C "$ADV_REPO" config user.email t@t; git -C "$ADV_REPO" config user.name t
printf base > "$ADV_REPO/state"; git -C "$ADV_REPO" add state; git -C "$ADV_REPO" commit -qm base; ADV_BASE="$(git -C "$ADV_REPO" rev-parse HEAD)"; printf advanced > "$ADV_REPO/state"; git -C "$ADV_REPO" commit -qam advanced
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-advanced --stage work --pid 999999 --start-time 1 --heartbeat-ts 1 --git-ref refs/heads/main --git-sha "$ADV_BASE" --worktree "$ADV_REPO"; ADV_LEASE="$CMD_OUT"
jq -nc --argjson l "$ADV_LEASE" '{run_id:$l.run_id,stage:$l.stage,generation:$l.generation,nonce:$l.nonce,campaign_id:"",ticket_id:"",lineage_id:"",git_ref:$l.git_ref,git_sha:$l.git_sha,worktree:$l.worktree,status:"no_effect",effects:[]}' > "$TEST_TMP/r6-advanced-result.json"
ADV_COORD="$(AUTOPILOT_ADAPTIVE_INTERVENTION=1 bash "$SCRIPT" stage-coordinate --ledger "$R6_LEDGER" --run-id r6-advanced --stage work --action intervene --stale-seconds 1 --wait-seconds 0 --idempotency-key r6-advanced-key --authorize-transfer --result-json "$TEST_TMP/r6-advanced-result.json" --git-dir "$ADV_REPO")"; assert_json_eq "$ADV_COORD" '.status' adopted "advanced Git truth is adopted"; assert_eq "$(jq -s --arg rid r6-advanced '[.[]|select(.kind=="coordination" and .run_id==$rid and .action=="transfer" and .status=="authorized")]|length' "$R6_LEDGER")" 0 "advanced Git truth emits no transfer authorization"

# Same-key controllers reserve one exact lease tuple under the run lock.
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-idem --stage work --pid 999999 --start-time 1 --heartbeat-ts 1; IDEM_LEASE="$CMD_OUT"
jq -nc --argjson l "$IDEM_LEASE" '{run_id:$l.run_id,stage:$l.stage,generation:$l.generation,nonce:$l.nonce,campaign_id:"",ticket_id:"",lineage_id:"",git_ref:"",git_sha:"",worktree:"",status:"no_effect",effects:[]}' > "$TEST_TMP/r6-idem-result.json"
IDEM_PIDS=(); for i in 1 2; do AUTOPILOT_ADAPTIVE_INTERVENTION=1 bash "$SCRIPT" stage-coordinate --ledger "$R6_LEDGER" --run-id r6-idem --stage work --action intervene --stale-seconds 1 --wait-seconds 0 --idempotency-key r6-idem-key --authorize-transfer --result-json "$TEST_TMP/r6-idem-result.json" >"$TEST_TMP/idem-$i.out" 2>&1 & IDEM_PIDS+=("$!"); done; for p in "${IDEM_PIDS[@]}"; do wait "$p" || true; done
assert_eq "$(jq -s --arg rid r6-idem '[.[]|select(.kind=="coordination" and .run_id==$rid and .action=="transfer" and .status=="authorized")]|length' "$R6_LEDGER")" 1 "same-key concurrent authorization is at-most one"
run_cmd stage-event --ledger "$R6_LEDGER" --run-id r6-idem --stage work --condition waiting --reason lock-check; assert_cmd_rc 0 "idempotency reservation releases its run lock"

# Different caller keys still share one authorization slot for the exact lease tuple.
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-multikey --stage work --pid 999999 --start-time 1 --heartbeat-ts 1; MULTI_LEASE="$CMD_OUT"
jq -nc --argjson l "$MULTI_LEASE" '{run_id:$l.run_id,stage:$l.stage,generation:$l.generation,nonce:$l.nonce,campaign_id:"",ticket_id:"",lineage_id:"",git_ref:"",git_sha:"",worktree:"",status:"no_effect",effects:[]}' > "$TEST_TMP/r6-multikey-result.json"
MULTI_PIDS=(); for key in a b; do AUTOPILOT_ADAPTIVE_INTERVENTION=1 bash "$SCRIPT" stage-coordinate --ledger "$R6_LEDGER" --run-id r6-multikey --stage work --action intervene --stale-seconds 1 --wait-seconds 0 --idempotency-key "multi-$key" --authorize-transfer --result-json "$TEST_TMP/r6-multikey-result.json" >/dev/null 2>&1 & MULTI_PIDS+=("$!"); done; for p in "${MULTI_PIDS[@]}"; do wait "$p" || true; done
assert_eq "$(jq -s --arg rid r6-multikey '[.[]|select(.kind=="coordination" and .run_id==$rid and .action=="transfer" and .status=="authorized")]|length' "$R6_LEDGER")" 1 "different keys cannot double-authorize one tuple"

# Even a forged-looking authorization cannot seize a live owner.
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-live-owner --stage work --pid "$R6_REPLACEMENT_PID" --campaign-id campaign-r6 --ticket-id ticket-r6 --lineage-id lineage-r6
LIVE_GEN="$(jq -r '.generation' <<<"$CMD_OUT")"; LIVE_NONCE="$(jq -r '.nonce' <<<"$CMD_OUT")"; LIVE_START="$(jq -r '.start_time' <<<"$CMD_OUT")"
jq -nc --arg rid r6-live-owner --arg stg work --arg gen "$LIVE_GEN" --arg nonce "$LIVE_NONCE" --arg key live-key --arg pid "$R6_REPLACEMENT_PID" --arg start "$LIVE_START" '{kind:"coordination",ts:"fixture",run_id:$rid,stage:$stg,generation:($gen|tonumber),nonce:$nonce,action:"transfer",status:"authorized",idempotency_key:$key,payload:{authorization:"stage-transfer",no_effect_proof:true,old_pid:($pid|tonumber),old_start_time:($start|tonumber)}}' >> "$R6_LEDGER"
run_cmd stage-transfer --ledger "$R6_LEDGER" --run-id r6-live-owner --stage work --generation "$LIVE_GEN" --nonce "$LIVE_NONCE" --authorization-key live-key --pid "$R6_REPLACEMENT_PID" --timeout 5
assert_cmd_rc 1 "live owner blocks authorized transfer"

# A quarantined resource is not clear for handoff, even when owner evidence is absent.
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-quarantine --stage work --pid 999999 --start-time 1 --resources r6-resource
Q_GEN="$(jq -r '.generation' <<<"$CMD_OUT")"; Q_NONCE="$(jq -r '.nonce' <<<"$CMD_OUT")"
jq -nc --arg rid r6-quarantine --arg stg work --arg gen "$Q_GEN" --arg nonce "$Q_NONCE" '{kind:"resource",ts:"fixture",run_id:$rid,resource_id:"r6-resource",state:"quarantined",reason:"fixture",generation:($gen|tonumber),nonce:$nonce}' >> "$R6_LEDGER"
jq -nc --arg rid r6-quarantine --arg stg work --arg gen "$Q_GEN" --arg nonce "$Q_NONCE" --arg key quarantine-key '{kind:"coordination",ts:"fixture",run_id:$rid,stage:$stg,generation:($gen|tonumber),nonce:$nonce,action:"transfer",status:"authorized",idempotency_key:$key,payload:{authorization:"stage-transfer",no_effect_proof:true,old_pid:999999,old_start_time:1}}' >> "$R6_LEDGER"
run_cmd stage-transfer --ledger "$R6_LEDGER" --run-id r6-quarantine --stage work --generation "$Q_GEN" --nonce "$Q_NONCE" --authorization-key quarantine-key --pid "$R6_REPLACEMENT_PID" --timeout 5
assert_cmd_rc 1 "quarantined resource blocks transfer"
run_cmd stage-transition --ledger "$R6_LEDGER" --run-id r6-blocked --stage work --generation "$OLD_GEN" --nonce "$OLD_NONCE" --to-state committed
assert_cmd_rc 11 "late old-generation result is fenced after replacement"
assert_json_eq "$CMD_OUT" '.state' "stale_ignored" "late result records stale_ignored"
if ! kill "$R6_PID" 2>/dev/null; then :; fi
if ! wait "$R6_PID" 2>/dev/null; then :; fi
if ! kill "$R6_REPLACEMENT_PID" 2>/dev/null; then :; fi
if ! wait "$R6_REPLACEMENT_PID" 2>/dev/null; then :; fi

# A captured group is not terminated merely because its leader exits on TERM.
printf '%s\n' '#!/usr/bin/env bash' 'trap "exit 0" TERM' '(trap "" TERM; while :; do sleep 1; done) &' 'while :; do sleep 1; done' > "$TEST_TMP/r6-lingering-group.sh"; chmod +x "$TEST_TMP/r6-lingering-group.sh"
setsid "$TEST_TMP/r6-lingering-group.sh" >/dev/null 2>&1 & R6_LINGER_PGID=$!
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-lingering --stage work --pid "$R6_LINGER_PGID" --heartbeat-ts 1
LINGER_COORD="$(AUTOPILOT_ADAPTIVE_INTERVENTION=1 bash "$SCRIPT" stage-coordinate --ledger "$R6_LEDGER" --run-id r6-lingering --stage work --action intervene --stale-seconds 1 --wait-seconds 0 --grace-seconds 2 --idempotency-key linger)"
assert_json_eq "$LINGER_COORD" '.status' quarantined "leader exit with captured group survivor quarantines"; assert_json_eq "$LINGER_COORD" '.termination' group_survived "captured group survivor forbids replacement"
kill -KILL -- "-$R6_LINGER_PGID" 2>/dev/null || true; wait "$R6_LINGER_PGID" 2>/dev/null || true

# An acknowledgement before the bounded deadline prevents kill/re-dispatch.
setsid "$TEST_TMP/r6-quiet-worker.sh" >/dev/null 2>&1 &
R6_ACK_PID=$!
run_cmd stage-acquire --ledger "$R6_LEDGER" --run-id r6-ack --stage work --pid "$R6_ACK_PID" --heartbeat-ts 1
AUTOPILOT_ADAPTIVE_INTERVENTION=1 bash "$SCRIPT" stage-coordinate --ledger "$R6_LEDGER" --run-id r6-ack --stage work --action intervene --stale-seconds 1 --wait-seconds 2 --grace-seconds 0 --idempotency-key r6-ack-key >"$TEST_TMP/r6-ack.out" 2>"$TEST_TMP/r6-ack.err" &
R6_COORD_PID=$!
R6_DIRECTIVE_ID=""
for _ in $(seq 1 20); do
  if ! R6_DIRECTIVE_ID="$(jq -r --arg rid r6-ack 'select(.kind=="directive" and .run_id==$rid) | .directive_id' "$R6_LEDGER" 2>/dev/null | tail -n 1)"; then
    R6_DIRECTIVE_ID=""
  fi
  [ -n "$R6_DIRECTIVE_ID" ] && break
  sleep 0.1
done
if [ -n "$R6_DIRECTIVE_ID" ]; then
  bash "$SCRIPT" directive-ack --ledger "$R6_LEDGER" --run-id r6-ack --directive-id "$R6_DIRECTIVE_ID" --by fixture >/dev/null
fi
if ! wait "$R6_COORD_PID"; then :; fi
ACK_COORD="$(cat "$TEST_TMP/r6-ack.out")"
assert_json_eq "$ACK_COORD" '.status' "acknowledged" "acknowledged inquiry prevents kill/replacement"
assert_eq "$(jq -s --arg rid r6-ack '[.[]|select(.kind=="stage" and .run_id==$rid)]|map(.generation)|unique|length' "$R6_LEDGER")" "1" "acknowledgement prevents generation advance"
if ! kill "$R6_ACK_PID" 2>/dev/null; then :; fi
if ! wait "$R6_ACK_PID" 2>/dev/null; then :; fi

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
