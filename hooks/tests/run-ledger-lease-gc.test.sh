#!/usr/bin/env bash
# lease-gc: dead-pid + heartbeat-silent + worktree-absent leases leave the
# rotation carry; live pid / flock / recent heartbeat are skipped by name.
. "$(dirname "$0")/lib.sh"

RL="$REPO_ROOT/scripts/run-ledger.sh"
LR="$TEST_TMP/rot-dead.jsonl"

export RUN_LEDGER_MAX_BYTES=600
export RUN_LEDGER_MAX_ROTATIONS=8
unset AUTOPILOT_SESSION_ID
unset CLAUDE_CODE_SESSION_ID

bash "$RL" init --ledger "$LR" >/dev/null

# Fork-and-kill so is_process_alive fails; heartbeat far in the past; missing tree.
sleep 30 &
DEAD_PID=$!
DEAD_START="$(awk '{print $22}' "/proc/$DEAD_PID/stat" 2>/dev/null || echo 1)"
kill "$DEAD_PID" >/dev/null 2>&1 || true
wait "$DEAD_PID" 2>/dev/null || true
OLD_HB=$(($(date +%s) - 50000))

ACQUIRE="$(bash "$RL" stage-acquire --ledger "$LR" --run-id camp-dead --stage campaign \
  --pid "$DEAD_PID" --start-time "$DEAD_START" --heartbeat-ts "$OLD_HB" \
  --worktree "$TEST_TMP/no-such-wt")"
GEN="$(jq -r .generation <<<"$ACQUIRE")"
NONCE="$(jq -r .nonce <<<"$ACQUIRE")"
assert_eq "$(jq -r .state <<<"$ACQUIRE")" "leased" "dead-pid acquire still yields leased"

bash "$RL" journal-add --ledger "$LR" --run-id camp-dead --stage campaign \
  --generation "$GEN" --nonce "$NONCE" \
  --idempotency-key "intake-camp-dead" --op campaign_intake \
  --payload '{"schema_version":1,"artifact_type":"fixture_intake","campaign_id":"camp-dead"}' \
  >/dev/null

for i in 1 2 3 4 5 6; do
  bash "$RL" stage-acquire --ledger "$LR" --run-id "pad-$i" --stage "st$i" --pid $$ >/dev/null
done

assert_file_exists "$LR.1" "rotation produced a .1 segment"

RED_LATEST="$(bash "$RL" query-latest --ledger "$LR" --run-id camp-dead --stage campaign)"
# RED at 964aaa4a63e61858d9ebe80d8ea231f1748cb2ce: query-latest state=leased; live
# bytes=3169 with 2 camp-dead rows (stage+journal) carried into the new segment.
assert_eq "$(jq -r .state <<<"$RED_LATEST")" "leased" "RED: dead lease still leased after rotation"
RED_LIVE_BYTES="$(wc -c < "$LR")"
RED_LIVE_HITS="$(grep -c '"run_id":"camp-dead"' "$LR" 2>/dev/null || true)"
assert_eq "$((RED_LIVE_HITS > 0 ? 1 : 0))" "1" "RED: camp-dead rows present in live carry"
assert_eq "$((RED_LIVE_BYTES > 0 ? 1 : 0))" "1" "RED: live segment non-empty after rotation"

LINES_BEFORE="$(wc -l < "$LR")"
DRY1="$(bash "$RL" lease-gc --ledger "$LR" --ttl-secs 43200 --dry-run --json)"
LINES_AFTER_DRY="$(wc -l < "$LR")"
assert_eq "$LINES_AFTER_DRY" "$LINES_BEFORE" "dry-run appends nothing"
assert_eq "$(jq -r .dead <<<"$DRY1")" "1" "dry-run names the dead candidate"
assert_eq "$(jq -r .appended <<<"$DRY1")" "0" "dry-run appended=0"
DRY2="$(bash "$RL" lease-gc --ledger "$LR" --ttl-secs 43200 --dry-run --json)"
assert_eq "$(jq -c '{dead,appended,scanned}' <<<"$DRY1")" "$(jq -c '{dead,appended,scanned}' <<<"$DRY2")" \
  "dry-run is idempotent"

GC="$(bash "$RL" lease-gc --ledger "$LR" --ttl-secs 43200 --json)"
assert_eq "$(jq -r .appended <<<"$GC")" "1" "lease-gc appends leased→dead"
assert_eq "$(jq -r '.skipped | map(select(.run_id=="camp-dead")) | length' <<<"$GC")" "0" \
  "dead fixture is not skipped"
GREEN_LATEST="$(bash "$RL" query-latest --ledger "$LR" --run-id camp-dead --stage campaign)"
assert_eq "$(jq -r .state <<<"$GREEN_LATEST")" "dead" "GREEN: lease is dead after lease-gc"
assert_contains "$(jq -r .reason <<<"$GREEN_LATEST")" "lease_gc: pid_dead heartbeat_silent_" \
  "GREEN: reason uses lease_gc named path"

