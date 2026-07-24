#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import importlib.util
import os
import sys
from types import SimpleNamespace
from unittest.mock import patch

root = sys.argv[1]
spec = importlib.util.spec_from_file_location(
    'p35_durable_handoff',
    os.path.join(root, 'src', 'engine', 'supervised_p35_durable_handoff.py'),
)
handoff = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handoff)

def digest(label):
    return handoff.sha256_value(label)

now = 2_000_000_000_000
authority = {
    'issuer': 'owner-control',
    'key_id': 'owner-key-a',
    'attestation_hash': digest('authority'),
}
record = handoff.create_verified_handoff(
    p35_install_binding_hash=digest('p35-install'),
    session_id='session-v2',
    session_challenge_hash=digest('challenge'),
    ticket_hash=digest('ticket'),
    descriptor_binding_hash=digest('descriptor'),
    workspace_root_hash=digest('workspace'),
    immutable_base='a' * 40,
    authority=authority,
    gateway_receipt_hash=digest('gateway'),
    bridge_plan_hash=digest('plan'),
    bridge_receipt_hash=digest('bridge'),
    authenticated_receipt_hash=digest('authenticated'),
    now_ms=now,
    handoff_id='handoff-v2',
)
assert record['intake_protocol_version'] == 2
assert handoff.normalize_handoff(record, now_ms=now) == record
assert 'workspace_path' not in handoff.canonical(record)
assert 'descriptor_path' not in handoff.canonical(record)
assert 'ticket_body' not in handoff.canonical(record)
for raw in (b'{"value":NaN}', b'{"value":Infinity}', b'{"value":-Infinity}'):
    try:
        handoff.require_canonical_json_bytes(raw, 'nonfinite handoff fixture')
        raise AssertionError('non-finite handoff JSON was accepted')
    except handoff.DurableHandoffError:
        pass

for field in ('schema_version', 'intake_protocol_version'):
    candidate = dict(record, **{field: True})
    material = dict(candidate)
    material.pop('handoff_hash')
    candidate['handoff_hash'] = handoff.sha256_value(handoff.canonical(material))
    try:
        handoff.normalize_handoff(candidate, now_ms=now)
        raise AssertionError('rehashed handoff boolean was accepted for ' + field)
    except handoff.DurableHandoffError:
        pass

for mutate in (
    lambda value: value.update(intake_protocol_version=1),
    lambda value: value.update(ticket_hash=digest('substituted-ticket')),
    lambda value: value.update(expires_at_ms=value['issued_at_ms']),
):
    candidate = dict(record)
    mutate(candidate)
    try:
        handoff.normalize_handoff(candidate, now_ms=now)
        raise AssertionError('tampered handoff was accepted')
    except handoff.DurableHandoffError:
        pass
try:
    handoff.normalize_handoff(record, now_ms=record['expires_at_ms'])
    raise AssertionError('expired handoff was accepted')
except handoff.DurableHandoffError:
    pass

consumer = {
    'p36_install_binding_hash': digest('p36-install'),
    'p36_run_binding_hash': digest('p36-run'),
    'durable_binding_hash': digest('durable-binding'),
    'cohort_id': 'cohort-new',
    'generation': 7,
}
writes = {}
def fake_write(path, value, label):
    if path in writes:
        raise handoff.DurableHandoffError(label + ' already exists')
    writes[path] = value

with patch.object(handoff, 'require_root_process'), \
     patch.object(handoff, 'ensure_handoff_root', side_effect=lambda root, create=False: root), \
     patch.object(handoff, '_read_root_file', side_effect=lambda _path, _label: record), \
     patch.object(handoff, '_write_new_root_file', side_effect=fake_write), \
     patch.object(handoff, 'fsync_directory'):
    claimed = handoff.claim_verified_handoff('/root-only', 'handoff-v2', consumer, now_ms=now)
    assert claimed['handoff'] == record
    assert claimed['claim']['cohort_id'] == 'cohort-new'
    try:
        handoff.claim_verified_handoff('/root-only', 'handoff-v2', consumer, now_ms=now)
        raise AssertionError('one-shot handoff replay was accepted')
    except handoff.DurableHandoffError:
        pass

