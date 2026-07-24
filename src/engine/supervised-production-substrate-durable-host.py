#!/usr/bin/env python3
"""Root-installed P3.6 durable cohort host.

The old P2b host remains an independent 8 KiB peer credential probe.  This
host creates a fresh durable generation, provisions two role-private state
leaves, seals a new five-route 512 KiB socket topology, and consumes exactly
one root-only P3.5d v2 handoff.  It deliberately has no Engine/effect or
acceptance invocation path.
"""

import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import pwd
import grp
import secrets
import signal
import stat
import subprocess
import sys
import time


SCHEMA_VERSION = 1
RUNTIME_PARENT = "/run/autopilot-production-durable"
CONFIG_RELATIVE_PATH = "etc/supervised-production-substrate-durable.json"
SERVICE_ROLES = ("worker", "broker", "receipt_verifier", "witness", "coordinator")
SERVICE_IDENTITIES = {
    "worker": "autopilot-p36d-worker",
    "broker": "autopilot-p36d-broker",
    "receipt_verifier": "autopilot-p36d-receipt-verifier",
    "witness": "autopilot-p36d-witness",
    "coordinator": "autopilot-p36d-coordinator",
}
FILE_LAYOUT = {
    "host": "sbin/supervised-production-substrate-durable-host.py",
    "service": "lib/supervised-production-substrate-durable-service.py",
    "transport": "lib/supervised_production_substrate_durable_transport.py",
    "durable_core": "lib/supervised_production_substrate_durable.py",
    "handoff": "lib/supervised_p35_durable_handoff.py",
    "contract": "lib/supervised-production-substrate-durable-contract.js",
    "canonical": "lib/owner-kernel/canonical.js",
    "errors": "lib/owner-kernel/errors.js",
}
SNAPSHOT_SOURCE_LAYOUT = {
    "host": "supervised-production-substrate-durable-host.py",
    "service": "supervised-production-substrate-durable-service.py",
    "transport": "supervised_production_substrate_durable_transport.py",
    "durable_core": "supervised_production_substrate_durable.py",
    "handoff": "supervised_p35_durable_handoff.py",
    "contract": "supervised-production-substrate-durable-contract.js",
    "canonical": "owner-kernel/canonical.js",
    "errors": "owner-kernel/errors.js",
}
FILE_MODES = {
    "host": 0o755,
    "service": 0o755,
    "transport": 0o644,
    "durable_core": 0o644,
    "handoff": 0o644,
    "contract": 0o644,
    "canonical": 0o644,
    "errors": 0o644,
}
SYSTEM_PATHS = {
    "python_path": "/usr/bin/python3",
    "node_path": "/usr/bin/node",
    "systemd_run_path": "/usr/bin/systemd-run",
    "systemctl_path": "/usr/bin/systemctl",
    "useradd_path": "/usr/sbin/useradd",
}
ROLE_RUNTIME_MAX_SECONDS = 300
SYSTEMD_PROPERTIES = (
    "NoNewPrivileges=yes",
    "PrivateNetwork=yes",
    "PrivateTmp=yes",
    "ProtectSystem=strict",
    "ProtectHome=tmpfs",
    "RestrictNamespaces=yes",
    "RestrictSUIDSGID=yes",
    "CapabilityBoundingSet=",
    "CollectMode=inactive-or-failed",
    "RuntimeMaxSec=" + str(ROLE_RUNTIME_MAX_SECONDS) + "s",
    "TimeoutStopSec=5s",
)
ROLE_START_TIMEOUT_SECONDS = 8
# Successful setup includes bounded unit launch/PID, listener-ready, socket,
# and post-seal identity checks before the first release.
ROLE_RELEASE_TIMEOUT_SECONDS = 210
ROLE_ACK_TIMEOUT_SECONDS = 30
ROLE_HOLD_SECONDS = 35
SYSTEMD_COMMAND_TIMEOUT_SECONDS = 10
ROLE_RELEASE_SAFETY_MARGIN_SECONDS = 10
ROLE_ACK_SAFETY_MARGIN_SECONDS = 3
TERMINATION_SIGNALS = (signal.SIGINT, signal.SIGTERM)
DURABLE_STATE_ROOT_MODE = 0o711
MAX_DURABLE_COHORTS = 64
MAX_DURABLE_ATTEMPTS = 128
MAX_DURABLE_STATE_BYTES = 64 * 1024 * 1024
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
SHA256_CHARS = frozenset("0123456789abcdef")


class DurableHostError(Exception):
    pass


def fail(message):
    raise DurableHostError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def sha256_value(value):
    if not isinstance(value, str):
        value = canonical(value)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _reject_json_constant(value):
    raise ValueError("non-finite JSON constant: " + value)


def _contains_lone_surrogate(value):
    if isinstance(value, str):
        return any(0xD800 <= ord(character) <= 0xDFFF for character in value)
    if isinstance(value, list):
        return any(_contains_lone_surrogate(item) for item in value)
    if isinstance(value, dict):
        return any(
            _contains_lone_surrogate(key) or _contains_lone_surrogate(item)
            for key, item in value.items()
        )
    return False


def decode_root_canonical_json(raw, label, maximum):
    """Decode root/service evidence with the same fail-closed JSON rules as IPC."""

    if not isinstance(raw, bytes) or len(raw) < 2 or len(raw) > maximum or not raw.endswith(b"\n"):
        fail(label + " is not bounded newline-terminated canonical JSON")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text[:-1], parse_constant=_reject_json_constant)
        if _contains_lone_surrogate(value):
            raise ValueError("lone Unicode surrogate")
        if canonical(value) + "\n" != text:
            fail(label + " is not canonical")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, RecursionError, MemoryError) as error:
        raise DurableHostError(label + " is not bounded canonical JSON") from error
    return value


def emit(value):
    sys.stdout.write(canonical(value) + "\n")
    sys.stdout.flush()


def require_root():
    if os.geteuid() != 0 or os.getegid() != 0:
        fail("P3.6 durable host requires effective UID/GID 0")


def require_supported_host():
    if sys.platform != "linux" or not hasattr(signal, "pthread_sigmask"):
        fail("P3.6 durable host requires Linux signal masking")
    try:
        with open("/sys/fs/cgroup/cgroup.controllers", "rb") as source:
            source.read(1)
        with open("/proc/self/cgroup", "r", encoding="utf-8") as source:
            values = source.read(8192).splitlines()
    except OSError as error:
        raise DurableHostError("P3.6 durable host requires readable cgroup-v2 state") from error
    if not any(value.startswith("0::") for value in values):
        fail("P3.6 durable host requires unified cgroup-v2 state")


def require_lifecycle_timing_budget():
    """Keep the first service's pre-release lease above serial setup work."""

    setup_bound = (
        len(SERVICE_ROLES) * (SYSTEMD_COMMAND_TIMEOUT_SECONDS + ROLE_START_TIMEOUT_SECONDS)
        + len(SERVICE_ROLES) * (ROLE_START_TIMEOUT_SECONDS + min(ROLE_START_TIMEOUT_SECONDS, 2))
        + len(SERVICE_ROLES) * ROLE_START_TIMEOUT_SECONDS
        + len(SERVICE_ROLES) * min(ROLE_START_TIMEOUT_SECONDS, 2)
    )
    if ROLE_RELEASE_TIMEOUT_SECONDS <= setup_bound + ROLE_RELEASE_SAFETY_MARGIN_SECONDS:
        fail("durable release timeout cannot cover the worst-case pre-release setup")
    if ROLE_RELEASE_TIMEOUT_SECONDS + ROLE_HOLD_SECONDS > ROLE_RUNTIME_MAX_SECONDS:
        fail("durable service runtime cap cannot cover release and hold windows")
    if ROLE_ACK_TIMEOUT_SECONDS + ROLE_ACK_SAFETY_MARGIN_SECONDS > ROLE_HOLD_SECONDS:
        fail("durable acknowledgement deadline lacks a service hold safety margin")
    return setup_bound


def install_interrupt_handlers(handler):
    previous = {}
    try:
        for signal_number in TERMINATION_SIGNALS:
            previous[signal_number] = signal.signal(signal_number, handler)
    except (OSError, ValueError) as error:
        for signal_number, previous_handler in previous.items():
            signal.signal(signal_number, previous_handler)
        raise DurableHostError("cannot install P3.6 durable interruption handlers") from error
    return previous


def restore_interrupt_handlers(previous):
    for signal_number, previous_handler in previous.items():
        signal.signal(signal_number, previous_handler)


def with_termination_signals_blocked(callback, label):
    try:
        previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, set(TERMINATION_SIGNALS))
    except (AttributeError, OSError, ValueError) as error:
        raise DurableHostError("cannot safely " + label) from error
    try:
        return callback()
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)


def block_termination_signals(label):
    """Keep terminal cohort work non-interruptible until the outer restore."""

    try:
        signal.pthread_sigmask(signal.SIG_BLOCK, set(TERMINATION_SIGNALS))
    except (AttributeError, OSError, ValueError) as error:
        raise DurableHostError("cannot safely " + label) from error


def current_termination_signal_mask(label):
    try:
        return signal.pthread_sigmask(signal.SIG_BLOCK, set())
    except (AttributeError, OSError, ValueError) as error:
        raise DurableHostError("cannot inspect termination signal mask for " + label) from error


def restore_termination_signal_mask(previous_mask, label):
    try:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
    except (AttributeError, OSError, ValueError) as error:
        raise DurableHostError("cannot restore termination signal mask for " + label) from error


def raise_interruption(_signal_number, _frame):
    # A second termination signal must not interrupt root-private tombstone or
    # attempt-state persistence after the first one has entered this handler.
    signal.pthread_sigmask(signal.SIG_BLOCK, set(TERMINATION_SIGNALS))
    raise KeyboardInterrupt()


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


def require_exact_int(value, expected, label):
    if isinstance(value, bool) or not isinstance(value, int) or value != expected:
        fail(label + " must be the exact frozen integer")
    return value


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


def path_components(path):
    values = ["/"]
    current = ""
    for part in path.split("/"):
        if part:
            current += "/" + part
            values.append(current)
    return values


def require_root_owned_path(path, label, directory=False, executable=False):
    path = require_absolute_path(path, label)
    try:
        resolved = os.path.realpath(path)
    except OSError as error:
        raise DurableHostError(label + " cannot be resolved: " + str(error)) from error
    if resolved != path:
        fail(label + " must not resolve through a symlink")
    for component in path_components(path):
        try:
            info = os.lstat(component)
        except OSError as error:
            raise DurableHostError(label + " has an unreadable ancestor: " + str(error)) from error
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022) != 0:
            fail(label + " has an untrusted ancestor " + component)
    final = os.lstat(path)
    if directory and not stat.S_ISDIR(final.st_mode):
        fail(label + " must be a directory")
    if executable and (not stat.S_ISREG(final.st_mode) or (final.st_mode & 0o111) == 0):
        fail(label + " must be an executable regular file")
    return path


