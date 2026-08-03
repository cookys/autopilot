#!/usr/bin/env python3
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
import pwd
import grp
import secrets
import signal
import socket
import stat
import subprocess
import sys
import time
SCHEMA_VERSION = 1
RUNTIME_PARENT = "/run/autopilot-production-installed"
TRUSTED_RECOVERY_PARENT = "/run/autopilot-production-installed-recovery"
CONFIG_RELATIVE_PATH = "etc/supervised-owner-kernel-installed.json"
SERVICE_ROLES = (
    "kernel", "worker", "broker", "receipt_verifier", "witness", "coordinator",)
SERVICE_IDENTITIES = {
    "kernel": "autopilot-p37i-kernel", "worker": "autopilot-p37i-worker",
    "broker": "autopilot-p37i-broker", "receipt_verifier": "autopilot-p37i-receipt-verifier",
    "witness": "autopilot-p37i-witness", "coordinator": "autopilot-p37i-coordinator",}
FROZEN_SERVICE_UNITS = tuple(
    "autopilot-p37i-" + role.replace("_", "-") + ".service" for role in SERVICE_ROLES)
SERVICE_UNIT_BY_ROLE = {
    role: "autopilot-p37i-" + role.replace("_", "-") + ".service" for role in SERVICE_ROLES}
FILE_LAYOUT = {
    "host": "sbin/supervised-owner-kernel-installed-host.py", "service": "lib/supervised-owner-kernel-installed-service.py",
    "transport": "lib/supervised_owner_kernel_installed_transport.py", "core": "lib/supervised_owner_kernel_installed.py",
    "contract": "lib/supervised-owner-kernel-installed-contract.js", "ipc": "lib/supervised-owner-kernel-installed-ipc.js",
    "runner": "lib/supervised-owner-kernel-installed-runner.js", "canonical": "lib/owner-kernel/canonical.js",
    "errors": "lib/owner-kernel/errors.js", "probe_effect": "lib/supervised-owner-kernel-probe-effect.js",
    "node_runtime": "sbin/node",}
SNAPSHOT_SOURCE_LAYOUT = {
    "host": "supervised-owner-kernel-installed-host.py", "service": "supervised-owner-kernel-installed-service.py",
    "transport": "supervised_owner_kernel_installed_transport.py", "core": "supervised_owner_kernel_installed.py",
    "contract": "supervised-owner-kernel-installed-contract.js", "ipc": "supervised-owner-kernel-installed-ipc.js",
    "runner": "supervised-owner-kernel-installed-runner.js", "canonical": "owner-kernel/canonical.js",
    "errors": "owner-kernel/errors.js", "probe_effect": "supervised-owner-kernel-probe-effect.js",}
FILE_MODES = {
    "host": 0o755, "service": 0o755,
    "transport": 0o644, "core": 0o644,
    "contract": 0o644, "ipc": 0o644,
    "runner": 0o644, "canonical": 0o644,
    "errors": 0o644, "probe_effect": 0o644,
    "node_runtime": 0o755,}
SYSTEM_PATHS = {
    "python_path": "/usr/bin/python3", "node_path": "/usr/bin/node",
    "systemd_run_path": "/usr/bin/systemd-run", "systemctl_path": "/usr/bin/systemctl",
    "useradd_path": "/usr/sbin/useradd", "userdel_path": "/usr/sbin/userdel",
    "groupdel_path": "/usr/sbin/groupdel",}
ROLE_RUNTIME_MAX_SECONDS = 300
SYSTEMD_PROPERTIES = (
    "NoNewPrivileges=yes", "PrivateNetwork=yes", "PrivateTmp=yes",
    "ProtectSystem=strict", "ProtectHome=tmpfs", "RestrictNamespaces=yes",
    "RestrictSUIDSGID=yes", "CapabilityBoundingSet=",
    "CollectMode=inactive-or-failed",
    "RuntimeMaxSec=" + str(ROLE_RUNTIME_MAX_SECONDS) + "s", "TimeoutStopSec=5s",)
ROLE_START_TIMEOUT_SECONDS = 8
ROLE_RELEASE_TIMEOUT_SECONDS = 250
ROLE_ACK_TIMEOUT_SECONDS = 30
ROLE_QUIESCE_TIMEOUT_SECONDS = 10
ROLE_HOLD_SECONDS = 45
SYSTEMD_COMMAND_TIMEOUT_SECONDS = 10
ROLE_RELEASE_SAFETY_MARGIN_SECONDS = 10
ROLE_ACK_SAFETY_MARGIN_SECONDS = 3
TERMINATION_SIGNALS = (signal.SIGINT, signal.SIGTERM)
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-")
SHA256_CHARS = frozenset("0123456789abcdef")
class InstalledHostError(Exception):
    pass
def fail(message):
    raise InstalledHostError(message)
def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
def sha256_value(value):
    if not isinstance(value, str):
        value = canonical(value)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
def emit(value):
    sys.stdout.write(canonical(value) + "\n")
    sys.stdout.flush()
def require_root():
    if os.geteuid() != 0 or os.getegid() != 0:
        fail("P3.7 installed host requires effective UID/GID 0")
def require_supported_host():
    if sys.platform != "linux" or not hasattr(signal, "pthread_sigmask"):
        fail("P3.7 installed host requires Linux signal masking")
    try:
        with open("/sys/fs/cgroup/cgroup.controllers", "rb") as source:
            source.read(1)
        with open("/proc/self/cgroup", "r", encoding="utf-8") as source:
            values = source.read(8192).splitlines()
    except OSError as error:
        raise InstalledHostError("P3.7 installed host requires readable cgroup-v2 state") from error
    if not any(value.startswith("0::") for value in values):
        fail("P3.7 installed host requires unified cgroup-v2 state")
def require_lifecycle_timing_budget():
    setup_bound = (
        len(SERVICE_ROLES) * (SYSTEMD_COMMAND_TIMEOUT_SECONDS + ROLE_START_TIMEOUT_SECONDS)
        + len(SERVICE_ROLES) * (ROLE_START_TIMEOUT_SECONDS + min(ROLE_START_TIMEOUT_SECONDS, 2))
        + len(SERVICE_ROLES) * ROLE_START_TIMEOUT_SECONDS
        + len(SERVICE_ROLES) * min(ROLE_START_TIMEOUT_SECONDS, 2))
    if ROLE_RELEASE_TIMEOUT_SECONDS <= setup_bound + ROLE_RELEASE_SAFETY_MARGIN_SECONDS:
        fail("installed release timeout cannot cover the worst-case pre-release setup")
    if ROLE_RELEASE_TIMEOUT_SECONDS + ROLE_HOLD_SECONDS > ROLE_RUNTIME_MAX_SECONDS:
        fail("installed service runtime cap cannot cover release and hold windows")
    if (
        ROLE_ACK_TIMEOUT_SECONDS
        + ROLE_QUIESCE_TIMEOUT_SECONDS
        + ROLE_ACK_SAFETY_MARGIN_SECONDS
        > ROLE_HOLD_SECONDS
    ):
        fail("installed acknowledgement/quiescence deadlines lack a service hold safety margin")
    return setup_bound
def require_token(value, label):
    if not isinstance(value, str) or not value or len(value) > 128:
        fail(label + " is invalid")
    if any(character not in TOKEN_CHARS for character in value):
        fail(label + " is invalid")
    return value
def require_sha256(value, label):
    if not isinstance(value, str) or len(value) != 64:
        fail(label + " must be a lowercase SHA-256 digest")
    if any(character not in SHA256_CHARS for character in value):
        fail(label + " must be a lowercase SHA-256 digest")
    return value
def require_absolute_path(value, label):
    if not isinstance(value, str) or not value.startswith("/") or value != os.path.normpath(value):
        fail(label + " must be a canonical absolute path")
    return value
def path_components(path):
    current = require_absolute_path(path, "path")
    parts = [current]
    while os.path.dirname(current) != current:
        current = os.path.dirname(current)
        parts.append(current)
    parts.reverse()
    return parts
def require_trusted_directory(path, label):
    path = require_absolute_path(path, label)
    try:
        info = os.lstat(path)
    except OSError as error:
        raise InstalledHostError(label + " cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != 0 or info.st_gid != 0 or (info.st_mode & 0o022) != 0
    ):
        fail(label + " must be a root-owned nonsymlink directory not group/world writable")
    return path
def establish_trusted_recovery_parent():
    # root:root 0711 — traverse for dedicated service UIDs without list/mutate.
    require_trusted_directory("/run", "trusted recovery grandparent")
    parent = TRUSTED_RECOVERY_PARENT
    mode = 0o711
    if not os.path.lexists(parent):
        try:
            os.mkdir(parent, mode)
            os.chown(parent, 0, 0)
            os.chmod(parent, mode)
            fsync_directory("/run")
        except FileExistsError:
            pass
        except OSError as error:
            raise InstalledHostError("cannot establish trusted recovery parent: " + str(error)) from error
    # Reject symlink / non-root / group-world-writable before any mode repair.
    require_trusted_directory(parent, "trusted recovery parent")
    try:
        info = os.lstat(parent)
        if (info.st_mode & 0o7777) != mode:
            os.chmod(parent, mode)
            fsync_directory("/run")
    except OSError as error:
        raise InstalledHostError(
            "cannot revalidate trusted recovery parent mode: " + str(error)
        ) from error
    require_exact_directory(parent, 0, 0, mode, "trusted recovery parent")
    return parent
def pin_and_prepare_state_root(requested):
    requested = require_absolute_path(requested, "state_root")
    parent = TRUSTED_RECOVERY_PARENT
    if requested != parent and not requested.startswith(parent + os.sep):
        fail("state_root must be pinned under the fixed trusted recovery parent")
    establish_trusted_recovery_parent()
    for component in path_components(requested):
        if component == "/":
            continue
        if os.path.lexists(component):
            require_trusted_directory(component, "state ancestor " + component)
            continue
        if not component.startswith(parent + os.sep):
            fail("missing state ancestor is outside the trusted recovery parent: " + component)
        try:
            os.mkdir(component, 0o711)
            os.chown(component, 0, 0)
            os.chmod(component, 0o711)
            fsync_directory(os.path.dirname(component))
        except OSError as error:
            raise InstalledHostError("cannot create pinned state path " + component + ": " + str(error)) from error
        require_trusted_directory(component, "pinned state path " + component)
    return revalidate_pinned_state_root(requested)
def revalidate_pinned_state_root(state_root):
    state_root = require_absolute_path(state_root, "state_root")
    parent = TRUSTED_RECOVERY_PARENT
    if state_root != parent and not state_root.startswith(parent + os.sep):
        fail("state_root must remain pinned under the fixed trusted recovery parent")
    for component in path_components(state_root):
        if component != "/":
            require_trusted_directory(component, "revalidated state ancestor " + component)
    return state_root
def persist_install_recovery(recovery):
    recovery_parent = establish_trusted_recovery_parent()
    recovery_path = os.path.join(
        recovery_parent, "p37-installed-install-recovery-" + secrets.token_hex(8) + ".json")
    write_root_file(recovery_path, (canonical(recovery) + "\n").encode("utf-8"), 0o600)
    fsync_directory(recovery_parent)
    recovery["recovery_path"] = recovery_path
    return recovery_path
