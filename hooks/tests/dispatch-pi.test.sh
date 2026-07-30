#!/usr/bin/env bash
# dispatch-hetero --runner pi (RPC duplex) integration test.
#
# Outer bound: umbrella parallel runs must never hang indefinitely on the
# directive E2E tail. Individual cases already use `timeout 30`; this bounds
# the whole suite and cleans up stray children on expiry.
if [ -z "${DISPATCH_PI_OUTER_BOUNDED:-}" ]; then
  export DISPATCH_PI_OUTER_BOUNDED=1
  # 240s is well above a healthy serial run (~20s) and still bounds umbrella
  # serial-tail load (~8-minute hang class). Individual cases still use timeout 30.
  exec timeout --signal=TERM --kill-after=15s 240 bash "$0" "$@"
fi
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
STATUS_JS="$REPO_ROOT/scripts/dispatch-status.js"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"

RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$RUNS_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR"
export DISPATCH_QUIET=1

PI_MODELS_JSON="$TEST_TMP/pi-models.json"
printf '{}' > "$PI_MODELS_JSON"

# Mock pi: committed with usage + tool_execution_start.
STUB_OK="$TEST_TMP/pi-ok"
cat > "$STUB_OK" <<'__EOF1'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
    printf '%s\n' '{"type":"agent_start"}'
    printf '%s\n' '{"type":"tool_execution_start","toolName":"bash","args":{"command":"edit"}}'
    printf '%s\n' '{"type":"tool_execution_end","toolName":"bash","result":"ok"}'
    printf '%s\n' 'pi file output (escaped)'
    echo pi-edited > pi_out.txt
    printf '%s\n' '{"type":"message_end","message":{"role":"assistant","usage":{"input":100,"output":20,"cacheRead":50,"cacheWrite":0,"totalTokens":170,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}}}'
    printf '%s\n' '{"type":"agent_end","messages":[],"stopReason":"stop"}'
  fi
  if printf '%s' "$line" | grep -q '"type":"steer"'; then
    printf '%s\n' '{"type":"queue_update","queued":true}'
    printf '%s\n' '{"id":"pi-steer-response","type":"response","command":"steer","success":true}'
  fi
 done
__EOF1
chmod +x "$STUB_OK"

# Mock pi: zero edit and exit 0 (no_op).
STUB_NOOP="$TEST_TMP/pi-noop"
cat > "$STUB_NOOP" <<'__EOF2'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
    printf '%s\n' '{"type":"agent_end","messages":[],"stopReason":"stop"}'
  fi
done
__EOF2
chmod +x "$STUB_NOOP"

# Mock pi: exits non-zero before agent_end.
STUB_FAIL="$TEST_TMP/pi-fail"
cat > "$STUB_FAIL" <<'__EOF3'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
    printf '%s\n' '{"type":"agent_start"}'
    exit 1
  fi
done
__EOF3
chmod +x "$STUB_FAIL"

# Mock pi: emits prompt response, then stalls; resumes on one steer.
STUB_STALL="$TEST_TMP/pi-stall"
cat > "$STUB_STALL" <<'__EOF4'
#!/usr/bin/env bash
SLEEP_SECS="${PI_STALL_SLEEP:-2}"
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
    sleep "$SLEEP_SECS"
  fi
  if printf '%s' "$line" | grep -q '"type":"steer"'; then
    printf '%s\n' '{"type":"queue_update","queued":true}'
    printf '%s\n' '{"id":"pi-stall-steer-response","type":"response","command":"steer","success":true}'
    printf '%s\n' '{"type":"tool_execution_start","toolName":"bash","args":{"command":"after-stall"}}'
    echo stalled-edit > pi_stall_out.txt
    printf '%s\n' '{"type":"message_end","message":{"role":"assistant","usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}}}'
    printf '%s\n' '{"type":"agent_end","messages":[],"stopReason":"stop"}'
    exit 0
  fi
done
__EOF4
chmod +x "$STUB_STALL"

json_get() {
  local json="${1:-}"
  local expr="${2:-}"
  printf '%s' "$json" | node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); const parts=process.argv[1] ? String(process.argv[1]).split('.') : []; let v=d; for (const p of parts) { if (v && Object.prototype.hasOwnProperty.call(v,p)) v=v[p]; else { v=undefined; break; } } process.stdout.write(v===undefined||v===null?'':(typeof v==='string' ? v : JSON.stringify(v)));" "$expr"
}

