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
// Mutant copies live in scripts/lib/ so their relative requires resolve. A crashed or interrupted
// earlier run can leave some behind: sweep them before starting and again on exit / SIGINT / SIGTERM.
const MUT_RE = /^qualification-metrics\.mut-.*\.js$/;
function sweepMutants() {
  const dir = path.join(__dirname, 'lib');
  for (const f of fs.readdirSync(dir)) {
    if (MUT_RE.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* already gone */ } }
  }
}
sweepMutants();
process.on('exit', sweepMutants);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { sweepMutants(); process.exit(130); });

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
  twoRolesOneCellBothGetData(m) {
    const seat = (role, engine = 'grok') => ({ engine, model: engine, model_version: engine, runner: 'r', role, effort: 'low' });
    const common = { instrument_id: 'i', window_end: '2026-10-11T08:00:00Z', join: { board_cell: 'grok/low', board_join: 'mapped' } };
    const bench = (id, role) => ({
      ...common, entry_id: id, kind: 'benchmark_observation', seat: seat(role),
      speed: { solved_per_hour_milli: 9000 }, benchmark: { pass_rate_permille: 800 }, cost: { usd_per_solved_micro: 10 },
    });
    const doc = {
      seat_metrics: [
        bench('a2', 'implementer'), bench('a1', 'reviewer'),
        { ...common, entry_id: 'q1', kind: 'qualification', seat: seat('consult') },
        { ...common, entry_id: 'z', kind: 'benchmark_observation', join: { board_cell: 'slow/cell', board_join: 'mapped' }, seat: seat('implementer', 'slow'),
          speed: { solved_per_hour_milli: 100 }, benchmark: { pass_rate_permille: 800 }, cost: { usd_per_solved_micro: 10 } },
      ],
      strike_events: [],
    };
    assert.equal(m.dedupeBenchmarkRows(doc).length, 2, 'aggregation counts the cell once');
    for (const role of ['implementer', 'reviewer', 'consult']) {
      const e = m.metricFor(seat(role), doc);
      assert.ok(e, `${role} gets the cell data`);
      assert.equal(e.speed.solved_per_hour_milli, 9000);
    }
    const seats = [seat('implementer', 'slow'), seat('implementer'), seat('reviewer'), seat('consult')];
    const out = m.orderAdmittedSeats(seats, doc);
    assert.equal(out.length, 4);
    assert.equal(out[3].engine, 'slow');
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
function fixtureSetDiff(dir, manifest) {
  const listed = new Set(manifest.cases.map((c) => c.file));
  const support = new Set(['manifest.json', 'json-domain', 'record-id-parity.json']);
  const onDisk = fs.readdirSync(dir).filter((f) => !support.has(f));
  return {
    orphans: onDisk.filter((f) => !listed.has(f)).sort(),
    missing: [...listed].filter((f) => !onDisk.includes(f)).sort(),
  };
}

test('negative control: fixtureSetDiff reports an orphan file and a missing file', () => {
  const dir = tmp('fxset');
  fs.writeFileSync(path.join(dir, 'a.valid.json'), '{}');
  fs.writeFileSync(path.join(dir, 'orphan.invalid.json'), '{}');
  const d = fixtureSetDiff(dir, { cases: [{ file: 'a.valid.json' }, { file: 'gone.valid.json' }] });
  assert.deepEqual(d, { orphans: ['orphan.invalid.json'], missing: ['gone.valid.json'] });
});

test('fixture manifest: every case validates or is rejected with the stated first code', () => {
  const manifest = fxJson('manifest.json');
  assert.deepEqual(fixtureSetDiff(FIX, manifest), { orphans: [], missing: [] }, 'manifest and fixtures on disk must be the same set');
  for (const c of manifest.cases) {
    const raw = fx(c.file);
    const r = c.doc === 'record' ? lib.validateRecord(raw) : lib.validateMetrics(raw, c.max_bytes ? { maxBytes: c.max_bytes } : {});
    if (c.expect === 'valid') assert.deepEqual(r.errors, [], c.file);
    else assert.equal(r.errors[0] && r.errors[0][0], c.reject_code, c.file);
  }
});

test('json-domain: Node accepts exactly the accept files and refuses exactly the reject files', () => {
  const { readJson, validateJsonSchema } = require('./validate-json-schema.js');
  const dir = path.join(FIX, 'json-domain');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const schema = JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8'));
  assert.equal(manifest.cases.length, 42);
  const names = new Set(manifest.cases.map((c) => c.file));
  const onDisk = fs.readdirSync(dir).filter((f) => !['manifest.json', 'schema.json'].includes(f));
  assert.deepEqual(onDisk.sort(), [...names].sort(), 'no orphan or missing json-domain fixture');
  for (const c of manifest.cases) {
    let accepted;
    try {
      accepted = validateJsonSchema(schema, readJson(path.join(dir, c.file), c.file)).valid;
    } catch {
      accepted = false;
    }
    assert.equal(accepted, c.expect === 'accept', `${c.file}: expected ${c.expect}`);
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

// ── strict UTF-8 on every path that reads a registry document (fetch and cache) ──
function metricsBytesWith(bad) {
  const doc = fxJson('metrics-qualification-and-strikes.valid.json');
  doc.producer = 'PLACEHOLDER';
  const [head, tail] = Buffer.from(JSON.stringify(doc)).toString('utf8').split('PLACEHOLDER');
  return Buffer.concat([Buffer.from(head), Buffer.from(bad), Buffer.from(tail)]);
}
const BAD_UTF8 = {
  'encoded surrogate ED A0 80': [0xed, 0xa0, 0x80],
  'truncated sequence': [0xe2, 0x82],
  'lone 0xFF': [0xff],
};
const A_ENC = {
  async fetchRefusesInvalidUtf8(m) {
    for (const [name, bad] of Object.entries(BAD_UTF8)) {
      const f = feedDirWithMetrics(isoAgo(1));
      fs.writeFileSync(path.join(path.dirname(f.feed), 'qualification-metrics.json'), metricsBytesWith(bad));
      const cacheDir = tmp('cache');
      const r = await m.fetchMetrics(f.feed, { cacheDir, now: NOW });
      assert.equal(r.ok, false, `${name}: fetch accepted invalid UTF-8`);
      assert.equal(fs.existsSync(path.join(cacheDir, 'metrics', 'current.json')), false, `${name}: cache written`);
      assert.equal(m.readStatus({ cacheDir, now: NOW }).present, false);
    }
  },
  async cacheReadRefusesInvalidUtf8(m) {
    const f = feedDirWithMetrics(isoAgo(1));
    const cacheDir = tmp('cache');
    assert.equal((await m.fetchMetrics(f.feed, { cacheDir, now: NOW })).ok, true);
    const cur = JSON.parse(fs.readFileSync(path.join(cacheDir, 'metrics', 'current.json'), 'utf8'));
    fs.writeFileSync(path.join(cacheDir, 'metrics', cur.digest, 'metrics.json'), metricsBytesWith(BAD_UTF8['encoded surrogate ED A0 80']));
    const st = m.readStatus({ cacheDir, now: NOW });
    assert.equal(st.present, false);
    assert.equal(st.doc, null);
    assert.ok(st.labels.includes('cache-invalid'));
  },
  validateRefusesInvalidUtf8(m) {
    for (const [name, bad] of Object.entries(BAD_UTF8)) {
      assert.ok(m.validateMetrics(metricsBytesWith(bad)).errors.length > 0, `${name}: accepted`);
    }
  },
  validateRefusesBom(m) {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fx('metrics-qualification-and-strikes.valid.json')]);
    assert.ok(m.validateMetrics(bytes).errors.length > 0, 'BOM accepted');
  },
};
test('fetch refuses invalid UTF-8 and writes no cache', () => A_ENC.fetchRefusesInvalidUtf8(lib));
test('a cached document with invalid UTF-8 is not adopted', () => A_ENC.cacheReadRefusesInvalidUtf8(lib));
test('a document with a leading BOM is refused', () => A_ENC.validateRefusesBom(lib));
test('validateMetrics refuses invalid UTF-8', () => A_ENC.validateRefusesInvalidUtf8(lib));
expectRed('lenient UTF-8 decode accepts invalid bytes in validateMetrics', [["{ fatal: true, ignoreBOM: true }", "{ fatal: false, ignoreBOM: true }"]], A_ENC.validateRefusesInvalidUtf8);
expectRed('lenient UTF-8 decode adopts an invalid cache entry', [["{ fatal: true, ignoreBOM: true }", "{ fatal: false, ignoreBOM: true }"]], A_ENC.cacheReadRefusesInvalidUtf8);
expectRed('BOM stripped by the decoder is accepted', [["{ fatal: true, ignoreBOM: true }", "{ fatal: true, ignoreBOM: false }"]], A_ENC.validateRefusesBom);

// The v1 feed reader shares the same decode + preflight. The documents below are otherwise a valid
// defaults artifact, so only the encoding rule can refuse them.
async function readAndParse(feedLib, file) {
  const r = await feedLib.readFeedSource(file);
  return feedLib.parseFeed(r.body, r.origin, r.bytes);
}
const FEED_HEAD = '{"artifact_type":"official-qualification-defaults","note":"';
const FEED_TAIL = '"}';
test('feed reader: a valid artifact parses (control for the rejections below)', async () => {
  const feedLib = require('./lib/qualification-feed.js');
  const f = path.join(tmp('feedsrc'), 'ok.json');
  fs.writeFileSync(f, FEED_HEAD + 'é\u{1F600}' + FEED_TAIL);
  assert.ok((await readAndParse(feedLib, f)).doc);
});
for (const [name, content] of [
  ['invalid UTF-8 ED A0 80', Buffer.concat([Buffer.from(FEED_HEAD), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from(FEED_TAIL)])],
  ['truncated sequence', Buffer.concat([Buffer.from(FEED_HEAD), Buffer.from([0xe2, 0x82]), Buffer.from(FEED_TAIL)])],
  ['leading BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(FEED_HEAD + FEED_TAIL)])],
  ['escaped lone surrogate', Buffer.from(FEED_HEAD + '\\ud800' + FEED_TAIL)],
]) {
  test(`feed reader refuses: ${name}`, async () => {
    const feedLib = require('./lib/qualification-feed.js');
    const f = path.join(tmp('feedsrc'), 'bad.json');
    fs.writeFileSync(f, content);
    await assert.rejects(() => readAndParse(feedLib, f));
  });
}

// ── positive: authority ──
test('feed lift / omission leave local strikes untouched', () => { A.feedLiftLeavesLocalStrikes(lib); A.feedOmissionLeavesLocalStrikes(lib); });
test('feed qualified with no local row admits nothing', () => A.feedQualifiedWithoutLocalRowAdmitsNothing(lib));
test('two roles on one board cell both get the cell data; aggregation counts it once', () => A.twoRolesOneCellBothGetData(lib));
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
  // P6 withdraws byte-identity under the default trust mode auto. This assertion
  // stays, with qualification_feed.trust off (config.json is $HOME/.autopilot/config.json).
  const trustOff = (home) => {
    const dir = path.join(home, '.autopilot');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ qualification_feed: { trust: 'off' } }));
  };
  const absentHome = tmp('home');
  const hostileHome = tmp('home');
  trustOff(absentHome);
  trustOff(hostileHome);
  const { feed } = feedDirWithMetrics(isoAgo(100));
  const cacheDir = path.join(hostileHome, '.autopilot', 'qualification-feeds');
  assert.equal((await lib.fetchMetrics(feed, { cacheDir, now: NOW })).ok, true);
  assert.equal(run(hostileHome), run(absentHome));
});

