#!/usr/bin/python3 -I
"""Separate-UID P3.5c append-only shadow witness.

This is intentionally not the P3.2 external lifecycle witness and does not
understand P2 authority, Engine actions, permits, acceptance, workspaces, or
raw requests. It appends only fixed hash evidence for a root-issued descriptor
ticket after authenticating the exact verifier gateway peer.
"""

import argparse
import array
import ctypes
import hashlib
import json
import os
import select
import secrets
import signal
import socket
import stat
import struct
import sys
import time


SCHEMA_VERSION = 1
WITNESS_PROTOCOL_VERSION = 1
MAX_PACKET_BYTES = 16384
MAX_JOURNAL_BYTES = 128 * 1024
MAX_JOURNAL_ENTRIES = 3
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
SHA256_CHARS = frozenset("0123456789abcdef")
METHODS = frozenset(
    {
        "open_shadow",
        "append_shadow_observation",
        "read_shadow_record",
        "close_shadow_diagnostic",
    }
)


class ShadowWitnessError(Exception):
    pass


def fail(message):
    raise ShadowWitnessError(message)


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


def require_nullable_sha256(value, label):
    if value is None:
        return None
    return require_sha256(value, label)


def require_nonnegative_int(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
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
    if sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED"):
        fail("P3.5c shadow witness requires Linux SO_PEERCRED")
    if not hasattr(socket, "SOCK_SEQPACKET"):
        fail("P3.5c shadow witness requires SOCK_SEQPACKET")


def require_exact_directory(path, uid, gid, mode, label):
    path = require_absolute_path(path, label)
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
        fail(label + " does not have the expected identity and mode")
    return path


def require_exact_socket(path, uid, gid, mode, label):
    path = require_absolute_path(path, label)
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISSOCK(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o7777) != mode
    ):
        fail(label + " does not have the expected identity and mode")
    return path


def peer_credentials(connection):
    try:
        raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        return struct.unpack("3i", raw)
    except OSError as error:
        fail("shadow witness cannot read peer credentials: " + str(error))


def cgroup_v2_matches(pid, expected_path):
    try:
        with open("/proc/{}/cgroup".format(pid), "r", encoding="utf-8") as source:
            content = source.read(8192)
    except OSError:
        return False
    for line in content.splitlines():
        if line == "0::" + expected_path:
            return True
    return False


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
            socket.CMSG_SPACE(array.array("i", [0]).itemsize * 2),
            getattr(socket, "MSG_CMSG_CLOEXEC", 0),
        )
    except OSError as error:
        fail(label + " socket read failed: " + str(error))
    try:
        # Even though this protocol rejects SCM_RIGHTS, recvmsg has already
        # installed them. Close every received descriptor on every rejection.
        for level, kind, content in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                integers = array.array("i")
                full_length = len(content) - (len(content) % integers.itemsize)
                if full_length:
                    integers.frombytes(content[:full_length])
                    descriptors.extend(integers.tolist())
        if flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC):
            fail(label + " packet is truncated")
        if ancillary:
            fail(label + " must not contain descriptor ancillary data")
        return parse_canonical_packet(raw, label)
    except Exception:
        close_descriptors(descriptors)
        raise


def send_packet(connection, value):
    raw = canonical(value).encode("utf-8")
    if not raw or len(raw) > MAX_PACKET_BYTES:
        fail("shadow witness response exceeds the fixed byte limit")
    try:
        written = connection.send(raw)
    except OSError as error:
        fail("shadow witness socket write failed: " + str(error))
    if written != len(raw):
        fail("shadow witness socket write was short")


def require_private_file_stat(info, uid, gid, label, allow_empty=False):
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or info.st_nlink != 1
        or (info.st_mode & 0o7777) != 0o600
        or (not allow_empty and info.st_size <= 0)
        or info.st_size > MAX_JOURNAL_BYTES
    ):
        fail(label + " does not have the expected identity, mode, or size")


