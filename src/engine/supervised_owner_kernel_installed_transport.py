#!/usr/bin/env python3
"""P3.7 U5 installed Unix transport.
Bounded framed IPC with SO_PEERCRED, process-start identity, exact cgroup checks,
nonce/TTL/replay fences, and explicit timeouts. Does not accept caller-controlled
commands, paths, tools, catalog rows, receipt roots, UIDs, units, or cgroups.
"""
from __future__ import annotations
import hashlib
import json
import os
import select
import socket
import struct
import time
import supervised_owner_kernel_installed as installed
TRANSPORT_SCHEMA_VERSION = 1
REQUEST_KIND = "p37_installed_transport_request"
RESPONSE_KIND = "p37_installed_transport_response"
TRANSCRIPT_KIND = "p37_installed_peer_transcript"
MAX_FRAME_BYTES = installed.MAX_FRAME_BYTES
MAX_UNIX_SOCKET_PATH_BYTES = 107
FRAME_TIMEOUT_SECONDS = 5
SERVICE_ROLES = installed.SERVICE_ROLES
INSTALLED_ENDPOINTS = (
    {
        "endpoint_id": "kernel_broker",
        "sender_role": "kernel",
        "recipient_role": "broker",
        "operations": ("execute_probe", "cancel_probe", "mint_permit", "postclaim_authorize"),
    },
    {
        "endpoint_id": "kernel_receipt_verifier",
        "sender_role": "kernel",
        "recipient_role": "receipt_verifier",
        "operations": (
            "verify_effect",
            "verify_cancellation",
            "verify_receipt",
            "semantic_append",
            "semantic_readback",
        ),
    },
    {
        "endpoint_id": "receipt_verifier_witness",
        "sender_role": "receipt_verifier",
        "recipient_role": "witness",
        "operations": ("appendIfHead", "appendBatchIfHead", "getHead", "readback"),
    },
    {
        "endpoint_id": "coordinator_witness",
        "sender_role": "coordinator",
        "recipient_role": "witness",
        "operations": ("getHead", "readback"),
    },
    {
        "endpoint_id": "receipt_verifier_coordinator",
        "sender_role": "receipt_verifier",
        "recipient_role": "coordinator",
        "operations": ("prepare", "cancel", "resolve"),
    },
    {
        "endpoint_id": "worker_broker",
        "sender_role": "worker",
        "recipient_role": "broker",
        "operations": ("mint_permit", "postclaim_authorize", "execute_probe", "cancel_probe"),
    },)
ENVELOPE_FIELDS = (
    "schema_version",
    "protocol_version",
    "endpoint_id",
    "request_id",
    "operation",
    "sender_role",
    "sender_identity",
    "sender_attestation_hash",
    "sender_cgroup_binding_hash",
    "recipient_role",
    "recipient_identity",
    "recipient_attestation_hash",
    "recipient_cgroup_binding_hash",
    "install_binding_hash",
    "run_binding_hash",
    "installed_abi_hash",
    "cohort_id",
    "generation",
    "issued_at_ms",
    "expires_at_ms",
    "nonce_hash",
    "authentication_proof_hash",
    "payload_hash",)
class InstalledTransportError(Exception):
    def __init__(self, message, code="INSTALLED_TRANSPORT_ERROR"):
        super().__init__(message)
        self.code = code
def fail(message, code="INSTALLED_TRANSPORT_ERROR"):
    raise InstalledTransportError(message, code)
def canonical(value):
    return installed.canonical(value)
def sha256_value(value):
    return installed.sha256_value(value)
def endpoint_by_id(endpoint_id):
    for endpoint in INSTALLED_ENDPOINTS:
        if endpoint["endpoint_id"] == endpoint_id:
            return endpoint
    fail("installed endpoint is unknown")
def peer_credentials(connection):
    if not hasattr(socket, "SO_PEERCRED"):
        fail("SO_PEERCRED is unavailable on this host")
    try:
        creds = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    except OSError as error:
        raise InstalledTransportError("peer credentials unavailable: " + str(error)) from error
    pid, uid, gid = struct.unpack("3i", creds)
    if pid <= 0:
        fail("peer pid is invalid")
    return pid, uid, gid
