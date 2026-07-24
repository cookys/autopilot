#!/usr/bin/env python3
"""P3.6 Phase 2 root-owned independent-service substrate.

``install`` is the only trust handoff: a root operator snapshots this host,
the role-local release runner, and the Phase 1 contract files into a new,
root-owned directory. ``run-probe`` accepts no caller input and executes only
that installed snapshot. It starts five independent, bounded transient units,
verifies their exact UID/GID/groups and unified cgroup-v2 placement, seals the
four fixed Unix listener roots, then releases one no-effect peer probe per
ABI-pinned route.

This is deliberately below P2 authority. It has no action, permit, effect,
acceptance, dispatcher, workspace, or production witness implementation.
"""

import argparse
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


SCHEMA_VERSION = 2
RUNTIME_PARENT = "/run/autopilot-production-substrate"
CONFIG_RELATIVE_PATH = "etc/supervised-production-substrate.json"
SERVICE_ROLES = ("worker", "broker", "receipt_verifier", "witness", "coordinator")
SERVICE_IDENTITIES = {
    "worker": "autopilot-p36-worker",
    "broker": "autopilot-p36-broker",
    "receipt_verifier": "autopilot-p36-receipt-verifier",
    "witness": "autopilot-p36-witness",
    "coordinator": "autopilot-p36-coordinator",
}
FILE_LAYOUT = {
    "host": "sbin/supervised-production-substrate-host.py",
    "service_runner": "lib/supervised-production-substrate-service.py",
    "peer_protocol": "lib/supervised_production_substrate_peer.py",
    "contract": "lib/supervised-production-substrate-contract.js",
    "bridge_contract": "lib/supervised-engine-bridge-contract.js",
    "canonical": "lib/owner-kernel/canonical.js",
    "errors": "lib/owner-kernel/errors.js",
    "actions": "lib/owner-kernel/actions.js",
    "policy": "lib/owner-kernel/policy.js",
}
FILE_MODES = {
    "host": 0o755,
    "service_runner": 0o755,
    "peer_protocol": 0o644,
    "contract": 0o644,
    "bridge_contract": 0o644,
    "canonical": 0o644,
    "errors": 0o644,
    "actions": 0o644,
    "policy": 0o644,
}
SNAPSHOT_SOURCE_LAYOUT = {
    "host": "supervised-production-substrate-host.py",
    "service_runner": "supervised-production-substrate-service.py",
    "peer_protocol": "supervised_production_substrate_peer.py",
    "contract": "supervised-production-substrate-contract.js",
    "bridge_contract": "supervised-engine-bridge-contract.js",
    "canonical": "owner-kernel/canonical.js",
    "errors": "owner-kernel/errors.js",
    "actions": "owner-kernel/actions.js",
    "policy": "owner-kernel/policy.js",
}
SYSTEM_PATHS = {
    "python_path": "/usr/bin/python3",
    "node_path": "/usr/bin/node",
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
    "RestrictNamespaces=yes",
    "RestrictSUIDSGID=yes",
    "CapabilityBoundingSet=",
    "CollectMode=inactive-or-failed",
    "RuntimeMaxSec=240s",
    "TimeoutStopSec=5s",
)
# P2b authenticates a peer's exact unified cgroup-v2 location through
# /proc/<pid>/cgroup before it reads that peer's frame. ProtectProc=invisible
# hides other UID process metadata and would make that proof impossible. The
# remaining namespace, capability, identity, cgroup, and sealed-socket guards
# stay mandatory; a later root-owned verifier may restore process hiding.
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
SHA256_CHARS = frozenset("0123456789abcdef")
# The host may spend up to 130 seconds in successful pre-release work under
# its explicit child-command bounds: five systemd-run calls (10s), five PID
# waits (5s), five ready-record waits (5s), four socket waits (5s), and five
# post-seal process checks (2s). Keep a bounded setup margin rather than
# letting a healthy early service hit its release deadline during that work.
ROLE_RELEASE_TIMEOUT_SECONDS = 150
ROLE_STARTUP_TIMEOUT_SECONDS = 5
# Every released service exchanges its fixed peers concurrently. One role can
# still need two bounded outbound probes, so give the host one shared deadline
# to collect all acknowledgements rather than serially spending this bound.
ROLE_ACK_TIMEOUT_SECONDS = 35
# The host revalidates an acknowledgement as soon as it observes it. Retain a
# margin beyond the maximum peer exchange so that a near-deadline publication
# cannot exit before that immediate process check completes.
ROLE_HOLD_SECONDS = 40
SYSTEMD_LAUNCH_TIMEOUT_SECONDS = 10
SYSTEMD_INSPECTION_TIMEOUT_SECONDS = 2
TERMINATION_SIGNALS = (signal.SIGINT, signal.SIGTERM)


class SubstrateHostError(Exception):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def sha256_value(value):
    if not isinstance(value, str):
        value = canonical(value)
    return sha256_bytes(value.encode("utf-8"))


def emit(value):
    sys.stdout.write(canonical(value) + "\n")
    sys.stdout.flush()


def require_root():
    if os.geteuid() != 0 or os.getegid() != 0:
        raise SubstrateHostError("P3.6 substrate host requires effective UID/GID 0")


def require_supported_host():
    if sys.platform != "linux" or not hasattr(signal, "pthread_sigmask"):
        raise SubstrateHostError("P3.6 substrate host requires Linux signal masking")
    try:
        with open("/sys/fs/cgroup/cgroup.controllers", "rb") as source:
            source.read(1)
        with open("/proc/self/cgroup", "r", encoding="utf-8") as source:
            cgroups = source.read(8192).splitlines()
    except OSError as error:
        raise SubstrateHostError("P3.6 substrate host requires readable unified cgroup-v2 state") from error
    if not any(line.startswith("0::") for line in cgroups):
        raise SubstrateHostError("P3.6 substrate host requires unified cgroup-v2 state")


def require_plain_object(value, label):
    if not isinstance(value, dict):
        raise SubstrateHostError(label + " must be an object")
    return value


def require_exact_keys(value, expected, label):
    value = require_plain_object(value, label)
    if set(value.keys()) != set(expected):
        raise SubstrateHostError(label + " has an unexpected key set")
    return value


def require_token(value, label):
    if not isinstance(value, str) or not value or len(value) > 128:
        raise SubstrateHostError(label + " must be a bounded protocol token")
    if any(character not in TOKEN_CHARS for character in value):
        raise SubstrateHostError(label + " must be a bounded protocol token")
    return value


def require_sha256(value, label):
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in SHA256_CHARS for character in value)
    ):
        raise SubstrateHostError(label + " must be a lowercase SHA-256 digest")
    return value


def require_nonroot_id(value, label):
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise SubstrateHostError(label + " must be a non-root integer")
    return value


def require_absolute_path(value, label):
    if not isinstance(value, str) or not value.startswith("/"):
        raise SubstrateHostError(label + " must be an absolute path")
    normalized = os.path.normpath(value)
    if normalized != value or value == "/":
        raise SubstrateHostError(label + " must be a canonical non-root path")
    return value


def path_components(absolute_path):
    components = ["/"]
    current = ""
    for part in absolute_path.split("/"):
        if part:
            current += "/" + part
            components.append(current)
    return components


def mode_is_private(info):
    return (info.st_mode & 0o022) == 0


def require_root_owned_path(path, label, directory=False, executable=False):
    path = require_absolute_path(path, label)
    try:
        resolved = os.path.realpath(path)
    except OSError as error:
        raise SubstrateHostError(label + " cannot be resolved: " + str(error)) from error
    if resolved != path:
        raise SubstrateHostError(label + " must not resolve through a symlink")
    for component in path_components(path):
        try:
            info = os.lstat(component)
        except OSError as error:
            raise SubstrateHostError(label + " has an unreadable ancestor: " + str(error)) from error
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or not mode_is_private(info):
            raise SubstrateHostError(label + " has an untrusted ancestor " + component)
    final_info = os.lstat(path)
    if directory and not stat.S_ISDIR(final_info.st_mode):
        raise SubstrateHostError(label + " must be a directory")
    if executable and (
        not stat.S_ISREG(final_info.st_mode) or (final_info.st_mode & 0o111) == 0
    ):
        raise SubstrateHostError(label + " must be an executable regular file")
    return path


