#!/usr/bin/env python3
"""P3.5a unprivileged peer-credential gateway.

The root host starts this program as ``autopilot-verifier``. It reads Linux
``SO_PEERCRED`` before accepting a bounded frame, serializes durable replay
access with an advisory lock, and invokes only the installed Node verifier.
It never constructs a Kernel, invokes an Engine sink, or accepts a result.
"""

import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import select
import secrets
import socket
import stat
import struct
import subprocess
import sys
import time


SCHEMA_VERSION = 1
INTAKE_PROTOCOL_V1 = 1
INTAKE_PROTOCOL_V2 = 2
MAX_FRAME_BYTES = 262144
MAX_RESULT_BYTES = 65536
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)


class GatewayError(Exception):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def emit(value):
    sys.stdout.write(canonical(value) + "\n")
    sys.stdout.flush()


def fail(message):
    raise GatewayError(message)


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
        or any(character not in "0123456789abcdef" for character in value)
    ):
        fail(label + " must be a lowercase SHA-256 digest")
    return value


def require_exact_keys(value, expected, label):
    if not isinstance(value, dict) or set(value) != set(expected):
        fail(label + " has an unexpected key set")
    return value


def require_root_owned_file(path, label, executable=False):
    path = require_absolute_path(path, label)
    components = ["/"]
    current = ""
    for part in path.split("/"):
        if part:
            current += "/" + part
            components.append(current)
    for component in components:
        try:
            info = os.lstat(component)
        except OSError as error:
            fail(label + " cannot inspect an ancestor: " + str(error))
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022) != 0:
            fail(label + " has an untrusted ancestor " + component)
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode) or (executable and (info.st_mode & 0o111) == 0):
        fail(label + " must be a root-owned regular file")
    return path


def read_root_verifier_json(path, verifier_gid, label):
    path = require_absolute_path(path, label)
    try:
        initial = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(initial.st_mode)
        or not stat.S_ISREG(initial.st_mode)
        or initial.st_uid != 0
        or initial.st_gid != verifier_gid
        or (initial.st_mode & 0o7777) != 0o440
        or initial.st_size <= 0
        or initial.st_size > MAX_RESULT_BYTES
    ):
        fail(label + " does not have the expected root/verifier identity and mode")
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        opened = os.fstat(descriptor)
        if (
            opened.st_dev != initial.st_dev
            or opened.st_ino != initial.st_ino
            or opened.st_size != initial.st_size
            or opened.st_uid != 0
            or opened.st_gid != verifier_gid
            or (opened.st_mode & 0o7777) != 0o440
        ):
            fail(label + " changed while being opened")
        content = b""
        while len(content) <= MAX_RESULT_BYTES:
            block = os.read(descriptor, min(65536, MAX_RESULT_BYTES + 1 - len(content)))
            if not block:
                break
            content += block
        if len(content) > MAX_RESULT_BYTES:
            fail(label + " exceeds the fixed byte limit")
        final = os.fstat(descriptor)
        if final.st_dev != opened.st_dev or final.st_ino != opened.st_ino or final.st_size != len(content):
            fail(label + " changed while being read")
        try:
            text = content.decode("utf-8")
            value = json.loads(text)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            fail(label + " is not UTF-8 JSON: " + str(error))
        if canonical(value) != text:
            fail(label + " is not canonical")
        return value
    except OSError as error:
        fail(label + " cannot be read: " + str(error))
    finally:
        if descriptor is not None:
            os.close(descriptor)


