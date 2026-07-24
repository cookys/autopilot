#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import contextlib
import importlib.util
import inspect
import io
import os
import stat
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

root = sys.argv[1]
engine = os.path.join(root, 'src', 'engine')
sys.path.insert(0, engine)

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(engine, filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

host = load('p36_durable_host_test', 'supervised-production-substrate-durable-host.py')
core = load('p36_durable_host_core_test', 'supervised_production_substrate_durable.py')
transport = load('p36_durable_host_transport_test', 'supervised_production_substrate_durable_transport.py')
service = load('p36_durable_host_service_test', 'supervised-production-substrate-durable-service.py')
service.durable = core
service.transport = transport

def digest(value):
    return host.sha256_value(value)

services = {role: {
    'role': role, 'identity': 'p36d-' + role, 'uid': 61000 + index,
    'gid': 62000 + index, 'attestation_hash': digest('attestation:' + role),
} for index, role in enumerate(host.SERVICE_ROLES)}
units = {role: {
    'unit': 'autopilot-p36d-' + role + '-fixture.service',
    'cgroup_path': '/system.slice/autopilot-p36d-' + role + '-fixture.service',
    'release_token': 'release-' + role,
    'paths': host.role_paths('/run/p36d-fixture', role),
    'pid': 71000 + index,
} for index, role in enumerate(host.SERVICE_ROLES)}
handoff = {'handoff_hash': digest('handoff'), 'p35_install_binding_hash': digest('p35-install'), 'bridge_plan_hash': digest('plan')}
config = {'binding_hash': digest('p36-install'), 'durable_abi_hash': core.DURABLE_ABI_HASH}
run_material = host.run_binding_material(config, handoff, 9, 'p36d-9-fixture', units, services)
assert run_material['p35_handoff_hash'] == handoff['handoff_hash']
assert 'ticket_hash' not in host.canonical(run_material)
binding = host.durable_binding(core, config, handoff, 9, 'p36d-9-fixture', digest(run_material), units, services)
assert core.normalize_binding(binding) == binding
assert binding['service_bindings']['witness']['cgroup_binding_hash'] == core.sha256_value(units['witness']['cgroup_path'])
self_probe_specs = [spec for role in host.SERVICE_ROLES for spec in service.self_probe_specs(role, binding)]
assert {spec['endpoint_id'] for spec in self_probe_specs} == {item['endpoint_id'] for item in transport.DURABLE_ENDPOINTS}
assert [spec['expected_code'] for spec in self_probe_specs] == [
    'BROKER_EFFECTS_DISABLED', 'REVOCATION_UNAVAILABLE', 'WITNESS_RECORDED', 'WITNESS_RECORDED',
    'COORDINATOR_PREPARED', 'COORDINATOR_CANCELLED', 'WITNESS_AVAILABLE', 'WITNESS_AVAILABLE',
]
assert {spec['payload']['operation'] for spec in self_probe_specs} == {
    'execute', 'check_revocation', 'appendIfHead', 'appendBatchIfHead', 'prepare', 'cancel', 'getHead', 'readback',
}
assert 'accept' not in host.canonical(self_probe_specs) and 'permit' not in host.canonical(self_probe_specs)

endpoint = {'endpoint_id': 'worker_broker', 'socket_root': '/run/p36d-fixture/ipc/e0', 'socket_path': '/run/p36d-fixture/ipc/e0/s', 'sender_role': 'worker', 'recipient_role': 'broker', 'sender_gid': services['worker']['gid']}
endpoint_2 = {'endpoint_id': 'broker_receipt_verifier', 'socket_root': '/run/p36d-fixture/ipc/e4', 'socket_path': '/run/p36d-fixture/ipc/e4/s', 'sender_role': 'broker', 'recipient_role': 'receipt_verifier', 'sender_gid': services['broker']['gid']}
bootstrap = host.bootstrap_material('broker', units['broker'], services['broker'], None, [endpoint, endpoint_2])
assert bootstrap['endpoints'] == [endpoint, endpoint_2] and bootstrap['state_leaf'] is None
assert host.service_writable_paths('broker', units['broker'], [endpoint, endpoint_2], {}) == [units['broker']['paths']['ack_root'], endpoint['socket_root']]
assert host.DURABLE_STATE_ROOT_MODE == 0o711
with patch.object(service, 'read_root_group_json', return_value=bootstrap), patch.object(service, 'require_exact_identity'):
    assert service.read_bootstrap('/root-owned/bootstrap.json')['endpoints'] == [endpoint, endpoint_2]
assert service.decode_root_group_json(b'{"a":1}\n', 'fixture root config') == {'a': 1}
with contextlib.redirect_stderr(io.StringIO()):
    try:
        service.decode_root_group_json(b'{"a":1}', 'fixture root config')
        raise AssertionError('root config parser accepted a missing final newline')
    except SystemExit:
        pass
for raw in (b'{"a":NaN}\n', b'{"a":Infinity}\n', b'{"a":"\\ud800"}\n'):
    try:
        host.decode_root_canonical_json(raw, 'host hostile root JSON', 1024)
        raise AssertionError('host canonical parser accepted hostile JSON')
    except host.DurableHostError:
        pass
runtime = host.runtime_services(core, binding, units, services)
peer_config = host.peer_config_material('broker', binding, runtime, [endpoint, endpoint_2])
with patch.object(service, 'read_root_group_json', return_value=peer_config), \
     patch.object(service.os, 'getpid', return_value=units['broker']['pid']), \
     patch.object(service.transport, 'cgroup_v2_matches', return_value=True):
    normalized_peer = service.normalize_peer_config(bootstrap)
assert set(normalized_peer['runtime_services']) == {'worker', 'broker', 'receipt_verifier'}
assert normalized_peer['binding']['service_bindings']['broker'] == binding['service_bindings']['broker']
assert normalized_peer['binding']['service_bindings']['witness'] != binding['service_bindings']['witness']
assert normalized_peer['binding']['service_bindings']['coordinator'] != binding['service_bindings']['coordinator']
worker_peer_config = host.peer_config_material('worker', binding, runtime, [endpoint, endpoint_2])
assert set(worker_peer_config['runtime_services']) == {'worker', 'broker'}
assert worker_peer_config['durable_binding']['service_bindings']['receipt_verifier'] != binding['service_bindings']['receipt_verifier']
assert worker_peer_config['durable_binding']['service_bindings']['witness'] != binding['service_bindings']['witness']
assert worker_peer_config['durable_binding']['service_bindings']['coordinator'] != binding['service_bindings']['coordinator']
assert host.service_writable_paths('witness', units['witness'], [], {'witness': '/var/lib/p36/witness/leaf'})[-1] == '/var/lib/p36/witness/leaf'
assert host.require_lifecycle_timing_budget() < host.ROLE_RELEASE_TIMEOUT_SECONDS
evidence = {
    role: [dict(item, response_hash=digest({'role': role, 'index': index}))
           for index, item in enumerate(host.expected_probe_evidence(binding, role))]
    for role in host.SERVICE_ROLES
}
assert host.validate_probe_evidence(evidence['worker'], binding, 'worker')[0]['code'] == 'BROKER_EFFECTS_DISABLED'
try:
    hostile_evidence = list(evidence['worker'])
    hostile_evidence[0] = dict(hostile_evidence[0], permit='forbidden')
    host.validate_probe_evidence(hostile_evidence, binding, 'worker')
    raise AssertionError('probe evidence accepted a capability-shaped field')
except host.DurableHostError:
    pass

broker_listener_ids = [item['endpoint_id'] for item in bootstrap['endpoints'] if item['recipient_role'] == 'broker']
ready_material = {
    'schema_version': 1,
    'kind': 'p36_durable_listener_ready',
    'role': 'broker',
    'identity': services['broker']['identity'],
    'pid': units['broker']['pid'],
    'uid': services['broker']['uid'],
    'gid': services['broker']['gid'],
    'bootstrap_hash': bootstrap['bootstrap_hash'],
    'listener_endpoint_ids': broker_listener_ids,
}
ready = dict(ready_material, ready_hash=digest(ready_material))
host.validate_ready(ready, bootstrap, services['broker'], units['broker'], broker_listener_ids)
boolean_ready = dict(ready, schema_version=True)
boolean_ready_material = dict(boolean_ready)
boolean_ready_material.pop('ready_hash')
boolean_ready['ready_hash'] = digest(boolean_ready_material)
try:
    host.validate_ready(boolean_ready, bootstrap, services['broker'], units['broker'], broker_listener_ids)
    raise AssertionError('host accepted a rehashed ready schema boolean')
except host.DurableHostError:
    pass

with patch.object(service.os, 'getpid', return_value=units['broker']['pid']), \
     patch.object(service.os, 'geteuid', return_value=services['broker']['uid']), \
     patch.object(service.os, 'getegid', return_value=services['broker']['gid']), \
     patch.object(service, 'publish_owned_json'):
    acknowledgement = service.write_ack(bootstrap, normalized_peer, None, evidence['broker'])
host.validate_ack(acknowledgement, bootstrap, peer_config, services['broker'], units['broker'], core)
boolean_ack = dict(acknowledgement, schema_version=True)
boolean_ack_material = dict(boolean_ack)
boolean_ack_material.pop('ack_hash')
boolean_ack['ack_hash'] = digest(boolean_ack_material)
try:
    host.validate_ack(boolean_ack, bootstrap, peer_config, services['broker'], units['broker'], core)
    raise AssertionError('host accepted a rehashed acknowledgement schema boolean')
except host.DurableHostError:
    pass

with tempfile.TemporaryDirectory() as temporary:
    partial_runtime = os.path.join(temporary, 'runtime')
    os.mkdir(partial_runtime)
    os.mkdir(os.path.join(partial_runtime, 'roles'))
    host.remove_tree(partial_runtime)
    assert not os.path.lexists(partial_runtime)

with tempfile.TemporaryDirectory() as temporary:
    install_root = os.path.join(temporary, 'install')
    args = SimpleNamespace(
        install_root=install_root,
        state_root=os.path.join(temporary, 'state'),
        p35_handoff_root=os.path.join(temporary, 'handoff'),
        create_identities=False,
        node_path=None,
    )
    real_lstat = os.lstat

    def root_owned_partial_lstat(path):
        info = real_lstat(path)
        if os.path.normpath(path) == install_root:
            return SimpleNamespace(st_mode=info.st_mode, st_uid=0, st_gid=0)
        return info

    with patch.object(host, 'require_root'), \
         patch.object(host, 'require_supported_host'), \
         patch.object(host, 'ensure_root_state_root', return_value=args.state_root), \
         patch.object(host, 'require_root_owned_path'), \
         patch.object(host, 'resolve_services', return_value=services), \
         patch.object(host, 'current_termination_signal_mask', return_value=set()), \
         patch.object(host, 'install_interrupt_handlers', return_value={}), \
         patch.object(host, 'restore_interrupt_handlers'), \
         patch.object(host, 'restore_termination_signal_mask'), \
         patch.object(host, 'with_termination_signals_blocked', side_effect=lambda callback, _label: callback()), \
         patch.object(host.os, 'lstat', side_effect=root_owned_partial_lstat), \
         patch.object(host.os, 'chown', side_effect=OSError('forced ownership failure')):
        try:
            host.install(args)
            raise AssertionError('installer accepted a forced root ownership failure')
        except host.DurableHostError:
            pass
    assert not os.path.lexists(install_root), 'installer left a mkdir-created partial root after chown failure'
attempt_handoff = dict(handoff, handoff_id='p36-attempt-fixture')
with patch.object(host, 'process_start_token', return_value='123456'):
    attempt_material = host.launch_attempt_material(binding, attempt_handoff, units, 'preclaim_intent')
attempt = dict(attempt_material, attempt_hash=digest(attempt_material))
assert host.normalize_launch_attempt(attempt)['runtime_root'] == host.RUNTIME_PARENT + '/p36d-9-fixture'

bad_lock = SimpleNamespace(
    st_mode=stat.S_IFREG | 0o600,
    st_uid=0,
    st_gid=0,
    st_nlink=2,
    st_size=0,
)
with patch.object(host.os, 'lstat', return_value=bad_lock):
    try:
        host._require_root_private_regular_file('/root-owned/.generation.lock', 'fixture lock', allow_empty=True, maximum=0)
        raise AssertionError('generation lock accepted a hard-linked file')
    except host.DurableHostError:
        pass

payload = {'schema_version': 1, 'request_id': 'disabled-broker', 'operation': 'execute', 'substrate_plan_hash': binding['substrate_plan_hash']}
handler, availability = service.handler_for_role('broker', binding, None)
result = handler(core.canonical(payload).encode('utf-8'), digest('envelope'))
assert availability is None and result['code'] == 'BROKER_EFFECTS_DISABLED'
revocation = {'schema_version': 1, 'request_id': 'revocation', 'operation': 'check_revocation', 'broker_result_hash': digest('broker-result'), 'substrate_plan_hash': binding['substrate_plan_hash']}
handler, availability = service.handler_for_role('receipt_verifier', binding, None)
result = handler(core.canonical(revocation).encode('utf-8'), digest('envelope-2'))
assert availability is None and result['code'] == 'REVOCATION_UNAVAILABLE'

with contextlib.redirect_stderr(io.StringIO()):
    try:
        host.parser().parse_args(['run', '--handoff-id', 'opaque', '--config', '/tmp/override'])
        raise AssertionError('durable run accepted a caller config override')
    except SystemExit:
        pass

host_source = open(os.path.join(engine, 'supervised-production-substrate-durable-host.py'), encoding='utf-8').read()
service_source = open(os.path.join(engine, 'supervised-production-substrate-durable-service.py'), encoding='utf-8').read()
assert 'supervised_production_substrate_peer' not in host_source
assert 'supervised_production_substrate_peer' not in service_source
assert 'fcntl.flock' in host_source and 'write_abandoned_tombstone' in host_source and 'claim_verified_handoff' in host_source
assert 'create_effects_disabled_broker_result' in service_source
assert 'create_revocation_unavailable_result' in service_source
assert 'DurableWitness' in service_source and 'DurableCoordinator' in service_source
assert 'p36_durable_cohort_verified' in host_source and 'teardown_verified' in host_source
assert '_require_root_private_regular_file' in host_source and 'os.O_NOFOLLOW' in host_source
assert '0o600' in host_source and 'scoped_durable_binding' in host_source and 'direct_peer_roles' in host_source
assert 'recover_stale_launch_attempts' in host_source and 'preclaim_intent' in host_source and 'DURABLE_CAPACITY_EXHAUSTED' in host_source
assert 'P3.5d durable handoff is unavailable' in host_source and 'P3.5d durable handoff claim failed' in host_source
assert 'runtime_may_exist = True' in host_source and 'create_runtime_layout(runtime_root' in host_source
assert 'record_terminal_failure' in host_source and 'finish a verified durable cohort' in host_source
assert 'block_termination_signals' in host_source and 'finish a verified durable cohort' in host_source
assert 'decode_root_canonical_json' in host_source and 'parse_constant=_reject_json_constant' in host_source
assert 'on_created=lambda: _mark_install_root_created()' in host_source
assert 'decode_root_group_json' in service_source and 'raw[:-1]' in service_source
assert 'for endpoint, listener in listener_pairs' in service_source
assert 'run_self_probes' in service_source and 'start_listener_context' in service_source
lifecycle_source = inspect.getsource(host.run_session)
assert lifecycle_source.index('block_termination_signals("finish a verified durable cohort")') < lifecycle_source.index('except BaseException as error:')
assert lifecycle_source.index('block_termination_signals("persist a durable cohort failure")') > lifecycle_source.index('except BaseException as error:')
print('fresh_generation_and_one_shot_handoff_binding=true')
print('separate_state_leaf_and_socket_permissions=true')
print('disabled_broker_and_revocation_services=true')
print('p2b_probe_abi_is_not_reused=true')
print('generation_lock_and_teardown_status_are_fail_closed=true')
print('sealed_no_effect_self_probes_cover_every_durable_route=true')
print('peer_configs_disclose_only_direct_runtime_peers=true')
print('launch_intent_and_hash_only_probe_evidence_are_durable=true')
print('host_json_schema_and_partial_runtime_regressions=true')
print('installer_owns_mkdir_before_chown_failure=true')
PY
)"
PY_STATUS=$?

