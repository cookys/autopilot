#!/usr/bin/env bash
# Explicit privileged P3.6 A0 lifecycle evidence.  It is a .test.sh so the
# default suite records its opt-in skip; it does not require sudo unless the
# operator deliberately sets AUTOPILOT_P36_LIVE=1.

. "$(dirname "$0")/lib.sh"

TEST_NAME="supervised-production-substrate-live"
RUNTIME_PARENT="/run/autopilot-production-durable"
SERVICE_IDENTITIES=(
  autopilot-p36d-worker
  autopilot-p36d-broker
  autopilot-p36d-receipt-verifier
  autopilot-p36d-witness
  autopilot-p36d-coordinator
)

if [ "${AUTOPILOT_P36_LIVE:-0}" != "1" ]; then
  echo "SKIP [$TEST_NAME] set AUTOPILOT_P36_LIVE=1 to run the privileged disposable Linux gate"
  finalize_test
  exit 0
fi

preflight_failed=0
node_source="$(readlink -f "$(command -v node 2>/dev/null || true)" 2>/dev/null || true)"
if ! sudo -n true 2>/dev/null; then
  fail "$TEST_NAME requires passwordless sudo when AUTOPILOT_P36_LIVE=1"
  preflight_failed=1
fi
if [ ! -x /usr/bin/systemd-run ] || [ ! -x /usr/bin/systemctl ] || [ ! -x "$node_source" ]; then
  fail "$TEST_NAME requires systemd-run, systemctl, and a local Node executable"
  preflight_failed=1
fi
if ! /usr/bin/systemctl is-system-running >/dev/null 2>&1; then
  fail "$TEST_NAME requires a running systemd manager"
  preflight_failed=1
fi
if sudo -n test -e "$RUNTIME_PARENT"; then
  fail "$TEST_NAME refuses a pre-existing durable runtime parent"
  preflight_failed=1
fi
if sudo -n /usr/bin/systemctl list-units --all --no-legend 'autopilot-p36d-*' | /usr/bin/grep -q 'autopilot-p36d-'; then
  fail "$TEST_NAME refuses pre-existing durable service units"
  preflight_failed=1
fi
if [ "$preflight_failed" -ne 0 ]; then
  finalize_test
  exit 1
fi

live_parent="/run/autopilot-p36-live-$$-$RANDOM"
install_root="$live_parent/install"
state_root="$live_parent/state"
handoff_root="$live_parent/p35-handoff"
node_root="$live_parent/nodejs"
node_path="$node_source"
out="$TEST_TMP/p36-live.out"
err="$TEST_TMP/p36-live.err"
replay_out="$TEST_TMP/p36-live-replay.out"
replay_err="$TEST_TMP/p36-live-replay.err"
created_runtime_parent=0
created_identities=()

for identity in "${SERVICE_IDENTITIES[@]}"; do
  if ! getent passwd "$identity" >/dev/null; then
    created_identities+=("$identity")
  fi
done

cleanup_live() {
  local status="$?"
  local unit
  local identity
  set +e

  # The test refused pre-existing units, so a matching unit at this point is
  # attributable to this fixture and must not survive a failed assertion.
  while read -r unit _; do
    if [ -n "${unit:-}" ]; then
      sudo -n /usr/bin/systemctl stop "$unit" >/dev/null 2>&1
      sudo -n /usr/bin/systemctl reset-failed "$unit" >/dev/null 2>&1
    fi
  done < <(sudo -n /usr/bin/systemctl list-units --all --no-legend 'autopilot-p36d-*' 2>/dev/null)

  if sudo -n test -e "$RUNTIME_PARENT"; then
    if ! sudo -n rmdir "$RUNTIME_PARENT"; then
      printf 'FAIL [%s] durable runtime parent was not empty at cleanup\n' "$TEST_NAME" >&2
      status=1
    fi
  fi

  sudo -n /usr/bin/python3 -I - "$live_parent" <<'PY' 2>/dev/null || status=1
import os
import stat
import sys

root = sys.argv[1]
if not root.startswith('/run/autopilot-p36-live-'):
    raise SystemExit('unexpected disposable live root')

def remove(path):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return
    if stat.S_ISLNK(info.st_mode):
        os.unlink(path)
        return
    if stat.S_ISDIR(info.st_mode):
        for entry in os.scandir(path):
            remove(entry.path)
        os.rmdir(path)
        return
    if stat.S_ISREG(info.st_mode) or stat.S_ISSOCK(info.st_mode):
        os.unlink(path)
        return
    raise SystemExit('unexpected fixture entry type')

remove(root)
PY

  for identity in "${created_identities[@]}"; do
    if ! sudo -n /usr/sbin/userdel "$identity" >/dev/null 2>&1; then
      printf 'FAIL [%s] disposable identity %s could not be removed\n' "$TEST_NAME" "$identity" >&2
      status=1
      continue
    fi
    if getent group "$identity" >/dev/null && ! sudo -n /usr/sbin/groupdel "$identity" >/dev/null 2>&1; then
      printf 'FAIL [%s] disposable private group %s could not be removed\n' "$TEST_NAME" "$identity" >&2
      status=1
    fi
  done

  cleanup_test_tmp
  trap - EXIT
  exit "$status"
}

