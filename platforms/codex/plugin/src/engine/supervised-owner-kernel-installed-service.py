#!/usr/bin/env python3
"""Role-local runner for the P3.7 U5 installed six-identity cohort.
Binds only root-predeclared listeners, authenticates peers with SO_PEERCRED +
cgroup + process-start identity, and exposes the fixed probe / semantic witness
surface. Engine sink and acceptance remain disabled.
"""
from __future__ import annotations
import argparse
import json
import os
import socket
import stat
import sys
import threading
import time
MODULE_DIRECTORY = os.path.dirname(os.path.realpath(__file__))
sys.dont_write_bytecode = True
if MODULE_DIRECTORY not in sys.path:
    sys.path.insert(0, MODULE_DIRECTORY)
import supervised_owner_kernel_installed as core
import supervised_owner_kernel_installed_transport as transport
SCHEMA_VERSION = 1
ROOT_CONFIG_MODE = 0o440
SOCKET_STAGING_MODE = 0o2710  # recipient-owned, sender-group writable for connect
SOCKET_MODE = 0o660
ACK_SOCKET_MODE = 0o660
MAX_CONFIG_BYTES = 131072
MAX_LIFECYCLE_SECONDS = 300
def fail(message):
    sys.stderr.write("supervised-owner-kernel-installed-service: " + message + "\n")
    raise SystemExit(2)
def canonical(value):
    return transport.canonical(value)
def sha256_value(value):
    return transport.sha256_value(value)
def require_exact_identity(uid, gid):
    if os.geteuid() != uid or os.getegid() != gid:
        fail("installed service process does not match its configured identity")
    try:
        groups = set(os.getgroups())
    except OSError as error:
        fail("installed service groups cannot be inspected: " + str(error))
    if groups != {gid}:
        fail("installed service process has unexpected supplementary groups")
def require_exact_directory(path, uid, gid, mode, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o7777) != mode
    ):
        fail(label + " does not have the expected ownership and mode")
def require_exact_socket(path, uid, gid, mode, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISSOCK(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o777) != mode
    ):
        fail(label + " does not have the expected ownership and mode")
def decode_root_group_json(raw, label):
    if not isinstance(raw, (bytes, bytearray)) or len(raw) < 2 or not raw.endswith(b"\n"):
        fail(label + " is not bounded newline-terminated JSON")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text[:-1])
        if canonical(value) + "\n" != text:
            fail(label + " is not canonical")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
        fail(label + " is not canonical JSON")
    return value
def read_root_group_json(path, expected_gid, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid not in (0, expected_gid)
        or (info.st_mode & 0o777) not in (0o440, 0o400, 0o600)
        or info.st_nlink != 1
        or info.st_size <= 0
        or info.st_size > MAX_CONFIG_BYTES
    ):
        fail(label + " is not a root-owned config file")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(descriptor, MAX_CONFIG_BYTES + 1)
    finally:
        os.close(descriptor)
    if len(raw) > MAX_CONFIG_BYTES:
        fail(label + " exceeds the byte limit")
    return decode_root_group_json(raw, label)
def read_bootstrap(path):
    value = read_root_group_json(path, os.getegid(), "installed bootstrap")
    required = {
        "schema_version",
        "kind",
        "role",
        "identity",
        "uid",
        "gid",
        "attestation_hash",
        "release_path",
        "release_token",
        "ready_path",
        "ack_socket_path",
        "quiesce_path",
        "quiesce_token",
        "peer_config_path",
        "state_leaf",
        "release_timeout_seconds",
        "hold_seconds",
        "endpoints",
        "bootstrap_hash",}
    if set(value) != required:
        fail("installed bootstrap has an unexpected key set")
    if value["schema_version"] != SCHEMA_VERSION or value["kind"] != "p37_installed_service_bootstrap":
        fail("installed bootstrap schema/kind is unsupported")
    if value["role"] not in core.SERVICE_ROLES:
        fail("installed bootstrap role is invalid")
    material = dict(value)
    material.pop("bootstrap_hash", None)
    if sha256_value(material) != value["bootstrap_hash"]:
        fail("installed bootstrap hash is invalid")
    return value
def wait_for_token(path, expected_token, expected_gid, timeout_seconds, label):
    deadline = time.monotonic() + float(timeout_seconds)
    while time.monotonic() < deadline:
        if os.path.lexists(path):
            try:
                info = os.lstat(path)
                if (
                    not stat.S_ISLNK(info.st_mode)
                    and stat.S_ISREG(info.st_mode)
                    and info.st_uid == 0
                    and info.st_gid in (0, expected_gid)
                ):
                    with open(path, "rb") as source:
                        raw = source.read(4096)
                    if raw.decode("utf-8").strip() == expected_token:
                        return
            except OSError:
                pass
        time.sleep(0.025)
    fail(label + " token did not appear before its deadline")
