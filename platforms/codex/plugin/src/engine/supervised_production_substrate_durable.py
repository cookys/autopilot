#!/usr/bin/env python3
"""P3.6 Phase 3 hash-only durable state primitives.

This module deliberately sits below the later durable Unix service transport.
It accepts only exact canonical request bytes after a caller has authenticated
the peer, persists witness/coordinator state with fsync-backed journals, and
never loads an Engine, permit, action descriptor, workspace path, or command.
"""

import errno
import fcntl
import hashlib
import json
import os
import secrets
import stat
import sys
import time


SCHEMA_VERSION = 1
MAX_REQUEST_BYTES = 131072
MAX_JOURNAL_BYTES = 8 * 1024 * 1024
MAX_BATCH_EVENTS = 64
MAX_READBACK_LIMIT = 1024
MAX_SAFE_INTEGER = 9007199254740991
DURABLE_LOCK_TIMEOUT_SECONDS = 5
# This value is mechanically compared with the Node ABI in the recovery test.
# The root-installed host must refuse a snapshot if this pin and the copied
# durable contract disagree.
DURABLE_ABI_HASH = "f47c90057dc3cb0452b655f721d15f9dd36ba02c65f830cc9b84b04c257978a5"
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
SHA256_CHARS = frozenset("0123456789abcdef")
SERVICE_ROLES = (
    "worker",
    "broker",
    "receipt_verifier",
    "witness",
    "coordinator",
)


class DurableStateError(Exception):
    def __init__(self, message, code="DURABLE_STATE_INVALID"):
        super().__init__(message)
        self.code = code


def fail(message, code="DURABLE_STATE_INVALID"):
    raise DurableStateError(message, code)


def canonical(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    )


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


def require_positive_int(value, label):
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
        or value > MAX_SAFE_INTEGER
    ):
        fail(label + " must be a positive safe integer")
    return value


def require_nonnegative_int(value, label):
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > MAX_SAFE_INTEGER
    ):
        fail(label + " must be a nonnegative safe integer")
    return value


def require_exact_int(value, expected, label, code="DURABLE_STATE_INVALID"):
    """Require a frozen JSON integer without Python's ``True == 1`` coercion."""

    if isinstance(value, bool) or not isinstance(value, int) or value != expected:
        fail(label + " must be the exact frozen integer", code)
    return value


def require_absolute_path(value, label):
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or value.startswith("//")
        or value == "/"
        or "\x00" in value
        or os.path.normpath(value) != value
    ):
        fail(label + " must be a canonical non-root absolute path")
    return value


def reject_json_constant(value):
    raise ValueError("non-finite JSON constant: " + value)


def contains_lone_surrogate(value):
    """Reject Python strings that cannot round-trip as canonical UTF-8 JSON."""
    if isinstance(value, str):
        return any(0xD800 <= ord(character) <= 0xDFFF for character in value)
    if isinstance(value, list):
        return any(contains_lone_surrogate(item) for item in value)
    if isinstance(value, dict):
        return any(
            contains_lone_surrogate(key) or contains_lone_surrogate(item)
            for key, item in value.items()
        )
    return False


def parse_canonical_json_text(text, label, code, newline=False):
    if not isinstance(text, str):
        fail(label + " is not UTF-8 JSON", code)
    source = text[:-1] if newline and text.endswith("\n") else text
    if newline and not text.endswith("\n"):
        fail(label + " is not newline-terminated canonical JSON", code)
    try:
        value = json.loads(source, parse_constant=reject_json_constant)
        if contains_lone_surrogate(value):
            raise ValueError("lone Unicode surrogate")
        normalized = canonical(value)
    except (json.JSONDecodeError, ValueError, RecursionError, MemoryError):
        fail(label + " is not bounded canonical JSON", code)
    if normalized != source:
        fail(label + " is not canonical JSON", code)
    return value


def decode_canonical_request(raw, label):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_REQUEST_BYTES:
        fail(label + " has an invalid byte size", "DURABLE_REQUEST_INVALID")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        fail(label + " is not bounded canonical JSON", "DURABLE_REQUEST_INVALID")
    value = parse_canonical_json_text(text, label, "DURABLE_REQUEST_INVALID")
    return value, text


def normalize_binding(raw):
    value = require_exact_keys(
        raw,
        {
            "schema_version",
            "kind",
            "install_binding_hash",
            "run_binding_hash",
            "substrate_abi_hash",
            "substrate_plan_hash",
            "durable_abi_hash",
            "cohort_id",
            "generation",
            "service_bindings",
        },
        "durable binding",
    )
    if (
        require_exact_int(value["schema_version"], SCHEMA_VERSION, "durable binding schema")
        != SCHEMA_VERSION
        or value["kind"] != "p36_durable_state_binding"
    ):
        fail("durable binding has an unsupported schema or kind")
    services = require_exact_keys(value["service_bindings"], set(SERVICE_ROLES), "durable service bindings")
    normalized_services = {}
    seen = {"identity": set(), "uid": set(), "gid": set(), "attestation_hash": set(), "cgroup_binding_hash": set()}
    for role in SERVICE_ROLES:
        service = require_exact_keys(
            services[role],
            {"role", "identity", "uid", "gid", "attestation_hash", "cgroup_binding_hash"},
            "durable " + role + " service",
        )
        if service["role"] != role:
            fail("durable " + role + " service has the wrong role")
        normalized = {
            "role": role,
            "identity": require_token(service["identity"], "durable " + role + " identity"),
            "uid": require_positive_int(service["uid"], "durable " + role + " uid"),
            "gid": require_positive_int(service["gid"], "durable " + role + " gid"),
            "attestation_hash": require_sha256(service["attestation_hash"], "durable " + role + " attestation"),
            "cgroup_binding_hash": require_sha256(service["cgroup_binding_hash"], "durable " + role + " cgroup"),
        }
        for key in seen:
            if normalized[key] in seen[key]:
                fail("durable services do not retain independent " + key)
            seen[key].add(normalized[key])
        normalized_services[role] = normalized
    durable_abi_hash = require_sha256(value["durable_abi_hash"], "durable ABI")
    if durable_abi_hash != DURABLE_ABI_HASH:
        fail("durable binding does not match the pinned durable ABI", "DURABLE_ABI_MISMATCH")
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_state_binding",
        "install_binding_hash": require_sha256(value["install_binding_hash"], "durable install binding"),
        "run_binding_hash": require_sha256(value["run_binding_hash"], "durable run binding"),
        "substrate_abi_hash": require_sha256(value["substrate_abi_hash"], "durable substrate ABI"),
        "substrate_plan_hash": require_sha256(value["substrate_plan_hash"], "durable substrate plan"),
        "durable_abi_hash": DURABLE_ABI_HASH,
        "cohort_id": require_token(value["cohort_id"], "durable cohort id"),
        "generation": require_positive_int(value["generation"], "durable generation"),
        "service_bindings": normalized_services,
    }


def normalized_binding_hash(binding):
    return sha256_value(canonical(binding))


def write_all(descriptor, content, label):
    offset = 0
    while offset < len(content):
        try:
            written = os.write(descriptor, content[offset:])
        except OSError as error:
            fail(label + " write failed: " + str(error), "DURABLE_STORAGE_FAILED")
        if written <= 0:
            fail(label + " write did not make progress", "DURABLE_STORAGE_FAILED")
        offset += written


def journal_kind_for_role(role):
    if role == "receipt_verifier":
        return "p36_durable_receipt_anchor_journal"
    if role == "witness":
        return "p36_durable_witness_journal"
    if role == "coordinator":
        return "p36_durable_coordinator_journal"
    fail("durable journal role is unsupported")


def journal_header_for(binding, role):
    binding = normalize_binding(binding)
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": journal_kind_for_role(role) + "_header",
        "binding": binding,
        "previous_journal_hash": None,
    }
    return dict(material, journal_hash=sha256_value(canonical(material)))


def generation_manifest_for(binding, role):
    binding = normalize_binding(binding)
    header = journal_header_for(binding, role)
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_generation",
        "role": role,
        "binding_hash": normalized_binding_hash(binding),
        "journal_genesis_hash": header["journal_hash"],
    }
    return dict(material, generation_hash=sha256_value(canonical(material)))


