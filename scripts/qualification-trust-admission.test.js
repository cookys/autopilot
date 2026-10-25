'use strict';
// Run: node --test scripts/qualification-trust-admission.test.js
//
// # RED at c163b5174c227c34ffb121be509c4a7307fffd97:
// auto-needs-adopt: overlay absent; seat-status stayed no_record with no admission_source. Reverted.
// off-influences-result: overlay ran for trust off; seat-status stdout gained admission_source feed. Reverted.
// feed-overwrites-local-evidence: local-row guard removed; a local qualified seat took the feed record id. Reverted.
// feed-lifts-local-strike: strike fold on the feed path removed; a local critical strike still projected qualified. Reverted.
// pin-wins-over-feed: the pin branch in resolveLiveTuple was skipped; preferred_tuple.engine was null instead of the pin. Reverted.
// gate-failure-is-no-feed: recorded-digest comparison skipped; a tampered cache admitted the seat. Reverted.
// confirm-admits-nothing-yet: confirm admitted with no confirmation line; stdout differed from no-feed. Reverted.
// default-is-auto: a missing config was treated as off; the seat stayed no_record. Reverted.
//
// # RED at 6bb17926c83a4bc0158f88447c9cfae3b42fc158:
// strict-path-ignores-feed: green on the base. Routing --require-evidence through computeSeatProjection admitted the feed (admission_source feed). Restored computeSeatProjectionStrict.
// brain-seat-ignores-feed: green on the base. Disabling the seatKind !== default guard stamped admission_source feed on the brain seat. Guard restored.
// revoked-local-row-not-rescued: green on the base. Forcing hasLocalSeatRow to return false let the feed qualify a revoked row. Guard restored.
// superseded-local-row-not-rescued: green on the base. The same hasLocalSeatRow mutation let the feed qualify a superseded row. Guard restored.
//
// BL-0194 P6 stage B. Temp HOME, temp config, temp cache, temp scorecard store.
// No network. Confirm with no confirmation line matches the no-feed projection.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const FIX = path.join(REPO, 'hooks', 'tests', 'fixtures', 'qualification-registry');
const SCORECARD = path.join(REPO, 'scripts', 'engine-scorecard.js');
const CAPABILITY = path.join(REPO, 'scripts', 'engine-capability-state.js');
const TOPOLOGY = path.join(REPO, 'scripts', 'resolve-dispatch-topology.js');
const NOW_ISO = '2026-10-16T12:00:00Z';
const HEX64 = 'ab'.repeat(32);

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `qta-${prefix}-`));
}

function baseDoc() {
  const doc = JSON.parse(fs.readFileSync(path.join(FIX, 'metrics-qualification-and-strikes.valid.json'), 'utf8'));
  doc.generated_at = '2026-10-16T09:00:00Z';
  return doc;
}

