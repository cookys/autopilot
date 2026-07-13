#!/usr/bin/env bash
# Tests for `autopilot endpoints` (src/endpoints/cli.js via bin/autopilot.js): list / which /
# set / doctor over base + opt-in per-repo overlay. Focus: NO token ever leaks to stdout/argv,
# mode-600 writes, overlay layering, doctor exit codes.
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/bin/autopilot.js"
SH="$REPO_ROOT/scripts/load-endpoints-env.sh"
WORK="$(mktemp -d)"
# Chain lib.sh's cleanup: a bare trap here REPLACES the EXIT trap lib.sh set,
# which silently leaked one TEST_TMP dir per run into the host tmp namespace.
trap 'rm -rf "$WORK"; cleanup_test_tmp' EXIT
BASE="$WORK/endpoints.env"

run() { env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$BASE" node "$CLI" endpoints "$@"; }

# ── 1. set writes mode-600, token via stdin, NEVER echoes the token ──
setout="$(printf 'sekret-TOK-123' | run set glm --url https://api.z.ai/api/anthropic --token-stdin 2>&1)"; ec=$?
assert_exit_code "$ec" 0 "set exits 0"
assert_not_contains "$setout" 'sekret-TOK-123' "set never echoes the token value"
assert_contains "$setout" 'mode 600' "set reports mode 600"
mode="$(stat -c '%a' "$BASE" 2>/dev/null || stat -f '%Lp' "$BASE" 2>/dev/null)"
assert_eq "600" "$mode" "base file is mode 600"

# ── 2. list --json: correct presence, NO token leak ──
lj="$(run list --json 2>&1)"
node -e 'JSON.parse(require("fs").readFileSync(0))' <<<"$lj" >/dev/null 2>&1 && assert_eq ok ok "list --json is valid JSON" || fail "list --json invalid: $lj"
assert_not_contains "$lj" 'sekret-TOK-123' "list --json does not leak the token"
assert_contains "$lj" '"name":"glm"' "list shows glm"
assert_contains "$lj" '"ready":true' "glm is ready (url+token)"

# ── 3. token is NEVER accepted on argv (only --token-stdin exists) ──
argvout="$(run set glm --url https://x --token sekret 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "an argv --token flag is rejected (no argv token path)"
assert_contains "$argvout" 'unknown endpoints set option: --token' "rejects --token on argv"

# ── 4. doctor: healthy → exit 0; a url-only endpoint → exit 1 + flags missing token ──
run doctor >/dev/null 2>&1; assert_exit_code "$?" 0 "doctor healthy exits 0"
run set brokep --url https://only >/dev/null 2>&1
docout="$(run doctor 2>&1)"; ec=$?
assert_exit_code "$ec" 1 "doctor with an unresolved endpoint exits 1"
assert_contains "$docout" 'brokep: token missing' "doctor flags the missing token"

# ── 5. per-repo overlay: set --repo writes the keyed overlay; which shows base vs overlay ──
REPO="$WORK/repo"; mkdir -p "$REPO/.claude"
git -C "$REPO" init -q >/dev/null 2>&1
git -C "$REPO" remote add origin https://example.com/myproj.git
printf -- '- reviewer_endpoint: glm\n- implementer_endpoint: mm\n' > "$REPO/.claude/review-loop-config.md"
# glm already in base; put mm in the per-repo overlay
( cd "$REPO" && printf 'repo-TOK' | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$BASE" node "$CLI" endpoints set mm --url https://m --token-stdin --repo ) >/dev/null 2>&1
assert_file_exists "$WORK/endpoints.d/example_com_myproj.env" "set --repo wrote the keyed overlay file"
ovmode="$(stat -c '%a' "$WORK/endpoints.d/example_com_myproj.env" 2>/dev/null || stat -f '%Lp' "$WORK/endpoints.d/example_com_myproj.env" 2>/dev/null)"
assert_eq "600" "$ovmode" "overlay file is mode 600"

wj="$(cd "$REPO" && env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$BASE" node "$CLI" endpoints which --json 2>&1)"
node -e 'JSON.parse(require("fs").readFileSync(0))' <<<"$wj" >/dev/null 2>&1 && assert_eq ok ok "which --json valid" || fail "which --json invalid: $wj"
assert_not_contains "$wj" 'repo-TOK' "which --json does not leak the overlay token"
assert_not_contains "$wj" 'sekret-TOK-123' "which --json does not leak the base token"
assert_contains "$wj" '"role":"reviewer_endpoint","name":"glm"' "reviewer selects glm"
assert_contains "$wj" '"layer":"base"' "glm resolves from base"
assert_contains "$wj" '"layer":"overlay"' "mm resolves from the per-repo overlay"

# ── 6. set refuses to write through a symlink target ──
ln -s /etc/passwd "$WORK/symbase.env"
symout="$(printf t | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$WORK/symbase.env" node "$CLI" endpoints set x --url https://x --token-stdin 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "set refuses a symlink target"
assert_contains "$symout" 'symlink' "set explains the symlink refusal"

# ── 6b. newline-injection: a value with an embedded newline is refused, file NOT corrupted ──
INJBASE="$WORK/inj.env"
injurl="$(printf 'https://x\nAUTOPILOT_ENDPOINT_EVIL_TOKEN=pwned')"
injout="$(env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$INJBASE" node "$CLI" endpoints set glm --url "$injurl" 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "--url with an embedded newline is rejected"
assert_contains "$injout" 'https://' "explains the url-grammar refusal"
assert_file_absent "$INJBASE" "rejected injection wrote nothing (no EVIL line)"

# ── 6c. --url grammar (mirrors resolve-endpoint is_url_safe): non-https + whitespace rejected ──
env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$INJBASE" node "$CLI" endpoints set glm --url 'ftp://x' >/dev/null 2>&1; assert_exit_code "$?" 2 "non-https url rejected"
env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$INJBASE" node "$CLI" endpoints set glm --url 'https://a b' >/dev/null 2>&1; assert_exit_code "$?" 2 "url with whitespace rejected"
env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$INJBASE" node "$CLI" endpoints set glm --url 'http://localhost:8080/x' >/dev/null 2>&1; assert_exit_code "$?" 0 "http loopback url accepted"

# ── 6d. a token WITH shell metachars is accepted + round-trips LITERALLY (never executed) ──
# The file is a line-parser target, never sourced — so $()/;/backticks are safe to store.
META="$WORK/meta.env"
metatok='tok$(touch '"$WORK"'/CLIPWNED);`id`;a#b'
printf '%s' "$metatok" | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$META" node "$CLI" endpoints set glm --url https://x --token-stdin >/dev/null 2>&1
assert_exit_code "$?" 0 "token with shell metachars is accepted (file is never sourced)"
assert_file_absent "$WORK/CLIPWNED" "metachar token did NOT execute on write"
# and the loader reads it back literally, still no execution, glm resolves
metaload="$(env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$META" bash -c '. "'"$SH"'" && autopilot_load_endpoints_env; echo "T=[${AUTOPILOT_ENDPOINT_GLM_TOKEN:-}]"' 2>&1)"
assert_file_absent "$WORK/CLIPWNED" "metachar token did NOT execute on read-back either"
assert_contains "$metaload" 'T=[tok$(touch' "loader reads the metachar token back literally"
# token via stdin with an embedded newline is likewise refused
tokinj="$(printf 'abc\nAUTOPILOT_ENDPOINT_EVIL_TOKEN=pwned' | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$INJBASE" node "$CLI" endpoints set glm --url https://x --token-stdin 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "--token-stdin with an embedded newline is rejected"
assert_contains "$tokinj" 'control character' "explains the token newline-injection refusal"

