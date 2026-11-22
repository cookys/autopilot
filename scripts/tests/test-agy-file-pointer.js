#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const AGY_STREAM_JS = path.resolve(__dirname, '..', 'lib', 'agy-stream-json.js');
const QRP_JS = path.resolve(__dirname, '..', 'qualification-review-provider.js');

function makeFakeAgy(dir) {
  const binPath = path.join(dir, 'fake-agy');
  const script = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const stdin = fs.readFileSync(0, 'utf8');
const capture = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  stdin,
};
fs.writeFileSync(path.join(process.cwd(), 'capture.json'), JSON.stringify(capture));
process.stdout.write(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'OK' } }) + '\\n');
`;
  fs.writeFileSync(binPath, script, { mode: 0o755 });
  return binPath;
}

test('under-ceiling prompt goes inline', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-fp-inline-'));
  try {
    const fakeAgy = makeFakeAgy(tmp);
    const promptFile = path.join(tmp, 'prompt.txt');
    const prompt = 'hello inline prompt';
    fs.writeFileSync(promptFile, prompt);
    const res = spawnSync(process.execPath, [AGY_STREAM_JS, 'run', '--prompt-file', promptFile, '--', fakeAgy], {
      cwd: tmp,
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, 'OK');
    const cap = JSON.parse(fs.readFileSync(path.join(tmp, 'capture.json'), 'utf8'));
    const parsed = JSON.parse(cap.stdin.trim());
    assert.equal(parsed.message.content, prompt);
    assert.equal(cap.argv.some((a) => a.includes(prompt)), false);
    const files = fs.readdirSync(tmp).filter((f) => f.startsWith('.agy-prompt-'));
    assert.equal(files.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('200 KB prompt uses file-pointer fallback in seat cwd', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-fp-200k-'));
  try {
    const fakeAgy = makeFakeAgy(tmp);
    const promptFile = path.join(tmp, 'prompt.txt');
    const prompt = 'A'.repeat(200 * 1024);
    fs.writeFileSync(promptFile, prompt);
    const res = spawnSync(process.execPath, [AGY_STREAM_JS, 'run', '--prompt-file', promptFile, '--', fakeAgy], {
      cwd: tmp,
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, 'OK');
    const cap = JSON.parse(fs.readFileSync(path.join(tmp, 'capture.json'), 'utf8'));
    assert.ok(Buffer.byteLength(cap.stdin, 'utf8') < 4096, 'stdin message must be under 4 KB');
    assert.equal(cap.argv.some((a) => a.includes('AAAA')), false, 'argv must never contain the prompt');
    const parsed = JSON.parse(cap.stdin.trim());
    const match = parsed.message.content.match(/\.agy-prompt-[^\s]+\.txt/);
    assert.ok(match, `pointer prompt should name .agy-prompt-*.txt file: ${parsed.message.content}`);
    const writtenPath = path.join(tmp, match[0]);
    assert.ok(fs.existsSync(writtenPath), 'pointer file must exist in seat cwd');
    assert.equal(fs.readFileSync(writtenPath, 'utf8'), prompt);
    const mode = fs.statSync(writtenPath).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('3 MB prompt fails closed with agy_file_ceiling', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-fp-3m-'));
  try {
    const fakeAgy = makeFakeAgy(tmp);
    const promptFile = path.join(tmp, 'prompt.txt');
    fs.writeFileSync(promptFile, 'B'.repeat(3 * 1024 * 1024));
    const res = spawnSync(process.execPath, [AGY_STREAM_JS, 'run', '--prompt-file', promptFile, '--', fakeAgy], {
      cwd: tmp,
      encoding: 'utf8',
    });
    assert.equal(res.status, 3);
    assert.match(res.stderr, /agy_file_ceiling/);
    assert.equal(fs.existsSync(path.join(tmp, 'capture.json')), false, 'agy must not be spawned');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('negative control: fallback disabled refuses 200 KB prompt with exit 3 agy_stdin_ceiling', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-fp-neg-'));
  try {
    const fakeAgy = makeFakeAgy(tmp);
    const promptFile = path.join(tmp, 'prompt.txt');
    fs.writeFileSync(promptFile, 'C'.repeat(200 * 1024));
    const res = spawnSync(process.execPath, [AGY_STREAM_JS, 'run', '--prompt-file', promptFile, '--', fakeAgy], {
      cwd: tmp,
      env: { ...process.env, AUTOPILOT_AGY_FILE_FALLBACK: '0' },
      encoding: 'utf8',
    });
    assert.equal(res.status, 3);
    assert.match(res.stderr, /agy_stdin_ceiling/);
    assert.equal(fs.existsSync(path.join(tmp, 'capture.json')), false, 'agy must not be spawned');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('qualification-review-provider.js caps kimi argv prompt at 120000 bytes', () => {
  const src = fs.readFileSync(QRP_JS, 'utf8');
  assert.match(src, /const ARGV_PROMPT_LIMIT_BYTES\s*=\s*120000\s*;/);
});
