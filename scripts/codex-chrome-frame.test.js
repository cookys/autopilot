#!/usr/bin/env node
'use strict';
// codex_transport_has_chrome_frame: tracing lines before the banner, and a
// banner with trailing text after the semver. Run:
//   node --test scripts/codex-chrome-frame.test.js < /dev/null

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts/lib/dispatch-author-codex-transport.sh');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-chrome-frame-'));

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const FRAME = [
  'OpenAI Codex v0.166.0',
  '--------',
  'session id: 00000000-0000-4000-8000-000000000001',
  '--------',
  '',
].join('\n');

function stderrFile(name, body) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, body);
  return file;
}

function hasFrame(file) {
  const r = spawnSync(
    'bash',
    ['-c', 'source "$1"; codex_transport_has_chrome_frame "$2"', 'bash', LIB, file],
    { encoding: 'utf8' },
  );
  return r.status === 0;
}

test('banner, opening fence, body, closing fence', () => {
  const f = stderrFile('plain.txt', FRAME);
  assert.equal(hasFrame(f), true);
});

test('WARN tracing line then banner and frame', () => {
  const f = stderrFile(
    'warn.txt',
    '2026-11-18T00:50:35.530337Z  WARN codex_core::something: text\n' + FRAME,
  );
  assert.equal(hasFrame(f), true);
});

test('Reading prompt, then ERROR tracing line, then banner and frame', () => {
  const f = stderrFile(
    'read-error.txt',
    'Reading prompt from stdin...\n' +
      '2026-11-18T00:50:35.530391Z ERROR codex_login::auth::manager: text\n' +
      FRAME,
  );
  assert.equal(hasFrame(f), true);
});

test('banner with trailing text after the semver', () => {
  const f = stderrFile(
    'trailer.txt',
    'OpenAI Codex v0.166.0 (research preview)\n' +
      '--------\n' +
      'body\n' +
      '--------\n',
  );
  assert.equal(hasFrame(f), true);
});

test('Reading prompt then banner with trailing text', () => {
  const f = stderrFile(
    'read-trailer.txt',
    'Reading prompt from stdin...\n' +
      'OpenAI Codex v0.166.0 (research preview)\n' +
      '--------\n' +
      'body\n' +
      '--------\n',
  );
  assert.equal(hasFrame(f), true);
});

test('random text before the banner is rejected', () => {
  const f = stderrFile('random.txt', 'not a tracing line\n' + FRAME);
  assert.equal(hasFrame(f), false);
});

test('banner without the opening fence is rejected', () => {
  const f = stderrFile(
    'no-fence.txt',
    'OpenAI Codex v0.166.0\nbody\n--------\n',
  );
  assert.equal(hasFrame(f), false);
});

test('empty file is rejected', () => {
  const f = stderrFile('empty.txt', '');
  assert.equal(hasFrame(f), false);
});
