#!/usr/bin/python3 -I
"""P3.5a root-owned authenticated-intake shadow host.

``install`` is a root-operator trust handoff. It snapshots the host, gateway,
worker, Node verifier, P3.3 contract dependencies, and an Ed25519 public
keyring. ``begin`` creates a short-lived host challenge; v1 ``submit`` moves
bounded opaque bytes from root stdin to the dedicated worker, while v2 first
performs a bounded non-authenticating structural path-field preflight. The
unprivileged verifier parses the request and produces a non-authoritative
receipt.
"""

import argparse
import base64
import fcntl
import hashlib
import importlib.util
import json
import os
import pwd
import grp
import select
import secrets
import signal
import socket
import stat
import struct
import subprocess
import sys
import time


SCHEMA_VERSION = 1
INTAKE_PROTOCOL_V1 = 1
INTAKE_PROTOCOL_V2 = 2
WORKER_IDENTITY = "autopilot-intake-worker"
VERIFIER_IDENTITY = "autopilot-verifier"
SHADOW_WITNESS_IDENTITY = "autopilot-shadow-witness"
LEGACY_P34_WORKER_IDENTITY = "autopilot-worker"
RUNTIME_PARENT = "/run/autopilot-intake"
CONFIG_RELATIVE_PATH = "etc/supervised-intake-host.json"
KEYRING_RELATIVE_PATH = "etc/owner-intake-keyring.json"
FILE_LAYOUT = {
    "host": "sbin/supervised-intake-host.py",
    "node_runtime": "sbin/node",
    "p34_support": "lib/p34-support.py",
    "gateway": "lib/supervised-intake-gateway.py",
    "worker": "lib/supervised-intake-worker.py",
    "verifier": "lib/supervised-intake-verifier.js",
    "authenticated_intake": "lib/supervised-authenticated-intake.js",
    "bridge_contract": "lib/supervised-engine-bridge-contract.js",
    "shadow_engine_consumer": "lib/supervised-shadow-engine-consumer.js",
    "workspace_registry": "lib/supervised-workspace-registry.py",
    "shadow_witness": "lib/supervised-shadow-witness.py",
    "shadow_witness_client": "lib/supervised-shadow-witness-client.py",
    "canonical": "lib/owner-kernel/canonical.js",
    "actions": "lib/owner-kernel/actions.js",
    "errors": "lib/owner-kernel/errors.js",
    "policy": "lib/owner-kernel/policy.js",
}
SYSTEM_PATHS = {
    "python_path": "/usr/bin/python3",
    "setpriv_path": "/usr/bin/setpriv",
    "systemd_run_path": "/usr/bin/systemd-run",
    "systemctl_path": "/usr/bin/systemctl",
    "useradd_path": "/usr/sbin/useradd",
}
SYSTEMD_PROPERTIES = (
    "NoNewPrivileges=yes",
    "PrivateNetwork=yes",
    "PrivateTmp=yes",
    "ProtectSystem=strict",
    "ProtectHome=tmpfs",
    "ProtectProc=invisible",
    "RestrictNamespaces=yes",
    "RestrictSUIDSGID=yes",
    "CapabilityBoundingSet=",
    "CollectMode=inactive-or-failed",
    "RuntimeMaxSec=45s",
    "TimeoutStopSec=5s",
)
# The verifier must read /proc/<worker-pid>/cgroup after SO_PEERCRED. Keeping
# ProtectProc=invisible here would hide the very cgroup evidence it must verify.
GATEWAY_SYSTEMD_PROPERTIES = tuple(
    value for value in SYSTEMD_PROPERTIES if value != "ProtectProc=invisible"
)
WITNESS_SYSTEMD_PROPERTIES = GATEWAY_SYSTEMD_PROPERTIES
MAX_CONFIG_BYTES = 65536
MAX_REQUEST_BYTES = 262144
REQUEST_TIMEOUT_SECONDS = 5
RELEASE_TIMEOUT_SECONDS = 15
NODE_PREFLIGHT_TIMEOUT_SECONDS = 5
SESSION_TTL_MILLISECONDS = 5 * 60 * 1000
SESSION_SUBMIT_GRACE_MILLISECONDS = 60 * 1000
SESSION_CREATION_GRACE_MILLISECONDS = 60 * 1000
MAX_RUNTIME_SESSIONS = 64
MAX_KEY_LIFETIME_MILLISECONDS = 366 * 24 * 60 * 60 * 1000
MAX_ENVELOPE_LIFETIME_MILLISECONDS = 2 * 60 * 1000
MAX_FUTURE_SKEW_MILLISECONDS = 1000
MAX_CLOCK_ROLLBACK_MILLISECONDS = 0
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
SHA256_CHARS = frozenset("0123456789abcdef")
GIT_SHA_CHARS = frozenset("0123456789abcdef")
BASE64URL_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
)


class HostError(Exception):
    pass


def bootstrap_canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def bootstrap_path_components(path):
    components = ["/"]
    current = ""
    for part in path.split("/"):
        if part:
            current += "/" + part
            components.append(current)
    return components


def bootstrap_require_root_owned_path(path, label, directory=False, executable=False):
    if (
        not isinstance(path, str)
        or not path.startswith("/")
        or path.startswith("//")
        or os.path.normpath(path) != path
        or path == "/"
    ):
        raise HostError(label + " must be a canonical non-root absolute path")
    try:
        resolved = os.path.realpath(path)
    except OSError as error:
        raise HostError(label + " cannot be resolved: " + str(error)) from error
    if resolved != path:
        raise HostError(label + " must not resolve through a symlink")
    for component in bootstrap_path_components(path):
        try:
            info = os.lstat(component)
        except OSError as error:
            raise HostError(label + " has an unreadable ancestor: " + str(error)) from error
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022) != 0:
            raise HostError(label + " has an untrusted ancestor " + component)
    final_info = os.lstat(path)
    if not stat.S_ISREG(final_info.st_mode):
        raise HostError(label + " must be a regular file")
    if directory:
        raise HostError(label + " bootstrap only accepts regular files")
    if executable and (final_info.st_mode & 0o111) == 0:
        raise HostError(label + " must be executable")
    return path


def bootstrap_load_installed_p34_support(install_root):
    config_path = os.path.join(install_root, CONFIG_RELATIVE_PATH)
    bootstrap_require_root_owned_path(config_path, "installed P3.5 bootstrap config")
    try:
        with open(config_path, "rb") as source:
            raw = source.read(MAX_CONFIG_BYTES + 1)
    except OSError as error:
        raise HostError("installed P3.5 bootstrap config cannot be read: " + str(error)) from error
    if not raw or len(raw) > MAX_CONFIG_BYTES:
        raise HostError("installed P3.5 bootstrap config has an invalid size")
    try:
        text = raw.decode("utf-8")
        config = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HostError("installed P3.5 bootstrap config is not UTF-8 JSON: " + str(error)) from error
    if not isinstance(config, dict) or bootstrap_canonical(config) != text:
        raise HostError("installed P3.5 bootstrap config is not canonical")
    if config.get("install_root") != install_root:
        raise HostError("installed P3.5 bootstrap config has an unexpected root")
    binding_hash = config.get("binding_hash")
    material = dict(config)
    material.pop("binding_hash", None)
    if (
        not isinstance(binding_hash, str)
        or len(binding_hash) != 64
        or any(character not in SHA256_CHARS for character in binding_hash)
        or hashlib.sha256(bootstrap_canonical(material).encode("utf-8")).hexdigest() != binding_hash
    ):
        raise HostError("installed P3.5 bootstrap config binding_hash does not match content")
    files = config.get("files")
    entry = files.get("p34_support") if isinstance(files, dict) else None
    if not isinstance(entry, dict) or entry.get("relative_path") != FILE_LAYOUT["p34_support"]:
        raise HostError("installed P3.5 bootstrap p34 support entry is invalid")
    digest = entry.get("sha256")
    if (
        not isinstance(digest, str)
        or len(digest) != 64
        or any(character not in SHA256_CHARS for character in digest)
    ):
        raise HostError("installed P3.5 bootstrap p34 support digest is invalid")
    support = os.path.join(install_root, FILE_LAYOUT["p34_support"])
    bootstrap_require_root_owned_path(support, "installed P3.5 bootstrap p34 support")
    try:
        with open(support, "rb") as source:
            actual = hashlib.sha256(source.read()).hexdigest()
    except OSError as error:
        raise HostError("installed P3.5 bootstrap p34 support cannot be read: " + str(error)) from error
    if actual != digest:
        raise HostError("installed P3.5 bootstrap p34 support hash does not match")
    return support


def load_p34_support():
    invoked = os.path.abspath(__file__)
    current = os.path.realpath(invoked)
    install_root = os.path.dirname(os.path.dirname(current))
    installed_host = os.path.join(install_root, FILE_LAYOUT["host"])
    checkout = os.path.join(os.path.dirname(current), "supervised-host-launcher.py")
    if current == installed_host:
        if invoked != current:
            raise HostError("installed P3.5 host must not run through a symlink")
        source = bootstrap_load_installed_p34_support(install_root)
    else:
        source = checkout
    spec = importlib.util.spec_from_file_location("p35_p34_support", source)
    module = importlib.util.module_from_spec(spec)
    previous_dont_write_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_dont_write_bytecode
    return module


P34 = None


def load_snapshot_python_module(install_root, file_key, module_name):
    current = os.path.realpath(os.path.abspath(__file__))
    installed_host = os.path.join(install_root, FILE_LAYOUT["host"])
    if current == installed_host:
        source = os.path.join(install_root, FILE_LAYOUT[file_key])
        P34.require_root_owned_path(source, file_key + " snapshot", executable=file_key in {"workspace_registry", "shadow_witness"})
    else:
        source = os.path.join(os.path.dirname(current), os.path.basename(FILE_LAYOUT[file_key]))
    spec = importlib.util.spec_from_file_location(module_name, source)
    module = importlib.util.module_from_spec(spec)
    previous_dont_write_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_dont_write_bytecode
    return module


def load_workspace_registry(install_root):
    return load_snapshot_python_module(install_root, "workspace_registry", "p35_workspace_registry")


def load_shadow_witness_client(install_root):
    return load_snapshot_python_module(install_root, "shadow_witness_client", "p35_shadow_witness_client")


def fail(message):
    raise HostError(message)


def canonical(value):
    # P3.5's root-owned state is consumed by the installed Node verifier. Its
    # fixed schemas use ASCII keys, so literal UTF-8 values match canonicalJson.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def sha256_value(value):
    if not isinstance(value, str):
        value = canonical(value)
    return sha256_bytes(value.encode("utf-8"))


def emit(value):
    sys.stdout.write(canonical(value) + "\n")
    sys.stdout.flush()


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


def require_git_sha(value, label):
    if (
        not isinstance(value, str)
        or len(value) != 40
        or any(character not in GIT_SHA_CHARS for character in value)
    ):
        fail(label + " must be a lowercase full 40-character Git SHA")
    return value


def require_nonnegative_int(value, label, minimum=0):
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        fail(label + " must be a bounded integer")
    return value


def require_safe_int(value, label, minimum=0):
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < minimum
        or value > 9007199254740991
    ):
        fail(label + " must be a bounded integer")
    return value


def require_absolute_path(value, label):
    if not isinstance(value, str) or not value.startswith("/"):
        fail(label + " must be an absolute path")
    if os.path.normpath(value) != value or value.startswith("//") or value == "/":
        fail(label + " must be a canonical non-root path")
    return value


def require_plain_object(value, label):
    if not isinstance(value, dict):
        fail(label + " must be an object")
    return value


def require_exact_keys(value, expected, label):
    value = require_plain_object(value, label)
    if set(value) != set(expected):
        fail(label + " has an unexpected key set")
    return value


def require_canonical_json_bytes(raw, label, maximum):
    if not isinstance(raw, bytes) or len(raw) == 0 or len(raw) > maximum:
        fail(label + " must contain bounded JSON bytes")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(label + " is not valid UTF-8 JSON: " + str(error))
    if canonical(value) != text:
        fail(label + " must use exact canonical JSON bytes")
    return value


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


def read_canonical_json_file(path, label, maximum=MAX_CONFIG_BYTES):
    try:
        info = os.lstat(path)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            fail(label + " must be a regular non-symlink file")
        with open(path, "rb") as source:
            raw = source.read(maximum + 1)
    except OSError as error:
        fail(label + " cannot be read: " + str(error))
    return require_canonical_json_bytes(raw, label, maximum)


def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def fsync_snapshot_tree(snapshot_root):
    # File contents are synced by the snapshot writers. Persist each directory
    # entry bottom-up before atomically publishing the completed release root.
    for relative in ("lib/owner-kernel", "sbin", "lib", "etc"):
        fsync_directory(os.path.join(snapshot_root, relative))
    fsync_directory(snapshot_root)


def write_all(descriptor, content):
    remaining = memoryview(content)
    while remaining:
        written = os.write(descriptor, remaining)
        if written <= 0:
            fail("root state write was short")
        remaining = remaining[written:]


