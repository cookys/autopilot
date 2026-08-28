'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyImplementerLadder,
  selectImplementerRung,
} = require('../src/engine/implementer-ladder');
const { buildImplementationArgs } = require('../src/engine/autopilot-engine');

const REPO = path.resolve(__dirname, '..');
const RESOLVER = path.join(REPO, 'scripts', 'resolve-review-loop.sh');
const TEMPLATE = path.join(REPO, 'project-config-template', 'review-loop-config.md');

const LADDER = [
  { engine: 'gemini-3.7-flash-low', effort: 'low', runner: 'agy' },
  { engine: 'grok-4.6', effort: 'low', runner: 'grok' },
  { engine: 'sonnet', effort: 'medium', runner: 'codex' },
];

function writeConfig(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-'));
  const file = path.join(dir, 'review-loop-config.md');
  fs.writeFileSync(file, body);
  return file;
}

function resolveJson(configPath) {
  const run = spawnSync('bash', [RESOLVER], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, REVIEW_LOOP_CONFIG_OVERRIDE: configPath },
  });
  if (run.status !== 0) {
    return { status: run.status, stderr: run.stderr, stdout: run.stdout, json: null };
  }
  return { status: run.status, stderr: run.stderr, stdout: run.stdout, json: JSON.parse(run.stdout) };
}

function baseRoster() {
  return {
    implementer_engine: 'gpt-5.3-codex-spark',
    implementer_effort: 'high',
    implementer_runner: 'auto',
  };
}

test('select: mechanical r0/r1/r2 climb then cap', () => {
  const r0 = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 0 });
  const r1 = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 1 });
  const r2 = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 2 });
  const r3 = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 3 });
  assert.equal(r0.rung, 0);
  assert.equal(r0.tuple.engine, 'gemini-3.7-flash-low');
  assert.equal(r1.rung, 1);
  assert.equal(r1.tuple.engine, 'grok-4.6');
  assert.equal(r2.rung, 2);
  assert.equal(r2.tuple.engine, 'sonnet');
  assert.equal(r3.rung, 2);
});

test('select: judgment starts at rung 1', () => {
  const r0 = selectImplementerRung({ ladder: LADDER, unitClass: 'judgment', repairRound: 0 });
  const r1 = selectImplementerRung({ ladder: LADDER, unitClass: 'judgment', repairRound: 1 });
  assert.equal(r0.rung, 1);
  assert.equal(r0.tuple.engine, 'grok-4.6');
  assert.equal(r1.rung, 2);
});

test('select: single rung is used for both classes', () => {
  const one = [LADDER[0]];
  const m = selectImplementerRung({ ladder: one, unitClass: 'mechanical', repairRound: 0 });
  const j = selectImplementerRung({ ladder: one, unitClass: 'judgment', repairRound: 0 });
  assert.equal(m.rung, 0);
  assert.equal(j.rung, 0);
  assert.equal(m.tuple.engine, LADDER[0].engine);
});

test('select: absent ladder is identity', () => {
  const none = selectImplementerRung({ ladder: [], unitClass: 'mechanical', repairRound: 0 });
  assert.equal(none.applied, false);
  assert.equal(none.rung, null);
});

test('resolver: absent ladder emits empty array and keeps seat fields', () => {
  const cfg = writeConfig([
    '- implementer_engine: gpt-5.3-codex-spark',
    '- implementer_effort: high',
    '- implementer_runner: auto',
    '- allow_same_runner_dual_seat: on',
    '',
  ].join('\n'));
  const { status, json, stderr } = resolveJson(cfg);
  assert.equal(status, 0, stderr);
  assert.deepEqual(json.implementer_ladder, []);
  assert.equal(json.implementer_engine, 'gpt-5.3-codex-spark');
  assert.equal(json.implementer_effort, 'high');
  assert.equal(json.implementer_runner, 'auto');
});

test('resolver: parses engine/effort@runner list', () => {
  const cfg = writeConfig([
    '- implementer_engine: gpt-5.3-codex-spark',
    '- implementer_effort: high',
    '- implementer_runner: auto',
    '- implementer_ladder: gemini-3.7-flash-low/low@agy, grok-4.6/low@grok, sonnet/medium@codex',
    '- allow_same_runner_dual_seat: on',
    '',
  ].join('\n'));
  const { status, json, stderr } = resolveJson(cfg);
  assert.equal(status, 0, stderr);
  assert.deepEqual(json.implementer_ladder, LADDER);
});

test('resolver: rejects illegal ladder runner', () => {
  const cfg = writeConfig([
    '- implementer_engine: gpt-5.3-codex-spark',
    '- implementer_runner: auto',
    '- implementer_ladder: flash/low@not-a-runner',
    '- allow_same_runner_dual_seat: on',
    '',
  ].join('\n'));
  const { status, stderr } = resolveJson(cfg);
  assert.equal(status, 3);
  assert.match(stderr, /invalid implementer_ladder/);
});

test('planted negative: empty ladder dispatch argv equals pre-ladder roster', () => {
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-prompt-'));
  const promptFile = path.join(promptDir, 'prompt.md');
  fs.writeFileSync(promptFile, 'do the thing\n');
  const roster = { ...baseRoster(), implementer_ladder: [] };
  const applied = applyImplementerLadder(roster, {
    unitClass: 'judgment',
    repairRound: 0,
  });
  const before = buildImplementationArgs({
    roster: baseRoster(),
    promptFile,
    branch: 'feat/x',
    base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    cwd: promptDir,
  });
  const after = buildImplementationArgs({
    roster: applied.roster,
    promptFile,
    branch: 'feat/x',
    base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    cwd: promptDir,
  });
  assert.deepEqual(after, before);
});

test('template config has no implementer_ladder field (empty emit)', () => {
  const run = spawnSync('bash', [RESOLVER], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, REVIEW_LOOP_CONFIG_OVERRIDE: TEMPLATE },
  });
  assert.equal(run.status, 0, run.stderr);
  const json = JSON.parse(run.stdout);
  assert.deepEqual(json.implementer_ladder, []);
});
