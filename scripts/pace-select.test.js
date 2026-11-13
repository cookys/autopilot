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

const CLI = path.join(__dirname, 'pace-select.js');
const SCORECARD_CLI = path.join(__dirname, 'engine-scorecard.js');
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'pace-select');
const allEndpointsReady = () => true;

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
