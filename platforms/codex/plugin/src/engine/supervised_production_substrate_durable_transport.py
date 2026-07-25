#!/usr/bin/env python3
"""P3.6 durable Unix transport, intentionally separate from the P2b probe.

P2b is a small credential self-test with an 8 KiB one-probe ABI.  Durable
state needs different frame sizing, route semantics, request envelopes, and
responses, so this module does not import or share P2b protocol functions.
The OS peer credential is the authentication mechanism.  The ABI's
``authentication_proof_hash`` is a deterministic transcript binding, not a
bearer secret or a substitute for ``SO_PEERCRED`` plus cgroup verification.

The transport has no Engine, action descriptor, workspace path, permit, effect
or acceptance surface.  It accepts an already-root-created durable binding and
hands exact canonical payload bytes plus an envelope hash to the P3a state
core.
"""

import hashlib
import json
import math
import os
import select
import socket
import stat
import struct
import time

import supervised_production_substrate_durable as durable


TRANSPORT_SCHEMA_VERSION = 1
REQUEST_KIND = "p36_durable_transport_request"
RESPONSE_KIND = "p36_durable_transport_response"
TRANSCRIPT_KIND = "p36_durable_peer_transcript"
MAX_FRAME_BYTES = 524288
MAX_UNIX_SOCKET_PATH_BYTES = 107
FRAME_TIMEOUT_SECONDS = 5
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
SHA256_CHARS = frozenset("0123456789abcdef")
SERVICE_ROLES = ("worker", "broker", "receipt_verifier", "witness", "coordinator")
RUNTIME_CLAIM_FIELDS = (
    "role",
    "identity",
    "uid",
    "gid",
    "attestation_hash",
    "pid",
    "cgroup_path",
    "cgroup_binding_hash",
)
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
    "substrate_abi_hash",
    "substrate_plan_hash",
    "durable_abi_hash",
    "cohort_id",
    "generation",
    "issued_at_ms",
    "expires_at_ms",
    "nonce_hash",
    "authentication_proof_hash",
    "payload_hash",
)
REQUEST_FIELDS = ("schema_version", "kind", "envelope", "payload")
RESPONSE_FIELDS = (
    "schema_version",
    "kind",
    "request_envelope_hash",
    "request_hash",
    "response",
    "response_hash",
)
RESULT_COMMON_FIELDS = (
    "schema_version",
    "kind",
    "status",
    "code",
    "request_id",
    "operation",
    "install_binding_hash",
    "run_binding_hash",
    "substrate_abi_hash",
    "substrate_plan_hash",
    "durable_abi_hash",
    "cohort_id",
    "generation",
    "request_hash",
    "request_envelope_hash",
    "responder_role",
    "responder_identity",
    "responder_attestation_hash",
    "responder_cgroup_binding_hash",
    "owner_kernel_authority",
    "effect_authority",
    "broker_authority",
    "acceptance",
)
WITNESS_RESULT_FIELDS = RESULT_COMMON_FIELDS + (
    "stream_id", "head", "sequence", "records", "journal_hash", "result_hash",
)
COORDINATOR_RESULT_FIELDS = RESULT_COMMON_FIELDS + (
    "transaction_id", "fence", "state_hash", "journal_hash", "result_hash",
)
BROKER_RESULT_FIELDS = RESULT_COMMON_FIELDS + ("result_hash",)
REVOCATION_RESULT_FIELDS = RESULT_COMMON_FIELDS + ("broker_result_hash", "result_hash")


class DurableTransportError(Exception):
    pass


def fail(message):
    raise DurableTransportError(message)


def canonical(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    )


def sha256_value(value):
    if isinstance(value, str):
        value = value.encode("utf-8")
    elif not isinstance(value, bytes):
        value = canonical(value).encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def require_exact_keys(value, expected, label):
    if not isinstance(value, dict) or set(value) != set(expected):
        fail(label + " has an unexpected key set")
    return value


def require_token(value, label):
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 128
        or any(character not in TOKEN_CHARS for character in value)
    ):
        fail(label + " must be a bounded protocol token")
    return value


def require_sha256(value, label):
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in SHA256_CHARS for character in value)
    ):
        fail(label + " must be a lowercase SHA-256 digest")
    return value


def require_positive_int(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 9007199254740991:
        fail(label + " must be a positive safe integer")
    return value


def require_nonnegative_int(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 9007199254740991:
        fail(label + " must be a nonnegative safe integer")
    return value


def require_exact_int(value, expected, label):
    if isinstance(value, bool) or not isinstance(value, int) or value != expected:
        fail(label + " must be the exact frozen integer")
    return value


def require_timeout(value, label):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value <= 0
        or value > 30
    ):
        fail(label + " must be greater than zero and at most 30 seconds")
    return float(value)


def require_absolute_path(value, label):
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or value == "/"
        or value.startswith("//")
        or os.path.normpath(value) != value
    ):
        fail(label + " must be a canonical non-root absolute path")
    return value


def require_unix_socket_path(value, label):
    value = require_absolute_path(value, label)
    try:
        encoded = value.encode("ascii")
    except UnicodeEncodeError as error:
        raise DurableTransportError(label + " must be an ASCII Unix socket path") from error
    if len(encoded) > MAX_UNIX_SOCKET_PATH_BYTES:
        fail(label + " exceeds the Linux Unix socket path limit")
    return value


