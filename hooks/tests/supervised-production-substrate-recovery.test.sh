#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import base64
import contextlib
import fcntl
import importlib.util
import json
import multiprocessing
import os
import stat
import sys
import tempfile
import time
import types

root = sys.argv[1]
module_path = os.path.join(root, "src", "engine", "supervised_production_substrate_durable.py")
spec = importlib.util.spec_from_file_location("p36_durable", module_path)
durable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(durable)

REAL_LSTAT = os.lstat
REAL_FSTAT = os.fstat
REAL_GETGROUPS = os.getgroups
REAL_FSYNC = os.fsync


def digest(value):
    return durable.sha256_value(value)


def binding(active_role, suffix):
    roles = durable.SERVICE_ROLES
    uid = os.geteuid()
    gid = os.getegid()
    services = {}
    for index, role in enumerate(roles, 1):
        services[role] = {
            "role": role,
            "identity": "p36-" + suffix + "-" + role,
            "uid": uid if role == active_role else 61000 + index,
            "gid": gid if role == active_role else 62000 + index,
            "attestation_hash": digest("attestation-" + suffix + "-" + role),
            "cgroup_binding_hash": digest("cgroup-" + suffix + "-" + role),
        }
    return {
        "schema_version": 1,
        "kind": "p36_durable_state_binding",
        "install_binding_hash": digest("install-" + suffix),
        "run_binding_hash": digest("run-" + suffix),
        "substrate_abi_hash": digest("substrate-abi-" + suffix),
        "substrate_plan_hash": digest("substrate-plan-" + suffix),
        "durable_abi_hash": durable.DURABLE_ABI_HASH,
        "cohort_id": "cohort-" + suffix,
        "generation": 1,
        "service_bindings": services,
    }


def request_bytes(value):
    return durable.canonical(value).encode("utf-8")


def witness_request(bound, request_id, operation, **extra):
    value = {
        "schema_version": 1,
        "request_id": request_id,
        "operation": operation,
        "stream_id": extra.pop("stream_id", "stream-p36"),
        "substrate_plan_hash": bound["substrate_plan_hash"],
    }
    value.update(extra)
    return value


def coordinator_request(bound, request_id, operation, **extra):
    value = {
        "schema_version": 1,
        "request_id": request_id,
        "operation": operation,
        "transaction_id": extra.pop("transaction_id", "transaction-p36"),
        "fence": extra.pop("fence", 1),
        "expected_witness_head": extra.pop("expected_witness_head", digest("witness-head")),
        "substrate_plan_hash": bound["substrate_plan_hash"],
    }
    value.update(extra)
    return value


def expect_code(callback, code):
    try:
        callback()
    except durable.DurableStateError as error:
        assert error.code == code, (error.code, code)
        return
    raise AssertionError("expected " + code)


def expect_codes(callback, codes):
    try:
        callback()
    except durable.DurableStateError as error:
        assert error.code in codes, (error.code, codes)
        return
    raise AssertionError("expected one of " + repr(codes))


def root_like_stat(info):
    return types.SimpleNamespace(
        st_mode=info.st_mode,
        st_uid=0,
        st_gid=info.st_gid,
        st_nlink=info.st_nlink,
        st_size=info.st_size,
        st_dev=info.st_dev,
        st_ino=info.st_ino,
    )


@contextlib.contextmanager
def root_provisioned_metadata():
    def fake_lstat(path, *args, **kwargs):
        return root_like_stat(REAL_LSTAT(path, *args, **kwargs))

    def fake_fstat(descriptor, *args, **kwargs):
        return root_like_stat(REAL_FSTAT(descriptor, *args, **kwargs))

    old_lstat = durable.os.lstat
    old_fstat = durable.os.fstat
    old_getgroups = durable.os.getgroups
    durable.os.lstat = fake_lstat
    durable.os.fstat = fake_fstat
    durable.os.getgroups = lambda: [os.getegid()]
    try:
        yield
    finally:
        durable.os.lstat = old_lstat
        durable.os.fstat = old_fstat
        durable.os.getgroups = old_getgroups


@contextlib.contextmanager
def isolated_groups():
    old_getgroups = durable.os.getgroups
    durable.os.getgroups = lambda: [os.getegid()]
    try:
        yield
    finally:
        durable.os.getgroups = old_getgroups