def cgroup_v2_matches(pid, expected_path):
    try:
        with open("/proc/" + str(pid) + "/cgroup", "r", encoding="utf-8") as source:
            values = source.read(8192).splitlines()
    except OSError:
        return False
    return values == ["0::" + expected_path]
def read_process_starttime(pid):
    """Return /proc/<pid>/stat starttime (field 22). UID/GID alone is insufficient."""
    try:
        with open("/proc/" + str(pid) + "/stat", "r", encoding="utf-8") as source:
            raw = source.read(8192)
    except OSError:
        return None
    close = raw.rfind(")")
    if close < 0:
        return None
    tail = raw[close + 1 :].split()
    if len(tail) < 20:
        return None
    try:
        return int(tail[19])
    except ValueError:
        return None
def process_start_identity_matches(pid, expected_uid, expected_gid, expected_starttime=None):
    try:
        with open("/proc/" + str(pid) + "/status", "r", encoding="utf-8") as source:
            values = source.read(16384).splitlines()
    except OSError:
        return False
    fields = {}
    for line in values:
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key] = value.split()
    try:
        uids = [int(item) for item in fields["Uid"]]
        gids = [int(item) for item in fields["Gid"]]
        groups = {int(item) for item in fields.get("Groups", [])}
    except (KeyError, ValueError):
        return False
    if not (uids == [expected_uid] * 4 and gids == [expected_gid] * 4 and groups == {expected_gid}):
        return False
    if expected_starttime is not None:
        observed = read_process_starttime(pid)
        if observed is None or int(observed) != int(expected_starttime):
            return False
    return True
def peer_credentials_match(connection, expected):
    pid, uid, gid = peer_credentials(connection)
    if (
        pid != expected["pid"]
        or uid != expected["uid"]
        or gid != expected["gid"]
        or not cgroup_v2_matches(pid, expected["cgroup_path"])
        or not process_start_identity_matches(
            pid,
            expected["uid"],
            expected["gid"],
            expected.get("starttime"),)
    ):
        return False
    if "starttime" not in expected or expected["starttime"] is None:
        return False
    return True
def authentication_proof_hash(binding, endpoint, sender, recipient, envelope_fields):
    material = {
        "schema_version": TRANSPORT_SCHEMA_VERSION,
        "kind": TRANSCRIPT_KIND,
        "install_binding_hash": binding["install_binding_hash"],
        "run_binding_hash": binding["run_binding_hash"],
        "installed_abi_hash": binding["installed_abi_hash"],
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "endpoint_id": endpoint["endpoint_id"],
        "sender_role": sender["role"],
        "sender_identity": sender["identity"],
        "sender_attestation_hash": sender["attestation_hash"],
        "sender_cgroup_binding_hash": sender["cgroup_binding_hash"],
        "recipient_role": recipient["role"],
        "recipient_identity": recipient["identity"],
        "recipient_attestation_hash": recipient["attestation_hash"],
        "recipient_cgroup_binding_hash": recipient["cgroup_binding_hash"],
        "envelope": envelope_fields,}
    return sha256_value(material)
