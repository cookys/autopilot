#!/usr/bin/python3 -I
"""Root-held P3.5c workspace descriptor registry.

The registry owns only already-open Linux directory descriptors. It never
stores a workspace path, reopens a path, invokes Git, or passes a descriptor
to a worker, verifier, witness, or Engine. A registration is deliberately
memory-only: daemon restart closes every descriptor and makes all leases
unrecoverable.
"""

import argparse
import array
import ctypes
import errno
import fcntl
import hashlib
import json
import os
import platform
import select
import signal
import socket
import stat
import sys
import time
import uuid


SCHEMA_VERSION = 1
REGISTRY_PROTOCOL_VERSION = 1
MAX_PACKET_BYTES = 16384
MAX_REGISTRATIONS = 64
MAX_REGISTRATION_TTL_MILLISECONDS = 60 * 60 * 1000
MIN_REGISTRATION_TTL_MILLISECONDS = 1000
DEFAULT_REGISTRATION_TTL_MILLISECONDS = 10 * 60 * 1000
SOCKET_TIMEOUT_SECONDS = 5
REGISTRY_LOCK_FILENAME = "registry.lock"
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
SHA256_CHARS = frozenset("0123456789abcdef")
GIT_SHA_CHARS = frozenset("0123456789abcdef")
AT_FDCWD = -100
AT_EMPTY_PATH = 0x1000
RESOLVE_NO_MAGICLINKS = 0x02
RESOLVE_NO_SYMLINKS = 0x04
STATX_TYPE = 0x0001
STATX_MODE = 0x0002
STATX_NLINK = 0x0004
STATX_UID = 0x0008
STATX_GID = 0x0010
STATX_INO = 0x0100
STATX_MNT_ID = 0x1000


class WorkspaceRegistryError(Exception):
    pass


class OpenHow(ctypes.Structure):
    _fields_ = [
        ("flags", ctypes.c_uint64),
        ("mode", ctypes.c_uint64),
        ("resolve", ctypes.c_uint64),
    ]


class StatxTimestamp(ctypes.Structure):
    _fields_ = [
        ("tv_sec", ctypes.c_int64),
        ("tv_nsec", ctypes.c_uint32),
        ("__reserved", ctypes.c_int32),
    ]


class Statx(ctypes.Structure):
    _fields_ = [
        ("stx_mask", ctypes.c_uint32),
        ("stx_blksize", ctypes.c_uint32),
        ("stx_attributes", ctypes.c_uint64),
        ("stx_nlink", ctypes.c_uint32),
        ("stx_uid", ctypes.c_uint32),
        ("stx_gid", ctypes.c_uint32),
        ("stx_mode", ctypes.c_uint16),
        ("__spare0", ctypes.c_uint16),
        ("stx_ino", ctypes.c_uint64),
        ("stx_size", ctypes.c_uint64),
        ("stx_blocks", ctypes.c_uint64),
        ("stx_attributes_mask", ctypes.c_uint64),
        ("stx_atime", StatxTimestamp),
        ("stx_btime", StatxTimestamp),
        ("stx_ctime", StatxTimestamp),
        ("stx_mtime", StatxTimestamp),
        ("stx_rdev_major", ctypes.c_uint32),
        ("stx_rdev_minor", ctypes.c_uint32),
        ("stx_dev_major", ctypes.c_uint32),
        ("stx_dev_minor", ctypes.c_uint32),
        ("stx_mnt_id", ctypes.c_uint64),
        ("stx_dio_mem_align", ctypes.c_uint32),
        ("stx_dio_offset_align", ctypes.c_uint32),
        ("__spare3", ctypes.c_uint64 * 12),
    ]


def fail(message):
    raise WorkspaceRegistryError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_value(value):
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def require_plain_object(value, label):
    if not isinstance(value, dict):
        fail(label + " must be an object")
    return value


def require_exact_keys(value, expected, label):
    value = require_plain_object(value, label)
    if set(value) != set(expected):
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


def require_git_sha(value, label):
    if (
        not isinstance(value, str)
        or len(value) != 40
        or any(character not in GIT_SHA_CHARS for character in value)
    ):
        fail(label + " must be a lowercase full 40-character Git SHA")
    return value


