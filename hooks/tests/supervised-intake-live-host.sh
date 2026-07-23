#!/usr/bin/env bash
# Explicit privileged P3.5a evidence gate. It is intentionally not named
# *.test.sh: normal CI must not require sudo, systemd, or a persistent service
# account. The keypair is generated under TEST_TMP and never leaves this test.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [ "${AUTOPILOT_P35_LIVE:-0}" != "1" ]; then
  printf 'SKIP [supervised-intake-live-host] AUTOPILOT_P35_LIVE=1 is required\n'
  exit 0
fi

if ! sudo -n true 2>/dev/null; then
  printf 'FAIL [supervised-intake-live-host] AUTOPILOT_P35_LIVE=1 requires passwordless sudo\n' >&2
  exit 1
fi

created_test_tmp=0
if [ -z "${TEST_TMP+x}" ]; then
  TEST_TMP="$(mktemp -d)"
  created_test_tmp=1
fi

live_parent="/run/autopilot-p35-live-$$"
install_root="$live_parent/install"
state_root="$live_parent/state"
workspace_registry_root="$live_parent/workspace-registry"
witness_state_root="$live_parent/shadow-witness-state"
bound_workspace_root="$live_parent/bound-workspace"
stage_root="$TEST_TMP/p35-live-stage-$$-$RANDOM"
keyring_path="$stage_root/keyring.json"
private_key_path="$stage_root/private.pem"
request_path="$stage_root/request.json"
race_request_path="$stage_root/race-request.json"
expiry_request_path="$stage_root/expiry-request.json"
begin_out="$stage_root/begin.out"
submit_out="$stage_root/submit.out"
submit_err="$stage_root/submit.err"
replay_out="$stage_root/replay.out"
replay_err="$stage_root/replay.err"
install_out="$stage_root/install.out"
install_err="$stage_root/install.err"
tamper_out="$stage_root/tamper.out"
tamper_err="$stage_root/tamper.err"
p34_tamper_out="$stage_root/p34-tamper.out"
p34_tamper_err="$stage_root/p34-tamper.err"
race_a_out="$stage_root/race-a.out"
race_a_err="$stage_root/race-a.err"
race_b_out="$stage_root/race-b.out"
race_b_err="$stage_root/race-b.err"
expiry_out="$stage_root/expiry.out"
expiry_err="$stage_root/expiry.err"
handoff_probe_out="$stage_root/handoff-probe.out"
private_install_out="$stage_root/private-install.out"
private_install_err="$stage_root/private-install.err"
private_state_install_out="$stage_root/private-state-install.out"
private_state_install_err="$stage_root/private-state-install.err"
registry_out="$stage_root/workspace-registry.out"
registry_err="$stage_root/workspace-registry.err"
registry_duplicate_out="$stage_root/workspace-registry-duplicate.out"
registry_duplicate_err="$stage_root/workspace-registry-duplicate.err"
bound_register_out="$stage_root/bound-register.out"
bound_begin_out="$stage_root/bound-begin.out"
bound_request_path="$stage_root/bound-request.json"
bound_submit_out="$stage_root/bound-submit.out"
bound_submit_err="$stage_root/bound-submit.err"
bound_witness_meta="$stage_root/bound-witness-meta.json"
bound_reuse_out="$stage_root/bound-reuse.out"
bound_reuse_err="$stage_root/bound-reuse.err"
created_runtime_parent=0
workspace_registry_pid=""

mkdir -p "$stage_root"

stop_workspace_registry() {
  local pid="${workspace_registry_pid:-}"
  if [ -z "$pid" ]; then
    return 0
  fi
  if ! sudo -n kill -TERM "$pid" 2>/dev/null; then
    if kill -0 "$pid" 2>/dev/null; then
      printf 'FAIL [supervised-intake-live-host] workspace registry could not be stopped\n' >&2
      return 1
    fi
  fi
  if ! wait "$pid"; then
    printf 'FAIL [supervised-intake-live-host] workspace registry exited unsuccessfully\n' >&2
    return 1
  fi
  workspace_registry_pid=""
  return 0
}

cleanup_live() {
  local status="$?"
  local snapshot_cleanup_status=0
  set +e
  if ! stop_workspace_registry; then
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  sudo -n /usr/bin/python3 - "$live_parent" <<'PY' 2>/dev/null || snapshot_cleanup_status=$?
import os
import stat
import sys

root = sys.argv[1]
if not root.startswith('/run/autopilot-p35-live-'):
    raise SystemExit('unexpected live root')

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
    raise SystemExit('unexpected test-owned entry type')

remove(root)
PY
  if [ "$snapshot_cleanup_status" -ne 0 ]; then
    printf 'FAIL [supervised-intake-live-host] disposable live snapshot cleanup failed\n' >&2
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  if [ "$created_runtime_parent" -eq 1 ]; then
    if ! sudo -n rmdir /run/autopilot-intake 2>/dev/null; then
      printf 'FAIL [supervised-intake-live-host] test-created runtime parent was not empty\n' >&2
      if [ "$status" -eq 0 ]; then
        status=1
      fi
    fi
  fi
  if [ -n "${stage_root:-}" ] && [ -d "$stage_root" ]; then
    rm -rf -- "$stage_root"
    if [ -e "$stage_root" ] && [ "$status" -eq 0 ]; then
      printf 'FAIL [supervised-intake-live-host] private test artifacts were not removed\n' >&2
      status=1
    fi
  fi
  if [ "$created_test_tmp" -eq 1 ] && [ -d "$TEST_TMP" ]; then
    if ! rmdir "$TEST_TMP" 2>/dev/null && [ "$status" -eq 0 ]; then
      printf 'FAIL [supervised-intake-live-host] generated temporary parent was not removed\n' >&2
      status=1
    fi
  fi
  trap - EXIT
  exit "$status"
}

trap cleanup_live EXIT
trap 'exit 130' INT TERM

if [ -e "$live_parent" ]; then
  printf 'FAIL [supervised-intake-live-host] unique live root already exists\n' >&2
  exit 1
fi
if [ ! -e /run/autopilot-intake ]; then
  created_runtime_parent=1
fi

