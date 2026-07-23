#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/execution-witness-controls.js"
DRIVER="$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/run-harness-probes.sh"
OUT="$TEST_TMP/execution-witness-controls.json"
ERR="$TEST_TMP/execution-witness-controls.err"

node "$SCRIPT" --repo "$REPO_ROOT" --tmp "$TEST_TMP/controls" >"$OUT" 2>"$ERR"
RC=$?

assert_exit_code "$RC" 0 "execution witness controls pass"
assert_contains "$(cat "$OUT")" '"signed_payload_verified": true' "signed payload is verified"
assert_contains "$(cat "$OUT")" '"process_identity_metadata_is_not_caller_overridable": true' "caller cannot override witnessed process identity"
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
[ -n "${STUB_CODEX_ARGS_FILE:-}" ] && printf '%s\n' "$@" >"$STUB_CODEX_ARGS_FILE"
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
PATH="$STUB_BIN:$PATH" bash "$DRIVER" \
  --only codex --mode bypass --timeout 15 --out "$DRIVER_OUT" >"$TEST_TMP/driver-codex.stdout" 2>"$DRIVER_ERR"
DRIVER_RC=$?

assert_exit_code "$DRIVER_RC" 0 "driver accepts stub harness execution"
assert_eq "$(jq -r '.hosts[0].status' "$DRIVER_OUT")" "probed" "driver promotes verified witness to probed"
assert_eq "$(jq -r '.hosts[0].evidence_grade' "$DRIVER_OUT")" "driver_verified_execution_witness" "driver records evidence grade"
assert_eq "$(jq -r '.hosts[0].execution_witness_verified' "$DRIVER_OUT")" "true" "driver records witness verification"

DRIVER_FAKE_OUT="$TEST_TMP/driver-codex-fake.json"
DRIVER_FAKE_ERR="$TEST_TMP/driver-codex-fake.err"
STUB_CODEX_FAKE_WITNESS=1 PATH="$STUB_BIN:$PATH" bash "$DRIVER" \
  --only codex --mode bypass --timeout 15 --out "$DRIVER_FAKE_OUT" >"$TEST_TMP/driver-codex-fake.stdout" 2>"$DRIVER_FAKE_ERR"
DRIVER_FAKE_RC=$?

assert_exit_code "$DRIVER_FAKE_RC" 0 "driver completes fake witness probe"
assert_eq "$(jq -r '.hosts[0].status' "$DRIVER_FAKE_OUT")" "self_reported" "driver rejects fake witness as self-reported"
assert_eq "$(jq -r '.hosts[0].evidence_grade' "$DRIVER_FAKE_OUT")" "nonce_only_self_report" "driver records fake witness as nonce-only"
assert_contains "$(jq -r '.hosts[0].error_excerpt' "$DRIVER_FAKE_OUT")" "execution witness verification failed" "driver reports fake witness verification failure"

DRIVER_MODEL_OUT="$TEST_TMP/driver-codex-model.json"
DRIVER_MODEL_ERR="$TEST_TMP/driver-codex-model.err"
STUB_CODEX_ARGS_FILE="$TEST_TMP/codex-args.txt" PATH="$STUB_BIN:$PATH" bash "$DRIVER" \
  --only codex --mode bypass --model gpt-test --effort high --timeout 15 --out "$DRIVER_MODEL_OUT" \
  >"$TEST_TMP/driver-codex-model.stdout" 2>"$DRIVER_MODEL_ERR"
DRIVER_MODEL_RC=$?

assert_exit_code "$DRIVER_MODEL_RC" 0 "driver accepts model-pinned Codex probe"
assert_eq "$(jq -r '.variant.model' "$DRIVER_MODEL_OUT")" "gpt-test" "driver records pinned Codex model"
assert_eq "$(jq -r '.variant.effort' "$DRIVER_MODEL_OUT")" "high" "driver records pinned Codex effort"
assert_contains "$(cat "$TEST_TMP/codex-args.txt")" "--model" "driver passes Codex --model"
assert_contains "$(cat "$TEST_TMP/codex-args.txt")" "gpt-test" "driver passes Codex model value"
assert_contains "$(cat "$TEST_TMP/codex-args.txt")" "model_reasoning_effort=\"high\"" "driver passes Codex reasoning effort config"
assert_contains "$(jq -r '.hosts[0].command' "$DRIVER_MODEL_OUT")" "gpt-test" "driver command records Codex model"
assert_contains "$(jq -r '.hosts[0].command' "$DRIVER_MODEL_OUT")" "model_reasoning_effort=<high>" "driver command records Codex effort"

