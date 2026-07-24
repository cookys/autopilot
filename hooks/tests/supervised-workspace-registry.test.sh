#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import array
import errno
import hashlib
import importlib.util
import json
import os
import shutil
import socket
import sys
import tempfile

root = sys.argv[1]
source = os.path.join(root, 'src', 'engine', 'supervised-workspace-registry.py')
spec = importlib.util.spec_from_file_location('p35_workspace_registry', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

assertions = 0

def check(value, message):
    global assertions
    assertions += 1
    if not value:
        raise AssertionError(message)

def equal(actual, expected, message):
    global assertions
    assertions += 1
    if actual != expected:
        raise AssertionError('{}: {!r} != {!r}'.format(message, actual, expected))

def rejects(callback, fragment, message):
    global assertions
    assertions += 1
    try:
        callback()
    except module.WorkspaceRegistryError as error:
        if fragment not in str(error):
            raise AssertionError('{}: unexpected error {}'.format(message, error))
    else:
        raise AssertionError(message + ': expected WorkspaceRegistryError')

check(sys.platform == 'linux', 'workspace registry test requires Linux')
now = [1_000_000]
registry = module.WorkspaceDescriptorRegistry('a' * 64, now=lambda: now[0], instance_id='p35-registry-test')
temporary = tempfile.mkdtemp(prefix='p35-registry-', dir=os.environ.get('TMPDIR', '/tmp'))
try:
    workspace = os.path.join(temporary, 'workspace')
    os.mkdir(workspace, 0o700)
    descriptor, inspection = module.open_workspace_descriptor(workspace)
    expected_hash = hashlib.sha256(workspace.encode('utf-8')).hexdigest()
    equal(inspection['workspace_root_hash'], expected_hash, 'openat2 descriptor uses the P3.3 canonical path hash')
    check(len(inspection['descriptor_fingerprint_hash']) == 64, 'descriptor inspection includes a hash-only fingerprint')
    registered = registry.register('project-main', 'b' * 40, 60_000, descriptor)
    equal(registered['status'], 'registered', 'root registry accepts one opened descriptor')
    equal(registered['workspace_root_hash'], expected_hash, 'registration returns only the workspace hash')
    check(workspace not in json.dumps(registered, sort_keys=True), 'registration response excludes workspace path')
    record = registry.records['project-main']
    check('path' not in record, 'registry record does not persist a workspace path')
    equal(record['descriptor'], descriptor, 'registry retains the original O_PATH descriptor')
    rejects(lambda: registry.register('project-main', 'b' * 40, 60_000, os.dup(descriptor)), 'already live', 'live registration IDs are unique')

    reserved = registry.reserve('project-main', 'p35-session', 'c' * 64, 'a' * 64, now[0] + 5_000)
    ticket = reserved['ticket']
    equal(reserved['status'], 'reserved', 'registration is reserved once')
    equal(ticket['workspace_root_hash'], expected_hash, 'ticket binds exact workspace hash')
    equal(ticket['immutable_base'], 'b' * 40, 'ticket binds configured immutable-base claim')
    equal(ticket['session_id'], 'p35-session', 'ticket binds one session')
    check(workspace not in json.dumps(ticket, sort_keys=True), 'ticket excludes workspace path')
    registry.assert_reserved('project-main', 'p35-session', ticket['ticket_hash'])
    rejects(lambda: registry.reserve('project-main', 'other-session', 'd' * 64, 'a' * 64, now[0] + 4_000), 'already reserved', 'reservation is one-shot')
    completed = registry.complete('project-main', 'p35-session', ticket['ticket_hash'])
    equal(completed['status'], 'completed', 'completion closes the lease')
    try:
        os.fstat(descriptor)
    except OSError as error:
        equal(error.errno, errno.EBADF, 'completion closes the retained descriptor')
    else:
        raise AssertionError('completion left the retained descriptor open')
except module.WorkspaceRegistryError as unexpected:
    # This branch exists only to make failures retain the module error message.
    raise AssertionError('unexpected registry error: {}'.format(unexpected))
finally:
    registry.close_all()
    shutil.rmtree(temporary)

# Re-run the descriptor mutation tests in a fresh registry because completed
# descriptors are intentionally closed.
temporary = tempfile.mkdtemp(prefix='p35-registry-mutation-', dir=os.environ.get('TMPDIR', '/tmp'))
try:
    workspace = os.path.join(temporary, 'workspace')
    os.mkdir(workspace, 0o700)
    symlink = os.path.join(temporary, 'workspace-link')
    os.symlink(workspace, symlink)
    rejects(lambda: module.open_workspace_descriptor(symlink), 'cannot be opened safely', 'openat2 rejects a symlink registration path')

    registry = module.WorkspaceDescriptorRegistry('d' * 64, now=lambda: now[0], instance_id='p35-registry-mutation')
    descriptor, _inspection = module.open_workspace_descriptor(workspace)
    registered = registry.register('project-mutation', 'e' * 40, 60_000, descriptor)
    ticket = registry.reserve('project-mutation', 'p35-mutation', 'f' * 64, 'd' * 64, now[0] + 5_000)['ticket']
    moved = os.path.join(temporary, 'moved-workspace')
    os.rename(workspace, moved)
    os.mkdir(workspace, 0o700)
    rejects(
        lambda: registry.assert_reserved('project-mutation', 'p35-mutation', ticket['ticket_hash']),
        'changed after registration',
        'renamed/replaced paths cannot revive a retained descriptor',
    )
    check('project-mutation' not in registry.records, 'descriptor mismatch discards the registration')
    registry.close_all()

    descriptor, _inspection = module.open_workspace_descriptor(workspace)
    registry = module.WorkspaceDescriptorRegistry('1' * 64, now=lambda: now[0], instance_id='p35-registry-expiry')
    registry.register('project-expiry', '2' * 40, 1_000, descriptor)
    now[0] += 1_001
    rejects(
        lambda: registry.reserve('project-expiry', 'p35-expiry', '3' * 64, '1' * 64, now[0] + 1),
        'unavailable or expired',
        'expired registrations fail closed instead of reopening a path',
    )
    registry.close_all()
finally:
    shutil.rmtree(temporary)

left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
sender_descriptor = os.open('/dev/null', os.O_RDONLY)
try:
    before = len(os.listdir('/proc/self/fd'))
    right.sendmsg(
        [b'not-json'],
        [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [sender_descriptor]))],
    )
    rejects(
        lambda: module.receive_packet(left, 'malformed descriptor packet'),
        'not UTF-8 JSON',
        'registry closes received descriptors when canonical packet parsing rejects',
    )
    equal(
        len(os.listdir('/proc/self/fd')),
        before,
        'registry rejection does not leak SCM_RIGHTS descriptors',
    )
