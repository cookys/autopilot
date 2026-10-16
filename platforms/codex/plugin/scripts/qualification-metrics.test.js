'use strict';
// Run: node --test scripts/qualification-metrics.test.js
//
// BL-0194 P2. Positive cases, parity with the llm-playground fixtures, and NEGATIVE CONTROLS:
// each rule is asserted by a function that is run twice, once on the real module (must pass) and
// once on a deliberately broken copy (must throw). A control that does not go red is a failure.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const LIB_PATH = path.join(__dirname, 'lib', 'qualification-metrics.js');
const FIX = path.join(REPO, 'hooks', 'tests', 'fixtures', 'qualification-registry');
const lib = require(LIB_PATH);
const fx = (name) => fs.readFileSync(path.join(FIX, name));
const fxJson = (name) => JSON.parse(fx(name).toString('utf8'));
const DAY = 86400;
const NOW = '2026-10-16T12:00:00Z';
const isoAgo = (days) => new Date(Date.parse(NOW) - days * DAY * 1000).toISOString().replace('.000Z', 'Z');

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), `qm-${prefix}-`)); }

// A feed directory holding only the sibling metrics document (the feed itself is not needed to
// fetch metrics: the sibling path is derived from it).
function feedDirWithMetrics(generatedAt) {
  const dir = tmp('feed');
  const doc = fxJson('metrics-qualification-and-strikes.valid.json');
  doc.generated_at = generatedAt;
  fs.writeFileSync(path.join(dir, 'qualification-metrics.json'), JSON.stringify(doc));
  return { dir, feed: path.join(dir, 'feed.json') };
}

