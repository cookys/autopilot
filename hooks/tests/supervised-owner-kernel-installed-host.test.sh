#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import contextlib, importlib.util, inspect, io, os, sys, tempfile
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
core = load('p37_installed_core_test', 'supervised_owner_kernel_installed.py')
sys.modules['supervised_owner_kernel_installed'] = core
transport = load('p37_installed_transport_test', 'supervised_owner_kernel_installed_transport.py')
transport.installed = core
sys.modules['supervised_owner_kernel_installed_transport'] = transport
service = load('p37_installed_service_test', 'supervised-owner-kernel-installed-service.py')
service.core, service.transport = core, transport
host = load('p37_installed_host_test', 'supervised-owner-kernel-installed-host.py')
digest = host.sha256_value
assert host.SERVICE_ROLES == (
    'kernel', 'worker', 'broker', 'receipt_verifier', 'witness', 'coordinator'
)
assert host.SERVICE_IDENTITIES['kernel'] == 'autopilot-p37i-kernel'
assert len(host.SERVICE_ROLES) == 6
assert host.require_lifecycle_timing_budget() < host.ROLE_RELEASE_TIMEOUT_SECONDS
assert callable(host.read_process_starttime) and callable(transport.read_process_starttime)
services = {
    role: {
        'role': role, 'identity': 'p37i-' + role,
        'uid': 91000 + i, 'gid': 92000 + i,
        'attestation_hash': digest('attestation:' + role),
    }
    for i, role in enumerate(host.SERVICE_ROLES)
}
units = {
    role: {
        'unit': 'autopilot-p37i-' + role + '-fixture.service',
        'cgroup_path': '/system.slice/autopilot-p37i-' + role + '-fixture.service',
        'release_token': 'release-' + role, 'quiesce_token': 'quiesce-' + role,
        'paths': host.role_paths('/run/p37i-fixture', role),
        'pid': 93000 + i, 'starttime': 1000 + i, 'may_exist': False,
    }
    for i, role in enumerate(host.SERVICE_ROLES)
}
handoff = {
    'handoff_hash': digest('handoff'),
    'p35_install_binding_hash': digest('p35-install'),
    'bridge_plan_hash': digest('plan'),
}
config = {
    'binding_hash': digest('p37-install'),
    'installed_abi_hash': digest('installed-abi'),
    'durable_abi_hash': digest('durable-abi'),
}
run_material = host.run_binding_material(config, handoff, 3, 'p37i-3-fixture', units, services)
assert run_material['p35_handoff_hash'] == handoff['handoff_hash']
assert len(run_material['services']) == 6 and run_material['services'][0]['role'] == 'kernel'
assert 'ticket_hash' not in host.canonical(run_material)
binding = host.installed_binding(
    core, config, handoff, 3, 'p37i-3-fixture', digest(run_material), units, services, digest('snapshot')
)
assert core.normalize_binding(binding, expected_abi_hash=config['installed_abi_hash']) == binding
assert binding['service_bindings']['kernel']['role'] == 'kernel'
endpoints = host.endpoint_specs('/run/p37i-fixture', services, transport)
assert {item['endpoint_id'] for item in endpoints} == {item['endpoint_id'] for item in transport.INSTALLED_ENDPOINTS}
bootstrap = host.bootstrap_material('broker', units['broker'], services['broker'], None, endpoints)
assert bootstrap['role'] == 'broker' and bootstrap['ack_socket_path'] == units['broker']['paths']['ack_socket']
runtime = host.runtime_services(core, binding, units, services)
assert set(runtime) == set(host.SERVICE_ROLES)
bad_units = {role: dict(unit) for role, unit in units.items()}
bad_units['kernel'] = dict(bad_units['kernel'], starttime=None)
try:
    host.runtime_services(core, binding, bad_units, services)
    raise AssertionError('runtime_services accepted missing starttime')
except host.InstalledHostError:
    pass
authority_claim = {
    'claim_hash': digest('claim'), 'cohort_id': binding['cohort_id'],
    'generation': binding['generation'], 'run_binding_hash': binding['run_binding_hash'],
    'handoff_hash': handoff['handoff_hash'],
}
peer_kernel = host.peer_config_material('kernel', binding, runtime, endpoints, authority_claim=authority_claim)
assert peer_kernel['authority']['engine_sink'] == 'disabled'
assert peer_kernel['authority_claim']['claim_hash'] == authority_claim['claim_hash']
coord_evidence = host.expected_probe_evidence(binding, 'coordinator')
assert coord_evidence[0]['code'] == 'WITNESS_AVAILABLE'
rv_evidence = host.expected_probe_evidence(binding, 'receipt_verifier')
assert [item['operation'] for item in rv_evidence] == ['resolve']
assert any(item['code'] == 'ACCEPTANCE_DISABLED' for item in rv_evidence)
kernel_evidence = host.expected_probe_evidence(binding, 'kernel')
assert [item['code'] for item in kernel_evidence] == [
    'PROBE_AUTHORIZED', 'PROBE_EXECUTED', 'PROBE_VERIFIED', 'WITNESS_RECORDED', 'WITNESS_AVAILABLE', 'PROBE_RESTORED']