def require_service_traversable_root_path(path, label, executable=False):
    path = require_root_owned_path(path, label, executable=executable)
    # Traversal is a property of the containing directories.  Requiring the
    # final regular file itself to carry the other-execute bit would reject
    # legitimate root-owned read-only modules (for example the peer protocol).
    for component in path_components(os.path.dirname(path)):
        info = os.lstat(component)
        if (info.st_mode & 0o001) == 0:
            raise SubstrateHostError(label + " is not traversable by a substrate service at " + component)
    return path


def resolve_root_executable(path, label):
    candidate = require_absolute_path(path, label)
    resolved = os.path.realpath(candidate)
    if resolved == "/" or not os.path.isabs(resolved):
        raise SubstrateHostError(label + " cannot be resolved")
    return require_root_owned_path(resolved, label, executable=True)


def file_digest(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while True:
            block = source.read(65536)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def write_all(descriptor, content):
    remaining = memoryview(content)
    while remaining:
        written = os.write(descriptor, remaining)
        if written <= 0:
            raise OSError("short write while creating a root-owned file")
        remaining = remaining[written:]


def create_directory(path, uid, gid, mode, label, on_created=None):
    try:
        os.mkdir(path, mode)
    except FileExistsError as error:
        raise SubstrateHostError(label + " already exists") from error
    if on_created is not None:
        on_created()
    os.chown(path, uid, gid)
    os.chmod(path, mode)


def copy_root_snapshot_file(source_path, destination_path, mode):
    try:
        source_info = os.lstat(source_path)
    except OSError as error:
        raise SubstrateHostError("installation source cannot be inspected: " + str(error)) from error
    if stat.S_ISLNK(source_info.st_mode) or not stat.S_ISREG(source_info.st_mode):
        raise SubstrateHostError("installation source must be a regular non-symlink file")
    source_descriptor = os.open(source_path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        destination_descriptor = os.open(
            destination_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            mode,
        )
    except OSError:
        os.close(source_descriptor)
        raise
    try:
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
        os.close(destination_descriptor)


def write_root_file(path, content, mode):
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        mode,
    )
    try:
        write_all(descriptor, content)
        os.fsync(descriptor)
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, mode)
    finally:
        os.close(descriptor)


def write_root_group_file(path, content, gid, mode, label):
    gid = require_nonroot_id(gid, label + " gid")
    write_root_file(path, content, mode)
    try:
        os.chown(path, 0, gid)
        os.chmod(path, mode)
        info = os.lstat(path)
    except OSError as error:
        raise SubstrateHostError(label + " cannot be finalized") from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != gid
        or (info.st_mode & 0o777) != mode
    ):
        raise SubstrateHostError(label + " does not retain the expected root-owned mode")


def write_root_group_json(path, value, gid, label):
    write_root_group_file(path, (canonical(value) + "\n").encode("utf-8"), gid, 0o440, label)


def cleanup_partial_install(install_root):
    errors = []
    relative_files = [CONFIG_RELATIVE_PATH] + list(FILE_LAYOUT.values())
    for relative in relative_files:
        path = os.path.join(install_root, relative)
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            continue
        except OSError as error:
            errors.append(relative + ": " + str(error))
            continue
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != 0:
            errors.append(relative + ": unexpected file during install cleanup")
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
            errors.append((relative or "install root") + ": unexpected directory during install cleanup")
            continue
        try:
            os.rmdir(path)
        except OSError as error:
            errors.append((relative or "install root") + ": " + str(error))
    return errors


def run_command(command, timeout_seconds=10):
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
        raise SubstrateHostError("bounded child command timed out") from error
    except OSError as error:
        raise SubstrateHostError("bounded child command cannot be started: " + str(error)) from error


def require_private_groups(account):
    try:
        memberships = os.getgrouplist(account.pw_name, account.pw_gid)
    except (AttributeError, OSError) as error:
        raise SubstrateHostError("service group membership cannot be resolved") from error
    if set(memberships) != {account.pw_gid}:
        raise SubstrateHostError("service must not have supplementary groups")


def identity_attestation(role, identity, uid, gid):
    return sha256_value(
        {
            "schema_version": SCHEMA_VERSION,
            "role": role,
            "identity": identity,
            "uid": uid,
            "gid": gid,
            "kind": "p36_root_pinned_service_identity",
        }
    )


def resolve_service_identity(role, create):
    if role not in SERVICE_IDENTITIES:
        raise SubstrateHostError("unknown P3.6 service role")
    identity = SERVICE_IDENTITIES[role]
    try:
        account = pwd.getpwnam(identity)
    except KeyError:
        if not create:
            raise SubstrateHostError(
                "dedicated " + identity + " account is absent; run install with --create-identities"
            )
        useradd_path = resolve_root_executable(SYSTEM_PATHS["useradd_path"], "useradd_path")
        result = run_command(
            [
                useradd_path,
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
            raise SubstrateHostError(
                "cannot create dedicated " + identity + " account: " + result.stderr.strip()
            )
        account = pwd.getpwnam(identity)
    uid = require_nonroot_id(account.pw_uid, identity + " uid")
    gid = require_nonroot_id(account.pw_gid, identity + " gid")
    if account.pw_shell != "/usr/sbin/nologin" or account.pw_dir != "/nonexistent":
        raise SubstrateHostError("dedicated " + identity + " account must be non-login")
    group = grp.getgrgid(gid)
    if group.gr_name != identity or group.gr_mem:
        raise SubstrateHostError("dedicated " + identity + " primary group is not private")
    require_private_groups(account)
    return {
        "role": role,
        "identity": identity,
        "uid": uid,
        "gid": gid,
        "attestation_hash": identity_attestation(role, identity, uid, gid),
    }


def resolve_service_identities(create):
    services = {role: resolve_service_identity(role, create) for role in SERVICE_ROLES}
    for field in ("identity", "uid", "gid", "attestation_hash"):
        values = [services[role][field] for role in SERVICE_ROLES]
        if len(set(values)) != len(values):
            raise SubstrateHostError("P3.6 service " + field + " values must remain independent")
    return services


def snapshot_sources(source_root):
    return {
        name: os.path.join(source_root, relative)
        for name, relative in SNAPSHOT_SOURCE_LAYOUT.items()
    }


def installed_contract_abi(node_path, contract_path):
    script = (
        "const contract = require(process.argv[1]);"
        "process.stdout.write(contract.getSupervisedProductionSubstrateAbiHash());"
    )
    result = run_command([node_path, "-e", script, contract_path], timeout_seconds=5)
    if result.returncode != 0:
        raise SubstrateHostError("installed P3.6 contract ABI cannot be loaded: " + result.stderr.strip())
    return require_sha256(result.stdout.strip(), "installed substrate ABI hash")


def load_peer_protocol(install_root):
    path = os.path.join(install_root, FILE_LAYOUT["peer_protocol"])
    require_root_owned_path(path, "installed P3.6 peer protocol")
    previous_dont_write_bytecode = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec = importlib.util.spec_from_file_location("p36_installed_peer_protocol", path)
        if spec is None or spec.loader is None:
            raise ImportError("cannot create module loader")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    except (ImportError, OSError, ValueError) as error:
        raise SubstrateHostError("installed P3.6 peer protocol cannot be loaded") from error
    finally:
        sys.dont_write_bytecode = previous_dont_write_bytecode
    required = (
        "SERVICE_IPC_ENDPOINTS",
        "create_runtime_service_claim",
        "require_endpoint",
        "runtime_service_claim",
        "sha256_value",
        "require_unix_socket_path",
        "PeerProtocolError",
    )
    if any(not hasattr(module, name) for name in required):
        raise SubstrateHostError("installed P3.6 peer protocol has an incomplete surface")
    return module


def installation_material(install_root, services, paths, files, substrate_abi_hash):
    return {
        "schema_version": SCHEMA_VERSION,
        "install_root": install_root,
        "runtime_parent": RUNTIME_PARENT,
        "services": services,
        "paths": paths,
        "files": files,
        "substrate_abi_hash": substrate_abi_hash,
        "systemd_properties": list(SYSTEMD_PROPERTIES),
        "owner_kernel_authority": "none",
        "effect_authority": "none",
        "acceptance": "not_available",
    }


def install_interrupt_handlers(handler):
    previous_handlers = {}
    try:
        for signal_number in TERMINATION_SIGNALS:
            previous_handlers[signal_number] = signal.signal(signal_number, handler)
    except (OSError, ValueError) as error:
        for signal_number, previous_handler in previous_handlers.items():
            signal.signal(signal_number, previous_handler)
        raise SubstrateHostError("cannot install P3.6 installation interruption handlers") from error
    return previous_handlers


def restore_interrupt_handlers(previous_handlers):
    for signal_number, previous_handler in previous_handlers.items():
        signal.signal(signal_number, previous_handler)


def with_termination_signals_blocked(callback, label):
    try:
        previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, set(TERMINATION_SIGNALS))
    except (AttributeError, OSError, ValueError) as error:
        raise SubstrateHostError("cannot safely " + label) from error
    try:
        return callback()
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)


