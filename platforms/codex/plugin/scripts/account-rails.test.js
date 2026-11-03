#!/usr/bin/env node
'use strict';
// G37 L12 / P6: the total test over every wired claude caller (plan 6 N9, 5.9, 7). Tempdir only, FAKE- tokens, Node shim only;
// nothing here reads a real ~/.claude, a credentials file or ~/.config/autopilot (every env sets AUTOPILOT_ACCOUNTS_DIR).
//
// The caller list is NOT kept here. scripts/lib/claude-spawn-sites.json is the one list: every `wired` site names the suites
// (covered_by) that drive it with the shim, and this file
//   1. checks each covering suite still has the three N9 parts (a good-registry case, a broken-registry case that spawns 0,
//      a mutation case), so deleting one cannot go unnoticed;
//   2. RUNS every covering suite once (the per-caller drivers and mutation tables live in those suites: W1/W2/W3 in
//      hooks/tests/dispatch-{review,author}-account-rail.test.sh and scripts/dispatch-hetero-account.test.js, W4 in
//      scripts/account-rails-w4.test.js, W5 in scripts/eval-account-rails.test.js, P4 in scripts/lane-reopen.test.js);
//   3. holds the one env-check reading rule against all four readers (account-state.sh, account-rail.js, eval-account.js, eval-account.sh);
//   4. asserts that a claude child does not outlive an outer `timeout` (TERM, and -k KILL) - cases that are known to leak are
//      `todo` with the observed leak, so the suite stays honest and goes green-with-notice when the leak is fixed;
//   5. proves the test/registry isolation: hooks/tests/lib.sh, run.sh and affected-suites.js pin AUTOPILOT_ACCOUNTS_DIR to a path
//      that does not exist, and a broken registry pointed at a real suite goes red only when the isolation is switched off.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { makeFixture } = require('./lib/account-fixtures/shim-install.js');

const REPO = path.resolve(__dirname, '..');
const REG = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'lib', 'claude-spawn-sites.json'), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const SELF = 'scripts/account-rails.test.js';

// ---------------------------------------------------------------- 1 + 2: the caller list and its suites

const PRELOAD_SRC = [
  "const os = require('os');",
  'const orig = os.userInfo;',
  "os.userInfo = function (o) { return Object.assign({}, orig.call(os, o), { homedir: process.env.G37_TEST_REAL_HOME }); };",
].join('\n');

const wired = REG.sites.filter((s) => s.status === 'wired');
const railSites = wired.filter((s) => s.group !== 'account-layer');
const suitesOf = (sites) => [...new Set(sites.flatMap((s) => s.covered_by || []))].filter((p) => p !== SELF).sort();
const RAIL_SUITES = suitesOf(railSites);

/** What every rail suite must keep: a good-registry case, a broken-registry case (spawn 0) and a mutation case. */
function suiteProblems(text) {
  const p = [];
  if (!/fingerprint|\bfp\b|alias/i.test(text)) p.push('no good-registry case (alias / token fingerprint at the shim)');
  if (!/broken|invalid|unusable/i.test(text)) p.push('no broken-registry case');
  if (!/spawn(s|ed)?\b.{0,40}\b0\b|\b0\b.{0,30}spawn|spawn counter|NSPAWN|spawns?\(\)\s*,\s*0|calls\(\)\.length,\s*0|apiCalls\(.*\)\.length,\s*0|zero/i.test(text)) p.push('the broken-registry case does not assert zero spawns');
  if (!/mutation/i.test(text)) p.push('no mutation case');
  return p;
}