function writeCacheBytes(cacheDir, bytes, generatedAt) {
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const root = path.join(cacheDir, 'metrics', digest);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'metrics.json'), bytes);
  const manifest = {
    schema_version: 1,
    digest,
    origin: 'file://test',
    fetched_at: NOW_ISO,
    generated_at: generatedAt,
    n_seat_metrics: 0,
    n_strike_events: 0,
  };
  fs.mkdirSync(path.join(cacheDir, 'metrics'), { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'metrics', 'current.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return digest;
}

function homeWithCache(doc, trust) {
  const home = tmp('home');
  const cacheDir = path.join(home, '.autopilot', 'qualification-feeds');
  writeCacheBytes(cacheDir, Buffer.from(JSON.stringify(doc)), doc.generated_at);
  if (trust !== undefined) {
    fs.writeFileSync(
      path.join(home, '.autopilot', 'config.json'),
      JSON.stringify({ qualification_feed: { trust } }),
    );
  }
  return home;
}

function childEnv(home, extra = {}) {
  const env = {
    ...process.env,
    HOME: home,
    ENGINE_SCORECARD_DIR: extra.scorecard || tmp('score'),
    ENGINE_CAPABILITY_DIR: extra.capability || tmp('cap'),
    AUTOPILOT_STRIKE_WRITER: 'off',
  };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.AUTOPILOT_CONFIG_FILE;
  delete env.AUTOPILOT_TOPOLOGY_FILE;
  return env;
}

function seatStatus(env, engine, runner, role, effort) {
  const args = [SCORECARD, 'seat-status', '--engine', engine, '--runner', runner, '--role', role, '--now', NOW_ISO];
  if (effort !== undefined) args.push('--effort', effort);
  return spawnSync(process.execPath, args, { env, encoding: 'utf8' });
}

function recordLocal(env, status, effort = 'default') {
  const row = {
    engine: 'grok-4.6',
    runner: 'grok',
    family: 'f',
    role: 'reviewer',
    effort,
    model_version: 'v1',
    version_source: 'manual',
    corpus_version: 'c@1',
    harness_version: 'h@1',
    runner_version: 'rv1',
    prompt_config_hash: 'sha256:x',
    date: '2026-06-30',
    quality: { corpus_pass: '10/10', false_pass_critical: 0, specificity: '3/3' },
    capability_score: 0.9,
    cost: { source: 'manual', usd_per_mtok_input: 0, usd_per_mtok_output: 0, sample_tokens: 0 },
    latency: { sample_wall_time_s: 0 },
    status,
    qualified_at: '2026-06-01',
  };
  const file = path.join(tmp('row'), 'row.json');
  fs.writeFileSync(file, JSON.stringify(row));
  const r = spawnSync(process.execPath, [SCORECARD, 'record', '--file', file], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

function writeCriticalStrike(env) {
  const r = spawnSync(process.execPath, [
    CAPABILITY, 'strike-seat',
    '--engine', 'grok-4.6', '--runner', 'grok', '--role', 'reviewer', '--effort', 'default',
    '--class', 'critical_reexam_trigger', '--predicate-id', 'security_canary_disclosure',
    '--cause-class', 'engine_output', '--writer', 'fuse',
    '--dedup-key', 'feed-lift-1', '--detector-id', 'det-1', '--detector-version', 'v1',
    '--artifact-sha256', HEX64, '--receipt-ref', 'rcpt-feed-lift',
    '--now', '2026-10-01T00:00:00Z',
    '--store', env.ENGINE_CAPABILITY_DIR,
  ], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
}

function qualEntry() {
  return baseDoc().seat_metrics.find((e) => e.kind === 'qualification');
}

test('auto-needs-adopt', () => {
  const doc = baseDoc();
  const home = homeWithCache(doc, 'auto');
  const env = childEnv(home);
  const r = seatStatus(env, 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.admission_status, 'qualified');
  assert.equal(out.admission_source, 'feed');
  assert.equal(out.baseline_event_id, null);
  assert.equal(out.baseline_qualified_at, null);
  assert.equal(out.feed_record_id, qualEntry().qualification.record_id);
  assert.equal(out.feed_content_digest, '1c531f4133c8d1bbe6004d228a74bff4cd8a7ba31e1f396ccc505e22274724ef');
});

test('off-influences-result', () => {
  const doc = baseDoc();
  const seats = [
    ['grok-4.6', 'grok', 'reviewer', 'default'],
    ['grok-4.6', 'grok', 'implementer', 'low'],
  ];
  const bare = childEnv(tmp('home'));
  const off = childEnv(homeWithCache(doc, 'off'));
  for (const [engine, runner, role, effort] of seats) {
    const a = seatStatus(bare, engine, runner, role, effort);
    const b = seatStatus(off, engine, runner, role, effort);
    assert.equal(b.status, a.status);
    assert.equal(b.stdout, a.stdout);
    assert.equal(b.stderr, a.stderr);
  }
  const hashOf = (env) => {
    const outPath = path.join(tmp('topo'), 'topology.json');
    const r = spawnSync(process.execPath, [
      TOPOLOGY, '--json', '--out', outPath, '--role', 'reviewer,implementer',
    ], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    const admitted = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      for (const row of value) {
        if (row && row.engine && row.runner) admitted.push([key, row.engine, row.runner, row.effort]);
      }
    }
    admitted.sort();
    // generated_at is the wall clock. The ordering hash is the rest of the JSON.
    const stable = JSON.stringify({ ...parsed, generated_at: 'CLOCK' });
    return {
      hash: crypto.createHash('sha256').update(stable).digest('hex'),
      admitted: JSON.stringify(admitted),
    };
  };
  const ha = hashOf(bare);
  const hb = hashOf(off);
  assert.equal(hb.hash, ha.hash);
  assert.equal(hb.admitted, ha.admitted);
});

test('feed-overwrites-local-evidence', () => {
  const doc = baseDoc();
  const noFeed = childEnv(tmp('home'));
  const fed = childEnv(homeWithCache(doc, 'auto'));
  for (const env of [noFeed, fed]) recordLocal(env, 'qualified');
  const a = seatStatus(noFeed, 'grok-4.6', 'grok', 'reviewer', 'default');
  const b = seatStatus(fed, 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(b.stdout, a.stdout);
  const body = JSON.parse(b.stdout);
  assert.ok(body.baseline_event_id !== null);
  assert.equal(body.admission_source, undefined);
  assert.notEqual(body.feed_record_id, qualEntry().qualification.record_id);

  for (const status of ['failed', 'expired']) {
    const home = homeWithCache(doc, 'auto');
    const env = childEnv(home);
    recordLocal(env, status);
    const r = seatStatus(env, 'grok-4.6', 'grok', 'reviewer', 'default');
    const out = JSON.parse(r.stdout);
    assert.notEqual(out.admission_status, 'qualified', status);
    assert.equal(out.admission_source, undefined, status);
  }
});

test('feed-lifts-local-strike', () => {
  const doc = baseDoc();
  assert.ok(doc.strike_events.some((e) => e.lifted_by));
  const env = childEnv(homeWithCache(doc, 'auto'));
  recordLocal(env, 'qualified');
  writeCriticalStrike(env);
  const withLocal = JSON.parse(seatStatus(env, 'grok-4.6', 'grok', 'reviewer', 'default').stdout);
  assert.notEqual(withLocal.admission_status, 'qualified');
  assert.equal(withLocal.admission_status, 'requalify_required');

  const bareStrike = childEnv(homeWithCache(doc, 'auto'));
  writeCriticalStrike(bareStrike);
  const noBaseline = JSON.parse(seatStatus(bareStrike, 'grok-4.6', 'grok', 'reviewer', 'default').stdout);
  assert.notEqual(noBaseline.admission_status, 'qualified');
  assert.equal(noBaseline.admission_source, undefined);
});

test('pin-wins-over-feed', () => {
  // Pins are not an input of computeSeatProjection. resolveLiveTuple reads the
  // pin (readPinForRole) before it calls computeSeatProjection.
  const doc = baseDoc();
  const pin = (env, engine, role, effort) => {
    const r = spawnSync(process.execPath, [
      CAPABILITY, 'pin-seat',
      '--engine', engine, '--runner', 'grok', '--role', role, '--effort', effort,
      '--endpoint', '@none', '--reason', 'operator pin', '--operator', 'test',
      '--store', env.ENGINE_CAPABILITY_DIR,
    ], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  };
  const live = (env, role) => {
    const r = spawnSync(process.execPath, [
      TOPOLOGY, '--resolve-live', '--role', role, '--store', env.ENGINE_CAPABILITY_DIR,
    ], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const cases = [
    ['other-engine', 'implementer', 'low'],
    ['grok-4.6', 'reviewer', 'default'],
  ];
  for (const [engine, role, effort] of cases) {
    const plain = childEnv(tmp('home'));
    const fed = childEnv(homeWithCache(doc, 'auto'));
    pin(plain, engine, role, effort);
    pin(fed, engine, role, effort);
    const a = live(plain, role);
    const b = live(fed, role);
    assert.equal(b.operator_pin.engine, engine);
    assert.equal(b.preferred_tuple.engine, engine);
    assert.equal(b.preferred_tuple.runner, a.preferred_tuple.runner);
    assert.equal(b.preferred_tuple.effort, a.preferred_tuple.effort);
    assert.deepEqual(b.operator_pin, a.operator_pin);
    assert.deepEqual(b.preferred_tuple, a.preferred_tuple);
    assert.deepEqual(b.effective_tuple, a.effective_tuple);
  }
});

test('gate-failure-is-no-feed', () => {
  const noFeedEnv = childEnv(tmp('home'));
  const noFeed = seatStatus(noFeedEnv, 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(noFeed.stderr, '');

  const cases = [];
  {
    const doc = baseDoc();
    const home = homeWithCache(doc, 'auto');
    const manifest = JSON.parse(fs.readFileSync(path.join(home, '.autopilot', 'qualification-feeds', 'metrics', 'current.json'), 'utf8'));
    const file = path.join(home, '.autopilot', 'qualification-feeds', 'metrics', manifest.digest, 'metrics.json');
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, text.replace('build-qualification-feed.py@2', 'build-qualification-feed.py@3'));
    cases.push(home);
  }
  {
    const doc = baseDoc();
    doc.generated_at = '2026-09-01T00:00:00Z';
    cases.push(homeWithCache(doc, 'auto'));
  }
  {
    const doc = baseDoc();
    doc.schema = 'model-dyno.not-the-metrics-schema.v9';
    cases.push(homeWithCache(doc, 'auto'));
  }
  for (const home of cases) {
    const r = seatStatus(childEnv(home), 'grok-4.6', 'grok', 'reviewer', 'default');
    assert.equal(r.stdout, noFeed.stdout);
    assert.match(r.stderr, /qualification-feed gate REJECTED/);
  }
});

test('confirm-admits-nothing-yet', () => {
  const noFeed = seatStatus(childEnv(tmp('home')), 'grok-4.6', 'grok', 'reviewer', 'default');
  const fed = seatStatus(childEnv(homeWithCache(baseDoc(), 'confirm')), 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(fed.status, noFeed.status);
  assert.equal(fed.stdout, noFeed.stdout);
  assert.equal(fed.stderr, noFeed.stderr);
});

test('default-is-auto', () => {
  const home = homeWithCache(baseDoc(), undefined);
  assert.equal(fs.existsSync(path.join(home, '.autopilot', 'config.json')), false);
  const r = seatStatus(childEnv(home), 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.admission_status, 'qualified');
  assert.equal(out.admission_source, 'feed');
});

test('strict-path-ignores-feed', () => {
  const score = tmp('score');
  const cap = tmp('cap');
  const scope = path.join(tmp('scope'), 'scope.json');
  fs.writeFileSync(scope, '{}\n');
  const bare = childEnv(tmp('home'), { scorecard: score, capability: cap });
  const fed = childEnv(homeWithCache(baseDoc(), 'auto'), { scorecard: score, capability: cap });
  const run = (env) => spawnSync(process.execPath, [
    SCORECARD, 'seat-status', '--engine', 'grok-4.6', '--runner', 'grok', '--role', 'reviewer',
    '--effort', 'default', '--now', NOW_ISO, '--require-evidence', '--scope-file', scope,
  ], { env, encoding: 'utf8' });
  const a = run(bare);
  const b = run(fed);
  assert.equal(b.status, a.status);
  assert.equal(b.stdout, a.stdout);
  assert.equal(b.stderr, a.stderr);
});

test('brain-seat-ignores-feed', () => {
  const score = tmp('score');
  const cap = tmp('cap');
  const bare = childEnv(tmp('home'), { scorecard: score, capability: cap });
  const fed = childEnv(homeWithCache(baseDoc(), 'auto'), { scorecard: score, capability: cap });
  const run = (env) => spawnSync(process.execPath, [
    SCORECARD, 'seat-status', '--engine', 'grok-4.6', '--runner', 'grok', '--role', 'reviewer',
    '--effort', 'default', '--seat-kind', 'brain', '--now', NOW_ISO,
  ], { env, encoding: 'utf8' });
  const a = run(bare);
  const b = run(fed);
  assert.equal(b.status, a.status);
  assert.equal(b.stdout, a.stdout);
  assert.equal(b.stderr, a.stderr);
  assert.equal(JSON.parse(b.stdout).admission_source, undefined);
});

test('revoked-local-row-not-rescued', () => {
  const doc = baseDoc();
  const noFeed = childEnv(tmp('home'));
  const fed = childEnv(homeWithCache(doc, 'auto'));
  for (const env of [noFeed, fed]) {
    fs.mkdirSync(env.ENGINE_SCORECARD_DIR, { recursive: true });
    fs.appendFileSync(path.join(env.ENGINE_SCORECARD_DIR, 'scorecard.jsonl'), `${JSON.stringify({
      event_id: 1,
      engine: 'grok-4.6',
      runner: 'grok',
      role: 'reviewer',
      effort: 'default',
      status: 'revoked',
      qualified_at: '2026-06-01',
      date: '2026-06-30',
    })}\n`);
  }
  const a = seatStatus(noFeed, 'grok-4.6', 'grok', 'reviewer', 'default');
  const b = seatStatus(fed, 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(b.status, a.status);
  assert.equal(b.stdout, a.stdout);
  const body = JSON.parse(b.stdout);
  assert.equal(body.admission_source, undefined);
  assert.notEqual(body.admission_status, 'qualified');
});

test('superseded-local-row-not-rescued', () => {
  const doc = baseDoc();
  const noFeed = childEnv(tmp('home'));
  const fed = childEnv(homeWithCache(doc, 'auto'));
  for (const env of [noFeed, fed]) {
    const written = recordLocal(env, 'qualified');
    const marker = spawnSync(process.execPath, [
      SCORECARD, 'record', '--supersede-provisional',
      '--supersedes-event-id', String(written.event_id), '--reason', 'replaced by a later exam',
    ], { env, encoding: 'utf8' });
    assert.equal(marker.status, 0, marker.stderr || marker.stdout);
  }
  const a = seatStatus(noFeed, 'grok-4.6', 'grok', 'reviewer', 'default');
  const b = seatStatus(fed, 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(b.stdout, a.stdout);
  const body = JSON.parse(b.stdout);
  assert.equal(body.admission_source, undefined);
  assert.notEqual(body.admission_status, 'qualified');
});
