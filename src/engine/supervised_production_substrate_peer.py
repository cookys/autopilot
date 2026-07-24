#!/usr/bin/env python3
"""P3.6 P2b fixed-topology, no-effect Unix peer protocol.

This module deliberately carries only the bounded transport proof used by the
root-installed substrate. It has no workspace path, action, permit, Engine,
effect, acceptance, or durable-state surface. The role runner verifies Linux
peer credentials and cgroup placement before it decodes a frame; this module
then verifies the canonical, hash-bound request and response content.
"""

import hashlib
import json
import math
import os
import select
import socket
import struct
import time


PEER_PROTOCOL_SCHEMA_VERSION = 1
PEER_REQUEST_KIND = "p36_phase2b_peer_probe_request"
PEER_RESPONSE_KIND = "p36_phase2b_peer_probe_response"
PEER_RESPONSE_STATUS = "peer_authenticated_no_effect"
MAX_FRAME_BYTES = 8192
MAX_UNIX_SOCKET_PATH_BYTES = 107
PEER_TIMEOUT_SECONDS = 5
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
SHA256_CHARS = frozenset("0123456789abcdef")
SERVICE_IPC_ENDPOINTS = (
    {
        "endpoint_id": "worker_broker",
        "route_operation": "execute",
        "sender_role": "worker",
        "recipient_role": "broker",
    },
    {
        "endpoint_id": "receipt_verifier_coordinator",
        "route_operation": "prepare",
        "sender_role": "receipt_verifier",
        "recipient_role": "coordinator",
    },
    {
        "endpoint_id": "receipt_verifier_witness_append",
        "route_operation": "appendIfHead",
        "sender_role": "receipt_verifier",
        "recipient_role": "witness",
    },
    {
        "endpoint_id": "coordinator_witness_read",
        "route_operation": "getHead",
        "sender_role": "coordinator",
        "recipient_role": "witness",
    },
)
SERVICE_CLAIM_KEYS = (
    "role",
    "identity",
    "uid",
    "gid",
    "attestation_hash",
    "pid",
    "cgroup_binding_hash",
)
SERVICE_RUNTIME_CLAIM_KEYS = SERVICE_CLAIM_KEYS + ("cgroup_path",)
REQUEST_KEYS = (
    "schema_version",
    "kind",
    "endpoint_id",
    "route_operation",
    "sender",
    "recipient",
    "install_binding_hash",
    "run_binding_hash",
    "substrate_abi_hash",
    "request_hash",
)
RESPONSE_KEYS = (
    "schema_version",
    "kind",
    "status",
    "endpoint_id",
    "route_operation",
    "sender",
    "recipient",
    "install_binding_hash",
    "run_binding_hash",
    "substrate_abi_hash",
    "request_hash",
    "response_hash",
)


class PeerProtocolError(Exception):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_value(value):
    if not isinstance(value, str):
        value = canonical(value)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def require_plain_object(value, label):
    if not isinstance(value, dict):
        raise PeerProtocolError(label + " must be an object")
    return value


def require_exact_keys(value, expected, label):
    value = require_plain_object(value, label)
    if set(value.keys()) != set(expected):
        raise PeerProtocolError(label + " has an unexpected key set")
    return value


def require_token(value, label):
    if not isinstance(value, str) or not value or len(value) > 128:
        raise PeerProtocolError(label + " must be a bounded protocol token")
    if any(character not in TOKEN_CHARS for character in value):
        raise PeerProtocolError(label + " must be a bounded protocol token")
    return value


def require_sha256(value, label):
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in SHA256_CHARS for character in value)
    ):
        raise PeerProtocolError(label + " must be a lowercase SHA-256 digest")
    return value


def require_schema_version(value, label):
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value != PEER_PROTOCOL_SCHEMA_VERSION
    ):
        raise PeerProtocolError(label + " must be the exact peer protocol schema version")
    return value


def require_nonroot_id(value, label):
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise PeerProtocolError(label + " must be a non-root integer")
    return value


def require_absolute_path(value, label):
    if not isinstance(value, str) or not value.startswith("/"):
        raise PeerProtocolError(label + " must be an absolute path")
    if os.path.normpath(value) != value or value.startswith("//") or value == "/":
        raise PeerProtocolError(label + " must be a canonical non-root path")
    return value