assert [item['operation'] for item in kernel_evidence] == [
    'postclaim_authorize', 'execute_probe', 'verify_effect', 'semantic_append', 'semantic_readback', 'cancel_probe']
semantic_bind = {
    'claim_hash': authority_claim['claim_hash'], 'authorization_id': 'authorization-fixture',
    'effect_receipt_hash': digest('effect-receipt'), 'verification_hash': digest('verification'),
    'event_hash': digest('event'), 'witness_head': digest('head'), 'witness_sequence': 1,
}
kernel_live = []
for item in kernel_evidence:
    if item['operation'] in ('postclaim_authorize', 'execute_probe'):
        kernel_live.append(dict(item, claim_hash=authority_claim['claim_hash'], claim_consumed=True))
    elif item['operation'] == 'verify_effect':
        kernel_live.append(dict(item, effect_receipt_hash=semantic_bind['effect_receipt_hash'],
            verification_hash=semantic_bind['verification_hash'], claim_hash=authority_claim['claim_hash'],
            authorization_id=semantic_bind['authorization_id']))
    elif item['operation'] == 'semantic_append':
        kernel_live.append(dict(item, **semantic_bind))
    elif item['operation'] == 'semantic_readback':
        kernel_live.append(dict(item, **semantic_bind, readback_count=1))
    else:
        kernel_live.append(dict(item))
assert [item['code'] for item in host.validate_probe_evidence(kernel_live, binding, 'kernel')] == [
    'PROBE_AUTHORIZED', 'PROBE_EXECUTED', 'PROBE_VERIFIED', 'WITNESS_RECORDED', 'WITNESS_AVAILABLE', 'PROBE_RESTORED']
try:
    host.validate_probe_evidence([dict(coord_evidence[0], command='echo')], binding, 'coordinator')
    raise AssertionError('probe evidence accepted capability-shaped field')
except host.InstalledHostError:
    pass
ready_material = {
    'schema_version': 1, 'kind': 'p37_installed_listener_ready', 'role': 'broker',
    'identity': services['broker']['identity'], 'pid': units['broker']['pid'],
    'uid': services['broker']['uid'], 'gid': services['broker']['gid'],
    'bootstrap_hash': bootstrap['bootstrap_hash'],
    'listener_endpoint_ids': [e['endpoint_id'] for e in bootstrap['endpoints'] if e['recipient_role'] == 'broker'],
}
ready = dict(ready_material, ready_hash=digest(ready_material))
host.validate_ready(ready, bootstrap, services['broker'], units['broker'], ready_material['listener_endpoint_ids'])
with patch.object(service.os, 'getpid', return_value=units['broker']['pid']), \
     patch.object(service.os, 'geteuid', return_value=services['broker']['uid']), \
     patch.object(service.os, 'getegid', return_value=services['broker']['gid']), \
     patch.object(host, 'read_process_starttime', return_value=units['broker']['starttime']):
    peer_config = host.peer_config_material('broker', binding, runtime, endpoints, authority_claim=authority_claim)
    acknowledgement = service.write_ack(bootstrap, peer_config, host.expected_probe_evidence(binding, 'broker'))
    host.validate_ack(acknowledgement, bootstrap, peer_config, services['broker'], units['broker'], core)
    assert acknowledgement['phase'] == 'probe_complete' and acknowledgement['evidence'] == []
with patch.object(host, 'read_process_starttime', return_value=units['broker']['starttime'] + 99):
    try:
        host.validate_ack(acknowledgement, bootstrap, peer_config, services['broker'], units['broker'], core)
        raise AssertionError('validate_ack accepted starttime mismatch')
    except host.InstalledHostError:
        pass
kernel_bootstrap = host.bootstrap_material('kernel', units['kernel'], services['kernel'], None, endpoints)
with patch.object(service.os, 'getpid', return_value=units['kernel']['pid']), \
     patch.object(service.os, 'geteuid', return_value=services['kernel']['uid']), \
     patch.object(service.os, 'getegid', return_value=services['kernel']['gid']), \
     patch.object(host, 'read_process_starttime', return_value=units['kernel']['starttime']):
    peer_kernel = host.peer_config_material('kernel', binding, runtime, endpoints, authority_claim=authority_claim)
    kernel_ack = service.write_ack(kernel_bootstrap, peer_kernel, kernel_live)
    host.validate_ack(kernel_ack, kernel_bootstrap, peer_kernel, services['kernel'], units['kernel'], core)
assert [item['code'] for item in kernel_ack['evidence']][:3] == ['PROBE_AUTHORIZED', 'PROBE_EXECUTED', 'PROBE_VERIFIED']
assert kernel_ack['evidence'][0]['claim_consumed'] is True
class FakeAckConnection:
    def settimeout(self, _t): return None
    def sendall(self, _v): return None
    def close(self): self.closed = True
class FakeAckListener:
    def accept(self): return FakeAckConnection(), None
fake_ack_transport = SimpleNamespace(
    InstalledTransportError=Exception,
    peer_credentials=lambda *_a: (0, 0, 0),
    cgroup_v2_matches=lambda *_a: False,
    process_start_identity_matches=lambda *_a: False,
    read_single_frame=lambda *_a: (_ for _ in ()).throw(AssertionError('read before auth')),
    decode_frame=lambda *_a: (_ for _ in ()).throw(AssertionError('decode before auth')),
)
try:
    host.read_root_ack(FakeAckListener(), units['broker'], services['broker'], fake_ack_transport, 'fixture')
    raise AssertionError('root ACK accepted unauthenticated peer')