test('under auto a cached qualification admits the seat it qualifies', async () => {
  const home = tmp('home');
  const store = tmp('store');
  const { feed } = feedDirWithMetrics(isoAgo(1));
  const cacheDir = path.join(home, '.autopilot', 'qualification-feeds');
  assert.equal((await lib.fetchMetrics(feed, { cacheDir, now: NOW })).ok, true);
  const env = { ...process.env, HOME: home, ENGINE_SCORECARD_DIR: store };
  const r = spawnSync('node', [path.join(REPO, 'scripts', 'engine-scorecard.js'),
    'seat-status', '--engine', 'grok-4.6', '--runner', 'grok', '--role', 'reviewer', '--effort', 'default',
    '--now', NOW], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.admission_status, 'qualified');
  assert.equal(doc.admission_source, 'feed');
  assert.equal(doc.baseline_event_id, null);
});

// Whole-tree scan of scripts/ and hooks/. `own` is the allowlist of legitimate readers.
// A missing tree (the negative-control fixture has scripts/ and no hooks/) contributes no hits.
function metricsRequireHits(root, own) {
  const hits = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'node_modules' && ent.name !== 'fixtures') walk(full); continue; }
      if (!ent.isFile()) continue;
      const rel = path.relative(root, full);
      if (own.has(rel)) continue;
      if (/qualification-metrics/.test(fs.readFileSync(full, 'utf8'))) hits.push(rel);
    }
  };
  walk(path.join(root, 'scripts'));
  walk(path.join(root, 'hooks'));
  return hits;
}