def require_service_traversable_path(path, label, executable=False):
    path = require_root_owned_path(path, label, executable=executable)
    for component in path_components(os.path.dirname(path)):
        if (os.lstat(component).st_mode & 0o001) == 0:
            fail(label + " is not traversable by a service at " + component)
    return path


def resolve_root_executable(path, label):
    path = require_absolute_path(path, label)
    resolved = os.path.realpath(path)
    if not os.path.isabs(resolved) or resolved == "/":
        fail(label + " cannot be resolved")
    return require_root_owned_path(resolved, label, executable=True)


def file_digest(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while True:
            block = source.read(65536)
            if not block:
                return digest.hexdigest()
            digest.update(block)


def write_all(descriptor, content):
    view = memoryview(content)
    while view:
        written = os.write(descriptor, view)
        if written <= 0:
            raise OSError("short write")
        view = view[written:]


def fsync_directory(path):
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        os.fsync(descriptor)
    except OSError as error:
        raise DurableHostError("directory cannot be synchronized: " + path + ": " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def create_directory(path, uid, gid, mode, label, on_created=None):
    try:
        os.mkdir(path, mode)
        if on_created is not None:
            on_created()
        os.chown(path, uid, gid)
        os.chmod(path, mode)
    except FileExistsError as error:
        raise DurableHostError(label + " already exists") from error
    except OSError as error:
        raise DurableHostError(label + " cannot be created: " + str(error)) from error


def ensure_directory(path, uid, gid, mode, label):
    """Create an exact root-owned directory or accept only its exact twin.

    Shared roots are a concurrent admission surface.  ``exists`` followed by
    ``mkdir`` is not an ownership check, so the only tolerated race is an
    already-present directory that passes the same invariant as a new one.
    """

    try:
        create_directory(path, uid, gid, mode, label)
        created = True
    except DurableHostError as error:
        if not os.path.lexists(path):
            raise error
        created = False
    require_exact_directory(path, uid, gid, mode, label)
    return created


def require_exact_directory(path, uid, gid, mode, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise DurableHostError(label + " cannot be inspected: " + str(error)) from error
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
        raise DurableHostError(label + " cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISSOCK(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o777) != mode
    ):
        fail(label + " does not have the expected ownership and mode")


def write_root_file(path, content, mode, gid=0, allow_existing=False):
    descriptor = None
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, gid)
        write_all(descriptor, content)
        os.fsync(descriptor)
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or info.st_gid != gid
            or (info.st_mode & 0o777) != mode
            or info.st_nlink != 1
        ):
            fail("root file did not retain expected ownership")
    except FileExistsError:
        if allow_existing:
            return False
        raise DurableHostError("root file already exists: " + path)
    except OSError as error:
        raise DurableHostError("root file cannot be written: " + path + ": " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
    return True


def write_root_group_json(path, value, gid, label):
    try:
        write_root_file(path, (canonical(value) + "\n").encode("utf-8"), 0o440, gid)
        fsync_directory(os.path.dirname(path))
    except DurableHostError as error:
        raise DurableHostError(label + ": " + str(error)) from error


def copy_root_snapshot_file(source, destination, mode):
    try:
        source_info = os.lstat(source)
    except OSError as error:
        raise DurableHostError("snapshot source cannot be inspected: " + str(error)) from error
    if stat.S_ISLNK(source_info.st_mode) or not stat.S_ISREG(source_info.st_mode):
        fail("snapshot source must be a regular non-symlink file")
    source_descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    destination_descriptor = None
    try:
        destination_descriptor = os.open(
            destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode
        )
        while True:
            block = os.read(source_descriptor, 65536)
            if not block:
                break
            write_all(destination_descriptor, block)
        os.fsync(destination_descriptor)
        os.fchown(destination_descriptor, 0, 0)
        os.fchmod(destination_descriptor, mode)
    finally:
        os.close(source_descriptor)
        if destination_descriptor is not None:
            os.close(destination_descriptor)


def run_command(command, timeout_seconds=SYSTEMD_COMMAND_TIMEOUT_SECONDS):
    try:
        return subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={"LANG": "C", "LC_ALL": "C", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise DurableHostError("bounded child command timed out") from error
    except OSError as error:
        raise DurableHostError("bounded child command cannot be started: " + str(error)) from error


def identity_attestation(role, identity, uid, gid):
    return sha256_value(
        {
            "schema_version": SCHEMA_VERSION,
            "kind": "p36_durable_root_pinned_identity",
            "role": role,
            "identity": identity,
            "uid": uid,
            "gid": gid,
        }
    )


def require_private_service_account(role, create):
    identity = SERVICE_IDENTITIES[role]
    try:
        account = pwd.getpwnam(identity)
    except KeyError:
        if not create:
            fail("dedicated " + identity + " account is absent; run install with --create-identities")
        useradd = resolve_root_executable(SYSTEM_PATHS["useradd_path"], "useradd_path")
        result = run_command(
            [
                useradd,
                "--system",
                "--user-group",
                "--home-dir",
                "/nonexistent",
                "--shell",
                "/usr/sbin/nologin",
                identity,
            ]
        )
        if result.returncode != 0:
            fail("cannot create dedicated " + identity + " account: " + result.stderr.strip())
        account = pwd.getpwnam(identity)
    if account.pw_uid <= 0 or account.pw_gid <= 0:
        fail("dedicated " + identity + " identity must be non-root")
    if account.pw_shell != "/usr/sbin/nologin" or account.pw_dir != "/nonexistent":
        fail("dedicated " + identity + " identity must be non-login")
    group = grp.getgrgid(account.pw_gid)
    if group.gr_name != identity or group.gr_mem:
        fail("dedicated " + identity + " primary group is not private")
    try:
        memberships = os.getgrouplist(identity, account.pw_gid)
    except OSError as error:
        raise DurableHostError("service group membership cannot be resolved") from error
    if set(memberships) != {account.pw_gid}:
        fail("dedicated " + identity + " must not have supplementary groups")
    return {
        "role": role,
        "identity": identity,
        "uid": account.pw_uid,
        "gid": account.pw_gid,
        "attestation_hash": identity_attestation(role, identity, account.pw_uid, account.pw_gid),
    }


def resolve_services(create):
    services = {role: require_private_service_account(role, create) for role in SERVICE_ROLES}
    for field in ("identity", "uid", "gid", "attestation_hash"):
        values = [services[role][field] for role in SERVICE_ROLES]
        if len(values) != len(set(values)):
            fail("durable service " + field + " values must remain independent")
    return services


def snapshot_sources(source_root):
    return {
        name: os.path.join(source_root, relative)
        for name, relative in SNAPSHOT_SOURCE_LAYOUT.items()
    }


def installed_durable_abi(node_path, contract_path):
    script = (
        "const contract=require(process.argv[1]);"
        "process.stdout.write(contract.getSupervisedProductionDurableAbiHash());"
    )
    result = run_command([node_path, "-e", script, contract_path], timeout_seconds=5)
    if result.returncode != 0:
        fail("installed durable ABI cannot be loaded: " + result.stderr.strip())
    return require_sha256(result.stdout.strip(), "installed durable ABI hash")


def load_snapshot_module(install_root, file_key, module_name):
    path = os.path.join(install_root, FILE_LAYOUT[file_key])
    require_root_owned_path(path, "installed " + file_key + " snapshot")
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise ImportError("cannot create a module loader")
        module = importlib.util.module_from_spec(spec)
        # The snapshot can import its siblings by normal module name.
        directory = os.path.dirname(path)
        if directory not in sys.path:
            sys.path.insert(0, directory)
        spec.loader.exec_module(module)
        return module
    except (ImportError, OSError, ValueError) as error:
        raise DurableHostError("installed " + file_key + " snapshot cannot be loaded") from error
    finally:
        sys.dont_write_bytecode = previous


def ensure_root_state_root(path, create=False):
    path = require_absolute_path(path, "durable state root")
    parent = os.path.dirname(path)
    require_root_owned_path(parent, "durable state parent", directory=True)
    if not os.path.lexists(path):
        if not create:
            fail("durable state root is absent")
        # Services need execute-only traversal to their individually protected
        # leaves.  The root itself stays unreadable/unwritable; ledgers and
        # tombstones beneath it remain root-private files/directories.
        if ensure_directory(path, 0, 0, DURABLE_STATE_ROOT_MODE, "durable state root"):
            fsync_directory(parent)
    require_exact_directory(path, 0, 0, DURABLE_STATE_ROOT_MODE, "durable state root")
    return path


def installation_material(install_root, state_root, handoff_root, services, paths, files, durable_abi_hash):
    return {
        "schema_version": SCHEMA_VERSION,
        "install_root": install_root,
        "runtime_parent": RUNTIME_PARENT,
        "state_root": state_root,
        "p35_handoff_root": handoff_root,
        "services": services,
        "paths": paths,
        "files": files,
        "durable_abi_hash": durable_abi_hash,
        "systemd_properties": list(SYSTEMD_PROPERTIES),
        "owner_kernel_authority": "none",
        "effect_authority": "none",
        "broker_authority": "disabled",
        "acceptance": "not_available",
    }


def cleanup_partial_install(install_root):
    errors = []
    for relative in [CONFIG_RELATIVE_PATH] + list(FILE_LAYOUT.values()):
        path = os.path.join(install_root, relative)
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            continue
        except OSError as error:
            errors.append(relative + ": " + str(error))
            continue
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != 0:
            errors.append(relative + ": unexpected entry")
            continue
        try:
            os.unlink(path)
        except OSError as error:
            errors.append(relative + ": " + str(error))
    for relative in ("lib/owner-kernel", "etc", "sbin", "lib", ""):
        path = os.path.join(install_root, relative)
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            continue
        except OSError as error:
            errors.append((relative or "install root") + ": " + str(error))
            continue
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode) or info.st_uid != 0:
            errors.append((relative or "install root") + ": unexpected entry")
            continue
        try:
            os.rmdir(path)
        except OSError as error:
            errors.append((relative or "install root") + ": " + str(error))
    return errors


def install(args):
    require_root()
    require_supported_host()
    install_root = require_absolute_path(args.install_root, "install_root")
    state_root = ensure_root_state_root(args.state_root, create=True)
    handoff_root = require_absolute_path(args.p35_handoff_root, "p35_handoff_root")
    if os.path.lexists(install_root):
        fail("install_root already exists")
    # The P3.5 root host owns this mailbox; this host only consumes records.
    require_root_owned_path(handoff_root, "P3.5 durable handoff root", directory=True)
    install_root_created = False
    previous_signal_mask = current_termination_signal_mask("durable install")
    previous_handlers = install_interrupt_handlers(raise_interruption)
    try:
        services = resolve_services(args.create_identities)
        parent = os.path.dirname(install_root)
        require_root_owned_path(parent, "install parent", directory=True)

        def _mark_install_root_created():
            nonlocal install_root_created
            install_root_created = True

        def create_owned_install_root():
            create_directory(
                install_root,
                0,
                0,
                0o755,
                "durable install root",
                on_created=lambda: _mark_install_root_created(),
            )

        # Mask the mkdir-to-ownership-marker window.  A concurrent installer
        # that wins the O_EXCL-style mkdir race remains someone else's tree.
        with_termination_signals_blocked(create_owned_install_root, "create a durable install root")
        for relative in ("sbin", "lib", "etc", "lib/owner-kernel"):
            create_directory(os.path.join(install_root, relative), 0, 0, 0o755, "durable install directory")
        sources = snapshot_sources(os.path.dirname(os.path.realpath(__file__)))
        files = {}
        for name, relative in FILE_LAYOUT.items():
            destination = os.path.join(install_root, relative)
            copy_root_snapshot_file(sources[name], destination, FILE_MODES[name])
            require_root_owned_path(destination, name + " snapshot", executable=bool(FILE_MODES[name] & 0o111))
            files[name] = {"relative_path": relative, "sha256": file_digest(destination)}
        paths = {
            key: resolve_root_executable(value, key)
            for key, value in SYSTEM_PATHS.items()
            if key not in {"useradd_path", "node_path"}
        }
        paths["node_path"] = resolve_root_executable(args.node_path or SYSTEM_PATHS["node_path"], "node_path")
        durable_abi_hash = installed_durable_abi(paths["node_path"], os.path.join(install_root, FILE_LAYOUT["contract"]))
        core = load_snapshot_module(install_root, "durable_core", "p36d_install_core")
        if getattr(core, "DURABLE_ABI_HASH", None) != durable_abi_hash:
            fail("installed Python durable core does not match the copied durable ABI")
        material = installation_material(
            install_root, state_root, handoff_root, services, paths, files, durable_abi_hash
        )
        config = dict(material, binding_hash=sha256_value(material))
        write_root_file(
            os.path.join(install_root, CONFIG_RELATIVE_PATH),
            (canonical(config) + "\n").encode("utf-8"),
            0o600,
        )
        fsync_directory(os.path.join(install_root, "etc"))
        fsync_directory(install_root)
        emit(
            {
                "status": "installed",
                "install_binding_hash": config["binding_hash"],
                "durable_abi_hash": durable_abi_hash,
                "service_roles": [services[role] for role in SERVICE_ROLES],
                "owner_kernel_authority": "none",
                "effect_authority": "none",
                "broker_authority": "disabled",
                "acceptance": "not_available",
            }
        )
    except BaseException as error:
        if install_root_created:
            cleanup_errors = with_termination_signals_blocked(
                lambda: cleanup_partial_install(install_root), "clean up a partial durable install"
            )
            if cleanup_errors:
                raise DurableHostError("durable install cleanup failed: " + "; ".join(cleanup_errors)) from error
        if isinstance(error, KeyboardInterrupt):
            raise DurableHostError("durable install interrupted before completion") from error
        raise
    finally:
        restore_interrupt_handlers(previous_handlers)
        restore_termination_signal_mask(previous_signal_mask, "durable install")


def installed_root_from_self():
    host_path = os.path.realpath(__file__)
    install_root = os.path.dirname(os.path.dirname(host_path))
    if host_path != os.path.join(install_root, FILE_LAYOUT["host"]):
        fail("installed durable host must run from its fixed snapshot path")
    require_root_owned_path(install_root, "durable install root", directory=True)
    require_root_owned_path(host_path, "installed durable host", executable=True)
    return install_root


def read_canonical_config(path):
    try:
        with open(path, "rb") as source:
            raw = source.read(131073)
    except OSError as error:
        raise DurableHostError("installed durable config cannot be read: " + str(error)) from error
    if not raw or len(raw) > 131072:
        fail("installed durable config has an invalid size")
    return decode_root_canonical_json(raw, "installed durable config", 131072)


def load_installed_config(install_root):
    path = os.path.join(install_root, CONFIG_RELATIVE_PATH)
    _require_root_private_regular_file(path, "installed durable config", maximum=131072)
    config = read_canonical_config(path)
    require_exact_keys(
        config,
        {
            "schema_version", "install_root", "runtime_parent", "state_root", "p35_handoff_root",
            "services", "paths", "files", "durable_abi_hash", "systemd_properties",
            "owner_kernel_authority", "effect_authority", "broker_authority", "acceptance", "binding_hash",
        },
        "installed durable config",
    )
    if (
        require_exact_int(config["schema_version"], SCHEMA_VERSION, "installed durable config schema")
        != SCHEMA_VERSION
        or config["install_root"] != install_root
        or config["runtime_parent"] != RUNTIME_PARENT
    ):
        fail("installed durable config has an unsupported identity")
    material = dict(config)
    binding_hash = material.pop("binding_hash")
    if require_sha256(binding_hash, "installed durable config binding") != sha256_value(material):
        fail("installed durable config binding hash does not match content")
    return config


def validate_installed_config(install_root, config):
    services_raw = require_exact_keys(config["services"], SERVICE_ROLES, "installed durable services")
    services = {}
    for role in SERVICE_ROLES:
        expected = require_private_service_account(role, False)
        service = require_exact_keys(
            services_raw[role], {"role", "identity", "uid", "gid", "attestation_hash"}, "installed " + role
        )
        if service != expected:
            fail("installed durable " + role + " identity no longer matches its private account")
        services[role] = expected
    paths = require_exact_keys(
        config["paths"], {"python_path", "node_path", "systemd_run_path", "systemctl_path"}, "installed durable paths"
    )
    paths = {key: resolve_root_executable(value, key) for key, value in paths.items()}
    files = require_exact_keys(config["files"], FILE_LAYOUT.keys(), "installed durable files")
    for name, relative in FILE_LAYOUT.items():
        entry = require_exact_keys(files[name], {"relative_path", "sha256"}, "installed " + name + " snapshot")
        if entry["relative_path"] != relative:
            fail("installed " + name + " snapshot relative path is unexpected")
        path = os.path.join(install_root, relative)
        require_root_owned_path(path, "installed " + name + " snapshot", executable=bool(FILE_MODES[name] & 0o111))
        require_service_traversable_path(path, "installed " + name + " snapshot", executable=bool(FILE_MODES[name] & 0o111))
        if file_digest(path) != require_sha256(entry["sha256"], "installed " + name + " hash"):
            fail("installed " + name + " snapshot hash does not match content")
    if config["systemd_properties"] != list(SYSTEMD_PROPERTIES):
        fail("installed durable systemd properties differ from the frozen host")
    if (
        config["owner_kernel_authority"] != "none"
        or config["effect_authority"] != "none"
        or config["broker_authority"] != "disabled"
        or config["acceptance"] != "not_available"
    ):
        fail("installed durable host carries forbidden authority")
    durable_abi_hash = installed_durable_abi(paths["node_path"], os.path.join(install_root, FILE_LAYOUT["contract"]))
    if durable_abi_hash != require_sha256(config["durable_abi_hash"], "installed durable ABI"):
        fail("installed durable ABI does not match its snapshot")
    state_root = ensure_root_state_root(config["state_root"])
    handoff_root = require_root_owned_path(config["p35_handoff_root"], "P3.5 durable handoff root", directory=True)
    return {"services": services, "paths": paths, "durable_abi_hash": durable_abi_hash, "state_root": state_root, "handoff_root": handoff_root}


def ensure_runtime_parent():
    if not os.path.lexists(RUNTIME_PARENT):
        parent = os.path.dirname(RUNTIME_PARENT)
        require_root_owned_path(parent, "durable runtime parent ancestor", directory=True)
        if ensure_directory(RUNTIME_PARENT, 0, 0, 0o711, "durable runtime parent"):
            fsync_directory(parent)
    require_exact_directory(RUNTIME_PARENT, 0, 0, 0o711, "durable runtime parent")


def cgroup_v2_matches(pid, expected_path):
    try:
        with open("/proc/" + str(pid) + "/cgroup", "r", encoding="utf-8") as source:
            values = source.read(8192).splitlines()
    except OSError:
        return False
    return values == ["0::" + expected_path]


def process_identity_matches(pid, service):
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
        uids = [int(value) for value in fields["Uid"]]
        gids = [int(value) for value in fields["Gid"]]
        groups = {int(value) for value in fields["Groups"]}
    except (KeyError, ValueError):
        return False
    return uids == [service["uid"]] * 4 and gids == [service["gid"]] * 4 and groups == {service["gid"]}


def service_unit_name(role):
    return "autopilot-p36d-" + role.replace("_", "-") + "-" + secrets.token_hex(10) + ".service"


def wait_for_service_pid(systemctl_path, unit, cgroup_path, service, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        result = run_command(
            [systemctl_path, "show", "--property=MainPID", "--value", unit],
            timeout_seconds=min(2, max(0.1, deadline - time.monotonic())),
        )
        candidate = result.stdout.strip() if result.returncode == 0 else ""
        if candidate.isdigit() and int(candidate) > 0:
            pid = int(candidate)
            if cgroup_v2_matches(pid, cgroup_path) and process_identity_matches(pid, service):
                return pid
        time.sleep(0.05)
    fail("durable service did not expose its exact PID/UID/GID/cgroup: " + unit)


def verify_service_process_binding(systemctl_path, unit, service):
    """Re-read systemd's MainPID and reject an exited or replaced service."""

    expected_pid = unit.get("pid")
    if expected_pid is None:
        fail("durable service has no root-pinned MainPID")
    current_pid = wait_for_service_pid(
        systemctl_path,
        unit["unit"],
        unit["cgroup_path"],
        service,
        min(ROLE_START_TIMEOUT_SECONDS, 2),
    )
    if current_pid != expected_pid:
        fail("durable service MainPID changed after root pinning: " + unit["unit"])
    return current_pid


def wait_for_load_state(systemctl_path, unit, wanted, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    observed = ""
    while time.monotonic() < deadline:
        result = run_command([systemctl_path, "show", "--property=LoadState", "--value", unit], timeout_seconds=2)
        if result.returncode == 0:
            observed = result.stdout.strip()
            if observed == wanted:
                return
        time.sleep(0.05)
    fail("durable unit did not reach LoadState=" + wanted + ": " + observed)


def stop_and_collect_unit(systemctl_path, unit):
    details = []
    for command in ("stop", "reset-failed"):
        result = run_command([systemctl_path, command, unit], timeout_seconds=5)
        if result.returncode != 0:
            details.append(command + "=" + str(result.returncode))
    try:
        wait_for_load_state(systemctl_path, unit, "not-found", 5)
    except DurableHostError as error:
        fail("durable unit cleanup failed: " + "; ".join(details + [str(error)]))


def remove_tree(path):
    """Remove only a root-created runtime tree after units have stopped."""

    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return
    except OSError as error:
        raise DurableHostError("runtime cleanup cannot inspect " + path + ": " + str(error)) from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        fail("runtime cleanup refused an unexpected path type")
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in os.listdir(descriptor):
            if not name or "/" in name or name in {".", ".."}:
                fail("runtime cleanup encountered an invalid name")
            child_info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            child = os.path.join(path, name)
            if stat.S_ISDIR(child_info.st_mode):
                remove_tree(child)
            elif stat.S_ISREG(child_info.st_mode) or stat.S_ISSOCK(child_info.st_mode):
                os.unlink(name, dir_fd=descriptor)
            else:
                fail("runtime cleanup refused an unexpected entry type")
    finally:
        os.close(descriptor)
    os.rmdir(path)


def fsync_root_file(path):
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        os.fsync(descriptor)
    except OSError as error:
        raise DurableHostError("file cannot be synchronized: " + path + ": " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _read_root_private_json(path, label, maximum=65536):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise DurableHostError(label + " cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != 0
        or (info.st_mode & 0o777) != 0o600
        or info.st_nlink != 1
        or info.st_size <= 0
        or info.st_size > maximum
    ):
        fail(label + " is not a root-private canonical file")
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        raw = os.read(descriptor, maximum + 1)
        if len(raw) > maximum:
            fail(label + " exceeds the byte limit")
    except OSError as error:
        raise DurableHostError(label + " cannot be read: " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
    return decode_root_canonical_json(raw, label, maximum)


def _require_root_private_regular_file(path, label, *, allow_empty=False, maximum=65536):
    """Validate a root-owned ledger/lock before opening it by path."""

    try:
        info = os.lstat(path)
    except OSError as error:
        raise DurableHostError(label + " cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != 0
        or (info.st_mode & 0o777) != 0o600
        or info.st_nlink != 1
        or info.st_size > maximum
        or (not allow_empty and info.st_size <= 0)
    ):
        fail(label + " is not a root-private regular file")
    return info


def _write_root_private_replacement(path, value, label):
    parent = os.path.dirname(path)
    temporary = path + ".pending-" + secrets.token_hex(12)
    try:
        write_root_file(temporary, (canonical(value) + "\n").encode("utf-8"), 0o600)
        os.replace(temporary, path)
        fsync_directory(parent)
    except OSError as error:
        raise DurableHostError(label + " cannot be atomically written: " + str(error)) from error
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def generation_ledger_path(state_root):
    return os.path.join(state_root, "generation.json")


def generation_lock_path(state_root):
    return os.path.join(state_root, ".generation.lock")


def admission_lock_path(state_root):
    return os.path.join(state_root, ".admission.lock")


def acquire_admission_lock(state_root):
    """Serialize capacity admission through durable intent publication."""

    path = admission_lock_path(state_root)
    if write_root_file(path, b"", 0o600, allow_existing=True):
        fsync_directory(state_root)
    expected = _require_root_private_regular_file(
        path, "durable admission lock", allow_empty=True, maximum=0
    )
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != expected.st_uid
            or opened.st_gid != expected.st_gid
            or (opened.st_mode & 0o777) != 0o600
            or opened.st_nlink != 1
            or opened.st_dev != expected.st_dev
            or opened.st_ino != expected.st_ino
        ):
            fail("durable admission lock changed while opening")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        return descriptor
    except OSError as error:
        if descriptor is not None:
            os.close(descriptor)
        raise DurableHostError("durable admission lock cannot be acquired") from error


def release_admission_lock(descriptor):
    if descriptor is None:
        return
    try:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)


def ensure_generation_ledger(state_root):
    lock_path = generation_lock_path(state_root)
    if write_root_file(lock_path, b"", 0o600, allow_existing=True):
        fsync_directory(state_root)
    _require_root_private_regular_file(
        lock_path, "durable generation lock", allow_empty=True, maximum=0
    )
    ledger_path = generation_ledger_path(state_root)
    material = {"schema_version": SCHEMA_VERSION, "kind": "p36_durable_generation_ledger", "last_generation": 0}
    value = dict(material, ledger_hash=sha256_value(material))
    if write_root_file(ledger_path, (canonical(value) + "\n").encode("utf-8"), 0o600, allow_existing=True):
        fsync_directory(state_root)
    _require_root_private_regular_file(ledger_path, "durable generation ledger")
    return lock_path, ledger_path


def allocate_generation(state_root):
    lock_path, ledger_path = ensure_generation_ledger(state_root)
    descriptor = None
    try:
        descriptor = os.open(lock_path, os.O_RDWR | os.O_NOFOLLOW)
        opened_lock = os.fstat(descriptor)
        expected_lock = _require_root_private_regular_file(
            lock_path, "durable generation lock", allow_empty=True, maximum=0
        )
        if (
            opened_lock.st_dev != expected_lock.st_dev
            or opened_lock.st_ino != expected_lock.st_ino
            or not stat.S_ISREG(opened_lock.st_mode)
            or opened_lock.st_uid != 0
            or opened_lock.st_gid != 0
            or (opened_lock.st_mode & 0o777) != 0o600
            or opened_lock.st_nlink != 1
            or opened_lock.st_size != 0
        ):
            fail("durable generation lock changed while opening")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        value = _read_root_private_json(ledger_path, "durable generation ledger")
        require_exact_keys(value, {"schema_version", "kind", "last_generation", "ledger_hash"}, "durable generation ledger")
        material = dict(value)
        ledger_hash = material.pop("ledger_hash")
        if (
            require_exact_int(value["schema_version"], SCHEMA_VERSION, "durable generation ledger schema")
            != SCHEMA_VERSION
            or value["kind"] != "p36_durable_generation_ledger"
            or isinstance(value["last_generation"], bool)
            or not isinstance(value["last_generation"], int)
            or value["last_generation"] < 0
            or sha256_value(material) != require_sha256(ledger_hash, "durable generation ledger hash")
        ):
            fail("durable generation ledger is invalid")
        next_generation = value["last_generation"] + 1
        material = {"schema_version": SCHEMA_VERSION, "kind": "p36_durable_generation_ledger", "last_generation": next_generation}
        _write_root_private_replacement(ledger_path, dict(material, ledger_hash=sha256_value(material)), "durable generation ledger")
        return next_generation
    finally:
        if descriptor is not None:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            finally:
                os.close(descriptor)


def cohort_root_path(state_root, cohort_id):
    return os.path.join(state_root, "cohorts", require_token(cohort_id, "durable cohort id"))


def provision_durable_leaf(core, leaf, binding, role, service):
    """Precreate the whole P3a control set before any service starts."""

    parent = os.path.dirname(leaf)
    create_directory(parent, 0, service["gid"], 0o710, role + " durable state parent")
    create_directory(leaf, 0, service["gid"], 0o750, role + " durable state leaf")
    generation = core.generation_manifest_for(binding, role)
    header = core.journal_header_for(binding, role)
    values = {
        "generation.json": ((core.canonical(generation) + "\n").encode("utf-8"), 0o440),
        ".lock": (b"", 0o660),
        "journal.jsonl": ((core.canonical(header) + "\n").encode("utf-8"), 0o660),
        "cohort.json": (b"", 0o660),
        "quarantine.json": (b"", 0o660),
    }
    for name, (content, mode) in values.items():
        write_root_file(os.path.join(leaf, name), content, mode, service["gid"])
    fsync_directory(leaf)
    fsync_directory(parent)
    expected = {"generation.json", ".lock", "journal.jsonl", "cohort.json", "quarantine.json"}
    if set(os.listdir(leaf)) != expected:
        fail(role + " durable leaf does not retain the complete root-created control set")


def provision_cohort_state(core, state_root, binding, services):
    cohorts = os.path.join(state_root, "cohorts")
    if not os.path.lexists(cohorts):
        if ensure_directory(cohorts, 0, 0, 0o711, "durable cohorts root"):
            fsync_directory(state_root)
    require_exact_directory(cohorts, 0, 0, 0o711, "durable cohorts root")
    root = cohort_root_path(state_root, binding["cohort_id"])
    create_directory(root, 0, 0, 0o711, "durable cohort root")
    leaves = {}
    for role in ("witness", "coordinator"):
        leaf = os.path.join(root, role, "leaf")
        provision_durable_leaf(core, leaf, binding, role, services[role])
        leaves[role] = leaf
    fsync_directory(root)
    return root, leaves


def write_abandoned_tombstone(state_root, binding, handoff_hash, reason):
    tombstone_root = os.path.join(state_root, "abandoned")
    if not os.path.lexists(tombstone_root):
        if ensure_directory(tombstone_root, 0, 0, 0o700, "durable abandoned cohort root"):
            fsync_directory(state_root)
    require_exact_directory(tombstone_root, 0, 0, 0o700, "durable abandoned cohort root")
    path = os.path.join(tombstone_root, binding["cohort_id"] + ".json")
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_abandoned_cohort",
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "binding_hash": sha256_value(binding),
        "handoff_hash": require_sha256(handoff_hash, "durable handoff hash"),
        "reason_hash": sha256_value(reason),
    }
    value = dict(material, tombstone_hash=sha256_value(material))
    if os.path.exists(path):
        fail("durable abandoned cohort tombstone already exists")
    write_root_file(path, (canonical(value) + "\n").encode("utf-8"), 0o600)
    fsync_directory(tombstone_root)


def write_abandoned_tombstone_from_attempt(state_root, attempt, reason):
    """Persist recovery evidence without reconstructing a full service binding."""

    tombstone_root = os.path.join(state_root, "abandoned")
    if not os.path.lexists(tombstone_root):
        if ensure_directory(tombstone_root, 0, 0, 0o700, "durable abandoned cohort root"):
            fsync_directory(state_root)
    require_exact_directory(tombstone_root, 0, 0, 0o700, "durable abandoned cohort root")
    path = os.path.join(tombstone_root, attempt["cohort_id"] + ".json")
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_abandoned_cohort",
        "cohort_id": attempt["cohort_id"],
        "generation": attempt["generation"],
        "binding_hash": attempt["binding_hash"],
        "handoff_hash": attempt["handoff_hash"],
        "reason_hash": sha256_value(reason),
    }
    value = dict(material, tombstone_hash=sha256_value(material))
    write_root_file(path, (canonical(value) + "\n").encode("utf-8"), 0o600)
    fsync_directory(tombstone_root)


def launch_attempt_root(state_root):
    return os.path.join(state_root, "attempts")


def launch_attempt_path(state_root, cohort_id):
    return os.path.join(launch_attempt_root(state_root), require_token(cohort_id, "durable attempt cohort") + ".json")


def process_start_token(pid):
    pid = require_positive_int(pid, "durable host PID")
    try:
        with open("/proc/" + str(pid) + "/stat", "r", encoding="utf-8") as source:
            value = source.read(4096)
    except OSError:
        return None
    if ")" not in value:
        return None
    fields = value.rsplit(")", 1)[1].split()
    # Field 22 is starttime; fields after the final ')' begin at field 3.
    if len(fields) <= 19 or not fields[19].isdigit():
        return None
    return fields[19]


def launch_attempt_material(binding, handoff, units, state):
    if state not in {"preclaim_intent", "claimed_launching", "teardown_verified", "abandoned", "recovered_unclaimed", "recovered_abandoned", "claim_rejected"}:
        fail("durable launch attempt has an unsupported state")
    start_token = process_start_token(os.getpid())
    if start_token is None:
        fail("durable host cannot bind its launch attempt to /proc starttime")
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_launch_attempt",
        "state": state,
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "binding_hash": sha256_value(binding),
        "run_binding_hash": binding["run_binding_hash"],
        "handoff_id": handoff["handoff_id"],
        "handoff_hash": handoff["handoff_hash"],
        "host_pid": os.getpid(),
        "host_start_token": start_token,
        "runtime_root": os.path.join(RUNTIME_PARENT, binding["cohort_id"]),
        "units": [
            {"unit": units[role]["unit"], "cgroup_path": units[role]["cgroup_path"]}
            for role in SERVICE_ROLES
        ],
    }


def normalize_launch_attempt(raw):
    value = require_exact_keys(
        raw,
        {
            "schema_version", "kind", "state", "cohort_id", "generation", "binding_hash", "run_binding_hash",
            "handoff_id", "handoff_hash", "host_pid", "host_start_token", "runtime_root", "units", "attempt_hash",
        },
        "durable launch attempt",
    )
    material = dict(value)
    attempt_hash = material.pop("attempt_hash")
    states = {"preclaim_intent", "claimed_launching", "teardown_verified", "abandoned", "recovered_unclaimed", "recovered_abandoned", "claim_rejected"}
    if (
        require_exact_int(value["schema_version"], SCHEMA_VERSION, "durable launch attempt schema")
        != SCHEMA_VERSION
        or value["kind"] != "p36_durable_launch_attempt"
        or value["state"] not in states
        or sha256_value(material) != require_sha256(attempt_hash, "durable launch attempt hash")
    ):
        fail("durable launch attempt has invalid fixed fields")
    cohort_id = require_token(value["cohort_id"], "durable launch attempt cohort")
    generation = require_positive_int(value["generation"], "durable launch attempt generation")
    runtime_root = require_absolute_path(value["runtime_root"], "durable launch attempt runtime root")
    if runtime_root != os.path.join(RUNTIME_PARENT, cohort_id):
        fail("durable launch attempt runtime root is not cohort-bound")
    if not isinstance(value["host_start_token"], str) or not value["host_start_token"].isdigit():
        fail("durable launch attempt host start token is invalid")
    if not isinstance(value["units"], list) or len(value["units"]) != len(SERVICE_ROLES):
        fail("durable launch attempt does not retain every service unit")
    units = []
    seen_units = set()
    for index, raw_unit in enumerate(value["units"]):
        unit = require_exact_keys(raw_unit, {"unit", "cgroup_path"}, "durable launch attempt unit " + str(index))
        name = require_token(unit["unit"], "durable launch attempt unit name")
        cgroup_path = require_absolute_path(unit["cgroup_path"], "durable launch attempt cgroup")
        if (
            not name.startswith("autopilot-p36d-")
            or not name.endswith(".service")
            or cgroup_path != "/system.slice/" + name
            or name in seen_units
        ):
            fail("durable launch attempt unit is not root-planned")
        seen_units.add(name)
        units.append({"unit": name, "cgroup_path": cgroup_path})
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_launch_attempt",
        "state": value["state"],
        "cohort_id": cohort_id,
        "generation": generation,
        "binding_hash": require_sha256(value["binding_hash"], "durable launch attempt binding"),
        "run_binding_hash": require_sha256(value["run_binding_hash"], "durable launch attempt run binding"),
        "handoff_id": require_token(value["handoff_id"], "durable launch attempt handoff id"),
        "handoff_hash": require_sha256(value["handoff_hash"], "durable launch attempt handoff hash"),
        "host_pid": require_positive_int(value["host_pid"], "durable launch attempt host PID"),
        "host_start_token": value["host_start_token"],
        "runtime_root": runtime_root,
        "units": units,
        "attempt_hash": require_sha256(value["attempt_hash"], "durable launch attempt hash"),
    }