def validate_shadow_summary(value, label):
    value = require_exact_keys(
        value,
        {"schema_version", "status", "intake_id", "record_hash", "idempotent", "disclosure"},
        label,
    )
    disclosure = require_exact_keys(
        value["disclosure"],
        {
            "engine",
            "owner_kernel_authority",
            "legacy_execution_authority",
            "effect_authority",
            "broker_authority",
            "witness_assurance",
            "acceptance",
            "alias_retirement_eligible",
        },
        label + " disclosure",
    )
    engine = require_exact_keys(
        disclosure["engine"],
        {"status", "dispatch_authority"},
        label + " disclosure engine",
    )
    if (
        value["schema_version"] != SCHEMA_VERSION
        or value["status"] != "shadow_intake_recorded"
        or not isinstance(value["idempotent"], bool)
        or engine["status"] != "not_started"
        or engine["dispatch_authority"] != "not_available"
        or disclosure["owner_kernel_authority"] != "none"
        or disclosure["legacy_execution_authority"] != "unchanged"
        or disclosure["effect_authority"] != "none"
        or disclosure["broker_authority"] != "not_available"
        or disclosure["witness_assurance"] != "local_verifier_state_not_independent_witness"
        or disclosure["acceptance"] != "not_available"
        or disclosure["alias_retirement_eligible"] is not False
    ):
        fail(label + " is not a non-authoritative shadow admission")
    require_sha256(value["intake_id"], label + " intake_id")
    require_sha256(value["record_hash"], label + " record_hash")
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


def require_cgroup_path(value, label):
    if not isinstance(value, str) or not value.startswith("/system.slice/"):
        fail(label + " must be a system.slice cgroup path")
    if value.count("/") != 2 or not value.endswith(".service"):
        fail(label + " must name one exact transient service")
    return value


def require_exact_identity(uid, gid):
    if os.geteuid() != uid or os.getegid() != gid:
        fail("gateway does not have the expected verifier UID/GID")
    if set(os.getgroups()) != {gid}:
        fail("gateway has unexpected supplementary groups")


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


def cgroup_v2_matches(pid, expected_path):
    try:
        with open("/proc/{}/cgroup".format(pid), "r", encoding="utf-8") as source:
            lines = source.read(8192).splitlines()
    except OSError:
        return False
    return any(line == "0::" + expected_path for line in lines)


def receive_exact(connection, size, deadline):
    chunks = []
    remaining = size
    while remaining:
        timeout = deadline - time.monotonic()
        if timeout <= 0:
            fail("worker frame timed out")
        ready, _, _ = select.select([connection], [], [], timeout)
        if not ready:
            fail("worker frame timed out")
        block = connection.recv(remaining)
        if not block:
            fail("worker frame ended early")
        chunks.append(block)
        remaining -= len(block)
    return b"".join(chunks)


def read_single_frame(connection, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    header = receive_exact(connection, 4, deadline)
    size = struct.unpack("!I", header)[0]
    if size < 2 or size > MAX_FRAME_BYTES:
        fail("worker frame length is invalid")
    payload = receive_exact(connection, size, deadline)
    timeout = deadline - time.monotonic()
    if timeout <= 0:
        fail("worker frame timed out")
    ready, _, _ = select.select([connection], [], [], min(timeout, 0.1))
    if ready:
        trailing = connection.recv(1)
        if trailing:
            fail("worker sent more than one frame")
    return payload


def send_frame(connection, payload):
    if len(payload) == 0 or len(payload) > MAX_RESULT_BYTES:
        fail("verifier result length is invalid")
    connection.sendall(struct.pack("!I", len(payload)) + payload)


def peer_credentials(connection):
    if not hasattr(socket, "SO_PEERCRED"):
        fail("P3.5 gateway requires Linux SO_PEERCRED")
    raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    return struct.unpack("3i", raw)


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def write_all(descriptor, content):
    remaining = memoryview(content)
    while remaining:
        written = os.write(descriptor, remaining)
        if written <= 0:
            fail("gateway state write was short")
        remaining = remaining[written:]


def write_private_json(path, value):
    directory = os.path.dirname(path)
    temporary = os.path.join(directory, "." + os.path.basename(path) + ".pending-" + secrets.token_hex(16))
    descriptor = None
    temporary_exists = False
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        temporary_exists = True
        content = canonical(value).encode("utf-8")
        write_all(descriptor, content)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        os.replace(temporary, path)
        temporary_exists = False
        directory_descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if temporary_exists:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def validate_shadow_witness_capsule(value, label):
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
        label,
    )
    if value["schema_version"] != SCHEMA_VERSION:
        fail(label + " schema_version is unsupported")
    return {
        "schema_version": SCHEMA_VERSION,
        "shadow_admission_id": require_sha256(value["shadow_admission_id"], label + " admission id"),
        "ticket_hash": require_sha256(value["ticket_hash"], label + " ticket hash"),
        "capsule_hash": require_sha256(value["capsule_hash"], label + " capsule hash"),
        "observation_hash": require_sha256(value["observation_hash"], label + " observation hash"),
        "close_hash": require_sha256(value["close_hash"], label + " close hash"),
    }


