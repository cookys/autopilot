#!/usr/bin/env python3
"""P3.4b root-owned launcher for a bounded cross-UID mechanism probe.

This program has two deliberately separate trust moments:

* ``install`` is a root-operator handoff that snapshots this launcher, the peer
  helper, and the worker wrapper into a root-owned directory.
* ``run`` executes only that installed snapshot and its adjacent root-owned config.
  It accepts no caller-supplied command, helper, worker, runtime root, or config.

The result remains preflight-only. This module never imports or invokes Owner Kernel,
action, witness, intake-verifier, or acceptance code.
"""

import argparse
import hashlib
import json
import os
import pwd
import grp
import secrets
import select
import signal
import socket
import stat
import subprocess
import sys
import time


SCHEMA_VERSION = 1
WORKER_IDENTITY = "autopilot-worker"
RUNTIME_PARENT = "/run/autopilot-supervisor"
CONFIG_RELATIVE_PATH = "etc/supervised-host.json"
FILE_LAYOUT = {
    "launcher": "sbin/supervised-host-launcher.py",
    "helper": "lib/supervised-host-peercred.py",
    "wait_wrapper": "lib/supervised-host-worker-wait.py",
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
)
SYSTEM_PATHS = {
    "python_path": "/usr/bin/python3",
    "setpriv_path": "/usr/bin/setpriv",
    "systemd_run_path": "/usr/bin/systemd-run",
    "systemctl_path": "/usr/bin/systemctl",
    "useradd_path": "/usr/sbin/useradd",
}
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
GATEWAY_TIMEOUT_SECONDS = 5
WORKER_RELEASE_TIMEOUT_SECONDS = 15


class LauncherError(Exception):
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
        raise LauncherError("root-owned launcher requires effective UID/GID 0")


def require_supported_host():
    if sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED"):
        raise LauncherError("P3.4b requires Linux SO_PEERCRED")
    try:
        with open("/sys/fs/cgroup/cgroup.controllers", "rb") as source:
            source.read(1)
        with open("/proc/self/cgroup", "r", encoding="utf-8") as source:
            cgroups = source.read(8192).splitlines()
    except OSError as error:
        raise LauncherError("P3.4b requires readable unified cgroup-v2 host state") from error
    if not any(line.startswith("0::") for line in cgroups):
        raise LauncherError("P3.4b requires unified cgroup-v2 host state")


def require_plain_object(value, label):
    if not isinstance(value, dict):
        raise LauncherError(label + " must be an object")
    return value


def require_exact_keys(value, expected, label):
    value = require_plain_object(value, label)
    actual = set(value.keys())
    expected = set(expected)
    if actual != expected:
        raise LauncherError(label + " has an unexpected key set")
    return value


def require_token(value, label):
    if not isinstance(value, str) or not value or len(value) > 128:
        raise LauncherError(label + " must be a bounded protocol token")
    if any(character not in TOKEN_CHARS for character in value):
        raise LauncherError(label + " must be a bounded protocol token")
    return value


def require_sha256(value, label):
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise LauncherError(label + " must be a lowercase SHA-256 digest")
    return value


def require_nonnegative_int(value, label):
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise LauncherError(label + " must be a non-negative integer")
    return value


def require_absolute_path(value, label):
    if not isinstance(value, str) or not value.startswith("/"):
        raise LauncherError(label + " must be an absolute path")
    normalized = os.path.normpath(value)
    if normalized != value or normalized == "/":
        raise LauncherError(label + " must be a canonical non-root path")
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
        raise LauncherError(label + " cannot be resolved: " + str(error)) from error
    if resolved != path:
        raise LauncherError(label + " must not resolve through a symlink")
    for component in path_components(path):
        try:
            info = os.lstat(component)
        except OSError as error:
            raise LauncherError(label + " has an unreadable ancestor: " + str(error)) from error
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or not mode_is_private(info):
            raise LauncherError(label + " has an untrusted ancestor " + component)
    final_info = os.lstat(path)
    if directory and not stat.S_ISDIR(final_info.st_mode):
        raise LauncherError(label + " must be a directory")
    if executable and (
        not stat.S_ISREG(final_info.st_mode) or (final_info.st_mode & 0o111) == 0
    ):
        raise LauncherError(label + " must be an executable regular file")
    return path