def install(args):
    require_root()
    install_root = require_absolute_path(args.install_root, "install_root")
    if os.path.exists(install_root):
        raise SubstrateHostError("install_root already exists")
    created = {"install_root": False}
    previous_handlers = {}

    def interrupt_handler(_signum, _frame):
        raise SubstrateHostError("P3.6 installation interrupted before completion")

    try:
        previous_handlers = install_interrupt_handlers(interrupt_handler)
        services = resolve_service_identities(args.create_identities)
        require_root_owned_path(
            os.path.dirname(install_root), "existing install parent", directory=True
        )
        create_tracked_resource(
            created,
            "install_root",
            lambda on_created: create_directory(
                install_root, 0, 0, 0o755, "install root", on_created
            ),
        )
        for relative in ("sbin", "lib", "etc", "lib/owner-kernel"):
            create_directory(os.path.join(install_root, relative), 0, 0, 0o755, "install directory")

        source_root = os.path.dirname(os.path.realpath(__file__))
        sources = snapshot_sources(source_root)
        files = {}
        for name, relative in FILE_LAYOUT.items():
            destination = os.path.join(install_root, relative)
            copy_root_snapshot_file(sources[name], destination, FILE_MODES[name])
            require_root_owned_path(
                destination,
                name + " snapshot",
                executable=FILE_MODES[name] & 0o111 != 0,
            )
            files[name] = {"relative_path": relative, "sha256": file_digest(destination)}

        paths = {
            key: resolve_root_executable(value, key)
            for key, value in SYSTEM_PATHS.items()
            if key not in {"useradd_path", "node_path"}
        }
        node_candidate = args.node_path or SYSTEM_PATHS["node_path"]
        paths["node_path"] = resolve_root_executable(node_candidate, "node_path")
        substrate_abi_hash = installed_contract_abi(
            paths["node_path"], os.path.join(install_root, FILE_LAYOUT["contract"])
        )
        material = installation_material(install_root, services, paths, files, substrate_abi_hash)
        config = dict(material)
        config["binding_hash"] = sha256_value(material)
        config_path = os.path.join(install_root, CONFIG_RELATIVE_PATH)
        write_root_file(config_path, (canonical(config) + "\n").encode("utf-8"), 0o644)
        require_root_owned_path(config_path, "installed config")
        emit(
            {
                "status": "installed",
                "install_binding_hash": config["binding_hash"],
                "substrate_abi_hash": substrate_abi_hash,
                "service_roles": [
                    {
                        "role": role,
                        "identity": services[role]["identity"],
                        "uid": services[role]["uid"],
                        "gid": services[role]["gid"],
                        "attestation_hash": services[role]["attestation_hash"],
                    }
                    for role in SERVICE_ROLES
                ],
                "owner_kernel_authority": "none",
                "effect_authority": "none",
                "acceptance": "not_available",
            }
        )
    except BaseException as error:
        if created["install_root"]:
            cleanup_errors = with_termination_signals_blocked(
                lambda: cleanup_partial_install(install_root), "clean up a partial P3.6 installation"
            )
            if cleanup_errors:
                raise SubstrateHostError(
                    "P3.6 installation failed and cleanup was incomplete: " + "; ".join(cleanup_errors)
                ) from error
        if isinstance(error, KeyboardInterrupt):
            raise SubstrateHostError("P3.6 installation interrupted before completion") from error
        raise
    finally:
        restore_interrupt_handlers(previous_handlers)


def installed_root_from_self():
    host_path = os.path.realpath(__file__)
    root = os.path.dirname(os.path.dirname(host_path))
    expected = os.path.join(root, FILE_LAYOUT["host"])
    if host_path != expected:
        raise SubstrateHostError("installed P3.6 host must run from its fixed snapshot path")
    require_root_owned_path(root, "install root", directory=True)
    require_root_owned_path(host_path, "installed P3.6 host", executable=True)
    return root


def load_installed_config(install_root):
    config_path = os.path.join(install_root, CONFIG_RELATIVE_PATH)
    require_root_owned_path(config_path, "installed config")
    try:
        with open(config_path, "rb") as source:
            raw = source.read(65537)
    except OSError as error:
        raise SubstrateHostError("installed config cannot be read: " + str(error)) from error
    if not raw or len(raw) > 65536:
        raise SubstrateHostError("installed config has an invalid size")
    try:
        text = raw.decode("utf-8")
        config = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SubstrateHostError("installed config is invalid JSON") from error
    if canonical(config) + "\n" != text:
        raise SubstrateHostError("installed config is not canonical")
    require_exact_keys(
        config,
        {
            "schema_version",
            "install_root",
            "runtime_parent",
            "services",
            "paths",
            "files",
            "substrate_abi_hash",
            "systemd_properties",
            "owner_kernel_authority",
            "effect_authority",
            "acceptance",
            "binding_hash",
        },
        "installed config",
    )
    if config["schema_version"] != SCHEMA_VERSION:
        raise SubstrateHostError("installed config schema_version is unsupported")
    if config["install_root"] != install_root or config["runtime_parent"] != RUNTIME_PARENT:
        raise SubstrateHostError("installed config has an unexpected root path")
    require_sha256(config["binding_hash"], "installed config binding_hash")
    material = dict(config)
    material.pop("binding_hash")
    if sha256_value(material) != config["binding_hash"]:
        raise SubstrateHostError("installed config binding_hash does not match content")
    return config


def validate_installed_config(install_root, config):
    services = require_exact_keys(config["services"], set(SERVICE_ROLES), "installed services")
    validated_services = {}
    for role in SERVICE_ROLES:
        service = require_exact_keys(
            services[role],
            {"role", "identity", "uid", "gid", "attestation_hash"},
            "installed " + role + " service",
        )
        expected = resolve_service_identity(role, False)
        if service != expected:
            raise SubstrateHostError("installed " + role + " service no longer matches its private identity")
        validated_services[role] = expected
    for field in ("identity", "uid", "gid", "attestation_hash"):
        values = [validated_services[role][field] for role in SERVICE_ROLES]
        if len(set(values)) != len(values):
            raise SubstrateHostError("installed service " + field + " values are not independent")

    paths = require_exact_keys(
        config["paths"],
        {"python_path", "node_path", "systemd_run_path", "systemctl_path"},
        "installed paths",
    )
    files = require_exact_keys(config["files"], set(FILE_LAYOUT.keys()), "installed files")
    if config["systemd_properties"] != list(SYSTEMD_PROPERTIES):
        raise SubstrateHostError("installed systemd properties differ from the frozen host")
    if (
        config["owner_kernel_authority"] != "none"
        or config["effect_authority"] != "none"
        or config["acceptance"] != "not_available"
    ):
        raise SubstrateHostError("installed P3.6 host config has an invalid authority disclosure")
    for name, value in paths.items():
        paths[name] = require_root_owned_path(value, name, executable=True)
        if name in {"python_path", "node_path"}:
            require_service_traversable_root_path(paths[name], name, executable=True)
    for name, relative in FILE_LAYOUT.items():
        entry = require_exact_keys(files[name], {"relative_path", "sha256"}, name + " snapshot")
        if entry["relative_path"] != relative:
            raise SubstrateHostError(name + " snapshot relative path is unexpected")
        destination = os.path.join(install_root, relative)
        require_root_owned_path(
            destination,
            name + " snapshot",
            executable=FILE_MODES[name] & 0o111 != 0,
        )
        require_service_traversable_root_path(
            destination,
            name + " snapshot",
            executable=FILE_MODES[name] & 0o111 != 0,
        )
        if file_digest(destination) != require_sha256(entry["sha256"], name + " snapshot hash"):
            raise SubstrateHostError(name + " snapshot hash does not match installed file")
    contract_path = os.path.join(install_root, FILE_LAYOUT["contract"])
    actual_abi_hash = installed_contract_abi(paths["node_path"], contract_path)
    if actual_abi_hash != require_sha256(config["substrate_abi_hash"], "substrate_abi_hash"):
        raise SubstrateHostError("installed substrate ABI hash does not match its snapshot")
    return {
        "services": validated_services,
        "paths": paths,
        "files": files,
        "substrate_abi_hash": actual_abi_hash,
    }


