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
const { validateJsonSchema, readJson, canonical } = require('./validate-json-schema');
const { parseInstant, parseInstantMs } = require('../src/status/events/instant');
const repoLayout = require('./lib/repo-layout');
const fixtureLib = require('./lib/events-fixture');

const { FIXTURE_COMMITS, FOREIGN_BASE, buildFixture, exampleEvent, goldenEnvelope, goldenEvents, goldenWarnings, normaliseExample, sha256hex } = fixtureLib;

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
const isValid = (document) => errorsOf(JSON.parse(JSON.stringify(document))).length === 0; // a clean copy: in-process events carry a non-enumerable _src

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
  assert.equal(GOLDEN.length, 25);
  for (const event of GOLDEN) assert.equal(event.project_key, FX.projectKey);
});

test('fixture-literal-golden-ids', () => {
  // ids that need no path and no random bytes are literal constants of the contract
  const ids = new Set(GOLDEN.map((e) => e.id));
  for (const literal of [
    'dispatch.started:fx-run-done', 'dispatch.started:fx-run-live', 'dispatch.ended:fx-run-done',
    'qc.verdict:c32883fa590c3f1538a0743f77a41faae4dc5520', 'qc.verdict:9403e1b493da7cd7b5964d2c5eaeb4ba3fb59cbf',
    'review.collected:7cf288e31760:E1:g1', 'review.collected:545dd77e083f:E1:g1', 'review.finalized:545dd77e083f:E1:g1',
    'review.collected:23596bebea3f:E2:g1',
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
  assert.equal(stageRows.length, 4);
  for (const row of stageRows) {
    assert.ok(ids.has(`run.stage:${sha256hex(canonical(row)).slice(0, 24)}`), row.stage); // the validator's canonical(), the one shared implementation
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

  const chains = Object.entries(FX.paths.reviewLedgers).map(([name, dir]) => [name, JSON.parse(fs.readFileSync(path.join(dir, name === 'foreign' ? 'review-E9' : name === 'c' ? 'review-E2' : 'review-E1', 'chain.json'), 'utf8'))]);
  assert.equal(chains.length, 4);
  assert.equal(chains.find(([n]) => n === 'foreign')[1][0].base, FOREIGN_BASE);
  assert.equal(spawnSync('git', ['cat-file', '-e', FOREIGN_BASE], { cwd: FX.repoDir, env: FX.env }).status !== 0, true, 'foreign base absent from the repo');
  assert.equal(chains.find(([n]) => n === 'a')[1][0].base, FX.commits.c1);
  assert.equal(chains.find(([n]) => n === 'b')[1][0].base, FX.commits.c2);
  assert.equal(fs.readFileSync(FX.paths.reviewPointer, 'utf8').trim().split('\n').length, 3, 'pointer lists the three project ledgers, not the foreign one');
  assert.equal(fs.existsSync(path.join(FX.paths.reviewLedgers.c, 'review-E2', 'g1', 'findings.json')), false, 'ledger c has no findings.json');

  const decisions = fs.readFileSync(FX.paths.decisionLedger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(decisions.map((r) => r.kind), ['decision', 'decision', 'decision', 'veto', 'ladder', 'note', 'decision']);
  assert.equal(decisions.filter((r) => r.decision_id === 'D-002').length, 2, 'two rows share decision_id and kind');
  assert.ok(decisions.some((r) => r.repo_identity === FX.foreignIdentity), 'a foreign decision row');
  assert.ok(decisions.some((r) => r.kind === 'note' && r.repo_identity === undefined), 'a row without repo_identity');
  assert.ok(fs.readFileSync(FX.paths.decisionLedger, 'utf8').includes(FX.tokenShaped), 'the token-shaped rationale is raw in the store');
  assert.ok(fs.existsSync(FX.paths.workOrderLedger));

  const kinds = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).kind);
  assert.deepEqual(kinds(FX.paths.runLedgerRotated), ['stage', 'heartbeat']);
  assert.deepEqual(kinds(FX.paths.runLedger), ['heartbeat', 'journal', 'stage', 'stage', 'stage']);
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

test('schema-review-collected-findings-total-is-optional', () => {
  const withoutFindings = GOLDEN.find((e) => e.kind === 'review.collected' && !('findings_total' in e.data));
  assert.ok(withoutFindings, 'a golden review.collected without findings_total exists (findings.json missing)');
  assert.equal(withoutFindings.data.phase, 'E2');
  assert.equal(isValid(ENVELOPE([withoutFindings])), true, 'the event is kept, not dropped');
  assert.equal(SCHEMA.$defs.data_review_collected.required.includes('findings_total'), false);
  const bad = clone(withoutFindings);
  bad.data.findings_total = 'many';
  assert.equal(isValid(ENVELOPE([bad])), false, 'when present it still has to be an integer');
});

test('golden-run-stage-status-prefers-status-over-state', () => {
  const byStage = Object.fromEntries(GOLDEN.filter((e) => e.kind === 'run.stage').map((e) => [e.data.stage, e.data.status]));
  assert.deepEqual(byStage, { implement: 'running', verify: 'ok', review: 'done', merge: '' });
  // the three row shapes: only state, both with different values, only status
  const rows = FX.runRows;
  assert.deepEqual([rows.stage1.status, rows.stage1.state], [undefined, 'running']);
  assert.deepEqual([rows.stage2.status, rows.stage2.state], ['ok', 'terminal']);
  assert.deepEqual([rows.stage3.status, rows.stage3.state], ['done', undefined]);
  // a present-but-empty status is a status: it is kept (not replaced by state) and conflicts with the other value
  assert.deepEqual([rows.stage4.status, rows.stage4.state], ['', 'terminal']);
  assert.equal(GOLDEN.find((e) => e.kind === 'run.stage' && e.data.stage === 'merge').data.status, '');
  assert.deepEqual(goldenWarnings(FX), [{ source: 'runledger', code: 'status_state_conflict', count: 2 }], 'stage2 and stage4 conflict; stage1 and stage3 do not');
});

test('doc-names-the-reader-warnings-and-rules', () => {
  for (const needle of ['`findings_missing`', '`status_state_conflict`', '`findings_total?`', 'never dropped', '`status` wins']) assert.ok(DOC.includes(needle), needle);
});

test('doc-cost-turn-row-states-the-worktree-fallback', () => {
  const row = DOC.split('\n').find((line) => line.startsWith('| `cost.turn` |'));
  assert.ok(row, 'cost.turn row');
  for (const needle of ['worktree fallback', 'git worktree list --porcelain', "manifests' `worktree` fields", 'no longer exists', 'rows_filtered', 'no warning']) {
    assert.ok(row.includes(needle), `cost.turn row mentions: ${needle}`);
  }
  // the fixture keeps the removed-worktree row, so the contract has to say how
  assert.ok(GOLDEN.some((e) => e.kind === 'cost.turn' && e.data.session === 's-fx-2'));
});

test('instant-rejects-a-trailing-newline', () => {
  assert.equal(parseInstant('2026-11-02T08:00:00Z\n'), null);
  assert.equal(parseInstant('\n2026-11-02T08:00:00Z'), null);
});

test('schema-counts-have-a-zero-floor', () => {
  const review = clone(GOLDEN.find((e) => e.kind === 'review.collected'));
  assert.equal(isValid(ENVELOPE([review])), true);
  const probes = [
    ['review.collected', 'findings_total'], ['review.finalized', 'open_findings'], ['dispatch.started', 'depth'], ['dispatch.started', 'timeout_seconds'],
  ];
  for (const [kind, field] of probes) {
    const event = clone(GOLDEN.find((e) => e.kind === kind));
    event.data[field] = 0;
    assert.equal(isValid(ENVELOPE([event])), true, `${kind}.${field} = 0`);
    event.data[field] = null;
    assert.equal(isValid(ENVELOPE([event])), true, `${kind}.${field} = null`);
    event.data[field] = -1;
    assert.equal(isValid(ENVELOPE([event])), false, `${kind}.${field} = -1 must fail`);
  }
});

test('doc-run-stage-row-states-presence-rule', () => {
  const row = DOC.split('\n').find((line) => line.startsWith('| `run.stage` |'));
  for (const needle of ['whenever the row has a `status` property, even an empty string', 'the chosen value is kept as it is', '`status_state_conflict`']) assert.ok(row.includes(needle), needle);
});

// The E1 evidence file records this suite's own run. It must list exactly the tests the file declares, with their count.
test('evidence-e1-lists-exactly-the-tests-of-this-suite', () => {
  const evidenceFile = path.join(REPO, repoLayout.path('plans_evidence_dir'), '2026-11-02-oc-a1-events', 'e1-contract.txt');
  const evidence = fs.readFileSync(evidenceFile, 'utf8');
  const source = fs.readFileSync(__filename, 'utf8');
  // the resume-/order-/cursor- cases are E3's; they are recorded by the E3 evidence, not by this E1 file
  const declared = [...source.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]).filter((name) => !/^(resume|order|cursor)-/.test(name));
  for (const kind of KINDS) declared.push(`schema-negative-${kind}`);
  const listed = [...evidence.matchAll(/^✔ (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual([...listed].sort(), [...declared].sort(), 'evidence lists every declared test, no more, no less');
  assert.ok(evidence.includes(`ℹ tests ${declared.length}\nℹ pass ${declared.length}\nℹ fail 0`), `evidence records ${declared.length} tests, all passing`);
});

// ============================================================================================================================
// E3: merge, cursor, resume (cases resume-*, order-*, cursor-*). Plan: project/plans/2026-11-02-oc-a1-events-contract.md, E3.
// In-process through collectEvents; the fixture env is an explicit allowlist, every dir is a tempdir.
// ============================================================================================================================

const { collectEvents, exitCodeOf } = require('../src/status/events');
const cursorLib = require('../src/status/events/cursor');
const costReader = require('../src/status/events/sources/cost');

const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const isoOf = (ms) => new Date(ms).toISOString();
const baseOpts = (fx, extra = {}) => ({
  cwd: fx.repoDir, env: fx.env, home: fx.env.HOME, now: Date.parse('2026-11-02T08:00:00.000Z'), reviewLedgers: [fx.paths.reviewLedgers.foreign], ...extra,
});
const decodeC = (cursor) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
const encodeC = (body) => Buffer.from(JSON.stringify(body)).toString('base64url');
const dropHints = (cursor) => encodeC({ ...decodeC(cursor), h: {} });
const idsOfPages = (pages) => pages.flatMap((page) => page.events.map((e) => e.id));
const byTsId = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Pages of `limit` until has_more is false; each page resumes from the previous cursor (hints optionally stripped).
function drain(opts, { limit, hints = true, max = 800 } = {}) {
  const pages = [];
  let since = opts.since;
  for (let i = 0; i < max; i += 1) {
    const page = collectEvents({ ...opts, since, limit });
    assert.equal(page.error, undefined, JSON.stringify(page.error));
    pages.push(page);
    since = hints ? page.cursor : dropHints(page.cursor);
    if (!page.has_more) return pages;
  }
  throw new Error('drain did not terminate');
}

// Stub readers: the `cost` slot serves a mutable event list, every other slot is empty. Isolates the merge/cursor rules from the sources.
const EMPTY_READER = { read: () => ({ events: [], warnings: [], stats: { state: 'ok', rows_read: 0, rows_skipped: 0, rows_filtered: 0, redactions: 0 }, files: [] }) };
function stubEvent(fx, key, tsMs, src) {
  const event = {
    id: `cost.turn:${key}`, kind: 'cost.turn', ts: isoOf(tsMs), ts_basis: 'source', source: 'costs', project_key: fx.projectKey, root_run_id: null, run_id: null, data: {},
  };
  if (src) Object.defineProperty(event, '_src', { value: src, enumerable: false });
  return event;
}
function stubDeps(fx, events, files = []) {
  const project = { project_key: fx.projectKey, repo_identity: fx.identity, repo_name: 'repo', root: fx.repoDir, common_dir: fx.identity.slice('git-common-dir:'.length) };
  const cost = { read: () => ({ events: events(), warnings: [], stats: { state: 'ok', rows_read: 0, rows_skipped: 0, rows_filtered: 0, redactions: 0 }, files }) };
  return { resolveProject: () => project, readers: { dispatch: EMPTY_READER, cost, review: EMPTY_READER, qc: EMPTY_READER, decision: EMPTY_READER, runledger: EMPTY_READER } };
}
const stubOpts = (fx, events, extra = {}) => ({ cwd: fx.repoDir, env: {}, now: T0, deps: stubDeps(fx, events, extra.files), ...extra });
const padId = (n) => `e${String(n).padStart(6, '0')}`;

// ---- resume ---------------------------------------------------------------------------------------------------------------

test('resume-pages-1-3-all: pages of 1, 3 and all concatenate to the full list, in order', () => {
  const fx = fresh();
  const golden = goldenEvents(fx).map((e) => e.id);
  const whole = collectEvents(baseOpts(fx));
  assert.deepEqual(whole.events.map((e) => e.id), golden);
  assert.equal(whole.has_more, false);
  for (const n of [1, 3, 100]) {
    const pages = drain(baseOpts(fx), { limit: n });
    assert.deepEqual(idsOfPages(pages), golden, `pages of ${n}`);
    for (const page of pages.slice(0, -1)) assert.equal(page.has_more, true);
    assert.equal(pages[pages.length - 1].has_more, false);
  }
});

test('resume-after-append-cost: (i) rows appended to the live costs file arrive once, a byte-identical one as #2', () => {
  const fx = fresh();
  const first = collectEvents(baseOpts(fx));
  const rowA = JSON.stringify({ ...JSON.parse(fx.cost.main), ts: '2026-11-02T00:00:00.000Z', session: 's-app-1' });
  const rowB = JSON.stringify({ ...JSON.parse(fx.cost.main), ts: '2026-11-02T00:00:01.000Z', session: 's-app-2' });
  fs.appendFileSync(fx.paths.costsFile, `${rowA}\n${rowB}\n`);
  const idOf = (row, n) => `cost.turn:${sha256hex(row).slice(0, 24)}#${n}`;
  const second = collectEvents(baseOpts(fx, { since: first.cursor }));
  assert.deepEqual(second.events.map((e) => e.id), [idOf(rowA, 1), idOf(rowB, 1)]);
  fs.appendFileSync(fx.paths.costsFile, `${rowB}\n`);
  const third = collectEvents(baseOpts(fx, { since: second.cursor }));
  assert.deepEqual(third.events.map((e) => e.id), [idOf(rowB, 2)], 'an identical line stays a distinct event');
  const full = collectEvents(baseOpts(fx));
  assert.deepEqual(full.events.map((e) => e.id).sort(), [...first.events.map((e) => e.id), idOf(rowA, 1), idOf(rowB, 1), idOf(rowB, 2)].sort());
});

test('resume-late-row-decision: (ii) a row inside the slack but before the watermark is delivered once, earlier rows are not repeated', () => {
  const fx = fresh();
  const first = collectEvents(baseOpts(fx));
  assert.equal(decodeC(first.cursor).t, '2026-11-01T10:00:00.000Z');
  const late = { schema_version: 1, ts: '2026-11-01T09:58:00.000Z', kind: 'note', round: 3, text: 'late' };
  fs.appendFileSync(fx.paths.decisionLedger, `${JSON.stringify(late)}\n`);
  const second = collectEvents(baseOpts(fx, { since: first.cursor }));
  assert.equal(second.events.length, 1, 'only the late row; the rows of the earlier page inside the window are not repeated');
  assert.equal(second.events[0].kind, 'decision.row');
  assert.equal(second.events[0].data.row_kind, 'note');
  const third = collectEvents(baseOpts(fx, { since: second.cursor }));
  assert.deepEqual(third.events, [], 'delivered exactly once');
  assert.equal(third.cursor, second.cursor, 'an empty page returns the input cursor unchanged');
  // a row older than the slack is out of contract for a resumed read (a cold read still sees it)
  const tooLate = { schema_version: 1, ts: '2026-11-01T09:00:00.000Z', kind: 'note', round: 4, text: 'too late' };
  fs.appendFileSync(fx.paths.decisionLedger, `${JSON.stringify(tooLate)}\n`);
  assert.deepEqual(collectEvents(baseOpts(fx, { since: second.cursor })).events, []);
  assert.equal(collectEvents(baseOpts(fx)).events.filter((e) => e.data.row_kind === 'note').length, 3);
});

test('resume-manifest-finished: (iv) a running manifest that finishes between two reads yields exactly its dispatch.ended', () => {
  const fx = fresh();
  const first = collectEvents(baseOpts(fx));
  const file = path.join(fx.paths.runsDir, 'fx-run-live.manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.ended_at = '2026-11-01T10:30:00Z';
  manifest.ended_epoch = Math.floor(Date.parse(manifest.ended_at) / 1000);
  manifest.final_status = 'success';
  fs.writeFileSync(file, `${JSON.stringify(manifest)}\n`);
  const second = collectEvents(baseOpts(fx, { since: first.cursor }));
  assert.deepEqual(second.events.map((e) => e.id), ['dispatch.ended:fx-run-live']);
  assert.equal(second.events[0].data.duration_s, manifest.ended_epoch - manifest.started_epoch);
  assert.deepEqual(collectEvents(baseOpts(fx, { since: second.cursor })).events, []);
});

// a costs file of 170 rows (one every 400 s, ~400 bytes each): over the 64 KiB hint threshold, one row inside any 300 s window
function bigCostFile(fx, rows = 170) {
  const lines = [];
  for (let i = 0; i < rows; i += 1) {
    lines.push(JSON.stringify({ ...JSON.parse(fx.cost.main), ts: isoOf(T0 + i * 400000), session: `s-big-${i}`, pad: 'x'.repeat(200) }));
  }
  fs.writeFileSync(fx.paths.costsFile, `${lines.join('\n')}\n`);
  assert.ok(fs.statSync(fx.paths.costsFile).size >= 64 * 1024, 'the file is over the hint threshold');
  return lines;
}
function costOnlyOpts(fx, extra = {}) {
  const deps = stubDeps(fx, () => []);
  deps.readers.cost = costReader;
  return { ...baseOpts(fx), deps, ...extra };
}
const costStat = (page) => page.sources.find((s) => s.name === 'cost');

test('resume-hints-equal-pages-1: (ix) pages of 1 with hints equal pages of 1 without hints, and the hints are really used', () => {
  const fx = fresh();
  const lines = bigCostFile(fx);
  const expected = lines.map((line) => `cost.turn:${sha256hex(line).slice(0, 24)}#1`);
  const hinted = drain(costOnlyOpts(fx), { limit: 1 });
  const plain = drain(costOnlyOpts(fx), { limit: 1, hints: false });
  assert.deepEqual(idsOfPages(hinted), expected, 'no gap, no duplicate with hints');
  assert.deepEqual(idsOfPages(plain), expected);
  assert.deepEqual(idsOfPages(hinted), idsOfPages(plain));
  const hintKeys = Object.keys(decodeC(hinted[40].cursor).h);
  assert.equal(hintKeys.length, 1);
  assert.ok(hintKeys[0].startsWith('cost:'));
  // the later pages of the hinted run read a few rows, the unhinted run reads the file from the start every time
  // (every page reads to the end of the file: with a hint from the next undelivered row that is the 70 rows left, without it all 170)
  assert.ok(costStat(hinted[100]).rows_read <= 75, `hinted page reads ${costStat(hinted[100]).rows_read} rows`);
  assert.ok(costStat(plain[100]).rows_read >= 165, `unhinted page reads ${costStat(plain[100]).rows_read} rows`);
  // (v) deleting h from any cursor yields the identical result
  const mid = hinted[60].cursor;
  const withH = collectEvents(costOnlyOpts(fx, { since: mid, limit: 5 }));
  const withoutH = collectEvents(costOnlyOpts(fx, { since: dropHints(mid), limit: 5 }));
  assert.deepEqual(withH.events, withoutH.events);
  assert.deepEqual(decodeC(withH.cursor).w, decodeC(withoutH.cursor).w);
});

test('resume-identical-lines-hinted: two identical cost lines, the second appended after a hinted read, get the unhinted ids', () => {
  const fx = fresh();
  bigCostFile(fx);
  const opts = costOnlyOpts(fx);
  const all = collectEvents({ ...opts, limit: 10000 });
  const row = JSON.stringify({ ...JSON.parse(fx.cost.main), ts: isoOf(T0 + 200 * 400000), session: 's-twin' });
  fs.appendFileSync(fx.paths.costsFile, `${row}\n`);
  const second = collectEvents({ ...opts, since: all.cursor });
  assert.deepEqual(second.events.map((e) => e.id), [`cost.turn:${sha256hex(row).slice(0, 24)}#1`]);
  assert.ok(Object.keys(decodeC(second.cursor).h).length === 1, 'the cursor holds a hint');
  fs.appendFileSync(fx.paths.costsFile, `${row}\n`);
  const hinted = collectEvents({ ...opts, since: second.cursor });
  const unhinted = collectEvents({ ...opts, since: dropHints(second.cursor) });
  assert.deepEqual(hinted.events.map((e) => e.id), [`cost.turn:${sha256hex(row).slice(0, 24)}#2`]);
  assert.deepEqual(hinted.events, unhinted.events);
  // a third and fourth copy: the hint the previous call wrote must still sit at or before the FIRST copy (it was only read, not delivered)
  fs.appendFileSync(fx.paths.costsFile, `${row}\n`);
  const fourth = collectEvents({ ...opts, since: hinted.cursor });
  assert.deepEqual(fourth.events.map((e) => e.id), [`cost.turn:${sha256hex(row).slice(0, 24)}#3`]);
  assert.deepEqual(fourth.events, collectEvents({ ...opts, since: dropHints(hinted.cursor) }).events);
});

test('resume-bounded-out-of-order: a displaced line with a smaller offset than every kept one keeps the hint behind it', () => {
  const fx = fresh();
  const lines = bigCostFile(fx);
  // the first line of the file carries the LATEST ts: it is displaced by the collector, and no hint may skip it
  lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), ts: isoOf(T0 + 400 * 400000), session: 's-first-but-latest' });
  fs.writeFileSync(fx.paths.costsFile, `${lines.join('\n')}\n`);
  const expected = costOnlyOpts(fx, { limit: 10000 });
  const all = collectEvents(expected).events.map((e) => e.id);
  assert.equal(all.length, lines.length);
  for (const hints of [true, false]) assert.deepEqual(idsOfPages(drain(costOnlyOpts(fx), { limit: 3, hints })).sort(), [...all].sort(), `hints ${hints}`);
});

test('resume-rotation: (iii) rotating the run ledger keeps its hint (the head hash follows the file to .1): no gap, no duplicate, no full re-read', () => {
  const fx = fresh();
  const padRows = [];
  for (let i = 0; i < 500; i += 1) {
    padRows.push(JSON.stringify({ kind: 'stage', ts: `2026-10-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`, run_id: 'fx-run-done', stage: 'implement', generation: 10 + i, state: 'running', reason: 'p'.repeat(120) }));
  }
  fs.appendFileSync(fx.paths.runLedger, `${padRows.join('\n')}\n`);
  assert.ok(fs.statSync(fx.paths.runLedger).size >= 64 * 1024);
  const first = collectEvents(baseOpts(fx, { limit: 10000 }));
  assert.equal(first.events.filter((e) => e.kind === 'run.stage').length, 504);
  assert.ok(Object.keys(decodeC(first.cursor).h).some((key) => key.startsWith('runledger:')), 'the run ledger got a hint');
  // rotate: .1 -> .2, live -> .1, a new live file with one new stage row
  fs.renameSync(`${fx.paths.runLedger}.1`, `${fx.paths.runLedger}.2`);
  fs.renameSync(fx.paths.runLedger, `${fx.paths.runLedger}.1`);
  const fresh1 = { kind: 'stage', ts: '2026-11-01T11:00:00.000Z', run_id: 'fx-run-done', stage: 'close', state: 'terminal', generation: 5 };
  fs.writeFileSync(fx.paths.runLedger, `${JSON.stringify(fresh1)}\n`);
  const second = collectEvents(baseOpts(fx, { since: first.cursor, limit: 10000 }));
  assert.deepEqual(second.events.map((e) => e.id), [`run.stage:${sha256hex(canonical(fresh1)).slice(0, 24)}`]);
  const stat = second.sources.find((s) => s.name === 'runledger');
  assert.ok(stat.rows_read <= 10, `the rotated segment was read from its hint (${stat.rows_read} rows)`);
  const plain = collectEvents(baseOpts(fx, { since: dropHints(first.cursor), limit: 10000 }));
  assert.deepEqual(plain.events, second.events);
  assert.ok(plain.sources.find((s) => s.name === 'runledger').rows_read >= 500, 'without the hint the rotated file is read in full');
});

test('resume-two-ledgers-one-phase: (x) two review ledgers sharing phase E1 keep both histories across resume', () => {
  const fx = fresh();
  const pages = drain(baseOpts(fx), { limit: 2 });
  const reviewIds = idsOfPages(pages).filter((id) => id.startsWith('review.'));
  assert.ok(reviewIds.includes('review.collected:7cf288e31760:E1:g1'));
  assert.ok(reviewIds.includes('review.collected:545dd77e083f:E1:g1'));
  assert.ok(reviewIds.includes('review.finalized:545dd77e083f:E1:g1'));
  assert.equal(new Set(reviewIds).size, reviewIds.length);
});

test('resume-pages-window: pages of 1 and 4 over events 1 s apart (all inside the slack) have no duplicate and no gap', () => {
  const fx = fresh();
  const list = [];
  for (let i = 0; i < 30; i += 1) list.push(stubEvent(fx, padId(i), T0 + i * 1000));
  for (const n of [1, 4]) {
    const pages = drain(stubOpts(fx, () => list), { limit: n });
    assert.deepEqual(idsOfPages(pages), list.map((e) => e.id), `pages of ${n}`);
  }
});

// ---- order ----------------------------------------------------------------------------------------------------------------

test('order-tie: events with one ts are ordered by id, bytewise, whatever order the readers produced them', () => {
  const fx = fresh();
  const same = [stubEvent(fx, 'b', T0), stubEvent(fx, 'B', T0), stubEvent(fx, 'a', T0), stubEvent(fx, 'a10', T0), stubEvent(fx, 'a2', T0)];
  const page = collectEvents(stubOpts(fx, () => same));
  assert.deepEqual(page.events.map((e) => e.id), ['cost.turn:B', 'cost.turn:a', 'cost.turn:a10', 'cost.turn:a2', 'cost.turn:b']);
  const mixed = [stubEvent(fx, 'z', T0 + 1000), stubEvent(fx, 'y', T0), stubEvent(fx, 'a', T0 + 1000)];
  assert.deepEqual(collectEvents(stubOpts(fx, () => mixed)).events.map((e) => e.id), ['cost.turn:y', 'cost.turn:a', 'cost.turn:z']);
});

test('order-duplicate-id: two readers producing one id keep one event and warn duplicate_id; an event failing the envelope check is dropped', () => {
  const fx = fresh();
  const deps = stubDeps(fx, () => [stubEvent(fx, 'dup', T0), stubEvent(fx, 'dup', T0), stubEvent(fx, 'ok', T0 + 1)]);
  const broken = [{ id: 'cost.turn:x', kind: 'cost.turn', ts: 'yesterday', source: 'costs', project_key: fx.projectKey, data: {} }, { id: 'nope', kind: 'cost.turn', ts: isoOf(T0), source: 'costs', project_key: 'k', data: {} }];
  deps.readers.qc = { read: () => ({ events: broken, warnings: [], stats: { state: 'ok' }, files: [] }) };
  const page = collectEvents({ cwd: fx.repoDir, env: {}, now: T0, deps });
  assert.deepEqual(page.events.map((e) => e.id), ['cost.turn:dup', 'cost.turn:ok']);
  assert.deepEqual(page.warnings.filter((w) => w.source === 'merge').map((w) => `${w.code}:${w.count}`).sort(), ['duplicate_id:1', 'schema_mismatch:2']);
});

test('order-determinism: two runs on an unchanged fixture give byte-identical events and cursor', () => {
  const fx = fresh();
  const a = collectEvents(baseOpts(fx));
  const b = collectEvents(baseOpts(fx));
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  assert.equal(a.cursor, b.cursor);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'with a pinned now the whole envelope is identical');
  const c = collectEvents(baseOpts(fx, { limit: 7 }));
  assert.equal(c.cursor, collectEvents(baseOpts(fx, { limit: 7 })).cursor);
  assert.ok(isValid(a), 'the envelope is valid against the schema');
});

// ---- cursor ---------------------------------------------------------------------------------------------------------------

test('cursor-since-forms: omitted, 0 and "0" read everything; an ISO instant reads events with ts >= it; limit and kinds cut the page', () => {
  const fx = fresh();
  const golden = goldenEvents(fx);
  for (const since of [undefined, 0, '0']) assert.equal(collectEvents(baseOpts(fx, { since })).events.length, golden.length);
  const cutoff = '2026-11-01T08:50:00.000Z';
  const fromIso = collectEvents(baseOpts(fx, { since: cutoff }));
  assert.deepEqual(fromIso.events.map((e) => e.id), golden.filter((e) => e.ts >= cutoff).map((e) => e.id), 'an event at exactly the instant is included');
  const onlyQc = collectEvents(baseOpts(fx, { kinds: ['qc.verdict', 'run.stage'] }));
  assert.deepEqual(onlyQc.events.map((e) => e.id), golden.filter((e) => e.kind === 'qc.verdict' || e.kind === 'run.stage').map((e) => e.id));
  const kindList = collectEvents(baseOpts(fx, { kinds: 'qc.verdict' }));
  assert.equal(kindList.events.length, 2);
  const cut = collectEvents(baseOpts(fx, { limit: 4 }));
  assert.equal(cut.events.length, 4);
  assert.equal(cut.has_more, true);
  assert.equal(collectEvents(baseOpts(fx, { kinds: ['no.such.kind'] })).events.length, 0);
  assert.ok(isValid(fromIso) && isValid(onlyQc) && isValid(cut));
});

test('cursor-foreign-project: (vi) a cursor of another project exits 2 bad_cursor', () => {
  const fx = fresh();
  const other = fresh();
  assert.notEqual(fx.projectKey, other.projectKey);
  const theirs = collectEvents(baseOpts(other)).cursor;
  const result = collectEvents(baseOpts(fx, { since: theirs }));
  assert.deepEqual(result, { schema: 'autopilot.events/1', error: { code: 'bad_cursor' } });
  assert.equal(exitCodeOf(result), 2);
  assert.ok(isValid(result), 'the error object is the schema\'s second top-level shape');
  const mismatch = collectEvents(baseOpts(fx, { projectKey: 'f'.repeat(16) }));
  assert.deepEqual(mismatch, { schema: 'autopilot.events/1', error: { code: 'project_mismatch' } });
  assert.equal(exitCodeOf(mismatch), 2);
  assert.ok(isValid(mismatch), 'project_mismatch is a valid error object');
  assert.equal(collectEvents(baseOpts(fx, { projectKey: fx.projectKey })).error, undefined);
});

test('cursor-project-unresolved: (vi-b) cwd outside any repo, and a PATH without git, exit 2 project_unresolved', () => {
  const fx = fresh();
  const plain = path.join(fx.dir, 'plain');
  fs.mkdirSync(plain);
  const emptyBin = path.join(fx.dir, 'empty-bin');
  fs.mkdirSync(emptyBin);
  for (const opts of [baseOpts(fx, { cwd: plain }), baseOpts(fx, { env: { ...fx.env, PATH: emptyBin } }), baseOpts(fx, { cwd: path.join(fx.dir, 'gone') })]) {
    const result = collectEvents(opts);
    assert.deepEqual(result, { schema: 'autopilot.events/1', error: { code: 'project_unresolved' } });
    assert.equal(exitCodeOf(result), 2);
    assert.ok(isValid(result));
  }
  // the resolved project is the one scopeFromCwd computes
  const ok = collectEvents(baseOpts(fx));
  assert.deepEqual(ok.project, { project_key: fx.projectKey, repo_name: fx.repoName });
});

test('cursor-garbage: (vii) a cursor that does not decode, has an unknown v or a malformed field exits 2 bad_cursor', () => {
  const fx = fresh();
  const good = decodeC(collectEvents(baseOpts(fx)).cursor);
  const mutated = (patch) => encodeC({ ...good, ...patch });
  const garbage = [
    'not-a-cursor', '!!!', '2026-11-01', 'Nov 2', '1793000000000', encodeC('x').slice(0, 5), Buffer.from('{not json').toString('base64url'),
    Buffer.from('[]').toString('base64url'), mutated({ v: 2 }), mutated({ v: undefined }), mutated({ p: 'f'.repeat(16) }), mutated({ t: 'yesterday' }),
    mutated({ s: -1 }), mutated({ s: 400000 }), mutated({ w: 'x' }), mutated({ w: [['zz', 1]] }), mutated({ w: [['0123456789ab']] }), mutated({ f: 'x' }),
    mutated({ e: [1] }), mutated({ h: [] }), mutated({ h: { 'cost:zz': 1 } }), mutated({ h: { 'cost:0123456789ab': -1 } }),
    mutated({ w: Array.from({ length: 1001 }, (_, i) => [i.toString(16).padStart(12, '0'), 1]) }),
    mutated({ h: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`cost:${i.toString(16).padStart(12, '0')}`, 1])) }),
    'A'.repeat(70000),
  ];
  for (const since of garbage) {
    const result = collectEvents(baseOpts(fx, { since }));
    assert.deepEqual(result, { schema: 'autopilot.events/1', error: { code: 'bad_cursor' } }, String(since).slice(0, 40));
  }
  assert.equal(collectEvents(baseOpts(fx, { since: encodeC(good) })).error, undefined, 'the same body is accepted when well formed');
});