// # RED at 7d6975c9f: whole-tree scan fail — actual ['scripts/lib/qualification-prices.js'] expected [] (1 fail, 44 pass, 1 skipped, exit 1)
test('no other script or hook requires the metrics module (whole-tree scan)', () => {
  const own = new Set(['scripts/qualification-metrics.js', 'scripts/lib/qualification-metrics.js', 'scripts/qualification-metrics.test.js',
    // P3 write side: uses only recordIdV1 / strikeId / validateRecord, never admission or ordering.
    'scripts/qualification-send-queue.js', 'scripts/qualification-send-queue.test.js', 'scripts/lib/qualification-record-v2.js',
    'scripts/lib/qualification-trust.js', 'scripts/qualification-trust.test.js',
    // emit-record validates the emitted record with validateRecord and recordIdV1 (write side only, never admission or ordering), same class as the existing send-queue entries.
    'scripts/engine-qualify.js', 'platforms/codex/plugin/scripts/engine-qualify.js',
    'hooks/tests/engine-qualify-headless.test.sh', 'hooks/tests/engine-qualify-writeboundary.test.sh',
    // prices uses only DEFAULT_MAX_AGE_S and describeAges for freshness warnings, never admission or ordering of metrics.
    'scripts/lib/qualification-prices.js']);
  assert.deepEqual(metricsRequireHits(REPO, own), []);
});

