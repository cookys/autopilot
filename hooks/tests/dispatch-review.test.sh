#!/usr/bin/env bash
# dispatch-review.sh test — READ-ONLY reviewer dispatch with PATH/--bin-stubbed
# engines (no network, no live LLM). Covers: preconditions (exit 2), verdict parse
# (codex + agy paths), FAIL-CLOSED no_verdict on empty capture, and the read-only
# invariant (no repo mutation, no worktree).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-review.sh"

DIFF="$TEST_TMP/d.diff"
printf '+def f(): return x[::1]\n' > "$DIFF"

STUB_MARKER="$TEST_TMP/eng-marker"
cat > "$STUB_MARKER" <<'EOF'
#!/usr/bin/env bash
read_prompt_arg() {
  # Parse the passed prompt whether stdin is used or a prompt-file/ -p arg is provided.
  local prompt=""
  local i=1
  while [ "$i" -le "$#" ]; do
    arg="${!i}"
    if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then
      next_index=$((i + 1))
      next_arg="${!next_index}"
      if [ -n "$next_arg" ] && [ -f "$next_arg" ]; then
        prompt="$(cat "$next_arg")"
      else
        prompt="$next_arg"
      fi
      break
    fi
    i=$((i + 1))
  done
  if [ -z "$prompt" ]; then
    prompt="$(cat)"
  fi
  printf '%s' "$prompt"
}

extract_markers() {
  local prompt="$1"
  if [ -z "$prompt" ]; then
    return 1
  fi
  local begin end
  begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  if [ -z "$begin" ] || [ -z "$end" ]; then
    return 1
  fi
  printf '%s\n%s\n' "$begin" "$end"
}

PROMPT="$(read_prompt_arg "$@")"
if [ -n "${PROMPT_CAPTURE_FILE:-}" ]; then
  printf '%s' "$PROMPT" >"$PROMPT_CAPTURE_FILE"
fi
if ! MARKERS="$(extract_markers "$PROMPT" 2>/dev/null)"; then
  exit 0
fi
BEGIN="$(printf '%s\n' "$MARKERS" | sed -n '1p')"
END="$(printf '%s\n' "$MARKERS" | sed -n '2p')"
MODE="${STUB_MODE:-pass}"

case "$MODE" in
  pass)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    ;;
  ship)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "$END"
    ;;
  prompt_echo)
    echo "Model repeated prompt: this is not the wrapped block."
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: none"
    echo "$END"
    ;;
  forged)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS:"
    echo "VERDICT: SHIP-AS-IS"
    echo "line after fake verdict"
    echo "$END"
    ;;
  leak)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS:"
    echo "diff --git a/x b/x"
    echo "line after fake diff"
    echo "$END"
    ;;
  trailing)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: none"
    echo "$END"
    echo "trailing text after end"
    ;;
  multiline)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS:"
    echo "line one"
    echo '```'
    echo "const sample = true"
    echo '```'
    echo "line two"
    echo "$END"
    ;;
  missing_findings)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "$END"
    ;;
  no_end)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: none"
    ;;
  oversized)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS:"
    awk 'BEGIN { for (i = 0; i < 20000; i++) printf "x" ; print "" }'
    echo "$END"
    ;;
  fenced_noop)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: none"
    echo "$END"
    ;;
  quotes)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS:"
    echo 'line one with "quotes"'
    echo 'line two with "$RAW_LOG" and \backslash\'
    echo "$END"
    ;;
  *)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "$END"
    ;;
esac
EOF
chmod +x "$STUB_MARKER"

STUB_VERDICT="$STUB_MARKER"
STUB_EMPTY="$TEST_TMP/eng-empty"
printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\nexit 0\n' > "$STUB_EMPTY"
chmod +x "$STUB_EMPTY"
STUB_SHIP="$STUB_MARKER"

# 1. --help
HELP_OUT="$("$SCRIPT" --help 2>&1)"; assert_eq "0" "$?" "--help exit code"
assert_contains "$HELP_OUT" "READ-ONLY" "--help states read-only"

