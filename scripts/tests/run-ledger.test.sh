#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$SCRIPT_ROOT/scripts/run-ledger.sh"
TEST_TMP="$(mktemp -d -t "run-ledger-test-XXXXXX")"

trap 'rm -rf "$TEST_TMP"' EXIT

PASS_COUNT=0
FAILS=()
CMD_RC=0
CMD_OUT=""
TEST_NAME="run-ledger"

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

assert_json_true() {
  local payload="$1"
  local jq_path="$2"
  local msg="$3"
  local got
  got="$(jq -r "$jq_path // empty" <<<"$payload")"
  if [ "$got" = "true" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAILS+=("$msg: $jq_path expected true, got '$got'")
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

# 1) late child fence: stale writer can only become stale_ignored
LEDGER_A="$TEST_TMP/ledger-a.jsonl"
run_cmd init --ledger "$LEDGER_A"
run_cmd stage-acquire --ledger "$LEDGER_A" --run-id "run-a" --stage "build" --pid "$$" --resources "shared-a"
NONCE_A="$(jq -r '.nonce // empty' <<<"$CMD_OUT")"
assert_eq "$CMD_ERR" "" "stage-acquire keeps diagnostics off the JSON channel"
assert_eq "${#NONCE_A}" "16" "stage-acquire emits a 16-digit nonce"
GEN_A="$(jq -r '.generation' <<<"$CMD_OUT")"
run_cmd stage-transition --ledger "$LEDGER_A" --run-id "run-a" --stage "build" --generation "0" --nonce "wrong" --to-state committed
assert_cmd_rc 11 "late-child fence return code"
LAST_LINE="$(echo "$CMD_OUT" | tail -n 1)"
assert_json_eq "$LAST_LINE" '.state' 'stale_ignored' "late-child transition output state"
run_cmd query-latest --ledger "$LEDGER_A" --run-id "run-a" --stage "build"
assert_json_eq "$CMD_OUT" '.state' 'stale_ignored' "late-child transition result"

# 2) resume idempotency + residual late child is fenced
LEDGER_B="$TEST_TMP/ledger-b.jsonl"
run_cmd init --ledger "$LEDGER_B"
run_cmd stage-acquire --ledger "$LEDGER_B" --run-id "run-b" --stage "review" --pid "$$" --resources "resume"
ACQ_B="$CMD_OUT"
GEN_B="$(jq -r '.generation' <<<"$ACQ_B")"
NONCE_B="$(jq -r '.nonce // empty' <<<"$ACQ_B")"
cat > "$TEST_TMP/resume-late-child.sh" <<'CHILD'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_PATH="$1"
LEDGER_PATH="$2"
RUN_ID="$3"
STAGE="$4"
GEN="$5"
NONCE="$6"
sleep 0.3
bash "$SCRIPT_PATH" stage-transition --ledger "$LEDGER_PATH" --run-id "$RUN_ID" --stage "$STAGE" --generation "$GEN" --nonce "$NONCE" --to-state committed --idempotency-key "late-$RUN_ID"
CHILD
chmod +x "$TEST_TMP/resume-late-child.sh"

(
  bash "$TEST_TMP/resume-late-child.sh" \
    "$SCRIPT" "$LEDGER_B" "run-b" "review" "$GEN_B" "$NONCE_B" \
    >"$TEST_TMP/resume-late-child.out" \
    2>"$TEST_TMP/resume-late-child.err"
) &
RESUME_CHILD_PID=$!

sleep 0.15
run_cmd resume --ledger "$LEDGER_B" --run-id "run-b" --idempotency-key "resume-key-race"
assert_cmd_rc 0 "resume first round"
NEW_GEN_B="$(jq -r '.new_generation' <<<"$CMD_OUT")"
assert_json_eq "$CMD_OUT" '.status' 'resumed' "resume first status"
assert_ne "$NEW_GEN_B" "$GEN_B" "generation bumped on resume"
assert_json_eq "$CMD_OUT" '.adoption.status' 'needs_resume' "resume adopt status"

wait "$RESUME_CHILD_PID" || true
CHILD_OUT_B="$(cat "$TEST_TMP/resume-late-child.out")"
assert_contains "$CHILD_OUT_B" '"state":"stale_ignored"' "late child transition is fenced"

run_cmd resume --ledger "$LEDGER_B" --run-id "run-b" --idempotency-key "resume-key-race"
assert_json_eq "$CMD_OUT" '.status' 'already_applied' "resume idempotent replay"
RESUME_JOURNAL_COUNT_B="$(jq -s --arg rid "run-b" --arg stg "__resume__" --arg key "resume-key-race" --arg gen "0" '[ .[] | select(.kind=="journal" and .run_id==$rid and .stage==$stg and (.generation|tostring)==$gen and .idempotency_key==$key and .status=="applied") ] | length' "$LEDGER_B")"
assert_eq "$RESUME_JOURNAL_COUNT_B" "1" "exactly one resume journal row with idempotent key"
run_cmd query-latest --ledger "$LEDGER_B" --run-id "run-b" --stage "review"
assert_json_eq "$CMD_OUT" '.state' 'stale_ignored' "late child does not redo terminal commit"

# 3) resume adopts committed work via stage-reconcile + git-truth
LEDGER_C="$TEST_TMP/ledger-c.jsonl"
REPO="$TEST_TMP/repo-c"
git init -q "$REPO"
( cd "$REPO" && git config user.email t@example.com && git config user.name t && touch c.txt && git add c.txt && git commit -qm baseline && git checkout -qb case-c )
BASE_SHA="$(git -C "$REPO" rev-parse HEAD)"
run_cmd init --ledger "$LEDGER_C"
run_cmd stage-acquire --ledger "$LEDGER_C" --run-id "run-c" --stage "implement" --pid "$$" --resources "git-c" --git-ref "refs/heads/case-c" --git-sha "$BASE_SHA" --worktree "$REPO"
run_cmd stage-reconcile --ledger "$LEDGER_C" --run-id "run-c" --stage "implement" --git-dir "$REPO"
assert_json_eq "$CMD_OUT" '.reason' 'git_truth' "git-truth reconciliation reason"
assert_json_eq "$CMD_OUT" '.holder_alive' 'true' "git-truth reconciliation reports the live holder"
assert_json_eq "$CMD_OUT" '.git_truth' 'true' "git-truth reconciliation reports Git evidence"
assert_json_eq "$CMD_OUT" '.terminal' 'false' "leased reconciliation is not terminal"
assert_json_eq "$CMD_OUT" '.blocked_state' 'false' "leased reconciliation is not blocked"
assert_json_eq "$CMD_OUT" '.has_result' 'false' "missing result stays false"
run_cmd resume --ledger "$LEDGER_C" --run-id "run-c" --idempotency-key "resume-key-git-truth"
assert_json_eq "$CMD_OUT" '.status' 'resumed' "git-truth resume status"
assert_json_eq "$CMD_OUT" '.adoption.status' 'adopted' "git-truth adopted in resume"
assert_json_true "$CMD_OUT" '.adoption.reconciled' "resume reconciliation adopted"
assert_json_eq "$CMD_OUT" '.adoption.reason' 'git_truth' "git-truth reason"

# A terminal row retains the lease identity so reconciliation cannot claim a live
# writer is closed merely because the state advanced.
LEDGER_CLOSED="$TEST_TMP/ledger-closed.jsonl"
run_cmd init --ledger "$LEDGER_CLOSED"
run_cmd stage-acquire --ledger "$LEDGER_CLOSED" --run-id "run-closed" --stage "implement" --pid "$$"
CLOSED_GEN="$(jq -r '.generation' <<<"$CMD_OUT")"
CLOSED_NONCE="$(jq -r '.nonce' <<<"$CMD_OUT")"
run_cmd stage-transition --ledger "$LEDGER_CLOSED" --run-id "run-closed" --stage "implement" \
  --generation "$CLOSED_GEN" --nonce "$CLOSED_NONCE" --to-state committed
run_cmd stage-reconcile --ledger "$LEDGER_CLOSED" --run-id "run-closed" --stage "implement"
assert_json_eq "$CMD_OUT" '.terminal' 'true' "committed reconciliation is terminal"
assert_json_eq "$CMD_OUT" '.blocked_state' 'false' "committed reconciliation is not blocked"
assert_json_eq "$CMD_OUT" '.holder_alive' 'true' "terminal reconciliation retains a live holder"

# 4) quarantined/D-like resource goes to recovery path without trusting release
LEDGER_D="$TEST_TMP/ledger-d.jsonl"
run_cmd init --ledger "$LEDGER_D"
run_cmd stage-acquire --ledger "$LEDGER_D" --run-id "run-d" --stage "deploy" --pid "$$" --resources "shared-lock"
sleep 1
run_cmd stage-probe --ledger "$LEDGER_D" --run-id "run-d" --stage "deploy" --stale-seconds 1 --quarantine-on-stale-alive
PROBE_OUT="$(echo "$CMD_OUT" | tail -n 1)"
assert_json_eq "$PROBE_OUT" '.to' 'stale_ignored' "stale alive transition reason"
run_cmd resource-scan --ledger "$LEDGER_D" --resource-id "shared-lock" --state quarantined
assert_contains "$CMD_OUT" '"state":"quarantined"' "resource scan sees quarantine"
run_cmd resume --ledger "$LEDGER_D" --run-id "run-d" --idempotency-key "resume-quarantine"
assert_cmd_rc 3 "resume on quarantined resource must refuse"
assert_json_eq "$CMD_OUT" '.status' 'blocked_resource' "quarantine recovery blocked status"
assert_json_true "$CMD_OUT" '.must_use_new_resource' "quarantine recovery forces new resource"
run_cmd resource-lock --ledger "$LEDGER_D" --resource-id "shared-lock-recovery" --run-id "run-d-recovery" --stage "recovery"
assert_cmd_rc 0 "alternative resource lock succeeds"

# 5) kill during apply/commit leaves ledger parseable and recoverable
LEDGER_E="$TEST_TMP/ledger-e.jsonl"
cat > "$TEST_TMP/kill-child.sh" <<'CHILD'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_PATH="$1"
LEDGER_PATH="$2"
RUN_ID="$3"
STAGE="$4"
OUT="$(bash "$SCRIPT_PATH" stage-acquire --ledger "$LEDGER_PATH" --run-id "$RUN_ID" --stage "$STAGE" --resources "kill-lock")"
GEN="$(jq -r '.generation' <<<"$OUT")"
NONCE="$(jq -r '.nonce // empty' <<<"$OUT")"
sleep 0.3
bash "$SCRIPT_PATH" stage-apply --ledger "$LEDGER_PATH" --run-id "$RUN_ID" --stage "$STAGE" --generation "$GEN" --nonce "$NONCE" --to-state committed --idempotency-key "kill-${RUN_ID}"
CHILD
chmod +x "$TEST_TMP/kill-child.sh"

kill_found=0
kill_parse_ok=0
attempt=0
while [ "$attempt" -lt 20 ]; do
  attempt=$((attempt + 1))
  RUN_E="run-e-${attempt}"
  STAGE_E="stage"
  run_cmd init --ledger "$LEDGER_E"

  bash "$TEST_TMP/kill-child.sh" "$SCRIPT" "$LEDGER_E" "$RUN_E" "$STAGE_E" >"$TEST_TMP/child.out" 2>"$TEST_TMP/child.err" &
  KPID=$!
  sleep 0.1
  if kill -0 "$KPID" 2>/dev/null; then
    kill -9 "$KPID"
    kill_found=1
  fi
  wait "$KPID" || true

  if [ -s "$LEDGER_E" ] && jq -e . "$LEDGER_E" >/dev/null 2>&1; then
    ROWS="$(jq -s --arg rid "$RUN_E" --arg stg "$STAGE_E" '[ .[] | select(.kind=="stage" and .run_id==$rid and .stage==$stg) ] | length' "$LEDGER_E")"
    if [ "$ROWS" -gt 0 ]; then
      kill_parse_ok=1
      break
    fi
  fi

done

assert_eq "$kill_found" "1" "killed commit runner"
assert_eq "$kill_parse_ok" "1" "ledger remains parseable with row after kill"

run_cmd stage-probe --ledger "$LEDGER_E" --run-id "$RUN_E" --stage "$STAGE_E" --stale-seconds 0
assert_contains "$CMD_OUT" '"status"' "probe output exists after kill"
run_cmd query-latest --ledger "$LEDGER_E" --run-id "$RUN_E" --stage "$STAGE_E"
assert_ne "$(jq -r '.state // empty' <<<"$CMD_OUT")" "" "latest state exists after kill"

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
