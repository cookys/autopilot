#!/usr/bin/env bash
# dispatch-review.sh test, shard c (split from dispatch-review.test.sh for wall time).
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"

# --- cleanroom seat (portable stubs; RED at base ceb7c81d) ---
CR_PKT="$TEST_TMP/cleanroom-packet"
mkdir -p "$CR_PKT/tree"
printf '{}\n' > "$CR_PKT/MANIFEST.json"
printf 'tree-ok\n' > "$CR_PKT/tree/README.md"
CR_AUTH="$TEST_TMP/cleanroom-auth.json"
printf '{"dummy":true}\n' > "$CR_AUTH"
CR_BINDIR="$TEST_TMP/cleanroom-codex-bin"
mkdir -p "$CR_BINDIR"
CR_CODEX="$CR_BINDIR/codex"
printf '#!/usr/bin/env bash\nexit 99\n' > "$CR_CODEX"
chmod +x "$CR_CODEX"
printf 'host\n' > "$CR_BINDIR/codex-code-mode-host"
CR_BWRAP="$TEST_TMP/fake-bwrap"
printf '#!/usr/bin/env bash\nexit 0\n' > "$CR_BWRAP"
chmod +x "$CR_BWRAP"
CR_LAUNCHER="$TEST_TMP/stub-cleanroom-launch.sh"
CR_LAUNCH_LOG="$TEST_TMP/cleanroom-launch-modes.log"
CR_LAUNCH_ARGV="$TEST_TMP/cleanroom-launch.argv"
cat > "$CR_LAUNCHER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
: "${CR_LAUNCH_LOG:?}"
printf '%s\n' "$*" >> "$CR_LAUNCH_LOG"
if [ "${1:-}" = "--preflight" ] || grep -q -- '--preflight' < <(printf '%s\n' "$@"); then
  printf 'preflight\n' >> "$CR_LAUNCH_LOG"
  if [ "${CR_PREFLIGHT_RC:-0}" != "0" ]; then
    echo "${CR_PREFLIGHT_ERR:-preflight failed}" >&2
    exit "${CR_PREFLIGHT_RC}"
  fi
  printf '{ "schema_version": 1, "artifact_type": "cleanroom_launch", "profile": "preflight", "exit_status": 0, "timed_out": false, "seat_root_removed": true, "seat_root": "/tmp/x" }\n'
  exit 0
fi
printf 'launch\n' >> "$CR_LAUNCH_LOG"
printf '%s\n' "$@" > "$CR_LAUNCH_ARGV"
out=""
err=""
prompt=""
i=1
while [ "$i" -le "$#" ]; do
  eval "a=\${$i}"
  if [ "$a" = "--out" ]; then i=$((i+1)); eval "out=\${$i}"; fi
  if [ "$a" = "--err" ]; then i=$((i+1)); eval "err=\${$i}"; fi
  if [ "$a" = "--prompt-file" ]; then i=$((i+1)); eval "prompt=\${$i}"; fi
  i=$((i+1))
done
: "${out:?}" "${err:?}" "${prompt:?}"
begin="$(sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' "$prompt" | sed -n '1p')"
end="$(sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' "$prompt" | sed -n '1p')"
if [ "${CR_LAUNCH_RC:-0}" = "124" ]; then
  printf 'timed out\n' > "$out"
  printf 'timeout chrome\n' > "$err"
  printf '{ "schema_version": 1, "artifact_type": "cleanroom_launch", "profile": "codex", "exit_status": 124, "timed_out": true, "seat_root_removed": true, "seat_root": "/tmp/x" }\n'
  exit 124
fi
{
  echo "$begin"
  echo "VERDICT: SHIP-AS-IS"
  echo "FINDINGS: none"
  echo "NO-FINDING-PROOF: checked=diff and supplied acceptance criteria; evidence=target behavior was traced against the fixture; conclusion=no concrete blocking discrepancy was observed"
  echo "$end"
} > "$out"
printf '' > "$err"
printf '{ "schema_version": 1, "artifact_type": "cleanroom_launch", "profile": "codex", "exit_status": 0, "timed_out": false, "seat_root_removed": true, "seat_root": "/tmp/x" }\n'
exit 0
EOF
chmod +x "$CR_LAUNCHER"

# RED at base ceb7c81d: bwrap missing was never reached (no-tools gate first)
OUT="$(AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$CR_PKT" \
  AUTOPILOT_CLEANROOM_BWRAP=/nonexistent AUTOPILOT_CLEANROOM_LAUNCHER="$CR_LAUNCHER" \
  AUTOPILOT_CLEANROOM_CODEX_AUTH="$CR_AUTH" AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
  "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$CR_CODEX" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "blind cleanroom with missing bwrap is exit 2"
assert_contains "$OUT" 'bwrap not found' "missing bwrap names bwrap"

# Panel finding dr-auth-fallback (2026-09-17): an explicit credential override that is not a file
# must refuse, never fall back to the operator's ~/.codex/auth.json.
OUT="$(CR_LAUNCH_LOG="$CR_LAUNCH_LOG" CR_LAUNCH_ARGV="$CR_LAUNCH_ARGV" CR_PREFLIGHT_RC=0 \
  AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$CR_PKT" \
  AUTOPILOT_CLEANROOM_BWRAP="$CR_BWRAP" AUTOPILOT_CLEANROOM_LAUNCHER="$CR_LAUNCHER" \
  AUTOPILOT_CLEANROOM_CODEX_AUTH="$TEST_TMP/no-such-auth.json" AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
  "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$CR_CODEX" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "explicit credential override that is missing is exit 2"
assert_contains "$OUT" 'codex credential file not found: AUTOPILOT_CLEANROOM_CODEX_AUTH=' "missing explicit credential override is named, not silently replaced"

# RED at base ceb7c81d: no launcher seam; preflight never ran
: > "$CR_LAUNCH_LOG"
OUT="$(CR_LAUNCH_LOG="$CR_LAUNCH_LOG" CR_LAUNCH_ARGV="$CR_LAUNCH_ARGV" CR_PREFLIGHT_RC=2 CR_PREFLIGHT_ERR='userns blocked' \
  AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$CR_PKT" \
  AUTOPILOT_CLEANROOM_BWRAP="$CR_BWRAP" AUTOPILOT_CLEANROOM_LAUNCHER="$CR_LAUNCHER" \
  AUTOPILOT_CLEANROOM_CODEX_AUTH="$CR_AUTH" AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
  "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$CR_CODEX" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "preflight failure is exit 2"
assert_contains "$OUT" 'cleanroom runtime unusable: userns blocked' "preflight stderr is named"
assert_eq "0" "$(grep -cx launch "$CR_LAUNCH_LOG")" "failed preflight never calls launch mode"

