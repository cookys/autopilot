'use strict';

/**
 * Tests for scripts/lib/pace-reading.js, scripts/lib/pace-roles.json, and scripts/pace-select.js.
 * Run: node --test scripts/pace-select.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { freshReading } = require('./lib/pace-reading.js');
const {
  selectEngine,
  loadPools,
  loadRoles,
  mergePools,
  defaultPacePath,
  defaultQualifiedPath,
  QUALIFIED_SCHEMA,
  inAvailableWindow,
} = require('./pace-select.js');
const { isChineseFamily } = require('./lib/engine-spelling.js');

const {
  normalizeFamily,
  reviewerFallbackPlan,
  reviewerFallbackChain,
  implementerFallbackPlan,
  implementerFallbackChain,
  selectReviewerFallback,
  selectImplementerFallback,
  buildFallbackRecord,
  inferImplementerFamily,
  formatRung,
  isCodexRung,
} = require('./lib/seat-fallback.js');
const { AutopilotEngine } = require('../src/engine');
const CLI = path.join(__dirname, 'pace-select.js');
const SEAT_FALLBACK_CLI = path.join(__dirname, 'lib', 'seat-fallback.js');
const SCORECARD_CLI = path.join(__dirname, 'engine-scorecard.js');
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'pace-select');
const MISSING_PACE = path.join(FIXTURES_DIR, '__missing_pace__.json');
const allEndpointsReady = () => true;
// Small public-doc work admits CN seats for non-review roles; review roles are barred by the CN gate.
// Omit AUTOPILOT_TASK_ROLE so each call uses its own rail role (env wins over rail role in the gate).
const testTask = { AUTOPILOT_TASK_SIZE: 'S', AUTOPILOT_TASK_SCOPE: 'docs/example.md' };
for (const k of ['AUTOPILOT_TASK_ROLE', 'AUTOPILOT_TASK_NOVEL', 'AUTOPILOT_TASK_READS_TRANSCRIPT', 'AUTOPILOT_TASK_CLASS']) {
  delete process.env[k];
}
Object.assign(process.env, testTask);

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined;
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Inline-pace builders for the (priority a)-(priority f) tests.
const priorityPace = (rows) => ({
  schema: 'capacity.pace/1',
  generated_at: '2026-11-13T04:00:00Z',
  rows: rows.map(row => ({ hours_to_reset: 24, ...row })),
});
const paceRow = (pool, used, expected, extra = {}) => ({
  pool,
  class: 'other',
  status: 'ok',
  stale: false,
  used_pct: used,
  hours_to_reset: 24,
  expected_pct: expected,
  ...extra,
});

function fixturePath(name) {
  return path.join(FIXTURES_DIR, name);
}

function readFixture(name) {
  return JSON.parse(fs.readFileSync(fixturePath(name), 'utf8'));
}

function cli(args, envExtra = {}) {
  const env = { ...process.env };
  delete env.AUTOPILOT_PACE_FILE;
  delete env.AUTOPILOT_NONCQ_POOLS;
  delete env.AUTOPILOT_PACE_ROLES;
  delete env.ANTHROPIC_COMPATIBLE_BASE_URL;
  delete env.ANTHROPIC_COMPATIBLE_AUTH_TOKEN;
  // Hermetic default: isolate from host ~/.autopilot/qualified.v1.json and endpoints.env
  // unless a test explicitly overrides AUTOPILOT_QUALIFIED_FILE or AUTOPILOT_ENDPOINT_GLM_*.
  env.AUTOPILOT_QUALIFIED_FILE = path.join(FIXTURES_DIR, '__missing_qualified__.json');
  env.AUTOPILOT_ENDPOINTS_ENV = '/nonexistent';
  env.AUTOPILOT_ENDPOINT_GLM_URL = 'https://glm.example.invalid/v1';
  env.AUTOPILOT_ENDPOINT_GLM_TOKEN = 'test-glm-token';
  delete env.AUTOPILOT_ENDPOINT_GLM_TRANSPORT;
  Object.assign(env, envExtra);
  if (
    Object.prototype.hasOwnProperty.call(envExtra, 'AUTOPILOT_QUALIFIED_FILE')
    && envExtra.AUTOPILOT_QUALIFIED_FILE === undefined
  ) {
    delete env.AUTOPILOT_QUALIFIED_FILE;
  }
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env,
    input: '',
  });
}

test('freshReading: returns slack for fresh finite rows and null for stale or missing/null numbers', () => {
  assert.deepEqual(
    freshReading({
      pool: 'agy',
      stale: false,
      used_pct: 26,
      expected_pct: 40,
      hours_to_reset: 12.5,
    }),
    {
      pool: 'agy',
      used_pct: 26,
      expected_pct: 40,
      slack: 14,
      hours_to_reset: 12.5,
    },
  );

  // Explicit numeric 0 is valid and distinct from null/missing.
  assert.deepEqual(
    freshReading({
      pool: 'glm',
      stale: false,
      used_pct: 0,
      expected_pct: 0,
      hours_to_reset: 0,
    }),
    {
      pool: 'glm',
      used_pct: 0,
      expected_pct: 0,
      slack: 0,
      hours_to_reset: 0,
    },
  );

  assert.deepEqual(
    freshReading({
      pool: 'glm',
      stale: false,
      used_pct: 10,
      expected_pct: 25,
    }),
    {
      pool: 'glm',
      used_pct: 10,
      expected_pct: 25,
      slack: 15,
      hours_to_reset: null,
    },
  );

  const unknowns = [
    null,
    undefined,
    [],
    {},
    { pool: '', stale: false, used_pct: 10, expected_pct: 20 },
    { pool: 'agy', stale: true, used_pct: 10, expected_pct: 20 },
    { pool: 'agy', stale: null, used_pct: 10, expected_pct: 20 },
    { pool: 'agy', used_pct: 10, expected_pct: 20 },
    { pool: 'agy', stale: 'false', used_pct: 10, expected_pct: 20 },
    { pool: 'agy', stale: false, used_pct: null, expected_pct: 20 },
    { pool: 'agy', stale: false, expected_pct: 20 },
    { pool: 'agy', stale: false, used_pct: Number.NaN, expected_pct: 20 },
    { pool: 'agy', stale: false, used_pct: '10', expected_pct: 20 },
    { pool: 'agy', stale: false, used_pct: 10, expected_pct: null },
    { pool: 'agy', stale: false, used_pct: 10 },
    { pool: 'agy', stale: false, used_pct: 10, expected_pct: Number.POSITIVE_INFINITY },
    { pool: 'agy', stale: false, used_pct: 10, expected_pct: '20' },
  ];
  for (const bad of unknowns) {
    assert.equal(freshReading(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('pace-roles.json: matches scorecard qualification allowlists, codex pools, and excludes non-role keys', () => {
  const roles = loadRoles();
  assert.equal(typeof roles._why, 'string');
  assert.match(roles._why, /engine-scorecard current/);
  assert.match(roles._why, /glm: reviewer provisional, implementer qualified 2026-11-13, scorecard event 34, 24\/24, integrity 0/);
  assert.match(roles._why, /agyclaude: reviewer and implementer pass 2026-11-13/);
  assert.match(roles._why, /minimax: failed both 2026-11-13/);
  assert.match(roles._why, /hydrogen passed all four prereg bars \(develop d40e9ad43\)/);

  assert.deepEqual(roles.reviewer, ['agy', 'glm', 'codex', 'grok', 'agyclaude', 'deepseek']);
  assert.deepEqual(roles.implementer, ['agy', 'glm', 'agyclaude', 'codex', 'grok', 'kimi']);
  assert.deepEqual(roles.author, ['agy', 'glm', 'codex', 'grok', 'agyclaude', 'kimi']);
  assert.deepEqual(roles.priority, {
    implementer: ['agy', 'grok', 'glm', 'agyclaude'],
    reviewer: ['agy', 'grok', 'codex', 'glm', 'agyclaude'],
    author: ['agy', 'grok', 'codex', 'glm', 'agyclaude'],
  });
  assert.deepEqual(roles.role_models, { implementer: { agy: 'gemini-4-hydrogen-high' } });

  for (const r of ['reviewer', 'implementer', 'author']) {
    assert.equal(roles[r].includes('agyclaude'), true);
    assert.equal(roles[r].includes('minimax'), false);
  }

  assert.deepEqual(roles.pools, {
    'codex A': { key: 'codex', runner: 'codex', model: 'gpt-6.1-sol' },
    'codex B': { key: 'codex', runner: 'codex', model: 'gpt-6.1-sol' },
    deepseek: roles.pools.deepseek, // the cn_gate seat: pinned field by field in the (deepseek 1) test
  });

  const badWhy = cli(['--role', '_why', '--pace', fixturePath('ahead-vs-behind.json')]);
  assert.equal(badWhy.status, 2);

  const badPools = cli(['--role', 'pools', '--pace', fixturePath('ahead-vs-behind.json')]);
  assert.equal(badPools.status, 2);

  const badPriority = cli(['--role', 'priority', '--pace', fixturePath('ahead-vs-behind.json')]);
  assert.equal(badPriority.status, 2);

  const badRoleModels = cli(['--role', 'role_models', '--pace', fixturePath('ahead-vs-behind.json')]);
  assert.equal(badRoleModels.status, 2);

  const missingRole = cli(['--pace', fixturePath('ahead-vs-behind.json')]);
  assert.equal(missingRole.status, 2);
});

test('(a) reset-weighted quota outranks linear pace; claude rows are never candidates', () => {
  const pace = readFixture('ahead-vs-behind.json');
  const pools = loadPools();
  const roles = loadRoles();

  const res = selectEngine({
    pace,
    pools,
    roles,
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.deepEqual(res, {
    engine: 'glm',
    runner: 'cc-shim',
    model: 'glm-5.3',
    endpoint: 'glm',
    pool: 'glm',
    slack_pts: -3,
    used_pct: 43,
    expected_pct: 40,
    reset_at: null, score: 57 / 14.4, status: 'fresh', runner_up: 'grok', reason: 'quota_score',
    over_pace: false,
    selected_by: 'quota_score',
    low_keys: [],
    reviewer_exclude: ['glm'],
    role: 'implementer',
    qualified_source: 'pace-roles.json',
    pace_generated_at: '2026-11-13T02:00:00Z',
    candidates: [
      { engine: 'agy', pool: 'agy', slack_pts: -25 },
      { engine: 'glm', pool: 'glm', slack_pts: -3 },
      { engine: 'agyclaude', reason: 'unknown' },
      { engine: 'codex', reason: 'unknown' },
      { engine: 'grok', pool: 'grok-cli', slack_pts: 14 },
    ],
  });

  const r = cli(['--role', 'implementer', '--pace', fixturePath('ahead-vs-behind.json'), '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), res);

  // Even if a pool map entry mapped claude-pool-a (+80 slack) to codex, class "claude" is rejected.
  const poolsWithClaudeMapped = {
    ...pools,
    'claude-pool-a': { key: 'codex', runner: 'codex', model: 'gpt-6.1-sol' },
  };
  const withClaude = selectEngine({
    pace,
    pools: poolsWithClaudeMapped,
    roles,
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(withClaude.engine, 'glm');
  assert.deepEqual(
    withClaude.candidates.find((c) => c.engine === 'codex'),
    { engine: 'codex', reason: 'unknown' },
  );

  // A fresh agyclaude reading wins with 90 points left and only 7.2 hours to reset.
  const agyClaudeFresh = structuredClone(pace);
  agyClaudeFresh.rows.find((row) => row.pool === 'agyclaude(alias 2)').stale = false;
  const agyClaudeLater = selectEngine({
    pace: agyClaudeFresh,
    pools,
    roles,
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(agyClaudeLater.engine, 'agyclaude');
  assert.equal(agyClaudeLater.selected_by, 'quota_score');
  assert.equal(agyClaudeLater.slack_pts, 70);

  // Increasing grok usage does not change the winner.
  const grokBehind = structuredClone(agyClaudeFresh);
  grokBehind.rows.find((row) => row.pool === 'grok-cli').used_pct = 50;
  const agyClaudeWin = selectEngine({
    pace: grokBehind,
    pools,
    roles,
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(agyClaudeWin.engine, 'agyclaude');
  assert.equal(agyClaudeWin.runner, 'agy');
  assert.equal(agyClaudeWin.model, 'claude-opus-5-5-medium');
  assert.equal(agyClaudeWin.pool, 'agyclaude(alias 2)');
  assert.equal(agyClaudeWin.selected_by, 'quota_score');
  assert.equal(agyClaudeWin.slack_pts, 70);
});

test('(b) stale row and null expected_pct/used_pct rows are reported as unknown and never selected', () => {
  const pace = readFixture('stale-and-null.json');
  const pools = loadPools();
  const roles = loadRoles();

  // agy is stale (+76 if read as fresh); glm has expected_pct:null, used_pct:0 (0 slack if null read as 0);
  // grok-cli has used_pct:null, expected_pct:70 (+70 slack if null read as 0);
  // grok-cli(alias 2) is fresh with slack -6. Every broken reading would beat -6 if misread.
  const r = cli(['--role', 'author', '--pace', fixturePath('stale-and-null.json'), '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.engine, 'grok');
  assert.equal(out.pool, 'grok-cli(alias 2)');
  assert.equal(out.slack_pts, -6);
  assert.equal(out.over_pace, false);
  assert.deepEqual(out.candidates, [
    { engine: 'agy', reason: 'unknown' },
    { engine: 'glm', reason: 'unknown' },
    { engine: 'codex', reason: 'unknown' },
    { engine: 'grok', pool: 'grok-cli(alias 2)', slack_pts: -6 },
    { engine: 'agyclaude', reason: 'unknown' },
  ]);

  // Negative controls: coalescing null expected_pct -> 0 makes glm win (0 > -6);
  // ignoring stale on agy makes agy win (76 > -6).
  const nullAsZeroPace = structuredClone(pace);
  Object.assign(nullAsZeroPace.rows.find((row) => row.pool === 'glm'), { expected_pct: 0, hours_to_reset: 1 });
  assert.equal(
    selectEngine({
      pace: nullAsZeroPace,
      pools,
      roles,
      role: 'author',
      checkEndpoint: allEndpointsReady,
    }).engine,
    'glm',
  );

  const staleIgnoredPace = structuredClone(pace);
  staleIgnoredPace.rows.find((row) => row.pool === 'agy').stale = false;
  assert.equal(
    selectEngine({
      pace: staleIgnoredPace,
      pools,
      roles,
      role: 'author',
      checkEndpoint: allEndpointsReady,
    }).engine,
    'agy',
  );
});

test('(c) only ahead keys (< -10 slack) -> largest slack chosen with over_pace: true', () => {
  const r = cli(['--role', 'author', '--pace', fixturePath('only-ahead.json'), '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.engine, 'glm');
  assert.equal(out.runner, 'cc-shim');
  assert.equal(out.endpoint, 'glm');
  assert.equal(out.model, 'glm-5.3');
  assert.equal(out.pool, 'glm');
  assert.equal(out.slack_pts, -15);
  assert.equal(out.used_pct, 45);
  assert.equal(out.expected_pct, 30);
  assert.equal(out.over_pace, true);

  // implementer: the priority walk fails (agy -32, grok -22, glm -15, agyclaude unknown),
  // so the slack fallback picks glm (-15), the least-behind eligible key.
  const impl = selectEngine({
    pace: readFixture('only-ahead.json'),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(impl.engine, 'glm');
  assert.equal(impl.selected_by, 'quota_score');
  assert.equal(impl.slack_pts, -15);
  assert.equal(impl.over_pace, true);

  // Boundary: slack === -10 qualifies (over_pace: false); slack === -11 sets over_pace: true.
  const atFloor = selectEngine({
    pace: {
      schema: 'capacity.pace/1',
      generated_at: '2026-11-13T02:12:00Z',
      rows: [{ pool: 'agy', class: 'other', status: 'WARN_ahead', stale: false, hours_to_reset: 24, used_pct: 50, expected_pct: 40 }],
    },
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(atFloor.engine, 'agy');
  assert.equal(atFloor.slack_pts, -10);
  assert.equal(atFloor.over_pace, false);

  const belowFloor = selectEngine({
    pace: {
      schema: 'capacity.pace/1',
      generated_at: '2026-11-13T02:12:00Z',
      rows: [{ pool: 'agy', class: 'other', status: 'WARN_ahead', stale: false, hours_to_reset: 24, used_pct: 51, expected_pct: 40 }],
    },
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(belowFloor.engine, 'agy');
  assert.equal(belowFloor.slack_pts, -11);
  assert.equal(belowFloor.over_pace, true);
});

test('(d) all unknown -> exit 3 with engine: null and reason: pace_unknown', () => {
  const r = cli(['--role', 'reviewer', '--pace', fixturePath('all-unknown.json'), '--json']);
  assert.equal(r.status, 3, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.engine, null);
  assert.equal(out.reason, 'pace_unknown');
  assert.equal(out.role, 'reviewer');
  assert.equal(out.qualified_source, 'pace-roles.json');
  assert.equal(out.pace_generated_at, '2026-11-13T02:15:00Z');
  assert.deepEqual(out.candidates, [
    { engine: 'agy', reason: 'unknown' },
    { engine: 'glm', reason: 'cn_model_dispatch_barred' },
    { engine: 'codex', reason: 'unknown' },
    { engine: 'grok', reason: 'unknown' },
    { engine: 'agyclaude', reason: 'unknown' },
  ]);

  // Default --pace resolution: AUTOPILOT_PACE_FILE, else $HOME/projects/capacity/out/pace.v1.json.
  assert.equal(
    defaultPacePath({ AUTOPILOT_PACE_FILE: fixturePath('ahead-vs-behind.json'), HOME: '/nonexistent' }),
    fixturePath('ahead-vs-behind.json'),
  );
  const viaEnv = cli(['--role', 'implementer', '--json'], {
    AUTOPILOT_PACE_FILE: fixturePath('ahead-vs-behind.json'),
  });
  assert.equal(viaEnv.status, 0, viaEnv.stderr);
  assert.equal(JSON.parse(viaEnv.stdout).engine, 'glm');

  let emptyHome;
  try {
    emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-select-home-'));
    const missingDefault = cli(['--role', 'implementer', '--json'], { HOME: emptyHome });
    assert.equal(missingDefault.status, 3);
    const missingOut = JSON.parse(missingDefault.stdout);
    assert.equal(missingOut.engine, null);
    assert.equal(missingOut.reason, 'pace_unknown');
  } finally {
    if (emptyHome) fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('(e) --exclude removes keys from consideration', () => {
  const file = fixturePath('ahead-vs-behind.json');

  const base = cli(['--role', 'author', '--pace', file, '--json']);
  assert.equal(base.status, 0, base.stderr);
  assert.equal(JSON.parse(base.stdout).engine, 'glm');

  const noGrok = cli(['--role', 'author', '--pace', file, '--exclude', 'grok', '--json']);
  assert.equal(noGrok.status, 0, noGrok.stderr);
  const noGrokOut = JSON.parse(noGrok.stdout);
  assert.equal(noGrokOut.engine, 'glm');
  assert.equal(noGrokOut.slack_pts, -3);
  assert.equal(noGrokOut.over_pace, false);
  assert.equal(noGrokOut.candidates.some((c) => c.engine === 'grok'), false);

  const noGrokGlm = cli(['--role', 'author', '--pace', file, '--exclude', 'grok,glm', '--json']);
  assert.equal(noGrokGlm.status, 0, noGrokGlm.stderr);
  const noGrokGlmOut = JSON.parse(noGrokGlm.stdout);
  assert.equal(noGrokGlmOut.engine, 'agy');
  assert.equal(noGrokGlmOut.slack_pts, -25);
  assert.equal(noGrokGlmOut.over_pace, true);

  const noneLeft = cli(['--role', 'author', '--pace', file, '--exclude', 'grok,glm,agy', '--json']);
  assert.equal(noneLeft.status, 3);
  assert.equal(JSON.parse(noneLeft.stdout).reason, 'pace_unknown');
});

test('(f) alias rows of one key: the larger fresh slack is used', () => {
  const r = cli(['--role', 'implementer', '--pace', fixturePath('aliases.json'), '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, {
    engine: 'agy',
    runner: 'agy',
    model: 'gemini-4-hydrogen-high',
    pool: 'agy(alias 2)',
    slack_pts: 28,
    used_pct: 12,
    expected_pct: 40,
    reset_at: null, score: 88 / 72, status: 'fresh', runner_up: 'grok', reason: 'quota_score',
    over_pace: false,
    selected_by: 'quota_score',
    low_keys: [],
    reviewer_exclude: ['agy'],
    role: 'implementer',
    qualified_source: 'pace-roles.json',
    pace_generated_at: '2026-11-13T02:20:00Z',
    candidates: [
      { engine: 'agy', pool: 'agy(alias 2)', slack_pts: 28 },
      { engine: 'glm', reason: 'unknown' },
      { engine: 'agyclaude', reason: 'unknown' },
      { engine: 'codex', reason: 'unknown' },
      { engine: 'grok', pool: 'grok-cli(alias 2)', slack_pts: 11 },
    ],
  });
});

test('(g) scarce codex row 35 pts ahead is a known reading with slack -35, not unknown', () => {
  const pace = readFixture('scarce-codex.json');
  const pools = loadPools();
  const roles = loadRoles();

  // noncq-pools.json has no codex pool; mergePools supplies codex A / codex B from pace-roles.json.
  assert.equal(Object.prototype.hasOwnProperty.call(pools, 'codex A'), false);
  const merged = mergePools(pools, roles);
  assert.deepEqual(merged['codex A'], { key: 'codex', runner: 'codex', model: 'gpt-6.1-sol' });
  assert.deepEqual(merged['codex B'], { key: 'codex', runner: 'codex', model: 'gpt-6.1-sol' });

  const res = selectEngine({
    pace,
    pools,
    roles,
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.deepEqual(res, {
    engine: 'codex',
    runner: 'codex',
    model: 'gpt-6.1-sol',
    pool: 'codex A',
    slack_pts: -35,
    used_pct: 75,
    expected_pct: 40,
    reset_at: null, score: 25 / 96, status: 'fresh', runner_up: null, reason: 'quota_score',
    over_pace: true,
    selected_by: 'quota_score',
    low_keys: [],
    reviewer_exclude: ['codex'],
    role: 'implementer',
    qualified_source: 'pace-roles.json',
    pace_generated_at: '2026-11-13T02:25:00Z',
    candidates: [
      { engine: 'agy', reason: 'unknown' },
      { engine: 'glm', reason: 'unknown' },
      { engine: 'agyclaude', reason: 'unknown' },
      { engine: 'codex', pool: 'codex A', slack_pts: -35 },
      { engine: 'grok', reason: 'unknown' },
    ],
  });

  // Both codex A (-35) and codex B (-8) fresh scarce rows -> larger slack (-8) wins, over_pace: false.
  const bothCodex = {
    schema: 'capacity.pace/1',
    generated_at: '2026-11-13T02:26:00Z',
    rows: [
      ...pace.rows,
      {
        pool: 'codex B',
        class: 'scarce',
        status: 'ok',
        stale: false, hours_to_reset: 24,
        used_pct: 48,
        expected_pct: 40,
      },
    ],
  };
  const bothRes = selectEngine({
    pace: bothCodex,
    pools,
    roles,
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(bothRes.engine, 'codex');
  assert.equal(bothRes.pool, 'codex B');
  assert.equal(bothRes.slack_pts, -8);
  assert.equal(bothRes.over_pace, false);
});

test('(h) endpoint readiness: glm has best slack (+30) but endpoint_not_ready -> another engine is chosen', () => {
  const pace = readFixture('glm-best-slack.json');
  const pools = loadPools();
  const roles = loadRoles();

  // Control: grok is second in reviewer priority and on pace (+14), so it wins
  // before glm (+30). The glm endpoint is still probed during the pool scan.
  const checkedReady = [];
  const whenReady = selectEngine({
    pace,
    pools,
    roles,
    role: 'author',
    checkEndpoint: (ep) => {
      checkedReady.push(ep);
      return true;
    },
  });
  assert.deepEqual(checkedReady, ['glm']);
  assert.equal(whenReady.engine, 'glm');
  assert.equal(whenReady.selected_by, 'quota_score');
  assert.equal(whenReady.slack_pts, 30);

  // When earlier priority keys are behind, a ready glm endpoint still wins.
  const grokBehind = structuredClone(pace);
  grokBehind.rows.find((row) => row.pool === 'grok-cli').used_pct = 51;
  const glmWhenGrokBehind = selectEngine({
    pace: grokBehind,
    pools,
    roles,
    role: 'author',
    checkEndpoint: () => true,
  });
  assert.equal(glmWhenGrokBehind.engine, 'glm');
  assert.equal(glmWhenGrokBehind.selected_by, 'quota_score');
  assert.equal(glmWhenGrokBehind.slack_pts, 30);
  const glmDown = selectEngine({
    pace: grokBehind,
    pools,
    roles,
    role: 'author',
    checkEndpoint: (ep) => ep !== 'glm',
  });
  assert.equal(glmDown.engine, 'agy');
  assert.equal(glmDown.slack_pts, -15);
  assert.equal(glmDown.selected_by, 'quota_score');
  assert.equal(glmDown.over_pace, true);

  // When glm endpoint is not ready (injected, no shell spawn), glm is listed as
  // { engine: "glm", reason: "endpoint_not_ready" } and grok (+14) is chosen instead.
  const checkedUnready = [];
  const whenNotReady = selectEngine({
    pace,
    pools,
    roles,
    role: 'author',
    checkEndpoint: (ep) => {
      checkedUnready.push(ep);
      return ep !== 'glm';
    },
  });
  assert.deepEqual(checkedUnready, ['glm']);
  assert.equal(whenNotReady.engine, 'grok');
  assert.equal(whenNotReady.runner, 'grok');
  assert.equal(whenNotReady.model, 'grok-4.7');
  assert.equal(whenNotReady.slack_pts, 14);
  assert.equal(whenNotReady.over_pace, false);
  assert.deepEqual(whenNotReady.candidates, [
    { engine: 'agy', pool: 'agy', slack_pts: -15 },
    { engine: 'glm', reason: 'endpoint_not_ready' },
    { engine: 'codex', reason: 'unknown' },
    { engine: 'grok', pool: 'grok-cli', slack_pts: 14 },
    { engine: 'agyclaude', reason: 'unknown' },
  ]);

  // End-to-end CLI check through resolve-endpoint.sh when GLM credentials are unconfigured.
  const unconfiguredCli = cli(
    ['--role', 'author', '--pace', fixturePath('glm-best-slack.json'), '--json'],
    {
      AUTOPILOT_ENDPOINT_GLM_URL: '',
      AUTOPILOT_ENDPOINT_GLM_TOKEN: '',
    },
  );
  assert.equal(unconfiguredCli.status, 0, unconfiguredCli.stderr);
  const cliOut = JSON.parse(unconfiguredCli.stdout);
  assert.equal(cliOut.engine, 'grok');
  assert.deepEqual(
    cliOut.candidates.find((c) => c.engine === 'glm'),
    { engine: 'glm', reason: 'endpoint_not_ready' },
  );
});

test('(i) qualified.v1.json eligibility: fail-only excluded, provisional allowed, missing file falls back', () => {
  let tmpDir;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-select-qualified-'));
    const paceFile = fixturePath('ahead-vs-behind.json');
    const pace = readFixture('ahead-vs-behind.json');
    const pools = loadPools();
    const roles = loadRoles();

    // 1. Fail-only key (grok, +14 slack) is excluded; provisional key (glm, -3 slack) is allowed
    // and wins over pass key (agy, -25 slack); qualified_source reports the file path.
    const qPath = path.join(tmpDir, 'qualified.v1.json');
    const qualifiedDoc = {
      schema: QUALIFIED_SCHEMA,
      generated_at: '2026-11-13T03:00:00.000Z',
      rows: [
        { engine: 'grok-4.7', runner: 'grok', role: 'author', result: 'fail', date: '2026-11-12', event_id: 1 },
        { engine: 'glm-5.3', runner: 'cc-shim', role: 'author', result: 'provisional', date: '2026-11-11', event_id: 2 },
        { engine: 'gemini-4-carbon-high', runner: 'agy', role: 'author', result: 'pass', date: '2026-11-10', event_id: 3 },
      ],
    };
    fs.writeFileSync(qPath, `${JSON.stringify(qualifiedDoc, null, 2)}\n`, 'utf8');

    const viaFlag = cli(['--role', 'author', '--pace', paceFile, '--qualified', qPath, '--json']);
    assert.equal(viaFlag.status, 0, viaFlag.stderr);
    const flagOut = JSON.parse(viaFlag.stdout);
    assert.equal(flagOut.engine, 'glm');
    assert.equal(flagOut.runner, 'cc-shim');
    assert.equal(flagOut.model, 'glm-5.3');
    assert.equal(flagOut.slack_pts, -3);
    assert.equal(flagOut.over_pace, false);
    assert.equal(flagOut.qualified_source, qPath);
    assert.equal(flagOut.candidates.some((c) => c.engine === 'grok'), false);
    assert.deepEqual(flagOut.candidates, [
      { engine: 'agy', pool: 'agy', slack_pts: -25 },
      { engine: 'glm', pool: 'glm', slack_pts: -3 },
    ]);

    const viaEnv = cli(['--role', 'author', '--pace', paceFile, '--json'], {
      AUTOPILOT_QUALIFIED_FILE: qPath,
    });
    assert.equal(viaEnv.status, 0, viaEnv.stderr);
    assert.deepEqual(JSON.parse(viaEnv.stdout), flagOut);

    // 2. Role eligibility comes from qualified.v1.json (not intersected with pace-roles.json):
    // glm is absent from pace-roles.json implementer, yet a provisional row in qualified.v1.json admits it.
    const implQualified = {
      schema: QUALIFIED_SCHEMA,
      generated_at: '2026-11-13T03:05:00.000Z',
      rows: [
        { engine: 'grok-4.7', runner: 'grok', role: 'implementer', result: 'fail', date: '2026-11-12', event_id: 1 },
        { engine: 'glm-5.3', runner: 'cc-shim', role: 'implementer', result: 'provisional', date: '2026-11-13', event_id: 2 },
      ],
    };
    const implRes = selectEngine({
      pace,
      pools,
      roles,
      role: 'implementer',
      qualified: implQualified,
      qualifiedSource: qPath,
      checkEndpoint: allEndpointsReady,
    });
    assert.equal(implRes.engine, 'glm');
    assert.equal(implRes.qualified_source, qPath);
    assert.deepEqual(implRes.candidates, [{ engine: 'glm', pool: 'glm', slack_pts: -3 }]);

    // 3. Missing qualified file falls back to scripts/lib/pace-roles.json with qualified_source: "pace-roles.json".
    const missingPath = path.join(tmpDir, 'does-not-exist.json');
    const viaMissingFlag = cli(['--role', 'author', '--pace', paceFile, '--qualified', missingPath, '--json']);
    assert.equal(viaMissingFlag.status, 0, viaMissingFlag.stderr);
    const missingFlagOut = JSON.parse(viaMissingFlag.stdout);
    assert.equal(missingFlagOut.engine, 'glm');
    assert.equal(missingFlagOut.qualified_source, 'pace-roles.json');

    assert.equal(
      defaultQualifiedPath({ HOME: tmpDir }),
      path.join(tmpDir, '.autopilot', 'qualified.v1.json'),
    );
    const viaMissingDefault = cli(['--role', 'author', '--pace', paceFile, '--json'], {
      HOME: tmpDir,
      AUTOPILOT_QUALIFIED_FILE: undefined,
    });
    assert.equal(viaMissingDefault.status, 0, viaMissingDefault.stderr);
    const missingDefaultOut = JSON.parse(viaMissingDefault.stdout);
    assert.equal(missingDefaultOut.engine, 'glm');
    assert.equal(missingDefaultOut.qualified_source, 'pace-roles.json');

    // 4. End-to-end round-trip: engine-scorecard.js export-qualified -> pace-select.js --role author
    // (canonical verification_author role in export matches --role author).
    const scDir = path.join(tmpDir, 'scorecard');
    const capDir = path.join(tmpDir, 'cap');
    const outboxDir = path.join(tmpDir, 'outbox');
    const exportedPath = path.join(tmpDir, 'exported-qualified.v1.json');
    fs.mkdirSync(scDir, { recursive: true });
    fs.mkdirSync(capDir, { recursive: true });
    fs.mkdirSync(outboxDir, { recursive: true });
    const scEnv = {
      ...process.env,
      HOME: tmpDir,
      ENGINE_SCORECARD_DIR: scDir,
      ENGINE_CAPABILITY_DIR: capDir,
      AUTOPILOT_OUTBOX_DIR: outboxDir,
      AUTOPILOT_STRIKE_WRITER: 'off',
    };
    const makeRow = (engine, runner, family, status, date) => JSON.stringify({
      engine,
      runner,
      family,
      role: 'verification_author',
      model_version: 'v1',
      version_source: 'manual',
      corpus_version: 'c@1',
      harness_version: 'h@1',
      runner_version: 'rv1',
      prompt_config_hash: 'sha256:x',
      date,
      quality: { corpus_pass: '10/10', false_pass_critical: 0, specificity: '3/3' },
      capability_score: 0.85,
      cost: { source: 'manual', usd_per_mtok_input: 1, usd_per_mtok_output: 1, sample_tokens: 100 },
      latency: { sample_wall_time_s: 1 },
      status,
      qualified_at: date,
    });
    const rFail = spawnSync(process.execPath, [SCORECARD_CLI, 'record'], {
      encoding: 'utf8',
      env: scEnv,
      input: `${makeRow('grok-4.7', 'grok', 'xai', 'failed', '2026-11-12')}\n`,
    });
    assert.equal(rFail.status, 0, rFail.stderr);
    const rPass = spawnSync(process.execPath, [SCORECARD_CLI, 'record'], {
      encoding: 'utf8',
      env: scEnv,
      input: `${makeRow('gemini-4-carbon-high', 'agy', 'google', 'qualified', '2026-11-13')}\n`,
    });
    assert.equal(rPass.status, 0, rPass.stderr);
    const expRes = spawnSync(process.execPath, [SCORECARD_CLI, 'export-qualified', '--out', exportedPath], {
      encoding: 'utf8',
      env: scEnv,
      input: '',
    });
    assert.equal(expRes.status, 0, expRes.stderr);

    const authorPick = cli(['--role', 'author', '--pace', paceFile, '--qualified', exportedPath, '--json']);
    assert.equal(authorPick.status, 0, authorPick.stderr);
    const authorOut = JSON.parse(authorPick.stdout);
    assert.equal(authorOut.engine, 'agy');
    assert.equal(authorOut.qualified_source, exportedPath);
    assert.deepEqual(authorOut.candidates, [{ engine: 'agy', pool: 'agy', slack_pts: -25 }]);

    // 5. Negative control: invalid schema or invented result in an existing qualified file fails closed (exit 2).
    const badPath = path.join(tmpDir, 'bad-qualified.json');
    fs.writeFileSync(
      badPath,
      JSON.stringify({
        schema: QUALIFIED_SCHEMA,
        generated_at: '2026-11-13T03:00:00Z',
        rows: [{ engine: 'grok-4.7', runner: 'grok', role: 'reviewer', result: 'invented', date: '2026-11-13', event_id: 1 }],
      }),
      'utf8',
    );
    const badCli = cli(['--role', 'reviewer', '--pace', paceFile, '--qualified', badPath, '--json']);
    assert.equal(badCli.status, 2);
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('quota tie-breaks: score, slack, then configured priority; role model and family exclusions stay intact', () => {
  const pace = priorityPace([paceRow('agy', 40, 50), paceRow('codex A', 40, 60)]);
  const run = (role = 'implementer') => selectEngine({ pace, role, checkEndpoint: allEndpointsReady });
  assert.equal(run().engine, 'codex'); // equal score, codex has larger slack
  pace.rows[0].expected_pct = 60;
  assert.equal(run().engine, 'agy'); // exact tie uses priority
  assert.equal(run().model, 'gemini-4-hydrogen-high');
  assert.deepEqual(run().reviewer_exclude, ['agy']);
  assert.equal(run('reviewer').model, 'gemini-4-carbon-high');
  assert.equal(run('author').model, 'gemini-4-carbon-high');
  pace.rows[1].used_pct = 13;
  assert.equal(run('reviewer').engine, 'codex'); // priority never beats quota
  pace.rows[1].stale = true;
  assert.equal(run().engine, 'agy'); // incomplete stale row stays unknown
});

// ---------------------------------------------------------------------------
// Seat fallback order & implementer family inference (PM 01M7AHAM)
// ---------------------------------------------------------------------------

test('(seat-fallback a) reviewer retreat skips google/hydrogen and picks grok, never codex', () => withEnv({ AUTOPILOT_PACE_FILE: MISSING_PACE }, () => {
  const roles = loadRoles();
  assert.deepEqual(
    roles.fallback.reviewer.map((r) => r.key),
    ['hydrogen', 'grok', 'glm', 'agyclaude']
  );

  const chain = reviewerFallbackChain({ implementerFamily: 'google' });
  assert.deepEqual(chain.map((r) => r.key), ['grok', 'glm', 'agyclaude']);
  const first = selectReviewerFallback({ implementerFamily: 'google' });
  assert.equal(first.key, 'grok');
  assert.equal(first.runner, 'grok');
  assert.equal(first.model, 'grok-4.7');
  assert.equal(first.effort, 'high');
  assert.equal(first.family, 'xai');
  assert.equal(first.endpoint, null);
  assert.equal(chain.some((r) => r.runner === 'codex' || isCodexRung(r)), false);

  // xai / grok implementer skips the grok rung (same family) and keeps hydrogen first.
  const xaiChain = reviewerFallbackChain({ implementerFamily: 'xai' });
  assert.deepEqual(xaiChain.map((r) => r.key), ['hydrogen', 'glm', 'agyclaude']);
  assert.equal(xaiChain.some((r) => r.key === 'grok'), false);
}));

test('(seat-fallback b) reviewer retreat for anthropic/agyclaude implementer picks hydrogen first', () => withEnv({ AUTOPILOT_PACE_FILE: MISSING_PACE }, () => {
  for (const imp of ['anthropic', 'agyclaude', 'claude-opus-5-5-medium']) {
    const first = selectReviewerFallback({ implementerFamily: imp });
    assert.equal(first.key, 'hydrogen');
    assert.equal(first.runner, 'agy');
    assert.equal(first.model, 'gemini-4-hydrogen-high');
    const chain = reviewerFallbackChain({ implementerFamily: imp });
    assert.deepEqual(chain.map((r) => r.key), ['hydrogen', 'grok', 'glm']);
    assert.equal(chain.some((r) => r.runner === 'codex'), false);
  }
}));

test('(seat-fallback c) unknown implementer family never assumes openai and keeps glm eligible', () => withEnv({ AUTOPILOT_PACE_FILE: MISSING_PACE }, () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-fb-infer-'));
  try {
    const emptyRuns = path.join(tmpDir, 'runs');
    fs.mkdirSync(emptyRuns, { recursive: true });
    const inferred = inferImplementerFamily({
      cwd: tmpDir,
      runsDir: emptyRuns,
      chainFile: path.join(tmpDir, 'missing-chain.json'),
      branchLedgerFile: path.join(tmpDir, 'missing-branches.jsonl'),
      diffFile: path.join(tmpDir, 'diff.patch'),
      branch: 'feat/unknown',
      env: {},
    });
    assert.equal(inferred.family, 'unknown');
    assert.equal(inferred.source, 'none');

    const chain = reviewerFallbackChain({ implementerFamily: inferred.family });
    assert.deepEqual(chain.map((r) => r.key), ['hydrogen', 'grok', 'glm', 'agyclaude']);
    assert.equal(chain[0].model, 'gemini-4-hydrogen-high');
    assert.equal(chain.some((r) => r.key === 'glm'), true);

    // Inference from runsDir when recorded: matches by branch/diff without defaulting to openai.
    const runsFile = path.join(emptyRuns, 'impl-run-1.manifest.json');
    fs.writeFileSync(runsFile, JSON.stringify({
      run_id: 'impl-run-1',
      role: 'implementer',
      branch: 'feat/glm-work',
      model: 'glm-5.3',
    }));
    const fromRuns = inferImplementerFamily({
      cwd: tmpDir,
      runsDir: emptyRuns,
      branch: 'feat/glm-work',
      env: {},
    });
    assert.equal(fromRuns.family, 'zhipu');
    assert.equal(fromRuns.source, 'runs_dir');

    // Inference from chainFile takes precedence cleanly.
    const chainFile = path.join(tmpDir, 'chain.json');
    fs.writeFileSync(chainFile, JSON.stringify({ implementer_family: 'anthropic' }));
    const fromChain = inferImplementerFamily({
      cwd: tmpDir,
      chainFile,
      runsDir: emptyRuns,
      branch: 'feat/glm-work',
      env: {},
    });
    assert.equal(fromChain.family, 'anthropic');
    assert.equal(fromChain.source, 'chain_file');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}));

test('(seat-fallback d) implementer default policy retreats along priority.implementer without codex', () => withEnv({ AUTOPILOT_PACE_FILE: MISSING_PACE }, () => {
  const chainAll = implementerFallbackChain({});
  assert.deepEqual(chainAll.map((r) => r.key), ['agy', 'grok', 'glm', 'agyclaude']);
  assert.equal(chainAll[0].model, 'gemini-4-hydrogen-high');
  assert.equal(chainAll[1].key, 'grok');
  assert.equal(chainAll[1].runner, 'grok');
  assert.equal(chainAll[1].model, 'grok-4.7');
  assert.equal(chainAll[2].endpoint, 'glm');

  const afterAgy = selectImplementerFallback({
    failedRunner: 'agy',
    failedModel: 'gemini-4-hydrogen-high',
  });
  assert.equal(afterAgy.key, 'grok');
  assert.equal(afterAgy.runner, 'grok');
  assert.equal(afterAgy.model, 'grok-4.7');
  assert.equal(afterAgy.effort, 'high');
  assert.equal(afterAgy.family, 'xai');

  const flagOf = (argv, flag) => {
    if (!Array.isArray(argv)) return '';
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === flag && i + 1 < argv.length) return argv[i + 1];
      if (typeof argv[i] === 'string' && argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1);
    }
    return '';
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-fb-engine-'));
  try {
    const promptFile = path.join(tmpDir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'implementer task\n');
    const base = '1111111111111111111111111111111111111111';

    // Case 1: local qwen endpoint unavailable with unset on_engine_unavailable -> agy/hydrogen first.
    const callsQwen = [];
    const engineQwen = new AutopilotEngine({
      clock: () => 1782864000000,
      implementationDispatcher(args) {
        callsQwen.push(args);
        return {
          error: null,
          status: 1,
          signal: null,
          stdout: '',
          stderr: '',
          parseError: null,
          result: {
            status: 'engine_unavailable',
            runner: callsQwen.length === 1 ? 'cc-shim' : 'agy',
            model: callsQwen.length === 1 ? 'Qwen3.8-27B-QUASAR-NVFP4' : 'gemini-4-hydrogen-high',
            commit: null,
            base,
            branch: 'feat/qwen-down',
            files_changed: 0,
            insertions: 0,
            deletions: 0,
            worktree: null,
            agent_log: null,
            error: 'engine unavailable (endpoint_unreachable): endpoint pre-probe qwen_local: refused',
          },
        };
      },
    });
    const outQwen = engineQwen.implementTask({
      promptFile,
      branch: 'feat/qwen-down',
      base,
      runId: 'run-fb-d1',
      implementationRound: 1,
      extraImplementationArgs: ['--endpoint', 'qwen_local'],
      roster: {
        implementer_engine: 'Qwen3.8-27B-QUASAR-NVFP4',
        implementer_effort: 'high',
        implementer_runner: 'cc-shim',
        implementer_endpoint: 'qwen_local',
      },
    });
    assert.equal(callsQwen.length, 2);
    assert.equal(outQwen.engine_unavailable.policy, 'cloud-fallback');
    assert.equal(outQwen.engine_unavailable.cloud_fallback_exhausted, true);
    assert.equal(flagOf(callsQwen[1], '--runner'), 'agy');
    assert.equal(flagOf(callsQwen[1], '--model'), 'gemini-4-hydrogen-high');
    assert.notEqual(flagOf(callsQwen[1], '--runner'), 'codex');

    // Case 2: agy seat unavailable with unset policy -> retreats to grok (grok-4.7).
    const callsAgy = [];
    const engineAgy = new AutopilotEngine({
      clock: () => 1782864000000,
      implementationDispatcher(args) {
        callsAgy.push(args);
        return {
          error: null,
          status: 1,
          signal: null,
          stdout: '',
          stderr: '',
          parseError: null,
          result: {
            status: 'engine_unavailable',
            runner: 'agy',
            model: 'gemini-4-hydrogen-high',
            commit: null,
            base,
            branch: 'feat/agy-down',
            files_changed: 0,
            insertions: 0,
            deletions: 0,
            worktree: null,
            agent_log: null,
            error: 'engine unavailable (endpoint_busy): agy overloaded',
          },
        };
      },
    });
    engineAgy.implementTask({
      promptFile,
      branch: 'feat/agy-down',
      base,
      runId: 'run-fb-d2',
      implementationRound: 1,
      roster: {
        implementer_engine: 'gemini-4-hydrogen-high',
        implementer_effort: 'high',
        implementer_runner: 'agy',
      },
    });
    assert.equal(callsAgy.length, 2);
    assert.equal(flagOf(callsAgy[1], '--runner'), 'grok');
    assert.equal(flagOf(callsAgy[1], '--model'), 'grok-4.7');
    assert.equal(flagOf(callsAgy[1], '--endpoint'), '');

    // Case 3: explicit roster.on_engine_unavailable = 'ask' still escalates without retreating.
    const callsAsk = [];
    const engineAsk = new AutopilotEngine({
      clock: () => 1782864000000,
      implementationDispatcher(args) {
        callsAsk.push(args);
        return {
          error: null,
          status: 1,
          signal: null,
          stdout: '',
          stderr: '',
          parseError: null,
          result: {
            status: 'engine_unavailable',
            runner: 'cc-shim',
            model: 'Qwen3.8-27B-QUASAR-NVFP4',
            commit: null,
            base,
            branch: 'feat/explicit-ask',
            files_changed: 0,
            insertions: 0,
            deletions: 0,
            worktree: null,
            agent_log: null,
            error: 'engine unavailable (endpoint_unreachable): refused',
          },
        };
      },
    });
    const outAsk = engineAsk.implementTask({
      promptFile,
      branch: 'feat/explicit-ask',
      base,
      runId: 'run-fb-d3',
      implementationRound: 1,
      roster: {
        implementer_engine: 'Qwen3.8-27B-QUASAR-NVFP4',
        implementer_effort: 'high',
        implementer_runner: 'cc-shim',
        on_engine_unavailable: 'ask',
      },
    });
    assert.equal(callsAsk.length, 1);
    assert.equal(outAsk.engine_unavailable.policy, 'ask');
    assert.equal(outAsk.engine_unavailable.action, 'escalate');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}));

test('(seat-fallback e) codex never appears as a retreat target in reviewer or implementer chains', () => withEnv({ AUTOPILOT_PACE_FILE: MISSING_PACE }, () => {
  for (const fam of ['google', 'anthropic', 'zhipu', 'xai', 'openai', 'unknown', '']) {
    const rev = reviewerFallbackChain({ implementerFamily: fam });
    assert.equal(
      rev.some((r) => r.runner === 'codex' || r.key === 'codex' || r.endpoint === 'codex' || isCodexRung(r)),
      false,
      `codex leaked into reviewerFallbackChain for ${fam}`
    );
  }
  for (const failed of [
    {},
    { failedRunner: 'cc-shim', failedEndpoint: 'qwen_local', failedModel: 'Qwen3.8-27B-QUASAR-NVFP4' },
    { failedRunner: 'agy', failedModel: 'gemini-4-hydrogen-high' },
    { failedRunner: 'cc-shim', failedEndpoint: 'glm', failedModel: 'glm-5.3' },
  ]) {
    const imp = implementerFallbackChain(failed);
    assert.equal(
      imp.some((r) => r.runner === 'codex' || r.key === 'codex' || r.endpoint === 'codex' || isCodexRung(r)),
      false,
      'codex leaked into implementerFallbackChain'
    );
  }

  // Even a custom roles file injecting codex must have codex filtered out by seat-fallback.js.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-fb-nocodex-'));
  try {
    const customRoles = path.join(tmpDir, 'roles.json');
    fs.writeFileSync(customRoles, JSON.stringify({
      priority: { implementer: ['codex', 'agy', 'glm'] },
      fallback: {
        reviewer: [
          { key: 'codex', runner: 'codex', model: 'gpt-6.1-sol', effort: 'high', family: 'openai' },
          { key: 'hydrogen', runner: 'agy', model: 'gemini-4-hydrogen-high', effort: 'high', family: 'google' },
        ],
      },
      role_models: { implementer: { agy: 'gemini-4-hydrogen-high' } },
    }));
    const rev = reviewerFallbackChain({ rolesPath: customRoles, implementerFamily: 'unknown' });
    assert.deepEqual(rev.map((r) => r.runner), ['agy']);
    const imp = implementerFallbackChain({ rolesPath: customRoles });
    assert.deepEqual(imp.map((r) => r.key), ['agy', 'glm']);
    assert.equal(formatRung(imp[0]), 'gemini-4-hydrogen-high/high@agy');
    assert.equal(normalizeFamily('agyclaude'), 'anthropic');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}));

// ---------------------------------------------------------------------------
// Low-quota warning demotion (PM 01M7AVE2 item 3)
// ---------------------------------------------------------------------------

test('(low 3a) quota score ranks codex then agyclaude; low_keys is diagnostic', () => {
  const withCodex = priorityPace([
    paceRow('agy', 45, 40),
    {
      pool: 'agyclaude(alias 2)',
      id: 'agyclaude-2',
      class: 'other',
      status: 'WARN_agyclaude_low',
      stale: false, hours_to_reset: 24,
      used_pct: 36,
      expected_pct: 40,
      left_pts: 4,
    },
    { pool: 'codex A', class: 'scarce', status: 'ok', stale: false, hours_to_reset: 24, used_pct: 20, expected_pct: 40 },
  ]);

  const resWithCodex = selectEngine({
    pace: withCodex,
    pools: loadPools(),
    roles: loadRoles(),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(resWithCodex.engine, 'codex');
  assert.equal(resWithCodex.selected_by, 'quota_score');
  assert.equal(resWithCodex.over_pace, false);
  assert.deepEqual(resWithCodex.low_keys, ['agyclaude']);
  assert.equal(resWithCodex.demoted_last_resort, undefined);

  // Without codex/grok, no non-low key is >= 0 slack -> agyclaude wins as last resort.
  const withoutCodexOrGrok = priorityPace([
    paceRow('agy', 45, 40),
    {
      pool: 'agyclaude(alias 2)',
      id: 'agyclaude-2',
      class: 'other',
      status: 'WARN_agyclaude_low',
      stale: false, hours_to_reset: 24,
      used_pct: 36,
      expected_pct: 40,
      left_pts: 4,
    },
  ]);

  const resLastResort = selectEngine({
    pace: withoutCodexOrGrok,
    pools: loadPools(),
    roles: loadRoles(),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(resLastResort.engine, 'agyclaude');
  assert.equal(resLastResort.demoted_last_resort, undefined);
  assert.deepEqual(resLastResort.low_keys, ['agyclaude']);

  // The CLI uses quota score and preserves low_keys diagnostics.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-low-3a-'));
  try {
    const f1 = path.join(tmpDir, 'pace-codex.json');
    const f2 = path.join(tmpDir, 'pace-last-resort.json');
    fs.writeFileSync(f1, JSON.stringify(withCodex));
    fs.writeFileSync(f2, JSON.stringify(withoutCodexOrGrok));

    const r1 = cli(['--role', 'implementer', '--pace', f1, '--json']);
    assert.equal(r1.status, 0, r1.stderr);
    const out1 = JSON.parse(r1.stdout);
    assert.equal(out1.engine, 'codex');
    assert.equal(out1.selected_by, 'quota_score');
    assert.deepEqual(out1.low_keys, ['agyclaude']);
    assert.equal(out1.demoted_last_resort, undefined);

    const r2 = cli(['--role', 'implementer', '--pace', f2, '--json']);
    assert.equal(r2.status, 0, r2.stderr);
    const out2 = JSON.parse(r2.stdout);
    assert.equal(out2.engine, 'agyclaude');
    assert.equal(out2.demoted_last_resort, undefined);
    assert.deepEqual(out2.low_keys, ['agyclaude']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('quota score supersedes legacy WARN low demotion; low_keys remains diagnostic', () => {
  const res = selectEngine({ pace: priorityPace([
    paceRow('agy', 10, 40, { status: 'WARN_agy_low' }), paceRow('glm', 38, 40),
  ]), role: 'implementer', checkEndpoint: allEndpointsReady });
  assert.equal(res.engine, 'agy');
  assert.equal(res.selected_by, 'quota_score');
  assert.deepEqual(res.low_keys, ['agy']);
});

test('(seat-fallback f / 3c) pace demotion moves low rungs behind non-low rungs and records fallback.demoted only when order changed', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-fb-low-'));
  try {
    // 1. google implementer + GLM unavailable + agyclaude low -> grok (not low) stays ahead of agyclaude; order unchanged -> demoted [].
    const agyclaudeLowPace = path.join(tmpDir, 'pace-agyclaude-low.json');
    fs.writeFileSync(agyclaudeLowPace, JSON.stringify(priorityPace([
      {
        pool: 'agyclaude(alias 2)',
        id: 'agyclaude-2',
        class: 'other',
        status: 'WARN_agyclaude_low',
        stale: false, hours_to_reset: 24,
        used_pct: 90,
        expected_pct: 40,
        left_pts: 3,
      },
    ])));
    const planGoogleLastResort = reviewerFallbackPlan({
      implementerFamily: 'google',
      excludeKeys: ['glm'],
      pacePath: agyclaudeLowPace,
    });
    assert.deepEqual(planGoogleLastResort.chain.map((r) => r.key), ['grok', 'agyclaude']);
    assert.deepEqual(planGoogleLastResort.demoted, []);

    const recNoReorder = buildFallbackRecord({
      from: 'Qwen3.8-27B@anthropic-compatible#qwen_local',
      to: formatRung(planGoogleLastResort.chain[0]),
      reason: 'endpoint_busy',
      demoted: planGoogleLastResort.demoted,
    });
    assert.equal(recNoReorder.reason, 'endpoint_busy');
    assert.equal(Object.prototype.hasOwnProperty.call(recNoReorder, 'demoted'), false);

    // 2. hydrogen low + zhipu implementer -> grok and agyclaude before hydrogen, demoted: ['hydrogen'].
    const hydrogenLowPace = path.join(tmpDir, 'pace-hydrogen-low.json');
    fs.writeFileSync(hydrogenLowPace, JSON.stringify(priorityPace([
      paceRow('hydrogen', 92, 40, { status: 'WARN_hydrogen_low', left_pts: 2 }),
      paceRow('agyclaude', 20, 40),
    ])));
    const planZhipu = reviewerFallbackPlan({
      implementerFamily: 'zhipu',
      pacePath: hydrogenLowPace,
    });
    assert.deepEqual(planZhipu.chain.map((r) => r.key), ['grok', 'agyclaude', 'hydrogen']);
    assert.deepEqual(planZhipu.demoted, ['hydrogen']);

    // Shared agy quota (WARN_agy_low) also demotes hydrogen behind grok and agyclaude.
    const agyLowPace = path.join(tmpDir, 'pace-agy-low.json');
    fs.writeFileSync(agyLowPace, JSON.stringify(priorityPace([
      paceRow('agy', 92, 40, { status: 'WARN_agy_low', left_pts: 2 }),
      paceRow('glm', 20, 40),
      paceRow('agyclaude', 25, 40),
    ])));
    const planZhipuViaAgy = reviewerFallbackPlan({
      implementerFamily: 'zhipu',
      pacePath: agyLowPace,
    });
    assert.deepEqual(planZhipuViaAgy.chain.map((r) => r.key), ['grok', 'agyclaude', 'hydrogen']);
    assert.deepEqual(planZhipuViaAgy.demoted, ['hydrogen']);

    const recDemoted = buildFallbackRecord({
      from: 'Qwen3.8-27B@anthropic-compatible#qwen_local',
      to: formatRung(planZhipu.chain[0]),
      reason: 'endpoint_busy',
      demoted: planZhipu.demoted,
    });
    assert.equal(recDemoted.reason, 'endpoint_busy');
    assert.deepEqual(recDemoted.demoted, ['hydrogen']);

    // 3. Implementer walk with agy low moves agy behind grok, glm and agyclaude.
    const implPlan = implementerFallbackPlan({ pacePath: agyLowPace });
    assert.deepEqual(implPlan.chain.map((r) => r.key), ['grok', 'glm', 'agyclaude', 'agy']);
    assert.deepEqual(implPlan.demoted, ['agy']);

    // 4. CLI supports --pace and AUTOPILOT_PACE_FILE.
    const cliFlag = spawnSync(process.execPath, [
      SEAT_FALLBACK_CLI, 'reviewer', '--implementer-family', 'zhipu', '--pace', hydrogenLowPace, '--all',
    ], { encoding: 'utf8', env: { ...process.env } });
    assert.equal(cliFlag.status, 0, cliFlag.stderr);
    assert.deepEqual(JSON.parse(cliFlag.stdout).map((r) => r.key), ['grok', 'agyclaude', 'hydrogen']);

    const cliEnv = spawnSync(process.execPath, [
      SEAT_FALLBACK_CLI, 'implementer', '--all',
    ], { encoding: 'utf8', env: { ...process.env, AUTOPILOT_PACE_FILE: agyLowPace } });
    assert.equal(cliEnv.status, 0, cliEnv.stderr);
    assert.deepEqual(JSON.parse(cliEnv.stdout).map((r) => r.key), ['grok', 'glm', 'agyclaude', 'agy']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('(seat-fallback g / 3d) missing or unreadable pace file leaves fallback order unchanged', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-fb-nopace-'));
  try {
    const missing = path.join(tmpDir, 'does-not-exist.json');
    const badJson = path.join(tmpDir, 'not-json.json');
    fs.writeFileSync(badJson, '{ broken json');

    for (const pacePath of [missing, badJson]) {
      const revZhipu = reviewerFallbackPlan({ implementerFamily: 'zhipu', pacePath });
      assert.deepEqual(revZhipu.chain.map((r) => r.key), ['hydrogen', 'grok', 'agyclaude']);
      assert.deepEqual(revZhipu.demoted, []);

      const revGoogle = reviewerFallbackPlan({ implementerFamily: 'google', pacePath });
      assert.deepEqual(revGoogle.chain.map((r) => r.key), ['grok', 'glm', 'agyclaude']);
      assert.deepEqual(revGoogle.demoted, []);

      const imp = implementerFallbackPlan({ pacePath });
      assert.deepEqual(imp.chain.map((r) => r.key), ['agy', 'grok', 'glm', 'agyclaude']);
      assert.deepEqual(imp.demoted, []);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// PM addendum 2: a kimi Highspeed variant burns 3x Coding Plan quota; no kimi id with "highspeed" may sit in a
// reviewer/implementer list, the live roster or the pool table.
test('no kimi highspeed model id in the live roster, implementer/reviewer lists or noncq pools', () => {
  const fsx = require('fs');
  const pathx = require('path');
  const root = pathx.join(__dirname, '..');
  const roster = fsx.readFileSync(pathx.join(root, '.claude', 'review-loop-config.md'), 'utf8');
  const kimiLines = roster.split('\n').filter((l) => /kimi/i.test(l));
  assert.ok(kimiLines.length >= 1, 'the live roster names kimi (as a disabled note)');
  // PM addendum 3: no highspeed id, no K3.1 Pro, no bare 1M k3 (k3-256k is the only k3 spelling allowed).
  for (const l of kimiLines) assert.doesNotMatch(l, /highspeed|k3\.1-pro|kimi-code[\/-]k3(?!-256k)/i, l);
  const pools = fsx.readFileSync(pathx.join(root, 'scripts', 'lib', 'noncq-pools.json'), 'utf8');
  for (const p of Object.values(JSON.parse(pools))) {
    if (/kimi/i.test(JSON.stringify(p))) assert.doesNotMatch(JSON.stringify(p), /highspeed|k3\.1-pro/i);
  }
});

test('pace-roles _disabled: a disabled key with a fresh pace row is never returned, enabling it makes it pickable', () => {
  const pace = priorityPace([paceRow('kimi', 5, 60)]);
  const pools = loadPools();
  const roles = loadRoles();
  assert.deepEqual(roles._disabled, ['kimi', 'minimax']);
  const run = (r) => { try { return selectEngine({ pace, pools, roles: r, role: 'implementer', checkEndpoint: allEndpointsReady }); } catch (e) { return { error: e.code || e.message }; } };
  const off = run(roles);
  assert.notEqual(off.engine, 'kimi', JSON.stringify(off));
  const on = run({ ...roles, _disabled: [] });
  assert.equal(on.engine, 'kimi', JSON.stringify(on));
});

// ---- DeepSeek restricted reviewer seat (PM 01M7EETN): cn_gate pool in pace-roles.json -------------------
const dsPace = (rows) => ({
  schema: 'capacity.pace/1',
  generated_at: '2026-11-15T01:00:00Z',
  rows: rows || [{ pool: 'agy', class: 'other', stale: false, hours_to_reset: 24, used_pct: 10, expected_pct: 20 }],
});
const DS_IN_WINDOW = new Date('2026-11-15T02:00:00Z'); // 10:00 Taipei
const DS_OUT_WINDOW = new Date('2026-11-15T05:00:00Z'); // 13:00 Taipei
// Default seam file lists the in-window clock's Taipei date, so the existing
// deepseek cases stay on "date listed" once available_dates_file is set.
const dsSeamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-seam-default-'));
const dsSeamFile = path.join(dsSeamDir, 'days.txt');
fs.writeFileSync(dsSeamFile, '# listed\n\n2026-11-15\n');
const dsSeamEnv = { ...testTask, HOME: dsSeamDir, AUTOPILOT_DS_SEAM_DAYS_FILE: dsSeamFile };
const dsSelect = (extra) => selectEngine({
  pace: dsPace(extra && extra.rows),
  role: 'reviewer',
  qualified: undefined,
  checkEndpoint: allEndpointsReady,
  env: dsSeamEnv,
  ...extra,
  // CN gate bars cloud review_roles unconditionally; scope the test seam to these unit tests of cn_gate/seam-day logic.
  env: { ...testTask, AUTOPILOT_TEST_CN_GATE_OFF: '1', ...(extra?.env || dsSeamEnv) },
  // only the deepseek seat is under test: take the other pools out of the walk unless the case wants them
});
const dsRolesDated = (fileOrNull) => {
  const roles = loadRoles();
  const deepseek = { ...roles.pools.deepseek };
  if (fileOrNull === null) delete deepseek.available_dates_file;
  else deepseek.available_dates_file = fileOrNull;
  return { ...roles, pools: { ...roles.pools, deepseek } };
};
const DS_OTHERS = ['glm', 'codex', 'grok', 'agyclaude'];
const dsCandidate = (res) => res.candidates.find((c) => c.engine === 'deepseek');

test('(deepseek 1) deepseek is classified Chinese-family, seat pool is cn_gate', () => {
  assert.equal(isChineseFamily('deepseek'), true);
  for (const f of ['zhipu', 'alibaba', 'moonshot', 'minimax', 'meituan']) assert.equal(isChineseFamily(f), true, f);
  for (const f of ['google', 'openai', 'anthropic', 'xai', 'unknown', undefined]) assert.equal(isChineseFamily(f), false, String(f));
  const pool = loadRoles().pools.deepseek;
  assert.equal(pool.cn_gate, true);
  assert.equal(pool.family, 'deepseek');
  assert.equal(isChineseFamily(pool.family), true);
  assert.deepEqual(pool.available_window, { tz: 'Asia/Taipei', start: '09:00', end: '12:45' });
  assert.equal(pool.available_dates_file, '~/.config/autopilot/ds-seam-days.txt');
  assert.match(pool.available_dates_why, /Delete this key when the recovery line ends/);
  assert.match(loadRoles()._why, /available_dates_file/);
});

test('(deepseek 2) without --scope mechanical the seat is not a candidate at all', () => {
  const res = dsSelect({ now: DS_IN_WINDOW });
  assert.equal(dsCandidate(res), undefined);
  assert.notEqual(res.engine, 'deepseek');
});

test('(deepseek 3) mechanical scope inside the window with a non-Chinese pair: candidate, pair reported', () => {
  const res = dsSelect({ scope: 'mechanical', now: DS_IN_WINDOW, exclude: ['glm', 'codex', 'grok', 'agyclaude'] });
  // agy stays eligible (the pair); deepseek ranks behind it (slack 0 vs +10) and is listed as a candidate
  assert.equal(res.engine, 'agy');
  assert.deepEqual(dsCandidate(res), { engine: 'deepseek', pool: 'deepseek', slack_pts: 0 });
});

test('(deepseek 4) outside 09:00-12:45 Asia/Taipei the seat is skipped with reason outside_window', () => {
  const res = dsSelect({ scope: 'mechanical', now: DS_OUT_WINDOW });
  assert.deepEqual(dsCandidate(res), { engine: 'deepseek', reason: 'outside_window' });
  assert.equal(inAvailableWindow({ tz: 'Asia/Taipei', start: '09:00', end: '12:45' }, new Date('2026-11-15T00:59:00Z')), false); // 08:59
  assert.equal(inAvailableWindow({ tz: 'Asia/Taipei', start: '09:00', end: '12:45' }, new Date('2026-11-15T01:00:00Z')), true); // 09:00
  assert.equal(inAvailableWindow({ tz: 'Asia/Taipei', start: '09:00', end: '12:45' }, new Date('2026-11-15T04:44:00Z')), true); // 12:44
  assert.equal(inAvailableWindow({ tz: 'Asia/Taipei', start: '09:00', end: '12:45' }, new Date('2026-11-15T04:45:00Z')), false); // 12:45
});

test('(deepseek 5) offline (probe not ok) -> endpoint_not_ready, never waited for; the probe gets the pool entry', () => {
  let probed = null;
  const res = dsSelect({
    scope: 'mechanical',
    now: DS_IN_WINDOW,
    checkEndpoint: (ep, entry) => { if (ep === 'deepseek') { probed = entry; return false; } return true; },
  });
  assert.deepEqual(dsCandidate(res), { engine: 'deepseek', reason: 'endpoint_not_ready' });
  assert.equal(probed.probe_model, 'deepseek-v4.1-flash');
  assert.notEqual(res.engine, 'deepseek');
});

test('(deepseek 6) never the sole reviewer: with no non-Chinese key to pair, it is dropped (no_non_cn_pair)', () => {
  // only the deepseek seat and a Chinese-family seat (glm, zhipu pool has no family field -> keep it explicit) are left
  const res = dsSelect({
    scope: 'mechanical',
    now: DS_IN_WINDOW,
    exclude: ['agy', 'codex', 'grok', 'agyclaude'],
    rows: [{ pool: 'glm', class: 'other', stale: false, hours_to_reset: 24, used_pct: 10, expected_pct: 20 }],
  });
  assert.deepEqual(dsCandidate(res), { engine: 'deepseek', reason: 'no_non_cn_pair' });
  assert.notEqual(res.engine, 'deepseek');
  // with the pair present (agy) and deepseek the priority pick, it is chosen and reports its pair
  const roles = loadRoles();
  const only = { ...roles, priority: { ...roles.priority, reviewer: ['deepseek'] } };
  const paired = selectEngine({
    pace: dsPace([...dsPace().rows, { pool: 'deepseek', class: 'other', stale: false, used_pct: 0, expected_pct: 0, hours_to_reset: 1 }]), pools: loadPools(), roles: only, role: 'reviewer', scope: 'mechanical', now: DS_IN_WINDOW,
    checkEndpoint: allEndpointsReady, exclude: ['glm', 'codex', 'grok', 'agyclaude'], env: { ...dsSeamEnv, AUTOPILOT_TEST_CN_GATE_OFF: '1' },
  });
  assert.equal(paired.engine, 'deepseek');
  assert.deepEqual(paired.cn_gate, { scope: 'mechanical', never_sole: true, pair_with: 'agy' });
});

test('(deepseek 7) listed seam day inside the window: deepseek stays selectable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-seam-in-'));
  try {
    const file = path.join(dir, 'days.txt');
    fs.writeFileSync(file, '# comment\n\n2026-11-16\n2026-11-17\n');
    const res = dsSelect({
      scope: 'mechanical',
      now: new Date('2026-11-16T10:00:00+08:00'),
      roles: dsRolesDated(file),
      env: { HOME: dir },
      exclude: DS_OTHERS,
    });
    assert.equal(res.engine, 'agy');
    assert.deepEqual(dsCandidate(res), { engine: 'deepseek', pool: 'deepseek', slack_pts: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('(deepseek 8) inside the window but not a listed seam day: not_seam_day, next reviewer, exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-seam-out-'));
  try {
    const file = path.join(dir, 'days.txt');
    fs.writeFileSync(file, '# comment\n\n2026-11-16\n2026-11-17\n');
    const now = new Date('2026-11-18T10:00:00+08:00');
    const res = dsSelect({
      scope: 'mechanical',
      now,
      roles: dsRolesDated(file),
      env: { HOME: dir },
      exclude: DS_OTHERS,
    });
    assert.deepEqual(dsCandidate(res), { engine: 'deepseek', reason: 'not_seam_day' });
    assert.equal(res.engine, 'agy');

    const rolesPath = path.join(dir, 'pace-roles.json');
    const pacePath = path.join(dir, 'pace.json');
    fs.writeFileSync(rolesPath, JSON.stringify(dsRolesDated(file)));
    fs.writeFileSync(pacePath, JSON.stringify(dsPace()));
    const cliRes = cli([
      '--role', 'reviewer', '--scope', 'mechanical', '--now', '2026-11-18T10:00:00+08:00', '--pace', pacePath,
    ], {
      AUTOPILOT_PACE_ROLES: rolesPath,
      AUTOPILOT_DS_SEAM_DAYS_FILE: file,
      AUTOPILOT_ENDPOINT_DEEPSEEK_URL: '',
      AUTOPILOT_ENDPOINT_DEEPSEEK_TOKEN: '',
      HOME: dir,
    });
    assert.equal(cliRes.status, 0, cliRes.stderr);
    const body = JSON.parse(cliRes.stdout);
    assert.equal(body.engine, 'agy');
    assert.deepEqual(dsCandidate(body), { engine: 'deepseek', reason: 'not_seam_day' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('(deepseek 9) absent available_dates_file keeps today behaviour even when the seam file would block', () => {
  const missing = path.join(dsSeamDir, 'no-such-days.txt');
  const res = dsSelect({
    scope: 'mechanical',
    now: DS_IN_WINDOW,
    roles: dsRolesDated(null),
    env: { HOME: dsSeamDir, AUTOPILOT_DS_SEAM_DAYS_FILE: missing },
    exclude: DS_OTHERS,
  });
  assert.equal(res.engine, 'agy');
  assert.deepEqual(dsCandidate(res), { engine: 'deepseek', pool: 'deepseek', slack_pts: 0 });
});

test('(deepseek 10) a non YYYY-MM-DD line fails closed with bad_available_dates; another reviewer is chosen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-seam-bad-'));
  try {
    const file = path.join(dir, 'days.txt');
    fs.writeFileSync(file, '2026-11-15\n2026-02-31\n');
    const res = dsSelect({
      scope: 'mechanical',
      now: DS_IN_WINDOW,
      roles: dsRolesDated(file),
      env: { HOME: dir },
      exclude: DS_OTHERS,
    });
    assert.deepEqual(dsCandidate(res), { engine: 'deepseek', reason: 'bad_available_dates' });
    assert.equal(res.engine, 'agy');

    const rolesPath = path.join(dir, 'pace-roles.json');
    const pacePath = path.join(dir, 'pace.json');
    fs.writeFileSync(rolesPath, JSON.stringify(dsRolesDated(file)));
    fs.writeFileSync(pacePath, JSON.stringify(dsPace()));
    const cliRes = cli([
      '--role', 'reviewer', '--scope', 'mechanical', '--now', '2026-11-15T10:00:00+08:00', '--pace', pacePath,
    ], {
      AUTOPILOT_PACE_ROLES: rolesPath,
      HOME: dir,
      AUTOPILOT_ENDPOINT_DEEPSEEK_URL: '',
      AUTOPILOT_ENDPOINT_DEEPSEEK_TOKEN: '',
    });
    assert.equal(cliRes.status, 0, cliRes.stderr);
    const body = JSON.parse(cliRes.stdout);
    assert.equal(body.engine, 'agy');
    assert.deepEqual(dsCandidate(body), { engine: 'deepseek', reason: 'bad_available_dates' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('(deepseek 11) missing seam-days file: seam_days_unreadable; another reviewer is chosen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-seam-gone-'));
  try {
    const file = path.join(dir, 'missing.txt');
    const res = dsSelect({
      scope: 'mechanical',
      now: DS_IN_WINDOW,
      roles: dsRolesDated(file),
      env: { HOME: dir },
      exclude: DS_OTHERS,
    });
    assert.deepEqual(dsCandidate(res), { engine: 'deepseek', reason: 'seam_days_unreadable' });
    assert.equal(res.engine, 'agy');

    const rolesPath = path.join(dir, 'pace-roles.json');
    const pacePath = path.join(dir, 'pace.json');
    fs.writeFileSync(rolesPath, JSON.stringify(dsRolesDated(file)));
    fs.writeFileSync(pacePath, JSON.stringify(dsPace()));
    const cliRes = cli([
      '--role', 'reviewer', '--scope', 'mechanical', '--now', '2026-11-15T10:00:00+08:00', '--pace', pacePath,
    ], {
      AUTOPILOT_PACE_ROLES: rolesPath,
      HOME: dir,
      AUTOPILOT_ENDPOINT_DEEPSEEK_URL: '',
      AUTOPILOT_ENDPOINT_DEEPSEEK_TOKEN: '',
    });
    assert.equal(cliRes.status, 0, cliRes.stderr);
    const body = JSON.parse(cliRes.stdout);
    assert.equal(body.engine, 'agy');
    assert.deepEqual(dsCandidate(body), { engine: 'deepseek', reason: 'seam_days_unreadable' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('(deepseek 12) ~ expands to HOME and the file is read again at each pick', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-seam-home-'));
  try {
    const file = path.join(home, '.config', 'autopilot', 'ds-seam-days.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '2026-11-15\n');
    const pick = () => dsSelect({
      scope: 'mechanical',
      now: DS_IN_WINDOW,
      roles: dsRolesDated('~/.config/autopilot/ds-seam-days.txt'),
      env: { HOME: home },
      exclude: DS_OTHERS,
    });
    assert.deepEqual(dsCandidate(pick()), { engine: 'deepseek', pool: 'deepseek', slack_pts: 0 });
    fs.writeFileSync(file, '2026-11-16\n');
    assert.deepEqual(dsCandidate(pick()), { engine: 'deepseek', reason: 'not_seam_day' });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('(deepseek 13) AUTOPILOT_DS_SEAM_DAYS_FILE overrides available_dates_file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-seam-over-'));
  try {
    const configured = path.join(dir, 'configured.txt');
    const override = path.join(dir, 'override.txt');
    fs.writeFileSync(configured, '2026-11-15\n');
    fs.writeFileSync(override, '2026-11-16\n');
    const res = dsSelect({
      scope: 'mechanical',
      now: DS_IN_WINDOW,
      roles: dsRolesDated(configured),
      env: { HOME: dir, AUTOPILOT_DS_SEAM_DAYS_FILE: override },
      exclude: DS_OTHERS,
    });
    assert.deepEqual(dsCandidate(res), { engine: 'deepseek', reason: 'not_seam_day' });
    assert.equal(res.engine, 'agy');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('(deepseek 14) outside the window stays outside_window even when the seam file is missing or the date is absent', () => {
  const missing = dsSelect({
    scope: 'mechanical',
    now: DS_OUT_WINDOW,
    roles: dsRolesDated(path.join(dsSeamDir, 'definitely-missing.txt')),
    env: { HOME: dsSeamDir },
    exclude: DS_OTHERS,
  });
  assert.deepEqual(dsCandidate(missing), { engine: 'deepseek', reason: 'outside_window' });

  const otherDay = path.join(dsSeamDir, 'other-day.txt');
  fs.writeFileSync(otherDay, '2026-11-16\n');
  const unlisted = dsSelect({
    scope: 'mechanical',
    now: DS_OUT_WINDOW,
    roles: dsRolesDated(otherDay),
    env: { HOME: dsSeamDir },
    exclude: DS_OTHERS,
  });
  assert.deepEqual(dsCandidate(unlisted), { engine: 'deepseek', reason: 'outside_window' });
});

// PM 01M7K384: quota score replaces the habitual priority walk.
test('quota ranking: reviewer picks codex at 13 over agy at 43 and grok at 93', () => {
  const result = selectEngine({ pace: readFixture('quota-default.json'), role: 'reviewer', checkEndpoint: allEndpointsReady });
  assert.equal(result.engine, 'codex');
});
test('quota ranking: equal remaining quota prefers the sooner reset', () => {
  const pace = readFixture('quota-default.json');
  pace.rows = pace.rows.filter(r => r.pool !== 'grok-cli');
  pace.rows.forEach(r => { r.used_pct = 40; });
  const result = selectEngine({ pace, role: 'reviewer', checkEndpoint: allEndpointsReady });
  assert.equal(result.engine, 'codex');
});

test('quota ceiling: 85 inclusive, configurable, and reported before ranking', () => {
  const pace = readFixture('quota-default.json');
  const run = (roles = loadRoles()) => selectEngine({ pace, roles, role: 'reviewer', checkEndpoint: allEndpointsReady });
  assert.equal(run().candidates.find(c => c.engine === 'grok').reason, 'over_ceiling');
  pace.rows = [pace.rows[0]];
  pace.rows[0].used_pct = 85;
  assert.equal(run().engine, null);
  pace.rows[0].expected_pct = null;
  assert.equal(run().candidates.find(c => c.engine === 'grok').reason, 'over_ceiling');
  pace.rows[0].expected_pct = 60;
  assert.equal(run({ ...loadRoles(), PACE_CEILING_PCT: 90 }).engine, 'grok');
});

test('quota stale: recent codex loses to every fresh row but beats over-ceiling grok', () => {
  const pace = readFixture('quota-default.json');
  const now = new Date('2026-11-17T00:00:00Z');
  const codex = pace.rows.find(r => r.pool === 'codex A');
  codex.stale = true;
  pace.rows[0].used_pct = 70;
  pace.rows[0].hours_to_reset = 100;
  const run = () => selectEngine({ pace, now, role: 'reviewer', checkEndpoint: allEndpointsReady });
  assert.equal(run().engine, 'agy');
  pace.rows = pace.rows.filter(r => r.pool !== 'agy');
  pace.rows[0].used_pct = 93;
  assert.equal(run().engine, 'codex');
  assert.equal(run().status, 'stale_recent');
  for (const patch of [{ seen_at: '2026-11-15T23:59:59Z' }, { seen_at: null }, { reset_at: '2026-11-16T00:00:00Z' }, { used_pct: null }, { seen_at: '2026-11-17T00:00:01Z' }]) {
    const saved = { ...codex };
    Object.assign(codex, patch);
    assert.equal(run().engine, null, JSON.stringify(patch));
    Object.assign(codex, saved);
  }
  codex.expected_pct = null; // score needs usage and reset; slack is only a tie-breaker
  assert.equal(run().engine, 'codex');
  codex.seen_at = '2026-11-16T00:00:00Z'; // inclusive 24-hour boundary
  assert.equal(run().engine, 'codex');
});

test('quota gates: CN review gate, qualification and disabled keys precede ranking', () => {
  const pace = readFixture('quota-default.json');
  pace.rows.push({ ...pace.rows[0], pool: 'glm', used_pct: 0, hours_to_reset: 1 });
  const run = (extra = {}) => selectEngine({ pace, role: 'reviewer', env: { AUTOPILOT_TASK_SIZE: 'M', AUTOPILOT_TASK_SCOPE: 'scripts/pace-select.js' },
    checkEndpoint: () => { throw Error('barred endpoint must not be probed'); }, ...extra });
  assert.equal(run().engine, 'codex');
  assert.equal(run().candidates.find(c => c.engine === 'glm').reason, 'cn_model_dispatch_barred');
  // Even at Size S / public docs, reviewer role bars glm and deepseek via CN gate, while author/implementer allows glm.
  const revSmall = selectEngine({
    pace, role: 'reviewer', scope: 'mechanical', now: DS_IN_WINDOW,
    env: { ...dsSeamEnv },
    checkEndpoint: (ep) => { if (ep === 'glm' || ep === 'deepseek') throw Error('barred endpoint must not be probed'); return true; },
  });
  assert.equal(revSmall.candidates.find(c => c.engine === 'glm').reason, 'cn_model_dispatch_barred');
  assert.equal(revSmall.candidates.find(c => c.engine === 'deepseek').reason, 'cn_model_dispatch_barred');
  assert.equal(run({ roles: { ...loadRoles(), _disabled: ['codex'] } }).engine, 'agy');
  const qualified = { schema: QUALIFIED_SCHEMA, rows: [
    { runner: 'codex', engine: 'gpt-6.1-sol', role: 'reviewer', result: 'fail' },
    { runner: 'agy', engine: 'gemini-4-carbon-high', role: 'reviewer', result: 'pass' },
  ] };
  assert.equal(run({ qualified }).engine, 'agy');
});

test('quota caller pin: broken qualification data cannot veto a named runner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-named-'));
  try {
    const qualified = path.join(dir, 'qualified.json');
    fs.writeFileSync(qualified, '{broken');
    const r = cli(['--role', 'reviewer', '--dispatch', '--pace', fixturePath('quota-default.json'),
      '--qualified', qualified, '--named-runner', 'grok', '--named-model', 'grok-4.7']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /named by caller, dispatching anyway/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('quota review: every comma-separated implementer family is excluded before ranking', () => {
  const pace = readFixture('quota-default.json');
  pace.rows[0].used_pct = 70;
  const result = selectEngine({ pace, role: 'reviewer', excludeFamily: 'openai, google', checkEndpoint: allEndpointsReady });
  assert.equal(result.engine, 'grok');
  for (const engine of ['codex', 'agy']) assert.equal(result.candidates.find(c => c.engine === engine).reason, 'same_family');
});

test('cc-shim named pool matching: --named-endpoint isolates pools and runner-only fallback requires single key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-ccshim-'));
  try {
    const pace = readFixture('quota-default.json');
    pace.rows.push(
      { pool: 'glm', class: 'other', used_pct: 90, expected_pct: 60, stale: false, hours_to_reset: 12, reset_at: '2026-11-17T12:00:00.000Z', seen_at: '2026-11-16T23:00:00Z', status: 'ok' },
      { pool: 'minimax', class: 'other', used_pct: 0, expected_pct: 60, stale: false, hours_to_reset: 12, reset_at: '2026-11-17T12:00:00.000Z', seen_at: '2026-11-16T23:00:00Z', status: 'ok' },
    );
    const pacePath = path.join(dir, 'pace.json');
    fs.writeFileSync(pacePath, JSON.stringify(pace));

    // Direction 1: cc-shim + glm endpoint while glm >=85% and minimax 0% must still warn about glm.
    for (const extra of [
      ['--named-runner', 'cc-shim', '--named-endpoint', 'glm'],
      ['--named-endpoint', 'glm'],
      ['--named-runner', 'cc-shim', '--named-model', 'glm-5.3', '--named-endpoint', 'glm'],
    ]) {
      const r = cli(['--role', 'implementer', '--dispatch', '--pace', pacePath, ...extra]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /pace: glm is at 90% of its 7-day window.*named by caller, dispatching anyway — codex has 87% left/);
    }

    // Direction 2: naming minimax while glm >=85% must not warn about glm.
    for (const extra of [
      ['--named-runner', 'cc-shim', '--named-model', 'MiniMax-M3.1-Flash'],
      ['--named-runner', 'cc-shim', '--named-endpoint', 'minimax'],
      ['--named-runner', 'cc-shim', '--named-model', 'MiniMax-M3.1-Flash', '--named-endpoint', 'minimax'],
      ['--named-runner', 'cc-shim', '--named-endpoint', 'qwen_local'],
      ['--named-runner', 'cc-shim'],
    ]) {
      const r = cli(['--role', 'implementer', '--dispatch', '--pace', pacePath, ...extra]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, '', `expected no warning for ${extra.join(' ')}`);
    }

    // Single-key runner fallback still works for grok and codex, not multi-key agy.
    const grokDiffModel = cli(['--role', 'implementer', '--dispatch', '--pace', pacePath, '--named-runner', 'grok', '--named-model', 'grok-4.6']);
    assert.equal(grokDiffModel.status, 0, grokDiffModel.stderr);
    assert.match(grokDiffModel.stderr, /pace: grok is at 93% of its 7-day window/);

    const multiPace = structuredClone(pace);
    multiPace.rows.find(r => r.pool === 'codex A').used_pct = 90;
    multiPace.rows.find(r => r.pool === 'agy').used_pct = 90;
    multiPace.rows.push({ pool: 'agyclaude', class: 'other', used_pct: 0, expected_pct: 60, stale: false, hours_to_reset: 12, reset_at: '2026-11-17T12:00:00.000Z', seen_at: '2026-11-16T23:00:00Z', status: 'ok' });
    const multiPacePath = path.join(dir, 'pace-multi.json');
    fs.writeFileSync(multiPacePath, JSON.stringify(multiPace));

    const codexOnly = cli(['--role', 'implementer', '--dispatch', '--pace', multiPacePath, '--named-runner', 'codex']);
    assert.equal(codexOnly.status, 0, codexOnly.stderr);
    assert.match(codexOnly.stderr, /pace: codex is at 90% of its 7-day window/);

    const agyOnly = cli(['--role', 'implementer', '--dispatch', '--pace', multiPacePath, '--named-runner', 'agy']);
    assert.equal(agyOnly.status, 0, agyOnly.stderr);
    assert.equal(agyOnly.stderr, '');

    // parseArgs rejects empty/missing --named-endpoint.
    assert.equal(cli(['--role', 'implementer', '--dispatch', '--pace', pacePath, '--named-endpoint', '']).status, 2);
    assert.equal(cli(['--role', 'implementer', '--dispatch', '--pace', pacePath, '--named-endpoint']).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
