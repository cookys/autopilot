'use strict';
// scripts/status-events.test.js - acceptance suite of the events feed (`autopilot status events`, schema autopilot.events/1).
// Plan: docs/plans/2026-11-02-oc-a1-events-contract.md. This file holds the E1 cases (contract, schema, fixture, instant
// grammar); the E2-E4 cases (source-*, degrade-*, resume-*, order-*, cursor-*, rotation, readonly-*) are added by those phases.
// Isolation: every dir is an os.tmpdir() mkdtemp dir; the fixture env is an explicit allowlist; nothing touches the real
// stores (~/.claude, ~/.autopilot, the live dir, the dispatch runs dir).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateJsonSchema, readJson } = require('./validate-json-schema');
const { parseInstant, parseInstantMs } = require('../src/status/events/instant');
const repoLayout = require('./lib/repo-layout');
const fixtureLib = require('./lib/events-fixture');

const { FIXTURE_COMMITS, FOREIGN_BASE, buildFixture, exampleEvent, goldenEnvelope, goldenEvents, normaliseExample, sha256hex } = fixtureLib;

const REPO = path.join(__dirname, '..');
const SCHEMA_FILE = path.join(REPO, repoLayout.path('events_schema'));
const DOC_FILE = path.join(REPO, repoLayout.path('events_contract_doc'));
const SCHEMA = readJson(SCHEMA_FILE, 'schema');
const KINDS = ['dispatch.started', 'dispatch.ended', 'cost.turn', 'review.collected', 'review.finalized', 'qc.verdict', 'decision.row', 'run.stage'];

const cleanup = [];
test.after(() => { for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true }); });
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-events-'));
  cleanup.push(dir);
  return buildFixture({ dir });
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const errorsOf = (document) => validateJsonSchema(SCHEMA, document).errors;
const isValid = (document) => errorsOf(document).length === 0;

// One fixture for the read-only cases (built once; nothing mutates it).
const FX = fresh();
const GOLDEN = goldenEvents(FX);
const ENVELOPE = (events) => ({ ...goldenEnvelope(FX), events });

// ---- instant: the one timestamp grammar -------------------------------------------------------------------------------

test('instant-accepts-rfc3339-and-normalises-to-utc-millis', () => {
  const cases = [
    ['2026-11-02T08:00:00Z', '2026-11-02T08:00:00.000Z'],
    ['2026-11-02T08:00:00.5Z', '2026-11-02T08:00:00.500Z'],
    ['2026-11-02T08:00:00.123Z', '2026-11-02T08:00:00.123Z'],
    ['2026-11-02T08:00:00.123456789Z', '2026-11-02T08:00:00.123Z'], // sub-millisecond digits truncated, not rounded
    ['2026-11-02T08:00:00.9999999Z', '2026-11-02T08:00:00.999Z'],
    ['2026-11-01T09:30:00+01:00', '2026-11-01T08:30:00.000Z'], // git %cI shape
    ['2026-11-01T03:30:00-05:00', '2026-11-01T08:30:00.000Z'],
    ['2024-02-29T00:00:00Z', '2024-02-29T00:00:00.000Z'], // leap day
  ];
  for (const [input, expected] of cases) assert.equal(parseInstant(input), expected, input);
});

test('instant-rejects-lenient-and-impossible-forms', () => {
  const rejected = [
    '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-11-02T24:00:00Z', '2026-11-02T23:59:60Z', '2023-02-29T00:00:00Z',
    '2026-11-02T08:00:00+24:00', '2026-11-02T08:00:00+00:60',
    'Nov 2', '2026-11-02', '2026-11-02 08:00:00Z', '2026-11-02T08:00:00', '2026-11-02t08:00:00z', '2026-11-02T08:00Z',
    '1793000000000', '1793000000', '', ' 2026-11-02T08:00:00Z', '2026-11-02T08:00:00Z ', '2026-11-02T08:00:00.Z',
    '2026-11-02T08:00:00.1234567890Z', '+002026-11-02T08:00:00Z',
    null, undefined, 1793000000000, {}, [],
  ];
  for (const input of rejected) assert.equal(parseInstant(input), null, String(input));
});

