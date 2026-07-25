#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const host = require(path.join(root, 'src', 'engine', 'supervised-host-preflight'));
const engine = require(path.join(root, 'src', 'engine'));
const { sha256 } = require(path.join(root, 'src', 'engine', 'owner-kernel'));

const nonce = 'p34-contract-nonce';
const hash = (character) => character.repeat(64);
const baseInput = () => ({
  schema_version: host.SUPERVISED_HOST_PREFLIGHT_SCHEMA_VERSION,
  run_id: 'p34-contract-run',
  invocation_id: 'p34-contract-invocation',
  plan_hash: hash('a'),
  nonce_hash: sha256(nonce),
  service_unit: 'autopilot-p34-contract.service',
  broker: { identity: 'broker-owner', uid: 1000, gid: 1000 },
  worker: {
    identity: host.SYSTEMD_WORKER_IDENTITY,
    uid: host.SYSTEMD_WORKER_UID,
    gid: host.SYSTEMD_WORKER_GID,
  },
  runtime_root: `${host.RUNTIME_PARENT}/autopilot-p34-contract.service`,
  helper_path: '/usr/local/lib/autopilot/p34/supervised-host-peercred.py',
  python_path: '/usr/bin/python3.14',
  systemd_run_path: '/usr/bin/systemd-run',
});

const plan = host.compileSupervisedHostPreflight(baseInput());
assert.equal(plan.status, 'preflight_only');
assert.equal(plan.owner_kernel_authority, 'none');
assert.equal(plan.acceptance, 'not_available');
assert.equal(plan.protocol.operation, 'p34_hello');
assert.equal(plan.protocol.request_lifecycle, 'single_use');
assert.equal(plan.protocol.max_frame_bytes, host.MAX_FRAME_BYTES);
assert.equal(plan.socket_path, `${plan.runtime_root}/${host.SOCKET_DIRECTORY}/${host.SOCKET_FILENAME}`);
assert.equal(plan.worker_cgroup_path, `/system.slice/${plan.service_unit}`);
assert.deepEqual(host.verifySupervisedHostPreflight(plan, baseInput()), {
  verified: true,
  binding_hash: plan.binding_hash,
  status: 'preflight_only',
  owner_kernel_authority: 'none',
  acceptance: 'not_available',
});

const systemdArgs = host.buildSupervisedHostSystemdArgs(plan);
assert.deepEqual(systemdArgs.slice(0, 6), [
  '--wait',
  '--pipe',
  '--quiet',
  '--collect',
  '--unit=autopilot-p34-contract.service',
  '--slice=system.slice',
]);
assert.ok(systemdArgs.includes('--uid=nobody'));
assert.ok(systemdArgs.includes('--gid=nogroup'));
assert.ok(systemdArgs.includes('--property=CollectMode=inactive-or-failed'));
for (const property of host.SUPERVISED_HOST_SYSTEMD_PROPERTIES) {
  assert.ok(systemdArgs.includes(`--property=${property}`));
}

const gatewayArgs = host.buildSupervisedHostGatewayArgs(plan);
assert.deepEqual(gatewayArgs.slice(0, 4), [plan.python_path, '-I', plan.helper_path, 'serve']);
assert.ok(gatewayArgs.includes('--expected-cgroup-path'));
assert.ok(gatewayArgs.includes('/system.slice/autopilot-p34-contract.service'));
assert.ok(gatewayArgs.includes('--broker-uid'));
assert.ok(gatewayArgs.includes('--socket-gid'));

const workerArgs = host.buildSupervisedHostWorkerArgs(plan, nonce);
assert.deepEqual(workerArgs.slice(0, 4), [plan.python_path, '-I', plan.helper_path, 'client']);
assert.ok(workerArgs.includes('--expected-server-uid'));
assert.ok(workerArgs.includes('--expected-server-gid'));
assert.ok(workerArgs.includes('--expected-socket-gid'));
assert.ok(workerArgs.includes(plan.binding_hash));
assert.throws(
  () => host.buildSupervisedHostWorkerArgs(plan, 'wrong-nonce'),
  /nonce hash/i,
);