claim_boolean = dict(claimed['claim'], schema_version=True)
claim_material = dict(claim_boolean)
claim_material.pop('claim_hash')
claim_boolean['claim_hash'] = handoff.sha256_value(handoff.canonical(claim_material))
try:
    handoff.normalize_claim(claim_boolean)
    raise AssertionError('rehashed handoff claim boolean schema was accepted')
except handoff.DurableHandoffError:
    pass

root_info = SimpleNamespace(
    st_mode=0o100600,
    st_uid=0,
    st_gid=0,
    st_nlink=1,
    st_size=128,
)
full_mailbox = ['handoff-id' + str(index) + '.json' for index in range(handoff.MAX_HANDOFF_RECORDS)]
with patch.object(handoff, 'require_exact_directory'), \
     patch.object(handoff.os, 'listdir', return_value=full_mailbox), \
     patch.object(handoff, '_require_root_private_file_info', return_value=root_info):
    try:
        handoff.require_handoff_capacity('/root-only')
        raise AssertionError('full durable handoff mailbox accepted another publication')
    except handoff.DurableHandoffError as error:
        assert str(error) == 'DURABLE_HANDOFF_CAPACITY_EXHAUSTED'

with patch.object(handoff, 'require_exact_directory'), \
     patch.object(handoff.os, 'listdir', return_value=['handoff-orphan.claim']), \
     patch.object(handoff, '_require_root_private_file_info', return_value=root_info):
    try:
        handoff.require_handoff_capacity('/root-only')
        raise AssertionError('terminal-only durable handoff mailbox entry was accepted')
    except handoff.DurableHandoffError:
        pass

publication_events = []
with patch.object(handoff, 'require_root_process'), \
     patch.object(handoff, 'ensure_handoff_root', side_effect=lambda root: root), \
     patch.object(handoff, 'normalize_handoff', return_value=record), \
     patch.object(handoff, 'acquire_handoff_admission_lock', side_effect=lambda _root: publication_events.append('lock') or object()), \
     patch.object(handoff, 'require_handoff_capacity', side_effect=lambda _root: publication_events.append('capacity')), \
     patch.object(handoff, '_write_new_root_file', side_effect=lambda *_args: publication_events.append('write')), \
     patch.object(handoff, 'fsync_directory', side_effect=lambda _root: publication_events.append('fsync')), \
     patch.object(handoff, 'release_handoff_admission_lock', side_effect=lambda _lock: publication_events.append('release')):
    handoff.publish_verified_handoff('/root-only', record)
assert publication_events == ['lock', 'capacity', 'write', 'fsync', 'release']

reservation_events = []
reserved_descriptor = object()
with patch.object(handoff, 'require_root_process'), \
     patch.object(handoff, 'ensure_handoff_root', side_effect=lambda root: root), \
     patch.object(handoff, 'acquire_handoff_admission_lock', side_effect=lambda _root: reservation_events.append('lock') or reserved_descriptor), \
     patch.object(handoff, 'require_handoff_capacity', side_effect=lambda _root: reservation_events.append('capacity')), \
     patch.object(handoff, 'release_handoff_admission_lock', side_effect=lambda lock: reservation_events.append('release') if lock is reserved_descriptor else (_ for _ in ()).throw(AssertionError('wrong reservation lock'))):
    assert handoff.reserve_handoff_publication_slot('/root-only') is reserved_descriptor
    handoff.release_handoff_admission_lock(reserved_descriptor)
assert reservation_events == ['lock', 'capacity', 'release']