def provision_leaf(temporary, bound, role):
    parent = os.path.join(temporary, role + "-parent")
    leaf = os.path.join(parent, "leaf")
    os.mkdir(parent, 0o710)
    os.mkdir(leaf, 0o750)
    os.chmod(parent, 0o710)
    os.chmod(leaf, 0o750)

    files = {
        "generation.json": (durable.canonical(durable.generation_manifest_for(bound, role)) + "\n").encode("utf-8"),
        "journal.jsonl": (durable.canonical(durable.journal_header_for(bound, role)) + "\n").encode("utf-8"),
        ".lock": b"",
        "cohort.json": b"",
        "quarantine.json": b"",
    }
    for name, content in files.items():
        path = os.path.join(leaf, name)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o660 if name != "generation.json" else 0o440)
        try:
            if content:
                os.write(descriptor, content)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.chmod(path, 0o660 if name != "generation.json" else 0o440)
    return leaf


def hold_lock(path, ready):
    descriptor = os.open(path, os.O_RDWR)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        ready.put(True)
        time.sleep(1)
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


bound_witness = binding("witness", "witness")
bound_coordinator = binding("coordinator", "coordinator")
assert durable.normalize_binding(bound_witness)["durable_abi_hash"] == durable.DURABLE_ABI_HASH

with tempfile.TemporaryDirectory() as temporary:
    unsafe_leaf = provision_leaf(temporary, bound_witness, "witness")
    try:
        durable.DurableWitness(unsafe_leaf, bound_witness, uid=os.geteuid())
    except TypeError:
        pass
    else:
        raise AssertionError("production constructor retained a UID override")
    with isolated_groups():
        expect_code(
            lambda: durable.DurableWitness(unsafe_leaf, bound_witness),
            "DURABLE_FILESYSTEM_UNSAFE",
        )

cross_language_fixture = None
with tempfile.TemporaryDirectory() as temporary:
    witness_leaf = provision_leaf(temporary, bound_witness, "witness")
    with root_provisioned_metadata():
        witness = durable.DurableWitness(witness_leaf, bound_witness)
        first_request = witness_request(
            bound_witness,
            "append-1",
            "appendIfHead",
            expected_head=None,
            event_hash=digest("event-1"),
            event_payload_hash=digest("payload-1"),
        )
        first_envelope = digest("envelope-1")
        first = witness.handle(request_bytes(first_request), first_envelope)
        assert first["status"] == "recorded"
        assert first["sequence"] == 1
        assert witness.handle(request_bytes(first_request), first_envelope) == first

        head_request = witness_request(bound_witness, "head-1", "getHead")
        head_envelope = digest("head-envelope")
        head_before = witness.handle(request_bytes(head_request), head_envelope)
        assert head_before["status"] == "available"
        assert head_before["sequence"] == 1

        batch_request = witness_request(
            bound_witness,
            "batch-1",
            "appendBatchIfHead",
            expected_head=first["head"],
            events=[
                {"event_hash": digest("event-2"), "event_payload_hash": digest("payload-2")},
                {"event_hash": digest("event-3"), "event_payload_hash": digest("payload-3")},
            ],
        )
        batch = witness.handle(request_bytes(batch_request), digest("batch-envelope"))
        assert batch["sequence"] == 3
        assert witness.handle(request_bytes(head_request), head_envelope) == head_before
        expect_code(
            lambda: witness.handle(
                request_bytes({**head_request, "request_id": "append-1", "operation": "getHead"}),
                digest("conflicting-envelope"),
            ),
            "WITNESS_REQUEST_REPLAY_CONFLICT",
        )

        readback_request = witness_request(
            bound_witness,
            "readback-1",
            "readback",
            from_sequence=2,
            limit=2,
        )
        readback = witness.handle(request_bytes(readback_request), digest("readback-envelope"))
        assert [item["sequence"] for item in readback["records"]] == [2, 3]
        assert witness.handle(request_bytes(readback_request), digest("readback-envelope")) == readback

        large_integer = witness_request(
            bound_witness,
            "unsafe-integer",
            "readback",
            from_sequence=10 ** 100,
            limit=1,
        )
        expect_code(
            lambda: witness.handle(request_bytes(large_integer), digest("unsafe-integer-envelope")),
            "DURABLE_REQUEST_INVALID",
        )

        cross_language_fixture = {
            "binding": bound_witness,
            "request": batch_request,
            "request_envelope_hash": digest("batch-envelope"),
            "result": batch,
        }

        restarted = durable.DurableWitness(witness_leaf, bound_witness)
        expect_code(
            lambda: restarted.availability(),
            "DURABLE_COHORT_RECOVERY_REQUIRED",
        )
        assert os.path.getsize(os.path.join(witness_leaf, "cohort.json")) > 0
        assert os.path.getsize(os.path.join(witness_leaf, "quarantine.json")) > 0

