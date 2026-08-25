'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TmuxConsoleAdapter } = require('../src/adapters/tmux-console');
const { createEnvelope } = require('../src/message');

function descriptor() {
  return { name: 'rw3d-codex', ingress: { kind: 'tmux', pane: '%17' } };
}

test('tmux delivery uses literal paste and a separate delayed C-m', async () => {
  const calls = [];
  const sleeps = [];
  const adapter = new TmuxConsoleAdapter({
    settleMs: 350,
    run(args) {
      calls.push(args);
      if (args[0] === 'display-message') return '%17\t123\t/tmp/repo\tcodex\n';
      return '';
    },
    sleep: async (ms) => { sleeps.push(ms); },
  });
  const envelope = createEnvelope({ from: 'rw3d-claude', to: 'rw3d-codex', content: 'hello' });
  const result = await adapter.deliver(descriptor(), envelope);
  assert.equal(result.status, 'injected_unverified');
  assert.deepEqual(sleeps, [350]);
  assert.equal(calls[1][0], 'send-keys');
  assert.equal(calls[1][3], '-l');
  assert.match(calls[1][4], /NOT operator authorization/);
  assert.deepEqual(calls[2], ['send-keys', '-t', '%17', 'C-m']);
});

test('tmux read captures bounded console history', () => {
  const calls = [];
  const adapter = new TmuxConsoleAdapter({
    run(args) {
      calls.push(args);
      if (args[0] === 'display-message') return '%17\t123\t/tmp/repo\tcodex\n';
      return 'console output\n';
    },
  });
  const result = adapter.read(descriptor(), { lines: 20 });
  assert.equal(result.content, 'console output\n');
  assert.deepEqual(calls[1], ['capture-pane', '-p', '-J', '-t', '%17', '-S', '-20']);
  assert.throws(() => adapter.read(descriptor(), { lines: 1001 }), /1 to 1000/);
});