test('whole-tree scan reports an unregistered requirer and ignores an allowlisted path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-scan-'));
  const rel = 'scripts/unregistered-requirer.js';
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, rel), "require('./qualification-metrics.js');\n");
  assert.deepEqual(metricsRequireHits(root, new Set()), [rel]);
  assert.deepEqual(metricsRequireHits(root, new Set([rel])), []);
});

test('a malformed feed URL returns ok:false instead of throwing', async () => {
  const r = await lib.fetchMetrics('https://[bad', { cacheDir: tmp('cache'), now: NOW });
  assert.equal(r.ok, false);
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
  const ordered = cli('order', '--seats', seats);
  assert.deepEqual(JSON.parse(ordered.stdout), list);
  assert.match(ordered.stderr, /warning:.*stale/, 'order prints cache warnings to stderr');
  for (const bad of ['-1', 'abc', 'NaN', 'Infinity', '']) {
    assert.equal(cli('status', '--max-age-s', bad).status, 2, `--max-age-s ${bad}`);
  }
  const fresh = feedDirWithMetrics(isoAgo(0));
  const c2 = tmp('cache');
  const cli2 = (...args) => spawnSync('node', [path.join(__dirname, 'qualification-metrics.js'), ...args, '--feed-cache-dir', c2, '--now', NOW], { encoding: 'utf8' });
  cli2('fetch', '--from', fresh.feed);
  assert.deepEqual(JSON.parse(cli2('status').stdout).warnings, []);
  assert.ok(JSON.parse(cli2('status', '--max-age-s', '0').stdout).warnings.length >= 1, '0 means always warn');
});

// latest_per_task rows (null n_attempts) still get the attempt-free lints (aligned with Python).
function latestPerTaskRow() {
  const doc = fxJson('seat-metrics-latest-per-task.valid.json');
  return { doc, entry: doc.seat_metrics.find((e) => e.benchmark && e.benchmark.n_attempts === null) };
}
const A_lpt = {
  lintsRun(m) {
    const { doc, entry } = latestPerTaskRow();
    assert.ok(entry, 'fixture has a latest_per_task benchmark row');
    assert.deepEqual(m.validateMetrics(JSON.stringify(doc)).errors, []);
    entry.sampling.low_n = !entry.sampling.low_n;
    const r = m.validateMetrics(JSON.stringify(doc));
    assert.ok(r.errors.some((x) => x[0] === 'DERIVED_MISMATCH' && /low_n/.test(x[1])), 'low_n mismatch caught');
    const d2 = latestPerTaskRow();
    d2.entry.speed.speed_basis = 'bogus..bogus';
    assert.ok(m.validateMetrics(JSON.stringify(d2.doc)).errors.length > 0, 'speed_basis mismatch caught');
  },
};
test('latest_per_task: low_n / speed_basis lints run although n_attempts is null', () => A_lpt.lintsRun(lib));

// ── negative controls: the same assertions on deliberately broken copies must go RED ──
expectRed('latest_per_task skips the attempt-free lints', [[
  'if (b.n_attempts === null || b.n_attempts === undefined) { attemptFree(); return out; }',
  'if (b.n_attempts === null || b.n_attempts === undefined) return out;',
]], A_lpt.lintsRun);

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
  'if (a.age_s !== null && (maxAgeS === 0 || a.age_s > maxAgeS)) {',
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

expectRed('old behaviour: lookup through the deduped rows starves the other seats', [[
  '  const own = latestOf(',
  '  if (seat) return latestOf(dedupeBenchmarkRows(doc).filter((e) => seatMatches(seat, e.seat)));\n  const own = latestOf(',
]], A.twoRolesOneCellBothGetData);

expectRed('n_pass + n_timeout check removed: the manifest fixture is no longer rejected', [[
  "if (b.n_timeout !== null && b.n_pass + b.n_timeout > b.n_attempts) bad('n_pass + n_timeout exceeds n_attempts');",
  '',
]], (m) => {
  const r = m.validateMetrics(fx('pass-plus-timeout-exceeds-attempts.invalid.json'));
  assert.equal(r.errors[0] && r.errors[0][0], 'DERIVED_MISMATCH');
});