def fsync_directory(path, label):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as error:
        fail(label + " directory cannot be opened: " + str(error))
    try:
        os.fsync(descriptor)
    except OSError as error:
        fail(label + " directory cannot be persisted: " + str(error))
    finally:
        os.close(descriptor)


def write_all(descriptor, content, label):
    offset = 0
    while offset < len(content):
        try:
            written = os.write(descriptor, content[offset:])
        except OSError as error:
            fail(label + " write failed: " + str(error))
        if written <= 0:
            fail(label + " write was short")
        offset += written


def entry_material(
    shadow_admission_id,
    ticket_hash,
    sequence,
    phase,
    previous_shadow_head,
    capsule_hash,
    observation_hash,
    close_hash,
):
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p35_shadow_witness_entry",
        "shadow_admission_id": require_sha256(shadow_admission_id, "shadow admission id"),
        "ticket_hash": require_sha256(ticket_hash, "shadow ticket hash"),
        "sequence": require_nonnegative_int(sequence, "shadow sequence"),
        "phase": phase,
        "previous_shadow_head": require_nullable_sha256(
            previous_shadow_head, "shadow previous chain head"
        ),
        "capsule_hash": require_nullable_sha256(capsule_hash, "shadow capsule hash"),
        "observation_hash": require_nullable_sha256(observation_hash, "shadow observation hash"),
        "close_hash": require_nullable_sha256(close_hash, "shadow close hash"),
    }


def normalize_entry(value, label):
    value = require_exact_keys(
        value,
        {
            "schema_version",
            "kind",
            "shadow_admission_id",
            "ticket_hash",
            "sequence",
            "phase",
            "previous_shadow_head",
            "capsule_hash",
            "observation_hash",
            "close_hash",
            "entry_hash",
        },
        label,
    )
    if value["kind"] != "p35_shadow_witness_entry":
        fail(label + " has an unexpected kind")
    if not isinstance(value["phase"], str):
        fail(label + " phase must be a string")
    material = entry_material(
        value["shadow_admission_id"],
        value["ticket_hash"],
        value["sequence"],
        value["phase"],
        value["previous_shadow_head"],
        value["capsule_hash"],
        value["observation_hash"],
        value["close_hash"],
    )
    if material["phase"] not in {"open", "observation", "closed"}:
        fail(label + " has an unexpected phase")
    entry_hash = require_sha256(value["entry_hash"], label + " entry hash")
    if entry_hash != sha256_value(canonical(material)):
        fail(label + " entry hash does not match content")
    return dict(material, entry_hash=entry_hash)


def validate_chain(entries, shadow_admission_id, ticket_hash):
    if not entries or len(entries) > MAX_JOURNAL_ENTRIES:
        fail("shadow witness journal has an invalid entry count")
    normalized = [normalize_entry(entry, "shadow witness journal entry") for entry in entries]
    first = normalized[0]
    if (
        first["sequence"] != 0
        or first["phase"] != "open"
        or first["previous_shadow_head"] is not None
        or first["capsule_hash"] is None
        or first["observation_hash"] is not None
        or first["close_hash"] is not None
    ):
        fail("shadow witness journal open entry is invalid")
    if first["shadow_admission_id"] != shadow_admission_id or first["ticket_hash"] != ticket_hash:
        fail("shadow witness journal does not match the requested ticket")
    previous = first
    if len(normalized) >= 2:
        observed = normalized[1]
        if (
            observed["sequence"] != 1
            or observed["phase"] != "observation"
            or observed["previous_shadow_head"] != previous["entry_hash"]
            or observed["shadow_admission_id"] != shadow_admission_id
            or observed["ticket_hash"] != ticket_hash
            or observed["capsule_hash"] != first["capsule_hash"]
            or observed["observation_hash"] is None
            or observed["close_hash"] is not None
        ):
            fail("shadow witness journal observation entry is invalid")
        previous = observed
    if len(normalized) == 3:
        closed = normalized[2]
        if (
            closed["sequence"] != 2
            or closed["phase"] != "closed"
            or closed["previous_shadow_head"] != previous["entry_hash"]
            or closed["shadow_admission_id"] != shadow_admission_id
            or closed["ticket_hash"] != ticket_hash
            or closed["capsule_hash"] != first["capsule_hash"]
            or closed["observation_hash"] != previous["observation_hash"]
            or closed["close_hash"] is None
        ):
            fail("shadow witness journal close entry is invalid")
    return normalized