def write_atomic_root_json(path, value, mode=0o600, replace=False, uid=0, gid=0):
    directory = os.path.dirname(path)
    temporary = os.path.join(directory, "." + os.path.basename(path) + ".pending-" + secrets.token_hex(16))
    if os.path.lexists(path) and not replace:
        fail("root state path already exists")
    descriptor = None
    temporary_exists = False
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            mode,
        )
        temporary_exists = True
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, mode)
        write_all(descriptor, canonical(value).encode("utf-8"))
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        if replace:
            os.replace(temporary, path)
        else:
            os.link(temporary, path, follow_symlinks=False)
            os.unlink(temporary)
        temporary_exists = False
        fsync_directory(directory)
    except FileExistsError as error:
        fail("root state path already exists: " + str(error))
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if temporary_exists:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def read_bounded_stdin(timeout_seconds, descriptor=None):
    if descriptor is None:
        descriptor = sys.stdin.fileno()
    deadline = time.monotonic() + timeout_seconds
    try:
        previous_blocking = os.get_blocking(descriptor)
        os.set_blocking(descriptor, False)
    except OSError as error:
        fail("P3.5 submit stdin cannot be made nonblocking: " + str(error))
    blocks = []
    total = 0
    poller = select.poll()
    poller.register(descriptor, select.POLLIN | select.POLLHUP | select.POLLERR | select.POLLNVAL)
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                fail("P3.5 submit request timed out before EOF")
            events = poller.poll(max(1, int(remaining * 1000)))
            if not events:
                continue
            flags = events[0][1]
            if flags & select.POLLNVAL:
                fail("P3.5 submit stdin descriptor is invalid")
            if flags & select.POLLERR:
                fail("P3.5 submit stdin reported an error")
            try:
                block = os.read(descriptor, min(65536, MAX_REQUEST_BYTES + 1 - total))
            except BlockingIOError:
                continue
            if not block:
                break
            total += len(block)
            if total > MAX_REQUEST_BYTES:
                fail("P3.5 submit request exceeds the fixed byte limit")
            blocks.append(block)
    finally:
        try:
            os.set_blocking(descriptor, previous_blocking)
        except OSError as error:
            fail("P3.5 submit stdin blocking mode cannot be restored: " + str(error))
    if total == 0:
        fail("P3.5 submit request is empty")
    return b"".join(blocks)


def decode_canonical_base64url(value, label, maximum):
    if (
        not isinstance(value, str)
        or not value
        or len(value) > maximum * 2
        or any(character not in BASE64URL_CHARS for character in value)
    ):
        fail(label + " must be bounded canonical base64url")
    try:
        padding = "=" * (-len(value) % 4)
        decoded = base64.urlsafe_b64decode(value + padding)
    except (ValueError, UnicodeEncodeError) as error:
        fail(label + " is invalid base64url: " + str(error))
    if (
        len(decoded) == 0
        or len(decoded) > maximum
        or base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=") != value
    ):
        fail(label + " must be bounded canonical base64url")
    return decoded


def reject_v2_structured_workspace_path_fields(value, label):
    pending = [value]
    while pending:
        current = pending.pop()
        if isinstance(current, dict):
            for key, nested in current.items():
                if key in {"workspaceRoot", "workspace_root"}:
                    fail(label + " must not carry a raw workspace path field")
                pending.append(nested)
        elif isinstance(current, list):
            pending.extend(current)


def preflight_v2_request_before_worker_handoff(raw):
    value = require_canonical_json_bytes(raw, "P3.5d v2 root preflight request", MAX_REQUEST_BYTES)
    value = require_exact_keys(
        value,
        {"bridge_input", "envelope", "protocol_version", "session_id"},
        "P3.5d v2 root preflight request",
    )
    if value["protocol_version"] != INTAKE_PROTOCOL_V2:
        fail("P3.5d v2 root preflight request protocol_version is invalid")
    require_token(value["session_id"], "P3.5d v2 root preflight session id")
    bridge_input = require_plain_object(value["bridge_input"], "P3.5d v2 root preflight bridge input")
    envelope = require_exact_keys(
        value["envelope"],
        {"schema_version", "protected_payload", "signature"},
        "P3.5d v2 root preflight envelope",
    )
    if envelope["schema_version"] != INTAKE_PROTOCOL_V2:
        fail("P3.5d v2 root preflight envelope schema_version is invalid")
    decode_canonical_base64url(
        envelope["signature"], "P3.5d v2 root preflight signature", MAX_REQUEST_BYTES
    )
    protected_claims = require_canonical_json_bytes(
        decode_canonical_base64url(
            envelope["protected_payload"],
            "P3.5d v2 root preflight protected payload",
            MAX_REQUEST_BYTES,
        ),
        "P3.5d v2 root preflight protected claims",
        MAX_REQUEST_BYTES,
    )
    reject_v2_structured_workspace_path_fields(
        bridge_input, "P3.5d v2 root preflight bridge input"
    )
    reject_v2_structured_workspace_path_fields(
        protected_claims, "P3.5d v2 root preflight protected claims"
    )


