#!/usr/bin/env bash
# Readiness probe single-line frame (peer-reported 2026-10-03, cuda/chatgpt-tunnel):
# a model that answers `<open-marker>OK<close-marker>` on ONE line was reported as
# dispatch-author `truncated/frame_missing` -> transport_failure. Contract:
#  (a) the readiness probe alone accepts exactly that form with the run's own marker id and
#      payload exactly `OK`; wrong id / other payload / extra text stay not-ready;
#  (b) dispatch-author names the class `frame_format` (any caller) and the probe result keeps
#      a bounded, redacted stderr tail + dispatch-result envelope.
# The general author path still rejects the single-line form (dispatch-author.test.sh).
. "$(dirname "$0")/lib.sh"

FAKE_AUTHOR="$TEST_TMP/fake-dispatch-author.sh"
cat > "$FAKE_AUTHOR" <<'FAKE'
#!/usr/bin/env bash
set -u
count_file="$FAKE_COUNT_FILE"
n=0; [ -f "$count_file" ] && n=$(cat "$count_file")
n=$((n + 1)); printf '%s' "$n" > "$count_file"
D=0123456789abcdef0123456789abcdef
O="<<<AUTOPILOT-AUTHOR-${D}>>>"; C="<<<AUTOPILOT-END-${D}>>>"
raw="$FAKE_RAW_LOG.$n"
case "$FAKE_MODE" in
  oneline)      printf '%sOK%s\n' "$O" "$C" > "$raw" ;;
  oneline_ws)   printf '\n  %sOK%s  \n\n' "$O" "$C" > "$raw" ;;
  wrongnonce)   printf '<<<AUTOPILOT-AUTHOR-ffffffffffffffffffffffffffffffff>>>OK<<<AUTOPILOT-END-ffffffffffffffffffffffffffffffff>>>\n' > "$raw" ;;
  mismatchpair) printf '%sOK<<<AUTOPILOT-END-ffffffffffffffffffffffffffffffff>>>\n' "$O" > "$raw" ;;
  extratext)    printf '%sOK%s trailing\n' "$O" "$C" > "$raw" ;;
  prefixtext)   printf 'sure: %sOK%s\n' "$O" "$C" > "$raw" ;;
  otherpayload) printf '%sNOPE%s\n' "$O" "$C" > "$raw" ;;
  twolines)     printf '%sOK\n%s\n' "$O" "$C" > "$raw" ;;
  separate)     printf 'OK\n' > "$raw" ;;
esac
echo "runner stderr: Authorization: Bearer sk-SECRETSENTINEL0123456789 something went odd" >&2
if [ "$FAKE_MODE" = separate ]; then
  printf '{"status":"authored","raw_log":"%s","error":null}\n' "$raw"; exit 0
fi
printf '{"status":"truncated","raw_log":"%s","error":"frame_format","frame_derived":"%s"}\n' "$raw" "$D"; exit 5
FAKE
chmod +x "$FAKE_AUTHOR"

run_case() {
  # $1 = mode, $2 = expected classification, $3 = expected call count, $4 = label
  local mode="$1" expect="$2" calls="$3" label="$4"
  rm -f "$TEST_TMP/count"
  local out
  out="$(FAKE_COUNT_FILE="$TEST_TMP/count" FAKE_MODE="$mode" FAKE_RAW_LOG="$TEST_TMP/raw" \
    node - "$REPO_ROOT" "$FAKE_AUTHOR" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const scriptPath = process.argv[3];
const { LIVE_PROBE_REQUEST, classifyLiveProbeResult } = require(path.join(root, 'src', 'readiness', 'probe'));
const { dispatchAuthorLiveProbe } = require(path.join(root, 'src', 'readiness', 'live-probe'));
const tuple = { role: 'reviewer', runner: 'claude-native', model: 'claude-fable-5', effort: 'max', endpoint: null };
const result = dispatchAuthorLiveProbe({ tuple, request: LIVE_PROBE_REQUEST }, { scriptPath });
process.stdout.write(`classification=${classifyLiveProbeResult(tuple, result)}\n`);
const d = result.diagnostics;
process.stdout.write(`diagnostics=${d ? 'present' : 'absent'}\n`);
if (d) {
  const text = JSON.stringify(d);
  process.stdout.write(`diag_bytes_ok=${Buffer.byteLength(text) <= 2048}\n`);
  process.stdout.write(`diag_secret_free=${!text.includes('SECRETSENTINEL')}\n`);
  process.stdout.write(`diag_has_stderr=${/something went odd/.test(d.stderr_tail || '')}\n`);
  process.stdout.write(`diag_error=${d.dispatch_result && d.dispatch_result.error}\n`);
}
NODE
)"
  assert_exit_code "$?" "0" "$label: adapter runs"
  assert_contains "$out" "classification=$expect" "$label: classification is $expect"
  assert_eq "$calls" "$(cat "$TEST_TMP/count")" "$label: dispatch-author called $calls time(s)"
  LAST_OUT="$out"
}