test('instant-ms-agrees-with-string-form-and-feeds-the-envelope-pattern', () => {
  const ms = parseInstantMs('2026-11-01T09:30:00+01:00');
  assert.equal(new Date(ms).toISOString(), parseInstant('2026-11-01T09:30:00+01:00'));
  // every golden ts is a fixed point of the grammar and matches the schema's ts pattern
  for (const event of GOLDEN) assert.equal(parseInstant(event.ts), event.ts, event.id);
});

// ---- fixture ----------------------------------------------------------------------------------------------------------

test('fixture-env-is-an-explicit-allowlist', () => {
  assert.deepEqual(Object.keys(FX.env).sort(), [
    'AUTOPILOT_CONFIG_FILE', 'AUTOPILOT_COSTS_FILE', 'AUTOPILOT_DISPATCH_RUNS_DIR', 'AUTOPILOT_LIVE_DIR', 'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_NOSYSTEM', 'HOME', 'LC_ALL', 'PATH', 'TMPDIR',
  ]);
  for (const name of Object.keys(FX.env)) {
    if (name === 'PATH' || name === 'LC_ALL' || name === 'GIT_CONFIG_NOSYSTEM') continue;
    assert.ok(FX.env[name].startsWith(FX.dir), `${name} points into the tempdir`);
  }
  for (const forbidden of ['AUTOPILOT_ROOT_RUN_ID', 'AUTOPILOT_SESSION_ID', 'AUTOPILOT_EVENTS_REVIEW_LEDGERS', 'GIT_DIR', 'GIT_AUTHOR_DATE']) {
    assert.equal(FX.env[forbidden], undefined, forbidden);
  }
});

test('fixture-commit-shas-are-pinned-constants', () => {
  assert.deepEqual(FX.commits, FIXTURE_COMMITS);
  const again = fresh();
  assert.deepEqual(again.commits, FIXTURE_COMMITS, 'a second tempdir yields the same shas');
  assert.notEqual(again.dir, FX.dir);
});

test('fixture-golden-covers-all-8-kinds-with-unique-ordered-ids', () => {
  assert.deepEqual([...new Set(GOLDEN.map((e) => e.kind))].sort(), [...KINDS].sort());
  const ids = GOLDEN.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const sorted = [...GOLDEN].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  assert.deepEqual(GOLDEN, sorted, 'golden list is in (ts, id) order');
  assert.equal(GOLDEN.length, 22);
  for (const event of GOLDEN) assert.equal(event.project_key, FX.projectKey);
});

test('fixture-literal-golden-ids', () => {
  // ids that need no path and no random bytes are literal constants of the contract
  const ids = new Set(GOLDEN.map((e) => e.id));
  for (const literal of [
    'dispatch.started:fx-run-done', 'dispatch.started:fx-run-live', 'dispatch.ended:fx-run-done',
    'qc.verdict:c32883fa590c3f1538a0743f77a41faae4dc5520', 'qc.verdict:9403e1b493da7cd7b5964d2c5eaeb4ba3fb59cbf',
    'review.collected:7cf288e31760:E1:g1', 'review.collected:545dd77e083f:E1:g1', 'review.finalized:545dd77e083f:E1:g1',
  ]) assert.ok(ids.has(literal), literal);
  // the two review ledgers share the phase name E1 and keep distinct histories through phase_base12
  assert.equal(sha256hex(FX.commits.c1).slice(0, 12), '7cf288e31760');
  assert.equal(sha256hex(FX.commits.c2).slice(0, 12), '545dd77e083f');
});