class ShadowJournal:
    def __init__(self, state_root, uid=None, gid=None):
        self.uid = os.geteuid() if uid is None else uid
        self.gid = os.getegid() if gid is None else gid
        self.state_root = require_exact_directory(
            state_root, self.uid, self.gid, 0o700, "shadow witness state root"
        )
        self.journal_root = os.path.join(self.state_root, "journal")
        if not os.path.lexists(self.journal_root):
            try:
                os.mkdir(self.journal_root, 0o700)
                os.chown(self.journal_root, self.uid, self.gid)
                os.chmod(self.journal_root, 0o700)
                fsync_directory(self.state_root, "shadow witness state root")
            except OSError as error:
                fail("shadow witness journal root cannot be created: " + str(error))
        require_exact_directory(self.journal_root, self.uid, self.gid, 0o700, "shadow witness journal root")

    def path_for(self, shadow_admission_id):
        return os.path.join(
            self.journal_root,
            require_sha256(shadow_admission_id, "shadow admission id") + ".jsonl",
        )

    def read(self, shadow_admission_id, ticket_hash):
        shadow_admission_id = require_sha256(shadow_admission_id, "shadow admission id")
        ticket_hash = require_sha256(ticket_hash, "shadow ticket hash")
        path = self.path_for(shadow_admission_id)
        try:
            initial = os.lstat(path)
        except FileNotFoundError:
            return []
        except OSError as error:
            fail("shadow witness journal cannot be inspected: " + str(error))
        require_private_file_stat(initial, self.uid, self.gid, "shadow witness journal")
        descriptor = None
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            opened = os.fstat(descriptor)
            if (
                opened.st_dev != initial.st_dev
                or opened.st_ino != initial.st_ino
                or opened.st_size != initial.st_size
            ):
                fail("shadow witness journal changed while being opened")
            require_private_file_stat(opened, self.uid, self.gid, "shadow witness journal")
            content = bytearray()
            while len(content) <= MAX_JOURNAL_BYTES:
                block = os.read(descriptor, min(65536, MAX_JOURNAL_BYTES + 1 - len(content)))
                if not block:
                    break
                content.extend(block)
            if len(content) > MAX_JOURNAL_BYTES:
                fail("shadow witness journal exceeds the fixed byte limit")
            final = os.fstat(descriptor)
            if (
                final.st_dev != opened.st_dev
                or final.st_ino != opened.st_ino
                or final.st_size != opened.st_size
            ):
                fail("shadow witness journal changed while being read")
        except OSError as error:
            fail("shadow witness journal cannot be read safely: " + str(error))
        finally:
            if descriptor is not None:
                os.close(descriptor)
        if not content or not content.endswith(b"\n"):
            fail("shadow witness journal is partial or unterminated")
        entries = []
        for line in bytes(content[:-1]).split(b"\n"):
            if not line:
                fail("shadow witness journal contains an empty entry")
            try:
                text = line.decode("utf-8")
                value = json.loads(text)
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                fail("shadow witness journal entry is invalid JSON: " + str(error))
            if canonical(value) != text:
                fail("shadow witness journal entry is not canonical")
            entries.append(value)
        return validate_chain(entries, shadow_admission_id, ticket_hash)

    def append(self, entry):
        entry = normalize_entry(entry, "shadow witness append entry")
        path = self.path_for(entry["shadow_admission_id"])
        content = (canonical(entry) + "\n").encode("utf-8")
        if len(content) > MAX_JOURNAL_BYTES:
            fail("shadow witness append entry exceeds the fixed byte limit")
        descriptor = None
        created = False
        try:
            try:
                descriptor = os.open(
                    path,
                    os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o600,
                )
                created = True
                os.fchown(descriptor, self.uid, self.gid)
                os.fchmod(descriptor, 0o600)
                require_private_file_stat(
                    os.fstat(descriptor), self.uid, self.gid, "shadow witness new journal", allow_empty=True
                )
            except FileExistsError:
                descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
                require_private_file_stat(os.fstat(descriptor), self.uid, self.gid, "shadow witness journal")
            write_all(descriptor, content, "shadow witness journal")
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = None
            fsync_directory(self.journal_root, "shadow witness journal")
        except OSError as error:
            fail("shadow witness journal cannot be appended safely: " + str(error))
        finally:
            if descriptor is not None:
                os.close(descriptor)
        return entry