def create_envelope(binding, endpoint_id, payload, now_ms=None, nonce_hash=None):
    endpoint = endpoint_by_id(endpoint_id)
    if not isinstance(payload, dict) or "operation" not in payload:
        fail("installed transport payload must include an operation")
    operation = installed.require_operation_allowed(payload["operation"])
    if operation not in endpoint["operations"]:
        fail("operation is not allowed on this endpoint")
    if operation in installed.FORBIDDEN_OPERATIONS:
        fail("operation is forbidden", "OPERATION_FORBIDDEN")
    sender = binding["service_bindings"][endpoint["sender_role"]]
    recipient = binding["service_bindings"][endpoint["recipient_role"]]
    issued = int(time.time() * 1000) if now_ms is None else int(now_ms)
    expires = issued + installed.MAX_MESSAGE_LIFETIME_MILLISECONDS
    payload_hash = sha256_value(payload)
    nonce = nonce_hash or sha256_value(os.urandom(32).hex())
    request_id = payload.get("request_id") or ("req-" + nonce[:16])
    partial = {
        "schema_version": TRANSPORT_SCHEMA_VERSION,
        "protocol_version": installed.PROTOCOL_VERSION,
        "endpoint_id": endpoint["endpoint_id"],
        "request_id": request_id,
        "operation": operation,
        "sender_role": sender["role"],
        "sender_identity": sender["identity"],
        "sender_attestation_hash": sender["attestation_hash"],
        "sender_cgroup_binding_hash": sender["cgroup_binding_hash"],
        "recipient_role": recipient["role"],
        "recipient_identity": recipient["identity"],
        "recipient_attestation_hash": recipient["attestation_hash"],
        "recipient_cgroup_binding_hash": recipient["cgroup_binding_hash"],
        "install_binding_hash": binding["install_binding_hash"],
        "run_binding_hash": binding["run_binding_hash"],
        "installed_abi_hash": binding["installed_abi_hash"],
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "issued_at_ms": issued,
        "expires_at_ms": expires,
        "nonce_hash": nonce,
        "payload_hash": payload_hash,}
    proof = authentication_proof_hash(binding, endpoint, sender, recipient, partial)
    envelope = dict(partial, authentication_proof_hash=proof)
    return envelope
def encode_frame(value):
    body = (canonical(value) + "\n").encode("utf-8")
    if len(body) > MAX_FRAME_BYTES:
        fail("frame exceeds maximum size", "FRAME_TOO_LARGE")
    return struct.pack("!I", len(body)) + body
def decode_frame(frame, label="installed frame"):
    if not isinstance(frame, (bytes, bytearray)) or len(frame) < 4:
        fail(label + " is truncated", "FRAME_INVALID")
    size = struct.unpack("!I", frame[:4])[0]
    if size < 2 or size > MAX_FRAME_BYTES or len(frame) != size + 4:
        fail(label + " length is invalid", "FRAME_INVALID")
    body = frame[4:]
    if not body.endswith(b"\n"):
        fail(label + " is not newline-terminated", "FRAME_INVALID")
    try:
        text = body.decode("utf-8")
        value = json.loads(text[:-1])
        if canonical(value) + "\n" != text:
            fail(label + " is not canonical", "FRAME_INVALID")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError) as error:
        raise InstalledTransportError(label + " is not valid canonical JSON", "FRAME_INVALID") from error
    return value
def _wait_for(descriptor, writable, deadline, label):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        fail(label + " timed out", "IPC_TIMEOUT")
    readers = [] if writable else [descriptor]
    writers = [descriptor] if writable else []
    ready_r, ready_w, _ready_x = select.select(readers, writers, [], remaining)
    if writable and descriptor not in ready_w:
        fail(label + " timed out", "IPC_TIMEOUT")
    if not writable and descriptor not in ready_r:
        fail(label + " timed out", "IPC_TIMEOUT")
def _read_exact(connection, size, deadline, label):
    chunks = []
    remaining = size
    while remaining > 0:
        _wait_for(connection, False, deadline, label)
        chunk = connection.recv(remaining)
        if not chunk:
            fail(label + " closed early", "IPC_CLOSED")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)
def read_single_frame(connection, timeout_seconds=FRAME_TIMEOUT_SECONDS):
    """Read one bounded frame and return the raw header+body bytes.
    Callers decode via decode_frame / decode_request / decode_response. Returning
    raw bytes matches the durable transport contract and avoids double-decode.
    """
    deadline = time.monotonic() + float(timeout_seconds)
    header = _read_exact(connection, 4, deadline, "installed frame header")
    size = struct.unpack("!I", header)[0]
    if size < 2 or size > MAX_FRAME_BYTES:
        fail("installed frame size is invalid", "FRAME_INVALID")
    body = _read_exact(connection, size, deadline, "installed frame body")
    frame = header + body
    decode_frame(frame, "installed frame")
    return frame