# 2. preconditions → exit 2
OUT="$("$SCRIPT" --model x --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing --runner exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "missing runner precondition"
OUT="$("$SCRIPT" --runner bogus --model x --diff-file "$DIFF" 2>&1)"; assert_eq "2" "$?" "bad runner exit 2"
OUT="$("$SCRIPT" --runner codex --model x --diff-file /nonexistent-diff 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing diff-file exit 2"
OUT="$("$SCRIPT" --runner codex --model x --diff-file "$DIFF" --spec-file /nonexistent-spec 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing spec-file exit 2"
OUT="$("$SCRIPT" --runner codex --model x --diff-file "$DIFF" --effort turbo 2>&1)"; assert_eq "2" "$?" "bad effort exit 2"

# 3. codex path: verdict parsed → reviewed, exit 0
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "codex reviewed exit 0"
assert_contains "$OUT" '"status": "reviewed"' "codex reviewed status"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "codex verdict parsed"
assert_contains "$OUT" 'does not reverse' "codex findings captured"

# 4. FAIL-CLOSED: empty capture → no_verdict, exit 1 (NEVER a pass)
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_EMPTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "empty capture exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "empty → no_verdict"
assert_contains "$OUT" '"verdict": null' "no_verdict has null verdict"
assert_not_contains "$OUT" 'SHIP-AS-IS' "empty capture is NEVER read as a ship verdict"

# 4b. Whole-prompt echo is rejected if the first non-empty line is not the marker.
OUT="$(STUB_MODE=prompt_echo "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "prompt-echo output no_verdict"
assert_contains "$OUT" '"status": "no_verdict"' "prompt-echo output is no_verdict"

# 4c. Multi-line FINDINGS are preserved for shell-backed runners.
OUT="$(STUB_MODE=multiline "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "multiline findings reviewed exit 0"
assert_contains "$OUT" 'line one' "multiline findings first line captured"
assert_contains "$OUT" 'line two' "multiline findings second line captured"
assert_not_contains "$OUT" '```' "multiline findings omit fence delimiters"

# 4d. A verdict without the required FINDINGS line is fail-closed.
OUT="$(STUB_MODE=missing_findings "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "missing FINDINGS exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "missing FINDINGS → no_verdict"

# 4e. Extra/duplicated VERDICT token is rejected by the single-verdict guard.
OUT="$(STUB_MODE=forged "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "forged verdict content exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "forged diff content → no_verdict"

# 4f. Diff-leakage text is rejected by the leak guard.
OUT="$(STUB_MODE=leak "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "leak content exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "leakage content → no_verdict"

# 4g. Content after END is rejected (trailing non-blank payload).
OUT="$(STUB_MODE=trailing "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "trailing content after END exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "trailing content after END → no_verdict"

# 4h. Oversized wrapped block is rejected.
OUT="$(STUB_MODE=oversized "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "oversized block exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "oversized block → no_verdict"

# 4i. Missing END marker is rejected.
OUT="$(STUB_MODE=no_end "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "missing END exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "missing END → no_verdict"

# 5. agy path (through the script -qec pseudo-TTY wrapper) with a stub engine
if command -v script >/dev/null 2>&1; then
  OUT="$(STUB_MODE=ship "$SCRIPT" --runner agy --model "Gemini 3.5 Flash (High)" --diff-file "$DIFF" --bin "$STUB_SHIP" 2>&1)"; EXIT=$?
  assert_eq "0" "$EXIT" "agy reviewed exit 0 (pseudo-TTY capture)"
  assert_contains "$OUT" '"runner": "agy"' "agy runner provenance"
  assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "agy verdict parsed through script -qec"
else
  echo "  (skip agy pseudo-TTY case: 'script' not available)"
fi

