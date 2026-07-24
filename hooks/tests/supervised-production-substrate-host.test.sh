#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import contextlib
import importlib.util
import io
import json
import os
import shutil
import stat
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

root = sys.argv[1]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(root, "src", "engine", filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

host = load("p36_host", "supervised-production-substrate-host.py")
runner = load("p36_runner", "supervised-production-substrate-service.py")

assert host.SERVICE_ROLES == ("worker", "broker", "receipt_verifier", "witness", "coordinator")
assert len(set(host.SERVICE_IDENTITIES.values())) == len(host.SERVICE_ROLES)
assert host.identity_attestation("worker", "worker-id", 1001, 1001) != host.identity_attestation("broker", "worker-id", 1001, 1001)
assert host.role_paths("/run/p36", "worker") == {
    "root": "/run/p36/worker",
    "release": "/run/p36/worker/release",
    "ack_root": "/run/p36/worker/ack",
    "ack": "/run/p36/worker/ack/release.json",
    "ack_pending": "/run/p36/worker/ack/release.json.pending",
}

expected_cgroup = "/system.slice/autopilot-p36-worker-test.service"
with patch("builtins.open", return_value=io.StringIO("0::" + expected_cgroup + "\n")):
    assert host.cgroup_v2_matches(42, expected_cgroup) is True
with patch("builtins.open", return_value=io.StringIO("0::" + expected_cgroup + "/nested\n")):
    assert host.cgroup_v2_matches(42, expected_cgroup) is False
identity_service = {"uid": 991, "gid": 991}
status_exact = "Uid:\t991\t991\t991\t991\nGid:\t991\t991\t991\t991\nGroups:\t991\n"
with patch("builtins.open", return_value=io.StringIO(status_exact)):
    assert host.process_identity_matches(42, identity_service) is True
status_drift = "Uid:\t991\t991\t991\t991\nGid:\t991\t991\t991\t991\nGroups:\t991 44\n"
with patch("builtins.open", return_value=io.StringIO(status_drift)):
    assert host.process_identity_matches(42, identity_service) is False

try:
    with contextlib.redirect_stderr(io.StringIO()):
        host.parser().parse_args(["run-probe", "--config", "/tmp/override.json"])
    raise AssertionError("run-probe accepted an alternate config")
except SystemExit:
    pass
try:
    with contextlib.redirect_stderr(io.StringIO()):
        host.parser().parse_args(["run-probe", "--node-path", "/tmp/override-node"])
    raise AssertionError("run-probe accepted an alternate node path")
except SystemExit:
    pass

try:
    with contextlib.redirect_stderr(io.StringIO()):
        runner.require_timeout(float("nan"), "timeout")
    raise AssertionError("runner accepted NaN timeout")
except SystemExit:
    pass

private_account = SimpleNamespace(pw_name="autopilot-p36-worker", pw_gid=991)
with patch.object(host.os, "getgrouplist", return_value=[991, 44]):
    try:
        host.require_private_groups(private_account)
        raise AssertionError("supplementary service group was accepted")
    except host.SubstrateHostError:
        pass

with patch.object(runner.os, "geteuid", return_value=991), patch.object(runner.os, "getegid", return_value=991), patch.object(runner.os, "getgroups", return_value=[991, 44]):
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            runner.require_exact_identity(991, 991)
        raise AssertionError("runner accepted supplementary group drift")
    except SystemExit:
        pass

services = {
    role: {
        "role": role,
        "identity": host.SERVICE_IDENTITIES[role],
        "uid": 71000 + index,
        "gid": 72000 + index,
        "attestation_hash": host.identity_attestation(role, host.SERVICE_IDENTITIES[role], 71000 + index, 72000 + index),
    }
    for index, role in enumerate(host.SERVICE_ROLES, 1)
}
paths = {
    "python_path": "/usr/bin/python3",
    "node_path": "/usr/bin/node",
    "systemd_run_path": "/usr/bin/systemd-run",
    "systemctl_path": "/usr/bin/systemctl",
}
files = {
    name: {"relative_path": relative, "sha256": (str(index) * 64)[:64]}
    for index, (name, relative) in enumerate(host.FILE_LAYOUT.items(), 1)
}
abi_hash = "a" * 64
material = host.installation_material("/tmp/p36-installed", services, paths, files, abi_hash)
assert material["owner_kernel_authority"] == "none"
assert material["effect_authority"] == "none"
assert material["acceptance"] == "not_available"
config = dict(material)
config["binding_hash"] = host.sha256_value(material)

with patch.object(host, "resolve_service_identity", side_effect=lambda role, create: services[role]), patch.object(host, "require_root_owned_path", side_effect=lambda path, *_args, **_kwargs: path), patch.object(host, "require_service_traversable_root_path", side_effect=lambda path, *_args, **_kwargs: path), patch.object(host, "file_digest", side_effect=lambda path: next(entry["sha256"] for entry in files.values() if path.endswith(entry["relative_path"]))), patch.object(host, "installed_contract_abi", return_value=abi_hash):
    validated = host.validate_installed_config("/tmp/p36-installed", config)
assert validated["services"] == services
assert validated["substrate_abi_hash"] == abi_hash

duplicate_services = json.loads(json.dumps(services))
duplicate_services["broker"]["uid"] = duplicate_services["worker"]["uid"]
duplicate_config = dict(config)
duplicate_config["services"] = duplicate_services
with patch.object(host, "resolve_service_identity", side_effect=lambda role, create: duplicate_services[role]), patch.object(host, "require_root_owned_path", side_effect=lambda path, *_args, **_kwargs: path), patch.object(host, "require_service_traversable_root_path", side_effect=lambda path, *_args, **_kwargs: path), patch.object(host, "file_digest", side_effect=lambda path: next(entry["sha256"] for entry in files.values() if path.endswith(entry["relative_path"]))), patch.object(host, "installed_contract_abi", return_value=abi_hash):
    try:
        host.validate_installed_config("/tmp/p36-installed", duplicate_config)
        raise AssertionError("duplicate service UID was accepted")
    except host.SubstrateHostError:
        pass

with tempfile.TemporaryDirectory() as temporary_directory:
    snapshot_root = os.path.join(temporary_directory, "snapshot")
    source_root = os.path.join(root, "src", "engine")
    sources = host.snapshot_sources(source_root)
    assert set(sources) == set(host.FILE_LAYOUT)
    for name, relative in host.FILE_LAYOUT.items():
        destination = os.path.join(snapshot_root, relative)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copyfile(sources[name], destination)
    node_path = shutil.which("node")
    assert node_path is not None, "Node.js is required to load the P3.6 contract fixture"
    loaded_abi_hash = host.installed_contract_abi(
        node_path, os.path.join(snapshot_root, host.FILE_LAYOUT["contract"])
    )
    assert len(loaded_abi_hash) == 64

partial_cleanup_roots = []
install_args = SimpleNamespace(
    install_root="/tmp/p36-partial-install-fixture",
    create_identities=False,
    node_path=None,
)
with patch.object(host, "require_root"), patch.object(host, "resolve_service_identities", return_value=services), patch.object(host.os.path, "exists", return_value=False), patch.object(host, "require_root_owned_path", side_effect=lambda path, *_args, **_kwargs: path), patch.object(host, "install_interrupt_handlers", return_value={}), patch.object(host, "restore_interrupt_handlers"), patch.object(host, "create_directory", side_effect=lambda _path, _uid, _gid, _mode, _label, on_created=None: on_created() if on_created else None), patch.object(host, "copy_root_snapshot_file", side_effect=host.SubstrateHostError("simulated snapshot failure")), patch.object(host, "cleanup_partial_install", side_effect=lambda path: partial_cleanup_roots.append(path) or []):
    try:
        host.install(install_args)
        raise AssertionError("partial installation failure was accepted")
    except host.SubstrateHostError as error:
        assert "simulated snapshot failure" in str(error)
assert partial_cleanup_roots == [install_args.install_root]

interrupted_cleanup_roots = []
with patch.object(host, "require_root"), patch.object(host, "resolve_service_identities", return_value=services), patch.object(host.os.path, "exists", return_value=False), patch.object(host, "require_root_owned_path", side_effect=lambda path, *_args, **_kwargs: path), patch.object(host, "install_interrupt_handlers", return_value={}), patch.object(host, "restore_interrupt_handlers"), patch.object(host, "create_directory", side_effect=lambda _path, _uid, _gid, _mode, _label, on_created=None: on_created() if on_created else None), patch.object(host, "copy_root_snapshot_file", side_effect=KeyboardInterrupt()), patch.object(host, "cleanup_partial_install", side_effect=lambda path: interrupted_cleanup_roots.append(path) or []):
    try:
        host.install(install_args)
        raise AssertionError("interrupted partial installation was accepted")
    except host.SubstrateHostError as error:
        assert "interrupted" in str(error)
assert interrupted_cleanup_roots == [install_args.install_root]

with tempfile.TemporaryDirectory() as temporary_directory:
    release_path = os.path.join(temporary_directory, "release")
    original_write_all = host.write_all
    def write_before_publish(descriptor, content):
        assert not os.path.lexists(release_path)
        original_write_all(descriptor, content)
    with patch.object(host, "write_all", side_effect=write_before_publish), patch.object(host.os, "fchown"):
        host.create_release_file(release_path, "release-token", 991)
    with open(release_path, encoding="ascii") as source:
        assert source.read() == "release-token\n"

with tempfile.TemporaryDirectory() as temporary_directory:
    ack_path = os.path.join(temporary_directory, "ack.json")
    current_uid = os.geteuid()
    current_gid = os.getegid()
    service = {"role": "worker", "uid": current_uid, "gid": current_gid}
    ack_args = SimpleNamespace(
        role="worker",
        ack_path=ack_path,
        release_token="release-token",
        expected_uid=current_uid,
        expected_gid=current_gid,
        install_binding_hash="b" * 64,
        run_binding_hash="c" * 64,
        substrate_abi_hash="d" * 64,
    )
    original_runner_write = runner.os.write
    def write_pending_before_publication(descriptor, content):
        assert not os.path.lexists(ack_path)
        return original_runner_write(descriptor, content)
    with patch.object(runner.os, "write", side_effect=write_pending_before_publication):
        runner.write_ack(ack_args)
    assert not os.path.lexists(ack_path + ".pending")
    parsed = host.read_release_ack(ack_path, service, "b" * 64, "c" * 64, "d" * 64)
    assert parsed["release_hash"] == host.sha256_value("release-token")

systemd_mainpid = SimpleNamespace(returncode=0, stdout="4242\n")
with patch.object(host, "run_command", return_value=systemd_mainpid), patch.object(host, "cgroup_v2_matches", return_value=True), patch.object(host, "process_identity_matches", return_value=True):
    host.verify_ack_service_process("/usr/bin/systemctl", "p36.service", "/system.slice/p36.service", {"uid": 991, "gid": 991}, 4242)
with patch.object(host, "run_command", return_value=SimpleNamespace(returncode=0, stdout="4243\n")):
    try:
        host.verify_ack_service_process("/usr/bin/systemctl", "p36.service", "/system.slice/p36.service", {"uid": 991, "gid": 991}, 4242)
        raise AssertionError("ack accepted a changed systemd MainPID")
    except host.SubstrateHostError:
        pass
with patch.object(host, "run_command", return_value=systemd_mainpid), patch.object(host, "cgroup_v2_matches", return_value=False):
    try:
        host.verify_ack_service_process("/usr/bin/systemctl", "p36.service", "/system.slice/p36.service", {"uid": 991, "gid": 991}, 4242)
        raise AssertionError("ack accepted a cgroup drift after publication")
    except host.SubstrateHostError:
        pass

cleanup_units = []
systemd_commands = []
synthetic_config = {"binding_hash": "b" * 64}
synthetic_validated = {
    "services": services,
    "paths": paths,
    "files": {},
    "substrate_abi_hash": abi_hash,
}
def mark_created(resources, key, creator):
    creator(lambda: resources.__setitem__(key, True))
def harmless_directory(*args, **kwargs):
    on_created = kwargs.get("on_created")
    if on_created is None and len(args) >= 6:
        on_created = args[5]
    if on_created is not None:
        on_created()
def marked_runtime_parent(on_created=None):
    if on_created is not None:
        on_created()
    return True
def ambiguous_systemd(*_args, **_kwargs):
    systemd_commands.append(_args[0])
    raise host.SubstrateHostError("simulated ambiguous systemd response")
def record_cleanup(systemctl_path, unit):
    cleanup_units.append((systemctl_path, unit))

with patch.object(host, "require_root"), patch.object(host, "installed_root_from_self", return_value="/tmp/p36-installed"), patch.object(host, "load_installed_config", return_value=synthetic_config), patch.object(host, "validate_installed_config", return_value=synthetic_validated), patch.object(host, "require_supported_host"), patch.object(host, "create_tracked_resource", side_effect=mark_created), patch.object(host, "ensure_runtime_parent", side_effect=marked_runtime_parent), patch.object(host, "create_directory", side_effect=harmless_directory), patch.object(host, "run_command", side_effect=ambiguous_systemd), patch.object(host, "stop_and_collect_unit", side_effect=record_cleanup), patch.object(host, "cleanup_path"), patch.object(host.signal, "signal", side_effect=lambda *_args: None):
    try:
        host.run_probe()
        raise AssertionError("ambiguous systemd response did not fail")
    except host.SubstrateHostError as error:
        assert "simulated ambiguous systemd response" in str(error)
assert len(cleanup_units) == 1
assert cleanup_units[0][0] == paths["systemctl_path"]
assert cleanup_units[0][1].startswith("autopilot-p36-worker-")
assert cleanup_units[0][1].endswith(".service")
assert any(argument.startswith("--property=ReadWritePaths=/run/autopilot-production-substrate/p36-") and argument.endswith("/worker/ack") for argument in systemd_commands[0])

second_interrupt_cleanup_labels = []
second_interrupt_sent = [False]
def interrupt_between_cleanup_callbacks(_errors, label, callback):
    callback()
    second_interrupt_cleanup_labels.append(label)
    if not second_interrupt_sent[0]:
        second_interrupt_sent[0] = True
        os.kill(os.getpid(), host.signal.SIGINT)

previous_termination_mask = host.signal.pthread_sigmask(
    host.signal.SIG_UNBLOCK, set(host.TERMINATION_SIGNALS)
)
previous_sigint_handler = host.signal.getsignal(host.signal.SIGINT)
def deliver_test_interrupt(_signum, _frame):
    raise KeyboardInterrupt
host.signal.signal(host.signal.SIGINT, deliver_test_interrupt)
try:
    with patch.object(host, "require_root"), patch.object(host, "installed_root_from_self", return_value="/tmp/p36-installed"), patch.object(host, "load_installed_config", return_value=synthetic_config), patch.object(host, "validate_installed_config", return_value=synthetic_validated), patch.object(host, "require_supported_host"), patch.object(host, "create_tracked_resource", side_effect=mark_created), patch.object(host, "ensure_runtime_parent", side_effect=marked_runtime_parent), patch.object(host, "create_directory", side_effect=harmless_directory), patch.object(host, "run_command", side_effect=ambiguous_systemd), patch.object(host, "stop_and_collect_unit"), patch.object(host, "cleanup_path"), patch.object(host, "append_cleanup_error", side_effect=interrupt_between_cleanup_callbacks):
        try:
            host.run_probe()
            raise AssertionError("second cleanup interrupt did not reach the caller")
        except KeyboardInterrupt:
            pass
finally:
    host.signal.signal(host.signal.SIGINT, previous_sigint_handler)
    host.signal.pthread_sigmask(host.signal.SIG_SETMASK, previous_termination_mask)
assert second_interrupt_sent == [True]
assert second_interrupt_cleanup_labels[0] == "worker systemd unit"
assert "coordinator acknowledgement root" in second_interrupt_cleanup_labels
assert "worker runtime root" in second_interrupt_cleanup_labels
assert second_interrupt_cleanup_labels[-2:] == ["runtime root", "runtime parent"]

source = open(os.path.join(root, "src", "engine", "supervised-production-substrate-host.py"), encoding="utf-8").read()
runner_source = open(os.path.join(root, "src", "engine", "supervised-production-substrate-service.py"), encoding="utf-8").read()
assert "shell=True" not in source
assert "AutopilotEngine" not in source
assert "mintActionDecision" not in source
assert "executeAuthorizedAction" not in source
assert "--config" not in source
assert source.index('unit["may_exist"] = True') < source.index("started = run_command(systemd_command")
assert "released_no_effect" in runner_source
assert "require_exact_identity" in runner_source
assert "wait_for_release" in runner_source

print("five_independent_identities=true")
print("no_runtime_override_surface=true")
print("snapshot_abi_and_authority_binding=true")
print("snapshot_contract_dependency_closure_loads=true")
print("identity_and_group_drift_rejected=true")
print("exact_pid_identity_cgroup_v2=true")
print("duplicate_identity_axes_rejected=true")
print("release_published_after_complete_write=true")
print("role_ack_is_canonical_and_bound=true")
print("role_ack_published_after_complete_write=true")
print("ack_mainpid_cgroup_revalidated=true")
print("ambiguous_launch_cleanup_is_armed=true")
print("second_interrupt_cleanup_is_masked=true")
print("role_ack_writable_path_is_pinned=true")
print("partial_install_cleanup_is_armed=true")
print("interruptible_install_cleanup_is_armed=true")
print("no_effect_runtime_surface=true")
PY
)"
PY_STATUS=$?