def write_launch_attempt(state_root, material, replace=False):
    root = launch_attempt_root(state_root)
    if not os.path.lexists(root):
        if ensure_directory(root, 0, 0, 0o700, "durable launch attempt root"):
            fsync_directory(state_root)
    require_exact_directory(root, 0, 0, 0o700, "durable launch attempt root")
    material = dict(material)
    material["attempt_hash"] = sha256_value(material)
    value = normalize_launch_attempt(material)
    path = launch_attempt_path(state_root, value["cohort_id"])
    if replace:
        _write_root_private_replacement(path, value, "durable launch attempt")
    else:
        write_root_file(path, (canonical(value) + "\n").encode("utf-8"), 0o600)
        fsync_directory(root)
    return value


def transition_launch_attempt(state_root, attempt, state):
    material = dict(attempt)
    material.pop("attempt_hash", None)
    material["state"] = state
    return write_launch_attempt(state_root, material, replace=True)


def state_tree_usage(path):
    total_bytes = 0
    entries = 0
    pending = [path]
    while pending:
        current = pending.pop()
        try:
            info = os.lstat(current)
        except OSError as error:
            raise DurableHostError("durable state capacity cannot inspect " + current + ": " + str(error)) from error
        if stat.S_ISLNK(info.st_mode):
            fail("durable state capacity rejects a symlink")
        entries += 1
        if entries > 16384:
            fail("DURABLE_CAPACITY_EXHAUSTED: durable state entry limit")
        if stat.S_ISDIR(info.st_mode):
            try:
                names = os.listdir(current)
            except OSError as error:
                raise DurableHostError("durable state capacity cannot list " + current) from error
            pending.extend(os.path.join(current, name) for name in names)
        elif stat.S_ISREG(info.st_mode):
            total_bytes += info.st_size
            if total_bytes > MAX_DURABLE_STATE_BYTES:
                fail("DURABLE_CAPACITY_EXHAUSTED: durable state byte limit")
        else:
            fail("durable state capacity rejects an unexpected entry type")
    return total_bytes, entries