def require_root_owned_path(path, label, directory=False, executable=False):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise InstalledHostError(label + " cannot be inspected: " + str(error)) from error
    if stat.S_ISLNK(info.st_mode):
        fail(label + " must not be a symlink")
    if directory and not stat.S_ISDIR(info.st_mode):
        fail(label + " must be a directory")
    if not directory and not stat.S_ISREG(info.st_mode):
        fail(label + " must be a regular file")
    if info.st_uid != 0 or info.st_gid != 0:
        fail(label + " must be root-owned")
    if executable and (info.st_mode & 0o111) == 0:
        fail(label + " must be executable")
    return path
def resolve_root_executable(path, label):
    candidate = require_absolute_path(path, label)
    try:
        resolved = os.path.realpath(candidate)
    except OSError as error:
        raise InstalledHostError(label + " cannot be resolved: " + str(error)) from error
    if not os.path.isabs(resolved) or resolved == "/":
        fail(label + " cannot be resolved")
    return require_root_owned_path(resolved, label, executable=True)
def resolve_trusted_node_runtime():
    expected = SYSTEM_PATHS["node_path"]
    if expected != "/usr/bin/node":
        fail("trusted node runtime path is misconfigured")
    source_path = require_absolute_path(expected, "trusted node runtime")
    try:
        resolved = os.path.realpath(source_path)
        info = os.lstat(resolved)
    except OSError as error:
        raise InstalledHostError("trusted node runtime cannot be inspected: " + str(error)) from error
    if (
        not os.path.isabs(resolved)
        or resolved == "/"
        or stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or (info.st_mode & 0o111) == 0
        or info.st_uid != 0
        or info.st_gid != 0
        or (info.st_mode & 0o022) != 0
    ):
        fail(
            "trusted node runtime must be a root-owned regular executable "
            "not writable by group/other at fixed path " + expected)
    if os.path.basename(resolved) != "node" and os.path.basename(source_path) != "node":
        fail("trusted node runtime identity must be node")
    return resolved
