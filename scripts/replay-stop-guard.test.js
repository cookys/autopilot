'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const replay = require('./replay-stop-guard');
const cards = require('./open-decision');

test('replay CLI uses final assistant text and prints only file, verdict and classes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-replay-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, texts) => fs.writeFileSync(path.join(dir, file), texts.map((text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })).join('\n'));
  write('a.jsonl', ['Please run the check.']);
  write('b.jsonl', ["I'll remind you."]);
  write('c.jsonl', ['Should I continue?', 'Finished; all checks passed.']);
  fs.writeFileSync(path.join(dir, 'ignore.txt'), 'not a transcript');
  const script = path.join(__dirname, 'replay-stop-guard.js');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, env: cleanEnv, encoding: 'utf8' });
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

test('replay CLI fails closed on card lookup in non-git cwd or corrupt store instead of exiting 2', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-replay-nongit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'card.jsonl'), JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Please confirm d-00000000.' }] },
  }));
  const script = path.join(__dirname, 'replay-stop-guard.js');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = spawnSync(process.execPath, [script, '--dir', dir], { cwd: dir, env: cleanEnv, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'card.jsonl: BLOCK question\n');

  const origFindCard = cards.findCard;
  const origWrite = process.stdout.write;
  let captured = '';
  t.after(() => {
    cards.findCard = origFindCard;
    process.stdout.write = origWrite;
  });
  cards.findCard = () => { throw new Error('corrupt decision store'); };
  process.stdout.write = (chunk) => { captured += String(chunk); return true; };
  assert.equal(replay.main(['--dir', dir]), 0);
  assert.equal(captured, 'card.jsonl: BLOCK question\n');
});
