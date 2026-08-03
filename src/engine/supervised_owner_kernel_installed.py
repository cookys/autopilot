#!/usr/bin/env python3
"""P3.7 U5 installed activation core.
Hash-pinned installed profile helpers, fixed probe catalog binding, crash-honest
outcomes, and authority disclosure. Engine sink and acceptance stay disabled.
This module never executes caller-supplied commands, paths, tools, or UIDs.
"""
from __future__ import annotations
import hashlib
import json
import os
import secrets
import stat
import time
SCHEMA_VERSION = 1
PROTOCOL_VERSION = 1
PROFILE_VERSION = 1
INSTALLED_KIND = "p37_installed_semantic_probe_contract"
BINDING_KIND = "p37_installed_state_binding"
PROFILE_KIND = "p37_installed_probe_profile"
RESULT_KIND = "p37_installed_run_probe_result"
CRASH_KIND = "p37_installed_crash_outcome"
MAX_FRAME_BYTES = 524288
MAX_MESSAGE_LIFETIME_MILLISECONDS = 60 * 1000
MAX_FUTURE_SKEW_MILLISECONDS = 1000
MAX_SAFE_INTEGER = 9007199254740991
SERVICE_ROLES = (
    "kernel",
    "worker",
    "broker",
    "receipt_verifier",
    "witness",
    "coordinator",)
SERVICE_IDENTITIES = {
    "kernel": "autopilot-p37i-kernel",
    "worker": "autopilot-p37i-worker",
    "broker": "autopilot-p37i-broker",
    "receipt_verifier": "autopilot-p37i-receipt-verifier",
    "witness": "autopilot-p37i-witness",
    "coordinator": "autopilot-p37i-coordinator",}
FIXED_PROBE_CATALOG_ID = "owner-kernel-probe-toggle-v1"
FIXED_PROBE_OPERATION = "owner_kernel_probe_toggle"
FIXED_PROBE_TARGET = "owner-kernel-private-probe-sentinel"
FIXED_PROBE_RECEIPT_ROOT = "/var/lib/autopilot-production/owner-kernel-probe"
AUTHORITY = {
    "owner_kernel_authority": "active",
    "effect_authority": "reversible_probe_only",
    "broker_authority": "probe_only",
    "acceptance": "not_available",
    "engine_sink": "disabled",
    "acceptance_transaction": "disabled",}
CRASH_OUTCOMES = ("completed", "failed", "unknown", "recovery_required")
FORBIDDEN_OPERATIONS = (
    "accept",
    "commit",
    "engine_dispatch",
    "implementation_dispatch",
    "arbitrary_execute",)
CALLER_CONTROLLED_KEYS = frozenset(
    {
        "command",
        "path",
        "tool",
        "target",
        "catalog_row",
        "receipt_root",
        "uid",
        "gid",
        "unit",
        "cgroup",
        "identity",
        "service_identity",
        "executable",
        "argv",
        "shell",
        "cwd",})
TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-")
SHA256_CHARS = frozenset("0123456789abcdef")
INSTALLED_ABI_HASH_PLACEHOLDER = "0" * 64
class InstalledError(Exception):
    def __init__(self, message, code="INSTALLED_CORE_INVALID"):
        super().__init__(message)
        self.code = code
def fail(message, code="INSTALLED_CORE_INVALID"):
    raise InstalledError(message, code)
def canonical(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,)
def sha256_value(value):
    if not isinstance(value, (bytes, bytearray)):
        if not isinstance(value, str):
            value = canonical(value)
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
def require_positive_int(value, label):
    if not isinstance(value, int) or isinstance(value, bool) or value < 1 or value > MAX_SAFE_INTEGER:
        fail(label + " must be a positive safe integer")
    return value
def reject_caller_controlled(value, label):
    value = require_plain_object(value, label)
    for key in value:
        if key in CALLER_CONTROLLED_KEYS:
            fail(
                label + ' forbids caller-controlled field "' + key + '"',
                "CALLER_CONTROLLED_FIELD_FORBIDDEN",)
