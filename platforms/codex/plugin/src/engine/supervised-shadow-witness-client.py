#!/usr/bin/python3 -I
"""Verifier/root client for the P3.5c separate-UID shadow witness.

The client has no P2 or Engine dependency. Its only public operations map to
the witness's four hash-only shadow methods.
"""

import hashlib
import json
import os
import socket
import stat
import struct
import sys


SCHEMA_VERSION = 1
WITNESS_PROTOCOL_VERSION = 1
MAX_PACKET_BYTES = 16384
SHA256_CHARS = frozenset("0123456789abcdef")
METHODS = frozenset(
    {
        "open_shadow",
        "append_shadow_observation",
        "read_shadow_record",
        "close_shadow_diagnostic",
    }
)


class ShadowWitnessClientError(Exception):
    pass


def fail(message):
    raise ShadowWitnessClientError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_value(value):
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def require_plain_object(value, label):
    if not isinstance(value, dict):
        fail(label + " must be an object")
    return value


def require_exact_keys(value, expected, label):
    value = require_plain_object(value, label)
    if set(value) != set(expected):
        fail(label + " has an unexpected key set")
    return value


def require_sha256(value, label):
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in SHA256_CHARS for character in value)
    ):
        fail(label + " must be a lowercase SHA-256 digest")
    return value


def require_nullable_sha256(value, label):
    if value is None:
        return None
    return require_sha256(value, label)


def require_nonnegative_int(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        fail(label + " must be a bounded integer")
    return value


def require_absolute_path(value, label):
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or value.startswith("//")
        or value == "/"
        or os.path.normpath(value) != value
        or "\x00" in value
    ):
        fail(label + " must be a canonical non-root absolute path")
    return value


def require_exact_directory(path, uid, gid, mode, label):
    path = require_absolute_path(path, label)
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
        fail(label + " does not have the expected identity and mode")
    return path


def require_exact_socket(path, uid, gid, mode, label):
    path = require_absolute_path(path, label)
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISSOCK(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o7777) != mode
    ):
        fail(label + " does not have the expected identity and mode")
    return path


def parse_canonical_packet(raw, label):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_PACKET_BYTES:
        fail(label + " has an invalid size")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(label + " is not UTF-8 JSON: " + str(error))
    if canonical(value) != text:
        fail(label + " is not canonical JSON")
    return value


def peer_credentials(connection):
    try:
        raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        return struct.unpack("3i", raw)
    except OSError as error:
        fail("shadow witness client cannot read peer credentials: " + str(error))


def send_packet(connection, value):
    raw = canonical(value).encode("utf-8")
    if not raw or len(raw) > MAX_PACKET_BYTES:
        fail("shadow witness request exceeds the fixed byte limit")
    try:
        written = connection.send(raw)
    except OSError as error:
        fail("shadow witness request write failed: " + str(error))
    if written != len(raw):
        fail("shadow witness request write was short")


def receive_packet(connection, label):
    try:
        raw, ancillary, flags, _address = connection.recvmsg(MAX_PACKET_BYTES + 1, 0)
    except OSError as error:
        fail(label + " socket read failed: " + str(error))
    if flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC):
        fail(label + " packet is truncated")
    if ancillary:
        fail(label + " must not contain descriptor ancillary data")
    return parse_canonical_packet(raw, label)


def normalize_capsule(value):
    value = require_exact_keys(
        value,
        {
            "schema_version",
            "shadow_admission_id",
            "ticket_hash",
            "capsule_hash",
            "observation_hash",
            "close_hash",
        },
        "shadow witness capsule",
    )
    if value["schema_version"] != SCHEMA_VERSION:
        fail("shadow witness capsule schema_version is unsupported")
    return {
        "schema_version": SCHEMA_VERSION,
        "shadow_admission_id": require_sha256(value["shadow_admission_id"], "shadow witness admission id"),
        "ticket_hash": require_sha256(value["ticket_hash"], "shadow witness ticket hash"),
        "capsule_hash": require_sha256(value["capsule_hash"], "shadow witness capsule hash"),
        "observation_hash": require_sha256(value["observation_hash"], "shadow witness observation hash"),
        "close_hash": require_sha256(value["close_hash"], "shadow witness close hash"),
    }


def normalize_response(value):
    value = require_plain_object(value, "shadow witness response")
    if set(value) == {"schema_version", "status", "reason"}:
        if value["schema_version"] != SCHEMA_VERSION or value["status"] != "rejected" or not isinstance(value["reason"], str):
            fail("shadow witness rejected response is invalid")
        fail("shadow witness rejected request: " + value["reason"])
    value = require_exact_keys(
        value,
        {
            "schema_version",
            "status",
            "shadow_admission_id",
            "ticket_hash",
            "capsule_hash",
            "observation_hash",
            "close_hash",
            "sequence",
            "previous_shadow_head",
            "shadow_chain_head",
            "idempotent",
            "continuation_token",
        },
        "shadow witness response",
    )
    if value["schema_version"] != SCHEMA_VERSION or value["status"] not in {
        "shadow_opened",
        "shadow_observed",
        "shadow_closed",
        "shadow_recovery_required",
    }:
        fail("shadow witness response status is invalid")
    return {
        "schema_version": SCHEMA_VERSION,
        "status": value["status"],
        "shadow_admission_id": require_sha256(value["shadow_admission_id"], "shadow witness response admission id"),
        "ticket_hash": require_sha256(value["ticket_hash"], "shadow witness response ticket hash"),
        "capsule_hash": require_sha256(value["capsule_hash"], "shadow witness response capsule hash"),
        "observation_hash": require_nullable_sha256(value["observation_hash"], "shadow witness response observation hash"),
        "close_hash": require_nullable_sha256(value["close_hash"], "shadow witness response close hash"),
        "sequence": require_nonnegative_int(value["sequence"], "shadow witness response sequence"),
        "previous_shadow_head": require_nullable_sha256(value["previous_shadow_head"], "shadow witness response previous head"),
        "shadow_chain_head": require_sha256(value["shadow_chain_head"], "shadow witness response chain head"),
        "idempotent": value["idempotent"] if isinstance(value["idempotent"], bool) else fail("shadow witness response idempotent must be boolean"),
        "continuation_token": value["continuation_token"]
        if value["continuation_token"] is None
        else value["continuation_token"]
        if isinstance(value["continuation_token"], str) and 0 < len(value["continuation_token"]) <= 128
        else fail("shadow witness response continuation token is invalid"),
    }