with tempfile.TemporaryDirectory() as temporary:
    deleted_leaf = provision_leaf(temporary, bound_witness, "witness")
    with root_provisioned_metadata():
        witness = durable.DurableWitness(deleted_leaf, bound_witness)
        os.unlink(os.path.join(deleted_leaf, "journal.jsonl"))
        expect_code(lambda: witness.availability(), "DURABLE_FILESYSTEM_UNSAFE")
        assert not os.path.exists(os.path.join(deleted_leaf, "journal.jsonl"))

with tempfile.TemporaryDirectory() as temporary:
    marker_leaf = provision_leaf(temporary, bound_witness, "witness")
    with root_provisioned_metadata():
        witness = durable.DurableWitness(marker_leaf, bound_witness)
        marker_request = witness_request(
            bound_witness,
            "marker-append",
            "appendIfHead",
            expected_head=None,
            event_hash=digest("marker-event"),
            event_payload_hash=digest("marker-payload"),
        )
        witness.handle(request_bytes(marker_request), digest("marker-envelope"))
        with open(os.path.join(marker_leaf, "cohort.json"), "wb") as source:
            source.truncate(0)
        restarted = durable.DurableWitness(marker_leaf, bound_witness)
        expect_code(lambda: restarted.availability(), "DURABLE_COHORT_MARKER_MISSING")

with tempfile.TemporaryDirectory() as temporary:
    corrupt_leaf = provision_leaf(temporary, bound_witness, "witness")
    with root_provisioned_metadata():
        witness = durable.DurableWitness(corrupt_leaf, bound_witness)
        with open(os.path.join(corrupt_leaf, "journal.jsonl"), "ab") as source:
            source.write(b'{"generation":')
            source.write(b"9" * 5000)
            source.write(b"}\n")
        expect_code(lambda: witness.availability(), "DURABLE_JOURNAL_CORRUPT")
        assert os.path.getsize(os.path.join(corrupt_leaf, "quarantine.json")) > 0

with tempfile.TemporaryDirectory() as temporary:
    surrogate_leaf = provision_leaf(temporary, bound_witness, "witness")
    with root_provisioned_metadata():
        witness = durable.DurableWitness(surrogate_leaf, bound_witness)
        original_request = witness_request(
            bound_witness,
            "surrogate-append",
            "appendIfHead",
            expected_head=None,
            event_hash=digest("surrogate-event"),
            event_payload_hash=digest("surrogate-payload"),
        )
        witness.handle(request_bytes(original_request), digest("surrogate-envelope"))
        with open(os.path.join(surrogate_leaf, "journal.jsonl"), encoding="utf-8") as source:
            original_record = json.loads(source.readlines()[-1])
        surrogate_request = dict(original_request, request_id="\udc00")
        malicious_record = dict(original_record)
        malicious_record["request_id"] = surrogate_request["request_id"]
        malicious_record["request_canonical"] = durable.canonical(surrogate_request)
        malicious_record["request_hash"] = durable.sha256_value(malicious_record["request_canonical"])
        malicious_record["previous_journal_hash"] = original_record["journal_hash"]
        malicious_record["journal_hash"] = witness._record_hash(malicious_record)
        with open(os.path.join(surrogate_leaf, "journal.jsonl"), "ab") as source:
            source.write((durable.canonical(malicious_record) + "\n").encode("utf-8"))
            source.flush()
            os.fsync(source.fileno())
        expect_code(lambda: witness.availability(), "DURABLE_JOURNAL_CORRUPT")

with tempfile.TemporaryDirectory() as temporary:
    corrupt_leaf = provision_leaf(temporary, bound_witness, "witness")
    with root_provisioned_metadata():
        witness = durable.DurableWitness(corrupt_leaf, bound_witness)
        with open(os.path.join(corrupt_leaf, "quarantine.json"), "wb") as source:
            source.write(b'{"generation":')
            source.write(b"9" * 5000)
            source.write(b"}\n")
        expect_code(lambda: witness.availability(), "DURABLE_QUARANTINE_CORRUPT")