trap cleanup_live EXIT
trap 'exit 130' INT TERM

sudo -n mkdir "$live_parent"
sudo -n chown root:root "$live_parent"
sudo -n chmod 755 "$live_parent"
sudo -n mkdir "$handoff_root"
sudo -n chown root:root "$handoff_root"
sudo -n chmod 700 "$handoff_root"
# The host correctly refuses user-owned binaries.  A packaged /usr/bin/node is
# already root-owned and can be pinned directly.  Otherwise copy only a Node
# version directory, never an ancestor such as /usr, into the disposable root.
if [ "$node_source" != "/usr/bin/node" ]; then
  node_distribution="$(dirname "$(dirname "$node_source")")"
  case "$node_distribution" in
    /|/usr|/usr/local|/opt) fail "$TEST_NAME refuses to copy a broad Node ancestor: $node_distribution"; finalize_test; exit 1 ;;
  esac
  case "$(basename "$node_distribution")" in
    node-*) ;;
    *) fail "$TEST_NAME requires a versioned Node distribution outside /usr/bin"; finalize_test; exit 1 ;;
  esac
  sudo -n cp -a "$node_distribution" "$node_root"
  sudo -n chown -R root:root "$node_root"
  sudo -n chmod -R go-w "$node_root"
  node_path="$node_root/bin/node"
fi

sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$REPO_ROOT/src/engine/supervised-production-substrate-durable-host.py" install \
  --install-root "$install_root" \
  --state-root "$state_root" \
  --p35-handoff-root "$handoff_root" \
  --node-path "$node_path" \
  --create-identities >"$TEST_TMP/p36-live-install.out" 2>"$TEST_TMP/p36-live-install.err"
install_status=$?
if [ "$install_status" != "0" ]; then
  fail "root installer snapshots the durable host and fixed role identities: expected '0', got '$install_status'"
  cat "$TEST_TMP/p36-live-install.err" >&2
  finalize_test
  exit 1
fi
assert_eq "$install_status" "0" "root installer snapshots the durable host and fixed role identities"