def require_cgroup_path(value, label):
    if not isinstance(value, str) or not value.startswith("/system.slice/"):
        fail(label + " must be an exact system.slice cgroup path")
    if value.count("/") != 2 or not value.endswith(".service"):
        fail(label + " must be an exact transient service cgroup path")
    return value


def _reject_duplicate_pairs(pairs):
    result = {}
    for key, item in pairs:
        if key in result:
            fail("durable transport JSON repeats an object key")
        result[key] = item
    return result


def _reject_surrogates(value):
    if isinstance(value, str):
        if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
            fail("durable transport JSON contains a lone Unicode surrogate")
    elif isinstance(value, dict):
        for key, item in value.items():
            _reject_surrogates(key)
            _reject_surrogates(item)
    elif isinstance(value, list):
        for item in value:
            _reject_surrogates(item)


def _reject_json_constant(value):
    raise ValueError("non-finite JSON constant: " + value)


def decode_canonical_json(raw, label, maximum=MAX_FRAME_BYTES):
    if not isinstance(raw, bytes) or not raw or len(raw) > maximum:
        fail(label + " has an invalid byte size")
    try:
        text = raw.decode("utf-8")
        value = json.loads(
            text,
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=_reject_json_constant,
        )
        _reject_surrogates(value)
        normalized = canonical(value).encode("utf-8")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, RecursionError, MemoryError) as error:
        raise DurableTransportError(label + " is not UTF-8 JSON: " + str(error)) from error
    if normalized != raw:
        fail(label + " is not canonical JSON")
    return value


def endpoint_by_id(endpoint_id):
    endpoint_id = require_token(endpoint_id, "durable endpoint id")
    matches = [item for item in DURABLE_ENDPOINTS if item["endpoint_id"] == endpoint_id]
    if len(matches) != 1:
        fail("durable endpoint is not part of the frozen topology")
    return dict(matches[0])


# Keep the endpoint table here instead of importing the P2b topology.  The
# durable contract owns this five-route semantic graph.
DURABLE_ENDPOINTS = (
    {
        "endpoint_id": "worker_broker",
        "sender_role": "worker",
        "recipient_role": "broker",
        "operations": ("mint_permit", "postclaim_authorize", "execute", "revoke"),
    },
    {
        "endpoint_id": "receipt_verifier_witness",
        "sender_role": "receipt_verifier",
        "recipient_role": "witness",
        "operations": ("appendIfHead", "appendBatchIfHead"),
    },
    {
        "endpoint_id": "receipt_verifier_coordinator",
        "sender_role": "receipt_verifier",
        "recipient_role": "coordinator",
        "operations": ("prepare", "cancel", "resolve"),
    },
    {
        "endpoint_id": "coordinator_witness",
        "sender_role": "coordinator",
        "recipient_role": "witness",
        "operations": ("getHead", "readback"),
    },
    {
        "endpoint_id": "broker_receipt_verifier",
        "sender_role": "broker",
        "recipient_role": "receipt_verifier",
        "operations": ("check_revocation",),
    },
)


def normalize_runtime_claim(raw, binding, role, label):
    value = require_exact_keys(raw, RUNTIME_CLAIM_FIELDS, label)
    service = binding["service_bindings"][role]
    normalized = {
        "role": require_token(value["role"], label + ".role"),
        "identity": require_token(value["identity"], label + ".identity"),
        "uid": require_positive_int(value["uid"], label + ".uid"),
        "gid": require_positive_int(value["gid"], label + ".gid"),
        "attestation_hash": require_sha256(value["attestation_hash"], label + ".attestation_hash"),
        "pid": require_positive_int(value["pid"], label + ".pid"),
        "cgroup_path": require_cgroup_path(value["cgroup_path"], label + ".cgroup_path"),
        "cgroup_binding_hash": require_sha256(
            value["cgroup_binding_hash"], label + ".cgroup_binding_hash"
        ),
    }
    if (
        normalized["role"] != role
        or normalized["identity"] != service["identity"]
        or normalized["uid"] != service["uid"]
        or normalized["gid"] != service["gid"]
        or normalized["attestation_hash"] != service["attestation_hash"]
        or normalized["cgroup_binding_hash"] != service["cgroup_binding_hash"]
        or normalized["cgroup_binding_hash"] != sha256_value(normalized["cgroup_path"])
    ):
        fail(label + " does not match the root-pinned durable service binding")
    return normalized


def normalize_runtime_services(raw, binding_raw):
    try:
        binding = durable.normalize_binding(binding_raw)
    except durable.DurableStateError as error:
        raise DurableTransportError("durable transport binding is invalid: " + str(error)) from error
    value = raw
    if not isinstance(value, dict) or not value or not set(value).issubset(SERVICE_ROLES):
        fail("durable runtime services have an invalid role set")
    normalized = {}
    seen = {"pid": set(), "cgroup_path": set()}
    for role in sorted(value):
        claim = normalize_runtime_claim(value[role], binding, role, "durable " + role + " runtime")
        for key in seen:
            if claim[key] in seen[key]:
                fail("durable runtime services do not retain independent " + key)
            seen[key].add(claim[key])
        normalized[role] = claim
    return binding, normalized


def endpoint_runtime_services(runtime_services, endpoint):
    try:
        sender = runtime_services[endpoint["sender_role"]]
        recipient = runtime_services[endpoint["recipient_role"]]
    except KeyError as error:
        raise DurableTransportError(
            "durable peer configuration omits a direct endpoint runtime claim: " + endpoint["endpoint_id"]
        ) from error
    return sender, recipient