def invoke(
    socket_root,
    socket_path,
    witness_pid,
    witness_uid,
    witness_gid,
    socket_gid,
    method,
    request,
    timeout_seconds=5,
):
    if sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED"):
        fail("shadow witness client requires Linux SO_PEERCRED")
    if method not in METHODS:
        fail("shadow witness client method is unsupported")
    witness_pid = require_nonnegative_int(witness_pid, "shadow witness pid", 1)
    witness_uid = require_nonnegative_int(witness_uid, "shadow witness uid", 1)
    witness_gid = require_nonnegative_int(witness_gid, "shadow witness gid", 1)
    socket_gid = require_nonnegative_int(socket_gid, "shadow witness socket gid", 1)
    require_exact_directory(socket_root, 0, socket_gid, 0o710, "sealed shadow witness socket root")
    require_exact_socket(socket_path, witness_uid, socket_gid, 0o660, "shadow witness socket")
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    try:
        connection.settimeout(timeout_seconds)
        connection.connect(socket_path)
        pid, uid, gid = peer_credentials(connection)
        if pid != witness_pid or uid != witness_uid or gid != witness_gid:
            fail("shadow witness client connected to an unexpected peer")
        send_packet(
            connection,
            {
                "schema_version": WITNESS_PROTOCOL_VERSION,
                "method": method,
                "request": request,
            },
        )
        return normalize_response(receive_packet(connection, "shadow witness response"))
    except socket.timeout as error:
        fail("shadow witness request timed out: " + str(error))
    except OSError as error:
        fail("shadow witness request failed: " + str(error))
    finally:
        connection.close()


def require_response(response, status, capsule, label):
    if response["status"] != status or response["idempotent"]:
        fail(label + " did not produce one fresh expected witness transition")
    for key in ("shadow_admission_id", "ticket_hash", "capsule_hash"):
        if response[key] != capsule[key]:
            fail(label + " does not match the verifier capsule")
    return response


def record_shadow(socket_root, socket_path, witness_pid, witness_uid, witness_gid, socket_gid, capsule):
    capsule = normalize_capsule(capsule)
    common = {
        "socket_root": socket_root,
        "socket_path": socket_path,
        "witness_pid": witness_pid,
        "witness_uid": witness_uid,
        "witness_gid": witness_gid,
        "socket_gid": socket_gid,
    }
    opened = require_response(
        invoke(
            method="open_shadow",
            request={
                "shadow_admission_id": capsule["shadow_admission_id"],
                "ticket_hash": capsule["ticket_hash"],
                "capsule_hash": capsule["capsule_hash"],
            },
            **common,
        ),
        "shadow_opened",
        capsule,
        "open_shadow",
    )
    if opened["continuation_token"] is None:
        fail("open_shadow did not return an in-memory continuation token")
    observed = require_response(
        invoke(
            method="append_shadow_observation",
            request={
                "shadow_admission_id": capsule["shadow_admission_id"],
                "ticket_hash": capsule["ticket_hash"],
                "observation_hash": capsule["observation_hash"],
                "continuation_token": opened["continuation_token"],
            },
            **common,
        ),
        "shadow_observed",
        capsule,
        "append_shadow_observation",
    )
    if observed["observation_hash"] != capsule["observation_hash"]:
        fail("append_shadow_observation does not match the verifier capsule")
    closed = require_response(
        invoke(
            method="close_shadow_diagnostic",
            request={
                "shadow_admission_id": capsule["shadow_admission_id"],
                "ticket_hash": capsule["ticket_hash"],
                "close_hash": capsule["close_hash"],
                "continuation_token": opened["continuation_token"],
            },
            **common,
        ),
        "shadow_closed",
        capsule,
        "close_shadow_diagnostic",
    )
    if (
        closed["observation_hash"] != capsule["observation_hash"]
        or closed["close_hash"] != capsule["close_hash"]
    ):
        fail("close_shadow_diagnostic does not match the verifier capsule")
    readback = invoke(
        method="read_shadow_record",
        request={
            "shadow_admission_id": capsule["shadow_admission_id"],
            "ticket_hash": capsule["ticket_hash"],
        },
        **common,
    )
    if (
        readback["status"] != "shadow_closed"
        or not readback["idempotent"]
        or readback["shadow_chain_head"] != closed["shadow_chain_head"]
        or readback["observation_hash"] != capsule["observation_hash"]
        or readback["close_hash"] != capsule["close_hash"]
    ):
        fail("read_shadow_record did not return the closed witness record")
    return {
        "schema_version": SCHEMA_VERSION,
        "status": "shadow_witness_recorded",
        "shadow_admission_id": capsule["shadow_admission_id"],
        "ticket_hash": capsule["ticket_hash"],
        "capsule_hash": capsule["capsule_hash"],
        "observation_hash": capsule["observation_hash"],
        "close_hash": capsule["close_hash"],
        "previous_shadow_head": closed["previous_shadow_head"],
        "shadow_chain_head": closed["shadow_chain_head"],
        "idempotent": False,
    }