node - "$REPO_ROOT" "$keyring_path" "$private_key_path" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [root, keyringPath, privatePath] = process.argv.slice(2);
const { canonicalJson } = require(path.join(root, 'src', 'engine', 'owner-kernel', 'canonical'));
const pair = crypto.generateKeyPairSync('ed25519');
const now = Date.now();
const keyring = {
  schema_version: 1,
  issuer: 'owner-control',
  keyring_id: 'owner-keyring-e1',
  keyring_epoch: 1,
  keys: [{
    algorithm: 'ed25519',
    key_id: 'owner-ed25519-live',
    not_before_ms: now - 1000,
    not_after_ms: now + 240000,
    public_key_spki_base64: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
  }],
};
fs.writeFileSync(keyringPath, canonicalJson(keyring), { mode: 0o600 });
fs.writeFileSync(privatePath, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
NODE

sudo -n /usr/bin/python3 -I "$REPO_ROOT/src/engine/supervised-intake-host.py" install \
  --install-root "$install_root" \
  --state-root "$state_root" \
  --workspace-registry-root "$workspace_registry_root" \
  --witness-state-root "$witness_state_root" \
  --keyring "$keyring_path" \
  --node-path "$(readlink -f "$(command -v node)")" \
  --create-worker \
  --create-verifier \
  --create-shadow-witness >"$install_out" 2>"$install_err"
if sudo -n find "$REPO_ROOT/src/engine" -maxdepth 2 -type f -path '*/__pycache__/*' | grep -q .; then
  printf 'FAIL [supervised-intake-live-host] root install left bytecode in the source checkout\n' >&2
  exit 1
fi

node - "$install_out" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.worker?.identity !== 'autopilot-intake-worker') process.exit(1);
NODE

sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" workspace-registry-serve >"$registry_out" 2>"$registry_err" &
workspace_registry_pid=$!
registry_ready=0
for _ in $(seq 1 50); do
  if grep -q '"status":"workspace_registry_ready"' "$registry_out"; then
    registry_ready=1
    break
  fi
  if ! kill -0 "$workspace_registry_pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
if [ "$registry_ready" -ne 1 ]; then
  printf 'FAIL [supervised-intake-live-host] workspace registry did not become ready\n' >&2
  sed -n '1,80p' "$registry_err" >&2 || true
  exit 1
fi
node - "$registry_out" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.status !== 'workspace_registry_ready' || !/^[A-Za-z0-9._:-]+$/.test(value.registry_instance_id || '')) process.exit(1);
if (value.owner_kernel_authority !== 'none' || value.acceptance !== 'not_available') process.exit(1);
NODE

if sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" workspace-registry-serve \
  >"$registry_duplicate_out" 2>"$registry_duplicate_err"; then
  printf 'FAIL [supervised-intake-live-host] second workspace registry unexpectedly started\n' >&2
  exit 1
fi
if ! grep -qi 'instance lock is already held' "$registry_duplicate_err"; then
  printf 'FAIL [supervised-intake-live-host] second registry did not fail on the singleton lock\n' >&2
  sed -n '1,80p' "$registry_duplicate_err" >&2 || true
  exit 1
fi
if ! sudo -n test -S "$workspace_registry_root/registry.sock"; then
  printf 'FAIL [supervised-intake-live-host] failed second registry removed the first listener socket\n' >&2
  exit 1
fi

sudo -n /usr/bin/python3 -I - "$install_root/sbin/supervised-intake-host.py" "$live_parent/handoff-probe" >"$handoff_probe_out" <<'PY'
import importlib.util
import os
import pwd
import select
import socket
import stat
import struct
import sys
import time

host_path, probe_root = sys.argv[1:]
spec = importlib.util.spec_from_file_location("p35_live_host", host_path)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
host.P34 = host.load_p34_support()
worker_account = pwd.getpwnam("autopilot-intake-worker")
verifier_account = pwd.getpwnam("autopilot-verifier")
try:
    legacy_worker = pwd.getpwnam("autopilot-worker")
except KeyError:
    legacy_worker = None
if legacy_worker and (
    worker_account.pw_uid == legacy_worker.pw_uid or worker_account.pw_gid == legacy_worker.pw_gid
):
    raise SystemExit("P3.5 worker aliases the legacy P3.4 worker identity")
worker = {"uid": worker_account.pw_uid, "gid": worker_account.pw_gid}
verifier = {"uid": verifier_account.pw_uid, "gid": verifier_account.pw_gid}
os.mkdir(probe_root, 0o710)
os.chown(probe_root, 0, worker["gid"])
os.chmod(probe_root, 0o710)
release_path = os.path.join(probe_root, "release.json")
host.create_release(release_path, "p35-live-release", 1, verifier, worker)
info = os.lstat(release_path)
if (
    not stat.S_ISREG(info.st_mode)
    or info.st_uid != 0
    or info.st_gid != worker["gid"]
    or (info.st_mode & 0o777) != 0o440
):
    raise SystemExit("unexpected worker release marker identity or mode")


def receive_bytes(connection, size):
    blocks = []
    remaining = size
    while remaining:
        block = connection.recv(remaining)
        if not block:
            raise SystemExit("handoff peer ended before the expected bytes")
        blocks.append(block)
        remaining -= len(block)
    return b"".join(blocks)


def cgroup_path(pid):
    with open("/proc/{}/cgroup".format(pid), "r", encoding="utf-8") as source:
        for line in source.read(8192).splitlines():
            if line.startswith("0::"):
                return line[3:]
    raise SystemExit("worker fixture did not expose a unified cgroup-v2 path")


handoff_path = os.path.join(probe_root, "handoff.sock")
go_read, go_write = os.pipe()
payload_read, payload_write = os.pipe()
correct_pid = os.fork()
if correct_pid == 0:
    os.close(go_write)
    os.close(payload_read)
    try:
        expected_server_pid = int(os.read(go_read, 32).decode("ascii"))
        os.setgroups([])
        os.setgid(worker["gid"])
        os.setuid(worker["uid"])
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            connection.settimeout(2)
            connection.connect(handoff_path)
            raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
            peer_pid, peer_uid, peer_gid = struct.unpack("3i", raw)
            if peer_pid != expected_server_pid or peer_uid != 0 or peer_gid != 0:
                os._exit(30)
            size = struct.unpack("!I", receive_bytes(connection, 4))[0]
            os.write(payload_write, receive_bytes(connection, size))
        finally:
            connection.close()
        os._exit(0)
    except BaseException:
        os._exit(31)
os.close(go_read)
os.close(payload_write)
server_read, server_write = os.pipe()
handoff_pid = os.fork()
if handoff_pid == 0:
    os.close(server_read)
    try:
        host.deliver_request_to_exact_worker(
            handoff_path,
            worker,
            correct_pid,
            cgroup_path(correct_pid),
            b"opaque-live-root-request",
        )
        os.write(server_write, b"ok")
        os._exit(0)
    except BaseException as error:
        os.write(server_write, str(error).encode("utf-8", "replace"))
        os._exit(32)
os.close(server_write)
deadline = time.monotonic() + 2
wrong_peer = None
while time.monotonic() < deadline:
    if not os.path.lexists(handoff_path):
        time.sleep(0.01)
        continue
    candidate = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    candidate.settimeout(0.1)
    try:
        candidate.connect(handoff_path)
        wrong_peer = candidate
        break
    except (ConnectionRefusedError, FileNotFoundError):
        candidate.close()
        time.sleep(0.01)
if wrong_peer is None:
    raise SystemExit("root handoff listener did not become connectable")
wrong_peer.settimeout(1)
try:
    wrong_bytes = wrong_peer.recv(1)