def file_digest(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while True:
            block = source.read(65536)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def require_private_service_account(identity, create):
    try:
        account = pwd.getpwnam(identity)
    except KeyError:
        if not create:
            fail("dedicated " + identity + " account is absent; run install with the matching create flag")
        useradd = P34.resolve_root_executable(SYSTEM_PATHS["useradd_path"], "useradd_path")
        result = subprocess.run(
            [
                useradd,
                "--system",
                "--user-group",
                "--home-dir",
                "/nonexistent",
                "--shell",
                "/usr/sbin/nologin",
                identity,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={"LANG": "C", "LC_ALL": "C", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
            check=False,
        )
        if result.returncode != 0:
            fail("cannot create dedicated " + identity + " account: " + result.stderr.strip())
        account = pwd.getpwnam(identity)
    if account.pw_uid == 0 or account.pw_gid == 0:
        fail("dedicated " + identity + " account must be unprivileged")
    if account.pw_shell != "/usr/sbin/nologin" or account.pw_dir != "/nonexistent":
        fail("dedicated " + identity + " account must be non-login")
    group = grp.getgrgid(account.pw_gid)
    if group.gr_name != identity or group.gr_mem:
        fail("dedicated " + identity + " primary group is not private")
    try:
        memberships = os.getgrouplist(account.pw_name, account.pw_gid)
    except (AttributeError, OSError) as error:
        fail("dedicated " + identity + " group membership cannot be resolved: " + str(error))
    if set(memberships) != {account.pw_gid}:
        fail("dedicated " + identity + " must not have supplementary groups")
    return {"identity": identity, "uid": account.pw_uid, "gid": account.pw_gid}


def require_unprivileged_runtime_ancestors(path, label):
    for component in P34.path_components(path)[:-1]:
        try:
            info = os.lstat(component)
        except OSError as error:
            fail(label + " ancestor cannot be inspected: " + str(error))
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            fail(label + " has an invalid ancestor " + component)
        if (info.st_mode & 0o001) == 0:
            fail(label + " is not traversable by an unprivileged runtime at " + component)


def require_distinct_legacy_p34_worker_identity(worker):
    try:
        legacy = pwd.getpwnam(LEGACY_P34_WORKER_IDENTITY)
    except KeyError:
        return
    if worker["uid"] == legacy.pw_uid or worker["gid"] == legacy.pw_gid:
        fail("P3.5 intake worker must not share a UID or GID with the legacy P3.4 worker")


def ensure_state_root(state_root, verifier, create=False):
    state_root = require_absolute_path(state_root, "state_root")
    parent = os.path.dirname(state_root)
    P34.ensure_root_directory_chain(parent)
    require_unprivileged_runtime_ancestors(state_root, "verifier state root")
    if not os.path.exists(state_root):
        if not create:
            fail("verifier state root is absent")
        P34.create_directory(state_root, verifier["uid"], verifier["gid"], 0o700, "verifier state root")
    require_exact_directory(state_root, verifier["uid"], verifier["gid"], 0o700, "verifier state root")
    replay_root = os.path.join(state_root, "replay")
    if not os.path.exists(replay_root):
        if not create:
            fail("verifier replay root is absent")
        P34.create_directory(replay_root, verifier["uid"], verifier["gid"], 0o700, "verifier replay root")
    require_exact_directory(replay_root, verifier["uid"], verifier["gid"], 0o700, "verifier replay root")
    return state_root


def ensure_root_private_state_root(state_root, label, create=False):
    state_root = require_absolute_path(state_root, label)
    parent = os.path.dirname(state_root)
    P34.ensure_root_directory_chain(parent)
    if not os.path.exists(state_root):
        if not create:
            fail(label + " is absent")
        P34.create_directory(state_root, 0, 0, 0o700, label)
    require_exact_directory(state_root, 0, 0, 0o700, label)
    return state_root


def ensure_witness_state_root(state_root, witness, create=False):
    state_root = require_absolute_path(state_root, "shadow witness state root")
    parent = os.path.dirname(state_root)
    P34.ensure_root_directory_chain(parent)
    require_unprivileged_runtime_ancestors(state_root, "shadow witness state root")
    if not os.path.exists(state_root):
        if not create:
            fail("shadow witness state root is absent")
        P34.create_directory(
            state_root,
            witness["uid"],
            witness["gid"],
            0o700,
            "shadow witness state root",
        )
    require_exact_directory(
        state_root,
        witness["uid"],
        witness["gid"],
        0o700,
        "shadow witness state root",
    )
    return state_root


def validate_keyring_bytes(raw, label):
    value = require_canonical_json_bytes(raw, label, MAX_CONFIG_BYTES)
    value = require_exact_keys(value, {"schema_version", "issuer", "keyring_id", "keyring_epoch", "keys"}, label)
    if value["schema_version"] != SCHEMA_VERSION:
        fail(label + " schema_version is unsupported")
    issuer = require_token(value["issuer"], label + " issuer")
    keyring_id = require_token(value["keyring_id"], label + " keyring_id")
    require_safe_int(value["keyring_epoch"], label + " keyring_epoch", 1)
    if not isinstance(value["keys"], list) or not value["keys"] or len(value["keys"]) > 16:
        fail(label + " keys must be a bounded non-empty array")
    seen = set()
    for index, key in enumerate(value["keys"]):
        key = require_exact_keys(
            key,
            {"algorithm", "key_id", "not_before_ms", "not_after_ms", "public_key_spki_base64"},
            label + " key",
        )
        if key["algorithm"] != "ed25519":
            fail(label + " key algorithm must be ed25519")
        key_id = require_token(key["key_id"], label + " key_id")
        if key_id in seen:
            fail(label + " contains duplicate key_id")
        seen.add(key_id)
        before = require_safe_int(key["not_before_ms"], label + " key not_before_ms")
        after = require_safe_int(key["not_after_ms"], label + " key not_after_ms", 1)
        if after <= before or after - before > MAX_KEY_LIFETIME_MILLISECONDS:
            fail(label + " key lifetime is invalid")
        encoded = key["public_key_spki_base64"]
        if not isinstance(encoded, str) or not encoded or len(encoded) > 4096:
            fail(label + " public key is invalid")
        if any(character not in BASE64URL_CHARS for character in encoded):
            fail(label + " public key is invalid")
        try:
            padding = "=" * (-len(encoded) % 4)
            public_key = base64.urlsafe_b64decode(encoded + padding)
        except (ValueError, UnicodeEncodeError) as error:
            fail(label + " public key is invalid: " + str(error))
        if (
            base64.urlsafe_b64encode(public_key).decode("ascii").rstrip("=") != encoded
            or len(public_key) != 44
            or public_key[:12] != bytes.fromhex("302a300506032b6570032100")
        ):
            fail(label + " public key is not a canonical Ed25519 SPKI")
    return {
        "relative_path": KEYRING_RELATIVE_PATH,
        "sha256": sha256_bytes(raw),
        "authority": {
            "issuer": issuer,
            "key_id": keyring_id,
            "attestation_hash": sha256_bytes(raw),
        },
    }


def read_keyring_source(source_path):
    try:
        info = os.lstat(source_path)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            fail("keyring source must be a regular non-symlink file")
        with open(source_path, "rb") as source:
            raw = source.read(MAX_CONFIG_BYTES + 1)
    except OSError as error:
        fail("keyring source cannot be read: " + str(error))
    if len(raw) > MAX_CONFIG_BYTES:
        fail("keyring source is too large")
    return raw, validate_keyring_bytes(raw, "keyring source")


def installation_material(
    install_root,
    state_root,
    workspace_registry_root,
    witness_state_root,
    worker,
    verifier,
    shadow_witness,
    paths,
    files,
    keyring,
):
    return {
        "schema_version": SCHEMA_VERSION,
        "install_root": install_root,
        "runtime_parent": RUNTIME_PARENT,
        "state_root": state_root,
        "workspace_registry": {
            "root": workspace_registry_root,
            "socket": os.path.join(workspace_registry_root, "registry.sock"),
        },
        "witness_state_root": witness_state_root,
        "worker": worker,
        "verifier": verifier,
        "shadow_witness": shadow_witness,
        "paths": paths,
        "files": files,
        "keyring": keyring,
        "limits": {
            "request_timeout_seconds": REQUEST_TIMEOUT_SECONDS,
            "session_ttl_milliseconds": SESSION_TTL_MILLISECONDS,
            "session_submit_grace_milliseconds": SESSION_SUBMIT_GRACE_MILLISECONDS,
            "session_creation_grace_milliseconds": SESSION_CREATION_GRACE_MILLISECONDS,
            "max_runtime_sessions": MAX_RUNTIME_SESSIONS,
            "max_envelope_lifetime_milliseconds": MAX_ENVELOPE_LIFETIME_MILLISECONDS,
            "max_future_skew_milliseconds": MAX_FUTURE_SKEW_MILLISECONDS,
            "max_clock_rollback_milliseconds": MAX_CLOCK_ROLLBACK_MILLISECONDS,
        },
        "systemd_properties": list(SYSTEMD_PROPERTIES),
    }


def installation_sources():
    source_root = os.path.dirname(os.path.realpath(__file__))
    return {
        "host": os.path.join(source_root, "supervised-intake-host.py"),
        "p34_support": os.path.join(source_root, "supervised-host-launcher.py"),
        "gateway": os.path.join(source_root, "supervised-intake-gateway.py"),
        "worker": os.path.join(source_root, "supervised-intake-worker.py"),
        "verifier": os.path.join(source_root, "supervised-intake-verifier.js"),
        "authenticated_intake": os.path.join(source_root, "supervised-authenticated-intake.js"),
        "bridge_contract": os.path.join(source_root, "supervised-engine-bridge-contract.js"),
        "shadow_engine_consumer": os.path.join(source_root, "supervised-shadow-engine-consumer.js"),
        "workspace_registry": os.path.join(source_root, "supervised-workspace-registry.py"),
        "shadow_witness": os.path.join(source_root, "supervised-shadow-witness.py"),
        "shadow_witness_client": os.path.join(source_root, "supervised-shadow-witness-client.py"),
        "canonical": os.path.join(source_root, "owner-kernel", "canonical.js"),
        "actions": os.path.join(source_root, "owner-kernel", "actions.js"),
        "errors": os.path.join(source_root, "owner-kernel", "errors.js"),
        "policy": os.path.join(source_root, "owner-kernel", "policy.js"),
    }


def resolve_node_install_source(value):
    source_path = require_absolute_path(value, "node_path")
    try:
        resolved = os.path.realpath(source_path)
        info = os.lstat(resolved)
    except OSError as error:
        fail("node_path cannot be inspected: " + str(error))
    if (
        not os.path.isabs(resolved)
        or stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or (info.st_mode & 0o111) == 0
    ):
        fail("node_path must resolve to an executable regular non-symlink file")
    return resolved


def preflight_node_runtime(node_path):
    program = (
        "const crypto=require('crypto');"
        "const spki=Buffer.from('302a300506032b6570032100'+'00'.repeat(32),'hex');"
        "const imported=crypto.createPublicKey({key:spki,format:'der',type:'spki'});"
        "const pair=crypto.generateKeyPairSync('ed25519');const message=Buffer.from('autopilot-p35-node-preflight');"
        "const signature=crypto.sign(null,message,pair.privateKey);"
        "if(imported.asymmetricKeyType!=='ed25519'||!crypto.verify(null,message,pair.publicKey,signature))process.exit(2);"
        "process.stdout.write('p35-node-ed25519-ok\\n');"
    )
    try:
        result = subprocess.run(
            [node_path, "-e", program],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd="/",
            env={"LANG": "C", "LC_ALL": "C", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
            timeout=NODE_PREFLIGHT_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        fail("node runtime preflight failed: " + str(error))
    if result.returncode != 0 or result.stdout != "p35-node-ed25519-ok\n":
        fail("node runtime does not support the required Ed25519 preflight")


def install(args):
    P34.require_root()
    install_root = require_absolute_path(args.install_root, "install_root")
    state_root = require_absolute_path(args.state_root, "state_root")
    workspace_registry_root = require_absolute_path(
        args.workspace_registry_root, "workspace_registry_root"
    )
    witness_state_root = require_absolute_path(args.witness_state_root, "witness_state_root")
    if os.path.lexists(install_root):
        fail("install_root already exists")
    worker = require_private_service_account(WORKER_IDENTITY, args.create_worker)
    verifier = require_private_service_account(VERIFIER_IDENTITY, args.create_verifier)
    shadow_witness = require_private_service_account(
        SHADOW_WITNESS_IDENTITY, args.create_shadow_witness
    )
    identities = (worker, verifier, shadow_witness)
    if len({identity["uid"] for identity in identities}) != len(identities) or len(
        {identity["gid"] for identity in identities}
    ) != len(identities):
        fail("dedicated worker, verifier, and shadow witness identities must be distinct")
    require_distinct_legacy_p34_worker_identity(worker)
    state_root = ensure_state_root(state_root, verifier, create=True)
    workspace_registry_root = ensure_root_private_state_root(
        workspace_registry_root, "workspace registry root", create=True
    )
    witness_state_root = ensure_witness_state_root(witness_state_root, shadow_witness, create=True)
    keyring_raw, keyring = read_keyring_source(args.keyring)
    node_source = resolve_node_install_source(args.node_path)
    install_parent = os.path.dirname(install_root)
    staging_root = os.path.join(
        install_parent,
        "." + os.path.basename(install_root) + ".pending-" + secrets.token_hex(16),
    )
    staging_root_created = {"value": False}
    active_install_root = {"value": staging_root}
    files = {}
    try:
        P34.ensure_root_directory_chain(install_parent)
        P34.create_directory(
            staging_root,
            0,
            0,
            0o755,
            "pending install root",
            lambda: staging_root_created.__setitem__("value", True),
        )
        for relative in ("sbin", "lib", "lib/owner-kernel", "etc"):
            P34.create_directory(
                os.path.join(staging_root, relative), 0, 0, 0o755, "install directory"
            )
        sources = installation_sources()
        sources["node_runtime"] = node_source
        for name, relative in FILE_LAYOUT.items():
            destination = os.path.join(staging_root, relative)
            P34.copy_root_snapshot_file(sources[name], destination)
            P34.require_root_owned_path(
                destination,
                name + " snapshot",
                executable=name in {"host", "gateway", "worker", "verifier", "workspace_registry", "shadow_witness"},
            )
            files[name] = {"relative_path": relative, "sha256": file_digest(destination)}
        node_snapshot = P34.require_root_owned_path(
            os.path.join(staging_root, FILE_LAYOUT["node_runtime"]),
            "node runtime snapshot",
            executable=True,
        )
        preflight_node_runtime(node_snapshot)
        keyring_path = os.path.join(staging_root, KEYRING_RELATIVE_PATH)
        P34.write_root_file(keyring_path, keyring_raw, 0o644)
        P34.require_root_owned_path(keyring_path, "keyring snapshot")
        if file_digest(keyring_path) != keyring["sha256"]:
            fail("keyring snapshot hash does not match")
        paths = {
            key: P34.resolve_root_executable(value, key)
            for key, value in SYSTEM_PATHS.items()
            if key != "useradd_path"
        }
        staging_node_snapshot = P34.require_root_owned_path(
            os.path.join(staging_root, FILE_LAYOUT["node_runtime"]),
            "node runtime snapshot",
            executable=True,
        )
        paths["node_path"] = os.path.join(install_root, FILE_LAYOUT["node_runtime"])
        material = installation_material(
            install_root,
            state_root,
            workspace_registry_root,
            witness_state_root,
            worker,
            verifier,
            shadow_witness,
            paths,
            files,
            keyring,
        )
        config = dict(material)
        config["binding_hash"] = sha256_value(material)
        config_path = os.path.join(staging_root, CONFIG_RELATIVE_PATH)
        P34.write_root_file(config_path, canonical(config).encode("utf-8"), 0o644)
        fsync_directory(os.path.dirname(config_path))
        P34.require_root_owned_path(config_path, "installed config")
        # A release that service accounts cannot traverse is not an installed
        # release. Validate the complete snapshot before reporting success.
        validation_config = dict(config)
        validation_config["paths"] = dict(paths)
        validation_config["paths"]["node_path"] = staging_node_snapshot
        validate_installed_config(staging_root, validation_config)
        fsync_snapshot_tree(staging_root)
        if os.path.lexists(install_root):
            fail("install_root appeared while the pending snapshot was being built")
        os.rename(staging_root, install_root)
        active_install_root["value"] = install_root
        fsync_directory(install_parent)
    except Exception as error:
        # Installation is all-or-nothing at the install root. State root and accounts
        # are intentional host provisioning and are never removed by a failed install.
        if staging_root_created["value"]:
            cleanup_errors = cleanup_install_tree(active_install_root["value"])
            if cleanup_errors:
                raise HostError("P3.5 installation cleanup failed: " + "; ".join(cleanup_errors)) from error
        raise
    emit(
        {
            "status": "installed",
            "install_root": install_root,
            "binding_hash": config["binding_hash"],
            "authority": keyring["authority"],
            "worker": worker,
            "verifier": verifier,
            "shadow_witness": shadow_witness,
            "owner_kernel_authority": "none",
            "acceptance": "not_available",
        }
    )


def cleanup_install_tree(install_root):
    errors = []
    if not os.path.lexists(install_root):
        return errors
    for relative in list(FILE_LAYOUT.values()) + [KEYRING_RELATIVE_PATH, CONFIG_RELATIVE_PATH]:
        candidate = os.path.join(install_root, relative)
        try:
            P34.cleanup_path(candidate, "file")
        except (OSError, P34.LauncherError) as error:
            errors.append(candidate + ": " + str(error))
    for relative in ("lib/owner-kernel", "sbin", "lib", "etc", ""):
        candidate = os.path.join(install_root, relative)
        try:
            P34.cleanup_path(candidate, "dir")
        except (OSError, P34.LauncherError) as error:
            errors.append(candidate + ": " + str(error))
    return errors


def installed_root_from_self():
    launcher_path = os.path.realpath(__file__)
    install_root = os.path.dirname(os.path.dirname(launcher_path))
    expected = os.path.join(install_root, FILE_LAYOUT["host"])
    if launcher_path != expected:
        fail("installed P3.5 host must run from its fixed snapshot path")
    P34.require_root_owned_path(install_root, "install root", directory=True)
    P34.require_root_owned_path(launcher_path, "installed host", executable=True)
    return install_root


def load_installed_config(install_root):
    config_path = os.path.join(install_root, CONFIG_RELATIVE_PATH)
    P34.require_root_owned_path(config_path, "installed config")
    config = read_canonical_json_file(config_path, "installed config")
    expected = {
        "schema_version",
        "install_root",
        "runtime_parent",
        "state_root",
        "workspace_registry",
        "witness_state_root",
        "worker",
        "verifier",
        "shadow_witness",
        "paths",
        "files",
        "keyring",
        "limits",
        "systemd_properties",
        "binding_hash",
    }
    require_exact_keys(config, expected, "installed config")
    if config["schema_version"] != SCHEMA_VERSION:
        fail("installed config schema_version is unsupported")
    if config["install_root"] != install_root or config["runtime_parent"] != RUNTIME_PARENT:
        fail("installed config has an unexpected root path")
    require_sha256(config["binding_hash"], "installed config binding_hash")
    material = dict(config)
    material.pop("binding_hash")
    if sha256_value(material) != config["binding_hash"]:
        fail("installed config binding_hash does not match content")
    return config


def validate_identity(raw, label, expected_identity):
    value = require_exact_keys(raw, {"identity", "uid", "gid"}, label)
    identity = require_token(value["identity"], label + " identity")
    uid = require_nonnegative_int(value["uid"], label + " uid", 1)
    gid = require_nonnegative_int(value["gid"], label + " gid", 1)
    if identity != expected_identity:
        fail(label + " identity is not fixed")
    return {"identity": identity, "uid": uid, "gid": gid}


def require_unprivileged_runtime_path(path, label, directory=False, readable=False, executable=False):
    candidate = P34.require_root_owned_path(path, label, directory=directory, executable=executable)
    require_unprivileged_runtime_ancestors(candidate, label)
    info = os.lstat(candidate)
    if directory and (info.st_mode & 0o001) == 0:
        fail(label + " is not traversable by an unprivileged runtime")
    if readable and (info.st_mode & 0o004) == 0:
        fail(label + " is not readable by an unprivileged runtime")
    if executable and (info.st_mode & 0o001) == 0:
        fail(label + " is not executable by an unprivileged runtime")
    return candidate


def validate_installed_config(install_root, config):
    worker = validate_identity(config["worker"], "installed worker", WORKER_IDENTITY)
    verifier = validate_identity(config["verifier"], "installed verifier", VERIFIER_IDENTITY)
    shadow_witness = validate_identity(
        config["shadow_witness"], "installed shadow witness", SHADOW_WITNESS_IDENTITY
    )
    identities = (worker, verifier, shadow_witness)
    if len({identity["uid"] for identity in identities}) != len(identities) or len(
        {identity["gid"] for identity in identities}
    ) != len(identities):
        fail("installed worker, verifier, and shadow witness identities must be distinct")
    require_distinct_legacy_p34_worker_identity(worker)
    if require_private_service_account(WORKER_IDENTITY, False) != worker:
        fail("dedicated worker account no longer matches installed config")
    if require_private_service_account(VERIFIER_IDENTITY, False) != verifier:
        fail("dedicated verifier account no longer matches installed config")
    if require_private_service_account(SHADOW_WITNESS_IDENTITY, False) != shadow_witness:
        fail("dedicated shadow witness account no longer matches installed config")
    require_unprivileged_runtime_path(
        os.path.join(install_root, CONFIG_RELATIVE_PATH), "installed config", readable=True
    )
    paths = require_exact_keys(
        config["paths"],
        {"node_path", "python_path", "setpriv_path", "systemd_run_path", "systemctl_path"},
        "installed paths",
    )
    paths = {
        key: P34.require_root_owned_path(value, key, executable=True)
        for key, value in paths.items()
    }
    require_unprivileged_runtime_path(install_root, "install root", directory=True)
    for key in ("python_path", "node_path"):
        require_unprivileged_runtime_path(paths[key], key, executable=True)
    files = require_plain_object(config["files"], "installed files")
    if set(files) != set(FILE_LAYOUT):
        fail("installed file inventory differs from the fixed snapshot")
    for name, relative in FILE_LAYOUT.items():
        entry = require_exact_keys(files[name], {"relative_path", "sha256"}, name + " snapshot")
        if entry["relative_path"] != relative:
            fail(name + " snapshot relative path is unexpected")
        destination = os.path.join(install_root, relative)
        P34.require_root_owned_path(
            destination,
            name + " snapshot",
            executable=name in {"host", "gateway", "worker", "verifier", "workspace_registry", "shadow_witness"},
        )
        if name not in {"host", "p34_support"}:
            require_unprivileged_runtime_path(
                destination,
                name + " snapshot",
                readable=True,
                executable=name in {"gateway", "worker", "verifier", "shadow_witness"},
            )
        if file_digest(destination) != require_sha256(entry["sha256"], name + " snapshot hash"):
            fail(name + " snapshot hash does not match installed content")
    keyring = require_exact_keys(config["keyring"], {"relative_path", "sha256", "authority"}, "installed keyring")
    if keyring["relative_path"] != KEYRING_RELATIVE_PATH:
        fail("installed keyring relative path is unexpected")
    keyring_path = os.path.join(install_root, KEYRING_RELATIVE_PATH)
    P34.require_root_owned_path(keyring_path, "installed keyring")
    require_unprivileged_runtime_path(keyring_path, "installed keyring", readable=True)
    if file_digest(keyring_path) != require_sha256(keyring["sha256"], "installed keyring hash"):
        fail("installed keyring hash does not match")
    with open(keyring_path, "rb") as source:
        actual_keyring = validate_keyring_bytes(source.read(MAX_CONFIG_BYTES + 1), "installed keyring")
    authority = require_exact_keys(keyring["authority"], {"issuer", "key_id", "attestation_hash"}, "installed keyring authority")
    if authority != actual_keyring["authority"]:
        fail("installed keyring authority does not match its content")
    limits = require_exact_keys(
        config["limits"],
        {
            "request_timeout_seconds",
            "session_ttl_milliseconds",
            "session_submit_grace_milliseconds",
            "session_creation_grace_milliseconds",
            "max_runtime_sessions",
            "max_envelope_lifetime_milliseconds",
            "max_future_skew_milliseconds",
            "max_clock_rollback_milliseconds",
        },
        "installed limits",
    )
    workspace_registry = require_exact_keys(
        config["workspace_registry"], {"root", "socket"}, "installed workspace registry"
    )
    registry_root = ensure_root_private_state_root(
        workspace_registry["root"], "workspace registry root"
    )
    expected_registry_socket = os.path.join(registry_root, "registry.sock")
    if workspace_registry["socket"] != expected_registry_socket:
        fail("installed workspace registry socket is unexpected")
    witness_state_root = ensure_witness_state_root(config["witness_state_root"], shadow_witness)
    if limits != installation_material(
        install_root,
        config["state_root"],
        registry_root,
        witness_state_root,
        worker,
        verifier,
        shadow_witness,
        paths,
        files,
        actual_keyring,
    )["limits"]:
        fail("installed limits differ from the frozen host protocol")
    if config["systemd_properties"] != list(SYSTEMD_PROPERTIES):
        fail("installed systemd properties differ from the frozen host protocol")
    state_root = ensure_state_root(config["state_root"], verifier)
    return {
        "worker": worker,
        "verifier": verifier,
        "shadow_witness": shadow_witness,
        "paths": paths,
        "files": files,
        "keyring": actual_keyring,
        "state_root": state_root,
        "workspace_registry": {"root": registry_root, "socket": expected_registry_socket},
        "witness_state_root": witness_state_root,
        "limits": limits,
    }


def ensure_runtime_parent():
    if not os.path.exists(RUNTIME_PARENT):
        P34.ensure_root_directory_chain(os.path.dirname(RUNTIME_PARENT))
        try:
            P34.create_directory(RUNTIME_PARENT, 0, 0, 0o711, "P3.5 runtime parent")
        except P34.LauncherError:
            if not os.path.exists(RUNTIME_PARENT):
                raise
    require_exact_directory(RUNTIME_PARENT, 0, 0, 0o711, "P3.5 runtime parent")


def acquire_runtime_parent_lease():
    ensure_runtime_parent()
    descriptor = None
    try:
        descriptor = os.open(RUNTIME_PARENT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(descriptor)
        if (
            not stat.S_ISDIR(info.st_mode)
            or info.st_uid != 0
            or info.st_gid != 0
            or (info.st_mode & 0o7777) != 0o711
        ):
            fail("P3.5 runtime parent lease has an unexpected identity or mode")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("P3.5 runtime session lease is busy; retry after the current operation")
        return descriptor
    except Exception:
        if descriptor is not None:
            os.close(descriptor)
        raise


def session_paths(session_id):
    require_token(session_id, "session_id")
    return session_paths_from_root(os.path.join(RUNTIME_PARENT, session_id))


def session_paths_from_root(root):
    return {
        "root": root,
        "root_state": os.path.join(root, "root-state"),
        "worker": os.path.join(root, "worker"),
        "socket": os.path.join(root, "socket"),
        "gateway": os.path.join(root, "gateway"),
        "binding": os.path.join(root, "binding"),
        "witness": os.path.join(root, "witness"),
        "session": os.path.join(root, "root-state", "session.json"),
        "claim": os.path.join(root, "root-state", "submit-claim.json"),
        "handoff_socket": os.path.join(root, "worker", "handoff.sock"),
        "legacy_request": os.path.join(root, "worker", "request.json"),
        "release": os.path.join(root, "worker", "release.json"),
        "socket_path": os.path.join(root, "socket", "intake.sock"),
        "ready": os.path.join(root, "gateway", "ready.json"),
        "result": os.path.join(root, "gateway", "result.json"),
        "workspace_ticket": os.path.join(root, "binding", "workspace-ticket.json"),
        "witness_binding": os.path.join(root, "binding", "shadow-witness.json"),
        "witness_socket_path": os.path.join(root, "witness", "shadow.sock"),
        "witness_ready": os.path.join(root, "witness", "ready.json"),
    }


def require_session_layout(paths, worker, verifier):
    require_exact_directory(paths["root"], 0, 0, 0o711, "session root")
    require_exact_directory(paths["root_state"], 0, 0, 0o700, "session root state")
    require_exact_directory(paths["worker"], 0, worker["gid"], 0o710, "session worker root")
    require_exact_directory(paths["socket"], verifier["uid"], worker["gid"], 0o2710, "session socket root")
    require_exact_directory(paths["gateway"], verifier["uid"], verifier["gid"], 0o700, "session gateway root")


def require_sealed_p35a_session_layout(paths, worker, verifier):
    require_exact_directory(paths["root"], 0, 0, 0o711, "sealed session root")
    require_exact_directory(paths["root_state"], 0, 0, 0o700, "sealed session root state")
    require_exact_directory(paths["worker"], 0, worker["gid"], 0o710, "sealed session worker root")
    require_exact_directory(paths["socket"], 0, worker["gid"], 0o710, "sealed session socket root")
    require_exact_directory(paths["gateway"], verifier["uid"], verifier["gid"], 0o700, "sealed session gateway root")


def require_partially_sealed_p35a_session_layout(paths, worker, verifier):
    # chown() is the security boundary: once the verifier no longer owns this
    # directory it cannot replace the listener. A signal can arrive before the
    # following fchmod(), so reaping must recognize this exact transient state.
    require_exact_directory(paths["root"], 0, 0, 0o711, "partially sealed session root")
    require_exact_directory(paths["root_state"], 0, 0, 0o700, "partially sealed session root state")
    require_exact_directory(paths["worker"], 0, worker["gid"], 0o710, "partially sealed session worker root")
    require_exact_directory(paths["socket"], 0, worker["gid"], 0o2710, "partially sealed session socket root")
    require_exact_directory(paths["gateway"], verifier["uid"], verifier["gid"], 0o700, "partially sealed session gateway root")


def legacy_p34_worker_identity():
    try:
        account = pwd.getpwnam(LEGACY_P34_WORKER_IDENTITY)
    except KeyError:
        fail("legacy P3.4 worker account is absent while its runtime session remains")
    if account.pw_uid == 0 or account.pw_gid == 0:
        fail("legacy P3.4 worker account is not unprivileged")
    return {"uid": account.pw_uid, "gid": account.pw_gid}


def require_legacy_p35a_session_layout(paths, verifier):
    legacy_worker = legacy_p34_worker_identity()
    require_exact_directory(paths["root"], 0, 0, 0o711, "legacy session root")
    require_exact_directory(paths["root_state"], 0, 0, 0o700, "legacy session root state")
    require_exact_directory(paths["worker"], 0, legacy_worker["gid"], 0o710, "legacy session worker root")
    require_exact_directory(
        paths["socket"], verifier["uid"], legacy_worker["gid"], 0o2710, "legacy session socket root"
    )
    require_exact_directory(paths["gateway"], verifier["uid"], verifier["gid"], 0o700, "legacy session gateway root")


def require_reapable_session_layout(paths, worker, verifier):
    try:
        require_session_layout(paths, worker, verifier)
        return {"legacy_request_gid": worker["gid"], "worker": worker}
    except HostError as current_layout_error:
        try:
            require_sealed_p35a_session_layout(paths, worker, verifier)
            return {"legacy_request_gid": worker["gid"], "worker": worker}
        except HostError:
            try:
                require_partially_sealed_p35a_session_layout(paths, worker, verifier)
                return {"legacy_request_gid": worker["gid"], "worker": worker}
            except HostError:
                try:
                    legacy_worker = legacy_p34_worker_identity()
                    require_legacy_p35a_session_layout(paths, verifier)
                    return {"legacy_request_gid": legacy_worker["gid"], "worker": legacy_worker}
                except HostError:
                    raise current_layout_error


def normalize_session(value, config):
    required = {
        "expires_at_ms",
        "install_binding_hash",
        "schema_version",
        "session_challenge_hash",
        "session_id",
        "status",
    }
    protocol_version = INTAKE_PROTOCOL_V1
    if isinstance(value, dict) and "intake_protocol_version" in value:
        required = required | {"intake_protocol_version"}
        protocol_version = value["intake_protocol_version"]
    value = require_exact_keys(value, required, "P3.5 session state")
    if value["schema_version"] != SCHEMA_VERSION:
        fail("P3.5 session state schema_version is unsupported")
    if value["status"] not in {"open", "submitting"}:
        fail("P3.5 session state is not open")
    if value["install_binding_hash"] != config["binding_hash"]:
        fail("P3.5 session does not match the installed host")
    protocol_version = require_nonnegative_int(
        protocol_version, "P3.5 session intake protocol", INTAKE_PROTOCOL_V1
    )
    if protocol_version not in {INTAKE_PROTOCOL_V1, INTAKE_PROTOCOL_V2}:
        fail("P3.5 session intake protocol is unsupported")
    if protocol_version == INTAKE_PROTOCOL_V1 and "intake_protocol_version" in value:
        fail("P3.5 v1 session must omit intake protocol version")
    return {
        "schema_version": SCHEMA_VERSION,
        "status": value["status"],
        "session_id": require_token(value["session_id"], "P3.5 session_id"),
        "session_challenge_hash": require_sha256(value["session_challenge_hash"], "P3.5 session_challenge_hash"),
        "install_binding_hash": config["binding_hash"],
        "expires_at_ms": require_nonnegative_int(value["expires_at_ms"], "P3.5 session expiry", 1),
        "intake_protocol_version": protocol_version,
    }


def session_storage_value(session):
    value = dict(session)
    if value.get("intake_protocol_version") == INTAKE_PROTOCOL_V1:
        value.pop("intake_protocol_version", None)
    return value


def normalize_workspace_ticket(value, config, session_id=None, session_challenge_hash=None):
    value = require_exact_keys(
        value,
        {
            "schema_version",
            "kind",
            "install_binding_hash",
            "registry_instance_id",
            "registration_id",
            "workspace_root_hash",
            "immutable_base",
            "descriptor_fingerprint_hash",
            "descriptor_binding_hash",
            "session_id",
            "session_challenge_hash",
            "expires_at_ms",
            "ticket_hash",
        },
        "P3.5c workspace ticket",
    )
    material = dict(value)
    ticket_hash = require_sha256(material.pop("ticket_hash"), "P3.5c workspace ticket hash")
    if sha256_value(material) != ticket_hash:
        fail("P3.5c workspace ticket hash does not match content")
    if material["schema_version"] != SCHEMA_VERSION or material["kind"] != "p35_workspace_descriptor_ticket":
        fail("P3.5c workspace ticket protocol is unsupported")
    if material["install_binding_hash"] != config["binding_hash"]:
        fail("P3.5c workspace ticket does not match the installed host")
    normalized = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p35_workspace_descriptor_ticket",
        "install_binding_hash": config["binding_hash"],
        "registry_instance_id": require_token(
            material["registry_instance_id"], "P3.5c workspace ticket registry instance"
        ),
        "registration_id": require_token(
            material["registration_id"], "P3.5c workspace ticket registration"
        ),
        "workspace_root_hash": require_sha256(
            material["workspace_root_hash"], "P3.5c workspace ticket workspace hash"
        ),
        "immutable_base": require_git_sha(
            material["immutable_base"], "P3.5c workspace ticket immutable base"
        ),
        "descriptor_fingerprint_hash": require_sha256(
            material["descriptor_fingerprint_hash"], "P3.5c workspace ticket descriptor fingerprint"
        ),
        "descriptor_binding_hash": require_sha256(
            material["descriptor_binding_hash"], "P3.5c workspace ticket descriptor binding"
        ),
        "session_id": require_token(material["session_id"], "P3.5c workspace ticket session"),
        "session_challenge_hash": require_sha256(
            material["session_challenge_hash"], "P3.5c workspace ticket challenge"
        ),
        "expires_at_ms": require_nonnegative_int(
            material["expires_at_ms"], "P3.5c workspace ticket expiry", 1
        ),
        "ticket_hash": ticket_hash,
    }
    if session_id is not None and normalized["session_id"] != session_id:
        fail("P3.5c workspace ticket does not match the session")
    if (
        session_challenge_hash is not None
        and normalized["session_challenge_hash"] != session_challenge_hash
    ):
        fail("P3.5c workspace ticket does not match the session challenge")
    return normalized


def read_root_verifier_json(path, verifier, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != verifier["gid"]
        or (info.st_mode & 0o7777) != 0o440
    ):
        fail(label + " does not have the expected root/verifier identity and mode")
    return read_canonical_json_file(path, label)


def require_workspace_binding_layout(paths, verifier):
    require_exact_directory(
        paths["binding"], 0, verifier["gid"], 0o710, "session workspace binding root"
    )
    return paths["binding"]


def normalize_reapable_session(value, session_id):
    required = {
        "expires_at_ms",
        "install_binding_hash",
        "schema_version",
        "session_challenge_hash",
        "session_id",
        "status",
    }
    protocol_version = INTAKE_PROTOCOL_V1
    if isinstance(value, dict) and "intake_protocol_version" in value:
        required = required | {"intake_protocol_version"}
        protocol_version = value["intake_protocol_version"]
    value = require_exact_keys(value, required, "P3.5 reaped session state")
    if value["schema_version"] != SCHEMA_VERSION:
        fail("P3.5 reaped session state schema_version is unsupported")
    if value["status"] not in {"open", "submitting"}:
        fail("P3.5 reaped session state has an unexpected status")
    if require_token(value["session_id"], "P3.5 reaped session_id") != session_id:
        fail("P3.5 reaped session state does not match its runtime directory")
    protocol_version = require_nonnegative_int(
        protocol_version, "P3.5 reaped session intake protocol", INTAKE_PROTOCOL_V1
    )
    if protocol_version not in {INTAKE_PROTOCOL_V1, INTAKE_PROTOCOL_V2}:
        fail("P3.5 reaped session intake protocol is unsupported")
    if protocol_version == INTAKE_PROTOCOL_V1 and "intake_protocol_version" in value:
        fail("P3.5 reaped v1 session must omit intake protocol version")
    return {
        "schema_version": SCHEMA_VERSION,
        "status": value["status"],
        "session_id": session_id,
        "session_challenge_hash": require_sha256(value["session_challenge_hash"], "P3.5 reaped session challenge"),
        "install_binding_hash": require_sha256(value["install_binding_hash"], "P3.5 reaped install binding"),
        "expires_at_ms": require_nonnegative_int(value["expires_at_ms"], "P3.5 reaped session expiry", 1),
        "intake_protocol_version": protocol_version,
    }


def read_root_private_json(path, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != 0
        or (info.st_mode & 0o777) != 0o600
    ):
        fail(label + " does not have the expected root identity and mode")
    return read_canonical_json_file(path, label)


def generated_session_id(value):
    return (
        isinstance(value, str)
        and len(value) == 36
        and value.startswith("p35-")
        and all(character in "0123456789abcdef" for character in value[4:])
    )


def generated_pending_session_name(value):
    prefix = ".p35-"
    marker = ".pending-"
    if not isinstance(value, str) or not value.startswith(prefix):
        return False
    suffix = value[len(prefix):]
    if marker not in suffix:
        return False
    session_hex, pending_hex = suffix.split(marker, 1)
    return (
        len(session_hex) == 32
        and len(pending_hex) == 32
        and all(character in "0123456789abcdef" for character in session_hex + pending_hex)
    )


def has_exact_pending_suffix(name, prefixes):
    if not isinstance(name, str):
        return False
    for prefix in prefixes:
        if not name.startswith(prefix):
            continue
        suffix = name[len(prefix):]
        return len(suffix) == 32 and all(character in "0123456789abcdef" for character in suffix)
    return False


def cleanup_pending_state_files(paths):
    try:
        entries = list(os.scandir(paths["root_state"]))
    except FileNotFoundError:
        return []
    except OSError as error:
        return [paths["root_state"] + ": " + str(error)]
    errors = []
    for entry in entries:
        if not has_exact_pending_suffix(
            entry.name,
            (".session.json.pending-", ".submit-claim.json.pending-"),
        ):
            continue
        try:
            info = os.lstat(entry.path)
            if (
                stat.S_ISLNK(info.st_mode)
                or not stat.S_ISREG(info.st_mode)
                or info.st_uid != 0
                or info.st_gid != 0
                or (info.st_mode & 0o7777 & ~0o600) != 0
            ):
                errors.append(entry.path + ": unexpected pending state identity")
                continue
            P34.cleanup_path(entry.path, "file")
        except (OSError, P34.LauncherError) as error:
            errors.append(entry.path + ": " + str(error))
    return errors


def cleanup_worker_pending_artifacts(paths, worker):
    try:
        entries = list(os.scandir(paths["worker"]))
    except FileNotFoundError:
        return []
    except OSError as error:
        return [paths["worker"] + ": " + str(error)]
    errors = []
    for entry in entries:
        if has_exact_pending_suffix(entry.name, ("release.json.pending-",)):
            expected_kind = "file"
            valid_identity = lambda info: (
                stat.S_ISREG(info.st_mode)
                and info.st_uid == 0
                and info.st_gid in {0, worker["gid"]}
                and (info.st_mode & 0o7777 & ~0o440) == 0
            )
        elif has_exact_pending_suffix(entry.name, (".h-",)):
            expected_kind = "socket"
            valid_identity = lambda info: (
                stat.S_ISSOCK(info.st_mode)
                and (info.st_uid, info.st_gid) in {(0, 0), (worker["uid"], worker["gid"])}
                and (info.st_mode & 0o7777 & ~0o777) == 0
            )
        else:
            continue
        try:
            info = os.lstat(entry.path)
            if stat.S_ISLNK(info.st_mode) or not valid_identity(info):
                errors.append(entry.path + ": unexpected pending worker artifact identity")
                continue
            P34.cleanup_path(entry.path, expected_kind)
        except (OSError, P34.LauncherError) as error:
            errors.append(entry.path + ": " + str(error))
    return errors


def cleanup_gateway_pending_artifacts(paths, verifier):
    try:
        entries = list(os.scandir(paths["gateway"]))
    except FileNotFoundError:
        return []
    except OSError as error:
        return [paths["gateway"] + ": " + str(error)]
    errors = []
    for entry in entries:
        if not has_exact_pending_suffix(
            entry.name,
            (".ready.json.pending-", ".result.json.pending-"),
        ):
            continue
        try:
            info = os.lstat(entry.path)
            if (
                stat.S_ISLNK(info.st_mode)
                or not stat.S_ISREG(info.st_mode)
                or info.st_uid != verifier["uid"]
                or info.st_gid != verifier["gid"]
                or (info.st_mode & 0o7777 & ~0o600) != 0
            ):
                errors.append(entry.path + ": unexpected pending gateway artifact identity")
                continue
            P34.cleanup_path(entry.path, "file")
        except (OSError, P34.LauncherError) as error:
            errors.append(entry.path + ": " + str(error))
    return errors


def cleanup_pending_session(paths, worker=None, verifier=None):
    try:
        info = os.lstat(paths["root"])
    except FileNotFoundError:
        return True
    except OSError as error:
        fail("P3.5 pending session cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != 0
        or (info.st_mode & 0o7777 & ~0o711) != 0
    ):
        fail("P3.5 pending session has an unexpected identity or mode")
    if int(time.time() * 1000) < int(info.st_mtime * 1000) + SESSION_CREATION_GRACE_MILLISECONDS:
        return False
    errors = cleanup_session_paths(
        paths,
        remove_session=True,
        worker=worker,
        verifier=verifier,
    )
    if errors:
        fail("P3.5 pending session cleanup failed: " + "; ".join(errors))
    return True


def read_submit_claim(paths, session_id):
    if not os.path.lexists(paths["claim"]):
        return None
    value = require_exact_keys(
        read_root_private_json(paths["claim"], "P3.5 submit claim"),
        {"claimed_at_ms", "schema_version", "session_id"},
        "P3.5 submit claim",
    )
    if value["schema_version"] != SCHEMA_VERSION:
        fail("P3.5 submit claim schema_version is unsupported")
    if require_token(value["session_id"], "P3.5 submit claim session_id") != session_id:
        fail("P3.5 submit claim does not match its session")
    return {
        "schema_version": SCHEMA_VERSION,
        "session_id": session_id,
        "claimed_at_ms": require_nonnegative_int(value["claimed_at_ms"], "P3.5 submit claim time", 1),
    }


def release_root_lease(descriptor):
    if descriptor is None:
        return
    try:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)


def acquire_global_submit_lease():
    try:
        return acquire_runtime_parent_lease()
    except HostError as error:
        if str(error) == "P3.5 runtime session lease is busy; retry after the current operation":
            fail("P3.5 verifier is busy; retry the still-open session")
        raise


def create_submit_claim(paths, session_id, on_created):
    try:
        write_atomic_root_json(
            paths["claim"],
            {
                "schema_version": SCHEMA_VERSION,
                "session_id": session_id,
                "claimed_at_ms": int(time.time() * 1000),
            },
        )
    except HostError as error:
        if str(error).startswith("root state path already exists"):
            fail("P3.5 session has already been claimed")
        raise
    except FileNotFoundError:
        fail("P3.5 session is no longer available")
    on_created()


def reap_expired_sessions(validated):
    ensure_runtime_parent()
    now = int(time.time() * 1000)
    active_sessions = 0
    try:
        entries = sorted(os.scandir(RUNTIME_PARENT), key=lambda entry: entry.name)
    except OSError as error:
        fail("P3.5 runtime parent cannot be scanned: " + str(error))
    for entry in entries:
        if generated_pending_session_name(entry.name):
            if not cleanup_pending_session(
                session_paths_from_root(entry.path),
                worker=validated["worker"],
                verifier=validated["verifier"],
            ):
                active_sessions += 1
            continue
        if not generated_session_id(entry.name):
            fail("P3.5 runtime parent contains an unexpected entry")
        paths = session_paths(entry.name)
        layout = require_reapable_session_layout(paths, validated["worker"], validated["verifier"])
        session = normalize_reapable_session(
            read_root_private_json(paths["session"], "P3.5 reaped session state"),
            entry.name,
        )
        claim = read_submit_claim(paths, entry.name)
        if now < session["expires_at_ms"]:
            active_sessions += 1
            continue
        if claim is not None and now < session["expires_at_ms"] + SESSION_SUBMIT_GRACE_MILLISECONDS:
            active_sessions += 1
            continue
        errors = cleanup_session_paths(
            paths,
            remove_session=True,
            legacy_request_gid=layout["legacy_request_gid"],
            worker=layout["worker"],
            verifier=validated["verifier"],
        )
        if errors:
            fail("P3.5 expired session cleanup failed: " + "; ".join(errors))
    if active_sessions >= MAX_RUNTIME_SESSIONS:
        fail("P3.5 runtime parent exceeds the fixed session limit")


def workspace_registry_request(install_root, validated, operation, request):
    registry = load_workspace_registry(install_root)
    try:
        return registry.registry_request(
            validated["workspace_registry"]["socket"], operation, request
        )
    except registry.WorkspaceRegistryError as error:
        fail("P3.5c workspace registry rejected the root request: " + str(error))


def reserve_workspace_ticket(install_root, config, validated, registration_id, session):
    response = workspace_registry_request(
        install_root,
        validated,
        "reserve",
        {
            "registration_id": require_token(registration_id, "workspace registration id"),
            "session_id": session["session_id"],
            "session_challenge_hash": session["session_challenge_hash"],
            "install_binding_hash": config["binding_hash"],
            "expires_at_ms": session["expires_at_ms"],
        },
    )
    response = require_exact_keys(
        response, {"schema_version", "status", "ticket"}, "workspace registry reservation response"
    )
    if response["schema_version"] != SCHEMA_VERSION or response["status"] != "reserved":
        fail("workspace registry did not reserve the descriptor")
    return normalize_workspace_ticket(
        response["ticket"],
        config,
        session_id=session["session_id"],
        session_challenge_hash=session["session_challenge_hash"],
    )


def release_workspace_ticket(install_root, validated, ticket):
    response = workspace_registry_request(
        install_root,
        validated,
        "release",
        {
            "registration_id": ticket["registration_id"],
            "session_id": ticket["session_id"],
            "ticket_hash": ticket["ticket_hash"],
        },
    )
    response = require_exact_keys(
        response,
        {"schema_version", "status", "registration_id", "session_id", "ticket_hash"},
        "workspace registry release response",
    )
    if (
        response["schema_version"] != SCHEMA_VERSION
        or response["status"] != "released"
        or response["registration_id"] != ticket["registration_id"]
        or response["session_id"] != ticket["session_id"]
        or response["ticket_hash"] != ticket["ticket_hash"]
    ):
        fail("workspace registry did not release the descriptor")


def create_session(
    config,
    validated,
    install_root,
    workspace_registration_id=None,
    intake_protocol_version=INTAKE_PROTOCOL_V1,
):
    P34.require_root()
    P34.require_supported_host()
    if intake_protocol_version not in {INTAKE_PROTOCOL_V1, INTAKE_PROTOCOL_V2}:
        fail("P3.5 intake protocol version is unsupported")
    if intake_protocol_version == INTAKE_PROTOCOL_V2 and workspace_registration_id is None:
        fail("P3.5d v2 session requires a workspace registration id")
    reap_expired_sessions(validated)
    worker = validated["worker"]
    verifier = validated["verifier"]
    shadow_witness = validated["shadow_witness"]
    session_id = "p35-" + secrets.token_hex(16)
    challenge = secrets.token_urlsafe(32).rstrip("=")
    paths = session_paths(session_id)
    pending_root = os.path.join(
        RUNTIME_PARENT, "." + session_id + ".pending-" + secrets.token_hex(16)
    )
    pending_paths = session_paths_from_root(pending_root)
    published = False
    workspace_ticket = None
    try:
        P34.create_directory(pending_paths["root"], 0, 0, 0o711, "pending session root")
        P34.create_directory(pending_paths["root_state"], 0, 0, 0o700, "session root state")
        P34.create_directory(pending_paths["worker"], 0, worker["gid"], 0o710, "session worker root")
        P34.create_directory(pending_paths["socket"], verifier["uid"], worker["gid"], 0o2710, "session socket root")
        P34.create_directory(pending_paths["gateway"], verifier["uid"], verifier["gid"], 0o700, "session gateway root")
        session = {
            "schema_version": SCHEMA_VERSION,
            "status": "open",
            "session_id": session_id,
            "session_challenge_hash": sha256_value(challenge),
            "install_binding_hash": config["binding_hash"],
            "expires_at_ms": int(time.time() * 1000) + validated["limits"]["session_ttl_milliseconds"],
        }
        if intake_protocol_version == INTAKE_PROTOCOL_V2:
            session["intake_protocol_version"] = INTAKE_PROTOCOL_V2
        write_atomic_root_json(pending_paths["session"], session)
        if workspace_registration_id is not None:
            P34.create_directory(
                pending_paths["binding"],
                0,
                verifier["gid"],
                0o710,
                "session workspace binding root",
            )
            workspace_ticket = reserve_workspace_ticket(
                install_root,
                config,
                validated,
                workspace_registration_id,
                session,
            )
            write_atomic_root_json(
                pending_paths["workspace_ticket"],
                workspace_ticket,
                mode=0o440,
                uid=0,
                gid=verifier["gid"],
            )
        if os.path.lexists(paths["root"]):
            fail("P3.5 generated session path already exists")
        os.rename(pending_paths["root"], paths["root"])
        published = True
        fsync_directory(RUNTIME_PARENT)
    except Exception:
        if workspace_ticket is not None:
            try:
                release_workspace_ticket(install_root, validated, workspace_ticket)
            except HostError:
                pass
        cleanup_session_paths(
            paths if published else pending_paths,
            remove_session=True,
            worker=worker,
            verifier=verifier,
        )
        raise
    result = {
        "status": "session_open",
        "schema_version": SCHEMA_VERSION,
        "session_id": session_id,
        "session_challenge": challenge,
        "session_challenge_hash": session["session_challenge_hash"],
        "expires_at_ms": session["expires_at_ms"],
        "install_binding_hash": config["binding_hash"],
        "authority": validated["keyring"]["authority"],
        "owner_kernel_authority": "none",
        "acceptance": "not_available",
    }
    if workspace_ticket is not None:
        result["workspace_binding"] = {
            "registration_id": workspace_ticket["registration_id"],
            "descriptor_binding_hash": workspace_ticket["descriptor_binding_hash"],
            "ticket_hash": workspace_ticket["ticket_hash"],
            "assurance": (
                "root_held_descriptor_matches_signed_v2_ticket_and_base"
                if intake_protocol_version == INTAKE_PROTOCOL_V2
                else "root_held_descriptor_matches_signed_v1_path_and_base_only"
            ),
            "content_immutability": "not_available",
        }
        if intake_protocol_version == INTAKE_PROTOCOL_V2:
            result["workspace_binding"]["workspace_root_hash"] = workspace_ticket["workspace_root_hash"]
            result["workspace_binding"]["immutable_base"] = workspace_ticket["immutable_base"]
    if intake_protocol_version == INTAKE_PROTOCOL_V2:
        result["intake_protocol_version"] = INTAKE_PROTOCOL_V2
        result["effect_authority"] = "none"
    return result


def read_exact_private_json(path, uid, gid, label):
    try:
        initial = os.lstat(path)
    except FileNotFoundError:
        raise
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(initial.st_mode)
        or not stat.S_ISREG(initial.st_mode)
        or initial.st_uid != uid
        or initial.st_gid != gid
        or (initial.st_mode & 0o777) != 0o600
        or initial.st_size <= 0
        or initial.st_size > MAX_CONFIG_BYTES
    ):
        fail(label + " has an unexpected identity, mode, or size")
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        opened = os.fstat(descriptor)
        if (
            opened.st_dev != initial.st_dev
            or opened.st_ino != initial.st_ino
            or not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != uid
            or opened.st_gid != gid
            or (opened.st_mode & 0o777) != 0o600
        ):
            fail(label + " changed while being opened")
        blocks = []
        total = 0
        while True:
            block = os.read(descriptor, min(65536, MAX_CONFIG_BYTES + 1 - total))
            if not block:
                break
            total += len(block)
            if total > MAX_CONFIG_BYTES:
                fail(label + " exceeds the fixed byte limit")
            blocks.append(block)
        final = os.fstat(descriptor)
        if (
            final.st_dev != opened.st_dev
            or final.st_ino != opened.st_ino
            or final.st_size != total
        ):
            fail(label + " changed while being read")
        return require_canonical_json_bytes(b"".join(blocks), label, MAX_CONFIG_BYTES)
    except OSError as error:
        fail(label + " cannot be read: " + str(error))
    finally:
        if descriptor is not None:
            os.close(descriptor)


def wait_for_private_json(path, uid, gid, timeout_seconds, label):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            return read_exact_private_json(path, uid, gid, label)
        except FileNotFoundError:
            time.sleep(0.025)
            continue
    fail(label + " did not appear before the deadline")


def socket_peer_credentials(connection):
    raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    return struct.unpack("3i", raw)


def deliver_request_to_exact_worker(path, worker, worker_pid, worker_cgroup, content):
    if os.path.lexists(path):
        fail("worker handoff socket path already exists")
    # AF_UNIX pathnames have a small fixed kernel limit. Keep the staging name
    # short enough for the fixed deepest runtime session path.
    temporary = os.path.join(os.path.dirname(path), ".h-" + secrets.token_hex(16))
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    # Record the staging path before bind: the submit signal handler may run
    # immediately after bind succeeds, and cleanup_path() tolerates an absent
    # pathname if bind itself fails.
    bound_path = temporary
    try:
        listener.bind(temporary)
        # Publish only the fully finalized socket. The worker never observes a
        # bind-to-chown/mode transition at the fixed pathname.
        os.chown(temporary, worker["uid"], worker["gid"])
        os.chmod(temporary, 0o600)
        info = os.lstat(temporary)
        if (
            not stat.S_ISSOCK(info.st_mode)
            or info.st_uid != worker["uid"]
            or info.st_gid != worker["gid"]
            or (info.st_mode & 0o777) != 0o600
        ):
            fail("worker handoff socket did not inherit the expected identity and mode")
        listener.listen(16)
        os.rename(temporary, path)
        bound_path = path
        fsync_directory(os.path.dirname(path))
        deadline = time.monotonic() + REQUEST_TIMEOUT_SECONDS
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                fail("exact worker did not connect to the request handoff before the deadline")
            listener.settimeout(remaining)
            try:
                candidate, _ = listener.accept()
            except socket.timeout:
                fail("exact worker did not connect to the request handoff before the deadline")
            try:
                pid, uid, gid = socket_peer_credentials(candidate)
                if (
                    pid != worker_pid
                    or uid != worker["uid"]
                    or gid != worker["gid"]
                    or not P34.cgroup_v2_matches(pid, worker_cgroup)
                ):
                    continue
                candidate.settimeout(remaining)
                candidate.sendall(struct.pack("!I", len(content)) + content)
                candidate.shutdown(socket.SHUT_WR)
                return
            except OSError as error:
                fail("worker request handoff failed: " + str(error))
            finally:
                candidate.close()
    finally:
        listener.close()
        if bound_path is not None:
            try:
                P34.cleanup_path(bound_path, "socket")
            except (OSError, P34.LauncherError) as error:
                fail("worker handoff socket cleanup failed: " + str(error))


def create_release(path, token, server_pid, verifier, worker):
    if os.path.lexists(path):
        fail("worker release path already exists")
    temporary = path + ".pending-" + secrets.token_hex(16)
    descriptor = None
    temporary_exists = False
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        temporary_exists = True
        os.fchown(descriptor, 0, worker["gid"])
        os.fchmod(descriptor, 0o440)
        value = {
            "schema_version": SCHEMA_VERSION,
            "release_token": token,
            "server_pid": server_pid,
            "server_uid": verifier["uid"],
            "server_gid": verifier["gid"],
        }
        write_all(descriptor, canonical(value).encode("utf-8"))
        os.fsync(descriptor)
        os.link(temporary, path, follow_symlinks=False)
        os.unlink(temporary)
        temporary_exists = False
        fsync_directory(os.path.dirname(path))
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if temporary_exists:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def seal_gateway_socket_for_worker(socket_root, path, worker, verifier):
    # The verifier owns this directory only while creating its listener. Seal
    # the directory before looking up or changing the listener pathname so an
    # unprivileged verifier process cannot swap it under a root path operation.
    require_exact_directory(
        socket_root,
        verifier["uid"],
        worker["gid"],
        0o2710,
        "gateway socket root before worker release",
    )
    try:
        descriptor = os.open(socket_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as error:
        fail("gateway socket root cannot be opened before worker release: " + str(error))
    try:
        os.fchown(descriptor, 0, worker["gid"])
        os.fchmod(descriptor, 0o710)
    except OSError as error:
        fail("gateway socket root cannot be sealed for the dedicated worker: " + str(error))
    finally:
        os.close(descriptor)
    require_exact_directory(
        socket_root,
        0,
        worker["gid"],
        0o710,
        "sealed gateway socket root",
    )
    try:
        initial = os.lstat(path)
    except OSError as error:
        fail("gateway socket cannot be inspected after sealing: " + str(error))
    if (
        stat.S_ISLNK(initial.st_mode)
        or not stat.S_ISSOCK(initial.st_mode)
        or initial.st_uid != verifier["uid"]
        or initial.st_gid != worker["gid"]
        or (initial.st_mode & 0o777) != 0o660
    ):
        fail("gateway socket is not the expected verifier listener after sealing")
    try:
        os.chown(path, worker["uid"], worker["gid"])
        os.chmod(path, 0o600)
        final = os.lstat(path)
    except OSError as error:
        fail("gateway socket cannot be restricted to the dedicated worker: " + str(error))
    if (
        stat.S_ISLNK(final.st_mode)
        or not stat.S_ISSOCK(final.st_mode)
        or final.st_uid != worker["uid"]
        or final.st_gid != worker["gid"]
        or (final.st_mode & 0o777) != 0o600
    ):
        fail("gateway socket did not retain the dedicated worker restriction")


def validate_shadow_witness_ready(value, expected_pid, witness, verifier):
    value = require_exact_keys(
        value,
        {"schema_version", "status", "witness_pid", "witness_uid", "witness_gid", "socket_gid"},
        "shadow witness readiness",
    )
    if (
        value["schema_version"] != SCHEMA_VERSION
        or value["status"] != "ready"
        or value["witness_pid"] != expected_pid
        or value["witness_uid"] != witness["uid"]
        or value["witness_gid"] != witness["gid"]
        or value["socket_gid"] != verifier["gid"]
    ):
        fail("shadow witness readiness does not match the fixed host identities")


def seal_shadow_witness_socket(socket_root, socket_path, witness, verifier):
    require_exact_directory(
        socket_root,
        witness["uid"],
        verifier["gid"],
        0o2710,
        "shadow witness socket root before sealing",
    )
    try:
        descriptor = os.open(socket_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as error:
        fail("shadow witness socket root cannot be opened before sealing: " + str(error))
    try:
        os.fchown(descriptor, 0, verifier["gid"])
        os.fchmod(descriptor, 0o710)
    except OSError as error:
        fail("shadow witness socket root cannot be sealed: " + str(error))
    finally:
        os.close(descriptor)
    require_exact_directory(
        socket_root,
        0,
        verifier["gid"],
        0o710,
        "sealed shadow witness socket root",
    )
    try:
        info = os.lstat(socket_path)
    except OSError as error:
        fail("shadow witness socket cannot be inspected after sealing: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISSOCK(info.st_mode)
        or info.st_uid != witness["uid"]
        or info.st_gid != verifier["gid"]
        or (info.st_mode & 0o7777) != 0o660
    ):
        fail("shadow witness socket is not the expected sealed listener")


def write_shadow_witness_binding(path, session_id, ticket, ready, witness, verifier):
    value = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p35_shadow_witness_binding",
        "session_id": session_id,
        "ticket_hash": ticket["ticket_hash"],
        "witness_pid": ready["witness_pid"],
        "witness_uid": witness["uid"],
        "witness_gid": witness["gid"],
        "socket_gid": verifier["gid"],
    }
    write_atomic_root_json(path, value, mode=0o440, uid=0, gid=verifier["gid"])
    return value


def normalize_shadow_witness_binding(value, session_id, ticket, witness, verifier):
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
        "shadow witness binding",
    )
    if (
        value["schema_version"] != SCHEMA_VERSION
        or value["kind"] != "p35_shadow_witness_binding"
        or value["session_id"] != session_id
        or value["ticket_hash"] != ticket["ticket_hash"]
        or value["witness_uid"] != witness["uid"]
        or value["witness_gid"] != witness["gid"]
        or value["socket_gid"] != verifier["gid"]
    ):
        fail("shadow witness binding does not match the session identities")
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p35_shadow_witness_binding",
        "session_id": session_id,
        "ticket_hash": ticket["ticket_hash"],
        "witness_pid": require_nonnegative_int(value["witness_pid"], "shadow witness pid", 1),
        "witness_uid": witness["uid"],
        "witness_gid": witness["gid"],
        "socket_gid": verifier["gid"],
    }


def systemd_command(paths, unit, uid, gid, properties, command):
    return [
        paths["systemd_run_path"],
        "--no-block",
        "--quiet",
        "--collect",
        "--unit=" + unit,
        "--slice=system.slice",
        "--uid=" + str(uid),
        "--gid=" + str(gid),
    ] + ["--property=" + value for value in properties] + command


def launch_unit(paths, unit, uid, gid, properties, command, label):
    result = P34.run_command(systemd_command(paths, unit, uid, gid, properties, command), timeout_seconds=10)
    if result.returncode != 0:
        fail(label + " launch failed: " + result.stderr.strip())


def validate_gateway_ready(value, expected_pid, verifier, worker):
    value = require_exact_keys(
        value,
        {"schema_version", "status", "gateway_pid", "gateway_uid", "gateway_gid", "socket_gid"},
        "gateway readiness",
    )
    if (
        value["schema_version"] != SCHEMA_VERSION
        or value["status"] != "ready"
        or value["gateway_pid"] != expected_pid
        or value["gateway_uid"] != verifier["uid"]
        or value["gateway_gid"] != verifier["gid"]
        or value["socket_gid"] != worker["gid"]
    ):
        fail("gateway readiness does not match the fixed host identities")


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


def validate_shadow_witness_summary(
    value, ticket, label, intake_protocol_version=INTAKE_PROTOCOL_V1
):
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
            "previous_shadow_head",
            "shadow_chain_head",
            "idempotent",
            "disclosure",
        },
        label,
    )
    disclosure = require_exact_keys(
        value["disclosure"],
        {
            "engine",
            "owner_kernel_authority",
            "effect_authority",
            "acceptance",
            "witness_assurance",
            "workspace_assurance",
            "content_immutability",
        },
        label + " disclosure",
    )
    engine = require_exact_keys(
        disclosure["engine"], {"status", "dispatch_authority"}, label + " disclosure engine"
    )
    if (
        value["schema_version"] != SCHEMA_VERSION
        or value["status"] != "shadow_witness_recorded"
        or value["ticket_hash"] != ticket["ticket_hash"]
        or value["idempotent"] is not False
        or engine["status"] != "not_started"
        or engine["dispatch_authority"] != "not_available"
        or disclosure["owner_kernel_authority"] != "none"
        or disclosure["effect_authority"] != "none"
        or disclosure["acceptance"] != "not_available"
        or disclosure["witness_assurance"]
        != "separate_uid_local_append_only_root_readback_not_p2"
        or disclosure["workspace_assurance"]
        != (
            "root_held_descriptor_matches_signed_v2_ticket_and_base"
            if intake_protocol_version == INTAKE_PROTOCOL_V2
            else "root_held_descriptor_matches_signed_v1_path_and_base_only"
        )
        or disclosure["content_immutability"] != "not_available"
    ):
        fail(label + " is not a non-authoritative shadow witness record")
    for key in (
        "shadow_admission_id",
        "ticket_hash",
        "capsule_hash",
        "observation_hash",
        "close_hash",
        "shadow_chain_head",
    ):
        require_sha256(value[key], label + " " + key)
    if value["previous_shadow_head"] is not None:
        require_sha256(value["previous_shadow_head"], label + " previous shadow head")
    return value