# 1) committed path: runner/duplex/manifest/log_format and usage parsing.
OUT="$(cd "$SBX" && PI_MODELS_JSON="$PI_MODELS_JSON" "$SCRIPT" --runner pi --model MiniMax-M3 --branch feat/pi-ok --prompt-file "$PROMPT" --pi-bin "$STUB_OK" 2>&1)"
RC=$?
assert_eq "0" "$RC" "pi committed path exit"
assert_contains "$OUT" '"status": "committed"' "pi committed status"
assert_contains "$OUT" '"runner": "pi"' "pi runner in final JSON"
assert_contains "$OUT" '"duplex": "rpc"' "pi duplex field in final JSON"
assert_contains "$OUT" '"source":"pi-rpc"' "pi usage source"
# Extract the final JSON line (dispatch-hetero may print stderr notes into the 2>&1 capture)
OUT_JSON="$(printf '%s\n' "$OUT" | grep '^{ "status"' | tail -1)"
assert_eq "120" "$(json_get "$OUT_JSON" usage.total_tokens)" "pi total_tokens usage"
assert_eq "50" "$(json_get "$OUT_JSON" usage.cache_read_tokens)" "pi cache_read_tokens usage"
RUN_ID="$(json_get "$OUT_JSON" run_id | tr -d '\"')"
assert_file_exists "$RUNS_DIR/$RUN_ID.manifest.json" "pi committed run manifest"
MANIFEST="$(cat "$RUNS_DIR/$RUN_ID.manifest.json")"
assert_contains "$MANIFEST" '"duplex": "rpc"' "pi manifest duplex"
assert_contains "$MANIFEST" '"log_format": "pi-rpc"' "pi manifest log_format"
assert_contains "$MANIFEST" '"runner": "pi"' "pi manifest runner provenance (was: agy — gpt-5.5 R4)"
LOG_PATH="$(json_get "$OUT_JSON" agent_log | tr -d '\"')"
SUMMARY="$(node "$STATUS_JS" --log "$LOG_PATH" --format pi-rpc --summary)"
assert_contains "$SUMMARY" '"tool_calls":1' "pi summary counts tool_execution_start only"
assert_contains "$SUMMARY" '"total_tokens":120' "pi summary total tokens"
assert_contains "$SUMMARY" '"cache_read_tokens":50' "pi summary cache read tokens"
assert_contains "$SUMMARY" '"usage_source":"pi-rpc"' "pi summary usage source"

# 2) no-op mock: exit 1 with status no_op.
OUT_NOOP="$(cd "$SBX" && PI_MODELS_JSON="$PI_MODELS_JSON" "$SCRIPT" --runner pi --model MiniMax-M3 --branch feat/pi-noop --prompt-file "$PROMPT" --pi-bin "$STUB_NOOP" 2>&1)"
RC_NOOP=$?
assert_eq "1" "$RC_NOOP" "pi no-op path exit"
assert_contains "$OUT_NOOP" '"status": "no_op"' "pi status no_op"

# 3) failure mock: no agent_end and non-zero => non-committed.
OUT_FAIL="$(cd "$SBX" && PI_MODELS_JSON="$PI_MODELS_JSON" "$SCRIPT" --runner pi --model MiniMax-M3 --branch feat/pi-fail --prompt-file "$PROMPT" --pi-bin "$STUB_FAIL" 2>&1)"
RC_FAIL=$?
assert_eq "1" "$RC_FAIL" "pi failure path exit"
assert_not_contains "$OUT_FAIL" '"status": "committed"' "pi failure is not committed"

# 4) stall probe path: one injected probe, still finalizes.
OUT_STALL="$(cd "$SBX" && PI_MODELS_JSON="$PI_MODELS_JSON" PI_STALL_SLEEP=2 PI_RPC_STALL_PROBE_SECS=1 "$SCRIPT" --runner pi --model MiniMax-M3 --branch feat/pi-stall --prompt-file "$PROMPT" --pi-bin "$STUB_STALL" 2>&1)"
RC_STALL=$?
assert_eq "0" "$RC_STALL" "pi stall path still commits"
OUT_STALL_JSON="$(printf '%s\n' "$OUT_STALL" | grep '^{ "status"' | tail -1)"
STALL_LOG="$(json_get "$OUT_STALL_JSON" agent_log | tr -d '\"')"
assert_contains "$(cat "$STALL_LOG")" '"type":"supervisor_stall_probe"' "pi stall probe appears in log"
assert_contains "$OUT_STALL" '"status": "committed"' "pi stall path commits"

# 5) preconditions
OUT_MISSING_BIN="$(cd "$SBX" && PI_MODELS_JSON="$PI_MODELS_JSON" "$SCRIPT" --runner pi --model MiniMax-M3 --branch feat/pi-bad-bin --prompt-file "$PROMPT" --pi-bin "$TEST_TMP/non-existent-pi" 2>&1)"
RC_MISSING_BIN=$?
assert_eq "2" "$RC_MISSING_BIN" "pi precondition missing bin"
assert_contains "$OUT_MISSING_BIN" 'pi binary not found' "pi precondition names missing pi binary"