def require_unix_socket_path(value, label):
    value = require_absolute_path(value, label)
    try:
        encoded = value.encode("ascii")
    except UnicodeEncodeError as error:
        raise PeerProtocolError(label + " must be an ASCII Unix socket path") from error
    if len(encoded) > MAX_UNIX_SOCKET_PATH_BYTES:
        raise PeerProtocolError(label + " exceeds the Linux Unix socket path limit")
    return value


def require_cgroup_path(value, label):
    if not isinstance(value, str) or not value.startswith("/system.slice/"):
        raise PeerProtocolError(label + " must be an exact system.slice cgroup path")
    if value.count("/") != 2 or not value.endswith(".service"):
        raise PeerProtocolError(label + " must be an exact transient service cgroup path")
    return value


def require_timeout(value, label):
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value <= 0
        or value > 30
    ):
        raise PeerProtocolError(label + " must be greater than zero and at most 30")
    return value


def endpoint_by_id(endpoint_id):
    endpoint_id = require_token(endpoint_id, "endpoint_id")
    matches = [item for item in SERVICE_IPC_ENDPOINTS if item["endpoint_id"] == endpoint_id]
    if len(matches) != 1:
        raise PeerProtocolError("endpoint_id is not part of the fixed P3.6 topology")
    return dict(matches[0])


def require_endpoint(value, label):
    value = require_exact_keys(
        value,
        {"endpoint_id", "route_operation", "sender_role", "recipient_role"},
        label,
    )
    expected = endpoint_by_id(value["endpoint_id"])
    if value != expected:
        raise PeerProtocolError(label + " does not match the fixed P3.6 topology")
    return expected


def public_service_claim(value, label):
    value = require_exact_keys(value, SERVICE_CLAIM_KEYS, label)
    normalized = {
        "role": require_token(value["role"], label + ".role"),
        "identity": require_token(value["identity"], label + ".identity"),
        "uid": require_nonroot_id(value["uid"], label + ".uid"),
        "gid": require_nonroot_id(value["gid"], label + ".gid"),
        "attestation_hash": require_sha256(
            value["attestation_hash"], label + ".attestation_hash"
        ),
        "pid": require_nonroot_id(value["pid"], label + ".pid"),
        "cgroup_binding_hash": require_sha256(
            value["cgroup_binding_hash"], label + ".cgroup_binding_hash"
        ),
    }
    return normalized


def runtime_service_claim(value, label):
    value = require_exact_keys(value, SERVICE_RUNTIME_CLAIM_KEYS, label)
    normalized = public_service_claim(
        {key: value[key] for key in SERVICE_CLAIM_KEYS}, label
    )
    normalized["cgroup_path"] = require_cgroup_path(value["cgroup_path"], label + ".cgroup_path")
    if normalized["cgroup_binding_hash"] != sha256_value(normalized["cgroup_path"]):
        raise PeerProtocolError(label + " cgroup binding hash does not match its cgroup path")
    return normalized


def create_runtime_service_claim(service, pid, cgroup_path):
    service = require_exact_keys(
        service,
        {"role", "identity", "uid", "gid", "attestation_hash"},
        "service",
    )
    cgroup_path = require_cgroup_path(cgroup_path, "cgroup_path")
    return runtime_service_claim(
        {
            "role": service["role"],
            "identity": service["identity"],
            "uid": service["uid"],
            "gid": service["gid"],
            "attestation_hash": service["attestation_hash"],
            "pid": pid,
            "cgroup_path": cgroup_path,
            "cgroup_binding_hash": sha256_value(cgroup_path),
        },
        "runtime service claim",
    )


def public_claim_from_runtime(value, label):
    normalized = runtime_service_claim(value, label)
    return {key: normalized[key] for key in SERVICE_CLAIM_KEYS}


def require_bindings(value, label):
    value = require_exact_keys(
        value,
        {"install_binding_hash", "run_binding_hash", "substrate_abi_hash"},
        label,
    )
    return {
        "install_binding_hash": require_sha256(
            value["install_binding_hash"], label + ".install_binding_hash"
        ),
        "run_binding_hash": require_sha256(value["run_binding_hash"], label + ".run_binding_hash"),
        "substrate_abi_hash": require_sha256(
            value["substrate_abi_hash"], label + ".substrate_abi_hash"
        ),
    }