def verify_shadow_witness_root_readback(install_root, paths, binding, ticket, summary):
    client = load_shadow_witness_client(install_root)
    try:
        response = client.invoke(
            socket_root=paths["witness"],
            socket_path=paths["witness_socket_path"],
            witness_pid=binding["witness_pid"],
            witness_uid=binding["witness_uid"],
            witness_gid=binding["witness_gid"],
            socket_gid=binding["socket_gid"],
            method="read_shadow_record",
            request={
                "shadow_admission_id": summary["shadow_admission_id"],
                "ticket_hash": ticket["ticket_hash"],
            },
        )
    except client.ShadowWitnessClientError as error:
        fail("root shadow witness readback failed: " + str(error))
    if (
        response["status"] != "shadow_closed"
        or response["idempotent"] is not True
        or response["shadow_admission_id"] != summary["shadow_admission_id"]
        or response["ticket_hash"] != summary["ticket_hash"]
        or response["capsule_hash"] != summary["capsule_hash"]
        or response["observation_hash"] != summary["observation_hash"]
        or response["close_hash"] != summary["close_hash"]
        or response["previous_shadow_head"] != summary["previous_shadow_head"]
        or response["shadow_chain_head"] != summary["shadow_chain_head"]
    ):
        fail("root shadow witness readback does not match the verifier result")


