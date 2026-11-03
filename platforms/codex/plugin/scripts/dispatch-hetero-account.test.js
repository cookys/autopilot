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
  // A capturing `claude` in front of the fixture shim: records the worker's stdin and a copy of the --settings
  // file (the rail removes it when the worker ends), then hands both to the real fixture shim. The capture dir
  // is baked into the wrapper because the child env is an allowlist.
  const cap = path.join(fx.root, 'cap');
  const wrap = path.join(fx.root, 'wrap');
  fs.mkdirSync(cap);
  fs.mkdirSync(wrap);
  fs.writeFileSync(path.join(wrap, 'claude'), [
    `#!${process.execPath}`,
    "'use strict';",
    "const fs = require('fs');",
    `const cap = ${JSON.stringify(cap)};`,
    'const stdin = fs.readFileSync(0);',
    "fs.writeFileSync(cap + '/stdin', stdin);",
    "const i = process.argv.indexOf('--settings');",
    "if (i > 0) { fs.writeFileSync(cap + '/settings-path', process.argv[i + 1]); fs.copyFileSync(process.argv[i + 1], cap + '/settings.json'); }",
    `const r = require('child_process').spawnSync(process.execPath, [${JSON.stringify(fx.shim.shimPath)}, ...process.argv.slice(2)], { input: stdin, stdio: ['pipe', 'inherit', 'inherit'] });`,
    'process.exitCode = r.status;',
    '',
  ].join('\n'), { mode: 0o755 });
  env.PATH = `${wrap}:${env.PATH}`;
  spawnSync('node', [path.join(SCRIPTS, 'run-approval.js'), 'confirm-claude-native'], { env, stdio: 'ignore' });
  return { fx, repo, prompt, rules, env, cap };
}