except ConnectionResetError:
    wrong_bytes = b""
wrong_peer.close()
if wrong_bytes != b"":
    raise SystemExit("wrong handoff peer received raw request bytes")
os.write(go_write, str(handoff_pid).encode("ascii"))
os.close(go_write)
ready, _, _ = select.select([payload_read], [], [], 2)
if not ready or os.read(payload_read, 128) != b"opaque-live-root-request":
    raise SystemExit("exact worker did not receive the root handoff bytes")
os.close(payload_read)
ready, _, _ = select.select([server_read], [], [], 2)
if not ready or os.read(server_read, 128) != b"ok":
    raise SystemExit("root handoff server did not complete after the exact worker connected")
os.close(server_read)
_, correct_status = os.waitpid(correct_pid, 0)
_, handoff_status = os.waitpid(handoff_pid, 0)
if not os.WIFEXITED(correct_status) or os.WEXITSTATUS(correct_status) != 0:
    raise SystemExit("exact worker handoff fixture failed")
if not os.WIFEXITED(handoff_status) or os.WEXITSTATUS(handoff_status) != 0:
    raise SystemExit("root handoff fixture failed")
if os.path.lexists(handoff_path):
    raise SystemExit("root handoff socket remained after completion")

os.unlink(release_path)
os.rmdir(probe_root)
claim_root = os.path.join(os.path.dirname(probe_root), "claim-probe")
os.mkdir(claim_root, 0o700)
os.chown(claim_root, 0, 0)
os.chmod(claim_root, 0o700)
claim_paths = {"claim": os.path.join(claim_root, "submit-claim.json")}
start_read, start_write = os.pipe()
children = []
for _ in range(2):
    child = os.fork()
    if child == 0:
        os.close(start_write)
        try:
            if os.read(start_read, 1) != b"x":
                os._exit(20)
            try:
                host.create_submit_claim(claim_paths, "p35-live-claim-race", lambda: None)
                os._exit(0)
            except host.HostError as error:
                os._exit(10 if str(error) == "P3.5 session has already been claimed" else 21)
        except BaseException:
            os._exit(22)
    children.append(child)
os.close(start_read)
os.write(start_write, b"xx")
os.close(start_write)
statuses = []
for child in children:
    _, status = os.waitpid(child, 0)
    statuses.append((status >> 8) if os.WIFEXITED(status) else 23)
if sorted(statuses) != [0, 10]:
    raise SystemExit("atomic submit claim race did not produce one winner and one claimed loser")
claim_info = os.lstat(claim_paths["claim"])
if claim_info.st_uid != 0 or claim_info.st_gid != 0 or (claim_info.st_mode & 0o777) != 0o600:
    raise SystemExit("atomic submit claim did not preserve root-private state")
os.unlink(claim_paths["claim"])
os.rmdir(claim_root)
print("p35_exact_peer_handoff_ok")
print("p35_release_marker_mode_ok")
print("p35_atomic_submit_claim_ok")
PY
for evidence in p35_exact_peer_handoff_ok p35_release_marker_mode_ok p35_atomic_submit_claim_ok; do
  if ! grep -qx "$evidence" "$handoff_probe_out"; then
    printf 'FAIL [supervised-intake-live-host] handoff/claim probe did not produce %s\n' "$evidence" >&2
    exit 1
  fi
done

private_parent="$live_parent/private-parent"
private_install_root="$private_parent/install"
sudo -n install -d -o root -g root -m 0700 "$private_parent"
if sudo -n /usr/bin/python3 -I "$REPO_ROOT/src/engine/supervised-intake-host.py" install \
  --install-root "$private_install_root" \
  --state-root "$state_root" \
  --workspace-registry-root "$workspace_registry_root" \
  --witness-state-root "$witness_state_root" \
  --keyring "$keyring_path" \
  --node-path "$(readlink -f "$(command -v node)")" >"$private_install_out" 2>"$private_install_err"; then
  printf 'FAIL [supervised-intake-live-host] install accepted an untraversable service snapshot parent\n' >&2
  exit 1
fi
if ! grep -qi 'not traversable' "$private_install_err"; then
  printf 'FAIL [supervised-intake-live-host] untraversable install rejection was not visible\n' >&2
  exit 1
fi
if sudo -n test -e "$private_install_root"; then
  printf 'FAIL [supervised-intake-live-host] rejected untraversable install left a snapshot\n' >&2
  exit 1
fi

private_state_parent="$live_parent/private-state-parent"
private_state_root="$private_state_parent/state"
private_state_install_root="$live_parent/private-state-install"
sudo -n install -d -o root -g root -m 0700 "$private_state_parent"
if sudo -n /usr/bin/python3 -I "$REPO_ROOT/src/engine/supervised-intake-host.py" install \
  --install-root "$private_state_install_root" \
  --state-root "$private_state_root" \
  --workspace-registry-root "$workspace_registry_root" \
  --witness-state-root "$witness_state_root" \
  --keyring "$keyring_path" \
  --node-path "$(readlink -f "$(command -v node)")" >"$private_state_install_out" 2>"$private_state_install_err"; then
  printf 'FAIL [supervised-intake-live-host] install accepted an untraversable verifier state parent\n' >&2
  exit 1
fi
if ! grep -qi 'not traversable' "$private_state_install_err"; then
  printf 'FAIL [supervised-intake-live-host] untraversable state-root rejection was not visible\n' >&2
  exit 1
fi
if sudo -n test -e "$private_state_install_root"; then
  printf 'FAIL [supervised-intake-live-host] rejected untraversable state-root install left a snapshot\n' >&2
  exit 1
fi

sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" begin >"$begin_out"
session_id="$(node -e "console.log(JSON.parse(process.argv[1]).session_id)" "$(cat "$begin_out")")"
challenge_hash="$(node -e "console.log(JSON.parse(process.argv[1]).session_challenge_hash)" "$(cat "$begin_out")")"
install_binding_hash="$(node -e "console.log(JSON.parse(process.argv[1]).install_binding_hash)" "$(cat "$begin_out")")"