except host.InstalledHostError:
    pass
class FakePeerConn: pass
def fake_peer_creds(_c):
    return (units['broker']['pid'], services['broker']['uid'], services['broker']['gid'])
with patch.object(transport, 'peer_credentials', side_effect=fake_peer_creds), \
     patch.object(transport, 'cgroup_v2_matches', return_value=True), \
     patch.object(transport, 'process_start_identity_matches',
                  side_effect=lambda pid, uid, gid, starttime=None: starttime == units['broker']['starttime']):
    ok_expected = {
        'pid': units['broker']['pid'], 'uid': services['broker']['uid'],
        'gid': services['broker']['gid'], 'cgroup_path': units['broker']['cgroup_path'],
        'starttime': units['broker']['starttime'],
    }
    assert transport.peer_credentials_match(FakePeerConn(), ok_expected) is True
    assert transport.peer_credentials_match(FakePeerConn(), dict(ok_expected, starttime=ok_expected['starttime'] + 7)) is False
    assert transport.peer_credentials_match(FakePeerConn(), {
        'pid': units['broker']['pid'], 'uid': services['broker']['uid'],
        'gid': services['broker']['gid'], 'cgroup_path': units['broker']['cgroup_path'],
    }) is False
class Cmd:
    def __init__(self, returncode, stdout='', stderr=''):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr
# Production host has no dry_binding simulation branch.
assert 'dry_binding' not in inspect.signature(host.run_probe_session).parameters
host_src = open(os.path.join(engine, 'supervised-owner-kernel-installed-host.py'), encoding='utf-8').read()
fn_body = host_src.split('def run_probe_session', 1)[1].split('def parser', 1)[0]
assert 'if dry_binding is not None' not in fn_body and 'dry_binding=' not in fn_body
assert 'provisional_completed' in fn_body and 'persist_durable_audit_record' in host_src
assert 'remove_tree(runtime_root)' in fn_body and '.recovery.json' in fn_body
assert 'empty_audit_material' in fn_body and 'record_audit_phase' in fn_body
assert 'audit_material=audit_material' in fn_body
# Fixed probe helpers (test-only fixture, not production host path).
with tempfile.TemporaryDirectory(prefix='p37i-dry-') as tmp:
    norm = core.normalize_binding(binding, expected_abi_hash=binding['installed_abi_hash'])
    profile = host.sha256_value({'binding': norm, 'operation': 'run_probe'})
    sentinel = core.ProbeSentinel(tmp, norm['cohort_id'])
    auth = 'authorization-' + norm['cohort_id']
    record = sentinel.toggle(auth)
    assert sentinel.observe()['state_hash'] == record['current_hash']
    restore = sentinel.restore_last()
    assert restore['sentinel_restored'] is True
    fence = core.NonceFence()
    fence.observe(host.sha256_value(auth))
    try:
        fence.observe(host.sha256_value(auth))
        raise AssertionError('replay not refused')
    except core.InstalledError as err:
        assert err.code == 'REPLAY_DETECTED'
    dry = core.build_run_probe_result(norm, profile, 'completed', 'completed', True, {
        'authorization_id': auth, 'record': record, 'restore': restore,
        'effect_replayed': False, 'fixture_only': True,
    })
assert dry['outcome'] == 'completed' and dry['sentinel_restored'] is True
assert dry['effect_replayed'] is False and dry['authority']['engine_sink'] == 'disabled'
crash_material = {
    'acks': {'probe_complete': {'kernel': kernel_live}},
    'semantic_readback': [i for i in kernel_live if i['operation'] in ('semantic_append', 'semantic_readback')],
    'independent_verification': {'sentinel': False, 'toggles': 1},
    'claim_consumption': {'claim_hash': authority_claim['claim_hash'], 'consumed': True},
    'cleanup_evidence': {'unit_outcomes': [], 'cleanup_errors': []},
}
crash = core.create_crash_outcome('recovery_required', 'req-1', 'HOST_FAILURE', crash_material)
assert crash['effect_replayed'] is False and crash['outcome'] == 'recovery_required'
assert crash['audit_hash'] == core.sha256_value(crash_material)
# Transport: forbidden ops + replay fence.
try:
    transport.create_envelope(binding, 'kernel_broker', {'operation': 'accept', 'request_id': 'x'})
    raise AssertionError('transport accepted forbidden accept')
except (transport.InstalledTransportError, core.InstalledError):
    pass
payload = {'operation': 'execute_probe', 'request_id': 't1', 'authorization_id': 'a1'}
request = transport.create_request(binding, 'kernel_broker', payload, now_ms=2_000_000_000_000)
frame = transport.encode_frame(request)
fence = core.NonceFence()
transport.decode_request(binding, frame, nonce_fence=fence, now_ms=2_000_000_000_000)
try:
    transport.decode_request(binding, frame, nonce_fence=fence, now_ms=2_000_000_000_000)
    raise AssertionError('transport accepted replayed nonce')
except (transport.InstalledTransportError, core.InstalledError):
    pass