def _public_transcript_claim(claim):
    return {
        "role": claim["role"],
        "identity": claim["identity"],
        "uid": claim["uid"],
        "gid": claim["gid"],
        "attestation_hash": claim["attestation_hash"],
        "pid": claim["pid"],
        "cgroup_binding_hash": claim["cgroup_binding_hash"],
    }


def authentication_proof_hash(binding, endpoint, sender, recipient, envelope_fields):
    """Return the non-secret transcript pin checked after OS authentication."""

    material = {
        "schema_version": TRANSPORT_SCHEMA_VERSION,
        "kind": TRANSCRIPT_KIND,
        "endpoint_id": endpoint["endpoint_id"],
        "sender": _public_transcript_claim(sender),
        "recipient": _public_transcript_claim(recipient),
        "request_id": envelope_fields["request_id"],
        "operation": envelope_fields["operation"],
        "install_binding_hash": binding["install_binding_hash"],
        "run_binding_hash": binding["run_binding_hash"],
        "substrate_abi_hash": binding["substrate_abi_hash"],
        "substrate_plan_hash": binding["substrate_plan_hash"],
        "durable_abi_hash": binding["durable_abi_hash"],
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "issued_at_ms": envelope_fields["issued_at_ms"],
        "expires_at_ms": envelope_fields["expires_at_ms"],
        "nonce_hash": envelope_fields["nonce_hash"],
        "payload_hash": envelope_fields["payload_hash"],
    }
    return sha256_value(canonical(material))


def normalize_envelope(binding, runtime_services, raw, payload, now_ms=None):
    value = require_exact_keys(raw, ENVELOPE_FIELDS, "durable transport envelope")
    require_exact_int(value["schema_version"], durable.SCHEMA_VERSION, "durable transport envelope schema")
    require_exact_int(value["protocol_version"], durable.SCHEMA_VERSION, "durable transport envelope protocol")
    endpoint = endpoint_by_id(value["endpoint_id"])
    sender, recipient = endpoint_runtime_services(runtime_services, endpoint)
    payload_canonical = canonical(payload)
    payload_hash = sha256_value(payload_canonical)
    normalized = {
        "schema_version": durable.SCHEMA_VERSION,
        "protocol_version": durable.SCHEMA_VERSION,
        "endpoint_id": endpoint["endpoint_id"],
        "request_id": require_token(value["request_id"], "durable request id"),
        "operation": require_token(value["operation"], "durable operation"),
        "sender_role": require_token(value["sender_role"], "durable sender role"),
        "sender_identity": require_token(value["sender_identity"], "durable sender identity"),
        "sender_attestation_hash": require_sha256(value["sender_attestation_hash"], "durable sender attestation"),
        "sender_cgroup_binding_hash": require_sha256(value["sender_cgroup_binding_hash"], "durable sender cgroup"),
        "recipient_role": require_token(value["recipient_role"], "durable recipient role"),
        "recipient_identity": require_token(value["recipient_identity"], "durable recipient identity"),
        "recipient_attestation_hash": require_sha256(value["recipient_attestation_hash"], "durable recipient attestation"),
        "recipient_cgroup_binding_hash": require_sha256(value["recipient_cgroup_binding_hash"], "durable recipient cgroup"),
        "install_binding_hash": require_sha256(value["install_binding_hash"], "durable install binding"),
        "run_binding_hash": require_sha256(value["run_binding_hash"], "durable run binding"),
        "substrate_abi_hash": require_sha256(value["substrate_abi_hash"], "durable substrate ABI"),
        "substrate_plan_hash": require_sha256(value["substrate_plan_hash"], "durable substrate plan"),
        "durable_abi_hash": require_sha256(value["durable_abi_hash"], "durable ABI"),
        "cohort_id": require_token(value["cohort_id"], "durable cohort id"),
        "generation": require_positive_int(value["generation"], "durable generation"),
        "issued_at_ms": require_nonnegative_int(value["issued_at_ms"], "durable issued time"),
        "expires_at_ms": require_positive_int(value["expires_at_ms"], "durable expiry time"),
        "nonce_hash": require_sha256(value["nonce_hash"], "durable nonce"),
        "authentication_proof_hash": require_sha256(
            value["authentication_proof_hash"], "durable authentication transcript"
        ),
        "payload_hash": require_sha256(value["payload_hash"], "durable payload hash"),
    }
    if normalized["operation"] not in endpoint["operations"]:
        fail("durable endpoint does not allow the requested operation")
    if not isinstance(payload, dict):
        fail("durable transport payload must be an object")
    if payload.get("request_id") != normalized["request_id"] or payload.get("operation") != normalized["operation"]:
        fail("durable envelope does not bind the payload request id and operation")
    if (
        normalized["sender_role"] != endpoint["sender_role"]
        or normalized["sender_identity"] != sender["identity"]
        or normalized["sender_attestation_hash"] != sender["attestation_hash"]
        or normalized["sender_cgroup_binding_hash"] != sender["cgroup_binding_hash"]
        or normalized["recipient_role"] != endpoint["recipient_role"]
        or normalized["recipient_identity"] != recipient["identity"]
        or normalized["recipient_attestation_hash"] != recipient["attestation_hash"]
        or normalized["recipient_cgroup_binding_hash"] != recipient["cgroup_binding_hash"]
        or any(
            normalized[key] != binding[key]
            for key in (
                "install_binding_hash",
                "run_binding_hash",
                "substrate_abi_hash",
                "substrate_plan_hash",
                "durable_abi_hash",
                "cohort_id",
                "generation",
            )
        )
        or normalized["payload_hash"] != payload_hash
    ):
        fail("durable transport envelope does not match the root-pinned cohort binding")
    if normalized["expires_at_ms"] <= normalized["issued_at_ms"]:
        fail("durable transport envelope expiry is invalid")
    if normalized["expires_at_ms"] - normalized["issued_at_ms"] > 60 * 1000:
        fail("durable transport envelope lifetime exceeds the frozen bound")
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    now_ms = require_nonnegative_int(now_ms, "durable transport clock")
    if normalized["issued_at_ms"] > now_ms + 1000 or now_ms >= normalized["expires_at_ms"]:
        fail("durable transport envelope is outside its active window")
    if normalized["authentication_proof_hash"] != authentication_proof_hash(
        binding, endpoint, sender, recipient, normalized
    ):
        fail("durable transport authentication transcript does not match the peer binding")
    return endpoint, normalized, payload_canonical.encode("utf-8")