generate_request() {
  local output_path="$1"
  local target_session="$2"
  local target_challenge_hash="$3"
  local jti="$4"
  local workspace_root="${5:-$REPO_ROOT/test-workspace}"
  node - "$REPO_ROOT" "$private_key_path" "$output_path" "$target_session" "$target_challenge_hash" "$install_binding_hash" "$jti" "$workspace_root" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [root, privatePath, outputPath, sessionId, challengeHash, installBindingHash, jti, workspaceRoot] = process.argv.slice(2);
const {
  AUTOPILOT_ENGINE_CONTROL_SINKS,
  compileSupervisedEngineBridgeContract,
  getAutopilotEngineControlSinkInventory,
  getRequiredActionCatalogBindingIds,
  getSupervisedEngineBridgeAbiHash,
} = require(path.join(root, 'src', 'engine', 'supervised-engine-bridge-contract'));
const {
  canonicalJson,
  freezeAcceptanceContract,
  resolveGovernancePolicy,
  sha256,
} = require(path.join(root, 'src', 'engine', 'owner-kernel'));

const hash = (value) => sha256(value);
const requirement = {
  'review-dispatch': ['engine_review_dispatch', 'model_runner', 'external'],
  'implementation-dispatch': ['engine_implementation_dispatch', 'model_runner', 'external'],
  'diff-provenance': ['engine_diff_materialization', 'filesystem_git', 'reversible'],
  'repair-prompt-write': ['engine_repair_prompt_write', 'filesystem', 'reversible'],
  'verification-execution': ['engine_verification_command', 'shell', 'external'],
  'verify-worktree-add': ['engine_verify_worktree_add', 'git', 'external'],
  'verify-worktree-remove': ['engine_verify_worktree_remove', 'git', 'external'],
  'verify-worktree-cleanup': ['engine_verify_worktree_cleanup', 'filesystem', 'irreversible'],
  'branch-force': ['engine_branch_force', 'git', 'external'],
};
const attestation = (identity) => ({
  issuer: 'test', uri: `test://${identity}`, sha256: hash(identity),
  issued_at: '2026-07-23T00:00:00.000Z', expires_at: '2027-07-23T00:00:00.000Z',
});
const roster = (identity, role) => ({ identity, model_alias: identity, model_version: '1', family: 'test', runner: 'test', role, attestation: attestation(identity) });
const actionCatalog = AUTOPILOT_ENGINE_CONTROL_SINKS.filter((sink) => sink.requires_action_catalog_binding).map((sink) => {
  const [operation, toolClass, actionClass] = requirement[sink.id];
  return {
    id: sink.id, operation, tool_class: toolClass, action_class: actionClass,
    command_required: sink.id === 'verification-execution', requires_mediator: true, requires_challenge: false,
  };
});
const input = {
  ownerRunId: 'owner-run-p35-live', engineRunId: 'engine-run-p35-live', invocationId: 'invocation-p35-live',
  governanceConfig: {
    schema_version: 1,
    governance: {
      default_mode: 'owner-led', owner_roster: [roster('owner-a', 'owner')], challenger_roster: [roster('challenger-a', 'challenger')], trusted_runner_roster: [roster('runner-a', 'trusted_runner')],
      approval_policy: {
        read_only: { requires_approval: false, max_uses: 1 }, reversible: { requires_approval: false, max_uses: 1 },
        external: { requires_approval: true, max_uses: 1 }, irreversible: { requires_approval: true, max_uses: 1 },
      },
      capability_ttl_seconds: 3600, checkpoint_interval_closed_events: 100, max_blocked_duration_seconds: 86400, action_catalog: actionCatalog,
    },
  },
  acceptanceContract: {
    schema_version: 2, contract_id: 'p35-live-contract', artifacts: [{ id: 'source', target: 'src/engine/autopilot-engine.js' }],
    legs: [{ id: 'verification', kind: 'executable', command: 'bash hooks/tests/autopilot-engine.test.sh', artifact_ids: ['source'] }],
  },
  immutableBase: 'a'.repeat(40), workspaceRoot, prompt: '\u8acb\u9a57\u8b49 P3.5 \u4e2d\u6587 intake \u4e0d\u5f97\u6d29\u9732',
  branch: 'feat/p35-live', verifyCommand: 'bash hooks/tests/run.sh --parallel 16',
  actionCatalogBindings: Object.fromEntries(getRequiredActionCatalogBindingIds().map((id) => [id, id])),
};
const binding = {
  schema_version: 1,
  owner_run_id: input.ownerRunId, engine_run_id: input.engineRunId, invocation_id: input.invocationId,
  policy_hash: resolveGovernancePolicy(input.governanceConfig).policy_hash,
  contract_hash: freezeAcceptanceContract(input.acceptanceContract).contract_hash,
  immutable_base: input.immutableBase, workspace_root_hash: hash(path.resolve(input.workspaceRoot)), prompt_hash: hash(input.prompt),
  branch_hash: hash(input.branch), verify_command_hash: hash(input.verifyCommand),
  sink_inventory_hash: hash(canonicalJson(getAutopilotEngineControlSinkInventory())), bridge_abi_hash: getSupervisedEngineBridgeAbiHash(),
};
const plan = compileSupervisedEngineBridgeContract(input);
const now = Date.now();
const claims = {
  schema_version: 1, purpose: 'autopilot-supervised-owner-intake/v1', audience: 'autopilot-supervised-host',
  issuer: 'owner-control', signing_key_id: 'owner-ed25519-live', keyring_epoch: 1, jti,
  issued_at_ms: now - 5, not_before_ms: now - 5, expires_at_ms: now + 60000,
  session_id: sessionId, session_challenge_hash: challengeHash, host_install_binding_hash: installBindingHash,
  binding, binding_hash: hash(canonicalJson(binding)), plan_hash: hash(canonicalJson(plan)),
};
const protectedPayload = Buffer.from(canonicalJson(claims));
const signature = crypto.sign(null, Buffer.concat([Buffer.from('autopilot-supervised-owner-intake/v1\n'), protectedPayload]), fs.readFileSync(privatePath));
const request = {
  protocol_version: 1, session_id: sessionId,
  envelope: { schema_version: 1, protected_payload: protectedPayload.toString('base64url'), signature: signature.toString('base64url') },
  bridge_input: input,
};
fs.writeFileSync(outputPath, canonicalJson(request), { mode: 0o600 });
NODE
}

generate_request "$request_path" "$session_id" "$challenge_hash" "p35-live-replay-jti"
sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" submit --session-id "$session_id" <"$request_path" >"$submit_out" 2>"$submit_err"

node - "$submit_out" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.status !== 'p35_shadow_intake_complete' || value.owner_kernel_authority !== 'none' || value.acceptance !== 'not_available') process.exit(1);
if (!/^[0-9a-f]{64}$/.test(value.receipt_hash) || !/^[0-9a-f]{64}$/.test(value.plan_hash) || !/^[0-9a-f]{64}$/.test(value.binding_hash)) process.exit(1);
const shadow = value.shadow;
if (!shadow || shadow.status !== 'shadow_intake_recorded' || shadow.idempotent !== false) process.exit(1);
if (!/^[0-9a-f]{64}$/.test(shadow.intake_id) || !/^[0-9a-f]{64}$/.test(shadow.record_hash)) process.exit(1);
if (shadow.disclosure?.engine?.status !== 'not_started' || shadow.disclosure?.engine?.dispatch_authority !== 'not_available') process.exit(1);
if (shadow.disclosure?.owner_kernel_authority !== 'none' || shadow.disclosure?.effect_authority !== 'none') process.exit(1);
if (shadow.disclosure?.broker_authority !== 'not_available' || shadow.disclosure?.acceptance !== 'not_available') process.exit(1);
if (shadow.disclosure?.witness_assurance !== 'local_verifier_state_not_independent_witness' || shadow.disclosure?.alias_retirement_eligible !== false) process.exit(1);
NODE