test('N9 list: the wired rails are the registry list, every one is covered by a suite that exists', () => {
  assert.ok(railSites.length >= 20, `only ${railSites.length} wired rail sites registered`);
  for (const s of railSites) {
    assert.ok(Array.isArray(s.covered_by) && s.covered_by.length > 0, `${s.file} has no covered_by`);
    for (const c of s.covered_by) assert.ok(fs.existsSync(path.join(REPO, c)), `${s.file}: covering suite ${c} is missing`);
  }
  // the groups the plan names: A1-A10 and A12 are all present
  const groups = new Set(railSites.map((s) => s.group));
  for (const g of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A12', 'P4']) assert.ok(groups.has(g), `no wired site in group ${g}`);
});

test('N9 shape: every covering suite still holds the good / broken (spawn 0) / mutation parts', () => {
  for (const suite of RAIL_SUITES) {
    if (suite === 'scripts/lane-reopen.test.js') continue; // P4 has its own N11 shape (fake tmux), not the spawn counter
    assert.deepStrictEqual(suiteProblems(read(suite)), [], `${suite}`);
  }
});

test('N9 shape: the check itself rejects a suite that lost one of the parts (negative control)', () => {
  const good = read('scripts/account-rails-w4.test.js');
  assert.deepStrictEqual(suiteProblems(good), []);
  assert.ok(suiteProblems(good.replace(/mutation/gi, 'm')).some((x) => /mutation/.test(x)));
  assert.ok(suiteProblems(good.replace(/broken|invalid|unusable/gi, 'x')).some((x) => /broken-registry case$/.test(x)));
  assert.ok(suiteProblems('test("x", () => {});').length >= 3);
});

function runSuite(rel, env) {
  return new Promise((resolve) => {
    const isSh = rel.endsWith('.sh');
    const child = spawn(isSh ? 'bash' : process.execPath, isSh ? [path.join(REPO, rel)] : ['--test', path.join(REPO, rel)], {
      cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), 600000);
    child.on('close', (code) => { clearTimeout(t); resolve({ rel, code, tail: out.split('\n').slice(-25).join('\n') }); });
  });
}

test('N9 run: every covering suite is green (good registry -> alias token at the shim; broken -> spawn 0; mutations red)', { timeout: 1200000 }, async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'g37-rails-'));
  const env = Object.assign({}, process.env, {
    AUTOPILOT_ACCOUNTS_DIR: path.join(sandbox, 'no-accounts'), // a suite that needs a registry builds its own fixture
    ENGINE_CAPABILITY_DIR: path.join(sandbox, 'cap'), AUTOPILOT_STRIKE_WRITER: 'off',
  });
  delete env.AUTOPILOT_SESSION_ID;
  delete env.AUTOPILOT_TEST_KEEP_ACCOUNTS_DIR;
  const queue = RAIL_SUITES.slice();
  const results = [];
  const worker = async () => { for (let s = queue.shift(); s; s = queue.shift()) results.push(await runSuite(s, env)); };
  await Promise.all([worker(), worker()]); // two at a time: the longest suites (hetero, w4) overlap, nothing more
  fs.rmSync(sandbox, { recursive: true, force: true });
  const bad = results.filter((r) => r.code !== 0);
  assert.deepStrictEqual(bad.map((r) => r.rel), [], bad.map((r) => `--- ${r.rel} rc=${r.code}\n${r.tail}`).join('\n'));
  assert.strictEqual(results.length, RAIL_SUITES.length);
});

// ---------------------------------------------------------------- 2b: run-d0gate-v2-campaign.js (A12): refuses, never falls back

test('A12 run-d0gate-v2-campaign.js: a registry (usable or broken) refuses the real run with exit 2 before any claude is started', { timeout: 120000 }, () => {
  for (const mode of ['active', 'broken']) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }] });
    try {
      if (mode === 'broken') fs.chmodSync(fx.regFile, 0o644);
      const pre = path.join(fx.root, 'pre.js');
      fs.writeFileSync(pre, PRELOAD_SRC);
      const env = Object.assign({}, fx.env, { NODE_OPTIONS: `--require ${pre}`, G37_TEST_REAL_HOME: fx.realHome });
      delete env.AUTOPILOT_SESSION_ID;
      const r = spawnSync(process.execPath, [path.join(REPO, 'evals', 'skill-onoff', 'run-d0gate-v2-campaign.js'), '--runner', 'cc', '--pilot', '--results', path.join(fx.root, 'res.jsonl')], { env, encoding: 'utf8', timeout: 60000 });
      assert.strictEqual(r.status, 2, `${mode}: ${r.stderr}`);
      assert.strictEqual(fx.shim.spawns(), 0, `${mode}: a claude was started`);
      assert.match(r.stderr, mode === 'active' ? /account registry is configured/ : /account registry is unusable/);
      assert.ok(!fs.existsSync(path.join(fx.root, 'res.jsonl')), `${mode}: a results row was written`);
    } finally { fx.cleanup(); }
  }
});

