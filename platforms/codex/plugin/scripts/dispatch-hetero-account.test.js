'use strict';
// G37 W3 (plan section 8) rail test: dispatch-hetero.sh --runner claude-native with an account registry.
// Only `claude` is faked (the Node shim from account-fixtures); the real rail and claude-account.js run.
// Controls: registry present -> alias + token fingerprint at the shim, gate-rules --settings kept, push
// block (HANDS_GIT_ENV) and git identity env reach the worker, no seeded dir; registry broken (N9) ->
// nothing spawned, decoy unread; no registry -> legacy seeded path unchanged; mutation -> the wiring
// removed makes the registry-present check go red.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const { makeFixture, readLog } = require('./lib/account-fixtures/shim-install');

const SCRIPTS = __dirname;
const REAL_RAIL = path.join(SCRIPTS, 'dispatch-hetero.sh');
const fp = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 8);

function git(cwd, args) {
  execFileSync('git', ['-c', 'user.email=fixture', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
}

function world(opts) {
  const fx = makeFixture(opts);
  const repo = path.join(fx.root, 'repo');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'develop']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const prompt = path.join(fx.root, 'prompt.txt');
  fs.writeFileSync(prompt, 'do work\n');
  const rules = path.join(fx.root, 'rules.json');
  fs.writeFileSync(rules, JSON.stringify({ v: 1, forbid_paths: [{ id: 'fp', glob: 'src/legacy/**' }] }));
  const env = Object.assign({}, fx.env, {
    AUTOPILOT_CONFIG_FILE: fx.configFile,
    AUTOPILOT_DISPATCH_RUNS_DIR: path.join(fx.root, 'runs'),
    DISPATCH_QUIET: '1',
    GIT_CONFIG_NOSYSTEM: '1',
  });
  fs.mkdirSync(env.AUTOPILOT_DISPATCH_RUNS_DIR, { recursive: true });
  for (const k of ['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CHILD_SESSION_ID']) delete env[k];
  spawnSync('node', [path.join(SCRIPTS, 'run-approval.js'), 'confirm-claude-native'], { env, stdio: 'ignore' });
  return { fx, repo, prompt, rules, env };
}

function dispatch(w, rail, extra) {
  const r = spawnSync(rail, ['--runner', 'claude-native', '--model', 'claude-sonnet-4-6', '--prompt-file', w.prompt,
    '--context-window', 'off', '--branch', 'feat/g37-' + Math.random().toString(36).slice(2, 8), ...(extra || [])],
  { cwd: w.repo, env: w.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// A copy of the rail dir (symlinks) whose dispatch-hetero.sh is edited by `edit`.
function farmWith(w, edit) {
  const d = path.join(w.fx.root, 'farm');
  fs.mkdirSync(d);
  for (const n of fs.readdirSync(SCRIPTS)) {
    if (n === 'dispatch-hetero.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS, n), path.join(d, n));
  }
  const src = fs.readFileSync(REAL_RAIL, 'utf8');
  const out = edit(src);
  assert.notEqual(out, src, 'mutation matched nothing');
  fs.writeFileSync(path.join(d, 'dispatch-hetero.sh'), out, { mode: 0o755 });
  return path.join(d, 'dispatch-hetero.sh');
}

function checkWired(w, rail) {
  const r = dispatch(w, rail, ['--gate-rules', w.rules]);
  assert.match(r.out, /"status": "no_op".*agent exit 0/s, r.out); // the shim edits nothing: a clean no-op
  const calls = readLog(w.fx.shim.log);
  assert.equal(calls.length, 1, 'exactly one shim call');
  const c = calls[0];
  assert.ok(c.account, 'alias reached the shim');
  assert.equal(c.fp, fp(w.fx.tokens[c.account]), 'token fingerprint of that alias');
  assert.equal(c.decoy_read, false, 'ambient credentials never reachable');
  assert.notEqual(c.home, w.fx.realHome);
  assert.ok(c.argv.includes('--settings'), 'gate-rules settings argument preserved');
  assert.ok(c.argv.includes('--strict-mcp-config') && c.argv.includes('--dangerously-skip-permissions'));
  assert.ok(c.argv.includes('--output-format') && c.argv.includes('json'));
  return c;
}

test('registry present: worker goes through claude-account run (alias, fingerprint, gate-rules, T-GIT env)', () => {
  const w = world();
  try {
    const c = checkWired(w, REAL_RAIL);
    // T-GIT: git identity/config reference and the hands push block reach the worker env.
    assert.ok(c.env_names.includes('GIT_CONFIG_GLOBAL') || !fs.existsSync(path.join(w.fx.realHome, '.gitconfig')));
    assert.ok(c.env_names.includes('GIT_ALLOW_PROTOCOL'), 'push block GIT_ALLOW_PROTOCOL reached the worker');
    assert.ok(c.env_names.includes('GIT_CONFIG_COUNT'), 'push block GIT_CONFIG_COUNT reached the worker');
    assert.ok(c.env_names.includes('AUTOPILOT_CHILD_SESSION_ID'));
    for (const bad of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']) assert.ok(!c.env_names.includes(bad));
    // the seeded-dir path is not touched: no .credentials.json was written anywhere under the tmp dir
    const found = execFileSync('find', [w.fx.tmpDir, '-name', '.credentials.json'], { encoding: 'utf8' });
    assert.equal(found.trim(), '');
  } finally { w.fx.cleanup(); }
});

test('N9: registry broken -> nothing spawned, decoy unread, precondition refusal', () => {
  const w = world();
  try {
    fs.writeFileSync(w.fx.regFile, '{ not json');
    const r = dispatch(w, REAL_RAIL);
    assert.notEqual(r.rc, 0, r.out);
    assert.equal(readLog(w.fx.shim.log).length, 0, 'spawn count 0');
    assert.match(r.out, /registry/i);
  } finally { w.fx.cleanup(); }
});

test('no registry: legacy seeded path, no alias reaches the shim', () => {
  const w = world();
  try {
    fs.rmSync(w.fx.regFile);
    const r = dispatch(w, REAL_RAIL);
    assert.match(r.out, /"status": "no_op".*agent exit 0/s, r.out); // the shim edits nothing: a clean no-op
    const calls = readLog(w.fx.shim.log);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].account, null);
    assert.ok(calls[0].config_dir && calls[0].config_dir !== path.join(w.fx.realHome, '.claude'), 'seeded dir, not the real one');
  } finally { w.fx.cleanup(); }
});

test('mutation: wiring removed (state forced to legacy) -> the registry-present check goes red', () => {
  const w = world();
  try {
    const rail = farmWith(w, (s) => s.replace('local _out _rc\n', 'echo legacy; return 0\n'));
    assert.throws(() => checkWired(w, rail), /./);
  } finally { w.fx.cleanup(); }
});