specs = service.self_probe_specs('kernel', binding, authority_claim=authority_claim)
assert [item['expected_code'] for item in specs] == [
    'PROBE_AUTHORIZED', 'PROBE_EXECUTED', 'PROBE_VERIFIED',
    'WITNESS_RECORDED', 'WITNESS_AVAILABLE', 'PROBE_RESTORED',
]
assert service.decode_root_group_json(b'{"a":1}\n', 'fixture') == {'a': 1}
with contextlib.redirect_stderr(io.StringIO()):
    try:
        service.decode_root_group_json(b'{"a":1}', 'fixture')
        raise AssertionError('accepted missing newline')
    except SystemExit:
        pass
for key in ('host', 'service', 'transport', 'core', 'contract', 'ipc', 'runner'):
    assert key in host.FILE_LAYOUT and key in host.SNAPSHOT_SOURCE_LAYOUT
assert host.FILE_LAYOUT['node_runtime'] == 'sbin/node' and 'node_runtime' not in host.SNAPSHOT_SOURCE_LAYOUT
# --- Six MUST-FIX security negatives (F1-F6) ---
assert '--node-path' not in host_src.split('def parser', 1)[1]
assert callable(host.resolve_trusted_node_runtime)
assert 'resolve_node_install_source' not in host_src
assert '--node-path' not in host_src.split('def parser', 1)[1]
with tempfile.TemporaryDirectory(prefix='p37i-node-') as tmp:
    evil = os.path.join(tmp, 'node'); open(evil, 'wb').write(b'x'); os.chmod(evil, 0o777)
    orig = dict(host.SYSTEM_PATHS)
    try:
        host.SYSTEM_PATHS = dict(orig, node_path=evil)
        try: host.resolve_trusted_node_runtime(); raise AssertionError('writable node ok')
        except host.InstalledHostError as err:
            assert any(k in str(err).lower() for k in ('writable', 'root-owned', 'trusted'))
    finally: host.SYSTEM_PATHS = orig
fake_pw, fake_gr = SimpleNamespace(pw_uid=91001, pw_gid=91001), SimpleNamespace(gr_gid=91001)
with patch.object(host.pwd, 'getpwnam', return_value=fake_pw), patch.object(host.grp, 'getgrnam', return_value=fake_gr):
    try: host.require_private_service_account('kernel', True); raise AssertionError('pre-existing ok')
    except host.InstalledHostError as err: assert 'pre-existing' in str(err).lower()
with patch.object(host, '_identity_user_exists', side_effect=lambda n: n.endswith('broker')), \
     patch.object(host, '_identity_group_exists', return_value=False):
    try: host.preflight_dedicated_identities_absent(); raise AssertionError('preflight ok')
    except host.InstalledHostError as err: assert 'pre-existing' in str(err).lower()
assert 'preflight_dedicated_identities_absent' in inspect.getsource(host.resolve_services)
assert 'was not confirmed after creation' in host_src
planned = host.plan_units('/run/p37i-fixture')
assert host.FROZEN_SERVICE_UNITS == tuple(planned[r]['unit'] for r in host.SERVICE_ROLES)
assert host.service_unit_name('kernel') == 'autopilot-p37i-kernel.service'
assert 'token_hex' not in inspect.getsource(host.service_unit_name)
def _show(load_rc, load_out, load_err=''):
    return lambda args, timeout_seconds=None: Cmd(
        load_rc if '--property=LoadState' in args else 0,
        load_out if '--property=LoadState' in args else 'inactive', load_err)
with patch.object(host, 'run_command', side_effect=_show(1, '', 'connection timed out')):
    try: host.preflight_units_absent('/usr/bin/systemctl', planned); raise AssertionError('query fail ok')
    except host.InstalledHostError as err: assert 'failed' in str(err).lower()
with patch.object(host, 'run_command', side_effect=_show(0, 'loaded')):
    try: host.preflight_units_absent('/usr/bin/systemctl', planned); raise AssertionError('loaded ok')
    except host.InstalledHostError as err: assert 'pre-existing' in str(err).lower() or 'forbidden' in str(err).lower()
with patch.object(host, 'run_command', side_effect=_show(0, 'not-found')):
    host.preflight_units_absent('/usr/bin/systemctl', planned)
created_acc, created_once = [], {'n': 0}
def _fake_require(role, create, created_identities=None):
    created_once['n'] += 1
    if created_once['n'] == 1:
        identity = host.SERVICE_IDENTITIES[role]
        if created_identities is not None:
            created_identities.append(identity)
        return ({'role': role, 'identity': identity, 'uid': 91001, 'gid': 91001, 'attestation_hash': digest('a1')}, True)
    raise host.InstalledHostError('cannot create installed identity ' + host.SERVICE_IDENTITIES[role] + ': mocked')
with patch.object(host, 'preflight_dedicated_identities_absent', return_value=None), \
     patch.object(host, 'require_private_service_account', side_effect=_fake_require):
    try: host.resolve_services(True, created_acc); raise AssertionError('should fail after first')
    except host.InstalledHostError: pass