test('A12 run-d0gate-v2-campaign.js: the gate sits before the first claude lookup (mutation: moving it after is detected)', () => {
  const src = read('evals/skill-onoff/run-d0gate-v2-campaign.js');
  const gate = src.indexOf("eval-account.js').gate(");
  const lookup = src.indexOf('cc.whichClaude(');
  assert.ok(gate > 0 && lookup > 0 && gate < lookup, 'gate() must precede whichClaude()');
  const swapped = src.replace("eval-account.js').gate(", 'XX').replace('cc.whichClaude(', "eval-account.js').gate(").replace('XX', 'cc.whichClaude(');
  assert.ok(swapped.indexOf("eval-account.js').gate(") > swapped.indexOf('cc.whichClaude('), 'the order check is blind to a moved gate');
});

// ---------------------------------------------------------------- 3: the one env-check reading rule

const ROWS = [
  [0, 'unconfigured\n', 'legacy'], [0, 'mode_off\n', 'legacy'], [0, 'ok alias=a\n', 'active'], [0, 'unconfigured\nok\n', 'legacy'],
  [0, '', 'invalid'], [0, 'garbage', 'invalid'], [0, 'Unconfigured', 'invalid'], [0, 'okay', 'invalid'], [0, ' ok alias=a', 'invalid'],
  [2, '', 'invalid'], [2, 'unconfigured', 'invalid'], [3, 'ok alias=a', 'invalid'],
];

/** A copy of the four readers beside a stub claude-account.js whose env-check prints G37_STUB_OUT and exits G37_STUB_RC. */
function readerTree(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g37-readers-'));
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  for (const f of ['account-rail.js', 'eval-account.js', 'eval-account.sh', 'account-state.sh']) {
    let t = read(`scripts/lib/${f}`);
    if (mutate && mutate[f]) t = mutate[f](t);
    fs.writeFileSync(path.join(root, 'scripts', 'lib', f), t);
  }
  fs.writeFileSync(path.join(root, 'scripts', 'claude-account.js'), [
    "const fs = require('fs');",
    "if (process.argv[2] === 'env-check') {",
    "  fs.appendFileSync(process.env.G37_STUB_LOG, process.argv.slice(2).join(' ') + '\\n');",
    "  process.stdout.write(process.env.G37_STUB_OUT || ''); process.exit(Number(process.env.G37_STUB_RC || 0));",
    '}',
    'process.exit(9);',
  ].join('\n'));
  return root;
}

/** -> { 'account-state.sh': word, 'account-rail.js': word, 'eval-account.js': word, 'eval-account.sh': word } for one stub answer. */
function readAll(root, rc, out) {
  const log = path.join(root, 'stub.log');
  fs.rmSync(log, { force: true });
  const env = { PATH: process.env.PATH, HOME: root, G37_STUB_RC: String(rc), G37_STUB_OUT: out, G37_STUB_LOG: log, AUTOPILOT_ACCOUNTS_DIR: path.join(root, 'none') };
  const lib = path.join(root, 'scripts', 'lib');
  const cli = path.join(root, 'scripts', 'claude-account.js');
  const sh = (code) => spawnSync('bash', ['-c', code, 'x', lib, cli], { env, encoding: 'utf8', cwd: root });
  const res = {};
  res['account-state.sh'] = sh('. "$1/account-state.sh"; account_layer_state "$2" t').stdout.trim();
  res['account-rail.js'] = JSON.parse(spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(require(process.argv[1]).layerState({ purpose: "t" })))', path.join(lib, 'account-rail.js')], { env, encoding: 'utf8' }).stdout).state;
  const p = JSON.parse(spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(require(process.argv[1]).probe()))', path.join(lib, 'eval-account.js')], { env, encoding: 'utf8' }).stdout);
  res['eval-account.js'] = p.state === 'broken' ? 'invalid' : p.state;
  const e = sh('. "$1/eval-account.sh"; eval_account_probe t; echo "rc=$? active=${EVAL_ACCOUNT_ACTIVE:-}"').stdout;
  const m = /rc=(\d+) active=(\d*)/.exec(e);
  res['eval-account.sh'] = !m || m[1] !== '0' ? 'invalid' : (m[2] === '1' ? 'active' : 'legacy');
  res.asked = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return res;
}

