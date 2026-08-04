#!/usr/bin/env bash
# dispatch-status.js + run-manifest observability test (Stage 1, BACKLOG
# "Dispatch observability Stage 1"). Covers:
#   - log parsing: codex-chrome (REAL captured fixture), generic JSONL, plain-text
#     honest-nulls, missing file
#   - --usage-only output discipline (object-or-`null`, exit 0, never anything else)
#   - liveness: flock-held → alive/running, released → exited, ended_at → exited
#   - stall detection (mtime age vs --stall-secs, only while alive)
#   - dispatch-hetero e2e: manifest at START (visible mid-run, alive:true),
#     final JSON gains run_id/usage/wall_secs (additive), manifest finalized
#   - dispatch-review: manifest written + finalized even on precondition failure,
#     final JSON keeps run_id out while carrying the required usage field
#   - AUTOPILOT_DISPATCH_MANIFEST=0 escape hatch
. "$(dirname "$0")/lib.sh"

STATUS_JS="$REPO_ROOT/scripts/dispatch-status.js"
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
FIXTURES="$REPO_ROOT/hooks/tests/fixtures/dispatch-status"
RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$RUNS_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR"
export DISPATCH_QUIET=1

# ---------- 1. codex-chrome parsing (real captured fixture) ----------
OUT="$(node "$STATUS_JS" --log "$FIXTURES/codex-chrome-merged.log" --summary)"
assert_contains "$OUT" '"total_tokens":7420' "codex fixture: total tokens parsed from 'tokens used' + comma-grouped number"
assert_contains "$OUT" '"tool_calls":1' "codex fixture: one exec section = one tool call"
assert_contains "$OUT" '"events":3' "codex fixture: user/exec/codex sections counted"
assert_contains "$OUT" '"format":"codex-chrome"' "codex fixture: format auto-detected"
assert_contains "$OUT" '"usage_source":"codex-chrome"' "codex fixture: usage source labeled"

OUT="$(node "$STATUS_JS" --log "$FIXTURES/codex-chrome-merged.log" --usage-only)"
assert_contains "$OUT" '"total_tokens":7420' "usage-only: codex tokens"
assert_eq "$(printf '%s' "$OUT" | wc -l | tr -d ' ')" "0" "usage-only: exactly one line (no trailing extras)"

# ---------- 2. generic JSONL parsing (dispatcher-declared format) ----------
JSONL="$TEST_TMP/synth.jsonl"
printf '%s\n' \
  '{"type":"message","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":30}}' \
  '{"type":"tool_use","tool_name":"bash"}' > "$JSONL"
OUT="$(node "$STATUS_JS" --log "$JSONL" --summary --format jsonl)"
assert_contains "$OUT" '"input_tokens":100' "jsonl: input tokens"
assert_contains "$OUT" '"output_tokens":50' "jsonl: output tokens"
assert_contains "$OUT" '"cache_read_tokens":30' "jsonl: cache read tokens"
assert_contains "$OUT" '"total_tokens":150' "jsonl: total derived from input+output"
assert_contains "$OUT" '"tool_calls":1' "jsonl: tool_use event counted"

# ---------- 2b. pi-rpc parsing (executor-declared format) ----------
PIRPC="$TEST_TMP/pi-rpc.jsonl"
printf '%s\n' \
  '{"id":"prompt-1","type":"response","command":"prompt","success":true}' \
  '{"type":"agent_start"}' \
  '{"type":"tool_execution_start","toolName":"bash","args":{"command":"edit"}}' \
  '{"type":"tool_execution_end","toolName":"bash","result":{"success":true,"output":"ok"}}' \
  '{"type":"message_end","message":{"role":"assistant","usage":{"input":100,"output":20,"cacheRead":50,"cacheWrite":0,"totalTokens":170,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}}}' \
  '{"type":"agent_end","messages":[],"stopReason":"stop"}' > "$PIRPC"
OUT="$(node "$STATUS_JS" --log "$PIRPC" --summary --format pi-rpc)"
assert_contains "$OUT" '"format":"pi-rpc"' "pi-rpc: format used"
assert_contains "$OUT" '"tool_calls":1' "pi-rpc: only tool_execution_start counted"
assert_contains "$OUT" '"total_tokens":120' "pi-rpc: input+output summed"
assert_contains "$OUT" '"cache_read_tokens":50' "pi-rpc: cache read from message.usage"
assert_contains "$OUT" '"usage_source":"pi-rpc"' "pi-rpc: usage source labeled"