# 6. anthropic-compatible: transport precondition failures collapse to no_verdict, exit 1 (no network)
OUT="$(env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_COMPATIBLE_AUTH_TOKEN -u MINIMAX_API_KEY \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible missing token exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible missing token no_verdict"
assert_contains "$OUT" '"runner": "anthropic-compatible"' "anthropic-compatible runner provenance"
assert_not_contains "$OUT" 'test-token' "missing-token test does not echo token material"
OUT="$(env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY \
  -u ANTHROPIC_COMPATIBLE_BASE_URL -u AUTOPILOT_MINIMAX_BASE_URL \
  ANTHROPIC_COMPATIBLE_AUTH_TOKEN="test-token-generic" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible generic token does not satisfy MiniMax exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible generic token no_verdict"
assert_not_contains "$OUT" 'test-token-generic' "generic-token MiniMax test does not echo token material"
OUT="$(env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_COMPATIBLE_AUTH_TOKEN -u MINIMAX_API_KEY \
  -u ANTHROPIC_COMPATIBLE_BASE_URL -u AUTOPILOT_MINIMAX_BASE_URL \
  ANTHROPIC_API_KEY="test-token-anthropic" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible Anthropic key does not satisfy MiniMax exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible Anthropic key no_verdict"
assert_not_contains "$OUT" 'test-token-anthropic' "Anthropic-key MiniMax test does not echo token material"
OUT="$(ANTHROPIC_COMPATIBLE_AUTH_TOKEN="test-token-timeout" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" --timeout 5x 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "anthropic-compatible bad timeout exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "anthropic-compatible bad timeout precondition"
assert_not_contains "$OUT" 'test-token-timeout' "bad-timeout test does not echo token material"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://example.com" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="test-token-cleartext" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible non-loopback http exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible non-loopback http precondition"
assert_not_contains "$OUT" 'test-token-cleartext' "non-loopback http test does not echo token material"
DIFF_DIR="$TEST_TMP/diff-dir"; mkdir -p "$DIFF_DIR"
OUT="$(ANTHROPIC_COMPATIBLE_AUTH_TOKEN="test-token-diffdir" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF_DIR" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "anthropic-compatible directory diff-file exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "anthropic-compatible directory diff-file precondition"
assert_not_contains "$OUT" "$DIFF_DIR" "directory diff-file error does not echo path"
assert_not_contains "$OUT" 'test-token-diffdir' "directory diff-file test does not echo token material"

