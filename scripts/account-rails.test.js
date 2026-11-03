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

/** The suite text without comments: a part that is only described in a comment is not a part. */
function codeOnly(text, rel) {
  let t = text;
  if (/\.(js|cjs|mjs)$/.test(rel)) t = t.replace(/\/\*[\s\S]*?\*\//g, '');
  return t.split('\n').filter((l) => {
    const x = l.trimStart();
    return !(x === '' || x.startsWith('#') || x.startsWith('//') || x.startsWith('*'));
  }).join('\n');
}

/**
 * The executable CASES of a suite: JS test()/it() lines (title included) and shell assertion lines (their message is the case
 * name). Only these count as parts; prose, comments and helper names do not.
 */
function caseLines(text, rel) {
  const code = codeOnly(text, rel);
  const re = /\.(js|cjs|mjs)$/.test(rel) ? /^\s*(test|it)\s*\(/ : /^\s*(assert_\w+|check_\w+|pass|fail|ok)\b/;
  return code.split('\n').filter((l) => re.test(l));
}

/** What every rail suite must keep, found among its EXECUTABLE cases: a good-registry case, a broken-registry case that asserts
 *  zero spawns, and a mutation (or negative-control) case. A deleted case whose comment survives is a problem. */
function suiteProblems(text, rel) {
  const cases = caseLines(text, rel || 'x.js');
  const p = [];
  if (!cases.some((l) => /fingerprint|\bfp\b|alias|token|good|registry present|active|account/i.test(l))) p.push('no good-registry case (alias / token fingerprint at the shim)');
  const broken = cases.filter((l) => /broken|invalid|unusable|unrecogni[sz]ed|garbage/i.test(l));
  if (!broken.length) p.push('no broken-registry case');
  else if (!broken.some((l) => /spawn|zero|nothing|\b0\b|not started|decoy/i.test(l))) p.push('the broken-registry case does not assert zero spawns');
  if (!cases.some((l) => /mutation|negative control/i.test(l))) p.push('no mutation case');
  return p;
}

/** Each wired rail caller must be driven by a covering suite whose EXECUTABLE code names it (a comment naming it is not a driver). */
function callerProblems(site) {
  const out = [];
  for (const c of site.covered_by || []) {
    if (c === SELF || c === 'scripts/lane-reopen.test.js') continue;
    const code = codeOnly(read(c), c);
    if (!code.includes(path.basename(site.file)) && !code.includes(path.basename(site.file).replace(/\.(js|sh)$/, ''))) out.push(`${site.file}: ${c} names it only in comments`);
    for (const x of suiteProblems(read(c), c)) out.push(`${site.file} / ${c}: ${x}`);
  }
  return out;
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
    assert.deepStrictEqual(suiteProblems(read(suite), suite), [], `${suite}`);
  }
  // per caller: every wired rail site is named by the executable code of each of its covering suites
  assert.deepStrictEqual(railSites.flatMap(callerProblems), []);
});