assert_eq "$PY_STATUS" "0" "P3.6 Phase 2 substrate host deterministic fixture exits successfully"
assert_contains "$PY_OUT" "five_independent_identities=true" "five fixed service identities are present and disjoint"
assert_contains "$PY_OUT" "no_runtime_override_surface=true" "installed run-probe has no caller config override"
assert_contains "$PY_OUT" "snapshot_abi_and_authority_binding=true" "installed snapshot binds ABI and no-authority disclosures"
assert_contains "$PY_OUT" "snapshot_contract_dependency_closure_loads=true" "installed snapshot contains the P3.6 contract dependency closure"
assert_contains "$PY_OUT" "identity_and_group_drift_rejected=true" "private-group identity drift fails closed"
assert_contains "$PY_OUT" "exact_pid_identity_cgroup_v2=true" "service PID must retain exact identity and unified cgroup-v2 binding"
assert_contains "$PY_OUT" "duplicate_identity_axes_rejected=true" "duplicate service identity axes fail closed"
assert_contains "$PY_OUT" "release_published_after_complete_write=true" "role release is atomically published after its full content"
assert_contains "$PY_OUT" "role_ack_is_canonical_and_bound=true" "role acknowledgement is canonical and binds its frozen run"
assert_contains "$PY_OUT" "role_ack_published_after_complete_write=true" "role acknowledgement is atomically published after its full content"
assert_contains "$PY_OUT" "ack_mainpid_cgroup_revalidated=true" "acknowledgement revalidates systemd MainPID and cgroup binding"
assert_contains "$PY_OUT" "ambiguous_launch_cleanup_is_armed=true" "ambiguous systemd launch still collects its possible unit"
assert_contains "$PY_OUT" "second_interrupt_cleanup_is_masked=true" "a second interruption cannot truncate substrate cleanup"
assert_contains "$PY_OUT" "role_ack_writable_path_is_pinned=true" "systemd strict filesystem policy grants only the role acknowledgement root"
assert_contains "$PY_OUT" "partial_install_cleanup_is_armed=true" "failed installation cleans its partial immutable snapshot"
assert_contains "$PY_OUT" "interruptible_install_cleanup_is_armed=true" "interrupted installation cleans its partial immutable snapshot"
assert_contains "$PY_OUT" "no_effect_runtime_surface=true" "P3.6 Phase 2 source has no Engine or action authority surface"

finalize_test