# ── 6e. set into a directory target → clean status 2, NOT an uncaught crash (panel) ──
mkdir -p "$WORK/dirtarget"
dtout="$(printf t | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$WORK/dirtarget" node "$CLI" endpoints set glm --url https://x --token-stdin 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "set into a directory target exits 2 (clean)"
assert_not_contains "$dtout" 'at Object.' "no uncaught stack trace on a bad target"
assert_not_contains "$dtout" 'at cmdSet' "no uncaught stack trace frame"

# ── 6f. set hardens a pre-existing 0755 credential dir to 700 (MiniMax panel) ──
D755="$WORK/d755"; mkdir -p "$D755"; chmod 0755 "$D755"
printf t | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$D755/endpoints.env" node "$CLI" endpoints set glm --url https://x --token-stdin >/dev/null 2>&1
d7mode="$(stat -c '%a' "$D755" 2>/dev/null || stat -f '%Lp' "$D755" 2>/dev/null)"
assert_eq "700" "$d7mode" "set chmods a pre-existing credential dir to 700"

# ── 6g. atomic write leaves no .tmp turd + content round-trips ──
if ls "$D755"/*.tmp-* >/dev/null 2>&1; then fail "leftover .tmp file after set (non-atomic)"; else assert_eq ok ok "no leftover .tmp after set"; fi
env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$D755/endpoints.env" node "$CLI" endpoints list 2>/dev/null | grep -q 'glm' && assert_eq ok ok "set content round-trips (list sees glm)" || fail "set content not readable"

# ── 6h. list surfaces a perms-rejection warning (non-json) instead of a silent empty list (panel) ──
RJ="$WORK/rej.env"; printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=x\n' > "$RJ"; chmod 0666 "$RJ"
rjout="$(env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$RJ" node "$CLI" endpoints list 2>&1)"
assert_contains "$rjout" 'group/other-writable' "list surfaces the perms-rejection warning (not silent empty)"

# ── 7. unknown subcommand → exit 2 ──
run bogus >/dev/null 2>&1; assert_exit_code "$?" 2 "unknown subcommand exits 2"

# ── 8. test command assertions ──

# Test unconfigured name
unconf_out="$(run test non_existent 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "test on unconfigured endpoint exits 2"
assert_contains "$unconf_out" "not_configured" "unconfigured test prints not_configured"

unconf_json="$(run test non_existent --json 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "test on unconfigured endpoint with json exits 2"
assert_contains "$unconf_json" '"outcome":"not_configured"' "unconfigured json contains outcome"

# Start stub local HTTP server
STUB_JS="$WORK/stub_server.js"
PORT_FILE="$WORK/port.txt"
cat > "$STUB_JS" <<'EOF'
const http = require('http');
const fs = require('fs');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const auth = req.headers.authorization || '';
  
  if (url.pathname === '/v1/messages' && req.method === 'POST') {
    if (auth.includes('delay-token')) {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text: 'Delayed' }] }));
      }, 2000);
      return;
    }
    
    if (auth === 'Bearer valid-token') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text: 'OK' }] }));
      return;
    }
    
    if (auth === 'Bearer invalid-token') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'Invalid token' } }));
      return;
    }
  }
  res.writeHead(404);
  res.end();
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  fs.writeFileSync(process.argv[2], String(port));
});
EOF

node "$STUB_JS" "$PORT_FILE" &
STUB_PID=$!
# Wait for port file
for i in {1..30}; do
  if [ -f "$PORT_FILE" ]; then break; fi
  sleep 0.1
done
PORT=$(cat "$PORT_FILE")

# Update trap to cleanup the background stub server (keep chaining cleanup_test_tmp)
trap 'kill $STUB_PID 2>/dev/null; rm -rf "$WORK"; cleanup_test_tmp' EXIT

# Configure fake endpoints pointing to stub
printf 'valid-token' | run set stubok --url "http://127.0.0.1:$PORT" --token-stdin >/dev/null
printf 'invalid-token' | run set stuberr --url "http://127.0.0.1:$PORT" --token-stdin >/dev/null
printf 'delay-token' | run set stubdelay --url "http://127.0.0.1:$PORT" --token-stdin >/dev/null

# Test ok path
ok_out="$(run test stubok 2>&1)"; ec=$?
assert_exit_code "$ec" 0 "test ok exits 0"
assert_contains "$ok_out" "ok" "test ok prints ok"
assert_not_contains "$ok_out" "valid-token" "test ok does not leak token"

ok_json="$(run test stubok --json 2>&1)"; ec=$?
assert_exit_code "$ec" 0 "test ok --json exits 0"
assert_contains "$ok_json" '"outcome":"ok"' "test ok --json contains outcome:ok"
assert_not_contains "$ok_json" "valid-token" "test ok --json does not leak token"

# Test auth_failed path
err_out="$(run test stuberr 2>&1)"; ec=$?
assert_exit_code "$ec" 1 "test auth_failed exits 1"
assert_contains "$err_out" "auth_failed" "test auth_failed prints auth_failed"
assert_not_contains "$err_out" "invalid-token" "test auth_failed does not leak token"

err_json="$(run test stuberr --json 2>&1)"; ec=$?
assert_exit_code "$ec" 1 "test auth_failed --json exits 1"
assert_contains "$err_json" '"outcome":"auth_failed"' "test auth_failed --json contains outcome:auth_failed"
assert_not_contains "$err_json" "invalid-token" "test auth_failed --json does not leak token"

# Test timeout path
timeout_out="$(AUTOPILOT_TEST_TIMEOUT_MS=100 run test stubdelay 2>&1)"; ec=$?
assert_exit_code "$ec" 1 "test timeout exits 1"
assert_contains "$timeout_out" "network_failed" "test timeout prints network_failed"
assert_not_contains "$timeout_out" "delay-token" "test timeout does not leak token"

timeout_json="$(AUTOPILOT_TEST_TIMEOUT_MS=100 run test stubdelay --json 2>&1)"; ec=$?
assert_exit_code "$ec" 1 "test timeout --json exits 1"
assert_contains "$timeout_json" '"outcome":"network_failed"' "test timeout --json contains outcome:network_failed"
assert_not_contains "$timeout_json" "delay-token" "test timeout --json does not leak token"

# ── 9. repo-keying UX notes assertions ──

# Test `which` shows repo_key_source in both modes:
# Mode A: with remote (already set origin url in REPO above)
wj_remote_json="$(cd "$REPO" && env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$BASE" node "$CLI" endpoints which --json 2>&1)"
assert_contains "$wj_remote_json" '"repo_key_source":"remote"' "which --json remote mode contains repo_key_source:remote"

# Mode B: without remote (create a new repo under $WORK/noremote, no origin)
NOREMOTE="$WORK/noremote"; mkdir -p "$NOREMOTE/.claude"
git -C "$NOREMOTE" init -q >/dev/null 2>&1
wj_noremote="$(cd "$NOREMOTE" && env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$BASE" node "$CLI" endpoints which 2>&1)"
assert_contains "$wj_noremote" "Warning: repo-key is path-fallback" "which non-json fallback mode prints path-fallback warning"
wj_noremote_json="$(cd "$NOREMOTE" && env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$BASE" node "$CLI" endpoints which --json 2>&1)"
assert_contains "$wj_noremote_json" '"repo_key_source":"path-fallback"' "which --json fallback mode contains repo_key_source:path-fallback"

# Test `set --repo` warning when no remote
set_warn_out="$(cd "$NOREMOTE" && printf 'noremote-token' | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$BASE" node "$CLI" endpoints set mm --url https://m --token-stdin --repo 2>&1)"
assert_contains "$set_warn_out" "Warning: repo has no git remote. Overlay is keyed to the checkout PATH" "set --repo prints warning when no remote"

finalize_test
