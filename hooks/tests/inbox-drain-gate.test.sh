#!/usr/bin/env bash
# inbox-drain-gate.test.sh — Stop hook (hooks/inbox-drain-gate.js) tests.
# Covers:
#   1. Regression snapshot: 23 unread + 7 pending_decision (mixed ages: >10m and <10m).
#      Asserts: blocks, lists only >10m items, 2nd block still blocks, 3rd attempt passes.
#   2. Non-PM seat is not blocked.
#   3. Lead seat is not blocked by default; blocked when AUTOPILOT_INBOX_DRAIN_GATE_LEAD=1.
#   4. Empty or all-young inbox is not blocked.
#   5. Adapter failure does not block and prints one line to stderr.
. "$(dirname "$0")/lib.sh"

GATE="$REPO_ROOT/hooks/inbox-drain-gate.js"
FIXTURE="$TEST_TMP/fixture"
LIVE="$TEST_TMP/live"
mkdir -p "$FIXTURE" "$LIVE" "$TEST_TMP/state"
chmod 0700 "$LIVE"

export AUTOPILOT_LIVE_DIR="$LIVE"
export AUTOPILOT_CONTEXT_BUDGET_DIR="$TEST_TMP/state"
export AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FIXTURE"
unset AUTOPILOT_INBOX_DRAIN_GATE_LEAD

SID="11111111-2222-3333-4444-555555555555"
STOP_PAYLOAD="{\"session_id\":\"$SID\",\"cwd\":\"$TEST_TMP\",\"hook_event_name\":\"Stop\"}"

run_gate() {
  local sid="${1:-$SID}"
  local active="${2:-false}"
  local payload="{\"session_id\":\"$sid\",\"cwd\":\"$TEST_TMP\",\"hook_event_name\":\"Stop\",\"stop_hook_active\":$active}"
  printf '%s' "$payload" | node "$GATE" 2>"$TEST_TMP/gate.err"
}

# Build regression snapshot: 23 unread (15 old >10m, 8 young <10m) + 7 pending_decision (4 old, 3 young)
node -e '
const fs = require("fs");
const now = Date.now();
const oldTs = new Date(now - 15 * 60 * 1000).toISOString();
const youngTs = new Date(now - 2 * 60 * 1000).toISOString();
const items = [];
for (let i = 1; i <= 23; i++) {
  items.push({
    id: `msg-unread-${i}`,
    from: `sender-${i}`,
    disposition: "unread",
    created_at: i <= 15 ? oldTs : youngTs,
    summary: `Unread item ${i}`
  });
}
for (let i = 1; i <= 7; i++) {
  items.push({
    id: `msg-pending-${i}`,
    from: `lead-${i}`,
    disposition: "pending_decision",
    created_at: i <= 4 ? oldTs : youngTs,
    summary: `Pending decision ${i}`
  });
}
fs.writeFileSync(process.argv[1], JSON.stringify({ items }));
' "$FIXTURE/inbox.json"

# 1. PM seat: 1st block -> blocks and lists only old unread items
out1="$(AUTOPILOT_FLEET_ADDRESS="cookys/openclaw/pm--claude" run_gate "$SID")"
assert_contains "$out1" '"decision":"block"' "PM seat 1st attempt blocks"
assert_contains "$out1" "msg-unread-1" "lists old unread item 1"
assert_contains "$out1" "msg-unread-15" "lists old unread item 15"
assert_not_contains "$out1" "msg-unread-16" "does not list young unread item 16"
assert_contains "$out1" "scripts/pm-inbox-done.js" "includes pm-inbox-done.js instruction"

# 2nd block in same turn still blocks
out2="$(AUTOPILOT_FLEET_ADDRESS="cookys/openclaw/pm--claude" run_gate "$SID" true)"
assert_contains "$out2" '"decision":"block"' "PM seat 2nd attempt still blocks"

# 3rd attempt in same turn does NOT block
out3="$(AUTOPILOT_FLEET_ADDRESS="cookys/openclaw/pm--claude" run_gate "$SID" true)"
assert_eq "" "$out3" "PM seat 3rd attempt does not block"

# New turn (stop_hook_active false) resets the per-turn cap: blocks again (was a per-session cap before)
out4="$(AUTOPILOT_FLEET_ADDRESS="cookys/openclaw/pm--claude" run_gate "$SID")"
assert_contains "$out4" '"decision":"block"' "PM seat blocks again on a new turn"

# 2. Non-PM seat is not blocked
SID_OTHER="22222222-2222-3333-4444-555555555555"
out_other="$(AUTOPILOT_FLEET_ADDRESS="cookys/openclaw/worker--claude" run_gate "$SID_OTHER")"
assert_eq "" "$out_other" "non-PM seat is not blocked"

# 3. Lead seat: not blocked by default, blocked when AUTOPILOT_INBOX_DRAIN_GATE_LEAD=1
SID_LEAD="33333333-2222-3333-4444-555555555555"
out_lead_off="$(AUTOPILOT_FLEET_ADDRESS="cookys/openclaw/hangar--claude" run_gate "$SID_LEAD")"
assert_eq "" "$out_lead_off" "lead seat is not blocked by default"

out_lead_on="$(AUTOPILOT_FLEET_ADDRESS="cookys/openclaw/hangar--claude" AUTOPILOT_INBOX_DRAIN_GATE_LEAD=1 run_gate "$SID_LEAD")"
assert_contains "$out_lead_on" '"decision":"block"' "lead seat blocks when AUTOPILOT_INBOX_DRAIN_GATE_LEAD=1"

# 4. Empty or all-young inbox is not blocked
SID_YOUNG="44444444-2222-3333-4444-555555555555"
node -e '
const fs = require("fs");
const youngTs = new Date(Date.now() - 60 * 1000).toISOString();
fs.writeFileSync(process.argv[1], JSON.stringify({
  items: [{ id: "msg-young-1", from: "s1", disposition: "unread", created_at: youngTs, summary: "Fresh" }]
}));
' "$FIXTURE/inbox.json"
out_young="$(AUTOPILOT_FLEET_ADDRESS="cookys/openclaw/pm--claude" run_gate "$SID_YOUNG")"
assert_eq "" "$out_young" "all-young inbox is not blocked"

printf '{"items":[]}' > "$FIXTURE/inbox.json"
out_empty="$(AUTOPILOT_FLEET_ADDRESS="cookys/openclaw/pm--claude" run_gate "$SID_YOUNG")"
assert_eq "" "$out_empty" "empty inbox is not blocked"

# 5. Adapter failure does not block and prints one line to stderr
SID_ERR="55555555-2222-3333-4444-555555555555"
rm -f "$FIXTURE/inbox.json"
out_err="$(AUTOPILOT_FLEET_ADDRESS="cookys/openclaw/pm--claude" run_gate "$SID_ERR")"
err_msg="$(cat "$TEST_TMP/gate.err")"
assert_eq "" "$out_err" "adapter failure does not block"
assert_contains "$err_msg" "inbox-drain-gate adapter error" "adapter failure prints to stderr"

finalize_test