assert created_acc == [host.SERVICE_IDENTITIES['kernel']], created_acc
install_src = inspect.getsource(host.install)
live_src = open(os.path.join(root, 'hooks', 'tests', 'supervised-owner-kernel-installed-live.test.sh'), encoding='utf-8').read()
assert 'resolve_services(True, created_identities)' in install_src and 'created_identities = []' in install_src
# W1 identity confirmation prefix: append before private-group validation raises.
w1_acc, w1_state = [], {'created': False}
with patch.object(host, '_identity_user_exists', side_effect=lambda n: w1_state['created']), \
     patch.object(host, '_identity_group_exists', side_effect=lambda n: w1_state['created']), \
     patch.object(host, 'run_command', side_effect=lambda *a, **k: (w1_state.update(created=True) or Cmd(0, '', ''))), \
     patch.object(host.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=91001, pw_gid=99999)), \
     patch.object(host.grp, 'getgrnam', return_value=SimpleNamespace(gr_gid=91001)):
    try:
        host.require_private_service_account('kernel', True, w1_acc)
        raise AssertionError('mismatched primary group accepted')
    except host.InstalledHostError as err:
        assert 'private primary group' in str(err).lower()
assert w1_acc == [host.SERVICE_IDENTITIES['kernel']], w1_acc
# W2 recovery persistence: fixed parent before identities; fail visibly; no parent-preexistence gate.
assert host.TRUSTED_RECOVERY_PARENT == '/run/autopilot-production-installed-recovery'
assert install_src.find('establish_trusted_recovery_parent') < install_src.find('resolve_services(True, created_identities)')
assert 'persist_install_recovery' in install_src and 'recovery_persist_error' in install_src
assert 'if state_parent and os.path.isdir' not in install_src
with patch.object(host, 'establish_trusted_recovery_parent', return_value=host.TRUSTED_RECOVERY_PARENT), \
     patch.object(host, 'write_root_file', side_effect=OSError('disk full')), \
     patch.object(host, 'fsync_directory'):
    try:
        host.persist_install_recovery({'kind': 'p37_installed_install_recovery', 'created_identities': []})
        raise AssertionError('recovery write failure swallowed')
    except (host.InstalledHostError, OSError) as err:
        assert 'disk full' in str(err).lower() or 'cannot write' in str(err).lower()
# W3 state-root pin under fixed trusted recovery parent; reject caller-selected ancestors.
assert 'pin_and_prepare_state_root' in install_src and 'revalidate_pinned_state_root' in install_src
for bad in ('/tmp/evil-caller-state', '/var/tmp/not-pinned'):
    try:
        (host.pin_and_prepare_state_root if 'tmp/evil' in bad else host.revalidate_pinned_state_root)(bad)
        raise AssertionError('unpinned state root accepted: ' + bad)
    except host.InstalledHostError as err:
        assert 'pinned' in str(err).lower() or 'trusted recovery' in str(err).lower()