reserved_publication_events = []
with patch.object(handoff, 'require_root_process'), \
     patch.object(handoff, 'ensure_handoff_root', side_effect=lambda root: root), \
     patch.object(handoff, 'normalize_handoff', return_value=record), \
     patch.object(handoff, 'acquire_handoff_admission_lock', side_effect=AssertionError('reserved publish reacquired its lock')), \
     patch.object(handoff, 'require_handoff_capacity', side_effect=AssertionError('reserved publish repeated capacity admission')), \
     patch.object(handoff, '_write_new_root_file', side_effect=lambda *_args: reserved_publication_events.append('write')), \
     patch.object(handoff, 'fsync_directory', side_effect=lambda _root: reserved_publication_events.append('fsync')):
    handoff.publish_verified_handoff('/root-only', record, reserved_descriptor)
assert reserved_publication_events == ['write', 'fsync']

released_after_failure = []
with patch.object(handoff, 'require_root_process'), \
     patch.object(handoff, 'ensure_handoff_root', side_effect=lambda root: root), \
     patch.object(handoff, 'acquire_handoff_admission_lock', return_value=reserved_descriptor), \
     patch.object(handoff, 'require_handoff_capacity', side_effect=handoff.DurableHandoffError('DURABLE_HANDOFF_CAPACITY_EXHAUSTED')), \
     patch.object(handoff, 'release_handoff_admission_lock', side_effect=lambda lock: released_after_failure.append(lock)):
    try:
        handoff.reserve_handoff_publication_slot('/root-only')
        raise AssertionError('failed mailbox reservation retained its admission lock')
    except handoff.DurableHandoffError:
        pass
assert released_after_failure == [reserved_descriptor]

expired_writes = {}
with patch.object(handoff, 'require_root_process'), \
     patch.object(handoff, 'ensure_handoff_root', side_effect=lambda root, create=False: root), \
     patch.object(handoff, '_read_root_file', side_effect=lambda _path, _label: record), \
     patch.object(handoff, '_write_new_root_file', side_effect=lambda path, value, _label: expired_writes.setdefault(path, value)), \
     patch.object(handoff, 'fsync_directory'):
    try:
        handoff.claim_verified_handoff('/root-only', 'handoff-v2', consumer, now_ms=record['expires_at_ms'])
        raise AssertionError('expired handoff claim was accepted')
    except handoff.DurableHandoffError:
        pass
assert any(path.endswith('.expired') for path in expired_writes)

source = open(os.path.join(root, 'src', 'engine', 'supervised_p35_durable_handoff.py'), encoding='utf-8').read()
assert 'os.O_EXCL' in source and 'os.O_NOFOLLOW' in source and 'os.fsync' in source
assert 'parse_constant=_reject_json_constant' in source
assert 'MAX_HANDOFF_RECORDS' in source and 'fcntl.flock' in source and 'require_handoff_capacity' in source
assert 'reserve_handoff_publication_slot' in source and 'reserved_admission_lock' in source
assert 'workspace_path' not in source and 'ticket_body' not in source
print('v2_only_hash_only_handoff=true')
print('expired_and_replayed_handoffs_are_terminal=true')
print('root_private_exclusive_claim_protocol=true')
print('bounded_locked_handoff_mailbox=true')
print('reserved_handoff_capacity_survives_p35_cleanup=true')
PY
)"
PY_STATUS=$?

assert_eq "$PY_STATUS" "0" "P3.5d durable handoff deterministic fixture exits successfully"
assert_contains "$PY_OUT" "v2_only_hash_only_handoff=true" "handoff is v2-only and contains hash-only workspace facts"
assert_contains "$PY_OUT" "expired_and_replayed_handoffs_are_terminal=true" "expired and repeated handoff claims fail closed"
assert_contains "$PY_OUT" "root_private_exclusive_claim_protocol=true" "handoff record and claim use root-private exclusive persistence"
assert_contains "$PY_OUT" "bounded_locked_handoff_mailbox=true" "terminal P3.5 handoffs cannot grow the root mailbox without bound"
assert_contains "$PY_OUT" "reserved_handoff_capacity_survives_p35_cleanup=true" "P3.5 can hold verified mailbox capacity through cleanup and publish without a second admission race"
finalize_test
