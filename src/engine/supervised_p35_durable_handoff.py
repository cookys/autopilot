#!/usr/bin/env python3
"""Root-only P3.5d -> P3.6 verified-intake handoff records.

The public P3.5 ``submit`` result is deliberately not a P3.6 ingress.  Its
workspace reservation is closed during submit cleanup and an unprivileged
caller could otherwise replay or substitute the JSON it saw.  This module
instead lets the root P3.5 host publish one canonical, hash-only record after
v2 verification while it still holds the ticket.  A root P3.6 host consumes it
with an ``O_EXCL`` claim bound to one freshly allocated durable cohort.

There are no workspace paths, descriptors, ticket bodies, actions, permits,
effects, or acceptance decisions in this format.  A claim is intentionally
terminal: an expired record, a failed cohort launch, or an interrupted claim
must be retried through a new P3.5d session rather than replayed.
"""

import fcntl
import hashlib
import json
import os
import secrets
import stat
import time


HANDOFF_SCHEMA_VERSION = 1
HANDOFF_KIND = "p36_root_verified_intake_handoff"
CLAIM_KIND = "p36_root_verified_intake_handoff_claim"
EXPIRED_KIND = "p36_root_verified_intake_handoff_expired"
HANDOFF_DIRECTORY_MODE = 0o700
HANDOFF_FILE_MODE = 0o600
MAX_HANDOFF_BYTES = 65536
MAX_HANDOFF_LIFETIME_MILLISECONDS = 60 * 1000
# Handoffs and their terminal evidence are intentionally retained for root
# recovery/audit, so the mailbox itself needs a hard admission bound rather
# than an unbounded best-effort cleanup policy.
MAX_HANDOFF_RECORDS = 128
MAX_HANDOFF_ROOT_ENTRIES = MAX_HANDOFF_RECORDS * 3
MAX_HANDOFF_ROOT_BYTES = MAX_HANDOFF_ROOT_ENTRIES * MAX_HANDOFF_BYTES
HANDOFF_ADMISSION_LOCK = ".admission.lock"
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
)
SHA256_CHARS = frozenset("0123456789abcdef")
GIT_SHA_CHARS = frozenset("0123456789abcdef")


class DurableHandoffError(Exception):
    """A handoff record is absent, malformed, expired, or already consumed."""


def fail(message):
    raise DurableHandoffError(message)


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


def _reject_duplicate_pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            fail("handoff JSON repeats an object key")
        value[key] = item
    return value


def _reject_surrogates(value):
    if isinstance(value, str):
        if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
            fail("handoff JSON contains a lone Unicode surrogate")
    elif isinstance(value, dict):
        for key, item in value.items():
            _reject_surrogates(key)
            _reject_surrogates(item)
    elif isinstance(value, list):
        for item in value:
            _reject_surrogates(item)


def _reject_json_constant(value):
    raise ValueError("non-finite JSON constant: " + value)


def require_canonical_json_bytes(raw, label):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_HANDOFF_BYTES:
        fail(label + " has an invalid byte size")
    try:
        text = raw.decode("utf-8")
        value = json.loads(
            text,
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=_reject_json_constant,
        )
        _reject_surrogates(value)
        normalized = canonical(value).encode("utf-8")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, RecursionError, MemoryError) as error:
        raise DurableHandoffError(label + " is not UTF-8 JSON: " + str(error)) from error
    if normalized != raw:
        fail(label + " is not canonical JSON")
    return value


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


def require_git_sha(value, label):
    if (
        not isinstance(value, str)
        or len(value) not in {40, 64}
        or any(character not in GIT_SHA_CHARS for character in value)
    ):
        fail(label + " must be a canonical Git object hash")
    return value


