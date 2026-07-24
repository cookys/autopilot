#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import contextlib
import errno
import importlib.util
import io
import os
import socket
import stat
import sys
import tempfile
import threading
from unittest.mock import patch

root = sys.argv[1]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(root, "src", "engine", filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

peer = load("p36_peer_service", "supervised_production_substrate_peer.py")
runner = load("p36_peer_runner", "supervised-production-substrate-service.py")
host = load("p36_peer_host", "supervised-production-substrate-host.py")

uid = os.geteuid()
gid = os.getegid()
pid = os.getpid()
bindings = {
    "install_binding_hash": "a" * 64,
    "run_binding_hash": "b" * 64,
    "substrate_abi_hash": "c" * 64,
}
endpoint = peer.endpoint_by_id("worker_broker")
sender_static = {
    "role": "worker",
    "identity": "autopilot-p36-worker",
    "uid": uid,
    "gid": gid,
    "attestation_hash": "d" * 64,
}
recipient_static = {
    "role": "broker",
    "identity": "autopilot-p36-broker",
    "uid": uid,
    "gid": gid,
    "attestation_hash": "e" * 64,
}

fixture_paths = host.role_paths("/run/p36-fixture", "worker")
fixture_unit = {
    "paths": fixture_paths,
    "release_token": "fixture-release",
    "pid": pid,
    "cgroup_path": "/system.slice/autopilot-p36-worker-fixture.service",
}
fixture_static_endpoint = {
    "endpoint": endpoint,
    "socket_root": "/run/p36-fixture/i/worker_broker",
    "socket_path": "/run/p36-fixture/i/worker_broker/s",
    "sender": sender_static,
    "recipient": recipient_static,
}
fixture_validated = {
    "services": {"worker": sender_static},
    "substrate_abi_hash": bindings["substrate_abi_hash"],
}
fixture_config = {"binding_hash": bindings["install_binding_hash"]}
bootstrap_material = host.service_bootstrap_material(
    fixture_config,
    fixture_validated,
    fixture_unit,
    "worker",
    bindings["run_binding_hash"],
    [fixture_static_endpoint],
)
bootstrap_value = dict(bootstrap_material)
bootstrap_value["bootstrap_hash"] = host.sha256_value(bootstrap_material)
with patch.object(runner, "read_root_group_json", return_value=bootstrap_value), patch.object(
    runner.os, "geteuid", return_value=uid
), patch.object(runner.os, "getegid", return_value=gid), patch.object(
    runner.os, "getgroups", return_value=[gid]
):
    normalized_bootstrap = runner.read_bootstrap("/ignored/bootstrap.json")
assert normalized_bootstrap["attestation_hash"] == sender_static["attestation_hash"]
assert normalized_bootstrap["release_timeout_seconds"] == host.ROLE_RELEASE_TIMEOUT_SECONDS
assert normalized_bootstrap["hold_seconds"] == host.ROLE_HOLD_SECONDS
fixture_runtime_endpoint = dict(fixture_static_endpoint)
fixture_runtime_endpoint["sender"] = runner.peer.create_runtime_service_claim(
    sender_static, pid, fixture_unit["cgroup_path"]
)
fixture_runtime_endpoint["recipient"] = runner.peer.create_runtime_service_claim(
    recipient_static, pid, "/system.slice/autopilot-p36-broker-fixture.service"
)
peer_config_material = host.peer_config_material(
    fixture_config,
    fixture_validated,
    "worker",
    bindings["run_binding_hash"],
    [fixture_runtime_endpoint],
)
peer_config_value = dict(peer_config_material)
peer_config_value["peer_config_hash"] = host.sha256_value(peer_config_material)
with patch.object(runner, "read_root_group_json", return_value=peer_config_value), patch.object(
    runner.os, "getpid", return_value=pid
), patch.object(runner.peer, "cgroup_v2_matches", return_value=True):
    normalized_peer_config = runner.read_peer_config(normalized_bootstrap)
assert normalized_peer_config["endpoints"][0]["sender"]["pid"] == pid
try:
    with contextlib.redirect_stderr(io.StringIO()), patch.object(
        runner, "read_root_group_json", return_value=peer_config_value
    ), patch.object(runner.os, "getpid", return_value=pid + 1), patch.object(
        runner.peer, "cgroup_v2_matches", return_value=True
    ):
        runner.read_peer_config(normalized_bootstrap)
    raise AssertionError("peer config accepted a local PID substitution")
except SystemExit:
    pass
try:
    with contextlib.redirect_stderr(io.StringIO()):
        runner.parser().parse_args(["--role", "worker"])
    raise AssertionError("service runner accepted legacy caller-selected role arguments")
except SystemExit:
    pass

with tempfile.TemporaryDirectory(dir="/tmp", prefix="p36-") as temporary_directory:
    socket_root = os.path.join(temporary_directory, "worker_broker")
    socket_path = os.path.join(socket_root, "peer.sock")
    os.mkdir(socket_root, 0o2710)
    os.chmod(socket_root, 0o2710)
    static_endpoint = {
        "endpoint": endpoint,
        "socket_root": socket_root,
        "socket_path": socket_path,
        "sender": sender_static,
        "recipient": recipient_static,
    }
    sender = peer.create_runtime_service_claim(
        sender_static, pid, "/system.slice/autopilot-p36-worker-fixture.service"
    )
    recipient = peer.create_runtime_service_claim(
        recipient_static, pid, "/system.slice/autopilot-p36-broker-fixture.service"
    )
    runtime_endpoint = dict(static_endpoint)
    runtime_endpoint["sender"] = sender
    runtime_endpoint["recipient"] = recipient
    broker_bootstrap = {"role": "broker", "uid": uid, "gid": gid, **bindings}
    worker_bootstrap = {"role": "worker", "uid": uid, "gid": gid, **bindings}
    with patch.object(runner.peer, "cgroup_v2_matches", return_value=True):
        listener = runner.bind_listener(static_endpoint, broker_bootstrap)
        socket_info = os.lstat(socket_path)
        assert stat.S_ISSOCK(socket_info.st_mode)
        assert socket_info.st_uid == uid and socket_info.st_gid == gid
        assert (socket_info.st_mode & 0o777) == 0o660
        result = {}
        thread = threading.Thread(
            target=runner.serve_listener,
            args=(listener, runtime_endpoint, broker_bootstrap, result),
        )
        thread.start()
        outbound = runner.send_outbound_probe(runtime_endpoint, worker_bootstrap)
        thread.join(2)
        assert not thread.is_alive()
        assert "error" not in result
        inbound = result["receipt"]
    assert outbound["direction"] == "outbound"
    assert inbound["direction"] == "inbound"
    assert outbound["request_hash"] == inbound["request_hash"]
    assert outbound["response_hash"] == inbound["response_hash"]
    assert "cgroup_path" not in outbound["peer"]
    assert "socket_path" not in outbound

with tempfile.TemporaryDirectory(dir="/tmp", prefix="p36-") as temporary_directory:
    socket_root = os.path.join(temporary_directory, "reject")
    socket_path = os.path.join(socket_root, "peer.sock")
    os.mkdir(socket_root, 0o2710)
    os.chmod(socket_root, 0o2710)
    invalid_static = {
        "endpoint": endpoint,
        "socket_root": socket_root,
        "socket_path": socket_path,
        "sender": dict(sender_static, uid=uid + 1),
        "recipient": recipient_static,
    }
    invalid_sender = peer.create_runtime_service_claim(
        invalid_static["sender"], pid + 1, "/system.slice/autopilot-p36-invalid-fixture.service"
    )
    invalid_runtime = dict(invalid_static)
    invalid_runtime["sender"] = invalid_sender
    invalid_runtime["recipient"] = recipient
    result = {}
    parsed_frames = []
    with patch.object(runner.peer, "PEER_TIMEOUT_SECONDS", 0.1), patch.object(
        runner.peer, "read_single_frame", side_effect=lambda *_args: parsed_frames.append(True)
    ), patch.object(runner.peer, "cgroup_v2_matches", return_value=True):
        listener = runner.bind_listener(invalid_static, broker_bootstrap)
        thread = threading.Thread(
            target=runner.serve_listener,
            args=(listener, invalid_runtime, broker_bootstrap, result),
        )
        thread.start()
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            client.connect(socket_path)
            try:
                client.sendall(b"\x00\x00\x00\x02{}")
            except OSError as error:
                # The server is deliberately allowed to reject this wrong peer
                # immediately after SO_PEERCRED, before the client can finish
                # writing its decoy frame.
                if error.errno not in {errno.EPIPE, errno.ECONNRESET}:
                    raise
        finally:
            client.close()
        thread.join(2)
    assert not thread.is_alive()
    assert parsed_frames == []
    assert "error" in result

accepted_timeouts = []
class TimeoutCandidate:
    def settimeout(self, value):
        accepted_timeouts.append(value)
    def close(self):
        pass
class TimeoutListener:
    def __init__(self):
        self.accepted = False
    def settimeout(self, _value):
        pass
    def accept(self):
        if not self.accepted:
            self.accepted = True
            return TimeoutCandidate(), None
        raise socket.timeout()
    def close(self):
        pass
timeout_result = {}
with patch.object(runner.peer, "PEER_TIMEOUT_SECONDS", 0.1), patch.object(
    runner.peer, "peer_credentials_match", return_value=None
):
    runner.serve_listener(TimeoutListener(), runtime_endpoint, broker_bootstrap, timeout_result)
assert accepted_timeouts == [0.1]
assert "error" in timeout_result

seal_endpoint = {
    "endpoint": endpoint,
    "socket_root": "/run/p36/worker_broker",
    "socket_path": "/run/p36/worker_broker/peer.sock",
    "sender": sender_static,
    "recipient": recipient_static,
}
with patch.object(host, "require_exact_directory"), patch.object(host, "require_exact_socket"), patch.object(
    host.os, "open", return_value=41
), patch.object(host.os, "fchown") as fchown, patch.object(host.os, "fchmod") as fchmod, patch.object(
    host.os, "close"
), patch.object(host.os, "listdir", return_value=["peer.sock"]
):
    host.seal_listener_socket(seal_endpoint)
assert fchown.call_args.args == (41, 0, gid)
assert fchmod.call_args.args == (41, 0o710)
with patch.object(host, "require_exact_directory"), patch.object(host, "require_exact_socket"), patch.object(
    host.os, "open", return_value=41
), patch.object(host.os, "fchown"), patch.object(host.os, "fchmod"), patch.object(
    host.os, "close"
), patch.object(host.os, "listdir", return_value=["peer.sock", "unexpected"]):
    try:
        host.seal_listener_socket(seal_endpoint)
        raise AssertionError("root seal accepted an extra recipient-created entry")
    except host.SubstrateHostError:
        pass
assert "ProtectProc=invisible" not in host.SYSTEMD_PROPERTIES

with tempfile.TemporaryDirectory(dir="/tmp", prefix="p36-") as temporary_directory:
    cleanup_root = os.path.join(temporary_directory, "socket-root")
    os.mkdir(cleanup_root)
    cleanup_socket_path = os.path.join(cleanup_root, "peer.sock")
    cleanup_listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    cleanup_listener.bind(cleanup_socket_path)
    cleanup_listener.close()
    with open(os.path.join(cleanup_root, "unexpected"), "w", encoding="ascii") as source:
        source.write("x")
    cleanup_endpoint = dict(seal_endpoint)
    cleanup_endpoint["socket_root"] = cleanup_root
    cleanup_endpoint["socket_path"] = cleanup_socket_path
    with patch.object(host.os, "fchown"), patch.object(host.os, "fchmod"):
        host.cleanup_endpoint_socket_root(cleanup_endpoint)
    assert not os.path.exists(cleanup_root)

runtime_specs = [runtime_endpoint]
expected_worker = host.expected_ipc_receipts("worker", runtime_specs)
expected_broker = host.expected_ipc_receipts("broker", runtime_specs)
assert host.validate_ipc_receipts([outbound], expected_worker) == [outbound]
assert host.validate_ipc_receipts([inbound], expected_broker) == [inbound]
host.verify_cross_peer_receipts(
    {
        "worker": {"ipc_receipts": [outbound]},
        "broker": {"ipc_receipts": [inbound]},
    },
    runtime_specs,
)
bad_outbound = dict(outbound)
bad_outbound["response_hash"] = "f" * 64
bad_outbound["receipt_hash"] = host.sha256_value(
    {key: value for key, value in bad_outbound.items() if key != "receipt_hash"}
)
try:
    host.verify_cross_peer_receipts(
        {
            "worker": {"ipc_receipts": [bad_outbound]},
            "broker": {"ipc_receipts": [inbound]},
        },
        runtime_specs,
    )
    raise AssertionError("cross-peer receipt mismatch was accepted")
except host.SubstrateHostError:
    pass

print("actual_unix_peer_round_trip=true")
print("root_bootstrap_and_pid_bound_peer_config=true")
print("invalid_peer_rejected_before_frame_read=true")
print("accepted_peer_socket_is_timeout_bounded=true")
print("socket_root_sealed_to_sender_only=true")
print("extra_socket_root_entries_fail_closed_and_cleanup=true")
print("paired_hash_receipts_required=true")
print("no_effect_peer_receipts_hide_paths=true")
PY
)"
PY_STATUS=$?

