#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import importlib.util
import io
import os
import sys
import contextlib
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

root = sys.argv[1]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(root, "src", "engine", filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

helper = load("p34b_peercred", "supervised-host-peercred.py")
launcher = load("p34b_launcher", "supervised-host-launcher.py")
waiter = load("p34b_waiter", "supervised-host-worker-wait.py")

expected = "/system.slice/autopilot-p34-unit.service"
with patch("builtins.open", return_value=io.StringIO("0::" + expected + "\n")):
    assert helper.cgroup_matches(42, expected, require_unified_v2=True) is True
with patch("builtins.open", return_value=io.StringIO("1:name=systemd:" + expected + "\n")):
    assert helper.cgroup_matches(42, expected, require_unified_v2=True) is False
try:
    with contextlib.redirect_stderr(io.StringIO()):
        helper.require_cgroup_path(expected + "/child.service", "expected_cgroup_path")
    raise AssertionError("nested cgroup path was accepted")
except SystemExit:
    pass

material = launcher.installation_material(
    "/run/autopilot-p34b-test/install",
    {"uid": 1000, "gid": 1000},
    {"identity": launcher.WORKER_IDENTITY, "uid": 991, "gid": 991},
    {"python_path": "/usr/bin/python3.14", "setpriv_path": "/usr/bin/setpriv", "systemd_run_path": "/usr/bin/systemd-run", "systemctl_path": "/usr/bin/systemctl"},
    {name: {"relative_path": relative, "sha256": "a" * 64} for name, relative in launcher.FILE_LAYOUT.items()},
)
binding = launcher.sha256_value(material)
assert binding == launcher.sha256_value(material)
assert material["runtime_parent"] == launcher.RUNTIME_PARENT
assert launcher.WORKER_IDENTITY == "autopilot-worker"

try:
    with contextlib.redirect_stderr(io.StringIO()):
        launcher.parser().parse_args(["run", "--config", "/tmp/override.json"])
    raise AssertionError("run accepted an alternate config")
except SystemExit:
    pass

try:
    with contextlib.redirect_stderr(io.StringIO()):
        waiter.require_timeout(float("nan"))
    raise AssertionError("NaN timeout was accepted")
except SystemExit:
    pass

worker_account = SimpleNamespace(pw_name="autopilot-worker", pw_gid=991)
with patch.object(launcher.os, "getgrouplist", return_value=[991, 44]):
    try:
        launcher.require_private_worker_groups(worker_account)
        raise AssertionError("supplementary worker group was accepted")
    except launcher.LauncherError:
        pass

cleanup_commands = []
def cleanup_command(command, **_kwargs):
    cleanup_commands.append(command)
    return SimpleNamespace(returncode=1)

with patch.object(launcher, "run_command", side_effect=cleanup_command), patch.object(launcher, "wait_for_load_state") as wait_for_load_state:
    launcher.stop_and_collect_unit("/usr/bin/systemctl", "autopilot-p34-unit.service")
assert cleanup_commands == [
    ["/usr/bin/systemctl", "stop", "autopilot-p34-unit.service"],
    ["/usr/bin/systemctl", "reset-failed", "autopilot-p34-unit.service"],
]
wait_for_load_state.assert_called_once_with("/usr/bin/systemctl", "autopilot-p34-unit.service", "not-found", 5)

ambiguous_cleanup_units = []
synthetic_config = {"binding_hash": "b" * 64}
synthetic_validated = {
    "broker": {"uid": 1000, "gid": 1000},
    "worker": {"identity": launcher.WORKER_IDENTITY, "uid": 991, "gid": 991},
    "paths": {
        "python_path": "/usr/bin/python3",
        "setpriv_path": "/usr/bin/setpriv",
        "systemd_run_path": "/usr/bin/systemd-run",
        "systemctl_path": "/usr/bin/systemctl",
    },
    "files": {},
}
def ambiguous_systemd_response(*_args, **_kwargs):
    raise launcher.LauncherError("simulated ambiguous systemd response")
def record_ambiguous_cleanup(systemctl_path, unit):
    ambiguous_cleanup_units.append((systemctl_path, unit))

with patch.object(launcher, "require_root"), patch.object(launcher, "installed_root_from_self", return_value="/tmp/p34b-installed"), patch.object(launcher, "load_installed_config", return_value=synthetic_config), patch.object(launcher, "validate_installed_config", return_value=synthetic_validated), patch.object(launcher, "require_supported_host"), patch.object(launcher, "ensure_runtime_parent", return_value=True), patch.object(launcher, "create_directory"), patch.object(launcher, "run_command", side_effect=ambiguous_systemd_response), patch.object(launcher, "stop_and_collect_unit", side_effect=record_ambiguous_cleanup), patch.object(launcher, "cleanup_path"), patch.object(launcher.signal, "signal", side_effect=lambda *_args: None):
    try:
        launcher.run_probe()
        raise AssertionError("ambiguous systemd response did not fail")
    except launcher.LauncherError as error:
        assert "simulated ambiguous systemd response" in str(error)
assert len(ambiguous_cleanup_units) == 1
assert ambiguous_cleanup_units[0][0] == "/usr/bin/systemctl"
assert ambiguous_cleanup_units[0][1].startswith("autopilot-p34-")
assert ambiguous_cleanup_units[0][1].endswith(".service")

tracked_resources = {"runtime_root": False}
mask_operations = []
def record_mask(operation, signal_set):
    mask_operations.append((operation, signal_set))
    return {launcher.signal.SIGUSR1}
def fail_after_mkdir(mark_created):
    mark_created()
    raise OSError("simulated chmod failure after mkdir")
with patch.object(launcher.signal, "pthread_sigmask", side_effect=record_mask):
    try:
        launcher.create_tracked_resource(tracked_resources, "runtime_root", fail_after_mkdir)
        raise AssertionError("post-mkdir failure was accepted")
    except OSError:
        pass
assert tracked_resources["runtime_root"] is True
assert mask_operations[0][0] == launcher.signal.SIG_BLOCK
assert mask_operations[-1][0] == launcher.signal.SIG_SETMASK

with patch.object(launcher, "create_directory", side_effect=launcher.LauncherError("runtime parent already exists")):
    try:
        launcher.ensure_runtime_parent()
        raise AssertionError("shared runtime parent was accepted")
    except launcher.LauncherError:
        pass

with patch.object(launcher.sys, "platform", "darwin"):
    try:
        launcher.require_supported_host()
        raise AssertionError("unsupported host was accepted")
    except launcher.LauncherError:
        pass

with patch.object(waiter.os, "geteuid", return_value=991), patch.object(waiter.os, "getegid", return_value=991), patch.object(waiter.os, "getgroups", return_value=[991, 44]):
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            waiter.require_exact_worker_identity(991, 991)
        raise AssertionError("worker supplementary group set was accepted")
    except SystemExit:
        pass

with tempfile.TemporaryDirectory() as temporary_directory:
    release_path = os.path.join(temporary_directory, "worker-release")
    original_write_all = launcher.write_all
    def write_before_publish(descriptor, content):
        assert not os.path.lexists(release_path)
        original_write_all(descriptor, content)
    with patch.object(launcher, "write_all", side_effect=write_before_publish), patch.object(launcher.os, "fchown"):
        launcher.create_release_file(release_path, "release-token", 991)
    with open(release_path, encoding="ascii") as release_file:
        assert release_file.read() == "release-token\n"

source = open(os.path.join(root, "src", "engine", "supervised-host-launcher.py"), encoding="utf-8").read()
helper_source = open(os.path.join(root, "src", "engine", "supervised-host-peercred.py"), encoding="utf-8").read()
assert "shell=True" not in source
assert "owner-kernel" not in source
assert "mintActionDecision" not in source
assert "--expected-pid" in source
assert "--require-unified-cgroup-v2" in source
assert "server_peer_identity_mismatch" in helper_source
assert source.index("require_supported_host()") < source.index("create_tracked_resource(created_resources, \"parent\"")
assert source.index("unit_may_exist = True") < source.index("started = run_command(systemd_command")
assert source.index("release_may_exist = True") < source.index("create_release_file(release_path")
assert "--release-timeout-seconds" in source
assert "create_tracked_resource" in source
assert "require_exact_worker_identity" in open(os.path.join(root, "src", "engine", "supervised-host-worker-wait.py"), encoding="utf-8").read()

print("strict_installed_config=true")
print("exact_pid_cgroup_v2=true")
print("no_override_surface=true")
print("no_owner_kernel_authority=true")
print("worker_group_drift_rejected=true")
print("failure_cleanup_waits_for_collection=true")
print("runtime_parent_is_exclusive=true")
print("unsupported_host_rejected_before_runtime=true")
print("worker_runtime_group_drift_rejected=true")
print("release_published_after_complete_write=true")
print("ambiguous_launch_cleanup_is_armed=true")
print("ambiguous_launch_fault_is_collected=true")
print("post_mkdir_interrupt_cleanup_is_armed=true")
print("release_and_protocol_budgets_are_separate=true")
PY
)"
PY_STATUS=$?