assert.throws(
  () => host.compileSupervisedHostPreflight({
    ...baseInput(),
    broker: { identity: 'root-broker', uid: 0, gid: 0 },
  }),
  /unprivileged/i,
);
assert.throws(
  () => host.compileSupervisedHostPreflight({
    ...baseInput(),
    broker: { identity: 'same-gid', uid: 1000, gid: host.SYSTEMD_WORKER_GID },
  }),
  /distinct UID and GID/i,
);
assert.throws(
  () => host.compileSupervisedHostPreflight({
    ...baseInput(),
    worker: { identity: 'other', uid: host.SYSTEMD_WORKER_UID, gid: host.SYSTEMD_WORKER_GID },
  }),
  /frozen nobody/i,
);
assert.throws(
  () => host.compileSupervisedHostPreflight({
    ...baseInput(),
    service_unit: 'foreign.service',
  }),
  /autopilot-p34/i,
);
assert.throws(
  () => host.compileSupervisedHostPreflight({
    ...baseInput(),
    runtime_root: '/tmp/autopilot-p34-contract.service',
  }),
  /runtime_root/i,
);
assert.throws(
  () => host.compileSupervisedHostPreflight({ ...baseInput(), extra: true }),
  /unsupported key/i,
);

const tamperedPlan = JSON.parse(JSON.stringify(plan));
tamperedPlan.protocol.request_lifecycle = 'retry';
assert.throws(
  () => host.buildSupervisedHostSystemdArgs(tamperedPlan),
  /does not match frozen input/i,
);
assert.throws(
  () => host.preflightSupervisedHostRuntime(plan, { platform: 'darwin', getuid: () => 0 }),
  /requires Linux/i,
);
assert.throws(
  () => host.preflightSupervisedHostRuntime(plan, { platform: 'linux', getuid: () => 1000 }),
  /requires root/i,
);

const fakeStat = (candidate) => ({
  uid: 0,
  mode: candidate === host.RUNTIME_PARENT ? 0o711 : 0o755,
  isSymbolicLink: () => false,
  isDirectory: () => candidate === host.RUNTIME_PARENT,
  isFile: () => candidate !== host.RUNTIME_PARENT,
});
const runtime = host.preflightSupervisedHostRuntime(plan, {
  platform: 'linux',
  getuid: () => 0,
  lstatSync: fakeStat,
  realpathSync: (candidate) => candidate,
});
assert.equal(runtime.ready_to_launch, true);
assert.equal(runtime.binding_hash, plan.binding_hash);
assert.throws(
  () => host.preflightSupervisedHostRuntime(plan, {
    platform: 'linux',
    getuid: () => 0,
    lstatSync: fakeStat,
    realpathSync: (candidate) => candidate === plan.python_path ? '/usr/bin/python3.15' : candidate,
  }),
  /symlink/i,
);
assert.equal(engine.compileSupervisedHostPreflight, host.compileSupervisedHostPreflight);
assert.equal(engine.buildSupervisedHostWorkerArgs, host.buildSupervisedHostWorkerArgs);