class DurableLeaf:
    """A root-created role leaf whose service may only mutate fixed files."""

    CONTROL_FILES = frozenset({
        "generation.json",
        ".lock",
        "journal.jsonl",
        "cohort.json",
        "quarantine.json",
    })

    def __init__(self, state_root, binding, role, root_audit=False):
        self.binding = normalize_binding(binding)
        if role not in {"receipt_verifier", "witness", "coordinator"}:
            fail("durable leaf role is unsupported")
        self.role = role
        self.root_audit = root_audit
        service = self.binding["service_bindings"][role]
        self.uid = service["uid"]
        self.gid = service["gid"]
        self._require_runtime_identity()
        self.state_root = require_absolute_path(state_root, "durable state root")
        self.state_parent = os.path.dirname(self.state_root)
        self.generation_path = os.path.join(self.state_root, "generation.json")
        self.lock_path = os.path.join(self.state_root, ".lock")
        self.journal_path = os.path.join(self.state_root, "journal.jsonl")
        self.cohort_path = os.path.join(self.state_root, "cohort.json")
        self.quarantine_path = os.path.join(self.state_root, "quarantine.json")
        self._poisoned = False
        self._terminal_code = None
        self._instance_hash = sha256_value(secrets.token_hex(32))
        self._cohort_marker_hash = None
        self._active_cohort_marker = None
        self._require_parent()
        self._require_leaf()
        self._require_generation_manifest()
        self._check_entries()

    def _require_runtime_identity(self):
        if self.root_audit:
            if os.geteuid() != 0 or os.getegid() != 0:
                fail("durable root audit does not run as UID/GID 0", "DURABLE_AUDIT_NOT_ROOT")
            return
        if os.geteuid() != self.uid or os.getegid() != self.gid:
            fail("durable service process does not match its pinned UID/GID", "DURABLE_IDENTITY_MISMATCH")
        try:
            groups = os.getgroups()
        except OSError as error:
            fail("durable service groups cannot be inspected: " + str(error), "DURABLE_IDENTITY_MISMATCH")
        if set(groups) != {self.gid}:
            fail("durable service has unexpected supplementary groups", "DURABLE_IDENTITY_MISMATCH")

    def _require_parent(self):
        try:
            info = os.lstat(self.state_parent)
        except OSError as error:
            fail("durable state parent cannot be inspected: " + str(error), "DURABLE_FILESYSTEM_UNSAFE")
        if (
            stat.S_ISLNK(info.st_mode)
            or not stat.S_ISDIR(info.st_mode)
            or info.st_uid != 0
            or info.st_gid != self.gid
            or (info.st_mode & 0o7777) != 0o710
        ):
            fail("durable state parent is not the root-created role boundary", "DURABLE_FILESYSTEM_UNSAFE")

    def _require_leaf(self):
        try:
            info = os.lstat(self.state_root)
        except OSError as error:
            fail("durable state root cannot be inspected: " + str(error), "DURABLE_FILESYSTEM_UNSAFE")
        if (
            stat.S_ISLNK(info.st_mode)
            or not stat.S_ISDIR(info.st_mode)
            or info.st_uid != 0
            or info.st_gid != self.gid
            or (info.st_mode & 0o7777) != 0o750
        ):
            fail("durable state leaf is not root-created and role-private", "DURABLE_FILESYSTEM_UNSAFE")

    def _require_root_file(self, info, label, mode, allow_empty=False, maximum=MAX_JOURNAL_BYTES):
        if (
            stat.S_ISLNK(info.st_mode)
            or not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or info.st_gid != self.gid
            or info.st_nlink != 1
            or (info.st_mode & 0o7777) != mode
            or (not allow_empty and info.st_size <= 0)
            or info.st_size > maximum
        ):
            fail(label + " has an unexpected root identity, mode, or size", "DURABLE_FILESYSTEM_UNSAFE")

    def _read_root_file(self, path, label, mode, allow_empty=False, maximum=MAX_JOURNAL_BYTES):
        try:
            initial = os.lstat(path)
        except FileNotFoundError:
            fail(label + " is missing", "DURABLE_FILESYSTEM_UNSAFE")
        except OSError as error:
            fail(label + " cannot be inspected: " + str(error), "DURABLE_FILESYSTEM_UNSAFE")
        self._require_root_file(initial, label, mode, allow_empty, maximum)
        descriptor = None
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            opened = os.fstat(descriptor)
            if (
                opened.st_dev != initial.st_dev
                or opened.st_ino != initial.st_ino
                or opened.st_size != initial.st_size
            ):
                fail(label + " changed while opening", "DURABLE_FILESYSTEM_UNSAFE")
            self._require_root_file(opened, label, mode, allow_empty, maximum)
            chunks = []
            remaining = maximum + 1
            while remaining:
                block = os.read(descriptor, min(65536, remaining))
                if not block:
                    break
                chunks.append(block)
                remaining -= len(block)
            content = b"".join(chunks)
            if len(content) > maximum:
                fail(label + " exceeds the byte limit", "DURABLE_FILESYSTEM_UNSAFE")
            final = os.fstat(descriptor)
            if (
                final.st_dev != opened.st_dev
                or final.st_ino != opened.st_ino
                or final.st_size != opened.st_size
            ):
                fail(label + " changed while reading", "DURABLE_FILESYSTEM_UNSAFE")
            return content
        except OSError as error:
            fail(label + " cannot be read safely: " + str(error), "DURABLE_FILESYSTEM_UNSAFE")
        finally:
            if descriptor is not None:
                os.close(descriptor)

    def _require_generation_manifest(self):
        raw = self._read_root_file(
            self.generation_path,
            "durable generation manifest",
            0o440,
            maximum=65536,
        )
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            fail("durable generation manifest is not canonical JSON", "DURABLE_FILESYSTEM_UNSAFE")
        value = parse_canonical_json_text(
            text,
            "durable generation manifest",
            "DURABLE_FILESYSTEM_UNSAFE",
            newline=True,
        )
        expected = generation_manifest_for(self.binding, self.role)
        if value != expected:
            fail("durable generation manifest does not match the frozen role binding", "DURABLE_FILESYSTEM_UNSAFE")

    def _require_control_file(self, path, label, allow_empty=False, maximum=MAX_JOURNAL_BYTES):
        try:
            info = os.lstat(path)
        except OSError as error:
            fail(label + " cannot be inspected: " + str(error), "DURABLE_FILESYSTEM_UNSAFE")
        self._require_root_file(info, label, 0o660, allow_empty, maximum)
        return info

    def _check_entries(self):
        self._require_parent()
        self._require_leaf()
        self._require_generation_manifest()
        try:
            entries = set(os.listdir(self.state_root))
        except OSError as error:
            fail("durable state root cannot be listed: " + str(error), "DURABLE_FILESYSTEM_UNSAFE")
        if entries != self.CONTROL_FILES:
            fail("durable state root does not contain the root-created control file set", "DURABLE_FILESYSTEM_UNSAFE")
        self._require_control_file(self.lock_path, "durable lock", allow_empty=True, maximum=65536)
        self._require_control_file(self.journal_path, "durable journal")
        self._require_control_file(self.cohort_path, "durable cohort marker", allow_empty=True, maximum=65536)
        self._require_control_file(self.quarantine_path, "durable quarantine", allow_empty=True, maximum=65536)

    def _fsync_directory(self):
        descriptor = None
        try:
            descriptor = os.open(self.state_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            os.fsync(descriptor)
        except OSError as error:
            fail("durable state directory cannot be persisted: " + str(error), "DURABLE_STORAGE_FAILED")
        finally:
            if descriptor is not None:
                os.close(descriptor)

    def _open_lock(self):
        self._check_entries()
        descriptor = None
        try:
            descriptor = os.open(self.lock_path, os.O_RDWR | os.O_NOFOLLOW)
            self._require_root_file(os.fstat(descriptor), "durable lock", 0o660, allow_empty=True, maximum=65536)
            deadline = time.monotonic() + DURABLE_LOCK_TIMEOUT_SECONDS
            while True:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        fail("durable state lock did not become available", "DURABLE_LOCK_UNAVAILABLE")
                    time.sleep(0.025)
            return descriptor
        except DurableStateError:
            if descriptor is not None:
                os.close(descriptor)
            raise
        except OSError as error:
            if descriptor is not None:
                os.close(descriptor)
            fail("durable state lock cannot be acquired: " + str(error), "DURABLE_STORAGE_FAILED")

    def _read_control_file(self, path, label, allow_empty=False, maximum=MAX_JOURNAL_BYTES):
        return self._read_root_file(path, label, 0o660, allow_empty, maximum)

    def _write_empty_control_file(self, path, label, content):
        descriptor = None
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_NOFOLLOW)
            info = os.fstat(descriptor)
            self._require_root_file(info, label, 0o660, allow_empty=True, maximum=65536)
            if info.st_size != 0:
                fail(label + " was not root-provisioned empty", "DURABLE_FILESYSTEM_UNSAFE")
            write_all(descriptor, content, label)
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = None
            self._fsync_directory()
        except DurableStateError:
            raise
        except OSError as error:
            fail(label + " cannot be persisted: " + str(error), "DURABLE_STORAGE_FAILED")
        finally:
            if descriptor is not None:
                os.close(descriptor)

    def _block_cohort(self, code, reason):
        self._poisoned = True
        self._terminal_code = code
        try:
            self._write_quarantine(code, reason)
        except DurableStateError:
            pass

    def _poison_storage(self, reason):
        self._block_cohort("DURABLE_STORAGE_UNCERTAIN", reason)

    def _write_quarantine(self, code, reason):
        if self.root_audit:
            return
        existing = self._read_control_file(
            self.quarantine_path,
            "durable quarantine",
            allow_empty=True,
            maximum=65536,
        )
        if existing:
            return
        value = {
            "schema_version": SCHEMA_VERSION,
            "kind": "p36_durable_quarantine",
            "role": self.role,
            "binding_hash": normalized_binding_hash(self.binding),
            "code": require_token(code, "durable quarantine code"),
            "reason_hash": sha256_value(reason),
        }
        material = dict(value)
        value["quarantine_hash"] = sha256_value(canonical(material))
        try:
            self._write_empty_control_file(
                self.quarantine_path,
                "durable quarantine",
                (canonical(value) + "\n").encode("utf-8"),
            )
        except DurableStateError:
            # The original integrity failure is more informative than a best
            # effort marker. The in-memory instance stays poisoned either way.
            pass

    def _raise_quarantined(self, reason, code="DURABLE_QUARANTINED"):
        if self.root_audit:
            fail("durable " + self.role + " state is unavailable to root audit", code)
        self._write_quarantine(code, reason)
        fail("durable " + self.role + " state is quarantined", code)

    def _read_quarantine(self):
        raw = self._read_control_file(
            self.quarantine_path,
            "durable quarantine",
            allow_empty=True,
            maximum=65536,
        )
        if not raw:
            return None
        try:
            text = raw.decode("utf-8")
            value = parse_canonical_json_text(
                text,
                "durable quarantine",
                "DURABLE_QUARANTINE_CORRUPT",
                newline=True,
            )
            value = require_exact_keys(
                value,
                {"schema_version", "kind", "role", "binding_hash", "code", "reason_hash", "quarantine_hash"},
                "durable quarantine",
            )
            material = dict(value)
            quarantine_hash = material.pop("quarantine_hash")
            if (
                require_exact_int(
                    value["schema_version"], SCHEMA_VERSION, "durable quarantine schema", "DURABLE_QUARANTINE_CORRUPT"
                )
                != SCHEMA_VERSION
                or value["kind"] != "p36_durable_quarantine"
                or value["role"] != self.role
                or value["binding_hash"] != normalized_binding_hash(self.binding)
                or sha256_value(canonical(material)) != require_sha256(quarantine_hash, "durable quarantine hash")
            ):
                fail("durable quarantine binding is invalid", "DURABLE_QUARANTINE_CORRUPT")
            return value
        except DurableStateError as error:
            self._raise_quarantined(str(error), "DURABLE_QUARANTINE_CORRUPT")

    def _read_cohort_marker(self):
        raw = self._read_control_file(
            self.cohort_path,
            "durable cohort marker",
            allow_empty=True,
            maximum=65536,
        )
        if not raw:
            return None
        try:
            text = raw.decode("utf-8")
            value = parse_canonical_json_text(
                text,
                "durable cohort marker",
                "DURABLE_COHORT_MARKER_CORRUPT",
                newline=True,
            )
            value = require_exact_keys(
                value,
                {
                    "schema_version",
                    "kind",
                    "role",
                    "binding_hash",
                    "instance_hash",
                    "first_request_hash",
                    "marker_hash",
                },
                "durable cohort marker",
            )
            material = dict(value)
            marker_hash = material.pop("marker_hash")
            if (
                require_exact_int(
                    value["schema_version"], SCHEMA_VERSION, "durable cohort marker schema", "DURABLE_COHORT_MARKER_CORRUPT"
                )
                != SCHEMA_VERSION
                or value["kind"] != "p36_durable_cohort_marker"
                or value["role"] != self.role
                or value["binding_hash"] != normalized_binding_hash(self.binding)
                or sha256_value(canonical(material)) != require_sha256(marker_hash, "durable cohort marker hash")
            ):
                fail("durable cohort marker binding is invalid", "DURABLE_COHORT_MARKER_CORRUPT")
            require_sha256(value["instance_hash"], "durable cohort instance hash")
            require_sha256(value["first_request_hash"], "durable cohort request hash")
            return value
        except DurableStateError as error:
            self._raise_quarantined(str(error), "DURABLE_COHORT_MARKER_CORRUPT")

    def _claim_mutating_cohort(self, request_hash):
        marker = self._read_cohort_marker()
        if marker is not None:
            if marker["marker_hash"] == self._cohort_marker_hash:
                return
            self._raise_quarantined(
                "a new service instance attempted to reuse a durable cohort",
                "DURABLE_COHORT_RECOVERY_REQUIRED",
            )
        value = {
            "schema_version": SCHEMA_VERSION,
            "kind": "p36_durable_cohort_marker",
            "role": self.role,
            "binding_hash": normalized_binding_hash(self.binding),
            "instance_hash": self._instance_hash,
            "first_request_hash": require_sha256(request_hash, "durable cohort request hash"),
        }
        material = dict(value)
        value["marker_hash"] = sha256_value(canonical(material))
        try:
            self._write_empty_control_file(
                self.cohort_path,
                "durable cohort marker",
                (canonical(value) + "\n").encode("utf-8"),
            )
        except DurableStateError:
            self._poisoned = True
            raise
        self._cohort_marker_hash = value["marker_hash"]
        self._active_cohort_marker = value

    def _require_marker_for_journal(self, values):
        if len(values) > 1 and self._active_cohort_marker is None:
            self._raise_quarantined(
                "durable records exist without a root-visible cohort marker",
                "DURABLE_COHORT_MARKER_MISSING",
            )

    def _locked(self, callback):
        if self._poisoned:
            fail(
                "durable " + self.role + " state is no longer available",
                self._terminal_code or "DURABLE_STORAGE_UNCERTAIN",
            )
        descriptor = self._open_lock()
        try:
            if self._read_quarantine() is not None:
                fail("durable " + self.role + " state is quarantined", "DURABLE_QUARANTINED")
            marker = self._read_cohort_marker()
            if (
                marker is not None
                and not self.root_audit
                and marker["marker_hash"] != self._cohort_marker_hash
            ):
                self._raise_quarantined(
                    "a new service instance attempted to reuse a durable cohort",
                    "DURABLE_COHORT_RECOVERY_REQUIRED",
                )
            self._active_cohort_marker = marker
            try:
                return callback()
            finally:
                self._active_cohort_marker = None
        finally:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            finally:
                os.close(descriptor)

    def _append_journal(self, value):
        content = (canonical(value) + "\n").encode("utf-8")
        descriptor = None
        write_started = False
        try:
            existing = self._read_control_file(self.journal_path, "durable journal")
            if len(existing) + len(content) > MAX_JOURNAL_BYTES:
                self._block_cohort(
                    "DURABLE_JOURNAL_FULL",
                    "durable journal cannot persist another exact request snapshot",
                )
                fail("durable journal has reached its byte limit", "DURABLE_JOURNAL_FULL")
            descriptor = os.open(self.journal_path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
            self._require_root_file(os.fstat(descriptor), "durable journal", 0o660)
            write_started = True
            write_all(descriptor, content, "durable journal")
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = None
            self._fsync_directory()
        except DurableStateError as error:
            if write_started:
                self._poison_storage(str(error))
            raise
        except OSError as error:
            if write_started:
                self._poison_storage(str(error))
            fail("durable journal cannot be appended: " + str(error), "DURABLE_STORAGE_FAILED")
        finally:
            if descriptor is not None:
                os.close(descriptor)

    def _header(self, journal_kind):
        if journal_kind != journal_kind_for_role(self.role):
            fail("durable journal kind does not match its role", "DURABLE_FILESYSTEM_UNSAFE")
        return journal_header_for(self.binding, self.role)

    def _read_journal_values(self, journal_kind):
        raw = self._read_control_file(self.journal_path, "durable journal")
        if not raw.endswith(b"\n"):
            self._raise_quarantined("unterminated journal", "DURABLE_JOURNAL_CORRUPT")
        lines = raw[:-1].split(b"\n")
        if not lines or any(not line for line in lines):
            self._raise_quarantined("empty journal record", "DURABLE_JOURNAL_CORRUPT")
        values = []
        for line in lines:
            try:
                text = line.decode("utf-8")
                values.append(
                    parse_canonical_json_text(
                        text,
                        "durable journal record",
                        "DURABLE_JOURNAL_CORRUPT",
                    )
                )
            except (UnicodeDecodeError, DurableStateError) as error:
                self._raise_quarantined(str(error), "DURABLE_JOURNAL_CORRUPT")
        return values

    def _validate_header(self, value, journal_kind):
        try:
            value = require_exact_keys(
                value,
                {"schema_version", "kind", "binding", "previous_journal_hash", "journal_hash"},
                "durable journal header",
            )
            material = dict(value)
            journal_hash = material.pop("journal_hash")
            if (
                require_exact_int(
                    value["schema_version"], SCHEMA_VERSION, "durable journal header schema", "DURABLE_JOURNAL_CORRUPT"
                )
                != SCHEMA_VERSION
                or value["kind"] != journal_kind + "_header"
                or value["previous_journal_hash"] is not None
                or normalize_binding(value["binding"]) != self.binding
                or sha256_value(canonical(material)) != require_sha256(journal_hash, "durable journal header hash")
            ):
                fail("durable journal header is invalid", "DURABLE_JOURNAL_CORRUPT")
            return value
        except DurableStateError as error:
            self._raise_quarantined(str(error), "DURABLE_JOURNAL_CORRUPT")

    def _common_result(self, kind, status, code, request, request_canonical, envelope_hash, responder_role):
        responder = self.binding["service_bindings"][responder_role]
        return {
            "schema_version": SCHEMA_VERSION,
            "kind": kind,
            "status": status,
            "code": code,
            "request_id": request["request_id"],
            "operation": request["operation"],
            "install_binding_hash": self.binding["install_binding_hash"],
            "run_binding_hash": self.binding["run_binding_hash"],
            "substrate_abi_hash": self.binding["substrate_abi_hash"],
            "substrate_plan_hash": self.binding["substrate_plan_hash"],
            "durable_abi_hash": self.binding["durable_abi_hash"],
            "cohort_id": self.binding["cohort_id"],
            "generation": self.binding["generation"],
            "request_hash": sha256_value(request_canonical),
            "request_envelope_hash": require_sha256(envelope_hash, "durable request envelope hash"),
            "responder_role": responder_role,
            "responder_identity": responder["identity"],
            "responder_attestation_hash": responder["attestation_hash"],
            "responder_cgroup_binding_hash": responder["cgroup_binding_hash"],
            "owner_kernel_authority": "none",
            "effect_authority": "none",
            "broker_authority": "disabled",
            "acceptance": "not_available",
        }


def normalize_witness_request(value, binding):
    value = require_plain_object(value, "durable witness request")
    operation = require_token(value.get("operation"), "durable witness operation")
    fields = {
        "appendIfHead": {
            "schema_version", "request_id", "operation", "stream_id", "expected_head",
            "event_hash", "event_payload_hash", "substrate_plan_hash",
        },
        "appendBatchIfHead": {
            "schema_version", "request_id", "operation", "stream_id", "expected_head",
            "events", "substrate_plan_hash",
        },
        "getHead": {"schema_version", "request_id", "operation", "stream_id", "substrate_plan_hash"},
        "readback": {
            "schema_version", "request_id", "operation", "stream_id", "from_sequence",
            "limit", "substrate_plan_hash",
        },
    }
    if operation not in fields:
        fail("durable witness operation is unsupported", "DURABLE_REQUEST_INVALID")
    value = require_exact_keys(value, fields[operation], "durable witness request")
    if require_exact_int(
        value["schema_version"], SCHEMA_VERSION, "durable witness request schema", "DURABLE_REQUEST_INVALID"
    ) != SCHEMA_VERSION:
        fail("durable witness request schema is unsupported", "DURABLE_REQUEST_INVALID")
    request = {
        "schema_version": SCHEMA_VERSION,
        "request_id": require_token(value["request_id"], "durable witness request id"),
        "operation": operation,
        "stream_id": require_token(value["stream_id"], "durable witness stream id"),
        "substrate_plan_hash": require_sha256(value["substrate_plan_hash"], "durable witness plan"),
    }
    if request["substrate_plan_hash"] != binding["substrate_plan_hash"]:
        fail("durable witness request does not match the frozen plan", "DURABLE_REQUEST_INVALID")
    if operation == "appendIfHead":
        request.update(
            {
                "expected_head": require_nullable_sha256(value["expected_head"], "durable witness expected head"),
                "event_hash": require_sha256(value["event_hash"], "durable witness event hash"),
                "event_payload_hash": require_sha256(value["event_payload_hash"], "durable witness event payload hash"),
            }
        )
    elif operation == "appendBatchIfHead":
        if not isinstance(value["events"], list) or not (1 <= len(value["events"]) <= MAX_BATCH_EVENTS):
            fail("durable witness batch event count is invalid", "DURABLE_REQUEST_INVALID")
        seen = set()
        events = []
        for index, event in enumerate(value["events"]):
            event = require_exact_keys(event, {"event_hash", "event_payload_hash"}, "durable witness batch event")
            event_hash = require_sha256(event["event_hash"], "durable witness batch event hash")
            if event_hash in seen:
                fail("durable witness batch repeats an event hash", "DURABLE_REQUEST_INVALID")
            seen.add(event_hash)
            events.append(
                {
                    "event_hash": event_hash,
                    "event_payload_hash": require_sha256(
                        event["event_payload_hash"], "durable witness batch event payload hash"
                    ),
                }
            )
        request.update(
            {
                "expected_head": require_nullable_sha256(value["expected_head"], "durable witness expected head"),
                "events": events,
            }
        )
    elif operation == "readback":
        limit = value["limit"]
        if isinstance(limit, bool) or not isinstance(limit, int) or not (1 <= limit <= MAX_READBACK_LIMIT):
            fail("durable witness readback limit is invalid", "DURABLE_REQUEST_INVALID")
        request.update(
            {
                "from_sequence": require_positive_int(value["from_sequence"], "durable witness from sequence"),
                "limit": limit,
            }
        )
    return request


def witness_receipt(stream_id, sequence, previous_head, event, request_hash):
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_witness_receipt",
        "stream_id": stream_id,
        "sequence": sequence,
        "previous_head": previous_head,
        "event_hash": event["event_hash"],
        "event_payload_hash": event["event_payload_hash"],
        "request_hash": request_hash,
    }
    return {
        "sequence": sequence,
        "event_hash": event["event_hash"],
        "event_payload_hash": event["event_payload_hash"],
        "previous_head": previous_head,
        "request_hash": request_hash,
        "head": sha256_value(canonical(material)),
    }


