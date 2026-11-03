'use strict';
// N11: lane-reopen must not leak the token to tmux. Fake tmux (Node) captures argv; no real tmux is used.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
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
function run(fx, args, tool) { return spawnSync(process.execPath, [tool || TOOL, ...args], { env: fx.env, encoding: 'utf8', stdin: 'ignore' }); }
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

// The real-path leak predicate, applied to the real tool AND to the mutated copy below: [] when clean.
function leakProblems(tool, fx, cap) {
  const problems = [];
  const r = run(fx, ['--alias', 'spare', '--cwd', '/work/x', '--session', 's1'], tool);
  if (r.status !== 0) problems.push(`exit ${r.status}`);
  const c = captured(cap);
  if (!c.includes('new-window')) problems.push('tmux not asked for a window');
  if (c.includes(TOKEN)) problems.push('token leaked to tmux');
  if (c.trim() && JSON.parse(c.trim().split('\n')[0]).argv.includes('-e')) problems.push('new-window -e used');
  return problems;
}

test('real path: fake tmux argv and env never contain the token', () => {
  const { fx, cap } = setup();
  const r = run(fx, ['--alias', 'spare', '--cwd', '/work/x', '--session', 's1']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /^reopened alias=spare window=s1:lane-spare$/m);
  fs.rmSync(cap, { force: true });
  assert.deepStrictEqual(leakProblems(TOOL, fx, cap), []);
  assert.ok(captured(cap).includes('spare'));
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

test('NEG N11: lane-reopen.js itself mutated to pass the token with new-window -e is caught by the real-path predicate', () => {
  const { fx, cap } = setup();
  // A copy of scripts/ whose lane-reopen.js hands the token to tmux via -e: the deliberately broken tool.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g37-lane-mut-'));
  try {
    fs.cpSync(__dirname, dir, { recursive: true, filter: (f) => !/\.test\.(js|sh)$/.test(f) });
    const mut = path.join(dir, 'lane-reopen.js');
    const src = fs.readFileSync(mut, 'utf8');
    const anchor = "const tmuxArgs = ['new-window', '-d', '-c', o.cwd, '-n', window];";
    assert.ok(src.includes(anchor), 'mutation anchor present');
    const out = src.replace(anchor, anchor + "\n  tmuxArgs.push('-e', 'CLAUDE_CODE_OAUTH_TOKEN=' + require('fs').readFileSync(path.join(process.env.AUTOPILOT_ACCOUNTS_DIR, o.alias, 'token'), 'utf8'));");
    assert.notStrictEqual(out, src);
    fs.writeFileSync(mut, out);
    const problems = leakProblems(mut, fx, cap);
    assert.ok(problems.includes('token leaked to tmux'), `the capture must see the token: ${JSON.stringify(problems)}`);
    assert.ok(problems.includes('new-window -e used'), JSON.stringify(problems));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fx.cleanup(); }
});