def require_worker_traversable_root_path(path, label, executable=False):
    path = require_root_owned_path(path, label, executable=executable)
    for component in path_components(path):
        info = os.lstat(component)
        if (info.st_mode & 0o001) == 0:
            raise LauncherError(label + " is not traversable by the dedicated worker at " + component)
    return path


def resolve_root_executable(path, label):
    candidate = require_absolute_path(path, label)
    resolved = os.path.realpath(candidate)
    if resolved == "/" or not os.path.isabs(resolved):
        raise LauncherError(label + " cannot be resolved")
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
            raise OSError("short write while creating root-owned file")
        remaining = remaining[written:]


def ensure_root_directory_chain(path):
    path = require_absolute_path(path, "directory path")
    missing = []
    cursor = path
    while not os.path.exists(cursor):
        missing.append(cursor)
        cursor = os.path.dirname(cursor)
        if cursor == "/":
            break
    require_root_owned_path(cursor, "existing install parent", directory=True)
    for directory in reversed(missing):
        os.mkdir(directory, 0o755)
        os.chown(directory, 0, 0)
        os.chmod(directory, 0o755)
    require_root_owned_path(path, "install parent", directory=True)


def create_directory(path, uid, gid, mode, label, on_created=None):
    try:
        os.mkdir(path, mode)
    except FileExistsError as error:
        raise LauncherError(label + " already exists") from error
    if on_created is not None:
        on_created()
    os.chown(path, uid, gid)
    os.chmod(path, mode)