class DurableWitness(DurableLeaf):
    JOURNAL_KIND = "p36_durable_witness_journal"

    def __init__(self, state_root, binding, root_audit=False):
        super().__init__(state_root, binding, "witness", root_audit=root_audit)

    def _record_hash(self, record):
        material = dict(record)
        material.pop("journal_hash", None)
        return sha256_value(canonical(material))

    def _load_locked(self):
        values = self._read_journal_values(self.JOURNAL_KIND)
        self._require_marker_for_journal(values)
        try:
            header = self._validate_header(values[0], self.JOURNAL_KIND)
            state = {"journal_hash": header["journal_hash"], "streams": {}, "requests": {}}
            for raw in values[1:]:
                record = self._normalize_record(raw, state["journal_hash"])
                self._apply_record(state, record)
            return state
        except DurableStateError as error:
            if error.code.startswith("DURABLE_"):
                self._raise_quarantined(str(error), "DURABLE_JOURNAL_CORRUPT")
            raise

    def _normalize_record(self, value, expected_previous_hash):
        value = require_plain_object(value, "durable witness journal record")
        record_type = value.get("record_type")
        if record_type == "mutation":
            expected_fields = {
                "schema_version", "kind", "record_type", "operation", "request_id",
                "request_canonical", "request_hash", "request_envelope_hash", "stream_id",
                "expected_head", "events", "receipts", "previous_journal_hash", "journal_hash",
            }
        elif record_type == "query":
            expected_fields = {
                "schema_version", "kind", "record_type", "operation", "request_id",
                "request_canonical", "request_hash", "request_envelope_hash", "stream_id",
                "snapshot", "previous_journal_hash", "journal_hash",
            }
        else:
            fail("durable witness journal record type is invalid")
        value = require_exact_keys(value, expected_fields, "durable witness journal record")
        if (
            require_exact_int(
                value["schema_version"], SCHEMA_VERSION, "durable witness journal schema", "DURABLE_JOURNAL_CORRUPT"
            )
            != SCHEMA_VERSION
            or value["kind"] != "p36_durable_witness_record"
            or value["record_type"] != record_type
            or value["previous_journal_hash"] != expected_previous_hash
            or value["journal_hash"] != self._record_hash(value)
        ):
            fail("durable witness journal chain is invalid")
        if not isinstance(value["request_canonical"], str):
            fail("durable witness journal request is invalid")
        request_bytes = value["request_canonical"].encode("utf-8")
        request_value, request_canonical = decode_canonical_request(request_bytes, "durable witness journal request")
        request = normalize_witness_request(request_value, self.binding)
        if (
            request_canonical != value["request_canonical"]
            or sha256_value(request_canonical) != require_sha256(value["request_hash"], "durable witness record request hash")
            or request["request_id"] != value["request_id"]
            or request["operation"] != value["operation"]
            or request["stream_id"] != value["stream_id"]
        ):
            fail("durable witness journal request binding is invalid")
        require_sha256(value["request_envelope_hash"], "durable witness record envelope hash")
        if record_type == "mutation":
            if (
                request["operation"] not in {"appendIfHead", "appendBatchIfHead"}
                or request["expected_head"] != value["expected_head"]
            ):
                fail("durable witness mutation request binding is invalid")
            events = value["events"]
            if not isinstance(events, list) or not events:
                fail("durable witness journal events are invalid")
            normalized_events = []
            for event in events:
                event = require_exact_keys(event, {"event_hash", "event_payload_hash"}, "durable witness journal event")
                normalized_events.append(
                    {
                        "event_hash": require_sha256(event["event_hash"], "durable witness journal event hash"),
                        "event_payload_hash": require_sha256(
                            event["event_payload_hash"],
                            "durable witness journal event payload hash",
                        ),
                    }
                )
            expected_events = (
                [{"event_hash": request["event_hash"], "event_payload_hash": request["event_payload_hash"]}]
                if request["operation"] == "appendIfHead"
                else request["events"]
            )
            if (
                normalized_events != expected_events
                or not isinstance(value["receipts"], list)
                or len(value["receipts"]) != len(expected_events)
            ):
                fail("durable witness journal event set is invalid")
            return dict(value, request=request, events=normalized_events)
        if request["operation"] not in {"getHead", "readback"}:
            fail("durable witness query request binding is invalid")
        snapshot = require_exact_keys(
            value["snapshot"],
            {"head", "sequence", "records", "journal_hash"},
            "durable witness query snapshot",
        )
        if (
            require_nullable_sha256(snapshot["head"], "durable witness query head") != snapshot["head"]
            or require_nonnegative_int(snapshot["sequence"], "durable witness query sequence") != snapshot["sequence"]
            or require_sha256(snapshot["journal_hash"], "durable witness query journal hash") != expected_previous_hash
            or not isinstance(snapshot["records"], list)
        ):
            fail("durable witness query snapshot is invalid")
        return dict(value, request=request, snapshot=snapshot)

    def _apply_record(self, state, record):
        request = record["request"]
        request_id = request["request_id"]
        if request_id in state["requests"]:
            fail("durable witness journal repeats a request id")
        stream = state["streams"].setdefault(
            request["stream_id"], {"head": None, "sequence": 0, "receipts": []}
        )
        if record["record_type"] == "mutation":
            if stream["head"] != request["expected_head"]:
                fail("durable witness journal compare-and-append head is stale")
            receipts = []
            previous_head = stream["head"]
            for index, event in enumerate(record["events"]):
                expected = witness_receipt(
                    request["stream_id"],
                    stream["sequence"] + index + 1,
                    previous_head,
                    event,
                    record["request_hash"],
                )
                if record["receipts"][index] != expected:
                    fail("durable witness journal receipt is invalid")
                receipts.append(expected)
                previous_head = expected["head"]
            stream["sequence"] += len(receipts)
            stream["head"] = previous_head
            stream["receipts"].extend(receipts)
        else:
            snapshot = record["snapshot"]
            expected_records = (
                []
                if request["operation"] == "getHead"
                else [
                    receipt
                    for receipt in stream["receipts"]
                    if receipt["sequence"] >= request["from_sequence"]
                ][: request["limit"]]
            )
            if (
                snapshot["journal_hash"] != state["journal_hash"]
                or snapshot["head"] != stream["head"]
                or snapshot["sequence"] != stream["sequence"]
                or snapshot["records"] != expected_records
            ):
                fail("durable witness query snapshot is not an immutable state view")
        state["requests"][request_id] = record
        state["journal_hash"] = record["journal_hash"]

    def _result(self, request, request_canonical, envelope_hash, status, code, stream, records, journal_hash):
        material = self._common_result(
            "p36_durable_witness_result",
            status,
            code,
            request,
            request_canonical,
            envelope_hash,
            "witness",
        )
        material.update(
            {
                "stream_id": request["stream_id"],
                "head": stream["head"],
                "sequence": stream["sequence"],
                "records": records,
                "journal_hash": journal_hash,
            }
        )
        return dict(material, result_hash=sha256_value(canonical(material)))

    def _result_from_record(self, record):
        request = record["request"]
        if record["record_type"] == "query":
            snapshot = record["snapshot"]
            return self._result(
                request,
                record["request_canonical"],
                record["request_envelope_hash"],
                "available",
                "WITNESS_AVAILABLE",
                {"head": snapshot["head"], "sequence": snapshot["sequence"]},
                snapshot["records"],
                snapshot["journal_hash"],
            )
        receipts = record["receipts"]
        stream = {
            "head": receipts[-1]["head"],
            "sequence": receipts[-1]["sequence"],
        }
        return self._result(
            request,
            record["request_canonical"],
            record["request_envelope_hash"],
            "recorded",
            "WITNESS_RECORDED",
            stream,
            receipts,
            record["journal_hash"],
        )

    def handle(self, raw_request, request_envelope_hash):
        value, request_canonical = decode_canonical_request(raw_request, "durable witness request")
        envelope_hash = require_sha256(request_envelope_hash, "durable witness request envelope hash")

        def operation():
            state = self._load_locked()
            try:
                request = normalize_witness_request(value, self.binding)
            except DurableStateError as error:
                if error.code == "DURABLE_STATE_INVALID":
                    fail(str(error), "DURABLE_REQUEST_INVALID")
                raise
            existing = state["requests"].get(request["request_id"])
            if existing is not None:
                if (
                    existing["request_canonical"] == request_canonical
                    and existing["request_envelope_hash"] == envelope_hash
                ):
                    return self._result_from_record(existing)
                fail("durable witness request id replay conflicts with committed bytes", "WITNESS_REQUEST_REPLAY_CONFLICT")
            request_hash = sha256_value(request_canonical)
            if request["operation"] in {"appendIfHead", "appendBatchIfHead"}:
                stream = state["streams"].get(request["stream_id"], {"head": None, "sequence": 0, "receipts": []})
                if stream["head"] != request["expected_head"]:
                    fail("durable witness compare-and-append head is stale", "WITNESS_HEAD_STALE")
                events = (
                    [{"event_hash": request["event_hash"], "event_payload_hash": request["event_payload_hash"]}]
                    if request["operation"] == "appendIfHead"
                    else request["events"]
                )
                previous_head = stream["head"]
                receipts = []
                for index, event in enumerate(events):
                    receipt = witness_receipt(
                        request["stream_id"], stream["sequence"] + index + 1, previous_head, event, request_hash
                    )
                    receipts.append(receipt)
                    previous_head = receipt["head"]
                record = {
                    "schema_version": SCHEMA_VERSION,
                    "kind": "p36_durable_witness_record",
                    "record_type": "mutation",
                    "operation": request["operation"],
                    "request_id": request["request_id"],
                    "request_canonical": request_canonical,
                    "request_hash": request_hash,
                    "request_envelope_hash": envelope_hash,
                    "stream_id": request["stream_id"],
                    "expected_head": request["expected_head"],
                    "events": events,
                    "receipts": receipts,
                    "previous_journal_hash": state["journal_hash"],
                }
                record["journal_hash"] = self._record_hash(record)
                self._claim_mutating_cohort(request_hash)
                self._append_journal(record)
                normalized_record = self._normalize_record(record, state["journal_hash"])
                self._apply_record(state, normalized_record)
                return self._result_from_record(normalized_record)
            stream = state["streams"].get(request["stream_id"], {"head": None, "sequence": 0, "receipts": []})
            records = (
                []
                if request["operation"] == "getHead"
                else [
                    receipt
                    for receipt in stream["receipts"]
                    if receipt["sequence"] >= request["from_sequence"]
                ][: request["limit"]]
            )
            record = {
                "schema_version": SCHEMA_VERSION,
                "kind": "p36_durable_witness_record",
                "record_type": "query",
                "operation": request["operation"],
                "request_id": request["request_id"],
                "request_canonical": request_canonical,
                "request_hash": request_hash,
                "request_envelope_hash": envelope_hash,
                "stream_id": request["stream_id"],
                "snapshot": {
                    "head": stream["head"],
                    "sequence": stream["sequence"],
                    "records": records,
                    "journal_hash": state["journal_hash"],
                },
                "previous_journal_hash": state["journal_hash"],
            }
            record["journal_hash"] = self._record_hash(record)
            self._claim_mutating_cohort(request_hash)
            self._append_journal(record)
            normalized_record = self._normalize_record(record, state["journal_hash"])
            self._apply_record(state, normalized_record)
            return self._result_from_record(normalized_record)

        return self._locked(operation)

    def availability(self):
        def operation():
            state = self._load_locked()
            return service_availability_snapshot(
                self.binding,
                "witness",
                "available",
                state["journal_hash"],
            )

        return self._locked(operation)