def require_nonnegative_int(value, label, minimum=0, maximum=None):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        fail(label + " must be a bounded integer")
    if maximum is not None and value > maximum:
        fail(label + " must be a bounded integer")
    return value


def require_absolute_path(value, label):
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or value.startswith("//")
        or value == "/"
        or os.path.normpath(value) != value
        or "\x00" in value
    ):
        fail(label + " must be a canonical non-root absolute path")
    return value


def require_linux():
    if sys.platform != "linux":
        fail("P3.5c workspace registry requires Linux")
    if not hasattr(socket, "SO_PEERCRED") or not hasattr(socket, "SOCK_SEQPACKET"):
        fail("P3.5c workspace registry requires Linux peer credentials and SOCK_SEQPACKET")
    if not hasattr(os, "O_PATH") or not hasattr(os, "O_NOFOLLOW"):
        fail("P3.5c workspace registry requires O_PATH and O_NOFOLLOW")


def syscall_numbers():
    machine = platform.machine().lower()
    # These three Linux architectures use the generic syscall numbers. Refuse
    # unknown ABIs rather than silently using an architecture-specific number.
    if machine not in {"x86_64", "amd64", "aarch64", "arm64", "riscv64"}:
        fail("P3.5c workspace registry does not know this Linux syscall ABI")
    return {"statx": 332, "openat2": 437}


LIBC = ctypes.CDLL(None, use_errno=True)


def linux_syscall(number, *arguments):
    result = LIBC.syscall(number, *arguments)
    if result == -1:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    return result


def openat2_directory(path):
    """Open one canonical directory without following a symlink or magic link."""
    require_linux()
    path = require_absolute_path(path, "workspace registration path")
    how = OpenHow(
        flags=os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
        mode=0,
        resolve=RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS,
    )
    try:
        descriptor = linux_syscall(
            syscall_numbers()["openat2"],
            AT_FDCWD,
            ctypes.c_char_p(path.encode("utf-8")),
            ctypes.byref(how),
            ctypes.sizeof(how),
        )
    except OSError as error:
        if error.errno in {errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP}:
            fail("P3.5c workspace registration requires openat2 without fallback")
        fail("workspace registration directory cannot be opened safely: " + str(error))
    return descriptor


def statx_descriptor(descriptor):
    require_linux()
    value = Statx()
    mask = STATX_TYPE | STATX_MODE | STATX_NLINK | STATX_UID | STATX_GID | STATX_INO | STATX_MNT_ID
    try:
        linux_syscall(
            syscall_numbers()["statx"],
            descriptor,
            ctypes.c_char_p(b""),
            AT_EMPTY_PATH,
            mask,
            ctypes.byref(value),
        )
    except OSError as error:
        if error.errno in {errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP}:
            fail("P3.5c workspace registration requires statx mount identity without fallback")
        fail("workspace descriptor statx failed: " + str(error))
    if (value.stx_mask & mask) != mask:
        fail("workspace descriptor statx did not return the required identity fields")
    return {
        "mode": value.stx_mode,
        "uid": value.stx_uid,
        "gid": value.stx_gid,
        "inode": value.stx_ino,
        "device_major": value.stx_dev_major,
        "device_minor": value.stx_dev_minor,
        "mount_id": value.stx_mnt_id,
        "nlink": value.stx_nlink,
    }


def descriptor_path_from_fd(descriptor):
    try:
        value = os.readlink("/proc/self/fd/" + str(descriptor))
    except OSError as error:
        fail("workspace descriptor cannot expose a Linux FD path: " + str(error))
    if value.endswith(" (deleted)"):
        fail("workspace descriptor refers to a deleted directory")
    return require_absolute_path(value, "workspace descriptor kernel path")