const FAULT_ENV = (fx, name, allow = '1') => ({ ...fx.env, AUTOPILOT_TEST_ALLOW_EVENTS_FAULT: allow, AUTOPILOT_EVENTS_TEST_FAULT: name });
function assertFallback(page, cursor) {
  assert.deepEqual(page.events, []);
  assert.equal(page.has_more, false);
  assert.equal(page.cursor, cursor, 'the input cursor comes back unchanged');
  assert.deepEqual(page.sources.map((s) => s.state), Array(6).fill('degraded'));
  assert.deepEqual(page.warnings.map((w) => w.code), ['internal_error']);
  assert.ok(!/[\\/]/.test(page.warnings[0].detail) && !/\n|at /.test(page.warnings[0].detail), 'error name only');
  assert.ok(isValid(page));
}

test('cursor-fault-in-process: (vi-c) a fault in merge, cursor encoding or envelope build via collectEvents({deps}) exits 0 with internal_error and the input cursor', () => {
  const fx = fresh();
  const golden = goldenEvents(fx).map((e) => e.id);
  const first = collectEvents(baseOpts(fx, { limit: 3 }));
  const boom = () => { throw new TypeError('boom'); };
  for (const deps of [{ mergePage: boom }, { encodeCursor: boom }, { buildEnvelope: boom }]) {
    const page = collectEvents(baseOpts(fx, { since: first.cursor, limit: 3, deps }));
    assert.equal(exitCodeOf(page), 0);
    assertFallback(page, first.cursor);
    assert.equal(page.warnings[0].detail, 'TypeError');
    // a following normal call with that cursor delivers the rest
    const rest = drain(baseOpts(fx, { since: page.cursor }), { limit: 3 });
    assert.deepEqual([...first.events.map((e) => e.id), ...idsOfPages(rest)], golden);
  }
  // from the very start the cursor echoed is the synthetic one the value decodes to
  const cold = collectEvents(baseOpts(fx, { deps: { mergePage: boom } }));
  assertFallback(cold, cold.cursor);
  assert.deepEqual(decodeC(cold.cursor), { v: 1, t: '1970-01-01T00:05:00.000Z', s: 300000, w: [], f: 0, e: null, h: {}, p: fx.projectKey });
  assert.deepEqual(drain(baseOpts(fx, { since: cold.cursor }), { limit: 100 })[0].events.map((e) => e.id), golden);
  const iso = collectEvents(baseOpts(fx, { since: '2026-11-01T09:00:00Z', deps: { encodeCursor: boom } }));
  assertFallback(iso, iso.cursor);
  assert.equal(decodeC(iso.cursor).t, '2026-11-01T09:05:00.000Z');
  // a reader that throws is a source problem, not an internal error
  const deps = stubDeps(fx, () => []);
  deps.readers.qc = { read: boom };
  const degraded = collectEvents({ cwd: fx.repoDir, env: {}, now: T0, deps });
  assert.deepEqual(degraded.warnings.map((w) => `${w.source}:${w.code}`), ['qc:source_failed']);
  assert.equal(degraded.sources.find((s) => s.name === 'qc').state, 'degraded');
});

