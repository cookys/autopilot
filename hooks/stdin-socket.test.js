'use strict';
// Regression: hooks must read the event payload from fd 0, not the '/dev/stdin'
// PATH. Claude Code (and Node spawn with stdio 'pipe') hands hooks a UNIX
// socketpair; opening the /dev/stdin path on a socket throws ENXIO, so a hook
// that only reads the path sees an empty payload. Each case spawns the real hook
// with a socket stdin and asserts an effect that depends on the payload.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function run(hook, payload, extraEnv) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stdin-socket-'));
  const cwd = path.join(home, 'work');
  fs.mkdirSync(cwd);
  const env = {
    PATH: process.env.PATH, HOME: home, TMPDIR: home,
    CLAUDE_CODE_SESSION_ID: 'sock-test', ...extraEnv,
  };
  // spawnSync with stdio 'pipe' + input => stdin is a socketpair.
  const r = spawnSync(process.execPath, [path.join(__dirname, hook)], {
    input: JSON.stringify(payload), stdio: ['pipe', 'pipe', 'pipe'], env, cwd, encoding: 'utf8',
  });
  return { home, cwd, r };
}

test('harness: spawn stdio pipe really gives a socket stdin', () => {
  const r = spawnSync(process.execPath, ['-e',
    'process.stdout.write(require("fs").fstatSync(0).isSocket() ? "socket" : "other")'],
  { input: 'x', stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
  assert.strictEqual(r.stdout, 'socket');
});

test('accumulator records the edited path from a socket payload', () => {
  const { home, r } = run('accumulator.js',
    { tool_input: { file_path: '/x/a.ts' } }, { AUTOPILOT_HOOK_ACCUMULATOR: '1' });
  assert.strictEqual(r.status, 0);
  const f = path.join(home, 'claude-edited-sock-test.txt');
  assert.ok(fs.existsSync(f), 'accumulator output file missing');
  assert.match(fs.readFileSync(f, 'utf8'), /\/x\/a\.ts/);
});

test('design-quality flags a stock design from a socket payload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stdin-socket-dq-'));
  const f = path.join(dir, 'a.css');
  fs.writeFileSync(f, 'body { font-family: Inter, sans-serif; }\n');
  const { r } = run('design-quality.js', { tool_input: { file_path: f } },
    { AUTOPILOT_HOOK_DESIGN_QUALITY: '1' });
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /Inter font/);
});

test('log-error logs a failing tool result from a socket payload', () => {
  const { home, r } = run('log-error.js',
    { tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: 'fatal: boom' }, {});
  assert.strictEqual(r.status, 0);
  const f = path.join(home, '.claude', 'error-log.md');
  assert.ok(fs.existsSync(f), 'error-log.md missing');
  assert.match(fs.readFileSync(f, 'utf8'), /fatal: boom/);
});

test('intent-capture records tool_name from a socket payload', () => {
  const { home, r } = run('intent-capture.js',
    { tool_name: 'Edit', tool_input: { file_path: '/x/y.js' }, hook_event_name: 'PostToolUse' }, {});
  assert.strictEqual(r.status, 0);
  const dir = path.join(home, '.autopilot', 'intent');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.ok(files.length > 0, 'no intent file written');
  const body = fs.readFileSync(path.join(dir, files[0]), 'utf8');
  assert.match(body, /"Edit"/);
  assert.match(body, /"last_tool_source": "stdin"/);
});

test('capture-payload captures the raw socket payload', () => {
  const { home, r } = run('capture-payload.js', { hello: 'world' },
    { AUTOPILOT_CAPTURE_PAYLOAD: '1' });
  assert.strictEqual(r.status, 0);
  const dir = path.join(home, '.autopilot', 'payloads');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.ok(files.length > 0, 'no payload file written');
  assert.match(fs.readFileSync(path.join(dir, files[0]), 'utf8'), /hello/);
});

test('reload-watch exits 0 with socket stdin (consume path)', () => {
  const { r } = run('reload-watch.js', { session_id: 's' }, {});
  assert.strictEqual(r.status, 0);
});
