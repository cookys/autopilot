#!/usr/bin/env node
/**
 * Unit & reverse-probe tests for scripts/eval-skill-triggers.js.
 * Uses an injected fake runner (never spawns real claude).
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseStreamJsonTriggers,
  runSuite,
} = require('../eval-skill-triggers.js');

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`PASS: ${name}\n`);
  } catch (err) {
    process.stderr.write(`FAIL: ${name}\n${err.stack || err}\n`);
    process.exitCode = 1;
  }
}

function makeTempFixtures(shouldTriggerLines, shouldNotTriggerLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-triggers-test-'));
  const posFile = path.join(dir, 'pos.txt');
  const negFile = path.join(dir, 'neg.txt');
  const outFile = path.join(dir, 'out.json');
  fs.writeFileSync(posFile, shouldTriggerLines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(negFile, shouldNotTriggerLines.join('\n') + '\n', 'utf8');
  return { dir, posFile, negFile, outFile };
}

test('reverse probe: system/init-only stream fixture must be judged NOT triggered', () => {
  const initOnlyStream = [
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      skills: ['autopilot:dev-flow', 'autopilot:debug'],
    }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Sure, here is the answer.' }] },
    }),
    JSON.stringify({ type: 'result', total_cost_usd: 0.01 }),
  ].join('\n');

  const parsed = parseStreamJsonTriggers(initOnlyStream);
  assert.deepEqual(parsed.triggeredSkills, []);
  assert.equal(parsed.costUsd, 0.01);

  const fx = makeTempFixtures(
    ['autopilot:dev-flow | start coding', 'autopilot:dev-flow | 開始寫程式'],
    ['autopilot:dev-flow | what is TCP?']
  );
  try {
    const res = runSuite(
      {
        shouldTrigger: fx.posFile,
        shouldNotTrigger: fx.negFile,
        out: fx.outFile,
        pluginDir: process.cwd(),
        timeoutMs: 5000,
      },
      { runner: () => initOnlyStream }
    );
    assert.equal(res.report.skills['autopilot:dev-flow'].positive_hits, 0);
    assert.equal(res.report.skills['autopilot:dev-flow'].hit_rate, 0);
    assert.equal(res.report.skills['autopilot:dev-flow'].negative_hits, 0);
    assert.equal(res.report.skills['autopilot:dev-flow'].false_positive_rate, 0);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('reverse probe: unrelated skill description causes hit_rate drop and non-zero --compare', () => {
  const fx = makeTempFixtures(
    ['autopilot:debug | fix crash', 'autopilot:debug | 除錯測試'],
    ['autopilot:debug | hello']
  );
  const baselineFile = path.join(fx.dir, 'baseline.json');
  fs.writeFileSync(
    baselineFile,
    JSON.stringify({
      skills: {
        'autopilot:debug': { hit_rate: 1.0, false_positive_rate: 0.0 },
      },
    }),
    'utf8'
  );

  // Simulate unrelated description: assistant never invokes Skill tool_use
  const brokenRunner = () =>
    [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'No skill matched.' }] },
      }),
      JSON.stringify({ type: 'result', total_cost_usd: 0.005 }),
    ].join('\n');

  try {
    const res = runSuite(
      {
        shouldTrigger: fx.posFile,
        shouldNotTrigger: fx.negFile,
        out: fx.outFile,
        compare: baselineFile,
        pluginDir: process.cwd(),
        timeoutMs: 5000,
      },
      { runner: brokenRunner }
    );
    assert.equal(res.report.skills['autopilot:debug'].hit_rate, 0);
    assert.ok(res.regressions.length > 0);
    assert.equal(res.exitCode, 1);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('budget stop-loss stops early, writes partial --out, and exits non-zero', () => {
  const fx = makeTempFixtures(
    [
      'autopilot:dev-flow | p1',
      'autopilot:dev-flow | p2',
      'autopilot:debug | p3',
    ],
    ['autopilot:dev-flow | n1']
  );
  let calls = 0;
  const expensiveRunner = ({ skill }) => {
    calls += 1;
    return [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] },
      }),
      JSON.stringify({ type: 'result', total_cost_usd: 0.6 }),
    ].join('\n');
  };

  try {
    const res = runSuite(
      {
        shouldTrigger: fx.posFile,
        shouldNotTrigger: fx.negFile,
        out: fx.outFile,
        budgetUsd: 1.0,
        pluginDir: process.cwd(),
        timeoutMs: 5000,
      },
      { runner: expensiveRunner }
    );
    assert.equal(calls, 2);
    assert.equal(res.budgetExceeded, true);
    assert.equal(res.report.partial, true);
    assert.equal(res.exitCode, 2);
    assert.ok(fs.existsSync(fx.outFile));
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('runner receives isolated temp HOME and CLAUDE_CONFIG_DIR', () => {
  const fx = makeTempFixtures(['autopilot:next | what next?'], []);
  let seenHome = null;
  let seenConfig = null;
  const inspectRunner = ({ env }) => {
    seenHome = env.HOME;
    seenConfig = env.CLAUDE_CONFIG_DIR;
    return JSON.stringify({ type: 'result', total_cost_usd: 0 });
  };

  try {
    runSuite(
      {
        shouldTrigger: fx.posFile,
        shouldNotTrigger: fx.negFile,
        pluginDir: process.cwd(),
        timeoutMs: 5000,
      },
      { runner: inspectRunner }
    );
    assert.ok(seenHome && seenHome !== process.env.HOME);
    assert.ok(seenConfig && seenConfig !== process.env.CLAUDE_CONFIG_DIR);
    assert.equal(fs.existsSync(seenHome), false);
    assert.equal(fs.existsSync(seenConfig), false);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ---- N9 account-rail cases (claude-spawn-sites S7): the eval spawns claude through `claude-account.js exec --pick`.
// Tempdir fixture, FAKE- tokens, Node claude shim; os.userInfo() pinned to the fixture home by a --require preload.
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { makeFixture } = require('../lib/account-fixtures/shim-install.js');
const SCRIPTS_DIR = path.resolve(__dirname, '..');
const fpOf = (tok) => crypto.createHash('sha256').update(tok).digest('hex').slice(0, 8);

function n9Run(mode, scriptsDir) {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
  try {
    fx.shim.setControl({ default: { exit: 0, stdout: `${JSON.stringify({ type: 'result', total_cost_usd: 0 })}\n` } });
    if (mode === 'broken') fs.chmodSync(fx.regFile, 0o644);
    const preload = path.join(fx.root, 'preload.js');
    fs.writeFileSync(preload, [
      "const os = require('os'); const orig = os.userInfo;",
      "os.userInfo = function (o) { return Object.assign({}, orig.call(os, o), { homedir: process.env.G37_TEST_REAL_HOME }); };",
    ].join('\n'));
    const pos = path.join(fx.root, 'pos.txt');
    fs.writeFileSync(pos, 'autopilot:next | what next?\n');
    const neg = path.join(fx.root, 'neg.txt');
    fs.writeFileSync(neg, '');
    const env = Object.assign({}, fx.env, { NODE_OPTIONS: `--require ${preload}`, G37_TEST_REAL_HOME: fx.realHome });
    delete env.AUTOPILOT_SESSION_ID;
    const r = spawnSync(process.execPath, [path.join(scriptsDir, 'eval-skill-triggers.js'), '--should-trigger', pos, '--should-not-trigger', neg,
      '--plugin-dir', path.resolve(SCRIPTS_DIR, '..'), '--timeout-ms', '60000'], { env, encoding: 'utf8', timeout: 120000 });
    const calls = fx.shim.calls().filter((c) => !c.argv.includes('--version'));
    return { code: r.status, stderr: r.stderr, calls, tok: fpOf(fx.tokens.a) };
  } finally { fx.cleanup(); }
}
const n9Good = (r) => r.code === 0 && r.calls.length > 0 && r.calls.every((c) => c.fp === r.tok && c.account === 'a' && c.decoy_read === false);

test('N9 good: eval-skill-triggers.js: registry present -> alias token fingerprint at the shim, decoy never read', () => {
  const r = n9Run('good', SCRIPTS_DIR);
  assert.ok(n9Good(r), `code ${r.code} calls=${JSON.stringify(r.calls)} stderr=${String(r.stderr).slice(0, 300)}`);
});

test('N9 broken: eval-skill-triggers.js: registry unusable -> zero spawn, decoy not read', () => {
  const r = n9Run('broken', SCRIPTS_DIR);
  assert.ok(r.calls.length === 0 && !r.calls.some((c) => c.decoy_read), `calls=${JSON.stringify(r.calls)}`);
});

test('N9 mutation: eval-skill-triggers.js: account call removed -> the good-run assertion turns red', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-triggers-mut-'));
  try {
    const dir = path.join(root, 'scripts');
    fs.cpSync(SCRIPTS_DIR, dir, { recursive: true, filter: (s) => !/\.test\.(js|sh)$/.test(s) });
    const p = path.join(dir, 'eval-skill-triggers.js');
    const src = fs.readFileSync(p, 'utf8');
    const out = src.replace(/process\.execPath,\s*\[\s*path\.join\(__dirname, 'claude-account\.js'\), 'exec', '--pick', '--purpose', 'skill-trigger-eval', '--', 'claude',/, "'claude',\n    [");
    assert.notStrictEqual(out, src, 'mutation applied');
    fs.writeFileSync(p, out);
    assert.ok(!n9Good(n9Run('good', dir)), 'without the account call the good-run predicate must fail');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