def get_installed_abi():
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": INSTALLED_KIND,
        "protocol_version": PROTOCOL_VERSION,
        "profile_version": PROFILE_VERSION,
        "max_frame_bytes": MAX_FRAME_BYTES,
        "max_message_lifetime_milliseconds": MAX_MESSAGE_LIFETIME_MILLISECONDS,
        "max_future_skew_milliseconds": MAX_FUTURE_SKEW_MILLISECONDS,
        "service_roles": list(SERVICE_ROLES),
        "service_identities": dict(SERVICE_IDENTITIES),
        "fixed_probe": {
            "catalog_id": FIXED_PROBE_CATALOG_ID,
            "operation": FIXED_PROBE_OPERATION,
            "target": FIXED_PROBE_TARGET,
            "receipt_root_prefix": FIXED_PROBE_RECEIPT_ROOT,
        },
        "authority": dict(AUTHORITY),
        "crash_outcomes": list(CRASH_OUTCOMES),
        "forbidden_operations": list(FORBIDDEN_OPERATIONS),
        "effect_replay": "never",
        "caller_controlled_fields": "forbidden",
        "engine_sink": "disabled",
        "acceptance": "not_available",}
def installed_abi_hash():
    return sha256_value(get_installed_abi())
def normalize_service_bindings(raw):
    value = require_exact_keys(raw, SERVICE_ROLES, "installed service bindings")
    seen = {}
    normalized = {}
    for role in SERVICE_ROLES:
        entry = require_exact_keys(
            value[role],
            ("role", "identity", "uid", "gid", "attestation_hash", "cgroup_binding_hash"),
            "installed " + role + " binding",)
        if entry["role"] != role:
            fail("installed " + role + " binding role is invalid")
        item = {
            "role": role,
            "identity": require_token(entry["identity"], "installed " + role + " identity"),
            "uid": require_positive_int(entry["uid"], "installed " + role + " uid"),
            "gid": require_positive_int(entry["gid"], "installed " + role + " gid"),
            "attestation_hash": require_sha256(entry["attestation_hash"], "installed " + role + " attestation_hash"),
            "cgroup_binding_hash": require_sha256(
                entry["cgroup_binding_hash"], "installed " + role + " cgroup_binding_hash"
            ),}
        for field, field_value in item.items():
            if field == "role":
                continue
            key = field + ":" + str(field_value)
            if key in seen:
                fail("installed " + role + " " + field + " duplicates " + seen[key])
            seen[key] = role
        normalized[role] = item
    return normalized
def normalize_binding(raw, expected_abi_hash=None):
    value = require_exact_keys(
        raw,
        (
            "schema_version",
            "kind",
            "install_binding_hash",
            "run_binding_hash",
            "installed_abi_hash",
            "durable_abi_hash",
            "cohort_id",
            "generation",
            "service_bindings",
            "snapshot_hash",
        ),
        "installed binding",)
    if value["schema_version"] != SCHEMA_VERSION or value["kind"] != BINDING_KIND:
        fail("installed binding has an unsupported schema or kind")
    abi_hash = expected_abi_hash or value["installed_abi_hash"]
    require_sha256(abi_hash, "installed abi hash")
    if value["installed_abi_hash"] != abi_hash:
        fail("installed binding does not match the installed ABI")
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": BINDING_KIND,
        "install_binding_hash": require_sha256(value["install_binding_hash"], "install_binding_hash"),
        "run_binding_hash": require_sha256(value["run_binding_hash"], "run_binding_hash"),
        "installed_abi_hash": abi_hash,
        "durable_abi_hash": require_sha256(value["durable_abi_hash"], "durable_abi_hash"),
        "cohort_id": require_token(value["cohort_id"], "cohort_id"),
        "generation": require_positive_int(value["generation"], "generation"),
        "service_bindings": normalize_service_bindings(value["service_bindings"]),
        "snapshot_hash": require_sha256(value["snapshot_hash"], "snapshot_hash"),}
def normalized_binding_hash(binding):
    return sha256_value(normalize_binding(binding))