# anti-self-report guard: the SAME log with the dispatcher-declared format `plain`
# (what response-only agy logs and cc-shim runs declare) must yield NO telemetry — a worker printing JSON
# usage lines cannot promote its own output into token telemetry (gpt-5.5 R2).
OUT="$(node "$STATUS_JS" --log "$JSONL" --summary --format plain)"
assert_contains "$OUT" '"tokens":null' "declared plain beats JSON-looking content: tokens null (self-report suppressed)"
OUT="$(node "$STATUS_JS" --log "$JSONL" --usage-only --format plain)"
assert_eq "$OUT" "null" "usage-only with declared plain: null despite JSON-looking content"
OUT="$(node "$STATUS_JS" --log "$JSONL" --usage-only --format bogus)"; RC=$?
assert_eq "$OUT" "null" "usage-only with invalid --format: still null, never an error"
assert_eq "$RC" "0" "usage-only with invalid --format: exit 0 (never-fail discipline)"

# ---------- 2c. agy native JSON envelope (closed, single-parse authority) ----------
AGY_VALID="$TEST_TMP/agy-valid.json"
node - "$AGY_VALID" <<'NODE'
const fs = require('fs');
const response = [
  '<<<AUTOPILOT-REVIEW-fixture>>>',
  'VERDICT: SHIP-AS-IS',
  'FINDINGS: none',
  'NO-FINDING-PROOF: checked=diff; evidence=tests; conclusion=no blocker',
  '{"usage":{"input_tokens":999999,"output_tokens":999999}}',
  '<<<AUTOPILOT-END-fixture>>>',
].join('\n');
fs.writeFileSync(process.argv[2], `${JSON.stringify({
  conversation_id: 'fixture-conversation',
  duration_seconds: 1.25,
  num_turns: 1,
  response,
  status: 'SUCCESS',
  usage: {
    cache_read_tokens: 7,
    input_tokens: 101,
    output_tokens: 23,
    thinking_tokens: 11,
    total_tokens: 142,
  },
})}\n`);
NODE
OUT="$(node "$STATUS_JS" --log "$AGY_VALID" --agy-envelope)"; RC=$?
assert_eq "$RC" "0" "agy envelope: valid closed native JSON exits 0"
assert_contains "$OUT" '"response":"<<<AUTOPILOT-REVIEW-fixture>>>' "agy envelope: response is separated for existing framing"
assert_contains "$OUT" '"usage":{"total_tokens":142,"input_tokens":101,"output_tokens":23,"cache_read_tokens":7,"source":"agy-json"}' "agy envelope: authoritative usage normalized into existing shape"
assert_contains "$OUT" '999999' "agy envelope: worker fake usage remains inert response text rather than becoming telemetry"
OUT="$(node "$STATUS_JS" --log "$AGY_VALID" --usage-only --format agy-json)"; RC=$?
assert_eq "$RC" "0" "agy usage-only: valid envelope preserves never-fail exit discipline"
assert_contains "$OUT" '"source":"agy-json"' "agy usage-only: declared native envelope exposes authoritative source"
assert_contains "$OUT" '"total_tokens":142' "agy usage-only: declared native envelope exposes validated total"

write_agy_invalid() { # $1 file $2 node mutation body
  local file="$1" mutation="$2"
  node - "$AGY_VALID" "$file" "$mutation" <<'NODE'
const fs = require('fs');
const [source, destination, mutation] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(source, 'utf8'));
Function('value', mutation)(value);
fs.writeFileSync(destination, `${JSON.stringify(value)}\n`);
NODE
}
assert_agy_rejected() { # $1 file $2 label
  OUT="$(node "$STATUS_JS" --log "$1" --agy-envelope 2>&1)"; RC=$?
  assert_eq "$RC" "1" "agy envelope rejects $2"
  assert_contains "$OUT" "agy envelope invalid" "agy envelope reports fail-closed $2"
  OUT="$(node "$STATUS_JS" --log "$1" --usage-only --format agy-json)"; RC=$?
  assert_eq "$RC" "0" "agy invalid $2 usage-only keeps never-fail exit"
  assert_eq "$OUT" "null" "agy invalid $2 carries usage null"
}