with tempfile.TemporaryDirectory() as temporary:
    failure_leaf = provision_leaf(temporary, bound_witness, "witness")
    with root_provisioned_metadata():
        witness = durable.DurableWitness(failure_leaf, bound_witness)
        calls = {"count": 0}

        def fail_journal_fsync(descriptor):
            calls["count"] += 1
            if calls["count"] >= 3:
                raise OSError("forced fsync failure")
            return REAL_FSYNC(descriptor)

        old_fsync = durable.os.fsync
        durable.os.fsync = fail_journal_fsync
        failure_request = witness_request(
            bound_witness,
            "failure-append",
            "appendIfHead",
            expected_head=None,
            event_hash=digest("failure-event"),
            event_payload_hash=digest("failure-payload"),
        )
        try:
            expect_code(
                lambda: witness.handle(request_bytes(failure_request), digest("failure-envelope")),
                "DURABLE_STORAGE_FAILED",
            )
        finally:
            durable.os.fsync = old_fsync
        expect_code(lambda: witness.availability(), "DURABLE_STORAGE_UNCERTAIN")
        restarted = durable.DurableWitness(failure_leaf, bound_witness)
        expect_codes(
            lambda: restarted.availability(),
            {"DURABLE_COHORT_RECOVERY_REQUIRED", "DURABLE_QUARANTINED"},
        )

with tempfile.TemporaryDirectory() as temporary:
    full_leaf = provision_leaf(temporary, bound_witness, "witness")
    with root_provisioned_metadata():
        witness = durable.DurableWitness(full_leaf, bound_witness)
        previous_limit = durable.MAX_JOURNAL_BYTES
        durable.MAX_JOURNAL_BYTES = os.path.getsize(os.path.join(full_leaf, "journal.jsonl"))
        try:
            expect_code(
                lambda: witness.handle(
                    request_bytes(witness_request(bound_witness, "full-head", "getHead")),
                    digest("full-head-envelope"),
                ),
                "DURABLE_JOURNAL_FULL",
            )
            expect_code(lambda: witness.availability(), "DURABLE_JOURNAL_FULL")
        finally:
            durable.MAX_JOURNAL_BYTES = previous_limit

with tempfile.TemporaryDirectory() as temporary:
    lock_leaf = provision_leaf(temporary, bound_witness, "witness")
    with root_provisioned_metadata():
        witness = durable.DurableWitness(lock_leaf, bound_witness)
        context = multiprocessing.get_context("fork")
        ready = context.Queue()
        process = context.Process(target=hold_lock, args=(os.path.join(lock_leaf, ".lock"), ready))
        process.start()
        ready.get(timeout=5)
        previous_timeout = durable.DURABLE_LOCK_TIMEOUT_SECONDS
        durable.DURABLE_LOCK_TIMEOUT_SECONDS = 0.1
        try:
            expect_code(lambda: witness.availability(), "DURABLE_LOCK_UNAVAILABLE")
        finally:
            durable.DURABLE_LOCK_TIMEOUT_SECONDS = previous_timeout
            process.join(5)
        assert process.exitcode == 0

with tempfile.TemporaryDirectory() as temporary:
    coordinator_leaf = provision_leaf(temporary, bound_coordinator, "coordinator")
    with root_provisioned_metadata():
        coordinator = durable.DurableCoordinator(coordinator_leaf, bound_coordinator)
        unknown_cancel_request = coordinator_request(
            bound_coordinator,
            "unknown-cancel",
            "cancel",
            transaction_id="unknown-transaction",
            fence=1,
        )
        unknown_cancelled = coordinator.handle(
            request_bytes(unknown_cancel_request),
            digest("unknown-cancel-envelope"),
        )
        assert unknown_cancelled["status"] == "unknown"
        expect_code(
            lambda: coordinator.handle(
                request_bytes(coordinator_request(
                    bound_coordinator,
                    "prepare-after-unknown",
                    "prepare",
                    transaction_id="unknown-transaction",
                    fence=2,
                )),
                digest("prepare-after-unknown-envelope"),
            ),
            "COORDINATOR_TRANSACTION_CONFLICT",
        )
        assert coordinator.handle(
            request_bytes(unknown_cancel_request),
            digest("unknown-cancel-envelope"),
        ) == unknown_cancelled
        cross_language_fixture["unknown_cancel"] = {
            "binding": bound_coordinator,
            "request": unknown_cancel_request,
            "request_envelope_hash": digest("unknown-cancel-envelope"),
            "result": unknown_cancelled,
        }

        prepare_request = coordinator_request(bound_coordinator, "prepare-1", "prepare", fence=2)
        prepared = coordinator.handle(request_bytes(prepare_request), digest("prepare-envelope"))
        cancel_request = coordinator_request(bound_coordinator, "cancel-1", "cancel", fence=2)
        cancelled = coordinator.handle(request_bytes(cancel_request), digest("cancel-envelope"))
        assert prepared["status"] == "prepared"
        assert cancelled["status"] == "cancelled"
        assert coordinator.handle(request_bytes(prepare_request), digest("prepare-envelope")) == prepared
        restarted = durable.DurableCoordinator(coordinator_leaf, bound_coordinator)
        expect_code(lambda: restarted.availability(), "DURABLE_COHORT_RECOVERY_REQUIRED")