def require_exact_directory(path, uid, gid, mode, label):
    info = os.lstat(path)
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o7777) != mode
    ):
        raise SubstrateHostError(label + " does not have the expected ownership and mode")


def require_exact_socket(path, uid, gid, mode, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise SubstrateHostError(label + " cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISSOCK(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o777) != mode
    ):
        raise SubstrateHostError(label + " does not have the expected ownership and mode")


def wait_for_listener_socket(endpoint_spec, timeout_seconds):
    endpoint = endpoint_spec["endpoint"]
    socket_root = endpoint_spec["socket_root"]
    socket_path = endpoint_spec["socket_path"]
    recipient = endpoint_spec["recipient"]
    sender = endpoint_spec["sender"]
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if os.path.lexists(socket_path):
            require_exact_directory(
                socket_root,
                recipient["uid"],
                sender["gid"],
                0o2710,
                endpoint["endpoint_id"] + " socket root before sealing",
            )
            require_exact_socket(
                socket_path,
                recipient["uid"],
                sender["gid"],
                0o660,
                endpoint["endpoint_id"] + " socket before sealing",
            )
            return
        time.sleep(0.025)
    raise SubstrateHostError(endpoint["endpoint_id"] + " listener did not appear before the deadline")


def require_exact_listener_directory_contents(descriptor, socket_path, label):
    try:
        entries = os.listdir(descriptor)
    except OSError as error:
        raise SubstrateHostError(label + " cannot be enumerated after sealing") from error
    if entries != [os.path.basename(socket_path)]:
        raise SubstrateHostError(label + " contains an unexpected entry after sealing")


def seal_listener_socket(endpoint_spec):
    endpoint = endpoint_spec["endpoint"]
    socket_root = endpoint_spec["socket_root"]
    socket_path = endpoint_spec["socket_path"]
    recipient = endpoint_spec["recipient"]
    sender = endpoint_spec["sender"]
    require_exact_directory(
        socket_root,
        recipient["uid"],
        sender["gid"],
        0o2710,
        endpoint["endpoint_id"] + " socket root before sealing",
    )
    try:
        descriptor = os.open(socket_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as error:
        raise SubstrateHostError(endpoint["endpoint_id"] + " socket root cannot be sealed") from error
    try:
        os.fchown(descriptor, 0, sender["gid"])
        os.fchmod(descriptor, 0o710)
        require_exact_listener_directory_contents(
            descriptor,
            socket_path,
            endpoint["endpoint_id"] + " sealed socket root",
        )
    except OSError as error:
        raise SubstrateHostError(endpoint["endpoint_id"] + " socket root cannot be sealed") from error
    finally:
        os.close(descriptor)
    require_exact_directory(
        socket_root,
        0,
        sender["gid"],
        0o710,
        endpoint["endpoint_id"] + " sealed socket root",
    )
    require_exact_socket(
        socket_path,
        recipient["uid"],
        sender["gid"],
        0o660,
        endpoint["endpoint_id"] + " sealed socket",
    )


def remove_directory_entries(descriptor, label):
    try:
        entries = os.listdir(descriptor)
    except OSError as error:
        raise SubstrateHostError(label + " cannot be enumerated during cleanup") from error
    for entry in entries:
        if not entry or entry in {".", ".."} or "/" in entry:
            raise SubstrateHostError(label + " contains an invalid cleanup entry")
        try:
            info = os.stat(entry, dir_fd=descriptor, follow_symlinks=False)
        except OSError as error:
            raise SubstrateHostError(label + " cannot inspect a cleanup entry") from error
        if stat.S_ISDIR(info.st_mode):
            try:
                child_descriptor = os.open(
                    entry,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=descriptor,
                )
            except OSError as error:
                raise SubstrateHostError(label + " cannot open a cleanup directory") from error
            try:
                remove_directory_entries(child_descriptor, label)
            finally:
                os.close(child_descriptor)
            try:
                os.rmdir(entry, dir_fd=descriptor)
            except OSError as error:
                raise SubstrateHostError(label + " cannot remove a cleanup directory") from error
        else:
            try:
                os.unlink(entry, dir_fd=descriptor)
            except OSError as error:
                raise SubstrateHostError(label + " cannot remove a cleanup entry") from error


def cleanup_endpoint_socket_root(endpoint_spec):
    endpoint = endpoint_spec["endpoint"]
    socket_root = endpoint_spec["socket_root"]
    sender = endpoint_spec["sender"]
    try:
        descriptor = os.open(socket_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return
    except OSError as error:
        raise SubstrateHostError(endpoint["endpoint_id"] + " socket root cannot be opened for cleanup") from error
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISDIR(info.st_mode):
            raise SubstrateHostError(endpoint["endpoint_id"] + " socket root is not a directory during cleanup")
        os.fchown(descriptor, 0, sender["gid"])
        os.fchmod(descriptor, 0o700)
        remove_directory_entries(descriptor, endpoint["endpoint_id"] + " socket root")
    except OSError as error:
        raise SubstrateHostError(endpoint["endpoint_id"] + " socket root cannot be cleaned") from error
    finally:
        os.close(descriptor)
    try:
        os.rmdir(socket_root)
    except OSError as error:
        raise SubstrateHostError(endpoint["endpoint_id"] + " socket root cannot be removed") from error


def ensure_runtime_parent(on_created=None):
    create_directory(RUNTIME_PARENT, 0, 0, 0o711, "runtime parent", on_created)
    require_exact_directory(RUNTIME_PARENT, 0, 0, 0o711, "runtime parent")
    return True


def cgroup_v2_matches(pid, expected_path):
    try:
        with open("/proc/{}/cgroup".format(pid), "r", encoding="utf-8") as source:
            lines = source.read(8192).splitlines()
    except OSError:
        return False
    return any(line == "0::" + expected_path for line in lines)


def process_identity_matches(pid, service):
    try:
        with open("/proc/{}/status".format(pid), "r", encoding="utf-8") as source:
            lines = source.read(16384).splitlines()
    except OSError:
        return False
    fields = {}
    for line in lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key] = value.split()
    try:
        uid_values = [int(value) for value in fields["Uid"]]
        gid_values = [int(value) for value in fields["Gid"]]
        groups = {int(value) for value in fields["Groups"]}
    except (KeyError, ValueError):
        return False
    return (
        uid_values == [service["uid"]] * 4
        and gid_values == [service["gid"]] * 4
        and groups == {service["gid"]}
    )


def wait_for_service_pid(systemctl_path, unit, cgroup_path, service, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    observed = ""
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        result = run_command(
            [systemctl_path, "show", "--property=MainPID", "--value", unit],
            timeout_seconds=min(SYSTEMD_INSPECTION_TIMEOUT_SECONDS, remaining),
        )
        if result.returncode == 0:
            observed = result.stdout.strip()
            if observed.isdigit() and int(observed) > 0:
                pid = int(observed)
                if cgroup_v2_matches(pid, cgroup_path) and process_identity_matches(pid, service):
                    return pid
        time.sleep(0.05)
    raise SubstrateHostError(
        "systemd service did not expose its exact identity and cgroup-v2 MainPID: " + observed
    )


def wait_for_load_state(systemctl_path, unit, wanted, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    observed = ""
    while time.monotonic() < deadline:
        result = run_command(
            [systemctl_path, "show", "--property=LoadState", "--value", unit],
            timeout_seconds=2,
        )
        if result.returncode == 0:
            observed = result.stdout.strip()
            if observed == wanted:
                return
        time.sleep(0.05)
    raise SubstrateHostError("systemd unit did not reach LoadState=" + wanted + ": " + observed)


def stop_and_collect_unit(systemctl_path, unit):
    errors = []
    for operation in ("stop", "reset-failed"):
        try:
            result = run_command([systemctl_path, operation, unit], timeout_seconds=5)
        except SubstrateHostError as error:
            errors.append(operation + " timed out: " + str(error))
            continue
        if result.returncode != 0:
            errors.append(operation + " exit=" + str(result.returncode))
    try:
        wait_for_load_state(systemctl_path, unit, "not-found", 5)
    except SubstrateHostError as error:
        detail = "; ".join(errors)
        if detail:
            detail += "; "
        raise SubstrateHostError("systemd cleanup did not collect the exact unit: " + detail + str(error)) from error


def create_tracked_resource(resources, key, creator):
    return with_termination_signals_blocked(
        lambda: creator(lambda: resources.__setitem__(key, True)),
        "create a tracked P3.6 runtime resource",
    )


def cleanup_path(path, expected_type):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return
    if expected_type == "file" and (stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode)):
        raise SubstrateHostError("cleanup refused unexpected file type at " + path)
    if expected_type == "dir" and (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)):
        raise SubstrateHostError("cleanup refused unexpected directory type at " + path)
    if expected_type == "socket" and (stat.S_ISLNK(info.st_mode) or not stat.S_ISSOCK(info.st_mode)):
        raise SubstrateHostError("cleanup refused unexpected socket type at " + path)
    if expected_type == "dir":
        os.rmdir(path)
    else:
        os.unlink(path)


def append_cleanup_error(errors, label, callback):
    try:
        callback()
    except (SubstrateHostError, OSError, subprocess.TimeoutExpired) as error:
        errors.append(label + ": " + str(error))


def create_release_file(path, token, service_gid):
    if os.path.lexists(path):
        raise SubstrateHostError("service release path already exists")
    temporary_path = path + ".pending-" + secrets.token_hex(16)
    descriptor = os.open(
        temporary_path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o400,
    )
    temporary_exists = True
    try:
        os.fchmod(descriptor, 0o400)
        write_all(descriptor, (token + "\n").encode("ascii"))
        os.fsync(descriptor)
        os.fchown(descriptor, 0, service_gid)
        os.fchmod(descriptor, 0o440)
        os.fsync(descriptor)
        os.link(temporary_path, path, follow_symlinks=False)
        os.unlink(temporary_path)
        temporary_exists = False
        directory_descriptor = os.open(
            os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        )
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        os.close(descriptor)
        if temporary_exists:
            try:
                info = os.lstat(temporary_path)
                if stat.S_ISREG(info.st_mode) and info.st_uid == 0:
                    os.unlink(temporary_path)
            except FileNotFoundError:
                pass


def service_unit_name(role):
    return "autopilot-p36-{}-{}.service".format(role.replace("_", "-"), secrets.token_hex(12))


def role_paths(runtime_root, role):
    role_root = os.path.join(runtime_root, role)
    return {
        "root": role_root,
        "release": os.path.join(role_root, "release"),
        "bootstrap": os.path.join(role_root, "bootstrap.json"),
        "peer_config": os.path.join(role_root, "peer.json"),
        "ack_root": os.path.join(role_root, "ack"),
        "ready": os.path.join(role_root, "ack", "listeners.json"),
        "ready_pending": os.path.join(role_root, "ack", "listeners.json.pending"),
        "ack": os.path.join(role_root, "ack", "release.json"),
        "ack_pending": os.path.join(role_root, "ack", "release.json.pending"),
    }


def endpoint_socket_paths(runtime_root, endpoint_id, peer_protocol):
    endpoint_id = require_token(endpoint_id, "endpoint_id")
    root = os.path.join(runtime_root, "i", endpoint_id)
    socket_path = os.path.join(root, "s")
    try:
        peer_protocol.require_unix_socket_path(socket_path, "P3.6 peer socket path")
    except peer_protocol.PeerProtocolError as error:
        raise SubstrateHostError(str(error)) from error
    return {"root": root, "socket": socket_path}


def endpoint_static_specs(runtime_root, peer_protocol, services):
    specs = []
    seen = set()
    for raw in peer_protocol.SERVICE_IPC_ENDPOINTS:
        endpoint = peer_protocol.require_endpoint(dict(raw), "P3.6 fixed IPC endpoint")
        endpoint_id = endpoint["endpoint_id"]
        if endpoint_id in seen:
            raise SubstrateHostError("P3.6 fixed IPC endpoint IDs must be unique")
        seen.add(endpoint_id)
        sender = services[endpoint["sender_role"]]
        recipient = services[endpoint["recipient_role"]]
        socket_paths = endpoint_socket_paths(runtime_root, endpoint_id, peer_protocol)
        specs.append(
            {
                "endpoint": endpoint,
                "socket_root": socket_paths["root"],
                "socket_path": socket_paths["socket"],
                "sender": {
                    "role": sender["role"],
                    "identity": sender["identity"],
                    "uid": sender["uid"],
                    "gid": sender["gid"],
                    "attestation_hash": sender["attestation_hash"],
                },
                "recipient": {
                    "role": recipient["role"],
                    "identity": recipient["identity"],
                    "uid": recipient["uid"],
                    "gid": recipient["gid"],
                    "attestation_hash": recipient["attestation_hash"],
                },
            }
        )
    if len(specs) != len(peer_protocol.SERVICE_IPC_ENDPOINTS):
        raise SubstrateHostError("P3.6 fixed IPC endpoint topology is incomplete")
    return specs


def service_writable_paths(role, unit, endpoint_specs):
    if role not in SERVICE_ROLES:
        raise SubstrateHostError("unknown P3.6 service role for writable path policy")
    paths = [unit["paths"]["ack_root"]] + [
        endpoint_spec["socket_root"]
        for endpoint_spec in endpoint_specs
        if endpoint_spec["endpoint"]["recipient_role"] == role
    ]
    if len(paths) != len(set(paths)):
        raise SubstrateHostError("P3.6 service writable path policy contains an alias")
    return tuple(paths)


def run_binding_material(config, validated, run_id, units, endpoint_specs):
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_phase2b_run_binding",
        "install_binding_hash": config["binding_hash"],
        "substrate_abi_hash": validated["substrate_abi_hash"],
        "run_id": run_id,
        "services": [
            {
                "role": role,
                "identity": validated["services"][role]["identity"],
                "uid": validated["services"][role]["uid"],
                "gid": validated["services"][role]["gid"],
                "attestation_hash": validated["services"][role]["attestation_hash"],
                "unit": units[role]["unit"],
                "cgroup_path": units[role]["cgroup_path"],
                "ack_root": units[role]["paths"]["ack_root"],
                "ready_path": units[role]["paths"]["ready"],
                "ack_path": units[role]["paths"]["ack"],
                "bootstrap_path": units[role]["paths"]["bootstrap"],
                "peer_config_path": units[role]["paths"]["peer_config"],
                "release_hash": sha256_value(units[role]["release_token"]),
            }
            for role in SERVICE_ROLES
        ],
        "endpoints": endpoint_specs,
    }


def service_bootstrap_material(config, validated, unit, role, run_binding_hash, endpoint_specs):
    service = validated["services"][role]
    endpoints = [
        spec
        for spec in endpoint_specs
        if role in {spec["endpoint"]["sender_role"], spec["endpoint"]["recipient_role"]}
    ]
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_phase2b_bootstrap",
        "role": role,
        "identity": service["identity"],
        "uid": service["uid"],
        "gid": service["gid"],
        "attestation_hash": service["attestation_hash"],
        "release_path": unit["paths"]["release"],
        "ack_path": unit["paths"]["ack"],
        "ready_path": unit["paths"]["ready"],
        "peer_config_path": unit["paths"]["peer_config"],
        "release_token": unit["release_token"],
        "install_binding_hash": config["binding_hash"],
        "run_binding_hash": run_binding_hash,
        "substrate_abi_hash": validated["substrate_abi_hash"],
        "release_timeout_seconds": ROLE_RELEASE_TIMEOUT_SECONDS,
        "hold_seconds": ROLE_HOLD_SECONDS,
        "endpoints": endpoints,
    }