cat >"$STUB_BIN/grok" <<'STUB'
#!/usr/bin/env bash
[ -n "${STUB_GROK_ARGS_FILE:-}" ] && printf '%s\n' "$@" >"$STUB_GROK_ARGS_FILE"
prompt=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -p|--single)
      prompt="$2"; shift 2 ;;
    *)
      shift ;;
  esac
done
cmd="${prompt#*: }"
set -f
set -- $cmd
if [ "$#" -ne 7 ] || [ "$1" != "node" ] || [ "$3" != "--nonce" ] || [ "$5" != "--repo" ] || [ "$7" != "--json" ]; then
  echo "unexpected witness command shape" >&2
  exit 64
fi
exec "$1" "$2" "$3" "$4" "$5" "$6" "$7"
STUB
chmod +x "$STUB_BIN/grok"

DRIVER_GROK_OUT="$TEST_TMP/driver-grok-model.json"
DRIVER_GROK_ERR="$TEST_TMP/driver-grok-model.err"
STUB_GROK_ARGS_FILE="$TEST_TMP/grok-args.txt" PATH="$STUB_BIN:$PATH" bash "$DRIVER" \
  --only grok --mode bypass --model grok-4.5 --effort high --timeout 15 --out "$DRIVER_GROK_OUT" \
  >"$TEST_TMP/driver-grok-model.stdout" 2>"$DRIVER_GROK_ERR"
DRIVER_GROK_RC=$?

assert_exit_code "$DRIVER_GROK_RC" 0 "driver accepts model-pinned Grok probe"
assert_eq "$(jq -r '.hosts[0].harness' "$DRIVER_GROK_OUT")" "grok" "driver records Grok harness"
assert_eq "$(jq -r '.hosts[0].status' "$DRIVER_GROK_OUT")" "probed" "driver promotes verified Grok witness to probed"
assert_eq "$(jq -r '.variant.model' "$DRIVER_GROK_OUT")" "grok-4.5" "driver records pinned Grok model"
assert_eq "$(jq -r '.variant.effort' "$DRIVER_GROK_OUT")" "high" "driver records pinned Grok effort"
assert_contains "$(cat "$TEST_TMP/grok-args.txt")" "--model" "driver passes Grok --model"
assert_contains "$(cat "$TEST_TMP/grok-args.txt")" "grok-4.5" "driver passes Grok model value"
assert_contains "$(cat "$TEST_TMP/grok-args.txt")" "--reasoning-effort" "driver passes Grok reasoning effort flag"
assert_contains "$(cat "$TEST_TMP/grok-args.txt")" "high" "driver passes Grok effort value"
assert_contains "$(cat "$TEST_TMP/grok-args.txt")" "bypassPermissions" "driver passes Grok bypass permission mode"

cat >"$STUB_BIN/claude" <<'STUB'
#!/usr/bin/env bash
[ -n "${STUB_CLAUDE_ARGS_FILE:-}" ] && printf '%s\n' "$@" >"$STUB_CLAUDE_ARGS_FILE"
prompt="$(cat)"
if [ "${STUB_CLAUDE_NO_NONCE:-0}" = "1" ]; then
  case "$prompt" in
    *"SELF_DISABLE_FAILED"*)
      printf 'SELF_DISABLE_FAILED stub refusal\n'
      exit 0 ;;
    *)
      printf 'command needs approval\n'
      exit 0 ;;
  esac
fi
cmd="${prompt#*: }"
set -f
set -- $cmd
if [ "$#" -ne 7 ] || [ "$1" != "node" ] || [ "$3" != "--nonce" ] || [ "$5" != "--repo" ] || [ "$7" != "--json" ]; then
  echo "unexpected witness command shape" >&2
  exit 64