const jsSource = fs.readFileSync(path.join(root, 'src', 'engine', 'supervised-host-preflight.js'), 'utf8');
assert.doesNotMatch(jsSource, /\b(?:mintActionDecision|executeAuthorizedAction|acceptRun|completeRun)\s*\(/);
assert.doesNotMatch(jsSource, /require\(['"]\.\/owner-kernel['"]\)/);
console.log('compile_verify=true');
console.log('single_use=true');
console.log('frozen_identity=true');
console.log('root_preflight=true');
console.log('no_owner_kernel_authority=true');
NODE
)"
NODE_STATUS=$?

assert_eq "$NODE_STATUS" "0" "supervised host preflight contract fixture exits successfully"
assert_contains "$OUT" "compile_verify=true" "compiled preflight bindings verify exactly"
assert_contains "$OUT" "single_use=true" "protocol is explicitly one-shot"
assert_contains "$OUT" "frozen_identity=true" "broker and worker identities are constrained"
assert_contains "$OUT" "root_preflight=true" "runtime preflight rejects non-root/non-Linux launchers"
assert_contains "$OUT" "no_owner_kernel_authority=true" "preflight source cannot invoke Owner Kernel authority"

PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import importlib.util
import io
import json
import os
import socket
import sys
import threading
import time
import types
from unittest.mock import patch

sys.dont_write_bytecode = True
source = sys.argv[1] + "/src/engine/supervised-host-peercred.py"
spec = importlib.util.spec_from_file_location("supervised_host_peercred_test", source)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

nonce = "p34-python-nonce"
args = types.SimpleNamespace(
    run_id="p34-python-run",
    invocation_id="p34-python-invocation",
    plan_hash="a" * 64,
    nonce_hash=helper.digest(nonce),
    binding_hash="b" * 64,
    expected_server_uid=1000,
    expected_server_gid=1000,
)
hello = {
    "op": "p34_hello",
    "run_id": args.run_id,
    "invocation_id": args.invocation_id,
    "plan_hash": args.plan_hash,
    "nonce": nonce,
}
assert helper.validate_hello(helper.canonical(hello).encode("utf-8"), args) == hello
invalid = dict(hello)
invalid["op"] = "accept"
try:
    helper.validate_hello(helper.canonical(invalid).encode("utf-8"), args)
    raise AssertionError("unknown operation was accepted")
except ValueError as error:
    assert str(error) == "operation_rejected"

with patch("builtins.open", return_value=io.StringIO("0::/system.slice/autopilot-p34-live.service-evil\n")):
    assert helper.cgroup_matches(42, "/system.slice/autopilot-p34-live.service") is False
with patch("builtins.open", return_value=io.StringIO("0::/system.slice/autopilot-p34-live.service\n")):
    assert helper.cgroup_matches(42, "/system.slice/autopilot-p34-live.service") is True

left, right = socket.socketpair()
try:
    left.sendall(b"x" * (helper.MAX_FRAME_BYTES + 1))
    try:
        helper.receive_one_frame(right, 1)
        raise AssertionError("oversize frame was accepted")
    except ValueError as error:
        assert "frame" in str(error)
finally:
    left.close()
    right.close()

left, right = socket.socketpair()
def drip():
    for _ in range(5):
        left.sendall(b"x")
        time.sleep(0.04)
thread = threading.Thread(target=drip)
thread.start()
started = time.monotonic()
try:
    helper.receive_one_frame(right, 0.1)
    raise AssertionError("trickling peer exceeded the absolute frame deadline")
except TimeoutError:
    assert time.monotonic() - started < 0.2
finally:
    thread.join()
    left.close()
    right.close()

receipt = {
    "protocol_version": helper.PROTOCOL_VERSION,
    "run_id": args.run_id,
    "invocation_id": args.invocation_id,
    "plan_hash": args.plan_hash,
    "binding_hash": args.binding_hash,
    "gateway": {"uid": args.expected_server_uid, "gid": args.expected_server_gid},
    "peer": {"pid": os.getpid(), "uid": os.geteuid(), "gid": os.getegid()},
    "status": "preflight_only",
    "owner_kernel_authority": "none",
    "acceptance": "not_available",
}
receipt["receipt_hash"] = helper.receipt_hash(receipt)
response = {"ok": True, "receipt": receipt}
assert helper.validate_response((helper.canonical(response) + "\n").encode("utf-8"), args)["ok"] is True
bad_response = json.loads(json.dumps(response))
bad_response["receipt"]["binding_hash"] = "c" * 64
try:
    helper.validate_response((helper.canonical(bad_response) + "\n").encode("utf-8"), args)
    raise AssertionError("wrong binding was accepted")
except ValueError as error:
    assert str(error) == "receipt_binding_mismatch"

print("strict_frames=true")
print("response_binding=true")
print("python_compatibility=true")
PY
)"
PY_STATUS=$?

assert_eq "$PY_STATUS" "0" "peer-credential helper pure protocol fixture exits successfully"
assert_contains "$PY_OUT" "strict_frames=true" "gateway rejects malformed and oversized frames"
assert_contains "$PY_OUT" "response_binding=true" "worker verifies the bounded gateway receipt"
assert_contains "$PY_OUT" "python_compatibility=true" "helper imports without host-specific package dependencies"

run_live_probe() {
  local unit="autopilot-p34-live-$$.service"
  local state_unit="autopilot-p34-state-$$.service"
  local runtime_parent="/run/autopilot-supervisor"
  local runtime_root="$runtime_parent/$unit"
  local socket_parent="$runtime_root/socket"
  local bin_dir="$runtime_root/bin"
  local helper="$bin_dir/supervised-host-peercred.py"
  local plan_json="$TEST_TMP/p34-live-plan.json"
  local negative_out="$TEST_TMP/p34-negative-gateway.out"
  local negative_err="$TEST_TMP/p34-negative-gateway.err"
  local positive_out="$TEST_TMP/p34-positive-gateway.out"
  local positive_err="$TEST_TMP/p34-positive-gateway.err"
  local negative_client_out="$TEST_TMP/p34-negative-client.out"
  local cgroup_out="$TEST_TMP/p34-cgroup-gateway.out"
  local cgroup_err="$TEST_TMP/p34-cgroup-gateway.err"
  local cgroup_client_out="$TEST_TMP/p34-cgroup-client.out"
  local worker_out="$TEST_TMP/p34-worker.out"
  local server_pid=""
  local created_parent=0

  live_cleanup() {
    if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
      kill "$server_pid" 2>/dev/null || true
      wait "$server_pid" 2>/dev/null || true
    fi
    sudo -n /usr/bin/systemctl stop "$unit" "$state_unit" 2>/dev/null || true
    sudo -n /usr/bin/systemctl reset-failed "$unit" "$state_unit" 2>/dev/null || true
    if sudo -n test -S "$socket_parent/worker.sock" 2>/dev/null; then
      sudo -n unlink "$socket_parent/worker.sock" 2>/dev/null || true
    fi
    sudo -n unlink "$helper" 2>/dev/null || true
    sudo -n rmdir "$socket_parent" 2>/dev/null || true
    sudo -n rmdir "$runtime_root/state" 2>/dev/null || true
    sudo -n rmdir "$bin_dir" 2>/dev/null || true
    sudo -n rmdir "$runtime_root" 2>/dev/null || true
    if [ "$created_parent" -eq 1 ]; then
      sudo -n rmdir "$runtime_parent" 2>/dev/null || true
    fi
  }

  restore_live_traps() {
    trap - INT TERM
    trap 'cleanup_test_tmp' EXIT
  }

  trap 'live_cleanup; cleanup_test_tmp' EXIT
  trap 'live_cleanup; exit 130' INT TERM

  if [ -e "$runtime_parent" ]; then
    fail "live probe refuses to modify an existing $runtime_parent"
    restore_live_traps
    return
  fi

  sudo -n install -d -o root -g root -m 0711 "$runtime_parent" || { fail "live probe cannot create root runtime parent"; restore_live_traps; return; }
  created_parent=1
  sudo -n install -d -o root -g nogroup -m 0710 "$runtime_root" || { fail "live probe cannot create isolated runtime root"; live_cleanup; restore_live_traps; return; }
  sudo -n install -d -o root -g root -m 0755 "$bin_dir" || { fail "live probe cannot create root snapshot directory"; live_cleanup; restore_live_traps; return; }
  sudo -n install -d -o root -g root -m 0700 "$runtime_root/state" || { fail "live probe cannot create private state directory"; live_cleanup; restore_live_traps; return; }
  sudo -n install -d -o "$(id -u)" -g nogroup -m 0710 "$socket_parent" || { fail "live probe cannot create broker socket directory"; live_cleanup; restore_live_traps; return; }
  sudo -n install -o root -g root -m 0755 "$REPO_ROOT/src/engine/supervised-host-peercred.py" "$helper" || { fail "live probe cannot install root-owned helper snapshot"; live_cleanup; restore_live_traps; return; }

  node - "$REPO_ROOT" "$runtime_root" "$helper" "$unit" "$(id -u)" "$(id -g)" "$(readlink -f /usr/bin/python3)" "$(readlink -f /usr/bin/systemd-run)" >"$plan_json" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, runtimeRoot, helperPath, unit, brokerUid, brokerGid, pythonPath, systemdRunPath] = process.argv.slice(2);
const host = require(path.join(root, 'src', 'engine', 'supervised-host-preflight'));
const { sha256 } = require(path.join(root, 'src', 'engine', 'owner-kernel'));
const nonce = 'p34-live-nonce';
const plan = host.compileSupervisedHostPreflight({
  schema_version: host.SUPERVISED_HOST_PREFLIGHT_SCHEMA_VERSION,
  run_id: 'p34-live-run',
  invocation_id: 'p34-live-invocation',
  plan_hash: 'a'.repeat(64),
  nonce_hash: sha256(nonce),
  service_unit: unit,
  broker: { identity: 'live-broker', uid: Number(brokerUid), gid: Number(brokerGid) },
  worker: { identity: host.SYSTEMD_WORKER_IDENTITY, uid: host.SYSTEMD_WORKER_UID, gid: host.SYSTEMD_WORKER_GID },
  runtime_root: runtimeRoot,
  helper_path: helperPath,
  python_path: pythonPath,
  systemd_run_path: systemdRunPath,
});
process.stdout.write(JSON.stringify({
  gateway: host.buildSupervisedHostGatewayArgs(plan),
  worker: host.buildSupervisedHostWorkerArgs(plan, nonce),
  systemd: host.buildSupervisedHostSystemdArgs(plan),
}));
NODE
  if [ $? -ne 0 ]; then
    fail "live probe cannot compile frozen runtime arguments"
    live_cleanup
    restore_live_traps
    return
  fi

  local -a gateway_args worker_args systemd_args state_args
  mapfile -t gateway_args < <(node - "$plan_json" <<'NODE'
const spec = require(process.argv[2]);
for (const value of spec.gateway) process.stdout.write(`${value}\n`);
NODE
)
  mapfile -t worker_args < <(node - "$plan_json" <<'NODE'
const spec = require(process.argv[2]);
for (const value of spec.worker) process.stdout.write(`${value}\n`);
NODE
)
  mapfile -t systemd_args < <(node - "$plan_json" <<'NODE'
const spec = require(process.argv[2]);
for (const value of spec.systemd) process.stdout.write(`${value}\n`);
NODE
)
  state_args=("${systemd_args[@]}")
  local i
  for i in "${!state_args[@]}"; do
    if [[ "${state_args[$i]}" == --unit=* ]]; then
      state_args[$i]="--unit=$state_unit"
    fi
  done

  start_gateway() {
    local out="$1"
    local err="$2"
    sudo -n setpriv --reset-env --nnp --reuid="$(id -u)" --regid="$(id -g)" --groups="$(id -g),65534" "${gateway_args[@]}" >"$out" 2>"$err" &
    server_pid=$!
    local ready=0
    local attempt
    for attempt in $(seq 1 120); do
      if [ -f "$out" ] && grep -q '"status":"ready"' "$out"; then
        ready=1
        break
      fi
      sleep 0.1
    done
    if [ "$ready" -ne 1 ]; then
      cat "$out" >&2
      cat "$err" >&2
      fail "gateway did not reach ready state"
      return 1
    fi
  }

  start_gateway "$negative_out" "$negative_err" || { live_cleanup; restore_live_traps; return; }
  sudo -n setpriv --reset-env --nnp --reuid="$(id -u)" --regid="$(id -g)" --groups="$(id -g),65534" "${worker_args[@]}" >"$negative_client_out" 2>&1
  local negative_client_status=$?
  wait "$server_pid"
  local negative_server_status=$?
  server_pid=""
  assert_neq "$negative_client_status" "0" "same-UID broker peer cannot enter worker gateway"
  assert_neq "$negative_server_status" "0" "gateway fails closed after unexpected peer"
  assert_contains "$(cat "$negative_out")" '"status":"peer_rejected"' "gateway rejects the broker UID before parsing a request"
  assert_contains "$(cat "$negative_out")" "\"uid\":$(id -u)" "negative peer observation reports broker UID"

  start_gateway "$cgroup_out" "$cgroup_err" || { live_cleanup; restore_live_traps; return; }
  sudo -n setpriv --reset-env --nnp --reuid=nobody --regid=nogroup --clear-groups "${worker_args[@]}" >"$cgroup_client_out" 2>&1
  local cgroup_client_status=$?
  wait "$server_pid"
  local cgroup_server_status=$?
  server_pid=""
  assert_neq "$cgroup_client_status" "0" "nobody peer outside the expected unit cannot enter the gateway"
  assert_neq "$cgroup_server_status" "0" "gateway fails closed after a cgroup mismatch"
  assert_contains "$(cat "$cgroup_out")" '"status":"peer_rejected"' "gateway rejects the correct UID/GID outside the expected cgroup"
  assert_contains "$(cat "$cgroup_out")" '"uid":65534' "cgroup negative control reached the frozen worker UID check"

  start_gateway "$positive_out" "$positive_err" || { live_cleanup; restore_live_traps; return; }
  sudo -n /usr/bin/systemd-run "${state_args[@]}" /usr/bin/test -r "$runtime_root/state" >"$TEST_TMP/p34-state.out" 2>&1
  local state_status=$?
  assert_neq "$state_status" "0" "systemd worker cannot read root-only state"

  sudo -n /usr/bin/systemd-run "${systemd_args[@]}" "${worker_args[@]}" >"$worker_out" 2>&1
  local worker_status=$?
  wait "$server_pid"
  local server_status=$?
  server_pid=""
  assert_eq "$worker_status" "0" "systemd nobody worker completes the single-use hello"
  assert_eq "$server_status" "0" "broker gateway accepts only the authenticated worker"
  assert_contains "$(cat "$worker_out")" '"uid":65534' "worker receipt carries the kernel-observed nobody UID"
  assert_contains "$(cat "$worker_out")" '"gid":65534' "worker receipt carries the kernel-observed nobody GID"
  assert_contains "$(cat "$positive_out")" '"status":"peer_accepted"' "gateway records the accepted peer credential"
  assert_contains "$(cat "$positive_out")" '"request_lifecycle":"single_use"' "gateway declares a one-shot endpoint"
  assert_eq "$(sudo -n stat -c '%u:%g:%a' "$runtime_root/state")" "0:0:700" "state remains root-only"
  assert_eq "$(sudo -n stat -c '%u:%g:%a' "$socket_parent")" "$(id -u):65534:710" "worker can traverse but not read or mutate the socket parent"
  assert_eq "$(sudo -n stat -c '%u:%g:%a' "$helper")" "0:0:755" "worker executes only a root-owned helper snapshot"
  local unit_load_state=""
  local state_unit_load_state=""
  for attempt in $(seq 1 30); do
    unit_load_state="$(sudo -n /usr/bin/systemctl show --property=LoadState --value "$unit" 2>/dev/null)"
    state_unit_load_state="$(sudo -n /usr/bin/systemctl show --property=LoadState --value "$state_unit" 2>/dev/null)"
    if [ "$unit_load_state" = "not-found" ] && [ "$state_unit_load_state" = "not-found" ]; then
      break
    fi
    sleep 0.1
  done
  assert_eq "$unit_load_state" "not-found" "successful transient systemd unit is collected"
  assert_eq "$state_unit_load_state" "not-found" "failed transient systemd unit is collected"
  live_cleanup
  restore_live_traps
  echo "live_cross_uid=true"
}

if [ "${AUTOPILOT_P34_LIVE:-0}" = "1" ]; then
  run_live_probe
else
  echo "live_cross_uid=skipped"
fi

finalize_test