def parse_verifier_output(output, expect_shadow_witness=False, intake_protocol_version=INTAKE_PROTOCOL_V1):
    if not output or len(output) > MAX_RESULT_BYTES:
        fail("installed verifier output is missing or too large")
    try:
        text = output.decode("utf-8")
        value = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("installed verifier output is not JSON: " + str(error))
    if canonical(value) + "\n" != text:
        fail("installed verifier output is not canonical")
    expected = {
        "acceptance",
        "bridge_receipt",
        "owner_kernel_authority",
        "receipt",
        "schema_version",
        "shadow",
        "status",
    }
    if expect_shadow_witness:
        expected.add("shadow_witness_capsule")
    if intake_protocol_version == INTAKE_PROTOCOL_V2:
        expected.add("intake_protocol_version")
        expected.add("effect_authority")
    if not isinstance(value, dict) or set(value) != expected:
        fail("installed verifier output has an unexpected shape")
    if (
        value["schema_version"] != SCHEMA_VERSION
        or value["status"] != "verified_intake"
        or value["owner_kernel_authority"] != "none"
        or value["acceptance"] != "not_available"
        or not isinstance(value["receipt"], dict)
        or not isinstance(value["bridge_receipt"], dict)
    ):
        fail("installed verifier output is not a non-authoritative intake receipt")
    if (
        intake_protocol_version == INTAKE_PROTOCOL_V2
        and (
            value["intake_protocol_version"] != INTAKE_PROTOCOL_V2
            or value["effect_authority"] != "none"
        )
    ):
        fail("installed verifier output does not match the v2 intake protocol")
    validate_shadow_summary(value["shadow"], "installed verifier shadow summary")
    if expect_shadow_witness:
        value["shadow_witness_capsule"] = validate_shadow_witness_capsule(
            value["shadow_witness_capsule"], "installed verifier shadow witness capsule"
        )
    return value