def create_crash_outcome(outcome, request_id, reason_code, audit_material=None):
    if outcome not in CRASH_OUTCOMES:
        fail("crash outcome is not allowed")
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": CRASH_KIND,
        "outcome": outcome,
        "effect_replayed": False,
        "request_id": require_token(request_id, "crash request_id"),
        "reason_code": require_token(reason_code, "crash reason_code"),
        "audit_hash": sha256_value(audit_material or {"request_id": request_id, "reason_code": reason_code}),}
    return material
def build_run_probe_result(binding, profile_hash, outcome, status, sentinel_restored, audit_material):
    if outcome not in CRASH_OUTCOMES:
        fail("run-probe outcome is invalid")
    if outcome in ("unknown", "recovery_required"):
        pass
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": RESULT_KIND,
        "status": require_token(status, "result status"),
        "outcome": outcome,
        "profile_hash": require_sha256(profile_hash, "profile_hash"),
        "install_binding_hash": binding["install_binding_hash"],
        "run_binding_hash": binding["run_binding_hash"],
        "cohort_id": binding["cohort_id"],
        "generation": binding["generation"],
        "probe_catalog_id": FIXED_PROBE_CATALOG_ID,
        "effect_replayed": False,
        "sentinel_restored": sentinel_restored is True,
        "authority": dict(AUTHORITY),
        "audit_hash": sha256_value(audit_material),}
    material["result_hash"] = sha256_value(material)
    return material
class ProbeSentinel:
    """Private reversible sentinel used only for owner-kernel-probe-toggle-v1.
    State is persisted under ``root`` so the independent receipt-verifier process
    can observe the same effect the broker applied without sharing memory.
    """
    def __init__(self, root, run_id):
        self.root = root
        self.run_id = require_token(run_id, "probe run_id")
        self.path = os.path.join(root, "sentinel.json")
        self._state = False
        self._history = []
        self._load()
    def _material(self):
        return {
            "schema_version": SCHEMA_VERSION,
            "kind": "p37_installed_probe_sentinel",
            "run_id": self.run_id,
            "sentinel": self._state is True,
            "history": list(self._history),}
    def _load(self):
        if not os.path.lexists(self.path):
            return
        try:
            info = os.lstat(self.path)
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                return
            with open(self.path, "rb") as source:
                raw = source.read(65536)
            if not raw.endswith(b"\n"):
                return
            value = json.loads(raw.decode("utf-8")[:-1])
            if not isinstance(value, dict) or value.get("run_id") != self.run_id:
                return
            self._state = value.get("sentinel") is True
            history = value.get("history")
            self._history = list(history) if isinstance(history, list) else []
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
            return
    def _persist(self):
        os.makedirs(self.root, mode=0o770, exist_ok=True)
        temporary = self.path + ".pending-" + secrets.token_hex(6)
        payload = (canonical(self._material()) + "\n").encode("utf-8")
        descriptor = None
        try:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o660)
            total = 0
            while total < len(payload):
                written = os.write(descriptor, payload[total:])
                if written <= 0:
                    fail("cannot persist installed probe sentinel")
                total += written
            os.fsync(descriptor)
        finally:
            if descriptor is not None:
                os.close(descriptor)
        os.replace(temporary, self.path)
    def state_hash(self):
        return sha256_value({"sentinel": self._state, "run_id": self.run_id})
    def toggle(self, authorization_id):
        require_token(authorization_id, "authorization_id")
        prior = self._state
        self._state = not self._state
        record = {
            "authorization_id": authorization_id,
            "prior": prior,
            "current": self._state,
            "prior_hash": sha256_value({"sentinel": prior, "run_id": self.run_id}),
            "current_hash": self.state_hash(),
            "at_ms": int(time.time() * 1000),}
        self._history.append(record)
        self._persist()
        return record
    def restore_last(self):
        if not self._history:
            self._persist()
            return {"sentinel_restored": True, "state_hash": self.state_hash()}
        last = self._history[-1]
        self._state = last["prior"]
        self._persist()
        return {
            "sentinel_restored": self._state == last["prior"],
            "prior_hash": last["current_hash"],
            "restored_hash": self.state_hash(),}
    def observe(self):
        self._load()
        return {"sentinel": self._state, "state_hash": self.state_hash(), "toggles": len(self._history)}