def send_frame(connection, frame, timeout_seconds=FRAME_TIMEOUT_SECONDS):
    deadline = time.monotonic() + float(timeout_seconds)
    view = memoryview(frame)
    while len(view) > 0:
        _wait_for(connection, True, deadline, "installed frame send")
        sent = connection.send(view)
        if sent <= 0:
            fail("installed frame send failed", "IPC_CLOSED")
        view = view[sent:]
def create_request(binding, endpoint_id, payload, now_ms=None, nonce_hash=None):
    envelope = create_envelope(binding, endpoint_id, payload, now_ms=now_ms, nonce_hash=nonce_hash)
    return {
        "schema_version": TRANSPORT_SCHEMA_VERSION,
        "kind": REQUEST_KIND,
        "envelope": envelope,
        "payload": payload,}
def create_response(request, result):
    return {
        "schema_version": TRANSPORT_SCHEMA_VERSION,
        "kind": RESPONSE_KIND,
        "endpoint_id": request["envelope"]["endpoint_id"],
        "request_id": request["envelope"]["request_id"],
        "operation": request["envelope"]["operation"],
        "envelope": request["envelope"],
        "result": result,
        "result_hash": sha256_value(result),}
def decode_request(binding, frame, nonce_fence=None, now_ms=None):
    value = decode_frame(frame, "installed request")
    if value.get("schema_version") != TRANSPORT_SCHEMA_VERSION or value.get("kind") != REQUEST_KIND:
        fail("installed request has an unsupported schema or kind")
    envelope = value.get("envelope")
    payload = value.get("payload")
    if not isinstance(envelope, dict) or not isinstance(payload, dict):
        fail("installed request envelope/payload must be objects")
    if set(envelope) != set(ENVELOPE_FIELDS):
        fail("installed request envelope has an unexpected key set")
    endpoint = endpoint_by_id(envelope["endpoint_id"])
    operation = installed.require_operation_allowed(envelope["operation"])
    if operation not in endpoint["operations"]:
        fail("installed request operation is not allowed")
    if payload.get("operation") != operation:
        fail("installed request payload operation drifted")
    if sha256_value(payload) != envelope["payload_hash"]:
        fail("installed request payload hash mismatch")
    sender = binding["service_bindings"][endpoint["sender_role"]]
    recipient = binding["service_bindings"][endpoint["recipient_role"]]
    for field, expected in (
        ("sender_role", sender["role"]),
        ("sender_identity", sender["identity"]),
        ("sender_attestation_hash", sender["attestation_hash"]),
        ("sender_cgroup_binding_hash", sender["cgroup_binding_hash"]),
        ("recipient_role", recipient["role"]),
        ("recipient_identity", recipient["identity"]),
        ("recipient_attestation_hash", recipient["attestation_hash"]),
        ("recipient_cgroup_binding_hash", recipient["cgroup_binding_hash"]),
        ("install_binding_hash", binding["install_binding_hash"]),
        ("run_binding_hash", binding["run_binding_hash"]),
        ("installed_abi_hash", binding["installed_abi_hash"]),
        ("cohort_id", binding["cohort_id"]),
        ("generation", binding["generation"]),
    ):
        if envelope.get(field) != expected:
            fail("installed request envelope does not match the binding: " + field)
    observed = int(time.time() * 1000) if now_ms is None else int(now_ms)
    issued = envelope["issued_at_ms"]
    expires = envelope["expires_at_ms"]
    if (
        not isinstance(issued, int)
        or not isinstance(expires, int)
        or expires <= issued
        or expires - issued > installed.MAX_MESSAGE_LIFETIME_MILLISECONDS
        or issued > observed + installed.MAX_FUTURE_SKEW_MILLISECONDS
        or expires <= observed
    ):
        fail("installed request is outside its clock window", "ENVELOPE_EXPIRED")
    partial = dict(envelope)
    partial.pop("authentication_proof_hash", None)
    expected_proof = authentication_proof_hash(binding, endpoint, sender, recipient, partial)
    if envelope["authentication_proof_hash"] != expected_proof:
        fail("installed request authentication proof is invalid")
    if nonce_fence is not None:
        nonce_fence.observe(envelope["nonce_hash"])
    return {
        "schema_version": TRANSPORT_SCHEMA_VERSION,
        "kind": REQUEST_KIND,
        "envelope": envelope,
        "payload": payload,}