def run_node_verifier(args, payload):
    command = [
        args.node_path,
        args.verifier_path,
        "verify",
        "--config",
        args.config_path,
        "--session-id",
        args.session_id,
        "--session-challenge-hash",
        args.session_challenge_hash,
        "--session-expires-at-ms",
        str(args.session_expires_at_ms),
        "--install-binding-hash",
        args.install_binding_hash,
        "--intake-protocol-version",
        str(args.intake_protocol_version),
    ]
    workspace_ticket = getattr(args, "workspace_ticket", None)
    if workspace_ticket is not None:
        command.extend(["--workspace-ticket", workspace_ticket])
    try:
        result = subprocess.run(
            command,
            input=payload,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd="/",
            env={"LANG": "C", "LC_ALL": "C", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
            timeout=args.timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        fail("installed verifier timed out")
    if result.returncode != 0:
        fail("installed verifier rejected the intake")
    return result.stdout, parse_verifier_output(
        result.stdout,
        expect_shadow_witness=workspace_ticket is not None,
        intake_protocol_version=args.intake_protocol_version,
    )


def normalize_shadow_witness_binding(value, args, capsule):
    value = require_exact_keys(
        value,
        {
            "schema_version",
            "kind",
            "session_id",
            "ticket_hash",
            "witness_pid",
            "witness_uid",
            "witness_gid",
            "socket_gid",
        },
        "shadow witness root binding",
    )
    if (
        value["schema_version"] != SCHEMA_VERSION
        or value["kind"] != "p35_shadow_witness_binding"
        or value["session_id"] != args.session_id
        or value["ticket_hash"] != capsule["ticket_hash"]
        or value["socket_gid"] != args.verifier_gid
    ):
        fail("shadow witness root binding does not match the verifier session")
    return {
        "witness_pid": require_nonnegative_int(value["witness_pid"], "shadow witness pid", 1),
        "witness_uid": require_nonnegative_int(value["witness_uid"], "shadow witness uid", 1),
        "witness_gid": require_nonnegative_int(value["witness_gid"], "shadow witness gid", 1),
        "socket_gid": args.verifier_gid,
    }


def load_shadow_witness_client(path):
    path = require_root_owned_file(path, "shadow witness client snapshot")
    spec = importlib.util.spec_from_file_location("p35_shadow_witness_client", path)
    module = importlib.util.module_from_spec(spec)
    previous_dont_write_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_dont_write_bytecode
    return module


def append_shadow_witness(args, parsed):
    if getattr(args, "workspace_ticket", None) is None:
        return parsed
    capsule = parsed.pop("shadow_witness_capsule", None)
    if capsule is None:
        fail("installed verifier did not return a shadow witness capsule")
    binding = normalize_shadow_witness_binding(
        read_root_verifier_json(
            args.shadow_witness_binding, args.verifier_gid, "shadow witness root binding"
        ),
        args,
        capsule,
    )
    client = load_shadow_witness_client(args.shadow_witness_client)
    try:
        summary = client.record_shadow(
            args.shadow_witness_socket_root,
            args.shadow_witness_socket,
            binding["witness_pid"],
            binding["witness_uid"],
            binding["witness_gid"],
            binding["socket_gid"],
            capsule,
        )
    except client.ShadowWitnessClientError as error:
        fail("shadow witness append failed: " + str(error))
    parsed["shadow_witness"] = {
        **summary,
        "disclosure": {
            "engine": {"status": "not_started", "dispatch_authority": "not_available"},
            "owner_kernel_authority": "none",
            "effect_authority": "none",
            "acceptance": "not_available",
            "witness_assurance": "separate_uid_local_append_only_root_readback_not_p2",
            "workspace_assurance": (
                "root_held_descriptor_matches_signed_v2_ticket_and_base"
                if args.intake_protocol_version == INTAKE_PROTOCOL_V2
                else "root_held_descriptor_matches_signed_v1_path_and_base_only"
            ),
            "content_immutability": "not_available",
        },
    }
    return parsed


def acquire_replay_lock(path):
    require_absolute_path(path, "replay lock path")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or (info.st_mode & 0o022) != 0:
            fail("replay lock has an unexpected identity or mode")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            fail("replay store is busy")
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def serve(args):
    require_exact_identity(args.verifier_uid, args.verifier_gid)
    if sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED"):
        fail("P3.5 gateway requires Linux SO_PEERCRED")
    require_exact_directory(args.socket_root, args.verifier_uid, args.socket_gid, 0o2710, "gateway socket root")
    require_exact_directory(args.gateway_state_root, args.verifier_uid, args.verifier_gid, 0o700, "gateway state root")
    if os.path.lexists(args.socket_path):
        fail("gateway socket path already exists")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.settimeout(args.timeout_seconds)
    wrote_result = False
    try:
        listener.bind(args.socket_path)
        os.chmod(args.socket_path, 0o660)
        socket_info = os.lstat(args.socket_path)
        if (
            not stat.S_ISSOCK(socket_info.st_mode)
            or socket_info.st_uid != args.verifier_uid
            or socket_info.st_gid != args.socket_gid
            or (socket_info.st_mode & 0o777) != 0o660
        ):
            fail("gateway socket did not inherit the expected identity and mode")
        listener.listen(16)
        write_private_json(
            args.ready_path,
            {
                "schema_version": SCHEMA_VERSION,
                "status": "ready",
                "gateway_pid": os.getpid(),
                "gateway_uid": args.verifier_uid,
                "gateway_gid": args.verifier_gid,
                "socket_gid": args.socket_gid,
            },
        )
        connection = None
        try:
            accept_deadline = time.monotonic() + args.timeout_seconds
            while connection is None:
                remaining = accept_deadline - time.monotonic()
                if remaining <= 0:
                    fail("gateway did not receive the expected worker before the deadline")
                listener.settimeout(remaining)
                try:
                    candidate, _ = listener.accept()
                except socket.timeout:
                    fail("gateway did not receive the expected worker before the deadline")
                try:
                    pid, uid, gid = peer_credentials(candidate)
                    if (
                        uid != args.expected_worker_uid
                        or gid != args.expected_worker_gid
                        or pid != args.expected_worker_pid
                        or not cgroup_v2_matches(pid, args.expected_cgroup_path)
                    ):
                        candidate.close()
                        continue
                    connection = candidate
                except Exception:
                    candidate.close()
                    raise
            payload = read_single_frame(connection, args.timeout_seconds)
            lock_descriptor = acquire_replay_lock(args.replay_lock_path)
            try:
                output, parsed = run_node_verifier(args, payload)
                parsed = append_shadow_witness(args, parsed)
                output = (canonical(parsed) + "\n").encode("utf-8")
                if len(output) > MAX_RESULT_BYTES:
                    fail("shadow witness verifier output exceeds the fixed byte limit")
            finally:
                fcntl.flock(lock_descriptor, fcntl.LOCK_UN)
                os.close(lock_descriptor)
            send_frame(connection, output)
            write_private_json(
                args.result_path,
                {
                    "schema_version": SCHEMA_VERSION,
                    "status": "verified_intake",
                    "peer": {"pid": pid, "uid": uid, "gid": gid},
                    "receipt_hash": sha256_bytes(output),
                    "output": parsed,
                },
            )
            wrote_result = True
        finally:
            if connection is not None:
                connection.close()
    except GatewayError:
        raise
    except (OSError, ValueError) as error:
        fail("gateway runtime failure: " + str(error))
    finally:
        listener.close()
        try:
            if os.path.lexists(args.socket_path):
                info = os.lstat(args.socket_path)
                if stat.S_ISSOCK(info.st_mode) and info.st_uid == args.verifier_uid:
                    os.unlink(args.socket_path)
        except OSError:
            pass
        if not wrote_result:
            try:
                write_private_json(
                    args.result_path,
                    {"schema_version": SCHEMA_VERSION, "status": "rejected"},
                )
            except (OSError, GatewayError):
                pass
    return 0


def parser():
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    serve_parser = commands.add_parser("serve")
    serve_parser.add_argument("--socket", dest="socket_path", required=True)
    serve_parser.add_argument("--socket-root", required=True)
    serve_parser.add_argument("--socket-gid", type=int, required=True)
    serve_parser.add_argument("--gateway-state-root", required=True)
    serve_parser.add_argument("--ready-path", required=True)
    serve_parser.add_argument("--result-path", required=True)
    serve_parser.add_argument("--replay-lock-path", required=True)
    serve_parser.add_argument("--expected-worker-pid", type=int, required=True)
    serve_parser.add_argument("--expected-worker-uid", type=int, required=True)
    serve_parser.add_argument("--expected-worker-gid", type=int, required=True)
    serve_parser.add_argument("--expected-cgroup-path", required=True)
    serve_parser.add_argument("--verifier-uid", type=int, required=True)
    serve_parser.add_argument("--verifier-gid", type=int, required=True)
    serve_parser.add_argument("--node-path", required=True)
    serve_parser.add_argument("--verifier-path", required=True)
    serve_parser.add_argument("--config", dest="config_path", required=True)
    serve_parser.add_argument("--session-id", required=True)
    serve_parser.add_argument("--session-challenge-hash", required=True)
    serve_parser.add_argument("--session-expires-at-ms", type=int, required=True)
    serve_parser.add_argument("--install-binding-hash", required=True)
    serve_parser.add_argument("--intake-protocol-version", type=int, default=INTAKE_PROTOCOL_V1)
    serve_parser.add_argument("--timeout-seconds", type=int, required=True)
    serve_parser.add_argument("--workspace-ticket")
    serve_parser.add_argument("--shadow-witness-binding")
    serve_parser.add_argument("--shadow-witness-socket")
    serve_parser.add_argument("--shadow-witness-socket-root")
    serve_parser.add_argument("--shadow-witness-client")
    serve_parser.set_defaults(handler=serve)
    return root


def normalize_args(args):
    args.socket_path = require_absolute_path(args.socket_path, "socket path")
    args.socket_root = require_absolute_path(args.socket_root, "socket root")
    args.gateway_state_root = require_absolute_path(args.gateway_state_root, "gateway state root")
    args.ready_path = require_absolute_path(args.ready_path, "ready path")
    args.result_path = require_absolute_path(args.result_path, "result path")
    args.replay_lock_path = require_absolute_path(args.replay_lock_path, "replay lock path")
    args.node_path = require_absolute_path(args.node_path, "node path")
    args.verifier_path = require_absolute_path(args.verifier_path, "verifier path")
    args.config_path = require_absolute_path(args.config_path, "config path")
    args.session_id = require_token(args.session_id, "session_id")
    args.session_challenge_hash = require_sha256(args.session_challenge_hash, "session_challenge_hash")
    args.session_expires_at_ms = require_nonnegative_int(
        args.session_expires_at_ms, "session_expires_at_ms", 1
    )
    args.install_binding_hash = require_sha256(args.install_binding_hash, "install_binding_hash")
    args.intake_protocol_version = require_nonnegative_int(
        args.intake_protocol_version, "intake_protocol_version", INTAKE_PROTOCOL_V1
    )
    if args.intake_protocol_version not in {INTAKE_PROTOCOL_V1, INTAKE_PROTOCOL_V2}:
        fail("intake_protocol_version is unsupported")
    args.expected_worker_pid = require_nonnegative_int(args.expected_worker_pid, "expected_worker_pid", 1)
    args.expected_worker_uid = require_nonnegative_int(args.expected_worker_uid, "expected_worker_uid", 1)
    args.expected_worker_gid = require_nonnegative_int(args.expected_worker_gid, "expected_worker_gid", 1)
    args.verifier_uid = require_nonnegative_int(args.verifier_uid, "verifier_uid", 1)
    args.verifier_gid = require_nonnegative_int(args.verifier_gid, "verifier_gid", 1)
    args.socket_gid = require_nonnegative_int(args.socket_gid, "socket_gid", 1)
    args.expected_cgroup_path = require_cgroup_path(args.expected_cgroup_path, "expected_cgroup_path")
    args.timeout_seconds = require_nonnegative_int(args.timeout_seconds, "timeout_seconds", 1)
    witness_values = (
        args.workspace_ticket,
        args.shadow_witness_binding,
        args.shadow_witness_socket,
        args.shadow_witness_socket_root,
        args.shadow_witness_client,
    )
    if any(value is not None for value in witness_values) and any(value is None for value in witness_values):
        fail("shadow witness arguments must be present together")
    if args.workspace_ticket is not None:
        args.workspace_ticket = require_absolute_path(args.workspace_ticket, "workspace ticket")
        args.shadow_witness_binding = require_absolute_path(
            args.shadow_witness_binding, "shadow witness binding"
        )
        args.shadow_witness_socket = require_absolute_path(
            args.shadow_witness_socket, "shadow witness socket"
        )
        args.shadow_witness_socket_root = require_absolute_path(
            args.shadow_witness_socket_root, "shadow witness socket root"
        )
        args.shadow_witness_client = require_absolute_path(
            args.shadow_witness_client, "shadow witness client"
        )
    if args.expected_worker_uid == args.verifier_uid or args.expected_worker_gid == args.verifier_gid:
        fail("worker and verifier identities must be distinct")
    return args


def main():
    try:
        args = normalize_args(parser().parse_args())
        return args.handler(args)
    except GatewayError as error:
        sys.stderr.write("supervised-intake-gateway: " + str(error) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