def inspect_workspace_descriptor(descriptor):
    require_linux()
    if not isinstance(descriptor, int) or descriptor < 0:
        fail("workspace descriptor is invalid")
    try:
        flags = fcntl.fcntl(descriptor, fcntl.F_GETFL)
        info = os.fstat(descriptor)
    except OSError as error:
        fail("workspace descriptor cannot be inspected: " + str(error))
    if (flags & os.O_PATH) != os.O_PATH or not stat.S_ISDIR(info.st_mode):
        fail("workspace descriptor is not an O_PATH directory")
    facts = statx_descriptor(descriptor)
    if not stat.S_ISDIR(facts["mode"]):
        fail("workspace descriptor statx is not a directory")
    kernel_path = descriptor_path_from_fd(descriptor)
    workspace_root_hash = sha256_value(kernel_path)
    fingerprint = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p35_workspace_descriptor_fingerprint",
        "workspace_root_hash": workspace_root_hash,
        "mode": facts["mode"],
        "uid": facts["uid"],
        "gid": facts["gid"],
        "inode": facts["inode"],
        "device_major": facts["device_major"],
        "device_minor": facts["device_minor"],
        "mount_id": facts["mount_id"],
        "nlink": facts["nlink"],
    }
    return {
        "workspace_root_hash": workspace_root_hash,
        "descriptor_fingerprint_hash": sha256_value(canonical(fingerprint)),
        "facts": facts,
    }


def open_workspace_descriptor(path):
    descriptor = openat2_directory(path)
    try:
        inspection = inspect_workspace_descriptor(descriptor)
        return descriptor, inspection
    except Exception:
        os.close(descriptor)
        raise


def peer_credentials(connection):
    try:
        raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        values = array.array("i")
        values.frombytes(raw)
        if len(values) != 3:
            fail("workspace registry peer credential length is invalid")
        return tuple(int(value) for value in values)
    except (OSError, ValueError) as error:
        fail("workspace registry cannot read peer credentials: " + str(error))


def parse_canonical_packet(raw, label):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_PACKET_BYTES:
        fail(label + " has an invalid size")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(label + " is not UTF-8 JSON: " + str(error))
    if canonical(value) != text:
        fail(label + " is not canonical JSON")
    return value


def send_packet(connection, value, descriptor=None):
    content = canonical(value).encode("utf-8")
    if not content or len(content) > MAX_PACKET_BYTES:
        fail("workspace registry response exceeds the fixed byte limit")
    ancillary = []
    if descriptor is not None:
        ancillary.append((socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [descriptor])))
    try:
        written = connection.sendmsg([content], ancillary)
    except OSError as error:
        fail("workspace registry socket write failed: " + str(error))
    if written != len(content):
        fail("workspace registry socket write was short")


def close_descriptors(descriptors):
    for descriptor in descriptors:
        try:
            os.close(descriptor)
        except OSError:
            pass


def receive_packet(connection, label):
    descriptors = []
    try:
        raw, ancillary, flags, _address = connection.recvmsg(
            MAX_PACKET_BYTES + 1,
            socket.CMSG_SPACE(array.array("i", [0, 0, 0, 0]).itemsize * 4),
            getattr(socket, "MSG_CMSG_CLOEXEC", 0),
        )
    except OSError as error:
        fail(label + " socket read failed: " + str(error))
    try:
        # Collect every received SCM_RIGHTS descriptor before validating the
        # frame. Any subsequent rejection must close all kernel-delivered FDs.
        for level, kind, content in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                integers = array.array("i")
                full_length = len(content) - (len(content) % integers.itemsize)
                if full_length:
                    integers.frombytes(content[:full_length])
                    descriptors.extend(integers.tolist())
        if flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC):
            fail(label + " packet is truncated")
        for level, kind, content in ancillary:
            if level != socket.SOL_SOCKET or kind != socket.SCM_RIGHTS:
                fail(label + " contains unsupported ancillary data")
            if len(content) % array.array("i").itemsize:
                fail(label + " has malformed descriptor ancillary data")
        return parse_canonical_packet(raw, label), descriptors
    except Exception:
        close_descriptors(descriptors)
        raise


def require_root_private_directory(path, label):
    path = require_absolute_path(path, label)
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != 0
        or (info.st_mode & 0o7777) != 0o700
    ):
        fail(label + " does not have root-private ownership and mode")
    return path