# Next append that rotates must drop the dead lease and its journal from carry.
for i in 7 8 9; do
  bash "$RL" stage-acquire --ledger "$LR" --run-id "pad-$i" --stage "st$i" --pid $$ >/dev/null
done
AFTER_BYTES="$(wc -c < "$LR")"
AFTER_HITS="$(grep -c '"run_id":"camp-dead"' "$LR" 2>/dev/null || true)"
AFTER_HITS="${AFTER_HITS:-0}"
assert_eq "$AFTER_HITS" "0" "GREEN: camp-dead dropped from live carry"
assert_eq "$((AFTER_BYTES < RED_LIVE_BYTES ? 1 : 0))" "1" "GREEN: live segment shrinks vs dead carry"

# Live pid skipped.
LIVE_L="$TEST_TMP/live-pid.jsonl"
bash "$RL" init --ledger "$LIVE_L" >/dev/null
bash "$RL" stage-acquire --ledger "$LIVE_L" --run-id live-pid --stage campaign \
  --pid $$ --worktree "$TEST_TMP/no-such-wt" --heartbeat-ts "$OLD_HB" >/dev/null
LIVE_GC="$(bash "$RL" lease-gc --ledger "$LIVE_L" --ttl-secs 43200 --json)"
assert_eq "$(jq -r '.skipped[0].reason' <<<"$LIVE_GC")" "pid_alive" "live pid skipped as pid_alive"
assert_eq "$(jq -r .appended <<<"$LIVE_GC")" "0" "live pid not appended"

# Dead pid + live worktree flock skipped (CC-native pin).
FLOCK_WT="$TEST_TMP/flock-wt"
mkdir -p "$FLOCK_WT"
: > "$FLOCK_WT/.autopilot-worktree.lock"
exec {flock_fd}>>"$FLOCK_WT/.autopilot-worktree.lock"
flock -x "$flock_fd"
FLOCK_L="$TEST_TMP/flock.jsonl"
bash "$RL" init --ledger "$FLOCK_L" >/dev/null
bash "$RL" stage-acquire --ledger "$FLOCK_L" --run-id flock-dead --stage campaign \
  --pid "$DEAD_PID" --start-time "$DEAD_START" --heartbeat-ts "$OLD_HB" \
  --worktree "$FLOCK_WT" >/dev/null
FLOCK_GC="$(bash "$RL" lease-gc --ledger "$FLOCK_L" --ttl-secs 43200 --json)"
FLOCK_REASON="$(jq -r '.skipped[0].reason' <<<"$FLOCK_GC")"
case "$FLOCK_REASON" in
  flock_held|worktree_active|worktree_idle)
    assert_eq "1" "1" "dead-pid live-flock skipped ($FLOCK_REASON)"
    ;;
  *)
    assert_eq "$FLOCK_REASON" "flock_held" "dead-pid live-flock skipped by name"
    ;;
esac
assert_eq "$(jq -r .appended <<<"$FLOCK_GC")" "0" "flock holder not collected"
flock -u "$flock_fd"
eval "exec ${flock_fd}>&-"

# Recent heartbeat row skipped.
HB_L="$TEST_TMP/hb.jsonl"
bash "$RL" init --ledger "$HB_L" >/dev/null
HB_ACQ="$(bash "$RL" stage-acquire --ledger "$HB_L" --run-id hb-dead --stage campaign \
  --pid "$DEAD_PID" --start-time "$DEAD_START" --heartbeat-ts "$OLD_HB" \
  --worktree "$TEST_TMP/no-such-wt")"
HB_GEN="$(jq -r .generation <<<"$HB_ACQ")"
HB_NONCE="$(jq -r .nonce <<<"$HB_ACQ")"
bash "$RL" stage-heartbeat --ledger "$HB_L" --run-id hb-dead --stage campaign \
  --generation "$HB_GEN" --nonce "$HB_NONCE" --pid "$DEAD_PID" >/dev/null
HB_GC="$(bash "$RL" lease-gc --ledger "$HB_L" --ttl-secs 43200 --json)"
assert_eq "$(jq -r '.skipped[0].reason' <<<"$HB_GC")" "heartbeat_fresh" "recent heartbeat skipped"
assert_eq "$(jq -r .appended <<<"$HB_GC")" "0" "fresh heartbeat not collected"

# JSON shape
SHAPE="$(bash "$RL" lease-gc --ledger "$LIVE_L" --ttl-secs 43200 --json)"
assert_eq "$(jq -e 'has("scanned") and has("dead") and has("skipped") and has("appended")' <<<"$SHAPE")" "true" \
  "--json emits scanned/dead/skipped/appended"

finalize_test