# RED at base ceb7c81d: npm-wrapper layout was not a named gate
CR_BADBIN="$TEST_TMP/codex-npm-wrapper"
mkdir -p "$CR_BADBIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$CR_BADBIN/codex"
chmod +x "$CR_BADBIN/codex"
: > "$CR_LAUNCH_LOG"
OUT="$(CR_LAUNCH_LOG="$CR_LAUNCH_LOG" CR_LAUNCH_ARGV="$CR_LAUNCH_ARGV" \
  AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$CR_PKT" \
  AUTOPILOT_CLEANROOM_BWRAP="$CR_BWRAP" AUTOPILOT_CLEANROOM_LAUNCHER="$CR_LAUNCHER" \
  AUTOPILOT_CLEANROOM_CODEX_AUTH="$CR_AUTH" AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
  "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$CR_BADBIN/codex" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "codex without code-mode-host is exit 2"
assert_contains "$OUT" 'codex binary directory unresolved' "missing helper names unresolved directory"

# Argument shape + parser + JSON line; default --timeout 5m forwarded; no outer timeout wrapper
: > "$CR_LAUNCH_LOG"
rm -f "$CR_LAUNCH_ARGV"
OUT="$(CR_LAUNCH_LOG="$CR_LAUNCH_LOG" CR_LAUNCH_ARGV="$CR_LAUNCH_ARGV" \
  AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$CR_PKT" \
  AUTOPILOT_CLEANROOM_BWRAP="$CR_BWRAP" AUTOPILOT_CLEANROOM_LAUNCHER="$CR_LAUNCHER" \
  AUTOPILOT_CLEANROOM_CODEX_AUTH="$CR_AUTH" AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
  "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$CR_CODEX" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "cleanroom stub --out framed verdict is reviewed"
assert_contains "$OUT" '"status": "reviewed"' "cleanroom --out is what the parser reads"
CR_ARGV="$(tr '\n' ' ' < "$CR_LAUNCH_ARGV")"
assert_contains "$CR_ARGV" '--profile codex' "launcher receives --profile codex"
assert_contains "$CR_ARGV" "--packet-dir $CR_PKT" "launcher receives packet dir"
assert_contains "$CR_ARGV" '--timeout 5m' "launcher receives default 5m timeout (coreutils grammar)"
assert_contains "$CR_ARGV" '--model gpt-5.5' "launcher receives --model"
assert_contains "$CR_ARGV" '--effort xhigh' "launcher receives --effort"
assert_contains "$CR_ARGV" "--bin-dir $CR_BINDIR" "launcher receives resolved bin dir"
assert_contains "$CR_ARGV" "--auth-file $CR_AUTH" "launcher receives --auth-file"
assert_contains "$CR_ARGV" "--seat-root $CR_PKT/../seat" "launcher receives seat-root beside packet"
RAW="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.raw_log||"")' "$OUT")"
assert_file_exists "$RAW"
assert_contains "$(cat "$RAW")" '--- cleanroom launch ---' "raw_log has cleanroom launch section"
assert_contains "$(cat "$RAW")" '"artifact_type": "cleanroom_launch"' "raw_log contains launcher JSON line"

# RED at base ceb7c81d: timeout was outer `timeout` + `codex exited non-zero`
OUT="$(CR_LAUNCH_LOG="$CR_LAUNCH_LOG" CR_LAUNCH_ARGV="$CR_LAUNCH_ARGV" CR_LAUNCH_RC=124 \
  AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$CR_PKT" \
  AUTOPILOT_CLEANROOM_BWRAP="$CR_BWRAP" AUTOPILOT_CLEANROOM_LAUNCHER="$CR_LAUNCHER" \
  AUTOPILOT_CLEANROOM_CODEX_AUTH="$CR_AUTH" AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
  "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$CR_CODEX" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "launcher 124 is no_verdict"
assert_contains "$OUT" '"status": "no_verdict"' "launcher 124 → no_verdict"
assert_contains "$OUT" 'cleanroom codex exited non-zero (rc=124)' "no_verdict names cleanroom rc"
RAW="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.raw_log||"")' "$OUT")"
assert_contains "$(cat "$RAW")" 'rc=124' "raw_log records rc=124"

# Parity extension: codex under blind with stub launcher reaches the LAUNCHER, not the binary
: > "$CR_LAUNCH_LOG"
OUT="$(CR_LAUNCH_LOG="$CR_LAUNCH_LOG" CR_LAUNCH_ARGV="$CR_LAUNCH_ARGV" \
  AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$CR_PKT" \
  AUTOPILOT_CLEANROOM_BWRAP="$CR_BWRAP" AUTOPILOT_CLEANROOM_LAUNCHER="$CR_LAUNCHER" \
  AUTOPILOT_CLEANROOM_CODEX_AUTH="$CR_AUTH" AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
  "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$CR_CODEX" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "parity extension: cleanroom launch succeeds via stub launcher"
assert_eq "1" "$(grep -cx launch "$CR_LAUNCH_LOG")" "parity extension: launcher launch mode was called exactly once"

BLIND_SOURCE="$TEST_TMP/blind-source"; mkdir -p "$BLIND_SOURCE"; printf 'diff\n' > "$BLIND_SOURCE/diff"; printf 'spec\n' > "$BLIND_SOURCE/spec"; printf 'escape\n' > "$BLIND_SOURCE/escape-sentinel"
BLIND_SCRIPT="$TEST_TMP/blind-probe"
printf '#!/usr/bin/env bash\nif [ -e escape-sentinel ]; then printf '\''%s\\n'\'' '\''{"runner":"fixture","model":"fixture","status":"reviewed","verdict":"SHIP-AS-IS","findings":"","no_finding_proof":"checked=sentinel; evidence=absent; conclusion=isolated","raw_log":null,"error":null,"usage":null}'\''; else exit 1; fi\n' > "$BLIND_SCRIPT"; chmod +x "$BLIND_SCRIPT"
OUT="$(BLIND_SOURCE="$BLIND_SOURCE" BLIND_SCRIPT="$BLIND_SCRIPT" REPO_ROOT="$REPO_ROOT" node - <<'NODE'
const { dispatchReviewJson } = require(`${process.env.REPO_ROOT}/src/runners/review`);
const source = process.env.BLIND_SOURCE;
const result = dispatchReviewJson(['--runner', 'fixture', '--model', 'fixture', '--diff-file', `${source}/diff`, '--spec-file', `${source}/spec`], { cwd: source, scriptPath: process.env.BLIND_SCRIPT, blindDiscovery: true });
console.log(JSON.stringify({ status: result.result && result.result.status, launch_cwd: result.transportEnvelope.cwd }));
NODE
  )"; EXIT=$?