test('cursor-fault-env: (vi-c) AUTOPILOT_EVENTS_TEST_FAULT=merge|cursor|envelope is honoured only with AUTOPILOT_TEST_ALLOW_EVENTS_FAULT=1', () => {
  const fx = fresh();
  const first = collectEvents(baseOpts(fx, { limit: 3 }));
  for (const name of ['merge', 'cursor', 'envelope']) {
    const page = collectEvents(baseOpts(fx, { since: first.cursor, limit: 3, env: FAULT_ENV(fx, name) }));
    assertFallback(page, first.cursor);
    const ignored = collectEvents(baseOpts(fx, { since: first.cursor, limit: 3, env: FAULT_ENV(fx, name, '0') }));
    assert.equal(ignored.warnings.some((w) => w.code === 'internal_error'), false, `${name} ignored without the allow variable`);
    assert.equal(ignored.events.length, 3);
    const unset = collectEvents(baseOpts(fx, { since: first.cursor, limit: 3, env: { ...fx.env, AUTOPILOT_EVENTS_TEST_FAULT: name } }));
    assert.equal(unset.events.length, 3);
  }
});

test('cursor-size-bound: w <= 1000 pairs and h <= 16 entries keep an encoded cursor under 64 KiB', () => {
  const state = {
    v: 1, t: T0, s: 300000, f: T0 - 300000, e: [T0, `cost.turn:${'f'.repeat(24)}#99999`], p: 'a'.repeat(16),
    w: Array.from({ length: cursorLib.MAX_W }, (_, i) => [sha256hex(`id-${i}`).slice(0, 12), 1793000000000 + i]),
    h: Object.fromEntries(Array.from({ length: cursorLib.MAX_H }, (_, i) => [`runledger:${sha256hex(`h-${i}`).slice(0, 12)}`, 2 ** 40 + i])),
  };
  const text = cursorLib.encodeCursor(state);
  assert.ok(text.length <= 64 * 1024, `${text.length} bytes`);
  assert.ok(text.length < 56 * 1024, 'about 46 KB of w plus the rest');
  const back = cursorLib.decodeCursor(text, state.p);
  assert.equal(back.w.length, 1000);
  assert.equal(Object.keys(back.h).length, 16);
  assert.deepEqual(cursorLib.decodeCursor(cursorLib.encodeCursor(back), state.p), back, 'encode/decode round trip');
});