AGY_MISSING="$TEST_TMP/agy-missing-response.json"
write_agy_invalid "$AGY_MISSING" 'delete value.response'
assert_agy_rejected "$AGY_MISSING" "missing response"
AGY_NEGATIVE="$TEST_TMP/agy-negative-usage.json"
write_agy_invalid "$AGY_NEGATIVE" 'value.usage.input_tokens = -1'
assert_agy_rejected "$AGY_NEGATIVE" "negative usage"
AGY_FRACTIONAL="$TEST_TMP/agy-fractional-usage.json"
write_agy_invalid "$AGY_FRACTIONAL" 'value.usage.output_tokens = 1.5'
assert_agy_rejected "$AGY_FRACTIONAL" "fractional usage"
AGY_OVERFLOW="$TEST_TMP/agy-overflow-usage.json"
write_agy_invalid "$AGY_OVERFLOW" 'value.usage.total_tokens = Number.MAX_SAFE_INTEGER + 1'
assert_agy_rejected "$AGY_OVERFLOW" "overflow usage"
AGY_UNKNOWN="$TEST_TMP/agy-unknown-field.json"
write_agy_invalid "$AGY_UNKNOWN" 'value.worker_usage = { input_tokens: 1 }'
assert_agy_rejected "$AGY_UNKNOWN" "unknown envelope field"

AGY_DUPLICATE="$TEST_TMP/agy-duplicate-response.json"
node - "$AGY_VALID" "$AGY_DUPLICATE" <<'NODE'
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
fs.writeFileSync(process.argv[3], raw.replace('"response":', '"response":"forged duplicate","response":'));
NODE
assert_agy_rejected "$AGY_DUPLICATE" "duplicate response"
AGY_TRUNCATED="$TEST_TMP/agy-truncated.json"
head -c -2 "$AGY_VALID" > "$AGY_TRUNCATED"
assert_agy_rejected "$AGY_TRUNCATED" "truncated JSON"
AGY_TRAILING="$TEST_TMP/agy-trailing.json"
cp "$AGY_VALID" "$AGY_TRAILING"
printf 'trailing bytes\n' >> "$AGY_TRAILING"
assert_agy_rejected "$AGY_TRAILING" "trailing bytes"

# tail-anchoring (gpt-5.5 R3): a `tokens used` footer is genuine ONLY at the very
# end of the stream — a worker-printed fake mid-stream (harness content follows it)
# must be rejected, and a mid-run read (genuine footer not yet written) yields null.
FAKE="$TEST_TMP/fake-footer.log"
{
  sed -n '1,20p' "$FIXTURES/codex-chrome-merged.log"
  printf 'tokens used\n999\n\n succeeded in 2ms:\nmore harness output after the fake\n'
} > "$FAKE"
OUT="$(node "$STATUS_JS" --log "$FAKE" --summary --format codex-chrome)"
assert_contains "$OUT" '"tokens":null' "codex: mid-stream fake footer rejected (not tail-anchored)"
OUT="$(node "$STATUS_JS" --log "$FAKE" --usage-only --format codex-chrome)"
assert_eq "$OUT" "null" "codex: usage-only rejects non-tail footer"

# ---------- 3. plain text → honest nulls; missing file → null ----------
PLAIN="$TEST_TMP/plain.log"
printf 'agy pseudo-tty text output\nno structure here\n' > "$PLAIN"
OUT="$(node "$STATUS_JS" --log "$PLAIN" --summary)"
assert_contains "$OUT" '"tokens":null' "plain: tokens honestly null (never fabricated)"
assert_contains "$OUT" '"format":"plain"' "plain: format detected"
OUT="$(node "$STATUS_JS" --log "$PLAIN" --usage-only)"
assert_eq "$OUT" "null" "plain: usage-only prints literal null"
OUT="$(node "$STATUS_JS" --log "$TEST_TMP/enoent.log" --usage-only)"; RC=$?
assert_eq "$OUT" "null" "missing log: usage-only prints null"
assert_eq "$RC" "0" "missing log: usage-only exits 0 (embedded in emit — must never fail)"