publish_fixture_handoff() {
  local session_id="$1"
  sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I - "$install_root/lib/supervised_p35_durable_handoff.py" "$handoff_root" "$session_id" <<'PY'
import importlib.util
import sys

module_path, root, session_id = sys.argv[1:]
spec = importlib.util.spec_from_file_location('p36_live_handoff', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
record = module.create_verified_handoff(
    p35_install_binding_hash='a' * 64,
    session_id=session_id,
    session_challenge_hash='b' * 64,
    ticket_hash='c' * 64,
    descriptor_binding_hash='d' * 64,
    workspace_root_hash='e' * 64,
    immutable_base='f' * 40,
    authority={'issuer': 'owner-control', 'key_id': 'p36-live-key', 'attestation_hash': '1' * 64},
    gateway_receipt_hash='2' * 64,
    bridge_plan_hash='3' * 64,
    bridge_receipt_hash='4' * 64,
    authenticated_receipt_hash='5' * 64,
)
module.publish_verified_handoff(root, record)
print(record['handoff_id'])
PY
}

handoff_id="$(publish_fixture_handoff p36-live-session)"
if [[ "$handoff_id" =~ ^p36-[A-Fa-f0-9]+$ ]]; then
  handoff_id_is_opaque=true
else
  handoff_id_is_opaque=false
fi
assert_eq "$handoff_id_is_opaque" "true" "fixture publishes a root-only opaque P3.5d handoff"

sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$install_root/sbin/supervised-production-substrate-durable-host.py" run \
  --handoff-id "$handoff_id" >"$out" 2>"$err"
run_status=$?
if [ "$run_status" != "0" ]; then
  fail "installed durable host verifies a no-effect five-role cohort: expected '0', got '$run_status'"
  cat "$err" >&2
  finalize_test
  exit 1
fi
assert_eq "$run_status" "0" "installed durable host verifies a no-effect five-role cohort"
assert_contains "$(cat "$out")" '"status":"p36_durable_cohort_verified"' "live output reports a verified rather than retained cohort"
assert_contains "$(cat "$out")" '"lifecycle":"teardown_verified"' "live output records teardown before disclosure"
assert_contains "$(cat "$out")" '"effect_authority":"none"' "live cohort preserves no effect authority"
assert_contains "$(cat "$out")" '"acceptance":"not_available"' "live cohort preserves no acceptance authority"
assert_contains "$(cat "$out")" '"fixed_probe_evidence_hash":"' "live cohort emits a root-retained fixed probe evidence hash"
assert_contains "$(cat "$out")" '"receipt_anchor_audit_hash":"' "live cohort emits a cross-leaf receipt anchor audit hash"
assert_contains "$(cat "$out")" '"receipt_anchor_audit_evidence_hash":"' "live cohort retains a receipt anchor audit evidence hash"

cohort_id="$(/usr/bin/python3 -I - "$out" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as source:
    value = json.load(source)
print(value['cohort_id'])
PY
)"
if [[ "$cohort_id" =~ ^p36d-[0-9]+-[a-f0-9]+$ ]]; then
  cohort_id_is_opaque=true
else
  cohort_id_is_opaque=false
fi
assert_eq "$cohort_id_is_opaque" "true" "live host allocates a fresh opaque cohort id"
assert_eq "$(sudo -n stat -c '%u:%g:%a' "$state_root/generation.json")" "0:0:600" "generation ledger remains root-private"
assert_eq "$(sudo -n stat -c '%u:%g:%a' "$handoff_root/handoff-$handoff_id.claim")" "0:0:600" "handoff claim remains root-private and durable"
assert_eq "$(sudo -n stat -c '%u:%g:%a' "$state_root/probe-evidence/$cohort_id.json")" "0:0:600" "fixed refusal evidence remains root-private after teardown"
assert_eq "$(sudo -n stat -c '%u:%g:%a' "$state_root/receipt-audits/$cohort_id.json")" "0:0:600" "receipt anchor audit evidence remains root-private after teardown"
assert_eq "$(sudo -n stat -c '%u:%g:%a' "$state_root/cohorts/$cohort_id/binding.json")" "0:0:600" "cohort binding remains root-private for later read-only audit"
assert_eq "$(sudo -n /usr/bin/python3 -I - "$state_root/attempts/$cohort_id.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as source:
    print(json.load(source)['state'])