test('cursor-hints-bound: hints exist only for files >= 64 KiB, at most 16, the largest first', () => {
  const fx = fresh();
  const files = [];
  const events = [];
  for (let i = 0; i < 20; i += 1) {
    const head = i.toString(16).padStart(12, '0');
    files.push({ key: `cost:${head}`, file: `/f/${i}`, size: 70000 + i * 1000, head, startOffset: 0, endOffset: 5000 + i });
    events.push(stubEvent(fx, `big${i}`, T0 + i * 1000, { source: 'cost', file: `/f/${i}`, head, offset: 100 + i, end: 200 + i }));
  }
  files.push({ key: 'cost:ffffffffffff', file: '/f/small', size: 63 * 1024, head: 'ffffffffffff', startOffset: 0, endOffset: 9000 });
  const page = collectEvents(stubOpts(fx, () => events, { files }));
  const h = decodeC(page.cursor).h;
  assert.equal(Object.keys(h).length, 16);
  assert.equal(h['cost:ffffffffffff'], undefined, 'a small file gets no hint');
  for (let i = 4; i < 20; i += 1) assert.ok(h[`cost:${i.toString(16).padStart(12, '0')}`] !== undefined, `file ${i} is among the 16 largest`);
  for (let i = 0; i < 4; i += 1) assert.equal(h[`cost:${i.toString(16).padStart(12, '0')}`], undefined);
});