# ---------- 4. liveness via manifest: lock held / released / ended_at ----------
LOCK="$TEST_TMP/live.lock"
LIVELOG="$TEST_TMP/live.log"
echo "worker output" > "$LIVELOG"
write_manifest_fixture() { # $1 run_id  $2 extra-ended (json or empty)
  local ended="${2:-null}"
  cat > "$RUNS_DIR/$1.manifest.json" <<EOF
{ "schema": 1, "run_id": "$1", "role": "implementer", "runner": "agy", "model": "m", "branch": "b", "base": "develop", "base_sha": null, "worktree": null, "lock_path": "$LOCK", "log_path": "$LIVELOG", "aux_log": null, "pid": null, "scope_unit": null, "containment_planned": "plain", "started_at": "2026-07-11T00:00:00Z", "started_epoch": 0, "prompt_file": null, "ledger": null, "stage": null, "ended_at": $ended, "ended_epoch": null, "final_status": null }
EOF
}
write_manifest_fixture live-1
# Hold the lock until a sentinel is removed (not a fixed wall-clock window).
# Under parallel load node startup can exceed a fixed 8s hold → false failure.
LOCK_SENTINEL="$TEST_TMP/lock-held.sentinel"
touch "$LOCK_SENTINEL"
( exec 9>"$LOCK"; flock -x 9; while [ -e "$LOCK_SENTINEL" ]; do sleep 0.2; done ) &
LOCK_HOLDER=$!
# Wait until the holder actually acquired the flock (not a fixed pre-assert sleep).
if ! poll_until 5 bash -c '! flock -n "$0" true' "$LOCK"; then
  fail "lock held: background holder never acquired flock (readiness timeout)"
fi
OUT="$(node "$STATUS_JS" --run live-1)"
assert_contains "$OUT" '"alive":true' "lock held: alive"
assert_contains "$OUT" '"phase":"running"' "lock held: phase running"
assert_contains "$OUT" '"lock":"held"' "lock held: probe reports held"
assert_contains "$OUT" '"stall":false' "fresh log + alive: not stalled"

# stall: alive but log mtime is old
touch -d '10 minutes ago' "$LIVELOG" 2>/dev/null || touch -t 202601010000 "$LIVELOG"
OUT="$(node "$STATUS_JS" --run live-1 --stall-secs 60)"
assert_contains "$OUT" '"alive":true' "stall case: still alive"
assert_contains "$OUT" '"stall":true' "stall case: mtime age exceeds --stall-secs while alive"

rm -f "$LOCK_SENTINEL"
wait "$LOCK_HOLDER" 2>/dev/null
# Short poll for lock free (post-release) instead of a fixed sleep.
if ! poll_until 5 flock -n "$LOCK" true; then
  fail "lock released: flock never became free after holder exit"
fi
OUT="$(node "$STATUS_JS" --run live-1)"
assert_contains "$OUT" '"alive":false' "lock released: not alive"
assert_contains "$OUT" '"phase":"exited"' "lock released: phase exited"
assert_contains "$OUT" '"stall":false' "exited: never reported stalled"

# lock "free" is AUTHORITATIVE in the negative direction (the _wt_is_live contract):
# a live pid in the manifest at that point is pid reuse — must NOT resurrect the run.
cat > "$RUNS_DIR/live-3.manifest.json" <<EOF
{ "schema": 1, "run_id": "live-3", "role": "implementer", "runner": "agy", "model": "m", "branch": "b", "base": "develop", "base_sha": null, "worktree": null, "lock_path": "$LOCK", "log_path": "$LIVELOG", "aux_log": null, "pid": $$, "scope_unit": null, "containment_planned": "plain", "started_at": "2026-07-11T00:00:00Z", "started_epoch": 0, "prompt_file": null, "ledger": null, "stage": null, "ended_at": null, "ended_epoch": null, "final_status": null }
EOF
OUT="$(node "$STATUS_JS" --run live-3)"
assert_contains "$OUT" '"lock":"free"' "lock-free + live pid: lock probed free"
assert_contains "$OUT" '"pid":"alive"' "lock-free + live pid: pid genuinely alive (this test shell)"
assert_contains "$OUT" '"alive":false' "lock-free + live pid: flock verdict is authoritative — pid reuse must not resurrect the run"