def response_for_entries(entries, idempotent=False, status=None, continuation_token=None):
    last = entries[-1]
    phase = last["phase"]
    if status is None:
        status = {
            "open": "shadow_recovery_required",
            "observation": "shadow_recovery_required",
            "closed": "shadow_closed",
        }[phase]
    return {
        "schema_version": SCHEMA_VERSION,
        "status": status,
        "shadow_admission_id": last["shadow_admission_id"],
        "ticket_hash": last["ticket_hash"],
        "capsule_hash": entries[0]["capsule_hash"],
        "observation_hash": entries[1]["observation_hash"] if len(entries) >= 2 else None,
        "close_hash": entries[2]["close_hash"] if len(entries) == 3 else None,
        "sequence": last["sequence"],
        "previous_shadow_head": last["previous_shadow_head"],
        "shadow_chain_head": last["entry_hash"],
        "idempotent": idempotent,
        "continuation_token": continuation_token,
    }


class ShadowWitnessProtocol:
    def __init__(self, journal, ticket_hash):
        self.journal = journal
        self.ticket_hash = require_sha256(ticket_hash, "witness ticket hash")
        # Continuation material exists only in this daemon's memory. A daemon
        # restart leaves any incomplete journal diagnostic-only rather than
        # letting a new process continue a half-observed transaction.
        self.continuation_hashes = {}

    def _require_ticket(self, value):
        ticket_hash = require_sha256(value, "shadow request ticket hash")
        if ticket_hash != self.ticket_hash:
            fail("shadow request does not match this root-issued ticket")
        return ticket_hash

    def _open(self, value):
        value = require_exact_keys(
            value,
            {"shadow_admission_id", "ticket_hash", "capsule_hash"},
            "open_shadow request",
        )
        admission_id = require_sha256(value["shadow_admission_id"], "open_shadow admission id")
        ticket_hash = self._require_ticket(value["ticket_hash"])
        capsule_hash = require_sha256(value["capsule_hash"], "open_shadow capsule hash")
        entries = self.journal.read(admission_id, ticket_hash)
        if entries:
            current = response_for_entries(entries, idempotent=True)
            if current["capsule_hash"] != capsule_hash:
                fail("open_shadow conflicts with the existing shadow record")
            if current["status"] != "shadow_closed":
                return current
            return current
        material = entry_material(
            admission_id, ticket_hash, 0, "open", None, capsule_hash, None, None
        )
        entry = dict(material, entry_hash=sha256_value(canonical(material)))
        self.journal.append(entry)
        continuation_token = secrets.token_urlsafe(32).rstrip("=")
        self.continuation_hashes[admission_id] = sha256_value(continuation_token)
        return response_for_entries(
            [entry],
            idempotent=False,
            status="shadow_opened",
            continuation_token=continuation_token,
        )

    def _require_continuation(self, admission_id, value, label):
        if not isinstance(value, str) or not value or len(value) > 128:
            fail(label + " must be a bounded continuation token")
        expected = self.continuation_hashes.get(admission_id)
        if expected is None or sha256_value(value) != expected:
            fail(label + " is unavailable; shadow recovery is required")
        return value

    def _append(self, value):
        value = require_exact_keys(
            value,
            {"shadow_admission_id", "ticket_hash", "observation_hash", "continuation_token"},
            "append_shadow_observation request",
        )
        admission_id = require_sha256(value["shadow_admission_id"], "append admission id")
        ticket_hash = self._require_ticket(value["ticket_hash"])
        observation_hash = require_sha256(value["observation_hash"], "append observation hash")
        entries = self.journal.read(admission_id, ticket_hash)
        if not entries:
            fail("append_shadow_observation requires an opened shadow record")
        current = response_for_entries(entries, idempotent=True)
        if len(entries) == 1:
            self._require_continuation(admission_id, value["continuation_token"], "append continuation token")
            material = entry_material(
                admission_id,
                ticket_hash,
                1,
                "observation",
                entries[0]["entry_hash"],
                entries[0]["capsule_hash"],
                observation_hash,
                None,
            )
            entry = dict(material, entry_hash=sha256_value(canonical(material)))
            self.journal.append(entry)
            return response_for_entries(entries + [entry], idempotent=False, status="shadow_observed")
        if current["observation_hash"] != observation_hash:
            fail("append_shadow_observation conflicts with the existing shadow record")
        return current

    def _read(self, value):
        value = require_exact_keys(
            value,
            {"shadow_admission_id", "ticket_hash"},
            "read_shadow_record request",
        )
        admission_id = require_sha256(value["shadow_admission_id"], "read admission id")
        ticket_hash = self._require_ticket(value["ticket_hash"])
        entries = self.journal.read(admission_id, ticket_hash)
        if not entries:
            fail("read_shadow_record cannot find a shadow record")
        return response_for_entries(entries, idempotent=True)

    def _close(self, value):
        value = require_exact_keys(
            value,
            {"shadow_admission_id", "ticket_hash", "close_hash", "continuation_token"},
            "close_shadow_diagnostic request",
        )
        admission_id = require_sha256(value["shadow_admission_id"], "close admission id")
        ticket_hash = self._require_ticket(value["ticket_hash"])
        close_hash = require_sha256(value["close_hash"], "close shadow hash")
        entries = self.journal.read(admission_id, ticket_hash)
        if not entries:
            fail("close_shadow_diagnostic requires an opened shadow record")
        current = response_for_entries(entries, idempotent=True)
        if len(entries) == 1:
            fail("close_shadow_diagnostic cannot continue an unobserved record; shadow recovery is required")
        if len(entries) == 2:
            self._require_continuation(admission_id, value["continuation_token"], "close continuation token")
            material = entry_material(
                admission_id,
                ticket_hash,
                2,
                "closed",
                entries[1]["entry_hash"],
                entries[0]["capsule_hash"],
                entries[1]["observation_hash"],
                close_hash,
            )
            entry = dict(material, entry_hash=sha256_value(canonical(material)))
            self.journal.append(entry)
            return response_for_entries(entries + [entry], idempotent=False, status="shadow_closed")
        if len(entries) == 3 and current["close_hash"] == close_hash:
            self._require_continuation(admission_id, value["continuation_token"], "close continuation token")
            return current
        if len(entries) == 3:
            fail("close_shadow_diagnostic conflicts with the existing shadow record")
        return current

    def dispatch(self, method, request):
        if method == "open_shadow":
            return self._open(request)
        if method == "append_shadow_observation":
            return self._append(request)
        if method == "read_shadow_record":
            return self._read(request)
        if method == "close_shadow_diagnostic":
            return self._close(request)
        fail("shadow witness method is unsupported")