class DurableReceiptAnchor(DurableLeaf):
    """Receipt-verifier-owned commitments for witness mutation responses.

    The anchor has no transport endpoint or caller-controlled operation.  The
    receipt verifier appends a record only after the existing authenticated
    receipt-verifier-to-witness route has validated an exact mutation response.
    Query records do not advance a witness stream head and remain protected by
    the witness journal's local chain only. Root later compares this separate
    journal with the witness mutation/head ledger; a witness cannot rewrite
    both role-owned leaves.
    """

    JOURNAL_KIND = "p36_durable_receipt_anchor_journal"
    ENDPOINT_ID = "receipt_verifier_witness"
    ANCHORED_OPERATIONS = frozenset({"appendIfHead", "appendBatchIfHead"})

    def __init__(self, state_root, binding, root_audit=False):
        super().__init__(state_root, binding, "receipt_verifier", root_audit=root_audit)

    def _record_hash(self, record):
        material = dict(record)
        material.pop("journal_hash", None)
        return sha256_value(canonical(material))

    def _load_locked(self):
        values = self._read_journal_values(self.JOURNAL_KIND)
        self._require_marker_for_journal(values)
        try:
            header = self._validate_header(values[0], self.JOURNAL_KIND)
            state = {"journal_hash": header["journal_hash"], "records": {}, "ordered": []}
            for raw in values[1:]:
                record = self._normalize_record(raw, state["journal_hash"])
                if record["request_id"] in state["records"]:
                    fail("durable receipt anchor repeats a witness request id")
                state["records"][record["request_id"]] = record
                state["ordered"].append(record)
                state["journal_hash"] = record["journal_hash"]
            return state
        except DurableStateError as error:
            if error.code.startswith("DURABLE_"):
                self._raise_quarantined(str(error), "DURABLE_JOURNAL_CORRUPT")
            raise

    def _normalize_record(self, value, expected_previous_hash):
        value = require_exact_keys(
            value,
            {
                "schema_version", "kind", "request_id", "operation", "request_hash",
                "request_envelope_hash", "endpoint_id", "witness_status", "witness_code",
                "witness_result_hash", "witness_response_hash",
                "witness_stream_id", "witness_head", "witness_sequence", "witness_journal_hash",
                "previous_journal_hash", "journal_hash",
            },
            "durable receipt anchor record",
        )
        if (
            require_exact_int(
                value["schema_version"], SCHEMA_VERSION, "durable receipt anchor schema", "DURABLE_JOURNAL_CORRUPT"
            )
            != SCHEMA_VERSION
            or value["kind"] != "p36_durable_receipt_anchor_record"
            or value["previous_journal_hash"] != expected_previous_hash
            or value["journal_hash"] != self._record_hash(value)
        ):
            fail("durable receipt anchor journal chain is invalid")
        operation = require_token(value["operation"], "durable receipt anchor operation")
        expected_status, expected_code = self._expected_witness_outcome(operation)
        if (
            value["endpoint_id"] != self.ENDPOINT_ID
            or value["witness_status"] != expected_status
            or value["witness_code"] != expected_code
        ):
            fail("durable receipt anchor record is outside the fixed witness route", "DURABLE_JOURNAL_CORRUPT")
        return {
            "schema_version": SCHEMA_VERSION,
            "kind": "p36_durable_receipt_anchor_record",
            "request_id": require_token(value["request_id"], "durable receipt anchor request id"),
            "operation": operation,
            "request_hash": require_sha256(value["request_hash"], "durable receipt anchor request hash"),
            "request_envelope_hash": require_sha256(
                value["request_envelope_hash"], "durable receipt anchor envelope hash"
            ),
            "endpoint_id": require_token(value["endpoint_id"], "durable receipt anchor endpoint"),
            "witness_status": require_token(value["witness_status"], "durable receipt anchor witness status"),
            "witness_code": require_token(value["witness_code"], "durable receipt anchor witness code"),
            "witness_result_hash": require_sha256(
                value["witness_result_hash"], "durable receipt anchor witness result hash"
            ),
            "witness_response_hash": require_sha256(
                value["witness_response_hash"], "durable receipt anchor witness response hash"
            ),
            "witness_stream_id": require_token(
                value["witness_stream_id"], "durable receipt anchor witness stream"
            ),
            "witness_head": require_nullable_sha256(
                value["witness_head"], "durable receipt anchor witness head"
            ),
            "witness_sequence": require_nonnegative_int(
                value["witness_sequence"], "durable receipt anchor witness sequence"
            ),
            "witness_journal_hash": require_sha256(
                value["witness_journal_hash"], "durable receipt anchor witness journal"
            ),
            "previous_journal_hash": require_sha256(
                value["previous_journal_hash"], "durable receipt anchor previous journal"
            ),
            "journal_hash": require_sha256(value["journal_hash"], "durable receipt anchor journal hash"),
        }

    @classmethod
    def _expected_witness_outcome(cls, operation):
        if operation not in cls.ANCHORED_OPERATIONS:
            fail("durable receipt anchor operation is outside its fixed witness route", "DURABLE_RECEIPT_INVALID")
        return "recorded", "WITNESS_RECORDED"

    def _normalize_witness_response(self, request, request_canonical, envelope_hash, response):
        if not isinstance(response, dict):
            fail("durable receipt anchor witness response is not an object", "DURABLE_RECEIPT_INVALID")
        fields = {
            "schema_version", "kind", "status", "code", "request_id", "operation",
            "install_binding_hash", "run_binding_hash", "substrate_abi_hash",
            "substrate_plan_hash", "durable_abi_hash", "cohort_id", "generation",
            "request_hash", "request_envelope_hash", "responder_role", "responder_identity",
            "responder_attestation_hash", "responder_cgroup_binding_hash",
            "owner_kernel_authority", "effect_authority", "broker_authority", "acceptance",
            "stream_id", "head", "sequence", "records", "journal_hash", "result_hash",
        }
        response = require_exact_keys(response, fields, "durable receipt anchor witness response")
        material = dict(response)
        result_hash = material.pop("result_hash")
        witness = self.binding["service_bindings"]["witness"]
        expected_status, expected_code = self._expected_witness_outcome(request["operation"])
        if (
            require_exact_int(
                response["schema_version"], SCHEMA_VERSION, "durable receipt anchor response schema", "DURABLE_RECEIPT_INVALID"
            )
            != SCHEMA_VERSION
            or response["kind"] != "p36_durable_witness_result"
            or response["status"] != expected_status
            or response["code"] != expected_code
            or response["request_id"] != request["request_id"]
            or response["operation"] != request["operation"]
            or response["request_hash"] != sha256_value(request_canonical)
            or response["request_envelope_hash"] != envelope_hash
            or response["responder_role"] != "witness"
            or response["responder_identity"] != witness["identity"]
            or response["responder_attestation_hash"] != witness["attestation_hash"]
            or response["responder_cgroup_binding_hash"] != witness["cgroup_binding_hash"]
            or response["owner_kernel_authority"] != "none"
            or response["effect_authority"] != "none"
            or response["broker_authority"] != "disabled"
            or response["acceptance"] != "not_available"
            or any(
                response[key] != self.binding[key]
                for key in (
                    "install_binding_hash", "run_binding_hash", "substrate_abi_hash",
                    "substrate_plan_hash", "durable_abi_hash", "cohort_id", "generation",
                )
            )
            or sha256_value(canonical(material)) != require_sha256(
                result_hash, "durable receipt anchor witness result hash"
            )
        ):
            fail("durable receipt anchor witness response does not bind the fixed cohort", "DURABLE_RECEIPT_INVALID")
        if not isinstance(response["records"], list):
            fail("durable receipt anchor witness response records are invalid", "DURABLE_RECEIPT_INVALID")
        return response

    def record_witness_response(self, raw_request, request_envelope_hash, response):
        value, request_canonical = decode_canonical_request(raw_request, "durable receipt anchor witness request")
        request = normalize_witness_request(value, self.binding)
        expected_status, expected_code = self._expected_witness_outcome(request["operation"])
        envelope_hash = require_sha256(request_envelope_hash, "durable receipt anchor envelope hash")
        response = self._normalize_witness_response(request, request_canonical, envelope_hash, response)

        def operation():
            state = self._load_locked()
            existing = state["records"].get(request["request_id"])
            record = {
                "schema_version": SCHEMA_VERSION,
                "kind": "p36_durable_receipt_anchor_record",
                "request_id": request["request_id"],
                "operation": request["operation"],
                "request_hash": sha256_value(request_canonical),
                "request_envelope_hash": envelope_hash,
                "endpoint_id": self.ENDPOINT_ID,
                "witness_status": expected_status,
                "witness_code": expected_code,
                "witness_result_hash": response["result_hash"],
                "witness_response_hash": sha256_value(canonical(response)),
                "witness_stream_id": request["stream_id"],
                "witness_head": response["head"],
                "witness_sequence": response["sequence"],
                "witness_journal_hash": response["journal_hash"],
                "previous_journal_hash": state["journal_hash"],
            }
            record["journal_hash"] = self._record_hash(record)
            if existing is not None:
                compare_fields = {
                    "schema_version", "kind", "request_id", "operation", "request_hash",
                    "request_envelope_hash", "endpoint_id", "witness_status", "witness_code",
                    "witness_result_hash", "witness_response_hash",
                    "witness_stream_id", "witness_head", "witness_sequence", "witness_journal_hash",
                }
                if all(existing[field] == record[field] for field in compare_fields):
                    return existing
                fail("durable receipt anchor request id replay conflicts with committed bytes", "RECEIPT_ANCHOR_REPLAY_CONFLICT")
            self._claim_mutating_cohort(record["request_hash"])
            self._append_journal(record)
            normalized = self._normalize_record(record, state["journal_hash"])
            return normalized

        return self._locked(operation)

    def records_for_audit(self):
        def operation():
            state = self._load_locked()
            return list(state["ordered"]), state["journal_hash"]

        return self._locked(operation)

    def availability(self):
        def operation():
            state = self._load_locked()
            return service_availability_snapshot(
                self.binding,
                "receipt_verifier",
                "available",
                state["journal_hash"],
            )

        return self._locked(operation)