def directory_entry_count(path, label):
    if not os.path.lexists(path):
        return 0
    require_exact_directory(path, 0, 0, 0o711 if label == "cohorts" else 0o700, "durable " + label + " root")
    try:
        return len(os.listdir(path))
    except OSError as error:
        raise DurableHostError("durable " + label + " root cannot be listed") from error


def require_durable_capacity(state_root):
    state_tree_usage(state_root)
    cohorts = directory_entry_count(os.path.join(state_root, "cohorts"), "cohorts")
    attempts = directory_entry_count(launch_attempt_root(state_root), "attempts")
    if cohorts >= MAX_DURABLE_COHORTS:
        fail("DURABLE_CAPACITY_EXHAUSTED: durable cohort retention limit")
    if attempts >= MAX_DURABLE_ATTEMPTS:
        fail("DURABLE_CAPACITY_EXHAUSTED: durable attempt retention limit")


def _attempt_has_matching_claim(attempt, handoff_module, handoff_root):
    path = handoff_module._claim_path(handoff_root, attempt["handoff_id"])
    if not os.path.lexists(path):
        return False
    try:
        claim = handoff_module.normalize_claim(
            handoff_module._read_root_file(path, "durable recovery handoff claim")
        )
    except handoff_module.DurableHandoffError as error:
        raise DurableHostError("durable recovery handoff claim is invalid") from error
    return (
        claim["handoff_id"] == attempt["handoff_id"]
        and claim["handoff_hash"] == attempt["handoff_hash"]
        and claim["cohort_id"] == attempt["cohort_id"]
        and claim["generation"] == attempt["generation"]
        and claim["p36_run_binding_hash"] == attempt["run_binding_hash"]
        and claim["durable_binding_hash"] == attempt["binding_hash"]
    )