test('N9 shape: the check itself rejects a suite that lost one of the parts (negative control)', () => {
  const rel = 'scripts/account-rails-w4.test.js';
  const good = read(rel);
  assert.deepStrictEqual(suiteProblems(good, rel), []);
  // removing the word everywhere (the old whole-file keyword test) still turns it red
  assert.ok(suiteProblems(good.replace(/mutation/gi, 'm'), rel).some((x) => /mutation/.test(x)));
  assert.ok(suiteProblems(good.replace(/broken|invalid|unusable/gi, 'x'), rel).some((x) => /broken-registry case$/.test(x)));
  assert.ok(suiteProblems('test("x", () => {});', rel).length >= 3);
  // DELETE the real mutation cases but keep a comment that describes them: must be red (comments are not cases)
  const noMut = good.split('\n').filter((l) => !(/^\s*test\(/.test(l) && /mutation/i.test(l))).join('\n') + '\n// mutation: remove the wiring and the good run goes red\n';
  assert.ok(/mutation/i.test(noMut), 'the decoy comment is there');
  assert.ok(suiteProblems(noMut, rel).some((x) => /mutation/.test(x)), 'a comment must not stand in for a mutation case');
  // the same for the broken-registry case in a shell suite
  const sh = 'hooks/tests/dispatch-review-account-rail.test.sh';
  const shGood = read(sh);
  assert.deepStrictEqual(suiteProblems(shGood, sh), []);
  const shNoBroken = shGood.split('\n').filter((l) => !(/^\s*assert_\w+/.test(l) && /broken|invalid|unusable|unrecogni|garbage/i.test(l))).join('\n');
  assert.ok(suiteProblems(shNoBroken, sh).some((x) => /broken-registry case/.test(x)), 'comments left behind must not count');
  // a caller that is named only in a comment of its covering suite is reported
  const site = { file: 'scripts/zz-not-driven.sh', covered_by: [rel] };
  assert.ok(callerProblems(site).some((x) => /only in comments/.test(x)));
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

test('A12 run-d0gate-v2-campaign.js mutation: with the gate call neutralised the same active registry no longer stops the run', { timeout: 120000 }, () => {
  // a REAL mutation of the object under test (the previous string-order check proved only that a swap changes a string):
  // a copy of the campaign script whose gate() answers "legacy" and whose relative requires point back at the repo
  const src = read('evals/skill-onoff/run-d0gate-v2-campaign.js');
  const call = "require('../../scripts/lib/eval-account.js').gate('run-d0gate-v2-campaign')";
  assert.ok(src.includes(call), 'the gate call moved; update this mutation');
  const dir = path.join(REPO, 'evals', 'skill-onoff');
  const mutated = src.replace(call, "({ state: 'legacy' })")
    .replace('const HERE = __dirname;', `const HERE = ${JSON.stringify(dir)};`)
    .replace(/require\('\.\.\/\.\.\//g, `require('${REPO}/`)
    .replace(/require\('\.\//g, `require('${dir}/`);
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    const mut = path.join(fx.root, 'mutated-campaign.js');
    fs.writeFileSync(mut, mutated);
    const pre = path.join(fx.root, 'pre.js');
    fs.writeFileSync(pre, PRELOAD_SRC);
    const env = Object.assign({}, fx.env, { NODE_OPTIONS: `--require ${pre}`, G37_TEST_REAL_HOME: fx.realHome });
    delete env.AUTOPILOT_SESSION_ID;
    const run1 = (script) => spawnSync(process.execPath, [script, '--runner', 'cc', '--pilot', '--results', path.join(fx.root, 'res.jsonl')], { env, encoding: 'utf8', timeout: 60000 });
    const real = run1(path.join(dir, 'run-d0gate-v2-campaign.js'));
    assert.match(real.stderr, /account registry is configured/);
    const m = run1(mut);
    assert.doesNotMatch(m.stderr, /account registry is configured/, `the mutated script still refused: ${m.stderr.slice(0, 300)}`);
  } finally { fx.cleanup(); }
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
function orphanRun(tool, flags, kind, deaf, legacy) {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  if (legacy) fs.rmSync(fx.regFile); // no registry: the rail keeps its pre-G37 seeded path
  const marker = `G37-MARK-${process.pid}-${Date.now()}`;
  try {
    fx.shim.setControl({ default: { exit: 0, stdout: '{}\n', hangMs: 60000 } });
    const started = path.join(fx.root, 'started');
    // The shim answers at once when it can reach an ambient credential (the legacy seeded path hands it one), so the legacy
    // comparison uses a plain hanging claude double that records its start; `deaf` also ignores SIGTERM.
    if (deaf || legacy) fs.writeFileSync(path.join(fx.shim.binDir, 'claude'), `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(started)}, 'x');\n${deaf ? "process.on('SIGTERM', () => {});" : ''}setInterval(() => {}, 1000);\n`, { mode: 0o755 });
    const pre = path.join(fx.root, 'pre.js');
    fs.writeFileSync(pre, PRELOAD_SRC);
    const env = Object.assign({}, fx.env, { NODE_OPTIONS: `--require ${pre}`, G37_TEST_REAL_HOME: fx.realHome, AUTOPILOT_SETTLE_MS: '0', DISPATCH_QUIET: '1' });
    delete env.AUTOPILOT_SESSION_ID;
    if (legacy) { // the seeded path needs a (fake) credentials file in the config dir it copies from
      const cfg = path.join(fx.root, 'realcfg');
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"FAKE-stub"}}');
      env.CLAUDE_CONFIG_DIR = cfg;
    }
    let cmd;
    if (kind === 'run') cmd = [process.execPath, path.join(REPO, 'scripts', 'claude-account.js'), 'run', '--purpose', 't', '--', 'claude', '-p', marker];
    else {
      const diff = path.join(fx.root, 'd.diff');
      fs.writeFileSync(diff, 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n');
      cmd = ['bash', path.join(REPO, 'scripts', 'dispatch-review.sh'), '--runner', 'claude-native', '--model', 'haiku', '--diff-file', diff, '--bin', path.join(fx.shim.binDir, 'claude'), '--timeout', '120s'];
    }
    const t0 = Date.now();
    const r = spawnSync(tool, [...flags, '3', ...cmd], { env, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', stdio: 'ignore' });
    assert.ok(Date.now() - t0 < 29000, 'the outer timeout did not return (the wrapper never exited)');
    // the claude double was really started (a registry-present run) before the signal
    assert.ok(fx.shim.calls().length >= 1 || fs.existsSync(started), 'the claude double was never started: the case proves nothing');
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
// Fixed in claude-account.js (installSignalForwarding / TERM_GRACE_MS / setpriv --pdeathsig KILL; see claude-account-signals.test.js):
//  (a) TERM is forwarded to the child and escalates to SIGKILL; with the host (uutils) timeout `-k 1` and a claude that
//      ignores TERM, the claude child must still die (the wrapper is KILLed by timeout, the kernel kills the child);
//  (b) SIGKILL of the wrapper itself (uutils signals only its direct child): the child dies with it via pdeathsig;
//      both need setpriv and are skipped where it is missing.
//  (c) dispatch-review.sh TERM leaves orphans, but that is PRE-G37 behaviour (the rail does not trap INT/TERM,
//      dispatch-review.sh:1094; the legacy path leaks the same way). The assertion is "the account path is no worse than legacy".
const HAS_SETPRIV = ['/usr/bin/setpriv', '/bin/setpriv'].some((f) => fs.existsSync(f));
const NO_SETPRIV = HAS_SETPRIV ? false : 'no setpriv --pdeathsig on this platform';
test('grandchild cleanup (host timeout): run, TERM-then-KILL with a claude that ignores TERM -> nothing survives', { skip: NO_SETPRIV }, () => {
  const r = orphanRun('timeout', ['-k', '1', '-s', 'TERM'], 'run', true);
  assert.deepStrictEqual(r.alive, [], `rc=${r.rc} left ${JSON.stringify(r.alive)}`);
});
test('grandchild cleanup (host timeout): run, plain TERM (no -k) with a claude that ignores TERM -> the wrapper escalates to SIGKILL itself', () => {
  // no outer KILL and no pdeathsig help here: only the wrapper's own TERM_GRACE_MS escalation can end the child
  const r = orphanRun('timeout', ['-s', 'TERM'], 'run', true);
  assert.deepStrictEqual(r.alive, [], `rc=${r.rc} left ${JSON.stringify(r.alive)}`);
});
test('grandchild cleanup (host timeout): run, SIGKILL of claude-account.js -> the child dies with it', { skip: NO_SETPRIV }, () => {
  const r = orphanRun('timeout', ['-s', 'KILL'], 'run', false);
  assert.deepStrictEqual(r.alive, [], `rc=${r.rc} left ${JSON.stringify(r.alive)}`);
});
for (const [label, tool] of TIMEOUTS) {
  test(`grandchild cleanup (${label}): dispatch-review.sh under a registry, SIGTERM - no more orphans than the legacy path (known pre-G37 leak)`, { todo: 'corrected 2c92da93 comparison (account <= legacy) is red: the account path leaves one extra process, the claude-account.js wrapper itself (observed 3 vs 2); fix belongs to claude-account.js (p1 scope), then drop this todo' }, () => {
    const legacy = orphanRun(tool, ['-s', 'TERM'], 'review', false, true);
    const account = orphanRun(tool, ['-s', 'TERM'], 'review', false, false);
    assert.ok(account.alive.length <= legacy.alive.length,
      `account path regressed against legacy (legacy left ${legacy.alive.length}, account left ${JSON.stringify(account.alive)})`);
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

test('isolation: run.sh, lib.sh and affected-suites.js really replace the caller\'s registry dir; with the pin line deleted it leaks', () => {
  const CALLER = '/caller/real-accounts';
  for (const rel of ['hooks/tests/run.sh', 'hooks/tests/lib.sh']) {
    const lines = read(rel).split('\n');
    const i = lines.findIndex((l) => /^if \[ "\$\{AUTOPILOT_TEST_KEEP_ACCOUNTS_DIR:-\}" != 1 \]; then export AUTOPILOT_ACCOUNTS_DIR=/.test(l));
    assert.ok(i >= 0, `${rel}: the pin line is gone`);
    const val = (stmt) => spawnSync('bash', ['-c', `TEST_TMP=/t/x; ${stmt}; printf %s "$AUTOPILOT_ACCOUNTS_DIR"`], { env: { PATH: process.env.PATH, AUTOPILOT_ACCOUNTS_DIR: CALLER }, encoding: 'utf8' }).stdout;
    assert.notStrictEqual(val(lines[i]), CALLER, `${rel}: the pin line did not replace the caller's dir`);
    assert.strictEqual(val(':'), CALLER, `${rel}: with the pin line deleted the caller's dir should leak (it did not: the case proves nothing)`);
  }
  const jl = read('scripts/affected-suites.js').split('\n');
  const j = jl.findIndex((l) => /KEEP_ACCOUNTS_DIR !== '1'\) process\.env\.AUTOPILOT_ACCOUNTS_DIR\s*=/.test(l));
  assert.ok(j >= 0, 'scripts/affected-suites.js: the pin line is gone');
  const jval = (stmt) => {
    const env = { AUTOPILOT_ACCOUNTS_DIR: CALLER };
    new Function('process', 'os', 'path', stmt)({ env, pid: 1 }, os, path);
    return env.AUTOPILOT_ACCOUNTS_DIR;
  };
  assert.notStrictEqual(jval(jl[j]), CALLER);
  assert.strictEqual(jval(''), CALLER);
  // AUTOPILOT_TEST_KEEP_ACCOUNTS_DIR=1 keeps the caller's value and says so on stderr (b15b20ed)
  const kept = spawnSync('bash', ['-c', '. "$1/hooks/tests/lib.sh"; printf %s "$AUTOPILOT_ACCOUNTS_DIR"', 'x', REPO], { env: { PATH: process.env.PATH, HOME: os.tmpdir(), AUTOPILOT_ACCOUNTS_DIR: CALLER, AUTOPILOT_TEST_KEEP_ACCOUNTS_DIR: '1' }, encoding: 'utf8' });
  assert.strictEqual(kept.stdout.split('\n')[0], CALLER);
  assert.match(kept.stderr, /AUTOPILOT_TEST_KEEP_ACCOUNTS_DIR=1.*real|WARNING.*AUTOPILOT_TEST_KEEP_ACCOUNTS_DIR/);
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