def root_socket_identity(path, label):
    path = require_absolute_path(path, label)
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISSOCK(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != 0
        or (info.st_mode & 0o7777) != 0o600
    ):
        fail(label + " does not have root-private ownership and mode")
    return info.st_dev, info.st_ino


def require_root_socket(path, label):
    root_socket_identity(path, label)
    return path


def descriptor_binding_hash(record, registry_instance_id, install_binding_hash):
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p35_workspace_descriptor_binding",
        "install_binding_hash": require_sha256(install_binding_hash, "install binding"),
        "registry_instance_id": require_token(registry_instance_id, "registry instance"),
        "registration_id": require_token(record["registration_id"], "registration id"),
        "workspace_root_hash": require_sha256(record["workspace_root_hash"], "workspace root hash"),
        "immutable_base": require_git_sha(record["immutable_base"], "immutable base"),
        "descriptor_fingerprint_hash": require_sha256(
            record["descriptor_fingerprint_hash"], "descriptor fingerprint"
        ),
    }
    return sha256_value(canonical(material))


class WorkspaceDescriptorRegistry:
    """In-memory root descriptor leases with no path persistence or reopen path."""

    def __init__(self, install_binding_hash, now=None, instance_id=None):
        self.install_binding_hash = require_sha256(install_binding_hash, "registry install binding")
        self.now = now if now is not None else lambda: int(time.time() * 1000)
        self.instance_id = require_token(
            instance_id if instance_id is not None else "p35-registry-" + uuid.uuid4().hex,
            "registry instance id",
        )
        self.records = {}

    def close_all(self):
        for record in list(self.records.values()):
            try:
                os.close(record["descriptor"])
            except OSError:
                pass
        self.records.clear()

    def _discard(self, registration_id):
        record = self.records.pop(registration_id, None)
        if record is not None:
            try:
                os.close(record["descriptor"])
            except OSError:
                pass

    def _reap_expired(self):
        now = self.now()
        for registration_id, record in list(self.records.items()):
            if now >= record["expires_at_ms"]:
                self._discard(registration_id)

    def _record(self, registration_id):
        self._reap_expired()
        record = self.records.get(registration_id)
        if record is None:
            fail("workspace registration is unavailable or expired")
        return record

    def _verify_held_descriptor(self, record):
        try:
            current = inspect_workspace_descriptor(record["descriptor"])
        except WorkspaceRegistryError:
            self._discard(record["registration_id"])
            raise
        if (
            current["workspace_root_hash"] != record["workspace_root_hash"]
            or current["descriptor_fingerprint_hash"] != record["descriptor_fingerprint_hash"]
        ):
            self._discard(record["registration_id"])
            fail("root-held workspace descriptor changed after registration")
        return current

    def register(self, registration_id, immutable_base, ttl_milliseconds, descriptor):
        registration_id = require_token(registration_id, "workspace registration id")
        immutable_base = require_git_sha(immutable_base, "workspace registration immutable base")
        ttl_milliseconds = require_nonnegative_int(
            ttl_milliseconds,
            "workspace registration TTL",
            MIN_REGISTRATION_TTL_MILLISECONDS,
            MAX_REGISTRATION_TTL_MILLISECONDS,
        )
        self._reap_expired()
        if registration_id in self.records:
            fail("workspace registration id is already live")
        if len(self.records) >= MAX_REGISTRATIONS:
            fail("workspace registry has reached its fixed descriptor limit")
        inspection = inspect_workspace_descriptor(descriptor)
        expires_at_ms = self.now() + ttl_milliseconds
        record = {
            "registration_id": registration_id,
            "immutable_base": immutable_base,
            "workspace_root_hash": inspection["workspace_root_hash"],
            "descriptor_fingerprint_hash": inspection["descriptor_fingerprint_hash"],
            "descriptor": descriptor,
            "expires_at_ms": expires_at_ms,
            "state": "available",
            "session_id": None,
            "session_challenge_hash": None,
            "ticket_hash": None,
        }
        record["descriptor_binding_hash"] = descriptor_binding_hash(
            record, self.instance_id, self.install_binding_hash
        )
        self.records[registration_id] = record
        return {
            "schema_version": SCHEMA_VERSION,
            "status": "registered",
            "registry_instance_id": self.instance_id,
            "registration_id": registration_id,
            "workspace_root_hash": record["workspace_root_hash"],
            "immutable_base": immutable_base,
            "descriptor_binding_hash": record["descriptor_binding_hash"],
            "expires_at_ms": expires_at_ms,
        }

    def reserve(self, registration_id, session_id, session_challenge_hash, install_binding_hash, expires_at_ms):
        registration_id = require_token(registration_id, "workspace reservation registration id")
        session_id = require_token(session_id, "workspace reservation session id")
        session_challenge_hash = require_sha256(
            session_challenge_hash, "workspace reservation session challenge"
        )
        install_binding_hash = require_sha256(
            install_binding_hash, "workspace reservation install binding"
        )
        expires_at_ms = require_nonnegative_int(expires_at_ms, "workspace reservation expiry", 1)
        if install_binding_hash != self.install_binding_hash:
            fail("workspace reservation does not match the installed host")
        record = self._record(registration_id)
        if record["state"] != "available":
            fail("workspace registration is already reserved")
        if expires_at_ms > record["expires_at_ms"] or self.now() >= expires_at_ms:
            fail("workspace registration cannot cover the requested session lifetime")
        self._verify_held_descriptor(record)
        material = {
            "schema_version": SCHEMA_VERSION,
            "kind": "p35_workspace_descriptor_ticket",
            "install_binding_hash": self.install_binding_hash,
            "registry_instance_id": self.instance_id,
            "registration_id": registration_id,
            "workspace_root_hash": record["workspace_root_hash"],
            "immutable_base": record["immutable_base"],
            "descriptor_fingerprint_hash": record["descriptor_fingerprint_hash"],
            "descriptor_binding_hash": record["descriptor_binding_hash"],
            "session_id": session_id,
            "session_challenge_hash": session_challenge_hash,
            "expires_at_ms": expires_at_ms,
        }
        ticket_hash = sha256_value(canonical(material))
        ticket = dict(material)
        ticket["ticket_hash"] = ticket_hash
        record["state"] = "reserved"
        record["session_id"] = session_id
        record["session_challenge_hash"] = session_challenge_hash
        record["ticket_hash"] = ticket_hash
        return {
            "schema_version": SCHEMA_VERSION,
            "status": "reserved",
            "ticket": ticket,
        }

    def assert_reserved(self, registration_id, session_id, ticket_hash):
        registration_id = require_token(registration_id, "workspace assertion registration id")
        session_id = require_token(session_id, "workspace assertion session id")
        ticket_hash = require_sha256(ticket_hash, "workspace assertion ticket hash")
        record = self._record(registration_id)
        if (
            record["state"] != "reserved"
            or record["session_id"] != session_id
            or record["ticket_hash"] != ticket_hash
        ):
            fail("workspace descriptor reservation does not match the session")
        self._verify_held_descriptor(record)
        return {
            "schema_version": SCHEMA_VERSION,
            "status": "reserved",
            "registration_id": registration_id,
            "session_id": session_id,
            "ticket_hash": ticket_hash,
        }

    def complete(self, registration_id, session_id, ticket_hash):
        result = self.assert_reserved(registration_id, session_id, ticket_hash)
        self._discard(registration_id)
        return {
            "schema_version": SCHEMA_VERSION,
            "status": "completed",
            "registration_id": result["registration_id"],
            "session_id": result["session_id"],
            "ticket_hash": result["ticket_hash"],
        }

    def release(self, registration_id, session_id, ticket_hash):
        registration_id = require_token(registration_id, "workspace release registration id")
        session_id = require_token(session_id, "workspace release session id")
        ticket_hash = require_sha256(ticket_hash, "workspace release ticket hash")
        record = self._record(registration_id)
        if (
            record["state"] != "reserved"
            or record["session_id"] != session_id
            or record["ticket_hash"] != ticket_hash
        ):
            fail("workspace descriptor release does not match the session")
        self._discard(registration_id)
        return {
            "schema_version": SCHEMA_VERSION,
            "status": "released",
            "registration_id": registration_id,
            "session_id": session_id,
            "ticket_hash": ticket_hash,
        }