// ── mutation harness ──
function mutatedLib(replacements) {
  let source = fs.readFileSync(LIB_PATH, 'utf8');
  for (const [from, to] of replacements) {
    assert.ok(source.includes(from), `mutation anchor missing: ${from}`);
    source = source.replace(from, to);
  }
  const file = path.join(__dirname, 'lib', `qualification-metrics.mut-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(file, source);
  try {
    return { mod: require(file), cleanup: () => { delete require.cache[file]; fs.unlinkSync(file); } };
  } catch (error) {
    fs.unlinkSync(file);
    throw error;
  }
}

function expectRed(name, replacements, assertion) {
  test(`negative control (red): ${name}`, async () => {
    const { mod, cleanup } = mutatedLib(replacements);
    try {
      await assert.rejects(async () => assertion(mod), (e) => { if (process.env.QM_SHOW) console.log(`RED[${name}] ${String(e.message).split("\n")[0]}`); return true; }, `${name}: assertion stayed green on the broken module`);
    } finally {
      cleanup();
    }
  });
}

// ── assertions shared by the green run and the red runs ──
const LOCAL_STRIKES = [
  { strike_id: 's-a', seat: 'x', reason: 'r1' },
  { strike_id: 's-b', seat: 'x', reason: 'r2' },
];
const A = {
  feedLiftLeavesLocalStrikes(m) {
    const before = JSON.stringify(LOCAL_STRIKES);
    const events = [{ strike_id: 's-a', lifted_by: 's-z' }, { strike_id: 's-b', lifted_by: null }];
    const r = m.reconcileStrikeDisclosure(LOCAL_STRIKES, events);
    assert.equal(JSON.stringify(r.local), before);
    assert.equal(JSON.stringify(LOCAL_STRIKES), before);
    assert.deepEqual(r.feed_lifts_local, ['s-a']);
  },
  feedOmissionLeavesLocalStrikes(m) {
    const before = JSON.stringify(LOCAL_STRIKES);
    const r = m.reconcileStrikeDisclosure(LOCAL_STRIKES, []);
    assert.equal(JSON.stringify(r.local), before);
    assert.deepEqual(r.local_only, ['s-a', 's-b']);
  },
  feedQualifiedWithoutLocalRowAdmitsNothing(m) {
    const doc = fxJson('metrics-qualification-and-strikes.valid.json');
    const view = m.admissionView([], doc);
    assert.deepEqual(view.local_admitted, []);
    assert.equal(view.feed_only_claims.length, 1);
    const local = [{ engine: 'other', runner: 'r', role: 'reviewer', effort: 'default' }];
    assert.deepEqual(m.admissionView(local, doc).local_admitted, local);
  },
  staleWarns(m, cacheDir) {
    const s = m.readStatus({ cacheDir, now: NOW });
    assert.equal(s.present, true, 'stale cache is still served');
    assert.ok(s.doc);
    assert.ok(s.producer_age_s > 7 * DAY);
    assert.ok(s.warnings.length >= 1, 'status carries a warning past max_age_s');
  },
  dedupeOncePerBoardCell(m) {
    const base = (id, effort) => ({
      entry_id: id, kind: 'benchmark_observation', instrument_id: 'swe', window_end: '2026-10-11T08:00:00Z',
      seat: { engine: 'e', model: 'e', model_version: 'e', runner: 'r', role: 'implementer', effort },
      join: { board_cell: 'cell/1', board_join: 'mapped' },
    });
    const doc = { seat_metrics: [base('a1', 'low'), base('a2', 'high'), base('a3', null)], strike_events: [] };
    assert.equal(m.dedupeBenchmarkRows(doc).length, 1);
  },
  unknownIsNotZero(m) {
    const row = (engine, cost) => ({
      entry_id: engine, kind: 'benchmark_observation', instrument_id: 'i', window_end: '2026-10-11T08:00:00Z',
      seat: { engine, model: engine, model_version: engine, runner: 'r', role: 'implementer', effort: 'low' },
      join: { board_cell: `c/${engine}`, board_join: 'mapped' },
      speed: { solved_per_hour_milli: 5000 }, benchmark: { pass_rate_permille: 900 }, cost: { usd_per_solved_micro: cost },
    });
    const doc = { seat_metrics: [row('unknown-cost', null), row('known-cost', 5000)], strike_events: [] };
    const seats = [{ engine: 'unknown-cost' }, { engine: 'known-cost' }];
    assert.deepEqual(m.orderAdmittedSeats(seats, doc).map((s) => s.engine), ['known-cost', 'unknown-cost']);
  },
  latestPerTaskNullsAreUnknown(m) {
    const row = (engine, population, nAttempts, pass) => ({
      entry_id: engine, kind: 'benchmark_observation', instrument_id: 'i', window_end: '2026-10-11T08:00:00Z',
      seat: { engine, model: engine, model_version: engine, runner: 'r', role: 'implementer', effort: 'low' },
      join: { board_cell: `c/${engine}`, board_join: 'mapped' },
      speed: { solved_per_hour_milli: null }, benchmark: { population, n_attempts: nAttempts, n_timeout: nAttempts, pass_rate_permille: pass }, cost: { usd_per_solved_micro: null },
    });
    const doc = { seat_metrics: [row('lpt', 'latest_per_task', null, null), row('zero', 'all_attempts', 100, 0)], strike_events: [] };
    const out = m.orderAdmittedSeats([{ engine: 'lpt' }, { engine: 'zero' }], doc).map((s) => s.engine);
    assert.deepEqual(out, ['zero', 'lpt']);
  },
  orderingIsAPermutation(m) {
    const doc = {
      seat_metrics: [{
        entry_id: 'x', kind: 'benchmark_observation', instrument_id: 'i', window_end: '2026-10-11T08:00:00Z',
        seat: { engine: 'fast', model: 'fast', model_version: 'fast', runner: 'r', role: 'implementer', effort: 'low' },
        join: { board_cell: 'c/fast', board_join: 'mapped' },
        speed: { solved_per_hour_milli: 9000 }, benchmark: { pass_rate_permille: 800 }, cost: { usd_per_solved_micro: 1 },
      }],
      strike_events: [],
    };
    const seats = [{ engine: 'slow-no-metrics' }, { engine: 'fast' }, { engine: 'other' }];
    const out = m.orderAdmittedSeats(seats, doc);
    assert.equal(out.length, seats.length, 'no admitted seat is dropped');
    assert.deepEqual(out.map((s) => s.engine), ['fast', 'slow-no-metrics', 'other']);
    assert.deepEqual(m.orderAdmittedSeats(seats, null), seats, 'no metrics => today\'s order');
  },
};

function staleCache() {
  const { feed } = feedDirWithMetrics(isoAgo(8));
  const cacheDir = tmp('cache');
  return lib.fetchMetrics(feed, { cacheDir, now: NOW }).then((r) => {
    assert.equal(r.ok, true, r.error);
    return cacheDir;
  });
}

// ── parity with the llm-playground fixture set ──
test('fixture manifest: every case validates or is rejected with the stated first code', () => {
  const manifest = fxJson('manifest.json');
  for (const c of manifest.cases) {
    const raw = fx(c.file);
    const r = c.doc === 'record' ? lib.validateRecord(raw) : lib.validateMetrics(raw, c.max_bytes ? { maxBytes: c.max_bytes } : {});
    if (c.expect === 'valid') assert.deepEqual(r.errors, [], c.file);
    else assert.equal(r.errors[0] && r.errors[0][0], c.reject_code, c.file);
  }
});

test('record_id / entry_id / strike_id match the cross-language parity fixture', () => {
  const p = fxJson('record-id-parity.json');
  for (const c of p.record_id_cases) {
    const i = c.inputs;
    assert.equal(lib.canonicalJson([i.producer, i.transcript_hash, {
      effort: i.seat.effort, engine: i.seat.engine, model: i.seat.model, model_version: i.seat.model_version, role: i.seat.role, runner: i.seat.runner,
    }, i.corpus_version, i.administered_at]), c.canonical_json, c.name);
    assert.equal(lib.recordIdV1(i.producer, i.transcript_hash, i.seat, i.corpus_version, i.administered_at), c.record_id, c.name);
  }
  for (const c of p.entry_id_cases) {
    const i = c.inputs;
    assert.equal(lib.entryId(i.seat, i.kind, i.instrument_id, i.window_end), c.entry_id, c.name);
  }
  for (const c of p.strike_id_cases) {
    const i = c.inputs;
    assert.equal(lib.strikeId(i.seat, i.effort, i.reason, i.administered_at, i.record_id), c.strike_id, c.name);
  }
});

test('vendored schemas are byte-identical to the llm-playground P1 copy when it is present', (t) => {
  const root = process.env.QUALIFICATION_LP_ROOT || '/home/cookys/projects/llm-playground-bl0194-p1';
  const names = ['qualification-feed-v2.schema.json', 'qualification-record.schema.json'];
  if (!names.every((n) => fs.existsSync(path.join(root, 'schemas', n)))) { t.skip('llm-playground checkout not present'); return; }
  for (const n of names) {
    assert.ok(fs.readFileSync(path.join(REPO, 'schemas', n)).equals(fs.readFileSync(path.join(root, 'schemas', n))), n);
  }
});

test('effort null is not default: the two seats hash differently', () => {
  const s = { engine: 'e', model: 'm', model_version: 'v', runner: 'r', role: 'reviewer' };
  assert.notEqual(lib.entryId({ ...s, effort: null }, 'qualification', 'i', '2026-10-11T08:00:00Z'),
    lib.entryId({ ...s, effort: 'default' }, 'qualification', 'i', '2026-10-11T08:00:00Z'));
  assert.equal(lib.orderAdmittedSeats([{ ...s, effort: 'default' }], null).length, 1);
});

// ── ages and cache ──
test('an 8-day-old cache warns and is still served', async () => {
  A.staleWarns(lib, await staleCache());
});

test('a fresh document has no warning; a refetch of an OLD document still reports the old producer age', async () => {
  const fresh = feedDirWithMetrics(isoAgo(1));
  const cFresh = tmp('cache');
  assert.equal((await lib.fetchMetrics(fresh.feed, { cacheDir: cFresh, now: NOW })).ok, true);
  assert.deepEqual(lib.readStatus({ cacheDir: cFresh, now: NOW }).warnings, []);

  const old = feedDirWithMetrics(isoAgo(8));
  const cOld = tmp('cache');
  await lib.fetchMetrics(old.feed, { cacheDir: cOld, now: isoAgo(2) });
  const first = lib.readStatus({ cacheDir: cOld, now: NOW });
  await lib.fetchMetrics(old.feed, { cacheDir: cOld, now: NOW });
  const second = lib.readStatus({ cacheDir: cOld, now: NOW });
  assert.equal(second.producer_age_s, first.producer_age_s, 'refetching the same old document does not make it young');
  assert.ok(second.producer_age_s > 7 * DAY);
  assert.ok(second.fetch_age_s < first.fetch_age_s, 'fetch age is the time since OUR fetch');
});

test('missing and future timestamps are labelled; past 90 days is expired-advisory but still served', () => {
  const a = lib.describeAges({ fetched_at: undefined, generated_at: '2099-01-01T00:00:00Z' }, NOW);
  assert.equal(a.fetch_age_label, 'unknown');
  assert.equal(a.producer_age_label, 'clock-skew');
  const b = lib.describeAges({ fetched_at: NOW, generated_at: isoAgo(100) }, NOW);
  assert.ok(b.labels.includes('producer_age:expired-advisory'));
  assert.ok(b.warnings.length >= 1);
});

test('an unreachable or invalid feed never throws, writes nothing, and keeps the old cache', async () => {
  const good = feedDirWithMetrics(isoAgo(1));
  const cacheDir = tmp('cache');
  await lib.fetchMetrics(good.feed, { cacheDir, now: NOW });
  const before = fs.readFileSync(path.join(cacheDir, 'metrics', 'current.json'), 'utf8');
  const missing = await lib.fetchMetrics(path.join(tmp('none'), 'feed.json'), { cacheDir, now: NOW });
  assert.equal(missing.ok, false);
  const http = await lib.fetchMetrics('https://example.invalid/feed.json', { cacheDir, now: NOW, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(http.ok, false);
  const bad = feedDirWithMetrics(isoAgo(1));
  fs.writeFileSync(path.join(path.dirname(bad.feed), 'qualification-metrics.json'), fx('permille-fractional.invalid.json'));
  assert.equal((await lib.fetchMetrics(bad.feed, { cacheDir, now: NOW })).ok, false);
  assert.equal(fs.readFileSync(path.join(cacheDir, 'metrics', 'current.json'), 'utf8'), before);
  assert.equal(lib.readStatus({ cacheDir, now: NOW }).present, true);
  assert.equal(lib.siblingMetricsSource('https://h.example/a/b/feed.json'), 'https://h.example/a/b/qualification-metrics.json');
});

// ── positive: authority ──
test('feed lift / omission leave local strikes untouched', () => { A.feedLiftLeavesLocalStrikes(lib); A.feedOmissionLeavesLocalStrikes(lib); });
test('feed qualified with no local row admits nothing', () => A.feedQualifiedWithoutLocalRowAdmitsNothing(lib));
test('a board cell seen under several seats counts once', () => A.dedupeOncePerBoardCell(lib));
test('unknown (null) sorts after known and is never 0', () => A.unknownIsNotZero(lib));
test('latest_per_task rows with null counts sort as unknown, after known', () => A.latestPerTaskNullsAreUnknown(lib));
test('ordering is a permutation: nothing admitted is dropped, nothing added', () => A.orderingIsAPermutation(lib));

test('admission is byte-identical with the metrics cache absent or hostile', async () => {
  const run = (home) => {
    const store = tmp('store');
    const env = { ...process.env, HOME: home, ENGINE_SCORECARD_DIR: store };
    const out = [];
    for (const args of [
      ['seat-status', '--engine', 'grok-4.6', '--runner', 'grok', '--role', 'reviewer', '--effort', 'default'],
      ['seat-status', '--engine', 'grok-4.6', '--runner', 'grok', '--role', 'implementer', '--effort', 'low'],
    ]) {
      const r = spawnSync('node', [path.join(REPO, 'scripts', 'engine-scorecard.js'), ...args], { env, encoding: 'utf8' });
      out.push(r.status, r.stdout, r.stderr);
    }
    out.push(JSON.stringify(fs.readdirSync(store)));
    return JSON.stringify(out);
  };
  const absentHome = tmp('home');
  const hostileHome = tmp('home');
  const { feed } = feedDirWithMetrics(isoAgo(100));
  const cacheDir = path.join(hostileHome, '.autopilot', 'qualification-feeds');
  assert.equal((await lib.fetchMetrics(feed, { cacheDir, now: NOW })).ok, true);
  assert.equal(run(hostileHome), run(absentHome));
});

test('admission code never requires the metrics module', () => {
  for (const f of ['scripts/engine-scorecard.js', 'scripts/resolve-review-loop.sh', 'scripts/adopt-qualification-defaults.js',
    'scripts/lib/qualification-feed.js', 'scripts/resolve-dispatch-topology.js', 'scripts/lib/qualification-applicability-scope.js']) {
    assert.ok(!/qualification-metrics/.test(fs.readFileSync(path.join(REPO, f), 'utf8')), f);
  }
});

test('CLI: fetch, status and order work end to end and order never drops a seat', async () => {
  const { feed } = feedDirWithMetrics(isoAgo(8));
  const cacheDir = tmp('cache');
  const cli = (...args) => spawnSync('node', [path.join(__dirname, 'qualification-metrics.js'), ...args, '--feed-cache-dir', cacheDir, '--now', NOW], { encoding: 'utf8' });
  assert.equal(JSON.parse(cli('fetch', '--from', feed).stdout).ok, true);
  const st = JSON.parse(cli('status').stdout);
  assert.equal(st.present, true);
  assert.ok(st.warnings.length >= 1);
  const seats = path.join(tmp('seats'), 'seats.json');
  const list = [{ engine: 'a' }, { engine: 'b' }];
  fs.writeFileSync(seats, JSON.stringify(list));
  assert.deepEqual(JSON.parse(cli('order', '--seats', seats).stdout), list);
});

// ── negative controls: the same assertions on deliberately broken copies must go RED ──
expectRed('feed lift removes a local strike', [[
  '    local: localStrikes,',
  '    local: localStrikes.filter((s) => !strikeEvents.some((e) => e.lifted_by !== null && e.strike_id === localStrikeId(s))),',
]], A.feedLiftLeavesLocalStrikes);

expectRed('feed omission removes a local strike', [[
  '    local: localStrikes,',
  '    local: localStrikes.filter((s) => feedIds.has(localStrikeId(s))),',
]], A.feedOmissionLeavesLocalStrikes);

expectRed('feed qualified claim admits a seat with no local row', [[
  '  const local = localAdmittedSeats.slice();',
  "  const local = localAdmittedSeats.concat(doc ? doc.seat_metrics.filter((e) => e.kind === 'qualification' && e.qualification.status === 'qualified').map((e) => e.seat) : []);",
]], A.feedQualifiedWithoutLocalRowAdmitsNothing);

expectRed('warn branch removed: status assertion', [[
  'if (a.age_s !== null && a.age_s > maxAgeS) {',
  'if (false) {',
]], async (m) => A.staleWarns(m, await staleCache()));

expectRed('no dedupe per board cell', [[
  'if (!byCell.has(key)) byCell.set(key, e);',
  'byCell.set(key + e.entry_id, e);',
]], A.dedupeOncePerBoardCell);

expectRed('unknown cost treated as 0', [[
  'cost: e ? e.cost.usd_per_solved_micro : null,',
  'cost: e ? (e.cost.usd_per_solved_micro || 0) : null,',
]], A.unknownIsNotZero);

expectRed('ordering drops seats without metrics', [[
  'return keyed.map((k) => k.seat);',
  'return keyed.filter((k) => k.speed !== null).map((k) => k.seat);',
]], A.orderingIsAPermutation);

expectRed('null pass rate treated as 0 (latest_per_task)', [[
  'pass: e ? e.benchmark.pass_rate_permille : null,',
  'pass: e ? (e.benchmark.pass_rate_permille || 0) : null,',
]], A.latestPerTaskNullsAreUnknown);