assert_eq "$PY_STATUS" "0" "P3.6 durable host deterministic fixture exits successfully"
assert_contains "$PY_OUT" "fresh_generation_and_one_shot_handoff_binding=true" "host binds a new generation to one root-only P3.5d handoff"
assert_contains "$PY_OUT" "separate_state_leaf_and_socket_permissions=true" "state leaves and socket roots remain role-specific"
assert_contains "$PY_OUT" "disabled_broker_and_revocation_services=true" "broker and revocation service handlers remain refusal-only"
assert_contains "$PY_OUT" "p2b_probe_abi_is_not_reused=true" "host and service do not import the P2b probe ABI"
assert_contains "$PY_OUT" "generation_lock_and_teardown_status_are_fail_closed=true" "generation lock and cohort result remain fail-closed and semantically accurate"
assert_contains "$PY_OUT" "sealed_no_effect_self_probes_cover_every_durable_route=true" "all durable routes have fixed no-effect probes"
assert_contains "$PY_OUT" "peer_configs_disclose_only_direct_runtime_peers=true" "stateless services cannot read unrelated runtime identities"
assert_contains "$PY_OUT" "launch_intent_and_hash_only_probe_evidence_are_durable=true" "claim recovery and fixed refusal evidence remain root-verifiable"
assert_contains "$PY_OUT" "host_json_schema_and_partial_runtime_regressions=true" "host rejects hostile schemas and cleans a partial runtime layout"
assert_contains "$PY_OUT" "installer_owns_mkdir_before_chown_failure=true" "installer cleans a root created before ownership setup fails"
finalize_test