def normalize_request(value):
    value = require_exact_keys(value, {"schema_version", "op", "request"}, "workspace registry request")
    if value["schema_version"] != REGISTRY_PROTOCOL_VERSION:
        fail("workspace registry request schema_version is unsupported")
    op = value["op"]
    if op not in {"register", "reserve", "assert_reserved", "complete", "release"}:
        fail("workspace registry request operation is unsupported")
    return op, require_plain_object(value["request"], "workspace registry request body")


def normalize_register_request(value):
    value = require_exact_keys(
        value,
        {"registration_id", "immutable_base", "ttl_milliseconds"},
        "workspace registry register request",
    )
    return {
        "registration_id": require_token(value["registration_id"], "workspace registry registration id"),
        "immutable_base": require_git_sha(value["immutable_base"], "workspace registry immutable base"),
        "ttl_milliseconds": require_nonnegative_int(
            value["ttl_milliseconds"],
            "workspace registry TTL",
            MIN_REGISTRATION_TTL_MILLISECONDS,
            MAX_REGISTRATION_TTL_MILLISECONDS,
        ),
    }


def normalize_reserve_request(value):
    value = require_exact_keys(
        value,
        {"registration_id", "session_id", "session_challenge_hash", "install_binding_hash", "expires_at_ms"},
        "workspace registry reserve request",
    )
    return {
        "registration_id": require_token(value["registration_id"], "workspace registry registration id"),
        "session_id": require_token(value["session_id"], "workspace registry session id"),
        "session_challenge_hash": require_sha256(
            value["session_challenge_hash"], "workspace registry session challenge"
        ),
        "install_binding_hash": require_sha256(
            value["install_binding_hash"], "workspace registry install binding"
        ),
        "expires_at_ms": require_nonnegative_int(value["expires_at_ms"], "workspace registry expiry", 1),
    }


