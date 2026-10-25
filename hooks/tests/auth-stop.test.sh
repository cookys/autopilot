#!/usr/bin/env bash
# hooks/tests/auth-stop.test.sh -- scripts/lib/auth-stop.js (BL-0294): what counts as an authentication
# failure, in both directions. A generic failure must never stop a batch; a dead credential must.
. "$(dirname "$0")/lib.sh"

HELPER="$REPO_ROOT/scripts/lib/auth-stop.js"
chk() { node "$HELPER" check --id T1 "$@" < /dev/null 2>"$TEST_TMP/chk.err"; CHK_RC=$?; CHK_ERR="$(cat "$TEST_TMP/chk.err")"; }

# --- auth failures (each phrase is a real runner output, see the helper header) ---
for phrase in \
  'Failed to authenticate. API Error: 401' \
  'OAuth session expired, please log in' \
  'API Error: authentication_failed' \
  'Invalid API key · Please run /login' \
  'Not logged in · Please run /login' \
  'OAuth token has expired' \
  '401 Unauthorized: bad credentials' \
  'HTTP 401 unauthorised' \
  'invalid API key authorization failed' \
  'login required' \
  'API Error: 401 {"type":"error"}' \
  'request failed with status 401' \
  '{"status":401,"message":"x"}' \
  'Invalid API key' \
  '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'; do
  chk --text "$phrase"
  assert_eq "6" "$CHK_RC" "auth phrase stops: $phrase"
  assert_contains "$CHK_ERR" "STOP_AUTH after T1:" "stop line names the id: $phrase"
done

# --- NOT auth failures (must not stop a batch) ---
for phrase in \
  '429 rate limit reached' \
  '529 overloaded' \
  'API Error: 403 forbidden by policy' \
  'timed out after 30s' \
  'simulated failure' \
  'implement the authentication module for the author page' \
  'Unauthorized access to the repo is a policy topic' \
  'exit code 401 from the build tool' \
  'API Error: 403 permission_error' \
  '{"type":"error","error":{"type":"permission_error","message":"nope"}}' \
  'processed 401 records'; do
  chk --text "$phrase"
  assert_eq "0" "$CHK_RC" "generic failure does not stop: $phrase"
done

# --- structured reading: model prose inside JSON assistant lines is never searched ---
S="$TEST_TMP/structured.jsonl"
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"the docs say: Failed to authenticate means log in"}]}}' \
  '{"type":"result","is_error":false,"result":"Not logged in is what the CLI prints"}' > "$S"
chk --log "$S"
assert_eq "0" "$CHK_RC" "assistant prose and a successful result are not auth failures"
printf '%s\n' '{"type":"result","is_error":true,"api_error_status":401,"result":"x"}' > "$S"
chk --log "$S"
assert_eq "6" "$CHK_RC" "is_error result with api_error_status 401 stops"
printf '%s\n' '{"type":"result","is_error":true,"api_error_status":429,"result":"slow down"}' > "$S"
chk --log "$S"
assert_eq "0" "$CHK_RC" "is_error result with api_error_status 429 does not stop"
printf '%s\n' '{"status":"failure","error":"Failed to authenticate"}' > "$S"
chk --log "$S"
assert_eq "6" "$CHK_RC" "dispatch JSON error string stops"
printf 'plain stderr line\nOAuth session expired\n' > "$S"
chk --log "$S"
assert_eq "6" "$CHK_RC" "plain-text line in a mixed log stops"
printf 'OAuth session expired\n' > "$S"
chk --stderr "$S"
assert_eq "6" "$CHK_RC" "stderr file stops"

# --- structured layer: dispatch result names the runner's own log; weak phrases are not searched in plain mixed-log lines ---
printf '%s\n' '{"status":"failure","agent_log":"'"$TEST_TMP"'/agent.log"}' > "$S"
echo '{"type":"result","is_error":true,"result":"OAuth session expired"}' > "$TEST_TMP/agent.log"
chk --dispatch "$S"
assert_eq "6" "$CHK_RC" "dispatch result: auth error only in the agent_log it names stops"
echo '{"type":"result","is_error":true,"result":"rate limit"}' > "$TEST_TMP/agent.log"
chk --dispatch "$S"
assert_eq "0" "$CHK_RC" "dispatch result: a non-auth agent_log does not stop"
printf 'candidate code says: invalid API key\n' > "$S"
chk --log "$S"
assert_eq "0" "$CHK_RC" "a weak phrase in a plain line of a mixed log does not stop"
chk --stderr "$S"
assert_eq "6" "$CHK_RC" "the same weak phrase in stderr stops"
echo '{"type":"error","error":{"type":"authentication_error"}}' > "$S"
chk --log "$S"
assert_eq "6" "$CHK_RC" "Anthropic authentication_error envelope in a log stops"

# --- plumbing ---
chk --stderr "$TEST_TMP/missing-file"
assert_eq "0" "$CHK_RC" "a missing file is skipped, not an error"
chk --bogus x
assert_eq "2" "$CHK_RC" "unknown option is a usage error"

# --- parity with the wrapper-local regex this helper generalises (run-p2-batch.js is not rewired: it is hash-bound) ---
P2_RE="$(grep -m1 '^const AUTH_RE' "$REPO_ROOT/evals/orchestration/run-p2-batch.js")"
for w in 'failed to authenticate' 'oauth session expired' 'authentication_failed'; do
  assert_contains "$P2_RE" "$w" "run-p2-batch.js AUTH_RE still names: $w"
  chk --text "$w"
  assert_eq "6" "$CHK_RC" "helper covers the p2 phrase: $w"
done

# --- negative control: with the pattern list emptied, the stop test above would go red ---
MUT="$TEST_TMP/mut"; mkdir -p "$MUT"; cp "$HELPER" "$MUT/auth-stop.js"
sed -i 's/^const AUTH_PATTERNS = \[/const AUTH_PATTERNS = [ \/\\bnever-matches-anything\\b\/, ].concat([/; s/^\];$/]).slice(0, 1);/' "$MUT/auth-stop.js"
node "$MUT/auth-stop.js" check --id T1 --text 'Failed to authenticate' < /dev/null 2>/dev/null; MUT_RC=$?
assert_neq "6" "$MUT_RC" "negative control: a helper with no live pattern does not stop (the stop assertion would be red)"

finalize_test
