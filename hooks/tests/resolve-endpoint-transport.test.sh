#!/usr/bin/env bash
# resolve-endpoint-transport.test.sh — pin endpoint transport consistency:
#   1. http private-range IP literal WITH AUTOPILOT_ENDPOINT_<NAME>_TRANSPORT=plaintext-private
#      -> ready:true, url_safe:true, transport_security:plaintext_private
#   2. SAME http private-range endpoint WITHOUT the opt-in
#      -> ready:false, missing[] contains url_unsafe + transport_optin_required,
#         and dispatch-hetero.sh has the die_precondition gate at apply_runner_local
#   3. http HOSTNAME endpoint (DNS name, not IP literal) even WITH the opt-in
#      -> ready:false, missing[] contains url_unsafe
#   4. Unlisted endpoint name with --runner local
#      -> dispatch-hetero.sh refuses with the L3517 die_precondition message

. "$(dirname "$0")/lib.sh"

RESOLVE_SH="$REPO_ROOT/scripts/resolve-endpoint.sh"
DISPATCH_SH="$REPO_ROOT/scripts/dispatch-hetero.sh"
EMPTY_ENV="$TEST_TMP/nonexistent-endpoints.env"

# 1. http private-range literal WITH plaintext-private opt-in
rc=0
out="$(
  AUTOPILOT_ENDPOINTS_ENV="$EMPTY_ENV" \
  AUTOPILOT_ENDPOINT_GLM_LOCAL_URL="http://10.1.2.3:8780" \
  AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN="fake-token-not-a-secret" \
  AUTOPILOT_ENDPOINT_GLM_LOCAL_TRANSPORT="plaintext-private" \
  bash "$RESOLVE_SH" glm_local 2>/dev/null
)" || rc=$?
assert_eq "0" "$rc" "private-range http with plaintext-private opt-in exits 0"
assert_contains "$out" '"ready":true' "private-range http with opt-in is ready:true"
assert_contains "$out" '"url_safe":true' "private-range http with opt-in is url_safe:true"
assert_contains "$out" '"transport_security":"plaintext_private"' "private-range http with opt-in has transport_security:plaintext_private"

# 2. SAME http private-range endpoint WITHOUT the opt-in
rc=0
out="$(
  AUTOPILOT_ENDPOINTS_ENV="$EMPTY_ENV" \
  AUTOPILOT_ENDPOINT_GLM_LOCAL_URL="http://10.1.2.3:8780" \
  AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN="fake-token-not-a-secret" \
  bash "$RESOLVE_SH" glm_local 2>/dev/null
)" || rc=$?
assert_eq "1" "$rc" "private-range http without opt-in exits 1"
assert_contains "$out" '"ready":false' "private-range http without opt-in is ready:false"
assert_contains "$out" '"url_unsafe"' "private-range http without opt-in missing[] has url_unsafe"
assert_contains "$out" '"transport_optin_required"' "private-range http without opt-in missing[] has transport_optin_required"
if grep -q 'die_precondition "--runner local refuses unlisted --endpoint' "$DISPATCH_SH"; then
  PASS=$((PASS + 1))
else
  fail "dispatch-hetero.sh missing L3517 die_precondition path"
fi

# 3. http HOSTNAME endpoint (DNS name, not IP literal) even WITH the opt-in
rc=0
out="$(
  AUTOPILOT_ENDPOINTS_ENV="$EMPTY_ENV" \
  AUTOPILOT_ENDPOINT_TEST_HOST_URL="http://gateway.internal.example:8780" \
  AUTOPILOT_ENDPOINT_TEST_HOST_TOKEN="fake-token-not-a-secret" \
  AUTOPILOT_ENDPOINT_TEST_HOST_TRANSPORT="plaintext-private" \
  bash "$RESOLVE_SH" test_host 2>/dev/null
)" || rc=$?
assert_eq "1" "$rc" "http hostname with plaintext-private opt-in exits 1"
assert_contains "$out" '"ready":false' "http hostname with opt-in is ready:false"
assert_contains "$out" '"url_unsafe"' "http hostname with opt-in missing[] has url_unsafe"

# 4. Unlisted endpoint name with --runner local -> dispatch-hetero refuses with L3517 precondition
rc=0
err="$(
  AUTOPILOT_ENDPOINTS_ENV="$EMPTY_ENV" \
  bash "$DISPATCH_SH" --runner local --endpoint unlisted_test_ep --prompt "x" 2>&1 >/dev/null
)" || rc=$?
assert_neq "0" "$rc" "dispatch-hetero --runner local refuses unlisted endpoint"
assert_contains "$err" "refuses unlisted --endpoint unlisted_test_ep" "dispatch-hetero emits L3517 unlisted endpoint precondition"

finalize_test
