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
} = require('./pace-select.js');

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
  rows,
});
const paceRow = (pool, used, expected, extra = {}) => ({
  pool,
  class: 'other',
  status: 'ok',
  stale: false,
  used_pct: used,
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

  assert.deepEqual(roles.reviewer, ['agy', 'glm', 'codex', 'grok', 'agyclaude']);
  assert.deepEqual(roles.implementer, ['agy', 'glm', 'agyclaude', 'codex', 'grok']);
  assert.deepEqual(roles.author, ['agy', 'glm', 'codex', 'grok', 'agyclaude']);
  assert.deepEqual(roles.priority, { implementer: ['agy', 'glm', 'agyclaude'] });
  assert.deepEqual(roles.role_models, { implementer: { agy: 'gemini-4-hydrogen-high' } });

  for (const r of ['reviewer', 'implementer', 'author']) {
    assert.equal(roles[r].includes('agyclaude'), true);
    assert.equal(roles[r].includes('minimax'), false);
  }

  assert.deepEqual(roles.pools, {
    'codex A': { key: 'codex', runner: 'codex', model: 'gpt-6.1-sol' },
    'codex B': { key: 'codex', runner: 'codex', model: 'gpt-6.1-sol' },
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

test('(a) a key 25 pts ahead loses to a key 14 pts behind; claude rows are never candidates', () => {
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
    engine: 'grok',
    runner: 'grok',
    model: 'grok-4.7',
    pool: 'grok-cli',
    slack_pts: 14,
    used_pct: 26,
    expected_pct: 40,
    over_pace: false,
    selected_by: 'slack',
    low_keys: [],
    reviewer_exclude: ['grok'],
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
  assert.equal(withClaude.engine, 'grok');
  assert.deepEqual(
    withClaude.candidates.find((c) => c.engine === 'codex'),
    { engine: 'codex', reason: 'unknown' },
  );

  // Qualified agyclaude wins when its pool row is fresh and has the largest slack.
  const agyClaudeFresh = structuredClone(pace);
  agyClaudeFresh.rows.find((row) => row.pool === 'agyclaude(alias 2)').stale = false;
  const agyClaudeWin = selectEngine({
    pace: agyClaudeFresh,
    pools,
    roles,
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(agyClaudeWin.engine, 'agyclaude');
  assert.equal(agyClaudeWin.runner, 'agy');
  assert.equal(agyClaudeWin.model, 'claude-opus-5-5-medium');
  assert.equal(agyClaudeWin.pool, 'agyclaude(alias 2)');
  assert.equal(agyClaudeWin.slack_pts, 70);
});

test('(b) stale row and null expected_pct/used_pct rows are reported as unknown and never selected', () => {
  const pace = readFixture('stale-and-null.json');
  const pools = loadPools();
  const roles = loadRoles();

  // agy is stale (+76 if read as fresh); glm has expected_pct:null, used_pct:0 (0 slack if null read as 0);
  // grok-cli has used_pct:null, expected_pct:70 (+70 slack if null read as 0);
  // grok-cli(alias 2) is fresh with slack -6. Every broken reading would beat -6 if misread.
  const r = cli(['--role', 'reviewer', '--pace', fixturePath('stale-and-null.json'), '--json']);
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
  nullAsZeroPace.rows.find((row) => row.pool === 'glm').expected_pct = 0;
  assert.equal(
    selectEngine({
      pace: nullAsZeroPace,
      pools,
      roles,
      role: 'reviewer',
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
      role: 'reviewer',
      checkEndpoint: allEndpointsReady,
    }).engine,
    'agy',
  );
});

test('(c) only ahead keys (< -10 slack) -> largest slack chosen with over_pace: true', () => {
  const r = cli(['--role', 'reviewer', '--pace', fixturePath('only-ahead.json'), '--json']);
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

  // implementer: the priority walk fails (agy -32, glm -15, agyclaude unknown),
  // so the slack fallback picks glm (-15), the least-behind eligible key.
  const impl = selectEngine({
    pace: readFixture('only-ahead.json'),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(impl.engine, 'glm');
  assert.equal(impl.selected_by, 'slack');
  assert.equal(impl.slack_pts, -15);
  assert.equal(impl.over_pace, true);

  // Boundary: slack === -10 qualifies (over_pace: false); slack === -11 sets over_pace: true.
  const atFloor = selectEngine({
    pace: {
      schema: 'capacity.pace/1',
      generated_at: '2026-11-13T02:12:00Z',
      rows: [{ pool: 'agy', class: 'other', status: 'WARN_ahead', stale: false, used_pct: 50, expected_pct: 40 }],
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
      rows: [{ pool: 'agy', class: 'other', status: 'WARN_ahead', stale: false, used_pct: 51, expected_pct: 40 }],
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
    { engine: 'glm', reason: 'unknown' },
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
  assert.equal(JSON.parse(viaEnv.stdout).engine, 'grok');

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

  const base = cli(['--role', 'reviewer', '--pace', file, '--json']);
  assert.equal(base.status, 0, base.stderr);
  assert.equal(JSON.parse(base.stdout).engine, 'grok');

  const noGrok = cli(['--role', 'reviewer', '--pace', file, '--exclude', 'grok', '--json']);
  assert.equal(noGrok.status, 0, noGrok.stderr);
  const noGrokOut = JSON.parse(noGrok.stdout);
  assert.equal(noGrokOut.engine, 'glm');
  assert.equal(noGrokOut.slack_pts, -3);
  assert.equal(noGrokOut.over_pace, false);
  assert.equal(noGrokOut.candidates.some((c) => c.engine === 'grok'), false);

  const noGrokGlm = cli(['--role', 'reviewer', '--pace', file, '--exclude', 'grok,glm', '--json']);
  assert.equal(noGrokGlm.status, 0, noGrokGlm.stderr);
  const noGrokGlmOut = JSON.parse(noGrokGlm.stdout);
  assert.equal(noGrokGlmOut.engine, 'agy');
  assert.equal(noGrokGlmOut.slack_pts, -25);
  assert.equal(noGrokGlmOut.over_pace, true);

  const noneLeft = cli(['--role', 'reviewer', '--pace', file, '--exclude', 'grok,glm,agy', '--json']);
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
    over_pace: false,
    selected_by: 'priority',
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
    over_pace: true,
    selected_by: 'slack',
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
        stale: false,
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

  // Control: when endpoint is ready (injected, no shell spawn), glm (+30) beats grok (+14).
  const checkedReady = [];
  const whenReady = selectEngine({
    pace,
    pools,
    roles,
    role: 'reviewer',
    checkEndpoint: (ep) => {
      checkedReady.push(ep);
      return true;
    },
  });
  assert.deepEqual(checkedReady, ['glm']);
  assert.equal(whenReady.engine, 'glm');
  assert.equal(whenReady.slack_pts, 30);

  // When glm endpoint is not ready (injected, no shell spawn), glm is listed as
  // { engine: "glm", reason: "endpoint_not_ready" } and grok (+14) is chosen instead.
  const checkedUnready = [];
  const whenNotReady = selectEngine({
    pace,
    pools,
    roles,
    role: 'reviewer',
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
    ['--role', 'reviewer', '--pace', fixturePath('glm-best-slack.json'), '--json'],
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
        { engine: 'grok-4.7', runner: 'grok', role: 'reviewer', result: 'fail', date: '2026-11-12', event_id: 1 },
        { engine: 'glm-5.3', runner: 'cc-shim', role: 'reviewer', result: 'provisional', date: '2026-11-11', event_id: 2 },
        { engine: 'gemini-4-carbon-high', runner: 'agy', role: 'reviewer', result: 'pass', date: '2026-11-10', event_id: 3 },
      ],
    };
    fs.writeFileSync(qPath, `${JSON.stringify(qualifiedDoc, null, 2)}\n`, 'utf8');

    const viaFlag = cli(['--role', 'reviewer', '--pace', paceFile, '--qualified', qPath, '--json']);
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

    const viaEnv = cli(['--role', 'reviewer', '--pace', paceFile, '--json'], {
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
    const viaMissingFlag = cli(['--role', 'reviewer', '--pace', paceFile, '--qualified', missingPath, '--json']);
    assert.equal(viaMissingFlag.status, 0, viaMissingFlag.stderr);
    const missingFlagOut = JSON.parse(viaMissingFlag.stdout);
    assert.equal(missingFlagOut.engine, 'grok');
    assert.equal(missingFlagOut.qualified_source, 'pace-roles.json');

    assert.equal(
      defaultQualifiedPath({ HOME: tmpDir }),
      path.join(tmpDir, '.autopilot', 'qualified.v1.json'),
    );
    const viaMissingDefault = cli(['--role', 'reviewer', '--pace', paceFile, '--json'], {
      HOME: tmpDir,
      AUTOPILOT_QUALIFIED_FILE: undefined,
    });
    assert.equal(viaMissingDefault.status, 0, viaMissingDefault.stderr);
    const missingDefaultOut = JSON.parse(viaMissingDefault.stdout);
    assert.equal(missingDefaultOut.engine, 'grok');
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

test('(priority a) agy slack +1 beats glm +30: priority order wins, hydrogen model, reviewer_exclude ["agy"]', () => {
  const res = selectEngine({
    pace: priorityPace([paceRow('agy', 39, 40), paceRow('glm', 10, 40)]),
    pools: loadPools(),
    roles: loadRoles(),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(res.engine, 'agy');
  assert.equal(res.runner, 'agy');
  assert.equal(res.model, 'gemini-4-hydrogen-high');
  assert.equal(res.selected_by, 'priority');
  assert.deepEqual(res.reviewer_exclude, ['agy']);
});

test('(priority b) agy behind (-5) -> glm (+2) chosen, still selected_by priority', () => {
  const res = selectEngine({
    pace: priorityPace([paceRow('agy', 45, 40), paceRow('glm', 38, 40)]),
    pools: loadPools(),
    roles: loadRoles(),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(res.engine, 'glm');
  assert.equal(res.model, 'glm-5.3');
  assert.equal(res.selected_by, 'priority');
  assert.deepEqual(res.reviewer_exclude, ['glm']);
});

test('(priority c) agy -5, glm -3, agyclaude +4 -> agyclaude (third priority entry)', () => {
  const res = selectEngine({
    pace: priorityPace([
      paceRow('agy', 45, 40),
      paceRow('glm', 43, 40),
      paceRow('agyclaude', 36, 40),
    ]),
    pools: loadPools(),
    roles: loadRoles(),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(res.engine, 'agyclaude');
  assert.equal(res.model, 'claude-opus-5-5-medium');
  assert.equal(res.selected_by, 'priority');
  assert.deepEqual(res.reviewer_exclude, ['agyclaude']);
});

test('(priority d) all three behind (agy -5, glm -3, agyclaude -2), codex +20 -> slack fallback', () => {
  const res = selectEngine({
    pace: priorityPace([
      paceRow('agy', 45, 40),
      paceRow('glm', 43, 40),
      paceRow('agyclaude', 42, 40),
      { pool: 'codex A', class: 'scarce', status: 'ok', stale: false, used_pct: 20, expected_pct: 40 },
    ]),
    pools: loadPools(),
    roles: loadRoles(),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(res.engine, 'codex');
  assert.equal(res.model, 'gpt-6.1-sol');
  assert.equal(res.selected_by, 'slack');
  assert.deepEqual(res.reviewer_exclude, ['codex']);
});

test('(priority e) reviewer role unchanged: largest slack, agy model stays gemini-4-carbon-high', () => {
  const res = selectEngine({
    pace: priorityPace([paceRow('agy', 10, 40), paceRow('glm', 39, 40)]),
    pools: loadPools(),
    roles: loadRoles(),
    role: 'reviewer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(res.engine, 'agy');
  assert.equal(res.model, 'gemini-4-carbon-high');
  assert.equal(res.selected_by, 'slack');
  assert.deepEqual(res.reviewer_exclude, ['agy']);
});

test('(priority f) agy reading stale -> skipped by the priority walk, glm chosen', () => {
  const res = selectEngine({
    pace: priorityPace([paceRow('agy', 4, 80, { stale: true }), paceRow('glm', 38, 40)]),
    pools: loadPools(),
    roles: loadRoles(),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(res.engine, 'glm');
  assert.equal(res.selected_by, 'priority');
});

// ---------------------------------------------------------------------------
// Seat fallback order & implementer family inference (PM 01M7AHAM)
// ---------------------------------------------------------------------------

test('(seat-fallback a) reviewer retreat skips google/hydrogen and picks glm, never codex', () => withEnv({ AUTOPILOT_PACE_FILE: MISSING_PACE }, () => {
  const roles = loadRoles();
  assert.deepEqual(
    roles.fallback.reviewer.map((r) => r.key),
    ['hydrogen', 'glm', 'agyclaude']
  );

  const chain = reviewerFallbackChain({ implementerFamily: 'google' });
  assert.deepEqual(chain.map((r) => r.key), ['glm', 'agyclaude']);
  const first = selectReviewerFallback({ implementerFamily: 'google' });
  assert.equal(first.key, 'glm');
  assert.equal(first.runner, 'cc-shim');
  assert.equal(first.endpoint, 'glm');
  assert.equal(first.model, 'glm-5.3');
  assert.equal(chain.some((r) => r.runner === 'codex' || isCodexRung(r)), false);
}));

test('(seat-fallback b) reviewer retreat for anthropic/agyclaude implementer picks hydrogen first', () => withEnv({ AUTOPILOT_PACE_FILE: MISSING_PACE }, () => {
  for (const imp of ['anthropic', 'agyclaude', 'claude-opus-5-5-medium']) {
    const first = selectReviewerFallback({ implementerFamily: imp });
    assert.equal(first.key, 'hydrogen');
    assert.equal(first.runner, 'agy');
    assert.equal(first.model, 'gemini-4-hydrogen-high');
    const chain = reviewerFallbackChain({ implementerFamily: imp });
    assert.deepEqual(chain.map((r) => r.key), ['hydrogen', 'glm']);
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
    assert.deepEqual(chain.map((r) => r.key), ['hydrogen', 'glm', 'agyclaude']);
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
  assert.deepEqual(chainAll.map((r) => r.key), ['agy', 'glm', 'agyclaude']);
  assert.equal(chainAll[0].model, 'gemini-4-hydrogen-high');
  assert.equal(chainAll[1].endpoint, 'glm');

  const afterAgy = selectImplementerFallback({
    failedRunner: 'agy',
    failedModel: 'gemini-4-hydrogen-high',
  });
  assert.equal(afterAgy.key, 'glm');
  assert.equal(afterAgy.runner, 'cc-shim');
  assert.equal(afterAgy.endpoint, 'glm');
  assert.equal(afterAgy.model, 'glm-5.3');

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

    // Case 2: agy seat unavailable with unset policy -> retreats to glm (cc-shim --endpoint glm).
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
    assert.equal(flagOf(callsAgy[1], '--runner'), 'cc-shim');
    assert.equal(flagOf(callsAgy[1], '--model'), 'glm-5.3');
    assert.equal(flagOf(callsAgy[1], '--endpoint'), 'glm');

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

test('(low 3a) low agyclaude loses to codex in slack fallback, but wins with demoted_last_resort when codex/grok absent', () => {
  const withCodex = priorityPace([
    paceRow('agy', 45, 40),
    {
      pool: 'agyclaude(alias 2)',
      id: 'agyclaude-2',
      class: 'other',
      status: 'WARN_agyclaude_low',
      stale: false,
      used_pct: 36,
      expected_pct: 40,
      left_pts: 4,
    },
    { pool: 'codex A', class: 'scarce', status: 'ok', stale: false, used_pct: 20, expected_pct: 40 },
  ]);

  const resWithCodex = selectEngine({
    pace: withCodex,
    pools: loadPools(),
    roles: loadRoles(),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(resWithCodex.engine, 'codex');
  assert.equal(resWithCodex.selected_by, 'slack');
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
      stale: false,
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
  assert.equal(resLastResort.demoted_last_resort, true);
  assert.deepEqual(resLastResort.low_keys, ['agyclaude']);

  // CLI path using a temp fixture pace file also respects low demotion and emits low_keys / demoted_last_resort.
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
    assert.equal(out1.selected_by, 'slack');
    assert.deepEqual(out1.low_keys, ['agyclaude']);
    assert.equal(out1.demoted_last_resort, undefined);

    const r2 = cli(['--role', 'implementer', '--pace', f2, '--json']);
    assert.equal(r2.status, 0, r2.stderr);
    const out2 = JSON.parse(r2.stdout);
    assert.equal(out2.engine, 'agyclaude');
    assert.equal(out2.demoted_last_resort, true);
    assert.deepEqual(out2.low_keys, ['agyclaude']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('(low 3b) low agy is skipped in priority walk when glm is fresh with slack >= 0', () => {
  const res = selectEngine({
    pace: priorityPace([
      paceRow('agy', 10, 40, { status: 'WARN_agy_low', left_pts: 2 }),
      paceRow('glm', 38, 40),
    ]),
    pools: loadPools(),
    roles: loadRoles(),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(res.engine, 'glm');
  assert.equal(res.selected_by, 'priority');
  assert.deepEqual(res.low_keys, ['agy']);
  assert.equal(res.demoted_last_resort, undefined);

  // When both priority keys are low and no non-low key qualifies, relative priority order holds (agy before agyclaude).
  const bothLow = selectEngine({
    pace: priorityPace([
      paceRow('agy', 38, 40, { status: 'WARN_agy_low', left_pts: 2 }),
      paceRow('agyclaude', 20, 40, { status: 'WARN_agyclaude_low', left_pts: 3 }),
    ]),
    pools: loadPools(),
    roles: loadRoles(),
    role: 'implementer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(bothLow.engine, 'agy');
  assert.equal(bothLow.selected_by, 'priority');
  assert.equal(bothLow.demoted_last_resort, true);
  assert.deepEqual(bothLow.low_keys, ['agy', 'agyclaude']);

  // Largest-slack role (reviewer): low agyclaude (+30) loses to non-low grok (+5).
  const reviewerRes = selectEngine({
    pace: priorityPace([
      paceRow('agyclaude', 10, 40, { status: 'WARN_agyclaude_low', left_pts: 2 }),
      paceRow('grok-cli', 35, 40),
    ]),
    pools: loadPools(),
    roles: loadRoles(),
    role: 'reviewer',
    checkEndpoint: allEndpointsReady,
  });
  assert.equal(reviewerRes.engine, 'grok');
  assert.equal(reviewerRes.selected_by, 'slack');
  assert.deepEqual(reviewerRes.low_keys, ['agyclaude']);
  assert.equal(reviewerRes.demoted_last_resort, undefined);
});

test('(seat-fallback f / 3c) pace demotion moves low rungs behind non-low rungs and records fallback.demoted only when order changed', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-fb-low-'));
  try {
    // 1. google implementer + GLM unavailable + agyclaude low -> still returns agyclaude (last resort, order unchanged -> demoted []).
    const agyclaudeLowPace = path.join(tmpDir, 'pace-agyclaude-low.json');
    fs.writeFileSync(agyclaudeLowPace, JSON.stringify(priorityPace([
      {
        pool: 'agyclaude(alias 2)',
        id: 'agyclaude-2',
        class: 'other',
        status: 'WARN_agyclaude_low',
        stale: false,
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
    assert.deepEqual(planGoogleLastResort.chain.map((r) => r.key), ['agyclaude']);
    assert.deepEqual(planGoogleLastResort.demoted, []);

    const recNoReorder = buildFallbackRecord({
      from: 'Qwen3.8-27B@anthropic-compatible#qwen_local',
      to: formatRung(planGoogleLastResort.chain[0]),
      reason: 'endpoint_busy',
      demoted: planGoogleLastResort.demoted,
    });
    assert.equal(recNoReorder.reason, 'endpoint_busy');
    assert.equal(Object.prototype.hasOwnProperty.call(recNoReorder, 'demoted'), false);

    // 2. hydrogen low + zhipu implementer -> agyclaude before hydrogen, demoted: ['hydrogen'].
    const hydrogenLowPace = path.join(tmpDir, 'pace-hydrogen-low.json');
    fs.writeFileSync(hydrogenLowPace, JSON.stringify(priorityPace([
      paceRow('hydrogen', 92, 40, { status: 'WARN_hydrogen_low', left_pts: 2 }),
      paceRow('agyclaude', 20, 40),
    ])));
    const planZhipu = reviewerFallbackPlan({
      implementerFamily: 'zhipu',
      pacePath: hydrogenLowPace,
    });
    assert.deepEqual(planZhipu.chain.map((r) => r.key), ['agyclaude', 'hydrogen']);
    assert.deepEqual(planZhipu.demoted, ['hydrogen']);

    // Shared agy quota (WARN_agy_low) also demotes hydrogen behind agyclaude.
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
    assert.deepEqual(planZhipuViaAgy.chain.map((r) => r.key), ['agyclaude', 'hydrogen']);
    assert.deepEqual(planZhipuViaAgy.demoted, ['hydrogen']);

    const recDemoted = buildFallbackRecord({
      from: 'Qwen3.8-27B@anthropic-compatible#qwen_local',
      to: formatRung(planZhipu.chain[0]),
      reason: 'endpoint_busy',
      demoted: planZhipu.demoted,
    });
    assert.equal(recDemoted.reason, 'endpoint_busy');
    assert.deepEqual(recDemoted.demoted, ['hydrogen']);

    // 3. Implementer walk with agy low moves agy behind glm and agyclaude.
    const implPlan = implementerFallbackPlan({ pacePath: agyLowPace });
    assert.deepEqual(implPlan.chain.map((r) => r.key), ['glm', 'agyclaude', 'agy']);
    assert.deepEqual(implPlan.demoted, ['agy']);

    // 4. CLI supports --pace and AUTOPILOT_PACE_FILE.
    const cliFlag = spawnSync(process.execPath, [
      SEAT_FALLBACK_CLI, 'reviewer', '--implementer-family', 'zhipu', '--pace', hydrogenLowPace, '--all',
    ], { encoding: 'utf8', env: { ...process.env } });
    assert.equal(cliFlag.status, 0, cliFlag.stderr);
    assert.deepEqual(JSON.parse(cliFlag.stdout).map((r) => r.key), ['agyclaude', 'hydrogen']);

    const cliEnv = spawnSync(process.execPath, [
      SEAT_FALLBACK_CLI, 'implementer', '--all',
    ], { encoding: 'utf8', env: { ...process.env, AUTOPILOT_PACE_FILE: agyLowPace } });
    assert.equal(cliEnv.status, 0, cliEnv.stderr);
    assert.deepEqual(JSON.parse(cliEnv.stdout).map((r) => r.key), ['glm', 'agyclaude', 'agy']);
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
      assert.deepEqual(revZhipu.chain.map((r) => r.key), ['hydrogen', 'agyclaude']);
      assert.deepEqual(revZhipu.demoted, []);

      const revGoogle = reviewerFallbackPlan({ implementerFamily: 'google', pacePath });
      assert.deepEqual(revGoogle.chain.map((r) => r.key), ['glm', 'agyclaude']);
      assert.deepEqual(revGoogle.demoted, []);

      const imp = implementerFallbackPlan({ pacePath });
      assert.deepEqual(imp.chain.map((r) => r.key), ['agy', 'glm', 'agyclaude']);
      assert.deepEqual(imp.demoted, []);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
