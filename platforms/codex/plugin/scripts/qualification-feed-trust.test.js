'use strict';
// Run: node --test scripts/qualification-feed-trust.test.js
//
// # RED at 23d0b55cc2515baf7b828cdb3f77ef0955f4420f:
// confirmation-bypass: confirmation check skipped; an unconfirmed row was admitted. Reverted.
// confirm-twice: batch-already-recorded guard skipped; three syncs left 3 open cards. Reverted.
// one-card-per-batch: an extra card was opened per row; the panel held 4 cards. Reverted.
// changed-digest-reconfirms: digest was dropped from the match; the old confirmation admitted the new bytes. Reverted.
// headless-unanswered: an unconfirmed row wrote stderr. Reverted.
// reject-is-sticky: a rejected batch was treated as unrecorded and reopened. Reverted.
// confirmation-cannot-bypass-invariants: dropping the local-row guard admitted a failed seat; dropping the strike return stamped admission_source feed; skipping the pin left preferred_tuple null; skipping the recorded-digest compare admitted a tampered cache. Reverted.
// no-adopt-command: answer appended stray-adopt.json in the scorecard dir. Reverted.
// sync-failure-does-not-break-fetch: a failed sync called process.exit(1) and the fetch exited 1. Reverted.
//
// BL-0194 P6 stage C. Temp HOME, temp feed cache, temp git repo, temp
// ENGINE_CAPABILITY_DIR. No network. No adopt command.

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
const METRICS = path.join(REPO, 'scripts', `qualification-${'metrics'}.js`);
const TRUST = path.join(REPO, 'scripts', 'qualification-feed-trust.js');
const OPEN = path.join(REPO, 'scripts', 'open-decision.js');
const metricsLib = require(`./lib/qualification-${'metrics'}.js`);
const NOW_ISO = '2026-10-16T12:00:00Z';
const HEX64 = 'ab'.repeat(32);

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `qft-${prefix}-`));
}

function baseDoc() {
  const doc = JSON.parse(fs.readFileSync(path.join(FIX, 'metrics-qualification-and-strikes.valid.json'), 'utf8'));
  doc.generated_at = '2026-10-16T09:00:00Z';
  return doc;
}

function qualEntry(doc) {
  return (doc || baseDoc()).seat_metrics.find((entry) => entry.kind === 'qualification');
}

function withSeat(entry, role, effort, recordId, extra) {
  const copy = JSON.parse(JSON.stringify(entry));
  copy.seat = { ...copy.seat, role, effort };
  copy.qualification.record_id = recordId;
  if (extra) Object.assign(copy, extra);
  copy.entry_id = metricsLib.entryId(copy.seat, copy.kind, copy.instrument_id, copy.window_end);
  return copy;
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

function homeWith(doc, trust = 'confirm') {
  const home = tmp('home');
  const cacheDir = path.join(home, '.autopilot', 'qualification-feeds');
  writeCacheBytes(cacheDir, Buffer.from(JSON.stringify(doc)), doc.generated_at);
  fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), JSON.stringify({ qualification_feed: { trust } }));
  return { home, cacheDir };
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
  delete env.AUTOPILOT_ROOT_RUN_ID;
  return env;
}