def write_service_bootstrap(config, validated, unit, role, run_binding_hash, endpoint_specs):
    material = service_bootstrap_material(
        config, validated, unit, role, run_binding_hash, endpoint_specs
    )
    value = dict(material)
    value["bootstrap_hash"] = sha256_value(material)
    write_root_group_json(
        unit["paths"]["bootstrap"],
        value,
        validated["services"][role]["gid"],
        role + " peer bootstrap",
    )
    return value


def runtime_endpoint_specs(peer_protocol, endpoint_specs, units):
    values = []
    for spec in endpoint_specs:
        endpoint = spec["endpoint"]
        sender_role = endpoint["sender_role"]
        recipient_role = endpoint["recipient_role"]
        sender_unit = units[sender_role]
        recipient_unit = units[recipient_role]
        if sender_unit["pid"] is None or recipient_unit["pid"] is None:
            raise SubstrateHostError("P3.6 peer endpoint cannot be bound before both service PIDs exist")
        values.append(
            {
                "endpoint": endpoint,
                "socket_root": spec["socket_root"],
                "socket_path": spec["socket_path"],
                "sender": peer_protocol.create_runtime_service_claim(
                    spec["sender"], sender_unit["pid"], sender_unit["cgroup_path"]
                ),
                "recipient": peer_protocol.create_runtime_service_claim(
                    spec["recipient"], recipient_unit["pid"], recipient_unit["cgroup_path"]
                ),
            }
        )
    return values