def recover_stale_launch_attempts(state_root, systemctl_path, handoff_module, handoff_root):
    """Reap only a dead host's root-recorded cohort before a new admission."""

    root = launch_attempt_root(state_root)
    if not os.path.lexists(root):
        return []
    require_exact_directory(root, 0, 0, 0o700, "durable launch attempt root")
    recovered = []
    for name in sorted(os.listdir(root)):
        if not name.endswith(".json"):
            fail("durable launch attempt root has an unexpected entry")
        attempt = normalize_launch_attempt(
            _read_root_private_json(os.path.join(root, name), "durable launch attempt")
        )
        if name != attempt["cohort_id"] + ".json":
            fail("durable launch attempt filename does not bind its cohort")
        if attempt["state"] not in {"preclaim_intent", "claimed_launching", "abandoned", "claim_rejected"}:
            continue
        if process_start_token(attempt["host_pid"]) == attempt["host_start_token"]:
            continue
        for unit in reversed(attempt["units"]):
            stop_and_collect_unit(systemctl_path, unit["unit"])
        if os.path.lexists(attempt["runtime_root"]):
            remove_tree(attempt["runtime_root"])
        claimed = attempt["state"] in {"claimed_launching", "abandoned"} or _attempt_has_matching_claim(
            attempt, handoff_module, handoff_root
        )
        if claimed:
            tombstone = os.path.join(state_root, "abandoned", attempt["cohort_id"] + ".json")
            if not os.path.lexists(tombstone):
                write_abandoned_tombstone_from_attempt(state_root, attempt, "stale host recovery")
            transition_launch_attempt(state_root, attempt, "recovered_abandoned")
        else:
            transition_launch_attempt(state_root, attempt, "recovered_unclaimed")
        recovered.append(attempt["cohort_id"])
    return recovered


def endpoint_specs(runtime_root, services, transport):
    values = []
    ipc_root = os.path.join(runtime_root, "ipc")
    create_directory(ipc_root, 0, 0, 0o711, "durable IPC root")
    for index, endpoint in enumerate(transport.DURABLE_ENDPOINTS):
        endpoint_root = os.path.join(ipc_root, "e" + str(index))
        socket_path = os.path.join(endpoint_root, "s")
        transport.require_unix_socket_path(socket_path, "durable endpoint socket")
        sender = services[endpoint["sender_role"]]
        recipient = services[endpoint["recipient_role"]]
        create_directory(endpoint_root, recipient["uid"], sender["gid"], 0o2710, endpoint["endpoint_id"] + " staging root")
        values.append(
            {
                "endpoint_id": endpoint["endpoint_id"],
                "socket_root": endpoint_root,
                "socket_path": socket_path,
                "sender_role": endpoint["sender_role"],
                "recipient_role": endpoint["recipient_role"],
                "sender_gid": sender["gid"],
            }
        )
    return values


def role_paths(runtime_root, role):
    root = os.path.join(runtime_root, "roles", role)
    return {
        "root": root,
        "release": os.path.join(root, "release"),
        "bootstrap": os.path.join(root, "bootstrap.json"),
        "peer_config": os.path.join(root, "peer.json"),
        "ack_root": os.path.join(root, "ack"),
        "ready": os.path.join(root, "ack", "listeners.json"),
        "ack": os.path.join(root, "ack", "release.json"),
    }


def plan_units(runtime_root):
    units = {}
    for role in SERVICE_ROLES:
        paths = role_paths(runtime_root, role)
        unit = service_unit_name(role)
        units[role] = {
            "unit": unit,
            "cgroup_path": "/system.slice/" + unit,
            "release_token": "p36d-" + secrets.token_hex(24),
            "paths": paths,
            "pid": None,
            # systemd-run may create a transient unit and still return a
            # timeout/error to its caller.  Mark before launch so cleanup
            # interrogates every possibly-created unit.
            "may_exist": False,
        }
    return units


