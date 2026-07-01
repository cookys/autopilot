#!/usr/bin/env bash
# dispatch-review.sh test — READ-ONLY reviewer dispatch with PATH/--bin-stubbed
# engines (no network, no live LLM). Covers: preconditions (exit 2), verdict parse
# (codex + agy paths), FAIL-CLOSED no_verdict on empty capture, and the read-only
# invariant (no repo mutation, no worktree).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-review.sh"

DIFF="$TEST_TMP/d.diff"
printf '+def f(): return x[::1]\n' > "$DIFF"

# --- stub engine: emits a real verdict (ignores args, reads+discards the prompt) ---
STUB_VERDICT="$TEST_TMP/eng-verdict"
cat > "$STUB_VERDICT" <<'EOF'
#!/usr/bin/env bash
# codex path pipes the prompt on stdin; agy path passes it via -p. Drain stdin if any.
cat >/dev/null 2>&1 || true
echo "VERDICT: FIX-THEN-SHIP"
echo "FINDINGS: the slice does not reverse"
EOF
chmod +x "$STUB_VERDICT"

# --- stub engine: emits NOTHING (proxy for agy stdout-drop / a dead reviewer) ---
STUB_EMPTY="$TEST_TMP/eng-empty"
printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\nexit 0\n' > "$STUB_EMPTY"
chmod +x "$STUB_EMPTY"

# --- stub engine: emits a clean SHIP verdict ---
STUB_SHIP="$TEST_TMP/eng-ship"
printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\necho "VERDICT: SHIP-AS-IS"\necho "FINDINGS: none"\n' > "$STUB_SHIP"
chmod +x "$STUB_SHIP"

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

# 4b. FAIL-TOWARD-BLOCK: prose mentioning 'VERDICT: SHIP-AS-IS' mid-sentence must NOT flip a
# real 'VERDICT: FIX-THEN-SHIP' line into a pass (unanchored first-match grep was fail-OPEN).
STUB_TRICKY="$TEST_TMP/eng-tricky"
cat > "$STUB_TRICKY" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
echo "This is not a VERDICT: SHIP-AS-IS situation; the code is broken."
echo "VERDICT: FIX-THEN-SHIP"
echo "FINDINGS: null deref"
EOF
chmod +x "$STUB_TRICKY"
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_TRICKY" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "tricky reviewed exit 0"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "prose SHIP token does not flip a real FIX verdict (fail-toward-block)"

# 4c. Multi-line FINDINGS are preserved for shell-backed runners.
STUB_MULTI="$TEST_TMP/eng-multi"
cat > "$STUB_MULTI" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
echo "VERDICT: FIX-THEN-SHIP"
echo "FINDINGS:"
echo "line one"
echo '```'
echo "const sample = true"
echo '```'
echo "line two"
EOF
chmod +x "$STUB_MULTI"
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_MULTI" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "multiline findings reviewed exit 0"
assert_contains "$OUT" 'line one' "multiline findings first line captured"
assert_contains "$OUT" 'const sample = true' "multiline findings fenced content captured"
assert_contains "$OUT" 'line two' "multiline findings second line captured"
assert_not_contains "$OUT" '```' "multiline findings omit fence delimiters"

# 4d. A verdict without the required FINDINGS line is fail-closed.
STUB_NO_FINDINGS="$TEST_TMP/eng-no-findings"
cat > "$STUB_NO_FINDINGS" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
echo "VERDICT: SHIP-AS-IS"
EOF
chmod +x "$STUB_NO_FINDINGS"
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_NO_FINDINGS" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "missing FINDINGS exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "missing FINDINGS → no_verdict"

# 4e. Fenced or malformed verdict lines are ignored.
STUB_FENCED="$TEST_TMP/eng-fenced"
cat > "$STUB_FENCED" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
echo '```'
echo "VERDICT: SHIP-AS-IS"
echo '```'
echo "VERDICT: SHIP-AS-IS with trailing prose"
echo "FINDINGS: none"
EOF
chmod +x "$STUB_FENCED"
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_FENCED" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "fenced/malformed verdict exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "fenced/malformed verdict → no_verdict"

# 5. agy path (through the script -qec pseudo-TTY wrapper) with a stub engine
if command -v script >/dev/null 2>&1; then
  OUT="$("$SCRIPT" --runner agy --model "Gemini 3.5 Flash (High)" --diff-file "$DIFF" --bin "$STUB_SHIP" 2>&1)"; EXIT=$?
  assert_eq "0" "$EXIT" "agy reviewed exit 0 (pseudo-TTY capture)"
  assert_contains "$OUT" '"runner": "agy"' "agy runner provenance"
  assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "agy verdict parsed through script -qec"
else
  echo "  (skip agy pseudo-TTY case: 'script' not available)"
fi

# 6. anthropic-compatible: missing token → precondition_failed, exit 2 (no network)
OUT="$(env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_COMPATIBLE_AUTH_TOKEN -u MINIMAX_API_KEY \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "anthropic-compatible missing token exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "anthropic-compatible missing token precondition"
assert_contains "$OUT" '"runner": "anthropic-compatible"' "anthropic-compatible runner provenance"
assert_not_contains "$OUT" 'test-token' "missing-token test does not echo token material"
OUT="$(env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY \
  -u ANTHROPIC_COMPATIBLE_BASE_URL -u AUTOPILOT_MINIMAX_BASE_URL \
  ANTHROPIC_COMPATIBLE_AUTH_TOKEN="test-token-generic" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "anthropic-compatible generic token does not satisfy MiniMax exit 2"