def require_positive_int(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 9007199254740991:
        fail(label + " must be a positive safe integer")
    return value


def require_nonnegative_int(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 9007199254740991:
        fail(label + " must be a nonnegative safe integer")
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


def require_root_process():
    if os.geteuid() != 0 or os.getegid() != 0:
        fail("durable verified-intake handoff requires effective UID/GID 0")


def require_exact_directory(path, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise DurableHandoffError(label + " cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != 0
        or (info.st_mode & 0o7777) != HANDOFF_DIRECTORY_MODE
    ):
        fail(label + " is not a root-private handoff directory")


def ensure_handoff_root(path, create=False):
    """Create or verify the dedicated root-only leaf, never a caller path."""

    require_root_process()
    path = require_absolute_path(path, "durable handoff root")
    parent = os.path.dirname(path)
    if not os.path.isdir(parent):
        fail("durable handoff root parent is absent")
    try:
        parent_info = os.lstat(parent)
    except OSError as error:
        raise DurableHandoffError("durable handoff root parent cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(parent_info.st_mode)
        or not stat.S_ISDIR(parent_info.st_mode)
        or parent_info.st_uid != 0
        or (parent_info.st_mode & 0o022) != 0
    ):
        fail("durable handoff root parent is not root-controlled")
    if not os.path.exists(path):
        if not create:
            fail("durable handoff root is absent")
        try:
            os.mkdir(path, HANDOFF_DIRECTORY_MODE)
            os.chown(path, 0, 0)
            os.chmod(path, HANDOFF_DIRECTORY_MODE)
            fsync_directory(parent)
        except OSError as error:
            raise DurableHandoffError("durable handoff root cannot be created: " + str(error)) from error
    require_exact_directory(path, "durable handoff root")
    return path


def handoff_root_for_registry(workspace_registry_root):
    return os.path.join(require_absolute_path(workspace_registry_root, "workspace registry root"), "p36-handoff")


def fsync_directory(path):
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        os.fsync(descriptor)
    except OSError as error:
        raise DurableHandoffError("handoff directory cannot be synchronized: " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _write_new_root_file(path, value, label):
    content = canonical(value).encode("utf-8")
    descriptor = None
    try:
        descriptor = os.open(
            path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            HANDOFF_FILE_MODE,
        )
        os.fchmod(descriptor, HANDOFF_FILE_MODE)
        os.fchown(descriptor, 0, 0)
        offset = 0
        while offset < len(content):
            written = os.write(descriptor, content[offset:])
            if written <= 0:
                fail(label + " short write")
            offset += written
        os.fsync(descriptor)
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or info.st_gid != 0
            or (info.st_mode & 0o777) != HANDOFF_FILE_MODE
            or info.st_nlink != 1
        ):
            fail(label + " did not retain root-private ownership")
    except FileExistsError as error:
        raise DurableHandoffError(label + " already exists") from error
    except OSError as error:
        raise DurableHandoffError(label + " cannot be written: " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _read_root_file(path, label):
    try:
        initial = os.lstat(path)
    except OSError as error:
        raise DurableHandoffError(label + " cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(initial.st_mode)
        or not stat.S_ISREG(initial.st_mode)
        or initial.st_uid != 0
        or initial.st_gid != 0
        or (initial.st_mode & 0o777) != HANDOFF_FILE_MODE
        or initial.st_nlink != 1
        or initial.st_size <= 0
        or initial.st_size > MAX_HANDOFF_BYTES
    ):
        fail(label + " is not a bounded root-private regular file")
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != 0
            or opened.st_gid != 0
            or (opened.st_mode & 0o777) != HANDOFF_FILE_MODE
            or opened.st_nlink != 1
            or opened.st_dev != initial.st_dev
            or opened.st_ino != initial.st_ino
            or opened.st_size != initial.st_size
        ):
            fail(label + " changed while opening")
        raw = os.read(descriptor, MAX_HANDOFF_BYTES + 1)
        if len(raw) > MAX_HANDOFF_BYTES:
            fail(label + " exceeds the byte limit")
        final = os.fstat(descriptor)
        if (
            final.st_dev != opened.st_dev
            or final.st_ino != opened.st_ino
            or final.st_size != opened.st_size
        ):
            fail(label + " changed while reading")
        return require_canonical_json_bytes(raw, label)
    except OSError as error:
        raise DurableHandoffError(label + " cannot be read: " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _require_root_private_file_info(path, label, *, allow_empty=False):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise DurableHandoffError(label + " cannot be inspected: " + str(error)) from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != 0
        or (info.st_mode & 0o777) != HANDOFF_FILE_MODE
        or info.st_nlink != 1
        or info.st_size > MAX_HANDOFF_BYTES
        or (not allow_empty and info.st_size <= 0)
    ):
        fail(label + " is not a bounded root-private regular file")
    return info


def _ensure_admission_lock(root):
    path = os.path.join(root, HANDOFF_ADMISSION_LOCK)
    descriptor = None
    try:
        descriptor = os.open(
            path,
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            HANDOFF_FILE_MODE,
        )
        os.fchmod(descriptor, HANDOFF_FILE_MODE)
        os.fchown(descriptor, 0, 0)
        os.fsync(descriptor)
        fsync_directory(root)
    except FileExistsError:
        pass
    except OSError as error:
        raise DurableHandoffError("durable handoff admission lock cannot be created: " + str(error)) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
    return path


def acquire_handoff_admission_lock(root):
    """Serialize publication so capacity cannot be raced by root producers."""

    path = _ensure_admission_lock(root)
    expected = _require_root_private_file_info(path, "durable handoff admission lock", allow_empty=True)
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != 0
            or opened.st_gid != 0
            or (opened.st_mode & 0o777) != HANDOFF_FILE_MODE
            or opened.st_nlink != 1
            or opened.st_size != 0
            or opened.st_dev != expected.st_dev
            or opened.st_ino != expected.st_ino
        ):
            fail("durable handoff admission lock changed while opening")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        return descriptor
    except OSError as error:
        if descriptor is not None:
            os.close(descriptor)
        raise DurableHandoffError("durable handoff admission lock cannot be acquired") from error


def release_handoff_admission_lock(descriptor):
    if descriptor is None:
        return
    try:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)


def reserve_handoff_publication_slot(root):
    """Hold one bounded mailbox publication slot until P3.5 cleanup finishes.

    A P3.5 submit must not consume its one-shot verified intake and only then
    discover that the P3.6 mailbox is full.  The returned root-private flock
    is intentionally held by the root submitter until it publishes (or aborts)
    the record.  Existing P3.6 claims may still add their at-most-two terminal
    entries, which the capacity check reserves for each record.
    """

    require_root_process()
    root = ensure_handoff_root(root)
    descriptor = acquire_handoff_admission_lock(root)
    try:
        require_handoff_capacity(root)
    except BaseException:
        release_handoff_admission_lock(descriptor)
        raise
    return descriptor


def _parse_mailbox_entry_name(name):
    if name == HANDOFF_ADMISSION_LOCK:
        return None, "lock"
    prefix = "handoff-"
    suffixes = ((".json", "record"), (".claim", "claim"), (".expired", "expired"))
    if not isinstance(name, str) or not name.startswith(prefix):
        fail("durable handoff root has an unexpected entry")
    for suffix, kind in suffixes:
        if name.endswith(suffix):
            handoff_id = name[len(prefix):-len(suffix)]
            return require_token(handoff_id, "durable mailbox handoff id"), kind
    fail("durable handoff root has an unexpected entry")


def require_handoff_capacity(root):
    """Fail closed before a new record can exceed mailbox retention bounds."""

    require_exact_directory(root, "durable handoff root")
    try:
        names = os.listdir(root)
    except OSError as error:
        raise DurableHandoffError("durable handoff root cannot be listed: " + str(error)) from error
    records = set()
    entries_by_id = {}
    total_bytes = 0
    retained_entries = 0
    for name in names:
        handoff_id, kind = _parse_mailbox_entry_name(name)
        path = os.path.join(root, name)
        if kind == "lock":
            _require_root_private_file_info(path, "durable handoff admission lock", allow_empty=True)
            continue
        info = _require_root_private_file_info(path, "durable handoff mailbox entry")
        total_bytes += info.st_size
        retained_entries += 1
        entries_by_id.setdefault(handoff_id, set()).add(kind)
        if kind == "record":
            records.add(handoff_id)
    for handoff_id, kinds in entries_by_id.items():
        if "record" not in kinds:
            fail("durable handoff terminal evidence has no immutable record: " + handoff_id)
    if (
        len(records) >= MAX_HANDOFF_RECORDS
        or retained_entries >= MAX_HANDOFF_ROOT_ENTRIES
        or total_bytes + MAX_HANDOFF_BYTES > MAX_HANDOFF_ROOT_BYTES
    ):
        fail("DURABLE_HANDOFF_CAPACITY_EXHAUSTED")


def _record_path(root, handoff_id):
    return os.path.join(root, "handoff-" + require_token(handoff_id, "handoff id") + ".json")


def _claim_path(root, handoff_id):
    return os.path.join(root, "handoff-" + require_token(handoff_id, "handoff id") + ".claim")


def _expired_path(root, handoff_id):
    return os.path.join(root, "handoff-" + require_token(handoff_id, "handoff id") + ".expired")


def normalize_handoff(raw, now_ms=None, require_fresh=True):
    value = require_exact_keys(
        raw,
        {
            "schema_version",
            "kind",
            "handoff_id",
            "p35_install_binding_hash",
            "session_id",
            "session_challenge_hash",
            "intake_protocol_version",
            "ticket_hash",
            "descriptor_binding_hash",
            "workspace_root_hash",
            "immutable_base",
            "issuer",
            "key_id",
            "attestation_hash",
            "gateway_receipt_hash",
            "bridge_plan_hash",
            "bridge_receipt_hash",
            "authenticated_receipt_hash",
            "issued_at_ms",
            "expires_at_ms",
            "handoff_hash",
        },
        "durable verified-intake handoff",
    )
    material = dict(value)
    handoff_hash = material.pop("handoff_hash")
    if (
        require_exact_int(value["schema_version"], HANDOFF_SCHEMA_VERSION, "handoff schema")
        != HANDOFF_SCHEMA_VERSION
        or value["kind"] != HANDOFF_KIND
        or require_exact_int(value["intake_protocol_version"], 2, "handoff intake protocol") != 2
        or sha256_value(canonical(material)) != require_sha256(handoff_hash, "handoff hash")
    ):
        fail("durable verified-intake handoff has invalid fixed fields")
    normalized = {
        "schema_version": HANDOFF_SCHEMA_VERSION,
        "kind": HANDOFF_KIND,
        "handoff_id": require_token(value["handoff_id"], "handoff id"),
        "p35_install_binding_hash": require_sha256(value["p35_install_binding_hash"], "P3.5 install binding"),
        "session_id": require_token(value["session_id"], "handoff session id"),
        "session_challenge_hash": require_sha256(value["session_challenge_hash"], "handoff session challenge"),
        "intake_protocol_version": 2,
        "ticket_hash": require_sha256(value["ticket_hash"], "handoff ticket hash"),
        "descriptor_binding_hash": require_sha256(value["descriptor_binding_hash"], "handoff descriptor binding"),
        "workspace_root_hash": require_sha256(value["workspace_root_hash"], "handoff workspace root"),
        "immutable_base": require_git_sha(value["immutable_base"], "handoff immutable base"),
        "issuer": require_token(value["issuer"], "handoff issuer"),
        "key_id": require_token(value["key_id"], "handoff key id"),
        "attestation_hash": require_sha256(value["attestation_hash"], "handoff attestation"),
        "gateway_receipt_hash": require_sha256(value["gateway_receipt_hash"], "handoff gateway receipt"),
        "bridge_plan_hash": require_sha256(value["bridge_plan_hash"], "handoff bridge plan"),
        "bridge_receipt_hash": require_sha256(value["bridge_receipt_hash"], "handoff bridge receipt"),
        "authenticated_receipt_hash": require_sha256(value["authenticated_receipt_hash"], "handoff authenticated receipt"),
        "issued_at_ms": require_nonnegative_int(value["issued_at_ms"], "handoff issued time"),
        "expires_at_ms": require_positive_int(value["expires_at_ms"], "handoff expiry time"),
        "handoff_hash": require_sha256(value["handoff_hash"], "handoff hash"),
    }
    if normalized["expires_at_ms"] <= normalized["issued_at_ms"]:
        fail("durable verified-intake handoff expiry is not after issuance")
    if normalized["expires_at_ms"] - normalized["issued_at_ms"] > MAX_HANDOFF_LIFETIME_MILLISECONDS:
        fail("durable verified-intake handoff lifetime exceeds the fixed bound")
    if now_ms is not None:
        now_ms = require_nonnegative_int(now_ms, "handoff clock")
        if normalized["issued_at_ms"] > now_ms + 1000:
            fail("durable verified-intake handoff is from the future")
        if require_fresh and now_ms >= normalized["expires_at_ms"]:
            fail("durable verified-intake handoff has expired")
    return normalized


def create_verified_handoff(
    *,
    p35_install_binding_hash,
    session_id,
    session_challenge_hash,
    ticket_hash,
    descriptor_binding_hash,
    workspace_root_hash,
    immutable_base,
    authority,
    gateway_receipt_hash,
    bridge_plan_hash,
    bridge_receipt_hash,
    authenticated_receipt_hash,
    now_ms=None,
    handoff_id=None,
):
    """Build a canonical handoff value from root-held, already verified facts."""

    if now_ms is None:
        now_ms = int(time.time() * 1000)
    now_ms = require_nonnegative_int(now_ms, "handoff clock")
    authority = require_exact_keys(authority, {"issuer", "key_id", "attestation_hash"}, "handoff authority")
    material = {
        "schema_version": HANDOFF_SCHEMA_VERSION,
        "kind": HANDOFF_KIND,
        "handoff_id": require_token(
            handoff_id or ("p36-" + secrets.token_hex(24)), "handoff id"
        ),
        "p35_install_binding_hash": require_sha256(p35_install_binding_hash, "P3.5 install binding"),
        "session_id": require_token(session_id, "handoff session id"),
        "session_challenge_hash": require_sha256(session_challenge_hash, "handoff session challenge"),
        "intake_protocol_version": 2,
        "ticket_hash": require_sha256(ticket_hash, "handoff ticket hash"),
        "descriptor_binding_hash": require_sha256(descriptor_binding_hash, "handoff descriptor binding"),
        "workspace_root_hash": require_sha256(workspace_root_hash, "handoff workspace root"),
        "immutable_base": require_git_sha(immutable_base, "handoff immutable base"),
        "issuer": require_token(authority["issuer"], "handoff issuer"),
        "key_id": require_token(authority["key_id"], "handoff key id"),
        "attestation_hash": require_sha256(authority["attestation_hash"], "handoff attestation"),
        "gateway_receipt_hash": require_sha256(gateway_receipt_hash, "handoff gateway receipt"),
        "bridge_plan_hash": require_sha256(bridge_plan_hash, "handoff bridge plan"),
        "bridge_receipt_hash": require_sha256(bridge_receipt_hash, "handoff bridge receipt"),
        "authenticated_receipt_hash": require_sha256(
            authenticated_receipt_hash, "handoff authenticated receipt"
        ),
        "issued_at_ms": now_ms,
        "expires_at_ms": now_ms + MAX_HANDOFF_LIFETIME_MILLISECONDS,
    }
    value = dict(material, handoff_hash=sha256_value(canonical(material)))
    return normalize_handoff(value, now_ms=now_ms)


def publish_verified_handoff(root, handoff, reserved_admission_lock=None):
    """Persist exactly one root-created record before P3.5 releases its ticket."""

    require_root_process()
    root = ensure_handoff_root(root)
    handoff = normalize_handoff(handoff, now_ms=int(time.time() * 1000))
    path = _record_path(root, handoff["handoff_id"])
    descriptor = reserved_admission_lock
    owns_admission_lock = descriptor is None
    if owns_admission_lock:
        descriptor = acquire_handoff_admission_lock(root)
    try:
        if owns_admission_lock:
            require_handoff_capacity(root)
        _write_new_root_file(path, handoff, "durable verified-intake handoff")
        fsync_directory(root)
    finally:
        if owns_admission_lock:
            release_handoff_admission_lock(descriptor)
    return handoff


def _normalize_consumer_binding(raw):
    value = require_exact_keys(
        raw,
        {
            "p36_install_binding_hash",
            "p36_run_binding_hash",
            "durable_binding_hash",
            "cohort_id",
            "generation",
        },
        "durable handoff consumer binding",
    )
    return {
        "p36_install_binding_hash": require_sha256(value["p36_install_binding_hash"], "P3.6 install binding"),
        "p36_run_binding_hash": require_sha256(value["p36_run_binding_hash"], "P3.6 run binding"),
        "durable_binding_hash": require_sha256(value["durable_binding_hash"], "durable binding"),
        "cohort_id": require_token(value["cohort_id"], "durable cohort id"),
        "generation": require_positive_int(value["generation"], "durable generation"),
    }


def normalize_claim(raw):
    value = require_exact_keys(
        raw,
        {
            "schema_version",
            "kind",
            "handoff_id",
            "handoff_hash",
            "claimed_at_ms",
            "p36_install_binding_hash",
            "p36_run_binding_hash",
            "durable_binding_hash",
            "cohort_id",
            "generation",
            "claim_hash",
        },
        "durable verified-intake handoff claim",
    )
    material = dict(value)
    claim_hash = material.pop("claim_hash")
    if (
        require_exact_int(value["schema_version"], HANDOFF_SCHEMA_VERSION, "handoff claim schema")
        != HANDOFF_SCHEMA_VERSION
        or value["kind"] != CLAIM_KIND
        or sha256_value(canonical(material)) != require_sha256(claim_hash, "handoff claim hash")
    ):
        fail("durable verified-intake handoff claim has invalid fixed fields")
    consumer = _normalize_consumer_binding(
        {
            "p36_install_binding_hash": value["p36_install_binding_hash"],
            "p36_run_binding_hash": value["p36_run_binding_hash"],
            "durable_binding_hash": value["durable_binding_hash"],
            "cohort_id": value["cohort_id"],
            "generation": value["generation"],
        }
    )
    return {
        "schema_version": HANDOFF_SCHEMA_VERSION,
        "kind": CLAIM_KIND,
        "handoff_id": require_token(value["handoff_id"], "handoff claim id"),
        "handoff_hash": require_sha256(value["handoff_hash"], "handoff claim handoff hash"),
        "claimed_at_ms": require_nonnegative_int(value["claimed_at_ms"], "handoff claim time"),
        **consumer,
        "claim_hash": require_sha256(claim_hash, "handoff claim hash"),
    }


def _create_expired_marker(root, handoff, now_ms):
    material = {
        "schema_version": HANDOFF_SCHEMA_VERSION,
        "kind": EXPIRED_KIND,
        "handoff_id": handoff["handoff_id"],
        "handoff_hash": handoff["handoff_hash"],
        "expired_at_ms": now_ms,
    }
    value = dict(material, marker_hash=sha256_value(canonical(material)))
    try:
        _write_new_root_file(_expired_path(root, handoff["handoff_id"]), value, "expired durable handoff marker")
        fsync_directory(root)
    except DurableHandoffError:
        # The underlying record is still unusable because its clock is expired.
        pass


def read_verified_handoff(root, handoff_id, now_ms=None):
    """Read one fresh root-only handoff before constructing a P3.6 binding.

    This is intentionally only an inspection step.  The subsequent exclusive
    claim remains the authority boundary; a competing root consumer simply
    makes that claim fail closed.
    """

    require_root_process()
    root = ensure_handoff_root(root)
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    now_ms = require_nonnegative_int(now_ms, "handoff clock")
    handoff_id = require_token(handoff_id, "handoff id")
    handoff = normalize_handoff(
        _read_root_file(_record_path(root, handoff_id), "durable verified-intake handoff"),
        now_ms=now_ms,
    )
    if handoff["handoff_id"] != handoff_id:
        fail("durable verified-intake handoff file does not bind its file name")
    return handoff


def claim_verified_handoff(root, handoff_id, consumer_binding, now_ms=None):
    """Atomically consume a fresh record and bind it to one P3.6 cohort.

    The claim marker is never removed.  A caller must allocate its generation
    and cohort *before* this operation; failure after the marker exists is a
    terminal handoff failure, not a retry window.
    """

    require_root_process()
    root = ensure_handoff_root(root)
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    now_ms = require_nonnegative_int(now_ms, "handoff clock")
    handoff_id = require_token(handoff_id, "handoff id")
    consumer = _normalize_consumer_binding(consumer_binding)
    handoff = normalize_handoff(
        _read_root_file(_record_path(root, handoff_id), "durable verified-intake handoff"),
        now_ms=now_ms,
        require_fresh=False,
    )
    if handoff["handoff_id"] != handoff_id:
        fail("durable verified-intake handoff file does not bind its file name")
    if now_ms >= handoff["expires_at_ms"]:
        _create_expired_marker(root, handoff, now_ms)
        fail("durable verified-intake handoff has expired")
    if handoff["issued_at_ms"] > now_ms + 1000:
        fail("durable verified-intake handoff is from the future")
    material = {
        "schema_version": HANDOFF_SCHEMA_VERSION,
        "kind": CLAIM_KIND,
        "handoff_id": handoff_id,
        "handoff_hash": handoff["handoff_hash"],
        "claimed_at_ms": now_ms,
        **consumer,
    }
    claim = normalize_claim(dict(material, claim_hash=sha256_value(canonical(material))))
    _write_new_root_file(_claim_path(root, handoff_id), claim, "durable verified-intake handoff claim")
    fsync_directory(root)
    # Re-read only after the claim is durable.  Any storage ambiguity consumes
    # the record and causes the caller to abandon the freshly allocated cohort.
    verified = normalize_handoff(
        _read_root_file(_record_path(root, handoff_id), "durable verified-intake handoff"),
        now_ms=now_ms,
    )
    if verified != handoff:
        fail("durable verified-intake handoff changed after its claim")
    return {"handoff": verified, "claim": claim}


__all__ = [
    "CLAIM_KIND",
    "DurableHandoffError",
    "HANDOFF_DIRECTORY_MODE",
    "HANDOFF_FILE_MODE",
    "HANDOFF_KIND",
    "MAX_HANDOFF_LIFETIME_MILLISECONDS",
    "MAX_HANDOFF_RECORDS",
    "MAX_HANDOFF_ROOT_BYTES",
    "acquire_handoff_admission_lock",
    "canonical",
    "claim_verified_handoff",
    "create_verified_handoff",
    "ensure_handoff_root",
    "handoff_root_for_registry",
    "normalize_handoff",
    "normalize_claim",
    "publish_verified_handoff",
    "read_verified_handoff",
    "release_handoff_admission_lock",
    "reserve_handoff_publication_slot",
    "require_handoff_capacity",
    "sha256_value",
]