def create_runtime_layout(runtime_root, services, units):
    create_directory(runtime_root, 0, 0, 0o711, "durable runtime root")
    roles_root = os.path.join(runtime_root, "roles")
    create_directory(roles_root, 0, 0, 0o711, "durable role runtime root")
    for role in SERVICE_ROLES:
        service = services[role]
        paths = units[role]["paths"]
        create_directory(paths["root"], 0, service["gid"], 0o710, role + " runtime root")
        create_directory(paths["ack_root"], service["uid"], service["gid"], 0o700, role + " acknowledgement root")


def run_binding_material(config, handoff, generation, cohort_id, units, services):
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_run_binding",
        "p36_install_binding_hash": config["binding_hash"],
        "p35_handoff_hash": handoff["handoff_hash"],
        "p35_install_binding_hash": handoff["p35_install_binding_hash"],
        "bridge_plan_hash": handoff["bridge_plan_hash"],
        "cohort_id": cohort_id,
        "generation": generation,
        "services": [
            {
                "role": role,
                "identity": services[role]["identity"],
                "uid": services[role]["uid"],
                "gid": services[role]["gid"],
                "attestation_hash": services[role]["attestation_hash"],
                "unit": units[role]["unit"],
                "cgroup_path": units[role]["cgroup_path"],
            }
            for role in SERVICE_ROLES
        ],
    }


def durable_binding(core, config, handoff, generation, cohort_id, run_binding_hash, units, services):
    binding = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_state_binding",
        "install_binding_hash": config["binding_hash"],
        "run_binding_hash": run_binding_hash,
        "substrate_abi_hash": sha256_value(
            {"kind": "p36_durable_substrate_abi", "durable_abi_hash": config["durable_abi_hash"]}
        ),
        "substrate_plan_hash": handoff["bridge_plan_hash"],
        "durable_abi_hash": config["durable_abi_hash"],
        "cohort_id": cohort_id,
        "generation": generation,
        "service_bindings": {
            role: {
                "role": role,
                "identity": services[role]["identity"],
                "uid": services[role]["uid"],
                "gid": services[role]["gid"],
                "attestation_hash": services[role]["attestation_hash"],
                "cgroup_binding_hash": core.sha256_value(units[role]["cgroup_path"]),
            }
            for role in SERVICE_ROLES
        },
    }
    try:
        return core.normalize_binding(binding)
    except core.DurableStateError as error:
        raise DurableHostError("root-created durable binding is invalid: " + str(error)) from error


def bootstrap_material(role, unit, service, state_leaf, endpoints):
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_service_bootstrap",
        "role": role,
        "identity": service["identity"],
        "uid": service["uid"],
        "gid": service["gid"],
        "attestation_hash": service["attestation_hash"],
        "release_path": unit["paths"]["release"],
        "release_token": unit["release_token"],
        "ready_path": unit["paths"]["ready"],
        "ack_path": unit["paths"]["ack"],
        "peer_config_path": unit["paths"]["peer_config"],
        "state_leaf": state_leaf,
        "release_timeout_seconds": ROLE_RELEASE_TIMEOUT_SECONDS,
        "hold_seconds": ROLE_HOLD_SECONDS,
        "endpoints": [
            endpoint
            for endpoint in endpoints
            if role in {endpoint["sender_role"], endpoint["recipient_role"]}
        ],
    }
    return dict(material, bootstrap_hash=sha256_value(material))


def write_bootstraps(units, services, leaves, endpoints):
    values = {}
    for role in SERVICE_ROLES:
        value = bootstrap_material(role, units[role], services[role], leaves.get(role), endpoints)
        write_root_group_json(units[role]["paths"]["bootstrap"], value, services[role]["gid"], role + " durable bootstrap")
        values[role] = value
    return values


def launch_unit(paths, unit, service, bootstrap_path, writable_paths):
    command = [
        paths["systemd_run_path"],
        "--no-block",
        "--quiet",
        "--collect",
        "--unit=" + unit["unit"],
        "--slice=system.slice",
        "--uid=" + str(service["uid"]),
        "--gid=" + str(service["gid"]),
    ]
    for property_value in SYSTEMD_PROPERTIES:
        command.append("--property=" + property_value)
    writable_paths = list(writable_paths)
    if not writable_paths or len(writable_paths) != len(set(writable_paths)):
        fail("durable service writable path policy is invalid")
    command.append("--property=ReadWritePaths=" + " ".join(writable_paths))
    command.extend(
        [
            "--",
            paths["python_path"],
            "-I",
            paths["service_path"],
            "--bootstrap-config",
            bootstrap_path,
        ]
    )
    result = run_command(command)
    if result.returncode != 0:
        fail("cannot launch durable " + service["role"] + " service: " + result.stderr.strip())