def audit_receipt_anchor(witness_leaf, receipt_anchor_leaf, binding):
    """Root-only compare of receipt commitments against witness mutation state."""

    if os.geteuid() != 0 or os.getegid() != 0:
        fail("durable receipt-anchor audit requires effective UID/GID 0", "DURABLE_AUDIT_NOT_ROOT")
    binding = normalize_binding(binding)
    witness = DurableWitness(witness_leaf, binding, root_audit=True)
    anchor = DurableReceiptAnchor(receipt_anchor_leaf, binding, root_audit=True)
    records, anchor_journal_hash = anchor.records_for_audit()
    if not records:
        fail("durable receipt anchor has no witness commitments", "DURABLE_RECEIPT_AUDIT_FAILED")

    def operation():
        state = witness._load_locked()
        # The anchor intentionally covers only append mutations: those are the
        # fixed operations that advance a stream head and define A0's durable
        # event ledger. Query records are not independently receipt-anchored.
        anchored_request_ids = {record["request_id"] for record in records}
        witness_mutation_ids = {
            request_id
            for request_id, witness_record in state["requests"].items()
            if witness_record["record_type"] == "mutation"
        }
        if witness_mutation_ids != anchored_request_ids:
            fail(
                "durable receipt anchor does not cover every witness mutation",
                "DURABLE_RECEIPT_AUDIT_FAILED",
            )
        for record in records:
            witness_record = state["requests"].get(record["request_id"])
            if witness_record is None:
                fail("durable receipt anchor references a missing witness request", "DURABLE_RECEIPT_AUDIT_FAILED")
            response = witness._result_from_record(witness_record)
            expected_status, expected_code = anchor._expected_witness_outcome(record["operation"])
            if (
                record["operation"] != response["operation"]
                or record["request_hash"] != response["request_hash"]
                or record["request_envelope_hash"] != response["request_envelope_hash"]
                or record["endpoint_id"] != anchor.ENDPOINT_ID
                or record["witness_status"] != expected_status
                or record["witness_status"] != response["status"]
                or record["witness_code"] != expected_code
                or record["witness_code"] != response["code"]
                or record["witness_result_hash"] != response["result_hash"]
                or record["witness_response_hash"] != sha256_value(canonical(response))
                or record["witness_stream_id"] != response["stream_id"]
                or record["witness_head"] != response["head"]
                or record["witness_sequence"] != response["sequence"]
                or record["witness_journal_hash"] != response["journal_hash"]
            ):
                fail("durable receipt anchor does not match the witness journal", "DURABLE_RECEIPT_AUDIT_FAILED")
        material = {
            "schema_version": SCHEMA_VERSION,
            "kind": "p36_durable_receipt_anchor_audit",
            "status": "verified",
            "binding_hash": normalized_binding_hash(binding),
            "anchored_records": len(records),
            "receipt_anchor_journal_hash": anchor_journal_hash,
            "witness_journal_hash": state["journal_hash"],
        }
        return dict(material, audit_hash=sha256_value(canonical(material)))

    return witness._locked(operation)