PY
)" "teardown_verified" "normal cohort records verified teardown in its durable launch attempt"
if sudo -n test -e "$state_root/cohorts/$cohort_id/witness/leaf/journal.jsonl"; then witness_journal_exists=true; else witness_journal_exists=false; fi
if sudo -n test -e "$state_root/cohorts/$cohort_id/receipt_verifier/leaf/journal.jsonl"; then receipt_anchor_journal_exists=true; else receipt_anchor_journal_exists=false; fi
if sudo -n test -e "$state_root/cohorts/$cohort_id/coordinator/leaf/journal.jsonl"; then coordinator_journal_exists=true; else coordinator_journal_exists=false; fi
if sudo -n test -e "$RUNTIME_PARENT/$cohort_id"; then cohort_runtime_absent=false; else cohort_runtime_absent=true; fi
assert_eq "$witness_journal_exists" "true" "root retains durable witness evidence after transient teardown"
assert_eq "$receipt_anchor_journal_exists" "true" "root retains independently owned receipt anchor evidence after transient teardown"
assert_eq "$coordinator_journal_exists" "true" "root retains durable coordinator evidence after transient teardown"
assert_eq "$cohort_runtime_absent" "true" "cohort runtime tree is removed after verified teardown"
witness_journal_lines="$(sudo -n /usr/bin/wc -l "$state_root/cohorts/$cohort_id/witness/leaf/journal.jsonl" | /usr/bin/awk '{print $1}')"
receipt_anchor_journal_lines="$(sudo -n /usr/bin/wc -l "$state_root/cohorts/$cohort_id/receipt_verifier/leaf/journal.jsonl" | /usr/bin/awk '{print $1}')"
coordinator_journal_lines="$(sudo -n /usr/bin/wc -l "$state_root/cohorts/$cohort_id/coordinator/leaf/journal.jsonl" | /usr/bin/awk '{print $1}')"
assert_eq "$witness_journal_lines" "5" "sealed append, batch, get-head, and readback probes leave four witness records"
assert_eq "$receipt_anchor_journal_lines" "3" "receipt verifier commits both fixed witness responses into its own journal"
assert_eq "$coordinator_journal_lines" "3" "sealed prepare-cancel probes leave exactly two coordinator records"
assert_not_contains "$(sudo -n cat "$state_root/cohorts/$cohort_id/coordinator/leaf/journal.jsonl")" '"status":"unknown"' "live coordinator self-probe cannot leave pending or unknown state"
assert_not_contains "$(sudo -n cat "$state_root/cohorts/$cohort_id/witness/leaf/journal.jsonl")" '"ticket"' "durable witness evidence does not contain a P3.5 ticket body"
assert_contains "$(sudo -n cat "$state_root/cohorts/$cohort_id/witness/leaf/journal.jsonl")" '"operation":"appendBatchIfHead"' "live witness exercises the atomic batch route"
assert_contains "$(sudo -n cat "$state_root/cohorts/$cohort_id/witness/leaf/journal.jsonl")" '"operation":"readback"' "live witness exercises the bounded readback route"
assert_contains "$(sudo -n cat "$state_root/cohorts/$cohort_id/receipt_verifier/leaf/journal.jsonl")" '"endpoint_id":"receipt_verifier_witness"' "receipt anchor is limited to the fixed witness route"
assert_not_contains "$(sudo -n cat "$state_root/cohorts/$cohort_id/receipt_verifier/leaf/journal.jsonl")" '"ticket"' "receipt anchor retains no P3.5 ticket body"
probe_evidence="$(sudo -n cat "$state_root/probe-evidence/$cohort_id.json")"
assert_contains "$probe_evidence" '"code":"BROKER_EFFECTS_DISABLED"' "root retains hash-only evidence of the execute refusal"
assert_contains "$probe_evidence" '"code":"REVOCATION_UNAVAILABLE"' "root retains hash-only evidence of the revocation refusal"
assert_not_contains "$probe_evidence" '"permit"' "fixed refusal evidence exposes no capability material"
assert_not_contains "$probe_evidence" '"ticket"' "fixed refusal evidence exposes no P3.5 ticket body"

audit_out="$TEST_TMP/p36-live-audit.out"
audit_err="$TEST_TMP/p36-live-audit.err"
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$install_root/sbin/supervised-production-substrate-durable-host.py" audit \
  --cohort-id "$cohort_id" >"$audit_out" 2>"$audit_err"
audit_status=$?
if [ "$audit_status" != "0" ]; then
  fail "root re-audits the retained receipt and witness journals: expected '0', got '$audit_status'"
  cat "$audit_err" >&2
  finalize_test
  exit 1
fi
assert_eq "$audit_status" "0" "root re-audits the retained receipt and witness journals"
assert_contains "$(cat "$audit_out")" '"kind":"p36_durable_receipt_anchor_audit_result"' "read-only post-teardown audit emits its dedicated result kind"
assert_contains "$(cat "$audit_out")" '"status":"verified"' "read-only post-teardown audit verifies the independent receipt chain"

sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$install_root/sbin/supervised-production-substrate-durable-host.py" run \
  --handoff-id "$handoff_id" >"$replay_out" 2>"$replay_err"
replay_status=$?
assert_neq "$replay_status" "0" "one-shot P3.5d handoff cannot launch a second durable cohort"
assert_contains "$(cat "$replay_err")" "handoff claim already exists" "replayed handoff is explicitly fail-closed"
if sudo -n test -e "$RUNTIME_PARENT/$cohort_id"; then replay_runtime_absent=false; else replay_runtime_absent=true; fi
assert_eq "$replay_runtime_absent" "true" "replay rejection cannot recreate the original runtime tree"

# TERM is the recoverable interruption path: once the one-shot claim exists,
# the current host itself must write terminal evidence and remove every live
# resource.  This is intentionally separate from SIGKILL, which can only be
# repaired by a later admission.
term_handoff_id="$(publish_fixture_handoff p36-live-term-session)"
term_out="$TEST_TMP/p36-live-term.out"
term_err="$TEST_TMP/p36-live-term.err"
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$install_root/sbin/supervised-production-substrate-durable-host.py" run \
  --handoff-id "$term_handoff_id" >"$term_out" 2>"$term_err" &
term_runner_pid="$!"
term_attempt=""
for attempt in $(seq 1 120); do
  term_attempt="$(sudo -n /usr/bin/python3 -I - "$state_root/attempts" "$term_handoff_id" <<'PY'
import json
import os
import sys
root, handoff_id = sys.argv[1:]
for name in sorted(os.listdir(root)):
    if not name.endswith('.json'):
        continue
    with open(os.path.join(root, name), encoding='utf-8') as source:
        value = json.load(source)
    if value['handoff_id'] == handoff_id:
        print(value['cohort_id'] + ':' + str(value['host_pid']))
        break
PY
)"
  if [ -n "$term_attempt" ] \
    && sudo -n test -e "$handoff_root/handoff-$term_handoff_id.claim" \
    && sudo -n test -d "$RUNTIME_PARENT/${term_attempt%%:*}"; then
    break
  fi
  sleep 0.05
done
if [ -z "$term_attempt" ]; then
  fail "$TEST_NAME did not reach a claimed durable runtime before TERM injection"
  finalize_test
  exit 1
fi
term_cohort_id="${term_attempt%%:*}"
term_host_pid="${term_attempt##*:}"
if ! sudo -n /bin/kill -TERM "$term_host_pid"; then
  fail "$TEST_NAME could not inject TERM into the claimed durable host"
  finalize_test
  exit 1
fi
wait "$term_runner_pid" >/dev/null 2>&1
term_status=$?
assert_neq "$term_status" "0" "TERM-interrupted durable cohort must not report a verified result"
assert_eq "$(sudo -n /usr/bin/python3 -I - "$state_root/attempts/$term_cohort_id.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as source:
    print(json.load(source)['state'])
PY
)" "abandoned" "TERM interruption records a durable abandoned attempt before exit"
assert_eq "$(sudo -n test -e "$state_root/abandoned/$term_cohort_id.json"; printf '%s' "$?")" "0" "TERM interruption writes a root-only abandoned tombstone"
for attempt in $(seq 1 40); do
  if ! sudo -n /usr/bin/systemctl list-units --all --no-legend 'autopilot-p36d-*' | /usr/bin/grep -q 'autopilot-p36d-'; then
    break
  fi
  sleep 0.1
done
if sudo -n /usr/bin/systemctl list-units --all --no-legend 'autopilot-p36d-*' | /usr/bin/grep -q 'autopilot-p36d-'; then
  fail "$TEST_NAME left a transient unit after TERM interruption"
fi
if sudo -n test -e "$RUNTIME_PARENT/$term_cohort_id"; then term_runtime_absent=false; else term_runtime_absent=true; fi
assert_eq "$term_runtime_absent" "true" "TERM interruption removes the current cohort runtime tree"