if sudo -n test -e "/run/autopilot-intake/$session_id"; then
  printf 'FAIL [supervised-intake-live-host] completed session remained after cleanup\n' >&2
  exit 1
fi

sudo -n install -d -o root -g root -m 0755 "$bound_workspace_root"
sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" workspace-register \
  --registration-id p35c-workspace-main \
  --workspace-root "$bound_workspace_root" \
  --immutable-base "$(printf 'a%.0s' {1..40})" \
  --ttl-milliseconds 600000 >"$bound_register_out"
node - "$bound_register_out" "$bound_workspace_root" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [outputPath, workspaceRoot] = process.argv.slice(2);
const raw = fs.readFileSync(outputPath, 'utf8');
const value = JSON.parse(raw);
const expectedHash = crypto.createHash('sha256').update(path.resolve(workspaceRoot)).digest('hex');
if (value.status !== 'workspace_registered' || value.registration_id !== 'p35c-workspace-main') process.exit(1);
if (value.workspace_root_hash !== expectedHash || value.immutable_base !== 'a'.repeat(40)) process.exit(1);
if (!/^[0-9a-f]{64}$/.test(value.descriptor_binding_hash || '')) process.exit(1);
if (value.content_immutability !== 'not_available' || value.owner_kernel_authority !== 'none' || value.acceptance !== 'not_available') process.exit(1);
if (raw.includes(workspaceRoot)) process.exit(1);
NODE

sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" begin \
  --workspace-registration-id p35c-workspace-main >"$bound_begin_out"
bound_session="$(node -e "console.log(JSON.parse(process.argv[1]).session_id)" "$(cat "$bound_begin_out")")"
bound_challenge="$(node -e "console.log(JSON.parse(process.argv[1]).session_challenge_hash)" "$(cat "$bound_begin_out")")"
node - "$bound_begin_out" "$bound_workspace_root" <<'NODE'
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const value = JSON.parse(raw);
const workspaceRoot = process.argv[3];
const binding = value.workspace_binding;
if (value.status !== 'session_open' || !binding || binding.registration_id !== 'p35c-workspace-main') process.exit(1);
if (!/^[0-9a-f]{64}$/.test(binding.descriptor_binding_hash || '') || !/^[0-9a-f]{64}$/.test(binding.ticket_hash || '')) process.exit(1);
if (binding.assurance !== 'root_held_descriptor_matches_signed_v1_path_and_base_only' || binding.content_immutability !== 'not_available') process.exit(1);
if (raw.includes(workspaceRoot)) process.exit(1);
NODE
generate_request "$bound_request_path" "$bound_session" "$bound_challenge" "p35c-live-bound-jti" "$bound_workspace_root"
if ! sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" submit --session-id "$bound_session" \
  <"$bound_request_path" >"$bound_submit_out" 2>"$bound_submit_err"; then
  printf 'FAIL [supervised-intake-live-host] bound workspace submission failed\n' >&2
  sed -n '1,120p' "$bound_submit_err" >&2 || true
  exit 1
fi
node - "$bound_submit_out" "$bound_workspace_root" "$bound_witness_meta" <<'NODE'
const fs = require('fs');
const [outputPath, workspaceRoot, metaPath] = process.argv.slice(2);
const raw = fs.readFileSync(outputPath, 'utf8');
const value = JSON.parse(raw);
const hashes = ['shadow_admission_id', 'ticket_hash', 'capsule_hash', 'observation_hash', 'close_hash', 'shadow_chain_head'];
const witness = value.shadow_witness;
const binding = value.workspace_binding;
if (value.status !== 'p35_shadow_intake_complete' || value.owner_kernel_authority !== 'none' || value.acceptance !== 'not_available') process.exit(1);
if (!binding || binding.registration_id !== 'p35c-workspace-main' || binding.assurance !== 'root_held_descriptor_matches_signed_v1_path_and_base_only' || binding.content_immutability !== 'not_available') process.exit(1);
if (!witness || witness.status !== 'shadow_witness_recorded' || witness.idempotent !== false) process.exit(1);
if (!hashes.every((key) => /^[0-9a-f]{64}$/.test(witness[key] || ''))) process.exit(1);
if (witness.previous_shadow_head !== null && !/^[0-9a-f]{64}$/.test(witness.previous_shadow_head || '')) process.exit(1);
const disclosure = witness.disclosure;
if (disclosure?.engine?.status !== 'not_started' || disclosure?.engine?.dispatch_authority !== 'not_available') process.exit(1);
if (disclosure?.owner_kernel_authority !== 'none' || disclosure?.effect_authority !== 'none' || disclosure?.acceptance !== 'not_available') process.exit(1);
if (disclosure?.witness_assurance !== 'separate_uid_local_append_only_root_readback_not_p2') process.exit(1);
if (disclosure?.workspace_assurance !== 'root_held_descriptor_matches_signed_v1_path_and_base_only' || disclosure?.content_immutability !== 'not_available') process.exit(1);
if (raw.includes(workspaceRoot)) process.exit(1);
fs.writeFileSync(metaPath, JSON.stringify({
  shadow_admission_id: witness.shadow_admission_id,
  ticket_hash: witness.ticket_hash,
  capsule_hash: witness.capsule_hash,
  observation_hash: witness.observation_hash,
  close_hash: witness.close_hash,
  shadow_chain_head: witness.shadow_chain_head,
}, null, 0) + '\n', { mode: 0o600 });
NODE
if sudo -n test -e "/run/autopilot-intake/$bound_session"; then
  printf 'FAIL [supervised-intake-live-host] bound workspace session remained after cleanup\n' >&2
  exit 1
fi
sudo -n /usr/bin/python3 - "$witness_state_root" "$bound_witness_meta" "$bound_workspace_root" <<'PY'
import json
import os
import pwd
import stat
import sys

state_root, meta_path, workspace_root = sys.argv[1:]
with open(meta_path, 'r', encoding='utf-8') as source:
    expected = json.load(source)
journal_path = os.path.join(state_root, 'journal', expected['shadow_admission_id'] + '.jsonl')
account = pwd.getpwnam('autopilot-shadow-witness')
info = os.lstat(journal_path)
if (
    not stat.S_ISREG(info.st_mode)
    or info.st_uid != account.pw_uid
    or info.st_gid != account.pw_gid
    or (info.st_mode & 0o7777) != 0o600
    or info.st_nlink != 1
):
    raise SystemExit('witness journal identity or mode is incorrect')
with open(journal_path, 'rb') as source:
    raw = source.read()