def normalize_coordinator_request(value, binding):
    value = require_exact_keys(
        value,
        {
            "schema_version", "request_id", "operation", "transaction_id", "fence",
            "expected_witness_head", "substrate_plan_hash",
        },
        "durable coordinator request",
    )
    if require_exact_int(
        value["schema_version"], SCHEMA_VERSION, "durable coordinator request schema", "DURABLE_REQUEST_INVALID"
    ) != SCHEMA_VERSION:
        fail("durable coordinator request schema is unsupported", "DURABLE_REQUEST_INVALID")
    operation = require_token(value["operation"], "durable coordinator operation")
    if operation not in {"prepare", "cancel", "resolve"}:
        fail("durable coordinator operation is unsupported", "DURABLE_REQUEST_INVALID")
    request = {
        "schema_version": SCHEMA_VERSION,
        "request_id": require_token(value["request_id"], "durable coordinator request id"),
        "operation": operation,
        "transaction_id": require_token(value["transaction_id"], "durable coordinator transaction id"),
        "fence": require_positive_int(value["fence"], "durable coordinator fence"),
        "expected_witness_head": require_nullable_sha256(
            value["expected_witness_head"], "durable coordinator expected witness head"
        ),
        "substrate_plan_hash": require_sha256(value["substrate_plan_hash"], "durable coordinator plan"),
    }
    if request["substrate_plan_hash"] != binding["substrate_plan_hash"]:
        fail("durable coordinator request does not match the frozen plan", "DURABLE_REQUEST_INVALID")
    return request


