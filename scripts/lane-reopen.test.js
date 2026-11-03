'use strict';
// N11: lane-reopen must not leak the token to tmux. Fake tmux (Node) captures argv; no real tmux is used.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeFixture } = require('./lib/account-fixtures/shim-install.js');

const TOOL = path.join(__dirname, 'lane-reopen.js');
const TOKEN = 'FAKE-token-lane-xyz';

function setup() {
  const fx = makeFixture({ aliases: [{ alias: 'spare', token: TOKEN }] });
  const cap = path.join(fx.root, 'tmux-capture.jsonl');
  const tmux = path.join(fx.shim.binDir, 'tmux');
  fs.writeFileSync(tmux, `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(cap)}, JSON.stringify({argv:process.argv.slice(2),env:process.env})+'\\n');\n`, { mode: 0o755 });
  return { fx, cap };
}
function run(fx, args) { return spawnSync(process.execPath, [TOOL, ...args], { env: fx.env, encoding: 'utf8', stdin: 'ignore' }); }
function captured(cap) { try { return fs.readFileSync(cap, 'utf8'); } catch (_) { return ''; } }

test('dry-run prints an alias-only command and spawns nothing', () => {
  const { fx, cap } = setup();
  const r = run(fx, ['--alias', 'spare', '--cwd', '/work/x', '--dry-run', '--', '--model', 'sonnet']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /claude-account\.js' 'exec' '--alias' 'spare' '--purpose' 'lane' '--' 'claude' '--model' 'sonnet'/);
  assert.ok(!r.stdout.includes(TOKEN) && !r.stdout.includes(' -e '));
  assert.strictEqual(captured(cap), '');
  fx.cleanup();
});

test('real path: fake tmux argv and env never contain the token', () => {
  const { fx, cap } = setup();
  const r = run(fx, ['--alias', 'spare', '--cwd', '/work/x', '--session', 's1']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /^reopened alias=spare window=s1:lane-spare$/m);
  const c = captured(cap);
  assert.ok(c.includes('new-window'));
  assert.ok(c.includes('spare'));
  assert.ok(!c.includes(TOKEN), 'token leaked to tmux');
  assert.ok(!JSON.parse(c.trim()).argv.includes('-e'));
  fx.cleanup();
});

test('invalid alias / usage exit 2 with no tmux call', () => {
  const { fx, cap } = setup();
  assert.strictEqual(run(fx, ['--alias', 'Bad Alias', '--cwd', '/w']).status, 2);
  assert.strictEqual(run(fx, ['--cwd', '/w']).status, 2);
  assert.strictEqual(run(fx, ['--alias', 'spare', '--cwd', 'rel']).status, 2);
  assert.strictEqual(captured(cap), '');
  fx.cleanup();
});

test('NEG N11: a variant that passes the token with new-window -e is caught', () => {
  const { fx, cap } = setup();
  // the deliberately broken behaviour
  spawnSync(path.join(fx.shim.binDir, 'tmux'), ['new-window', '-e', `CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}`, 'claude'], { env: fx.env });
  const c = captured(cap);
  assert.ok(c.includes(TOKEN), 'capture must see the token in the broken variant');
  assert.ok(JSON.parse(c.trim()).argv.includes('-e'));
  fx.cleanup();
});