test('cursor-hint-cut-page: (e) a page cut by --limit leaves the hint at or before the first undelivered line', () => {
  const fx = fresh();
  const head = 'abcdef012345';
  const file = { key: `cost:${head}`, file: '/f/big', size: 200000, head, startOffset: 0, endOffset: 4000 };
  const rows = [1000, 2000, 3000, 4000].map((offset, i) => stubEvent(fx, padId(i), T0 + i * 1000000, { source: 'cost', file: '/f/big', head, offset, end: offset + 999 }));
  const page = collectEvents(stubOpts(fx, () => rows, { files: [file], limit: 2 }));
  assert.equal(page.events.length, 2);
  assert.ok(decodeC(page.cursor).h[file.key] <= 3000, `the hint ${decodeC(page.cursor).h[file.key]} is not past the first undelivered line`);
  const all = collectEvents(stubOpts(fx, () => rows, { files: [file] }));
  assert.equal(decodeC(all.cursor).h[file.key], 4000, 'with nothing left, the last line is the first one inside the window');
  const kinds = collectEvents(stubOpts(fx, () => rows, { files: [file], limit: 1 }));
  assert.ok(decodeC(kinds.cursor).h[file.key] <= 2000);
});

test('cursor-s-restore: after an overflow page, once newT passes the floor + default slack a late row inside the default slack is delivered', () => {
  const fx = fresh();
  const list = [];
  for (let i = 0; i < 5000; i += 1) list.push(stubEvent(fx, padId(i), T0 + Math.floor(i / 5)));
  const opts = stubOpts(fx, () => list, { limit: 10000 });
  const overflow = collectEvents(opts);
  assert.equal(overflow.events.length, 5000);
  assert.ok(overflow.warnings.some((w) => w.code === 'window_overflow'));
  const c1 = decodeC(overflow.cursor);
  assert.ok(c1.s < 300000 && c1.w.length <= 1000, `s ${c1.s}, w ${c1.w.length}`);
  // quiet page far ahead: newT moves past f + the default slack, the default slack comes back
  const newT = T0 + 1000 + 400000;
  list.push(stubEvent(fx, 'later', newT));
  const quiet = collectEvents({ ...opts, since: overflow.cursor });
  assert.deepEqual(quiet.events.map((e) => e.id), ['cost.turn:later']);
  const c2 = decodeC(quiet.cursor);
  assert.equal(c2.s, 300000, 's is recomputed per page and never carried forward');
  assert.equal(c2.f, newT - 300000);
  assert.equal(quiet.warnings.some((w) => w.code === 'window_overflow'), false);
  // a late row 100 s behind the watermark, inside the default slack, is delivered once
  list.push(stubEvent(fx, 'late', newT - 100000));
  const lateRead = collectEvents({ ...opts, since: quiet.cursor });
  assert.deepEqual(lateRead.events.map((e) => e.id), ['cost.turn:late']);
  assert.deepEqual(collectEvents({ ...opts, since: lateRead.cursor }).events, []);
});