# no lock verdict (review manifests have lock_path null) → pid IS the fallback signal
cat > "$RUNS_DIR/live-4.manifest.json" <<EOF
{ "schema": 1, "run_id": "live-4", "role": "reviewer", "runner": "agy", "model": "m", "branch": null, "base": null, "base_sha": null, "worktree": null, "lock_path": null, "log_path": "$LIVELOG", "aux_log": null, "pid": $$, "scope_unit": null, "containment_planned": "scratch", "started_at": "2026-07-11T00:00:00Z", "started_epoch": 0, "prompt_file": null, "ledger": null, "stage": null, "ended_at": null, "ended_epoch": null, "final_status": null }
EOF
OUT="$(node "$STATUS_JS" --run live-4)"
assert_contains "$OUT" '"alive":true' "no lock (reviewer): live pid is the fallback liveness signal"

write_manifest_fixture live-2 '"2026-07-11T00:10:00Z"'
OUT="$(node "$STATUS_JS" --run live-2)"
assert_contains "$OUT" '"phase":"exited"' "ended_at set: phase exited regardless of probes"

# list mode sees both
OUT="$(node "$STATUS_JS" --list)"
assert_contains "$OUT" '"run_id":"live-1"' "list: live-1 present"
assert_contains "$OUT" '"run_id":"live-2"' "list: live-2 present"

# unknown run id → exit 3 + honest error JSON
OUT="$(node "$STATUS_JS" --run no-such-run)"; RC=$?
assert_eq "$RC" "3" "unknown run: exit 3"
assert_contains "$OUT" 'manifest not found' "unknown run: honest error"

# ---------- 5. dispatch-hetero e2e: manifest at start, additive final JSON ----------
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"; echo "task" > "$PROMPT"

# The response deliberately contains a JSON usage line: worker-authored usage must NOT
# override the authoritative usage in the surrounding native agy envelope.
STUB_OK="$TEST_TMP/agy-ok"
cat > "$STUB_OK" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: smoke"
printf '%s\n' '{"conversation_id":"stub-ok","duration_seconds":1,"num_turns":1,"response":"{\"usage\":{\"input_tokens\":999999,\"output_tokens\":999999}}\\ndone","status":"SUCCESS","usage":{"cache_read_tokens":3,"input_tokens":11,"output_tokens":5,"thinking_tokens":2,"total_tokens":21}}'
EOF
chmod +x "$STUB_OK"
make_agy_stub_versioned "$STUB_OK"

OUT="$(cd "$SBX" && "$HETERO" --branch t/obs-e2e --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>/dev/null)"; RC=$?
assert_eq "$RC" "0" "e2e: committed exit 0"
assert_contains "$OUT" '"status": "committed"' "e2e: committed status"
assert_contains "$OUT" '"run_id": "hetero-' "e2e: final JSON carries generated run_id"
assert_contains "$OUT" '"usage": {"total_tokens":21,"input_tokens":11,"output_tokens":5,"cache_read_tokens":3,"source":"agy-json"}' "e2e: authoritative envelope usage wins over response-authored fake usage"
assert_contains "$OUT" '"wall_secs": ' "e2e: wall_secs present"
E2E_RUN_ID="$(printf '%s' "$OUT" | sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p')"
assert_file_exists "$RUNS_DIR/$E2E_RUN_ID.manifest.json" "e2e: manifest written under runs dir"
MOUT="$(cat "$RUNS_DIR/$E2E_RUN_ID.manifest.json")"
assert_contains "$MOUT" '"final_status": "committed"' "e2e: manifest finalized with outcome"
assert_contains "$MOUT" '"role": "implementer"' "e2e: manifest role"
assert_contains "$MOUT" '"log_format": "plain"' "e2e: manifest declares the runner's stream format (agy → plain)"
OUT="$(node "$STATUS_JS" --run "$E2E_RUN_ID")"
assert_contains "$OUT" '"phase":"exited"' "e2e: post-run status exited"
assert_contains "$OUT" '"final_status":"committed"' "e2e: post-run status carries final_status"
git -C "$SBX" branch -D t/obs-e2e >/dev/null 2>&1

# ---------- 6. dispatch-hetero e2e MID-RUN: alive:true while the worker runs ----------
STUB_SLOW="$TEST_TMP/agy-slow"
cat > "$STUB_SLOW" <<'EOF'
#!/usr/bin/env bash
sleep 4
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: slow"
printf '%s\n' '{"conversation_id":"stub-slow","duration_seconds":4,"num_turns":1,"response":"done","status":"SUCCESS","usage":{"cache_read_tokens":0,"input_tokens":7,"output_tokens":3,"thinking_tokens":1,"total_tokens":11}}'
EOF
chmod +x "$STUB_SLOW"
make_agy_stub_versioned "$STUB_SLOW"

