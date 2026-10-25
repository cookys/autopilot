'use strict';
// Tests for scripts/lib/chain-command.js and the hook-harness-matrix caller (BL-0241, g1 class A).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseChainCommand } = require('./chain-command.js');

const REPO = path.resolve(__dirname, '..', '..');

test('plain, quoted and escaped script paths parse to the same ordered members', () => {
  const want = { members: ['intent-capture', 'audit-log', 'log-error'] };
  assert.deepEqual(parseChainCommand('node ${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-chain.js intent-capture audit-log log-error'), want);
  assert.deepEqual(parseChainCommand('node "/tmp/my dir/post-tool-chain.js" intent-capture audit-log log-error'), want);
  assert.deepEqual(parseChainCommand("node '/tmp/post-tool-chain.js' intent-capture 'audit-log' log-error"), want);
  assert.deepEqual(parseChainCommand('node /tmp/my\\ dir/post-tool-chain.js intent-capture audit-log log-error'), want);
  assert.deepEqual(parseChainCommand('node --no-warnings /x/post-tool-chain.js intent-capture audit-log log-error'), want);
});

test('other commands return null (the chain is recognised by the executed script, not by a substring)', () => {
  assert.equal(parseChainCommand('node ${CLAUDE_PLUGIN_ROOT}/hooks/reload-watch.js'), null);
  assert.equal(parseChainCommand('node /x/opt-in-multiplexer.js PostToolUse'), null);
  assert.equal(parseChainCommand('node /x/audit-log.js post-tool-chain.js'), null);
  assert.equal(parseChainCommand(''), null);
});

test('negative: a chain command that cannot be read with certainty throws, never defaults', () => {
  assert.throws(() => parseChainCommand('node "/tmp/post-tool-chain.js intent-capture'), /cannot be parsed/);
  assert.throws(() => parseChainCommand('node /x/post-tool-chain.js'), /names no members/);
  assert.throws(() => parseChainCommand('node /x/post-tool-chain.js intent-capture; echo x'), /shell syntax/);
  assert.throws(() => parseChainCommand('node /x/post-tool-chain.js intent-capture | cat'), /shell syntax/);
  assert.throws(() => parseChainCommand('node /x/post-tool-chain.js ../evil'), /not a hook stem/);
});

function sandbox(command) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-cmd-'));
  fs.mkdirSync(path.join(d, 'hooks'));
  fs.mkdirSync(path.join(d, 'platforms/codex/hooks'), { recursive: true });
  const wiring = { hooks: { PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command }, { type: 'command', command: 'node /x/hooks/reload-watch.js' }] }] } };
  fs.writeFileSync(path.join(d, 'hooks/hooks.json'), JSON.stringify(wiring));
  fs.writeFileSync(path.join(d, 'platforms/codex/hooks/hooks.json'), JSON.stringify({ hooks: {} }));
  return d;
}

test('hook-harness-matrix: a quoted chain path credits only the named members (the old regex fell back to all five)', () => {
  const d = sandbox('node "/tmp/post-tool-chain.js" intent-capture');
  const r = spawnSync('node', [path.join(REPO, 'scripts/hook-harness-matrix.js'), '--repo', d], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| `intent-capture` \| PostToolUse/);
  assert.match(r.stdout, /\| `reload-watch` \| PostToolUse/); // registered directly in the sandbox
  assert.doesNotMatch(r.stdout, /`audit-log`/); // not named, so not credited
  assert.doesNotMatch(r.stdout, /`failure-escalation`/);
});

test('hook-harness-matrix: an unparseable chain command exits non-zero instead of defaulting', () => {
  const d = sandbox('node "/tmp/post-tool-chain.js intent-capture');
  const r = spawnSync('node', [path.join(REPO, 'scripts/hook-harness-matrix.js'), '--repo', d], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot be parsed/);
});