def normalize_assertion_request(value, label):
    value = require_exact_keys(
        value,
        {"registration_id", "session_id", "ticket_hash"},
        label,
    )
    return {
        "registration_id": require_token(value["registration_id"], label + " registration id"),
        "session_id": require_token(value["session_id"], label + " session id"),
        "ticket_hash": require_sha256(value["ticket_hash"], label + " ticket hash"),
    }


class WorkspaceRegistryServer:
    def __init__(self, state_root, socket_path, install_binding_hash):
        require_linux()
        self.state_root = require_root_private_directory(state_root, "workspace registry state root")
        self.socket_path = require_absolute_path(socket_path, "workspace registry socket")
        if os.path.dirname(self.socket_path) != self.state_root:
            fail("workspace registry socket must live directly below its root")
        self.registry = WorkspaceDescriptorRegistry(install_binding_hash)
        self.listener = None
        self.lock_descriptor = None
        self.socket_identity = None
        self.stopping = False

    def _acquire_instance_lock(self):
        if self.lock_descriptor is not None:
            fail("workspace registry instance is already started")
        lock_path = os.path.join(self.state_root, REGISTRY_LOCK_FILENAME)
        flags = os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW
        created = False
        try:
            descriptor = os.open(lock_path, flags | os.O_CREAT | os.O_EXCL, 0o600)
            created = True
        except FileExistsError:
            try:
                descriptor = os.open(lock_path, flags)
            except OSError as error:
                fail("workspace registry instance lock cannot be opened: " + str(error))
        except OSError as error:
            fail("workspace registry instance lock cannot be created: " + str(error))
        try:
            if created:
                os.fchown(descriptor, 0, 0)
                os.fchmod(descriptor, 0o600)
            info = os.fstat(descriptor)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != 0
                or info.st_gid != 0
                or info.st_nlink != 1
                or (info.st_mode & 0o7777) != 0o600
            ):
                fail("workspace registry instance lock does not have root-private ownership and mode")
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                if error.errno in (errno.EACCES, errno.EAGAIN):
                    fail("workspace registry instance lock is already held")
                fail("workspace registry instance lock cannot be acquired: " + str(error))
            self.lock_descriptor = descriptor
        except Exception:
            os.close(descriptor)
            raise

    def _release_instance_lock(self):
        descriptor = self.lock_descriptor
        self.lock_descriptor = None
        if descriptor is None:
            return
        try:
            os.close(descriptor)
        except OSError as error:
            fail("workspace registry instance lock cleanup failed: " + str(error))

    def _unlink_owned_socket(self):
        expected_identity = self.socket_identity
        if expected_identity is None:
            return
        try:
            actual_identity = root_socket_identity(self.socket_path, "workspace registry socket")
        except WorkspaceRegistryError:
            self.socket_identity = None
            raise
        if actual_identity != expected_identity:
            # A different root-owned service owns this pathname now. Never
            # remove it during this instance's teardown.
            self.socket_identity = None
            return
        try:
            os.unlink(self.socket_path)
        except FileNotFoundError:
            pass
        except OSError as error:
            fail("workspace registry socket cleanup failed: " + str(error))
        finally:
            self.socket_identity = None

    def start(self):
        if os.geteuid() != 0 or os.getegid() != 0 or set(os.getgroups()) != {0}:
            fail("workspace registry must run with the exact root identity")
        self._acquire_instance_lock()
        listener = None
        try:
            if os.path.lexists(self.socket_path):
                fail("workspace registry socket path already exists")
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
            listener.bind(self.socket_path)
            socket_info = os.lstat(self.socket_path)
            if stat.S_ISLNK(socket_info.st_mode) or not stat.S_ISSOCK(socket_info.st_mode):
                fail("workspace registry bind did not create a Unix socket")
            self.socket_identity = (socket_info.st_dev, socket_info.st_ino)
            os.chown(self.socket_path, 0, 0)
            os.chmod(self.socket_path, 0o600)
            require_root_socket(self.socket_path, "workspace registry socket")
            listener.listen(16)
            listener.setblocking(False)
            self.listener = listener
        except Exception:
            try:
                self._unlink_owned_socket()
            except WorkspaceRegistryError:
                pass
            if listener is not None:
                listener.close()
            self._release_instance_lock()
            raise

    def stop(self):
        self.stopping = True
        try:
            # Remove this instance's pathname while its listener and singleton
            # lock are still held. A failed peer instance has no identity and
            # therefore cannot unlink this listener during its own finally.
            self._unlink_owned_socket()
        finally:
            try:
                if self.listener is not None:
                    self.listener.close()
                    self.listener = None
            finally:
                try:
                    self.registry.close_all()
                finally:
                    self._release_instance_lock()

    def handle_connection(self, connection):
        descriptors = []
        try:
            # Credential validation intentionally happens before recvmsg/body parsing.
            pid, uid, gid = peer_credentials(connection)
            if pid <= 0 or uid != 0 or gid != 0:
                fail("workspace registry rejected a non-root peer")
            value, descriptors = receive_packet(connection, "workspace registry request")
            op, request = normalize_request(value)
            if op == "register":
                if len(descriptors) != 1:
                    fail("workspace registry register request must carry exactly one descriptor")
                normalized = normalize_register_request(request)
                response = self.registry.register(descriptor=descriptors[0], **normalized)
                descriptors = []  # Registry now owns the accepted descriptor.
            else:
                if descriptors:
                    fail("workspace registry non-register request must not carry a descriptor")
                if op == "reserve":
                    response = self.registry.reserve(**normalize_reserve_request(request))
                elif op == "assert_reserved":
                    response = self.registry.assert_reserved(
                        **normalize_assertion_request(request, "workspace registry assertion request")
                    )
                elif op == "complete":
                    response = self.registry.complete(
                        **normalize_assertion_request(request, "workspace registry completion request")
                    )
                else:
                    response = self.registry.release(
                        **normalize_assertion_request(request, "workspace registry release request")
                    )
            send_packet(connection, response)
        except WorkspaceRegistryError as error:
            try:
                send_packet(
                    connection,
                    {
                        "schema_version": SCHEMA_VERSION,
                        "status": "rejected",
                        "reason": str(error),
                    },
                )
            except WorkspaceRegistryError:
                pass
        finally:
            close_descriptors(descriptors)
            connection.close()

    def serve_forever(self):
        if self.listener is None:
            fail("workspace registry must be started before serving")
        while not self.stopping:
            try:
                ready, _unused, _errors = select.select([self.listener], [], [], 0.25)
            except (OSError, ValueError):
                if self.stopping:
                    return
                raise
            if not ready:
                self.registry._reap_expired()
                continue
            try:
                connection, _address = self.listener.accept()
            except OSError:
                if self.stopping:
                    return
                raise
            connection.settimeout(SOCKET_TIMEOUT_SECONDS)
            self.handle_connection(connection)