def normalize_request(value):
    value = require_exact_keys(
        value,
        {"schema_version", "method", "request"},
        "shadow witness request",
    )
    if value["schema_version"] != WITNESS_PROTOCOL_VERSION:
        fail("shadow witness request schema_version is unsupported")
    if value["method"] not in METHODS:
        fail("shadow witness request method is unsupported")
    return value["method"], require_plain_object(value["request"], "shadow witness request body")


def write_ready(path, value, uid, gid):
    path = require_absolute_path(path, "shadow witness ready path")
    if os.path.lexists(path):
        fail("shadow witness ready path already exists")
    content = canonical(value).encode("utf-8")
    descriptor = None
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, 0o600)
        write_all(descriptor, content, "shadow witness ready file")
        os.fsync(descriptor)
    except OSError as error:
        fail("shadow witness ready file cannot be written: " + str(error))
    finally:
        if descriptor is not None:
            os.close(descriptor)
    fsync_directory(os.path.dirname(path), "shadow witness ready file")


class ShadowWitnessServer:
    def __init__(
        self,
        socket_root,
        socket_path,
        ready_path,
        state_root,
        ticket_hash,
        verifier_pid,
        verifier_uid,
        verifier_gid,
        verifier_cgroup,
        root_pid,
        witness_uid,
        witness_gid,
        socket_gid,
    ):
        require_linux()
        self.socket_root = require_absolute_path(socket_root, "shadow witness socket root")
        self.socket_path = require_absolute_path(socket_path, "shadow witness socket")
        self.ready_path = require_absolute_path(ready_path, "shadow witness ready path")
        self.state_root = require_absolute_path(state_root, "shadow witness state root")
        if os.path.dirname(self.socket_path) != self.socket_root or os.path.dirname(self.ready_path) != self.socket_root:
            fail("shadow witness socket and ready file must live directly below the socket root")
        self.ticket_hash = require_sha256(ticket_hash, "shadow witness ticket hash")
        self.verifier_pid = require_nonnegative_int(verifier_pid, "shadow witness verifier pid", 1)
        self.verifier_uid = require_nonnegative_int(verifier_uid, "shadow witness verifier uid", 1)
        self.verifier_gid = require_nonnegative_int(verifier_gid, "shadow witness verifier gid", 1)
        self.verifier_cgroup = require_absolute_path(verifier_cgroup, "shadow witness verifier cgroup")
        self.root_pid = require_nonnegative_int(root_pid, "shadow witness root pid", 1)
        self.witness_uid = require_nonnegative_int(witness_uid, "shadow witness uid", 1)
        self.witness_gid = require_nonnegative_int(witness_gid, "shadow witness gid", 1)
        self.socket_gid = require_nonnegative_int(socket_gid, "shadow witness socket gid", 1)
        if self.verifier_uid == self.witness_uid or self.verifier_gid == self.witness_gid:
            fail("shadow witness and verifier identities must be distinct")
        self.listener = None
        self.protocol = None
        self.stopping = False

    def start(self):
        if os.geteuid() != self.witness_uid or os.getegid() != self.witness_gid:
            fail("shadow witness process does not have the configured UID/GID")
        if set(os.getgroups()) != {self.witness_gid}:
            fail("shadow witness process has unexpected supplementary groups")
        require_exact_directory(
            self.socket_root,
            self.witness_uid,
            self.socket_gid,
            0o2710,
            "shadow witness socket root",
        )
        journal = ShadowJournal(self.state_root, self.witness_uid, self.witness_gid)
        self.protocol = ShadowWitnessProtocol(journal, self.ticket_hash)
        if os.path.lexists(self.socket_path) or os.path.lexists(self.ready_path):
            fail("shadow witness session path already exists")
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        try:
            listener.bind(self.socket_path)
            os.chown(self.socket_path, self.witness_uid, self.socket_gid)
            os.chmod(self.socket_path, 0o660)
            require_exact_socket(
                self.socket_path,
                self.witness_uid,
                self.socket_gid,
                0o660,
                "shadow witness socket",
            )
            listener.listen(16)
            listener.setblocking(False)
            self.listener = listener
            write_ready(
                self.ready_path,
                {
                    "schema_version": SCHEMA_VERSION,
                    "status": "ready",
                    "witness_pid": os.getpid(),
                    "witness_uid": self.witness_uid,
                    "witness_gid": self.witness_gid,
                    "socket_gid": self.socket_gid,
                },
                self.witness_uid,
                self.witness_gid,
            )
        except Exception:
            listener.close()
            try:
                if os.path.lexists(self.socket_path):
                    os.unlink(self.socket_path)
            except OSError:
                pass
            raise

    def stop(self):
        self.stopping = True
        if self.listener is not None:
            self.listener.close()
            self.listener = None

    def classify_peer(self, connection):
        # This must precede receive_packet: unauthenticated peers receive no
        # protocol parser or request bytes.
        pid, uid, gid = peer_credentials(connection)
        if (
            pid == self.verifier_pid
            and uid == self.verifier_uid
            and gid == self.verifier_gid
            and cgroup_v2_matches(pid, self.verifier_cgroup)
        ):
            return "verifier"
        if pid == self.root_pid and uid == 0 and gid == 0:
            return "root"
        fail("shadow witness rejected an unexpected peer")

    def handle_connection(self, connection):
        try:
            role = self.classify_peer(connection)
            method, request = normalize_request(receive_packet(connection, "shadow witness request"))
            if role == "root" and method != "read_shadow_record":
                fail("root shadow witness peer may only read a record")
            response = self.protocol.dispatch(method, request)
            send_packet(connection, response)
        except ShadowWitnessError as error:
            try:
                send_packet(
                    connection,
                    {
                        "schema_version": SCHEMA_VERSION,
                        "status": "rejected",
                        "reason": str(error),
                    },
                )
            except ShadowWitnessError:
                pass
        finally:
            connection.close()

    def serve_forever(self):
        if self.listener is None:
            fail("shadow witness must be started before serving")
        while not self.stopping:
            try:
                ready, _unused, _errors = select.select([self.listener], [], [], 0.25)
            except (OSError, ValueError):
                if self.stopping:
                    return
                raise
            if not ready:
                continue
            try:
                connection, _address = self.listener.accept()
            except OSError:
                if self.stopping:
                    return
                raise
            connection.settimeout(5)
            self.handle_connection(connection)