test('env-check reading rule: all four readers give the same verdict for every stub answer, always asking with --any', () => {
  const root = readerTree();
  try {
    for (const [rc, out, want] of ROWS) {
      const r = readAll(root, rc, out);
      for (const k of ['account-state.sh', 'account-rail.js', 'eval-account.js', 'eval-account.sh']) {
        assert.strictEqual(r[k], want, `${k}: rc=${rc} out=${JSON.stringify(out)} -> ${r[k]}, want ${want}`);
      }
      assert.strictEqual(r.asked.length, 4, `each reader asks env-check once (got ${r.asked.length})`);
      for (const line of r.asked) assert.match(line, /env-check\b.*--any\b/, `reader did not pass --any: ${line}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('env-check reading rule mutation: eval-account.sh failing open on unrecognised output turns the table red', () => {
  const root = readerTree({ 'eval-account.sh': (t) => t.replace(/return 2/g, 'return 0') });
  try {
    const r = readAll(root, 0, 'garbage');
    assert.strictEqual(r['eval-account.sh'], 'legacy', 'the mutated reader should have failed open');
    assert.notStrictEqual(r['eval-account.sh'], 'invalid');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('env-check reading rule mutation: eval-account.js reading invalid as legacy turns the table red', () => {
  const root = readerTree({ 'eval-account.js': (t) => t.replace("r.state === 'invalid'", 'false').replace('return { state: r.state };', "return { state: r.state === 'invalid' ? 'legacy' : r.state };") });
  try {
    assert.strictEqual(readAll(root, 0, 'garbage')['eval-account.js'], 'legacy');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('env-check reading rule mutation: a reader that drops --any is caught', () => {
  const root = readerTree({ 'account-state.sh': (t) => t.replace('env-check --any', 'env-check') });
  try {
    const r = readAll(root, 0, 'ok alias=a');
    assert.ok(r.asked.some((l) => !/--any/.test(l)), 'the mutated reader should have asked without --any');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- 4: grandchild cleanup under an outer timeout


/** pids of live processes whose command line holds `marker` and that run the fixture's claude (the shim), not an account wrapper. */
function claudeChildren(marker, binDir) {
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let c;
    try { c = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0').join(' '); } catch (_) { continue; }
    if (c.includes(binDir) && (c.includes(marker) || c.includes('claude'))) out.push({ pid: Number(d), cmd: c.slice(0, 120) });
  }
  return out;
}
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Runs `timeout [flags] 3 <cmd>` against a hanging claude and returns the claude processes still alive 6 s later (they are killed
 * by pid afterwards). tool: path of the timeout binary. deaf: the claude double ignores SIGTERM.
 */
function orphanRun(tool, flags, kind, deaf) {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const marker = `G37-MARK-${process.pid}-${Date.now()}`;
  try {
    fx.shim.setControl({ default: { exit: 0, stdout: '{}\n', hangMs: 60000 } });
    if (deaf) fs.writeFileSync(path.join(fx.shim.binDir, 'claude'), "#!/usr/bin/env node\nprocess.on('SIGTERM', () => {});setInterval(() => {}, 1000);\n", { mode: 0o755 });
    const pre = path.join(fx.root, 'pre.js');
    fs.writeFileSync(pre, PRELOAD_SRC);
    const env = Object.assign({}, fx.env, { NODE_OPTIONS: `--require ${pre}`, G37_TEST_REAL_HOME: fx.realHome, AUTOPILOT_SETTLE_MS: '0', DISPATCH_QUIET: '1' });
    delete env.AUTOPILOT_SESSION_ID;
    let cmd;
    if (kind === 'run') cmd = [process.execPath, path.join(REPO, 'scripts', 'claude-account.js'), 'run', '--purpose', 't', '--', 'claude', '-p', marker];
    else {
      const diff = path.join(fx.root, 'd.diff');
      fs.writeFileSync(diff, 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n');
      cmd = ['bash', path.join(REPO, 'scripts', 'dispatch-review.sh'), '--runner', 'claude-native', '--model', 'haiku', '--diff-file', diff, '--bin', path.join(fx.shim.binDir, 'claude'), '--timeout', '120s'];
    }
    const t0 = Date.now();
    const r = spawnSync(tool, [...flags, '3', ...cmd], { env, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.ok(Date.now() - t0 < 30000, 'the outer timeout did not return');
    // the claude double was really started (a registry-present run) before the signal
    assert.ok(fx.shim.calls().length >= 1 || deaf, 'the claude double was never started: the case proves nothing');
    let alive = claudeChildren(marker, fx.shim.binDir);
    for (let i = 0; i < 12 && alive.length; i++) { sleepMs(500); alive = claudeChildren(marker, fx.shim.binDir); }
    for (const x of alive) { try { process.kill(x.pid, 'SIGKILL'); } catch (_) { /* gone */ } }
    return { rc: r.status, alive };
  } finally { fx.cleanup(); }
}

const HAVE_GNU = fs.existsSync('/usr/bin/gnutimeout');
const TIMEOUTS = [['host timeout', 'timeout']].concat(HAVE_GNU ? [['GNU timeout', '/usr/bin/gnutimeout']] : []);
// The host `timeout` is uutils 0.8.0 (memory host-timeout-is-uutils): it signals only the child it started, not the process
// group, so a claude grandchild survives a KILL of its parent. GNU timeout signals the group. Both are exercised.
for (const [label, tool] of TIMEOUTS) {
  test(`grandchild cleanup (${label}): claude-account.js run, SIGTERM -> the claude child does not survive`, () => {
    const r = orphanRun(tool, ['-s', 'TERM'], 'run', false);
    assert.deepStrictEqual(r.alive, [], `rc=${r.rc} left ${JSON.stringify(r.alive)}`);
  });
}
test('grandchild cleanup (GNU timeout): claude-account.js run, SIGKILL and TERM-then-KILL with a claude that ignores TERM -> nothing survives', { skip: !HAVE_GNU }, () => {
  assert.deepStrictEqual(orphanRun('/usr/bin/gnutimeout', ['-s', 'KILL'], 'run', false).alive, []);
  assert.deepStrictEqual(orphanRun('/usr/bin/gnutimeout', ['-k', '1', '-s', 'TERM'], 'run', true).alive, []);
});
// KNOWN LEAKS (reported to depth-0 with the G37 L12 report; the fixes touch claude-account.js and the rail, outside L12):
//  (a) host (uutils) timeout, `-k 1` with a claude that ignores TERM: the top process is killed, the claude child is orphaned;
//  (b) host (uutils) timeout, plain KILL of claude-account.js: same, inherent to SIGKILL without a group kill;
//  (c) dispatch-review.sh (registry present) under either timeout: TERM kills the bash rail, claude-account.js and its claude
//      child keep running (the rail documents that INT/TERM are not trapped, dispatch-review.sh:1094).
// They are `todo`: they run and report, they do not fail the suite, and each turns into a pass notice when fixed.
test('grandchild cleanup (host timeout): run, TERM-then-KILL with a claude that ignores TERM', { todo: 'known leak (a): claude-account.js does not escalate to SIGKILL on its child before the outer -k KILL' }, () => {
  assert.deepStrictEqual(orphanRun('timeout', ['-k', '1', '-s', 'TERM'], 'run', true).alive, []);
});
test('grandchild cleanup (host timeout): run, SIGKILL of claude-account.js', { todo: 'known leak (b): SIGKILL of the parent without a process-group kill (uutils timeout)' }, () => {
  assert.deepStrictEqual(orphanRun('timeout', ['-s', 'KILL'], 'run', false).alive, []);
});
for (const [label, tool] of TIMEOUTS) {
  test(`grandchild cleanup (${label}): dispatch-review.sh claude-native arm under a registry, SIGTERM`, { todo: 'known leak (c): the bash rail is killed by TERM, its claude-account.js and claude children are not' }, () => {
    assert.deepStrictEqual(orphanRun(tool, ['-s', 'TERM'], 'review', false).alive, []);
  });
}

// ---------------------------------------------------------------- 5: test / registry isolation

const SUITE_FOR_ISOLATION = 'hooks/tests/agy-remaining-stdin.test.sh'; // a short real suite that runs a wired caller

function brokenRegistryDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'g37-iso-'));
  const acc = path.join(d, 'acc');
  fs.mkdirSync(acc, { mode: 0o700 });
  fs.chmodSync(acc, 0o700);
  fs.writeFileSync(path.join(acc, 'registry.json'), JSON.stringify({ schema: 'autopilot.accounts/1', accounts: [{ alias: 'a', enabled: true, priority: 1 }] }), { mode: 0o644 });
  fs.chmodSync(path.join(acc, 'registry.json'), 0o644); // not 0600: the registry is broken on purpose
  return { d, acc };
}
function runIsolationSuite(extraEnv) {
  const { d, acc } = brokenRegistryDir();
  try {
    const env = Object.assign({}, process.env, { AUTOPILOT_ACCOUNTS_DIR: acc, ENGINE_CAPABILITY_DIR: path.join(d, 'cap'), AUTOPILOT_STRIKE_WRITER: 'off' }, extraEnv);
    delete env.AUTOPILOT_SESSION_ID;
    return spawnSync('bash', [path.join(REPO, SUITE_FOR_ISOLATION)], { cwd: REPO, env, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

test('isolation: hooks/tests/lib.sh replaces the caller\'s registry dir with one that does not exist', () => {
  const probe = [
    '. "$1/hooks/tests/lib.sh"',
    'printf "%s\\n" "$AUTOPILOT_ACCOUNTS_DIR"',
    'if [ -e "$AUTOPILOT_ACCOUNTS_DIR" ]; then echo EXISTS; else echo MISSING; fi',
    'case "$AUTOPILOT_ACCOUNTS_DIR" in "$TEST_TMP"/*) echo UNDER_TEST_TMP ;; esac',
  ].join('\n');
  const { d, acc } = brokenRegistryDir();
  try {
    const r = spawnSync('bash', ['-c', probe, 'x', REPO], { env: Object.assign({}, process.env, { AUTOPILOT_ACCOUNTS_DIR: acc }), encoding: 'utf8' });
    const lines = r.stdout.trim().split('\n');
    assert.ok(!lines[0].startsWith(acc), `the caller's registry dir leaked through: ${lines[0]}`);
    assert.ok(lines.includes('MISSING') && lines.includes('UNDER_TEST_TMP'), r.stdout + r.stderr);
    // KEEP=1 is the only way to keep the caller's value
    const k = spawnSync('bash', ['-c', probe, 'x', REPO], { env: Object.assign({}, process.env, { AUTOPILOT_ACCOUNTS_DIR: acc, AUTOPILOT_TEST_KEEP_ACCOUNTS_DIR: '1' }), encoding: 'utf8' });
    assert.strictEqual(k.stdout.split('\n')[0], acc);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('isolation negative control: a broken registry reaches a real suite only when the isolation is off', { timeout: 300000 }, () => {
  const isolated = runIsolationSuite({});
  assert.strictEqual(isolated.status, 0, `with the isolation on the suite must ignore the registry:\n${(isolated.stdout || '').split('\n').slice(-15).join('\n')}`);
  const kept = runIsolationSuite({ AUTOPILOT_TEST_KEEP_ACCOUNTS_DIR: '1' });
  assert.notStrictEqual(kept.status, 0, 'with the isolation off the broken registry should break the suite (it did not: the case proves nothing)');
});

test('isolation: run.sh and affected-suites.js pin the registry dir; a pin that is removed is detected', () => {
  const pins = {
    'hooks/tests/run.sh': /export AUTOPILOT_ACCOUNTS_DIR="\$\{TMPDIR:-\/tmp\}\/autopilot-no-accounts-/,
    'scripts/affected-suites.js': /process\.env\.AUTOPILOT_ACCOUNTS_DIR\s*=/,
    'hooks/tests/lib.sh': /export AUTOPILOT_ACCOUNTS_DIR="\$TEST_TMP\/no-accounts"/,
  };
  for (const [rel, re] of Object.entries(pins)) {
    const t = read(rel);
    assert.ok(re.test(t), `${rel} does not pin AUTOPILOT_ACCOUNTS_DIR`);
    assert.ok(!re.test(t.replace(/AUTOPILOT_ACCOUNTS_DIR/g, 'X')), `${rel}: the pin check is blind to its removal`);
  }
});

test('isolation: a suite that mentions a wired caller either sources hooks/tests/lib.sh or pins the registry dir itself', () => {
  const names = railSites.filter((s) => !s.file.startsWith('evals/') && !s.file.startsWith('scripts/lib/')).map((s) => path.basename(s.file));
  const loose = [];
  for (const f of fs.readdirSync(path.join(REPO, 'hooks', 'tests'))) {
    if (!f.endsWith('.test.sh')) continue;
    const t = read(`hooks/tests/${f}`);
    if (!names.some((n) => t.includes(n))) continue;
    if (!/lib\.sh/.test(t) && !/AUTOPILOT_ACCOUNTS_DIR/.test(t)) loose.push(f);
  }
  assert.deepStrictEqual(loose, [], 'these suites can reach the operator\'s real account registry when run by hand');
});