def peer_config_material(config, validated, role, run_binding_hash, endpoint_specs):
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_phase2b_peer_config",
        "role": role,
        "install_binding_hash": config["binding_hash"],
        "run_binding_hash": run_binding_hash,
        "substrate_abi_hash": validated["substrate_abi_hash"],
        "endpoints": [
            spec
            for spec in endpoint_specs
            if role in {spec["endpoint"]["sender_role"], spec["endpoint"]["recipient_role"]}
        ],
    }


def write_peer_configs(config, validated, units, run_binding_hash, endpoint_specs):
    values = {}
    for role in SERVICE_ROLES:
        material = peer_config_material(
            config, validated, role, run_binding_hash, endpoint_specs
        )
        value = dict(material)
        value["peer_config_hash"] = sha256_value(material)
        write_root_group_json(
            units[role]["paths"]["peer_config"],
            value,
            validated["services"][role]["gid"],
            role + " peer config",
        )
        values[role] = value
    return values


def expected_ipc_receipts(role, endpoint_specs):
    expected = []
    for spec in endpoint_specs:
        endpoint = spec["endpoint"]
        if endpoint["sender_role"] == role:
            direction = "outbound"
            peer = spec["recipient"]
        elif endpoint["recipient_role"] == role:
            direction = "inbound"
            peer = spec["sender"]
        else:
            continue
        expected.append(
            {
                "direction": direction,
                "endpoint_id": endpoint["endpoint_id"],
                "route_operation": endpoint["route_operation"],
                "peer": peer,
            }
        )
    return expected


def public_runtime_claim(value):
    return {
        "role": value["role"],
        "identity": value["identity"],
        "uid": value["uid"],
        "gid": value["gid"],
        "attestation_hash": value["attestation_hash"],
        "pid": value["pid"],
        "cgroup_binding_hash": value["cgroup_binding_hash"],
    }


def validate_ipc_receipts(value, expected):
    if not isinstance(value, list) or len(value) != len(expected):
        raise SubstrateHostError("service peer receipt count does not match its fixed topology")
    receipts = []
    for index, item in enumerate(value):
        expected_item = expected[index]
        item = require_exact_keys(
            item,
            {
                "direction",
                "endpoint_id",
                "route_operation",
                "peer",
                "request_hash",
                "response_hash",
                "receipt_hash",
            },
            "service peer receipt",
        )
        material = dict(item)
        receipt_hash = material.pop("receipt_hash")
        peer = require_exact_keys(
            item["peer"],
            {
                "role",
                "identity",
                "uid",
                "gid",
                "attestation_hash",
                "pid",
                "cgroup_binding_hash",
            },
            "service peer receipt peer",
        )
        expected_peer = public_runtime_claim(expected_item["peer"])
        if (
            item["direction"] != expected_item["direction"]
            or item["endpoint_id"] != expected_item["endpoint_id"]
            or item["route_operation"] != expected_item["route_operation"]
            or peer != expected_peer
            or sha256_value(material)
            != require_sha256(receipt_hash, "service peer receipt receipt_hash")
            or not isinstance(item["request_hash"], str)
            or not isinstance(item["response_hash"], str)
        ):
            raise SubstrateHostError("service peer receipt does not match the frozen endpoint")
        require_sha256(item["request_hash"], "service peer receipt request_hash")
        require_sha256(item["response_hash"], "service peer receipt response_hash")
        receipts.append(item)
    return receipts


def verify_cross_peer_receipts(acknowledgements, endpoint_specs):
    by_role = {role: acknowledgement["ipc_receipts"] for role, acknowledgement in acknowledgements.items()}
    for spec in endpoint_specs:
        endpoint = spec["endpoint"]
        endpoint_id = endpoint["endpoint_id"]
        sender_role = endpoint["sender_role"]
        recipient_role = endpoint["recipient_role"]
        outbound = [
            item
            for item in by_role[sender_role]
            if item["direction"] == "outbound" and item["endpoint_id"] == endpoint_id
        ]
        inbound = [
            item
            for item in by_role[recipient_role]
            if item["direction"] == "inbound" and item["endpoint_id"] == endpoint_id
        ]
        if (
            len(outbound) != 1
            or len(inbound) != 1
            or outbound[0]["request_hash"] != inbound[0]["request_hash"]
            or outbound[0]["response_hash"] != inbound[0]["response_hash"]
        ):
            raise SubstrateHostError("service peer receipts do not pair across the fixed endpoint")


def read_service_owned_json(path, service, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise SubstrateHostError(label + " is unavailable: " + str(error)) from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != service["uid"]
        or info.st_gid != service["gid"]
        or (info.st_mode & 0o777) != 0o600
    ):
        raise SubstrateHostError(label + " has an unexpected identity or mode")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise SubstrateHostError(label + " cannot be opened safely") from error
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != service["uid"]
            or opened.st_gid != service["gid"]
            or (opened.st_mode & 0o777) != 0o600
        ):
            raise SubstrateHostError(label + " changed while opening")
        raw = os.read(descriptor, 8193)
    finally:
        os.close(descriptor)
    if not raw or len(raw) > 8192:
        raise SubstrateHostError(label + " has an invalid size")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SubstrateHostError(label + " is invalid JSON") from error
    if canonical(value) + "\n" != text:
        raise SubstrateHostError(label + " is not canonical")
    return value


def read_listener_ready(
    path,
    service,
    install_binding_hash,
    run_binding_hash,
    substrate_abi_hash,
    expected_pid,
    expected_listener_endpoint_ids,
):
    value = read_service_owned_json(path, service, "service listener readiness")
    require_exact_keys(
        value,
        {
            "schema_version",
            "kind",
            "status",
            "role",
            "pid",
            "uid",
            "gid",
            "install_binding_hash",
            "run_binding_hash",
            "substrate_abi_hash",
            "listener_endpoint_ids",
            "ready_hash",
        },
        "service listener readiness",
    )
    material = dict(value)
    ready_hash = material.pop("ready_hash")
    if (
        not isinstance(value["schema_version"], int)
        or isinstance(value["schema_version"], bool)
        or value["schema_version"] != SCHEMA_VERSION
        or value["kind"] != "p36_phase2_listener_ready"
        or value["status"] != "fixed_listeners_ready"
        or value["role"] != service["role"]
        or value["uid"] != service["uid"]
        or value["gid"] != service["gid"]
        or not isinstance(value["pid"], int)
        or isinstance(value["pid"], bool)
        or value["pid"] < 1
        or value["pid"] != expected_pid
        or value["install_binding_hash"] != install_binding_hash
        or value["run_binding_hash"] != run_binding_hash
        or value["substrate_abi_hash"] != substrate_abi_hash
        or value["listener_endpoint_ids"] != expected_listener_endpoint_ids
        or sha256_value(material)
        != require_sha256(ready_hash, "service listener readiness ready_hash")
    ):
        raise SubstrateHostError("service listener readiness does not match the frozen run")
    return value


def wait_for_listener_ready(
    path,
    service,
    install_binding_hash,
    run_binding_hash,
    substrate_abi_hash,
    expected_pid,
    expected_listener_endpoint_ids,
):
    deadline = time.monotonic() + ROLE_STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if os.path.exists(path):
            return read_listener_ready(
                path,
                service,
                install_binding_hash,
                run_binding_hash,
                substrate_abi_hash,
                expected_pid,
                expected_listener_endpoint_ids,
            )
        time.sleep(0.025)
    raise SubstrateHostError("service did not publish listener readiness before the deadline")


def read_release_ack(
    path,
    service,
    install_binding_hash,
    run_binding_hash,
    substrate_abi_hash,
    expected_receipts,
):
    value = read_service_owned_json(path, service, "service release acknowledgement")
    require_exact_keys(
        value,
        {
            "schema_version",
            "kind",
            "status",
            "role",
            "pid",
            "uid",
            "gid",
            "install_binding_hash",
            "run_binding_hash",
            "substrate_abi_hash",
            "release_hash",
            "ipc_receipts",
            "ack_hash",
        },
        "service release acknowledgement",
    )
    material = dict(value)
    ack_hash = material.pop("ack_hash")
    if (
        not isinstance(value["schema_version"], int)
        or isinstance(value["schema_version"], bool)
        or value["schema_version"] != SCHEMA_VERSION
        or value["kind"] != "p36_phase2_release_ack"
        or value["status"] != "released_peer_authenticated_no_effect"
        or value["role"] != service["role"]
        or value["uid"] != service["uid"]
        or value["gid"] != service["gid"]
        or not isinstance(value["pid"], int)
        or isinstance(value["pid"], bool)
        or value["pid"] < 1
        or value["install_binding_hash"] != install_binding_hash
        or value["run_binding_hash"] != run_binding_hash
        or value["substrate_abi_hash"] != substrate_abi_hash
        or sha256_value(material) != require_sha256(ack_hash, "service acknowledgement ack_hash")
    ):
        raise SubstrateHostError("service release acknowledgement does not match the frozen run")
    require_sha256(value["release_hash"], "service acknowledgement release_hash")
    value["ipc_receipts"] = validate_ipc_receipts(value["ipc_receipts"], expected_receipts)
    return value