test('cursor-overflow-nodup: 1000 events at one instant then one a second later, then a quiet page: nothing at the instant is delivered twice', () => {
  const fx = fresh();
  const list = [];
  for (let i = 0; i < 1000; i += 1) list.push(stubEvent(fx, padId(i), T0));
  list.push(stubEvent(fx, 'zlast', T0 + 1000));
  const opts = stubOpts(fx, () => list, { limit: 10000 });
  const first = collectEvents(opts);
  assert.equal(first.events.length, 1001);
  assert.ok(first.warnings.some((w) => w.code === 'window_overflow'));
  const quiet = collectEvents({ ...opts, since: first.cursor });
  assert.deepEqual(quiet.events, [], 'no event at T is delivered twice');
  list.push(stubEvent(fx, 'zzz', T0 + 2000));
  const next = collectEvents({ ...opts, since: quiet.cursor });
  assert.deepEqual(next.events.map((e) => e.id), ['cost.turn:zzz']);
  const all = new Set([...first.events, ...next.events].map((e) => e.id));
  assert.equal(all.size, 1002);
});

test('cursor-group-e: (g)(s3) 1200 events at one ts in pages of 600: pages resume with e, no duplicate, no gap, and e outlives t moving on', () => {
  const fx = fresh();
  const list = [];
  for (let i = 0; i < 1200; i += 1) list.push(stubEvent(fx, padId(i), T0));
  const opts = stubOpts(fx, () => list);
  const pages = drain(opts, { limit: 600 });
  assert.equal(pages.length, 2);
  assert.deepEqual(idsOfPages(pages), list.map((e) => e.id));
  const c2 = decodeC(pages[1].cursor);
  assert.deepEqual(c2.e, [T0, `cost.turn:${padId(1199)}`], 'the group, too large for w, is carried as e');
  assert.equal(c2.w.length, 600, 'pairs at the group instant stay (a smaller-id late row at that ms must not resend the group)');
  assert.ok(pages[1].cursor.length <= 64 * 1024);
  assert.deepEqual(collectEvents({ ...opts, since: pages[1].cursor }).events, []);
  // t moves on to T+5 s: the group is still inside the floor, so e must still hide the ids w no longer holds
  list.push(stubEvent(fx, 'zafter', T0 + 5000));
  const after = collectEvents({ ...opts, since: pages[1].cursor });
  assert.deepEqual(after.events.map((e) => e.id), ['cost.turn:zafter'], 'no duplicate of the 1200');
  assert.deepEqual(decodeC(after.cursor).e, [T0, `cost.turn:${padId(1199)}`]);
  assert.deepEqual(collectEvents({ ...opts, since: after.cursor }).events, []);
  // pages of 350 over the same group
  const small = drain(stubOpts(fx, () => list.slice(0, 1200)), { limit: 350 });
  assert.deepEqual(idsOfPages(small), list.slice(0, 1200).map((e) => e.id));
});