test('fixture-hash-ids-recomputed-from-the-bytes-on-disk', () => {
  const ids = new Set(GOLDEN.map((e) => e.id));
  // cost.turn: sha256(raw line)[0:24] + #n, n = 1-based ordinal among byte-identical lines
  const seen = new Map();
  for (const line of fs.readFileSync(FX.paths.costsFile, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    const n = (seen.get(line) || 0) + 1;
    seen.set(line, n);
    const id = `cost.turn:${sha256hex(line).slice(0, 24)}#${n}`;
    const expected = row.cwd === FX.foreignDir || row.ts === '2026-02-30T00:00:00Z' ? false : true;
    assert.equal(ids.has(id), expected, `${row.session} ${n}`);
  }
  assert.equal([...seen.values()].filter((n) => n === 2).length, 1, 'exactly one byte-identical pair');
  // run.stage: sha256(canonical row)[0:24] of the stage rows read back from both ledger segments
  const stageRows = [];
  for (const file of [FX.paths.runLedgerRotated, FX.paths.runLedger]) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.kind === 'stage') stageRows.push(row);
    }
  }
  assert.equal(stageRows.length, 2);
  for (const row of stageRows) {
    const canonical = JSON.stringify(Object.fromEntries(Object.keys(row).sort().map((k) => [k, row[k]])));
    assert.ok(ids.has(`run.stage:${sha256hex(canonical).slice(0, 24)}`), row.stage);
  }
});

test('fixture-stores-hold-the-planned-shapes-and-foreign-rows', () => {
  const git = (args) => spawnSync('git', args, { cwd: FX.repoDir, env: FX.env, encoding: 'utf8' }).stdout;
  const log = git(['log', '--format=%H%x1f%cI%x1f%(trailers:key=QC-Verdict,valueonly,separator=%x1e)', '--branches', 'HEAD']).trim().split('\n');
  assert.equal(log.length, 3);
  const byCommit = Object.fromEntries(log.map((l) => l.split('\x1f')).map(([h, d, t]) => [h, { d, t: t.trim() }]));
  assert.equal(byCommit[FX.commits.c1].t, '');
  assert.deepEqual([byCommit[FX.commits.c2].t, byCommit[FX.commits.c2].d], ['PASS', '2026-11-01T09:30:00+01:00']);
  assert.equal(byCommit[FX.commits.c3].t, 'WAIVED');

  const manifests = fs.readdirSync(FX.paths.runsDir).sort();
  assert.deepEqual(manifests, ['fx-run-done.manifest.json', 'fx-run-foreign.manifest.json', 'fx-run-live.manifest.json']);
  assert.equal(FX.manifests.live.ended_at, null);
  assert.equal(FX.manifests.foreign.repo_identity, FX.foreignIdentity);
  assert.notEqual(FX.foreignIdentity, FX.identity);

  const costLines = fs.readFileSync(FX.paths.costsFile, 'utf8').split('\n').filter(Boolean);
  assert.equal(costLines.length, 7);
  assert.ok(costLines.some((l) => JSON.parse(l).cwd === FX.foreignDir), 'a foreign-cwd row');
  assert.ok(costLines.some((l) => JSON.parse(l).cwd === FX.paths.removedWorktree) && !fs.existsSync(FX.paths.removedWorktree), 'a removed-worktree row');
  assert.ok(costLines.some((l) => JSON.parse(l).ts === '2026-02-30T00:00:00Z'), 'an impossible-date row');

  const chains = Object.entries(FX.paths.reviewLedgers).map(([name, dir]) => [name, JSON.parse(fs.readFileSync(path.join(dir, name === 'foreign' ? 'review-E9' : 'review-E1', 'chain.json'), 'utf8'))]);
  assert.equal(chains.length, 3);
  assert.equal(chains.find(([n]) => n === 'foreign')[1][0].base, FOREIGN_BASE);
  assert.equal(spawnSync('git', ['cat-file', '-e', FOREIGN_BASE], { cwd: FX.repoDir, env: FX.env }).status !== 0, true, 'foreign base absent from the repo');
  assert.equal(chains.find(([n]) => n === 'a')[1][0].base, FX.commits.c1);
  assert.equal(chains.find(([n]) => n === 'b')[1][0].base, FX.commits.c2);
  assert.equal(fs.readFileSync(FX.paths.reviewPointer, 'utf8').trim().split('\n').length, 2, 'pointer lists the two project ledgers, not the foreign one');

  const decisions = fs.readFileSync(FX.paths.decisionLedger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(decisions.map((r) => r.kind), ['decision', 'decision', 'decision', 'veto', 'ladder', 'note', 'decision']);
  assert.equal(decisions.filter((r) => r.decision_id === 'D-002').length, 2, 'two rows share decision_id and kind');
  assert.ok(decisions.some((r) => r.repo_identity === FX.foreignIdentity), 'a foreign decision row');
  assert.ok(decisions.some((r) => r.kind === 'note' && r.repo_identity === undefined), 'a row without repo_identity');
  assert.ok(fs.readFileSync(FX.paths.decisionLedger, 'utf8').includes(FX.tokenShaped), 'the token-shaped rationale is raw in the store');
  assert.ok(fs.existsSync(FX.paths.workOrderLedger));

  const kinds = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).kind);
  assert.deepEqual(kinds(FX.paths.runLedgerRotated), ['stage', 'heartbeat']);
  assert.deepEqual(kinds(FX.paths.runLedger), ['heartbeat', 'journal', 'stage']);
});