def file_digest(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()
def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
def create_directory(path, uid, gid, mode, label, on_created=None):
    try:
        os.mkdir(path, mode)
    except FileExistsError:
        pass
    else:
        if on_created is not None:
            on_created()
    os.chown(path, uid, gid)
    os.chmod(path, mode)
    require_exact_directory(path, uid, gid, mode, label)
def ensure_directory(path, uid, gid, mode, label):
    if not os.path.lexists(path):
        create_directory(path, uid, gid, mode, label)
        return True
    require_exact_directory(path, uid, gid, mode, label)
    return False
def require_exact_directory(path, uid, gid, mode, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise InstalledHostError(label + " cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o7777) != mode
    ):
        fail(label + " does not have the expected ownership and mode")
def write_root_file(path, content, mode, gid=0, allow_existing=False):
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW
    flags |= 0 if allow_existing else os.O_EXCL
    descriptor = None
    created = False
    try:
        if not allow_existing and os.path.lexists(path):
            fail("root file already exists: " + path)
        descriptor = os.open(path, flags, mode)
        created = True
        total = 0
        while total < len(content):
            written = os.write(descriptor, content[total:])
            if written <= 0:
                fail("cannot write root file: " + path)
            total += written
        os.fchown(descriptor, 0, gid)
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    except OSError as error:
        raise InstalledHostError("cannot write root file " + path + ": " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
    return created
def write_root_group_json(path, value, gid, label):
    write_root_file(path, (canonical(value) + "\n").encode("utf-8"), 0o440, gid=gid)
    return value
def copy_root_snapshot_file(source, destination, mode):
    require_root_owned_path(os.path.dirname(destination) if os.path.dirname(destination) else "/", "snapshot parent", directory=True)
    with open(source, "rb") as handle:
        content = handle.read()
    write_root_file(destination, content, mode)
    return file_digest(destination)
def run_command(command, timeout_seconds=SYSTEMD_COMMAND_TIMEOUT_SECONDS):
    try:
        return subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,)
    except subprocess.TimeoutExpired as error:
        raise InstalledHostError("command timed out: " + " ".join(command)) from error
def identity_attestation(role, identity, uid, gid):
    return sha256_value(
        {
            "role": role,
            "identity": identity,
            "uid": uid,
            "gid": gid,
            "kind": "p37_installed_identity_attestation",})
def _identity_user_exists(identity):
    try:
        pwd.getpwnam(identity)
        return True
    except KeyError:
        return False
def _identity_group_exists(identity):
    try:
        grp.getgrnam(identity)
        return True
    except KeyError:
        return False
def preflight_dedicated_identities_absent():
    present = [
        SERVICE_IDENTITIES[role] for role in SERVICE_ROLES
        if _identity_user_exists(SERVICE_IDENTITIES[role])
        or _identity_group_exists(SERVICE_IDENTITIES[role])]
    if present:
        fail("pre-existing dedicated identity is forbidden: " + ", ".join(present)
             + "; all six user/group names must be absent before creation")
def require_private_service_account(role, create, created_identities=None):
    identity = SERVICE_IDENTITIES[role]
    user_exists = _identity_user_exists(identity)
    group_exists = _identity_group_exists(identity)
    created = False
    if user_exists or group_exists:
        if create:
            fail("pre-existing dedicated identity is forbidden: " + identity)
        if not user_exists or not group_exists:
            fail("dedicated " + identity + " user/group pair is incomplete")
        passwd = pwd.getpwnam(identity)
        group = grp.getgrnam(identity)
    else:
        if not create:
            fail("dedicated " + identity + " account is absent; run install with --create-identities")
        result = run_command(
            [
                SYSTEM_PATHS["useradd_path"],
                "--system",
                "--user-group",
                "--no-create-home",
                "--shell",
                "/usr/sbin/nologin",
                identity,])
        if result.returncode != 0:
            fail("cannot create installed identity " + identity + ": " + result.stderr.strip())
        passwd = pwd.getpwnam(identity)
        group = grp.getgrnam(identity)
        if not _identity_user_exists(identity) or not _identity_group_exists(identity):
            fail("installed identity " + identity + " was not confirmed after creation")
        created = True
        # Confirmed-prefix window: record before private-group/nonzero-ID validation.
        if created_identities is not None:
            created_identities.append(identity)
    if passwd.pw_gid != group.gr_gid:
        fail("installed identity " + identity + " must own a private primary group")
    if passwd.pw_uid < 1 or group.gr_gid < 1:
        fail("installed identity " + identity + " must not use uid/gid 0")
    return (
        {
            "role": role,
            "identity": identity,
            "uid": passwd.pw_uid,
            "gid": group.gr_gid,
            "attestation_hash": identity_attestation(role, identity, passwd.pw_uid, group.gr_gid),
        },
        created,)
def resolve_services(create, created_identities=None):
    # Caller-owned accumulator is filled inside require_private_service_account at
    # confirmation time so validation failures still expose the confirmed prefix.
    services = {}
    if created_identities is None:
        created_identities = []
    if create:
        preflight_dedicated_identities_absent()
    for role in SERVICE_ROLES:
        service, _created = require_private_service_account(
            role, create, created_identities)
        services[role] = service
    uids = [service["uid"] for service in services.values()]
    gids = [service["gid"] for service in services.values()]
    identities = [service["identity"] for service in services.values()]
    if len(set(uids)) != len(uids) or len(set(gids)) != len(gids) or len(set(identities)) != len(identities):
        fail("installed service uid/gid/identity values must remain independent")
    return services, created_identities
def _safe_identity_exists(checker, identity, errors, item, label):
    try:
        return bool(checker(identity))
    except Exception as error:
        errors.append(label + " lookup failed " + identity + ": " + str(error))
        item[label + "_lookup_error"] = str(error)
        return True
def _safe_delete_identity(command_path, identity, still_check, errors, item, kind):
    try:
        result = run_command([command_path, identity])
        item[kind + "_returncode"] = int(result.returncode)
        item[kind + "_stderr"] = (result.stderr or "").strip()
        if result.returncode == 0:
            return True
        if not _safe_identity_exists(still_check, identity, errors, item, kind):
            return True
        errors.append("cannot delete dedicated " + kind + " " + identity)
        return False
    except Exception as error:
        errors.append(kind + " failed " + identity + ": " + str(error))
        item[kind + "_error"] = str(error)
        return False
def remove_created_identities(created_identities, paths=None):
    errors = []
    evidence = []
    path_map = paths or SYSTEM_PATHS
    userdel_path = path_map.get("userdel_path", "/usr/sbin/userdel")
    groupdel_path = path_map.get("groupdel_path", "/usr/sbin/groupdel")
    for identity in list(created_identities or []):
        item = {"identity": identity, "user_removed": False, "group_removed": False, "absent": False}
        try:
            if _safe_identity_exists(_identity_user_exists, identity, errors, item, "user"):
                item["user_removed"] = _safe_delete_identity(
                    userdel_path, identity, _identity_user_exists, errors, item, "userdel")
            else:
                item["user_removed"] = True
            if _safe_identity_exists(_identity_group_exists, identity, errors, item, "group"):
                item["group_removed"] = _safe_delete_identity(
                    groupdel_path, identity, _identity_group_exists, errors, item, "groupdel")
            else:
                item["group_removed"] = True
            still_user = _safe_identity_exists(_identity_user_exists, identity, errors, item, "user")
            still_group = _safe_identity_exists(_identity_group_exists, identity, errors, item, "group")
            if still_user or still_group:
                errors.append("dedicated identity still present after cleanup: " + identity)
                item["absent"] = False
            else:
                item["absent"] = True
        except Exception as error:
            errors.append("identity cleanup failed " + identity + ": " + str(error))
            item["error"] = str(error)
            item["absent"] = False
        evidence.append(item)
    return errors, evidence
def snapshot_sources(source_root):
    sources = {}
    for key, relative in SNAPSHOT_SOURCE_LAYOUT.items():
        path = os.path.join(source_root, relative)
        if not os.path.isfile(path):
            fail("snapshot source is missing: " + relative)
        sources[key] = path
    return sources
def installed_contract_abi(node_path, contract_path):
    script = (
        "const c=require(" + json.dumps(contract_path) + ");"
        "process.stdout.write(c.getSupervisedOwnerKernelInstalledAbiHash());")
    result = run_command([node_path, "-e", script], timeout_seconds=15)
    if result.returncode != 0:
        fail("installed contract ABI cannot be loaded: " + result.stderr.strip())
    return require_sha256(result.stdout.strip(), "installed contract ABI hash")
SNAPSHOT_IMPORT_NAMES = {
    "core": "supervised_owner_kernel_installed",
    "transport": "supervised_owner_kernel_installed_transport",}
def load_snapshot_module(install_root, file_key, module_name):
    path = os.path.join(install_root, FILE_LAYOUT[file_key])
    require_root_owned_path(path, "installed " + file_key + " snapshot")
    lib_dir = os.path.join(install_root, "lib")
    if lib_dir not in sys.path:
        sys.path.insert(0, lib_dir)
    import_name = SNAPSHOT_IMPORT_NAMES.get(file_key, module_name)
    existing = sys.modules.get(import_name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(import_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[import_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception as error:  # pragma: no cover
        sys.modules.pop(import_name, None)
        raise InstalledHostError(
            "installed " + file_key + " snapshot cannot be loaded: " + str(error)
        ) from error
    return module
def installation_material(
    install_root,
    state_root,
    handoff_root,
    services,
    paths,
    files,
    installed_abi_hash,
    created_identities=None,
):
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p37_installed_host_config",
        "install_root": install_root,
        "state_root": state_root,
        "p35_handoff_root": handoff_root,
        "binding_hash": sha256_value(
            {
                "install_root": install_root,
                "state_root": state_root,
                "services": services,
                "files": files,
                "installed_abi_hash": installed_abi_hash,}
        ),
        "installed_abi_hash": installed_abi_hash,
        "services": services,
        "paths": paths,
        "files": files,
        "created_identities": list(created_identities or []),
        "authority": {
            "owner_kernel_authority": "active",
            "effect_authority": "reversible_probe_only",
            "broker_authority": "probe_only",
            "acceptance": "not_available",
            "engine_sink": "disabled",
            "acceptance_transaction": "disabled",
        },
        "fixed_probe_catalog_id": "owner-kernel-probe-toggle-v1",}
def cleanup_partial_install(install_root):
    if not install_root.startswith("/"):
        return
    if not os.path.lexists(install_root):
        return
    for root, dirs, files in os.walk(install_root, topdown=False):
        for name in files:
            try:
                os.unlink(os.path.join(root, name))
            except OSError:
                pass
        for name in dirs:
            try:
                os.rmdir(os.path.join(root, name))
            except OSError:
                pass
    try:
        os.rmdir(install_root)
    except OSError:
        pass
def install(args):
    require_root()
    require_supported_host()
    require_lifecycle_timing_budget()
    install_root = require_absolute_path(args.install_root, "install_root")
    requested_state_root = require_absolute_path(args.state_root, "state_root")
    handoff_root = require_absolute_path(args.p35_handoff_root, "p35_handoff_root")
    if os.path.lexists(install_root):
        fail("install_root already exists")
    if getattr(args, "node_path", None) is not None:
        fail("caller-controlled --node-path is forbidden; installed ABI uses fixed trusted Node only")
    source_root = os.path.dirname(os.path.realpath(__file__))
    sources = snapshot_sources(source_root)
    node_source = resolve_trusted_node_runtime()
    python_path = resolve_root_executable(SYSTEM_PATHS["python_path"], "python path")
    if not bool(args.create_identities):
        fail("installation must create all six dedicated identities (--create-identities required)")
    # Fixed trusted recovery parent before any identity creation.
    establish_trusted_recovery_parent()
    state_root = pin_and_prepare_state_root(requested_state_root)
    preflight_dedicated_identities_absent()
    services = {}
    created_identities = []
    install_root_created = False
    try:
        services, _ = resolve_services(True, created_identities)
        if len(created_identities) != len(SERVICE_ROLES):
            fail("installation must create and track all six dedicated identities for deletion")
        parent = os.path.dirname(install_root)
        require_root_owned_path(parent, "install parent", directory=True)
        def mark_created():
            nonlocal install_root_created
            install_root_created = True
        create_directory(install_root, 0, 0, 0o755, "installed install root", on_created=mark_created)
        for relative in ("sbin", "lib", "lib/owner-kernel", "etc"):
            create_directory(os.path.join(install_root, relative), 0, 0, 0o755, "installed " + relative)
        files = {}
        for key, source in sources.items():
            destination = os.path.join(install_root, FILE_LAYOUT[key])
            parent_dir = os.path.dirname(destination)
            if not os.path.isdir(parent_dir):
                create_directory(parent_dir, 0, 0, 0o755, "installed snapshot parent")
            files[key] = {
                "path": FILE_LAYOUT[key],
                "sha256": copy_root_snapshot_file(source, destination, FILE_MODES[key]),
                "mode": FILE_MODES[key],}
        node_destination = os.path.join(install_root, FILE_LAYOUT["node_runtime"])
        files["node_runtime"] = {
            "path": FILE_LAYOUT["node_runtime"],
            "sha256": copy_root_snapshot_file(node_source, node_destination, FILE_MODES["node_runtime"]),
            "mode": FILE_MODES["node_runtime"],}
        node_path = require_root_owned_path(node_destination, "installed node runtime", executable=True)
        node_info = os.lstat(node_path)
        if (node_info.st_mode & 0o022) != 0 or node_info.st_uid != 0 or node_info.st_gid != 0:
            fail("installed node runtime must remain root-owned and not writable by group/other")
        installed_abi_hash = installed_contract_abi(
            node_path, os.path.join(install_root, FILE_LAYOUT["contract"]))
        state_root = revalidate_pinned_state_root(state_root)
        require_root_owned_path(handoff_root, "P3.5 durable handoff root", directory=True)
        paths = dict(SYSTEM_PATHS)
        paths["node_path"] = node_path
        paths["python_path"] = python_path
        config = installation_material(
            install_root,
            state_root,
            handoff_root,
            services,
            paths,
            files,
            installed_abi_hash,
            created_identities=created_identities,)
        write_root_file(
            os.path.join(install_root, CONFIG_RELATIVE_PATH),
            (canonical(config) + "\n").encode("utf-8"),
            0o600,)
        emit(
            {
                "schema_version": SCHEMA_VERSION,
                "kind": "p37_installed_install_result",
                "status": "installed",
                "install_root": install_root,
                "state_root": state_root,
                "binding_hash": config["binding_hash"],
                "installed_abi_hash": installed_abi_hash,
                "snapshot_hash": sha256_value(files),
                "service_roles": list(SERVICE_ROLES),
                "service_identities": [services[role]["identity"] for role in SERVICE_ROLES],
                "created_identities": list(created_identities),
                "authority": config["authority"],
                "fixed_probe_catalog_id": config["fixed_probe_catalog_id"],})
    except BaseException as error:
        if install_root_created:
            cleanup_partial_install(install_root)
        recovery = {
            "schema_version": SCHEMA_VERSION,
            "kind": "p37_installed_install_recovery",
            "created_identities": list(created_identities),
            "error": str(error) if str(error) else error.__class__.__name__,}
        if created_identities:
            id_errors, id_evidence = remove_created_identities(created_identities)
            recovery["identity_cleanup_errors"] = list(id_errors)
            recovery["identity_cleanup_evidence"] = list(id_evidence)
        # Fail visibly: never condition on parent preexistence or swallow write errors.
        try:
            persist_install_recovery(recovery)
        except Exception as recovery_error:
            recovery["recovery_persist_error"] = str(recovery_error)
            try:
                sys.stderr.write(canonical(recovery) + "\n")
                sys.stderr.flush()
            except Exception:
                pass
            raise InstalledHostError(
                "install recovery persistence failed: " + str(recovery_error)
            ) from recovery_error
        try:
            sys.stderr.write(canonical(recovery) + "\n")
            sys.stderr.flush()
        except Exception:
            pass
        raise
def installed_root_from_self():
    self_path = os.path.realpath(__file__)
    marker = os.path.sep + FILE_LAYOUT["host"].replace("/", os.path.sep)
    if not self_path.endswith(marker):
        fail("host is not running from an installed snapshot")
    return self_path[: -len(marker)]
def load_installed_config(install_root):
    path = os.path.join(install_root, CONFIG_RELATIVE_PATH)
    require_root_owned_path(path, "installed config")
    with open(path, "rb") as source:
        raw = source.read()
    if not raw.endswith(b"\n"):
        fail("installed config is not newline-terminated")
    text = raw.decode("utf-8")
    value = json.loads(text[:-1])
    if canonical(value) + "\n" != text:
        fail("installed config is not canonical")
    return value
def validate_installed_config(install_root, config):
    if config.get("schema_version") != SCHEMA_VERSION or config.get("kind") != "p37_installed_host_config":
        fail("installed config schema/kind is unsupported")
    if config.get("install_root") != install_root:
        fail("installed config install_root drifted")
    if config.get("authority", {}).get("engine_sink") != "disabled":
        fail("installed config must keep engine sink disabled")
    if config.get("authority", {}).get("acceptance") != "not_available":
        fail("installed config must keep acceptance unavailable")
    if config.get("fixed_probe_catalog_id") != "owner-kernel-probe-toggle-v1":
        fail("installed config must freeze the probe catalog id")
    services = config["services"]
    if set(services) != set(SERVICE_ROLES):
        fail("installed config service topology is invalid")
    for role in SERVICE_ROLES:
        service = services[role]
        if service["identity"] != SERVICE_IDENTITIES[role]:
            fail("installed config identity for " + role + " is not the dedicated Kernel cohort identity")
    for key, meta in config["files"].items():
        path = os.path.join(install_root, meta["path"])
        require_root_owned_path(
            path,
            "installed snapshot " + key,
            executable=key in ("host", "service", "node_runtime"),)
        if file_digest(path) != meta["sha256"]:
            fail("installed snapshot file hash drifted: " + key)
    paths = config["paths"]
    expected_node = os.path.join(install_root, FILE_LAYOUT["node_runtime"])
    if paths.get("node_path") != expected_node:
        fail("installed config node_path must pin the snapshotted runtime")
    require_root_owned_path(paths["node_path"], "installed node path", executable=True)
    if "node_runtime" not in config["files"]:
        fail("installed config must hash-pin the node runtime snapshot")
    return {
        "services": services,
        "paths": paths,
        "installed_abi_hash": config["installed_abi_hash"],
        "state_root": config["state_root"],
        "handoff_root": config["p35_handoff_root"],
        "binding_hash": config["binding_hash"],
        "authority": config["authority"],}
def ensure_runtime_parent():
    created = False
    if not os.path.lexists(RUNTIME_PARENT):
        parent = os.path.dirname(RUNTIME_PARENT)
        require_root_owned_path(parent, "installed runtime parent ancestor", directory=True)
        if ensure_directory(RUNTIME_PARENT, 0, 0, 0o711, "installed runtime parent"):
            fsync_directory(parent)
            created = True
    require_exact_directory(RUNTIME_PARENT, 0, 0, 0o711, "installed runtime parent")
    return created
def cleanup_runtime_parent_if_created(runtime_parent_created):
    errors = []
    evidence = []
    if not runtime_parent_created:
        return errors, evidence
    try:
        if not os.path.lexists(RUNTIME_PARENT):
            evidence.append({"path": RUNTIME_PARENT, "removed": True, "absent": True})
            return errors, evidence
        remaining = list(os.listdir(RUNTIME_PARENT))
        if remaining:
            errors.append(
                "runtime parent still has entries after cleanup: " + ",".join(remaining))
            evidence.append(
                {
                    "path": RUNTIME_PARENT,
                    "removed": False,
                    "remaining": remaining,
                    "absent": False,})
            return errors, evidence
        os.rmdir(RUNTIME_PARENT)
        if os.path.lexists(RUNTIME_PARENT):
            errors.append("runtime parent still present after removal")
            evidence.append({"path": RUNTIME_PARENT, "removed": False, "absent": False})
        else:
            evidence.append({"path": RUNTIME_PARENT, "removed": True, "absent": True})
    except Exception as error:  # pragma: no cover
        errors.append("runtime parent: " + str(error))
        evidence.append({"path": RUNTIME_PARENT, "error": str(error), "absent": False})
    return errors, evidence
def empty_audit_material(cohort_id, generation):
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p37_installed_audit_material",
        "cohort_id": cohort_id,
        "generation": generation,
        "handoff_hash": None,
        "claim_hash": None,
        "claim_consumed": False,
        "units": {},
        "acks": {},
        "semantic_readback": [],
        "independent_verification": None,
        "claim_consumption": {"claim_hash": None, "consumed": False},
        "effect_replayed": False,
        "engine_sink": "disabled",
        "acceptance": "not_available",
        "phases": {},}
def record_audit_phase(audit_material, phase, evidence):
    if audit_material is None:
        return
    phases = audit_material.setdefault("phases", {})
    phases[phase] = evidence
    audit_material["phases"] = phases
def cgroup_v2_matches(pid, expected_path):
    try:
        with open("/proc/" + str(pid) + "/cgroup", "r", encoding="utf-8") as source:
            values = source.read(8192).splitlines()
    except OSError:
        return False
    return values == ["0::" + expected_path]
def read_process_starttime(pid):
    try:
        with open("/proc/" + str(pid) + "/stat", "r", encoding="utf-8") as source:
            raw = source.read(8192)
    except OSError:
        return None
    close = raw.rfind(")")
    if close < 0:
        return None
    tail = raw[close + 1 :].split()
    if len(tail) < 20:
        return None
    try:
        return int(tail[19])
    except ValueError:
        return None
def process_identity_matches(pid, service, expected_starttime=None):
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
    if not (uids == [service["uid"]] * 4 and gids == [service["gid"]] * 4 and groups == {service["gid"]}):
        return False
    if expected_starttime is not None:
        observed = read_process_starttime(pid)
        if observed is None or int(observed) != int(expected_starttime):
            return False
    return True
def service_unit_name(role):
    if role not in SERVICE_UNIT_BY_ROLE:
        fail("unknown installed service role for unit inventory: " + str(role))
    return SERVICE_UNIT_BY_ROLE[role]
def role_paths(runtime_root, role):
    root = os.path.join(runtime_root, role)
    return {
        "root": root,
        "bootstrap": os.path.join(root, "bootstrap.json"),
        "release": os.path.join(root, "release.token"),
        "ready": os.path.join(root, "ready.json"),
        "ack_root": os.path.join(root, "ack"),
        "ack_socket": os.path.join(root, "ack", "ack.sock"),
        "quiesce": os.path.join(root, "quiesce.token"),
        "peer_config": os.path.join(root, "peer.json"),
        "state": os.path.join(root, "state"),}
def plan_units(runtime_root):
    units = {}
    for role in SERVICE_ROLES:
        unit = service_unit_name(role)
        units[role] = {
            "unit": unit,
            "cgroup_path": "/system.slice/" + unit,
            "release_token": secrets.token_hex(16),
            "quiesce_token": secrets.token_hex(16),
            "paths": role_paths(runtime_root, role),
            "pid": None,
            "starttime": None,
            "may_exist": False,}
    planned = tuple(units[role]["unit"] for role in SERVICE_ROLES)
    if planned != FROZEN_SERVICE_UNITS:
        fail("installed unit inventory drifted from frozen six-unit set")
    return units
def preflight_units_absent(systemctl_path, units):
    # Independent ActiveState/LoadState queries. Absence only on successful
    # LoadState == not-found; any query failure blocks before launch.
    for role in SERVICE_ROLES:
        unit = units[role]["unit"]
        load_result = run_command(
            [systemctl_path, "show", "--property=LoadState", "--value", unit], timeout_seconds=2,)
        if load_result.returncode != 0:
            fail("unit preflight LoadState query failed for " + unit + ": "
                 + (load_result.stderr.strip() or load_result.stdout.strip() or str(load_result.returncode)))
        load_state = load_result.stdout.strip()
        active_result = run_command(
            [systemctl_path, "show", "--property=ActiveState", "--value", unit], timeout_seconds=2,)
        if active_result.returncode != 0:
            fail("unit preflight ActiveState query failed for " + unit + ": "
                 + (active_result.stderr.strip() or active_result.stdout.strip() or str(active_result.returncode)))
        active_state = active_result.stdout.strip()
        if load_state != "not-found":
            fail("pre-existing service unit is forbidden: " + unit
                 + " LoadState=" + (load_state or "unknown")
                 + " ActiveState=" + (active_state or "unknown"))
def run_binding_material(config, handoff, generation, cohort_id, units, services):
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p37_installed_run_binding",
        "p37_install_binding_hash": config["binding_hash"],
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
                "cgroup_path": units[role]["cgroup_path"],}
            for role in SERVICE_ROLES],}