assert 'pinned_state_root' in inspect.getsource(host.run_probe_session)
assert 'startswith(pinned_state_root' in host_src
# W4 live parent exclusivity: prove absent + plain exclusive mkdir (never mkdir -p).
assert '/usr/bin/mkdir -p' not in live_src and '/usr/bin/mkdir "$live_parent"' in live_src
assert 'exclusive live_parent' in live_src and 'TRUSTED_RECOVERY_PARENT' in live_src
# W5 recovery parent mode: exact root:root 0711 (traverse without list/mutate).
establish_src = inspect.getsource(host.establish_trusted_recovery_parent)
assert '0o711' in establish_src and 'require_exact_directory' in establish_src
assert '0o700' not in establish_src
assert 'chmod 0711' in live_src and 'cannot traverse trusted recovery parent' in live_src
import stat as _stat_mod
with tempfile.TemporaryDirectory(prefix='p37i-recovery-') as tmp:
    recovery = os.path.join(tmp, 'autopilot-production-installed-recovery')
    os.mkdir(recovery, 0o700)
    os.chmod(recovery, 0o700)
    assert (os.lstat(recovery).st_mode & 0o777) == 0o700
    def _trusted_no_own(path, label):
        path = host.require_absolute_path(path, label)
        info = os.lstat(path)
        if (
            _stat_mod.S_ISLNK(info.st_mode) or not _stat_mod.S_ISDIR(info.st_mode)
            or (info.st_mode & 0o022) != 0
        ):
            host.fail(label + ' must be a root-owned nonsymlink directory not group/world writable')
        return path
    def _exact_no_own(path, uid, gid, mode, label):
        info = os.lstat(path)
        if (
            _stat_mod.S_ISLNK(info.st_mode) or not _stat_mod.S_ISDIR(info.st_mode)
            or (info.st_mode & 0o7777) != mode
        ):
            host.fail(label + ' does not have the expected ownership and mode')
    with patch.object(host, 'TRUSTED_RECOVERY_PARENT', recovery), \
         patch.object(host, 'require_trusted_directory', side_effect=_trusted_no_own), \
         patch.object(host, 'require_exact_directory', side_effect=_exact_no_own), \
         patch.object(host.os, 'chown', return_value=None), \
         patch.object(host, 'fsync_directory'):
        got = host.establish_trusted_recovery_parent()
        assert got == recovery
        assert (os.lstat(recovery).st_mode & 0o777) == 0o711
    os.chmod(recovery, 0o771)
    with patch.object(host, 'TRUSTED_RECOVERY_PARENT', recovery), \
         patch.object(host, 'require_trusted_directory', side_effect=_trusted_no_own), \
         patch.object(host, 'require_exact_directory', side_effect=_exact_no_own), \
         patch.object(host.os, 'chown', return_value=None), \
         patch.object(host, 'fsync_directory'):
        try:
            host.establish_trusted_recovery_parent()
            raise AssertionError('group-writable recovery parent accepted')
        except host.InstalledHostError as err:
            assert 'writable' in str(err).lower() or 'root-owned' in str(err).lower()
    os.chmod(recovery, 0o711)
    os.rmdir(recovery)
    link_target = os.path.join(tmp, 'recovery-target')
    os.mkdir(link_target, 0o711)
    os.symlink(link_target, recovery)
    with patch.object(host, 'TRUSTED_RECOVERY_PARENT', recovery), \
         patch.object(host, 'require_trusted_directory', side_effect=_trusted_no_own), \
         patch.object(host, 'require_exact_directory', side_effect=_exact_no_own), \
         patch.object(host.os, 'chown', return_value=None), \
         patch.object(host, 'fsync_directory'):
        try:
            host.establish_trusted_recovery_parent()
            raise AssertionError('symlinked recovery parent accepted')
        except host.InstalledHostError as err:
            assert 'symlink' in str(err).lower() or 'nonsymlink' in str(err).lower() or 'root-owned' in str(err).lower()
    # W6 run-probe boundary: establish before revalidate/unit launch; 0700 drift → 0711;
    # symlink / non-root / group-world-writable still fail closed (W5 + non-root below).
    assert 'establish_trusted_recovery_parent()' in fn_body
    assert fn_body.find('establish_trusted_recovery_parent()') < fn_body.find(
        'revalidate_pinned_state_root(')
    assert fn_body.find('establish_trusted_recovery_parent()') < fn_body.find(
        'cannot launch installed')
    os.unlink(recovery)
    os.mkdir(recovery, 0o700)
    os.chmod(recovery, 0o700)
    assert (os.lstat(recovery).st_mode & 0o777) == 0o700
    def _trusted_owner(path, label, uid=0, gid=0):
        path = host.require_absolute_path(path, label)
        info = os.lstat(path)
        if (
            _stat_mod.S_ISLNK(info.st_mode) or not _stat_mod.S_ISDIR(info.st_mode)
            or uid != 0 or gid != 0 or (info.st_mode & 0o022) != 0
        ):
            host.fail(label + ' must be a root-owned nonsymlink directory not group/world writable')
        return path
    with patch.object(host, 'TRUSTED_RECOVERY_PARENT', recovery), \
         patch.object(host, 'require_trusted_directory', side_effect=_trusted_no_own), \
         patch.object(host, 'require_exact_directory', side_effect=_exact_no_own), \
         patch.object(host.os, 'chown', return_value=None), \
         patch.object(host, 'fsync_directory'):
        # run_probe_session calls establish first — prove 0700 drift is repaired.
        host.establish_trusted_recovery_parent()
        assert (os.lstat(recovery).st_mode & 0o777) == 0o711
    with patch.object(host, 'TRUSTED_RECOVERY_PARENT', recovery), \
         patch.object(host, 'require_trusted_directory',
                      side_effect=lambda p, l: _trusted_owner(
                          p, l,
                          uid=(1000 if p == recovery else 0),
                          gid=(1000 if p == recovery else 0))), \
         patch.object(host, 'require_exact_directory', side_effect=_exact_no_own), \
         patch.object(host.os, 'chown', return_value=None), \
         patch.object(host, 'fsync_directory'):
        try:
            host.establish_trusted_recovery_parent()
            raise AssertionError('non-root recovery parent accepted at run-probe boundary')
        except host.InstalledHostError as err:
            assert 'root-owned' in str(err).lower() or 'writable' in str(err).lower()
assert host.TERMINATION_SIGNALS == (host.signal.SIGINT, host.signal.SIGTERM)
assert 'SIG_BLOCK' in fn_body and 'SIG_SETMASK' in fn_body and 'SIG_UNBLOCK' not in fn_body
assert 'install_interrupt_handlers(' not in fn_body and 'raise_interruption' not in fn_body
assert fn_body.rfind('SIG_SETMASK') > fn_body.rfind('persist_durable_audit_record')
material = host.empty_audit_material('p37i-1-fixture', 1)
for phase in ('claim','claim_consumption','effect','verification','semantic_readback','restoration','independent_verification','cleanup'):
    host.record_audit_phase(material, phase, {'ok': True})