if workspace_root.encode('utf-8') in raw or '\u8acb\u9a57\u8b49 P3.5 \u4e2d\u6587 intake \u4e0d\u5f97\u6d29\u9732'.encode('utf-8') in raw:
    raise SystemExit('witness journal retained raw workspace or prompt data')
lines = raw.splitlines()
if len(lines) != 3:
    raise SystemExit('witness journal does not contain exactly three durable transitions')
entries = [json.loads(line) for line in lines]
if [(entry.get('sequence'), entry.get('phase')) for entry in entries] != [(0, 'open'), (1, 'observation'), (2, 'closed')]:
    raise SystemExit('witness journal phases are invalid')
if entries[-1].get('entry_hash') != expected['shadow_chain_head']:
    raise SystemExit('witness journal final hash does not match root-readback output')
if entries[0].get('shadow_admission_id') != expected['shadow_admission_id'] or entries[0].get('ticket_hash') != expected['ticket_hash']:
    raise SystemExit('witness journal does not match the root-issued ticket')
if entries[0].get('capsule_hash') != expected['capsule_hash']:
    raise SystemExit('witness journal capsule hash does not match the gateway summary')
if entries[1].get('observation_hash') != expected['observation_hash'] or entries[2].get('close_hash') != expected['close_hash']:
    raise SystemExit('witness journal observation or close hash does not match the gateway summary')
if any('workspace' in key or 'prompt' in key for entry in entries for key in entry):
    raise SystemExit('witness journal schema gained raw workspace or prompt fields')
PY
if sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" begin \
  --workspace-registration-id p35c-workspace-main >"$bound_reuse_out" 2>"$bound_reuse_err"; then
  printf 'FAIL [supervised-intake-live-host] completed workspace descriptor registration was reused\n' >&2
  exit 1
fi
if ! grep -qi 'registration\|completed\|reserved' "$bound_reuse_err"; then
  printf 'FAIL [supervised-intake-live-host] completed workspace descriptor rejection was not visible\n' >&2
  exit 1
fi
if ! stop_workspace_registry; then
  exit 1
fi
if sudo -n test -e "$workspace_registry_root/registry.sock"; then
  printf 'FAIL [supervised-intake-live-host] workspace registry socket remained after graceful stop\n' >&2
  exit 1
fi

sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" begin >"$begin_out"
stale_session="$(node -e "console.log(JSON.parse(process.argv[1]).session_id)" "$(cat "$begin_out")")"
sudo -n /usr/bin/python3 - "/run/autopilot-intake/$stale_session/root-state/session.json" <<'PY'
import json
import os
import sys

path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as source:
    value = json.load(source)
value['expires_at_ms'] = 1
with open(path, 'w', encoding='utf-8') as target:
    target.write(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False))
    target.flush()
    os.fsync(target.fileno())
os.chown(path, 0, 0)
os.chmod(path, 0o600)
PY

pending_session=".p35-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pending-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
legacy_session="p35-dddddddddddddddddddddddddddddddd"
prior_raw_session="p35-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
sealed_session="p35-ffffffffffffffffffffffffffffffff"
partially_sealed_session="p35-11111111111111111111111111111111"
legacy_fixture_expected=0
if getent passwd autopilot-worker >/dev/null; then
  legacy_fixture_expected=1
fi
sudo -n /usr/bin/python3 - "/run/autopilot-intake/$pending_session" "/run/autopilot-intake/$legacy_session" "$legacy_session" "/run/autopilot-intake/$prior_raw_session" "$prior_raw_session" "/run/autopilot-intake/$sealed_session" "$sealed_session" "/run/autopilot-intake/$partially_sealed_session" "$partially_sealed_session" <<'PY'
import json
import os
import pwd
import socket
import sys

(
    root,
    legacy_root,
    legacy_session,
    prior_raw_root,
    prior_raw_session,
    sealed_root,
    sealed_session,
    partially_sealed_root,
    partially_sealed_session,
) = sys.argv[1:]
worker = pwd.getpwnam('autopilot-intake-worker')
try:
    legacy_worker = pwd.getpwnam('autopilot-worker')
except KeyError:
    legacy_worker = None
verifier = pwd.getpwnam('autopilot-verifier')
os.mkdir(root, 0o711)
os.chown(root, 0, 0)
os.chmod(root, 0o711)
root_state = os.path.join(root, 'root-state')
worker_root = os.path.join(root, 'worker')
socket_root = os.path.join(root, 'socket')
gateway_root = os.path.join(root, 'gateway')
for path, uid, gid, mode in (
    (root_state, 0, 0, 0o700),
    (worker_root, 0, worker.pw_gid, 0o710),
    (socket_root, verifier.pw_uid, worker.pw_gid, 0o2710),
    (gateway_root, verifier.pw_uid, verifier.pw_gid, 0o700),
):
    os.mkdir(path, mode)
    os.chown(path, uid, gid)
    os.chmod(path, mode)
temporary = os.path.join(root_state, '.session.json.pending-cccccccccccccccccccccccccccccccc')
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o000)
os.fchown(descriptor, 0, 0)
os.fchmod(descriptor, 0o000)
os.close(descriptor)
os.utime(root, (1, 1))

os.mkdir(prior_raw_root, 0o711)
os.chown(prior_raw_root, 0, 0)
os.chmod(prior_raw_root, 0o711)
prior_raw_state_root = os.path.join(prior_raw_root, 'root-state')
prior_raw_worker_root = os.path.join(prior_raw_root, 'worker')
prior_raw_socket_root = os.path.join(prior_raw_root, 'socket')
prior_raw_gateway_root = os.path.join(prior_raw_root, 'gateway')
for path, uid, gid, mode in (
    (prior_raw_state_root, 0, 0, 0o700),
    (prior_raw_worker_root, 0, worker.pw_gid, 0o710),
    (prior_raw_socket_root, verifier.pw_uid, worker.pw_gid, 0o2710),
    (prior_raw_gateway_root, verifier.pw_uid, verifier.pw_gid, 0o700),
):
    os.mkdir(path, mode)
    os.chown(path, uid, gid)
    os.chmod(path, mode)
prior_raw_state = {
    'schema_version': 1,
    'status': 'open',
    'session_id': prior_raw_session,
    'session_challenge_hash': 'c' * 64,
    'install_binding_hash': 'b' * 64,
    'expires_at_ms': 1,
}
prior_raw_path = os.path.join(prior_raw_state_root, 'session.json')
with open(prior_raw_path, 'w', encoding='utf-8') as target:
    target.write(json.dumps(prior_raw_state, sort_keys=True, separators=(',', ':'), ensure_ascii=False))
    target.flush()
    os.fsync(target.fileno())