fi
exec "$1" "$2" "$3" "$4" "$5" "$6" "$7"
STUB
chmod +x "$STUB_BIN/claude"

DRIVER_CLAUDE_OUT="$TEST_TMP/driver-claude-model.json"
DRIVER_CLAUDE_ERR="$TEST_TMP/driver-claude-model.err"
STUB_CLAUDE_ARGS_FILE="$TEST_TMP/claude-args.txt" PATH="$STUB_BIN:$PATH" bash "$DRIVER" \
  --only claude-code --mode bypass --model opus --effort high --timeout 15 --out "$DRIVER_CLAUDE_OUT" \
  >"$TEST_TMP/driver-claude-model.stdout" 2>"$DRIVER_CLAUDE_ERR"
DRIVER_CLAUDE_RC=$?

assert_exit_code "$DRIVER_CLAUDE_RC" 0 "driver accepts model-pinned Claude Code probe"
assert_eq "$(jq -r '.hosts[0].harness' "$DRIVER_CLAUDE_OUT")" "claude-code" "driver records Claude Code harness"
assert_eq "$(jq -r '.hosts[0].status' "$DRIVER_CLAUDE_OUT")" "probed" "driver promotes verified Claude Code witness to probed"
assert_eq "$(jq -r '.variant.model' "$DRIVER_CLAUDE_OUT")" "opus" "driver records pinned Claude model"
assert_eq "$(jq -r '.variant.effort' "$DRIVER_CLAUDE_OUT")" "high" "driver records pinned Claude effort"
assert_contains "$(cat "$TEST_TMP/claude-args.txt")" "--model" "driver passes Claude --model"
assert_contains "$(cat "$TEST_TMP/claude-args.txt")" "opus" "driver passes Claude model value"
assert_contains "$(cat "$TEST_TMP/claude-args.txt")" "--effort" "driver passes Claude effort flag"
assert_contains "$(cat "$TEST_TMP/claude-args.txt")" "high" "driver passes Claude effort value"
assert_contains "$(cat "$TEST_TMP/claude-args.txt")" "bypassPermissions" "driver passes Claude bypass permission mode"

DRIVER_CLAUDE_DEFAULT_OUT="$TEST_TMP/driver-claude-default-model.json"
DRIVER_CLAUDE_DEFAULT_ERR="$TEST_TMP/driver-claude-default-model.err"
STUB_CLAUDE_ARGS_FILE="$TEST_TMP/claude-default-args.txt" PATH="$STUB_BIN:$PATH" bash "$DRIVER" \
  --only claude-code --mode default --model opus --effort high --timeout 15 --out "$DRIVER_CLAUDE_DEFAULT_OUT" \
  >"$TEST_TMP/driver-claude-default-model.stdout" 2>"$DRIVER_CLAUDE_DEFAULT_ERR"
DRIVER_CLAUDE_DEFAULT_RC=$?

assert_exit_code "$DRIVER_CLAUDE_DEFAULT_RC" 0 "driver accepts default-mode model-pinned Claude Code probe"
assert_eq "$(jq -r '.hosts[0].harness' "$DRIVER_CLAUDE_DEFAULT_OUT")" "claude-code" "driver records default-mode Claude Code harness"
assert_eq "$(jq -r '.variant.model' "$DRIVER_CLAUDE_DEFAULT_OUT")" "opus" "driver records default-mode pinned Claude model"
assert_eq "$(jq -r '.variant.effort' "$DRIVER_CLAUDE_DEFAULT_OUT")" "high" "driver records default-mode pinned Claude effort"
assert_contains "$(cat "$TEST_TMP/claude-default-args.txt")" "--model" "driver passes default-mode Claude --model"
assert_contains "$(cat "$TEST_TMP/claude-default-args.txt")" "opus" "driver passes default-mode Claude model value"
assert_contains "$(cat "$TEST_TMP/claude-default-args.txt")" "--effort" "driver passes default-mode Claude effort flag"
assert_contains "$(cat "$TEST_TMP/claude-default-args.txt")" "high" "driver passes default-mode Claude effort value"
assert_not_contains "$(cat "$TEST_TMP/claude-default-args.txt")" "bypassPermissions" "driver omits Claude bypass permission mode in default mode"
assert_contains "$(jq -r '.hosts[0].command' "$DRIVER_CLAUDE_DEFAULT_OUT")" "(default permission mode)" "driver command records Claude default mode"