def parser():
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve")
    serve.add_argument("--socket-root", required=True)
    serve.add_argument("--socket", required=True)
    serve.add_argument("--ready-path", required=True)
    serve.add_argument("--state-root", required=True)
    serve.add_argument("--ticket-hash", required=True)
    serve.add_argument("--expected-verifier-pid", type=int, required=True)
    serve.add_argument("--expected-verifier-uid", type=int, required=True)
    serve.add_argument("--expected-verifier-gid", type=int, required=True)
    serve.add_argument("--expected-verifier-cgroup", required=True)
    serve.add_argument("--expected-root-pid", type=int, required=True)
    serve.add_argument("--witness-uid", type=int, required=True)
    serve.add_argument("--witness-gid", type=int, required=True)
    serve.add_argument("--socket-gid", type=int, required=True)
    return root


def main():
    server = None
    status = 0
    try:
        args = parser().parse_args()
        if args.command != "serve":
            fail("shadow witness command is unsupported")
        server = ShadowWitnessServer(
            socket_root=args.socket_root,
            socket_path=args.socket,
            ready_path=args.ready_path,
            state_root=args.state_root,
            ticket_hash=args.ticket_hash,
            verifier_pid=args.expected_verifier_pid,
            verifier_uid=args.expected_verifier_uid,
            verifier_gid=args.expected_verifier_gid,
            verifier_cgroup=args.expected_verifier_cgroup,
            root_pid=args.expected_root_pid,
            witness_uid=args.witness_uid,
            witness_gid=args.witness_gid,
            socket_gid=args.socket_gid,
        )

        def stop(_signum, _frame):
            server.stopping = True

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        server.start()
        server.serve_forever()
    except ShadowWitnessError as error:
        sys.stderr.write("supervised-shadow-witness: " + str(error) + "\n")
        status = 2
    finally:
        if server is not None:
            try:
                server.stop()
            except ShadowWitnessError as error:
                sys.stderr.write("supervised-shadow-witness: " + str(error) + "\n")
                status = 2
    return status


if __name__ == "__main__":
    raise SystemExit(main())
