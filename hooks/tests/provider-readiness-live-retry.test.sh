#!/usr/bin/env bash
# v2.36.76: the strict /l5 readiness live probe retries ONCE when the provider answered but
# not with `OK` (a compliance flake: refusal or small talk → dispatch-author `truncated/frame_missing`,
# or an authored reply that does not normalise to OK). Transport-class outcomes (auth, quota,
# generic exit failure, timeout, precondition) never retry. Measured 2026-09-20 on
# qoderclicn/Qwen3.8-Max-Preview: 1 reply in ~6 refused the probe, two Qwen seats per roster
# → three consecutive strict campaigns blocked at provider_readiness.
. "$(dirname "$0")/lib.sh"

FAKE_AUTHOR="$TEST_TMP/fake-dispatch-author.sh"
cat > "$FAKE_AUTHOR" <<'FAKE'
#!/usr/bin/env bash
set -u
count_file="$FAKE_COUNT_FILE"
n=0; [ -f "$count_file" ] && n=$(cat "$count_file")
n=$((n + 1)); printf '%s' "$n" > "$count_file"
# FAKE_SEQUENCE: comma-separated per-call modes; the last one repeats.
IFS=',' read -r -a modes <<< "$FAKE_SEQUENCE"
idx=$((n - 1)); [ "$idx" -ge "${#modes[@]}" ] && idx=$(( ${#modes[@]} - 1 ))
mode="${modes[$idx]}"
case "$mode" in
  ok)
    printf 'OK\n' > "$FAKE_RAW_LOG.$n"
    printf '{"status":"authored","raw_log":"%s","error":null}\n' "$FAKE_RAW_LOG.$n"; exit 0 ;;
  chat)
    printf "I'm here and ready to help. What can I do for you?\n" > "$FAKE_RAW_LOG.$n"
    printf '{"status":"authored","raw_log":"%s","error":null}\n' "$FAKE_RAW_LOG.$n"; exit 0 ;;
  refuse)
    printf '{"status":"truncated","raw_log":"%s","error":"frame_missing"}\n' "$FAKE_RAW_LOG.$n"; exit 5 ;;
  auth)
    printf '{"status":"precondition_failed","raw_log":null,"error":"401 unauthorized"}\n'; exit 2 ;;
  quota)
    printf '{"status":"runner_failed","raw_log":null,"error":"quota exhausted"}\n'; exit 3 ;;
  generic)
    printf '{"status":"runner_failed","raw_log":null,"error":"process exited 9"}\n'; exit 3 ;;
esac
FAKE
chmod +x "$FAKE_AUTHOR"

run_case() {
  # $1 = sequence, $2 = expected classification, $3 = expected call count, $4 = label
  local seq="$1" expect="$2" calls="$3" label="$4"
  rm -f "$TEST_TMP/count"
  local out
  out="$(FAKE_COUNT_FILE="$TEST_TMP/count" FAKE_SEQUENCE="$seq" FAKE_RAW_LOG="$TEST_TMP/raw" \
    node - "$REPO_ROOT" "$FAKE_AUTHOR" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const scriptPath = process.argv[3];
const { LIVE_PROBE_REQUEST, classifyLiveProbeResult } = require(path.join(root, 'src', 'readiness', 'probe'));
const { dispatchAuthorLiveProbe } = require(path.join(root, 'src', 'readiness', 'live-probe'));
const tuple = { role: 'verification_author', runner: 'qoderclicn', model: 'Qwen3.8-Max-Preview', effort: 'high', endpoint: null };
const result = dispatchAuthorLiveProbe({ tuple, request: LIVE_PROBE_REQUEST }, { scriptPath });
process.stdout.write(`classification=${classifyLiveProbeResult(tuple, result)}\n`);
NODE
)"
  assert_exit_code "$?" "0" "$label: adapter runs"
  assert_contains "$out" "classification=$expect" "$label: classification is $expect"
  assert_eq "$calls" "$(cat "$TEST_TMP/count")" "$label: dispatch-author called $calls time(s)"
}

# RED at base b04a9354: refuse,ok → transport_failure with 1 call (no retry existed).
run_case "refuse,ok" "success" "2" "refusal then OK retries once and succeeds"
# RED at base b04a9354: chat,ok → malformed_response with 1 call.
run_case "chat,ok" "success" "2" "small talk then OK retries once and succeeds"
# Bounded: two flakes in a row stay a failure after exactly 2 calls (never a third).
run_case "refuse,refuse,ok" "transport_failure" "2" "two refusals stop at the attempt cap"
run_case "chat,chat,ok" "malformed_response" "2" "two chats stop at the attempt cap"
# Happy path and transport-class outcomes never retry.
run_case "ok" "success" "1" "OK first time makes one call"
run_case "auth,ok" "auth_failed" "1" "auth failure never retries"
run_case "quota,ok" "quota_exhausted" "1" "quota never retries"
run_case "generic,ok" "transport_failure" "1" "generic exit failure never retries"

finalize_test