# Kill a root host only after its one-shot handoff claim and pre-claim intent
# are durable.  A new handoff must first reap that abandoned attempt before it
# can run its own cohort; this covers the SIGKILL/power-loss claim gap.
crash_handoff_id="$(publish_fixture_handoff p36-live-crash-session)"
crash_out="$TEST_TMP/p36-live-crash.out"
crash_err="$TEST_TMP/p36-live-crash.err"
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$install_root/sbin/supervised-production-substrate-durable-host.py" run \
  --handoff-id "$crash_handoff_id" >"$crash_out" 2>"$crash_err" &
crash_runner_pid="$!"
crash_attempt=""
for attempt in $(seq 1 120); do
  crash_attempt="$(sudo -n /usr/bin/python3 -I - "$state_root/attempts" "$crash_handoff_id" <<'PY'
import json
import os
import sys
root, handoff_id = sys.argv[1:]
for name in sorted(os.listdir(root)):
    if not name.endswith('.json'):
        continue
    with open(os.path.join(root, name), encoding='utf-8') as source:
        value = json.load(source)
    if value['handoff_id'] == handoff_id:
        print(value['cohort_id'] + ':' + str(value['host_pid']))
        break
PY
)"
  if [ -n "$crash_attempt" ] && sudo -n test -e "$handoff_root/handoff-$crash_handoff_id.claim"; then
    break
  fi
  sleep 0.05
done
if [ -z "$crash_attempt" ]; then
  fail "$TEST_NAME did not persist a pre-claim launch intent before the crash injection"
  finalize_test
  exit 1
fi
crash_cohort_id="${crash_attempt%%:*}"
crash_host_pid="${crash_attempt##*:}"
sudo -n /bin/kill -KILL "$crash_host_pid"
wait "$crash_runner_pid" >/dev/null 2>&1 || true
assert_eq "$(sudo -n test -e "$handoff_root/handoff-$crash_handoff_id.claim"; printf '%s' "$?")" "0" "crash fixture reaches the terminal root handoff claim"

recovery_handoff_id="$(publish_fixture_handoff p36-live-recovery-session)"
recovery_out="$TEST_TMP/p36-live-recovery.out"
recovery_err="$TEST_TMP/p36-live-recovery.err"
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$install_root/sbin/supervised-production-substrate-durable-host.py" run \
  --handoff-id "$recovery_handoff_id" >"$recovery_out" 2>"$recovery_err"
recovery_status=$?
if [ "$recovery_status" != "0" ]; then
  fail "new durable cohort recovers a SIGKILL-abandoned claim before launch: expected '0', got '$recovery_status'"
  cat "$recovery_err" >&2
  finalize_test
  exit 1
fi
assert_eq "$recovery_status" "0" "new durable cohort recovers a SIGKILL-abandoned claim before launch"
assert_eq "$(sudo -n /usr/bin/python3 -I - "$state_root/attempts/$crash_cohort_id.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as source:
    print(json.load(source)['state'])
PY
)" "recovered_abandoned" "recovery marks the killed host attempt as durably abandoned"
assert_eq "$(sudo -n test -e "$state_root/abandoned/$crash_cohort_id.json"; printf '%s' "$?")" "0" "recovery retains an abandoned tombstone for the terminal claim"
if sudo -n test -e "$RUNTIME_PARENT/$crash_cohort_id"; then crash_runtime_absent=false; else crash_runtime_absent=true; fi
assert_eq "$crash_runtime_absent" "true" "recovery removes the killed cohort runtime tree"

for attempt in $(seq 1 40); do
  if ! sudo -n /usr/bin/systemctl list-units --all --no-legend 'autopilot-p36d-*' | /usr/bin/grep -q 'autopilot-p36d-'; then
    break
  fi
  sleep 0.1
done
if sudo -n /usr/bin/systemctl list-units --all --no-legend 'autopilot-p36d-*' | /usr/bin/grep -q 'autopilot-p36d-'; then
  fail "$TEST_NAME left a transient unit after normal and replay paths"
fi

echo "live_root_snapshot_and_five_role_lifecycle=true"
echo "live_one_shot_handoff_and_teardown=true"
echo "live_sigterm_terminal_teardown=true"
echo "live_sigkill_claim_recovery=true"
echo "live_receipt_anchor_audit=true"
finalize_test