assert_eq "$PY_STATUS" "0" "P3.4b launcher deterministic fixture exits successfully"
assert_contains "$PY_OUT" "strict_installed_config=true" "installer binding material is deterministic and fixed"
assert_contains "$PY_OUT" "exact_pid_cgroup_v2=true" "peer helper can require exact PID-compatible unified cgroup evidence"
assert_contains "$PY_OUT" "no_override_surface=true" "installed run does not accept alternate config input"
assert_contains "$PY_OUT" "no_owner_kernel_authority=true" "launcher source remains outside Owner Kernel authority"
assert_contains "$PY_OUT" "worker_group_drift_rejected=true" "worker supplementary-group drift fails closed"
assert_contains "$PY_OUT" "failure_cleanup_waits_for_collection=true" "failure cleanup waits for the exact transient unit to unload"
assert_contains "$PY_OUT" "runtime_parent_is_exclusive=true" "a pre-existing runtime parent blocks an overlapping launcher"
assert_contains "$PY_OUT" "unsupported_host_rejected_before_runtime=true" "unsupported host state is rejected before runtime creation"
assert_contains "$PY_OUT" "worker_runtime_group_drift_rejected=true" "worker runtime supplementary groups fail closed"
assert_contains "$PY_OUT" "release_published_after_complete_write=true" "worker release publication hides incomplete token bytes"
assert_contains "$PY_OUT" "ambiguous_launch_cleanup_is_armed=true" "cleanup is armed before an ambiguous systemd launch result"
assert_contains "$PY_OUT" "ambiguous_launch_fault_is_collected=true" "an ambiguous systemd launch fault still collects its generated unit"
assert_contains "$PY_OUT" "post_mkdir_interrupt_cleanup_is_armed=true" "a post-mkdir interruption still records cleanup ownership"
assert_contains "$PY_OUT" "release_and_protocol_budgets_are_separate=true" "worker release staging has a bounded independent budget"

