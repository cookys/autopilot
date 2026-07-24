#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import importlib.util
import os
import socket
import struct
import sys
from unittest.mock import patch

root = sys.argv[1]
engine_root = os.path.join(root, 'src', 'engine')
sys.path.insert(0, engine_root)

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(engine_root, filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

durable = load('p36_durable_core_test', 'supervised_production_substrate_durable.py')
transport = load('p36_durable_transport_test', 'supervised_production_substrate_durable_transport.py')
transport.durable = durable

def digest(value):
    return transport.sha256_value(value)

roles = ('worker', 'broker', 'receipt_verifier', 'witness', 'coordinator')
binding = {
    'schema_version': 1,
    'kind': 'p36_durable_state_binding',
    'install_binding_hash': digest('install'),
    'run_binding_hash': digest('run'),
    'substrate_abi_hash': digest('substrate'),
    'substrate_plan_hash': digest('plan'),
    'durable_abi_hash': durable.DURABLE_ABI_HASH,
    'cohort_id': 'cohort-new',
    'generation': 3,
    'service_bindings': {
        role: {
            'role': role,
            'identity': 'p36d-' + role,
            'uid': 41000 + index,
            'gid': 42000 + index,
            'attestation_hash': digest('attestation:' + role),
            'cgroup_binding_hash': digest('/system.slice/p36d-' + role + '.service'),
        }
        for index, role in enumerate(roles)
    },
}
runtime = {
    role: {
        **binding['service_bindings'][role],
        'pid': 51000 + index,
        'cgroup_path': '/system.slice/p36d-' + role + '.service',
    }
    for index, role in enumerate(roles)
}
for value in runtime.values():
    value['cgroup_binding_hash'] = digest(value['cgroup_path'])

payload = {
    'schema_version': 1,
    'request_id': 'broker-request',
    'operation': 'execute',
    'substrate_plan_hash': binding['substrate_plan_hash'],
}
request_value, request_frame = transport.create_request(
    binding,
    runtime,
    'worker_broker',
    payload,
    now_ms=2_000_000_000_000,
    nonce_hash=digest('nonce'),
)
decoded = transport.decode_request(binding, runtime, request_frame, now_ms=2_000_000_000_000)
assert decoded['endpoint']['endpoint_id'] == 'worker_broker'
assert decoded['payload_bytes'] == transport.canonical(payload).encode('utf-8')
response = durable.create_effects_disabled_broker_result(
    binding, decoded['payload_bytes'], decoded['envelope_hash']
)
_, response_frame = transport.create_response(decoded, response)
assert transport.decode_response(decoded, response_frame) == response
assert response['code'] == 'BROKER_EFFECTS_DISABLED'

def expect_transport_error(callback, label):
    try:
        callback()
    except transport.DurableTransportError:
        return
    raise AssertionError(label)

# Python must not accept JSON true as a frozen wire integer simply because
# bool is an int subclass locally.  Rehash every frame that reaches the
# relevant parser branch so these are ABI, not checksum, regressions.
expect_transport_error(
    lambda: transport.decode_request(
        binding,
        runtime,
        transport.encode_frame({**request_value, 'schema_version': True}),
        now_ms=2_000_000_000_000,
    ),
    'outer request schema boolean was accepted',
)
for key in ('schema_version', 'protocol_version'):
    hostile_request = dict(request_value, envelope=dict(request_value['envelope'], **{key: True}))
    expect_transport_error(
        lambda hostile_request=hostile_request: transport.decode_request(
            binding, runtime, transport.encode_frame(hostile_request), now_ms=2_000_000_000_000
        ),
        'envelope ' + key + ' boolean was accepted',
    )
boolean_payload = dict(payload, schema_version=True)
boolean_envelope = dict(request_value['envelope'])
boolean_envelope['payload_hash'] = digest(transport.canonical(boolean_payload))
boolean_endpoint = transport.endpoint_by_id('worker_broker')
boolean_envelope['authentication_proof_hash'] = transport.authentication_proof_hash(
    binding,
    boolean_endpoint,
    runtime['worker'],
    runtime['broker'],
    boolean_envelope,
)
expect_transport_error(
    lambda: transport.decode_request(
        binding,
        runtime,
        transport.encode_frame({
            'schema_version': transport.TRANSPORT_SCHEMA_VERSION,
            'kind': transport.REQUEST_KIND,
            'envelope': boolean_envelope,
            'payload': boolean_payload,
        }),
        now_ms=2_000_000_000_000,
    ),
    'payload schema boolean was accepted',
)
expect_transport_error(
    lambda: transport.decode_response(
        decoded,
        transport.encode_frame({
            'schema_version': True,
            'kind': transport.RESPONSE_KIND,
            'request_envelope_hash': decoded['envelope_hash'],
            'request_hash': decoded['request_hash'],
            'response': response,
            'response_hash': digest(transport.canonical(response)),
        }),
    ),
    'outer response schema boolean was accepted',
)
boolean_response = dict(response, schema_version=True)
boolean_response_material = dict(boolean_response)
boolean_response_material.pop('result_hash')
boolean_response['result_hash'] = digest(transport.canonical(boolean_response_material))
expect_transport_error(
    lambda: transport.decode_response(
        decoded,
        transport.encode_frame({
            'schema_version': transport.TRANSPORT_SCHEMA_VERSION,
            'kind': transport.RESPONSE_KIND,
            'request_envelope_hash': decoded['envelope_hash'],
            'request_hash': decoded['request_hash'],
            'response': boolean_response,
            'response_hash': digest(transport.canonical(boolean_response)),
        }),
    ),
    'inner response schema boolean was accepted',
)
for core_value, callback in (
    (dict(binding, schema_version=True), lambda value: durable.normalize_binding(value)),
    (dict(payload, schema_version=True), lambda value: durable.normalize_broker_request(value, binding)),
):
    try:
        callback(core_value)
        raise AssertionError('durable core accepted a frozen schema boolean')
    except durable.DurableStateError:
        pass

receipt_material = {
    'sequence': 1,
    'event_hash': digest('event'),
    'event_payload_hash': digest('event-payload'),
    'previous_head': None,
    'request_hash': digest('request'),
}
receipt = dict(receipt_material, head=digest({
    'schema_version': durable.SCHEMA_VERSION,
    'kind': 'p36_durable_witness_receipt',
    'stream_id': 'fixture-stream',
    **receipt_material,
}))
assert transport._normalize_witness_receipt(receipt, 'fixture-stream', 'fixture receipt') == receipt

# A recipient cannot add a hidden capability-shaped field, change its result
# family, or change the refusal code merely by recomputing the response hash.
for mutate in (
    lambda value: value.update(permit='forbidden'),
    lambda value: value.update(kind='p36_durable_revocation_result'),
    lambda value: value.update(code='REVOCATION_UNAVAILABLE'),
    lambda value: value.update(status=[]),
):
    hostile = dict(response)
    mutate(hostile)
    material = dict(hostile)
    material.pop('result_hash')
    hostile['result_hash'] = digest(hostile and transport.canonical(material))
    try:
        transport.create_response(decoded, hostile)
        raise AssertionError('rehashed hostile response was accepted by the sender')
    except transport.DurableTransportError:
        pass
    wrapper = {
        'schema_version': transport.TRANSPORT_SCHEMA_VERSION,
        'kind': transport.RESPONSE_KIND,
        'request_envelope_hash': decoded['envelope_hash'],
        'request_hash': decoded['request_hash'],
        'response': hostile,
        'response_hash': digest(transport.canonical(hostile)),
    }
    try:
        transport.decode_response(decoded, transport.encode_frame(wrapper))
        raise AssertionError('rehashed hostile response was accepted after transport decode')
    except transport.DurableTransportError:
        pass

substituted = dict(request_value)
substituted['payload'] = {**payload, 'request_id': 'substituted'}
try:
    transport.decode_request(binding, runtime, transport.encode_frame(substituted), now_ms=2_000_000_000_000)
    raise AssertionError('payload substitution was accepted')
except transport.DurableTransportError:
    pass
cross_route = dict(request_value)
cross_route['envelope'] = dict(request_value['envelope'], endpoint_id='coordinator_witness')
try:
    transport.decode_request(binding, runtime, transport.encode_frame(cross_route), now_ms=2_000_000_000_000)
    raise AssertionError('rehashed cross-route frame was accepted')
except transport.DurableTransportError:
    pass
expired = dict(request_value)
expired['envelope'] = dict(request_value['envelope'], expires_at_ms=1)
try:
    transport.decode_request(binding, runtime, transport.encode_frame(expired), now_ms=2_000_000_000_000)
    raise AssertionError('expired frame was accepted')
except transport.DurableTransportError:
    pass

base = transport.canonical({'data': ''}).encode('utf-8')
boundary = {'data': 'x' * (transport.MAX_FRAME_BYTES - len(base))}
assert len(transport.canonical(boundary).encode('utf-8')) == transport.MAX_FRAME_BYTES
assert len(transport.encode_frame(boundary)) == transport.MAX_FRAME_BYTES + 4
try:
    transport.encode_frame({'data': boundary['data'] + 'x'})
    raise AssertionError('over-boundary durable frame was accepted')
except transport.DurableTransportError:
    pass
for invalid in (
    struct.pack('!I', 0),
    struct.pack('!I', transport.MAX_FRAME_BYTES + 1),
    struct.pack('!I', 6) + b'{"a":1}',
    struct.pack('!I', 13) + b'{"a":1,"a":1}',
    struct.pack('!I', 9) + b'{"a":NaN}',
    struct.pack('!I', 14) + b'{"a":Infinity}',
):
    try:
        transport.decode_frame(invalid, 'invalid frame')
        raise AssertionError('invalid bounded frame was accepted')
    except transport.DurableTransportError:
        pass

left, right = socket.socketpair()
try:
    left.sendall(request_frame + b'X')
    try:
        transport.read_single_frame(right, 0.2)
        raise AssertionError('trailing transport bytes were accepted')
    except transport.DurableTransportError:
        pass
finally:
    left.close()
    right.close()

class FakeConnection:
    def close(self):
        pass

class FakeListener:
    def settimeout(self, _value):
        pass
    def accept(self):
        return FakeConnection(), None

frame_reads = []
with patch.object(transport, 'peer_credentials_match', return_value=None), \
     patch.object(transport, 'read_single_frame', side_effect=lambda *_args: frame_reads.append(True)):
    try:
        transport.serve_one(FakeListener(), binding, runtime, 'worker_broker', lambda *_args: {})
        raise AssertionError('unexpected peer was accepted')
    except transport.DurableTransportError:
        pass
assert frame_reads == []

source = open(os.path.join(engine_root, 'supervised_production_substrate_durable_transport.py'), encoding='utf-8').read()
assert 'supervised_production_substrate_peer' not in source
assert 'socket.SO_PEERCRED' in source
assert 'peer_credentials_match(connection, sender)' in source
assert 'MAX_FRAME_BYTES = 524288' in source
print('separate_512k_durable_transport=true')
print('canonical_envelope_and_result_binding=true')
print('credential_and_cgroup_check_precedes_frame_parse=true')
print('p2b_protocol_is_not_imported=true')
PY
)"
PY_STATUS=$?

assert_eq "$PY_STATUS" "0" "P3.6 durable transport deterministic fixture exits successfully"
assert_contains "$PY_OUT" "separate_512k_durable_transport=true" "durable transport has its own 512 KiB ABI boundary"
assert_contains "$PY_OUT" "canonical_envelope_and_result_binding=true" "durable transport binds canonical payloads, envelopes, and responses"
assert_contains "$PY_OUT" "credential_and_cgroup_check_precedes_frame_parse=true" "durable listener verifies the Linux peer before frame parsing"
assert_contains "$PY_OUT" "p2b_protocol_is_not_imported=true" "durable transport does not reuse the P2b peer ABI"
finalize_test