for operation, malicious_status in (
    ("cancel", "unavailable"),
    ("cancel", "unknown"),
    ("resolve", "cancelled"),
):
    with tempfile.TemporaryDirectory() as temporary:
        coordinator_leaf = provision_leaf(temporary, bound_coordinator, "coordinator")
        with root_provisioned_metadata():
            coordinator = durable.DurableCoordinator(coordinator_leaf, bound_coordinator)
            transaction_id = "malicious-" + operation + "-" + malicious_status
            prepare_request = coordinator_request(
                bound_coordinator,
                "prepare-" + transaction_id,
                "prepare",
                transaction_id=transaction_id,
                fence=1,
            )
            coordinator.handle(request_bytes(prepare_request), digest("prepare-" + transaction_id))
            terminal_request = coordinator_request(
                bound_coordinator,
                "terminal-" + transaction_id,
                operation,
                transaction_id=transaction_id,
                fence=1,
            )
            request_canonical = durable.canonical(terminal_request)
            with open(os.path.join(coordinator_leaf, "journal.jsonl"), encoding="utf-8") as source:
                previous_journal_hash = json.loads(source.readlines()[-1])["journal_hash"]
            malicious_record = {
                "schema_version": 1,
                "kind": "p36_durable_coordinator_record",
                "operation": operation,
                "request_id": terminal_request["request_id"],
                "request_canonical": request_canonical,
                "request_hash": durable.sha256_value(request_canonical),
                "request_envelope_hash": digest("terminal-" + transaction_id),
                "transaction_id": transaction_id,
                "fence": 1,
                "expected_witness_head": terminal_request["expected_witness_head"],
                "status": malicious_status,
                "previous_journal_hash": previous_journal_hash,
            }
            malicious_record["journal_hash"] = coordinator._record_hash(malicious_record)
            with open(os.path.join(coordinator_leaf, "journal.jsonl"), "ab") as source:
                source.write((durable.canonical(malicious_record) + "\n").encode("utf-8"))
                source.flush()
                os.fsync(source.fileno())
            expect_code(lambda: coordinator.availability(), "DURABLE_JOURNAL_CORRUPT")

witness_snapshot = durable.service_availability_snapshot(
    bound_witness,
    "witness",
    "available",
    digest("availability-witness"),
)
coordinator_snapshot = durable.service_availability_snapshot(
    bound_witness,
    "coordinator",
    "available",
    digest("availability-coordinator"),
)
disclosure = durable.create_availability_disclosure(
    bound_witness,
    witness_snapshot,
    coordinator_snapshot,
)
assert disclosure["status"] == "available"
foreign_snapshot = durable.service_availability_snapshot(
    bound_coordinator,
    "coordinator",
    "available",
    digest("foreign-coordinator"),
)
expect_code(
    lambda: durable.create_availability_disclosure(
        bound_witness,
        witness_snapshot,
        foreign_snapshot,
    ),
    "DURABLE_STATE_INVALID",
)