def create_peer_probe_request(endpoint, sender, recipient, bindings):
    endpoint = require_endpoint(endpoint, "endpoint")
    sender = public_claim_from_runtime(sender, "sender")
    recipient = public_claim_from_runtime(recipient, "recipient")
    bindings = require_bindings(bindings, "bindings")
    if sender["role"] != endpoint["sender_role"] or recipient["role"] != endpoint["recipient_role"]:
        raise PeerProtocolError("peer probe claims do not match the fixed endpoint roles")
    material = {
        "schema_version": PEER_PROTOCOL_SCHEMA_VERSION,
        "kind": PEER_REQUEST_KIND,
        "endpoint_id": endpoint["endpoint_id"],
        "route_operation": endpoint["route_operation"],
        "sender": sender,
        "recipient": recipient,
        **bindings,
    }
    value = dict(material)
    value["request_hash"] = sha256_value(material)
    return value


def normalize_peer_probe_request(value, endpoint, sender, recipient, bindings):
    endpoint = require_endpoint(endpoint, "expected endpoint")
    expected_sender = public_claim_from_runtime(sender, "expected sender")
    expected_recipient = public_claim_from_runtime(recipient, "expected recipient")
    bindings = require_bindings(bindings, "expected bindings")
    value = require_exact_keys(value, REQUEST_KEYS, "peer probe request")
    material = dict(value)
    request_hash = material.pop("request_hash")
    normalized = {
        "schema_version": require_schema_version(
            value["schema_version"], "peer probe request.schema_version"
        ),
        "kind": value["kind"],
        "endpoint_id": require_token(value["endpoint_id"], "peer probe request.endpoint_id"),
        "route_operation": require_token(
            value["route_operation"], "peer probe request.route_operation"
        ),
        "sender": public_service_claim(value["sender"], "peer probe request.sender"),
        "recipient": public_service_claim(value["recipient"], "peer probe request.recipient"),
        **require_bindings(
            {
                "install_binding_hash": value["install_binding_hash"],
                "run_binding_hash": value["run_binding_hash"],
                "substrate_abi_hash": value["substrate_abi_hash"],
            },
            "peer probe request bindings",
        ),
    }
    if (
        normalized["schema_version"] != PEER_PROTOCOL_SCHEMA_VERSION
        or normalized["kind"] != PEER_REQUEST_KIND
        or normalized["endpoint_id"] != endpoint["endpoint_id"]
        or normalized["route_operation"] != endpoint["route_operation"]
        or normalized["sender"] != expected_sender
        or normalized["recipient"] != expected_recipient
        or {
            key: normalized[key]
            for key in ("install_binding_hash", "run_binding_hash", "substrate_abi_hash")
        }
        != bindings
        or sha256_value(normalized) != require_sha256(
            request_hash, "peer probe request.request_hash"
        )
    ):
        raise PeerProtocolError("peer probe request does not match the frozen peer binding")
    normalized["request_hash"] = request_hash
    return normalized


def create_peer_probe_response(request):
    request = require_exact_keys(request, REQUEST_KEYS, "normalized peer probe request")
    material = {
        "schema_version": PEER_PROTOCOL_SCHEMA_VERSION,
        "kind": PEER_RESPONSE_KIND,
        "status": PEER_RESPONSE_STATUS,
        "endpoint_id": request["endpoint_id"],
        "route_operation": request["route_operation"],
        "sender": request["sender"],
        "recipient": request["recipient"],
        "install_binding_hash": request["install_binding_hash"],
        "run_binding_hash": request["run_binding_hash"],
        "substrate_abi_hash": request["substrate_abi_hash"],
        "request_hash": request["request_hash"],
    }
    value = dict(material)
    value["response_hash"] = sha256_value(material)
    return value