assert_eq "0" "$EXIT" "blind adapter probe returns transport result"
assert_contains "$OUT" '"status":null' "blind adapter rejects caller escape sentinel"
assert_not_contains "$OUT" '"status":"reviewed"' "blind adapter never accepts crawl verdict"

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
    fs.appendFileSync(logPath, `[call=${calls} max_tokens=${payload.max_tokens}]\n`);
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
    const boundedConvergence = prompt.includes('bounded keep/cut list and a minimum shippable version')
      && prompt.includes('smallest concrete remediation')
      && prompt.includes('MUST-FIX list is empty');
    const noFindingGate = prompt.includes('NO-FINDING-PROOF: checked=')
      && prompt.includes('Bare claims such as')
      && prompt.includes('FIX-THEN-SHIP must omit this line');
    fs.appendFileSync(
      logPath,
      `[bounded_convergence=${boundedConvergence ? 'present' : 'missing'}]\n`,
    );
    fs.appendFileSync(logPath, `[no_finding_gate=${noFindingGate ? 'present' : 'missing'}]\n`);
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
      // A real whole-prompt echo reproduces the framing markers too — the
      // leading line must carry the vocabulary (not just generic prose) to
      // still exercise the chrome-skip guard's hard-reject path.
      response.content[0].text = `Model repeated prompt: beginning with: ${nonceBegin} and more prose\n${wrapped('VERDICT: FIX-THEN-SHIP\nFINDINGS: none\n')}`;
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
    } else if (calls === 11) {
      response.content[0].text = wrapped('VERDICT: SHIP-AS-IS\nFINDINGS: none\n');
    } else if (calls === 12) {
      response.content[0].text = wrapped('VERDICT: SHIP-AS-IS\nFINDINGS: none\nNO-FINDING-PROOF: checked=no findings; evidence=all passed; conclusion=no must-fix remains\n');
    } else if (calls === 13) {
      response.content[0].text = wrapped('VERDICT: SHIP-AS-IS\nFINDINGS: none\nNO-FINDING-PROOF: checked=fixture diff and acceptance criteria; evidence=changed slice was traced; regression evidence was also inspected; conclusion=no concrete blocking discrepancy was observed\n');
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
assert_contains "$(cat "$MOCK_LOG")" 'bounded_convergence=present' \
  "anthropic-compatible prompt carries bounded convergence contract"
assert_contains "$(cat "$MOCK_LOG")" 'no_finding_gate=present' \
  "anthropic-compatible request body carries no-finding proof gate"
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
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" --max-tokens 17 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible max_tokens exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible max_tokens → no_verdict"
assert_contains "$(cat "$MOCK_LOG")" '[call=7 max_tokens=17]' "anthropic-compatible forwards the requested cap into the API payload"
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
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible bare SHIP-AS-IS exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible bare SHIP-AS-IS → no_verdict"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "anthropic-compatible tautological proof exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "anthropic-compatible tautological proof → no_verdict"
OUT="$(ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="$TEST_AUTH_TOKEN" \
  "$SCRIPT" --runner anthropic-compatible --model MiniMax-M3 --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "anthropic-compatible structured no-finding proof exit 0"
assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "anthropic-compatible structured proof ships"
assert_contains "$OUT" '"no_finding_proof": "checked=' \
  "anthropic-compatible structured proof is machine exposed"
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

# Verify that the event was recorded in the capability store under the exact
# runner/model/effort/endpoint tuple dispatch-review uses (default effort=xhigh,
# endpoint null). Query without effort would miss the exact-tuple partition.
assert_file_exists "$CAP_TEST_DIR_REVIEW/capability.jsonl" "capability store contains recorded review event"
recorded_status_review="$(node "$REPO_ROOT/scripts/engine-capability-state.js" current --runner codex --model gpt-5.5 --role reviewer --effort xhigh --endpoint @none --store "$CAP_TEST_DIR_REVIEW" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0, 'utf8')).capability.quota.status)")"
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
echo "NO-FINDING-PROOF: checked=stdout response against fixture contract; evidence=review block is isolated from stderr chrome; conclusion=no concrete blocking discrepancy was observed"
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
echo "NO-FINDING-PROOF: checked=assembled prompt and fixture diff; evidence=required protocol and diff payload were captured; conclusion=no concrete blocking discrepancy was observed"
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
echo "NO-FINDING-PROOF: checked=assembled prompt and fixture diff; evidence=required protocol and diff payload were captured; conclusion=no concrete blocking discrepancy was observed"
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

expected_begin_block="Output ONLY a wrapped block (no other text/fences), beginning with:
$begin_marker
VERDICT: SHIP-AS-IS or FIX-THEN-SHIP
FINDINGS: one finding per line, or the single word none"

expected_end_block="and ending with:
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
assert_contains "$PROMPT_CONTENT" "Task specification (DISPATCHER-AUTHORED, trusted):" "prompt contains spec header"
assert_contains "$PROMPT_CONTENT" "Spec file baseline text" "prompt contains spec file text"
assert_contains "$PROMPT_CONTENT" "Diff under review:" "prompt still contains Diff under review:"

# Regression Test 9: checklist routing in prompt
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_CAPTURE" --checklists "authz-boundary,tenant-boundary" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "checklist prompt-capture stub exits 0"
PROMPT_CONTENT="$(cat "$CAPTURED_PROMPT_FILE")"
assert_contains "$PROMPT_CONTENT" "Checklist (check closely):" "prompt contains checklist section when checklists set"
assert_contains "$PROMPT_CONTENT" "- authz-boundary" "prompt includes authz-boundary checklist item"
assert_contains "$PROMPT_CONTENT" "- tenant-boundary" "prompt includes tenant-boundary checklist item"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_CAPTURE" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "no-checklist prompt-capture stub exits 0"
PROMPT_CONTENT="$(cat "$CAPTURED_PROMPT_FILE")"
assert_not_contains "$PROMPT_CONTENT" "Checklist (check closely):" "prompt omits checklist section when --checklists is absent"

# Regression Test: multi-line findings containing double quotes/backslashes must produce valid parseable JSON.
OUT="$(STUB_MODE=quotes DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "quotes stub exits 0"
node -e 'JSON.parse(process.argv[1])' "$OUT"
assert_eq "0" "$?" "emitted JSON with multi-line quotes is valid and parseable"

# Regression Test: --pack-file injection present in prompt (skill-transport A/B, --pack-file flag)
PACK="$TEST_TMP/methodology.pack"
printf '# Review methodology\nTrace the control flow by hand before trusting a change.\nUNIQUEPACKSENTINEL42\n' > "$PACK"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_CAPTURE" --pack-file "$PACK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "pack-file prompt-capture stub exits 0"
PACK_PROMPT="$(cat "$CAPTURED_PROMPT_FILE")"
assert_contains "$PACK_PROMPT" "Review methodology (DISPATCHER-AUTHORED, trusted" "prompt contains methodology header when --pack-file set"
assert_contains "$PACK_PROMPT" "UNIQUEPACKSENTINEL42" "prompt contains the pack body when --pack-file set"
assert_contains "$PACK_PROMPT" "--- end methodology ---" "prompt closes the methodology block"
# The nonce output protocol must still precede the diff (pack must not displace it).
assert_contains "$PACK_PROMPT" "Diff under review:" "pack-injected prompt still contains Diff under review:"
pack_suffix="${PACK_PROMPT#*"--- end methodology ---"}"
assert_contains "$pack_suffix" "Diff under review:" "methodology block appears before the diff"

