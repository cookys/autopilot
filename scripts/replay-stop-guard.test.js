'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('replay CLI uses final assistant text and prints only file, verdict and classes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-replay-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, texts) => fs.writeFileSync(path.join(dir, file), texts.map((text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })).join('\n'));
  write('a.jsonl', ['Please run the check.']);
  write('b.jsonl', ["I'll remind you."]);
  write('c.jsonl', ['Should I continue?', 'Finished; all checks passed.']);
  fs.writeFileSync(path.join(dir, 'ignore.txt'), 'not a transcript');
  const script = path.join(__dirname, 'replay-stop-guard.js');
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
  const r = run('--dir', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'a.jsonl: BLOCK operator-step\nb.jsonl: BLOCK promise\nc.jsonl: PASS -\n');
  assert.equal(run().status, 2);
  assert.equal(run('--dir').status, 2);
  assert.equal(run('--dir', path.join(dir, 'absent')).status, 2);
  fs.mkdirSync(path.join(dir, 'empty'));
  assert.equal(run('--dir', path.join(dir, 'empty')).status, 2);
  write('d.jsonl', ['']);
  assert.equal(run('--dir', dir).status, 2, 'missing final assistant text is an input error');
});