MIDOUT_FILE="$TEST_TMP/mid.json"
( cd "$SBX" && "$HETERO" --branch t/obs-mid --prompt-file "$PROMPT" --agy-bin "$STUB_SLOW" > "$MIDOUT_FILE" 2>/dev/null ) &
DISPATCH_PID=$!
# Poll for a mid-run observation (manifest present AND alive:true) rather than
# assuming a fixed offset into the stub's sleep window (load can consume the
# whole 4s before a one-shot assert runs).
MID_RUN_ID=""
MID_ALIVE_OUT=""
_mid_deadline=$(( $(date +%s) + $(test_timing_scale 15) ))
while [ "$(date +%s)" -lt "$_mid_deadline" ]; do
  MID_MANIFEST="$(ls "$RUNS_DIR" 2>/dev/null | grep -v -e "^$E2E_RUN_ID" -e '^live-' | grep '\.manifest\.json$' | head -1)"
  if [ -n "$MID_MANIFEST" ]; then
    MID_RUN_ID="${MID_MANIFEST%.manifest.json}"
    MID_ALIVE_OUT="$(node "$STATUS_JS" --run "$MID_RUN_ID" 2>/dev/null || true)"
    case "$MID_ALIVE_OUT" in
      *'"alive":true'*) break ;;
    esac
  fi
  sleep 0.25
done
assert_neq "$MID_RUN_ID" "" "mid-run: manifest discoverable while dispatch is still running"
if [ -n "$MID_RUN_ID" ]; then
  case "$MID_ALIVE_OUT" in
    *'"alive":true'*)
      OUT="$MID_ALIVE_OUT"
      assert_contains "$OUT" '"alive":true' "mid-run: alive:true while worker runs (失聯 fixed)"
      assert_contains "$OUT" '"phase":"running"' "mid-run: phase running"
      ;;
    *)
      fail "mid-run: never observed alive:true while worker runs (readiness timeout)"
      ;;
  esac
fi
wait "$DISPATCH_PID" 2>/dev/null
OUT="$(node "$STATUS_JS" --run "$MID_RUN_ID")"
assert_contains "$OUT" '"phase":"exited"' "mid-run: exited after completion"
git -C "$SBX" branch -D t/obs-mid >/dev/null 2>&1

# ---------- 7. dispatch-review: manifest + finalize; no run_id in final JSON ----------
DIFF="$TEST_TMP/d.diff"; printf 'diff --git a/x b/x\n+hi\n' > "$DIFF"
RV_OUT="$("$REVIEW" --runner agy --model tm --diff-file "$DIFF" --bin /nonexistent-agy 2>/dev/null)"; RC=$?
assert_eq "$RC" "2" "review: precondition exit 2 unchanged"
assert_not_contains "$RV_OUT" 'run_id' "review: run_id remains manifest-only"
assert_contains "$RV_OUT" '"usage": null' "review: required usage is null on precondition failure"
RV_MANIFEST="$(grep -l '"run_id": "review-' "$RUNS_DIR"/*.manifest.json 2>/dev/null | head -1)"
assert_neq "$RV_MANIFEST" "" "review: manifest written"
if [ -n "$RV_MANIFEST" ]; then
  RVM="$(cat "$RV_MANIFEST")"
  assert_contains "$RVM" '"runner": "agy"' "review manifest: runner recorded"
  assert_not_contains "$RVM" '"ended_at": null' "review manifest: finalized (ended_at stamped) on exit"
  assert_contains "$RVM" '"final_status": "precondition_failed"' "review manifest: final_status mapped from the exit code (2 → precondition_failed)"
fi

# ---------- 8. AUTOPILOT_DISPATCH_MANIFEST=0 escape hatch ----------
RUNS_DIR2="$TEST_TMP/runs2"; mkdir -p "$RUNS_DIR2"
OUT="$(cd "$SBX" && AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR2" AUTOPILOT_DISPATCH_MANIFEST=0 "$HETERO" --branch t/obs-off --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>/dev/null)"
assert_contains "$OUT" '"status": "committed"' "manifest-off: dispatch unaffected"
assert_eq "$(ls "$RUNS_DIR2" 2>/dev/null | wc -l | tr -d ' ')" "0" "manifest-off: no manifest written"
git -C "$SBX" branch -D t/obs-off >/dev/null 2>&1

finalize_test
