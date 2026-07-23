#!/usr/bin/env python3
"""P3.4b worker-side release gate for a root-owned supervised launcher.

The wrapper has no action or Owner Kernel imports. It waits for a root-created,
per-run release file and then execs the fixed P3.4 peer-credential client so the
systemd MainPID remains the client PID observed by the gateway.
"""

import argparse
import math
import os
import stat
import sys
import time


TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)


def fail(message):
    sys.stderr.write("supervised-host-worker-wait: " + message + "\n")
    raise SystemExit(2)


def require_token(value, label):
    if not isinstance(value, str) or not value or len(value) > 128:
        fail(label + " must be a bounded protocol token")
    if any(character not in TOKEN_CHARS for character in value):
        fail(label + " must be a bounded protocol token")
    return value


def require_absolute_path(value, label):
    if not isinstance(value, str) or not value.startswith("/"):
        fail(label + " must be an absolute path")
    normalized = os.path.normpath(value)
    if normalized != value or normalized == "/":
        fail(label + " must be a canonical non-root path")
    return value


def require_nonnegative_int(value, label):
    if not isinstance(value, int) or value < 0:
        fail(label + " must be a non-negative integer")
    return value


def require_timeout(value):
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value <= 0
        or value > 30
    ):
        fail("timeout_seconds must be greater than zero and at most 30")
    return value


def require_exact_worker_identity(expected_uid, expected_gid):
    if os.geteuid() != expected_uid or os.getegid() != expected_gid:
        fail("worker process does not match the configured identity")
    if set(os.getgroups()) != {expected_gid}:
        fail("worker process has unexpected supplementary groups")


def read_release_token(path, expected_token, expected_gid):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    except OSError as error:
        fail("release path cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != expected_gid
        or (info.st_mode & 0o777) != 0o440
    ):
        fail("release file does not have root-owned expected mode")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        fail("release file cannot be opened safely: " + str(error))
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != 0
            or opened.st_gid != expected_gid
            or (opened.st_mode & 0o777) != 0o440
        ):
            fail("release file changed while opening")
        value = os.read(descriptor, 256).decode("ascii")
    except (OSError, UnicodeDecodeError) as error:
        fail("release file cannot be read safely: " + str(error))
    finally:
        os.close(descriptor)
    if value != expected_token + "\n":
        fail("release token does not match this worker invocation")
    return True


def wait_for_release(args):
    deadline = time.monotonic() + require_timeout(args.release_timeout_seconds)
    while True:
        if read_release_token(args.release_path, args.release_token, args.expected_socket_gid):
            return
        if time.monotonic() >= deadline:
            fail("release_timeout")
        time.sleep(0.025)


def run(args):
    args.release_path = require_absolute_path(args.release_path, "release_path")
    args.release_token = require_token(args.release_token, "release_token")
    args.python_path = require_absolute_path(args.python_path, "python_path")
    args.helper_path = require_absolute_path(args.helper_path, "helper_path")
    args.socket = require_absolute_path(args.socket, "socket")
    args.expected_worker_uid = require_nonnegative_int(
        args.expected_worker_uid, "expected_worker_uid"
    )
    args.expected_worker_gid = require_nonnegative_int(
        args.expected_worker_gid, "expected_worker_gid"
    )
    args.expected_server_uid = require_nonnegative_int(
        args.expected_server_uid, "expected_server_uid"
    )
    args.expected_server_gid = require_nonnegative_int(
        args.expected_server_gid, "expected_server_gid"
    )
    args.expected_socket_gid = require_nonnegative_int(
        args.expected_socket_gid, "expected_socket_gid"
    )
    args.run_id = require_token(args.run_id, "run_id")
    args.invocation_id = require_token(args.invocation_id, "invocation_id")
    args.plan_hash = require_token(args.plan_hash, "plan_hash")
    args.binding_hash = require_token(args.binding_hash, "binding_hash")
    args.nonce = require_token(args.nonce, "nonce")
    args.release_timeout_seconds = require_timeout(args.release_timeout_seconds)
    args.timeout_seconds = require_timeout(args.timeout_seconds)
    if args.expected_socket_gid != args.expected_worker_gid:
        fail("expected_socket_gid must equal expected_worker_gid")
    require_exact_worker_identity(args.expected_worker_uid, args.expected_worker_gid)
    wait_for_release(args)
    command = [
        args.python_path,
        "-I",
        args.helper_path,
        "client",
        "--socket",
        args.socket,
        "--expected-server-uid",
        str(args.expected_server_uid),
        "--expected-server-gid",
        str(args.expected_server_gid),
        "--expected-socket-gid",
        str(args.expected_socket_gid),
        "--binding-hash",
        args.binding_hash,
        "--run-id",
        args.run_id,
        "--invocation-id",
        args.invocation_id,
        "--plan-hash",
        args.plan_hash,
        "--nonce",
        args.nonce,
        "--timeout-seconds",
        str(args.timeout_seconds),
    ]
    os.execve(
        args.python_path,
        command,
        {"LANG": "C", "LC_ALL": "C", "PATH": "/usr/bin:/bin"},
    )


def parser():
    root = argparse.ArgumentParser()
    root.add_argument("--release-path", required=True)
    root.add_argument("--release-token", required=True)
    root.add_argument("--python-path", required=True)
    root.add_argument("--helper-path", required=True)
    root.add_argument("--socket", required=True)
    root.add_argument("--expected-worker-uid", required=True, type=int)
    root.add_argument("--expected-worker-gid", required=True, type=int)
    root.add_argument("--expected-server-uid", required=True, type=int)
    root.add_argument("--expected-server-gid", required=True, type=int)
    root.add_argument("--expected-socket-gid", required=True, type=int)
    root.add_argument("--binding-hash", required=True)
    root.add_argument("--run-id", required=True)
    root.add_argument("--invocation-id", required=True)
    root.add_argument("--plan-hash", required=True)
    root.add_argument("--nonce", required=True)
    root.add_argument("--release-timeout-seconds", type=float, default=15)
    root.add_argument("--timeout-seconds", type=float, default=5)
    return root


def main():
    return run(parser().parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