def installed_binding(core_module, config, handoff, generation, cohort_id, run_binding_hash, units, services, snapshot_hash):
    binding = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p37_installed_state_binding",
        "install_binding_hash": config["binding_hash"],
        "run_binding_hash": run_binding_hash,
        "installed_abi_hash": config["installed_abi_hash"],
        "durable_abi_hash": config.get("durable_abi_hash") or sha256_value({"kind": "p37_installed_durable_bridge"}),
        "cohort_id": cohort_id,
        "generation": generation,
        "service_bindings": {
            role: {
                "role": role,
                "identity": services[role]["identity"],
                "uid": services[role]["uid"],
                "gid": services[role]["gid"],
                "attestation_hash": services[role]["attestation_hash"],
                "cgroup_binding_hash": core_module.sha256_value(units[role]["cgroup_path"]),}
            for role in SERVICE_ROLES
        },
        "snapshot_hash": snapshot_hash,}
    try:
        return core_module.normalize_binding(binding, expected_abi_hash=config["installed_abi_hash"])
    except core_module.InstalledError as error:
        raise InstalledHostError("root-created installed binding is invalid: " + str(error)) from error
def bootstrap_material(role, unit, service, state_leaf, endpoints):
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p37_installed_service_bootstrap",
        "role": role,
        "identity": service["identity"],
        "uid": service["uid"],
        "gid": service["gid"],
        "attestation_hash": service["attestation_hash"],
        "release_path": unit["paths"]["release"],
        "release_token": unit["release_token"],
        "ready_path": unit["paths"]["ready"],
        "ack_socket_path": unit["paths"]["ack_socket"],
        "quiesce_path": unit["paths"]["quiesce"],
        "quiesce_token": unit["quiesce_token"],
        "peer_config_path": unit["paths"]["peer_config"],
        "state_leaf": state_leaf,
        "release_timeout_seconds": ROLE_RELEASE_TIMEOUT_SECONDS,
        "hold_seconds": ROLE_HOLD_SECONDS,
        "endpoints": [
            endpoint
            for endpoint in endpoints
            if role in {endpoint["sender_role"], endpoint["recipient_role"]}],}
    return dict(material, bootstrap_hash=sha256_value(material))
def endpoint_specs(runtime_root, services, transport_module):
    endpoints = []
    for index, endpoint in enumerate(transport_module.INSTALLED_ENDPOINTS):
        socket_root = os.path.join(runtime_root, "ipc", "e" + str(index))
        endpoints.append(
            {
                "endpoint_id": endpoint["endpoint_id"],
                "socket_root": socket_root,
                "socket_path": os.path.join(socket_root, "s"),
                "sender_role": endpoint["sender_role"],
                "recipient_role": endpoint["recipient_role"],
                "sender_gid": services[endpoint["sender_role"]]["gid"],})
    return endpoints
def service_writable_paths(role, unit, endpoints, leaves):
    paths = [unit["paths"]["ack_root"], unit["paths"]["root"]]
    for endpoint in endpoints:
        if role in {endpoint["sender_role"], endpoint["recipient_role"]}:
            paths.append(endpoint["socket_root"])
    if role in leaves:
        paths.append(leaves[role])
    ordered = []
    seen = set()
    for path in paths:
        if path not in seen:
            ordered.append(path)
            seen.add(path)
    return ordered
def runtime_services(core_module, binding, units, services):
    runtime = {}
    for role in SERVICE_ROLES:
        if units[role]["pid"] is None or units[role]["starttime"] is None:
            fail("runtime services require pinned pid and starttime for " + role)
        runtime[role] = {
            "role": role,
            "identity": services[role]["identity"],
            "uid": services[role]["uid"],
            "gid": services[role]["gid"],
            "attestation_hash": services[role]["attestation_hash"],
            "pid": units[role]["pid"],
            "starttime": units[role]["starttime"],
            "cgroup_path": units[role]["cgroup_path"],
            "cgroup_binding_hash": core_module.sha256_value(units[role]["cgroup_path"]),}
    return runtime
def peer_config_material(role, binding, runtime, endpoints, authority_claim=None):
    needed = {role}
    for endpoint in endpoints:
        if role in {endpoint["sender_role"], endpoint["recipient_role"]}:
            needed.add(endpoint["sender_role"])
            needed.add(endpoint["recipient_role"])
    if role == "kernel":
        needed = set(SERVICE_ROLES)
    if role == "receipt_verifier":
        needed.update({"kernel", "broker", "witness", "coordinator", "receipt_verifier"})
    redacted_bindings = {}
    for index, service_role in enumerate(SERVICE_ROLES):
        if service_role in needed:
            redacted_bindings[service_role] = binding["service_bindings"][service_role]
        else:
            redacted_bindings[service_role] = {
                "role": service_role,
                "identity": "redacted-" + service_role,
                "uid": 1 + index,
                "gid": 101 + index,
                "attestation_hash": sha256_value("redacted:" + service_role),
                "cgroup_binding_hash": sha256_value("redacted-cgroup:" + service_role),}
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p37_installed_peer_config",
        "role": role,
        "identity": binding["service_bindings"][role]["identity"],
        "binding": dict(binding, service_bindings=redacted_bindings),
        "runtime_services": {key: runtime[key] for key in sorted(needed)},
        "endpoints": [
            endpoint
            for endpoint in endpoints
            if role in {endpoint["sender_role"], endpoint["recipient_role"]}],
        "authority": {
            "owner_kernel_authority": "active",
            "effect_authority": "reversible_probe_only",
            "broker_authority": "probe_only",
            "acceptance": "not_available",
            "engine_sink": "disabled",
            "acceptance_transaction": "disabled",
        },}
    if role in ("kernel", "broker"):
        if not isinstance(authority_claim, dict):
            fail("kernel/broker peer config requires the exclusive authority claim")
        required = {
            "claim_hash",
            "cohort_id",
            "generation",
            "run_binding_hash",
            "handoff_hash",}
        if set(authority_claim) != required:
            fail("authority claim has an unexpected key set")
        if (
            authority_claim["cohort_id"] != binding["cohort_id"]
            or int(authority_claim["generation"]) != int(binding["generation"])
            or authority_claim["run_binding_hash"] != binding["run_binding_hash"]
        ):
            fail("authority claim drifted from the installed binding")
        material["authority_claim"] = {
            "claim_hash": require_sha256(authority_claim["claim_hash"], "authority claim_hash"),
            "cohort_id": require_token(authority_claim["cohort_id"], "authority cohort_id"),
            "generation": int(authority_claim["generation"]),
            "run_binding_hash": require_sha256(
                authority_claim["run_binding_hash"], "authority run_binding_hash"
            ),
            "handoff_hash": require_sha256(authority_claim["handoff_hash"], "authority handoff_hash"),}
    return material