# Regression Test: absent --pack-file ⇒ prompt byte-identical to the no-pack prompt (additive-flag byte-compat).
# Same diff, one run without --pack-file and one with an EMPTY pack argument path is invalid; instead compare
# the no-pack prompt against the earlier captured no-pack baseline: it must NOT carry the methodology header.
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_CAPTURE" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "no-pack prompt-capture stub exits 0"
NOPACK_PROMPT="$(cat "$CAPTURED_PROMPT_FILE")"
assert_not_contains "$NOPACK_PROMPT" "Review methodology (DISPATCHER-AUTHORED, trusted" "prompt omits methodology block when --pack-file is absent"
assert_not_contains "$NOPACK_PROMPT" "--- end methodology ---" "prompt omits methodology terminator when --pack-file is absent"

# Regression Test: --pack-file precondition (unreadable path ⇒ exit 2)
OUT="$("$SCRIPT" --runner codex --model x --diff-file "$DIFF" --pack-file /nonexistent-pack 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing pack-file exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "missing pack-file precondition"

# Regression: cc-shim must suppress Claude Code's unknown-model context-window notice.
# cc-shim exists to drive NON-Anthropic models through an Anthropic-compatible endpoint,
# so the model name is unknown to the CLI by construction. Without the suppression the CLI
# prepends a multi-line notice to STDOUT ahead of an otherwise complete, correctly-framed
# verdict. The parser requires the wrapped block to be the FIRST non-blank line — that is
# deliberate, because a prompt echo reproduces the framing markers too and only position
# separates the two — so the notice silently turned a finished review into no_verdict.
# Observed 2026-08-08 with MiniMax-M3: a real VERDICT: SHIP-AS-IS inside an intact nonce
# block, discarded. Fixing it at the launch env keeps the prompt-echo protection intact;
# relaxing the parser would not have.
assert_contains "$(cat "$SCRIPT")" "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1" \
  "cc-shim launch suppresses the unknown-model context-window notice"

# ── Blind-evidence gate (four-layer K1, D2): implementer narrative in the assembled
# payload fails closed BEFORE any runner spawn; --allow-narrative overrides loudly. ──
BE_SPEC="$TEST_TMP/be-narrative-spec.md"
BE_DIFF="$TEST_TMP/be-diff.txt"
printf 'I have implemented everything and all tests pass.\n' > "$BE_SPEC"
printf 'diff --git a/x b/x\n' > "$BE_DIFF"
BE_OUT="$(bash "$SCRIPT" --runner cc-shim --model MiniMax-M3 --endpoint minimax \
  --diff-file "$BE_DIFF" --spec-file "$BE_SPEC" 2>/dev/null)"
assert_contains "$BE_OUT" '"status": "precondition_failed"' \
  "narrative payload fails closed before dispatch (blind-evidence K1)"
assert_contains "$BE_OUT" "blind-evidence" "denial names the rule"
BE_ERR="$(bash "$SCRIPT" --runner cc-shim --model MiniMax-M3 --endpoint minimax \
  --diff-file "$BE_DIFF" --spec-file "$BE_SPEC" --allow-narrative "fixture override test" 2>&1 >/dev/null | head -20)"
assert_contains "$BE_ERR" "BLIND-EVIDENCE OVERRIDE" \
  "--allow-narrative admits the payload with a loud stderr override record"

# ── verdict-bytes preservation (v2.34.33): unratified_verdict salvage column ──
# Frozen rules (plan R3 §2/§3 + g2-adjudication #6/#7/#8): salvage runs the FULL
# authoritative content battery over the runner-specific capture; only the positional
# start-anchor (→ unique BEGIN + first END) and the exit-0 requirement are dropped.
# status/verdict/exit stay fail-closed on every path; the field is display/adjudication
# data, never authority.
VBP_NOTICE="$REPO_ROOT/docs/plans/evidence/2026-08-21-verdict-bytes-preservation/fixtures/unknown-model-notice.cc-2.1.238.txt"
SCHEMA_CHECK_JS="$REPO_ROOT/scripts/validate-json-schema.js"
RESULT_SCHEMA="$REPO_ROOT/schemas/review-result.schema.json"
vbp_json() {  # capture STDOUT ONLY (pure JSON) — stderr chrome would break schema checks
  DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 STUB_MODE="$1" \
    "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>/dev/null
}
vbp_schema_ok() {
  local doc="$TEST_TMP/vbp-result-$RANDOM.json"
  printf '%s\n' "$1" > "$doc"
  node "$SCHEMA_CHECK_JS" --schema "$RESULT_SCHEMA" --document "$doc" >/dev/null 2>&1
}

# Fixture A: frozen real-world unknown-model notice bytes (the exact chrome that
# caused the observed 4/4 data loss) ahead of an intact valid block, rc=0. Post
# chrome-skip-guard fix: this notice carries NO framing vocabulary, so it is
# skipped as pure chrome and the block is accepted DIRECTLY — reviewed,
# authoritative, no salvage needed. (Pre-fix this fell through to no_verdict +
# salvaged unratified_verdict; that fallback is no longer exercised by this
# exact real-world capture.)
OUT="$(VBP_NOTICE_FILE="$VBP_NOTICE" vbp_json vbp_chrome_then_block)"; EXIT=$?
assert_eq "$EXIT" "0" "A: chrome-prepend now reviews directly (exit 0)"
assert_contains "$OUT" '"status": "reviewed"' "A: chrome-prepend is reviewed, not no_verdict"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "A: verdict parsed directly behind the frozen notice bytes"
assert_not_contains "$OUT" 'unratified_verdict' "A: no salvage key on the direct-accept path (g2 #7)"
vbp_schema_ok "$OUT" || fail "A: directly-reviewed artifact behind chrome fails the result schema"

# Fixture B: complete block then runner dies rc=7 → salvaged, exit 1 unchanged.
OUT="$(vbp_json vbp_block_then_die)"; EXIT=$?
assert_eq "$EXIT" "1" "B: runner death still exits 1"
assert_contains "$OUT" '"status": "no_verdict"' "B: runner death stays no_verdict"
assert_contains "$OUT" '"unratified_verdict": "FIX-THEN-SHIP"' \
  "B: complete block before non-zero exit is salvaged"

# SHIP with a VALID proof then death → salvaged SHIP-AS-IS (proof battery passes).
OUT="$(vbp_json vbp_ship_then_die)"
assert_contains "$OUT" '"unratified_verdict": "SHIP-AS-IS"' \
  "B-ship: valid-proof SHIP block before death is salvaged"
assert_contains "$OUT" '"no_finding_proof": null' \
  "B-ship: authoritative proof column stays null on no_verdict"