run_live_launcher_probe() {
  local live_parent="/run/autopilot-p34b-live-$$"
  local install_root="$live_parent/install"
  local stage_root="$TEST_TMP/p34b-stage"
  local run_out="$TEST_TMP/p34b-run.out"
  local run_err="$TEST_TMP/p34b-run.err"
  local install_out="$TEST_TMP/p34b-install.out"
  local install_err="$TEST_TMP/p34b-install.err"
  local override_out="$TEST_TMP/p34b-override.out"
  local override_err="$TEST_TMP/p34b-override.err"
  local source_helper_hash=""
  local installed_helper_hash=""
  local service_unit=""
  local live_parent_created=0

  live_cleanup() {
    if [ -n "$service_unit" ]; then
      sudo -n /usr/bin/systemctl stop "$service_unit" 2>/dev/null || true
      sudo -n /usr/bin/systemctl reset-failed "$service_unit" 2>/dev/null || true
    fi
    sudo -n unlink "$install_root/etc/supervised-host.json" 2>/dev/null || true
    sudo -n unlink "$install_root/sbin/supervised-host-launcher.py" 2>/dev/null || true
    sudo -n unlink "$install_root/lib/supervised-host-peercred.py" 2>/dev/null || true
    sudo -n unlink "$install_root/lib/supervised-host-worker-wait.py" 2>/dev/null || true
    sudo -n rmdir "$install_root/etc" 2>/dev/null || true
    sudo -n rmdir "$install_root/sbin" 2>/dev/null || true
    sudo -n rmdir "$install_root/lib" 2>/dev/null || true
    sudo -n rmdir "$install_root" 2>/dev/null || true
    if [ "$live_parent_created" -eq 1 ]; then
      sudo -n rmdir "$live_parent" 2>/dev/null || true
    fi
  }

  restore_live_traps() {
    trap - INT TERM
    trap 'cleanup_test_tmp' EXIT
  }

  trap 'live_cleanup; cleanup_test_tmp' EXIT
  trap 'live_cleanup; exit 130' INT TERM

  if [ -e "$live_parent" ] || [ -e /run/autopilot-supervisor ]; then
    fail "P3.4b live probe refuses an existing runtime root"
    restore_live_traps
    return
  fi

  mkdir -p "$stage_root" || { fail "cannot create user-writable staging root"; restore_live_traps; return; }
  cp "$REPO_ROOT/src/engine/supervised-host-launcher.py" "$stage_root/supervised-host-launcher.py" || { fail "cannot stage launcher source"; restore_live_traps; return; }
  cp "$REPO_ROOT/src/engine/supervised-host-peercred.py" "$stage_root/supervised-host-peercred.py" || { fail "cannot stage peer helper source"; restore_live_traps; return; }
  cp "$REPO_ROOT/src/engine/supervised-host-worker-wait.py" "$stage_root/supervised-host-worker-wait.py" || { fail "cannot stage wait wrapper source"; restore_live_traps; return; }
  chmod 0755 "$stage_root"/*.py
  sudo -n install -d -o root -g root -m 0711 "$live_parent" || { fail "cannot create root-owned live install parent"; restore_live_traps; return; }
  live_parent_created=1

  sudo -n /usr/bin/python3 -I "$stage_root/supervised-host-launcher.py" install \
    --install-root "$install_root" \
    --broker-uid "$(id -u)" \
    --broker-gid "$(id -g)" \
    --create-worker >"$install_out" 2>"$install_err"
  local install_status=$?
  assert_eq "$install_status" "0" "root installer creates a dedicated worker snapshot"
  assert_contains "$(cat "$install_out")" '"status":"installed"' "installer reports a bounded snapshot result"
  assert_eq "$(sudo -n stat -c '%u:%g:%a' "$install_root/sbin/supervised-host-launcher.py")" "0:0:755" "installed launcher is root-owned and executable"
  assert_eq "$(sudo -n stat -c '%u:%g:%a' "$install_root/etc/supervised-host.json")" "0:0:644" "installed config is root-owned and immutable to worker"

  installed_helper_hash="$(sudo -n sha256sum "$install_root/lib/supervised-host-peercred.py" | awk '{print $1}')"
  printf '\n# user-writable staging mutation after installation\n' >> "$stage_root/supervised-host-peercred.py"
  source_helper_hash="$(sha256sum "$stage_root/supervised-host-peercred.py" | awk '{print $1}')"
  assert_neq "$source_helper_hash" "$installed_helper_hash" "staged source mutation differs from frozen installed helper"
  assert_eq "$(sudo -n sha256sum "$install_root/lib/supervised-host-peercred.py" | awk '{print $1}')" "$installed_helper_hash" "installed helper is unaffected by user staging mutation"

  /usr/bin/python3 -I "$install_root/sbin/supervised-host-launcher.py" run >"$TEST_TMP/p34b-nonroot.out" 2>"$TEST_TMP/p34b-nonroot.err"
  local nonroot_status=$?
  assert_neq "$nonroot_status" "0" "installed launcher refuses a non-root caller"
  assert_contains "$(cat "$TEST_TMP/p34b-nonroot.err")" "requires effective UID/GID 0" "non-root launch is rejected before runtime setup"

  sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-host-launcher.py" run --config "$TEST_TMP/override.json" >"$override_out" 2>"$override_err"
  local override_status=$?
  assert_neq "$override_status" "0" "installed launcher rejects alternate config arguments"
  assert_contains "$(cat "$override_err")" "unrecognized arguments" "installed launcher has no config override surface"

  sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-host-launcher.py" run >"$run_out" 2>"$run_err"
  local run_status=$?
  assert_eq "$run_status" "0" "installed root launcher completes the bounded cross-UID probe"
  if [ "$run_status" != "0" ]; then
    cat "$run_err" >&2
    live_cleanup
    restore_live_traps
    return
  fi
  assert_contains "$(cat "$run_out")" '"status":"p34b_probe_complete"' "installed launcher emits a non-authoritative probe receipt"
  service_unit="$(node - "$run_out" "$(id -u autopilot-worker)" "$(id -g autopilot-worker)" <<'NODE'
const fs = require('fs');
const [outputPath, workerUid, workerGid] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
if (receipt.owner_kernel_authority !== 'none' || receipt.acceptance !== 'not_available') process.exit(2);
if (!/^autopilot-p34-[A-Za-z0-9_-]+\.service$/.test(receipt.service_unit)) process.exit(3);
if (!Number.isInteger(receipt.peer.pid) || receipt.peer.pid <= 0) process.exit(4);
if (receipt.peer.uid !== Number(workerUid) || receipt.peer.gid !== Number(workerGid)) process.exit(5);
process.stdout.write(receipt.service_unit);
NODE
)"
  local receipt_parse_status=$?
  assert_eq "$receipt_parse_status" "0" "launcher receipt binds a bounded service unit and peer PID"
  if [ "$receipt_parse_status" != "0" ]; then
    live_cleanup
    restore_live_traps
    return
  fi
  assert_contains "$(cat "$run_out")" "\"uid\":$(id -u)" "launcher starts its gateway under the configured broker identity"
  assert_contains "$(cat "$run_out")" '"owner_kernel_authority":"none"' "P3.4b receipt remains non-authoritative"
  assert_eq "$(sudo -n /usr/bin/systemctl show --property=LoadState --value "$service_unit")" "not-found" "successful P3.4b transient unit is collected"
  assert_file_absent /run/autopilot-supervisor "P3.4b launcher removes its unique runtime parent"
  assert_contains "$(getent passwd autopilot-worker)" "autopilot-worker" "dedicated non-login worker provisioning is persistent host state"

  sudo -n /usr/bin/python3 -I - "$install_root/etc/supervised-host.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as source:
    value = json.load(source)
value["broker"]["uid"] += 1
with open(path, "w", encoding="utf-8") as destination:
    json.dump(value, destination, sort_keys=True, separators=(",", ":"))
    destination.write("\n")
PY
  local tampered_config_status=$?
  assert_eq "$tampered_config_status" "0" "test can introduce a root-side config mutation after the successful run"
  sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-host-launcher.py" run >"$TEST_TMP/p34b-tampered.out" 2>"$TEST_TMP/p34b-tampered.err"
  local tampered_run_status=$?
  assert_neq "$tampered_run_status" "0" "installed launcher rejects a config binding mismatch before child setup"
  assert_contains "$(cat "$TEST_TMP/p34b-tampered.err")" "binding_hash does not match content" "config hash mismatch is explicit and fail-closed"
  assert_file_absent /run/autopilot-supervisor "tampered config cannot create a runtime parent"

  live_cleanup
  restore_live_traps
  echo "live_root_launcher=true"
}

if [ "${AUTOPILOT_P34B_LIVE:-0}" = "1" ]; then
  run_live_launcher_probe
else
  echo "live_root_launcher=skipped"
fi

finalize_test