# (a) strict single-line extra form
run_case oneline success 1 "nonce-exact single-line OK is ready"
run_case oneline_ws success 1 "single-line OK with surrounding whitespace/newlines is ready"
run_case wrongnonce frame_format 2 "single-line frame with a foreign nonce is not ready"
run_case mismatchpair frame_format 2 "open/close with different ids is not ready"
run_case extratext frame_format 2 "extra text after the close marker is not ready"
run_case prefixtext frame_format 2 "extra text before the open marker is not ready"
run_case otherpayload frame_format 2 "single-line frame with a payload other than OK is not ready"
run_case twolines frame_format 2 "frame split across two lines is still not accepted by the probe form"
# normal separate-lines (already unwrapped by dispatch-author) unchanged
run_case separate success 1 "separate-lines normal case is unchanged"

# (b) diagnostics kept on failure: bounded, no secret
run_case wrongnonce frame_format 2 "failure diagnostics"
assert_contains "$LAST_OUT" "diagnostics=present" "failure result keeps diagnostics"
assert_contains "$LAST_OUT" "diag_bytes_ok=true" "diagnostics are bounded"
assert_contains "$LAST_OUT" "diag_secret_free=true" "diagnostics carry no secret"
assert_contains "$LAST_OUT" "diag_has_stderr=true" "diagnostics keep the stderr tail"
assert_contains "$LAST_OUT" "diag_error=frame_format" "diagnostics keep the dispatch-result error"
run_case oneline success 1 "success diagnostics"
assert_contains "$LAST_OUT" "diagnostics=absent" "success carries no diagnostics"

# runProviderProbe surfaces frame_format + diagnostics in the receipt body and persists the outcome
OUT="$(FAKE_COUNT_FILE="$TEST_TMP/count2" FAKE_MODE=wrongnonce FAKE_RAW_LOG="$TEST_TMP/raw2" \
  node - "$REPO_ROOT" "$FAKE_AUTHOR" "$TEST_TMP/store" <<'NODE'
'use strict';
const path = require('path');
const [root, scriptPath, store] = process.argv.slice(2);
const { runProviderProbe } = require(path.join(root, 'src', 'readiness', 'probe'));
const { dispatchAuthorLiveProbe } = require(path.join(root, 'src', 'readiness', 'live-probe'));
const tuple = { role: 'reviewer', runner: 'claude-native', model: 'claude-fable-5', effort: 'max', endpoint: null };
const r = runProviderProbe({ tuple, now: '2026-10-03T12:00:00.000Z', ttl_seconds: 600, store }, {
  safeProbe: () => ({ status: 'ready', evidence_class: 'safe-surface', reason: null }),
  liveProbe: (i) => dispatchAuthorLiveProbe(i, { scriptPath }),
});
process.stdout.write(`outcome=${r.live_probe.outcome}\n`);
process.stdout.write(`live_status=${r.live_observation.status}\n`);
process.stdout.write(`receipt_diag=${r.live_probe.diagnostics ? r.live_probe.diagnostics.dispatch_result.error : 'absent'}\n`);
process.stdout.write(`receipt_secret_free=${!JSON.stringify(r).includes('SECRETSENTINEL')}\n`);
NODE
)"
assert_exit_code "$?" "0" "runProviderProbe with frame_format runs"
assert_contains "$OUT" "outcome=frame_format" "receipt outcome is frame_format"
assert_contains "$OUT" "live_status=unknown" "frame_format leaves readiness unknown (not blocked)"
assert_contains "$OUT" "receipt_diag=frame_format" "receipt keeps the dispatch-result envelope"
assert_contains "$OUT" "receipt_secret_free=true" "receipt carries no secret"

finalize_test