test('fixture-golden-leaks-no-path-token-or-hidden-field', () => {
  const text = JSON.stringify([GOLDEN, goldenEnvelope(FX)]);
  for (const needle of [FX.dir, os.tmpdir(), '/home/', FX.identity, FX.tokenShaped, 'prompt_file', 'log_path', 'lock_path', 'worktree', 'repo_identity', '"cwd"']) {
    assert.ok(!text.includes(needle), `golden output must not contain ${needle}`);
  }
  assert.ok(!/gh[pousr]_[A-Za-z0-9]{20,}/.test(text), 'no token-shaped string');
  assert.ok(text.includes('rotated [redacted] after review'), 'the token-shaped rationale is golden-redacted');
});

test('fixture-writes-only-under-its-own-dir', () => {
  const inside = (file) => file === FX.dir || file.startsWith(`${FX.dir}${path.sep}`);
  const flat = (value) => (typeof value === 'string' ? [value] : Object.values(value).flatMap(flat));
  for (const file of flat(FX.paths)) assert.ok(inside(file), file);
  for (const file of [FX.env.HOME, FX.env.TMPDIR]) assert.deepEqual(fs.readdirSync(file), [], `${file} stays empty`);
  assert.ok(inside(FX.repoDir) && inside(FX.foreignDir));
});

// ---- schema -----------------------------------------------------------------------------------------------------------

