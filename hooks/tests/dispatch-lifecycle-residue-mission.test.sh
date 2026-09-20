#!/usr/bin/env bash
# Row 3: lease-gc must not abort the loop on one failed transition.
. "$(dirname "$0")/lib.sh"

assert_r3_run_ledger_sh_lease() {
  local RL="$REPO_ROOT/scripts/run-ledger.sh"
  local LR="$TEST_TMP/r3-lease-gc.jsonl"
  local CONTROLLER="$REPO_ROOT/scripts/reap-dispatch-worktrees.sh"

  unset AUTOPILOT_SESSION_ID
  unset CLAUDE_CODE_SESSION_ID

  sleep 30 &
  local DEAD_PID=$!
  local DEAD_START
  DEAD_START="$(awk '{print $22}' "/proc/$DEAD_PID/stat" 2>/dev/null || echo 1)"
  kill "$DEAD_PID" >/dev/null 2>&1 || true
  wait "$DEAD_PID" 2>/dev/null || true
  local OLD_HB=$(($(date +%s) - 50000))

  bash "$RL" init --ledger "$LR" >/dev/null
  bash "$RL" stage-acquire --ledger "$LR" --run-id aaa-fail --stage campaign \
    --pid "$DEAD_PID" --start-time "$DEAD_START" --heartbeat-ts "$OLD_HB" \
    --worktree "$TEST_TMP/r3-no-wt-fail" >/dev/null
  python3 - "$LR" <<'PY'
import json, sys
path = sys.argv[1]
rows = []
with open(path) as fh:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        if row.get("kind") == "stage" and row.get("run_id") == "aaa-fail":
            row.pop("nonce", None)
        rows.append(row)
with open(path, "w") as fh:
    for row in rows:
        fh.write(json.dumps(row, separators=(",", ":")) + "\n")
PY
  bash "$RL" stage-acquire --ledger "$LR" --run-id zzz-ok --stage campaign \
    --pid "$DEAD_PID" --start-time "$DEAD_START" --heartbeat-ts "$OLD_HB" \
    --worktree "$TEST_TMP/r3-no-wt-ok" >/dev/null

  local GC_REPO="$TEST_TMP/r3-reap-repo"
  mkdir -p "$GC_REPO"
  git -C "$GC_REPO" init -q -b develop
  git -C "$GC_REPO" -c user.email=wlb@test -c user.name=wlb \
    commit -q --allow-empty -m "r3 lease-gc wrapper fixture"
  local GC_COMMON
  GC_COMMON="$(git -C "$GC_REPO" rev-parse --path-format=absolute --git-common-dir)"
  mkdir -p "$GC_COMMON/autopilot"
  local GC_LEDGER="$GC_COMMON/autopilot/implementation-campaign.jsonl"
  cp "$LR" "$GC_LEDGER"

  local GC_OUT GC_EC
  set +e
  GC_OUT="$(bash "$RL" lease-gc --ledger "$LR" --ttl-secs 43200 --json 2>/dev/null)"
  GC_EC=$?
  set -e
  # RED at f61a0aab8603686e004fba27fec7cefd1f8fed61: lease-gc exits 1 with empty
  # stdout (loop abort inside command_stage_transition via error/exit) so no
  # JSON; appended never reported for zzz-ok.
  assert_eq "$GC_EC" "0" "lease-gc --json exits 0 after a per-lease failure"
  assert_eq "$(jq -r .failed <<<"$GC_OUT")" "1" "failed counts the corrupt lease"
  assert_eq "$(jq -r .dead <<<"$GC_OUT")" "2" "both stale leases counted dead"
  assert_eq "$(jq -r .appended <<<"$GC_OUT")" "1" "healthy lease still appended"
  assert_eq "$(jq -r .scanned <<<"$GC_OUT")" "2" "loop scanned both leases"

  AUTOPILOT_TEST_MODE=1 "$CONTROLLER" reap --repo "$GC_REPO" \
    --root-run-id "r3-lease-gc-root" --yes > "$TEST_TMP/r3-reap.json"
  assert_exit_code "$?" "0" "reap with mixed lease-gc ledger succeeds"
  assert_eq "$(jq -r '.lease_gc.failed' < "$TEST_TMP/r3-reap.json")" "1" \
    "wrapper keeps failed=1 instead of zero-defaulting"
  assert_eq "$(jq -r '.lease_gc.appended' < "$TEST_TMP/r3-reap.json")" "1" \
    "wrapper keeps healthy appended instead of zeros"
  assert_eq "$(jq -r '.lease_gc.scanned' < "$TEST_TMP/r3-reap.json")" "2" \
    "wrapper keeps scanned instead of zeros"
}

assert_r16_dispatch_foreman_tes() {
  # Regression guard, not a RED→GREEN pin. BACKLOG row 16 appears already
  # resolved by 8de50578; this row adds a regression guard only, no product
  # fix; the BACKLOG row itself is stale and needs closure (out of this
  # bundle's scope — no BACKLOG.md edits).
  # Actual base Summary (parent GIT overlay + sibling-prefix stripped):
  #   PASS [dispatch-foreman] 115 assertions
  local out ec
  out="$(
    unset GIT_ALLOW_PROTOCOL GIT_CONFIG_COUNT GIT_TERMINAL_PROMPT
    unset AUTOPILOT_DISPATCH_SIBLING_REF_PREFIX AUTOPILOT_DISPATCH_DEPTH
    unset AUTOPILOT_PARENT_RUN_ID AUTOPILOT_ROOT_RUN_ID AUTOPILOT_WORKTREE_ROOT_RUN_ID
    for i in $(seq 0 40); do
      unset "GIT_CONFIG_KEY_$i" "GIT_CONFIG_VALUE_$i"
    done
    env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
      bash "$REPO_ROOT/hooks/tests/dispatch-foreman.test.sh" < /dev/null 2>&1
  )"
  ec=$?
  assert_eq "$ec" "0" "r16: dispatch-foreman.test.sh subprocess exits 0"
  assert_contains "$out" "PASS [dispatch-foreman] 115 assertions" \
    "r16: Summary shows 0 failed"
}

assert_r3_run_ledger_sh_lease
assert_r16_dispatch_foreman_tes
finalize_test