def read_service_ack(path, service, label):
    parent = os.path.dirname(path)
    require_exact_directory(parent, service["uid"], service["gid"], 0o700, label + " parent")
    try:
        info = os.lstat(path)
    except OSError as error:
        raise DurableHostError(label + " cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != service["uid"]
        or info.st_gid != service["gid"]
        or (info.st_mode & 0o777) != 0o600
        or info.st_nlink != 1
        or info.st_size <= 0
        or info.st_size > 131072
    ):
        fail(label + " does not preserve service-private ownership")
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        raw = os.read(descriptor, 131073)
    except OSError as error:
        raise DurableHostError(label + " cannot be read: " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
    if len(raw) > 131072:
        fail(label + " exceeds its byte limit")
    return decode_root_canonical_json(raw, label, 131072)


def wait_for_service_json(path, service, timeout_seconds, label):
    deadline = time.monotonic() + timeout_seconds
    last_error = None
    while time.monotonic() < deadline:
        if os.path.lexists(path):
            try:
                return read_service_ack(path, service, label)
            except DurableHostError as error:
                last_error = error
        time.sleep(0.025)
    if last_error is not None:
        raise last_error
    fail(label + " did not appear before its deadline")


def collect_release_acks(units, services, bootstraps, peer_configs, core, systemctl_path):
    """Collect all role acknowledgements against one cohort-wide deadline."""

    deadline = time.monotonic() + ROLE_ACK_TIMEOUT_SECONDS
    pending = set(SERVICE_ROLES)
    snapshots = {}
    evidence_by_role = {}
    errors = {}
    while pending and time.monotonic() < deadline:
        for role in tuple(pending):
            unit = units[role]
            service = services[role]
            path = unit["paths"]["ack"]
            if not os.path.lexists(path):
                continue
            try:
                ack = read_service_ack(path, service, role + " durable release acknowledgement")
                verify_service_process_binding(systemctl_path, unit, service)
                snapshot, evidence = validate_ack(
                    ack,
                    bootstraps[role],
                    peer_configs[role],
                    service,
                    unit,
                    core,
                )
            except DurableHostError as error:
                errors[role] = str(error)
                continue
            if snapshot is not None:
                snapshots[role] = snapshot
            evidence_by_role[role] = evidence
            pending.remove(role)
        if pending:
            time.sleep(0.025)
    if pending:
        detail = "; ".join(role + "=" + errors.get(role, "acknowledgement did not appear") for role in sorted(pending))
        fail("durable release acknowledgements missed the shared deadline: " + detail)
    return snapshots, evidence_by_role


def validate_ready(raw, bootstrap, service, unit, expected_listener_ids):
    value = require_exact_keys(
        raw,
        {
            "schema_version", "kind", "role", "identity", "pid", "uid", "gid", "bootstrap_hash",
            "listener_endpoint_ids", "ready_hash",
        },
        "durable listener readiness",
    )
    material = dict(value)
    ready_hash = material.pop("ready_hash")
    if (
        require_exact_int(value["schema_version"], SCHEMA_VERSION, "durable listener readiness schema")
        != SCHEMA_VERSION
        or value["kind"] != "p36_durable_listener_ready"
        or value["role"] != service["role"]
        or value["identity"] != service["identity"]
        or require_positive_int(value["pid"], "durable listener readiness PID") != unit["pid"]
        or require_positive_int(value["uid"], "durable listener readiness UID") != service["uid"]
        or require_positive_int(value["gid"], "durable listener readiness GID") != service["gid"]
        or value["bootstrap_hash"] != bootstrap["bootstrap_hash"]
        or value["listener_endpoint_ids"] != expected_listener_ids
        or sha256_value(material) != require_sha256(ready_hash, "durable readiness hash")
    ):
        fail("durable listener readiness does not match the root-pinned service")


def wait_for_listener_socket(endpoint, services, timeout_seconds):
    recipient = services[endpoint["recipient_role"]]
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if os.path.lexists(endpoint["socket_path"]):
            require_exact_directory(
                endpoint["socket_root"], recipient["uid"], endpoint["sender_gid"], 0o2710,
                endpoint["endpoint_id"] + " staging root",
            )
            require_exact_socket(
                endpoint["socket_path"], recipient["uid"], endpoint["sender_gid"], 0o660,
                endpoint["endpoint_id"] + " listener socket",
            )
            return
        time.sleep(0.025)
    fail(endpoint["endpoint_id"] + " durable listener did not appear")


def seal_listener_socket(endpoint, services):
    recipient = services[endpoint["recipient_role"]]
    sender = services[endpoint["sender_role"]]
    root = endpoint["socket_root"]
    path = endpoint["socket_path"]
    require_exact_directory(root, recipient["uid"], sender["gid"], 0o2710, endpoint["endpoint_id"] + " staging root")
    descriptor = None
    try:
        descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        entries = os.listdir(descriptor)
        if entries != [os.path.basename(path)]:
            fail(endpoint["endpoint_id"] + " staging root contains unexpected entries")
        os.fchown(descriptor, 0, sender["gid"])
        os.fchmod(descriptor, 0o710)
        os.fsync(descriptor)
    except OSError as error:
        raise DurableHostError(endpoint["endpoint_id"] + " listener cannot be sealed: " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
    require_exact_directory(root, 0, sender["gid"], 0o710, endpoint["endpoint_id"] + " sealed root")
    require_exact_socket(path, recipient["uid"], sender["gid"], 0o660, endpoint["endpoint_id"] + " sealed socket")


def runtime_services(core, binding, units, services):
    values = {}
    for role in SERVICE_ROLES:
        unit = units[role]
        service = services[role]
        if unit["pid"] is None:
            fail("durable runtime service PID is absent")
        values[role] = {
            "role": role,
            "identity": service["identity"],
            "uid": service["uid"],
            "gid": service["gid"],
            "attestation_hash": service["attestation_hash"],
            "pid": unit["pid"],
            "cgroup_path": unit["cgroup_path"],
            "cgroup_binding_hash": core.sha256_value(unit["cgroup_path"]),
        }
    return values


def direct_peer_roles(role, endpoints):
    roles = {role}
    for endpoint in endpoints:
        if role in {endpoint["sender_role"], endpoint["recipient_role"]}:
            roles.add(endpoint["sender_role"])
            roles.add(endpoint["recipient_role"])
    return roles


def scoped_durable_binding(role, binding, endpoints):
    """Return a transport binding that discloses real identities only on routes.

    Stateless roles only need the two claims on each endpoint they can use.
    The durable ABI requires five syntactically valid bindings, so undisclosed
    services are deterministic, non-routable placeholders rather than omitted
    fields.  Witness/coordinator retain the full static binding because the
    P3a state core itself validates that frozen cohort contract; their runtime
    PID/cgroup disclosure remains route-scoped below.
    """

    if role in {"witness", "coordinator"}:
        return binding
    disclosed = direct_peer_roles(role, endpoints)
    material = dict(binding)
    service_bindings = {}
    used_identities = {binding["service_bindings"][name]["identity"] for name in disclosed}
    used_uids = {binding["service_bindings"][name]["uid"] for name in disclosed}
    used_gids = {binding["service_bindings"][name]["gid"] for name in disclosed}
    binding_hash = sha256_value(binding)
    for index, candidate_role in enumerate(SERVICE_ROLES, start=1):
        if candidate_role in disclosed:
            service_bindings[candidate_role] = binding["service_bindings"][candidate_role]
            continue
        digest = sha256_value({
            "kind": "p36_durable_redacted_peer_binding",
            "binding_hash": binding_hash,
            "viewer_role": role,
            "redacted_role": candidate_role,
        })
        identity = "p36d-hidden-" + digest[:24]
        suffix = 0
        while identity in used_identities:
            suffix += 1
            identity = "p36d-hidden-" + digest[:20] + str(suffix)
        used_identities.add(identity)
        uid = 900000000 + index
        while uid in used_uids:
            uid += len(SERVICE_ROLES)
        used_uids.add(uid)
        gid = 910000000 + index
        while gid in used_gids:
            gid += len(SERVICE_ROLES)
        used_gids.add(gid)
        service_bindings[candidate_role] = {
            "role": candidate_role,
            "identity": identity,
            "uid": uid,
            "gid": gid,
            "attestation_hash": sha256_value({"kind": "p36d-hidden-attestation", "digest": digest}),
            "cgroup_binding_hash": sha256_value({"kind": "p36d-hidden-cgroup", "digest": digest}),
        }
    material["service_bindings"] = service_bindings
    return material


def peer_config_material(role, binding, runtime, endpoints):
    disclosed = direct_peer_roles(role, endpoints)
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_peer_config",
        "role": role,
        "durable_binding": scoped_durable_binding(role, binding, endpoints),
        "runtime_services": {candidate: runtime[candidate] for candidate in sorted(disclosed)},
        "endpoints": [
            endpoint
            for endpoint in endpoints
            if role in {endpoint["sender_role"], endpoint["recipient_role"]}
        ],
    }
    return dict(material, peer_config_hash=sha256_value(material))


def write_peer_configs(units, services, binding, runtime, endpoints):
    values = {}
    for role in SERVICE_ROLES:
        value = peer_config_material(role, binding, runtime, endpoints)
        write_root_group_json(units[role]["paths"]["peer_config"], value, services[role]["gid"], role + " durable peer config")
        values[role] = value
    return values


def create_release_file(path, token, gid):
    parent = os.path.dirname(path)
    if os.path.lexists(path):
        fail("durable release path already exists")
    temporary = path + ".pending-" + secrets.token_hex(12)
    descriptor = None
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        write_all(descriptor, (token + "\n").encode("ascii"))
        os.fsync(descriptor)
        os.fchown(descriptor, 0, gid)
        os.fchmod(descriptor, 0o440)
        os.fsync(descriptor)
        os.link(temporary, path, follow_symlinks=False)
        os.unlink(temporary)
        fsync_directory(parent)
    except OSError as error:
        raise DurableHostError("durable release file cannot be published: " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def durable_probe_id(binding, suffix):
    seed = sha256_value({
        "kind": "p36_durable_fixed_probe_seed",
        **{
            key: binding[key]
            for key in (
                "install_binding_hash",
                "run_binding_hash",
                "substrate_abi_hash",
                "substrate_plan_hash",
                "durable_abi_hash",
                "cohort_id",
                "generation",
            )
        },
    })
    return "p36d-probe-" + seed[:24] + "-" + suffix


def expected_probe_evidence(binding, role):
    """Return the A0-only fixed no-effect evidence contract for one role."""

    values = {
        "worker": [("worker_broker", "worker-execute", "execute", "BROKER_EFFECTS_DISABLED")],
        "broker": [
            ("broker_receipt_verifier", "broker-revocation", "check_revocation", "REVOCATION_UNAVAILABLE"),
        ],
        "receipt_verifier": [
            ("receipt_verifier_witness", "witness-append", "appendIfHead", "WITNESS_RECORDED"),
            ("receipt_verifier_witness", "witness-batch", "appendBatchIfHead", "WITNESS_RECORDED"),
            ("receipt_verifier_coordinator", "coordinator-prepare", "prepare", "COORDINATOR_PREPARED"),
            ("receipt_verifier_coordinator", "coordinator-cancel", "cancel", "COORDINATOR_CANCELLED"),
        ],
        "coordinator": [
            ("coordinator_witness", "witness-head", "getHead", "WITNESS_AVAILABLE"),
            ("coordinator_witness", "witness-readback", "readback", "WITNESS_AVAILABLE"),
        ],
        "witness": [],
    }
    if role not in values:
        fail("durable self-probe evidence has an unknown role")
    return [
        {
            "endpoint_id": endpoint_id,
            "request_id": durable_probe_id(binding, suffix),
            "operation": operation,
            "code": code,
        }
        for endpoint_id, suffix, operation, code in values[role]
    ]


def validate_probe_evidence(raw, binding, role):
    if not isinstance(raw, list):
        fail("durable self-probe evidence is not a list")
    expected = expected_probe_evidence(binding, role)
    if len(raw) != len(expected):
        fail("durable self-probe evidence has an unexpected entry count")
    normalized = []
    for index, (entry, wanted) in enumerate(zip(raw, expected)):
        value = require_exact_keys(
            entry,
            {"endpoint_id", "request_id", "operation", "code", "response_hash"},
            "durable self-probe evidence " + str(index),
        )
        observed = {
            "endpoint_id": require_token(value["endpoint_id"], "durable evidence endpoint"),
            "request_id": require_token(value["request_id"], "durable evidence request id"),
            "operation": require_token(value["operation"], "durable evidence operation"),
            "code": require_token(value["code"], "durable evidence code"),
            "response_hash": require_sha256(value["response_hash"], "durable evidence response hash"),
        }
        if any(observed[key] != wanted[key] for key in wanted):
            fail("durable self-probe evidence does not match the fixed A0 route")
        normalized.append(observed)
    return normalized


def write_probe_evidence(state_root, binding, handoff_hash, evidence_by_role):
    root = os.path.join(state_root, "probe-evidence")
    if not os.path.lexists(root):
        if ensure_directory(root, 0, 0, 0o700, "durable probe evidence root"):
            fsync_directory(state_root)
    require_exact_directory(root, 0, 0, 0o700, "durable probe evidence root")
    expected_roles = set(SERVICE_ROLES)
    if set(evidence_by_role) != expected_roles:
        fail("durable probe evidence does not cover every service role")
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_fixed_probe_evidence",
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "binding_hash": sha256_value(binding),
        "handoff_hash": require_sha256(handoff_hash, "durable evidence handoff hash"),
        "evidence": {role: evidence_by_role[role] for role in SERVICE_ROLES},
    }
    value = dict(material, evidence_hash=sha256_value(material))
    path = os.path.join(root, binding["cohort_id"] + ".json")
    write_root_file(path, (canonical(value) + "\n").encode("utf-8"), 0o600)
    fsync_directory(root)
    return value


def validate_ack(raw, bootstrap, peer_config, service, unit, core):
    value = require_exact_keys(
        raw,
        {
            "schema_version", "kind", "status", "role", "identity", "pid", "uid", "gid", "bootstrap_hash",
            "peer_config_hash", "binding_hash", "state_snapshot", "self_probe_evidence", "owner_kernel_authority", "effect_authority",
            "broker_authority", "acceptance", "ack_hash",
        },
        "durable release acknowledgement",
    )
    material = dict(value)
    ack_hash = material.pop("ack_hash")
    binding = peer_config["durable_binding"]
    if (
        require_exact_int(value["schema_version"], SCHEMA_VERSION, "durable acknowledgement schema")
        != SCHEMA_VERSION
        or value["kind"] != "p36_durable_release_ack"
        or value["status"] != "released_durable_no_effect"
        or value["role"] != service["role"]
        or value["identity"] != service["identity"]
        or require_positive_int(value["pid"], "durable acknowledgement PID") != unit["pid"]
        or require_positive_int(value["uid"], "durable acknowledgement UID") != service["uid"]
        or require_positive_int(value["gid"], "durable acknowledgement GID") != service["gid"]
        or value["bootstrap_hash"] != bootstrap["bootstrap_hash"]
        or value["peer_config_hash"] != peer_config["peer_config_hash"]
        or value["binding_hash"] != core.normalized_binding_hash(binding)
        or value["owner_kernel_authority"] != "none"
        or value["effect_authority"] != "none"
        or value["broker_authority"] != "disabled"
        or value["acceptance"] != "not_available"
        or sha256_value(material) != require_sha256(ack_hash, "durable acknowledgement hash")
    ):
        fail("durable release acknowledgement does not match the root-pinned cohort")
    evidence = validate_probe_evidence(value["self_probe_evidence"], binding, service["role"])
    if service["role"] in {"witness", "coordinator"}:
        try:
            snapshot = core.normalize_service_availability_snapshot(binding, service["role"], value["state_snapshot"])
        except core.DurableStateError as error:
            raise DurableHostError("durable state availability acknowledgement is invalid: " + str(error)) from error
        return snapshot, evidence
    if value["state_snapshot"] is not None:
        fail("stateless durable role returned a state snapshot")
    return None, evidence


def service_writable_paths(role, unit, endpoints, leaves):
    values = [unit["paths"]["ack_root"]]
    values.extend(
        endpoint["socket_root"]
        for endpoint in endpoints
        if endpoint["recipient_role"] == role
    )
    if role in leaves:
        values.append(leaves[role])
    if len(values) != len(set(values)):
        fail("durable service writable paths contain an alias")
    return values


def run_session(handoff_id):
    require_root()
    require_supported_host()
    require_lifecycle_timing_budget()
    install_root = installed_root_from_self()
    config = load_installed_config(install_root)
    validated = validate_installed_config(install_root, config)
    core = load_snapshot_module(install_root, "durable_core", "p36d_run_core")
    transport = load_snapshot_module(install_root, "transport", "p36d_run_transport")
    handoff_module = load_snapshot_module(install_root, "handoff", "p36d_run_handoff")
    if core.DURABLE_ABI_HASH != validated["durable_abi_hash"]:
        fail("installed durable core ABI pin does not match the host config")
    if transport.MAX_FRAME_BYTES != 524288 or not hasattr(transport, "DURABLE_ENDPOINTS"):
        fail("installed durable transport does not retain its independent ABI")

    admission_descriptor = acquire_admission_lock(validated["state_root"])
    try:
        recover_stale_launch_attempts(
            validated["state_root"],
            validated["paths"]["systemctl_path"],
            handoff_module,
            validated["handoff_root"],
        )
        require_durable_capacity(validated["state_root"])
        try:
            handoff = handoff_module.read_verified_handoff(validated["handoff_root"], handoff_id)
        except handoff_module.DurableHandoffError as error:
            raise DurableHostError("P3.5d durable handoff is unavailable: " + str(error)) from error
        generation = allocate_generation(validated["state_root"])
        cohort_id = "p36d-" + str(generation) + "-" + secrets.token_hex(12)
        runtime_root = os.path.join(RUNTIME_PARENT, cohort_id)
        units = plan_units(runtime_root)
        run_material = run_binding_material(config, handoff, generation, cohort_id, units, validated["services"])
        run_binding_hash = sha256_value(run_material)
        binding = durable_binding(
            core,
            config,
            handoff,
            generation,
            cohort_id,
            run_binding_hash,
            units,
            validated["services"],
        )
        consumer_binding = {
            "p36_install_binding_hash": config["binding_hash"],
            "p36_run_binding_hash": run_binding_hash,
            "durable_binding_hash": core.normalized_binding_hash(binding),
            "cohort_id": cohort_id,
            "generation": generation,
        }
    except BaseException:
        release_admission_lock(admission_descriptor)
        raise
    claimed = False
    claim_may_exist = False
    attempt = None
    attempt_recorded = False
    runtime_may_exist = False
    cleanup_errors = []
    result = None
    primary_error = None
    previous_signal_mask = current_termination_signal_mask("durable cohort")
    previous_handlers = install_interrupt_handlers(raise_interruption)

    def observe_persisted_claim():
        """Resolve the O_EXCL outcome from disk, never from a local flag alone."""

        nonlocal claimed
        if claimed:
            return True
        if not claim_may_exist:
            return False
        try:
            claimed = _attempt_has_matching_claim(attempt, handoff_module, validated["handoff_root"])
        except DurableHostError as error:
            # A claim path that exists but cannot be proven is terminally
            # ambiguous.  Preserve an abandoned tombstone rather than reopen
            # an O_EXCL handoff as a retryable rejection.
            cleanup_errors.append("durable claim verification: " + str(error))
            claimed = True
        return claimed

    def record_terminal_failure(reason):
        """Persist terminal evidence before an interrupted cohort can exit."""

        nonlocal attempt
        claim_exists = observe_persisted_claim() if attempt_recorded else False
        if claim_exists:
            tombstone = os.path.join(validated["state_root"], "abandoned", binding["cohort_id"] + ".json")
            if not os.path.lexists(tombstone):
                try:
                    write_abandoned_tombstone(validated["state_root"], binding, handoff["handoff_hash"], reason)
                except (DurableHostError, OSError) as tombstone_error:
                    cleanup_errors.append("abandoned cohort tombstone: " + str(tombstone_error))
        if attempt_recorded:
            try:
                attempt = transition_launch_attempt(
                    validated["state_root"], attempt, "abandoned" if claim_exists else "claim_rejected"
                )
            except (DurableHostError, OSError) as attempt_error:
                cleanup_errors.append("launch attempt state: " + str(attempt_error))
        return claim_exists

    def finalize_cohort():
        """Clean up and fsync one terminal outcome with termination signals masked."""

        nonlocal attempt
        for role in reversed(SERVICE_ROLES):
            if not units[role]["may_exist"]:
                continue
            try:
                stop_and_collect_unit(validated["paths"]["systemctl_path"], units[role]["unit"])
            except (DurableHostError, OSError) as error:
                cleanup_errors.append(role + " unit: " + str(error))
        if runtime_may_exist:
            try:
                remove_tree(runtime_root)
            except (DurableHostError, OSError) as error:
                cleanup_errors.append("runtime root: " + str(error))

        failure = primary_error
        if failure is None and result is None:
            failure = DurableHostError("durable cohort was interrupted before a verified result")
        if cleanup_errors or failure is not None:
            record_terminal_failure(str(failure or "; ".join(cleanup_errors)))
            detail = "; ".join(cleanup_errors)
            if failure is not None:
                if detail:
                    raise DurableHostError(str(failure) + "; " + detail) from failure
                raise failure
            raise DurableHostError("durable cohort cleanup failed: " + detail)
        if attempt_recorded:
            try:
                attempt = transition_launch_attempt(validated["state_root"], attempt, "teardown_verified")
            except (DurableHostError, OSError) as error:
                record_terminal_failure(str(error))
                raise DurableHostError("durable launch attempt cannot record verified teardown") from error
        return result

    final_result = None
    try:
        # Persist intent before the O_EXCL claim.  If SIGKILL lands in the
        # claim/marker gap, the next root host proves the claim binding and
        # writes an abandoned recovery record before admitting new work.
        attempt = write_launch_attempt(
            validated["state_root"], launch_attempt_material(binding, handoff, units, "preclaim_intent")
        )
        attempt_recorded = True
        release_admission_lock(admission_descriptor)
        admission_descriptor = None
        claim_may_exist = True
        try:
            claim = handoff_module.claim_verified_handoff(
                validated["handoff_root"], handoff_id, consumer_binding
            )
        except handoff_module.DurableHandoffError as error:
            raise DurableHostError("P3.5d durable handoff claim failed: " + str(error)) from error
        if claim["handoff"] != handoff:
            fail("P3.5d handoff changed between inspection and exclusive claim")
        claimed = True
        attempt = transition_launch_attempt(validated["state_root"], attempt, "claimed_launching")
        ensure_runtime_parent()
        runtime_may_exist = True
        create_runtime_layout(runtime_root, validated["services"], units)
        _cohort_root, leaves = provision_cohort_state(core, validated["state_root"], binding, validated["services"])
        endpoints = endpoint_specs(runtime_root, validated["services"], transport)
        bootstraps = write_bootstraps(units, validated["services"], leaves, endpoints)
        run_paths = dict(validated["paths"])
        run_paths["service_path"] = os.path.join(install_root, FILE_LAYOUT["service"])
        for role in SERVICE_ROLES:
            units[role]["may_exist"] = True
            launch_unit(
                run_paths,
                units[role],
                validated["services"][role],
                units[role]["paths"]["bootstrap"],
                service_writable_paths(role, units[role], endpoints, leaves),
            )
            units[role]["pid"] = wait_for_service_pid(
                validated["paths"]["systemctl_path"],
                units[role]["unit"],
                units[role]["cgroup_path"],
                validated["services"][role],
                ROLE_START_TIMEOUT_SECONDS,
            )
        for role in SERVICE_ROLES:
            expected_listeners = [
                endpoint["endpoint_id"]
                for endpoint in bootstraps[role]["endpoints"]
                if endpoint["recipient_role"] == role
            ]
            ready = wait_for_service_json(
                units[role]["paths"]["ready"],
                validated["services"][role],
                ROLE_START_TIMEOUT_SECONDS,
                role + " durable listener readiness",
            )
            verify_service_process_binding(
                validated["paths"]["systemctl_path"], units[role], validated["services"][role]
            )
            validate_ready(ready, bootstraps[role], validated["services"][role], units[role], expected_listeners)
        for endpoint in endpoints:
            wait_for_listener_socket(endpoint, validated["services"], ROLE_START_TIMEOUT_SECONDS)
            seal_listener_socket(endpoint, validated["services"])
        for role in SERVICE_ROLES:
            verify_service_process_binding(
                validated["paths"]["systemctl_path"], units[role], validated["services"][role]
            )
        runtime = runtime_services(core, binding, units, validated["services"])
        peer_configs = write_peer_configs(units, validated["services"], binding, runtime, endpoints)
        for role in SERVICE_ROLES:
            create_release_file(
                units[role]["paths"]["release"], units[role]["release_token"], validated["services"][role]["gid"]
            )
        snapshots, evidence_by_role = collect_release_acks(
            units,
            validated["services"],
            bootstraps,
            peer_configs,
            core,
            validated["paths"]["systemctl_path"],
        )
        if set(snapshots) != {"witness", "coordinator"}:
            fail("durable cohort did not publish both state availability snapshots")
        availability = core.create_availability_disclosure(
            binding, snapshots["witness"], snapshots["coordinator"]
        )
        probe_evidence = write_probe_evidence(
            validated["state_root"], binding, handoff["handoff_hash"], evidence_by_role
        )
        result = {
            # This host deliberately tears down the transient cohort before it
            # emits a result.  The disclosure is evidence of a verified
            # no-effect lifecycle, not a live endpoint lease for a caller.
            "status": "p36_durable_cohort_verified",
            "lifecycle": "teardown_verified",
            "schema_version": SCHEMA_VERSION,
            "cohort_id": cohort_id,
            "generation": generation,
            "install_binding_hash": config["binding_hash"],
            "run_binding_hash": run_binding_hash,
            "durable_binding_hash": core.normalized_binding_hash(binding),
            "p35_handoff_hash": handoff["handoff_hash"],
            "availability": availability,
            "fixed_probe_evidence_hash": probe_evidence["evidence_hash"],
            "owner_kernel_authority": "none",
            "effect_authority": "none",
            "broker_authority": "disabled",
            "acceptance": "not_available",
        }
        # Keep the normal lifecycle inside the same terminal critical section
        # as failure persistence.  Otherwise a TERM between this try body and
        # the finally callback can bypass teardown until a later admission.
        block_termination_signals("finish a verified durable cohort")
    except BaseException as error:
        block_termination_signals("persist a durable cohort failure")
        record_terminal_failure(str(error))
        if isinstance(error, KeyboardInterrupt):
            error = DurableHostError("durable cohort interrupted before completion")
        primary_error = error
    finally:
        if admission_descriptor is not None:
            try:
                release_admission_lock(admission_descriptor)
            except OSError as error:
                cleanup_errors.append("durable admission lock: " + str(error))
            admission_descriptor = None
        try:
            final_result = finalize_cohort()
        finally:
            restore_interrupt_handlers(previous_handlers)
            restore_termination_signal_mask(previous_signal_mask, "durable cohort")
    return final_result


def parser():
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    install_parser = commands.add_parser("install")
    install_parser.add_argument("--install-root", required=True)
    install_parser.add_argument("--state-root", required=True)
    install_parser.add_argument("--p35-handoff-root", required=True)
    install_parser.add_argument("--create-identities", action="store_true")
    install_parser.add_argument("--node-path")
    install_parser.set_defaults(handler=install)
    run_parser = commands.add_parser("run")
    run_parser.add_argument("--handoff-id", required=True)
    run_parser.set_defaults(handler=lambda args: emit(run_session(require_token(args.handoff_id, "handoff id"))))
    return root


def main():
    try:
        args = parser().parse_args()
        args.handler(args)
        return 0
    except DurableHostError as error:
        sys.stderr.write("supervised-production-substrate-durable-host: " + str(error) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
