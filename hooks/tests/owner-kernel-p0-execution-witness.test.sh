#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/execution-witness-controls.js"
OUT="$TEST_TMP/execution-witness-controls.json"
ERR="$TEST_TMP/execution-witness-controls.err"

node "$SCRIPT" --repo "$REPO_ROOT" --tmp "$TEST_TMP/controls" >"$OUT" 2>"$ERR"
RC=$?

assert_exit_code "$RC" 0 "execution witness controls pass"
assert_contains "$(cat "$OUT")" '"signed_payload_verified": true' "signed payload is verified"
assert_contains "$(cat "$OUT")" '"tampered_payload_rejected": true' "tampered payload is rejected"
assert_contains "$(cat "$OUT")" '"namespace_pid_trace_verified": true' "namespace trace pid is verified"
assert_contains "$(cat "$OUT")" '"fdwrite_trace_verified": true' "fdwrite trace is verified"
assert_contains "$(cat "$OUT")" '"classifier_rejected_payload_self_claim": true' "classifier rejects self-claimed proof"
assert_contains "$(cat "$OUT")" '"classifier_rejected_tampered_driver_marked_payload": true' "classifier rejects tampered driver-marked proof"
assert_contains "$(cat "$OUT")" '"classifier_accepted_driver_verified_payload": true' "classifier accepts driver-verified proof"
assert_contains "$(cat "$OUT")" '"classifier_accepted_fdwrite_verified_payload": true' "classifier accepts fdwrite driver-verified proof"
assert_contains "$(cat "$OUT")" '"classifier_rejected_bad_fdwrite_driver": true' "classifier rejects malformed fdwrite proof"
assert_contains "$(cat "$OUT")" '"classifier_accepted_agy_self_disable_denial_for_none": true' "classifier closes agy self-disable denial operation"
assert_contains "$(cat "$OUT")" '"classifier_rejected_malformed_agy_self_disable_attempt": true' "classifier rejects malformed agy self-disable attempt"
assert_contains "$(cat "$OUT")" '"classifier_accepted_codex_json_driver": true' "classifier accepts Codex JSON command execution proof"
assert_contains "$(cat "$OUT")" '"classifier_rejected_codex_json_driver_hash_mismatch": true' "classifier rejects bad Codex JSON command execution proof"
assert_contains "$(cat "$OUT")" '"classifier_rejected_codex_json_driver_shape_variants": 9' "classifier rejects malformed Codex JSON command execution shapes"

STUB_BIN="$TEST_TMP/bin"
mkdir -p "$STUB_BIN"
cat >"$STUB_BIN/codex" <<'STUB'
#!/usr/bin/env bash
last=""
for arg in "$@"; do
  last="$arg"
done
cmd="${last#*: }"
set -f
set -- $cmd
if [ "$#" -ne 7 ] || [ "$1" != "node" ] || [ "$3" != "--nonce" ] || [ "$5" != "--repo" ] || [ "$7" != "--json" ]; then
  echo "unexpected witness command shape" >&2
  exit 64
fi
if [ "${STUB_CODEX_FAKE_WITNESS:-0}" = "1" ]; then
  nonce="$4"
  zeros="0000000000000000000000000000000000000000000000000000000000000000"
  printf '{"probe":"owner-kernel-p0-host-capability","nonce_echo":"%s","findings":{},"execution_proof":"host_process_witnessed","execution_witness":{"kind":"host_wrapper_payload_hash","version":1,"probe":"owner-kernel-p0-host-capability","nonce_echo":"%s","payload_sha256":"%s","wrapper_pid":999999,"parent_pid":999998,"wrapper_script":"host-capability-witness.js","node":"node"}}\n' "$nonce" "$nonce" "$zeros"
  exit 0
fi
exec "$1" "$2" "$3" "$4" "$5" "$6" "$7"
STUB
chmod +x "$STUB_BIN/codex"

DRIVER_OUT="$TEST_TMP/driver-codex.json"
DRIVER_ERR="$TEST_TMP/driver-codex.err"
PATH="$STUB_BIN:$PATH" bash "$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/run-harness-probes.sh" \
  --only codex --mode bypass --timeout 15 --out "$DRIVER_OUT" >"$TEST_TMP/driver-codex.stdout" 2>"$DRIVER_ERR"
DRIVER_RC=$?

assert_exit_code "$DRIVER_RC" 0 "driver accepts stub harness execution"
assert_eq "$(jq -r '.hosts[0].status' "$DRIVER_OUT")" "probed" "driver promotes verified witness to probed"
assert_eq "$(jq -r '.hosts[0].evidence_grade' "$DRIVER_OUT")" "driver_verified_execution_witness" "driver records evidence grade"
assert_eq "$(jq -r '.hosts[0].execution_witness_verified' "$DRIVER_OUT")" "true" "driver records witness verification"

DRIVER_FAKE_OUT="$TEST_TMP/driver-codex-fake.json"
DRIVER_FAKE_ERR="$TEST_TMP/driver-codex-fake.err"
STUB_CODEX_FAKE_WITNESS=1 PATH="$STUB_BIN:$PATH" bash "$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/run-harness-probes.sh" \
  --only codex --mode bypass --timeout 15 --out "$DRIVER_FAKE_OUT" >"$TEST_TMP/driver-codex-fake.stdout" 2>"$DRIVER_FAKE_ERR"
DRIVER_FAKE_RC=$?

assert_exit_code "$DRIVER_FAKE_RC" 0 "driver completes fake witness probe"
assert_eq "$(jq -r '.hosts[0].status' "$DRIVER_FAKE_OUT")" "self_reported" "driver rejects fake witness as self-reported"
assert_eq "$(jq -r '.hosts[0].evidence_grade' "$DRIVER_FAKE_OUT")" "nonce_only_self_report" "driver records fake witness as nonce-only"
assert_contains "$(jq -r '.hosts[0].error_excerpt' "$DRIVER_FAKE_OUT")" "execution witness verification failed" "driver reports fake witness verification failure"

finalize_test