def bind_listener(endpoint, bootstrap):
    socket_path = endpoint["socket_path"]
    parent = os.path.dirname(socket_path)
    sender_gid = endpoint.get("sender_gid")
    if not isinstance(sender_gid, int) or sender_gid < 1:
        fail(endpoint["endpoint_id"] + " endpoint omits its sender gid")
    require_exact_directory(
        parent,
        bootstrap["uid"],
        sender_gid,
        SOCKET_STAGING_MODE,
        endpoint["endpoint_id"] + " socket parent",)
    if os.path.lexists(socket_path):
        os.unlink(socket_path)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(socket_path)
    os.chmod(socket_path, SOCKET_MODE)
    listener.listen(16)
    listener.settimeout(1.0)
    require_exact_socket(
        socket_path,
        bootstrap["uid"],
        sender_gid,
        SOCKET_MODE,
        endpoint["endpoint_id"] + " socket",)
    return listener
def write_ready(bootstrap, listener_ids):
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p37_installed_listener_ready",
        "role": bootstrap["role"],
        "identity": bootstrap["identity"],
        "pid": os.getpid(),
        "uid": bootstrap["uid"],
        "gid": bootstrap["gid"],
        "bootstrap_hash": bootstrap["bootstrap_hash"],
        "listener_endpoint_ids": list(listener_ids),}
    ready = dict(material, ready_hash=sha256_value(material))
    path = bootstrap["ready_path"]
    temporary = path + ".pending"
    with open(temporary, "wb") as handle:
        handle.write((canonical(ready) + "\n").encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    os.chmod(path, 0o600)
    return ready
def normalize_peer_config(bootstrap):
    value = read_root_group_json(bootstrap["peer_config_path"], bootstrap["gid"], "installed peer config")
    if value.get("schema_version") != SCHEMA_VERSION or value.get("kind") != "p37_installed_peer_config":
        fail("installed peer config schema/kind is unsupported")
    if value.get("role") != bootstrap["role"] or value.get("identity") != bootstrap["identity"]:
        fail("installed peer config does not match the bootstrap identity")
    binding = core.normalize_binding(value["binding"], expected_abi_hash=value["binding"]["installed_abi_hash"])
    runtime = value.get("runtime_services")
    if not isinstance(runtime, dict):
        fail("installed peer config runtime_services is invalid")
    for role, claim in runtime.items():
        if role not in core.SERVICE_ROLES:
            fail("installed peer config includes an unknown role")
        required = {
            "role",
            "identity",
            "uid",
            "gid",
            "attestation_hash",
            "pid",
            "starttime",
            "cgroup_path",
            "cgroup_binding_hash",}
        if set(claim) != required:
            fail("installed runtime claim has an unexpected key set")
        if claim["role"] != role:
            fail("installed runtime claim role drifted")
        if claim["starttime"] is None or not isinstance(claim["starttime"], int) or claim["starttime"] < 0:
            fail("installed runtime claim starttime is invalid")
        if sha256_value(claim["cgroup_path"]) != claim["cgroup_binding_hash"]:
            fail("installed runtime claim cgroup hash is invalid")
    if not transport.cgroup_v2_matches(os.getpid(), runtime[bootstrap["role"]]["cgroup_path"]):
        fail("installed service cgroup does not match the peer config claim")
    if runtime[bootstrap["role"]]["pid"] != os.getpid():
        fail("installed service pid does not match the peer config claim")
    observed_start = transport.read_process_starttime(os.getpid())
    if (
        observed_start is None
        or int(observed_start) != int(runtime[bootstrap["role"]]["starttime"])
    ):
        fail("installed service starttime does not match the peer config claim")
    authority_claim = value.get("authority_claim")
    if authority_claim is not None:
        if not isinstance(authority_claim, dict):
            fail("installed peer config authority_claim is invalid")
        required_claim = {
            "claim_hash",
            "cohort_id",
            "generation",
            "run_binding_hash",
            "handoff_hash",}
        if set(authority_claim) != required_claim:
            fail("installed peer config authority_claim has an unexpected key set")
        if (
            authority_claim["cohort_id"] != binding["cohort_id"]
            or int(authority_claim["generation"]) != int(binding["generation"])
            or authority_claim["run_binding_hash"] != binding["run_binding_hash"]
        ):
            fail("installed peer config authority_claim drifted from the binding")
        if bootstrap["role"] not in ("kernel", "broker"):
            fail("authority_claim is only permitted for kernel and broker peer configs")
    elif bootstrap["role"] in ("kernel", "broker"):
        fail("kernel/broker peer config is missing the exclusive authority_claim")
    return {
        "binding": binding,
        "runtime_services": runtime,
        "endpoints": value.get("endpoints") or bootstrap["endpoints"],
        "role": bootstrap["role"],
        "authority_claim": authority_claim,}
def _authority_claim_matches(payload, expected):
    if not isinstance(expected, dict):
        return False
    try:
        generation = int(payload.get("generation"))
    except (TypeError, ValueError):
        return False
    return (
        payload.get("claim_hash") == expected.get("claim_hash")
        and payload.get("cohort_id") == expected.get("cohort_id")
        and generation == int(expected.get("generation"))
        and payload.get("run_binding_hash") == expected.get("run_binding_hash")
        and payload.get("handoff_hash") == expected.get("handoff_hash"))
def _authority_result(status, code, **extra):
    result = {
        "status": status,
        "code": code,
        "effect_replayed": False,
        "authority": dict(core.AUTHORITY),}
    result.update(extra)
    return result
def handler_for_role(role, binding, state, peer_config=None):
    nonce_fence = core.NonceFence()
    def handle(request):
        operation = request["payload"]["operation"]
        if operation in core.FORBIDDEN_OPERATIONS:
            fail("forbidden operation reached the service handler")
        if role == "broker":
            if operation == "execute_probe":
                authorization_id = request["payload"].get("authorization_id")
                if (
                    not authorization_id
                    or authorization_id not in state["authorizations"]
                    or not _authority_claim_matches(request["payload"], state["authorizations"][authorization_id])
                ):
                    return _authority_result("failed", "PROBE_UNAUTHORIZED")
                if authorization_id in state["consumed"]:
                    return _authority_result("failed", "PROBE_REPLAY")
                claim = state["authorizations"][authorization_id]
                state["consumed"].add(authorization_id)
                record = state["sentinel"].toggle(authorization_id)
                receipt = {
                    "effect_id": "effect-" + str(len(state["consumed"])),
                    "catalog_id": core.FIXED_PROBE_CATALOG_ID,
                    "operation": core.FIXED_PROBE_OPERATION,
                    "prior_state_hash": record["prior_hash"],
                    "new_state_hash": record["current_hash"],
                    "authorization_id": authorization_id,
                    "claim_hash": claim["claim_hash"],
                    "restored": False,}
                state["receipt_store"].put(receipt)
                state["receipts"][receipt["effect_id"]] = receipt
                return _authority_result(
                    "completed", "PROBE_EXECUTED",
                    receipt=receipt, claim_hash=claim["claim_hash"], claim_consumed=True,)
            if operation == "cancel_probe":
                restore = state["sentinel"].restore_last()
                return _authority_result(
                    "completed", "PROBE_RESTORED",
                    sentinel_restored=restore.get("sentinel_restored") is True,
                    restored_hash=restore.get("restored_hash") or restore.get("state_hash"),)
            if operation == "mint_permit":
                return _authority_result(
                    "authorized", "PROBE_AUTHORIZED",
                    authorization_id="permit-" + request["envelope"]["request_id"],)
            if operation == "postclaim_authorize":
                expected = state.get("authority_claim")
                if not _authority_claim_matches(request["payload"], expected):
                    return _authority_result("failed", "PROBE_UNAUTHORIZED")
                claim_hash = expected["claim_hash"]
                if state.get("claim_consumed") is True or claim_hash in state["consumed_claims"]:
                    return _authority_result("failed", "PROBE_REPLAY", claim_hash=claim_hash)
                state["claim_consumed"] = True
                state["consumed_claims"].add(claim_hash)
                authorization_id = "authorization-" + claim_hash[:24]
                state["authorizations"][authorization_id] = dict(expected)
                return _authority_result(
                    "authorized", "PROBE_AUTHORIZED",
                    authorization_id=authorization_id, claim_hash=claim_hash, claim_consumed=True,
                    cohort_id=expected["cohort_id"], generation=expected["generation"],
                    run_binding_hash=expected["run_binding_hash"],)
        if role == "receipt_verifier":
            if operation in ("verify_effect", "verify_cancellation"):
                effect_id = request["payload"].get("effect_id")
                receipt = state["receipt_store"].get(effect_id) if effect_id else None
                if receipt is None and effect_id:
                    receipt = state["receipts"].get(effect_id)
                observed = state["sentinel"].observe()
                if operation == "verify_cancellation":
                    verified = bool(receipt and observed["state_hash"] == receipt.get("prior_state_hash"))
                    return _authority_result(
                        "completed" if verified else "failed",
                        "PROBE_RESTORED" if verified else "PROBE_MISMATCH",
                        verified=verified, observed_state_hash=observed["state_hash"],)
                verified = bool(receipt and receipt["new_state_hash"] == observed["state_hash"])
                if verified and isinstance(receipt, dict):
                    effect_receipt_hash = sha256_value(receipt)
                    verification = {
                        "effect_id": receipt.get("effect_id"), "verified": True,
                        "observed_state_hash": observed["state_hash"],
                        "effect_receipt_hash": effect_receipt_hash,
                        "claim_hash": receipt.get("claim_hash"),
                        "authorization_id": receipt.get("authorization_id"),}
                    verification_hash = sha256_value(verification)
                    state["last_verification"] = {
                        **verification, "verification_hash": verification_hash, "receipt": receipt,}
                    return _authority_result(
                        "completed", "PROBE_VERIFIED", verified=True,
                        observed_state_hash=observed["state_hash"],
                        effect_receipt_hash=effect_receipt_hash,
                        verification_hash=verification_hash,
                        claim_hash=receipt.get("claim_hash"),
                        authorization_id=receipt.get("authorization_id"),)
                state["last_verification"] = None
                return _authority_result(
                    "failed", "PROBE_MISMATCH", verified=False,
                    observed_state_hash=observed["state_hash"],)
            if operation == "verify_receipt":
                return {"status": "verified", "code": "RECEIPT_VERIFIED", "verified": True, "effect_replayed": False}
            if operation == "semantic_append":
                last = state.get("last_verification")
                if not isinstance(last, dict) or last.get("verified") is not True:
                    return _authority_result("failed", "PROBE_NOT_VERIFIED")
                payload = request["payload"]
                for field in (
                    "claim_hash", "authorization_id", "effect_id",
                    "effect_receipt_hash", "verification_hash",
                ):
                    if payload.get(field) != last.get(field):
                        return _authority_result("failed", "SEMANTIC_BINDING_MISMATCH")
                if peer_config is None:
                    fail("semantic_append requires peer config for witness routing")
                cohort = binding["cohort_id"]
                stream_id = "probe-stream-" + cohort
                event_payload = {
                    "kind": "p37_installed_semantic_probe_event",
                    "catalog_id": core.FIXED_PROBE_CATALOG_ID,
                    "cohort_id": cohort,
                    "run_binding_hash": binding["run_binding_hash"],
                    "claim_hash": last["claim_hash"],
                    "authorization_id": last["authorization_id"],
                    "effect_id": last["effect_id"],
                    "effect_receipt_hash": last["effect_receipt_hash"],
                    "verification_hash": last["verification_hash"],}
                event_payload_hash = sha256_value(event_payload)
                event_hash = sha256_value({"event_payload_hash": event_payload_hash, "stream_id": stream_id})
                _request, witness_result = transport.request_response(
                    transport.endpoint_socket_path(peer_config["endpoints"], "receipt_verifier_witness"),
                    binding, peer_config["runtime_services"], "receipt_verifier_witness",
                    {
                        "operation": "appendIfHead", "request_id": "semantic-append-" + cohort,
                        "stream_id": stream_id, "expected_head": None,
                        "event_hash": event_hash, "event_payload_hash": event_payload_hash,
                    },
                    timeout_seconds=transport.FRAME_TIMEOUT_SECONDS,)
                if witness_result.get("code") != "WITNESS_RECORDED":
                    return _authority_result("failed", witness_result.get("code") or "WITNESS_APPEND_FAILED")
                state["last_semantic_event"] = {
                    "event_hash": event_hash, "event_payload_hash": event_payload_hash,
                    "stream_id": stream_id, "head": witness_result.get("head"),
                    "sequence": witness_result.get("sequence"),
                    "claim_hash": last["claim_hash"], "authorization_id": last["authorization_id"],
                    "effect_receipt_hash": last["effect_receipt_hash"],
                    "verification_hash": last["verification_hash"],}
                return _authority_result(
                    "recorded", "WITNESS_RECORDED",
                    head=witness_result.get("head"), sequence=witness_result.get("sequence"),
                    event_hash=event_hash, event_payload_hash=event_payload_hash,
                    claim_hash=last["claim_hash"], authorization_id=last["authorization_id"],
                    effect_receipt_hash=last["effect_receipt_hash"],
                    verification_hash=last["verification_hash"],)
            if operation == "semantic_readback":
                last_event = state.get("last_semantic_event")
                if not isinstance(last_event, dict) or not last_event.get("event_hash"):
                    return _authority_result("failed", "SEMANTIC_EVENT_MISSING")
                if peer_config is None:
                    fail("semantic_readback requires peer config for witness routing")
                _request, witness_result = transport.request_response(
                    transport.endpoint_socket_path(peer_config["endpoints"], "receipt_verifier_witness"),
                    binding, peer_config["runtime_services"], "receipt_verifier_witness",
                    {
                        "operation": "readback",
                        "request_id": "semantic-readback-" + binding["cohort_id"],
                        "stream_id": last_event["stream_id"],
                    },
                    timeout_seconds=transport.FRAME_TIMEOUT_SECONDS,)
                records = witness_result.get("records") if isinstance(witness_result, dict) else None
                if not isinstance(records, list) or not records:
                    return _authority_result("failed", "WITNESS_READBACK_EMPTY")
                if witness_result.get("head") != last_event.get("head"):
                    return _authority_result("failed", "WITNESS_HEAD_DRIFT")
                if not any(item.get("event_hash") == last_event["event_hash"] for item in records):
                    return _authority_result("failed", "WITNESS_RECORD_MISSING")
                if not any(item.get("head") == last_event.get("head") for item in records):
                    return _authority_result("failed", "WITNESS_RECEIPT_MISSING")
                return _authority_result(
                    "available", "WITNESS_AVAILABLE",
                    head=witness_result.get("head"), sequence=witness_result.get("sequence"),
                    records=records, event_hash=last_event["event_hash"],
                    claim_hash=last_event.get("claim_hash"),
                    authorization_id=last_event.get("authorization_id"),
                    effect_receipt_hash=last_event.get("effect_receipt_hash"),
                    verification_hash=last_event.get("verification_hash"),)
        if role == "witness":
            stream = state["streams"].setdefault(
                request["payload"].get("stream_id", "default"), {"head": None, "records": []},)
            if operation == "appendIfHead":
                if request["payload"].get("expected_head") != stream["head"]:
                    return {"status": "stale", "code": "WITNESS_STALE_HEAD", "head": stream["head"]}
                receipt = {
                    "sequence": len(stream["records"]) + 1,
                    "event_hash": request["payload"]["event_hash"],
                    "event_payload_hash": request["payload"]["event_payload_hash"],
                    "previous_head": stream["head"],}
                receipt["head"] = sha256_value(receipt)
                stream["records"].append(receipt)
                stream["head"] = receipt["head"]
                return {
                    "status": "recorded", "code": "WITNESS_RECORDED",
                    "head": stream["head"], "sequence": receipt["sequence"], "records": [receipt],}
            if operation in ("getHead", "readback"):
                return {
                    "status": "available", "code": "WITNESS_AVAILABLE",
                    "head": stream["head"], "sequence": len(stream["records"]),
                    "records": [] if operation == "getHead" else list(stream["records"]),}
        if role == "coordinator":
            if operation == "prepare":
                return {"status": "prepared", "code": "COORDINATOR_PREPARED", "acceptance": "not_available"}
            if operation == "cancel":
                return {"status": "cancelled", "code": "COORDINATOR_CANCELLED", "acceptance": "not_available"}
            if operation == "resolve":
                return {
                    "status": "unavailable", "code": "ACCEPTANCE_DISABLED",
                    "acceptance": "not_available", "engine_sink": "disabled",}
        if role == "kernel" and operation in (
            "run_probe", "capability_probe", "semantic_append", "semantic_readback",
        ):
            return _authority_result("accepted", "KERNEL_ROUTED")
        if role == "worker":
            return {"status": "delegated", "code": "WORKER_NO_DIRECT_APPEND", "authority": dict(core.AUTHORITY)}
        return {"status": "rejected", "code": "OPERATION_FORBIDDEN", "effect_replayed": False}
    def serve_connection(connection, endpoint, peer_config):
        try:
            endpoint_id = endpoint["endpoint_id"]
            endpoint_def = transport.endpoint_by_id(endpoint_id)
            sender = peer_config["runtime_services"][endpoint_def["sender_role"]]
            expected = {
                "pid": sender["pid"],
                "uid": sender["uid"],
                "gid": sender["gid"],
                "cgroup_path": sender["cgroup_path"],
                "starttime": sender["starttime"],}
            if not transport.peer_credentials_match(connection, expected):
                return
            frame = transport.read_single_frame(connection, timeout_seconds=transport.FRAME_TIMEOUT_SECONDS)
            request = transport.decode_request(peer_config["binding"], frame, nonce_fence=nonce_fence)
            if request["envelope"]["endpoint_id"] != endpoint_id:
                return
            result = handle(request)
            response = transport.create_response(request, result)
            transport.send_frame(connection, transport.encode_frame(response))
        except (transport.InstalledTransportError, core.InstalledError, OSError):
            return
        finally:
            try:
                connection.close()
            except OSError:
                pass
    return serve_connection, handle
def write_ack(bootstrap, peer_config, evidence, phase="probe_complete"):
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p37_installed_service_ack",
        "phase": phase,
        "role": bootstrap["role"],
        "identity": bootstrap["identity"],
        "pid": os.getpid(),
        "uid": bootstrap["uid"],
        "gid": bootstrap["gid"],
        "bootstrap_hash": bootstrap["bootstrap_hash"],
        "binding_hash": core.normalized_binding_hash(peer_config["binding"]),
        "evidence": evidence,
        "authority": dict(core.AUTHORITY),}
    ack = dict(material, ack_hash=sha256_value(material))
    return ack