assert set(material['phases']) >= {'claim','claim_consumption','effect','verification','semantic_readback','restoration','cleanup'}
assert 'audit_material' in inspect.signature(host.collect_release_acks).parameters
assert 'record_audit_phase' in inspect.getsource(host.collect_release_acks)
assert 'effect_and_semantic' not in fn_body and 'claim_consumption' in fn_body
cleanup_fn = live_src.split('cleanup_live()')[1].split('emergency_cleanup()')[0]
assert all(' || true' not in ln for ln in cleanup_fn.splitlines() if 'userdel' in ln or 'groupdel' in ln)
verify_fn = live_src.split('verify_resource_absent()')[1].split('cleanup_live()')[0]
assert ' || true' not in verify_fn and 'unverifiable' in verify_fn and 'SERVICE_UNITS' in live_src
assert 'created_identities=()' in live_src and 'created_identities=("${SERVICE_IDENTITIES[@]}")' not in live_src
assert 'mapfile' in live_src and 'for identity in "${created_identities[@]:-}"' in cleanup_fn
# GNU getent tri-state: 0 present, 2 not-found (absence), other lookup failure.
assert 'getent_identity_rc' in live_src
assert '[ "$rc" -eq 0 ]' in live_src and '[ "$rc" -ne 2 ]' in live_src
assert 'absence unverifiable' in live_src or 'residue unverifiable' in live_src
# Cleanup failures affect process status via explicit finish_live before finalize_test.
assert 'finish_live()' in live_src
assert 'trap emergency_cleanup EXIT' in live_src
assert live_src.rfind('finish_live') > live_src.rfind('cleanup_live()')
assert 'finalize_test' in live_src.split('finish_live()')[1].split('sudo -n /usr/bin/mkdir')[0]
# Emergency trap body must not call fail/finalize_test after a fixed main result.
emergency_body = live_src.split('emergency_cleanup()')[1].split('trap emergency_cleanup EXIT')[0]
assert 'finalize_test' not in emergency_body and 'fail ' not in emergency_body
assert 'CLEANUP_DONE' in emergency_body
# finish_live records cleanup/verify failures then finalizes once.
finish_fn = live_src.split('finish_live()')[1].split('sudo -n /usr/bin/mkdir')[0]
assert 'cleanup_live' in finish_fn and 'verify_resource_absent' in finish_fn
assert 'cleanup_failures' in finish_fn and 'finalize_test' in finish_fn
assert finish_fn.count('finalize_test') == 1
# Main path ends with explicit finish_live, not bare finalize_test.
assert live_src.rstrip().endswith('finish_live') or live_src.rstrip().endswith('finish_live\n') or \
       live_src.strip().splitlines()[-1].strip() == 'finish_live'
# 3) Identity cleanup exceptions: timeout/lookup/command failures continue best-effort.
class _DelCmd:
    def __init__(self, returncode=0, stderr=''):
        self.returncode, self.stdout, self.stderr = returncode, '', stderr
alive = {'autopilot-p37i-kernel'}
with patch.object(host, '_identity_user_exists', side_effect=lambda n: n in alive), \
     patch.object(host, '_identity_group_exists', side_effect=lambda n: n in alive), \
     patch.object(host, 'run_command', side_effect=lambda args, timeout_seconds=None: (alive.discard(args[1]), _DelCmd(0))[1]):
    errors, evidence = host.remove_created_identities(['autopilot-p37i-kernel'])
    assert errors == [] and evidence[0]['absent'] is True
stuck = {'autopilot-p37i-broker'}
with patch.object(host, '_identity_user_exists', side_effect=lambda n: n in stuck), \
     patch.object(host, '_identity_group_exists', side_effect=lambda n: n in stuck), \
     patch.object(host, 'run_command', return_value=_DelCmd(1, 'busy')):
    errors, evidence = host.remove_created_identities(['autopilot-p37i-broker'])
    assert errors and evidence[0]['absent'] is False
with patch.object(host, '_identity_user_exists', side_effect=RuntimeError('nss timeout')), \
     patch.object(host, '_identity_group_exists', return_value=False), \
     patch.object(host, 'run_command', side_effect=host.InstalledHostError('command timed out: userdel')):
    errors, evidence = host.remove_created_identities(['autopilot-p37i-witness'])
    assert errors and any('timeout' in e.lower() or 'lookup' in e.lower() or 'failed' in e.lower() for e in errors)
    assert evidence[0]['absent'] is False
# 4) Unit absence: only verified not-found succeeds (independent LoadState/ActiveState).
def _sys_props(op_map, prop_map=None):
    prop_map = prop_map or {}
    def fake(args, timeout_seconds=None):
        op = args[1]
        if op == 'show':
            for flag in args:
                if flag.startswith('--property='):
                    prop = flag.split('=', 1)[1]
                    if prop in prop_map: return prop_map[prop]
            if 'show' in op_map: return op_map['show']
        if op in op_map: return op_map[op]
        raise AssertionError(repr(args))
    return fake
def _unit_case(props, active, expect_issues):
    with patch.object(host, 'run_command', side_effect=_sys_props({
        'stop': Cmd(0), 'reset-failed': Cmd(0), 'is-active': active,
    }, props)):
        issues, _ = host.stop_and_collect_unit('/usr/bin/systemctl', 'autopilot-p37i-fixture.service')
        if expect_issues:
            assert issues and any('show' in i or 'not-found' in i or 'still loaded' in i for i in issues)
        else:
            assert issues == [], repr(issues)
_unit_case({'LoadState': Cmd(1, '', 'Failed to get properties: Connection timed out'),
            'ActiveState': Cmd(1, '', 'Failed to get properties: Connection timed out')},
           Cmd(1, 'unknown', ''), True)
_unit_case({'LoadState': Cmd(0, 'loaded', ''), 'ActiveState': Cmd(0, 'inactive', '')},
           Cmd(3, 'inactive', ''), True)