def create_envelope(binding_raw, runtime_services_raw, endpoint_id, payload, now_ms=None, nonce_hash=None):
    binding, runtime_services = normalize_runtime_services(runtime_services_raw, binding_raw)
    endpoint = endpoint_by_id(endpoint_id)
    if not isinstance(payload, dict):
        fail("durable transport payload must be an object")
    request_id = require_token(payload.get("request_id"), "durable payload request id")
    operation = require_token(payload.get("operation"), "durable payload operation")
    if operation not in endpoint["operations"]:
        fail("durable endpoint does not allow the requested operation")
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    now_ms = require_nonnegative_int(now_ms, "durable transport clock")
    sender, recipient = endpoint_runtime_services(runtime_services, endpoint)
    value = {
        "schema_version": durable.SCHEMA_VERSION,
        "protocol_version": durable.SCHEMA_VERSION,
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
        "substrate_abi_hash": binding["substrate_abi_hash"],
        "substrate_plan_hash": binding["substrate_plan_hash"],
        "durable_abi_hash": binding["durable_abi_hash"],
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "issued_at_ms": now_ms,
        "expires_at_ms": now_ms + 60 * 1000,
        "nonce_hash": require_sha256(
            nonce_hash if nonce_hash is not None else sha256_value(os.urandom(32)), "durable nonce"
        ),
        "authentication_proof_hash": "0" * 64,
        "payload_hash": sha256_value(canonical(payload)),
    }
    value["authentication_proof_hash"] = authentication_proof_hash(
        binding, endpoint, sender, recipient, value
    )
    # Exercise the full verifier before returning a frame to a sender.
    normalize_envelope(binding, runtime_services, value, payload, now_ms=now_ms)
    return value


def encode_frame(value):
    raw = canonical(value).encode("utf-8")
    if not raw or len(raw) > MAX_FRAME_BYTES:
        fail("durable transport frame exceeds the fixed byte bound")
    return struct.pack("!I", len(raw)) + raw


def decode_frame(frame, label):
    if not isinstance(frame, bytes) or len(frame) < 5:
        fail(label + " has no complete frame")
    declared = struct.unpack("!I", frame[:4])[0]
    if declared == 0 or declared > MAX_FRAME_BYTES or len(frame) != declared + 4:
        fail(label + " has an invalid bounded frame length")
    return decode_canonical_json(frame[4:], label)


def _wait_for(descriptor, writable, deadline, label):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        fail(label + " timed out")
    readable, writeable, _ = select.select(
        [] if writable else [descriptor], [descriptor] if writable else [], [], remaining
    )
    if (writable and not writeable) or (not writable and not readable):
        fail(label + " timed out")


def _read_exact(connection, size, deadline, label):
    blocks = []
    remaining = size
    while remaining:
        _wait_for(connection, False, deadline, label)
        try:
            block = connection.recv(remaining)
        except OSError as error:
            raise DurableTransportError(label + " cannot be read: " + str(error)) from error
        if not block:
            fail(label + " ended before its frame was complete")
        blocks.append(block)
        remaining -= len(block)
    return b"".join(blocks)


def read_single_frame(connection, timeout_seconds=FRAME_TIMEOUT_SECONDS):
    timeout_seconds = require_timeout(timeout_seconds, "durable frame timeout")
    deadline = time.monotonic() + timeout_seconds
    header = _read_exact(connection, 4, deadline, "durable transport frame header")
    size = struct.unpack("!I", header)[0]
    if size == 0 or size > MAX_FRAME_BYTES:
        fail("durable transport frame length exceeds the fixed bound")
    payload = _read_exact(connection, size, deadline, "durable transport frame payload")
    # A persistent readable extra byte is an injected second frame/trailer.
    readable, _, _ = select.select([connection], [], [], 0)
    if readable:
        try:
            extra = connection.recv(1, socket.MSG_PEEK)
        except OSError as error:
            raise DurableTransportError("durable transport trailer cannot be inspected: " + str(error)) from error
        if extra:
            fail("durable transport connection contains trailing frame data")
    return header + payload


def send_frame(connection, frame, timeout_seconds=FRAME_TIMEOUT_SECONDS):
    if not isinstance(frame, bytes) or len(frame) < 5:
        fail("durable transport outbound frame is invalid")
    # Decode first to avoid a caller using this helper as an arbitrary stream.
    decode_frame(frame, "durable transport outbound frame")
    timeout_seconds = require_timeout(timeout_seconds, "durable frame timeout")
    deadline = time.monotonic() + timeout_seconds
    view = memoryview(frame)
    while view:
        _wait_for(connection, True, deadline, "durable transport frame write")
        try:
            written = connection.send(view)
        except OSError as error:
            raise DurableTransportError("durable transport frame cannot be written: " + str(error)) from error
        if written <= 0:
            fail("durable transport frame write made no progress")
        view = view[written:]