vbp_schema_ok "$OUT" || fail "B-ship: salvaged SHIP artifact fails the result schema"

# Fixture B2: truncated block (no END) → never salvaged.
OUT="$(vbp_json vbp_truncated_then_die)"
assert_contains "$OUT" '"unratified_verdict": null' "B2: truncated block is never salvaged"

# Fixture E: leak line inside the block → battery parity → null.
OUT="$(vbp_json vbp_leak_then_die)"
assert_contains "$OUT" '"unratified_verdict": null' "E: leak scan applies to salvage"

# Fixture F: two BEGIN blocks → ambiguous → null.
OUT="$(vbp_json vbp_two_blocks_then_die)"
assert_contains "$OUT" '"unratified_verdict": null' "F: two blocks are ambiguous, never salvaged"

# Fixture G: tautological SHIP proof → full-battery parity → null.
OUT="$(vbp_json vbp_ship_tautology_then_die)"
assert_contains "$OUT" '"unratified_verdict": null' "G: tautology blacklist applies to salvage"

# Kimi rail (pre-merge review round-1 MUST-FIX): the bullet-prefix normalization now
# runs BEFORE the rc check, so the documented-common "• <BEGIN>" shape salvages on a
# runner death. Red evidence for the inert pre-fix shape is the reviewer's recorded
# two-sided probe (bullet → null / unprefixed → salvaged) in the round-1 report.
OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 STUB_MODE=vbp_kimi_bullet_then_die \
  "$SCRIPT" --runner kimi --model kimi-code/k3 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>/dev/null)"; EXIT=$?
assert_eq "$EXIT" "1" "kimi: runner death still exits 1"
assert_contains "$OUT" '"status": "no_verdict"' "kimi: runner death stays no_verdict"
assert_contains "$OUT" '"unratified_verdict": "FIX-THEN-SHIP"' \
  "kimi: bullet-prefixed block before death is salvaged (normalized capture)"

# Kimi rail argv wall (308 report 2026-09-07): kimi takes the prompt only as one -p argv
# string, so a prompt above MAX_ARG_STRLEN (128 KiB) used to reach execve and die rc=126
# ("Argument list too long") AFTER the context-window gate — an opaque no_verdict. The rail
# now fails closed BEFORE spend with the cause and remedies. --context-window off isolates
# the argv check from the token gate; AUTOPILOT_KIMI_ARGV_LIMIT is the test seam.
BIG_DIFF="$TEST_TMP/kimi-big.diff"
{ printf 'diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n'; for i in $(seq 1 3000); do printf '+line %05d %s\n' "$i" "$(printf 'x%.0s' $(seq 1 40))"; done; } > "$BIG_DIFF"
OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 \
  "$SCRIPT" --runner kimi --model kimi-code/k3 --diff-file "$BIG_DIFF" --bin "$STUB_VERDICT" --context-window off 2>/dev/null)"; EXIT=$?
assert_eq "$EXIT" "2" "kimi: oversized prompt is a precondition failure (exit 2), never an rc=126 death"
assert_contains "$OUT" '"status": "precondition_failed"' "kimi: oversized prompt reports precondition_failed"
assert_contains "$OUT" 'MAX_ARG_STRLEN' "kimi: refusal names the kernel argv limit"
assert_contains "$OUT" 'reads a prompt file' "kimi: refusal names the runner remedy"
assert_not_contains "$OUT" 'Argument list too long' "kimi: the execve failure never happens"
# Positive control: a prompt under the limit still reaches the runner and reviews. (A raised
# seam cannot serve as the control: the stub is itself exec'd with the prompt as one argv
# string, so on Linux it dies with the very rc=126 this guard exists to pre-empt.)
MID_DIFF="$TEST_TMP/kimi-mid.diff"
{ printf 'diff --git a/mid.txt b/mid.txt\n--- a/mid.txt\n+++ b/mid.txt\n'; for i in $(seq 1 1500); do printf '+line %05d %s\n' "$i" "$(printf 'x%.0s' $(seq 1 40))"; done; } > "$MID_DIFF"
OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 \
  "$SCRIPT" --runner kimi --model kimi-code/k3 --diff-file "$MID_DIFF" --bin "$STUB_VERDICT" --context-window off 2>/dev/null)"; EXIT=$?
assert_eq "$EXIT" "0" "kimi: a prompt under the argv limit still reaches the runner"
assert_contains "$OUT" '"status": "reviewed"' "kimi: under-limit prompt reviews normally"

# Reviewed path stays byte-identical: the key is NOT emitted on success (g2 #7)...
OUT="$(vbp_json pass)"; EXIT=$?
assert_eq "$EXIT" "0" "reviewed path still exits 0"
assert_not_contains "$OUT" 'unratified_verdict' "reviewed emit is byte-identical (no salvage key)"
vbp_schema_ok "$OUT" || fail "reviewed artifact without the optional key fails the result schema"

# ...and the strict JS consumer admits the key on no_verdict without granting authority,
# while still rejecting arbitrary unknown keys (closed-contract pin).
NODE_PIN="$(node -e '
const { parseReviewOutput } = require(process.argv[1] + "/src/runners/review");
const base = { runner: "codex", model: "m", status: "no_verdict", verdict: null,
  findings: "", no_finding_proof: null, raw_log: "/tmp/x", error: "died", usage: null };
const out = {};
const withKey = { ...base, unratified_verdict: "SHIP-AS-IS" };
try { const p = parseReviewOutput(JSON.stringify(withKey));
  out.admitted = true; out.verdict_stays = p.verdict === null; out.status_stays = p.status === "no_verdict";
} catch (e) { out.admitted = false; }
try { parseReviewOutput(JSON.stringify({ ...base, totally_unknown: 1 })); out.unknown_rejected = false; }
catch (e) { out.unknown_rejected = true; }
try { parseReviewOutput(JSON.stringify({ ...base, status: "reviewed", verdict: "FIX-THEN-SHIP", unratified_verdict: "SHIP-AS-IS" })); out.reviewed_nonnull_rejected = false; }
catch (e) { out.reviewed_nonnull_rejected = true; }
console.log(JSON.stringify(out));
' "$REPO_ROOT")"
assert_contains "$NODE_PIN" '"admitted":true' "runner contract admits unratified_verdict on no_verdict"
assert_contains "$NODE_PIN" '"verdict_stays":true' "unratified_verdict is never copied into verdict"
assert_contains "$NODE_PIN" '"status_stays":true' "unratified_verdict never changes status"
assert_contains "$NODE_PIN" '"unknown_rejected":true' "arbitrary unknown keys still fail closed"
assert_contains "$NODE_PIN" '"reviewed_nonnull_rejected":true' \
  "non-null unratified_verdict outside no_verdict is rejected"