def validate_gateway_result(
    value, expected_worker, ticket=None, intake_protocol_version=INTAKE_PROTOCOL_V1
):
    if isinstance(value, dict) and set(value) == {"schema_version", "status"}:
        if value["schema_version"] == SCHEMA_VERSION and value["status"] == "rejected":
            fail("gateway rejected the intake before a verified receipt")
    value = require_exact_keys(
        value,
        {"schema_version", "status", "peer", "receipt_hash", "output"},
        "gateway result",
    )
    if value["schema_version"] != SCHEMA_VERSION or value["status"] != "verified_intake":
        fail("gateway did not produce a verified intake result")
    peer = require_exact_keys(value["peer"], {"pid", "uid", "gid"}, "gateway peer")
    if peer["pid"] != expected_worker["pid"] or peer["uid"] != expected_worker["uid"] or peer["gid"] != expected_worker["gid"]:
        fail("gateway accepted an unexpected peer")
    require_sha256(value["receipt_hash"], "gateway receipt_hash")
    expected_output = {
        "schema_version",
        "status",
        "owner_kernel_authority",
        "acceptance",
        "receipt",
        "bridge_receipt",
        "shadow",
    }
    if ticket is not None:
        expected_output.add("shadow_witness")
    if intake_protocol_version == INTAKE_PROTOCOL_V2:
        expected_output.add("intake_protocol_version")
        expected_output.add("effect_authority")
    output = require_exact_keys(value["output"], expected_output, "gateway verifier output")
    if (
        output["schema_version"] != SCHEMA_VERSION
        or output["status"] != "verified_intake"
        or output["owner_kernel_authority"] != "none"
        or output["acceptance"] != "not_available"
        or not isinstance(output["receipt"], dict)
        or not isinstance(output["bridge_receipt"], dict)
    ):
        fail("gateway verifier output is not non-authoritative")
    if (
        intake_protocol_version == INTAKE_PROTOCOL_V2
        and (
            output["intake_protocol_version"] != INTAKE_PROTOCOL_V2
            or output["effect_authority"] != "none"
        )
    ):
        fail("gateway verifier output does not match the v2 intake protocol")
    validate_shadow_summary(output["shadow"], "gateway verifier shadow summary")
    if ticket is not None:
        validate_shadow_witness_summary(
            output["shadow_witness"],
            ticket,
            "gateway verifier shadow witness summary",
            intake_protocol_version,
        )
    return {"peer": peer, "receipt_hash": value["receipt_hash"], "output": output}


