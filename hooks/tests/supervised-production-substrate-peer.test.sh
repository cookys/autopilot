#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import io
import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
from unittest.mock import patch

root = sys.argv[1]
spec = importlib.util.spec_from_file_location(
    "p36_peer", os.path.join(root, "src", "engine", "supervised_production_substrate_peer.py")
)
peer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(peer)

assert tuple(item["endpoint_id"] for item in peer.SERVICE_IPC_ENDPOINTS) == (
    "worker_broker",
    "receipt_verifier_coordinator",
    "receipt_verifier_witness_append",
    "coordinator_witness_read",
)
assert peer.endpoint_by_id("worker_broker")["route_operation"] == "execute"
try:
    peer.endpoint_by_id("arbitrary_route")
    raise AssertionError("arbitrary endpoint was accepted")
except peer.PeerProtocolError:
    pass
abi_raw = subprocess.check_output(
    [
        "node",
        "-e",
        "process.stdout.write(JSON.stringify(require(process.argv[1]).getSupervisedProductionSubstrateAbi()))",
        os.path.join(root, "src", "engine", "supervised-production-substrate-contract.js"),
    ],
    text=True,
)
abi = json.loads(abi_raw)
operation_routes = abi["wire_contract"]["service_ipc"]["operation_routes"]
for fixed_endpoint in peer.SERVICE_IPC_ENDPOINTS:
    assert operation_routes[fixed_endpoint["route_operation"]] == {
        "sender_role": fixed_endpoint["sender_role"],
        "recipient_role": fixed_endpoint["recipient_role"],
    }

sender = peer.create_runtime_service_claim(
    {
        "role": "worker",
        "identity": "autopilot-p36-worker",
        "uid": 1101,
        "gid": 1101,
        "attestation_hash": "a" * 64,
    },
    3101,
    "/system.slice/autopilot-p36-worker-test.service",
)
recipient = peer.create_runtime_service_claim(
    {
        "role": "broker",
        "identity": "autopilot-p36-broker",
        "uid": 1102,
        "gid": 1102,
        "attestation_hash": "b" * 64,
    },
    3102,
    "/system.slice/autopilot-p36-broker-test.service",
)
bindings = {
    "install_binding_hash": "c" * 64,
    "run_binding_hash": "d" * 64,
    "substrate_abi_hash": "e" * 64,
}
endpoint = peer.endpoint_by_id("worker_broker")
request = peer.create_peer_probe_request(endpoint, sender, recipient, bindings)
encoded_request = peer.encode_canonical_frame(request)
assert peer.normalize_peer_probe_request(
    peer.decode_canonical_frame(encoded_request, "request"), endpoint, sender, recipient, bindings
) == request
response = peer.create_peer_probe_response(request)
encoded_response = peer.encode_canonical_frame(response)
assert peer.normalize_peer_probe_response(
    peer.decode_canonical_frame(encoded_response, "response"), request
) == response

tampered = dict(request)
tampered["route_operation"] = "prepare"
try:
    peer.normalize_peer_probe_request(tampered, endpoint, sender, recipient, bindings)
    raise AssertionError("cross-route request was accepted")
except peer.PeerProtocolError:
    pass
rehashed_cross_route = dict(request)
rehashed_cross_route["route_operation"] = "prepare"
rehashed_cross_route["request_hash"] = peer.sha256_value(
    {key: value for key, value in rehashed_cross_route.items() if key != "request_hash"}
)
try:
    peer.normalize_peer_probe_request(rehashed_cross_route, endpoint, sender, recipient, bindings)
    raise AssertionError("self-consistent cross-route request was accepted")
except peer.PeerProtocolError:
    pass
for invalid_schema_version in (True, 1.0):
    invalid_schema_request = dict(request)
    invalid_schema_request["schema_version"] = invalid_schema_version
    invalid_schema_request["request_hash"] = peer.sha256_value(
        {key: value for key, value in invalid_schema_request.items() if key != "request_hash"}
    )
    try:
        peer.normalize_peer_probe_request(invalid_schema_request, endpoint, sender, recipient, bindings)
        raise AssertionError("non-integer peer request schema version was accepted")
    except peer.PeerProtocolError:
        pass
invalid_schema_response = dict(response)
invalid_schema_response["schema_version"] = True
invalid_schema_response["response_hash"] = peer.sha256_value(
    {key: value for key, value in invalid_schema_response.items() if key != "response_hash"}
)
try:
    peer.normalize_peer_probe_response(invalid_schema_response, request)
    raise AssertionError("non-integer peer response schema version was accepted")
except peer.PeerProtocolError:
    pass
try:
    peer.decode_canonical_frame(b'{"a":1,"a":1}', "duplicate")
    raise AssertionError("noncanonical duplicate JSON was accepted")
except peer.PeerProtocolError:
    pass