finally:
    os.close(sender_descriptor)
    left.close()
    right.close()

class FakeRegistryConnection:
    def settimeout(self, _timeout_seconds):
        pass

    def connect(self, _socket_path):
        pass

    def close(self):
        pass

original_require_linux = module.require_linux
original_require_root_socket = module.require_root_socket
original_send_packet = module.send_packet
original_receive_packet = module.receive_packet
original_socket_factory = module.socket.socket
original_geteuid = module.os.geteuid
original_getegid = module.os.getegid
original_getgroups = module.os.getgroups
response_descriptor = None
try:
    before = len(os.listdir('/proc/self/fd'))
    response_descriptor = os.open('/dev/null', os.O_RDONLY)
    module.require_linux = lambda: None
    module.require_root_socket = lambda path, _label: path
    module.send_packet = lambda _connection, _value, descriptor=None: None
    module.receive_packet = lambda _connection, _label: ({'status': 'ok'}, [response_descriptor])
    module.socket.socket = lambda *_args: FakeRegistryConnection()
    module.os.geteuid = lambda: 0
    module.os.getegid = lambda: 0
    module.os.getgroups = lambda: [0]
    rejects(
        lambda: module.registry_request('/fake-registry.sock', 'reserve', {}, timeout_seconds=1),
        'must not carry descriptors',
        'registry client rejects a descriptor-bearing response',
    )
    equal(
        len(os.listdir('/proc/self/fd')),
        before,
        'registry client rejection closes received response descriptors',
    )
finally:
    module.require_linux = original_require_linux
    module.require_root_socket = original_require_root_socket
    module.send_packet = original_send_packet
    module.receive_packet = original_receive_packet
    module.socket.socket = original_socket_factory
    module.os.geteuid = original_geteuid
    module.os.getegid = original_getegid
    module.os.getgroups = original_getgroups
    if response_descriptor is not None:
        try:
            os.close(response_descriptor)
        except OSError:
            pass

source_text = open(source, 'r', encoding='utf-8').read()
handler_text = source_text[source_text.index('def handle_connection'):]
check('SO_PEERCRED' in source_text and handler_text.index('peer_credentials(connection)') < handler_text.index('receive_packet(connection'), 'server validates peer credentials before parsing a packet')
check('import subprocess' not in source_text and 'subprocess.' not in source_text, 'registry does not invoke a command')
check('openat2' in source_text and 'statx' in source_text, 'registry requires openat2 and statx')
print(assertions)
PY
)"

assert_eq "$OUT" "28" "workspace registry deterministic coverage"
finalize_test