class ProbeReceiptStore:
    """Disk-backed broker receipts for independent receipt-verifier readback."""
    def __init__(self, root):
        self.root = root
        self.path = os.path.join(root, "receipts.json")
        self._receipts = {}
        self._load()
    def _load(self):
        if not os.path.lexists(self.path):
            return
        try:
            with open(self.path, "rb") as source:
                raw = source.read(65536)
            if not raw.endswith(b"\n"):
                return
            value = json.loads(raw.decode("utf-8")[:-1])
            if isinstance(value, dict) and isinstance(value.get("receipts"), dict):
                self._receipts = dict(value["receipts"])
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
            return
    def _persist(self):
        os.makedirs(self.root, mode=0o770, exist_ok=True)
        material = {
            "schema_version": SCHEMA_VERSION,
            "kind": "p37_installed_probe_receipts",
            "receipts": self._receipts,}
        temporary = self.path + ".pending-" + secrets.token_hex(6)
        payload = (canonical(material) + "\n").encode("utf-8")
        descriptor = None
        try:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o660)
            total = 0
            while total < len(payload):
                written = os.write(descriptor, payload[total:])
                if written <= 0:
                    fail("cannot persist installed probe receipts")
                total += written
            os.fsync(descriptor)
        finally:
            if descriptor is not None:
                os.close(descriptor)
        os.replace(temporary, self.path)
    def put(self, receipt):
        require_plain_object(receipt, "probe receipt")
        effect_id = require_token(receipt["effect_id"], "effect_id")
        self._receipts[effect_id] = receipt
        self._persist()
        return receipt
    def get(self, effect_id):
        self._load()
        if effect_id is None:
            return None
        return self._receipts.get(effect_id)
class NonceFence:
    def __init__(self):
        self._seen = set()
    def observe(self, nonce_hash):
        require_sha256(nonce_hash, "nonce_hash")
        if nonce_hash in self._seen:
            fail("installed nonce has already been consumed", "REPLAY_DETECTED")
        self._seen.add(nonce_hash)
        return True
    def __len__(self):
        return len(self._seen)
def require_operation_allowed(operation):
    require_token(operation, "operation")
    if operation in FORBIDDEN_OPERATIONS:
        fail("operation is forbidden in U5", "OPERATION_FORBIDDEN")
    if operation not in (
        "run_probe",
        "execute_probe",
        "cancel_probe",
        "mint_permit",
        "postclaim_authorize",
        "verify_effect",
        "verify_cancellation",
        "verify_receipt",
        "appendIfHead",
        "appendBatchIfHead",
        "getHead",
        "readback",
        "prepare",
        "cancel",
        "resolve",
        "capability_probe",
        "semantic_append",
        "semantic_readback",
    ):
        fail("operation is not part of the installed U5 surface", "OPERATION_FORBIDDEN")
    return operation
def write_root_private_json(path, value):
    parent = os.path.dirname(path)
    temporary = path + ".pending-" + secrets.token_hex(8)
    payload = (canonical(value) + "\n").encode("utf-8")
    descriptor = None
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        total = 0
        while total < len(payload):
            written = os.write(descriptor, payload[total:])
            if written <= 0:
                fail("cannot write installed evidence file")
            total += written
        os.fsync(descriptor)
    finally:
        if descriptor is not None:
            os.close(descriptor)
    os.replace(temporary, path)
    dir_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
def read_root_private_json(path, maximum=65536):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise InstalledError("installed evidence cannot be inspected: " + str(error)) from error
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
        fail("installed evidence is not a root-private canonical file")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(descriptor, maximum + 1)
    finally:
        os.close(descriptor)
    if len(raw) > maximum or not raw.endswith(b"\n"):
        fail("installed evidence is not bounded newline-terminated JSON")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text[:-1])
        if canonical(value) + "\n" != text:
            fail("installed evidence is not canonical")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError) as error:
        raise InstalledError("installed evidence is not canonical JSON") from error
    return value
