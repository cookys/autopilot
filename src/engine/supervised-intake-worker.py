#!/usr/bin/env python3
"""Fixed dedicated-worker client for the P3.5a intake probe."""

import argparse
import json
import os
import select
import socket
import stat
import struct
import sys
import time


SCHEMA_VERSION = 1
MAX_FRAME_BYTES = 262144
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)


class WorkerError(Exception):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def fail(message):
    raise WorkerError(message)


def require_token(value, label):
    if not isinstance(value, str) or not value or len(value) > 128:
        fail(label + " must be a bounded protocol token")
    if any(character not in TOKEN_CHARS for character in value):
        fail(label + " must be a bounded protocol token")
    return value


def require_nonnegative_int(value, label, minimum=0):
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        fail(label + " must be a bounded integer")
    return value


def require_absolute_path(value, label):
    if not isinstance(value, str) or not value.startswith("/"):
        fail(label + " must be an absolute path")
    if os.path.normpath(value) != value or value.startswith("//") or value == "/":
        fail(label + " must be a canonical non-root path")
    return value


def require_exact_worker_identity(uid, gid):
    if os.geteuid() != uid or os.getegid() != gid:
        fail("worker does not have the expected UID/GID")
    if set(os.getgroups()) != {gid}:
        fail("worker has unexpected supplementary groups")


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


def read_exact_regular_file(path, owner_uid, group_gid, mode, label, maximum):
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != owner_uid
        or info.st_gid != group_gid
        or (info.st_mode & 0o777) != mode
        or info.st_size <= 0
        or info.st_size > maximum
    ):
        fail(label + " does not have the expected identity, mode, or size")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        after = os.fstat(descriptor)
        if after.st_ino != info.st_ino or after.st_dev != info.st_dev:
            fail(label + " changed while being opened")
        chunks = []
        while True:
            block = os.read(descriptor, 65536)
            if not block:
                break
            chunks.append(block)
        content = b"".join(chunks)
    finally:
        os.close(descriptor)
    if len(content) != info.st_size:
        fail(label + " changed while being read")
    return content


def parse_json(content, label):
    try:
        text = content.decode("utf-8")
        return text, json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(label + " is not valid UTF-8 JSON: " + str(error))


def parse_canonical_json(content, label):
    text, value = parse_json(content, label)
    if canonical(value) != text:
        fail(label + " is not canonical JSON")
    return value


def wait_for_release(args):
    deadline = time.monotonic() + args.release_timeout_seconds
    while time.monotonic() < deadline:
        if os.path.exists(args.release_path):
            content = read_exact_regular_file(
                args.release_path,
                0,
                args.expected_worker_gid,
                0o440,
                "worker release",
                4096,
            )
            value = parse_canonical_json(content, "worker release")
            if not isinstance(value, dict) or set(value) != {
                "release_token",
                "schema_version",
                "server_gid",
                "server_pid",
                "server_uid",
            }:
                fail("worker release has an unexpected shape")
            if (
                value["schema_version"] != SCHEMA_VERSION
                or value["release_token"] != args.release_token
                or value["server_uid"] != args.expected_server_uid
                or value["server_gid"] != args.expected_server_gid
            ):
                fail("worker release does not match the fixed host protocol")
            return require_nonnegative_int(value["server_pid"], "worker release server_pid", 1)
        time.sleep(0.025)
    fail("worker release timed out")


def receive_exact(connection, size, deadline, label):
    chunks = []
    remaining = size
    while remaining:
        timeout = deadline - time.monotonic()
        if timeout <= 0:
            fail(label + " timed out")
        ready, _, _ = select.select([connection], [], [], timeout)
        if not ready:
            fail(label + " timed out")
        block = connection.recv(remaining)
        if not block:
            fail(label + " ended early")
        chunks.append(block)
        remaining -= len(block)
    return b"".join(chunks)


def require_exact_socket(path, uid, gid, mode, label):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        raise
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