OUT_MISSING_MODELS="$(cd "$SBX" && PI_MODELS_JSON="$TEST_TMP/does-not-exist-models.json" "$SCRIPT" --runner pi --model MiniMax-M3 --branch feat/pi-missing-models --prompt-file "$PROMPT" --pi-bin "$STUB_OK" 2>&1)"
RC_MISSING_MODELS=$?
assert_eq "2" "$RC_MISSING_MODELS" "pi precondition missing models.json"
assert_contains "$OUT_MISSING_MODELS" 'pi models.json not readable' "pi precondition names missing models.json"

# ============================================================================
# Supervisor-direct tests (pi-rpc-run.js) — behaviors below the dispatch status
# layer. Added from the 2026-07-11 decorrelated (Gemini) adversarial review.
# ============================================================================
PI_RPC_RUN="$REPO_ROOT/scripts/lib/pi-rpc-run.js"
SUP_PROMPT="$TEST_TMP/sup-prompt.txt"; printf 'do the task\n' > "$SUP_PROMPT"
sup_cwd() { mkdir -p "$1"; }

# 6) prompt response success:false → supervisor exit 1 even with agent_end.
STUB_PROMPTFAIL="$TEST_TMP/pi-promptfail"
cat > "$STUB_PROMPTFAIL" <<'__EOF5'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":false}'
    printf '%s\n' '{"type":"agent_end","messages":[],"stopReason":"stop"}'
  fi