test('schema-file-is-supported-by-the-repo-validator', () => {
  assert.equal(isValid(goldenEnvelope(FX)), true);
  assert.equal(SCHEMA.$id.endsWith('/events.schema.json'), true);
  const cli = (documentFile) => spawnSync(process.execPath, [path.join(__dirname, 'validate-json-schema.js'), '--schema', SCHEMA_FILE, '--document', documentFile], { encoding: 'utf8' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-events-cli-'));
  cleanup.push(dir);
  const good = path.join(dir, 'good.json');
  fs.writeFileSync(good, JSON.stringify(ENVELOPE(GOLDEN)));
  assert.equal(cli(good).status, 0);
  const bad = clone(ENVELOPE(GOLDEN));
  delete bad.events.find((e) => e.kind === 'cost.turn').ts;
  const badFile = path.join(dir, 'bad.json');
  fs.writeFileSync(badFile, JSON.stringify(bad));
  assert.equal(cli(badFile).status, 1, 'the CLI rejects a golden cost.turn without ts');
});

test('schema-golden-events-validate', () => {
  const result = validateJsonSchema(SCHEMA, ENVELOPE(GOLDEN));
  assert.deepEqual(result.errors, []);
  for (const event of GOLDEN) assert.equal(isValid({ ...goldenEnvelope(FX), events: [event] }), true, event.id);
});

test('schema-error-object-is-the-second-top-level-shape', () => {
  for (const code of ['bad_cursor', 'usage', 'project_unresolved']) {
    assert.equal(isValid({ schema: 'autopilot.events/1', error: { code } }), true, code);
  }
  assert.equal(isValid({ schema: 'autopilot.events/1', error: {} }), false);
  assert.equal(isValid({ schema: 'autopilot.events/1', error: { code: 'bad_cursor', stack: 'x' } }), false, 'no stack or path in the error object');
  assert.equal(isValid({ ...goldenEnvelope(FX), error: { code: 'bad_cursor' } }), false, 'the two shapes do not mix');
  assert.equal(isValid({ schema: 'autopilot.events/2', error: { code: 'bad_cursor' } }), false);
});

test('schema-red-check-cost-turn-without-ts-fails', () => {
  const broken = clone(ENVELOPE(GOLDEN));
  delete broken.events.find((e) => e.kind === 'cost.turn').ts;
  assert.equal(isValid(broken), false);
});

for (const kind of KINDS) {
  test(`schema-negative-${kind}`, () => {
    const golden = GOLDEN.find((e) => e.kind === kind);
    assert.equal(isValid(ENVELOPE([golden])), true, 'the unmutated event validates');
    const reject = (label, mutate) => {
      const event = clone(golden);
      mutate(event);
      assert.equal(isValid(ENVELOPE([event])), false, `${kind}: ${label} must fail`);
    };
    const required = SCHEMA.$defs[`data_${kind.replace('.', '_')}`].required;
    for (const field of required) reject(`data.${field} removed`, (e) => { delete e.data[field]; });
    reject('unknown data field', (e) => { e.data.surprise = 1; });
    reject('data is not an object', (e) => { e.data = []; });
    reject('wrong source for the kind', (e) => { e.source = e.source === 'costs' ? 'run_ledger' : 'costs'; });
    reject('id with another kind prefix', (e) => { e.id = `other.kind:${e.id.slice(e.id.indexOf(':') + 1)}`; });
    reject('type break in the first required field', (e) => {
      const field = required.find((f) => typeof e.data[f] === 'string' || typeof e.data[f] === 'number');
      e.data[field] = typeof e.data[field] === 'string' ? 7 : 'x';
    });
  });
}

test('schema-negative-event-level-fields', () => {
  const golden = GOLDEN.find((e) => e.kind === 'dispatch.started');
  const mutations = {
    'ts without milliseconds': (e) => { e.ts = '2026-11-01T08:10:00Z'; },
    'ts with an offset': (e) => { e.ts = '2026-11-01T09:10:00.000+01:00'; },
    'ts_basis outside the enum': (e) => { e.ts_basis = 'guess'; },
    'project_key not 16 hex': (e) => { e.project_key = 'XYZ'; },
    'run_id absent': (e) => { delete e.run_id; },
    'root_run_id not string or null': (e) => { e.root_run_id = 5; },
    'extra event field': (e) => { e.repo_identity = 'git-common-dir:/x'; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const event = clone(golden);
    mutate(event);
    assert.equal(isValid(ENVELOPE([event])), false, label);
  }
});

test('schema-negative-envelope-fields', () => {
  const mutations = {
    'schema pinned to /1': (e) => { e.schema = 'autopilot.events/2'; },
    'has_more not boolean': (e) => { e.has_more = 'no'; },
    'cursor missing': (e) => { delete e.cursor; },
    'project_key null': (e) => { e.project.project_key = null; },
    'source state outside the enum': (e) => { e.sources[0].state = 'weird'; },
    'warning without count': (e) => { delete e.warnings[0].count; },
    'warning count zero': (e) => { e.warnings[0].count = 0; },
    'extra envelope field': (e) => { e.signature = 'x'; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const envelope = clone(goldenEnvelope(FX));
    mutate(envelope);
    assert.equal(isValid(envelope), false, label);
  }
});

test('schema-open-sets-accept-unknown-values', () => {
  // an unknown kind (any data), an unknown warning code, an unknown source name and an unknown row_kind are all valid /1 output
  const unknownKind = { ...clone(GOLDEN.find((e) => e.kind === 'cost.turn')), id: 'quota.observed:abc', kind: 'quota.observed', source: 'quota', data: { pct: 3 } };
  assert.equal(isValid(ENVELOPE([unknownKind])), true);
  const envelope = clone(goldenEnvelope(FX));
  envelope.warnings.push({ source: 'brand_new_source', code: 'brand_new_code', detail: 'x', count: 2 });
  envelope.sources.push({ name: 'brand_new_source', state: 'ok', rows_read: 0, rows_skipped: 0, rows_filtered: 0, redactions: 0 });
  assert.equal(isValid(envelope), true);
  const decision = clone(GOLDEN.find((e) => e.kind === 'decision.row'));
  decision.data.row_kind = 'brand_new_row_kind';
  decision.data.basis = 'observed';
  assert.equal(isValid(ENVELOPE([decision])), true);
  // a KNOWN kind still has to carry its own data shape: the open branch does not swallow it
  const known = clone(GOLDEN.find((e) => e.kind === 'cost.turn'));
  known.data = {};
  assert.equal(isValid(ENVELOPE([known])), false);
});

test('schema-known-kinds-are-exactly-the-doc-kinds', () => {
  const events = SCHEMA.$defs.event.oneOf.map((entry) => entry.$ref.split('/').pop());
  assert.equal(events.length, KINDS.length + 1, '8 kind branches plus the open-set branch');
  for (const kind of KINDS) assert.ok(SCHEMA.$defs[`event_${kind.replace('.', '_')}`], kind);
  const open = SCHEMA.$defs.event_unknown_kind.properties.kind.pattern;
  for (const kind of KINDS) assert.equal(new RegExp(open, 'u').test(kind), false, `the open branch excludes ${kind}`);
  assert.equal(new RegExp(open, 'u').test('quota.observed'), true);
});

// ---- doc ---------------------------------------------------------------------------------------------------------------

const DOC = fs.readFileSync(DOC_FILE, 'utf8');
function docExamples() {
  const found = {};
  const re = /^### Example: (\S+)\n\n```json\n([\s\S]*?)\n```/gm;
  let m;
  while ((m = re.exec(DOC)) !== null) found[m[1]] = JSON.parse(m[2]);
  return found;
}

test('doc-registry-keys-resolve-and-point-at-the-files', () => {
  const run = (key) => spawnSync(process.execPath, [path.join(__dirname, 'lib', 'repo-layout.js'), 'path', key], { encoding: 'utf8', cwd: REPO });
  assert.equal(run('events_contract_doc').stdout.trim(), 'docs/dev/events-contract.md');
  assert.equal(run('events_schema').stdout.trim(), 'schemas/events.schema.json');
  assert.ok(fs.existsSync(DOC_FILE) && fs.existsSync(SCHEMA_FILE));
  const lint = spawnSync(process.execPath, [path.join(__dirname, 'layout-lint.js')], { encoding: 'utf8', cwd: REPO });
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);
});

test('doc-examples-equal-the-normalised-fixture-events', () => {
  const examples = docExamples();
  assert.deepEqual(Object.keys(examples).sort(), ['envelope', ...KINDS].sort());
  assert.deepEqual(examples.envelope, normaliseExample(goldenEnvelope(FX), FX));
  for (const kind of KINDS) assert.deepEqual(examples[kind], normaliseExample(exampleEvent(GOLDEN, kind), FX), kind);
  // the envelope example is itself a valid /1 envelope once the documented placeholders are put back
  const live = clone(goldenEnvelope(FX));
  assert.equal(isValid(live), true);
});

test('doc-has-a-kinds-table-row-per-kind-and-the-consumer-table', () => {
  for (const kind of KINDS) {
    const row = DOC.split('\n').find((line) => line.startsWith(`| \`${kind}\` |`));
    assert.ok(row, `kinds table row for ${kind}`);
    const required = SCHEMA.$defs[`data_${kind.replace('.', '_')}`].required;
    for (const field of required) assert.ok(row.includes(`\`${field}\``), `${kind} row names data.${field}`);
  }
  assert.ok(/^\| consumer \| reads \(kind\.field\) \|$/m.test(DOC));
  for (const consumer of ['C1 `hangar console project <name>`', 'C1 `decisions`', 'A4 anomaly cards', 'G1 dashboard', '| all |']) assert.ok(DOC.includes(consumer), consumer);
  assert.ok(/telemetry projection, not attestation/i.test(DOC));
});
