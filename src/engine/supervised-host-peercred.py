#!/usr/bin/env python3
"""P3.4 Linux-only bounded Unix peer-credential gateway.

This helper is intended to run from a root-owned installed snapshot. It exposes
only one single-use preflight hello operation and never imports or invokes Owner
Kernel, action, broker, witness, or acceptance code.
"""

import argparse
import hashlib
import json
import math
import os
import re
import socket
import stat
import struct
import sys
import time


PROTOCOL_VERSION = 1
MAX_FRAME_BYTES = 4096
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
CGROUP_PATH_PATTERN = re.compile(r"^/system\.slice/autopilot-p34-[A-Za-z0-9_-]{1,96}\.service$")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def digest(value):
    if not isinstance(value, str):
        value = canonical(value)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def emit(value):
    sys.stdout.write(canonical(value) + "\n")
    sys.stdout.flush()


def fail(message, code=2):
    sys.stderr.write("supervised-host-peercred: " + message + "\n")
    raise SystemExit(code)


def require_token(value, label):
    if not isinstance(value, str) or TOKEN_PATTERN.fullmatch(value) is None:
        fail(label + " must be a bounded protocol token")
    return value


def require_sha256(value, label):
    if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
        fail(label + " must be a lowercase SHA-256 digest")
    return value


def require_nonnegative_int(value, label):
    if not isinstance(value, int) or value < 0:
        fail(label + " must be a non-negative integer")
    return value


def require_timeout_seconds(value):
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value <= 0
        or value > 30
    ):
        fail("timeout_seconds must be greater than zero and at most 30")
    return value


def require_absolute_path(value, label):
    if not isinstance(value, str) or not value.startswith("/"):
        fail(label + " must be an absolute path")
    normalized = os.path.normpath(value)
    if normalized != value or normalized == "/":
        fail(label + " must be a canonical non-root path")
    return normalized


def require_linux_peercred():
    if sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED"):
        fail("Linux SO_PEERCRED is required")


def path_components(absolute_path):
    components = ["/"]
    current = ""
    for part in absolute_path.split("/"):
        if not part:
            continue
        current += "/" + part
        components.append(current)
    return components


def inspect_directory(directory, label):
    try:
        info = os.lstat(directory)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        fail(label + " must be a real directory")
    return info


def require_safe_socket_parent(socket_path, expected_owner_uid, expected_group_gid):
    parent = os.path.dirname(socket_path)
    info = inspect_directory(parent, "socket parent")
    if info.st_uid != expected_owner_uid:
        fail("socket parent must be owned by the configured broker UID")
    if info.st_gid != expected_group_gid:
        fail("socket parent must use the frozen worker group")
    # Group execute is permitted so the frozen worker can traverse to the socket;
    # it cannot read or modify the parent, and other users get no access.
    if (info.st_mode & 0o067) != 0:
        fail("socket parent must deny group write/read and all other access")


def require_safe_gateway_socket_parent(socket_path, broker_uid, socket_gid):
    parent = os.path.dirname(socket_path)
    for component in path_components(parent):
        info = inspect_directory(component, "socket parent ancestor")
        if info.st_uid not in (0, broker_uid) or (info.st_mode & 0o022) != 0:
            fail("socket parent has an untrusted ancestor")
    require_safe_socket_parent(socket_path, broker_uid, socket_gid)


def socket_is_expected(socket_path, expected_uid, expected_gid):
    try:
        info = os.lstat(socket_path)
    except OSError:
        return False
    return (
        stat.S_ISSOCK(info.st_mode)
        and not stat.S_ISLNK(info.st_mode)
        and info.st_uid == expected_uid
        and info.st_gid == expected_gid
        and (info.st_mode & 0o777) == 0o660
    )


def require_safe_client_socket_path(socket_path, expected_server_uid, expected_socket_gid):
    parent = os.path.dirname(socket_path)
    for component in path_components(parent):
        info = inspect_directory(component, "socket ancestor")
        if info.st_uid not in (0, expected_server_uid) or (info.st_mode & 0o022) != 0:
            fail("socket has an untrusted ancestor")
    require_safe_socket_parent(socket_path, expected_server_uid, expected_socket_gid)
    if not socket_is_expected(socket_path, expected_server_uid, expected_socket_gid):
        fail("socket does not have expected broker ownership and mode")