def normalize_peer_probe_response(value, request):
    request = require_exact_keys(request, REQUEST_KEYS, "expected peer probe request")
    value = require_exact_keys(value, RESPONSE_KEYS, "peer probe response")
    material = dict(value)
    response_hash = material.pop("response_hash")
    normalized = {
        "schema_version": require_schema_version(
            value["schema_version"], "peer probe response.schema_version"
        ),
        "kind": value["kind"],
        "status": value["status"],
        "endpoint_id": require_token(value["endpoint_id"], "peer probe response.endpoint_id"),
        "route_operation": require_token(
            value["route_operation"], "peer probe response.route_operation"
        ),
        "sender": public_service_claim(value["sender"], "peer probe response.sender"),
        "recipient": public_service_claim(value["recipient"], "peer probe response.recipient"),
        "install_binding_hash": require_sha256(
            value["install_binding_hash"], "peer probe response.install_binding_hash"
        ),
        "run_binding_hash": require_sha256(
            value["run_binding_hash"], "peer probe response.run_binding_hash"
        ),
        "substrate_abi_hash": require_sha256(
            value["substrate_abi_hash"], "peer probe response.substrate_abi_hash"
        ),
        "request_hash": require_sha256(value["request_hash"], "peer probe response.request_hash"),
    }
    if (
        normalized["schema_version"] != PEER_PROTOCOL_SCHEMA_VERSION
        or normalized["kind"] != PEER_RESPONSE_KIND
        or normalized["status"] != PEER_RESPONSE_STATUS
        or any(normalized[key] != request[key] for key in REQUEST_KEYS if key != "schema_version" and key != "kind")
        or sha256_value(normalized) != require_sha256(
            response_hash, "peer probe response.response_hash"
        )
    ):
        raise PeerProtocolError("peer probe response does not bind the authenticated request")
    normalized["response_hash"] = response_hash
    return normalized


def encode_canonical_frame(value):
    payload = canonical(value).encode("ascii")
    if len(payload) < 2 or len(payload) > MAX_FRAME_BYTES:
        raise PeerProtocolError("peer frame payload has an invalid size")
    return payload


def decode_canonical_frame(payload, label):
    if not isinstance(payload, bytes) or len(payload) < 2 or len(payload) > MAX_FRAME_BYTES:
        raise PeerProtocolError(label + " has an invalid size")
    try:
        text = payload.decode("ascii")
        value = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PeerProtocolError(label + " is not JSON") from error
    if canonical(value) != text:
        raise PeerProtocolError(label + " is not canonical JSON")
    return value


def receive_exact(connection, size, deadline):
    chunks = []
    remaining = size
    while remaining:
        timeout = deadline - time.monotonic()
        if timeout <= 0:
            raise PeerProtocolError("peer frame timed out")
        ready, _, _ = select.select([connection], [], [], timeout)
        if not ready:
            raise PeerProtocolError("peer frame timed out")
        block = connection.recv(remaining)
        if not block:
            raise PeerProtocolError("peer frame ended early")
        chunks.append(block)
        remaining -= len(block)
    return b"".join(chunks)


def read_single_frame(connection, timeout_seconds=PEER_TIMEOUT_SECONDS):
    timeout_seconds = require_timeout(timeout_seconds, "peer timeout")
    deadline = time.monotonic() + timeout_seconds
    header = receive_exact(connection, 4, deadline)
    size = struct.unpack("!I", header)[0]
    if size < 2 or size > MAX_FRAME_BYTES:
        raise PeerProtocolError("peer frame length is invalid")
    payload = receive_exact(connection, size, deadline)
    timeout = deadline - time.monotonic()
    if timeout <= 0:
        raise PeerProtocolError("peer frame timed out")
    ready, _, _ = select.select([connection], [], [], min(timeout, 0.1))
    if ready and connection.recv(1):
        raise PeerProtocolError("peer sent more than one frame")
    return payload


def send_frame(connection, payload):
    if not isinstance(payload, bytes) or len(payload) < 2 or len(payload) > MAX_FRAME_BYTES:
        raise PeerProtocolError("peer result frame has an invalid size")
    connection.sendall(struct.pack("!I", len(payload)) + payload)


def peer_credentials(connection):
    if not hasattr(socket, "SO_PEERCRED"):
        raise PeerProtocolError("P3.6 peer protocol requires Linux SO_PEERCRED")
    raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    return struct.unpack("3i", raw)


def cgroup_v2_matches(pid, expected_path):
    expected_path = require_cgroup_path(expected_path, "expected cgroup path")
    try:
        with open("/proc/{}/cgroup".format(pid), "r", encoding="utf-8") as source:
            lines = source.read(8192).splitlines()
    except OSError:
        return False
    return any(line == "0::" + expected_path for line in lines)


def peer_credentials_match(connection, expected_claim):
    expected_claim = runtime_service_claim(expected_claim, "expected peer claim")
    pid, uid, gid = peer_credentials(connection)
    if (
        pid != expected_claim["pid"]
        or uid != expected_claim["uid"]
        or gid != expected_claim["gid"]
        or not cgroup_v2_matches(pid, expected_claim["cgroup_path"])
    ):
        return None
    return {"pid": pid, "uid": uid, "gid": gid}