assert_eq "$PY_STATUS" "0" "P3.6 P2b peer service deterministic fixture exits successfully"
assert_contains "$PY_OUT" "actual_unix_peer_round_trip=true" "P2b services complete one fixed Unix peer probe"
assert_contains "$PY_OUT" "root_bootstrap_and_pid_bound_peer_config=true" "P2b service accepts only root bootstrap and its exact runtime PID"
assert_contains "$PY_OUT" "invalid_peer_rejected_before_frame_read=true" "P2b rejects wrong peer credentials before parsing a frame"
assert_contains "$PY_OUT" "accepted_peer_socket_is_timeout_bounded=true" "P2b bounds accepted Unix peer sockets before credential, read, and response work"
assert_contains "$PY_OUT" "socket_root_sealed_to_sender_only=true" "P2b root seal removes server directory write authority and preserves sender access"
assert_contains "$PY_OUT" "extra_socket_root_entries_fail_closed_and_cleanup=true" "P2b rejects and removes recipient-created entries beyond the pinned listener socket"
assert_contains "$PY_OUT" "paired_hash_receipts_required=true" "P2b host requires matching request and response hashes at both endpoints"
assert_contains "$PY_OUT" "no_effect_peer_receipts_hide_paths=true" "P2b receipts carry no socket or cgroup filesystem path"

finalize_test