class DurableCoordinator(DurableLeaf):
    JOURNAL_KIND = "p36_durable_coordinator_journal"

    def __init__(self, state_root, binding):
        super().__init__(state_root, binding, "coordinator")
        self._known_journal_hash = None

    def _record_hash(self, record):
        material = dict(record)
        material.pop("journal_hash", None)
        return sha256_value(canonical(material))

    def _load_locked(self):
        values = self._read_journal_values(self.JOURNAL_KIND)
        self._require_marker_for_journal(values)
        try:
            header = self._validate_header(values[0], self.JOURNAL_KIND)
            state = {"journal_hash": header["journal_hash"], "highest_fence": 0, "transactions": {}, "requests": {}}
            for raw in values[1:]:
                record = self._normalize_record(raw, state["journal_hash"])
                self._apply_record(state, record)
            pending = any(item["status"] == "prepared" for item in state["transactions"].values())
            if pending and self._known_journal_hash != state["journal_hash"]:
                self._raise_quarantined("coordinator recovered a pending state", "COORDINATOR_RECOVERY_REQUIRED")
            self._known_journal_hash = state["journal_hash"]
            return state
        except DurableStateError as error:
            if error.code.startswith("DURABLE_"):
                self._raise_quarantined(str(error), "DURABLE_JOURNAL_CORRUPT")
            raise

    def _normalize_record(self, value, expected_previous_hash):
        value = require_exact_keys(
            value,
            {
                "schema_version", "kind", "operation", "request_id", "request_canonical",
                "request_hash", "request_envelope_hash", "transaction_id", "fence",
                "expected_witness_head", "status", "previous_journal_hash", "journal_hash",
            },
            "durable coordinator journal record",
        )
        record_fence = require_positive_int(value["fence"], "durable coordinator record fence")
        if (
            require_exact_int(
                value["schema_version"], SCHEMA_VERSION, "durable coordinator journal schema", "DURABLE_JOURNAL_CORRUPT"
            )
            != SCHEMA_VERSION
            or value["kind"] != "p36_durable_coordinator_record"
            or value["previous_journal_hash"] != expected_previous_hash
            or value["journal_hash"] != self._record_hash(value)
            or value["status"] not in {"prepared", "cancelled", "unavailable", "unknown"}
        ):
            fail("durable coordinator journal chain is invalid")
        if not isinstance(value["request_canonical"], str):
            fail("durable coordinator journal request is invalid")
        request_value, request_canonical = decode_canonical_request(
            value["request_canonical"].encode("utf-8"), "durable coordinator journal request"
        )
        request = normalize_coordinator_request(request_value, self.binding)
        if (
            request_canonical != value["request_canonical"]
            or request["request_id"] != value["request_id"]
            or request["operation"] != value["operation"]
            or request["transaction_id"] != value["transaction_id"]
            or request["fence"] != record_fence
            or request["expected_witness_head"] != value["expected_witness_head"]
            or sha256_value(request_canonical) != require_sha256(value["request_hash"], "durable coordinator request hash")
        ):
            fail("durable coordinator journal request binding is invalid")
        require_sha256(value["request_envelope_hash"], "durable coordinator envelope hash")
        return dict(value, request=request)

    def _apply_record(self, state, record):
        request = record["request"]
        if request["request_id"] in state["requests"]:
            fail("durable coordinator journal repeats a request id")
        transaction = state["transactions"].get(request["transaction_id"])
        if request["operation"] == "prepare":
            if transaction is not None or request["fence"] <= state["highest_fence"] or record["status"] != "prepared":
                fail("durable coordinator prepared record is invalid")
            transaction = {
                "fence": request["fence"],
                "expected_witness_head": request["expected_witness_head"],
                "status": "prepared",
                "journal_hash": record["journal_hash"],
            }
            state["transactions"][request["transaction_id"]] = transaction
            state["highest_fence"] = request["fence"]
        else:
            if transaction is None:
                if record["status"] != "unknown" or request["fence"] <= state["highest_fence"]:
                    fail("durable coordinator unknown terminal record is invalid")
                transaction = {
                    "fence": request["fence"],
                    "expected_witness_head": request["expected_witness_head"],
                    "status": "unknown",
                    "journal_hash": record["journal_hash"],
                }
                state["transactions"][request["transaction_id"]] = transaction
                state["highest_fence"] = request["fence"]
            else:
                if (
                    transaction["status"] != "prepared"
                    or transaction["fence"] != request["fence"]
                    or transaction["expected_witness_head"] != request["expected_witness_head"]
                    or record["status"] != {
                        "cancel": "cancelled",
                        "resolve": "unavailable",
                    }[request["operation"]]
                ):
                    fail("durable coordinator terminal record is invalid")
                transaction["status"] = record["status"]
                transaction["journal_hash"] = record["journal_hash"]
        state["requests"][request["request_id"]] = record
        state["journal_hash"] = record["journal_hash"]

    def _state_hash(self, transaction_id, transaction):
        return sha256_value(
            canonical(
                {
                    "transaction_id": transaction_id,
                    "fence": transaction["fence"],
                    "expected_witness_head": transaction["expected_witness_head"],
                    "status": transaction["status"],
                    "journal_hash": transaction["journal_hash"],
                }
            )
        )

    def _result(self, request, request_canonical, envelope_hash, status, code, transaction, journal_hash):
        material = self._common_result(
            "p36_durable_coordinator_result",
            status,
            code,
            request,
            request_canonical,
            envelope_hash,
            "coordinator",
        )
        material.update(
            {
                "transaction_id": request["transaction_id"],
                "fence": request["fence"],
                "state_hash": self._state_hash(request["transaction_id"], transaction),
                "journal_hash": journal_hash,
            }
        )
        return dict(material, result_hash=sha256_value(canonical(material)))

    def _result_from_record(self, record):
        status = record["status"]
        code = {
            "prepared": "COORDINATOR_PREPARED",
            "cancelled": "COORDINATOR_CANCELLED",
            "unavailable": "COORDINATOR_RESOLVED_UNAVAILABLE",
            "unknown": "COORDINATOR_RESOLVED_UNKNOWN",
        }[status]
        transaction = {
            "fence": record["fence"],
            "expected_witness_head": record["expected_witness_head"],
            "status": status,
            "journal_hash": record["journal_hash"],
        }
        return self._result(
            record["request"],
            record["request_canonical"],
            record["request_envelope_hash"],
            status,
            code,
            transaction,
            record["journal_hash"],
        )

    def handle(self, raw_request, request_envelope_hash):
        value, request_canonical = decode_canonical_request(raw_request, "durable coordinator request")
        envelope_hash = require_sha256(request_envelope_hash, "durable coordinator request envelope hash")

        def operation():
            state = self._load_locked()
            try:
                request = normalize_coordinator_request(value, self.binding)
            except DurableStateError as error:
                if error.code == "DURABLE_STATE_INVALID":
                    fail(str(error), "DURABLE_REQUEST_INVALID")
                raise
            existing = state["requests"].get(request["request_id"])
            if existing is not None:
                if (
                    existing["request_canonical"] == request_canonical
                    and existing["request_envelope_hash"] == envelope_hash
                ):
                    return self._result_from_record(existing)
                fail("durable coordinator request id replay conflicts with committed bytes", "COORDINATOR_REQUEST_REPLAY_CONFLICT")
            transaction = state["transactions"].get(request["transaction_id"])
            if request["operation"] == "prepare":
                if transaction is not None:
                    fail("durable coordinator transaction already exists", "COORDINATOR_TRANSACTION_CONFLICT")
                if request["fence"] <= state["highest_fence"]:
                    fail("durable coordinator fence is stale", "COORDINATOR_FENCED")
                status = "prepared"
            else:
                if transaction is None:
                    if request["fence"] <= state["highest_fence"]:
                        fail("durable coordinator fence is stale", "COORDINATOR_FENCED")
                    status = "unknown"
                else:
                    if transaction["status"] != "prepared":
                        fail("durable coordinator transaction is unavailable", "COORDINATOR_UNKNOWN")
                    if (
                        transaction["fence"] != request["fence"]
                        or transaction["expected_witness_head"] != request["expected_witness_head"]
                    ):
                        fail("durable coordinator terminal request has a stale fence", "COORDINATOR_FENCED")
                    status = "cancelled" if request["operation"] == "cancel" else "unavailable"
            record = {
                "schema_version": SCHEMA_VERSION,
                "kind": "p36_durable_coordinator_record",
                "operation": request["operation"],
                "request_id": request["request_id"],
                "request_canonical": request_canonical,
                "request_hash": sha256_value(request_canonical),
                "request_envelope_hash": envelope_hash,
                "transaction_id": request["transaction_id"],
                "fence": request["fence"],
                "expected_witness_head": request["expected_witness_head"],
                "status": status,
                "previous_journal_hash": state["journal_hash"],
            }
            record["journal_hash"] = self._record_hash(record)
            self._claim_mutating_cohort(record["request_hash"])
            self._append_journal(record)
            normalized_record = self._normalize_record(record, state["journal_hash"])
            self._apply_record(state, normalized_record)
            self._known_journal_hash = state["journal_hash"]
            return self._result_from_record(normalized_record)

        return self._locked(operation)

    def availability(self):
        def operation():
            state = self._load_locked()
            return service_availability_snapshot(
                self.binding,
                "coordinator",
                "available",
                state["journal_hash"],
            )

        return self._locked(operation)