def registry_request(socket_path, op, request, descriptor=None, timeout_seconds=SOCKET_TIMEOUT_SECONDS):
    require_linux()
    if os.geteuid() != 0 or os.getegid() != 0 or set(os.getgroups()) != {0}:
        fail("workspace registry client must run with the exact root identity")
    socket_path = require_root_socket(socket_path, "workspace registry socket")
    if op not in {"register", "reserve", "assert_reserved", "complete", "release"}:
        fail("workspace registry client operation is unsupported")
    value = {
        "schema_version": REGISTRY_PROTOCOL_VERSION,
        "op": op,
        "request": request,
    }
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    descriptors = []
    try:
        connection.settimeout(timeout_seconds)
        connection.connect(socket_path)
        send_packet(connection, value, descriptor=descriptor)
        response, descriptors = receive_packet(connection, "workspace registry response")
        if descriptors:
            fail("workspace registry response must not carry descriptors")
        response = require_plain_object(response, "workspace registry response")
        if response.get("status") == "rejected":
            reason = response.get("reason")
            fail("workspace registry rejected request: " + (reason if isinstance(reason, str) else "unknown"))
        return response
    except socket.timeout as error:
        fail("workspace registry request timed out: " + str(error))
    except OSError as error:
        fail("workspace registry request failed: " + str(error))
    finally:
        close_descriptors(descriptors)
        connection.close()