def send_ack(bootstrap, peer_config, evidence, phase):
    ack = write_ack(bootstrap, peer_config, evidence, phase=phase)
    require_exact_socket(
        bootstrap["ack_socket_path"],
        0,
        bootstrap["gid"],
        ACK_SOCKET_MODE,
        "installed acknowledgement socket",)
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        connection.settimeout(5)
        connection.connect(bootstrap["ack_socket_path"])
        transport.send_frame(connection, transport.encode_frame(ack))
        confirmation = connection.recv(1)
        if confirmation != b"\x01":
            fail("installed acknowledgement socket did not return root confirmation")
    finally:
        connection.close()
    return ack
def self_probe_specs(role, binding, authority_claim=None):
    cohort = binding["cohort_id"]
    def spec(endpoint_id, operation, code, payload=None, **flags):
        body = {"operation": operation, "request_id": "self-probe-" + operation + "-" + cohort}
        if payload:
            body.update(payload)
        item = {"endpoint_id": endpoint_id, "payload": body, "expected_code": code}
        item.update(flags)
        return item
    if role == "kernel":
        if not isinstance(authority_claim, dict):
            fail("kernel self-probe requires the exclusive authority claim")
        claim_fields = {
            "claim_hash": authority_claim["claim_hash"],
            "cohort_id": authority_claim["cohort_id"],
            "generation": authority_claim["generation"],
            "run_binding_hash": authority_claim["run_binding_hash"],
            "handoff_hash": authority_claim["handoff_hash"],}
        return [
            spec("kernel_broker", "postclaim_authorize", "PROBE_AUTHORIZED", claim_fields,
                 require_claim_consumed=True),
            spec("kernel_broker", "execute_probe", "PROBE_EXECUTED",
                 {"authorization_id": None, **claim_fields},
                 uses_authorization=True, require_claim_consumed=True),
            spec("kernel_receipt_verifier", "verify_effect", "PROBE_VERIFIED",
                 {"effect_id": None}, uses_effect_id=True, capture_verification=True),
            spec("kernel_receipt_verifier", "semantic_append", "WITNESS_RECORDED", {
                "effect_id": None, "authorization_id": None,
                "claim_hash": claim_fields["claim_hash"],
                "effect_receipt_hash": None, "verification_hash": None,
            }, uses_semantic_binding=True, require_witness_receipt=True, require_semantic_binding=True),
            spec("kernel_receipt_verifier", "semantic_readback", "WITNESS_AVAILABLE",
                 require_readback_records=True, require_semantic_binding=True),
            spec("kernel_broker", "cancel_probe", "PROBE_RESTORED"),]
    if role == "worker":
        return [spec("worker_broker", "mint_permit", "PROBE_AUTHORIZED")]
    if role == "receipt_verifier":
        return [spec("receipt_verifier_coordinator", "resolve", "ACCEPTANCE_DISABLED", {
            "transaction_id": "self-tx-" + cohort, "fence": 1,
            "expected_witness_head": None, "substrate_plan_hash": binding["run_binding_hash"],
        })]
    if role == "coordinator":
        return [spec("coordinator_witness", "getHead", "WITNESS_AVAILABLE",
                     {"stream_id": "probe-stream-" + cohort})]
    return []