test('cursor-overflow-5000: (viii) 5 000 events in one second: window_overflow, s shrinks, no duplicate, no gap, every cursor <= 64 KiB', () => {
  const fx = fresh();
  const list = [];
  for (let i = 0; i < 5000; i += 1) list.push(stubEvent(fx, padId(i), T0 + Math.floor(i / 5)));
  for (const limit of [700, 10000]) {
    const pages = drain(stubOpts(fx, () => list), { limit });
    assert.deepEqual(idsOfPages(pages), list.map((e) => e.id), `limit ${limit}`);
    assert.ok(pages.some((p) => p.warnings.some((w) => w.code === 'window_overflow')), 'the window overflowed');
    for (const page of pages) {
      assert.ok(page.cursor.length <= 64 * 1024);
      const c = decodeC(page.cursor);
      assert.ok(c.w.length <= 1000, `w ${c.w.length}`);
      if (page.warnings.some((w) => w.code === 'window_overflow')) assert.ok(c.s < 300000);
    }
  }
});

test('cursor-w-prune: (f) in a plain resume the per-id ts pruning keeps w under the cap and window_overflow never fires', () => {
  const fx = fresh();
  const list = [];
  for (let i = 0; i < 3000; i += 1) list.push(stubEvent(fx, padId(i), T0 + i * 1000));
  const pages = drain(stubOpts(fx, () => list), { limit: 100 });
  assert.deepEqual(idsOfPages(pages), list.map((e) => e.id));
  for (const page of pages) {
    assert.equal(page.warnings.some((w) => w.code === 'window_overflow'), false);
    const c = decodeC(page.cursor);
    assert.equal(c.s, 300000);
    assert.ok(c.w.length <= 302, `w ${c.w.length}: only the ids inside the slack are kept`);
  }
});

test('cursor-foreign-project-event: an event whose project_key is not this project\'s never reaches a page', () => {
  const fx = fresh();
  const alien = { ...stubEvent(fx, 'alien', T0), project_key: 'f'.repeat(16) };
  const page = collectEvents(stubOpts(fx, () => [stubEvent(fx, 'mine', T0 + 1), alien]));
  assert.deepEqual(page.events.map((e) => e.id), ['cost.turn:mine']);
  assert.ok(page.warnings.some((w) => w.source === 'merge' && w.code === 'schema_mismatch' && w.detail === 'project_key'));
});

test('cursor-reader-load-failure: a reader module that fails to load is that source\'s source_failed only', () => {
  const fx = fresh();
  const deps = stubDeps(fx, () => [stubEvent(fx, 'one', T0)]);
  const readers = deps.readers;
  delete deps.readers;
  deps.loadReader = (name) => { if (name === 'qc') throw new SyntaxError('cannot load'); return readers[name]; };
  const page = collectEvents({ cwd: fx.repoDir, env: {}, now: T0, deps });
  assert.deepEqual(page.events.map((e) => e.id), ['cost.turn:one']);
  assert.deepEqual(page.warnings.map((w) => `${w.source}:${w.code}:${w.detail}`), ['qc:source_failed:SyntaxError']);
  assert.deepEqual(page.sources.filter((s) => s.state === 'degraded').map((s) => s.name), ['qc']);
});

test('resume-duplicate-id-hint: a duplicate id dropped by the merge still pins its file\'s hint; removing the kept copy loses nothing with or without hints', () => {
  const fx = fresh();
  const headA = 'aaaaaaaaaaaa';
  const headB = 'bbbbbbbbbbbb';
  const fileOf = (head, f) => ({ key: `cost:${head}`, file: f, size: 100000, head, startOffset: 0, endOffset: 9000 });
  const src = (head, f, offset) => ({ source: 'cost', file: f, head, offset, end: offset + 99 });
  // the same ids in two files; file A lies first in reader order, so the merge keeps A's copies and drops B's
  const mk = (head, f) => [0, 1, 2, 3].map((i) => stubEvent(fx, padId(i), T0 + i * 1000000, src(head, f, 1000 * (i + 1))));
  let both = true;
  const events = () => (both ? [...mk(headA, '/f/a'), ...mk(headB, '/f/b')] : mk(headB, '/f/b'));
  const files = () => (both ? [fileOf(headA, '/f/a'), fileOf(headB, '/f/b')] : [fileOf(headB, '/f/b')]);
  const deps = stubDeps(fx, events);
  deps.readers.cost = { read: () => ({ events: events(), warnings: [], stats: { state: 'ok' }, files: files() }) };
  const opts = { cwd: fx.repoDir, env: {}, now: T0, deps };
  const first = collectEvents({ ...opts, limit: 2 });
  assert.equal(first.events.length, 2);
  const h = decodeC(first.cursor).h;
  assert.ok(h[`cost:${headB}`] !== undefined && h[`cost:${headB}`] <= 3000, `B's hint ${h[`cost:${headB}`]} stays before its undelivered line`);
  both = false; // file A (the kept copy) is gone
  const hinted = collectEvents({ ...opts, since: first.cursor, limit: 10 });
  const plain = collectEvents({ ...opts, since: dropHints(first.cursor), limit: 10 });
  assert.deepEqual(hinted.events.map((e) => e.id), [padId(2), padId(3)].map((k) => `cost.turn:${k}`));
  assert.deepEqual(hinted.events.map((e) => e.id), plain.events.map((e) => e.id));
});

test('resume-shared-head-zero-offset: two big files with one head share a hint key: the smallest offset, 0 included, wins', () => {
  const fx = fresh();
  const head = 'cccccccccccc';
  const f1 = { key: `cost:${head}`, file: '/f/one', size: 100000, head, startOffset: 0, endOffset: 9000 };
  const f2 = { key: `cost:${head}`, file: '/f/two', size: 90000, head, startOffset: 0, endOffset: 8000 };
  const mk = (f, offset, key, tsMs) => stubEvent(fx, key, tsMs, { source: 'cost', file: f, head, offset, end: offset + 9 });
  // file two holds an undelivered line at offset 0 (a different id, ts after the page), file one is read to its end
  const events = [mk('/f/one', 500, 'x1', T0), mk('/f/two', 0, 'x2', T0 + 2000000)];
  const page = collectEvents(stubOpts(fx, () => events, { files: [f1, f2], limit: 1 }));
  assert.deepEqual(page.events.map((e) => e.id), ['cost.turn:x1']);
  assert.equal(decodeC(page.cursor).h[`cost:${head}`], undefined, 'a 0 from either file means no hint for the shared key');
  const rest = collectEvents(stubOpts(fx, () => events, { files: [f1, f2], since: page.cursor }));
  assert.deepEqual(rest.events.map((e) => e.id), ['cost.turn:x2']);
});