def peer_credentials(connection):
    if not hasattr(socket, "SO_PEERCRED"):
        fail("durable transport requires Linux SO_PEERCRED")
    try:
        raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        return struct.unpack("3i", raw)
    except OSError as error:
        raise DurableTransportError("durable transport cannot inspect peer credentials: " + str(error)) from error


def cgroup_v2_matches(pid, expected_path):
    try:
        with open("/proc/" + str(pid) + "/cgroup", "r", encoding="utf-8") as source:
            values = source.read(8192).splitlines()
    except OSError:
        return False
    return values == ["0::" + expected_path]


def peer_credentials_match(connection, expected):
    pid, uid, gid = peer_credentials(connection)
    if pid != expected["pid"] or uid != expected["uid"] or gid != expected["gid"]:
        return None
    if not cgroup_v2_matches(pid, expected["cgroup_path"]):
        return None
    return {"pid": pid, "uid": uid, "gid": gid}


def create_request(binding_raw, runtime_services_raw, endpoint_id, payload, now_ms=None, nonce_hash=None):
    envelope = create_envelope(
        binding_raw, runtime_services_raw, endpoint_id, payload, now_ms=now_ms, nonce_hash=nonce_hash
    )
    value = {
        "schema_version": TRANSPORT_SCHEMA_VERSION,
        "kind": REQUEST_KIND,
        "envelope": envelope,
        "payload": payload,
    }
    frame = encode_frame(value)
    # The sender validates the route's exact payload ABI too; otherwise a
    # Python boolean could survive envelope validation and reach a core that
    # treats ``True == 1`` differently from the frozen Node contract.
    decode_request(binding_raw, runtime_services_raw, frame, now_ms=now_ms)
    return value, frame


def decode_request(binding_raw, runtime_services_raw, frame, now_ms=None):
    binding, runtime_services = normalize_runtime_services(runtime_services_raw, binding_raw)
    value = decode_frame(frame, "durable transport request")
    require_exact_keys(value, REQUEST_FIELDS, "durable transport request")
    if (
        require_exact_int(value["schema_version"], TRANSPORT_SCHEMA_VERSION, "durable transport request schema")
        != TRANSPORT_SCHEMA_VERSION
        or value["kind"] != REQUEST_KIND
    ):
        fail("durable transport request has an unsupported schema or kind")
    endpoint, envelope, payload_bytes = normalize_envelope(
        binding, runtime_services, value["envelope"], value["payload"], now_ms=now_ms
    )
    decoded = {
        "binding": binding,
        "runtime_services": runtime_services,
        "endpoint": endpoint,
        "envelope": envelope,
        "envelope_hash": sha256_value(canonical(envelope)),
        "payload": value["payload"],
        "payload_bytes": payload_bytes,
        "request_hash": sha256_value(payload_bytes),
    }
    _normalize_response_request(binding, decoded)
    return decoded


def require_nullable_sha256(value, label):
    if value is None:
        return None
    return require_sha256(value, label)


