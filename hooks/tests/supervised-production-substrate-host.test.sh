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
peer = load("p36_peer", "supervised_production_substrate_peer.py")

assert host.SERVICE_ROLES == ("worker", "broker", "receipt_verifier", "witness", "coordinator")
assert len(set(host.SERVICE_IDENTITIES.values())) == len(host.SERVICE_ROLES)
assert host.identity_attestation("worker", "worker-id", 1001, 1001) != host.identity_attestation("broker", "worker-id", 1001, 1001)
assert host.role_paths("/run/p36", "worker") == {
    "root": "/run/p36/worker",
    "release": "/run/p36/worker/release",
    "bootstrap": "/run/p36/worker/bootstrap.json",
    "peer_config": "/run/p36/worker/peer.json",
    "ack_root": "/run/p36/worker/ack",
    "ready": "/run/p36/worker/ack/listeners.json",
    "ready_pending": "/run/p36/worker/ack/listeners.json.pending",
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

pid_timeout_values = []
def record_pid_timeout(_command, timeout_seconds):
    pid_timeout_values.append(timeout_seconds)
    return SimpleNamespace(returncode=0, stdout="")
with patch.object(host.time, "monotonic", side_effect=[0, 4.5, 5]), patch.object(
    host.time, "sleep"
), patch.object(host, "run_command", side_effect=record_pid_timeout):
    try:
        host.wait_for_service_pid(
            "/usr/bin/systemctl",
            "p36.service",
            "/system.slice/p36.service",
            identity_service,
            5,
        )
        raise AssertionError("PID wait unexpectedly succeeded")
    except host.SubstrateHostError:
        pass
assert pid_timeout_values == [0.5]

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
        peer.require_timeout(float("nan"), "timeout")
    raise AssertionError("runner accepted NaN timeout")
except peer.PeerProtocolError:
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

runtime_fixture = "/run/autopilot-production-substrate/p36-0123456789abcdef01234567"
endpoint_specs = host.endpoint_static_specs(runtime_fixture, peer, services)
assert tuple(spec["endpoint"]["endpoint_id"] for spec in endpoint_specs) == (
    "worker_broker",
    "receipt_verifier_coordinator",
    "receipt_verifier_witness_append",
    "coordinator_witness_read",
)
assert all(len(spec["socket_path"].encode("ascii")) <= peer.MAX_UNIX_SOCKET_PATH_BYTES for spec in endpoint_specs)
assert endpoint_specs[0]["socket_path"].endswith("/i/worker_broker/s")
pre_release_budget = (
    len(host.SERVICE_ROLES) * host.SYSTEMD_LAUNCH_TIMEOUT_SECONDS
    + len(host.SERVICE_ROLES) * host.ROLE_STARTUP_TIMEOUT_SECONDS * 2
    + len(endpoint_specs) * host.ROLE_STARTUP_TIMEOUT_SECONDS
    + len(host.SERVICE_ROLES) * host.SYSTEMD_INSPECTION_TIMEOUT_SECONDS
)
assert host.ROLE_RELEASE_TIMEOUT_SECONDS >= pre_release_budget + 20
runtime_max_seconds = int(
    next(value for value in host.SYSTEMD_PROPERTIES if value.startswith("RuntimeMaxSec=")).split("=", 1)[1][:-1]
)
max_peer_probe_seconds = max(
    (
        sum(spec["endpoint"]["sender_role"] == role for spec in endpoint_specs)
        + sum(spec["endpoint"]["recipient_role"] == role for spec in endpoint_specs)
    )
    for role in host.SERVICE_ROLES
) * peer.PEER_TIMEOUT_SECONDS * 3
assert host.ROLE_HOLD_SECONDS >= host.SYSTEMD_INSPECTION_TIMEOUT_SECONDS + 20
assert runtime_max_seconds >= (
    host.ROLE_RELEASE_TIMEOUT_SECONDS
    + max_peer_probe_seconds
    + host.ROLE_HOLD_SECONDS
    + 20
)
binding_units = {
    role: {
        "unit": "autopilot-p36-" + role + "-fixture.service",
        "cgroup_path": "/system.slice/autopilot-p36-" + role + "-fixture.service",
        "paths": host.role_paths(runtime_fixture, role),
        "release_token": "release-" + role,
    }
    for role in host.SERVICE_ROLES
}
run_material = host.run_binding_material(config, {"services": services, "substrate_abi_hash": abi_hash}, "p36-fixture", binding_units, endpoint_specs)
assert run_material["kind"] == "p36_phase2b_run_binding"
assert run_material["endpoints"] == endpoint_specs
assert run_material["services"][0]["ready_path"] == binding_units["worker"]["paths"]["ready"]
assert host.service_writable_paths("worker", binding_units["worker"], endpoint_specs) == (
    binding_units["worker"]["paths"]["ack_root"],
)
assert host.service_writable_paths("broker", binding_units["broker"], endpoint_specs) == (
    binding_units["broker"]["paths"]["ack_root"],
    endpoint_specs[0]["socket_root"],
)
assert host.service_writable_paths("witness", binding_units["witness"], endpoint_specs) == (
    binding_units["witness"]["paths"]["ack_root"],
    endpoint_specs[2]["socket_root"],
    endpoint_specs[3]["socket_root"],
)
for role in host.SERVICE_ROLES:
    writable_paths = host.service_writable_paths(role, binding_units[role], endpoint_specs)
    assert binding_units[role]["paths"]["root"] not in writable_paths
    assert binding_units[role]["paths"]["release"] not in writable_paths
    assert binding_units[role]["paths"]["bootstrap"] not in writable_paths
    assert binding_units[role]["paths"]["peer_config"] not in writable_paths

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
    parsed = host.read_release_ack(ack_path, service, "b" * 64, "c" * 64, "d" * 64, [])
    assert parsed["release_hash"] == host.sha256_value("release-token")
    noninteger_schema_ack = dict(parsed)
    noninteger_schema_ack["schema_version"] = 2.0
    noninteger_schema_ack["ack_hash"] = host.sha256_value(
        {key: value for key, value in noninteger_schema_ack.items() if key != "ack_hash"}
    )
    with patch.object(host, "read_service_owned_json", return_value=noninteger_schema_ack):
        try:
            host.read_release_ack(ack_path, service, "b" * 64, "c" * 64, "d" * 64, [])
            raise AssertionError("release acknowledgement accepted a floating schema version")
        except host.SubstrateHostError:
            pass

with tempfile.TemporaryDirectory() as temporary_directory:
    ready_path = os.path.join(temporary_directory, "listeners.json")
    current_uid = os.geteuid()
    current_gid = os.getegid()
    service = {"role": "worker", "uid": current_uid, "gid": current_gid}
    ready_args = SimpleNamespace(
        role="worker",
        ready_path=ready_path,
        expected_uid=current_uid,
        expected_gid=current_gid,
        install_binding_hash="b" * 64,
        run_binding_hash="c" * 64,
        substrate_abi_hash="d" * 64,
    )
    runner.write_listener_ready(ready_args, [])
    parsed_ready = host.read_listener_ready(
        ready_path,
        service,
        "b" * 64,
        "c" * 64,
        "d" * 64,
        os.getpid(),
        [],
    )
    assert parsed_ready["status"] == "fixed_listeners_ready"
    try:
        host.read_listener_ready(
            ready_path,
            service,
            "b" * 64,
            "c" * 64,
            "d" * 64,
            os.getpid(),
            ["worker_broker"],
        )
        raise AssertionError("listener readiness accepted a substituted endpoint set")
    except host.SubstrateHostError:
        pass

with patch.object(host.time, "monotonic", side_effect=[0, host.ROLE_STARTUP_TIMEOUT_SECONDS + 1]):
    try:
        host.wait_for_listener_ready(
            "/tmp/p36-missing-listener-ready.json",
            {"role": "worker", "uid": 991, "gid": 991},
            "b" * 64,
            "c" * 64,
            "d" * 64,
            4242,
            [],
        )
        raise AssertionError("missing listener readiness did not fail closed")
    except host.SubstrateHostError:
        pass

traversal_components = []
with patch.object(host, "require_root_owned_path", side_effect=lambda path, *_args, **_kwargs: path), patch.object(
    host, "path_components", side_effect=lambda path: traversal_components.append(path) or ["/", "/root", "/root/p36", "/root/p36/lib"]
), patch.object(host.os, "lstat", return_value=SimpleNamespace(st_mode=0o755)):
    host.require_service_traversable_root_path("/root/p36/lib/peer.py", "peer protocol")
assert traversal_components == ["/root/p36/lib"]

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

ack_units = {
    role: {
        **binding_units[role],
        "pid": 81000 + index,
    }
    for index, role in enumerate(host.SERVICE_ROLES, 1)
}
ack_reads = []
ack_verifications = []
def collect_ack(path, service, *_args):
    role = service["role"]
    ack_reads.append(role)
    return {
        "pid": ack_units[role]["pid"],
        "release_hash": host.sha256_value(ack_units[role]["release_token"]),
        "ipc_receipts": [],
    }
def verify_collected_ack(_systemctl_path, _unit, _cgroup_path, service, _pid):
    ack_verifications.append(service["role"])
with patch.object(host.os.path, "exists", return_value=True), patch.object(
    host, "read_release_ack", side_effect=collect_ack
), patch.object(host, "verify_ack_service_process", side_effect=verify_collected_ack):
    collected_acks = host.collect_release_acks(
        ack_units,
        services,
        {role: [] for role in host.SERVICE_ROLES},
        "b" * 64,
        "c" * 64,
        "d" * 64,
        "/usr/bin/systemctl",
    )
assert tuple(collected_acks) == host.SERVICE_ROLES
assert ack_reads == list(host.SERVICE_ROLES)
assert ack_verifications == list(host.SERVICE_ROLES)
late_ack_reads = []
with patch.object(host.time, "monotonic", side_effect=[0, host.ROLE_ACK_TIMEOUT_SECONDS]), patch.object(
    host.os.path, "exists", return_value=True
), patch.object(host, "read_release_ack", side_effect=lambda *_args: late_ack_reads.append(True)):
    try:
        host.collect_release_acks(
            ack_units,
            services,
            {role: [] for role in host.SERVICE_ROLES},
            "b" * 64,
            "c" * 64,
            "d" * 64,
            "/usr/bin/systemctl",
        )
        raise AssertionError("collector accepted acknowledgements after its shared deadline")
    except host.SubstrateHostError:
        pass
assert late_ack_reads == []

cleanup_units = []
cleanup_paths = []
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
def record_cleanup_path(path, expected_type):
    cleanup_paths.append((path, expected_type))

with patch.object(host, "require_root"), patch.object(host, "installed_root_from_self", return_value="/tmp/p36-installed"), patch.object(host, "load_installed_config", return_value=synthetic_config), patch.object(host, "validate_installed_config", return_value=synthetic_validated), patch.object(host, "load_peer_protocol", return_value=peer), patch.object(host, "require_supported_host"), patch.object(host, "create_tracked_resource", side_effect=mark_created), patch.object(host, "ensure_runtime_parent", side_effect=marked_runtime_parent), patch.object(host, "create_directory", side_effect=harmless_directory), patch.object(host, "write_service_bootstrap"), patch.object(host, "run_command", side_effect=ambiguous_systemd), patch.object(host, "stop_and_collect_unit", side_effect=record_cleanup), patch.object(host, "cleanup_path", side_effect=record_cleanup_path), patch.object(host.signal, "signal", side_effect=lambda *_args: None):
    try:
        host.run_probe()
        raise AssertionError("ambiguous systemd response did not fail")
    except host.SubstrateHostError as error:
        assert "simulated ambiguous systemd response" in str(error)
assert len(cleanup_units) == 1
assert cleanup_units[0][0] == paths["systemctl_path"]
assert cleanup_units[0][1].startswith("autopilot-p36-worker-")
assert cleanup_units[0][1].endswith(".service")
assert any(path.endswith("/worker/ack/listeners.json") and kind == "file" for path, kind in cleanup_paths)
assert any(path.endswith("/worker/ack/listeners.json.pending") and kind == "file" for path, kind in cleanup_paths)
assert any(argument.startswith("--property=ReadWritePaths=/run/autopilot-production-substrate/p36-") and argument.endswith("/worker/ack") for argument in systemd_commands[0])
assert not any("ProtectProc=invisible" in argument for argument in systemd_commands[0])

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
    with patch.object(host, "require_root"), patch.object(host, "installed_root_from_self", return_value="/tmp/p36-installed"), patch.object(host, "load_installed_config", return_value=synthetic_config), patch.object(host, "validate_installed_config", return_value=synthetic_validated), patch.object(host, "load_peer_protocol", return_value=peer), patch.object(host, "require_supported_host"), patch.object(host, "create_tracked_resource", side_effect=mark_created), patch.object(host, "ensure_runtime_parent", side_effect=marked_runtime_parent), patch.object(host, "create_directory", side_effect=harmless_directory), patch.object(host, "write_service_bootstrap"), patch.object(host, "run_command", side_effect=ambiguous_systemd), patch.object(host, "stop_and_collect_unit"), patch.object(host, "cleanup_path"), patch.object(host, "append_cleanup_error", side_effect=interrupt_between_cleanup_callbacks):
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
assert "released_peer_authenticated_no_effect" in runner_source
assert "require_exact_identity" in runner_source
assert "wait_for_release" in runner_source
assert "def wait_for_release_ack" not in source
assert "def collect_release_acks" in source
assert runner_source.index("listener.listen(8)") < runner_source.index("write_listener_ready(runner_args")
assert runner_source.index("write_listener_ready(runner_args") < runner_source.index("        wait_for_release(bootstrap)")
ready_gate = source.index('wait_for_listener_ready(\n                unit["paths"]["ready"]')
assert ready_gate < source.index("            seal_listener_socket(endpoint_spec)")
assert ready_gate < source.index('            create_release_file(unit["paths"]["release"]')

print("five_independent_identities=true")
print("no_runtime_override_surface=true")
print("snapshot_abi_and_authority_binding=true")
print("snapshot_contract_dependency_closure_loads=true")
print("lifecycle_time_budgets_are_nested=true")
print("identity_and_group_drift_rejected=true")
print("exact_pid_identity_cgroup_v2=true")
print("pid_poll_never_exceeds_its_remaining_startup_budget=true")
print("duplicate_identity_axes_rejected=true")
print("release_published_after_complete_write=true")
print("role_ack_is_canonical_and_bound=true")
print("role_ack_published_after_complete_write=true")
print("listener_ready_is_canonical_and_bound=true")
print("listener_ready_precedes_seal_and_release=true")
print("missing_or_wrong_listener_ready_fails_closed=true")
print("listener_ready_cleanup_is_armed=true")
print("ack_mainpid_cgroup_revalidated=true")
print("release_acks_share_one_collection_deadline=true")
print("late_release_acks_are_not_scanned=true")
print("ambiguous_launch_cleanup_is_armed=true")
print("second_interrupt_cleanup_is_masked=true")
print("role_writable_paths_are_pinned=true")
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
assert_contains "$PY_OUT" "lifecycle_time_budgets_are_nested=true" "service release, probe hold, and systemd runtime limits cover bounded host startup"
assert_contains "$PY_OUT" "identity_and_group_drift_rejected=true" "private-group identity drift fails closed"
assert_contains "$PY_OUT" "exact_pid_identity_cgroup_v2=true" "service PID must retain exact identity and unified cgroup-v2 binding"
assert_contains "$PY_OUT" "pid_poll_never_exceeds_its_remaining_startup_budget=true" "PID inspection cannot overrun its bounded startup window"
assert_contains "$PY_OUT" "duplicate_identity_axes_rejected=true" "duplicate service identity axes fail closed"
assert_contains "$PY_OUT" "release_published_after_complete_write=true" "role release is atomically published after its full content"
assert_contains "$PY_OUT" "role_ack_is_canonical_and_bound=true" "role acknowledgement is canonical and binds its frozen run"
assert_contains "$PY_OUT" "role_ack_published_after_complete_write=true" "role acknowledgement is atomically published after its full content"
assert_contains "$PY_OUT" "listener_ready_is_canonical_and_bound=true" "listener readiness is canonical and pins its service PID and endpoint set"
assert_contains "$PY_OUT" "listener_ready_precedes_seal_and_release=true" "host seals and releases only after every listener is ready"
assert_contains "$PY_OUT" "missing_or_wrong_listener_ready_fails_closed=true" "missing or substituted listener readiness blocks sealing and release"
assert_contains "$PY_OUT" "listener_ready_cleanup_is_armed=true" "ambiguous service launch cleans ready and pending-ready records"
assert_contains "$PY_OUT" "ack_mainpid_cgroup_revalidated=true" "acknowledgement revalidates systemd MainPID and cgroup binding"
assert_contains "$PY_OUT" "release_acks_share_one_collection_deadline=true" "all role acknowledgements are collected and revalidated under one shared deadline"
assert_contains "$PY_OUT" "late_release_acks_are_not_scanned=true" "the shared acknowledgement deadline is checked before any late acknowledgement is read"
assert_contains "$PY_OUT" "ambiguous_launch_cleanup_is_armed=true" "ambiguous systemd launch still collects its possible unit"
assert_contains "$PY_OUT" "second_interrupt_cleanup_is_masked=true" "a second interruption cannot truncate substrate cleanup"
assert_contains "$PY_OUT" "role_writable_paths_are_pinned=true" "systemd strict filesystem policy grants only each role acknowledgement and listener roots"
assert_contains "$PY_OUT" "partial_install_cleanup_is_armed=true" "failed installation cleans its partial immutable snapshot"
assert_contains "$PY_OUT" "interruptible_install_cleanup_is_armed=true" "interrupted installation cleans its partial immutable snapshot"
assert_contains "$PY_OUT" "no_effect_runtime_surface=true" "P3.6 Phase 2 source has no Engine or action authority surface"

finalize_test
