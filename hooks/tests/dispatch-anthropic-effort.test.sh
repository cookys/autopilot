#!/usr/bin/env bash
# BL-0354: an anthropic-compatible review seat is qualified with body output_config.effort; the daily
# review must send the same field. dispatch-anthropic-review.js takes --effort, dispatch-review.sh
# forwards the seat's explicit effort, and the cc-shim path keeps its own claude --effort argv.
. "$(dirname "$0")/lib.sh"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
JS="$REPO_ROOT/scripts/dispatch-anthropic-review.js"
DIFF="$TEST_TMP/d.diff"; printf 'diff --git a/x b/x\n+x\n' > "$DIFF"
LOG="$TEST_TMP/bodies.log"; PORTF="$TEST_TMP/port"; PIDF="$TEST_TMP/pid"
TOK="tok-effort-${RANDOM}"
node - "$LOG" "$PORTF" "$PIDF" <<'NODE' &
const fs = require('fs'), http = require('http');
const [logPath, portPath, pidPath] = process.argv.slice(2);
http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const p = JSON.parse(b);
    fs.appendFileSync(logPath, `[oc=${p.output_config ? JSON.stringify(p.output_config) : 'absent'}]\n`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'VERDICT: SHIP\nFINDINGS:\nnone\n' }] }));
  });
}).listen(0, '127.0.0.1', function () {
  fs.writeFileSync(portPath, String(this.address().port)); fs.writeFileSync(pidPath, String(process.pid));
});
NODE
W=0; while { [ ! -f "$PORTF" ] || [ ! -f "$PIDF" ]; } && [ "$W" -lt 50 ]; do sleep 0.1; W=$((W+1)); done
PORT="$(cat "$PORTF")"; MPID="$(cat "$PIDF")"
run() { env -u AUTOPILOT_SESSION_ID ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TOK" node "$JS" --model GLM-5 --diff-file "$DIFF" "$@" 2>&1 < /dev/null; }

# (a) --effort high reaches the body
: > "$LOG"; run --effort high > /dev/null
assert_contains "$(cat "$LOG")" '[oc={"effort":"high"}]' "(a) --effort high puts output_config.effort=high in the body"
: > "$LOG"; run --effort max > /dev/null
assert_contains "$(cat "$LOG")" '[oc={"effort":"max"}]' "(a) --effort max is a legal messages value"
# (b) no --effort: body unchanged, no output_config
: > "$LOG"; run > /dev/null
assert_eq "[oc=absent]" "$(cat "$LOG")" "(b) without --effort the body carries no output_config"
# (c) illegal value: precondition failure, nothing sent
: > "$LOG"; OUT="$(run --effort turbo)"; EXIT=$?
assert_eq "2" "$EXIT" "(c) illegal --effort exits 2"
assert_contains "$OUT" '--effort must be one of' "(c) illegal --effort is named"
assert_eq "" "$(cat "$LOG")" "(c) illegal --effort sends no request"
: > "$LOG"; run --effort > /dev/null; EXIT=$?
assert_eq "2" "$EXIT" "(c) dangling --effort exits 2"

# (d) dispatch-review.sh forwards the explicit effort to the anthropic-compatible runner
SB="$TEST_TMP/scripts-copy"; cp -r "$REPO_ROOT/scripts" "$SB"
ARGV="$TEST_TMP/argv.log"
cat > "$SB/dispatch-anthropic-review.js" <<'STUB'
'use strict';
require('fs').appendFileSync(process.env.ARGV_LOG, `ARGV:${process.argv.slice(2).join(' ')}\n`);
process.stdout.write('VERDICT: SHIP\nFINDINGS:\nnone\n');
STUB
rail() { env -u AUTOPILOT_SESSION_ID ARGV_LOG="$ARGV" ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TOK" \
  bash "$SB/dispatch-review.sh" --runner anthropic-compatible --model GLM-5 --diff-file "$DIFF" "$@" > /dev/null 2>&1 < /dev/null; }
: > "$ARGV"; rail --effort high
assert_contains "$(cat "$ARGV")" '--effort high' "(d) dispatch-review.sh forwards --effort high to dispatch-anthropic-review.js"
: > "$ARGV"; rail
assert_not_contains "$(cat "$ARGV")" '--effort' "(d) an unspecified effort is not forwarded (script default is not a seat decision)"
: > "$ARGV"; rail --effort default
assert_not_contains "$(cat "$ARGV")" '--effort' "(d) --effort default forwards nothing"

# (e) cc-shim path keeps claude's own --effort and never touches the anthropic runner
FAKEBIN="$TEST_TMP/fakebin"; mkdir -p "$FAKEBIN"
cat > "$FAKEBIN/claude" <<'FAKE'
#!/usr/bin/env bash
printf 'CLAUDE:%s\n' "$*" >> "$ARGV_LOG"
echo 'VERDICT: SHIP'; echo 'FINDINGS:'; echo none
FAKE
chmod +x "$FAKEBIN/claude"
: > "$ARGV"
env -u AUTOPILOT_SESSION_ID ARGV_LOG="$ARGV" AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1" AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t" \
  bash "$SB/dispatch-review.sh" --runner cc-shim --model GLM-5 --endpoint TESTEP --bin "$FAKEBIN/claude" --effort high --diff-file "$DIFF" > /dev/null 2>&1 < /dev/null
assert_contains "$(cat "$ARGV")" '--effort high' "(e) cc-shim still passes claude --effort high"
assert_not_contains "$(cat "$ARGV")" 'ARGV:' "(e) cc-shim never runs the anthropic-compatible runner"

kill "$MPID" 2>/dev/null
finalize_test