def normalize_broker_request(value, binding):
    value = require_exact_keys(
        value,
        {"schema_version", "request_id", "operation", "substrate_plan_hash"},
        "durable broker request",
    )
    if require_exact_int(
        value["schema_version"], SCHEMA_VERSION, "durable broker request schema", "DURABLE_REQUEST_INVALID"
    ) != SCHEMA_VERSION:
        fail("durable broker request schema is unsupported", "DURABLE_REQUEST_INVALID")
    operation = require_token(value["operation"], "durable broker operation")
    if operation not in {"mint_permit", "postclaim_authorize", "execute", "revoke"}:
        fail("durable broker operation is unsupported", "DURABLE_REQUEST_INVALID")
    request = {
        "schema_version": SCHEMA_VERSION,
        "request_id": require_token(value["request_id"], "durable broker request id"),
        "operation": operation,
        "substrate_plan_hash": require_sha256(value["substrate_plan_hash"], "durable broker plan"),
    }
    if request["substrate_plan_hash"] != binding["substrate_plan_hash"]:
        fail("durable broker request does not match the frozen plan", "DURABLE_REQUEST_INVALID")
    return request


def create_effects_disabled_broker_result(binding, raw_request, request_envelope_hash):
    binding = normalize_binding(binding)
    value, request_canonical = decode_canonical_request(raw_request, "durable broker request")
    request = normalize_broker_request(value, binding)
    responder = binding["service_bindings"]["broker"]
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_broker_result",
        "status": "disabled",
        "code": "BROKER_EFFECTS_DISABLED",
        "request_id": request["request_id"],
        "operation": request["operation"],
        "install_binding_hash": binding["install_binding_hash"],
        "run_binding_hash": binding["run_binding_hash"],
        "substrate_abi_hash": binding["substrate_abi_hash"],
        "substrate_plan_hash": binding["substrate_plan_hash"],
        "durable_abi_hash": binding["durable_abi_hash"],
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "request_hash": sha256_value(request_canonical),
        "request_envelope_hash": require_sha256(request_envelope_hash, "durable broker envelope hash"),
        "responder_role": "broker",
        "responder_identity": responder["identity"],
        "responder_attestation_hash": responder["attestation_hash"],
        "responder_cgroup_binding_hash": responder["cgroup_binding_hash"],
        "owner_kernel_authority": "none",
        "effect_authority": "none",
        "broker_authority": "disabled",
        "acceptance": "not_available",
    }
    return dict(material, result_hash=sha256_value(canonical(material)))


def normalize_revocation_request(value, binding):
    value = require_exact_keys(
        value,
        {"schema_version", "request_id", "operation", "broker_result_hash", "substrate_plan_hash"},
        "durable revocation request",
    )
    if require_exact_int(
        value["schema_version"], SCHEMA_VERSION, "durable revocation request schema", "DURABLE_REQUEST_INVALID"
    ) != SCHEMA_VERSION:
        fail("durable revocation request schema is unsupported", "DURABLE_REQUEST_INVALID")
    request = {
        "schema_version": SCHEMA_VERSION,
        "request_id": require_token(value["request_id"], "durable revocation request id"),
        "operation": require_token(value["operation"], "durable revocation operation"),
        "broker_result_hash": require_sha256(value["broker_result_hash"], "durable revocation broker result"),
        "substrate_plan_hash": require_sha256(value["substrate_plan_hash"], "durable revocation plan"),
    }
    if request["operation"] != "check_revocation":
        fail("durable revocation operation is unsupported", "DURABLE_REQUEST_INVALID")
    if request["substrate_plan_hash"] != binding["substrate_plan_hash"]:
        fail("durable revocation request does not match the frozen plan", "DURABLE_REQUEST_INVALID")
    return request


def create_revocation_unavailable_result(binding, raw_request, request_envelope_hash):
    binding = normalize_binding(binding)
    value, request_canonical = decode_canonical_request(raw_request, "durable revocation request")
    try:
        request = normalize_revocation_request(value, binding)
    except DurableStateError as error:
        if error.code == "DURABLE_STATE_INVALID":
            fail(str(error), "DURABLE_REQUEST_INVALID")
        raise
    responder = binding["service_bindings"]["receipt_verifier"]
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_revocation_result",
        "status": "unavailable",
        "code": "REVOCATION_UNAVAILABLE",
        "request_id": request["request_id"],
        "operation": request["operation"],
        "install_binding_hash": binding["install_binding_hash"],
        "run_binding_hash": binding["run_binding_hash"],
        "substrate_abi_hash": binding["substrate_abi_hash"],
        "substrate_plan_hash": binding["substrate_plan_hash"],
        "durable_abi_hash": binding["durable_abi_hash"],
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "request_hash": sha256_value(request_canonical),
        "request_envelope_hash": require_sha256(request_envelope_hash, "durable revocation envelope hash"),
        "responder_role": "receipt_verifier",
        "responder_identity": responder["identity"],
        "responder_attestation_hash": responder["attestation_hash"],
        "responder_cgroup_binding_hash": responder["cgroup_binding_hash"],
        "owner_kernel_authority": "none",
        "effect_authority": "none",
        "broker_authority": "disabled",
        "acceptance": "not_available",
        "broker_result_hash": request["broker_result_hash"],
    }
    return dict(material, result_hash=sha256_value(canonical(material)))


def service_availability_snapshot(binding, role, state, journal_hash):
    binding = normalize_binding(binding)
    if role not in {"receipt_verifier", "witness", "coordinator"}:
        fail("durable availability role is unsupported")
    if state not in {"available", "unavailable", "unknown", "quarantined"}:
        fail("durable availability state is unsupported")
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_service_availability",
        "role": role,
        "binding_hash": normalized_binding_hash(binding),
        "status": state,
        "journal_hash": require_sha256(journal_hash, "durable availability journal hash"),
    }
    return dict(material, snapshot_hash=sha256_value(canonical(material)))


def normalize_service_availability_snapshot(binding, role, raw):
    binding = normalize_binding(binding)
    value = require_exact_keys(
        raw,
        {
            "schema_version",
            "kind",
            "role",
            "binding_hash",
            "status",
            "journal_hash",
            "snapshot_hash",
        },
        "durable service availability",
    )
    material = dict(value)
    snapshot_hash = material.pop("snapshot_hash")
    if (
        require_exact_int(value["schema_version"], SCHEMA_VERSION, "durable availability schema")
        != SCHEMA_VERSION
        or value["kind"] != "p36_durable_service_availability"
        or value["role"] != role
        or value["binding_hash"] != normalized_binding_hash(binding)
        or value["status"] not in {"available", "unavailable", "unknown", "quarantined"}
        or sha256_value(canonical(material)) != require_sha256(snapshot_hash, "durable availability snapshot hash")
    ):
        fail("durable service availability does not match the frozen role binding")
    require_sha256(value["journal_hash"], "durable availability journal hash")
    return value


def create_availability_disclosure(binding, receipt_anchor_snapshot, witness_snapshot, coordinator_snapshot):
    binding = normalize_binding(binding)
    receipt_anchor_state = normalize_service_availability_snapshot(
        binding, "receipt_verifier", receipt_anchor_snapshot
    )
    witness_state = normalize_service_availability_snapshot(binding, "witness", witness_snapshot)
    coordinator_state = normalize_service_availability_snapshot(binding, "coordinator", coordinator_snapshot)
    status = (
        "available"
        if (
            receipt_anchor_state["status"] == "available"
            and witness_state["status"] == "available"
            and coordinator_state["status"] == "available"
        )
        else "unknown"
    )
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_availability",
        "status": status,
        "install_binding_hash": binding["install_binding_hash"],
        "run_binding_hash": binding["run_binding_hash"],
        "substrate_abi_hash": binding["substrate_abi_hash"],
        "substrate_plan_hash": binding["substrate_plan_hash"],
        "durable_abi_hash": binding["durable_abi_hash"],
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "receipt_anchor_role": "receipt_verifier",
        "receipt_anchor_binding_hash": receipt_anchor_state["binding_hash"],
        "receipt_anchor_state": receipt_anchor_state["status"],
        "receipt_anchor_journal_hash": receipt_anchor_state["journal_hash"],
        "receipt_anchor_snapshot_hash": receipt_anchor_state["snapshot_hash"],
        "witness_role": "witness",
        "witness_binding_hash": witness_state["binding_hash"],
        "witness_state": witness_state["status"],
        "witness_journal_hash": witness_state["journal_hash"],
        "witness_snapshot_hash": witness_state["snapshot_hash"],
        "coordinator_role": "coordinator",
        "coordinator_binding_hash": coordinator_state["binding_hash"],
        "coordinator_state": coordinator_state["status"],
        "coordinator_journal_hash": coordinator_state["journal_hash"],
        "coordinator_snapshot_hash": coordinator_state["snapshot_hash"],
        "owner_kernel_authority": "none",
        "effect_authority": "none",
        "broker_authority": "disabled",
        "acceptance": "not_available",
    }
    return dict(material, disclosure_hash=sha256_value(canonical(material)))


__all__ = [
    "DurableReceiptAnchor",
    "DurableCoordinator",
    "DurableStateError",
    "DurableWitness",
    "SCHEMA_VERSION",
    "audit_receipt_anchor",
    "canonical",
    "create_availability_disclosure",
    "create_effects_disabled_broker_result",
    "create_revocation_unavailable_result",
    "generation_manifest_for",
    "journal_header_for",
    "normalize_binding",
    "normalize_revocation_request",
    "normalize_service_availability_snapshot",
    "sha256_value",
    "service_availability_snapshot",
]