function dispatch(w, rail, extra) {
  const r = spawnSync(rail, ['--runner', 'claude-native', '--model', 'claude-sonnet-4-6', '--prompt-file', w.prompt,
    '--context-window', 'off', '--branch', 'feat/g37-' + Math.random().toString(36).slice(2, 8), ...(extra || [])],
  { cwd: w.repo, env: w.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// A farm of the scripts dir (symlinks) where the named files are replaced: edits = { name: (src) => src | string }.
// A function-valued edit receives the real file text; a string edit is written verbatim.
function farmWith(w, edits) {
  // The farm keeps the repo layout (scripts/ beside src/, hooks/, ...) so `../src/...` requires still resolve;
  // a farm that cannot resolve them fails every mutation for a reason that has nothing to do with the mutation.
  const farmRoot = path.join(w.fx.root, 'farm-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(farmRoot);
  const repoRoot = path.resolve(SCRIPTS, '..');
  for (const n of fs.readdirSync(repoRoot)) {
    if (n === 'scripts' || n === '.git') continue;
    fs.symlinkSync(path.join(repoRoot, n), path.join(farmRoot, n));
  }
  const d = path.join(farmRoot, 'scripts');
  fs.mkdirSync(d);
  for (const n of fs.readdirSync(SCRIPTS)) {
    if (Object.prototype.hasOwnProperty.call(edits, n)) continue;
    fs.symlinkSync(path.join(SCRIPTS, n), path.join(d, n));
  }
  for (const [n, e] of Object.entries(edits)) {
    let out = e;
    if (typeof e === 'function') {
      const src = fs.readFileSync(path.join(SCRIPTS, n), 'utf8');
      out = e(src);
      assert.notEqual(out, src, 'mutation matched nothing in ' + n);
    }
    fs.writeFileSync(path.join(d, n), out, { mode: 0o755 });
  }
  return path.join(d, 'dispatch-hetero.sh');
}
// A stand-in claude-account.js: env-check prints $G37_STUB_OUT (exit $G37_STUB_RC); any other subcommand is
// recorded in $G37_STUB_LOG and exits 0 (a call there means the rail tried to spend).
const STUB_ACCOUNT_JS = [
  "const fs = require('fs'); const a = process.argv[2];",
  "if (a === 'env-check') { process.stdout.write(process.env.G37_STUB_OUT || ''); process.exit(Number(process.env.G37_STUB_RC || 0)); }",
  "fs.appendFileSync(process.env.G37_STUB_LOG, a + '\\n'); process.exit(0);",
  '',
].join('\n');

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
  // gate-rules: --settings points at the per-run gate settings file (not just "some --settings"), whose Stop
  // hook runs the per-turn gate, and the worker received the combined prompt on stdin.
  const si = c.argv.indexOf('--settings');
  assert.ok(si >= 0 && c.argv[si + 1], 'gate-rules settings argument preserved');
  assert.match(path.basename(c.argv[si + 1]), /^dispatch-hetero-gate-settings-/, 'the --settings value is the per-run gate settings file');
  assert.equal(fs.readFileSync(path.join(w.cap, 'settings-path'), 'utf8'), c.argv[si + 1]);
  const gate = JSON.parse(fs.readFileSync(path.join(w.cap, 'settings.json'), 'utf8'));
  assert.match(gate.hooks.Stop[0].hooks[0].command, /per-turn-gate\.js/, 'the settings file carries the per-turn gate Stop hook');
  assert.match(fs.readFileSync(path.join(w.cap, 'stdin'), 'utf8'), /do work/, 'the shim received the prompt on stdin');
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

test('mode_off: legacy seeded path, one spawn, no alias', () => {
  const w = world();
  try {
    w.env.AUTOPILOT_ACCOUNT_MODE = 'off';
    const r = dispatch(w, REAL_RAIL);
    assert.match(r.out, /"status": "no_op".*agent exit 0/s, r.out);
    const calls = readLog(w.fx.shim.log);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].account, null);
    assert.equal(calls[0].fp, '');
  } finally { w.fx.cleanup(); }
});

test('unrecognised env-check output (garbage / empty / near-miss words): invalid, spawn 0, nothing started', () => {
  const w = world();
  try {
    const rail = farmWith(w, { 'claude-account.js': STUB_ACCOUNT_JS });
    // positive control: the stub itself works. `unconfigured` through the stub is the legacy path (shim spawns once),
    // so a spawn-0 result below cannot be a stub that crashes (rc != 0 would also read as invalid).
    w.env.G37_STUB_OUT = 'unconfigured\n';
    w.env.G37_STUB_LOG = path.join(w.fx.root, 'stub-pos.log');
    fs.writeFileSync(w.env.G37_STUB_LOG, '');
    dispatch(w, rail);
    assert.equal(readLog(w.fx.shim.log).length, 1, 'positive control: the stub reporting unconfigured reaches the legacy spawn');
    fs.writeFileSync(w.fx.shim.log, '');
    for (const out of ['garbage\n', '', 'okay alias=a\n', 'Unconfigured\n', ' ok alias=a\n']) {
      const log = path.join(w.fx.root, 'stub.log');
      fs.writeFileSync(log, '');
      w.env.G37_STUB_OUT = out;
      w.env.G37_STUB_LOG = log;
      const r = dispatch(w, rail);
      assert.notEqual(r.rc, 0, `[${JSON.stringify(out)}] ` + r.out.slice(0, 300));
      assert.equal(readLog(w.fx.shim.log).length, 0, `[${JSON.stringify(out)}] shim spawn count 0`);
      assert.equal(fs.readFileSync(log, 'utf8'), '', `[${JSON.stringify(out)}] claude-account run/exec never called`);
    }
  } finally { w.fx.cleanup(); }
});

test('mutation: wiring removed (state forced to legacy) -> the registry-present check goes red', () => {
  const w = world();
  try {
    const rail = farmWith(w, { 'dispatch-hetero.sh': (s) => s.replace('  account_layer_state "$SELF_DIR/claude-account.js" hetero-impl\n', '  echo legacy\n') });
    assert.throws(() => checkWired(w, rail), /alias reached the shim/);
  } finally { w.fx.cleanup(); }
});

test('mutation: --settings dropped from the account arm -> the gate-rules assertion goes red', () => {
  const w = world();
  try {
    const rail = farmWith(w, { 'dispatch-hetero.sh': (s) => s.replace('        ${GATE_ARGV[@]+--settings "${GATE_ARGV[0]}"} --output-format json)\n      run_worker node', '        --output-format json)\n      run_worker node') });
    assert.throws(() => checkWired(w, rail), /settings argument preserved/);
  } finally { w.fx.cleanup(); }
});

test('mutation: invalid registry treated as legacy -> N9 goes red because the OLD claude path spawned the shim', () => {
  const w = world();
  try {
    const rail = farmWith(w, { 'dispatch-hetero.sh': (s) => s.replace('  account_layer_state "$SELF_DIR/claude-account.js" hetero-impl\n',
      '  if [ "$(account_layer_state "$SELF_DIR/claude-account.js" hetero-impl)" = active ]; then echo active; else echo legacy; fi\n') });
    fs.writeFileSync(w.fx.regFile, '{ not json');
    dispatch(w, rail);
    const calls = readLog(w.fx.shim.log);
    assert.equal(calls.length, 1, 'fail-open: the shim was spawned although the registry is broken (N9 would be red)');
    assert.equal(calls[0].account, null, '...on the old seeded path: no alias');
    assert.equal(calls[0].fp, '', '...and no alias token');
  } finally { w.fx.cleanup(); }
});

test('mutation: account-state.sh default arm = legacy -> the unrecognised-output case goes red (old path spawned)', () => {
  const w = world();
  try {
    const libDir = path.join(w.fx.root, 'libcopy');
    fs.cpSync(path.join(SCRIPTS, 'lib'), libDir, { recursive: true });
    const sh = path.join(libDir, 'account-state.sh');
    const src = fs.readFileSync(sh, 'utf8');
    const out = src.replace('    *) echo invalid ;;', '    *) echo legacy ;;');
    assert.notEqual(out, src);
    fs.writeFileSync(sh, out);
    const rail = farmWith(w, { 'claude-account.js': STUB_ACCOUNT_JS, 'dispatch-hetero.sh': fs.readFileSync(REAL_RAIL, 'utf8') });
    const farm = path.dirname(rail);
    fs.rmSync(path.join(farm, 'lib'));
    fs.symlinkSync(libDir, path.join(farm, 'lib'));
    w.env.G37_STUB_OUT = 'garbage\n';
    w.env.G37_STUB_LOG = path.join(w.fx.root, 'stub.log');
    fs.writeFileSync(w.env.G37_STUB_LOG, '');
    const r = dispatch(w, rail);
    assert.equal(readLog(w.fx.shim.log).length, 1, 'unrecognised output was treated as legacy: the shim spawned: ' + r.out.slice(0, 500));
  } finally { w.fx.cleanup(); }
});