def _authority_block():
    return {
        "owner_kernel_authority": "active",
        "effect_authority": "reversible_probe_only",
        "broker_authority": "probe_only",
        "acceptance": "not_available",
        "engine_sink": "disabled",
        "acceptance_transaction": "disabled",}
def expected_probe_evidence(binding, role):
    authority = _authority_block()
    def step(endpoint_id, operation, code):
        return {
            "endpoint_id": endpoint_id,
            "operation": operation,
            "code": code,
            "authority": dict(authority),}
    if role == "kernel":
        return [
            step("kernel_broker", "postclaim_authorize", "PROBE_AUTHORIZED"),
            step("kernel_broker", "execute_probe", "PROBE_EXECUTED"),
            step("kernel_receipt_verifier", "verify_effect", "PROBE_VERIFIED"),
            step("kernel_receipt_verifier", "semantic_append", "WITNESS_RECORDED"),
            step("kernel_receipt_verifier", "semantic_readback", "WITNESS_AVAILABLE"),
            step("kernel_broker", "cancel_probe", "PROBE_RESTORED"),]
    if role == "worker":
        return [step("worker_broker", "mint_permit", "PROBE_AUTHORIZED")]
    if role == "receipt_verifier":
        return [step("receipt_verifier_coordinator", "resolve", "ACCEPTANCE_DISABLED")]
    if role == "coordinator":
        return [step("coordinator_witness", "getHead", "WITNESS_AVAILABLE")]
    return []
def validate_probe_evidence(evidence, binding, role):
    if not isinstance(evidence, list):
        fail("probe evidence must be a list")
    expected = expected_probe_evidence(binding, role)
    if len(evidence) != len(expected):
        fail("probe evidence count drifted for " + role)
    validated = []
    for index, item in enumerate(evidence):
        if not isinstance(item, dict):
            fail("probe evidence item must be an object")
        for forbidden in ("permit", "command", "path", "tool", "target", "catalog_row", "receipt_root"):
            if forbidden in item:
                fail("probe evidence accepted a capability-shaped field")
        if item.get("endpoint_id") != expected[index]["endpoint_id"]:
            fail("probe evidence endpoint drifted")
        if item.get("operation") != expected[index]["operation"]:
            fail("probe evidence operation drifted")
        if item.get("code") != expected[index]["code"]:
            fail("probe evidence code drifted")
        if item.get("operation") in ("appendIfHead", "semantic_append"):
            if not item.get("witness_head") or item.get("witness_sequence") in (None, 0):
                fail("probe evidence missing authenticated witness append receipt")
            if item.get("operation") == "semantic_append":
                for field in (
                    "claim_hash",
                    "authorization_id",
                    "effect_receipt_hash",
                    "verification_hash",
                    "event_hash",
                ):
                    if not item.get(field):
                        fail("probe evidence semantic append missing " + field)
        if item.get("operation") in ("readback", "semantic_readback"):
            if not item.get("witness_head") or int(item.get("readback_count") or 0) < 1:
                fail("probe evidence missing authenticated witness readback records")
            if item.get("operation") == "semantic_readback":
                for field in (
                    "claim_hash",
                    "authorization_id",
                    "effect_receipt_hash",
                    "verification_hash",
                    "event_hash",
                ):
                    if not item.get(field):
                        fail("probe evidence semantic readback missing " + field)
        if role == "kernel" and item.get("operation") in ("postclaim_authorize", "execute_probe"):
            if item.get("claim_consumed") is not True or not item.get("claim_hash"):
                fail("probe evidence missing exclusive claim consumption")
        if role == "kernel" and item.get("operation") == "verify_effect":
            if not item.get("effect_receipt_hash") or not item.get("verification_hash"):
                fail("probe evidence missing effect verification binding hashes")
        validated.append(item)
    return validated
def validate_ready(ready, bootstrap, service, unit, listener_ids):
    if not isinstance(ready, dict):
        fail("ready message must be an object")
    if ready.get("schema_version") is not SCHEMA_VERSION and ready.get("schema_version") != SCHEMA_VERSION:
        fail("ready schema_version is invalid")
    if isinstance(ready.get("schema_version"), bool):
        fail("ready schema_version must be an integer")
    required = {
        "schema_version",
        "kind",
        "role",
        "identity",
        "pid",
        "uid",
        "gid",
        "bootstrap_hash",
        "listener_endpoint_ids",
        "ready_hash",}
    if set(ready) != required:
        fail("ready message has an unexpected key set")
    if ready["kind"] != "p37_installed_listener_ready":
        fail("ready kind is invalid")
    if (
        ready["role"] != service["role"]
        or ready["identity"] != service["identity"]
        or ready["uid"] != service["uid"]
        or ready["gid"] != service["gid"]
        or ready["bootstrap_hash"] != bootstrap["bootstrap_hash"]
        or ready["listener_endpoint_ids"] != list(listener_ids)
    ):
        fail("ready message does not match the launched service")
    material = dict(ready)
    material.pop("ready_hash", None)
    if sha256_value(material) != ready["ready_hash"]:
        fail("ready hash is invalid")
    return ready
def validate_ack(ack, bootstrap, peer_config, service, unit, core_module, expected_phase="probe_complete"):
    if not isinstance(ack, dict):
        fail("ack must be an object")
    if isinstance(ack.get("schema_version"), bool):
        fail("ack schema_version must be an integer")
    if unit.get("starttime") is None:
        fail("ack validation requires a pinned unit starttime")
    required = {
        "schema_version",
        "kind",
        "phase",
        "role",
        "identity",
        "pid",
        "uid",
        "gid",
        "bootstrap_hash",
        "binding_hash",
        "evidence",
        "authority",
        "ack_hash",}
    if set(ack) != required:
        fail("ack has an unexpected key set")
    if ack["kind"] != "p37_installed_service_ack" or ack["phase"] != expected_phase:
        fail("ack phase/kind is invalid")
    if (
        ack["role"] != service["role"]
        or ack["identity"] != service["identity"]
        or ack["uid"] != service["uid"]
        or ack["gid"] != service["gid"]
        or ack["bootstrap_hash"] != bootstrap["bootstrap_hash"]
        or ack["pid"] != unit["pid"]
    ):
        fail("ack does not match the launched service")
    observed_start = read_process_starttime(ack["pid"])
    if observed_start is None or int(observed_start) != int(unit["starttime"]):
        fail("ack process starttime does not match the pinned unit starttime")
    if ack["authority"].get("engine_sink") != "disabled" or ack["authority"].get("acceptance") != "not_available":
        fail("ack must keep engine sink and acceptance disabled")
    material = dict(ack)
    material.pop("ack_hash", None)
    if sha256_value(material) != ack["ack_hash"]:
        fail("ack hash is invalid")
    validate_probe_evidence(ack["evidence"], peer_config["binding"], service["role"])
    return ack
def bind_root_ack_listener(unit, service):
    path = unit["paths"]["ack_socket"]
    require_exact_directory(unit["paths"]["ack_root"], service["uid"], service["gid"], 0o700, service["role"] + " ack root")
    if os.path.lexists(path):
        fail(service["role"] + " root acknowledgement socket already exists")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        listener.bind(path)
        os.chown(path, 0, service["gid"])
        os.chmod(path, 0o660)
        try:
            info = os.lstat(path)
        except OSError as error:
            raise InstalledHostError(service["role"] + " ack socket cannot be inspected: " + str(error)) from error
        if (
            stat.S_ISLNK(info.st_mode)
            or not stat.S_ISSOCK(info.st_mode)
            or info.st_uid != 0
            or info.st_gid != service["gid"]
            or (info.st_mode & 0o777) != 0o660
        ):
            fail(service["role"] + " root acknowledgement socket is not root-owned")
        listener.listen(4)
        listener.setblocking(False)
        return listener
    except BaseException:
        listener.close()
        raise
def close_root_ack_listeners(listeners):
    for listener in listeners.values():
        try:
            listener.close()
        except OSError:
            pass
def read_root_ack(listener, unit, service, transport_module, label):
    try:
        connection, _ = listener.accept()
    except BlockingIOError:
        return None
    except OSError as error:
        raise InstalledHostError(label + " socket cannot accept a peer: " + str(error)) from error
    try:
        if unit.get("starttime") is None:
            fail(label + " unit is missing a pinned starttime")
        expected = {
            "pid": unit["pid"],
            "uid": service["uid"],
            "gid": service["gid"],
            "cgroup_path": unit["cgroup_path"],
            "starttime": unit["starttime"],}
        observed_pid, observed_uid, observed_gid = transport_module.peer_credentials(connection)
        if (
            observed_pid != expected["pid"]
            or observed_uid != expected["uid"]
            or observed_gid != expected["gid"]
            or not transport_module.cgroup_v2_matches(observed_pid, expected["cgroup_path"])
        ):
            fail(label + " peer credentials/cgroup did not match the launched unit")
        if not transport_module.process_start_identity_matches(
            observed_pid,
            expected["uid"],
            expected["gid"],
            expected["starttime"],
        ):
            fail(label + " process-start identity/starttime did not match the launched unit")
        frame = transport_module.read_single_frame(connection, timeout_seconds=5)
        ack = transport_module.decode_frame(frame, label)
        return connection, ack
    except BaseException:
        try:
            connection.close()
        except OSError:
            pass
        raise
def confirm_root_ack(connection, label):
    try:
        connection.sendall(b"\x01")
    except OSError as error:
        raise InstalledHostError(label + " root confirmation cannot be sent: " + str(error)) from error
