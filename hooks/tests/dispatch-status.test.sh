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
#     final JSON contract UNCHANGED (no new fields — strict schema untouched)
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
# (what agy/cc-shim runs declare) must yield NO telemetry — a worker printing JSON
# usage lines cannot promote its own output into token telemetry (gpt-5.5 R2).
OUT="$(node "$STATUS_JS" --log "$JSONL" --summary --format plain)"
assert_contains "$OUT" '"tokens":null' "declared plain beats JSON-looking content: tokens null (self-report suppressed)"
OUT="$(node "$STATUS_JS" --log "$JSONL" --usage-only --format plain)"
assert_eq "$OUT" "null" "usage-only with declared plain: null despite JSON-looking content"
OUT="$(node "$STATUS_JS" --log "$JSONL" --usage-only --format bogus)"; RC=$?
assert_eq "$OUT" "null" "usage-only with invalid --format: still null, never an error"
assert_eq "$RC" "0" "usage-only with invalid --format: exit 0 (never-fail discipline)"

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
# hold the lock in a background subshell (kernel-held flock — same probe contract
# as lib/worktree-reap.sh _wt_is_live)
( exec 9>"$LOCK"; flock -x 9; sleep 8 ) &
LOCK_HOLDER=$!
sleep 0.5
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

kill "$LOCK_HOLDER" 2>/dev/null; wait "$LOCK_HOLDER" 2>/dev/null
sleep 0.2
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

# The stub deliberately PRINTS a JSON usage line: an agy (plain-declared) worker's
# self-reported "usage" must NOT surface in the final JSON's usage field.
STUB_OK="$TEST_TMP/agy-ok"
cat > "$STUB_OK" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: smoke"
echo '{"usage":{"input_tokens":999999,"output_tokens":999999}}'
echo "done"
EOF
chmod +x "$STUB_OK"

OUT="$(cd "$SBX" && "$HETERO" --branch t/obs-e2e --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>/dev/null)"; RC=$?
assert_eq "$RC" "0" "e2e: committed exit 0"
assert_contains "$OUT" '"status": "committed"' "e2e: committed status"
assert_contains "$OUT" '"run_id": "hetero-' "e2e: final JSON carries generated run_id"
assert_contains "$OUT" '"usage": null' "e2e: agy declares plain → usage null even though the stub PRINTED a JSON usage line (self-report suppressed)"
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
echo "starting"
sleep 4
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: slow"
EOF
chmod +x "$STUB_SLOW"

MIDOUT_FILE="$TEST_TMP/mid.json"
( cd "$SBX" && "$HETERO" --branch t/obs-mid --prompt-file "$PROMPT" --agy-bin "$STUB_SLOW" > "$MIDOUT_FILE" 2>/dev/null ) &
DISPATCH_PID=$!
MID_RUN_ID=""
for _i in $(seq 1 40); do
  MID_MANIFEST="$(ls "$RUNS_DIR" 2>/dev/null | grep -v -e "^$E2E_RUN_ID" -e '^live-' | grep '\.manifest\.json$' | head -1)"
  [ -n "$MID_MANIFEST" ] && { MID_RUN_ID="${MID_MANIFEST%.manifest.json}"; break; }
  sleep 0.25
done
assert_neq "$MID_RUN_ID" "" "mid-run: manifest discoverable while dispatch is still running"
if [ -n "$MID_RUN_ID" ]; then
  OUT="$(node "$STATUS_JS" --run "$MID_RUN_ID")"
  assert_contains "$OUT" '"alive":true' "mid-run: alive:true while worker runs (失聯 fixed)"
  assert_contains "$OUT" '"phase":"running"' "mid-run: phase running"
fi
wait "$DISPATCH_PID" 2>/dev/null
OUT="$(node "$STATUS_JS" --run "$MID_RUN_ID")"
assert_contains "$OUT" '"phase":"exited"' "mid-run: exited after completion"
git -C "$SBX" branch -D t/obs-mid >/dev/null 2>&1

# ---------- 7. dispatch-review: manifest + finalize; final JSON contract unchanged ----------
DIFF="$TEST_TMP/d.diff"; printf 'diff --git a/x b/x\n+hi\n' > "$DIFF"
RV_OUT="$("$REVIEW" --runner agy --model tm --diff-file "$DIFF" --bin /nonexistent-agy 2>/dev/null)"; RC=$?
assert_eq "$RC" "2" "review: precondition exit 2 unchanged"
assert_not_contains "$RV_OUT" 'run_id' "review: final JSON contract UNCHANGED (strict schema — no new fields)"
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