def _normalize_response_request(binding, request):
    """Validate the exact request schema that determines a response schema.

    A listener's state core validates the same request before producing its
    response.  The sender repeats this narrow validation so a peer cannot turn
    an otherwise authenticated response into a different result family by
    exploiting an under-specified payload or an extra result field.
    """

    payload = request["payload"]
    endpoint_id = request["endpoint"]["endpoint_id"]
    operation = request["endpoint"]["operations"]
    if not isinstance(payload, dict):
        fail("durable response request payload must be an object")
    actual_operation = require_token(payload.get("operation"), "durable response request operation")
    if actual_operation not in operation:
        fail("durable response request operation is not allowed by its endpoint")
    common = {
        "schema_version": durable.SCHEMA_VERSION,
        "request_id": require_token(payload.get("request_id"), "durable response request id"),
        "operation": actual_operation,
        "substrate_plan_hash": require_sha256(
            payload.get("substrate_plan_hash"), "durable response request plan"
        ),
    }
    if (
        common["request_id"] != request["envelope"]["request_id"]
        or common["operation"] != request["envelope"]["operation"]
        or common["substrate_plan_hash"] != binding["substrate_plan_hash"]
    ):
        fail("durable response request does not match its envelope and cohort")

    if endpoint_id == "worker_broker":
        require_exact_keys(
            payload,
            {"schema_version", "request_id", "operation", "substrate_plan_hash"},
            "durable broker response request",
        )
    elif endpoint_id == "broker_receipt_verifier":
        require_exact_keys(
            payload,
            {"schema_version", "request_id", "operation", "broker_result_hash", "substrate_plan_hash"},
            "durable revocation response request",
        )
        if actual_operation != "check_revocation":
            fail("durable revocation response request has an invalid operation")
        common["broker_result_hash"] = require_sha256(
            payload["broker_result_hash"], "durable response broker result hash"
        )
    elif endpoint_id in {"receipt_verifier_witness", "coordinator_witness"}:
        if actual_operation == "appendIfHead":
            expected = {
                "schema_version", "request_id", "operation", "stream_id", "expected_head",
                "event_hash", "event_payload_hash", "substrate_plan_hash",
            }
        elif actual_operation == "appendBatchIfHead":
            expected = {
                "schema_version", "request_id", "operation", "stream_id", "expected_head",
                "events", "substrate_plan_hash",
            }
        elif actual_operation == "getHead":
            expected = {"schema_version", "request_id", "operation", "stream_id", "substrate_plan_hash"}
        elif actual_operation == "readback":
            expected = {
                "schema_version", "request_id", "operation", "stream_id", "from_sequence", "limit",
                "substrate_plan_hash",
            }
        else:
            fail("durable witness response request has an invalid operation")
        require_exact_keys(payload, expected, "durable witness response request")
        common["stream_id"] = require_token(payload["stream_id"], "durable response stream id")
        if actual_operation in {"appendIfHead", "appendBatchIfHead"}:
            common["expected_head"] = require_nullable_sha256(
                payload["expected_head"], "durable response expected head"
            )
        if actual_operation == "appendIfHead":
            common["events"] = [{
                "event_hash": require_sha256(payload["event_hash"], "durable response event hash"),
                "event_payload_hash": require_sha256(
                    payload["event_payload_hash"], "durable response event payload hash"
                ),
            }]
        elif actual_operation == "appendBatchIfHead":
            events = payload["events"]
            if not isinstance(events, list) or not events or len(events) > durable.MAX_BATCH_EVENTS:
                fail("durable response batch has an invalid event count")
            normalized_events = []
            seen = set()
            for index, event in enumerate(events):
                require_exact_keys(event, {"event_hash", "event_payload_hash"}, "durable response batch event")
                event_hash = require_sha256(event["event_hash"], "durable response batch event hash")
                if event_hash in seen:
                    fail("durable response batch repeats an event hash")
                seen.add(event_hash)
                normalized_events.append({
                    "event_hash": event_hash,
                    "event_payload_hash": require_sha256(
                        event["event_payload_hash"], "durable response batch payload hash"
                    ),
                })
            common["events"] = normalized_events
        elif actual_operation == "readback":
            common["from_sequence"] = require_positive_int(
                payload["from_sequence"], "durable response readback sequence"
            )
            limit = require_positive_int(payload["limit"], "durable response readback limit")
            if limit > durable.MAX_READBACK_LIMIT:
                fail("durable response readback limit exceeds the frozen bound")
            common["limit"] = limit
    elif endpoint_id == "receipt_verifier_coordinator":
        require_exact_keys(
            payload,
            {
                "schema_version", "request_id", "operation", "transaction_id", "fence",
                "expected_witness_head", "substrate_plan_hash",
            },
            "durable coordinator response request",
        )
        common["transaction_id"] = require_token(
            payload["transaction_id"], "durable response transaction id"
        )
        common["fence"] = require_positive_int(payload["fence"], "durable response fence")
        common["expected_witness_head"] = require_nullable_sha256(
            payload["expected_witness_head"], "durable response expected witness head"
        )
    else:
        fail("durable response request has an unknown endpoint")
    require_exact_int(
        payload.get("schema_version"), durable.SCHEMA_VERSION, "durable response request schema"
    )
    return common


def _response_schema(request):
    endpoint_id = request["endpoint"]["endpoint_id"]
    operation = request["envelope"]["operation"]
    if endpoint_id == "worker_broker":
        return BROKER_RESULT_FIELDS, "p36_durable_broker_result", {"disabled": "BROKER_EFFECTS_DISABLED"}
    if endpoint_id == "broker_receipt_verifier":
        return REVOCATION_RESULT_FIELDS, "p36_durable_revocation_result", {"unavailable": "REVOCATION_UNAVAILABLE"}
    if endpoint_id in {"receipt_verifier_witness", "coordinator_witness"}:
        if operation in {"appendIfHead", "appendBatchIfHead"}:
            return WITNESS_RESULT_FIELDS, "p36_durable_witness_result", {"recorded": "WITNESS_RECORDED"}
        return WITNESS_RESULT_FIELDS, "p36_durable_witness_result", {"available": "WITNESS_AVAILABLE"}
    if endpoint_id == "receipt_verifier_coordinator":
        allowed = {
            "prepare": {"prepared": "COORDINATOR_PREPARED"},
            "cancel": {
                "cancelled": "COORDINATOR_CANCELLED",
                "unknown": "COORDINATOR_RESOLVED_UNKNOWN",
            },
            "resolve": {
                "unavailable": "COORDINATOR_RESOLVED_UNAVAILABLE",
                "unknown": "COORDINATOR_RESOLVED_UNKNOWN",
            },
        }
        return COORDINATOR_RESULT_FIELDS, "p36_durable_coordinator_result", allowed[operation]
    fail("durable response has an unknown endpoint")


def _normalize_witness_receipt(raw, stream_id, label):
    value = require_exact_keys(
        raw,
        {"sequence", "event_hash", "event_payload_hash", "previous_head", "request_hash", "head"},
        label,
    )
    receipt = {
        "sequence": require_positive_int(value["sequence"], label + " sequence"),
        "event_hash": require_sha256(value["event_hash"], label + " event hash"),
        "event_payload_hash": require_sha256(value["event_payload_hash"], label + " event payload hash"),
        "previous_head": require_nullable_sha256(value["previous_head"], label + " previous head"),
        "request_hash": require_sha256(value["request_hash"], label + " request hash"),
        "head": require_sha256(value["head"], label + " head"),
    }
    head_material = dict(receipt)
    head_material.pop("head")
    expected_head = sha256_value({
        "schema_version": durable.SCHEMA_VERSION,
        "kind": "p36_durable_witness_receipt",
        "stream_id": stream_id,
        **head_material,
    })
    if receipt["head"] != expected_head:
        fail(label + " head is not bound to its event")
    return receipt