_unit_case({'LoadState': Cmd(1, '', 'Unit not found.'), 'ActiveState': Cmd(1, '', 'Unit not found.')},
           Cmd(4, 'unknown', ''), False)
# 7) Runtime parent remaining entry forbids completed; churn-safe helpers present.
with tempfile.TemporaryDirectory(prefix='p37i-parent-') as tmp:
    parent = os.path.join(tmp, 'runtime-parent')
    os.makedirs(os.path.join(parent, 'leftover-cohort'))
    with patch.object(host, 'RUNTIME_PARENT', parent):
        errors, evidence = host.cleanup_runtime_parent_if_created(True)
        assert errors and 'leftover-cohort' in evidence[0].get('remaining', [])
    os.rmdir(os.path.join(parent, 'leftover-cohort'))
    with patch.object(host, 'RUNTIME_PARENT', parent):
        errors, evidence = host.cleanup_runtime_parent_if_created(True)
        assert errors == [] and evidence[0].get('absent') is True
    with patch.object(host, 'RUNTIME_PARENT', parent):
        assert host.cleanup_runtime_parent_if_created(False) == ([], [])
# Exclusive claim fsyncs parent; second claim fails closed.
with tempfile.TemporaryDirectory(prefix='p37i-claim-') as tmp:
    handoff_id = 'handoff-fixture'
    staged = {
        'handoff_id': handoff_id, 'handoff_hash': digest('handoff-live'),
        'p35_install_binding_hash': digest('p35'), 'bridge_plan_hash': digest('bridge'),
    }
    with open(os.path.join(tmp, handoff_id + '.json'), 'w', encoding='utf-8') as handle:
        handle.write(host.canonical(staged) + '\n')
    with patch.object(host, 'require_root_owned_path', return_value=None), \
         patch.object(host, 'fsync_directory') as fsync_dir:
        claimed = host.claim_handoff(tmp, handoff_id, {
            'cohort_id': binding['cohort_id'], 'generation': binding['generation'],
            'run_binding_hash': binding['run_binding_hash'],
        })
        assert claimed['claim']['claim_hash'] and fsync_dir.called
        try:
            host.claim_handoff(tmp, handoff_id, {
                'cohort_id': binding['cohort_id'], 'generation': binding['generation'],
                'run_binding_hash': binding['run_binding_hash'],
            })
            raise AssertionError('second exclusive claim accepted')
        except host.InstalledHostError:
            pass
print(host.canonical({
    'ok': True, 'roles': len(host.SERVICE_ROLES),
    'endpoints': len(transport.INSTALLED_ENDPOINTS),
    'dry_outcome': dry['outcome'],
    'kernel_identity': host.SERVICE_IDENTITIES['kernel'],
    'windows': ['w1', 'w2', 'w3', 'w4'],
}))
PY
)"
assert_contains "$PY_OUT" '"ok":true'
assert_contains "$PY_OUT" '"roles":6'
assert_contains "$PY_OUT" '"dry_outcome":"completed"'
assert_contains "$PY_OUT" '"kernel_identity":"autopilot-p37i-kernel"'
assert_contains "$PY_OUT" '"windows":["w1","w2","w3","w4"]'
# Shell-level getent tri-state + cleanup-failure exit propagation (no sudo).
shell_probe_out="$TEST_TMP/p37-getent-cleanup-probe.out"
shell_probe_rc=0
(
  set +e
  getent_identity_rc() { case "$2" in present-*) return 0 ;; missing-*) return 2 ;; *) return 3 ;; esac; }
  classify() {
    getent_identity_rc "$1" "$2"; rc=$?
    if [ "$rc" -eq 0 ]; then echo "present:$1:$2"
    elif [ "$rc" -ne 2 ]; then echo "error:$1:$2:rc=$rc"
    else echo "absent:$1:$2"; fi
  }
  classify passwd present-user; classify passwd missing-user; classify passwd broken-user
  classify group present-group; classify group missing-group; classify group broken-group
  cleanup_failures=0; __FAILS=0
  fail_record() { __FAILS=$((__FAILS + 1)); echo "fail:$*"; }
  finalize_like() { [ "$__FAILS" -eq 0 ] && { echo finalize:pass; exit 0; }; echo finalize:fail; exit 1; }
  cleanup_live() { cleanup_failures=$((cleanup_failures + 1)); }
  verify_resource_absent() { return 0; }
  finish_live() {
    cleanup_live; verify_resource_absent; residual_rc=$?
    [ "$cleanup_failures" -ne 0 ] && fail_record "cleanup_failures=$cleanup_failures"
    [ "$residual_rc" -ne 0 ] && fail_record "residual_rc=$residual_rc"
    finalize_like
  }
  finish_live
) >"$shell_probe_out" 2>&1 || shell_probe_rc=$?
out="$(cat "$shell_probe_out")"
for needle in present:passwd:present-user absent:passwd:missing-user error:passwd:broken-user:rc=3 present:group:present-group absent:group:missing-group error:group:broken-group:rc=3 fail:cleanup_failures=1 finalize:fail; do
  assert_contains "$out" "$needle"
done
assert_eq "$shell_probe_rc" "1" "cleanup-failure finish_live must exit nonzero"
finalize_test