# 7. anthropic-compatible: mock HTTP server returns a verdict → reviewed, exit 0
MOCK_LOG="$TEST_TMP/mock-anthropic.log"
MOCK_PORT_FILE="$TEST_TMP/mock-port"
MOCK_PID_FILE="$TEST_TMP/mock-pid"
TEST_AUTH_TOKEN="test-token-redaction-${RANDOM}-${RANDOM}"
TEST_AUTH_TOKEN="$TEST_AUTH_TOKEN" node - "$MOCK_LOG" "$MOCK_PORT_FILE" "$MOCK_PID_FILE" <<'NODE' &
const fs = require('fs');
const http = require('http');
const logPath = process.argv[2];
const portPath = process.argv[3];
const pidPath = process.argv[4];
const expectedToken = process.env.TEST_AUTH_TOKEN;
let calls = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    calls += 1;
    const auth = req.headers.authorization || '';
    fs.appendFileSync(logPath, `[${req.method} ${req.url}]\n`);
    fs.appendFileSync(logPath, `[auth=${auth.startsWith('Bearer ') ? 'bearer' : 'missing'}]\n`);
    if (req.headers['x-api-key']) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":"unexpected x-api-key"}');
      return;
    }
    if (auth !== `Bearer ${expectedToken}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"error":"missing auth"}');
      return;
    }
    const payload = JSON.parse(body);
    fs.appendFileSync(logPath, `[model=${payload.model}]\n`);
    if (Object.prototype.hasOwnProperty.call(payload, 'thinking')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":"unexpected thinking"}');
      return;
    }
    if (!Array.isArray(payload.messages?.[0]?.content) || payload.messages[0].content[0]?.type !== 'text') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":"bad content blocks"}');
      return;
    }
    const prompt = String(payload.messages[0].content[0].text || '');
    const beginMatch = prompt.match(/<<<AUTOPILOT-REVIEW-[0-9a-f]{32}>>>/);
    const endMatch = prompt.match(/<<<AUTOPILOT-END-[0-9a-f]{32}>>>/);
    const nonceBegin = beginMatch ? beginMatch[0] : '<<<AUTOPILOT-REVIEW-MISSING>>>';
    const nonceEnd = endMatch ? endMatch[0] : '<<<AUTOPILOT-END-MISSING>>>';
    const wrapped = (text) => `${nonceBegin}\n${text}\n${nonceEnd}`;
    const response = {
      debug: `Authorization: Bearer ${expectedToken}`,
      content: [{ type: 'text', text: wrapped('VERDICT: FIX-THEN-SHIP\nFINDINGS:\nfirst finding\n```\nconst sample = true\n```\nsecond finding\n') }],
    };
    if (calls === 2) {
      response.content[0].text = wrapped('VERDICT: SHIP-AS-IS');
    } else if (calls === 3) {
      response.content[0].text = wrapped('```\nVERDICT: SHIP-AS-IS\n```\nVERDICT: SHIP-AS-IS with trailing prose\nFINDINGS: none\n');
    } else if (calls === 4) {
      response.content[0].text = `Model repeated prompt.\n${wrapped('VERDICT: FIX-THEN-SHIP\nFINDINGS: none\n')}`;
    } else if (calls === 5) {
      response.content[0].text = wrapped('VERDICT: FIX-THEN-SHIP\nFINDINGS:\ndiff --git a/x b/x\nline after fake diff\n');
    }
    if (calls === 7) {
      response.stop_reason = 'max_tokens';
      response.content[0].text = wrapped('VERDICT: SHIP-AS-IS\nFINDINGS: none\n');
    } else if (calls === 8) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('x'.repeat(1024 * 1024 + 1));
      return;
    } else if (calls === 9) {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(response));
      }, 1500);
      return;
    } else if (calls === 10) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"intentional"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
});
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  fs.writeFileSync(portPath, String(port));
  fs.writeFileSync(pidPath, String(process.pid));
});
NODE
MOCK_WAIT=0
while { [ ! -f "$MOCK_PORT_FILE" ] || [ ! -f "$MOCK_PID_FILE" ]; } && [ "$MOCK_WAIT" -lt 50 ]; do sleep 0.1; MOCK_WAIT=$((MOCK_WAIT + 1)); done
assert_file_exists "$MOCK_PORT_FILE" "mock anthropic server published port"
assert_file_exists "$MOCK_PID_FILE" "mock anthropic server published pid"
MOCK_PORT="$(cat "$MOCK_PORT_FILE")"
MOCK_PID="$(cat "$MOCK_PID_FILE")"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "anthropic-compatible mock reviewed exit 0"
assert_contains "$OUT" '"status": "reviewed"' "anthropic-compatible mock reviewed status"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "anthropic-compatible mock verdict parsed"
assert_contains "$OUT" 'first finding' "anthropic-compatible mock multiline findings first line parsed"
assert_contains "$OUT" 'second finding' "anthropic-compatible mock multiline findings second line parsed"
assert_not_contains "$OUT" '```' "anthropic-compatible mock findings omit fence delimiters"
assert_contains "$OUT" '"runner": "anthropic-compatible"' "anthropic-compatible mock runner provenance"
assert_not_contains "$OUT" "$TEST_AUTH_TOKEN" "mock success output does not leak token"
assert_contains "$(cat "$MOCK_LOG")" 'POST /v1/messages' "mock server received /v1/messages POST"
assert_contains "$(cat "$MOCK_LOG")" 'auth=bearer' "mock server received bearer auth"
assert_contains "$(cat "$MOCK_LOG")" 'model=MiniMax-M3' "mock server received requested model"
RAW_LOG_PATH="$(printf '%s' "$OUT" | sed -n 's/.*"raw_log"[[:space:]]*:[[:space:]]*"\([^\"]*\)".*/\1/p')"
assert_file_exists "$RAW_LOG_PATH" "anthropic-compatible mock raw log exists"
RAW_LOG_CONTENT="$(cat "$RAW_LOG_PATH")"
assert_not_contains "$RAW_LOG_CONTENT" "$TEST_AUTH_TOKEN" "mock raw log redacts echoed auth token"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible missing FINDINGS exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible missing FINDINGS → no_verdict"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible fenced/malformed verdict exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible fenced/malformed verdict → no_verdict"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible prompt-echo output exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible prompt-echo output → no_verdict"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible diff-leak inside wrapped block exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible diff-leak inside wrapped block → no_verdict"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "anthropic-compatible /v1 base-url reviewed exit 0"
assert_not_contains "$(cat "$MOCK_LOG")" 'POST /v1/v1/messages' "anthropic-compatible /v1 base-url does not double-append /v1"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible max_tokens exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible max_tokens → no_verdict"
assert_not_contains "$(cat "$MOCK_LOG")" 'POST /v1/v1/messages' "anthropic-compatible max_tokens does not double-append /v1"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible oversized response exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible oversized response → no_verdict"
assert_not_contains "$OUT" "$TEST_AUTH_TOKEN" "anthropic-compatible oversized response does not leak token"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" --timeout 1s 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible HTTP timeout exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible HTTP timeout → no_verdict"
assert_not_contains "$OUT" "$TEST_AUTH_TOKEN" "anthropic-compatible timeout does not leak token"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible non-zero JS exit maps to no_verdict"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible JS non-zero exit maps to no_verdict"
kill "$MOCK_PID" 2>/dev/null || true
wait "$MOCK_PID" 2>/dev/null || true

# 8. read-only invariant: running inside a git repo mutates NOTHING
RO="$TEST_TMP/ro-repo"; mkdir -p "$RO"
git -C "$RO" init -q -b develop
git -C "$RO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
BEFORE="$(git -C "$RO" rev-parse HEAD)"
( cd "$RO" && "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" >/dev/null 2>&1 )
assert_eq "$BEFORE" "$(git -C "$RO" rev-parse HEAD)" "read-only: HEAD unchanged"
assert_eq "" "$(git -C "$RO" status --porcelain)" "read-only: working tree clean"
assert_eq "" "$(ls "$RO/.git/worktrees" 2>/dev/null)" "read-only: no worktree created"

# 9. passive capture test: a reviewer failure that indicates quota exhaustion
# does NOT alter the exit code (exit 1) or status (no_verdict), but records the
# event in the capability store.
STUB_QUOTA_FAIL_REVIEW="$TEST_TMP/eng-quota-fail-review"
cat > "$STUB_QUOTA_FAIL_REVIEW" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
echo "ERROR: OpenAI billing quota exceeded" >&2
exit 1
EOF
chmod +x "$STUB_QUOTA_FAIL_REVIEW"

CAP_TEST_DIR_REVIEW="$TEST_TMP/cap-store-review"
export ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR_REVIEW"
rm -rf "$CAP_TEST_DIR_REVIEW"

OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_QUOTA_FAIL_REVIEW" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "quota failure exit code remains 1 for review"
assert_contains "$OUT" '"status": "no_verdict"' "quota failure status remains no_verdict for review"

# Verify that the event was recorded in the capability store
assert_file_exists "$CAP_TEST_DIR_REVIEW/capability.jsonl" "capability store contains recorded review event"
recorded_status_review="$(node "$REPO_ROOT/scripts/engine-capability-state.js" current --runner codex --model gpt-5.5 --role reviewer --store "$CAP_TEST_DIR_REVIEW" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0, 'utf8')).capability.quota.status)")"
assert_eq "exhausted" "$recorded_status_review" "recorded review quota status is exhausted"

# Regression Test 1: codex-chrome stub
STUB_CODEX_CHROME="$TEST_TMP/eng-codex-chrome"
cat > "$STUB_CODEX_CHROME" <<'EOF'
#!/usr/bin/env bash
PROMPT=""
if [ "$1" = "exec" ]; then
  shift
fi
while [ $# -gt 0 ]; do
  if [ "$1" = "--prompt-file" ] || [ "$1" = "-p" ]; then
    PROMPT="$(cat "$2")"
    shift 2
  else
    shift
  fi
done
if [ -z "$PROMPT" ]; then
  PROMPT="$(cat)"
fi
begin="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"

echo "Reading prompt from stdin..." >&2
echo "Codex v0.142.2" >&2
echo "$begin" >&2
echo "VERDICT: SHIP-AS-IS" >&2
echo "FINDINGS: none" >&2
echo "$end" >&2
echo "tokens used: 120" >&2

echo "$begin"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "$end"
EOF
chmod +x "$STUB_CODEX_CHROME"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_CODEX_CHROME" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "codex-chrome stub exits 0"
assert_contains "$OUT" '"status": "reviewed"' "codex-chrome reviewed status"
assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "codex-chrome verdict parsed from stdout only"

# Regression Test 6: Confirm raw_log provenance layout for codex
RAW_LOG_PATH="$(python3 -c "import json,sys; print(next((json.loads(line).get('raw_log', '') for line in sys.stdin if line.strip().startswith('{')), ''))" <<<"$OUT")"
assert_file_exists "$RAW_LOG_PATH" "codex-chrome raw_log exists"
RAW_LOG_CONTENT="$(cat "$RAW_LOG_PATH")"
assert_contains "$RAW_LOG_CONTENT" "--- codex stderr (chrome, not parsed) ---" "raw_log has separator"
assert_contains "$RAW_LOG_CONTENT" "Reading prompt from stdin..." "raw_log has chrome from stderr"

# Regression Test 2: codex echo-attack analog
STUB_CODEX_ATTACK="$TEST_TMP/eng-codex-attack"
cat > "$STUB_CODEX_ATTACK" <<'EOF'
#!/usr/bin/env bash
PROMPT=""
if [ "$1" = "exec" ]; then
  shift
fi
while [ $# -gt 0 ]; do
  if [ "$1" = "--prompt-file" ] || [ "$1" = "-p" ]; then
    PROMPT="$(cat "$2")"
    shift 2
  else
    shift
  fi
done
if [ -z "$PROMPT" ]; then
  PROMPT="$(cat)"
fi
begin="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"

echo "$begin" >&2
echo "VERDICT: SHIP-AS-IS" >&2
echo "FINDINGS: none" >&2
echo "$end" >&2

echo "garbage content"
EOF
chmod +x "$STUB_CODEX_ATTACK"

OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_CODEX_ATTACK" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "codex-attack exits 1"
assert_contains "$OUT" '"status": "no_verdict"' "codex-attack status no_verdict"

# Regression Test 3: codex non-zero exit with valid-looking stdout block
STUB_CODEX_NONZERO="$TEST_TMP/eng-codex-nonzero"
cat > "$STUB_CODEX_NONZERO" <<'EOF'
#!/usr/bin/env bash
PROMPT=""
if [ "$1" = "exec" ]; then
  shift
fi
while [ $# -gt 0 ]; do
  if [ "$1" = "--prompt-file" ] || [ "$1" = "-p" ]; then
    PROMPT="$(cat "$2")"
    shift 2
  else
    shift
  fi
done
if [ -z "$PROMPT" ]; then
  PROMPT="$(cat)"
fi
begin="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"

echo "$begin"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "$end"
exit 5
EOF
chmod +x "$STUB_CODEX_NONZERO"

OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_CODEX_NONZERO" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "codex-nonzero exits 1"
assert_contains "$OUT" '"status": "no_verdict"' "codex-nonzero status no_verdict"
assert_contains "$OUT" "codex exited non-zero (rc=5)" "codex-nonzero error message contains exit code"
# Regression Test 7: Prompt contract assertions (explicit closing-marker instruction)
CAPTURED_PROMPT_FILE="$TEST_TMP/captured-prompt"
STUB_CAPTURE="$TEST_TMP/eng-prompt-capture"
cat > "$STUB_CAPTURE" <<'EOF'
#!/usr/bin/env bash
cat > "$CAPTURED_PROMPT_FILE"
PROMPT="$(cat "$CAPTURED_PROMPT_FILE")"
begin="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
echo "$begin"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "$end"
EOF
chmod +x "$STUB_CAPTURE"

export CAPTURED_PROMPT_FILE
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_CAPTURE" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "prompt-capture stub exits 0"

PROMPT_CONTENT="$(cat "$CAPTURED_PROMPT_FILE")"
begin_marker="$(printf '%s\n' "$PROMPT_CONTENT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end_marker="$(printf '%s\n' "$PROMPT_CONTENT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"

assert_neq "" "$begin_marker" "begin_marker extracted"
assert_neq "" "$end_marker" "end_marker extracted"

expected_begin_block="Output your verdict with NO other text, prose, or fences. Its ENTIRE output MUST begin with:
$begin_marker
VERDICT: SHIP-AS-IS or FIX-THEN-SHIP
FINDINGS: one finding per line, or the single word none"

expected_end_block="and its ENTIRE output MUST end with:
$end_marker"

assert_contains "$PROMPT_CONTENT" "$expected_begin_block" "prompt contains begin-with instruction followed by BEGIN marker"
assert_contains "$PROMPT_CONTENT" "$expected_end_block" "prompt contains end-with instruction followed by END marker"

suffix_from_end_instr="${PROMPT_CONTENT#*"$expected_end_block"}"
assert_contains "$suffix_from_end_instr" "Diff under review:" "END-marker instruction appears before Diff under review:"

# Regression Test 8: spec-file inclusion
SPEC="$TEST_TMP/task.spec"
printf 'Spec file baseline text\n' > "$SPEC"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --spec-file "$SPEC" --bin "$STUB_CAPTURE" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "spec-file prompt-capture stub exits 0"
PROMPT_CONTENT="$(cat "$CAPTURED_PROMPT_FILE")"
assert_contains "$PROMPT_CONTENT" "Task specification (baseline — DISPATCHER-AUTHORED, trusted):" "prompt contains spec header"
assert_contains "$PROMPT_CONTENT" "Spec file baseline text" "prompt contains spec file text"
assert_contains "$PROMPT_CONTENT" "Diff under review:" "prompt still contains Diff under review:"

# Regression Test 9: checklist routing in prompt
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_CAPTURE" --checklists "authz-boundary,tenant-boundary" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "checklist prompt-capture stub exits 0"
PROMPT_CONTENT="$(cat "$CAPTURED_PROMPT_FILE")"
assert_contains "$PROMPT_CONTENT" "Adversarial checklist (must check these closely):" "prompt contains checklist section when checklists set"
assert_contains "$PROMPT_CONTENT" "- authz-boundary" "prompt includes authz-boundary checklist item"
assert_contains "$PROMPT_CONTENT" "- tenant-boundary" "prompt includes tenant-boundary checklist item"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_CAPTURE" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "no-checklist prompt-capture stub exits 0"
PROMPT_CONTENT="$(cat "$CAPTURED_PROMPT_FILE")"
assert_not_contains "$PROMPT_CONTENT" "Adversarial checklist (must check these closely):" "prompt omits checklist section when --checklists is absent"

# Regression Test: multi-line findings containing double quotes/backslashes must produce valid parseable JSON.
OUT="$(STUB_MODE=quotes DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "quotes stub exits 0"
node -e 'JSON.parse(process.argv[1])' "$OUT"
assert_eq "0" "$?" "emitted JSON with multi-line quotes is valid and parseable"

finalize_test
