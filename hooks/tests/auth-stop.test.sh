#!/usr/bin/env bash
# hooks/tests/auth-stop.test.sh -- scripts/lib/auth-stop.js (BL-0294): what counts as an authentication
# failure, in both directions. A generic failure must never stop a batch; a dead credential must.
. "$(dirname "$0")/lib.sh"

HELPER="$REPO_ROOT/scripts/lib/auth-stop.js"
chk() { node "$HELPER" check --id T1 --failed "${FAILED:-1}" "$@" < /dev/null 2>"$TEST_TMP/chk.err"; CHK_RC=$?; CHK_ERR="$(cat "$TEST_TMP/chk.err")"; }

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
  'Please log in to continue.' \
  'Authentication error' \
  'Authentication failed: token expired' \
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

# --- the call decides: a SUCCESSFUL call is never an auth failure, whatever its text says ---
for phrase in 'Invalid API key' 'Failed to authenticate' 'OAuth session expired' 'login required' 'API Error: 401 Unauthorized' 'Please log in to continue.' 'Authentication error'; do
  FAILED=0 chk --text "$phrase"
  assert_eq "0" "$CHK_RC" "successful call quoting '$phrase' does not stop"
done
FAILED=0 chk --stderr "$TEST_TMP/missing-file"
assert_eq "0" "$CHK_RC" "a successful call with a missing file does not stop"

# --- text phrases from the table that only a FAILED call may count (mixed stream, no stdout/stderr distinction) ---
S="$TEST_TMP/mixed.log"
printf 'plain line\nthe assistant says nothing\nerror: invalid api key\n' > "$S"
chk --log "$S"
assert_eq "6" "$CHK_RC" "failed call: weak phrase in a mixed log stops"
FAILED=0 chk --log "$S"
assert_eq "0" "$CHK_RC" "successful call: the same mixed log does not stop"
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Authentication failed: token expired"}]}}' > "$S"
chk --log "$S"
assert_eq "6" "$CHK_RC" "failed call: a phrase anywhere in any output counts"

# --- structured fields decide on their own, even for a call that looks successful ---
echo '{"type":"result","is_error":false,"api_error_status":401}' > "$S"
FAILED=0 chk --log "$S"; assert_eq "6" "$CHK_RC" "structured status 401 stops without a failed call"
echo '{"type":"error","error":{"type":"authentication_error","message":"x"}}' > "$S"
FAILED=0 chk --log "$S"; assert_eq "6" "$CHK_RC" "structured authentication_error stops without a failed call"
echo '{"type":"error","error":{"type":"permission_error"},"status":403}' > "$S"
chk --log "$S"; assert_eq "0" "$CHK_RC" "structured permission_error / 403 does not stop"
echo '{"type":"result","is_error":true,"api_error_status":429,"result":"slow down"}' > "$S"
chk --log "$S"; assert_eq "0" "$CHK_RC" "429 does not stop"

# --- failure signal from a dispatch result ---
printf '%s\n' '{"status":"committed","agent_log":"'"$TEST_TMP"'/agent.log"}' > "$S"
echo 'Invalid API key' > "$TEST_TMP/agent.log"
node "$HELPER" check --id T1 --failed-from "$S" --dispatch "$S" < /dev/null 2>/dev/null; assert_eq "0" "$?" "committed dispatch result: its agent_log quoting a phrase does not stop"
printf '%s\n' '{"status":"failure","agent_log":"'"$TEST_TMP"'/agent.log"}' > "$S"
node "$HELPER" check --id T1 --failed-from "$S" --dispatch "$S" < /dev/null 2>/dev/null; assert_eq "6" "$?" "failed dispatch result: the phrase in the agent_log it names stops"
node "$HELPER" check --id T1 --failed-from "$TEST_TMP/missing-file" --text 'Invalid API key' < /dev/null 2>/dev/null; assert_eq "6" "$?" "an unreadable result counts as failed"
node "$HELPER" check --id T1 --text 'Invalid API key' < /dev/null 2>/dev/null; assert_eq "2" "$?" "no failure signal given is a usage error"
echo '{"status":"no_op","agent_log":"'"$TEST_TMP"'/agent.log"}' > "$S"
node "$HELPER" check --id T1 --failed-from "$S" --dispatch "$S" < /dev/null 2>/dev/null; assert_eq "6" "$?" "no_op dispatch result (exit-0 runner, nothing committed) counts as failed"
printf 'Please log in to continue.\n' > "$S"
node "$HELPER" check --id T1 --failed-from-json "$S" --log "$S" < /dev/null 2>/dev/null; assert_eq "6" "$?" "json call with no result object (exit 0, plain auth message) counts as failed"
node "$HELPER" check --id T1 --failed-from-stream "$S" --log "$S" < /dev/null 2>/dev/null; assert_eq "6" "$?" "stream call with no result line counts as failed"
echo '{"type":"result","subtype":"success","is_error":false,"result":"Invalid API key is a phrase"}' > "$S"
node "$HELPER" check --id T1 --failed-from-json "$S" --log "$S" < /dev/null 2>/dev/null; assert_eq "0" "$?" "json call with a successful result object quoting a phrase does not stop"
node "$HELPER" check --id T1 --failed-from-stream "$S" --log "$S" < /dev/null 2>/dev/null; assert_eq "0" "$?" "stream call with a successful result line quoting a phrase does not stop"
echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Please log in to continue."}' > "$S"
node "$HELPER" check --id T1 --failed-from-json "$S" --log "$S" < /dev/null 2>/dev/null; assert_eq "6" "$?" "json call reporting is_error with an auth message stops"

# --- the shipped docs must say what the code does: no_op is a failure, not a success
assert_not_contains "$(cat "$HELPER")" "committed / no_op / reviewed" "helper header does not list no_op as a success status"
assert_contains "$(cat "$HELPER")" "no_op is NOT a success" "helper header says why no_op counts as failed"
assert_not_contains "$(grep -m1 'no_op' "$REPO_ROOT/docs/scripts-inventory.md" | grep -o 'committed / no_op' || true)" "committed / no_op" "inventory row does not list no_op as a success status"

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
sed_mutate "$MUT/auth-stop.js" 's/^const AUTH_PATTERNS = \[/const AUTH_PATTERNS = [ \/\\bnever-matches-anything\\b\/, ].concat([/'
sed_mutate "$MUT/auth-stop.js" 's/^\];$/]).slice(0, 1);/'
node "$MUT/auth-stop.js" check --id T1 --failed 1 --text 'Failed to authenticate' < /dev/null 2>/dev/null; MUT_RC=$?
assert_eq "0" "$MUT_RC" "negative control: mutant runs and reports clean (not a usage error)"
assert_neq "6" "$MUT_RC" "negative control: a helper with no live pattern does not stop (the stop assertion would be red)"

finalize_test