def register_workspace(socket_path, registration_id, immutable_base, workspace_root, ttl_milliseconds):
    descriptor, _inspection = open_workspace_descriptor(workspace_root)
    try:
        return registry_request(
            socket_path,
            "register",
            {
                "registration_id": require_token(registration_id, "workspace registration id"),
                "immutable_base": require_git_sha(immutable_base, "workspace immutable base"),
                "ttl_milliseconds": require_nonnegative_int(
                    ttl_milliseconds,
                    "workspace registration TTL",
                    MIN_REGISTRATION_TTL_MILLISECONDS,
                    MAX_REGISTRATION_TTL_MILLISECONDS,
                ),
            },
            descriptor=descriptor,
        )
    finally:
        os.close(descriptor)


def parser():
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve")
    serve.add_argument("--state-root", required=True)
    serve.add_argument("--socket", required=True)
    serve.add_argument("--install-binding-hash", required=True)
    return root


def main():
    server = None
    status = 0
    try:
        args = parser().parse_args()
        if args.command != "serve":
            fail("workspace registry command is unsupported")
        server = WorkspaceRegistryServer(args.state_root, args.socket, args.install_binding_hash)

        def stop(_signum, _frame):
            server.stopping = True

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        server.start()
        sys.stdout.write(canonical({
            "schema_version": SCHEMA_VERSION,
            "status": "ready",
            "registry_instance_id": server.registry.instance_id,
        }) + "\n")
        sys.stdout.flush()
        server.serve_forever()
    except WorkspaceRegistryError as error:
        sys.stderr.write("supervised-workspace-registry: " + str(error) + "\n")
        status = 2
    finally:
        if server is not None:
            try:
                server.stop()
            except WorkspaceRegistryError as error:
                sys.stderr.write("supervised-workspace-registry: " + str(error) + "\n")
                status = 2
    return status


if __name__ == "__main__":
    raise SystemExit(main())