def verify_service_process_binding(systemctl_path, unit, cgroup_path, service, expected_pid):
    result = run_command(
        [systemctl_path, "show", "--property=MainPID", "--value", unit],
        timeout_seconds=SYSTEMD_INSPECTION_TIMEOUT_SECONDS,
    )
    observed = result.stdout.strip() if result.returncode == 0 else ""
    if not observed.isdigit() or int(observed) != expected_pid:
        raise SubstrateHostError("service no longer matches systemd MainPID")
    if not cgroup_v2_matches(expected_pid, cgroup_path):
        raise SubstrateHostError("service PID no longer matches its cgroup-v2 binding")
    if not process_identity_matches(expected_pid, service):
        raise SubstrateHostError("service PID no longer matches its private identity")


def verify_ack_service_process(systemctl_path, unit, cgroup_path, service, acknowledged_pid):
    try:
        verify_service_process_binding(
            systemctl_path, unit, cgroup_path, service, acknowledged_pid
        )
    except SubstrateHostError as error:
        raise SubstrateHostError("service acknowledgement " + str(error)) from error


def collect_release_acks(
    units,
    services,
    expected_receipts,
    install_binding_hash,
    run_binding_hash,
    substrate_abi_hash,
    systemctl_path,
):
    pending = set(SERVICE_ROLES)
    acknowledgements = {}
    deadline = time.monotonic() + ROLE_ACK_TIMEOUT_SECONDS
    while pending:
        for role in SERVICE_ROLES:
            if role not in pending:
                continue
            if time.monotonic() >= deadline:
                raise SubstrateHostError(
                    "services did not acknowledge their no-effect release before the deadline"
                )
            service = services[role]
            unit = units[role]
            if not os.path.exists(unit["paths"]["ack"]):
                continue
            acknowledgement = read_release_ack(
                unit["paths"]["ack"],
                service,
                install_binding_hash,
                run_binding_hash,
                substrate_abi_hash,
                expected_receipts[role],
            )
            if acknowledgement["pid"] != unit["pid"]:
                raise SubstrateHostError("service acknowledgement PID does not match systemd MainPID")
            if acknowledgement["release_hash"] != sha256_value(unit["release_token"]):
                raise SubstrateHostError("service acknowledgement does not bind its release token")
            verify_ack_service_process(
                systemctl_path,
                unit["unit"],
                unit["cgroup_path"],
                service,
                acknowledgement["pid"],
            )
            if time.monotonic() >= deadline:
                raise SubstrateHostError(
                    "services did not acknowledge their no-effect release before the deadline"
                )
            acknowledgements[role] = acknowledgement
            pending.remove(role)
        if pending:
            if time.monotonic() >= deadline:
                raise SubstrateHostError("services did not acknowledge their no-effect release before the deadline")
            time.sleep(0.025)
    return acknowledgements