def copy_root_snapshot_file(source_path, destination_path):
    try:
        source_info = os.lstat(source_path)
    except OSError as error:
        raise LauncherError("installation source cannot be inspected: " + str(error)) from error
    if stat.S_ISLNK(source_info.st_mode) or not stat.S_ISREG(source_info.st_mode):
        raise LauncherError("installation source must be a regular non-symlink file")
    source_descriptor = os.open(source_path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        destination_descriptor = os.open(
            destination_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o755,
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
        os.fchmod(destination_descriptor, 0o755)
    finally:
        os.close(source_descriptor)
        os.close(destination_descriptor)


def require_private_worker_groups(account):
    try:
        memberships = os.getgrouplist(account.pw_name, account.pw_gid)
    except (AttributeError, OSError) as error:
        raise LauncherError("dedicated worker group membership cannot be resolved") from error
    if set(memberships) != {account.pw_gid}:
        raise LauncherError("dedicated worker must not have supplementary groups")


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


def resolve_worker(create_worker):
    try:
        account = pwd.getpwnam(WORKER_IDENTITY)
    except KeyError:
        if not create_worker:
            raise LauncherError(
                "dedicated autopilot-worker account is absent; run install with --create-worker"
            )
        useradd_path = resolve_root_executable(SYSTEM_PATHS["useradd_path"], "useradd_path")
        result = subprocess.run(
            [
                useradd_path,
                "--system",
                "--user-group",
                "--home-dir",
                "/nonexistent",
                "--shell",
                "/usr/sbin/nologin",
                WORKER_IDENTITY,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={"LANG": "C", "LC_ALL": "C", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
            check=False,
        )
        if result.returncode != 0:
            raise LauncherError("cannot create dedicated worker account: " + result.stderr.strip())
        account = pwd.getpwnam(WORKER_IDENTITY)
    if account.pw_uid == 0 or account.pw_gid == 0:
        raise LauncherError("dedicated worker account must be unprivileged")
    if account.pw_shell != "/usr/sbin/nologin" or account.pw_dir != "/nonexistent":
        raise LauncherError("dedicated worker account must be non-login")
    group = grp.getgrgid(account.pw_gid)
    if group.gr_name != WORKER_IDENTITY or group.gr_mem:
        raise LauncherError("dedicated worker primary group is not private")
    require_private_worker_groups(account)
    return {"identity": WORKER_IDENTITY, "uid": account.pw_uid, "gid": account.pw_gid}


def resolve_broker(uid, gid, worker):
    uid = require_nonnegative_int(uid, "broker uid")
    gid = require_nonnegative_int(gid, "broker gid")
    if uid == 0 or gid == 0:
        raise LauncherError("broker must be an unprivileged identity")
    if uid == worker["uid"] or gid == worker["gid"]:
        raise LauncherError("broker and worker identities must be distinct")
    try:
        account = pwd.getpwuid(uid)
    except KeyError as error:
        raise LauncherError("broker UID does not name a local account") from error
    if account.pw_gid != gid:
        raise LauncherError("broker GID must be the account primary GID")
    return {"uid": uid, "gid": gid}


def installation_material(install_root, broker, worker, paths, files):
    return {
        "schema_version": SCHEMA_VERSION,
        "install_root": install_root,
        "runtime_parent": RUNTIME_PARENT,
        "broker": broker,
        "worker": worker,
        "paths": paths,
        "files": files,
        "systemd_properties": list(SYSTEMD_PROPERTIES),
    }


def install(args):
    require_root()
    install_root = require_absolute_path(args.install_root, "install_root")
    if os.path.exists(install_root):
        raise LauncherError("install_root already exists")
    worker = resolve_worker(args.create_worker)
    broker = resolve_broker(args.broker_uid, args.broker_gid, worker)
    ensure_root_directory_chain(os.path.dirname(install_root))
    create_directory(install_root, 0, 0, 0o755, "install root")
    for relative in ("sbin", "lib", "etc"):
        create_directory(os.path.join(install_root, relative), 0, 0, 0o755, "install directory")

    source_root = os.path.dirname(os.path.realpath(__file__))
    sources = {
        "launcher": os.path.join(source_root, "supervised-host-launcher.py"),
        "helper": os.path.join(source_root, "supervised-host-peercred.py"),
        "wait_wrapper": os.path.join(source_root, "supervised-host-worker-wait.py"),
    }
    files = {}
    for name, relative in FILE_LAYOUT.items():
        destination = os.path.join(install_root, relative)
        copy_root_snapshot_file(sources[name], destination)
        require_root_owned_path(destination, name + " snapshot", executable=True)
        files[name] = {"relative_path": relative, "sha256": file_digest(destination)}

    paths = {
        key: resolve_root_executable(value, key)
        for key, value in SYSTEM_PATHS.items()
        if key != "useradd_path"
    }
    material = installation_material(install_root, broker, worker, paths, files)
    config = dict(material)
    config["binding_hash"] = sha256_value(material)
    config_path = os.path.join(install_root, CONFIG_RELATIVE_PATH)
    write_root_file(config_path, (canonical(config) + "\n").encode("utf-8"), 0o644)
    require_root_owned_path(config_path, "installed config")
    emit(
        {
            "status": "installed",
            "install_root": install_root,
            "binding_hash": config["binding_hash"],
            "worker": worker,
            "owner_kernel_authority": "none",
            "acceptance": "not_available",
        }
    )


def installed_root_from_self():
    launcher_path = os.path.realpath(__file__)
    root = os.path.dirname(os.path.dirname(launcher_path))
    expected = os.path.join(root, FILE_LAYOUT["launcher"])
    if launcher_path != expected:
        raise LauncherError("installed launcher must run from its fixed snapshot path")
    require_root_owned_path(root, "install root", directory=True)
    require_root_owned_path(launcher_path, "installed launcher", executable=True)
    return root


def load_installed_config(install_root):
    config_path = os.path.join(install_root, CONFIG_RELATIVE_PATH)
    require_root_owned_path(config_path, "installed config")
    try:
        with open(config_path, "rb") as source:
            raw = source.read(65537)
    except OSError as error:
        raise LauncherError("installed config cannot be read: " + str(error)) from error
    if len(raw) > 65536:
        raise LauncherError("installed config is too large")
    try:
        config = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LauncherError("installed config is invalid JSON") from error
    require_exact_keys(
        config,
        {
            "schema_version",
            "install_root",
            "runtime_parent",
            "broker",
            "worker",
            "paths",
            "files",
            "systemd_properties",
            "binding_hash",
        },
        "installed config",
    )
    if config["schema_version"] != SCHEMA_VERSION:
        raise LauncherError("installed config schema_version is unsupported")
    if config["install_root"] != install_root or config["runtime_parent"] != RUNTIME_PARENT:
        raise LauncherError("installed config has an unexpected root path")
    require_sha256(config["binding_hash"], "installed config binding_hash")
    material = dict(config)
    material.pop("binding_hash")
    if sha256_value(material) != config["binding_hash"]:
        raise LauncherError("installed config binding_hash does not match content")
    return config


def validate_installed_config(install_root, config):
    broker = require_exact_keys(config["broker"], {"uid", "gid"}, "installed broker")
    worker = require_exact_keys(config["worker"], {"identity", "uid", "gid"}, "installed worker")
    paths = require_exact_keys(
        config["paths"],
        {"python_path", "setpriv_path", "systemd_run_path", "systemctl_path"},
        "installed paths",
    )
    files = require_exact_keys(config["files"], set(FILE_LAYOUT.keys()), "installed files")
    if config["systemd_properties"] != list(SYSTEMD_PROPERTIES):
        raise LauncherError("installed systemd properties differ from the frozen launcher")
    worker["identity"] = require_token(worker["identity"], "worker identity")
    worker["uid"] = require_nonnegative_int(worker["uid"], "worker uid")
    worker["gid"] = require_nonnegative_int(worker["gid"], "worker gid")
    if worker["identity"] != WORKER_IDENTITY or worker["uid"] == 0 or worker["gid"] == 0:
        raise LauncherError("installed worker must be the dedicated unprivileged identity")
    broker["uid"] = require_nonnegative_int(broker["uid"], "broker uid")
    broker["gid"] = require_nonnegative_int(broker["gid"], "broker gid")
    if broker["uid"] == 0 or broker["gid"] == 0:
        raise LauncherError("installed broker must be unprivileged")
    if broker["uid"] == worker["uid"] or broker["gid"] == worker["gid"]:
        raise LauncherError("installed broker and worker identities must be distinct")
    for name, value in paths.items():
        paths[name] = require_root_owned_path(value, name, executable=True)
    for name, relative in FILE_LAYOUT.items():
        entry = require_exact_keys(files[name], {"relative_path", "sha256"}, name + " snapshot")
        if entry["relative_path"] != relative:
            raise LauncherError(name + " snapshot relative path is unexpected")
        destination = os.path.join(install_root, relative)
        require_root_owned_path(destination, name + " snapshot", executable=True)
        if name in {"helper", "wait_wrapper"}:
            require_worker_traversable_root_path(destination, name + " snapshot", executable=True)
        if file_digest(destination) != require_sha256(entry["sha256"], name + " snapshot hash"):
            raise LauncherError(name + " snapshot hash does not match installed file")
    require_worker_traversable_root_path(paths["python_path"], "python_path", executable=True)
    account = resolve_worker(False)
    if account != worker:
        raise LauncherError("dedicated worker account no longer matches installed config")
    broker_account = resolve_broker(broker["uid"], broker["gid"], worker)
    if broker_account != broker:
        raise LauncherError("broker account no longer matches installed config")
    return {"broker": broker, "worker": worker, "paths": paths, "files": files}


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
        raise LauncherError("bounded child command timed out") from error


def require_exact_directory(path, uid, gid, mode, label):
    info = os.lstat(path)
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o777) != mode
    ):
        raise LauncherError(label + " does not have the expected ownership and mode")


def ensure_runtime_parent(on_created=None):
    # The fixed parent is intentionally an exclusive per-run lease. Sharing it would
    # make one launch's cleanup race another launch's runtime tree.
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


def wait_for_main_pid(systemctl_path, unit, expected_path, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    last_value = ""
    while time.monotonic() < deadline:
        result = run_command(
            [systemctl_path, "show", "--property=MainPID", "--value", unit],
            timeout_seconds=2,
        )
        if result.returncode == 0:
            last_value = result.stdout.strip()
            if last_value.isdigit() and int(last_value) > 0:
                pid = int(last_value)
                if cgroup_v2_matches(pid, expected_path):
                    return pid
        time.sleep(0.05)
    raise LauncherError("systemd worker did not expose an expected cgroup-v2 MainPID: " + last_value)


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
    raise LauncherError("systemd unit did not reach LoadState=" + wanted + ": " + observed)


def read_gateway_ready(process, timeout_seconds):
    if process.stdout is None:
        raise LauncherError("gateway stdout is unavailable")
    ready, _, _ = select.select([process.stdout], [], [], timeout_seconds)
    if not ready:
        raise LauncherError("gateway did not report readiness before the deadline")
    line = process.stdout.readline()
    try:
        value = json.loads(line)
    except json.JSONDecodeError as error:
        raise LauncherError("gateway readiness output is invalid") from error
    if not isinstance(value, dict) or value.get("status") != "ready":
        raise LauncherError("gateway did not report ready status")
    return value


def create_release_file(path, token, worker_gid):
    if os.path.lexists(path):
        raise LauncherError("worker release path already exists")
    temporary_path = path + ".pending-" + secrets.token_hex(16)
    descriptor = os.open(
        temporary_path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o400,
    )
    temporary_exists = True
    try:
        # The worker polls the final pathname. Keep a private same-directory file
        # invisible until its token and metadata are complete, then hard-link it into
        # place so publication cannot expose an incomplete readable file.
        os.fchmod(descriptor, 0o400)
        write_all(descriptor, (token + "\n").encode("ascii"))
        os.fsync(descriptor)
        os.fchown(descriptor, 0, worker_gid)
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


def stop_and_collect_unit(systemctl_path, unit):
    command_errors = []
    for operation in ("stop", "reset-failed"):
        try:
            result = run_command([systemctl_path, operation, unit], timeout_seconds=5)
        except LauncherError as error:
            command_errors.append(operation + " timed out: " + str(error))
            continue
        if result.returncode != 0:
            command_errors.append(operation + " exit=" + str(result.returncode))
    try:
        wait_for_load_state(systemctl_path, unit, "not-found", 5)
    except LauncherError as error:
        detail = "; ".join(command_errors)
        if detail:
            detail += "; "
        raise LauncherError("systemd cleanup did not collect the exact unit: " + detail + str(error)) from error


def append_cleanup_error(errors, label, callback):
    try:
        callback()
    except (LauncherError, OSError, subprocess.TimeoutExpired) as error:
        errors.append(label + ": " + str(error))


def create_tracked_resource(resources, key, creator):
    try:
        previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    except (AttributeError, OSError, ValueError) as error:
        raise LauncherError("cannot safely create tracked runtime resource") from error
    try:
        creator(lambda: resources.__setitem__(key, True))
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)


def cleanup_path(path, expected_type):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return
    if expected_type == "file" and (stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode)):
        raise LauncherError("cleanup refused unexpected file type at " + path)
    if expected_type == "socket" and (stat.S_ISLNK(info.st_mode) or not stat.S_ISSOCK(info.st_mode)):
        raise LauncherError("cleanup refused unexpected socket type at " + path)
    if expected_type == "dir" and (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)):
        raise LauncherError("cleanup refused unexpected directory type at " + path)
    if expected_type == "dir":
        os.rmdir(path)
    else:
        os.unlink(path)


