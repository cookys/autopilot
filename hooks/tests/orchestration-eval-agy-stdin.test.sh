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
finalize_test
