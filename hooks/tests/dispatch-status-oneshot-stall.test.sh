#!/usr/bin/env bash
# A runner that prints nothing until it finishes (cc-shim = `claude -p`, qoderclicn, kimi, review-role plain logs) is not
# "stalled" just because its log is quiet: stall for it means alive past the dispatch's own timeout. Streaming runners keep the
# quiet-log rule (--stall-secs).
. "$(dirname "$0")/lib.sh"
STATUS_JS="$REPO_ROOT/scripts/dispatch-status.js"
RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$RUNS_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR"
LOCK="$TEST_TMP/held.lock"; LIVELOG="$TEST_TMP/live.log"; : > "$LOCK"; printf '[claude-code:unrecognized_model]\n' > "$LIVELOG"
mf() { # id runner role log_format timeout_json
  cat > "$RUNS_DIR/$1.manifest.json" <<EOT
{ "schema": 1, "run_id": "$1", "role": "$3", "runner": "$2", "model": "m", "branch": null, "base": null, "base_sha": null, "worktree": null, "lock_path": "$LOCK", "log_path": "$LIVELOG", "log_format": "$4", "aux_log": null, "pid": null, "scope_unit": null, "containment_planned": "plain", "started_at": "2026-07-11T00:00:00Z", "started_epoch": 0, "prompt_file": null, "ledger": null, "stage": null, "ended_at": null, "ended_epoch": null, "final_status": null, "timeout_seconds": $5 }
EOT
}
SENT="$TEST_TMP/sentinel"; touch "$SENT"
( exec 9>"$LOCK"; flock -x 9; while [ -e "$SENT" ]; do sleep 0.2; done ) &
HOLDER=$!
poll_until 5 bash -c '! flock -n "$0" true' "$LOCK" || fail "lock holder never acquired"
st() { node "$STATUS_JS" --run "$1" --stall-secs 180; }
age() { touch -d "$1 seconds ago" "$LIVELOG"; }

age 360   # 6 minutes quiet
mf shim cc-shim implementer plain 540;  assert_contains "$(st shim)" '"stall":false' "cc-shim 6 min quiet, timeout 9m: not stalled"
mf shim2 cc-shim reviewer plain null;   assert_contains "$(st shim2)" '"stall":false' "cc-shim reviewer, no timeout recorded: default wall, not stalled"
mf qd qoderclicn implementer plain 540; assert_contains "$(st qd)" '"stall":false' "qoderclicn 6 min quiet: not stalled"
mf kimi kimi implementer plain 540;     assert_contains "$(st kimi)" '"stall":false' "kimi 6 min quiet: not stalled"
mf cur cursor reviewer plain null;      assert_contains "$(st cur)" '"stall":false' "review-role plain log (cursor): not stalled"
mf cod codex implementer codex-chrome 540; assert_contains "$(st cod)" '"stall":true' "streaming codex 6 min quiet: still stalled"
mf cur2 cursor implementer jsonl 540;   assert_contains "$(st cur2)" '"stall":true' "streaming cursor implementer 6 min quiet: still stalled"
mf codr codex reviewer codex-chrome null; assert_contains "$(st codr)" '"stall":true' "codex reviewer streams: still stalled"
mf pir pi reviewer plain null;           assert_contains "$(st pir)" '"stall":true' "pi reviewer (plain log, but streams): still stalled"
age 600   # past the 9m timeout
mf shim cc-shim implementer plain 540;  assert_contains "$(st shim)" '"stall":true' "cc-shim past its own timeout: stalled"
assert_contains "$(st shim)" '"stall_limit_s":540' "limit reported"
age 1000  # past the default wall too
mf shim2 cc-shim reviewer plain null;   assert_contains "$(st shim2)" '"stall":true' "cc-shim, no timeout recorded, past default wall: stalled"

rm -f "$SENT"; wait "$HOLDER" 2>/dev/null
finalize_test
