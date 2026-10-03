#!/usr/bin/env bash
# dispatch-anthropic-review.js: a max-effort reviewer seat gets a thinking-sized output budget, and a
# thinking-only `stop_reason: max_tokens` response is the NAMED failure `output_budget_exhausted`
# (still a failure — the parser is not relaxed; a thinking-only response never becomes a verdict).
. "$(dirname "$0")/lib.sh"
# RED at f197fc09: FAIL thinking-only max_tokens is the named failure: 'output_budget_exhausted' not found in output
# RED at f197fc09: FAIL default output budget is thinking-sized (16384): '[call=1 max_tokens=16384]' not found in output
JS="$REPO_ROOT/scripts/dispatch-anthropic-review.js"
DIFF="$TEST_TMP/d.diff"; printf 'diff --git a/x b/x\n+x\n' > "$DIFF"
LOG="$TEST_TMP/mock.log"; PORTF="$TEST_TMP/port"; PIDF="$TEST_TMP/pid"
TOK="tok-budget-${RANDOM}"
TOK="$TOK" node - "$LOG" "$PORTF" "$PIDF" <<'NODE' &
const fs = require('fs'), http = require('http');
const [logPath, portPath, pidPath] = process.argv.slice(2);
let calls = 0;
http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    calls += 1;
    const p = JSON.parse(b);
    fs.appendFileSync(logPath, `[call=${calls} max_tokens=${p.max_tokens}]\n`);
    let r;
    if (calls === 1 || calls === 4) {            // thinking only, budget exhausted
      r = { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: 'hmm '.repeat(50) }] };
    } else if (calls === 2) {     // normal verdict (negative control)
      r = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'ok' }, { type: 'text', text: 'VERDICT: FIX-THEN-SHIP\nFINDINGS:\nreal finding\n' }] };
    } else {                      // truncated WITH text: still a failure, but not the thinking-only name
      r = { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'VERDICT: FIX-THEN-SHIP\nFINDINGS:\nreal finding\n' }] };
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r));
  });
}).listen(0, '127.0.0.1', function () {
  fs.writeFileSync(portPath, String(this.address().port)); fs.writeFileSync(pidPath, String(process.pid));
});
NODE
W=0; while { [ ! -f "$PORTF" ] || [ ! -f "$PIDF" ]; } && [ "$W" -lt 50 ]; do sleep 0.1; W=$((W+1)); done
PORT="$(cat "$PORTF")"; MPID="$(cat "$PIDF")"
run() { env -u AUTOPILOT_SESSION_ID ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TOK" node "$JS" --model GLM-5 --diff-file "$DIFF" "$@" 2>&1 < /dev/null; }

OUT="$(run)"; EXIT=$?
assert_eq "1" "$EXIT" "thinking-only max_tokens still fails (exit 1)"
assert_contains "$OUT" '"status": "no_verdict"' "thinking-only max_tokens is no_verdict, never a verdict"
assert_contains "$OUT" 'output_budget_exhausted' "thinking-only max_tokens is the named failure"
assert_contains "$(cat "$LOG")" '[call=1 max_tokens=16384]' "default output budget is thinking-sized (16384)"

OUT="$(run)"; EXIT=$?
assert_eq "0" "$EXIT" "negative control: normal text verdict still parses (exit 0)"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "negative control verdict"
assert_not_contains "$OUT" 'output_budget_exhausted' "negative control is not budget-exhausted"

OUT="$(run)"; EXIT=$?
assert_eq "1" "$EXIT" "truncated response with text still fails"
assert_not_contains "$OUT" 'output_budget_exhausted' "truncated-with-text keeps its own failure, not the thinking-only name"

# Through the shell rail: the named failure must reach the review JSON's error, not a generic transport line.
OUT="$(env -u AUTOPILOT_SESSION_ID ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TOK" \
  bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner anthropic-compatible --model GLM-5 --diff-file "$DIFF" 2>&1 < /dev/null)"; EXIT=$?
assert_eq "1" "$EXIT" "dispatch-review.sh: thinking-only max_tokens exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "dispatch-review.sh: thinking-only max_tokens is no_verdict"
assert_contains "$OUT" 'output_budget_exhausted' "dispatch-review.sh surfaces the named failure"
assert_contains "$(cat "$LOG")" '[call=4 max_tokens=16384]' "dispatch-review.sh rail also sends the thinking-sized budget (16384)"

# Detection must not depend on the stderr line landing at line start: stdout and stderr share RAW_LOG, so
# the bracketed raw-log line the JS appends is matched too, and the bare stderr line still works.
# A copy of scripts/ with a stub transport drives each raw-log shape.
SB="$TEST_TMP/scripts-copy"; cp -r "$REPO_ROOT/scripts" "$SB"
cat > "$SB/dispatch-anthropic-review.js" <<'STUB'
'use strict';
const mode = process.env.STUB_MODE;
if (mode === 'bracketed') {
  process.stdout.write('partial text without newline[dispatch-anthropic-review: x]\n');
  process.stdout.write('\n[dispatch-anthropic-review: output_budget_exhausted: stop_reason=max_tokens with no text block]\n');
} else if (mode === 'stderr') {
  process.stderr.write('output_budget_exhausted: stop_reason=max_tokens with no text block\n');
} else {
  process.stdout.write('\n[dispatch-anthropic-review: request failed — boom]\n');
}
process.exit(1);
STUB
stub_run() { STUB_MODE="$1" env -u AUTOPILOT_SESSION_ID ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TOK" \
  bash "$SB/dispatch-review.sh" --runner anthropic-compatible --model GLM-5 --diff-file "$DIFF" 2>&1 < /dev/null; }
# RED at 8a338ccb: FAIL bracketed raw-log line is detected as the named failure: 'output_budget_exhausted: reviewer spent' not found in output
OUT="$(stub_run bracketed)"
assert_contains "$OUT" '"status": "no_verdict"' "bracketed-only raw log is no_verdict"
assert_contains "$OUT" 'output_budget_exhausted: reviewer spent' "bracketed raw-log line is detected as the named failure"
OUT="$(stub_run stderr)"
assert_contains "$OUT" 'output_budget_exhausted: reviewer spent' "bare stderr line still detected as the named failure"
OUT="$(stub_run other)"
assert_contains "$OUT" '"status": "no_verdict"' "other transport failure is no_verdict"
assert_not_contains "$OUT" 'output_budget_exhausted' "other transport failure keeps the generic message"

kill "$MPID" 2>/dev/null
finalize_test