def peer_credentials(connection):
    raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    return struct.unpack("3i", raw)


def require_cgroup_path(value, label):
    value = require_absolute_path(value, label)
    if CGROUP_PATH_PATTERN.fullmatch(value) is None:
        fail(label + " must be an autopilot-p34 system.slice path")
    return value


def cgroup_matches(pid, expected_path, require_unified_v2=False):
    try:
        with open("/proc/{}/cgroup".format(pid), "r", encoding="utf-8") as source:
            body = source.read(8192)
    except OSError:
        return False
    for line in body.splitlines():
        fields = line.split(":", 2)
        if len(fields) != 3:
            continue
        if fields[2] == expected_path and (
            not require_unified_v2 or (fields[0] == "0" and fields[1] == "")
        ):
            return True
    return False


def receive_one_frame(connection, timeout_seconds, deadline=None):
    if deadline is None:
        deadline = time.monotonic() + timeout_seconds
    data = bytearray()
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("frame_timeout")
        connection.settimeout(remaining)
        chunk = connection.recv(min(1024, MAX_FRAME_BYTES + 1 - len(data)))
        if not chunk:
            break
        data.extend(chunk)
        if b"\n" in chunk:
            break
        if len(data) > MAX_FRAME_BYTES:
            raise ValueError("frame_too_large")
    if len(data) == 0 or len(data) > MAX_FRAME_BYTES:
        raise ValueError("frame_missing_or_too_large")
    if data.count(b"\n") != 1 or not data.endswith(b"\n"):
        raise ValueError("frame_must_contain_one_terminal_newline")
    return bytes(data[:-1])


