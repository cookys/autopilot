#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PY_OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import contextlib
import base64
import errno
import importlib.util
import inspect
import io
import json
import os
import select
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time
import types
from unittest.mock import patch

root = sys.argv[1]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(root, 'src', 'engine', filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

host = load('p35_host', 'supervised-intake-host.py')
gateway = load('p35_gateway', 'supervised-intake-gateway.py')
worker = load('p35_worker', 'supervised-intake-worker.py')

raw_keyring = {
    'schema_version': 1,
    'issuer': 'owner-control',
    'keyring_id': 'owner-keyring-e1',
    'keyring_epoch': 1,
    'keys': [{
        'algorithm': 'ed25519',
        'key_id': 'owner-key-a',
        'not_before_ms': 1,
        'not_after_ms': 2,
        'public_key_spki_base64': base64.urlsafe_b64encode(
            bytes.fromhex('302a300506032b6570032100') + bytes(32)
        ).decode('ascii').rstrip('='),
    }],
}
raw = host.canonical(raw_keyring).encode('utf-8')
keyring = host.validate_keyring_bytes(raw, 'test keyring')
assert keyring['authority'] == {
    'issuer': 'owner-control',
    'key_id': 'owner-keyring-e1',
    'attestation_hash': host.sha256_bytes(raw),
}
try:
    host.validate_keyring_bytes(raw + b'\n', 'noncanonical keyring')
    raise AssertionError('noncanonical keyring was accepted')
except host.HostError:
    pass

with tempfile.TemporaryDirectory() as temporary:
    fake_node = os.path.join(temporary, 'fake-node')
    with open(fake_node, 'w', encoding='utf-8') as target:
        target.write('#!/bin/sh\nexit 0\n')
    os.chmod(fake_node, 0o700)
    try:
        host.preflight_node_runtime(fake_node)
        raise AssertionError('Node preflight accepted an incompatible executable')
    except host.HostError:
        pass
for invalid_keyring in (
    {**raw_keyring, 'keys': [{**raw_keyring['keys'][0], 'public_key_spki_base64': 'AAAA'}]},
    {**raw_keyring, 'keys': [{**raw_keyring['keys'][0], 'not_after_ms': host.MAX_KEY_LIFETIME_MILLISECONDS + 2}]},
):
    try:
        host.validate_keyring_bytes(host.canonical(invalid_keyring).encode('utf-8'), 'invalid keyring')
        raise AssertionError('Node-incompatible keyring was accepted by the installer')
    except host.HostError:
        pass

material = host.installation_material(
    '/run/autopilot-p35-test/install',
    '/var/lib/autopilot-p35-test',
    '/var/lib/autopilot-p35-registry-test',
    '/var/lib/autopilot-p35-witness-test',
    {'identity': host.WORKER_IDENTITY, 'uid': 991, 'gid': 991},
    {'identity': host.VERIFIER_IDENTITY, 'uid': 992, 'gid': 992},
    {'identity': host.SHADOW_WITNESS_IDENTITY, 'uid': 993, 'gid': 993},
    {key: '/usr/bin/' + key for key in ('node_path', 'python_path', 'setpriv_path', 'systemd_run_path', 'systemctl_path')},
    {name: {'relative_path': relative, 'sha256': 'a' * 64} for name, relative in host.FILE_LAYOUT.items()},
    keyring,
)
assert material['runtime_parent'] == host.RUNTIME_PARENT
assert material['limits']['session_ttl_milliseconds'] == host.SESSION_TTL_MILLISECONDS
assert material['systemd_properties'] == list(host.SYSTEMD_PROPERTIES)
assert host.WORKER_IDENTITY == 'autopilot-intake-worker'
assert host.WORKER_IDENTITY != host.LEGACY_P34_WORKER_IDENTITY
assert host.SHADOW_WITNESS_IDENTITY == 'autopilot-shadow-witness'
assert material['workspace_registry']['socket'] == '/var/lib/autopilot-p35-registry-test/registry.sock'
assert material['durable_handoff_root'] == '/var/lib/autopilot-p35-registry-test/p36-handoff'
assert material['witness_state_root'] == '/var/lib/autopilot-p35-witness-test'
assert 'RuntimeMaxSec=45s' in host.SYSTEMD_PROPERTIES
assert 'TimeoutStopSec=5s' in host.SYSTEMD_PROPERTIES
assert host.sha256_value(material) == host.sha256_value(material)
unicode_material = host.installation_material(
    '/run/autopilot-p35-\u8acb',
    '/var/lib/autopilot-p35-\u8acb',
    '/var/lib/autopilot-p35-registry-\u8acb',
    '/var/lib/autopilot-p35-witness-\u8acb',
    {'identity': host.WORKER_IDENTITY, 'uid': 991, 'gid': 991},
    {'identity': host.VERIFIER_IDENTITY, 'uid': 992, 'gid': 992},
    {'identity': host.SHADOW_WITNESS_IDENTITY, 'uid': 993, 'gid': 993},
    {key: '/usr/bin/' + key for key in ('node_path', 'python_path', 'setpriv_path', 'systemd_run_path', 'systemctl_path')},
    {name: {'relative_path': relative, 'sha256': 'a' * 64} for name, relative in host.FILE_LAYOUT.items()},
    keyring,
)
node_hash = subprocess.check_output([
    'node',
    '-e',
    "const path=require('path');const {canonicalJson,sha256}=require(path.join(process.argv[1],'src','engine','owner-kernel','canonical'));process.stdout.write(sha256(canonicalJson(JSON.parse(process.argv[2]))));",
    root,
    json.dumps(unicode_material, ensure_ascii=False, separators=(',', ':')),
], text=True)
assert node_hash == host.sha256_value(unicode_material)
assert '\\u8acb' not in host.canonical(unicode_material)
try:
    host.require_absolute_path('//run/autopilot-p35', 'double slash path')
    raise AssertionError('double-leading-slash path was accepted')
except host.HostError:
    pass

sync_calls = []
original_fsync_directory = host.fsync_directory
host.fsync_directory = lambda path: sync_calls.append(path)
try:
    host.fsync_snapshot_tree('/snapshot')
finally:
    host.fsync_directory = original_fsync_directory
assert sync_calls == [
    '/snapshot/lib/owner-kernel',
    '/snapshot/sbin',
    '/snapshot/lib',
    '/snapshot/etc',
    '/snapshot',
]

with contextlib.redirect_stderr(io.StringIO()):
    try:
        host.parser().parse_args(['begin', '--config', '/tmp/override.json'])
        raise AssertionError('begin accepted a config override')
    except SystemExit:
        pass
with contextlib.redirect_stderr(io.StringIO()):
    try:
        host.parser().parse_args(['submit', '--session-id', 'p35-session', '--keyring', '/tmp/override.json'])
        raise AssertionError('submit accepted a keyring override')
    except SystemExit:
        pass

paths = host.session_paths('p35-session')
assert paths['root'] == '/run/autopilot-intake/p35-session'
assert paths['session'].startswith(paths['root_state'] + '/')
assert paths['handoff_socket'].startswith(paths['worker'] + '/')
assert paths['socket_path'].startswith(paths['socket'] + '/')

config = {'binding_hash': 'b' * 64}
session = host.normalize_session({
    'schema_version': 1,
    'status': 'open',
    'session_id': 'p35-session',
    'session_challenge_hash': 'c' * 64,
    'install_binding_hash': 'b' * 64,
    'expires_at_ms': 10,
}, config)
assert session['session_challenge_hash'] == 'c' * 64
assert 'session_challenge' not in session
assert host.session_storage_value(session).get('intake_protocol_version') is None
v2_session = host.normalize_session({
    'schema_version': 1,
    'status': 'open',
    'session_id': 'p35d-session',
    'session_challenge_hash': 'd' * 64,
    'install_binding_hash': 'b' * 64,
    'expires_at_ms': 11,
    'intake_protocol_version': 2,
}, config)
assert v2_session['intake_protocol_version'] == 2
assert host.session_storage_value(v2_session)['intake_protocol_version'] == 2

handoff_calls = {}
class HandoffStub:
    class DurableHandoffError(Exception):
        pass
    @staticmethod
    def canonical(value):
        return host.canonical(value)
    @staticmethod
    def sha256_value(value):
        return host.sha256_value(value)
    @staticmethod
    def create_verified_handoff(**kwargs):
        handoff_calls['create'] = kwargs
        return {'handoff_id': 'root-only-handoff'}
    @staticmethod
    def publish_verified_handoff(root, handoff, reserved_admission_lock=None):
        handoff_calls['publish'] = (root, handoff, reserved_admission_lock)

with patch.object(host, 'load_durable_handoff', return_value=HandoffStub):
    host.publish_p36_verified_intake_handoff(
        '/installed-p35',
        {
            'keyring': {'authority': {'issuer': 'owner', 'key_id': 'key', 'attestation_hash': 'a' * 64}},
            'durable_handoff_root': '/root-only/p36-handoff',
        },
        {'binding_hash': 'b' * 64},
        v2_session,
        {
            'ticket_hash': 'c' * 64,
            'descriptor_binding_hash': 'd' * 64,
            'workspace_root_hash': 'e' * 64,
            'immutable_base': 'f' * 40,
        },
        {
            'receipt_hash': '1' * 64,
            'output': {
                'intake_protocol_version': 2,
                'effect_authority': 'none',
                'receipt': {'plan_hash': '2' * 64},
                'bridge_receipt': {'receipt': 'bridge'},
            },
        },
    )
assert handoff_calls['create']['ticket_hash'] == 'c' * 64
assert handoff_calls['create']['bridge_plan_hash'] == '2' * 64
assert handoff_calls['publish'] == ('/root-only/p36-handoff', {'handoff_id': 'root-only-handoff'}, None)
try:
    host.normalize_session({
        'schema_version': 1,
        'status': 'open',
        'session_id': 'p35-v1-explicit',
        'session_challenge_hash': 'e' * 64,
        'install_binding_hash': 'b' * 64,
        'expires_at_ms': 12,
        'intake_protocol_version': 1,
    }, config)
    raise AssertionError('v1 session with a v2 discriminator field was accepted')
except host.HostError:
    pass
try:
    host.normalize_session({**session, 'status': 'complete'}, config)
    raise AssertionError('completed session was accepted for submit')
except host.HostError:
    pass


def v2_preflight_request(bridge_input, protected_claims):
    protected_payload = base64.urlsafe_b64encode(
        host.canonical(protected_claims).encode('utf-8')
    ).decode('ascii').rstrip('=')
    signature = base64.urlsafe_b64encode(b'v2-preflight-signature').decode('ascii').rstrip('=')
    return host.canonical({
        'protocol_version': 2,
        'session_id': 'p35-v2-preflight',
        'bridge_input': bridge_input,
        'envelope': {
            'schema_version': 2,
            'protected_payload': protected_payload,
            'signature': signature,
        },
    }).encode('utf-8')


valid_v2_preflight_request = v2_preflight_request(
    {
        'schema_version': 2,
        'workspaceBinding': {'workspaceRootHash': 'a' * 64},
        'prompt': 'opaque task input',
    },
    {'schema_version': 2, 'binding': {'workspace_root_hash': 'a' * 64}},
)
assert host.preflight_v2_request_before_worker_handoff(valid_v2_preflight_request) is None
raw_v2_workspace_request = v2_preflight_request(
    {'schema_version': 2, 'workspaceRoot': '/root/registered-workspace'},
    {'schema_version': 2, 'binding': {}},
)
try:
    host.preflight_v2_request_before_worker_handoff(raw_v2_workspace_request)
    raise AssertionError('v2 root preflight accepted a raw bridge workspace path')
except host.HostError:
    pass
try:
    host.preflight_v2_request_before_worker_handoff(v2_preflight_request(
        {'schema_version': 2, 'workspaceBinding': {'workspaceRoot': '/root/registered-workspace'}},
        {'schema_version': 2, 'binding': {}},
    ))
    raise AssertionError('v2 root preflight accepted a nested raw bridge workspace path')
except host.HostError:
    pass
try:
    host.preflight_v2_request_before_worker_handoff(v2_preflight_request(
        {'schema_version': 2, 'workspaceBinding': {'workspaceRootHash': 'a' * 64}},
        {'schema_version': 2, 'binding': {'workspace_root': '/root/registered-workspace'}},
    ))
    raise AssertionError('v2 root preflight accepted a raw signed workspace path')
except host.HostError:
    pass
top_level_raw_v2_request = json.loads(valid_v2_preflight_request.decode('utf-8'))
top_level_raw_v2_request['workspaceRoot'] = '/root/registered-workspace'
try:
    host.preflight_v2_request_before_worker_handoff(
        host.canonical(top_level_raw_v2_request).encode('utf-8')
    )
    raise AssertionError('v2 root preflight accepted a top-level raw workspace path')
except host.HostError:
    pass
bad_envelope_v2_request = json.loads(valid_v2_preflight_request.decode('utf-8'))
bad_envelope_v2_request['envelope']['schema_version'] = 1
try:
    host.preflight_v2_request_before_worker_handoff(
        host.canonical(bad_envelope_v2_request).encode('utf-8')
    )
    raise AssertionError('v2 root preflight accepted a v1 envelope')
except host.HostError:
    pass
bad_payload_v2_request = json.loads(valid_v2_preflight_request.decode('utf-8'))
bad_payload_v2_request['envelope']['protected_payload'] = 'not!base64'
try:
    host.preflight_v2_request_before_worker_handoff(
        host.canonical(bad_payload_v2_request).encode('utf-8')
    )
    raise AssertionError('v2 root preflight accepted a malformed protected payload')
except host.HostError:
    pass

with tempfile.TemporaryDirectory(prefix='p35-v2-preflight-', dir='/tmp') as temporary:
    original_p34 = host.P34
    original_installed_root = host.installed_root_from_self
    original_load_config = host.load_installed_config
    original_validate_config = host.validate_installed_config
    original_acquire_lease = host.acquire_global_submit_lease
    original_release_lease = host.release_root_lease
    original_session_paths = host.session_paths
    original_require_session_layout = host.require_session_layout
    original_read_root_private_json = host.read_root_private_json
    original_normalize_session = host.normalize_session
    original_create_submit_claim = host.create_submit_claim
    original_write_atomic_root_json = host.write_atomic_root_json
    original_read_bounded_stdin = host.read_bounded_stdin
    original_cleanup_session_paths = host.cleanup_session_paths
    original_launch_unit = host.launch_unit
    original_deliver_request = host.deliver_request_to_exact_worker
    original_load_durable_handoff = host.load_durable_handoff
    launches = []
    handoffs = []
    admission_events = []
    claim_events = []
    fake_paths = {
        'binding': os.path.join(temporary, 'no-binding'),
        'session': os.path.join(temporary, 'session.json'),
        'root': os.path.join(temporary, 'session-root'),
    }
    future = int(time.time() * 1000) + 60000
    fake_session = {
        'schema_version': 1,
        'status': 'open',
        'session_id': 'p35-v2-preflight',
        'session_challenge_hash': 'c' * 64,
        'install_binding_hash': 'b' * 64,
        'expires_at_ms': future,
        'intake_protocol_version': 2,
    }

    class PreflightP34:
        class LauncherError(Exception):
            pass

        @staticmethod
        def require_root():
            return None

        @staticmethod
        def require_supported_host():
            return None

        @staticmethod
        def create_tracked_resource(resources, key, action):
            action(lambda: resources.__setitem__(key, True))

    host.P34 = PreflightP34
    host.installed_root_from_self = lambda: '/test-install'
    host.load_installed_config = lambda _root: {'binding_hash': 'b' * 64}
    host.validate_installed_config = lambda _root, _config: {
        'worker': {'uid': 991, 'gid': 991},
        'verifier': {'uid': 992, 'gid': 992},
        'shadow_witness': {'uid': 993, 'gid': 993},
        'paths': {},
        'durable_handoff_root': '/root-only/p36-handoff',
    }
    host.acquire_global_submit_lease = lambda: object()
    host.release_root_lease = lambda _lease: None
    host.session_paths = lambda _session_id: fake_paths
    host.require_session_layout = lambda _paths, _worker, _verifier: None
    host.read_root_private_json = lambda _path, _label: dict(fake_session)
    host.normalize_session = lambda value, _config: dict(value)
    host.create_submit_claim = lambda _paths, _session_id, on_created: claim_events.append('claim') or on_created()
    host.write_atomic_root_json = lambda *_args, **_kwargs: None
    host.read_bounded_stdin = lambda _timeout: raw_v2_workspace_request
    host.cleanup_session_paths = lambda *_args, **_kwargs: []
    host.launch_unit = lambda *args: launches.append(args)
    host.deliver_request_to_exact_worker = lambda *args: handoffs.append(args)

    class CapacityFullHandoff:
        class DurableHandoffError(Exception):
            pass

        @staticmethod
        def reserve_handoff_publication_slot(_root):
            admission_events.append('capacity')
            raise CapacityFullHandoff.DurableHandoffError('DURABLE_HANDOFF_CAPACITY_EXHAUSTED')

    class ReservedHandoff:
        class DurableHandoffError(Exception):
            pass

        @staticmethod
        def reserve_handoff_publication_slot(_root):
            admission_events.append('reserve')
            return 'reserved-mailbox-lock'

        @staticmethod
        def release_handoff_admission_lock(lock):
            assert lock == 'reserved-mailbox-lock'
            admission_events.append('release')

    try:
        host.load_durable_handoff = lambda _root: CapacityFullHandoff
        try:
            host.submit_session('p35-v2-preflight')
            raise AssertionError('full durable mailbox allowed P3.5 submit claim')
        except host.HostError as error:
            assert 'DURABLE_HANDOFF_CAPACITY_EXHAUSTED' in str(error)
        assert claim_events == [], 'mailbox admission consumed a P3.5 session before capacity was reserved'

        host.load_durable_handoff = lambda _root: ReservedHandoff
        try:
            host.submit_session('p35-v2-preflight')
            raise AssertionError('v2 raw workspace request reached submit completion')
        except host.HostError as error:
            assert 'raw workspace path field' in str(error)
        assert launches == [], 'v2 root preflight launched a worker before rejecting the raw path'
        assert handoffs == [], 'v2 root preflight handed bytes to a worker before rejecting the raw path'
        assert admission_events == ['capacity', 'reserve', 'release']
        assert claim_events == ['claim'], 'reserved P3.6 capacity must precede the one-shot P3.5 submit claim'
    finally:
        host.P34 = original_p34
        host.installed_root_from_self = original_installed_root
        host.load_installed_config = original_load_config
        host.validate_installed_config = original_validate_config
        host.acquire_global_submit_lease = original_acquire_lease
        host.release_root_lease = original_release_lease
        host.session_paths = original_session_paths
        host.require_session_layout = original_require_session_layout
        host.read_root_private_json = original_read_root_private_json
        host.normalize_session = original_normalize_session
        host.create_submit_claim = original_create_submit_claim
        host.write_atomic_root_json = original_write_atomic_root_json
        host.read_bounded_stdin = original_read_bounded_stdin
        host.cleanup_session_paths = original_cleanup_session_paths
        host.launch_unit = original_launch_unit
        host.deliver_request_to_exact_worker = original_deliver_request
        host.load_durable_handoff = original_load_durable_handoff

reapable_v2_session = host.normalize_reapable_session({
    'schema_version': 1,
    'status': 'open',
    'session_id': 'p35d-reap',
    'session_challenge_hash': 'f' * 64,
    'install_binding_hash': 'b' * 64,
    'expires_at_ms': 1,
    'intake_protocol_version': 2,
}, 'p35d-reap')
assert reapable_v2_session['intake_protocol_version'] == 2
with tempfile.TemporaryDirectory(prefix='p35-reap-v2-', dir='/tmp') as temporary:
    stale_session_id = 'p35-' + 'a' * 32
    stale_root = os.path.join(temporary, stale_session_id)
    os.mkdir(stale_root, 0o700)
    original_runtime_parent = host.RUNTIME_PARENT
    original_ensure_runtime_parent = host.ensure_runtime_parent
    original_reapable_layout = host.require_reapable_session_layout
    original_read_root_private_json = host.read_root_private_json
    original_read_submit_claim = host.read_submit_claim
    original_cleanup_session_paths = host.cleanup_session_paths
    host.RUNTIME_PARENT = temporary
    host.ensure_runtime_parent = lambda: None
    host.require_reapable_session_layout = lambda _paths, _worker, _verifier: {
        'legacy_request_gid': None,
        'worker': {'uid': 991, 'gid': 991},
    }
    host.read_root_private_json = lambda _path, _label: {
        'schema_version': 1,
        'status': 'open',
        'session_id': stale_session_id,
        'session_challenge_hash': 'f' * 64,
        'install_binding_hash': 'b' * 64,
        'expires_at_ms': 1,
        'intake_protocol_version': 2,
    }
    host.read_submit_claim = lambda _paths, _session_id: None

    def cleanup_stale_v2(paths, **_kwargs):
        assert paths['root'] == stale_root
        os.rmdir(stale_root)
        return []

    host.cleanup_session_paths = cleanup_stale_v2
    try:
        host.reap_expired_sessions({
            'worker': {'uid': 991, 'gid': 991},
            'verifier': {'uid': 992, 'gid': 992},
        })
        assert not os.path.exists(stale_root)
    finally:
        host.RUNTIME_PARENT = original_runtime_parent
        host.ensure_runtime_parent = original_ensure_runtime_parent
        host.require_reapable_session_layout = original_reapable_layout
        host.read_root_private_json = original_read_root_private_json
        host.read_submit_claim = original_read_submit_claim
        host.cleanup_session_paths = original_cleanup_session_paths

read_fd, write_fd = os.pipe()
try:
    started = time.monotonic()
    try:
        host.read_bounded_stdin(0.025, read_fd)
        raise AssertionError('trickled stdin was accepted without EOF')
    except host.HostError as error:
        assert 'timed out' in str(error)
    assert time.monotonic() - started < 1
finally:
    os.close(read_fd)
    os.close(write_fd)


class HandoffP34:
    class LauncherError(Exception):
        pass

    expected_pid = None

    @classmethod
    def cgroup_v2_matches(cls, pid, _expected_path):
        return pid == cls.expected_pid

    @staticmethod
    def cleanup_path(path, expected_type):
        if expected_type != 'socket':
            raise AssertionError('handoff cleanup requested an unexpected type')
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def receive_bytes(connection, size):
    blocks = []
    remaining = size
    while remaining:
        block = connection.recv(remaining)
        if not block:
            raise AssertionError('socket peer ended before the expected bytes')
        blocks.append(block)
        remaining -= len(block)
    return b''.join(blocks)


if not hasattr(os, 'fork') or not hasattr(socket, 'SO_PEERCRED'):
    raise AssertionError('P3.5 handoff fixture requires Linux fork and SO_PEERCRED')
with tempfile.TemporaryDirectory(prefix='p35-', dir='/tmp') as temporary:
    handoff_path = os.path.join(temporary, 'handoff.sock')
    correct_go_read, correct_go_write = os.pipe()
    payload_read, payload_write = os.pipe()
    correct_pid = os.fork()
    if correct_pid == 0:
        os.close(correct_go_write)
        os.close(payload_read)
        try:
            if os.read(correct_go_read, 1) != b'x':
                os._exit(20)
            connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                connection.settimeout(2)
                connection.connect(handoff_path)
                size = struct.unpack('!I', receive_bytes(connection, 4))[0]
                os.write(payload_write, receive_bytes(connection, size))
            finally:
                connection.close()
            os._exit(0)
        except BaseException:
            os._exit(21)
    os.close(correct_go_read)
    os.close(payload_write)
    result_read, result_write = os.pipe()
    handoff_pid = os.fork()
    if handoff_pid == 0:
        os.close(result_read)
        HandoffP34.expected_pid = correct_pid
        host.P34 = HandoffP34
        try:
            host.deliver_request_to_exact_worker(
                handoff_path,
                {'uid': os.getuid(), 'gid': os.getgid()},
                correct_pid,
                '/test/exact-worker.service',
                b'opaque-root-request',
            )
            os.write(result_write, b'ok')
            os._exit(0)
        except BaseException as error:
            os.write(result_write, str(error).encode('utf-8', 'replace'))
            os._exit(22)
    os.close(result_write)
    deadline = time.monotonic() + 2
    wrong_peer = None
    while time.monotonic() < deadline:
        if not os.path.lexists(handoff_path):
            time.sleep(0.01)
            continue
        socket_info = os.lstat(handoff_path)
        assert stat.S_ISSOCK(socket_info.st_mode)
        assert socket_info.st_uid == os.getuid()
        assert socket_info.st_gid == os.getgid()
        assert (socket_info.st_mode & 0o777) == 0o600
        candidate = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        candidate.settimeout(0.1)
        try:
            candidate.connect(handoff_path)
            wrong_peer = candidate
            break
        except (ConnectionRefusedError, FileNotFoundError):
            candidate.close()
            time.sleep(0.01)
    if wrong_peer is None:
        ready, _, _ = select.select([result_read], [], [], 0)
        detail = os.read(result_read, 256).decode('utf-8', 'replace') if ready else 'no host result'
        raise AssertionError('root handoff listener did not become connectable: ' + detail)
    wrong_peer.settimeout(1)
    assert wrong_peer.recv(1) == b''
    wrong_peer.close()
    os.write(correct_go_write, b'x')
    os.close(correct_go_write)
    ready, _, _ = select.select([payload_read], [], [], 2)
    assert ready, 'exact worker did not receive the handoff payload'
    assert os.read(payload_read, 128) == b'opaque-root-request'
    os.close(payload_read)
    ready, _, _ = select.select([result_read], [], [], 2)
    assert ready, 'root handoff did not finish after the exact worker connected'
    assert os.read(result_read, 128) == b'ok'
    os.close(result_read)
    _, correct_status = os.waitpid(correct_pid, 0)
    _, handoff_status = os.waitpid(handoff_pid, 0)
    assert os.WIFEXITED(correct_status) and os.WEXITSTATUS(correct_status) == 0
    assert os.WIFEXITED(handoff_status) and os.WEXITSTATUS(handoff_status) == 0
    assert not os.path.lexists(handoff_path)


def expect_gateway_rejection(socket_path):
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        connection.settimeout(2)
        connection.connect(socket_path)
        try:
            connection.sendall(struct.pack('!I', 2) + b'{}')
            connection.shutdown(socket.SHUT_WR)
        except OSError as error:
            if error.errno in {errno.EPIPE, errno.ECONNRESET, errno.ENOTCONN}:
                return b''
            raise
        try:
            return connection.recv(1)
        except ConnectionResetError:
            return b''
    finally:
        connection.close()


with tempfile.TemporaryDirectory(prefix='p35-gw-', dir='/tmp') as temporary:
    socket_root = os.path.join(temporary, 'socket')
    gateway_root = os.path.join(temporary, 'gateway')
    socket_path = os.path.join(socket_root, 'intake.sock')
    ready_path = os.path.join(gateway_root, 'ready.json')
    result_path = os.path.join(gateway_root, 'result.json')
    replay_lock_path = os.path.join(gateway_root, 'replay.lock')
    allow_cgroup_path = os.path.join(temporary, 'allow-cgroup')
    os.mkdir(socket_root, 0o2710)
    os.chmod(socket_root, 0o2710)
    os.mkdir(gateway_root, 0o700)
    output_value = {
        'schema_version': 1,
        'status': 'verified_intake',
        'owner_kernel_authority': 'none',
        'acceptance': 'not_available',
        'receipt': {},
        'bridge_receipt': {},
    }
    expected_gateway_output = (gateway.canonical(output_value) + '\n').encode('utf-8')
    correct_go_read, correct_go_write = os.pipe()
    cgroup_done_read, cgroup_done_write = os.pipe()
    response_read, response_write = os.pipe()
    verifier_called_read, verifier_called_write = os.pipe()
    correct_pid = os.fork()
    if correct_pid == 0:
        os.close(correct_go_write)
        os.close(cgroup_done_read)
        os.close(response_read)
        os.close(verifier_called_read)
        try:
            if os.read(correct_go_read, 1) != b'x':
                os._exit(40)
            if expect_gateway_rejection(socket_path) != b'':
                os._exit(41)
            os.write(cgroup_done_write, b'ok')
            if os.read(correct_go_read, 1) != b'y':
                os._exit(42)
            connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                connection.settimeout(2)
                connection.connect(socket_path)
                connection.sendall(struct.pack('!I', 2) + b'{}')
                connection.shutdown(socket.SHUT_WR)
                size = struct.unpack('!I', receive_bytes(connection, 4))[0]
                if receive_bytes(connection, size) != expected_gateway_output:
                    os._exit(43)
            finally:
                connection.close()
            os.write(response_write, b'ok')
            os._exit(0)
        except BaseException:
            os._exit(44)
    os.close(correct_go_read)
    os.close(cgroup_done_write)
    os.close(response_write)
    gateway_pid = os.fork()
    if gateway_pid == 0:
        os.close(cgroup_done_read)
        os.close(response_read)
        os.close(verifier_called_read)
        # The regular fixture runs under the developer's account, which can
        # legitimately have extra groups. The production identity check is
        # covered separately; this process isolates the peer-gate behavior.
        gateway.require_exact_identity = lambda _uid, _gid: None
        gateway.cgroup_v2_matches = lambda pid, _path: (
            pid == correct_pid and os.path.exists(allow_cgroup_path)
        )

        def fake_node_verifier(_args, _payload):
            os.write(verifier_called_write, b'v')
            return expected_gateway_output, output_value

        gateway.run_node_verifier = fake_node_verifier
        arguments = types.SimpleNamespace(
            verifier_uid=os.geteuid(),
            verifier_gid=os.getegid(),
            socket_root=socket_root,
            socket_gid=os.getegid(),
            gateway_state_root=gateway_root,
            socket_path=socket_path,
            ready_path=ready_path,
            result_path=result_path,
            replay_lock_path=replay_lock_path,
            expected_worker_pid=correct_pid,
            expected_worker_uid=os.geteuid(),
            expected_worker_gid=os.getegid(),
            expected_cgroup_path='/test/exact-worker.service',
            timeout_seconds=3,
        )
        try:
            os._exit(0 if gateway.serve(arguments) == 0 else 45)
        except BaseException:
            os._exit(46)
    os.close(verifier_called_write)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline and not os.path.exists(ready_path):
        time.sleep(0.01)
    assert os.path.exists(ready_path), 'gateway did not publish readiness'
    assert expect_gateway_rejection(socket_path) == b''
    ready, _, _ = select.select([verifier_called_read], [], [], 0.1)
    assert not ready, 'gateway parsed a wrong-PID peer frame'
    os.write(correct_go_write, b'x')
    ready, _, _ = select.select([cgroup_done_read], [], [], 2)
    assert ready and os.read(cgroup_done_read, 2) == b'ok'
    ready, _, _ = select.select([verifier_called_read], [], [], 0.1)
    assert not ready, 'gateway parsed a wrong-cgroup peer frame'
    with open(allow_cgroup_path, 'w', encoding='utf-8') as target:
        target.write('allow')
    os.write(correct_go_write, b'y')
    os.close(correct_go_write)
    ready, _, _ = select.select([response_read], [], [], 2)
    assert ready and os.read(response_read, 2) == b'ok'
    ready, _, _ = select.select([verifier_called_read], [], [], 2)
    assert ready and os.read(verifier_called_read, 1) == b'v'
    os.close(cgroup_done_read)
    os.close(response_read)
    os.close(verifier_called_read)
    _, correct_status = os.waitpid(correct_pid, 0)
    _, gateway_status = os.waitpid(gateway_pid, 0)
    assert os.WIFEXITED(correct_status) and os.WEXITSTATUS(correct_status) == 0
    assert os.WIFEXITED(gateway_status) and os.WEXITSTATUS(gateway_status) == 0
    with open(result_path, 'r', encoding='utf-8') as source:
        assert json.load(source)['status'] == 'verified_intake'


with tempfile.TemporaryDirectory() as temporary:
    rollback_root = os.path.join(temporary, 'partial-install')

    class RollbackP34:
        class LauncherError(Exception):
            pass

        @staticmethod
        def require_root():
            return None

        @staticmethod
        def ensure_root_directory_chain(_path):
            return None

        @staticmethod
        def create_directory(path, _uid, _gid, _mode, _label, on_created=None):
            if (
                os.path.dirname(path) == temporary
                and os.path.basename(path).startswith('.partial-install.pending-')
            ):
                os.mkdir(path)
                if on_created is not None:
                    on_created()
                return None
            raise RollbackP34.LauncherError('forced install child-directory failure')

        @staticmethod
        def cleanup_path(path, expected_type):
            if not os.path.lexists(path):
                return None
            if expected_type == 'dir':
                os.rmdir(path)
            else:
                os.unlink(path)
            return None

    original_p34 = host.P34
    original_private_account = host.require_private_service_account
    original_distinct_legacy = host.require_distinct_legacy_p34_worker_identity
    original_state_root = host.ensure_state_root
    original_keyring_source = host.read_keyring_source
    original_node_source = host.resolve_node_install_source
    host.P34 = RollbackP34
    host.require_private_service_account = lambda identity, _create: {
        'identity': identity,
        'uid': {
            host.WORKER_IDENTITY: 991,
            host.VERIFIER_IDENTITY: 992,
            host.SHADOW_WITNESS_IDENTITY: 993,
        }[identity],
        'gid': {
            host.WORKER_IDENTITY: 991,
            host.VERIFIER_IDENTITY: 992,
            host.SHADOW_WITNESS_IDENTITY: 993,
        }[identity],
    }
    host.require_distinct_legacy_p34_worker_identity = lambda _worker: None
    host.ensure_state_root = lambda path, _verifier, create=False: path
    original_registry_root = host.ensure_root_private_state_root
    original_witness_root = host.ensure_witness_state_root
    host.ensure_root_private_state_root = lambda path, _label, create=False: path
    host.ensure_witness_state_root = lambda path, _witness, create=False: path
    host.read_keyring_source = lambda _path: (b'{}', {'sha256': 'a' * 64})
    host.resolve_node_install_source = lambda _path: '/fake/node'
    try:
        try:
            host.install(types.SimpleNamespace(
                install_root=rollback_root,
                state_root=os.path.join(temporary, 'state'),
                workspace_registry_root=os.path.join(temporary, 'registry'),
                witness_state_root=os.path.join(temporary, 'witness'),
                keyring=os.path.join(temporary, 'keyring'),
                node_path='/fake/node',
                create_worker=False,
                create_verifier=False,
                create_shadow_witness=False,
            ))
            raise AssertionError('install accepted a forced child-directory failure')
        except RollbackP34.LauncherError as error:
            assert 'forced install child-directory failure' in str(error)
        assert not os.path.lexists(rollback_root)
        assert not any(
            entry.name.startswith('.partial-install.pending-')
            for entry in os.scandir(temporary)
        )
    finally:
        host.P34 = original_p34
        host.require_private_service_account = original_private_account
        host.require_distinct_legacy_p34_worker_identity = original_distinct_legacy
        host.ensure_state_root = original_state_root
        host.ensure_root_private_state_root = original_registry_root
        host.ensure_witness_state_root = original_witness_root
        host.read_keyring_source = original_keyring_source
        host.resolve_node_install_source = original_node_source

gateway_source = inspect.getsource(gateway.serve)
assert gateway_source.index('peer_credentials(candidate)') < gateway_source.index('read_single_frame(connection')
assert 'while connection is None' in gateway_source
assert 'candidate.close()' in gateway_source
assert 'fcntl.flock' in gateway_source
assert host.FILE_LAYOUT['shadow_engine_consumer'] == 'lib/supervised-shadow-engine-consumer.js'
assert host.installation_sources()['shadow_engine_consumer'].endswith('supervised-shadow-engine-consumer.js')
assert host.FILE_LAYOUT['workspace_registry'] == 'lib/supervised-workspace-registry.py'
assert host.FILE_LAYOUT['shadow_witness'] == 'lib/supervised-shadow-witness.py'
assert host.FILE_LAYOUT['shadow_witness_client'] == 'lib/supervised-shadow-witness-client.py'
assert host.installation_sources()['workspace_registry'].endswith('supervised-workspace-registry.py')
shadow_summary = {
    'schema_version': 1,
    'status': 'shadow_intake_recorded',
    'intake_id': 'a' * 64,
    'record_hash': 'b' * 64,
    'idempotent': False,
    'disclosure': {
        'engine': {'status': 'not_started', 'dispatch_authority': 'not_available'},
        'owner_kernel_authority': 'none',
        'legacy_execution_authority': 'unchanged',
        'effect_authority': 'none',
        'broker_authority': 'not_available',
        'witness_assurance': 'local_verifier_state_not_independent_witness',
        'acceptance': 'not_available',
        'alias_retirement_eligible': False,
    },
}
assert host.validate_shadow_summary(shadow_summary, 'test shadow summary') == shadow_summary
assert gateway.validate_shadow_summary(shadow_summary, 'test shadow summary') == shadow_summary
v2_verifier_output = {
    'schema_version': 1,
    'status': 'verified_intake',
    'owner_kernel_authority': 'none',
    'acceptance': 'not_available',
    'receipt': {},
    'bridge_receipt': {},
    'shadow': shadow_summary,
    'intake_protocol_version': 2,
    'effect_authority': 'none',
}
assert gateway.parse_verifier_output(
    (gateway.canonical(v2_verifier_output) + '\n').encode('utf-8'),
    intake_protocol_version=2,
) == v2_verifier_output
try:
    gateway.parse_verifier_output(
        (gateway.canonical(v2_verifier_output) + '\n').encode('utf-8')
    )
    raise AssertionError('v1 gateway parser accepted a v2 verifier output')
except gateway.GatewayError:
    pass
try:
    host.validate_shadow_summary(
        {**shadow_summary, 'disclosure': {**shadow_summary['disclosure'], 'effect_authority': 'available'}},
        'invalid shadow summary',
    )
    raise AssertionError('host accepted an authoritative shadow summary')
except host.HostError:
    pass
try:
    gateway.validate_shadow_summary(
        {**shadow_summary, 'disclosure': {**shadow_summary['disclosure'], 'acceptance': 'accepted'}},
        'invalid shadow summary',
    )
    raise AssertionError('gateway accepted an accepting shadow summary')
except gateway.GatewayError:
    pass
ticket_material = {
    'schema_version': 1,
    'kind': 'p35_workspace_descriptor_ticket',
    'install_binding_hash': 'b' * 64,
    'registry_instance_id': 'p35-registry-fixture',
    'registration_id': 'project-main',
    'workspace_root_hash': 'c' * 64,
    'immutable_base': 'd' * 40,
    'descriptor_fingerprint_hash': 'e' * 64,
    'descriptor_binding_hash': 'f' * 64,
    'session_id': 'p35-session',
    'session_challenge_hash': 'c' * 64,
    'expires_at_ms': 10,
}
workspace_ticket = {**ticket_material, 'ticket_hash': host.sha256_value(ticket_material)}
normalized_ticket = host.normalize_workspace_ticket(
    workspace_ticket,
    config,
    session_id='p35-session',
    session_challenge_hash='c' * 64,
)
assert normalized_ticket['descriptor_binding_hash'] == 'f' * 64
try:
    host.normalize_workspace_ticket(
        {**workspace_ticket, 'workspace_root_hash': '0' * 64},
        config,
        session_id='p35-session',
        session_challenge_hash='c' * 64,
    )
    raise AssertionError('workspace ticket hash mismatch was accepted')
except host.HostError:
    pass
shadow_witness_summary = {
    'schema_version': 1,
    'status': 'shadow_witness_recorded',
    'shadow_admission_id': '1' * 64,
    'ticket_hash': normalized_ticket['ticket_hash'],
    'capsule_hash': '2' * 64,
    'observation_hash': '3' * 64,
    'close_hash': '4' * 64,
    'previous_shadow_head': '5' * 64,
    'shadow_chain_head': '6' * 64,
    'idempotent': False,
    'disclosure': {
        'engine': {'status': 'not_started', 'dispatch_authority': 'not_available'},
        'owner_kernel_authority': 'none',
        'effect_authority': 'none',
        'acceptance': 'not_available',
        'witness_assurance': 'separate_uid_local_append_only_root_readback_not_p2',
        'workspace_assurance': 'root_held_descriptor_matches_signed_v1_path_and_base_only',
        'content_immutability': 'not_available',
    },
}
assert host.validate_shadow_witness_summary(
    shadow_witness_summary, normalized_ticket, 'test shadow witness summary'
) == shadow_witness_summary
try:
    host.validate_shadow_witness_summary(
        {**shadow_witness_summary, 'disclosure': {**shadow_witness_summary['disclosure'], 'acceptance': 'accepted'}},
        normalized_ticket,
        'invalid shadow witness summary',
    )
    raise AssertionError('host accepted an authoritative shadow witness summary')
except host.HostError:
    pass
v2_shadow_witness_summary = {
    **shadow_witness_summary,
    'disclosure': {
        **shadow_witness_summary['disclosure'],
        'workspace_assurance': 'root_held_descriptor_matches_signed_v2_ticket_and_base',
    },
}
assert host.validate_shadow_witness_summary(
    v2_shadow_witness_summary,
    normalized_ticket,
    'v2 shadow witness summary',
    intake_protocol_version=2,
) == v2_shadow_witness_summary
try:
    host.validate_shadow_witness_summary(
        shadow_witness_summary,
        normalized_ticket,
        'v1 shadow witness summary in v2 session',
        intake_protocol_version=2,
    )
    raise AssertionError('v2 session accepted a v1 workspace-assurance disclosure')
except host.HostError:
    pass

class MismatchedRootReadbackClient:
    class ShadowWitnessClientError(Exception):
        pass

    @staticmethod
    def invoke(**kwargs):
        assert kwargs['method'] == 'read_shadow_record'
        assert kwargs['request'] == {
            'shadow_admission_id': shadow_witness_summary['shadow_admission_id'],
            'ticket_hash': normalized_ticket['ticket_hash'],
        }
        return {
            'status': 'shadow_closed',
            'idempotent': True,
            'shadow_admission_id': shadow_witness_summary['shadow_admission_id'],
            'ticket_hash': shadow_witness_summary['ticket_hash'],
            'capsule_hash': shadow_witness_summary['capsule_hash'],
            'observation_hash': shadow_witness_summary['observation_hash'],
            'close_hash': shadow_witness_summary['close_hash'],
            'previous_shadow_head': shadow_witness_summary['previous_shadow_head'],
            'shadow_chain_head': '0' * 64,
        }

original_witness_client_loader = host.load_shadow_witness_client
host.load_shadow_witness_client = lambda _install_root: MismatchedRootReadbackClient
try:
    try:
        host.verify_shadow_witness_root_readback(
            '/test-install',
            {'witness': '/test-witness-root', 'witness_socket_path': '/test-witness.sock'},
            {'witness_pid': 100, 'witness_uid': 101, 'witness_gid': 102, 'socket_gid': 103},
            normalized_ticket,
            shadow_witness_summary,
        )
        raise AssertionError('host accepted a mismatched root witness readback')
    except host.HostError as error:
        assert 'does not match' in str(error)
finally:
    host.load_shadow_witness_client = original_witness_client_loader

submit_source = inspect.getsource(host.submit_session)
assert 'json.loads' not in submit_source
assert 'read_bounded_stdin(' in submit_source
assert submit_source.index('preflight_v2_request_before_worker_handoff(request)') < submit_source.index('worker_command = [')
assert submit_source.index('preflight_v2_request_before_worker_handoff(request)') < submit_source.index('launch_unit(system_paths, worker_unit')
assert submit_source.index('preflight_v2_request_before_worker_handoff(request)') < submit_source.index('deliver_request_to_exact_worker(')
assert 'create_submit_claim' in submit_source
assert submit_source.index('acquire_global_submit_lease') < submit_source.index('require_session_layout(paths, worker, verifier)')
assert submit_source.index('reserve_handoff_publication_slot') < submit_source.index('create_submit_claim')
assert submit_source.index('create_submit_claim') < submit_source.index('write_atomic_root_json(paths["session"]')
assert submit_source.index('result = wait_for_private_json(') < submit_source.rindex('block_completion_signals()')
assert submit_source.rindex('block_completion_signals()') < submit_source.index('checked = validate_gateway_result(')
assert submit_source.index('worker_pid = P34.wait_for_main_pid') < submit_source.index('deliver_request_to_exact_worker(')
assert submit_source.index('deliver_request_to_exact_worker(') < submit_source.index('create_release(paths["release"]')
assert submit_source.index('validate_gateway_ready(ready, verifier_pid, verifier, worker)') < submit_source.index('seal_gateway_socket_for_worker(paths["socket"], paths["socket_path"], worker, verifier)')
assert submit_source.index('seal_gateway_socket_for_worker(paths["socket"], paths["socket_path"], worker, verifier)') < submit_source.index('create_release(paths["release"]')
assert '--session-expires-at-ms' in submit_source
assert 'P3.5 session is no longer available' in inspect.getsource(host.create_submit_claim)
assert 'os.link(temporary, path, follow_symlinks=False)' in inspect.getsource(host.write_atomic_root_json)
assert 'os.O_NOFOLLOW | os.O_NONBLOCK' in inspect.getsource(host.read_exact_private_json)
assert submit_source.index('if cleanup_errors:') < submit_source.index('publish_p36_verified_intake_handoff(')
assert submit_source.index('publish_p36_verified_intake_handoff(') < submit_source.rindex('release_reserved_durable_handoff_admission()')
worker_source = inspect.getsource(worker.connect_and_submit)
assert 'SO_PEERCRED' in worker_source
assert 'peer_pid != server_pid' in worker_source
assert 'socket_info.st_uid != args.expected_worker_uid' in worker_source
assert '(socket_info.st_mode & 0o777) != 0o600' in worker_source
assert 'parse_canonical_json(request' not in inspect.getsource(worker.run)
handoff_source = inspect.getsource(host.deliver_request_to_exact_worker)
gateway_restriction_source = inspect.getsource(host.seal_gateway_socket_for_worker)
worker_handoff_source = inspect.getsource(worker.receive_handoff_request)
release_source = inspect.getsource(host.create_release)
worker_run_source = inspect.getsource(worker.run)
assert 'P34.cgroup_v2_matches(pid, worker_cgroup)' in handoff_source
assert 'candidate.sendall' in handoff_source
assert 'bound_path = temporary' in handoff_source
assert handoff_source.index('listener.listen(16)') < handoff_source.index('os.rename(temporary, path)')
assert 'os.chown(temporary, worker["uid"], worker["gid"])' in handoff_source
assert 'os.chmod(temporary, 0o600)' in handoff_source
assert 'os.open(socket_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)' in gateway_restriction_source
assert 'os.fchown(descriptor, 0, worker["gid"])' in gateway_restriction_source
assert 'os.fchmod(descriptor, 0o710)' in gateway_restriction_source
assert 'initial.st_uid != verifier["uid"]' in gateway_restriction_source
assert 'os.chown(path, worker["uid"], worker["gid"])' in gateway_restriction_source
assert 'os.chmod(path, 0o600)' in gateway_restriction_source
assert 'peer_pid != args.expected_handoff_server_pid' in worker_handoff_source
assert 'peer_uid != 0' in worker_handoff_source
assert 'peer_gid != 0' in worker_handoff_source
assert 'args.handoff_timeout_seconds' in worker_handoff_source
assert 'os.fchown(descriptor, 0, worker["gid"])' in release_source
assert 'os.fchmod(descriptor, 0o440)' in release_source
assert 'args.expected_worker_uid' in worker_run_source
assert 'receive_handoff_request(args)' in worker_run_source
host_source = open(os.path.join(root, 'src', 'engine', 'supervised-intake-host.py'), encoding='utf-8').read()
assert host_source.index('def bootstrap_load_installed_p34_support') < host_source.index('spec.loader.exec_module')
assert host_source.startswith('#!/usr/bin/python3 -I\n')
install_source = inspect.getsource(host.install)
assert install_source.index('validate_installed_config') < install_source.index('emit(')
assert 'require_distinct_legacy_p34_worker_identity(worker)' in install_source
assert install_source.index('try:') < install_source.index('P34.create_directory(\n            staging_root')
assert 'validate_installed_config(staging_root, validation_config)' in install_source
assert 'validation_config["paths"]["node_path"] = staging_node_snapshot' in install_source
assert install_source.index('fsync_snapshot_tree(staging_root)') < install_source.index('os.rename(staging_root, install_root)')
assert 'os.rename(staging_root, install_root)' in install_source
assert 'cleanup_errors = cleanup_install_tree(active_install_root["value"])' in install_source
assert 'return errors' in inspect.getsource(host.cleanup_install_tree)
validate_source = inspect.getsource(host.validate_installed_config)
assert 'require_distinct_legacy_p34_worker_identity(worker)' in validate_source
assert 'require_unprivileged_runtime_ancestors(state_root, "verifier state root")' in inspect.getsource(host.ensure_state_root)
assert 'return acquire_runtime_parent_lease()' in inspect.getsource(host.acquire_global_submit_lease)
assert 'require_legacy_p35a_session_layout' in inspect.getsource(host.require_reapable_session_layout)
assert 'require_sealed_p35a_session_layout' in inspect.getsource(host.require_reapable_session_layout)
assert 'require_partially_sealed_p35a_session_layout' in inspect.getsource(host.require_reapable_session_layout)
assert 'require_reapable_session_layout(paths, validated["worker"], validated["verifier"])' in inspect.getsource(host.reap_expired_sessions)
cleanup_source = inspect.getsource(host.cleanup_session_paths)
assert 'cleanup_legacy_request' in cleanup_source
assert 'cleanup_worker_pending_artifacts' in cleanup_source
assert 'cleanup_gateway_pending_artifacts' in cleanup_source
assert host.has_exact_pending_suffix('release.json.pending-' + 'a' * 32, ('release.json.pending-',))
assert not host.has_exact_pending_suffix('release.json.pending-' + 'a' * 31, ('release.json.pending-',))
assert not host.has_exact_pending_suffix('release.json.pending-' + 'a' * 32 + '.tmp', ('release.json.pending-',))
original_getpwnam = host.pwd.getpwnam


def absent_legacy_getpwnam(identity):
    if identity == host.LEGACY_P34_WORKER_IDENTITY:
        raise KeyError(identity)
    return original_getpwnam(identity)


host.pwd.getpwnam = absent_legacy_getpwnam
try:
    host.require_distinct_legacy_p34_worker_identity({'uid': 991, 'gid': 991})
finally:
    host.pwd.getpwnam = original_getpwnam
service_account_source = inspect.getsource(host.require_private_service_account)
assert 'pwd.getpwall()' not in service_account_source

for filename in (
    'supervised-intake-host.py',
    'supervised-intake-gateway.py',
    'supervised-intake-worker.py',
    'supervised-intake-verifier.js',
    'supervised-authenticated-intake.js',
    'supervised-shadow-engine-consumer.js',
    'supervised-workspace-registry.py',
    'supervised-shadow-witness.py',
    'supervised-shadow-witness-client.py',
):
    source = open(os.path.join(root, 'src', 'engine', filename), encoding='utf-8').read()
    assert 'shell=True' not in source
    assert 'new OwnerKernel' not in source
    assert 'mintActionDecision(' not in source
    assert 'executeAuthorizedAction(' not in source

print('root_install_material_is_hash_bound=true')
print('installer_rejects_node_incompatible_keyring=true')
print('installer_preflights_node_ed25519_support=true')
print('host_config_utf8_matches_node=true')
print('installer_fsyncs_nested_snapshot_directories_before_publish=true')
print('no_runtime_config_or_keyring_override=true')
print('session_challenge_is_hash_only_at_rest=true')
print('expired_v2_session_is_reaped=true')
print('v1_root_submit_keeps_payload_opaque=true')
print('v2_raw_workspace_path_is_rejected_before_worker_handoff=true')
print('root_submit_claims_once_and_bounds_input=true')
print('root_submit_claim_uses_atomic_link=true')
print('root_private_results_are_opened_race_safely=true')
print('gateway_peercred_precedes_frame_parsing=true')
print('gateway_rejects_wrong_pid_and_cgroup_before_parsing=true')
print('gateway_replay_access_is_serialized=true')
print('worker_verifies_exact_gateway_peer=true')
print('root_handoff_rejects_wrong_peer_before_bytes=true')
print('root_handoff_uses_exact_pid_cgroup_socket=true')
print('installer_rejects_untraversable_service_snapshot=true')
print('p35_worker_is_distinct_from_legacy_broker=true')
print('fresh_host_allows_absent_legacy_worker=true')
print('installer_rolls_back_partial_snapshot=true')
print('request_delivery_follows_exact_worker_discovery=true')
print('expired_legacy_p35_session_layout_is_reaped=true')
print('expired_crash_pending_artifacts_are_reaped=true')
print('sealed_gateway_socket_has_no_verifier_path_race=true')
print('systemd_runtime_cap_is_frozen=true')
print('root_submit_lease_is_outside_verifier_state=true')
print('shadow_host_has_no_authority_calls=true')
print('shadow_admission_summary_is_strict_and_non_authoritative=true')
print('workspace_ticket_and_separate_witness_are_hash_bound=true')
print('root_witness_readback_mismatch_is_rejected=true')
print('p36_mailbox_capacity_is_reserved_before_p35_consumption=true')
PY
)"
PY_STATUS=$?