# --- agy effort follows resolved model id (v2.36.55) ---
# agy review runs under bwrap --ro-bind, so argv cannot be written to TEST_TMP.
# The stub echoes the received --effort into FINDINGS (STUB_MODE=effort_pin).
count_fold_notes() {
  printf '%s\n' "$1" | grep -c 'model id encodes the tier' || true
}

# RED at base fe225ff5: gemini-flash-medium with default effort reached the stub as --effort high
OUT="$(STUB_MODE=effort_pin AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-flash-medium \
  --diff-file "$DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "review gemini-flash-medium default effort exit 0"
assert_contains "$OUT" 'agy-argv-effort=medium' \
  "review alias gemini-flash-medium default effort reaches stub as --effort medium"

# RED at base fe225ff5: gemini-flash-high --effort low reached stub as --effort high with no fold note
OUT="$(STUB_MODE=effort_pin AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-flash-high \
  --effort low --diff-file "$DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "review gemini-flash-high --effort low exit 0"
assert_contains "$OUT" 'agy-argv-effort=high' \
  "review gemini-flash-high --effort low reaches stub as --effort high"
assert_eq "1" "$(count_fold_notes "$OUT")" "review fold note exactly one line when values differ"
assert_contains "$OUT" "agy effort low (clamped low) folded to high: model id encodes the tier" \
  "review fold note names requested, folded tier, and model-id reason"

# (preservation, green at base) gemini-flash-high --effort high: --effort high, zero fold notes
OUT="$(STUB_MODE=effort_pin AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-flash-high \
  --effort high --diff-file "$DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "review gemini-flash-high --effort high exit 0"
assert_contains "$OUT" 'agy-argv-effort=high' \
  "review gemini-flash-high --effort high stays --effort high"
assert_eq "0" "$(count_fold_notes "$OUT")" "review zero fold notes when requested clamp matches suffix"

# (preservation, green at base) gemini-flash-high default xhigh: --effort high, zero fold notes
OUT="$(STUB_MODE=effort_pin AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-flash-high \
  --diff-file "$DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "review gemini-flash-high default effort exit 0"
assert_contains "$OUT" 'agy-argv-effort=high' \
  "review gemini-flash-high default xhigh reaches stub as --effort high"
assert_eq "0" "$(count_fold_notes "$OUT")" "review zero fold notes for default xhigh on -high id"

# (preservation, green at base) bare (non-suffixed) agy id under default effort → --effort high
OUT="$(STUB_MODE=effort_pin AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-3.6-flash \
  --diff-file "$DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "review bare agy id exit 0"
assert_contains "$OUT" 'agy-argv-effort=high' \
  "review bare agy id under default effort reaches stub as --effort high"

# (preservation, green at base) grok/codex/cc-shim complete argv is the frozen literal (path/uuid-normalized)
normalize_argv() {
  sed -E \
    -e 's#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#UUID#g' \
    -e 's#/tmp/[^[:space:]]+#PATH#g' \
    -e 's#'"$TEST_TMP"'[^[:space:]]*#PATH#g'
}

REVIEW_GROK_ARGV="$TEST_TMP/review-grok.argv"
cat > "$TEST_TMP/review-grok-stub" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$REVIEW_GROK_ARGV"
exec "$STUB_VERDICT" "\$@"
EOF
chmod +x "$TEST_TMP/review-grok-stub"
OUT="$(STUB_MODE=ship AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner grok --model grok-4.6 \
  --diff-file "$DIFF" --bin "$TEST_TMP/review-grok-stub" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "review grok argv capture exit 0"
assert_eq "$(normalize_argv < "$REVIEW_GROK_ARGV")" "$(printf '%s\n' \
  --prompt-file PATH --cwd PATH --model grok-4.6 --reasoning-effort xhigh \
  --no-alt-screen --output-format plain --disable-web-search)" \
  "review grok argv matches frozen literal (preservation, green at base)"

REVIEW_CODEX_ARGV="$TEST_TMP/review-codex.argv"
cat > "$TEST_TMP/review-codex-stub" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$REVIEW_CODEX_ARGV"
PROMPT="\$(cat)"
begin="\$(printf '%s\n' "\$PROMPT" | sed -n 's/^\\(<<<AUTOPILOT-REVIEW-[0-9a-f]\\{32\\}>>>\\)\$/\\1/p' | sed -n '1p')"
end="\$(printf '%s\n' "\$PROMPT" | sed -n 's/^\\(<<<AUTOPILOT-END-[0-9a-f]\\{32\\}>>>\\)\$/\\1/p' | sed -n '1p')"
echo "\$begin"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "NO-FINDING-PROOF: checked=fixture; evidence=slice traced; conclusion=no blocking discrepancy observed"
echo "\$end"
EOF
chmod +x "$TEST_TMP/review-codex-stub"
OUT="$(AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner codex --model gpt-5.5 \
  --diff-file "$DIFF" --bin "$TEST_TMP/review-codex-stub" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "review codex argv capture exit 0"
assert_eq "$(normalize_argv < "$REVIEW_CODEX_ARGV")" "$(printf '%s\n' \
  exec --model gpt-5.5 --sandbox read-only -c 'model_reasoning_effort="xhigh"')" \
  "review codex argv matches frozen literal (preservation, green at base)"

REVIEW_CC_ARGV="$TEST_TMP/review-cc.argv"
cat > "$TEST_TMP/review-cc-stub" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$REVIEW_CC_ARGV"
PROMPT="\$(cat)"
begin="\$(printf '%s\n' "\$PROMPT" | sed -n 's/^\\(<<<AUTOPILOT-REVIEW-[0-9a-f]\\{32\\}>>>\\)\$/\\1/p' | sed -n '1p')"
end="\$(printf '%s\n' "\$PROMPT" | sed -n 's/^\\(<<<AUTOPILOT-END-[0-9a-f]\\{32\\}>>>\\)\$/\\1/p' | sed -n '1p')"
echo "\$begin"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "NO-FINDING-PROOF: checked=fixture; evidence=slice traced; conclusion=no blocking discrepancy observed"
echo "\$end"
EOF
chmod +x "$TEST_TMP/review-cc-stub"
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1"
export AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
OUT="$(AUTOPILOT_SETTLE_MS=0 \
  "$SCRIPT" --runner cc-shim --model mini --diff-file "$DIFF" --bin "$TEST_TMP/review-cc-stub" \
  --endpoint TESTEP 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "review cc-shim argv capture exit 0"
assert_eq "$(normalize_argv < "$REVIEW_CC_ARGV")" "$(printf '%s\n' \
  -p --model mini --setting-sources project --strict-mcp-config --tools '')" \
  "review cc-shim argv matches frozen literal (preservation, green at base)"