def collect_release_acks(
    ack_listeners,
    units,
    services,
    bootstraps,
    peer_configs,
    core_module,
    transport_module,
    expected_phase,
    timeout_seconds,
    audit_material=None,
):
    deadline = time.monotonic() + timeout_seconds
    pending = set(SERVICE_ROLES)
    evidence_by_role = {}
    if audit_material is not None:
        audit_material.setdefault("acks", {}).setdefault(expected_phase, {})
    while pending and time.monotonic() < deadline:
        for role in tuple(pending):
            try:
                received = read_root_ack(
                    ack_listeners[role],
                    units[role],
                    services[role],
                    transport_module,
                    role + " installed " + expected_phase + " acknowledgement",)
            except InstalledHostError:
                raise
            if received is None:
                continue
            connection, ack = received
            try:
                validate_ack(
                    ack,
                    bootstraps[role],
                    peer_configs[role],
                    services[role],
                    units[role],
                    core_module,
                    expected_phase,)
                confirm_root_ack(connection, role + " installed " + expected_phase + " acknowledgement")
            finally:
                try:
                    connection.close()
                except OSError:
                    pass
            evidence_by_role[role] = ack["evidence"]
            pending.remove(role)
            if audit_material is not None:
                audit_material["acks"][expected_phase][role] = ack["evidence"]
                record_audit_phase(
                    audit_material,
                    expected_phase + "_ack_" + role,
                    {"phase": expected_phase, "role": role, "evidence": ack["evidence"]},)
        if pending:
            time.sleep(0.025)
    if pending:
        fail(
            "installed "
            + expected_phase
            + " acknowledgements missed the shared deadline: "
            + ", ".join(sorted(pending)))
    return evidence_by_role
