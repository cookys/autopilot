#!/usr/bin/env bash
# orchestration-eval-agy-stdin.test.sh — BL-0302: run-orchestration-eval.sh --runner agy sends the prompt
# on STDIN through lib/agy-stream-json.js, not as an argv argument. A recording fake agy on PATH captures
# argv and stdin; the harness prompt text must be on stdin and absent from argv.
# Negative control: run this suite with EVAL_HARNESS=<path to the pre-BL-0302 harness copy living inside an
# evals/orchestration/ directory> (its REPO_ROOT is ../..) and the argv assertions go red.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export ORCH_TIMEOUT="1m"

HARNESS="${EVAL_HARNESS:-$REPO_ROOT/evals/orchestration/run-orchestration-eval.sh}"
BIN="$TEST_TMP/bin"; REC="$TEST_TMP/rec"; mkdir -p "$BIN" "$REC"
cat >"$BIN/agy" <<'FAKE'
#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('1.4.6'); process.exit(0); }
const n = `${Date.now()}-${process.pid}`;
const stdin = fs.readFileSync(0);
fs.writeFileSync(`${process.env.REC}/${n}.argv`, JSON.stringify(a));
fs.writeFileSync(`${process.env.REC}/${n}.stdin`, stdin);
const mode = process.env.FAKE_MODE || 'ok';
const legacy = a.includes('-p'); // pre-BL-0302 text transport: plain text on stdout
if (mode === 'auth') { process.stdout.write('authentication invalid API key\n'); process.exit(7); }
if (mode === 'exit3') { process.stdout.write('some diagnostic\n'); process.exit(3); }
if (mode === 'empty') {
  if (legacy) { process.stdout.write('\n'); process.exit(0); }
  console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '' } })); process.exit(0);
}
if (legacy) { process.stdout.write('FAKE-AGY-RESPONSE\n'); process.exit(0); }
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'FAKE-AGY-RESPONSE' } }));
FAKE
chmod +x "$BIN/agy"
export PATH="$BIN:$PATH" REC

OUT="$TEST_TMP/out"; mkdir -p "$OUT"
timeout 300 bash "$HARNESS" --task t1-fix-with-decoy --arm on --runner agy --model fake-model --out "$OUT" >"$TEST_TMP/run.log" 2>&1 </dev/null
RC=$?
A="$(/bin/ls -t "$REC"/*.argv 2>/dev/null | head -1)"
[ -n "$A" ] || fail "fake agy was never called (rc=$RC): $(tail -5 "$TEST_TMP/run.log")"
ARGV="$(cat "$A")"; STDIN="$(cat "${A%.argv}.stdin")"
assert_contains "$STDIN" 'HARNESS DIRECTIVE' "agy-eval: the harness prompt arrives on stdin"
assert_contains "$STDIN" '"event":"user"' "agy-eval: stdin is a stream-json user line"
assert_not_contains "$ARGV" 'HARNESS DIRECTIVE' "agy-eval: argv carries no prompt text"
assert_not_contains "$ARGV" '"-p"' "agy-eval: argv has no -p"
assert_contains "$ARGV" '"--print="' "agy-eval: argv carries --print="
assert_contains "$ARGV" '"--model","fake-model"' "agy-eval: model flag preserved"
assert_contains "$ARGV" '"--dangerously-skip-permissions"' "agy-eval: permission flag preserved"
assert_contains "$ARGV" '"--print-timeout","1m"' "agy-eval: print-timeout preserved"
assert_contains "$(cat "$OUT/run.log" 2>/dev/null)" 'FAKE-AGY-RESPONSE' "agy-eval: unwrapped response reaches the raw log"

# --- failure scenarios: the harness classification must match the pre-BL-0302 (text transport) behaviour ---
run_mode() { # <mode> -> sets CAUSE
  local o="$TEST_TMP/out-$1"; mkdir -p "$o"
  FAKE_MODE="$1" timeout 300 bash "$HARNESS" --task t1-fix-with-decoy --arm on --runner agy --model fake-model --out "$o" >"$TEST_TMP/run-$1.log" 2>&1 </dev/null || true
  CAUSE="$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).failure_cause))}catch(e){process.stdout.write("NO-RESULT")}' "$o/result.json")"
  RUNLOG="$(cat "$o/run.log" 2>/dev/null)"
}
run_mode auth
assert_eq "authentication" "$CAUSE" "agy-eval: exit 7 with authentication wording classifies as authentication"
assert_contains "$RUNLOG" 'authentication invalid API key' "agy-eval: agy's raw diagnostic stays in the run log"
run_mode empty
assert_eq "oracle_rejected" "$CAUSE" "agy-eval: an empty SUCCESS response classifies as oracle_rejected (same as the text transport)"
run_mode exit3
assert_eq "runner_error" "$CAUSE" "agy-eval: a non-zero exit without auth wording classifies as runner_error"
assert_contains "$RUNLOG" 'some diagnostic' "agy-eval: raw stdout of a failing agy stays in the run log"

# --- helper level: exit code passthrough and the --text-compat contract ---
HELPER="$REPO_ROOT/scripts/lib/agy-stream-json.js"
printf 'p' >"$TEST_TMP/p.txt"
FAKE_MODE=exit3 node "$HELPER" run --text-compat --prompt-file "$TEST_TMP/p.txt" -- agy >"$TEST_TMP/h.out" 2>/dev/null; HRC=$?
assert_eq "3" "$HRC" "helper --text-compat: agy exit code passed through"
assert_contains "$(cat "$TEST_TMP/h.out")" 'some diagnostic' "helper --text-compat: raw stdout replayed on failure"
FAKE_MODE=exit3 node "$HELPER" run --prompt-file "$TEST_TMP/p.txt" -- agy >"$TEST_TMP/h2.out" 2>/dev/null; HRC=$?
assert_eq "3" "$HRC" "helper default: exit code passed through"
assert_eq "" "$(cat "$TEST_TMP/h2.out")" "helper default: stdout stays empty on failure (unchanged)"
FAKE_MODE=empty node "$HELPER" run --prompt-file "$TEST_TMP/p.txt" -- agy >/dev/null 2>&1; HRC=$?
assert_eq "1" "$HRC" "helper default: empty SUCCESS still exits 1 (unchanged)"
FAKE_MODE=empty node "$HELPER" run --text-compat --prompt-file "$TEST_TMP/p.txt" -- agy >/dev/null 2>&1; HRC=$?
assert_eq "0" "$HRC" "helper --text-compat: empty SUCCESS exits 0"
assert_eq "FAKE-AGY-RESPONSE" "$(node "$HELPER" run --prompt-file "$TEST_TMP/p.txt" -- agy 2>/dev/null)" "helper default: response unchanged"
assert_eq "18" "$(node "$HELPER" run --text-compat --prompt-file "$TEST_TMP/p.txt" -- agy 2>/dev/null | wc -c | tr -d ' ')" "helper --text-compat: response is followed by one newline"
assert_eq "17" "$(node "$HELPER" run --prompt-file "$TEST_TMP/p.txt" -- agy 2>/dev/null | wc -c | tr -d ' ')" "helper default: no added newline"
finalize_test
