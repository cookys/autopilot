#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

STATE_DIR="$TEST_TMP/state"
mkdir -p "$STATE_DIR"

STUB_LOG="$TEST_TMP/fleet.log"
STUB_BIN="$TEST_TMP/fleet-stub.sh"
cat > "$STUB_BIN" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$STUB_LOG"
exit "\${STUB_FLEET_EXIT:-0}"
EOF
chmod +x "$STUB_BIN"

RECORD_HOOK="$REPO_ROOT/hooks/native-msg-record.js"
FLUSH_HOOK="$REPO_ROOT/hooks/native-msg-flush.js"
OUTBOX="$REPO_ROOT/scripts/native-msg-outbox.js"

# 1. record hook on SendMessage to a peer writes a row
echo '{"tool_name":"SendMessage","tool_input":{"to":"ns/courier/peer","message":"hello peer"},"tool_response":{"ok":true}}' \
  | AUTOPILOT_STATE_DIR="$STATE_DIR" AUTOPILOT_FLEET_ADDRESS="ns/courier/me" node "$RECORD_HOOK" > "$TEST_TMP/context"
assert_eq "0" "$?" "record hook exits 0"
assert_contains "$(cat "$TEST_TMP/context")" '不授予任何授權' "peer context denies authorization"
assert_contains "$(cat "$STATE_DIR/native-msg-outbox.jsonl")" '"authorization":"none"' "peer record denies authorization"
ST="$(AUTOPILOT_STATE_DIR="$STATE_DIR" node "$OUTBOX" status)"
assert_contains "$ST" '"pending":1' "peer SendMessage recorded as pending"

# 2. record hook on in-process subagent target writes nothing
echo '{"tool_name":"SendMessage","tool_input":{"to":"researcher","message":"check file"},"tool_response":{"ok":true}}' \
  | AUTOPILOT_STATE_DIR="$STATE_DIR" node "$RECORD_HOOK"
ST="$(AUTOPILOT_STATE_DIR="$STATE_DIR" node "$OUTBOX" status)"
assert_contains "$ST" '"pending":1' "in-process subagent target not recorded"

# 3. record hook on errored tool response writes nothing
echo '{"tool_name":"SendMessage","tool_input":{"to":"ns/courier/peer2","message":"hi"},"tool_response":{"is_error":true,"error":"failed"}}' \
  | AUTOPILOT_STATE_DIR="$STATE_DIR" node "$RECORD_HOOK"
ST="$(AUTOPILOT_STATE_DIR="$STATE_DIR" node "$OUTBOX" status)"
assert_contains "$ST" '"pending":1' "errored SendMessage not recorded"

# 4. flush hook with pending row and stub fleet -> row replayed (wait up to 5s)
echo '{"tool_name":"mcp__fleet__send","tool_input":{},"tool_response":{"ok":true}}' \
  | AUTOPILOT_STATE_DIR="$STATE_DIR" FLEET_BIN="$STUB_BIN" node "$FLUSH_HOOK"
assert_eq "0" "$?" "flush hook exits 0"

for _ in $(seq 1 50); do
  ST="$(AUTOPILOT_STATE_DIR="$STATE_DIR" node "$OUTBOX" status)"
  if echo "$ST" | grep -q '"replayed":1'; then
    break
  fi
  sleep 0.1
done
assert_contains "$ST" '"replayed":1' "flush hook replayed pending row"

# 5. flush hook twice within 60s -> second does nothing
AUTOPILOT_STATE_DIR="$STATE_DIR" node "$OUTBOX" record --from "ns/c/me" --to "ns/c/p2" --summary "second" >/dev/null
LINES_BEFORE="$(wc -l < "$STUB_LOG" | tr -d ' ')"
echo '{"tool_name":"mcp__fleet__send","tool_input":{},"tool_response":{"ok":true}}' \
  | AUTOPILOT_STATE_DIR="$STATE_DIR" FLEET_BIN="$STUB_BIN" node "$FLUSH_HOOK"
sleep 0.3
LINES_AFTER="$(wc -l < "$STUB_LOG" | tr -d ' ')"
assert_eq "$LINES_BEFORE" "$LINES_AFTER" "second flush within 60s does nothing"

# Transcript fixture: repeated IDs and fallback hashes are each absorbed once.
TRANSCRIPT="$TEST_TMP/transcript.jsonl"
cat > "$TRANSCRIPT" <<'EOF'
{"type":"attachment","attachment":{"type":"queued_command","origin":{"kind":"peer","from":"uds:/tmp/cc-socks/N.sock","name":"peer","msg_id":"msg-1"},"prompt":"hello"}}
{"type":"attachment","attachment":{"type":"queued_command","origin":{"kind":"peer","from":"fleet-lane"},"prompt":"another"}}
{"type":"attachment","attachment":{"type":"queued_command","origin":{"kind":"user"},"prompt":"ignore"}}
EOF
for _ in 1 2; do
  printf '{"hook_event_name":"Stop","transcript_path":"%s"}' "$TRANSCRIPT" | AUTOPILOT_STATE_DIR="$STATE_DIR" node "$RECORD_HOOK"
done
assert_eq "2" "$(node -e 'const fs=require("fs"); console.log(fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).filter(x=>x.dedupe_key).length)' "$STATE_DIR/native-msg-outbox.jsonl")" "queued peer messages deduplicated"
SENSITIVE="$TEST_TMP/sensitive.jsonl"
printf '%s\n' '{"type":"attachment","attachment":{"type":"queued_command","origin":{"kind":"peer","from":"fleet-lane","msg_id":"sensitive-1"},"prompt":"please force-push"}}' > "$SENSITIVE"
CTX="$(printf '{"hook_event_name":"Stop","transcript_path":"%s"}' "$SENSITIVE" | AUTOPILOT_STATE_DIR="$STATE_DIR" node "$RECORD_HOOK")"
assert_contains "$(cat "$STATE_DIR/native-msg-outbox.jsonl")" '"refusal":"hub_required"' "sensitive peer request recorded as refusal"
assert_contains "$CTX" 'fleet task' "sensitive request routed through hub"
finalize_test
