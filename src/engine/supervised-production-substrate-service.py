#!/usr/bin/env python3
"""P3.6 Phase 2 role-local no-effect release runner.

The root-owned P3.6 host starts one copy under each fixed service identity.
This program verifies its own UID/GID/group set, waits for a root-created
one-shot release file, writes an identity-bound no-effect acknowledgement, and
waits to be collected. It has no IPC, Engine, action, or acceptance surface.
"""

import argparse
import hashlib
import json
import math
import os
import stat
import sys
import time


SCHEMA_VERSION = 1
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
SHA256_CHARS = frozenset("0123456789abcdef")


def fail(message):
    sys.stderr.write("supervised-production-substrate-service: " + message + "\n")
    raise SystemExit(2)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_value(value):
    if not isinstance(value, str):
        value = canonical(value)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def require_token(value, label):
    if not isinstance(value, str) or not value or len(value) > 128:
        fail(label + " must be a bounded protocol token")
    if any(character not in TOKEN_CHARS for character in value):
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


def require_absolute_path(value, label):
    if not isinstance(value, str) or not value.startswith("/"):
        fail(label + " must be an absolute path")
    if os.path.normpath(value) != value or value == "/":
        fail(label + " must be a canonical non-root path")
    return value


def require_nonroot_id(value, label):
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        fail(label + " must be a non-root integer")
    return value


def require_timeout(value, label):
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value <= 0
        or value > 30
    ):
        fail(label + " must be greater than zero and at most 30")
    return value


def require_exact_identity(expected_uid, expected_gid):
    if os.geteuid() != expected_uid or os.getegid() != expected_gid:
        fail("service process does not match its configured identity")
    if set(os.getgroups()) != {expected_gid}:
        fail("service process has unexpected supplementary groups")


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
        fail("release file does not have the expected root-owned mode")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        fail("release file cannot be opened safely: " + str(error))
    try:
        opened = os.fstat(descriptor)
        if (
            stat.S_ISLNK(opened.st_mode)
            or not stat.S_ISREG(opened.st_mode)
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
        fail("release token does not match this service invocation")
    return True


def wait_for_release(args):
    deadline = time.monotonic() + args.release_timeout_seconds
    while True:
        if read_release_token(args.release_path, args.release_token, args.expected_gid):
            return
        if time.monotonic() >= deadline:
            fail("release_timeout")
        time.sleep(0.025)


def write_ack(args):
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_phase2_release_ack",
        "status": "released_no_effect",
        "role": args.role,
        "pid": os.getpid(),
        "uid": os.geteuid(),
        "gid": os.getegid(),
        "install_binding_hash": args.install_binding_hash,
        "run_binding_hash": args.run_binding_hash,
        "substrate_abi_hash": args.substrate_abi_hash,
        "release_hash": sha256_value(args.release_token),
    }
    value = dict(material)
    value["ack_hash"] = sha256_value(material)
    content = (canonical(value) + "\n").encode("utf-8")
    pending_path = args.ack_path + ".pending"
    if os.path.lexists(args.ack_path) or os.path.lexists(pending_path):
        fail("ack publication path already exists")
    descriptor = None
    pending_exists = False
    try:
        descriptor = os.open(
            pending_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        pending_exists = True
        os.fchmod(descriptor, 0o600)
        total = 0
        while total < len(content):
            written = os.write(descriptor, content[total:])
            if written <= 0:
                fail("ack pending path short write")
            total += written
        os.fsync(descriptor)
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != args.expected_uid
            or info.st_gid != args.expected_gid
            or (info.st_mode & 0o777) != 0o600
        ):
            fail("ack pending file does not retain the expected identity and mode")
        os.link(pending_path, args.ack_path, follow_symlinks=False)
        os.unlink(pending_path)
        pending_exists = False
    except OSError as error:
        fail("ack cannot be atomically created and published: " + str(error))
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if pending_exists:
            try:
                info = os.lstat(pending_path)
                if (
                    stat.S_ISREG(info.st_mode)
                    and info.st_uid == args.expected_uid
                    and info.st_gid == args.expected_gid
                    and (info.st_mode & 0o777) == 0o600
                ):
                    os.unlink(pending_path)
            except OSError:
                pass
    try:
        directory_descriptor = os.open(
            os.path.dirname(args.ack_path),
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
        )
    except OSError as error:
        fail("ack directory cannot be opened safely: " + str(error))
    try:
        os.fsync(directory_descriptor)
    except OSError as error:
        fail("ack directory cannot be synchronized: " + str(error))
    finally:
        os.close(directory_descriptor)


def run(args):
    args.role = require_token(args.role, "role")
    args.release_path = require_absolute_path(args.release_path, "release_path")
    args.ack_path = require_absolute_path(args.ack_path, "ack_path")
    args.release_token = require_token(args.release_token, "release_token")
    args.expected_uid = require_nonroot_id(args.expected_uid, "expected_uid")
    args.expected_gid = require_nonroot_id(args.expected_gid, "expected_gid")
    args.install_binding_hash = require_sha256(args.install_binding_hash, "install_binding_hash")
    args.run_binding_hash = require_sha256(args.run_binding_hash, "run_binding_hash")
    args.substrate_abi_hash = require_sha256(args.substrate_abi_hash, "substrate_abi_hash")
    args.release_timeout_seconds = require_timeout(
        args.release_timeout_seconds, "release_timeout_seconds"
    )
    args.hold_seconds = require_timeout(args.hold_seconds, "hold_seconds")
    require_exact_identity(args.expected_uid, args.expected_gid)
    wait_for_release(args)
    write_ack(args)
    time.sleep(args.hold_seconds)


def parser():
    root = argparse.ArgumentParser()
    root.add_argument("--role", required=True)
    root.add_argument("--release-path", required=True)
    root.add_argument("--ack-path", required=True)
    root.add_argument("--release-token", required=True)
    root.add_argument("--expected-uid", required=True, type=int)
    root.add_argument("--expected-gid", required=True, type=int)
    root.add_argument("--install-binding-hash", required=True)
    root.add_argument("--run-binding-hash", required=True)
    root.add_argument("--substrate-abi-hash", required=True)
    root.add_argument("--release-timeout-seconds", type=float, default=15)
    root.add_argument("--hold-seconds", type=float, default=15)
    return root


def main():
    run(parser().parse_args())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