def _require_witness_result(response, request_payload):
    if (
        response["stream_id"] != request_payload["stream_id"]
        or require_nullable_sha256(response["head"], "durable witness result head") != response["head"]
        or require_nonnegative_int(response["sequence"], "durable witness result sequence") != response["sequence"]
        or require_sha256(response["journal_hash"], "durable witness result journal hash") != response["journal_hash"]
        or not isinstance(response["records"], list)
    ):
        fail("durable witness response has an invalid snapshot")
    if (response["sequence"] == 0) != (response["head"] is None):
        fail("durable witness response head does not match its sequence")
    records = [
        _normalize_witness_receipt(record, request_payload["stream_id"], "durable witness receipt " + str(index))
        for index, record in enumerate(response["records"])
    ]
    for index in range(1, len(records)):
        if (
            records[index]["sequence"] != records[index - 1]["sequence"] + 1
            or records[index]["previous_head"] != records[index - 1]["head"]
        ):
            fail("durable witness response receipts do not form a chain")
    operation = request_payload["operation"]
    if operation in {"appendIfHead", "appendBatchIfHead"}:
        expected_events = request_payload["events"]
        expected_length = len(expected_events)
        first_sequence = response["sequence"] - expected_length + 1
        previous_head = request_payload["expected_head"]
        expected_records = []
        for index, event in enumerate(expected_events):
            receipt = {
                "sequence": first_sequence + index,
                "event_hash": event["event_hash"],
                "event_payload_hash": event["event_payload_hash"],
                "previous_head": previous_head,
                "request_hash": response["request_hash"],
            }
            receipt["head"] = sha256_value({
                "schema_version": durable.SCHEMA_VERSION,
                "kind": "p36_durable_witness_receipt",
                "stream_id": request_payload["stream_id"],
                **receipt,
            })
            expected_records.append(receipt)
            previous_head = receipt["head"]
        if (
            response["status"] != "recorded"
            or first_sequence < 1
            or canonical(records) != canonical(expected_records)
            or previous_head != response["head"]
        ):
            fail("durable witness mutation response is not an exact receipt set")
    else:
        if response["status"] != "available" or (operation == "getHead" and records):
            fail("durable witness query response is invalid")
        if operation == "readback":
            expected_count = min(
                request_payload["limit"],
                max(0, response["sequence"] - request_payload["from_sequence"] + 1),
            )
            if (
                len(records) != expected_count
                or (expected_count > 0 and (
                    records[0]["sequence"] != request_payload["from_sequence"]
                    or records[-1]["sequence"] != request_payload["from_sequence"] + expected_count - 1
                    or (records[-1]["sequence"] == response["sequence"] and records[-1]["head"] != response["head"])
                ))
            ):
                fail("durable witness readback response is not the exact requested range")


def _require_coordinator_result(response, request_payload):
    if (
        response["transaction_id"] != request_payload["transaction_id"]
        or require_positive_int(response["fence"], "durable coordinator response fence") != request_payload["fence"]
        or require_sha256(response["journal_hash"], "durable coordinator journal hash") != response["journal_hash"]
    ):
        fail("durable coordinator response does not match the request")
    expected_state_hash = sha256_value({
        "transaction_id": request_payload["transaction_id"],
        "fence": request_payload["fence"],
        "expected_witness_head": request_payload["expected_witness_head"],
        "status": response["status"],
        "journal_hash": response["journal_hash"],
    })
    if require_sha256(response["state_hash"], "durable coordinator state hash") != expected_state_hash:
        fail("durable coordinator response state hash is not an immutable snapshot")


def _require_response_common(binding, request, response):
    if not isinstance(response, dict):
        fail("durable transport response payload must be an object")
    request_payload = _normalize_response_request(binding, request)
    fields, expected_kind, codes = _response_schema(request)
    require_exact_keys(response, fields, "durable transport response payload")
    recipient = binding["service_bindings"][request["endpoint"]["recipient_role"]]
    status = require_token(response["status"], "durable response status")
    code = require_token(response["code"], "durable response code")
    if (
        require_exact_int(response["schema_version"], durable.SCHEMA_VERSION, "durable response schema")
        != durable.SCHEMA_VERSION
        or response["kind"] != expected_kind
        or status not in codes
        or code != codes[status]
        or response["request_id"] != request_payload["request_id"]
        or response["operation"] != request_payload["operation"]
        or require_sha256(response["request_hash"], "durable response request hash") != request["request_hash"]
        or require_sha256(response["request_envelope_hash"], "durable response envelope hash") != request["envelope_hash"]
        or response["responder_role"] != recipient["role"]
        or response["responder_identity"] != recipient["identity"]
        or require_sha256(response["responder_attestation_hash"], "durable responder attestation") != recipient["attestation_hash"]
        or require_sha256(response["responder_cgroup_binding_hash"], "durable responder cgroup") != recipient["cgroup_binding_hash"]
        or response["owner_kernel_authority"] != "none"
        or response["effect_authority"] != "none"
        or response["broker_authority"] != "disabled"
        or response["acceptance"] != "not_available"
        or require_positive_int(response["generation"], "durable response generation") != binding["generation"]
        or any(
            response[key] != binding[key]
            for key in (
                "install_binding_hash",
                "run_binding_hash",
                "substrate_abi_hash",
                "substrate_plan_hash",
                "durable_abi_hash",
                "cohort_id",
            )
        )
    ):
        fail("durable transport response does not match its exact request and cohort")
    if request["endpoint"]["endpoint_id"] in {"receipt_verifier_witness", "coordinator_witness"}:
        _require_witness_result(response, request_payload)
    elif request["endpoint"]["endpoint_id"] == "receipt_verifier_coordinator":
        _require_coordinator_result(response, request_payload)
    elif request["endpoint"]["endpoint_id"] == "broker_receipt_verifier":
        if response["broker_result_hash"] != request_payload["broker_result_hash"]:
            fail("durable revocation response does not bind the broker result")
    material = dict(response)
    result_hash = material.pop("result_hash")
    if require_sha256(result_hash, "durable response result hash") != sha256_value(canonical(material)):
        fail("durable transport response result hash is invalid")