def submit_session(session_id):
    P34.require_root()
    install_root = installed_root_from_self()
    config = load_installed_config(install_root)
    validated = validate_installed_config(install_root, config)
    P34.require_supported_host()
    paths = session_paths(session_id)
    worker = validated["worker"]
    verifier = validated["verifier"]
    shadow_witness = validated["shadow_witness"]
    system_paths = validated["paths"]
    worker_unit = "autopilot-p35-worker-" + secrets.token_hex(16) + ".service"
    verifier_unit = "autopilot-p35-verifier-" + secrets.token_hex(16) + ".service"
    witness_unit = "autopilot-p35-shadow-witness-" + secrets.token_hex(16) + ".service"
    worker_cgroup = "/system.slice/" + worker_unit
    verifier_cgroup = "/system.slice/" + verifier_unit
    witness_cgroup = "/system.slice/" + witness_unit
    worker_started = False
    verifier_started = False
    witness_started = False
    cleanup_errors = []
    created_resources = {"claim": False}
    global_submit_lease = None
    previous_handlers = {}
    workspace_ticket = None
    workspace_reservation_active = False
    shadow_witness_binding = None

    def interrupt_handler(_signum, _frame):
        fail("P3.5 submit interrupted before completion")

    for signal_number in (signal.SIGINT, signal.SIGTERM):
        previous_handlers[signal_number] = signal.signal(signal_number, interrupt_handler)

    try:
        global_submit_lease = acquire_global_submit_lease()
        require_session_layout(paths, worker, verifier)
        session = normalize_session(read_root_private_json(paths["session"], "P3.5 session state"), config)
        if session["session_id"] != session_id or session["status"] != "open":
            fail("P3.5 session has already been consumed")
        if int(time.time() * 1000) >= session["expires_at_ms"]:
            fail("P3.5 session has expired")
        P34.create_tracked_resource(
            created_resources,
            "claim",
            lambda on_created: create_submit_claim(paths, session_id, on_created),
        )
        session = normalize_session(read_root_private_json(paths["session"], "P3.5 session state"), config)
        if session["session_id"] != session_id or session["status"] != "open":
            fail("P3.5 session has already been consumed")
        now = int(time.time() * 1000)
        if now >= session["expires_at_ms"]:
            fail("P3.5 session has expired")
        if os.path.lexists(paths["binding"]):
            require_workspace_binding_layout(paths, verifier)
            workspace_ticket = normalize_workspace_ticket(
                read_root_verifier_json(
                    paths["workspace_ticket"], verifier, "P3.5c session workspace ticket"
                ),
                config,
                session_id=session_id,
                session_challenge_hash=session["session_challenge_hash"],
            )
            if now >= workspace_ticket["expires_at_ms"]:
                fail("P3.5c workspace descriptor ticket has expired")
            workspace_registry_request(
                install_root,
                validated,
                "assert_reserved",
                {
                    "registration_id": workspace_ticket["registration_id"],
                    "session_id": session_id,
                    "ticket_hash": workspace_ticket["ticket_hash"],
                },
            )
            workspace_reservation_active = True
            P34.create_directory(
                paths["witness"],
                shadow_witness["uid"],
                verifier["gid"],
                0o2710,
                "session shadow witness root",
            )
        session["status"] = "submitting"
        write_atomic_root_json(paths["session"], session_storage_value(session), replace=True)
        request = read_bounded_stdin(
            min(REQUEST_TIMEOUT_SECONDS, (session["expires_at_ms"] - now) / 1000)
        )
        if int(time.time() * 1000) >= session["expires_at_ms"]:
            fail("P3.5 session expired while reading the request")
        if session["intake_protocol_version"] == INTAKE_PROTOCOL_V2:
            preflight_v2_request_before_worker_handoff(request)
        release_token = secrets.token_urlsafe(24).rstrip("=")
        worker_command = [
            system_paths["python_path"],
            "-I",
            os.path.join(install_root, FILE_LAYOUT["worker"]),
            "--release-path", paths["release"],
            "--release-token", release_token,
            "--handoff-socket", paths["handoff_socket"],
            "--handoff-root", paths["worker"],
            "--expected-handoff-server-pid", str(os.getpid()),
            "--handoff-timeout-seconds", str(RELEASE_TIMEOUT_SECONDS),
            "--socket", paths["socket_path"],
            "--socket-root", paths["socket"],
            "--expected-worker-uid", str(worker["uid"]),
            "--expected-worker-gid", str(worker["gid"]),
            "--expected-server-uid", str(verifier["uid"]),
            "--expected-server-gid", str(verifier["gid"]),
            "--release-timeout-seconds", str(RELEASE_TIMEOUT_SECONDS),
            "--timeout-seconds", str(REQUEST_TIMEOUT_SECONDS),
        ]
        worker_started = True
        launch_unit(system_paths, worker_unit, worker["uid"], worker["gid"], SYSTEMD_PROPERTIES, worker_command, "worker")
        worker_pid = P34.wait_for_main_pid(
            system_paths["systemctl_path"], worker_unit, worker_cgroup, REQUEST_TIMEOUT_SECONDS
        )
        deliver_request_to_exact_worker(
            paths["handoff_socket"], worker, worker_pid, worker_cgroup, request
        )
        gateway_command = [
            system_paths["python_path"],
            "-I",
            os.path.join(install_root, FILE_LAYOUT["gateway"]),
            "serve",
            "--socket", paths["socket_path"],
            "--socket-root", paths["socket"],
            "--socket-gid", str(worker["gid"]),
            "--gateway-state-root", paths["gateway"],
            "--ready-path", paths["ready"],
            "--result-path", paths["result"],
            "--replay-lock-path", os.path.join(validated["state_root"], "replay.lock"),
            "--expected-worker-pid", str(worker_pid),
            "--expected-worker-uid", str(worker["uid"]),
            "--expected-worker-gid", str(worker["gid"]),
            "--expected-cgroup-path", worker_cgroup,
            "--verifier-uid", str(verifier["uid"]),
            "--verifier-gid", str(verifier["gid"]),
            "--node-path", system_paths["node_path"],
            "--verifier-path", os.path.join(install_root, FILE_LAYOUT["verifier"]),
            "--config", os.path.join(install_root, CONFIG_RELATIVE_PATH),
            "--session-id", session_id,
            "--session-challenge-hash", session["session_challenge_hash"],
            "--session-expires-at-ms", str(session["expires_at_ms"]),
            "--install-binding-hash", config["binding_hash"],
            "--intake-protocol-version", str(session["intake_protocol_version"]),
            "--timeout-seconds", str(REQUEST_TIMEOUT_SECONDS),
        ]
        if workspace_ticket is not None:
            gateway_command.extend(
                [
                    "--workspace-ticket", paths["workspace_ticket"],
                    "--shadow-witness-binding", paths["witness_binding"],
                    "--shadow-witness-socket", paths["witness_socket_path"],
                    "--shadow-witness-socket-root", paths["witness"],
                    "--shadow-witness-client", os.path.join(install_root, FILE_LAYOUT["shadow_witness_client"]),
                ]
            )
        gateway_properties = list(GATEWAY_SYSTEMD_PROPERTIES) + [
            "ReadWritePaths="
            + " ".join(
                [validated["state_root"], paths["socket"], paths["gateway"]]
                + ([paths["binding"], paths["witness"]] if workspace_ticket is not None else [])
            ),
        ]
        verifier_started = True
        launch_unit(system_paths, verifier_unit, verifier["uid"], verifier["gid"], gateway_properties, gateway_command, "verifier")
        verifier_pid = P34.wait_for_main_pid(
            system_paths["systemctl_path"], verifier_unit, verifier_cgroup, REQUEST_TIMEOUT_SECONDS
        )
        if workspace_ticket is not None:
            witness_command = [
                system_paths["python_path"],
                "-I",
                os.path.join(install_root, FILE_LAYOUT["shadow_witness"]),
                "serve",
                "--socket-root", paths["witness"],
                "--socket", paths["witness_socket_path"],
                "--ready-path", paths["witness_ready"],
                "--state-root", validated["witness_state_root"],
                "--ticket-hash", workspace_ticket["ticket_hash"],
                "--expected-verifier-pid", str(verifier_pid),
                "--expected-verifier-uid", str(verifier["uid"]),
                "--expected-verifier-gid", str(verifier["gid"]),
                "--expected-verifier-cgroup", verifier_cgroup,
                "--expected-root-pid", str(os.getpid()),
                "--witness-uid", str(shadow_witness["uid"]),
                "--witness-gid", str(shadow_witness["gid"]),
                "--socket-gid", str(verifier["gid"]),
            ]
            witness_properties = list(WITNESS_SYSTEMD_PROPERTIES) + [
                "ReadWritePaths=" + " ".join([validated["witness_state_root"], paths["witness"]]),
            ]
            witness_started = True
            launch_unit(
                system_paths,
                witness_unit,
                shadow_witness["uid"],
                shadow_witness["gid"],
                witness_properties,
                witness_command,
                "shadow witness",
            )
            witness_pid = P34.wait_for_main_pid(
                system_paths["systemctl_path"], witness_unit, witness_cgroup, REQUEST_TIMEOUT_SECONDS
            )
            witness_ready = wait_for_private_json(
                paths["witness_ready"],
                shadow_witness["uid"],
                shadow_witness["gid"],
                REQUEST_TIMEOUT_SECONDS,
                "shadow witness readiness",
            )
            validate_shadow_witness_ready(witness_ready, witness_pid, shadow_witness, verifier)
            seal_shadow_witness_socket(
                paths["witness"], paths["witness_socket_path"], shadow_witness, verifier
            )
            shadow_witness_binding = write_shadow_witness_binding(
                paths["witness_binding"],
                session_id,
                workspace_ticket,
                witness_ready,
                shadow_witness,
                verifier,
            )
        ready = wait_for_private_json(
            paths["ready"], verifier["uid"], verifier["gid"], REQUEST_TIMEOUT_SECONDS, "gateway readiness"
        )
        validate_gateway_ready(ready, verifier_pid, verifier, worker)
        seal_gateway_socket_for_worker(paths["socket"], paths["socket_path"], worker, verifier)
        create_release(paths["release"], release_token, verifier_pid, verifier, worker)
        result = wait_for_private_json(
            paths["result"], verifier["uid"], verifier["gid"], REQUEST_TIMEOUT_SECONDS * 2, "gateway result"
        )
        checked = validate_gateway_result(
            result,
            {"pid": worker_pid, "uid": worker["uid"], "gid": worker["gid"]},
            ticket=workspace_ticket,
            intake_protocol_version=session["intake_protocol_version"],
        )
        if workspace_ticket is not None:
            if shadow_witness_binding is None:
                fail("shadow witness binding is absent for the bound workspace session")
            verify_shadow_witness_root_readback(
                install_root,
                paths,
                shadow_witness_binding,
                workspace_ticket,
                checked["output"]["shadow_witness"],
            )
            completed = workspace_registry_request(
                install_root,
                validated,
                "complete",
                {
                    "registration_id": workspace_ticket["registration_id"],
                    "session_id": session_id,
                    "ticket_hash": workspace_ticket["ticket_hash"],
                },
            )
            completed = require_exact_keys(
                completed,
                {"schema_version", "status", "registration_id", "session_id", "ticket_hash"},
                "workspace registry completion response",
            )
            if (
                completed["schema_version"] != SCHEMA_VERSION
                or completed["status"] != "completed"
                or completed["registration_id"] != workspace_ticket["registration_id"]
                or completed["session_id"] != session_id
                or completed["ticket_hash"] != workspace_ticket["ticket_hash"]
            ):
                fail("workspace registry did not close the descriptor reservation")
            workspace_reservation_active = False
        P34.wait_for_load_state(system_paths["systemctl_path"], verifier_unit, "not-found", REQUEST_TIMEOUT_SECONDS)
        P34.wait_for_load_state(system_paths["systemctl_path"], worker_unit, "not-found", REQUEST_TIMEOUT_SECONDS)
        output = {
            "status": "p35_shadow_intake_complete",
            "schema_version": SCHEMA_VERSION,
            "session_id": session_id,
            "peer": checked["peer"],
            "receipt_hash": checked["receipt_hash"],
            "plan_hash": checked["output"]["receipt"].get("plan_hash"),
            "binding_hash": checked["output"]["receipt"].get("binding_hash"),
            "install_binding_hash": config["binding_hash"],
            "shadow": checked["output"]["shadow"],
            "owner_kernel_authority": "none",
            "acceptance": "not_available",
        }
        if workspace_ticket is not None:
            output["workspace_binding"] = {
                "registration_id": workspace_ticket["registration_id"],
                "descriptor_binding_hash": workspace_ticket["descriptor_binding_hash"],
                "ticket_hash": workspace_ticket["ticket_hash"],
                "assurance": (
                    "root_held_descriptor_matches_signed_v2_ticket_and_base"
                    if session["intake_protocol_version"] == INTAKE_PROTOCOL_V2
                    else "root_held_descriptor_matches_signed_v1_path_and_base_only"
                ),
                "content_immutability": "not_available",
            }
            if session["intake_protocol_version"] == INTAKE_PROTOCOL_V2:
                output["workspace_binding"]["workspace_root_hash"] = workspace_ticket["workspace_root_hash"]
                output["workspace_binding"]["immutable_base"] = workspace_ticket["immutable_base"]
            output["shadow_witness"] = checked["output"]["shadow_witness"]
        if session["intake_protocol_version"] == INTAKE_PROTOCOL_V2:
            output["intake_protocol_version"] = INTAKE_PROTOCOL_V2
            output["effect_authority"] = "none"
        return output
    finally:
        if witness_started:
            try:
                P34.stop_and_collect_unit(system_paths["systemctl_path"], witness_unit)
            except (P34.LauncherError, OSError) as error:
                cleanup_errors.append("shadow witness unit: " + str(error))
        if verifier_started:
            try:
                P34.stop_and_collect_unit(system_paths["systemctl_path"], verifier_unit)
            except (P34.LauncherError, OSError) as error:
                cleanup_errors.append("verifier unit: " + str(error))
        if worker_started:
            try:
                P34.stop_and_collect_unit(system_paths["systemctl_path"], worker_unit)
            except (P34.LauncherError, OSError) as error:
                cleanup_errors.append("worker unit: " + str(error))
        if workspace_ticket is not None and workspace_reservation_active:
            try:
                release_workspace_ticket(install_root, validated, workspace_ticket)
            except HostError as error:
                cleanup_errors.append("workspace descriptor release: " + str(error))
        if created_resources["claim"]:
            cleanup_errors.extend(
                cleanup_session_paths(
                    paths,
                    remove_session=True,
                    legacy_request_gid=worker["gid"],
                    worker=worker,
                    verifier=verifier,
                )
            )
        try:
            release_root_lease(global_submit_lease)
        except OSError as error:
            cleanup_errors.append("global submit lease: " + str(error))
        for signal_number, previous in previous_handlers.items():
            signal.signal(signal_number, previous)
        if cleanup_errors:
            fail("P3.5 submit cleanup failed: " + "; ".join(cleanup_errors))


