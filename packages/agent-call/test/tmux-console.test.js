'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TmuxConsoleAdapter } = require('../src/adapters/tmux-console');
const { createEnvelope } = require('../src/message');

function descriptor() {
  return { name: 'rw3d-codex', ingress: { kind: 'tmux', pane: '%17' } };
}

test('tmux delivery uses a private bracketed paste buffer and a separate delayed C-m', async () => {
  const calls = [];
  const sleeps = [];
  const adapter = new TmuxConsoleAdapter({
    settleMs: 350,
    run(args, options = {}) {
      calls.push({ args, options });
      if (args[0] === 'display-message') return '%17\t123\t/tmp/repo\tcodex\n';
      return '';
    },
    sleep: async (ms) => { sleeps.push(ms); },
  });
  const envelope = createEnvelope({
    from: 'rw3d-claude', to: 'rw3d-codex', content: 'hello\nsecond line',
  });
  const result = await adapter.deliver(descriptor(), envelope);
  assert.equal(result.status, 'injected_unverified');
  assert.deepEqual(sleeps, [350]);
  assert.equal(calls[1].args[0], 'load-buffer');
  assert.equal(calls[1].args[1], '-b');
  assert.equal(calls[1].args.at(-1), '-');
  assert.equal(calls[1].options.input.includes('\n'), false);
  assert.match(calls[1].options.input, /NOT operator|peer-not-operator/);
  assert.deepEqual(calls[2].args.slice(0, 4), ['paste-buffer', '-d', '-p', '-r']);
  assert.deepEqual(calls[3].args, ['send-keys', '-t', '%17', 'C-m']);
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


test('tmux adapter rejects a settle delay that can re-enter paste-burst mode', () => {
  assert.throws(() => new TmuxConsoleAdapter({ settleMs: 0 }), /150 to 5000/);
  assert.throws(() => new TmuxConsoleAdapter({ settleMs: 99999 }), /150 to 5000/);
});

test('tmux removes its private buffer when paste-buffer fails', async () => {
  const calls = [];
  const adapter = new TmuxConsoleAdapter({
    run(args) {
      calls.push(args);
      if (args[0] === 'display-message') return '%17\t123\t/tmp/repo\tcodex\n';
      if (args[0] === 'paste-buffer') throw new Error('paste failed');
      return '';
    },
    sleep: async () => {},
  });
  const envelope = createEnvelope({ from: 'rw3d-claude', to: 'rw3d-codex', content: 'hello' });
  await assert.rejects(() => adapter.deliver(descriptor(), envelope), /paste failed/);
  assert.ok(calls.some((args) => args[0] === 'delete-buffer'));
  assert.equal(calls.some((args) => args[0] === 'send-keys'), false);
});
