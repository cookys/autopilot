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