with tempfile.TemporaryDirectory(dir="/tmp", prefix="p36-") as temporary_directory:
    boundary_socket_path = os.path.join(
        temporary_directory,
        "s" * (peer.MAX_UNIX_SOCKET_PATH_BYTES - len(temporary_directory) - 1),
    )
    assert len(boundary_socket_path.encode("ascii")) == peer.MAX_UNIX_SOCKET_PATH_BYTES
    assert peer.require_unix_socket_path(boundary_socket_path, "boundary socket") == boundary_socket_path
    boundary_listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        boundary_listener.bind(boundary_socket_path)
        boundary_listener.listen(1)
    finally:
        boundary_listener.close()
        if os.path.lexists(boundary_socket_path):
            os.unlink(boundary_socket_path)
assert peer.require_unix_socket_path("/run/p36/i/worker_broker/s", "socket")
try:
    peer.require_unix_socket_path("/run/" + ("x" * 104), "socket")
    raise AssertionError("overlong Unix socket path was accepted")
except peer.PeerProtocolError:
    pass

left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
try:
    peer.send_frame(left, encoded_request)
    assert peer.read_single_frame(right) == encoded_request
finally:
    left.close()
    right.close()

frame_reads = []
with patch.object(peer, "peer_credentials", return_value=(3101, 1101, 1101)), patch.object(
    peer, "cgroup_v2_matches", return_value=True
):
    probe_socket = object()
    assert peer.peer_credentials_match(probe_socket, sender) == {
        "pid": 3101,
        "uid": 1101,
        "gid": 1101,
    }
with patch.object(peer, "peer_credentials", return_value=(9999, 1101, 1101)), patch.object(
    peer, "cgroup_v2_matches", side_effect=lambda *_args: frame_reads.append("cgroup") or True
):
    assert peer.peer_credentials_match(object(), sender) is None
assert frame_reads == []
with patch.object(peer, "peer_credentials", return_value=(3101, 1101, 1101)), patch.object(
    peer, "cgroup_v2_matches", return_value=False
):
    assert peer.peer_credentials_match(object(), sender) is None

with patch("builtins.open", return_value=io.StringIO("0::/system.slice/autopilot-p36-worker-test.service\n")):
    assert peer.cgroup_v2_matches(3101, sender["cgroup_path"]) is True
with patch("builtins.open", return_value=io.StringIO("0::/system.slice/autopilot-p36-worker-test.service/nested\n")):
    assert peer.cgroup_v2_matches(3101, sender["cgroup_path"]) is False

assert "cgroup_path" not in request["sender"]
assert "cgroup_path" not in request["recipient"]
source = open(
    os.path.join(root, "src", "engine", "supervised_production_substrate_peer.py"), encoding="utf-8"
).read()
assert "AutopilotEngine" not in source
assert "mintActionDecision" not in source
assert "executeAuthorizedAction" not in source

print("fixed_topology_only=true")
print("probe_topology_matches_frozen_contract=true")
print("canonical_hash_bound_frames=true")
print("schema_versions_are_exact_integers=true")
print("cross_route_and_noncanonical_frames_rejected=true")
print("unix_socket_path_limit_is_fail_closed=true")
print("unix_socket_path_boundary_binds=true")
print("single_frame_transport=true")
print("peer_credentials_checked_before_frame_parse=true")
print("exact_cgroup_v2_claim_required=true")
print("no_raw_path_or_authority_surface=true")
PY
)"
PY_STATUS=$?

assert_eq "$PY_STATUS" "0" "P3.6 P2b peer protocol deterministic fixture exits successfully"
assert_contains "$PY_OUT" "fixed_topology_only=true" "P2b accepts only the four ABI-pinned routes"
assert_contains "$PY_OUT" "probe_topology_matches_frozen_contract=true" "P2b probe routes match the frozen P3.6 contract ABI"
assert_contains "$PY_OUT" "canonical_hash_bound_frames=true" "P2b request and response hashes bind canonical content"
assert_contains "$PY_OUT" "schema_versions_are_exact_integers=true" "P2b rejects boolean and floating peer schema versions"
assert_contains "$PY_OUT" "cross_route_and_noncanonical_frames_rejected=true" "P2b rejects route substitution and noncanonical JSON"
assert_contains "$PY_OUT" "unix_socket_path_limit_is_fail_closed=true" "P2b rejects Unix socket paths beyond the Linux limit"
assert_contains "$PY_OUT" "unix_socket_path_boundary_binds=true" "P2b accepts and binds the exact Linux Unix socket path boundary"
assert_contains "$PY_OUT" "single_frame_transport=true" "P2b uses one bounded framed message per direction"
assert_contains "$PY_OUT" "peer_credentials_checked_before_frame_parse=true" "P2b rejects wrong peer credentials before any frame parse"
assert_contains "$PY_OUT" "exact_cgroup_v2_claim_required=true" "P2b requires exact unified cgroup-v2 placement"
assert_contains "$PY_OUT" "no_raw_path_or_authority_surface=true" "P2b protocol carries neither raw paths nor authority"

finalize_test