assert_contains "$OUT" 'MINIMAX_API_KEY' "anthropic-compatible MiniMax precondition names provider key"
assert_not_contains "$OUT" 'test-token-generic' "generic-token MiniMax test does not echo token material"
OUT="$(env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_COMPATIBLE_AUTH_TOKEN -u MINIMAX_API_KEY \
  -u ANTHROPIC_COMPATIBLE_BASE_URL -u AUTOPILOT_MINIMAX_BASE_URL \
  ANTHROPIC_API_KEY="test-token-anthropic" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "anthropic-compatible Anthropic key does not satisfy MiniMax exit 2"
assert_contains "$OUT" 'MINIMAX_API_KEY' "anthropic-compatible Anthropic-key precondition names provider key"
assert_not_contains "$OUT" 'test-token-anthropic' "Anthropic-key MiniMax test does not echo token material"
OUT="$(ANTHROPIC_COMPATIBLE_AUTH_TOKEN="test-token-timeout" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" --timeout 5x 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "anthropic-compatible bad timeout exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "anthropic-compatible bad timeout precondition"
assert_not_contains "$OUT" 'test-token-timeout' "bad-timeout test does not echo token material"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://example.com" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="test-token-cleartext" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "anthropic-compatible non-loopback http exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "anthropic-compatible non-loopback http precondition"
assert_contains "$OUT" 'https://' "anthropic-compatible non-loopback http message mentions https"
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
    let text = 'VERDICT: FIX-THEN-SHIP\nFINDINGS:\nfirst finding\n```\nconst sample = true\n```\nsecond finding\n';
    if (calls === 2) {
      text = 'VERDICT: SHIP-AS-IS\n';
    } else if (calls === 3) {
      text = '```\nVERDICT: SHIP-AS-IS\n```\nVERDICT: SHIP-AS-IS with trailing prose\nFINDINGS: none\n';
    }
    const response = {
      debug: `Authorization: Bearer ${expectedToken}`,
      content: [{ type: 'text', text }],
    };
    if (calls === 5) {
      response.stop_reason = 'max_tokens';
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
assert_contains "$OUT" 'const sample = true' "anthropic-compatible mock fenced finding content parsed"
assert_contains "$OUT" 'second finding' "anthropic-compatible mock multiline findings second line parsed"
assert_not_contains "$OUT" '```' "anthropic-compatible mock findings omit fence delimiters"
assert_contains "$OUT" '"runner": "anthropic-compatible"' "anthropic-compatible mock runner provenance"
assert_not_contains "$OUT" "$TEST_AUTH_TOKEN" "mock success output does not leak token"
assert_contains "$(cat "$MOCK_LOG")" 'POST /v1/messages' "mock server received /v1/messages POST"
assert_contains "$(cat "$MOCK_LOG")" 'auth=bearer' "mock server received bearer auth"
assert_contains "$(cat "$MOCK_LOG")" 'model=MiniMax-M3' "mock server received requested model"
RAW_LOG_PATH="$(printf '%s' "$OUT" | sed -n 's/.*"raw_log": "\([^"]*\)".*/\1/p')"
assert_file_exists "$RAW_LOG_PATH" "anthropic-compatible mock raw log exists"
RAW_LOG_CONTENT="$(cat "$RAW_LOG_PATH")"
assert_not_contains "$RAW_LOG_CONTENT" "$TEST_AUTH_TOKEN" "mock raw log redacts echoed auth token"
assert_contains "$RAW_LOG_CONTENT" '<REDACTED>' "mock raw log records redaction marker"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible missing FINDINGS exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible missing FINDINGS → no_verdict"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible fenced/malformed verdict exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible fenced/malformed verdict → no_verdict"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "anthropic-compatible /v1 base-url reviewed exit 0"
assert_not_contains "$(cat "$MOCK_LOG")" 'POST /v1/v1/messages' "anthropic-compatible /v1 base-url does not double-append /v1"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
kill "$MOCK_PID" 2>/dev/null || true
wait "$MOCK_PID" 2>/dev/null || true
assert_eq "1" "$EXIT" "anthropic-compatible max_tokens exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible max_tokens → no_verdict"

# 8. read-only invariant: running inside a git repo mutates NOTHING
RO="$TEST_TMP/ro-repo"; mkdir -p "$RO"
git -C "$RO" init -q -b develop
git -C "$RO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
BEFORE="$(git -C "$RO" rev-parse HEAD)"
( cd "$RO" && "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" >/dev/null 2>&1 )
assert_eq "$BEFORE" "$(git -C "$RO" rev-parse HEAD)" "read-only: HEAD unchanged"
assert_eq "" "$(git -C "$RO" status --porcelain)" "read-only: working tree clean"
assert_eq "" "$(ls "$RO/.git/worktrees" 2>/dev/null)" "read-only: no worktree created"

finalize_test