def cleanup_legacy_request(path, gid):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return None
    except OSError as error:
        return path + ": " + str(error)
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != gid
        or (info.st_mode & 0o777) != 0o440
    ):
        return path + ": legacy request has an unexpected identity, mode, or type"
    try:
        P34.cleanup_path(path, "file")
    except (OSError, P34.LauncherError) as error:
        return path + ": " + str(error)
    return None


def cleanup_session_paths(paths, remove_session, legacy_request_gid=None, worker=None, verifier=None):
    errors = cleanup_pending_state_files(paths)
    if worker is not None:
        errors.extend(cleanup_worker_pending_artifacts(paths, worker))
    if verifier is not None:
        errors.extend(cleanup_gateway_pending_artifacts(paths, verifier))
    for candidate, kind in (
        (paths.get("socket_path"), "socket"),
        (paths.get("witness_socket_path"), "socket"),
        (paths.get("release"), "file"),
        (paths.get("handoff_socket"), "socket"),
        (paths.get("ready"), "file"),
        (paths.get("result"), "file"),
        (paths.get("workspace_ticket"), "file"),
        (paths.get("witness_binding"), "file"),
        (paths.get("witness_ready"), "file"),
        (paths.get("claim"), "file"),
        (paths.get("session"), "file"),
    ):
        if candidate:
            try:
                P34.cleanup_path(candidate, kind)
            except (OSError, P34.LauncherError) as error:
                errors.append(candidate + ": " + str(error))
    if legacy_request_gid is not None:
        legacy_request_error = cleanup_legacy_request(paths["legacy_request"], legacy_request_gid)
        if legacy_request_error is not None:
            errors.append(legacy_request_error)
    if remove_session:
        for candidate in (
            paths.get("witness"),
            paths.get("binding"),
            paths.get("gateway"),
            paths.get("socket"),
            paths.get("worker"),
            paths.get("root_state"),
            paths.get("root"),
        ):
            if candidate:
                try:
                    P34.cleanup_path(candidate, "dir")
                except (OSError, P34.LauncherError) as error:
                    errors.append(candidate + ": " + str(error))
    return errors