# RED at base 004cb2da: stdout "/poison|poison" (ambient packet env inherited)
# RED at base 004cb2da: no packet key on dispatchReviewJson result; args end in diff.file.input
# RED at base 004cb2da: bad candidate still launched the stub
PKT_REPO="$TEST_TMP/pkt-repo"
git init --object-format=sha1 -q "$PKT_REPO"
git -C "$PKT_REPO" config user.email t@t.example
git -C "$PKT_REPO" config user.name t
printf 'a\n' > "$PKT_REPO/a.txt"
git -C "$PKT_REPO" add a.txt
git -C "$PKT_REPO" commit -q -m b
printf 'b\n' > "$PKT_REPO/a.txt"
git -C "$PKT_REPO" add a.txt
git -C "$PKT_REPO" commit -q -m c
PKT_B="$(git -C "$PKT_REPO" rev-parse HEAD^)"
PKT_C="$(git -C "$PKT_REPO" rev-parse HEAD)"
PKT_DIFF="$TEST_TMP/pkt.diff"
git -C "$PKT_REPO" diff --no-ext-diff --no-textconv "$PKT_B..$PKT_C" > "$PKT_DIFF"
PKT_SPEC="$TEST_TMP/pkt.spec"
printf 'spec\n' > "$PKT_SPEC"
PKT_DUMP="$TEST_TMP/pkt-dump"; mkdir -p "$PKT_DUMP"
PKT_STUB="$TEST_TMP/pkt-stub"
cat > "$PKT_STUB" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$PKT_DUMP/args"
printenv > "$PKT_DUMP/env"
touch "$PKT_DUMP/invoked"
printf '%s\n' '{"runner":"fixture","model":"fixture","status":"reviewed","verdict":"SHIP-AS-IS","findings":"","no_finding_proof":"checked=sentinel; evidence=absent; conclusion=isolated","raw_log":null,"error":null,"usage":null}'
EOF
chmod +x "$PKT_STUB"

OUT="$(REPO_ROOT="$REPO_ROOT" PKT_REPO="$PKT_REPO" PKT_B="$PKT_B" PKT_C="$PKT_C" PKT_DIFF="$PKT_DIFF" PKT_SPEC="$PKT_SPEC" PKT_STUB="$PKT_STUB" PKT_DUMP="$PKT_DUMP" node - <<'NODE'
const fs = require('fs');
const { dispatchReviewJson } = require(`${process.env.REPO_ROOT}/src/runners/review`);
const result = dispatchReviewJson([
  '--runner', 'fixture', '--model', 'fixture',
  '--diff-file', process.env.PKT_DIFF, '--spec-file', process.env.PKT_SPEC,
], {
  scriptPath: process.env.PKT_STUB,
  blindDiscovery: true,
  packet: { repo: process.env.PKT_REPO, baseSha: process.env.PKT_B, candidateSha: process.env.PKT_C },
});
const args = fs.readFileSync(`${process.env.PKT_DUMP}/args`, 'utf8');
const env = fs.readFileSync(`${process.env.PKT_DUMP}/env`, 'utf8');
process.stdout.write(JSON.stringify({
  args,
  envDir: (env.match(/^AUTOPILOT_REVIEW_PACKET_DIR=(.*)$/m) || [])[1] || '',
  envHash: (env.match(/^AUTOPILOT_REVIEW_PACKET_HASH=(.*)$/m) || [])[1] || '',
  blind: /AUTOPILOT_BLIND_DISCOVERY=1/.test(env),
  packet: result.packet,
}));
NODE
)"
assert_eq "0" "$?" "packet dispatch node exits 0"
assert_contains "$OUT" '/packet/diff.patch' "packet mode --diff-file ends /packet/diff.patch"
assert_contains "$OUT" '/packet/spec.md' "packet mode --spec-file ends /packet/spec.md"
assert_contains "$OUT" '"blind":true' "packet mode sets AUTOPILOT_BLIND_DISCOVERY=1"
node -e '
const o=JSON.parse(process.argv[1]);
if (!o.packet || o.packet.packet_hash !== o.envHash) process.exit(2);
if (!/^[0-9a-f]{64}$/.test(o.envHash)) process.exit(3);
if (!o.args.includes("/packet/diff.patch")) process.exit(4);
if (!o.envDir.endsWith("/packet")) process.exit(5);
' "$OUT"
assert_eq "0" "$?" "packet.packet_hash equals env hash; DIR is packet dir"

rm -f "$PKT_DUMP/args" "$PKT_DUMP/env" "$PKT_DUMP/invoked"
OUT="$(REPO_ROOT="$REPO_ROOT" PKT_REPO="$PKT_REPO" PKT_B="$PKT_B" PKT_C="$PKT_C" PKT_DIFF="$PKT_DIFF" PKT_STUB="$PKT_STUB" PKT_DUMP="$PKT_DUMP" node - <<'NODE'
const fs = require('fs');
const { dispatchReviewJson } = require(`${process.env.REPO_ROOT}/src/runners/review`);
const result = dispatchReviewJson([
  '--runner', 'fixture', '--model', 'fixture',
  '--diff-file', process.env.PKT_DIFF,
], {
  scriptPath: process.env.PKT_STUB,
  blindDiscovery: true,
  packet: { repo: process.env.PKT_REPO, baseSha: process.env.PKT_B, candidateSha: process.env.PKT_C },
});
const args = fs.readFileSync(`${process.env.PKT_DUMP}/args`, 'utf8');
process.stdout.write(JSON.stringify({ args, packet: result.packet }));
NODE
)"
assert_not_contains "$OUT" '--spec-file' "no --spec-file arg when omitted"
# zero-byte spec was in packet dir during launch; reconstruct via entries_count/hash still
node -e 'const o=JSON.parse(process.argv[1]); if (o.args.includes("--spec-file")) process.exit(2);' "$OUT"
assert_eq "0" "$?" "omitted spec-file not added"

# rebuild to inspect spec.md: run buildReviewPacket
node - "$REPO_ROOT/src/runners/review-packet.js" "$PKT_REPO" "$PKT_B" "$PKT_C" "$PKT_DIFF" "$TEST_TMP/pkt-nospec" <<'NODE'
const fs = require('fs');
const { buildReviewPacket } = require(process.argv[2]);
const r = buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
});
if (fs.readFileSync(require('path').join(r.dir, 'spec.md')).length !== 0) process.exit(2);
NODE
assert_eq "0" "$?" "no --spec-file yields zero-byte packet/spec.md"

# preservation: no options.packet
rm -f "$PKT_DUMP/args" "$PKT_DUMP/env"
OUT="$(REPO_ROOT="$REPO_ROOT" PKT_DIFF="$PKT_DIFF" PKT_SPEC="$PKT_SPEC" PKT_STUB="$PKT_STUB" PKT_DUMP="$PKT_DUMP" node - <<'NODE'
const fs = require('fs');
const { dispatchReviewJson } = require(`${process.env.REPO_ROOT}/src/runners/review`);
const result = dispatchReviewJson([
  '--runner', 'fixture', '--model', 'fixture',
  '--diff-file', process.env.PKT_DIFF, '--spec-file', process.env.PKT_SPEC,
], { scriptPath: process.env.PKT_STUB, blindDiscovery: true });
const args = fs.readFileSync(`${process.env.PKT_DUMP}/args`, 'utf8');
process.stdout.write(JSON.stringify({ args, packet: result.packet }));
NODE
)"
assert_contains "$OUT" 'diff.input' "legacy blind args end in diff.file.input (preservation, green at base)"
assert_contains "$OUT" 'spec.input' "legacy blind args end in spec.file.input (preservation, green at base)"
assert_contains "$OUT" '"packet":null' "legacy blind packet is null (preservation)"