def claim_handoff(handoff_root, handoff_id, consumer_binding):
    handoff_id = require_token(handoff_id, "handoff id")
    handoff_path = os.path.join(handoff_root, handoff_id + ".json")
    claim_path = os.path.join(handoff_root, handoff_id + ".claimed")
    require_root_owned_path(handoff_path, "P3.5d handoff")
    with open(handoff_path, "rb") as source:
        handoff_raw = source.read()
    try:
        handoff = json.loads(handoff_raw.decode("utf-8").rstrip("\n"))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise InstalledHostError("P3.5d handoff is not valid JSON") from error
    for field in ("handoff_hash", "p35_install_binding_hash", "bridge_plan_hash"):
        require_sha256(handoff[field], "handoff " + field)
    if handoff.get("handoff_id") not in (None, handoff_id):
        fail("handoff id drifted from the staged path")
    claim = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p37_installed_handoff_claim",
        "handoff_id": handoff_id,
        "handoff_hash": handoff["handoff_hash"],
        "p35_install_binding_hash": handoff["p35_install_binding_hash"],
        "bridge_plan_hash": handoff["bridge_plan_hash"],
        "cohort_id": require_token(consumer_binding["cohort_id"], "claim cohort_id"),
        "generation": int(consumer_binding["generation"]),
        "run_binding_hash": require_sha256(consumer_binding["run_binding_hash"], "claim run_binding_hash"),
        "claimed_at_ms": int(time.time() * 1000),}
    claim["claim_hash"] = sha256_value(claim)
    payload = (canonical(claim) + "\n").encode("utf-8")
    descriptor = None
    try:
        descriptor = os.open(claim_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        total = 0
        while total < len(payload):
            written = os.write(descriptor, payload[total:])
            if written <= 0:
                fail("cannot write handoff claim")
            total += written
        os.fsync(descriptor)
    except FileExistsError as error:
        raise InstalledHostError("P3.5d handoff was already claimed") from error
    except OSError as error:
        raise InstalledHostError("P3.5d handoff claim failed: " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
    fsync_directory(handoff_root)
    return {"handoff": handoff, "claim": claim}
def remove_tree(path):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return
    except OSError as error:
        raise InstalledHostError("runtime cleanup cannot inspect " + path + ": " + str(error)) from error
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
def _systemctl_unit_absent(text):
    lowered = (text or "").lower()
    return (
        "not loaded" in lowered
        or "could not be found" in lowered
        or "not-found" in lowered
        or "not found" in lowered
        or "unit not found" in lowered
        or "no such file" in lowered)
def stop_and_collect_unit(systemctl_path, unit):
    issues, outcomes = [], []
    def record(op, completed=None, error=None):
        if error is not None:
            entry = {"op": op, "unit": unit, "error": str(error), "absent": False}
            outcomes.append(entry)
            issues.append(op + " " + unit + " exception: " + str(error))
            return entry
        text = (completed.stderr.strip() or completed.stdout.strip() or "")
        entry = {
            "op": op, "unit": unit, "returncode": int(completed.returncode),
            "stdout": completed.stdout.strip(), "stderr": completed.stderr.strip(),
            "absent": _systemctl_unit_absent(text) or (completed.stdout.strip() == "not-found"),}
        outcomes.append(entry)
        return entry
    def run_op(op, args, timeout_seconds=5):
        try:
            completed = run_command(args, timeout_seconds=timeout_seconds)
            entry = record(op, completed=completed)
            if completed.returncode != 0 and not entry["absent"] and op in ("stop", "reset-failed"):
                issues.append(op + " " + unit + ": " + (entry["stderr"] or entry["stdout"] or str(completed.returncode)))
            return completed, entry
        except Exception as error:
            return None, record(op, error=error)
    run_op("stop", [systemctl_path, "stop", unit])
    run_op("reset-failed", [systemctl_path, "reset-failed", unit])
    show_absent, active_state, load_state = False, "", ""
    load_shown, load_entry = None, {}
    try:
        deadline = time.monotonic() + 1.0
        while True:
            load_shown, load_entry = run_op(
                "show-LoadState",
                [systemctl_path, "show", "--property=LoadState", "--value", unit],
                timeout_seconds=2,)
            active_shown, _active_entry = run_op(
                "show-ActiveState",
                [systemctl_path, "show", "--property=ActiveState", "--value", unit],
                timeout_seconds=2,)
            if load_shown is None or active_shown is None:
                show_absent = False
                break
            load_state = load_shown.stdout.strip() if load_shown.returncode == 0 else ""
            active_state = active_shown.stdout.strip() if active_shown.returncode == 0 else ""
            load_text = (load_shown.stderr.strip() or load_shown.stdout.strip() or "")
            if load_shown.returncode == 0 and load_state == "not-found":
                show_absent = True
            elif load_shown.returncode != 0 and (
                load_entry.get("absent") or _systemctl_unit_absent(load_text)
            ):
                show_absent = True
            else:
                show_absent = False
            if show_absent or active_state in ("inactive", "failed", "dead", "active"):
                break
            if time.monotonic() >= deadline:
                break
            time.sleep(0.05)
        if not show_absent:
            if load_shown is not None and load_shown.returncode != 0 and not (
                load_entry.get("absent") or _systemctl_unit_absent(load_shown.stderr.strip() or "")
            ):
                issues.append(
                    "show " + unit + " nonzero without not-found: "
                    + (load_entry.get("stderr") or load_entry.get("stdout") or str(load_shown.returncode)))
            elif active_state in ("inactive", "failed", "dead", "active") or (
                load_shown is not None and load_shown.returncode == 0 and load_state and load_state != "not-found"
            ):
                issues.append(
                    "unit " + unit + " still loaded after stop (state="
                    + (active_state or load_state or "unknown") + "); not-found/unloaded required")
            else:
                issues.append(
                    "unit " + unit + " not verified not-found/unloaded: "
                    + (load_state or active_state or "unknown"))
    except Exception as error:
        record("show-LoadState", error=error)
        show_absent = False
    try:
        is_active, is_active_entry = run_op("is-active", [systemctl_path, "is-active", unit])
        if is_active is None:
            return issues, outcomes
        is_active_text = is_active.stdout.strip()
        is_active_absent = bool(
            is_active_entry["absent"]
            or _systemctl_unit_absent(is_active.stderr.strip() or is_active.stdout.strip() or "")
            or is_active_text in ("not-found", "unknown", ""))
        if is_active_text == "active" or is_active.returncode == 0:
            issues.append("unit " + unit + " still reports active")
        elif is_active_text in ("inactive", "failed", "dead") and not show_absent:
            issues.append("unit " + unit + " is-active=" + is_active_text + " without verified not-found/unloaded")
        elif not (show_absent or is_active_absent):
            issues.append(
                "is-active " + unit + " nonzero without verified not-found: "
                + (is_active_text or str(is_active.returncode)))
    except Exception as error:
        record("is-active", error=error)
    return issues, outcomes
def _claim_hash_of(claimed):
    if isinstance(claimed, dict) and isinstance(claimed.get("claim"), dict):
        return claimed["claim"].get("claim_hash")
    return None
def persist_durable_audit_record(
    state_root,
    cohort_id,
    generation,
    result,
    audit_material,
    claim_hash=None,
    suffix=".json",
    allow_existing=False,
):
    state_root = revalidate_pinned_state_root(state_root)
    audit_dir = os.path.join(state_root, "audit")
    ensure_directory(audit_dir, 0, 0, 0o700, "installed audit root")
    durable_record = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p37_installed_durable_audit",
        "cohort_id": cohort_id,
        "generation": generation,
        "claim_hash": claim_hash,
        "result": result,
        "audit_material": audit_material,}
    durable_audit_hash = sha256_value(durable_record)
    durable_record = dict(durable_record, durable_audit_hash=durable_audit_hash)
    if isinstance(result, dict) and result.get("audit_hash") is not None:
        if result.get("audit_hash") != sha256_value(audit_material):
            fail("installed result audit_hash does not match durable audit material")
    durable_audit_path = os.path.join(audit_dir, cohort_id + suffix)
    write_root_file(
        durable_audit_path,
        (canonical(durable_record) + "\n").encode("utf-8"),
        0o600,
        allow_existing=allow_existing,)
    fsync_directory(audit_dir)
    return durable_audit_path, durable_audit_hash
def run_probe_session(handoff_id=None):
    require_root()
    require_supported_host()
    require_lifecycle_timing_budget()
    install_root = installed_root_from_self()
    config = load_installed_config(install_root)
    validated = validate_installed_config(install_root, config)
    core_module = load_snapshot_module(install_root, "core", "p37i_run_core")
    transport_module = load_snapshot_module(install_root, "transport", "p37i_run_transport")
    if config["authority"]["engine_sink"] != "disabled":
        fail("installed Engine sink must remain disabled in U5")
    handoff_id = require_token(handoff_id or "", "handoff id") if handoff_id else None
    if not handoff_id:
        fail("run-probe requires an exclusive P3.5d handoff id")
    generation = int(time.time()) % 100000 + 1
    cohort_id = "p37i-" + str(generation) + "-" + secrets.token_hex(8)
    runtime_root = os.path.join(RUNTIME_PARENT, cohort_id)
    units = plan_units(runtime_root)
    preflight_units_absent(validated["paths"]["systemctl_path"], units)
    cleanup_errors = []
    unit_cleanup_outcomes = []
    post_cleanup_evidence = []
    result = None
    audit_material = empty_audit_material(cohort_id, generation)
    primary_error = None
    claimed = None
    handoff = None
    binding = None
    ack_listeners = {}
    peer_configs = {}
    runtime_parent_created = False
    # Repair recovery parent mode (e.g. 0700 drift → 0711) before state revalidation
    # and before any dedicated service UID must traverse the parent.
    establish_trusted_recovery_parent()
    pinned_state_root = revalidate_pinned_state_root(validated["state_root"])
    cohort_state_root = os.path.join(pinned_state_root, cohort_id)
    provisional_completed = None
    profile_hash = None
    previous_sigmask = None
    created_identities = list(config.get("created_identities") or [])
    if len(created_identities) != len(SERVICE_ROLES):
        fail("installed config must track all six created dedicated identities")
    try:
        try:
            previous_sigmask = signal.pthread_sigmask(signal.SIG_BLOCK, set(TERMINATION_SIGNALS))
        except (AttributeError, OSError, ValueError) as error:
            raise InstalledHostError("cannot mask termination signals") from error
        try:
            handoff_path = os.path.join(validated["handoff_root"], handoff_id + ".json")
            require_root_owned_path(handoff_path, "P3.5d handoff")
            with open(handoff_path, "rb") as source:
                staged = json.loads(source.read().decode("utf-8").rstrip("\n"))
            for field in ("handoff_hash", "p35_install_binding_hash", "bridge_plan_hash"):
                require_sha256(staged[field], "handoff " + field)
            run_material = run_binding_material(
                config, staged, generation, cohort_id, units, validated["services"])
            run_binding_hash = sha256_value(run_material)
            claimed = claim_handoff(
                validated["handoff_root"],
                handoff_id,
                {
                    "cohort_id": cohort_id,
                    "generation": generation,
                    "run_binding_hash": run_binding_hash,
                },)
            handoff = claimed["handoff"]
            if (
                handoff["handoff_hash"] != staged["handoff_hash"]
                or handoff["p35_install_binding_hash"] != staged["p35_install_binding_hash"]
                or handoff["bridge_plan_hash"] != staged["bridge_plan_hash"]
            ):
                fail("P3.5d handoff changed between inspection and exclusive claim")
            audit_material["handoff_hash"] = handoff["handoff_hash"]
            audit_material["claim_hash"] = claimed["claim"]["claim_hash"]
            audit_material["claim_consumption"] = {
                "claim_hash": claimed["claim"]["claim_hash"],
                "consumed": False,
                "cohort_id": cohort_id,
                "generation": generation,}
            record_audit_phase(
                audit_material,
                "claim",
                {
                    "claim_hash": claimed["claim"]["claim_hash"],
                    "handoff_hash": handoff["handoff_hash"],
                },)
            snapshot_hash = sha256_value(config["files"])
            binding = installed_binding(
                core_module,
                config,
                handoff,
                generation,
                cohort_id,
                run_binding_hash,
                units,
                validated["services"],
                snapshot_hash,)
            record_audit_phase(
                audit_material, "installed_binding", {"binding_hash": binding.get("binding_hash")})
            runtime_parent_created = ensure_runtime_parent()
            create_directory(runtime_root, 0, 0, 0o711, "installed runtime root")
            leaves = {}
            probe_leaf = os.path.join(cohort_state_root, "probe")
            create_directory(cohort_state_root, 0, 0, 0o711, "cohort state parent")
            create_directory(
                probe_leaf,
                validated["services"]["broker"]["uid"],
                validated["services"]["receipt_verifier"]["gid"],
                0o2770,
                "shared probe leaf",)
            leaves["broker"] = probe_leaf
            leaves["receipt_verifier"] = probe_leaf
            for role in ("witness", "coordinator"):
                leaf = os.path.join(cohort_state_root, role)
                create_directory(
                    leaf,
                    validated["services"][role]["uid"],
                    validated["services"][role]["gid"],
                    0o700,
                    role + " state leaf",)
                leaves[role] = leaf
            for role in SERVICE_ROLES:
                paths = units[role]["paths"]
                create_directory(
                    paths["root"],
                    validated["services"][role]["uid"],
                    validated["services"][role]["gid"],
                    0o700,
                    role + " runtime",)
                create_directory(
                    paths["ack_root"],
                    validated["services"][role]["uid"],
                    validated["services"][role]["gid"],
                    0o700,
                    role + " ack root",)
                ack_listeners[role] = bind_root_ack_listener(units[role], validated["services"][role])
            endpoints = endpoint_specs(runtime_root, validated["services"], transport_module)
            create_directory(os.path.join(runtime_root, "ipc"), 0, 0, 0o711, "installed ipc root")
            for endpoint in endpoints:
                recipient = endpoint["recipient_role"]
                sender = endpoint["sender_role"]
                create_directory(
                    endpoint["socket_root"],
                    validated["services"][recipient]["uid"],
                    validated["services"][sender]["gid"],
                    0o2710,
                    endpoint["endpoint_id"] + " socket root",)
            bootstraps = {}
            for role in SERVICE_ROLES:
                bootstraps[role] = bootstrap_material(
                    role, units[role], validated["services"][role], leaves.get(role), endpoints)
                write_root_group_json(
                    units[role]["paths"]["bootstrap"],
                    bootstraps[role],
                    validated["services"][role]["gid"],
                    role + " bootstrap",)
            for role in SERVICE_ROLES:
                units[role]["may_exist"] = True
                command = [
                    validated["paths"]["systemd_run_path"],
                    "--no-block",
                    "--quiet",
                    "--collect",
                    "--unit=" + units[role]["unit"],
                    "--slice=system.slice",
                    "--uid=" + str(validated["services"][role]["uid"]),
                    "--gid=" + str(validated["services"][role]["gid"]),]
                for property_value in SYSTEMD_PROPERTIES:
                    command.append("--property=" + property_value)
                writable = service_writable_paths(role, units[role], endpoints, leaves)
                command.append("--property=ReadWritePaths=" + " ".join(writable))
                command.extend(
                    [
                        "--",
                        validated["paths"]["python_path"],
                        "-I",
                        os.path.join(install_root, FILE_LAYOUT["service"]),
                        "--bootstrap-config",
                        units[role]["paths"]["bootstrap"],])
                launched = run_command(command)
                if launched.returncode != 0:
                    fail("cannot launch installed " + role + " service: " + launched.stderr.strip())
                deadline = time.monotonic() + ROLE_START_TIMEOUT_SECONDS
                pid = None
                starttime = None
                while time.monotonic() < deadline:
                    shown = run_command(
                        [
                            validated["paths"]["systemctl_path"],
                            "show",
                            "--property=MainPID",
                            "--value",
                            units[role]["unit"],],
                        timeout_seconds=2,)
                    candidate = shown.stdout.strip() if shown.returncode == 0 else ""
                    if candidate.isdigit() and int(candidate) > 0:
                        candidate_pid = int(candidate)
                        candidate_start = read_process_starttime(candidate_pid)
                        if (
                            candidate_start is not None
                            and cgroup_v2_matches(candidate_pid, units[role]["cgroup_path"])
                            and process_identity_matches(
                                candidate_pid,
                                validated["services"][role],
                                expected_starttime=candidate_start,)
                        ):
                            pid = candidate_pid
                            starttime = candidate_start
                            break
                    time.sleep(0.05)
                if pid is None or starttime is None:
                    fail(
                        "installed service did not expose its exact PID/UID/GID/cgroup/starttime: "
                        + units[role]["unit"])
                units[role]["pid"] = pid
                units[role]["starttime"] = starttime
            audit_material["units"] = {
                role: {
                    "unit": units[role]["unit"],
                    "pid": units[role]["pid"],
                    "starttime": units[role]["starttime"],}
                for role in SERVICE_ROLES}
            record_audit_phase(audit_material, "units_started", audit_material["units"])
            runtime = runtime_services(core_module, binding, units, validated["services"])
            authority_claim = {
                "claim_hash": claimed["claim"]["claim_hash"],
                "cohort_id": cohort_id,
                "generation": generation,
                "run_binding_hash": run_binding_hash,
                "handoff_hash": handoff["handoff_hash"],}
            for role in SERVICE_ROLES:
                peer = peer_config_material(
                    role,
                    binding,
                    runtime,
                    endpoints,
                    authority_claim=authority_claim if role in ("kernel", "broker") else None,)
                peer_configs[role] = peer
                write_root_group_json(
                    units[role]["paths"]["peer_config"],
                    peer,
                    validated["services"][role]["gid"],
                    role + " peer config",)
            for role in SERVICE_ROLES:
                write_root_file(
                    units[role]["paths"]["release"],
                    (units[role]["release_token"] + "\n").encode("utf-8"),
                    0o640,
                    gid=validated["services"][role]["gid"],)
            for role in SERVICE_ROLES:
                ready_path = units[role]["paths"]["ready"]
                deadline = time.monotonic() + ROLE_START_TIMEOUT_SECONDS
                ready = None
                while time.monotonic() < deadline:
                    if os.path.lexists(ready_path):
                        with open(ready_path, "rb") as source:
                            ready = json.loads(source.read().decode("utf-8"))
                        break
                    time.sleep(0.025)
                if ready is None:
                    fail("ready message missing for " + role)
                listener_ids = [
                    endpoint["endpoint_id"]
                    for endpoint in endpoints
                    if endpoint["recipient_role"] == role]
                validate_ready(
                    ready, bootstraps[role], validated["services"][role], units[role], listener_ids)
            evidence_by_role = collect_release_acks(
                ack_listeners,
                units,
                validated["services"],
                bootstraps,
                peer_configs,
                core_module,
                transport_module,
                "probe_complete",
                ROLE_ACK_TIMEOUT_SECONDS,
                audit_material=audit_material,)
            if set(evidence_by_role) != set(SERVICE_ROLES):
                fail("installed probe-complete acknowledgements did not cover all six roles")
            kernel_codes = [item.get("code") for item in evidence_by_role["kernel"]]
            kernel_ops = [item.get("operation") for item in evidence_by_role["kernel"]]
            if kernel_codes != [
                "PROBE_AUTHORIZED", "PROBE_EXECUTED", "PROBE_VERIFIED",
                "WITNESS_RECORDED", "WITNESS_AVAILABLE", "PROBE_RESTORED",
            ]:
                fail("installed kernel effect path did not complete through six-service IPC")
            if kernel_ops != [
                "postclaim_authorize", "execute_probe", "verify_effect",
                "semantic_append", "semantic_readback", "cancel_probe",
            ]:
                fail("installed kernel probe operation order drifted")
            if kernel_ops.index("semantic_append") <= kernel_ops.index("verify_effect"):
                fail("installed semantic append ran before effect verification")
            kernel_claim_hashes = {
                item.get("claim_hash")
                for item in evidence_by_role["kernel"]
                if item.get("claim_consumed") is True}
            if kernel_claim_hashes != {claimed["claim"]["claim_hash"]}:
                fail("installed probe did not consume the exact exclusive handoff claim")
            audit_material["claim_consumed"] = True
            audit_material["claim_consumption"] = {
                "claim_hash": claimed["claim"]["claim_hash"],
                "consumed": True,
                "cohort_id": cohort_id,
                "generation": generation,}
            record_audit_phase(
                audit_material, "claim_consumption", audit_material["claim_consumption"])
            def _kernel_items(*ops):
                return [
                    item for item in evidence_by_role["kernel"]
                    if item.get("operation") in ops]
            def _phase(name, items):
                record_audit_phase(
                    audit_material,
                    name,
                    {
                        "kernel_ops": [item.get("operation") for item in items],
                        "kernel_codes": [item.get("code") for item in items],
                        "items": list(items),
                    },)
            _phase("effect", _kernel_items("postclaim_authorize", "execute_probe"))
            _phase("verification", _kernel_items("verify_effect"))
            semantic_items = _kernel_items("semantic_append", "semantic_readback")
            if len(semantic_items) != 2:
                fail("installed semantic witness append/readback missing from kernel evidence")
            for item in semantic_items:
                for field in (
                    "claim_hash", "authorization_id", "effect_receipt_hash",
                    "verification_hash", "event_hash",
                ):
                    if not item.get(field):
                        fail("installed semantic evidence missing " + field)
                if item.get("claim_hash") != claimed["claim"]["claim_hash"]:
                    fail("installed semantic evidence claim_hash drifted from exclusive claim")
            if semantic_items[0].get("event_hash") != semantic_items[1].get("event_hash"):
                fail("installed semantic readback did not re-authenticate the append event")
            if not any(
                item.get("operation") == "semantic_append" and item.get("witness_head")
                for item in evidence_by_role["kernel"]
            ):
                fail("installed semantic witness missing durable append receipt")
            if not any(
                item.get("operation") == "semantic_readback"
                and int(item.get("readback_count") or 0) >= 1
                for item in evidence_by_role["kernel"]
            ):
                fail("installed semantic witness missing authenticated readback")
            audit_material["semantic_readback"] = list(semantic_items)
            record_audit_phase(audit_material, "semantic_readback", {"items": list(semantic_items)})
            _phase("restoration", _kernel_items("cancel_probe"))
            rv_codes = [item.get("code") for item in evidence_by_role["receipt_verifier"]]
            if rv_codes != ["ACCEPTANCE_DISABLED"]:
                fail("installed receipt-verifier did not keep acceptance disabled")
            audit_material["acks"]["probe_complete"] = evidence_by_role
            independent = core_module.ProbeSentinel(probe_leaf, cohort_id).observe()
            if independent["toggles"] < 1:
                fail("installed probe left no durable sentinel history for independent audit")
            if independent["sentinel"] is not False:
                fail("installed probe sentinel was not restored for independent verification")
            audit_material["independent_verification"] = independent
            record_audit_phase(audit_material, "independent_verification", independent)
            for role in SERVICE_ROLES:
                write_root_file(
                    units[role]["paths"]["quiesce"],
                    (units[role]["quiesce_token"] + "\n").encode("utf-8"),
                    0o640,
                    gid=validated["services"][role]["gid"],)
            quiesced_evidence = collect_release_acks(
                ack_listeners,
                units,
                validated["services"],
                bootstraps,
                peer_configs,
                core_module,
                transport_module,
                "quiesced",
                ROLE_QUIESCE_TIMEOUT_SECONDS,
                audit_material=audit_material,)
            if quiesced_evidence != evidence_by_role:
                fail(
                    "installed cohort changed fixed probe evidence between acknowledgement phases")
            audit_material["acks"]["quiesced"] = quiesced_evidence
            record_audit_phase(audit_material, "acks", audit_material["acks"])
            profile_hash = sha256_value(
                {
                    "binding": binding,
                    "operation": "run_probe",
                    "handoff": handoff["handoff_hash"],
                    "claim": claimed["claim"]["claim_hash"],})
            provisional_completed = {
                "binding": binding,
                "profile_hash": profile_hash,
                "audit_material": audit_material,}
        except BaseException as error:
            if isinstance(error, KeyboardInterrupt):
                primary_error = InstalledHostError(
                    "installed probe interrupt: " + (str(error) or "terminated"))
            elif isinstance(error, InstalledHostError):
                primary_error = error
            else:
                primary_error = InstalledHostError(str(error))
        finally:
            close_root_ack_listeners(ack_listeners)
            for role in reversed(SERVICE_ROLES):
                if not units[role]["may_exist"]:
                    continue
                try:
                    unit_issues, unit_outcomes = stop_and_collect_unit(
                        validated["paths"]["systemctl_path"], units[role]["unit"])
                    unit_cleanup_outcomes.extend(unit_outcomes)
                    for issue in unit_issues:
                        cleanup_errors.append(role + " unit: " + issue)
                except Exception as error:  # pragma: no cover
                    cleanup_errors.append(role + " unit: " + str(error))
                    unit_cleanup_outcomes.append(
                        {
                            "op": "stop_and_collect",
                            "unit": units[role]["unit"],
                            "error": str(error),})
            record_audit_phase(
                audit_material,
                "unit_cleanup",
                {
                    "unit_outcomes": list(unit_cleanup_outcomes),
                    "cleanup_errors": list(cleanup_errors),
                },)
        try:
            if os.path.lexists(runtime_root):
                remove_tree(runtime_root)
                post_cleanup_evidence.append({"path": runtime_root, "removed": True})
            if os.path.lexists(runtime_root):
                cleanup_errors.append("runtime root still present after cleanup: " + runtime_root)
                post_cleanup_evidence.append({"path": runtime_root, "removed": False})
        except Exception as error:  # pragma: no cover
            cleanup_errors.append("runtime root: " + str(error))
            post_cleanup_evidence.append({"path": runtime_root, "error": str(error)})
        try:
            # Recursive cleanup only on the revalidated pinned state root subtree.
            revalidate_pinned_state_root(pinned_state_root)
            if os.path.lexists(cohort_state_root):
                if not cohort_state_root.startswith(pinned_state_root + os.sep):
                    fail("cohort state root escaped the pinned state root")
                remove_tree(cohort_state_root)
                post_cleanup_evidence.append({"path": cohort_state_root, "removed": True})
            if os.path.lexists(cohort_state_root):
                cleanup_errors.append(
                    "cohort state still present after cleanup: " + cohort_state_root)
                post_cleanup_evidence.append({"path": cohort_state_root, "removed": False})
        except Exception as error:  # pragma: no cover
            cleanup_errors.append("cohort state: " + str(error))
            post_cleanup_evidence.append({"path": cohort_state_root, "error": str(error)})
        parent_errors, parent_evidence = cleanup_runtime_parent_if_created(runtime_parent_created)
        cleanup_errors.extend(parent_errors)
        post_cleanup_evidence.extend(parent_evidence)
        if created_identities:
            id_errors, id_evidence = remove_created_identities(
                created_identities, validated.get("paths"))
            cleanup_errors.extend(id_errors)
            post_cleanup_evidence.extend(id_evidence)
            record_audit_phase(
                audit_material,
                "identity_cleanup",
                {"created_identities": list(created_identities), "evidence": id_evidence},)
        claim_hash = _claim_hash_of(claimed)
        cleanup_evidence = {
            "unit_outcomes": list(unit_cleanup_outcomes),
            "post_cleanup": list(post_cleanup_evidence),
            "cleanup_errors": list(cleanup_errors),
            "created_identities": list(created_identities),}
        audit_material["cleanup_evidence"] = cleanup_evidence
        audit_material["cleanup_errors"] = list(cleanup_errors)
        record_audit_phase(audit_material, "cleanup", cleanup_evidence)
        if cleanup_errors and provisional_completed is not None:
            if primary_error is None:
                primary_error = InstalledHostError(
                    "installed cohort cleanup failed: " + "; ".join(cleanup_errors))
            provisional_completed = None
        if provisional_completed is not None and primary_error is None:
            result = core_module.build_run_probe_result(
                provisional_completed["binding"],
                provisional_completed["profile_hash"],
                "completed",
                "completed",
                True,
                audit_material,)
            durable_audit_path, durable_audit_hash = persist_durable_audit_record(
                pinned_state_root,
                cohort_id,
                generation,
                result,
                audit_material,
                claim_hash=claim_hash,
                suffix=".json",)
            emitted = dict(result)
            emitted["durable_audit_path"] = durable_audit_path
            emitted["durable_audit_hash"] = durable_audit_hash
            emit(emitted)
            return emitted
        if primary_error is None:
            primary_error = InstalledHostError(
                "installed probe failed without a completed outcome"
                + ("; cleanup: " + "; ".join(cleanup_errors) if cleanup_errors else ""))
        audit_material["error"] = str(primary_error)
        if "claim_consumption" not in audit_material or not audit_material["claim_consumption"]:
            audit_material["claim_consumption"] = {
                "claim_hash": claim_hash,
                "consumed": bool(audit_material.get("claim_consumed")),}
        outcome = "unknown" if "interrupt" in str(primary_error).lower() else "recovery_required"
        reason_code = "CLEANUP_FAILURE" if cleanup_errors else "HOST_FAILURE"
        recovery_profile_hash = sha256_value(
            {
                "error": str(primary_error),
                "cohort_id": cohort_id,
                "claim_hash": claim_hash,
                "cleanup_errors": cleanup_errors,})
        if binding is not None:
            result = core_module.build_run_probe_result(
                binding,
                recovery_profile_hash,
                outcome,
                outcome,
                False,
                audit_material,)
        else:
            crash = core_module.create_crash_outcome(
                outcome,
                "run-probe-" + cohort_id,
                reason_code,
                audit_material,)
            result = {
                "schema_version": SCHEMA_VERSION,
                "kind": "p37_installed_run_probe_result",
                "status": outcome,
                "outcome": outcome,
                "profile_hash": recovery_profile_hash,
                "cohort_id": cohort_id,
                "generation": generation,
                "claim_hash": claim_hash,
                "probe_catalog_id": "owner-kernel-probe-toggle-v1",
                "effect_replayed": False,
                "sentinel_restored": False,
                "authority": {"engine_sink": "disabled", "acceptance": "not_available"},
                "audit_hash": crash["audit_hash"],
                "reason_code": reason_code,
                "request_id": crash["request_id"],}
        durable_audit_path, durable_audit_hash = persist_durable_audit_record(
            pinned_state_root,
            cohort_id,
            generation,
            result,
            audit_material,
            claim_hash=claim_hash,
            suffix=".recovery.json",
            allow_existing=False,)
        emitted = dict(result)
        emitted["durable_audit_path"] = durable_audit_path
        emitted["durable_audit_hash"] = durable_audit_hash
        emit(emitted)
        if cleanup_errors:
            raise InstalledHostError(
                str(primary_error) + "; cleanup: " + "; ".join(cleanup_errors)
            ) from primary_error
        raise primary_error
    finally:
        if previous_sigmask is not None:
            try:
                signal.pthread_sigmask(signal.SIG_SETMASK, previous_sigmask)
            except (AttributeError, OSError, ValueError):
                pass
def parser():
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    install_parser = commands.add_parser("install")
    install_parser.add_argument("--install-root", required=True)
    install_parser.add_argument("--state-root", required=True)
    install_parser.add_argument("--p35-handoff-root", required=True)
    install_parser.add_argument("--create-identities", action="store_true")
    install_parser.set_defaults(handler=install)
    run_parser = commands.add_parser("run-probe")
    run_parser.add_argument("--handoff-id", required=True)
    run_parser.set_defaults(
        handler=lambda args: run_probe_session(require_token(args.handoff_id, "handoff id")))
    return root
def main():
    try:
        args = parser().parse_args()
        args.handler(args)
        return 0
    except InstalledHostError as error:
        sys.stderr.write("supervised-owner-kernel-installed-host: " + str(error) + "\n")
        return 2
if __name__ == "__main__":
    raise SystemExit(main())