def validate_hello(frame, args):
    try:
        value = json.loads(frame.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("invalid_json") from error
    if not isinstance(value, dict):
        raise ValueError("frame_must_be_object")
    expected_keys = {"op", "run_id", "invocation_id", "plan_hash", "nonce"}
    if set(value.keys()) != expected_keys:
        raise ValueError("frame_keys_mismatch")
    if value["op"] != "p34_hello":
        raise ValueError("operation_rejected")
    if value["run_id"] != args.run_id or value["invocation_id"] != args.invocation_id:
        raise ValueError("run_binding_mismatch")
    if value["plan_hash"] != args.plan_hash:
        raise ValueError("plan_hash_mismatch")
    nonce = require_token(value["nonce"], "nonce")
    if digest(nonce) != args.nonce_hash:
        raise ValueError("nonce_mismatch")
    return value


def receipt_hash(receipt):
    material = dict(receipt)
    material.pop("receipt_hash", None)
    return digest(material)


def validate_response(frame, args):
    try:
        value = json.loads(frame.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("invalid_response") from error
    if not isinstance(value, dict) or set(value.keys()) != {"ok", "receipt"}:
        raise ValueError("response_shape_mismatch")
    if value["ok"] is not True or not isinstance(value["receipt"], dict):
        raise ValueError("response_not_ok")
    receipt = value["receipt"]
    expected_receipt_keys = {
        "protocol_version",
        "run_id",
        "invocation_id",
        "plan_hash",
        "binding_hash",
        "gateway",
        "peer",
        "status",
        "owner_kernel_authority",
        "acceptance",
        "receipt_hash",
    }
    if set(receipt.keys()) != expected_receipt_keys:
        raise ValueError("receipt_shape_mismatch")
    if (
        receipt["protocol_version"] != PROTOCOL_VERSION
        or receipt["run_id"] != args.run_id
        or receipt["invocation_id"] != args.invocation_id
        or receipt["plan_hash"] != args.plan_hash
        or receipt["binding_hash"] != args.binding_hash
        or receipt["status"] != "preflight_only"
        or receipt["owner_kernel_authority"] != "none"
        or receipt["acceptance"] != "not_available"
    ):
        raise ValueError("receipt_binding_mismatch")
    gateway = receipt["gateway"]
    peer = receipt["peer"]
    if set(gateway.keys()) != {"uid", "gid"} or set(peer.keys()) != {"pid", "uid", "gid"}:
        raise ValueError("receipt_principal_shape_mismatch")
    if gateway["uid"] != args.expected_server_uid or gateway["gid"] != args.expected_server_gid:
        raise ValueError("gateway_identity_mismatch")
    if peer["uid"] != os.geteuid() or peer["gid"] != os.getegid() or not isinstance(peer["pid"], int) or peer["pid"] <= 0:
        raise ValueError("peer_identity_mismatch")
    require_sha256(receipt["receipt_hash"], "receipt_hash")
    if receipt["receipt_hash"] != receipt_hash(receipt):
        raise ValueError("receipt_hash_mismatch")
    return value


def serve(args):
    require_linux_peercred()
    socket_path = require_absolute_path(args.socket, "socket")
    expected_uid = require_nonnegative_int(args.expected_uid, "expected_uid")
    expected_gid = require_nonnegative_int(args.expected_gid, "expected_gid")
    broker_uid = require_nonnegative_int(args.broker_uid, "broker_uid")
    broker_gid = require_nonnegative_int(args.broker_gid, "broker_gid")
    socket_gid = require_nonnegative_int(args.socket_gid, "socket_gid")
    expected_pid = args.expected_pid
    if expected_pid is not None:
        expected_pid = require_nonnegative_int(expected_pid, "expected_pid")
        if expected_pid == 0:
            fail("expected_pid must be greater than zero")
    if broker_uid == 0 or broker_gid == 0:
        fail("gateway broker identity must be unprivileged")
    if os.geteuid() != broker_uid or os.getegid() != broker_gid:
        fail("gateway process does not match the configured broker identity")
    if expected_uid == broker_uid or expected_gid == broker_gid:
        fail("gateway and worker must use distinct UID and GID identities")
    if socket_gid != expected_gid:
        fail("socket group must equal the frozen worker GID")
    if socket_gid not in os.getgroups() and socket_gid != os.getegid():
        fail("gateway cannot assign the frozen worker socket group")
    require_safe_gateway_socket_parent(socket_path, broker_uid, socket_gid)
    if os.path.lexists(socket_path):
        fail("socket path already exists")
    require_token(args.run_id, "run_id")
    require_token(args.invocation_id, "invocation_id")
    require_sha256(args.plan_hash, "plan_hash")
    require_sha256(args.nonce_hash, "nonce_hash")
    require_sha256(args.binding_hash, "binding_hash")
    expected_cgroup_path = require_cgroup_path(args.expected_cgroup_path, "expected_cgroup_path")
    timeout_seconds = require_timeout_seconds(args.timeout_seconds)

    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        listener.bind(socket_path)
        os.chown(socket_path, -1, socket_gid)
        os.chmod(socket_path, 0o660)
        if not socket_is_expected(socket_path, broker_uid, socket_gid):
            fail("bound socket does not have expected ownership and mode")
        listener.listen(1)
        emit({
            "status": "ready",
            "protocol_version": PROTOCOL_VERSION,
            "socket": socket_path,
            "gateway_uid": os.geteuid(),
            "gateway_gid": os.getegid(),
            "socket_gid": socket_gid,
            "request_lifecycle": "single_use",
        })
        deadline = time.monotonic() + timeout_seconds
        listener.settimeout(timeout_seconds)
        try:
            connection, _ = listener.accept()
        except TimeoutError:
            emit({"status": "request_timeout"})
            return 1
        with connection:
            pid, uid, gid = peer_credentials(connection)
            if (
                uid != expected_uid
                or gid != expected_gid
                or (expected_pid is not None and pid != expected_pid)
                or not cgroup_matches(pid, expected_cgroup_path, args.require_unified_cgroup_v2)
            ):
                emit({
                    "status": "peer_rejected",
                    "pid": pid,
                    "uid": uid,
                    "gid": gid,
                })
                return 1
            try:
                validate_hello(receive_one_frame(connection, timeout_seconds, deadline), args)
            except (ValueError, TimeoutError, OSError) as error:
                emit({
                    "status": "request_rejected",
                    "pid": pid,
                    "uid": uid,
                    "gid": gid,
                    "reason": str(error),
                })
                return 1
            receipt = {
                "protocol_version": PROTOCOL_VERSION,
                "run_id": args.run_id,
                "invocation_id": args.invocation_id,
                "plan_hash": args.plan_hash,
                "binding_hash": args.binding_hash,
                "gateway": {"uid": broker_uid, "gid": broker_gid},
                "peer": {"pid": pid, "uid": uid, "gid": gid},
                "status": "preflight_only",
                "owner_kernel_authority": "none",
                "acceptance": "not_available",
            }
            receipt["receipt_hash"] = receipt_hash(receipt)
            try:
                connection.sendall((canonical({"ok": True, "receipt": receipt}) + "\n").encode("utf-8"))
            except OSError as error:
                emit({"status": "response_failed", "reason": str(error)})
                return 1
            emit({"status": "peer_accepted", "receipt_hash": receipt["receipt_hash"], "pid": pid, "uid": uid, "gid": gid})
            return 0
    finally:
        listener.close()
        if os.path.lexists(socket_path) and socket_is_expected(socket_path, broker_uid, socket_gid):
            os.unlink(socket_path)


def client(args):
    require_linux_peercred()
    socket_path = require_absolute_path(args.socket, "socket")
    args.expected_server_uid = require_nonnegative_int(args.expected_server_uid, "expected_server_uid")
    args.expected_server_gid = require_nonnegative_int(args.expected_server_gid, "expected_server_gid")
    expected_socket_gid = require_nonnegative_int(args.expected_socket_gid, "expected_socket_gid")
    require_safe_client_socket_path(socket_path, args.expected_server_uid, expected_socket_gid)
    require_token(args.run_id, "run_id")
    require_token(args.invocation_id, "invocation_id")
    require_sha256(args.plan_hash, "plan_hash")
    require_sha256(args.binding_hash, "binding_hash")
    nonce = require_token(args.nonce, "nonce")
    timeout_seconds = require_timeout_seconds(args.timeout_seconds)
    request = {
        "op": "p34_hello",
        "run_id": args.run_id,
        "invocation_id": args.invocation_id,
        "plan_hash": args.plan_hash,
        "nonce": nonce,
    }
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    deadline = time.monotonic() + timeout_seconds
    try:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("connect_timeout")
        connection.settimeout(remaining)
        connection.connect(socket_path)
        _server_pid, server_uid, server_gid = peer_credentials(connection)
        if server_uid != args.expected_server_uid or server_gid != args.expected_server_gid:
            raise ValueError("server_peer_identity_mismatch")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("send_timeout")
        connection.settimeout(remaining)
        connection.sendall((canonical(request) + "\n").encode("utf-8"))
        response = receive_one_frame(connection, timeout_seconds, deadline)
        value = validate_response(response, args)
    except (OSError, TimeoutError, ValueError) as error:
        emit({"ok": False, "error": str(error)})
        return 1
    finally:
        connection.close()
    emit(value)
    return 0


def parser():
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)

    serve_parser = commands.add_parser("serve")
    serve_parser.add_argument("--socket", required=True)
    serve_parser.add_argument("--expected-uid", required=True, type=int)
    serve_parser.add_argument("--expected-gid", required=True, type=int)
    serve_parser.add_argument("--expected-pid", type=int)
    serve_parser.add_argument("--expected-cgroup-path", required=True)
    serve_parser.add_argument("--require-unified-cgroup-v2", action="store_true")
    serve_parser.add_argument("--broker-uid", required=True, type=int)
    serve_parser.add_argument("--broker-gid", required=True, type=int)
    serve_parser.add_argument("--socket-gid", required=True, type=int)
    serve_parser.add_argument("--run-id", required=True)
    serve_parser.add_argument("--invocation-id", required=True)
    serve_parser.add_argument("--plan-hash", required=True)
    serve_parser.add_argument("--nonce-hash", required=True)
    serve_parser.add_argument("--binding-hash", required=True)
    serve_parser.add_argument("--timeout-seconds", type=float, default=5)
    serve_parser.set_defaults(handler=serve)

    client_parser = commands.add_parser("client")
    client_parser.add_argument("--socket", required=True)
    client_parser.add_argument("--expected-server-uid", required=True, type=int)
    client_parser.add_argument("--expected-server-gid", required=True, type=int)
    client_parser.add_argument("--expected-socket-gid", required=True, type=int)
    client_parser.add_argument("--binding-hash", required=True)
    client_parser.add_argument("--run-id", required=True)
    client_parser.add_argument("--invocation-id", required=True)
    client_parser.add_argument("--plan-hash", required=True)
    client_parser.add_argument("--nonce", required=True)
    client_parser.add_argument("--timeout-seconds", type=float, default=5)
    client_parser.set_defaults(handler=client)
    return root


def main():
    args = parser().parse_args()
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
