#!/usr/bin/env bash
# BL-0012: question_suspected emits a waiting worker_event the watcher can read.
# RED at 2efd32b23: waiting worker_event count was 0 (expected 1) and watch-foreman printed no CONDITION line containing waiting.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
unset GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL
for _git_cfg_i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  unset "GIT_CONFIG_KEY_${_git_cfg_i}" "GIT_CONFIG_VALUE_${_git_cfg_i}"
done
unset _git_cfg_i

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
RL="$REPO_ROOT/scripts/run-ledger.sh"
WF="$REPO_ROOT/scripts/watch-foreman.js"
CAP="$TEST_TMP/engine-capability"
mkdir -p "$CAP"
export ENGINE_CAPABILITY_DIR="$CAP"
export AUTOPILOT_STRIKE_WRITER=off
EMPTY_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"
mkdir -p "$EMPTY_SESSION_MODE_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"

AGY_FIXTURE_HELPER="$TEST_TMP/emit-agy-envelope"
cat > "$AGY_FIXTURE_HELPER" <<'EOF'
#!/usr/bin/env bash
response="${1:-self-report: DONE}"
RESPONSE="$response" node -e '
  process.stdout.write(JSON.stringify({
    conversation_id: "fixture",
    duration_seconds: 1,
    num_turns: 1,
    response: process.env.RESPONSE,
    status: "SUCCESS",
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
  }));
'
EOF
chmod +x "$AGY_FIXTURE_HELPER"
export AGY_FIXTURE_HELPER

STUB_QUESTION="$TEST_TMP/agy-question"
cat > "$STUB_QUESTION" <<'EOF'
#!/usr/bin/env bash
echo "Which file should I edit?" >&2
exit 124
EOF
chmod +x "$STUB_QUESTION"
make_agy_stub_versioned "$STUB_QUESTION"

STUB_OK="$TEST_TMP/agy-ok"
cat > "$STUB_OK" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: smoke"
"$AGY_FIXTURE_HELPER" "self-report: DONE"
EOF
chmod +x "$STUB_OK"
make_agy_stub_versioned "$STUB_OK"

waiting_rows() {
  jq -s -r --arg rid "$1" --arg stg "$2" '
    [ .[] | select(.kind=="worker_event" and .run_id==$rid and .stage==$stg and .condition=="waiting") ] | length
  ' "$3"
}

# --- 1. question_suspected writes waiting, and the watcher prints it ----------
LEDGER="$TEST_TMP/q.jsonl"
bash "$RL" init --ledger "$LEDGER" >/dev/null
bash "$RL" stage-acquire --ledger "$LEDGER" --run-id qrun --stage implement --pid "$$" >/dev/null
ERR="$TEST_TMP/q.err"
OUT="$(cd "$SBX" && env DISPATCH_QUIET=1 DISPATCH_DETACH=0 \
  "$SCRIPT" --branch hands/bl0012/q --prompt-file "$PROMPT" --agy-bin "$STUB_QUESTION" \
  --ledger "$LEDGER" --run-id qrun --stage implement 2>"$ERR")"
EC=$?
assert_eq "$EC" "1" "question_suspected exits 1"
assert_contains "$OUT" '"status": "question_suspected"' "question_suspected status"
ROWS="$(waiting_rows qrun implement "$LEDGER")"
assert_eq "$ROWS" "1" "ledger has one waiting worker_event for qrun/implement"
WATCH="$(node "$WF" --ledger "$LEDGER" --runs-dir "$TEST_TMP/empty-runs" --once 2>&1)"
assert_contains "$WATCH" "CONDITION run=qrun implement waiting" "watcher prints waiting for qrun"

# --- 2. a normal commit does not write waiting --------------------------------
LEDGER_OK="$TEST_TMP/ok.jsonl"
bash "$RL" init --ledger "$LEDGER_OK" >/dev/null
bash "$RL" stage-acquire --ledger "$LEDGER_OK" --run-id okrun --stage implement --pid "$$" >/dev/null
OUT="$(cd "$SBX" && env DISPATCH_QUIET=1 DISPATCH_DETACH=0 \
  "$SCRIPT" --branch hands/bl0012/ok --prompt-file "$PROMPT" --agy-bin "$STUB_OK" \
  --ledger "$LEDGER_OK" --run-id okrun --stage implement 2>/dev/null)"
EC=$?
assert_eq "$EC" "0" "committed hand exits 0"
assert_contains "$OUT" '"status": "committed"' "committed status"
ROWS="$(waiting_rows okrun implement "$LEDGER_OK")"
assert_eq "$ROWS" "0" "committed hand writes no waiting worker_event"

# --- 3. no ledger: same status and exit, and no event error -------------------
ERR2="$TEST_TMP/nolegder.err"
OUT="$(cd "$SBX" && env DISPATCH_QUIET=1 DISPATCH_DETACH=0 \
  "$SCRIPT" --branch hands/bl0012/noleg --prompt-file "$PROMPT" --agy-bin "$STUB_QUESTION" \
  2>"$ERR2")"
EC=$?
assert_eq "$EC" "1" "ledger-less question_suspected still exits 1"
assert_contains "$OUT" '"status": "question_suspected"' "ledger-less status unchanged"
assert_not_contains "$ERR2" "stage-event" "ledger-less dispatch prints no event error"
assert_not_contains "$ERR2" "waiting condition" "ledger-less dispatch prints no waiting warning"

finalize_test