def run_self_probes(role, peer_config):
    evidence = []
    authorization_id = effect_id = claim_hash = witness_head = None
    effect_receipt_hash = verification_hash = semantic_event_hash = None
    deadline = time.monotonic() + min(float(peer_config.get("hold_seconds", 30)), 30)
    authority_claim = peer_config.get("authority_claim")
    for spec in self_probe_specs(role, peer_config["binding"], authority_claim=authority_claim):
        payload = dict(spec["payload"])
        if spec.get("uses_authorization"):
            if not authorization_id:
                fail("installed self-probe missing authorization for execute")
            payload["authorization_id"] = authorization_id
        if spec.get("uses_effect_id"):
            if not effect_id:
                fail("installed self-probe missing effect id for verify")
            payload["effect_id"] = effect_id
        if spec.get("uses_semantic_binding"):
            if not effect_id or not authorization_id or not effect_receipt_hash or not verification_hash:
                fail("installed self-probe missing post-verification binding for semantic append")
            payload.update({
                "effect_id": effect_id, "authorization_id": authorization_id,
                "effect_receipt_hash": effect_receipt_hash, "verification_hash": verification_hash,
            })
            if claim_hash:
                payload["claim_hash"] = claim_hash
        if payload.get("operation") == "readback" and "expected_witness_head" in payload:
            payload["expected_witness_head"] = witness_head
        if payload.get("operation") == "resolve" and witness_head is not None:
            payload["expected_witness_head"] = witness_head
        socket_path = transport.endpoint_socket_path(peer_config["endpoints"], spec["endpoint_id"])
        last_error, result = None, None
        while time.monotonic() < deadline:
            try:
                if not os.path.lexists(socket_path):
                    last_error = transport.InstalledTransportError("socket absent: " + socket_path)
                    time.sleep(0.05)
                    continue
                _request, result = transport.request_response(
                    socket_path, peer_config["binding"], peer_config["runtime_services"],
                    spec["endpoint_id"], payload,
                    timeout_seconds=min(transport.FRAME_TIMEOUT_SECONDS, max(0.1, deadline - time.monotonic())),)
                break
            except transport.InstalledTransportError as error:
                last_error = error
                time.sleep(0.05)
        if result is None:
            fail("installed self-probe timed out on " + spec["endpoint_id"] + ": " + str(last_error))
        if result.get("code") != spec["expected_code"]:
            fail("installed self-probe unexpected code on " + spec["endpoint_id"] + ": " + str(result.get("code")))
        if spec.get("require_claim_consumed"):
            if result.get("claim_consumed") is not True or not result.get("claim_hash"):
                fail("installed broker did not consume the exclusive claim")
            claim_hash = result["claim_hash"]
        if spec.get("capture_verification"):
            if result.get("verified") is not True:
                fail("installed effect verification did not confirm the effect")
            if not result.get("effect_receipt_hash") or not result.get("verification_hash"):
                fail("installed effect verification missing binding hashes")
            effect_receipt_hash = result["effect_receipt_hash"]
            verification_hash = result["verification_hash"]
            if result.get("authorization_id"):
                authorization_id = result["authorization_id"]
            if result.get("claim_hash"):
                claim_hash = result["claim_hash"]
        if spec.get("require_witness_receipt"):
            if not result.get("head") or not result.get("sequence"):
                fail("installed witness append did not return a durable receipt")
            witness_head = result["head"]
            if result.get("event_hash"):
                semantic_event_hash = result["event_hash"]
        if spec.get("require_readback_records"):
            records = result.get("records")
            if not isinstance(records, list) or not records:
                fail("installed witness readback returned no authenticated records")
            if witness_head and result.get("head") != witness_head:
                fail("installed witness readback head drifted from append receipt")
            if not any(item.get("head") == result.get("head") for item in records):
                fail("installed witness readback missing the append receipt")
            if semantic_event_hash and not any(item.get("event_hash") == semantic_event_hash for item in records):
                fail("installed witness readback missing the exact semantic event record")
        if spec.get("require_semantic_binding"):
            if (
                result.get("claim_hash") != claim_hash
                or result.get("authorization_id") != authorization_id
                or result.get("effect_receipt_hash") != effect_receipt_hash
                or result.get("verification_hash") != verification_hash
            ):
                fail("installed semantic evidence drifted from claim/effect verification binding")
        if result.get("authorization_id") and not spec.get("capture_verification"):
            authorization_id = result["authorization_id"]
        if isinstance(result.get("receipt"), dict) and result["receipt"].get("effect_id"):
            effect_id = result["receipt"]["effect_id"]
        item = {
            "endpoint_id": spec["endpoint_id"], "operation": payload["operation"],
            "code": result["code"], "authority": dict(core.AUTHORITY),}
        if claim_hash and spec.get("require_claim_consumed"):
            item["claim_hash"] = claim_hash
            item["claim_consumed"] = True
        if result.get("head"):
            item["witness_head"] = result["head"]
        if result.get("sequence") is not None:
            item["witness_sequence"] = result["sequence"]
        if isinstance(result.get("records"), list):
            item["readback_count"] = len(result["records"])
        if result.get("event_hash"):
            item["event_hash"] = result["event_hash"]
        if spec.get("require_semantic_binding") or spec.get("capture_verification"):
            for key in ("claim_hash", "authorization_id", "effect_receipt_hash", "verification_hash"):
                if result.get(key):
                    item[key] = result[key]
        evidence.append(item)
    return evidence
