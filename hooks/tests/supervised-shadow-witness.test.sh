#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$REPO_ROOT" <<'PY'
import array
import importlib.util
import json
import os
import shutil
import socket
import sys
import tempfile

root = sys.argv[1]
source = os.path.join(root, 'src', 'engine', 'supervised-shadow-witness.py')
spec = importlib.util.spec_from_file_location('p35_shadow_witness', source)
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
    except module.ShadowWitnessError as error:
        if fragment not in str(error):
            raise AssertionError('{}: unexpected error {}'.format(message, error))
    else:
        raise AssertionError(message + ': expected ShadowWitnessError')

temporary = tempfile.mkdtemp(prefix='p35-shadow-witness-', dir=os.environ.get('TMPDIR', '/tmp'))
try:
    state_root = os.path.join(temporary, 'state')
    os.mkdir(state_root, 0o700)
    journal = module.ShadowJournal(state_root)
    ticket_hash = 'a' * 64
    protocol = module.ShadowWitnessProtocol(journal, ticket_hash)
    capsule = {
        'shadow_admission_id': 'b' * 64,
        'ticket_hash': ticket_hash,
        'capsule_hash': 'c' * 64,
        'observation_hash': 'd' * 64,
        'close_hash': 'e' * 64,
    }
    opened = protocol.dispatch('open_shadow', {
        'shadow_admission_id': capsule['shadow_admission_id'],
        'ticket_hash': ticket_hash,
        'capsule_hash': capsule['capsule_hash'],
    })
    equal(opened['status'], 'shadow_opened', 'first open creates an append-only record')
    check(opened['continuation_token'] is not None, 'open returns an in-memory continuation token')
    check(opened['observation_hash'] is None and opened['close_hash'] is None, 'open response contains no later phase')
    observed = protocol.dispatch('append_shadow_observation', {
        'shadow_admission_id': capsule['shadow_admission_id'],
        'ticket_hash': ticket_hash,
        'observation_hash': capsule['observation_hash'],
        'continuation_token': opened['continuation_token'],
    })
    equal(observed['status'], 'shadow_observed', 'observation advances a fresh open record once')
    equal(observed['previous_shadow_head'], opened['shadow_chain_head'], 'observation chains to the open hash')
    closed = protocol.dispatch('close_shadow_diagnostic', {
        'shadow_admission_id': capsule['shadow_admission_id'],
        'ticket_hash': ticket_hash,
        'close_hash': capsule['close_hash'],
        'continuation_token': opened['continuation_token'],
    })
    equal(closed['status'], 'shadow_closed', 'close produces the terminal diagnostic record')
    equal(closed['previous_shadow_head'], observed['shadow_chain_head'], 'close chains to the observation hash')
    readback = protocol.dispatch('read_shadow_record', {
        'shadow_admission_id': capsule['shadow_admission_id'],
        'ticket_hash': ticket_hash,
    })
    equal(readback['status'], 'shadow_closed', 'readback reports a closed record')
    check(readback['idempotent'] is True, 'readback is deterministic')
    equal(readback['shadow_chain_head'], closed['shadow_chain_head'], 'readback returns exact terminal head')
    replay = protocol.dispatch('close_shadow_diagnostic', {
        'shadow_admission_id': capsule['shadow_admission_id'],
        'ticket_hash': ticket_hash,
        'close_hash': capsule['close_hash'],
        'continuation_token': opened['continuation_token'],
    })
    check(replay['idempotent'] is True and replay['shadow_chain_head'] == closed['shadow_chain_head'], 'exact terminal close replay is idempotent')
    rejects(
        lambda: protocol.dispatch('close_shadow_diagnostic', {
            'shadow_admission_id': capsule['shadow_admission_id'],
            'ticket_hash': ticket_hash,
            'close_hash': 'f' * 64,
            'continuation_token': opened['continuation_token'],
        }),
        'conflicts',
        'changed terminal data cannot rewrite the journal',
    )

    partial = {
        'shadow_admission_id': '1' * 64,
        'ticket_hash': ticket_hash,
        'capsule_hash': '2' * 64,
        'observation_hash': '3' * 64,
        'close_hash': '4' * 64,
    }
    partial_open = protocol.dispatch('open_shadow', {
        'shadow_admission_id': partial['shadow_admission_id'],
        'ticket_hash': ticket_hash,
        'capsule_hash': partial['capsule_hash'],
    })
    restarted = module.ShadowWitnessProtocol(journal, ticket_hash)
    recovery = restarted.dispatch('read_shadow_record', {
        'shadow_admission_id': partial['shadow_admission_id'],
        'ticket_hash': ticket_hash,
    })
    equal(recovery['status'], 'shadow_recovery_required', 'unclosed journal is diagnosis only after restart')
    check(recovery['continuation_token'] is None, 'recovery does not reissue a continuation token')
    rejects(
        lambda: restarted.dispatch('append_shadow_observation', {
            'shadow_admission_id': partial['shadow_admission_id'],
            'ticket_hash': ticket_hash,
            'observation_hash': partial['observation_hash'],
            'continuation_token': partial_open['continuation_token'],
        }),
        'recovery is required',
        'restart cannot continue an unclosed journal even with an old token',
    )
    rejects(
        lambda: restarted.dispatch('close_shadow_diagnostic', {
            'shadow_admission_id': partial['shadow_admission_id'],
            'ticket_hash': ticket_hash,
            'close_hash': partial['close_hash'],
            'continuation_token': partial_open['continuation_token'],
        }),
        'recovery is required',
        'restart cannot close an unclosed journal automatically',
    )

    corrupt_id = '5' * 64
    corrupt_path = journal.path_for(corrupt_id)
    with open(corrupt_path, 'wb') as target:
        target.write(b'{"partial":true}')
    os.chmod(corrupt_path, 0o600)
    rejects(
        lambda: journal.read(corrupt_id, ticket_hash),
        'partial or unterminated',
        'unterminated journal tails fail closed',
    )
    journal_path = journal.path_for(capsule['shadow_admission_id'])
    journal_text = open(journal_path, 'r', encoding='utf-8').read()
    check(journal_text.endswith('\n'), 'every durable journal append is newline-delimited')
    check(opened['continuation_token'] not in journal_text, 'continuation token is never persisted in the journal')
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
        lambda: module.receive_packet(left, 'descriptor packet'),
        'must not contain descriptor ancillary data',
        'witness rejects SCM_RIGHTS packets',
    )
    equal(
        len(os.listdir('/proc/self/fd')),
        before,
        'witness rejection does not leak SCM_RIGHTS descriptors',
    )
finally:
    os.close(sender_descriptor)
    left.close()
    right.close()

source_text = open(source, 'r', encoding='utf-8').read()
handler_text = source_text[source_text.index('def handle_connection'):]
check(handler_text.index('self.classify_peer(connection)') < handler_text.index('receive_packet(connection'), 'witness reads peer credentials before request bytes')
check('external-lifecycle-witness' not in source_text and 'append_if_head' not in source_text and 'OwnerKernel' not in source_text and 'AutopilotEngine' not in source_text, 'witness does not reuse P2/lifecycle/Engine authority surfaces')
check(all(name in source_text for name in ('open_shadow', 'append_shadow_observation', 'read_shadow_record', 'close_shadow_diagnostic')), 'witness exposes only the P3.5c shadow method vocabulary')
print(assertions)
PY
)"

assert_eq "$OUT" "24" "shadow witness deterministic coverage"
finalize_test