# poisoned ambient env
rm -f "$PKT_DUMP/args" "$PKT_DUMP/env"
OUT="$(REPO_ROOT="$REPO_ROOT" PKT_DIFF="$PKT_DIFF" PKT_SPEC="$PKT_SPEC" PKT_STUB="$PKT_STUB" PKT_DUMP="$PKT_DUMP" node - <<'NODE'
const fs = require('fs');
const { dispatchReviewJson } = require(`${process.env.REPO_ROOT}/src/runners/review`);
const env = { ...process.env, AUTOPILOT_REVIEW_PACKET_DIR: '/poison', AUTOPILOT_REVIEW_PACKET_HASH: 'poison' };
dispatchReviewJson([
  '--runner', 'fixture', '--model', 'fixture',
  '--diff-file', process.env.PKT_DIFF, '--spec-file', process.env.PKT_SPEC,
], { scriptPath: process.env.PKT_STUB, blindDiscovery: true, env });
const e = fs.readFileSync(`${process.env.PKT_DUMP}/env`, 'utf8');
process.stdout.write(e);
NODE
)"
assert_not_contains "$OUT" '/poison' "legacy blind launch does not inherit AUTOPILOT_REVIEW_PACKET_DIR"
assert_not_contains "$OUT" 'PACKET_HASH=poison' "legacy blind launch does not inherit AUTOPILOT_REVIEW_PACKET_HASH"

rm -f "$PKT_DUMP/env"
OUT="$(REPO_ROOT="$REPO_ROOT" PKT_DIFF="$PKT_DIFF" PKT_SPEC="$PKT_SPEC" PKT_STUB="$PKT_STUB" PKT_DUMP="$PKT_DUMP" node - <<'NODE'
const fs = require('fs');
const { dispatchReviewJson } = require(`${process.env.REPO_ROOT}/src/runners/review`);
const env = { ...process.env, AUTOPILOT_REVIEW_PACKET_DIR: '/poison', AUTOPILOT_REVIEW_PACKET_HASH: 'poison' };
dispatchReviewJson([
  '--runner', 'fixture', '--model', 'fixture',
  '--diff-file', process.env.PKT_DIFF, '--spec-file', process.env.PKT_SPEC,
], { scriptPath: process.env.PKT_STUB, env });
const e = fs.readFileSync(`${process.env.PKT_DUMP}/env`, 'utf8');
process.stdout.write(e);
NODE
)"
assert_not_contains "$OUT" '/poison' "non-blind launch does not inherit AUTOPILOT_REVIEW_PACKET_DIR"
assert_not_contains "$OUT" 'PACKET_HASH=poison' "non-blind launch does not inherit AUTOPILOT_REVIEW_PACKET_HASH"

# bad candidate: never invoke stub
rm -f "$PKT_DUMP/invoked"
OUT="$(REPO_ROOT="$REPO_ROOT" PKT_REPO="$PKT_REPO" PKT_B="$PKT_B" PKT_DIFF="$PKT_DIFF" PKT_SPEC="$PKT_SPEC" PKT_STUB="$PKT_STUB" node - <<'NODE'
const { dispatchReviewJson } = require(`${process.env.REPO_ROOT}/src/runners/review`);
const result = dispatchReviewJson([
  '--runner', 'fixture', '--model', 'fixture',
  '--diff-file', process.env.PKT_DIFF, '--spec-file', process.env.PKT_SPEC,
], {
  scriptPath: process.env.PKT_STUB,
  blindDiscovery: true,
  packet: { repo: process.env.PKT_REPO, baseSha: process.env.PKT_B, candidateSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
});
process.stdout.write(JSON.stringify({
  hasError: Boolean(result.error),
  status: result.status,
  packet: result.packet,
}));
NODE
)"
assert_contains "$OUT" '"hasError":true' "bad candidate returns error"
assert_contains "$OUT" '"status":null' "bad candidate status null"
assert_contains "$OUT" '"packet":null' "bad candidate packet null"
assert_file_absent "$PKT_DUMP/invoked" "bad candidate never invokes stub"

# child-error / parse-error / missing-script → packet null
CHILD_STUB="$TEST_TMP/child-err"
printf '#!/usr/bin/env bash\nexit 1\n' > "$CHILD_STUB"; chmod +x "$CHILD_STUB"
OUT="$(REPO_ROOT="$REPO_ROOT" PKT_DIFF="$PKT_DIFF" CHILD_STUB="$CHILD_STUB" node - <<'NODE'
const { dispatchReviewJson } = require(`${process.env.REPO_ROOT}/src/runners/review`);
const result = dispatchReviewJson(['--runner', 'fixture', '--model', 'fixture', '--diff-file', process.env.PKT_DIFF], { scriptPath: process.env.CHILD_STUB });
process.stdout.write(JSON.stringify({ packet: result.packet, status: result.status }));
NODE
)"
assert_contains "$OUT" '"packet":null' "child-error branch packet null"

PARSE_STUB="$TEST_TMP/parse-err"
printf '#!/usr/bin/env bash\necho not-json\n' > "$PARSE_STUB"; chmod +x "$PARSE_STUB"
OUT="$(REPO_ROOT="$REPO_ROOT" PKT_DIFF="$PKT_DIFF" PARSE_STUB="$PARSE_STUB" node - <<'NODE'
const { dispatchReviewJson } = require(`${process.env.REPO_ROOT}/src/runners/review`);
const result = dispatchReviewJson(['--runner', 'fixture', '--model', 'fixture', '--diff-file', process.env.PKT_DIFF], { scriptPath: process.env.PARSE_STUB });
process.stdout.write(JSON.stringify({ packet: result.packet, parse: Boolean(result.parseError) }));
NODE
)"
assert_contains "$OUT" '"packet":null' "parse-error branch packet null"

OUT="$(REPO_ROOT="$REPO_ROOT" PKT_DIFF="$PKT_DIFF" node - <<'NODE'
const { dispatchReviewJson } = require(`${process.env.REPO_ROOT}/src/runners/review`);
const result = dispatchReviewJson(['--runner', 'fixture', '--model', 'fixture', '--diff-file', process.env.PKT_DIFF], { scriptPath: '/no/such/dispatch-review.sh' });
process.stdout.write(JSON.stringify({ packet: result.packet, hasError: Boolean(result.error) }));
NODE
)"
assert_contains "$OUT" '"packet":null' "missing-script branch packet null"

finalize_test