os.chown(prior_raw_path, 0, 0)
os.chmod(prior_raw_path, 0o600)
prior_raw_request = os.path.join(prior_raw_worker_root, 'request.json')
descriptor = os.open(prior_raw_request, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
os.write(descriptor, b'{}')
os.fchown(descriptor, 0, worker.pw_gid)
os.fchmod(descriptor, 0o440)
os.close(descriptor)
release_pending = os.path.join(
    prior_raw_worker_root,
    'release.json.pending-99999999999999999999999999999999',
)
descriptor = os.open(release_pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
os.write(descriptor, b'{}')
os.fchown(descriptor, 0, worker.pw_gid)
os.fchmod(descriptor, 0o440)
os.close(descriptor)
handoff_pending = os.path.join(
    prior_raw_worker_root,
    '.h-88888888888888888888888888888888',
)
handoff_listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
handoff_listener.bind(handoff_pending)
os.chmod(handoff_pending, 0o600)
handoff_listener.close()

os.mkdir(sealed_root, 0o711)
os.chown(sealed_root, 0, 0)
os.chmod(sealed_root, 0o711)
sealed_state_root = os.path.join(sealed_root, 'root-state')
sealed_worker_root = os.path.join(sealed_root, 'worker')
sealed_socket_root = os.path.join(sealed_root, 'socket')
sealed_gateway_root = os.path.join(sealed_root, 'gateway')
for path, uid, gid, mode in (
    (sealed_state_root, 0, 0, 0o700),
    (sealed_worker_root, 0, worker.pw_gid, 0o710),
    (sealed_socket_root, 0, worker.pw_gid, 0o710),
    (sealed_gateway_root, verifier.pw_uid, verifier.pw_gid, 0o700),
):
    os.mkdir(path, mode)
    os.chown(path, uid, gid)
    os.chmod(path, mode)
sealed_state = {
    'schema_version': 1,
    'status': 'open',
    'session_id': sealed_session,
    'session_challenge_hash': 'c' * 64,
    'install_binding_hash': 'b' * 64,
    'expires_at_ms': 1,
}
sealed_path = os.path.join(sealed_state_root, 'session.json')
with open(sealed_path, 'w', encoding='utf-8') as target:
    target.write(json.dumps(sealed_state, sort_keys=True, separators=(',', ':'), ensure_ascii=False))
    target.flush()
    os.fsync(target.fileno())
os.chown(sealed_path, 0, 0)
os.chmod(sealed_path, 0o600)
sealed_socket_path = os.path.join(sealed_socket_root, 'intake.sock')
sealed_listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sealed_listener.bind(sealed_socket_path)
os.chown(sealed_socket_path, worker.pw_uid, worker.pw_gid)
os.chmod(sealed_socket_path, 0o600)
sealed_listener.close()
for name in (
    '.ready.json.pending-77777777777777777777777777777777',
    '.result.json.pending-66666666666666666666666666666666',
):
    pending_path = os.path.join(sealed_gateway_root, name)
    descriptor = os.open(pending_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.write(descriptor, b'{}')
    os.fchown(descriptor, verifier.pw_uid, verifier.pw_gid)
    os.fchmod(descriptor, 0o600)
    os.close(descriptor)

os.mkdir(partially_sealed_root, 0o711)
os.chown(partially_sealed_root, 0, 0)
os.chmod(partially_sealed_root, 0o711)
partially_sealed_state_root = os.path.join(partially_sealed_root, 'root-state')
partially_sealed_worker_root = os.path.join(partially_sealed_root, 'worker')
partially_sealed_socket_root = os.path.join(partially_sealed_root, 'socket')
partially_sealed_gateway_root = os.path.join(partially_sealed_root, 'gateway')
for path, uid, gid, mode in (
    (partially_sealed_state_root, 0, 0, 0o700),
    (partially_sealed_worker_root, 0, worker.pw_gid, 0o710),
    (partially_sealed_socket_root, 0, worker.pw_gid, 0o2710),
    (partially_sealed_gateway_root, verifier.pw_uid, verifier.pw_gid, 0o700),
):
    os.mkdir(path, mode)
    os.chown(path, uid, gid)
    os.chmod(path, mode)
partially_sealed_state = {
    'schema_version': 1,
    'status': 'open',
    'session_id': partially_sealed_session,
    'session_challenge_hash': 'c' * 64,
    'install_binding_hash': 'b' * 64,
    'expires_at_ms': 1,
}
partially_sealed_path = os.path.join(partially_sealed_state_root, 'session.json')
with open(partially_sealed_path, 'w', encoding='utf-8') as target:
    target.write(json.dumps(partially_sealed_state, sort_keys=True, separators=(',', ':'), ensure_ascii=False))
    target.flush()
    os.fsync(target.fileno())
os.chown(partially_sealed_path, 0, 0)
os.chmod(partially_sealed_path, 0o600)

if legacy_worker is not None:
    os.mkdir(legacy_root, 0o711)
    os.chown(legacy_root, 0, 0)
    os.chmod(legacy_root, 0o711)
    legacy_root_state = os.path.join(legacy_root, 'root-state')
    legacy_worker_root = os.path.join(legacy_root, 'worker')
    legacy_socket_root = os.path.join(legacy_root, 'socket')
    legacy_gateway_root = os.path.join(legacy_root, 'gateway')
    for path, uid, gid, mode in (
        (legacy_root_state, 0, 0, 0o700),
        (legacy_worker_root, 0, legacy_worker.pw_gid, 0o710),
        (legacy_socket_root, verifier.pw_uid, legacy_worker.pw_gid, 0o2710),
        (legacy_gateway_root, verifier.pw_uid, verifier.pw_gid, 0o700),
    ):
        os.mkdir(path, mode)
        os.chown(path, uid, gid)
        os.chmod(path, mode)
    legacy_state = {
        'schema_version': 1,
        'status': 'open',
        'session_id': legacy_session,
        'session_challenge_hash': 'c' * 64,
        'install_binding_hash': 'b' * 64,
        'expires_at_ms': 1,
    }
    legacy_path = os.path.join(legacy_root_state, 'session.json')
    with open(legacy_path, 'w', encoding='utf-8') as target:
        target.write(json.dumps(legacy_state, sort_keys=True, separators=(',', ':'), ensure_ascii=False))
        target.flush()
        os.fsync(target.fileno())
    os.chown(legacy_path, 0, 0)
    os.chmod(legacy_path, 0o600)
    legacy_request = os.path.join(legacy_worker_root, 'request.json')
    descriptor = os.open(legacy_request, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    os.write(descriptor, b'{}')
    os.fchown(descriptor, 0, legacy_worker.pw_gid)
    os.fchmod(descriptor, 0o440)
    os.close(descriptor)
PY

sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" begin >"$replay_out"
if sudo -n test -e "/run/autopilot-intake/$stale_session"; then
  printf 'FAIL [supervised-intake-live-host] expired abandoned session was not reaped\n' >&2
  exit 1
fi
if sudo -n test -e "/run/autopilot-intake/$pending_session"; then
  printf 'FAIL [supervised-intake-live-host] stale pending session was not reaped\n' >&2
  exit 1
fi
if sudo -n test -e "/run/autopilot-intake/$prior_raw_session"; then
  printf 'FAIL [supervised-intake-live-host] expired prior raw-request session was not reaped\n' >&2
  exit 1
fi
if sudo -n test -e "/run/autopilot-intake/$sealed_session"; then
  printf 'FAIL [supervised-intake-live-host] expired sealed socket session was not reaped\n' >&2
  exit 1
fi
if sudo -n test -e "/run/autopilot-intake/$partially_sealed_session"; then
  printf 'FAIL [supervised-intake-live-host] expired partially sealed socket session was not reaped\n' >&2
  exit 1
fi
if [ "$legacy_fixture_expected" -eq 1 ] && sudo -n test -e "/run/autopilot-intake/$legacy_session"; then
  printf 'FAIL [supervised-intake-live-host] expired legacy worker session was not reaped\n' >&2
  exit 1
fi
replay_session="$(node -e "console.log(JSON.parse(process.argv[1]).session_id)" "$(cat "$replay_out")")"
replay_challenge="$(node -e "console.log(JSON.parse(process.argv[1]).session_challenge_hash)" "$(cat "$replay_out")")"
generate_request "$request_path" "$replay_session" "$replay_challenge" "p35-live-replay-jti"
if sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" submit --session-id "$replay_session" <"$request_path" >"$replay_out" 2>"$replay_err"; then
  printf 'FAIL [supervised-intake-live-host] conflicting durable replay was accepted\n' >&2
  exit 1
fi
if ! grep -qi 'verified intake result\|replay\|rejected' "$replay_err"; then
  printf 'FAIL [supervised-intake-live-host] replay rejection was not visible\n' >&2
  exit 1
fi
if sudo -n test -e "/run/autopilot-intake/$replay_session"; then
  printf 'FAIL [supervised-intake-live-host] rejected session remained after cleanup\n' >&2
  exit 1
fi

sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" begin >"$begin_out"
race_session="$(node -e "console.log(JSON.parse(process.argv[1]).session_id)" "$(cat "$begin_out")")"
race_challenge="$(node -e "console.log(JSON.parse(process.argv[1]).session_challenge_hash)" "$(cat "$begin_out")")"
generate_request "$race_request_path" "$race_session" "$race_challenge" "p35-live-race-jti"
race_a_status=0
race_b_status=0
sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" submit --session-id "$race_session" <"$race_request_path" >"$race_a_out" 2>"$race_a_err" &
race_a_pid=$!
sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" submit --session-id "$race_session" <"$race_request_path" >"$race_b_out" 2>"$race_b_err" &
race_b_pid=$!
if wait "$race_a_pid"; then
  race_a_status=0
else
  race_a_status=$?
fi
if wait "$race_b_pid"; then
  race_b_status=0
else
  race_b_status=$?
fi
if [ $(( (race_a_status == 0 ? 1 : 0) + (race_b_status == 0 ? 1 : 0) )) -ne 1 ]; then
  printf 'FAIL [supervised-intake-live-host] concurrent submit did not produce exactly one winner\n' >&2
  exit 1
fi
if sudo -n test -e "/run/autopilot-intake/$race_session"; then
  printf 'FAIL [supervised-intake-live-host] race session remained after winner cleanup\n' >&2
  exit 1
fi

sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" begin >"$begin_out"
expiry_session="$(node -e "console.log(JSON.parse(process.argv[1]).session_id)" "$(cat "$begin_out")")"
expiry_challenge="$(node -e "console.log(JSON.parse(process.argv[1]).session_challenge_hash)" "$(cat "$begin_out")")"
generate_request "$expiry_request_path" "$expiry_session" "$expiry_challenge" "p35-live-expiry-jti"
sudo -n /usr/bin/python3 - "/run/autopilot-intake/$expiry_session/root-state/session.json" <<'PY'
import json
import os
import time
import sys

path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as source:
    value = json.load(source)
value['expires_at_ms'] = int(time.time() * 1000) + 250
with open(path, 'w', encoding='utf-8') as target:
    target.write(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False))
    target.flush()
    os.fsync(target.fileno())
os.chown(path, 0, 0)
os.chmod(path, 0o600)
PY
if (sleep 1; cat "$expiry_request_path") | sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" submit --session-id "$expiry_session" >"$expiry_out" 2>"$expiry_err"; then
  printf 'FAIL [supervised-intake-live-host] submit survived session expiry while waiting for stdin\n' >&2
  exit 1
fi
if ! grep -qi 'timed out\|expired' "$expiry_err"; then
  printf 'FAIL [supervised-intake-live-host] expiry rejection was not visible\n' >&2
  exit 1
fi
if sudo -n test -e "/run/autopilot-intake/$expiry_session"; then
  printf 'FAIL [supervised-intake-live-host] expired submit session remained after cleanup\n' >&2
  exit 1
fi

p34_original="$stage_root/p34-support.original"
cp "$install_root/lib/p34-support.py" "$p34_original"
printf 'raise RuntimeError("P35_BOOTSTRAP_EXECUTED_UNTRUSTED_P34")\n' | sudo -n tee "$install_root/lib/p34-support.py" >/dev/null
sudo -n chmod 755 "$install_root/lib/p34-support.py"
if sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" begin >"$p34_tamper_out" 2>"$p34_tamper_err"; then
  printf 'FAIL [supervised-intake-live-host] modified p34 support was imported\n' >&2
  exit 1
fi
if grep -q 'P35_BOOTSTRAP_EXECUTED_UNTRUSTED_P34' "$p34_tamper_err" || ! grep -qi 'bootstrap p34 support hash' "$p34_tamper_err"; then
  printf 'FAIL [supervised-intake-live-host] p34 support failed after import instead of bootstrap validation\n' >&2
  exit 1
fi
sudo -n cp "$p34_original" "$install_root/lib/p34-support.py"
sudo -n chmod 755 "$install_root/lib/p34-support.py"

sudo -n /usr/bin/python3 - "$install_root/etc/supervised-intake-host.json" <<'PY'
import sys
path = sys.argv[1]
with open(path, 'rb') as source:
    raw = source.read()
with open(path, 'wb') as target:
    target.write(raw[:-1] + b'!')
PY
if sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-intake-host.py" begin >"$tamper_out" 2>"$tamper_err"; then
  printf 'FAIL [supervised-intake-live-host] modified installed config was accepted\n' >&2
  exit 1
fi
if ! grep -qi 'config' "$tamper_err"; then
  printf 'FAIL [supervised-intake-live-host] config tamper failure was not visible\n' >&2
  exit 1
fi

if sudo -n /usr/bin/systemctl list-units --all --no-legend 'autopilot-p35-*' | grep -q 'autopilot-p35-'; then
  printf 'FAIL [supervised-intake-live-host] transient P3.5 unit remained after cleanup\n' >&2
  exit 1
fi

printf 'PASS [supervised-intake-live-host]\n'