done
__EOF5
chmod +x "$STUB_PROMPTFAIL"
CW="$TEST_TMP/cw-promptfail"; sup_cwd "$CW"
( cd "$CW" && timeout 30 node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" --pi-bin "$STUB_PROMPTFAIL" >/dev/null 2>&1 )
assert_eq "1" "$?" "supervisor: prompt success:false → exit 1"

# 6b) prompt success:false with NO agent_end (gpt-5.5 R3): a rejected prompt on
# the persistent server must trigger the fail-closed shutdown ladder, not idle
# until an external timeout. Mock keeps reading forever after the rejection —
# only the supervisor-initiated shutdown (EOF→TERM→KILL) can end it. Assert a
# FAST exit 1 (rc 1, not timeout's 124).
STUB_PROMPTFAIL_HANG="$TEST_TMP/pi-promptfail-hang"
cat > "$STUB_PROMPTFAIL_HANG" <<'__EOF5B'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -c '"type":"prompt"' >/dev/null; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":false}'
  fi
done
__EOF5B
chmod +x "$STUB_PROMPTFAIL_HANG"
CW="$TEST_TMP/cw-promptfail-hang"; sup_cwd "$CW"
( cd "$CW" && PI_RPC_STALL_PROBE_SECS=999 timeout 20 node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" --pi-bin "$STUB_PROMPTFAIL_HANG" >/dev/null 2>&1 )
assert_eq "1" "$?" "supervisor: rejected prompt with no agent_end → fail-closed shutdown, fast exit 1 (never hangs to timeout)"

# 7) UTF-8 multibyte char split across stdout chunks in the agent_end line must
# still parse (StringDecoder fix). Mock writes 🚀 (F0 9F 9A 80) split 2+2 bytes.
STUB_UTF8="$TEST_TMP/pi-utf8"
cat > "$STUB_UTF8" <<'__EOF6'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
    printf '{"type":"agent_end","messages":[{"role":"user","text":"go \xf0\x9f'
    sleep 0.3
    printf '\x9a\x80"}],"stopReason":"stop"}\n'
  fi
done
__EOF6
chmod +x "$STUB_UTF8"
CW="$TEST_TMP/cw-utf8"; sup_cwd "$CW"
( cd "$CW" && timeout 30 node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" --pi-bin "$STUB_UTF8" >/dev/null 2>&1 )
assert_eq "0" "$?" "supervisor: multibyte agent_end split across chunks still detected → exit 0"

# 8) no stall probe when events keep flowing (probe must NOT fire).
STUB_FLOW="$TEST_TMP/pi-flow"
cat > "$STUB_FLOW" <<'__EOF7'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
    for i in 1 2 3 4 5 6; do printf '%s\n' '{"type":"turn_update","n":'"$i"'}'; sleep 0.3; done
    printf '%s\n' '{"type":"agent_end","messages":[],"stopReason":"stop"}'
  fi
done
__EOF7
chmod +x "$STUB_FLOW"
CW="$TEST_TMP/cw-flow"; sup_cwd "$CW"
FLOW_EVENTS="$( cd "$CW" && PI_RPC_STALL_PROBE_SECS=1 timeout 30 node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" --pi-bin "$STUB_FLOW" 2>/dev/null )"
assert_eq "0" "$?" "supervisor: flowing events → exit 0"
assert_not_contains "$FLOW_EVENTS" 'supervisor_stall_probe' "supervisor: no stall probe while events flow"

# 9) hard cap PI_RPC_MAX_SECS aborts a runaway (no agent_end) → exit 1.
STUB_HANG="$TEST_TMP/pi-hang"
cat > "$STUB_HANG" <<'__EOF8'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
    sleep 60
  fi
done
__EOF8
chmod +x "$STUB_HANG"
CW="$TEST_TMP/cw-hang"; sup_cwd "$CW"
( cd "$CW" && PI_RPC_MAX_SECS=1 PI_RPC_STALL_PROBE_SECS=999 timeout 30 node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" --pi-bin "$STUB_HANG" >/dev/null 2>&1 )
assert_eq "1" "$?" "supervisor: PI_RPC_MAX_SECS hard cap → exit 1"

# 10) parser: nested cost object never counted; multi message_end aggregation.
PARSE_LOG="$TEST_TMP/parse.jsonl"
{
  printf '%s\n' '{"type":"message_end","message":{"usage":{"input":150,"output":30,"cacheRead":10,"cost":{"input":9999,"output":8888,"cacheRead":7777}}}}'
  printf '%s\n' '{"type":"tool_execution_start","toolName":"bash"}'
  printf '%s\n' '{"type":"message_end","message":{"usage":{"input":50,"output":20,"cacheRead":5,"cost":{"input":1,"output":1,"cacheRead":1}}}}'
} > "$PARSE_LOG"
PARSE_SUM="$(node "$STATUS_JS" --log "$PARSE_LOG" --format pi-rpc --summary)"
assert_contains "$PARSE_SUM" '"input_tokens":200' "parser: aggregates input across message_end (150+50), cost ignored"
assert_contains "$PARSE_SUM" '"output_tokens":50' "parser: aggregates output (30+20), cost ignored"
assert_contains "$PARSE_SUM" '"cache_read_tokens":15' "parser: aggregates cacheRead (10+5), cost ignored"
assert_contains "$PARSE_SUM" '"total_tokens":250' "parser: total = input+output (honest billed spend)"

# 11) parser: agent_end with NO usage → tokens null (honest, not zero).
NOUSAGE_LOG="$TEST_TMP/nousage.jsonl"
printf '%s\n' '{"type":"agent_end","messages":[],"stopReason":"stop"}' > "$NOUSAGE_LOG"
NOUSAGE_SUM="$(node "$STATUS_JS" --log "$NOUSAGE_LOG" --format pi-rpc --summary)"
assert_contains "$NOUSAGE_SUM" '"tokens":null' "parser: no message_end → tokens null (not fabricated 0)"
assert_contains "$NOUSAGE_SUM" '"usage_source":"none"' "parser: no usage → source none"

# 12b) shutdown ESCALATION path (qc panel, opus): a pi that completes the protocol
# (agent_end) but IGNORES stdin EOF and TRAPS SIGTERM — the exact persistent-server
# shape the escalation ladder (stdin EOF → SIGTERM → SIGKILL) was written for.
# The supervisor must still terminate (SIGKILL rung) and score SUCCESS on the
# observed agent_end. Also asserts the EDIT-ONLY harness directive actually
# reaches pi's prompt payload (a stated trust rail, previously untested).
STUB_STUBBORN="$TEST_TMP/pi-stubborn"
cat > "$STUB_STUBBORN" <<'__EOF8'
#!/usr/bin/env bash
trap '' TERM HUP
while IFS= read -r line; do
  if printf '%s' "$line" | grep -c '"type":"prompt"' >/dev/null; then
    printf '%s' "$line" > "${PI_PROMPT_CAPTURE:?}"
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
    printf '%s\n' '{"type":"message_end","message":{"usage":{"input":10,"output":5,"cacheRead":0,"cost":{"input":0,"output":0}}}}'
    printf '%s\n' '{"type":"agent_end","messages":[],"stopReason":"stop"}'
    break
  fi
done
# stdin EOF is IGNORED from here on; TERM is trapped — only SIGKILL ends this.
while :; do sleep 1; done
__EOF8
chmod +x "$STUB_STUBBORN"
CW="$TEST_TMP/cw-stubborn"; sup_cwd "$CW"
PROMPT_CAPTURE="$TEST_TMP/prompt-capture.json"
( cd "$CW" && PI_PROMPT_CAPTURE="$PROMPT_CAPTURE" PI_RPC_STALL_PROBE_SECS=999 \
    timeout 30 node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" --pi-bin "$STUB_STUBBORN" >/dev/null 2>&1 )
assert_eq "0" "$?" "shutdown escalation: TERM-trapping EOF-ignoring pi still reaped via SIGKILL; success scored on observed agent_end"
assert_file_exists "$PROMPT_CAPTURE" "shutdown escalation: prompt payload captured by mock"
if grep -c 'HARNESS DIRECTIVE' "$PROMPT_CAPTURE" >/dev/null 2>&1; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "EDIT-ONLY harness directive missing from the prompt payload pi received"
fi
if grep -c 'do the task' "$PROMPT_CAPTURE" >/dev/null 2>&1; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "task prompt body missing from the prompt payload pi received"
fi

# 12) supervisor external-signal shutdown (qc panel, gpt-5.5): SIGTERM to the
# supervisor must not orphan the persistent pi server — verified empirically
# (kill + pid probe), never by reasoning. The fake pi ignores stdin EOF and
# would live forever without the supervisor's signal handler.
STUB_ORPHAN="$TEST_TMP/pi-orphan"
cat > "$STUB_ORPHAN" <<'__EOF9'
#!/usr/bin/env bash
echo "$$" > "${PI_ORPHAN_PIDFILE:?}"
# ignore stdin/EOF entirely; only signals can end this process
while :; do sleep 1; done
__EOF9
chmod +x "$STUB_ORPHAN"
CW="$TEST_TMP/cw-signal"; sup_cwd "$CW"
ORPHAN_PIDFILE="$TEST_TMP/orphan.pid"
( cd "$CW" && PI_ORPHAN_PIDFILE="$ORPHAN_PIDFILE" PI_RPC_STALL_PROBE_SECS=999 \
    node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" --pi-bin "$STUB_ORPHAN" >/dev/null 2>&1 ) &
SUP_SHELL_PID=$!
for _i in $(seq 1 40); do [ -s "$ORPHAN_PIDFILE" ] && break; sleep 0.25; done
FAKE_PI_PID="$(cat "$ORPHAN_PIDFILE" 2>/dev/null)"
assert_neq "$FAKE_PI_PID" "" "signal test: fake pi started and reported its pid"
# TERM the supervisor's node process (child of the subshell), not the subshell
SUP_NODE_PID="$(pgrep -P "$SUP_SHELL_PID" -f pi-rpc-run 2>/dev/null | head -1)"
[ -z "$SUP_NODE_PID" ] && SUP_NODE_PID="$SUP_SHELL_PID"
kill -TERM "$SUP_NODE_PID" 2>/dev/null
PI_DEAD=0
for _i in $(seq 1 20); do
  if ! kill -0 "$FAKE_PI_PID" 2>/dev/null; then PI_DEAD=1; break; fi
  sleep 0.25
done
assert_eq "$PI_DEAD" "1" "signal test: SIGTERM to supervisor also terminates the spawned pi (no orphan)"
wait "$SUP_SHELL_PID" 2>/dev/null

# ============================================================================
# Phase 2 — directive delivery (queue-and-deliver-at-boundary, advisory).
# The supervisor polls the R0 ledger for pending directives, steers pi with a
# `[depth-0 directive] …` message, and acks directive_delivered FROM THE
# SUPERVISOR (never the worker). Shutdown expires any still-pending directive.
# ============================================================================
RUN_LEDGER="$REPO_ROOT/scripts/run-ledger.sh"

# 13) delivery: a pending directive is steered into pi's stdin (with the text)
#     and the supervisor writes directive_delivered.
LGR="$TEST_TMP/deliver.jsonl"
bash "$RUN_LEDGER" init --ledger "$LGR" >/dev/null
bash "$RUN_LEDGER" stage-acquire --ledger "$LGR" --run-id DRUN --stage implement --pid $$ >/dev/null
D_ROW="$(bash "$RUN_LEDGER" directive-send --ledger "$LGR" --run-id DRUN --stage implement --text 'focus on the error paths' --from depth-0)"
D_ID="$(printf '%s' "$D_ROW" | jq -r .directive_id)"

# fake pi: respond to prompt, stay alive; on receiving a steer, capture it and end.
STUB_DELIVER="$TEST_TMP/pi-deliver"
cat > "$STUB_DELIVER" <<'__EOFD'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
  fi
  if printf '%s' "$line" | grep -q '"type":"steer"'; then
    printf '%s\n' "$line" >> "${PI_STEER_CAPTURE:?}"
    printf '%s\n' '{"id":"steer-resp","type":"response","command":"steer","success":true}'
    printf '%s\n' '{"type":"agent_end","messages":[],"stopReason":"stop"}'
  fi
done
__EOFD
chmod +x "$STUB_DELIVER"
CW="$TEST_TMP/cw-deliver"; sup_cwd "$CW"
STEER_CAPTURE="$TEST_TMP/deliver-steers.txt"; : > "$STEER_CAPTURE"
( cd "$CW" && PI_STEER_CAPTURE="$STEER_CAPTURE" PI_RPC_STALL_PROBE_SECS=999 PI_RPC_DIRECTIVE_POLL_SECS=1 \
    timeout 30 node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" \
    --pi-bin "$STUB_DELIVER" --ledger "$LGR" --run-id DRUN --stage implement >/dev/null 2>&1 )
assert_eq "$?" "0" "directive delivery: supervisor exits 0 after agent_end"
assert_contains "$(cat "$STEER_CAPTURE")" '[depth-0 directive] focus on the error paths' "directive steer with prefixed text reached pi stdin"
assert_contains "$(cat "$STEER_CAPTURE")" "directive-$D_ID" "steer carries the directive id"
DELIVERED="$(jq -s --arg d "$D_ID" '[.[]|select(.kind=="directive_delivered" and .directive_id==$d)]|length' "$LGR")"
assert_eq "$DELIVERED" "1" "supervisor wrote exactly one directive_delivered row"
assert_eq "$(jq -s --arg d "$D_ID" 'map(select(.kind=="directive_delivered" and .directive_id==$d))|.[0].by' "$LGR" | tr -d '\"')" "supervisor" "delivered ack is attributed to the supervisor (not the worker)"
assert_eq "$(bash "$RUN_LEDGER" directive-poll --ledger "$LGR" --run-id DRUN --stage implement | jq -r 'length')" "0" "delivered directive no longer pending"

# 14) shutdown expiry: a directive that is NEVER delivered (poll interval longer than
#     the run) gets directive_expired(run_ended) at supervisor shutdown.
LGR2="$TEST_TMP/expire.jsonl"
bash "$RUN_LEDGER" init --ledger "$LGR2" >/dev/null
bash "$RUN_LEDGER" stage-acquire --ledger "$LGR2" --run-id ERUN --stage implement --pid $$ >/dev/null
E_ROW="$(bash "$RUN_LEDGER" directive-send --ledger "$LGR2" --run-id ERUN --stage implement --text 'too late to deliver')"
E_ID="$(printf '%s' "$E_ROW" | jq -r .directive_id)"
CW="$TEST_TMP/cw-expire"; sup_cwd "$CW"
( cd "$CW" && PI_RPC_STALL_PROBE_SECS=999 PI_RPC_DIRECTIVE_POLL_SECS=999 \
    timeout 30 node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" \
    --pi-bin "$STUB_NOOP" --ledger "$LGR2" --run-id ERUN --stage implement >/dev/null 2>&1 )
EXPIRED="$(jq -s --arg d "$E_ID" 'map(select(.kind=="directive_expired" and .directive_id==$d))|.[0].reason' "$LGR2" | tr -d '\"')"
assert_eq "$EXPIRED" "run_ended" "shutdown expires the undelivered directive with reason run_ended"
assert_eq "$(bash "$RUN_LEDGER" directive-poll --ledger "$LGR2" --run-id ERUN --stage implement | jq -r 'length')" "0" "no directive is left silently pending after shutdown"

# 14b) stale directive is NEVER steered (QC fix — validate-then-steer-then-ack):
# a directive bound to lease gen N with the stage since re-acquired at gen N+1 must
# be skipped (no steer reaches pi) yet still terminalize as expired(stale_generation).
LGR_ST="$TEST_TMP/stale.jsonl"
bash "$RUN_LEDGER" init --ledger "$LGR_ST" >/dev/null
bash "$RUN_LEDGER" stage-acquire --ledger "$LGR_ST" --run-id SRUN --stage implement --pid $$ >/dev/null
S_ROW="$(bash "$RUN_LEDGER" directive-send --ledger "$LGR_ST" --run-id SRUN --stage implement --text 'stale nudge')"
S_ID="$(printf '%s' "$S_ROW" | jq -r .directive_id)"
bash "$RUN_LEDGER" stage-acquire --ledger "$LGR_ST" --run-id SRUN --stage implement --pid $$ >/dev/null  # bump generation
STUB_SLOW="$TEST_TMP/pi-slow"
cat > "$STUB_SLOW" <<'__EOFS'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
    sleep 3
    printf '%s\n' '{"type":"agent_end","messages":[],"stopReason":"stop"}'
  fi
  if printf '%s' "$line" | grep -q 'depth-0 directive'; then
    printf '%s\n' "$line" >> "${PI_STALE_STEER_CAPTURE:?}"
  fi
done
__EOFS
chmod +x "$STUB_SLOW"
CW="$TEST_TMP/cw-stale"; sup_cwd "$CW"
STALE_CAPTURE="$TEST_TMP/stale-steers.txt"; : > "$STALE_CAPTURE"
STALE_OUT="$( cd "$CW" && PI_STALE_STEER_CAPTURE="$STALE_CAPTURE" PI_RPC_STALL_PROBE_SECS=999 PI_RPC_DIRECTIVE_POLL_SECS=1 \
    timeout 30 node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" \
    --pi-bin "$STUB_SLOW" --ledger "$LGR_ST" --run-id SRUN --stage implement 2>/dev/null )"
assert_not_contains "$(cat "$STALE_CAPTURE")" 'depth-0 directive' "stale-generation directive never steered to the current worker"
assert_contains "$STALE_OUT" 'supervisor_directive_stale_skipped' "stale skip is an observable supervisor event"
STALE_TERM="$(jq -s --arg d "$S_ID" 'map(select(.kind=="directive_expired" and .directive_id==$d))|.[0].reason' "$LGR_ST" | tr -d '\"')"
assert_eq "$STALE_TERM" "stale_generation" "stale directive still terminalizes as expired(stale_generation)"

# 15) byte-compat: NO ledger coords → the supervisor performs zero directive delivery.
LGR3="$TEST_TMP/nocoords.jsonl"
bash "$RUN_LEDGER" init --ledger "$LGR3" >/dev/null
bash "$RUN_LEDGER" stage-acquire --ledger "$LGR3" --run-id NRUN --stage implement --pid $$ >/dev/null
N_ROW="$(bash "$RUN_LEDGER" directive-send --ledger "$LGR3" --run-id NRUN --stage implement --text untouched)"
N_ID="$(printf '%s' "$N_ROW" | jq -r .directive_id)"
CW="$TEST_TMP/cw-nocoords"; sup_cwd "$CW"
( cd "$CW" && PI_RPC_STALL_PROBE_SECS=999 PI_RPC_DIRECTIVE_POLL_SECS=1 \
    timeout 30 node "$PI_RPC_RUN" --model M --provider minimax --cwd "$CW" --prompt-file "$SUP_PROMPT" \
    --pi-bin "$STUB_OK" >/dev/null 2>&1 )
assert_eq "$?" "0" "no-coords run still succeeds (byte-compat)"
assert_eq "$(bash "$RUN_LEDGER" directive-poll --ledger "$LGR3" --run-id NRUN --stage implement | jq -r 'length')" "1" "without ledger coords the supervisor makes zero directive polls/acks (directive still pending)"

# 16) E2E through dispatch-hetero (QC MAJOR fix): the PRODUCTION pi dispatch path must
# forward --ledger/--run-id/--stage to the supervisor, so a depth-0 directive-send
# against the dispatch's own lease actually DELIVERS mid-run. Fake pi blocks until the
# directive steer arrives (deterministic), writes the steer line into the WORKTREE so
# the assertion reads a GIT ARTIFACT (committed by the wrapper), never self-report.
STUB_E2E="$TEST_TMP/pi-e2e"
cat > "$STUB_E2E" <<'__EOFE'
#!/usr/bin/env bash
while IFS= read -r line || [ -n "$line" ]; do
  if printf '%s' "$line" | grep -q '"type":"prompt"'; then
    printf '%s\n' '{"id":"prompt-1","type":"response","command":"prompt","success":true}'
  fi
  if printf '%s' "$line" | grep -q 'depth-0 directive'; then
    printf '%s\n' "$line" > steer_capture.txt
    printf '%s\n' '{"id":"steer-resp","type":"response","command":"steer","success":true}'
    printf '%s\n' '{"type":"agent_end","messages":[],"stopReason":"stop"}'
  fi
done
__EOFE
chmod +x "$STUB_E2E"
LGR_E2E="$TEST_TMP/e2e.jsonl"
bash "$RUN_LEDGER" init --ledger "$LGR_E2E" >/dev/null
E2E_OUT_FILE="$TEST_TMP/e2e-dispatch.out"
# Bound production detach E2E: never wait unbounded for a missing directive.
# PI_RPC_* env is now re-exported into the detach state file so poll interval
# survives setsid. Outer timeout keeps the umbrella serial tail finite.
( cd "$SBX" && \
    PI_MODELS_JSON="$PI_MODELS_JSON" \
    PI_RPC_STALL_PROBE_SECS=999 \
    PI_RPC_DIRECTIVE_POLL_SECS=1 \
    timeout --signal=TERM --kill-after=15s 120 \
    "$SCRIPT" --runner pi --model MiniMax-M3 --branch feat/pi-e2e-directive --prompt-file "$PROMPT" \
    --pi-bin "$STUB_E2E" --ledger "$LGR_E2E" --run-id E2ERUN --stage implement > "$E2E_OUT_FILE" 2>&1 ) &
E2E_DISPATCH_PID=$!
# Always reap the dispatch process group on suite exit so a hung stub cannot
# outlive the outer bound and poison later umbrella runs.
e2e_cleanup() {
  local lease detached_pid
  if [ -n "${E2E_DISPATCH_PID:-}" ] && kill -0 "$E2E_DISPATCH_PID" 2>/dev/null; then
    kill -TERM "-$E2E_DISPATCH_PID" 2>/dev/null || kill -TERM "$E2E_DISPATCH_PID" 2>/dev/null || true
    wait "$E2E_DISPATCH_PID" 2>/dev/null || true
  fi
  # Detach intentionally survives its caller. On a failed/timeout test, reap
  # only the exact test-owned detached lease before removing TEST_TMP.
  lease="$(bash "$RUN_LEDGER" query-latest --ledger "$LGR_E2E" --run-id E2ERUN --stage implement 2>/dev/null || true)"
  detached_pid="$(printf '%s' "$lease" | jq -r '.pid // empty' 2>/dev/null)"
  if [[ "$detached_pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$detached_pid" 2>/dev/null; then
    kill -TERM -- "-$detached_pid" 2>/dev/null || kill -TERM "$detached_pid" 2>/dev/null || true
  fi
  # The fake pi path is unique beneath this test's private TEST_TMP.
  pkill -f "$TEST_TMP/pi-e2e" 2>/dev/null || true
}
trap 'e2e_cleanup; cleanup_test_tmp' EXIT
# Send the directive mid-run: retry until the dispatch's OWN lease exists (send refuses
# before that — the refusal is the contract, so the retry loop IS the boundary).
# Wait for the post-transfer detached lease. A directive bound to the parent's
# generation must remain stale by design; never weaken that fencing or race a resend.
E2E_SENT=""
E2E_LEASE=""
for _i in $(seq 1 80); do
  E2E_LEASE="$(bash "$RUN_LEDGER" query-latest --ledger "$LGR_E2E" --run-id E2ERUN --stage implement 2>/dev/null || true)"
  E2E_LEASE_PID="$(printf '%s' "$E2E_LEASE" | jq -r '.pid // empty' 2>/dev/null)"
  if printf '%s' "$E2E_LEASE" | jq -e '
      .state == "leased"
      and (.generation // 0) >= 2
      and ((.worktree // "") | length) > 0
    ' >/dev/null 2>&1 \
    && [[ "$E2E_LEASE_PID" =~ ^[1-9][0-9]*$ ]] \
    && kill -0 "$E2E_LEASE_PID" 2>/dev/null; then
    if E2E_SENT="$(bash "$RUN_LEDGER" directive-send --ledger "$LGR_E2E" --run-id E2ERUN --stage implement --text 'nudge-e2e' --from depth-0 2>/dev/null)"; then
      break
    fi
  fi
  sleep 0.25
done
E2E_DID="$(printf '%s' "$E2E_SENT" | jq -r '.directive_id // empty' 2>/dev/null)"
assert_neq "$E2E_DID" "" "e2e: directive-send succeeded against the dispatch's live lease"
wait "$E2E_DISPATCH_PID"; E2E_RC=$?
e2e_cleanup
trap cleanup_test_tmp EXIT
[ "$E2E_RC" -eq 0 ] \
  || printf 'dispatch-pi diagnostic (e2e): %s\n' "$(cat "$E2E_OUT_FILE" 2>/dev/null)" >&2
assert_eq "$E2E_RC" "0" "e2e: pi dispatch with ledger coords exits 0"
assert_contains "$(cat "$E2E_OUT_FILE")" '"status": "committed"' "e2e: dispatch committed"
# git-artifact assertion: the steer (with the prefixed text) reached fake pi's stdin
E2E_STEER="$(git -C "$SBX" show feat/pi-e2e-directive:steer_capture.txt 2>/dev/null)"
assert_contains "$E2E_STEER" '[depth-0 directive] nudge-e2e' "e2e: steer with prefixed directive text reached pi (git artifact)"
assert_contains "$E2E_STEER" "directive-$E2E_DID" "e2e: steer carries the directive id (git artifact)"
E2E_DELIVERED="$(jq -s --arg d "$E2E_DID" '[.[]|select(.kind=="directive_delivered" and .directive_id==$d)]|length' "$LGR_E2E")"
assert_eq "$E2E_DELIVERED" "1" "e2e: exactly one directive_delivered row landed"
assert_eq "$(bash "$RUN_LEDGER" directive-poll --ledger "$LGR_E2E" --run-id E2ERUN --stage implement | jq -r 'length')" "0" "e2e: nothing left pending"
# and the no-coords dispatch (test 1) performed zero directive activity in its log
assert_not_contains "$(cat "$LOG_PATH")" 'supervisor_directive' "no-coords dispatch log has zero directive activity (byte-compat)"

finalize_test