def start_listener_threads(listeners, peer_config, serve):
    stop = threading.Event()
    errors = []
    def loop(endpoint, listener):
        while not stop.is_set():
            try:
                connection, _address = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                if stop.is_set():
                    return
                continue
            try:
                serve(connection, endpoint, peer_config)
            except Exception as error:  # pragma: no cover - listener fail-closed
                errors.append(error)
                stop.set()
                return
    threads = []
    for endpoint, listener in listeners:
        thread = threading.Thread(target=loop, args=(endpoint, listener), daemon=True)
        thread.start()
        threads.append(thread)
    return {"stop": stop, "threads": threads, "errors": errors}
def stop_listener_threads(context, listeners):
    context["stop"].set()
    for _endpoint, listener in listeners:
        try:
            listener.close()
        except OSError:
            pass
    for thread in context["threads"]:
        thread.join(transport.FRAME_TIMEOUT_SECONDS + 1)
def run(args):
    bootstrap = read_bootstrap(args.bootstrap_config)
    require_exact_identity(bootstrap["uid"], bootstrap["gid"])
    wait_for_token(
        bootstrap["release_path"],
        bootstrap["release_token"],
        bootstrap["gid"],
        bootstrap["release_timeout_seconds"],
        "release",)
    listener_endpoints = [
        endpoint
        for endpoint in bootstrap["endpoints"]
        if endpoint["recipient_role"] == bootstrap["role"]]
    listeners = []
    for endpoint in listener_endpoints:
        listeners.append((endpoint, bind_listener(endpoint, bootstrap)))
    write_ready(bootstrap, [endpoint["endpoint_id"] for endpoint, _listener in listeners])
    deadline = time.monotonic() + float(bootstrap["release_timeout_seconds"])
    peer_config = None
    while time.monotonic() < deadline:
        if os.path.lexists(bootstrap["peer_config_path"]):
            try:
                peer_config = normalize_peer_config(bootstrap)
                break
            except SystemExit:
                raise
            except Exception:
                pass
        time.sleep(0.025)
    if peer_config is None:
        fail("peer config was not published before the deadline")
    probe_root = bootstrap.get("state_leaf") or os.path.join("/tmp", "p37i-" + bootstrap["identity"])
    state = {
        "sentinel": core.ProbeSentinel(probe_root, peer_config["binding"]["cohort_id"]),
        "receipt_store": core.ProbeReceiptStore(probe_root),
        "consumed": set(),
        "consumed_claims": set(),
        "authorizations": {},
        "authority_claim": peer_config.get("authority_claim"),
        "claim_consumed": False,
        "receipts": {},
        "streams": {},}
    serve, _handle = handler_for_role(
        bootstrap["role"], peer_config["binding"], state, peer_config=peer_config)
    listener_context = start_listener_threads(listeners, peer_config, serve)
    evidence = []
    try:
        time.sleep(0.1)
        evidence = run_self_probes(bootstrap["role"], peer_config)
        if listener_context["errors"]:
            fail("installed listener failed during self-probe: " + str(listener_context["errors"][0]))
        send_ack(bootstrap, peer_config, evidence, phase="probe_complete")
        stop_at = time.monotonic() + float(bootstrap["hold_seconds"])
        while time.monotonic() < stop_at:
            if os.path.lexists(bootstrap["quiesce_path"]):
                try:
                    with open(bootstrap["quiesce_path"], "rb") as source:
                        token = source.read(4096).decode("utf-8").strip()
                    if token == bootstrap["quiesce_token"]:
                        break
                except OSError:
                    pass
            if listener_context["errors"]:
                fail("installed listener failed during hold: " + str(listener_context["errors"][0]))
            time.sleep(0.025)
    finally:
        stop_listener_threads(listener_context, listeners)
    if bootstrap["role"] in ("broker", "receipt_verifier"):
        state["sentinel"].restore_last()
    send_ack(bootstrap, peer_config, evidence, phase="quiesced")
def parser():
    root = argparse.ArgumentParser()
    root.add_argument("--bootstrap-config", required=True)
    return root
def main():
    try:
        args = parser().parse_args()
        run(args)
        return 0
    except SystemExit as error:
        if isinstance(error.code, int):
            return error.code
        return 2
    except Exception as error:  # pragma: no cover - fail-closed service boundary
        sys.stderr.write("supervised-owner-kernel-installed-service: " + str(error) + "\n")
        return 2
if __name__ == "__main__":
    raise SystemExit(main())