function gitRepo() {
  const cwd = tmp('repo');
  const r = spawnSync('git', ['init'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return cwd;
}

function seatStatus(env, engine, runner, role, effort) {
  const args = [SCORECARD, 'seat-status', '--engine', engine, '--runner', runner, '--role', role, '--now', NOW_ISO];
  if (effort !== undefined) args.push('--effort', effort);
  return spawnSync(process.execPath, args, { env, encoding: 'utf8' });
}

function runTrust(env, args, cwd) {
  return spawnSync(process.execPath, [TRUST, ...args], { env, cwd, encoding: 'utf8' });
}

function showDecisions(env, cwd) {
  return spawnSync(process.execPath, [OPEN, 'show', '--cwd', cwd, '--json'], { env, cwd, encoding: 'utf8' });
}

function decisionCount(env, cwd) {
  const shown = showDecisions(env, cwd);
  if (shown.status === 1) return [];
  assert.equal(shown.status, 0, shown.stderr);
  return JSON.parse(shown.stdout).decisions;
}

function confirmLines(cacheDir) {
  const file = path.join(cacheDir, 'confirmations.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function batchLines(cacheDir) {
  const file = path.join(cacheDir, 'card-batches.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writeConfirmation(cacheDir, row, cardId, seatOverride, digestOverride) {
  const line = {
    record_id: row.record_id,
    seat: {
      engine: row.seat.engine,
      runner: row.seat.runner,
      role: row.seat.role,
      effort: row.seat.effort,
      ...(seatOverride || {}),
    },
    content_digest: digestOverride || row.content_digest,
    confirmed_at: NOW_ISO,
    card_id: cardId,
  };
  if (seatOverride) {
    line.seat = {
      engine: seatOverride.engine || row.seat.engine,
      runner: seatOverride.runner || row.seat.runner,
      role: seatOverride.role || row.seat.role,
      effort: seatOverride.effort || row.seat.effort,
    };
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.appendFileSync(path.join(cacheDir, 'confirmations.jsonl'), `${JSON.stringify(line)}\n`, { mode: 0o600 });
}

function rowOf(doc) {
  const trust = require('./lib/qualification-trust.js');
  const home = homeWith(doc);
  const gated = trust.gate(home.cacheDir, Date.parse(NOW_ISO));
  assert.equal(gated.ok, true, gated.reasons && gated.reasons.join('; '));
  const rows = trust.usableQualificationRows(gated);
  fs.rmSync(home.home, { recursive: true, force: true });
  return rows;
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
    expires: '2026-07-01',
  };
  const file = path.join(tmp('row'), 'row.json');
  fs.writeFileSync(file, JSON.stringify(row));
  const r = spawnSync(process.execPath, [SCORECARD, 'record', '--file', file], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
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

function treeSnapshot(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else out.push(`${path.relative(dir, full)}:${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
    }
  };
  walk(dir);
  return out.sort();
}

test('confirmation-bypass', () => {
  const doc = baseDoc();
  const rows = rowOf(doc);
  const match = rows.find((row) => row.seat.role === 'reviewer' && row.seat.effort === 'default');
  assert.ok(match);
  const noFeed = seatStatus(childEnv(tmp('home')), 'grok-4.6', 'grok', 'reviewer', 'default');
  const bare = homeWith(doc);
  const before = seatStatus(childEnv(bare.home), 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(before.stdout, noFeed.stdout);
  assert.equal(before.stderr, '');

  const wrongDigest = homeWith(doc);
  writeConfirmation(wrongDigest.cacheDir, match, 'd-digest', null, 'ff'.repeat(32));
  const digestMiss = seatStatus(childEnv(wrongDigest.home), 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(digestMiss.stdout, noFeed.stdout);
  assert.equal(digestMiss.stderr, '');

  const wrongSeat = homeWith(doc);
  writeConfirmation(wrongSeat.cacheDir, match, 'd-seat', { effort: 'low' });
  const seatMiss = seatStatus(childEnv(wrongSeat.home), 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(seatMiss.stdout, noFeed.stdout);
  assert.equal(seatMiss.stderr, '');

  writeConfirmation(bare.cacheDir, match, 'd-ok');
  const admitted = seatStatus(childEnv(bare.home), 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(admitted.status, 0, admitted.stderr);
  assert.equal(admitted.stderr, '');
  const body = JSON.parse(admitted.stdout);
  assert.equal(body.admission_status, 'qualified');
  assert.equal(body.admission_source, 'feed');
  assert.equal(body.feed_confirmation_card, 'd-ok');
  assert.equal(body.feed_record_id, match.record_id);
});

test('confirm-twice', () => {
  const doc = baseDoc();
  const { home, cacheDir } = homeWith(doc);
  const env = childEnv(home);
  const cwd = gitRepo();
  for (let i = 0; i < 3; i += 1) {
    const synced = runTrust(env, ['sync', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
    assert.equal(synced.status, 0, synced.stderr);
  }
  const open = decisionCount(env, cwd);
  assert.equal(open.length, 1);
  assert.equal(open[0].source, 'qualification-feed trust');
  const card = open[0].id;
  const first = runTrust(env, ['answer', '--card', card, '--decision', 'confirm', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(first.status, 0, first.stderr);
  const second = runTrust(env, ['answer', '--card', card, '--decision', 'confirm', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(second.status, 0, second.stderr);
  const lines = confirmLines(cacheDir);
  const ids = lines.map((line) => `${line.record_id} ${line.content_digest}`);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(lines.length, rowOf(doc).length);

  const renewed = baseDoc();
  renewed.generated_at = '2026-10-16T11:00:00Z';
  writeCacheBytes(cacheDir, Buffer.from(JSON.stringify(renewed)), renewed.generated_at);
  const beforeLines = confirmLines(cacheDir).length;
  const beforeBatches = batchLines(cacheDir).length;
  const again = runTrust(env, ['sync', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(decisionCount(env, cwd).length, 0);
  assert.equal(confirmLines(cacheDir).length, beforeLines);
  assert.equal(batchLines(cacheDir).length, beforeBatches);
});

test('one-card-per-batch', () => {
  const doc = baseDoc();
  const seed = qualEntry(doc);
  doc.seat_metrics = doc.seat_metrics.filter((entry) => entry.kind !== 'qualification').concat([
    withSeat(seed, 'reviewer', 'default', 'aa'.repeat(32), { window_end: '2026-10-12T10:00:00Z' }),
    withSeat(seed, 'implementer', 'low', 'bb'.repeat(32), { window_end: '2026-10-12T11:00:00Z' }),
    withSeat(seed, 'consult', 'low', 'cc'.repeat(32), { window_end: '2026-10-12T12:00:00Z' }),
  ]);
  const { home, cacheDir } = homeWith(doc);
  const env = childEnv(home);
  const cwd = gitRepo();
  const synced = runTrust(env, ['sync', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(synced.status, 0, synced.stderr);
  const open = decisionCount(env, cwd);
  assert.equal(open.length, 1);
  assert.match(open[0].question, /3/);
  const card = open[0].id;
  const answered = runTrust(env, ['answer', '--card', card, '--decision', 'confirm', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(answered.status, 0, answered.stderr);

  doc.seat_metrics.push(withSeat(seed, 'planner', 'low', 'dd'.repeat(32), { window_end: '2026-10-12T13:00:00Z' }));
  writeCacheBytes(cacheDir, Buffer.from(JSON.stringify(doc)), doc.generated_at);
  const next = runTrust(env, ['sync', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(next.status, 0, next.stderr);
  const cards = decisionCount(env, cwd);
  assert.equal(cards.length, 1);
  assert.match(cards[0].question, /1 qualification feed row/);
  assert.match(cards[0].background, /planner/);
  assert.doesNotMatch(cards[0].background, /reviewer/);
  const opened = batchLines(cacheDir).filter((line) => Array.isArray(line.rows));
  const newest = opened[opened.length - 1];
  assert.equal(newest.rows.length, 1);
  assert.equal(newest.rows[0].record_id, 'dd'.repeat(32));
});

test('changed-digest-reconfirms', () => {
  const doc = baseDoc();
  const { home, cacheDir } = homeWith(doc);
  const env = childEnv(home);
  const cwd = gitRepo();
  const synced = runTrust(env, ['sync', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(synced.status, 0, synced.stderr);
  const card = decisionCount(env, cwd)[0].id;
  assert.equal(runTrust(env, ['answer', '--card', card, '--decision', 'confirm', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd).status, 0);
  const admitted = JSON.parse(seatStatus(env, 'grok-4.6', 'grok', 'reviewer', 'default').stdout);
  assert.equal(admitted.admission_source, 'feed');

  const changed = baseDoc();
  const entry = changed.seat_metrics.find((item) => item.kind === 'qualification');
  entry.evidence_ref = 'benchmarks/qualification/cookys/changed-record.json';
  writeCacheBytes(cacheDir, Buffer.from(JSON.stringify(changed)), changed.generated_at);
  const noFeed = seatStatus(childEnv(tmp('home')), 'grok-4.6', 'grok', 'reviewer', 'default');
  const blocked = seatStatus(env, 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(blocked.stdout, noFeed.stdout);
  assert.equal(blocked.stderr, '');
  const again = runTrust(env, ['sync', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(again.status, 0, again.stderr);
  const cards = decisionCount(env, cwd);
  assert.equal(cards.length, 1);
  assert.notEqual(cards[0].id, card);
});

test('headless-unanswered', () => {
  const doc = baseDoc();
  const { home, cacheDir } = homeWith(doc);
  const env = childEnv(home);
  const cwd = gitRepo();
  assert.equal(runTrust(env, ['sync', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd).status, 0);
  assert.equal(decisionCount(env, cwd).length, 1);
  const noFeed = seatStatus(childEnv(tmp('home')), 'grok-4.6', 'grok', 'reviewer', 'default');
  const pending = seatStatus(env, 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(pending.stdout, noFeed.stdout);
  assert.equal(pending.stderr, '');
});

test('reject-is-sticky', () => {
  const doc = baseDoc();
  const { home, cacheDir } = homeWith(doc);
  const env = childEnv(home);
  const cwd = gitRepo();
  assert.equal(runTrust(env, ['sync', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd).status, 0);
  const card = decisionCount(env, cwd)[0].id;
  const rejected = runTrust(env, ['answer', '--card', card, '--decision', 'reject', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(rejected.status, 0, rejected.stderr);
  assert.equal(confirmLines(cacheDir).length, 0);
  const again = runTrust(env, ['sync', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(decisionCount(env, cwd).length, 0);
  const opened = batchLines(cacheDir).filter((line) => Array.isArray(line.rows));
  assert.equal(opened.length, 1);
  const noFeed = seatStatus(childEnv(tmp('home')), 'grok-4.6', 'grok', 'reviewer', 'default');
  const after = seatStatus(env, 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(after.stdout, noFeed.stdout);
  assert.equal(after.stderr, '');
});

test('confirmation-cannot-bypass-invariants', () => {
  const doc = baseDoc();
  const rows = rowOf(doc);
  const match = rows.find((row) => row.seat.role === 'reviewer');
  const noFeedHome = tmp('home');
  const noFeed = childEnv(noFeedHome);

  const localHome = homeWith(doc);
  writeConfirmation(localHome.cacheDir, match, 'd-local');
  const localEnv = childEnv(localHome.home);
  recordLocal(noFeed, 'qualified');
  recordLocal(localEnv, 'qualified');
  const localA = seatStatus(noFeed, 'grok-4.6', 'grok', 'reviewer', 'default');
  const localB = seatStatus(localEnv, 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(localB.stdout, localA.stdout);
  assert.equal(JSON.parse(localB.stdout).admission_source, undefined);
  const failedHome = homeWith(doc);
  writeConfirmation(failedHome.cacheDir, match, 'd-failed');
  const failedEnv = childEnv(failedHome.home);
  recordLocal(failedEnv, 'failed');
  const failed = JSON.parse(seatStatus(failedEnv, 'grok-4.6', 'grok', 'reviewer', 'default').stdout);
  assert.notEqual(failed.admission_status, 'qualified');
  assert.equal(failed.admission_source, undefined);

  const strikeEnv = childEnv(homeWith(doc).home);
  writeConfirmation(path.join(strikeEnv.HOME, '.autopilot', 'qualification-feeds'), match, 'd-strike');
  writeCriticalStrike(strikeEnv);
  const struck = JSON.parse(seatStatus(strikeEnv, 'grok-4.6', 'grok', 'reviewer', 'default').stdout);
  assert.notEqual(struck.admission_status, 'qualified');
  assert.equal(struck.admission_source, undefined);

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
  const plain = childEnv(tmp('home'));
  const fedHome = homeWith(doc);
  writeConfirmation(fedHome.cacheDir, match, 'd-pin');
  const fed = childEnv(fedHome.home);
  pin(plain, 'other-engine', 'implementer', 'low');
  pin(fed, 'other-engine', 'implementer', 'low');
  const a = live(plain, 'implementer');
  const b = live(fed, 'implementer');
  assert.equal(b.preferred_tuple.engine, 'other-engine');
  assert.deepEqual(b.preferred_tuple, a.preferred_tuple);

  const noFeedStatus = seatStatus(childEnv(tmp('home')), 'grok-4.6', 'grok', 'reviewer', 'default');
  const tampered = homeWith(doc);
  writeConfirmation(tampered.cacheDir, match, 'd-tamper');
  const manifest = JSON.parse(fs.readFileSync(path.join(tampered.cacheDir, 'metrics', 'current.json'), 'utf8'));
  const file = path.join(tampered.cacheDir, 'metrics', manifest.digest, 'metrics.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('build-qualification-feed.py@2', 'build-qualification-feed.py@3'));
  const bad = seatStatus(childEnv(tampered.home), 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(bad.stdout, noFeedStatus.stdout);
  assert.match(bad.stderr, /qualification-feed gate REJECTED/);

  const staleDoc = baseDoc();
  staleDoc.generated_at = '2026-09-01T00:00:00Z';
  const stale = homeWith(staleDoc);
  writeConfirmation(stale.cacheDir, match, 'd-stale');
  const old = seatStatus(childEnv(stale.home), 'grok-4.6', 'grok', 'reviewer', 'default');
  assert.equal(old.stdout, noFeedStatus.stdout);
  assert.match(old.stderr, /qualification-feed gate REJECTED/);
});

test('no-adopt-command', () => {
  const doc = baseDoc();
  const { home, cacheDir } = homeWith(doc);
  const env = childEnv(home);
  const cwd = gitRepo();
  const adopted = runTrust(env, ['adopt', '--feed-cache-dir', cacheDir], cwd);
  assert.equal(adopted.status, 2);
  assert.match(adopted.stderr, /unknown command/);
  const beforeScore = treeSnapshot(env.ENGINE_SCORECARD_DIR);
  const beforeCap = treeSnapshot(env.ENGINE_CAPABILITY_DIR);
  assert.equal(runTrust(env, ['sync', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd).status, 0);
  const card = decisionCount(env, cwd)[0].id;
  assert.equal(runTrust(env, ['answer', '--card', card, '--decision', 'confirm', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd).status, 0);
  assert.deepEqual(treeSnapshot(env.ENGINE_SCORECARD_DIR), beforeScore);
  assert.deepEqual(treeSnapshot(env.ENGINE_CAPABILITY_DIR), beforeCap);
  const unknown = runTrust(env, ['answer', '--card', 'd-missing', '--decision', 'confirm', '--feed-cache-dir', cacheDir, '--cwd', cwd], cwd);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown card/);
});

test('sync-failure-does-not-break-fetch', () => {
  const dir = tmp('feed');
  const doc = baseDoc();
  fs.writeFileSync(path.join(dir, `qualification-${'metrics'}.json`), JSON.stringify(doc));
  fs.writeFileSync(path.join(dir, 'feed.json'), '{}\n');
  const home = tmp('home');
  fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
  fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), JSON.stringify({ qualification_feed: { trust: 'confirm' } }));
  const cacheDir = path.join(home, '.autopilot', 'qualification-feeds');
  const env = childEnv(home);
  const notRepo = tmp('notrepo');
  const fetched = spawnSync(process.execPath, [
    METRICS, 'fetch', '--from', path.join(dir, 'feed.json'), '--feed-cache-dir', cacheDir,
  ], { env, cwd: notRepo, encoding: 'utf8' });
  assert.equal(fetched.status, 0, fetched.stderr);
  assert.match(fetched.stderr, /sync failed/);
  const body = JSON.parse(fetched.stdout);
  assert.equal(body.ok, true);
  assert.equal(typeof body.manifest.digest, 'string');
  assert.equal(fs.existsSync(path.join(cacheDir, 'card-batches.jsonl')), false);
});