assert_eq "$PY_STATUS" "0" "P3.5 host deterministic fixture exits successfully"
assert_contains "$PY_OUT" "root_install_material_is_hash_bound=true" "root installation material includes fixed hash-bound state"
assert_contains "$PY_OUT" "installer_rejects_node_incompatible_keyring=true" "installer rejects malformed Ed25519 SPKI and impossible key lifetime"
assert_contains "$PY_OUT" "installer_preflights_node_ed25519_support=true" "installer rejects a Node runtime without Ed25519 support"
assert_contains "$PY_OUT" "host_config_utf8_matches_node=true" "host config uses the same UTF-8 canonical form as the Node verifier"
assert_contains "$PY_OUT" "installer_fsyncs_nested_snapshot_directories_before_publish=true" "installer fsyncs nested snapshot directories before publication"
assert_contains "$PY_OUT" "no_runtime_config_or_keyring_override=true" "begin and submit reject alternate trust inputs"
assert_contains "$PY_OUT" "session_challenge_is_hash_only_at_rest=true" "root session state retains only a challenge hash"
assert_contains "$PY_OUT" "expired_v2_session_is_reaped=true" "expired v2 sessions do not wedge later begins"
assert_contains "$PY_OUT" "v1_root_submit_keeps_payload_opaque=true" "v1 root launcher keeps the legacy payload opaque"
assert_contains "$PY_OUT" "v2_raw_workspace_path_is_rejected_before_worker_handoff=true" "v2 root preflight rejects raw workspace fields before any worker handoff"
assert_contains "$PY_OUT" "root_submit_claims_once_and_bounds_input=true" "root submit claims one session and bounds a trickling request"
assert_contains "$PY_OUT" "root_submit_claim_uses_atomic_link=true" "root submit claim publication uses an atomic no-replace link"
assert_contains "$PY_OUT" "root_private_results_are_opened_race_safely=true" "root opens verifier-owned results without a pathname race"
assert_contains "$PY_OUT" "gateway_peercred_precedes_frame_parsing=true" "gateway validates Linux peer credentials before reading a frame"
assert_contains "$PY_OUT" "gateway_rejects_wrong_pid_and_cgroup_before_parsing=true" "gateway closes wrong PID and wrong cgroup peers before verifier parsing"
assert_contains "$PY_OUT" "gateway_replay_access_is_serialized=true" "gateway serializes persistent replay state access"
assert_contains "$PY_OUT" "worker_verifies_exact_gateway_peer=true" "worker independently validates the gateway peer identity"
assert_contains "$PY_OUT" "root_handoff_rejects_wrong_peer_before_bytes=true" "wrong PID handoff peers are closed before raw request bytes are sent"
assert_contains "$PY_OUT" "root_handoff_uses_exact_pid_cgroup_socket=true" "raw request transfer is limited to the exact worker PID and cgroup"
assert_contains "$PY_OUT" "installer_rejects_untraversable_service_snapshot=true" "installer validates that service accounts can traverse the completed snapshot"
assert_contains "$PY_OUT" "p35_worker_is_distinct_from_legacy_broker=true" "P3.5 uses a distinct worker identity from the P3.4 worker/broker group"
assert_contains "$PY_OUT" "fresh_host_allows_absent_legacy_worker=true" "P3.5 installation supports a fresh host without the legacy P3.4 worker"
assert_contains "$PY_OUT" "installer_rolls_back_partial_snapshot=true" "installer cleans an incomplete release tree after every post-create failure"
assert_contains "$PY_OUT" "request_delivery_follows_exact_worker_discovery=true" "root sends raw request bytes only after discovering the fixed worker PID"
assert_contains "$PY_OUT" "expired_legacy_p35_session_layout_is_reaped=true" "expired pre-isolation P3.5 sessions do not wedge a worker identity migration"
assert_contains "$PY_OUT" "expired_crash_pending_artifacts_are_reaped=true" "expired P3.5 crash temporaries do not wedge reaping"
assert_contains "$PY_OUT" "sealed_gateway_socket_has_no_verifier_path_race=true" "root seals the gateway socket directory before metadata changes"
assert_contains "$PY_OUT" "systemd_runtime_cap_is_frozen=true" "P3.5 transient units have a fixed crash-lifecycle runtime cap"
assert_contains "$PY_OUT" "root_submit_lease_is_outside_verifier_state=true" "root submit serialization is not stored in verifier-writable state"
assert_contains "$PY_OUT" "shadow_host_has_no_authority_calls=true" "P3.5 host stays outside Kernel/action authority"
assert_contains "$PY_OUT" "shadow_admission_summary_is_strict_and_non_authoritative=true" "P3.5 host validates a strict non-authoritative shadow summary"
assert_contains "$PY_OUT" "workspace_ticket_and_separate_witness_are_hash_bound=true" "P3.5c binds a root descriptor ticket and strict separate-UID witness summary"
assert_contains "$PY_OUT" "root_witness_readback_mismatch_is_rejected=true" "P3.5c rejects a root witness readback that diverges from the gateway summary"
assert_contains "$PY_OUT" "p36_mailbox_capacity_is_reserved_before_p35_consumption=true" "P3.5 reserves durable handoff capacity before consuming its one-shot session"

finalize_test