def decode_response(request, frame):
    value = decode_frame(frame, "installed response")
    if value.get("schema_version") != TRANSPORT_SCHEMA_VERSION or value.get("kind") != RESPONSE_KIND:
        fail("installed response has an unsupported schema or kind")
    if (
        value.get("endpoint_id") != request["envelope"]["endpoint_id"]
        or value.get("request_id") != request["envelope"]["request_id"]
        or value.get("operation") != request["envelope"]["operation"]
    ):
        fail("installed response does not bind its request")
    result = value.get("result")
    if not isinstance(result, dict):
        fail("installed response result must be an object")
    if value.get("result_hash") != sha256_value(result):
        fail("installed response result hash is invalid")
    return result
def endpoint_socket_path(endpoints, endpoint_id):
    matches = [item for item in endpoints if item.get("endpoint_id") == endpoint_id]
    if len(matches) != 1:
        fail("installed endpoint socket is absent from the peer config")
    path = matches[0].get("socket_path")
    if not isinstance(path, str) or not path.startswith("/") or len(path.encode("utf-8")) > MAX_UNIX_SOCKET_PATH_BYTES:
        fail("installed endpoint socket path is invalid")
    return path
def request_response(
    socket_path,
    binding,
    runtime_services,
    endpoint_id,
    payload,
    timeout_seconds=FRAME_TIMEOUT_SECONDS,
    now_ms=None,
):
    """Issue one bounded request after authenticating the recipient peer."""
    endpoint = endpoint_by_id(endpoint_id)
    recipient = runtime_services[endpoint["recipient_role"]]
    request = create_request(binding, endpoint_id, payload, now_ms=now_ms)
    frame = encode_frame(request)
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        connection.settimeout(float(timeout_seconds))
        connection.connect(socket_path)
        expected = {
            "pid": recipient["pid"],
            "uid": recipient["uid"],
            "gid": recipient["gid"],
            "cgroup_path": recipient["cgroup_path"],
            "starttime": recipient["starttime"],}
        if not peer_credentials_match(connection, expected):
            fail("installed sender rejected an unexpected recipient peer before frame write")
        send_frame(connection, frame, timeout_seconds=timeout_seconds)
        result = decode_response(
            request, read_single_frame(connection, timeout_seconds=timeout_seconds))
        return request, result
    except OSError as error:
        raise InstalledTransportError(
            "installed request cannot complete on " + endpoint_id + ": " + str(error)
        ) from error
    finally:
        try:
            connection.close()
        except OSError:
            pass
def serve_one(
    listener,
    binding,
    runtime_services,
    endpoint_id,
    handler,
    nonce_fence=None,
    timeout_seconds=FRAME_TIMEOUT_SECONDS,
):
    """Accept one connection, authenticate the endpoint sender role, then handle."""
    endpoint = endpoint_by_id(endpoint_id)
    sender = runtime_services[endpoint["sender_role"]]
    listener.settimeout(float(timeout_seconds))
    try:
        connection, _address = listener.accept()
    except OSError as error:
        raise InstalledTransportError("installed listener did not accept a request: " + str(error)) from error
    try:
        expected = {
            "pid": sender["pid"],
            "uid": sender["uid"],
            "gid": sender["gid"],
            "cgroup_path": sender["cgroup_path"],
            "starttime": sender["starttime"],}
        if not peer_credentials_match(connection, expected):
            fail("installed listener rejected an unexpected sender peer before frame parsing")
        request = decode_request(
            binding,
            read_single_frame(connection, timeout_seconds=timeout_seconds),
            nonce_fence=nonce_fence,)
        if request["envelope"]["endpoint_id"] != endpoint_id:
            fail("installed listener request does not match its bound endpoint")
        result = handler(request)
        response = create_response(request, result)
        send_frame(connection, encode_frame(response), timeout_seconds=timeout_seconds)
        return request
    finally:
        try:
            connection.close()
        except OSError:
            pass