def parse_gateway_result(stdout, expected_pid, worker):
    accepted = None
    for line in stdout.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("status") == "peer_accepted":
            accepted = value
    if accepted is None:
        raise LauncherError("gateway did not report an accepted peer")
    if (
        accepted.get("pid") != expected_pid
        or accepted.get("uid") != worker["uid"]
        or accepted.get("gid") != worker["gid"]
    ):
        raise LauncherError("gateway accepted an unexpected peer identity")
    return accepted


def run_probe():
    require_root()
    install_root = installed_root_from_self()
    config = load_installed_config(install_root)
    validated = validate_installed_config(install_root, config)
    require_supported_host()
    broker = validated["broker"]
    worker = validated["worker"]
    paths = validated["paths"]
    helper_path = os.path.join(install_root, FILE_LAYOUT["helper"])
    wait_wrapper_path = os.path.join(install_root, FILE_LAYOUT["wait_wrapper"])

    service_unit = "autopilot-p34-" + secrets.token_hex(16) + ".service"
    run_id = "p34b-" + secrets.token_hex(12)
    invocation_id = "p34b-invocation-" + secrets.token_hex(12)
    nonce = secrets.token_urlsafe(24).rstrip("=")
    nonce_hash = sha256_value(nonce)
    cgroup_path = "/system.slice/" + service_unit
    plan_hash = sha256_value(
        {
            "schema_version": SCHEMA_VERSION,
            "install_binding_hash": config["binding_hash"],
            "run_id": run_id,
            "invocation_id": invocation_id,
            "service_unit": service_unit,
            "nonce_hash": nonce_hash,
        }
    )
    binding_hash = sha256_value(
        {
            "schema_version": SCHEMA_VERSION,
            "install_binding_hash": config["binding_hash"],
            "run_id": run_id,
            "invocation_id": invocation_id,
            "service_unit": service_unit,
            "plan_hash": plan_hash,
            "nonce_hash": nonce_hash,
            "broker": broker,
            "worker": worker,
            "cgroup_path": cgroup_path,
            "systemd_properties": list(SYSTEMD_PROPERTIES),
        }
    )
    runtime_root = os.path.join(RUNTIME_PARENT, service_unit)
    state_root = os.path.join(runtime_root, "state")
    socket_root = os.path.join(runtime_root, "socket")
    socket_path = os.path.join(socket_root, "worker.sock")
    release_path = os.path.join(runtime_root, "worker-release")
    release_token = secrets.token_urlsafe(24).rstrip("=")
    created_resources = {
        "parent": False,
        "runtime_root": False,
        "state_root": False,
        "socket_root": False,
    }
    release_may_exist = False
    unit_may_exist = False
    gateway = None
    previous_handlers = {}

    def interrupt_handler(_signum, _frame):
        raise LauncherError("launcher interrupted before completion")

    for signal_number in (signal.SIGINT, signal.SIGTERM):
        previous_handlers[signal_number] = signal.signal(signal_number, interrupt_handler)

    try:
        create_tracked_resource(created_resources, "parent", ensure_runtime_parent)
        create_tracked_resource(
            created_resources,
            "runtime_root",
            lambda on_created: create_directory(
                runtime_root, 0, worker["gid"], 0o710, "runtime root", on_created
            ),
        )
        create_tracked_resource(
            created_resources,
            "state_root",
            lambda on_created: create_directory(state_root, 0, 0, 0o700, "state root", on_created),
        )
        create_tracked_resource(
            created_resources,
            "socket_root",
            lambda on_created: create_directory(
                socket_root, broker["uid"], worker["gid"], 0o710, "socket root", on_created
            ),
        )
        worker_command = [
            paths["python_path"],
            "-I",
            wait_wrapper_path,
            "--release-path",
            release_path,
            "--release-token",
            release_token,
            "--python-path",
            paths["python_path"],
            "--helper-path",
            helper_path,
            "--socket",
            socket_path,
            "--expected-worker-uid",
            str(worker["uid"]),
            "--expected-worker-gid",
            str(worker["gid"]),
            "--expected-server-uid",
            str(broker["uid"]),
            "--expected-server-gid",
            str(broker["gid"]),
            "--expected-socket-gid",
            str(worker["gid"]),
            "--binding-hash",
            binding_hash,
            "--run-id",
            run_id,
            "--invocation-id",
            invocation_id,
            "--plan-hash",
            plan_hash,
            "--nonce",
            nonce,
            "--release-timeout-seconds",
            str(WORKER_RELEASE_TIMEOUT_SECONDS),
            "--timeout-seconds",
            str(GATEWAY_TIMEOUT_SECONDS),
        ]
        systemd_command = [
            paths["systemd_run_path"],
            "--no-block",
            "--quiet",
            "--collect",
            "--unit=" + service_unit,
            "--slice=system.slice",
            "--uid=" + str(worker["uid"]),
            "--gid=" + str(worker["gid"]),
        ] + ["--property=" + property for property in SYSTEMD_PROPERTIES] + worker_command
        # systemd may accept the D-Bus request before the client times out or loses its
        # response, so every invocation is treated as a possible created unit.
        unit_may_exist = True
        started = run_command(systemd_command, timeout_seconds=10)
        if started.returncode != 0:
            raise LauncherError("systemd worker launch failed: " + started.stderr.strip())
        expected_pid = wait_for_main_pid(
            paths["systemctl_path"], service_unit, cgroup_path, GATEWAY_TIMEOUT_SECONDS
        )

        gateway_command = [
            paths["setpriv_path"],
            "--reset-env",
            "--nnp",
            "--reuid=" + str(broker["uid"]),
            "--regid=" + str(broker["gid"]),
            "--groups=" + str(broker["gid"]) + "," + str(worker["gid"]),
            paths["python_path"],
            "-I",
            helper_path,
            "serve",
            "--socket",
            socket_path,
            "--expected-uid",
            str(worker["uid"]),
            "--expected-gid",
            str(worker["gid"]),
            "--expected-pid",
            str(expected_pid),
            "--expected-cgroup-path",
            cgroup_path,
            "--require-unified-cgroup-v2",
            "--broker-uid",
            str(broker["uid"]),
            "--broker-gid",
            str(broker["gid"]),
            "--socket-gid",
            str(worker["gid"]),
            "--run-id",
            run_id,
            "--invocation-id",
            invocation_id,
            "--plan-hash",
            plan_hash,
            "--nonce-hash",
            nonce_hash,
            "--binding-hash",
            binding_hash,
            "--timeout-seconds",
            str(GATEWAY_TIMEOUT_SECONDS),
        ]
        gateway = subprocess.Popen(
            gateway_command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={"LANG": "C", "LC_ALL": "C", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
        )
        ready = read_gateway_ready(gateway, GATEWAY_TIMEOUT_SECONDS)
        if (
            ready.get("gateway_uid") != broker["uid"]
            or ready.get("gateway_gid") != broker["gid"]
            or ready.get("socket_gid") != worker["gid"]
        ):
            raise LauncherError("gateway readiness did not echo the frozen identities")
        release_may_exist = True
        create_release_file(release_path, release_token, worker["gid"])
        try:
            gateway_stdout, gateway_stderr = gateway.communicate(
                timeout=GATEWAY_TIMEOUT_SECONDS * 2
            )
        except subprocess.TimeoutExpired as error:
            gateway.kill()
            gateway.communicate()
            raise LauncherError("gateway did not finish after releasing worker") from error
        if gateway.returncode != 0:
            raise LauncherError("gateway rejected the released worker: " + gateway_stderr.strip())
        accepted = parse_gateway_result(gateway_stdout, expected_pid, worker)
        wait_for_load_state(
            paths["systemctl_path"], service_unit, "not-found", GATEWAY_TIMEOUT_SECONDS
        )
        return {
            "status": "p34b_probe_complete",
            "schema_version": SCHEMA_VERSION,
            "service_unit": service_unit,
            "broker": broker,
            "peer": {
                "pid": expected_pid,
                "uid": worker["uid"],
                "gid": worker["gid"],
            },
            "receipt_hash": require_sha256(accepted.get("receipt_hash"), "gateway receipt_hash"),
            "binding_hash": binding_hash,
            "install_binding_hash": config["binding_hash"],
            "owner_kernel_authority": "none",
            "acceptance": "not_available",
        }
    finally:
        cleanup_errors = []
        if gateway is not None and gateway.poll() is None:
            def stop_gateway():
                gateway.terminate()
                try:
                    gateway.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    gateway.kill()
                    gateway.wait(timeout=2)

            append_cleanup_error(cleanup_errors, "gateway", stop_gateway)
        if unit_may_exist:
            append_cleanup_error(
                cleanup_errors,
                "systemd unit",
                lambda: stop_and_collect_unit(paths["systemctl_path"], service_unit),
            )
        if created_resources["socket_root"]:
            append_cleanup_error(cleanup_errors, "gateway socket", lambda: cleanup_path(socket_path, "socket"))
        if release_may_exist:
            append_cleanup_error(cleanup_errors, "worker release", lambda: cleanup_path(release_path, "file"))
        if created_resources["socket_root"]:
            append_cleanup_error(cleanup_errors, "socket root", lambda: cleanup_path(socket_root, "dir"))
        if created_resources["state_root"]:
            append_cleanup_error(cleanup_errors, "state root", lambda: cleanup_path(state_root, "dir"))
        if created_resources["runtime_root"]:
            append_cleanup_error(cleanup_errors, "runtime root", lambda: cleanup_path(runtime_root, "dir"))
        if created_resources["parent"]:
            append_cleanup_error(cleanup_errors, "runtime parent", lambda: cleanup_path(RUNTIME_PARENT, "dir"))
        for signal_number, previous_handler in previous_handlers.items():
            signal.signal(signal_number, previous_handler)
        if cleanup_errors:
            raise LauncherError("launcher cleanup failed: " + "; ".join(cleanup_errors))


def parser():
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    install_parser = commands.add_parser("install")
    install_parser.add_argument("--install-root", required=True)
    install_parser.add_argument("--broker-uid", required=True, type=int)
    install_parser.add_argument("--broker-gid", required=True, type=int)
    install_parser.add_argument("--create-worker", action="store_true")
    install_parser.set_defaults(handler=install)
    run_parser = commands.add_parser("run")
    run_parser.set_defaults(handler=lambda _args: emit(run_probe()))
    return root


def main():
    try:
        args = parser().parse_args()
        args.handler(args)
        return 0
    except LauncherError as error:
        sys.stderr.write("supervised-host-launcher: " + str(error) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