// ---- bounded collection (collector.js): a small limit over a large source -----------------------------------------------

test('resume-bounded-pages: a small limit over many rows concatenates to the full read, with and without hints, has_more from displaced rows', () => {
  const fx = fresh();
  const lines = bigCostFile(fx); // 170 rows, over the hint threshold, one row per 400 s
  const expected = lines.map((line) => `cost.turn:${sha256hex(line).slice(0, 24)}#1`);
  const full = collectEvents(costOnlyOpts(fx, { limit: 10000 }));
  assert.deepEqual(full.events.map((e) => e.id), expected);
  const first = collectEvents(costOnlyOpts(fx, { limit: 3 }));
  assert.equal(first.events.length, 3);
  assert.equal(first.has_more, true, 'rows beyond the cap were displaced, not lost');
  for (const [limit, hints] of [[3, true], [3, false], [10, true], [64, true]]) {
    const pages = drain(costOnlyOpts(fx), { limit, hints });
    assert.deepEqual(idsOfPages(pages), expected, `limit ${limit}, hints ${hints}`);
  }
  // a byte-identical pair spread over pages: the ids stay #1, #2 whatever the page size
  const twin = lines[10];
  fs.appendFileSync(fx.paths.costsFile, `${twin}\n`);
  const fullTwin = collectEvents(costOnlyOpts(fx, { limit: 10000 })).events.map((e) => e.id);
  assert.equal(fullTwin.length, expected.length + 1);
  assert.deepEqual(idsOfPages(drain(costOnlyOpts(fx), { limit: 4 })).sort(), [...fullTwin].sort());
});

test('resume-bounded-window-rows: pages of 7 over 400 rows 3 s apart (a wide window of delivered ids) equal the full read', () => {
  const fx = fresh();
  const lines = [];
  for (let i = 0; i < 400; i += 1) lines.push(JSON.stringify({ ...JSON.parse(fx.cost.main), ts: isoOf(T0 + i * 3000), session: `s-w-${i}` }));
  fs.writeFileSync(fx.paths.costsFile, `${lines.join('\n')}\n`);
  const expected = lines.map((line) => `cost.turn:${sha256hex(line).slice(0, 24)}#1`);
  for (const hints of [true, false]) assert.deepEqual(idsOfPages(drain(costOnlyOpts(fx), { limit: 7, hints })), expected);
});

test('cursor-collector-bounds: the collector keeps the smallest cap events by (ts, id), counts what it displaced and notes their offsets', () => {
  const { createCollector } = require('../src/status/events/collector');
  const fx = fresh();
  const mkE = (key, tsMs, offset) => stubEvent(fx, key, tsMs, { source: 'cost', file: '/f/x', head: 'abcdef012345', offset, end: offset + 9 });
  const col = createCollector({ cap: 3, keep: (e) => e.id !== 'cost.turn:skip', sinceTs: T0 });
  for (const [k, ts, off] of [['d', 4, 400], ['b', 2, 200], ['a', 1, 100], ['c', 3, 300], ['e', 5, 500], ['b', 2, 250], ['skip', 2, 50]]) col.push(mkE(k, T0 + ts, off));
  const { events, bounded } = col.result();
  assert.deepEqual(events.map((e) => e.id), ['cost.turn:a', 'cost.turn:b', 'cost.turn:c']);
  assert.equal(bounded.displaced, 2);
  assert.deepEqual(bounded.displacedOffsets.map((o) => o.offset), [400], 'the smallest start offset among the displaced lines (d at 400, e at 500)');
  assert.deepEqual(bounded.rejectedOffsets.map((o) => o.offset), [50], 'a refused line and a repeated id are noted: the smaller offset wins');
  const plain = createCollector({});
  plain.push(mkE('z', T0, 1));
  plain.push(mkE('y', T0, 2));
  assert.deepEqual(plain.result().events.map((e) => e.id), ['cost.turn:y', 'cost.turn:z'], 'without keep and cap it is a sorted list');
});

// ---- the collector and repeated ids; hint slots ---------------------------------------------------------------------------

test('cursor-duplicate-id-real-reader: two manifests of one run_id give one event and a duplicate_id warning through the collector', () => {
  const fx = fresh();
  const text = fs.readFileSync(path.join(fx.paths.runsDir, 'fx-run-live.manifest.json'), 'utf8');
  fs.writeFileSync(path.join(fx.paths.runsDir, 'fx-run-live-copy.manifest.json'), text);
  const page = collectEvents(baseOpts(fx));
  assert.equal(page.events.filter((e) => e.id === 'dispatch.started:fx-run-live').length, 1);
  assert.deepEqual(page.warnings.filter((w) => w.code === 'duplicate_id').map((w) => `${w.source}:${w.count}`), ['merge:1']);
  assert.equal(page.events.length, goldenEvents(fx).length);
});

test('order-duplicate-id-keeps-earlier-ts: the copy with the smaller ts survives whatever the input order and page size', () => {
  const fx = fresh();
  const { createCollector } = require('../src/status/events/collector');
  const mk = (key, tsMs) => stubEvent(fx, key, tsMs);
  const run = (list, limit) => {
    const deps = stubDeps(fx, () => []);
    deps.readers.cost = { read: (ctx, window) => { const col = createCollector(window); for (const e of list()) col.push(e); return { ...col.result(), warnings: [], stats: { state: 'ok' }, files: [] }; } };
    return drain({ cwd: fx.repoDir, env: {}, now: T0, deps }, { limit });
  };
  const forward = () => [mk('a', T0), mk('x', T0 + 1000), mk('x', T0 + 5000), mk('z', T0 + 3000)];
  const reverse = () => [mk('x', T0 + 5000), mk('z', T0 + 3000), mk('x', T0 + 1000), mk('a', T0)];
  for (const limit of [1, 2, 10]) {
    for (const list of [forward, reverse]) {
      const pages = run(list, limit);
      assert.deepEqual(idsOfPages(pages), ['cost.turn:a', 'cost.turn:x', 'cost.turn:z'], `limit ${limit}`);
      const x = pages.flatMap((p) => p.events).find((e) => e.id === 'cost.turn:x');
      assert.equal(x.ts, isoOf(T0 + 1000), 'the earlier copy is kept');
    }
  }
  const warned = run(reverse, 10)[0].warnings.filter((w) => w.code === 'duplicate_id');
  assert.equal(warned.length, 1);
  assert.equal(warned[0].count, 1);
});

test('cursor-hints-zero-placeholder: a 0 hint does not take one of the 16 slots from a positive key', () => {
  const fx = fresh();
  const files = [];
  const events = [];
  for (let i = 0; i < 17; i += 1) {
    const head = i.toString(16).padStart(12, '0');
    files.push({ key: `cost:${head}`, file: `/f/${i}`, size: 200000 - i * 1000, head, startOffset: 0, endOffset: 5000 });
    events.push(stubEvent(fx, `z${i}`, T0 + i * 1000, { source: 'cost', file: `/f/${i}`, head, offset: i === 0 ? 0 : 100 + i, end: 200 }));
  }
  const h = decodeC(collectEvents(stubOpts(fx, () => events, { files })).cursor).h;
  assert.equal(h['cost:000000000000'], undefined, 'the file that must be read from 0 has no hint');
  assert.equal(Object.keys(h).length, 16, 'all 16 slots go to positive keys');
});