DRIVER_CLAUDE_SELF_DISABLE_OUT="$TEST_TMP/driver-claude-self-disable.json"
DRIVER_CLAUDE_SELF_DISABLE_ERR="$TEST_TMP/driver-claude-self-disable.err"
STUB_CLAUDE_NO_NONCE=1 STUB_CLAUDE_ARGS_FILE="$TEST_TMP/claude-self-disable-args.txt" PATH="$STUB_BIN:$PATH" bash "$DRIVER" \
  --only claude-code --mode default --model opus --effort high --timeout 15 --out "$DRIVER_CLAUDE_SELF_DISABLE_OUT" \
  >"$TEST_TMP/driver-claude-self-disable.stdout" 2>"$DRIVER_CLAUDE_SELF_DISABLE_ERR"
DRIVER_CLAUDE_SELF_DISABLE_RC=$?

assert_exit_code "$DRIVER_CLAUDE_SELF_DISABLE_RC" 0 "driver records Claude Code self-disable attempt"
assert_eq "$(jq -r '.hosts[0].status' "$DRIVER_CLAUDE_SELF_DISABLE_OUT")" "no_nonce" "driver keeps Claude permission prompt as no_nonce"
assert_eq "$(jq -r '.hosts[0].default_self_disable_attempt.attempted' "$DRIVER_CLAUDE_SELF_DISABLE_OUT")" "true" "driver attempts Claude self-disable capture"
assert_eq "$(jq -r '.hosts[0].default_self_disable_attempt.settings_file' "$DRIVER_CLAUDE_SELF_DISABLE_OUT")" "claude-code/settings.local.json" "driver records Claude settings file class"
assert_eq "$(jq -r '.hosts[0].default_self_disable_attempt.expected_rule_sha256 | test("^[a-f0-9]{64}$")' "$DRIVER_CLAUDE_SELF_DISABLE_OUT")" "true" "driver records Claude expected allow-rule hash"
assert_eq "$(jq -r '.hosts[0].default_self_disable_attempt.settings_changed' "$DRIVER_CLAUDE_SELF_DISABLE_OUT")" "false" "driver records unchanged Claude settings"
assert_eq "$(jq -r '.hosts[0].default_self_disable_attempt.expected_rule_present_after_run' "$DRIVER_CLAUDE_SELF_DISABLE_OUT")" "false" "driver records absent Claude self-allow rule"
assert_eq "$(jq -r '.hosts[0].default_self_disable_attempt.settings_restored' "$DRIVER_CLAUDE_SELF_DISABLE_OUT")" "true" "driver restores Claude settings"
assert_eq "$(jq -r '.hosts[0].default_self_disable_attempt.target_execve_observed' "$DRIVER_CLAUDE_SELF_DISABLE_OUT")" "false" "driver records no Claude target exec"
assert_eq "$(jq -r '.hosts[0].default_self_disable_attempt.target_payload_present' "$DRIVER_CLAUDE_SELF_DISABLE_OUT")" "false" "driver records no Claude target payload"
assert_eq "$(jq -r '.hosts[0].default_self_disable_attempt.output_class' "$DRIVER_CLAUDE_SELF_DISABLE_OUT")" "self_disable_failed" "driver records Claude self-disable failure class"
assert_not_contains "$(cat "$TEST_TMP/claude-self-disable-args.txt")" "bypassPermissions" "self-disable capture does not use Claude bypass permission mode"
assert_not_contains "$(cat "$TEST_TMP/claude-self-disable-args.txt")" "dangerously-skip-permissions" "self-disable capture does not skip Claude permissions"

finalize_test