def begin(args):
    P34.require_root()
    install_root = installed_root_from_self()
    config = load_installed_config(install_root)
    validated = validate_installed_config(install_root, config)
    lease = acquire_runtime_parent_lease()
    try:
        registration_id = (
            require_token(args.workspace_registration_id, "workspace registration id")
            if args.workspace_registration_id is not None
            else None
        )
        intake_protocol_version = require_nonnegative_int(
            args.intake_protocol_version,
            "intake protocol version",
            INTAKE_PROTOCOL_V1,
        )
        if intake_protocol_version not in {INTAKE_PROTOCOL_V1, INTAKE_PROTOCOL_V2}:
            fail("intake protocol version is unsupported")
        if intake_protocol_version == INTAKE_PROTOCOL_V2 and registration_id is None:
            fail("P3.5d v2 begin requires a workspace registration id")
        return create_session(
            config,
            validated,
            install_root,
            registration_id,
            intake_protocol_version,
        )
    finally:
        release_root_lease(lease)


def serve_workspace_registry(_args):
    P34.require_root()
    install_root = installed_root_from_self()
    config = load_installed_config(install_root)
    validated = validate_installed_config(install_root, config)
    registry_module = load_workspace_registry(install_root)
    server = registry_module.WorkspaceRegistryServer(
        validated["workspace_registry"]["root"],
        validated["workspace_registry"]["socket"],
        config["binding_hash"],
    )
    previous_handlers = {}

    def stop_registry(_signum, _frame):
        # Defer descriptor and socket teardown to the normal finally path.
        # Calling close operations from a signal handler would make the
        # registry's lifecycle depend on an arbitrary instruction boundary.
        server.stopping = True

    try:
        for signal_number in (signal.SIGINT, signal.SIGTERM):
            previous_handlers[signal_number] = signal.signal(signal_number, stop_registry)
        server.start()
        return_value = {
            "schema_version": SCHEMA_VERSION,
            "status": "workspace_registry_ready",
            "registry_instance_id": server.registry.instance_id,
            "owner_kernel_authority": "none",
            "acceptance": "not_available",
        }
        emit(return_value)
        server.serve_forever()
        return None
    finally:
        try:
            server.stop()
        finally:
            for signal_number, previous in previous_handlers.items():
                signal.signal(signal_number, previous)


def register_workspace(args):
    P34.require_root()
    install_root = installed_root_from_self()
    config = load_installed_config(install_root)
    validated = validate_installed_config(install_root, config)
    registry_module = load_workspace_registry(install_root)
    try:
        response = registry_module.register_workspace(
            validated["workspace_registry"]["socket"],
            require_token(args.registration_id, "workspace registration id"),
            require_git_sha(args.immutable_base, "workspace immutable base"),
            require_absolute_path(args.workspace_root, "workspace registration path"),
            require_nonnegative_int(
                args.ttl_milliseconds,
                "workspace registration TTL",
                registry_module.MIN_REGISTRATION_TTL_MILLISECONDS,
            ),
        )
    except registry_module.WorkspaceRegistryError as error:
        fail("P3.5c workspace registration failed: " + str(error))
    response = require_exact_keys(
        response,
        {
            "schema_version",
            "status",
            "registry_instance_id",
            "registration_id",
            "workspace_root_hash",
            "immutable_base",
            "descriptor_binding_hash",
            "expires_at_ms",
        },
        "workspace registration response",
    )
    if response["schema_version"] != SCHEMA_VERSION or response["status"] != "registered":
        fail("workspace registry did not retain the root-held descriptor")
    require_token(response["registry_instance_id"], "workspace registry instance")
    if response["registration_id"] != args.registration_id:
        fail("workspace registry registration id does not match")
    require_sha256(response["workspace_root_hash"], "workspace registry workspace hash")
    if response["immutable_base"] != args.immutable_base:
        fail("workspace registry immutable base does not match")
    require_sha256(response["descriptor_binding_hash"], "workspace descriptor binding")
    require_nonnegative_int(response["expires_at_ms"], "workspace registration expiry", 1)
    return {
        "schema_version": SCHEMA_VERSION,
        "status": "workspace_registered",
        "registry_instance_id": response["registry_instance_id"],
        "registration_id": response["registration_id"],
        "workspace_root_hash": response["workspace_root_hash"],
        "immutable_base": response["immutable_base"],
        "descriptor_binding_hash": response["descriptor_binding_hash"],
        "expires_at_ms": response["expires_at_ms"],
        "content_immutability": "not_available",
        "owner_kernel_authority": "none",
        "acceptance": "not_available",
    }


def parser():
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    install_parser = commands.add_parser("install")
    install_parser.add_argument("--install-root", required=True)
    install_parser.add_argument("--state-root", required=True)
    install_parser.add_argument("--workspace-registry-root", required=True)
    install_parser.add_argument("--witness-state-root", required=True)
    install_parser.add_argument("--keyring", required=True)
    install_parser.add_argument("--node-path", required=True)
    install_parser.add_argument("--create-worker", action="store_true")
    install_parser.add_argument("--create-verifier", action="store_true")
    install_parser.add_argument("--create-shadow-witness", action="store_true")
    install_parser.set_defaults(handler=install)
    begin_parser = commands.add_parser("begin")
    begin_parser.add_argument("--workspace-registration-id")
    begin_parser.add_argument(
        "--intake-protocol-version", type=int, default=INTAKE_PROTOCOL_V1
    )
    begin_parser.set_defaults(handler=begin)
    submit_parser = commands.add_parser("submit")
    submit_parser.add_argument("--session-id", required=True)
    submit_parser.set_defaults(handler=lambda args: submit_session(require_token(args.session_id, "session_id")))
    registry_serve_parser = commands.add_parser("workspace-registry-serve")
    registry_serve_parser.set_defaults(handler=serve_workspace_registry)
    workspace_register_parser = commands.add_parser("workspace-register")
    workspace_register_parser.add_argument("--registration-id", required=True)
    workspace_register_parser.add_argument("--workspace-root", required=True)
    workspace_register_parser.add_argument("--immutable-base", required=True)
    workspace_register_parser.add_argument("--ttl-milliseconds", type=int, default=10 * 60 * 1000)
    workspace_register_parser.set_defaults(handler=register_workspace)
    return root


def main():
    global P34
    try:
        P34 = load_p34_support()
        args = parser().parse_args()
        result = args.handler(args)
        if result is not None:
            emit(result)
        return 0
    except HostError as error:
        sys.stderr.write("supervised-intake-host: " + str(error) + "\n")
        return 2
    except Exception as error:
        if P34 is not None and isinstance(error, P34.LauncherError):
            sys.stderr.write("supervised-intake-host: " + str(error) + "\n")
            return 2
        raise


if __name__ == "__main__":
    raise SystemExit(main())