def run_probe():
    require_root()
    install_root = installed_root_from_self()
    config = load_installed_config(install_root)
    validated = validate_installed_config(install_root, config)
    peer_protocol = load_peer_protocol(install_root)
    require_supported_host()

    run_id = "p36-" + secrets.token_hex(12)
    runtime_root = os.path.join(RUNTIME_PARENT, run_id)
    runner_path = os.path.join(install_root, FILE_LAYOUT["service_runner"])
    resources = {"parent": False, "runtime_root": False, "ipc_root": False}
    units = {}
    endpoint_specs = []
    releases = {role: False for role in SERVICE_ROLES}
    readiness_may_exist = {role: False for role in SERVICE_ROLES}
    acknowledgements = {role: False for role in SERVICE_ROLES}
    acknowledgement_values = {}
    acknowledgements_may_exist = {role: False for role in SERVICE_ROLES}
    previous_handlers = {}

    def interrupt_handler(_signum, _frame):
        raise SubstrateHostError("P3.6 substrate probe interrupted before completion")

    for signal_number in TERMINATION_SIGNALS:
        previous_handlers[signal_number] = signal.signal(signal_number, interrupt_handler)

    try:
        create_tracked_resource(resources, "parent", ensure_runtime_parent)
        create_tracked_resource(
            resources,
            "runtime_root",
            lambda on_created: create_directory(
                runtime_root, 0, 0, 0o711, "runtime root", on_created
            ),
        )
        for role in SERVICE_ROLES:
            service = validated["services"][role]
            paths = role_paths(runtime_root, role)
            resources[role + "_root"] = False
            resources[role + "_ack_root"] = False
            resources[role + "_bootstrap_may_exist"] = False
            resources[role + "_peer_config_may_exist"] = False
            create_tracked_resource(
                resources,
                role + "_root",
                lambda on_created, paths=paths, service=service, role=role: create_directory(
                    paths["root"],
                    0,
                    service["gid"],
                    0o710,
                    role + " runtime root",
                    on_created,
                ),
            )
            create_tracked_resource(
                resources,
                role + "_ack_root",
                lambda on_created, paths=paths, service=service, role=role: create_directory(
                    paths["ack_root"],
                    service["uid"],
                    service["gid"],
                    0o700,
                    role + " acknowledgement root",
                    on_created,
                ),
            )
            unit = service_unit_name(role)
            units[role] = {
                "unit": unit,
                "cgroup_path": "/system.slice/" + unit,
                "paths": paths,
                "may_exist": False,
                "pid": None,
                "release_token": secrets.token_urlsafe(24).rstrip("="),
            }

        endpoint_specs = endpoint_static_specs(
            runtime_root, peer_protocol, validated["services"]
        )
        ipc_root = os.path.join(runtime_root, "i")
        create_tracked_resource(
            resources,
            "ipc_root",
            lambda on_created: create_directory(
                ipc_root, 0, 0, 0o711, "P3.6 peer IPC root", on_created
            ),
        )
        for endpoint_spec in endpoint_specs:
            endpoint = endpoint_spec["endpoint"]
            endpoint_id = endpoint["endpoint_id"]
            recipient = endpoint_spec["recipient"]
            sender = endpoint_spec["sender"]
            resources["endpoint_" + endpoint_id + "_root"] = False
            resources["endpoint_" + endpoint_id + "_socket_may_exist"] = True
            create_tracked_resource(
                resources,
                "endpoint_" + endpoint_id + "_root",
                lambda on_created, endpoint_spec=endpoint_spec, recipient=recipient, sender=sender, endpoint_id=endpoint_id: create_directory(
                    endpoint_spec["socket_root"],
                    recipient["uid"],
                    sender["gid"],
                    0o2710,
                    endpoint_id + " peer socket root",
                    on_created,
                ),
            )

        run_material = run_binding_material(
            config, validated, run_id, units, endpoint_specs
        )
        run_binding_hash = sha256_value(run_material)
        for role in SERVICE_ROLES:
            unit = units[role]
            resources[role + "_bootstrap_may_exist"] = True
            write_service_bootstrap(
                config, validated, unit, role, run_binding_hash, endpoint_specs
            )
        for role in SERVICE_ROLES:
            service = validated["services"][role]
            unit = units[role]
            command = [
                validated["paths"]["python_path"],
                "-I",
                runner_path,
                "--bootstrap-config",
                unit["paths"]["bootstrap"],
            ]
            writable_paths = service_writable_paths(role, unit, endpoint_specs)
            systemd_command = [
                validated["paths"]["systemd_run_path"],
                "--no-block",
                "--quiet",
                "--collect",
                "--unit=" + unit["unit"],
                "--slice=system.slice",
                "--uid=" + str(service["uid"]),
                "--gid=" + str(service["gid"]),
            ] + ["--property=" + property for property in SYSTEMD_PROPERTIES] + [
                "--property=ReadWritePaths=" + " ".join(writable_paths)
            ] + command
            # Treat a timeout or lost response as a possibly created unit before
            # invoking systemd-run, so cleanup never assumes launch ambiguity away.
            unit["may_exist"] = True
            readiness_may_exist[role] = True
            started = run_command(systemd_command, timeout_seconds=SYSTEMD_LAUNCH_TIMEOUT_SECONDS)
            if started.returncode != 0:
                raise SubstrateHostError(
                    "systemd " + role + " launch failed: " + started.stderr.strip()
                )
            unit["pid"] = wait_for_service_pid(
                validated["paths"]["systemctl_path"],
                unit["unit"],
                unit["cgroup_path"],
                service,
                ROLE_STARTUP_TIMEOUT_SECONDS,
            )

        for role in SERVICE_ROLES:
            unit = units[role]
            listener_endpoint_ids = [
                spec["endpoint"]["endpoint_id"]
                for spec in endpoint_specs
                if spec["endpoint"]["recipient_role"] == role
            ]
            wait_for_listener_ready(
                unit["paths"]["ready"],
                validated["services"][role],
                config["binding_hash"],
                run_binding_hash,
                validated["substrate_abi_hash"],
                unit["pid"],
                listener_endpoint_ids,
            )
        for endpoint_spec in endpoint_specs:
            wait_for_listener_socket(endpoint_spec, ROLE_STARTUP_TIMEOUT_SECONDS)
        for endpoint_spec in endpoint_specs:
            seal_listener_socket(endpoint_spec)
        for role in SERVICE_ROLES:
            unit = units[role]
            verify_service_process_binding(
                validated["paths"]["systemctl_path"],
                unit["unit"],
                unit["cgroup_path"],
                validated["services"][role],
                unit["pid"],
            )
        endpoint_runtime = runtime_endpoint_specs(peer_protocol, endpoint_specs, units)
        for role in SERVICE_ROLES:
            resources[role + "_peer_config_may_exist"] = True
        write_peer_configs(
            config, validated, units, run_binding_hash, endpoint_runtime
        )
        expected_receipts = {
            role: expected_ipc_receipts(role, endpoint_runtime) for role in SERVICE_ROLES
        }

        for role in SERVICE_ROLES:
            service = validated["services"][role]
            unit = units[role]
            acknowledgements_may_exist[role] = True
            releases[role] = True
            create_release_file(unit["paths"]["release"], unit["release_token"], service["gid"])

        acknowledgement_values = collect_release_acks(
            units,
            validated["services"],
            expected_receipts,
            config["binding_hash"],
            run_binding_hash,
            validated["substrate_abi_hash"],
            validated["paths"]["systemctl_path"],
        )
        receipts = {}
        for role in SERVICE_ROLES:
            service = validated["services"][role]
            unit = units[role]
            acknowledgement = acknowledgement_values[role]
            acknowledgements[role] = True
            receipts[role] = {
                "role": role,
                "identity": service["identity"],
                "uid": service["uid"],
                "gid": service["gid"],
                "pid": unit["pid"],
                "attestation_hash": service["attestation_hash"],
                "cgroup_binding_hash": sha256_value(unit["cgroup_path"]),
                "status": acknowledgement["status"],
                "ipc_peer_proof": "peer_authenticated_no_effect",
                "ipc_receipt_count": len(acknowledgement["ipc_receipts"]),
            }
        verify_cross_peer_receipts(acknowledgement_values, endpoint_runtime)
        return {
            "status": "p36_phase2b_peer_probe_complete",
            "schema_version": SCHEMA_VERSION,
            "run_binding_hash": run_binding_hash,
            "install_binding_hash": config["binding_hash"],
            "substrate_abi_hash": validated["substrate_abi_hash"],
            "services": [receipts[role] for role in SERVICE_ROLES],
            "owner_kernel_authority": "none",
            "effect_authority": "none",
            "acceptance": "not_available",
        }
    finally:
        cleanup_errors = []
        handlers_restored = [False]

        def cleanup_sequence():
            try:
                for role in reversed(SERVICE_ROLES):
                    unit = units.get(role)
                    if unit and unit["may_exist"]:
                        append_cleanup_error(
                            cleanup_errors,
                            role + " systemd unit",
                            lambda unit=unit: stop_and_collect_unit(
                                validated["paths"]["systemctl_path"], unit["unit"]
                            ),
                        )
                for role in reversed(SERVICE_ROLES):
                    unit = units.get(role)
                    if not unit:
                        continue
                    if acknowledgements_may_exist[role]:
                        append_cleanup_error(
                            cleanup_errors,
                            role + " acknowledgement",
                            lambda unit=unit: cleanup_path(unit["paths"]["ack"], "file"),
                        )
                        append_cleanup_error(
                            cleanup_errors,
                            role + " pending acknowledgement",
                            lambda unit=unit: cleanup_path(unit["paths"]["ack_pending"], "file"),
                        )
                    if readiness_may_exist[role]:
                        append_cleanup_error(
                            cleanup_errors,
                            role + " listener readiness",
                            lambda unit=unit: cleanup_path(unit["paths"]["ready"], "file"),
                        )
                        append_cleanup_error(
                            cleanup_errors,
                            role + " pending listener readiness",
                            lambda unit=unit: cleanup_path(unit["paths"]["ready_pending"], "file"),
                        )
                    if releases[role]:
                        append_cleanup_error(
                            cleanup_errors,
                            role + " release",
                            lambda unit=unit: cleanup_path(unit["paths"]["release"], "file"),
                        )
                    if resources.get(role + "_peer_config_may_exist"):
                        append_cleanup_error(
                            cleanup_errors,
                            role + " peer config",
                            lambda unit=unit: cleanup_path(unit["paths"]["peer_config"], "file"),
                        )
                    if resources.get(role + "_bootstrap_may_exist"):
                        append_cleanup_error(
                            cleanup_errors,
                            role + " peer bootstrap",
                            lambda unit=unit: cleanup_path(unit["paths"]["bootstrap"], "file"),
                        )
                    if resources.get(role + "_ack_root"):
                        append_cleanup_error(
                            cleanup_errors,
                            role + " acknowledgement root",
                            lambda unit=unit: cleanup_path(unit["paths"]["ack_root"], "dir"),
                        )
                    if resources.get(role + "_root"):
                        append_cleanup_error(
                            cleanup_errors,
                            role + " runtime root",
                            lambda unit=unit: cleanup_path(unit["paths"]["root"], "dir"),
                        )
                for endpoint_spec in reversed(endpoint_specs):
                    endpoint = endpoint_spec["endpoint"]
                    endpoint_id = endpoint["endpoint_id"]
                    if resources.get("endpoint_" + endpoint_id + "_root"):
                        append_cleanup_error(
                            cleanup_errors,
                            endpoint_id + " peer socket root",
                            lambda endpoint_spec=endpoint_spec: cleanup_endpoint_socket_root(
                                endpoint_spec
                            ),
                        )
                if resources.get("ipc_root"):
                    append_cleanup_error(
                        cleanup_errors,
                        "peer IPC root",
                        lambda: cleanup_path(ipc_root, "dir"),
                    )
                if resources.get("runtime_root"):
                    append_cleanup_error(
                        cleanup_errors,
                        "runtime root",
                        lambda: cleanup_path(runtime_root, "dir"),
                    )
                if resources.get("parent"):
                    append_cleanup_error(
                        cleanup_errors,
                        "runtime parent",
                        lambda: cleanup_path(RUNTIME_PARENT, "dir"),
                    )
            finally:
                handlers_restored[0] = True
                restore_interrupt_handlers(previous_handlers)

        try:
            with_termination_signals_blocked(
                cleanup_sequence, "complete P3.6 substrate cleanup"
            )
        finally:
            if not handlers_restored[0]:
                restore_interrupt_handlers(previous_handlers)
        if cleanup_errors:
            raise SubstrateHostError("P3.6 substrate cleanup failed: " + "; ".join(cleanup_errors))


def parser():
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    install_parser = commands.add_parser("install")
    install_parser.add_argument("--install-root", required=True)
    install_parser.add_argument("--create-identities", action="store_true")
    install_parser.add_argument("--node-path")
    install_parser.set_defaults(handler=install)
    probe_parser = commands.add_parser("run-probe")
    probe_parser.set_defaults(handler=lambda _args: emit(run_probe()))
    return root


def main():
    try:
        args = parser().parse_args()
        args.handler(args)
        return 0
    except SubstrateHostError as error:
        sys.stderr.write("supervised-production-substrate-host: " + str(error) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