def receive_handoff_frame(connection, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    header = receive_exact(connection, 4, deadline, "root handoff")
    size = struct.unpack("!I", header)[0]
    if size == 0 or size > MAX_FRAME_BYTES:
        fail("root handoff length is invalid")
    payload = receive_exact(connection, size, deadline, "root handoff")
    ready, _, _ = select.select([connection], [], [], 0)
    if ready and connection.recv(1):
        fail("root sent more than one handoff frame")
    return payload


def receive_handoff_request(args):
    require_exact_directory(
        args.handoff_root,
        0,
        args.expected_worker_gid,
        0o710,
        "root handoff directory",
    )
    deadline = time.monotonic() + args.handoff_timeout_seconds
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            fail("root handoff timed out")
        try:
            require_exact_socket(
                args.handoff_socket,
                args.expected_worker_uid,
                args.expected_worker_gid,
                0o600,
                "root handoff socket",
            )
        except FileNotFoundError:
            time.sleep(0.025)
            continue
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            connection.settimeout(remaining)
            try:
                connection.connect(args.handoff_socket)
            except (ConnectionRefusedError, FileNotFoundError):
                time.sleep(0.025)
                continue
            raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
            peer_pid, peer_uid, peer_gid = struct.unpack("3i", raw)
            if (
                peer_pid != args.expected_handoff_server_pid
                or peer_uid != 0
                or peer_gid != 0
            ):
                fail("worker connected to an unexpected root handoff peer")
            return receive_handoff_frame(connection, remaining)
        except OSError as error:
            fail("root handoff exchange failed: " + str(error))
        finally:
            connection.close()


def receive_single_frame(connection, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    header = receive_exact(connection, 4, deadline, "verifier response")
    size = struct.unpack("!I", header)[0]
    if size < 2 or size > MAX_FRAME_BYTES:
        fail("verifier response length is invalid")
    payload = receive_exact(connection, size, deadline, "verifier response")
    ready, _, _ = select.select([connection], [], [], 0)
    if ready and connection.recv(1):
        fail("verifier sent more than one response frame")
    return payload


def verify_response(payload):
    value = parse_canonical_json(payload.rstrip(b"\n"), "verifier response")
    if not isinstance(value, dict) or set(value) != {
        "acceptance",
        "bridge_receipt",
        "owner_kernel_authority",
        "receipt",
        "schema_version",
        "status",
    }:
        fail("verifier response has an unexpected shape")
    if (
        value["schema_version"] != SCHEMA_VERSION
        or value["status"] != "verified_intake"
        or value["owner_kernel_authority"] != "none"
        or value["acceptance"] != "not_available"
    ):
        fail("verifier response is not a non-authoritative intake receipt")


def connect_and_submit(args, server_pid, request):
    require_exact_directory(
        args.socket_root,
        0,
        args.expected_worker_gid,
        0o710,
        "gateway socket root",
    )
    try:
        socket_info = os.lstat(args.socket_path)
    except OSError as error:
        fail("gateway socket cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(socket_info.st_mode)
        or not stat.S_ISSOCK(socket_info.st_mode)
        or socket_info.st_uid != args.expected_worker_uid
        or socket_info.st_gid != args.expected_worker_gid
        or (socket_info.st_mode & 0o777) != 0o600
    ):
        fail("gateway socket does not have the dedicated worker restriction")
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        connection.settimeout(args.timeout_seconds)
        connection.connect(args.socket_path)
        if not hasattr(socket, "SO_PEERCRED"):
            fail("worker requires Linux SO_PEERCRED")
        raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        peer_pid, peer_uid, peer_gid = struct.unpack("3i", raw)
        if (
            peer_pid != server_pid
            or peer_uid != args.expected_server_uid
            or peer_gid != args.expected_server_gid
        ):
            fail("worker connected to an unexpected verifier peer")
        connection.sendall(struct.pack("!I", len(request)) + request)
        connection.shutdown(socket.SHUT_WR)
        verify_response(receive_single_frame(connection, args.timeout_seconds))
    except OSError as error:
        fail("worker socket exchange failed: " + str(error))
    finally:
        connection.close()


def run(args):
    require_exact_worker_identity(args.expected_worker_uid, args.expected_worker_gid)
    if sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED"):
        fail("P3.5 worker requires Linux SO_PEERCRED")
    request = receive_handoff_request(args)
    server_pid = wait_for_release(args)
    # The fixed Node verifier is the single canonical parser for opaque intake
    # bytes. The worker keeps the root handoff only in memory and validates
    # local peer credentials before forwarding it.
    connect_and_submit(args, server_pid, request)
    return 0


def parser():
    root = argparse.ArgumentParser()
    root.add_argument("--release-path", required=True)
    root.add_argument("--release-token", required=True)
    root.add_argument("--handoff-socket", required=True)
    root.add_argument("--handoff-root", required=True)
    root.add_argument("--expected-handoff-server-pid", type=int, required=True)
    root.add_argument("--handoff-timeout-seconds", type=int, required=True)
    root.add_argument("--socket", dest="socket_path", required=True)
    root.add_argument("--socket-root", required=True)
    root.add_argument("--expected-worker-uid", type=int, required=True)
    root.add_argument("--expected-worker-gid", type=int, required=True)
    root.add_argument("--expected-server-uid", type=int, required=True)
    root.add_argument("--expected-server-gid", type=int, required=True)
    root.add_argument("--release-timeout-seconds", type=int, required=True)
    root.add_argument("--timeout-seconds", type=int, required=True)
    return root


def normalize_args(args):
    args.release_path = require_absolute_path(args.release_path, "release path")
    args.handoff_socket = require_absolute_path(args.handoff_socket, "handoff socket path")
    args.handoff_root = require_absolute_path(args.handoff_root, "handoff root path")
    args.socket_path = require_absolute_path(args.socket_path, "socket path")
    args.socket_root = require_absolute_path(args.socket_root, "socket root")
    args.release_token = require_token(args.release_token, "release token")
    args.expected_worker_uid = require_nonnegative_int(args.expected_worker_uid, "expected worker UID", 1)
    args.expected_worker_gid = require_nonnegative_int(args.expected_worker_gid, "expected worker GID", 1)
    args.expected_server_uid = require_nonnegative_int(args.expected_server_uid, "expected server UID", 1)
    args.expected_server_gid = require_nonnegative_int(args.expected_server_gid, "expected server GID", 1)
    args.expected_handoff_server_pid = require_nonnegative_int(
        args.expected_handoff_server_pid, "expected root handoff server PID", 1
    )
    args.handoff_timeout_seconds = require_nonnegative_int(
        args.handoff_timeout_seconds, "root handoff timeout", 1
    )
    args.release_timeout_seconds = require_nonnegative_int(args.release_timeout_seconds, "release timeout", 1)
    args.timeout_seconds = require_nonnegative_int(args.timeout_seconds, "timeout", 1)
    if args.expected_worker_uid == args.expected_server_uid or args.expected_worker_gid == args.expected_server_gid:
        fail("worker and verifier identities must be distinct")
    return args


def main():
    try:
        return run(normalize_args(parser().parse_args()))
    except WorkerError as error:
        sys.stderr.write("supervised-intake-worker: " + str(error) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