def create_response(request, response):
    _require_response_common(request["binding"], request, response)
    value = {
        "schema_version": TRANSPORT_SCHEMA_VERSION,
        "kind": RESPONSE_KIND,
        "request_envelope_hash": request["envelope_hash"],
        "request_hash": request["request_hash"],
        "response": response,
        "response_hash": sha256_value(canonical(response)),
    }
    return value, encode_frame(value)


def decode_response(request, frame):
    value = decode_frame(frame, "durable transport response")
    require_exact_keys(value, RESPONSE_FIELDS, "durable transport response")
    if (
        require_exact_int(value["schema_version"], TRANSPORT_SCHEMA_VERSION, "durable transport response schema")
        != TRANSPORT_SCHEMA_VERSION
        or value["kind"] != RESPONSE_KIND
    ):
        fail("durable transport response has an unsupported schema or kind")
    if (
        require_sha256(value["request_envelope_hash"], "durable response envelope hash")
        != request["envelope_hash"]
        or require_sha256(value["request_hash"], "durable response request hash") != request["request_hash"]
        or require_sha256(value["response_hash"], "durable response hash")
        != sha256_value(canonical(value["response"]))
    ):
        fail("durable transport response does not bind its exact request")
    _require_response_common(request["binding"], request, value["response"])
    return value["response"]


def serve_one(listener, binding_raw, runtime_services_raw, endpoint_id, handler, timeout_seconds=FRAME_TIMEOUT_SECONDS):
    """Serve exactly one request after authenticating the Unix peer first."""

    binding, runtime_services = normalize_runtime_services(runtime_services_raw, binding_raw)
    endpoint = endpoint_by_id(endpoint_id)
    sender, _recipient = endpoint_runtime_services(runtime_services, endpoint)
    timeout_seconds = require_timeout(timeout_seconds, "durable listener timeout")
    listener.settimeout(timeout_seconds)
    try:
        connection, _ = listener.accept()
    except OSError as error:
        raise DurableTransportError("durable listener did not accept a request: " + str(error)) from error
    try:
        # This must remain before *any* frame read or JSON parse.
        if peer_credentials_match(connection, sender) is None:
            fail("durable listener rejected an unexpected Linux peer before frame parsing")
        request = decode_request(binding, runtime_services, read_single_frame(connection, timeout_seconds))
        if request["endpoint"]["endpoint_id"] != endpoint["endpoint_id"]:
            fail("durable listener request does not match its bound endpoint")
        response = handler(request["payload_bytes"], request["envelope_hash"])
        _value, frame = create_response(request, response)
        send_frame(connection, frame, timeout_seconds)
        return request
    finally:
        connection.close()


def request_response(socket_path, binding_raw, runtime_services_raw, endpoint_id, payload, timeout_seconds=FRAME_TIMEOUT_SECONDS, now_ms=None):
    """Make one bounded durable request, verifying the recipient before write."""

    binding, runtime_services = normalize_runtime_services(runtime_services_raw, binding_raw)
    endpoint = endpoint_by_id(endpoint_id)
    _sender, recipient = endpoint_runtime_services(runtime_services, endpoint)
    socket_path = require_unix_socket_path(socket_path, "durable endpoint socket")
    request_value, outbound = create_request(
        binding, runtime_services, endpoint_id, payload, now_ms=now_ms
    )
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        connection.settimeout(require_timeout(timeout_seconds, "durable request timeout"))
        connection.connect(socket_path)
        if peer_credentials_match(connection, recipient) is None:
            fail("durable sender rejected an unexpected listener before frame write")
        send_frame(connection, outbound, timeout_seconds)
        request = decode_request(binding, runtime_services, outbound, now_ms=now_ms)
        response = decode_response(request, read_single_frame(connection, timeout_seconds))
        return request_value, response
    except OSError as error:
        raise DurableTransportError("durable request cannot connect to its endpoint: " + str(error)) from error
    finally:
        connection.close()


__all__ = [
    "DURABLE_ENDPOINTS",
    "DurableTransportError",
    "ENVELOPE_FIELDS",
    "FRAME_TIMEOUT_SECONDS",
    "MAX_FRAME_BYTES",
    "MAX_UNIX_SOCKET_PATH_BYTES",
    "REQUEST_KIND",
    "RESPONSE_KIND",
    "authentication_proof_hash",
    "canonical",
    "cgroup_v2_matches",
    "create_envelope",
    "create_request",
    "create_response",
    "decode_request",
    "decode_response",
    "encode_frame",
    "endpoint_by_id",
    "normalize_runtime_services",
    "peer_credentials_match",
    "read_single_frame",
    "request_response",
    "send_frame",
    "serve_one",
    "sha256_value",
]