broker_request = {
    "schema_version": 1,
    "request_id": "broker-execute",
    "operation": "execute",
    "substrate_plan_hash": bound_witness["substrate_plan_hash"],
}
broker_result = durable.create_effects_disabled_broker_result(
    bound_witness,
    request_bytes(broker_request),
    digest("broker-envelope"),
)
assert broker_result["status"] == "disabled"
assert broker_result["code"] == "BROKER_EFFECTS_DISABLED"
cross_language_fixture["broker"] = {
    "request": broker_request,
    "request_envelope_hash": digest("broker-envelope"),
    "result": broker_result,
}
revocation_request = {
    "schema_version": 1,
    "request_id": "revocation-check",
    "operation": "check_revocation",
    "broker_result_hash": broker_result["result_hash"],
    "substrate_plan_hash": bound_witness["substrate_plan_hash"],
}
revocation_result = durable.create_revocation_unavailable_result(
    bound_witness,
    request_bytes(revocation_request),
    digest("revocation-envelope"),
)
assert revocation_result["status"] == "unavailable"
assert revocation_result["code"] == "REVOCATION_UNAVAILABLE"
assert revocation_result["broker_result_hash"] == broker_result["result_hash"]
cross_language_fixture["revocation"] = {
    "request": revocation_request,
    "request_envelope_hash": digest("revocation-envelope"),
    "result": revocation_result,
}

source = open(module_path, encoding="utf-8").read()
assert "subprocess" not in source
assert "AutopilotEngine" not in source
print("durable_cas_batch_readback=true")
print("durable_exact_replay_and_race=true")
print("durable_restart_quarantine=true")
print("durable_broker_disabled=true")
print("durable_no_effect_surface=true")
print("cross_language_fixture=" + base64.b64encode(
    durable.canonical(cross_language_fixture).encode("utf-8")
).decode("ascii"))
PY
)"
STATUS=$?

assert_eq "$STATUS" "0" "P3.6 durable recovery fixture exits successfully"
assert_contains "$PY_OUT" "durable_cas_batch_readback=true" "durable witness provides atomic CAS, batch, and readback"
assert_contains "$PY_OUT" "durable_exact_replay_and_race=true" "durable witness stores immutable replay snapshots"
assert_contains "$PY_OUT" "durable_restart_quarantine=true" "new service instances cannot reuse a durable cohort"
assert_contains "$PY_OUT" "durable_broker_disabled=true" "every durable broker operation stays explicitly disabled"
assert_contains "$PY_OUT" "durable_no_effect_surface=true" "durable state source has no Engine or subprocess effect path"

CROSS_LANGUAGE_FIXTURE="$(printf '%s\n' "$PY_OUT" | sed -n 's/^cross_language_fixture=//p')"
NODE_OUT="$(node - "$REPO_ROOT" "$CROSS_LANGUAGE_FIXTURE" <<'NODE'
const assert = require('assert/strict');
const path = require('path');

const root = process.argv[2];
const encoded = process.argv[3];
const durable = require(path.join(root, 'src', 'engine', 'supervised-production-substrate-durable-contract'));
const fixture = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));

assert.equal(fixture.binding.durable_abi_hash, durable.getSupervisedProductionDurableAbiHash());
assert.deepEqual(
  durable.normalizeDurableWitnessResult(
    fixture.binding,
    fixture.request,
    fixture.request_envelope_hash,
    fixture.result,
  ),
  fixture.result,
);
assert.deepEqual(
  durable.normalizeDurableRevocationResult(
    fixture.binding,
    fixture.revocation.request,
    fixture.revocation.request_envelope_hash,
    fixture.revocation.result,
  ),
  fixture.revocation.result,
);
assert.deepEqual(
  durable.normalizeDurableBrokerResult(
    fixture.binding,
    fixture.broker.request,
    fixture.broker.request_envelope_hash,
    fixture.broker.result,
  ),
  fixture.broker.result,
);
assert.deepEqual(
  durable.normalizeDurableCoordinatorResult(
    fixture.unknown_cancel.binding,
    fixture.unknown_cancel.request,
    fixture.unknown_cancel.request_envelope_hash,
    fixture.unknown_cancel.result,
  ),
  fixture.unknown_cancel.result,
);
const tampered = structuredClone(fixture.result);
tampered.sequence += 1;
assert.throws(
  () => durable.normalizeDurableWitnessResult(
    fixture.binding,
    fixture.request,
    fixture.request_envelope_hash,
    tampered,
  ),
);
console.log('durable_python_result_normalized=true');
NODE
)"
NODE_STATUS=$?

assert_eq "$NODE_STATUS" "0" "P3.6 Python result matches the frozen Node durable ABI"
assert_contains "$NODE_OUT" "durable_python_result_normalized=true" "Node verifies Python witness result and rejects tampering"

finalize_test
