'use strict';
// Tests for scripts/check-events-contract.js (operator console A1 E4). Every case works on copies in a tempdir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const repoLayout = require('./lib/repo-layout');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(__dirname, 'check-events-contract.js');
const real = (key) => path.join(REPO, repoLayout.path(key));
const cleanup = [];
test.after(() => { for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true }); });

function copies() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-events-contract-test-'));
  cleanup.push(dir);
  const f = { doc: path.join(dir, 'doc.md'), schema: path.join(dir, 'schema.json'), baseline: path.join(dir, 'baseline.json') };
  fs.copyFileSync(real('events_contract_doc'), f.doc);
  fs.copyFileSync(real('events_schema'), f.schema);
  fs.copyFileSync(real('events_baseline'), f.baseline);
  return f;
}
function run(f) {
  const r = spawnSync(process.execPath, [SCRIPT, '--doc', f.doc, '--schema', f.schema, '--baseline', f.baseline], { encoding: 'utf8', cwd: REPO });
  return { status: r.status, err: r.stderr };
}
const edit = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));
const editJson = (file, fn) => { const j = JSON.parse(fs.readFileSync(file, 'utf8')); fn(j); fs.writeFileSync(file, JSON.stringify(j, null, 2)); };

test('positive: the repo doc, schema and baseline pass; default registry paths too', () => {
  const r = run(copies());
  assert.equal(r.status, 0, r.err);
  const d = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: REPO });
  assert.equal(d.status, 0, d.stderr);
});

test('usage error exits 2', () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8' }).status, 2);
});

test('red (i): deleting a kinds-table row exits 1 and names the kind', () => {
  const f = copies();
  edit(f.doc, (t) => t.split('\n').filter((l) => !l.startsWith('| `cost.turn` |')).join('\n'));
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.err, /\[schema-undocumented\].*cost\.turn/);
});

test('red (i): a schema data property absent from the doc exits 1 and names it', () => {
  const f = copies();
  editJson(f.schema, (s) => { s.$defs.data_qc_verdict.properties.undocumented_field = { type: 'string' }; });
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.err, /\[schema-undocumented\].*qc\.verdict\.data\.undocumented_field/);
});

test('red (ii): renaming a consumer-table field exits 1 and names it', () => {
  const f = copies();
  edit(f.doc, (t) => t.replace('`final_status`, `duration_s`)', '`final_status`, `duration_sec`)'));
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.err, /\[consumer-unknown\].*duration_sec/);
});

test('red (iii): a doc example that drifts from the fixture exits 1', () => {
  const f = copies();
  edit(f.doc, (t) => t.replace('"role": "implementer",\n    "runner": "codex"', '"role": "reviewer",\n    "runner": "codex"'));
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.err, /\[example-drift\]/);
});

test('red (iv): a missing doc path exits 1', () => {
  const f = copies();
  f.doc = path.join(path.dirname(f.doc), 'absent.md');
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.err, /\[path-unresolved\].*doc/);
});

test('red (v): retyping a field in schema and doc together fails the baseline check', () => {
  const f = copies();
  editJson(f.schema, (s) => { s.$defs.data_review_collected.properties.generation.type = 'string'; delete s.$defs.data_review_collected.properties.generation.minimum; });
  edit(f.doc, (t) => t.replace('"generation": 1,\n    "base"', '"generation": "1",\n    "base"'));
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.err, /\[baseline-regression\].*review\.collected\.generation changed type/);
});

test('red (v): removing a field, or making it nullable, fails; adding a field passes', () => {
  let f = copies();
  editJson(f.schema, (s) => { delete s.$defs.data_cost_turn.properties.tier; s.$defs.data_cost_turn.required = s.$defs.data_cost_turn.required.filter((x) => x !== 'tier'); });
  assert.match(run(f).err, /\[baseline-regression\].*cost\.turn\.tier is gone/);
  f = copies();
  editJson(f.schema, (s) => { s.$defs.data_cost_turn.properties.session.type = ['string', 'null']; });
  assert.match(run(f).err, /\[baseline-regression\].*cost\.turn\.session changed nullable/);
  f = copies();
  editJson(f.schema, (s) => { s.$defs.data_cost_turn.properties.extra_ok = { type: 'string' }; });
  edit(f.doc, (t) => t.replace(/(\| `cost\.turn` \|.*)(`agent_id\?`)/, '$1$2, `extra_ok?`'));
  const r = run(f);
  assert.equal(r.status, 0, r.err);
});

// A check that is deleted must turn its test red: run a copy of the checker with one class removed.
for (const [cls, needle] of [
  ['schema-undocumented', ' of checkSchemaDocumented(schema, doc)'],
  ['consumer-unknown', ' of checkConsumers(schema, doc)'],
  ['example-drift', ' of checkExamples(doc, schema)'],
  ['baseline-regression', ' of checkBaseline(schema, baseline)'],
]) {
  test(`negative control: removing the ${cls} check makes its red case pass wrongly`, () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.ok(src.includes(needle), needle);
    const mutated = src.replace(needle, ' of []');
    const f = copies();
    if (cls === 'schema-undocumented') editJson(f.schema, (s) => { s.$defs.data_qc_verdict.properties.zzz = { type: 'string' }; });
    if (cls === 'consumer-unknown') edit(f.doc, (t) => t.replace('`final_status`, `duration_s`)', '`final_status`, `duration_sec`)'));
    if (cls === 'example-drift') edit(f.doc, (t) => t.replace('"role": "implementer",\n    "runner": "codex"', '"role": "reviewer",\n    "runner": "codex"'));
    if (cls === 'baseline-regression') editJson(f.schema, (s) => { s.$defs.data_cost_turn.properties.session.type = 'integer'; });
    // Compile the mutated source as if it lived at the real path (so its relative requires resolve), then call main().
    const loader = `const M = require('module'); const p = require('path'); const f = ${JSON.stringify(SCRIPT)};
      const m = new M(f); m.filename = f; m.paths = M._nodeModulePaths(p.dirname(f)); m._compile(${JSON.stringify(mutated)}, f);
      process.exit(m.exports.main(process.argv.slice(1)));`;
    const r = spawnSync(process.execPath, ['-e', loader, '--', '--doc', f.doc, '--schema', f.schema, '--baseline', f.baseline], { encoding: 'utf8', cwd: REPO });
    const withCheck = run(f);
    assert.equal(withCheck.status, 1, `the real checker is red on the ${cls} case`);
    assert.equal(r.status, 0, `with the ${cls} check removed the case is wrongly green: ${r.stderr}`);
  });
}

// ---- round 1 fixes: A typo'd kind, B baseline regeneration, C schema-derived kinds ------------------------------------

function runMutated(replacements, args, mode) {
  let src = fs.readFileSync(SCRIPT, 'utf8');
  for (const [a, b] of replacements) { assert.ok(src.includes(a), `mutation anchor: ${a}`); src = src.replace(a, b); }
  const loader = `const M = require('module'); const p = require('path'); const f = ${JSON.stringify(SCRIPT)};
    const m = new M(f); m.filename = f; m.paths = M._nodeModulePaths(p.dirname(f)); m._compile(${JSON.stringify(src)}, f);
    process.exit(m.exports.main(process.argv.slice(1)));`;
  return spawnSync(process.execPath, ['-e', loader, '--', ...args], { encoding: 'utf8', cwd: REPO, input: '' });
}
const argsOf = (f) => ['--doc', f.doc, '--schema', f.schema, '--baseline', f.baseline];

const TYPO_CASES = [
  ['qc.verdit.verdict', 'consumer table cell with an unknown kind typo', (t) => t.replace('`qc.verdict.verdict`', '`qc.verdit.verdict`')],
  ['dispatch.endded', 'dispatch.endded.duration_s', (t) => t.replace('`dispatch.ended.duration_s`', '`dispatch.endded.duration_s`')],
  ['dispatch.startd', 'slash form with a typo', (t) => t.replace('`dispatch.started/ended`', '`dispatch.startd/ended`')],
];
const OLD_A = [["if (shaped && shaped[1].split('.')[0] !== 'data' && !FUTURE_KINDS.has(shaped[1])) {", 'if (false) {'], ["if (slash && !(KINDS.includes(slash[1]) && KINDS.includes(`${slash[1].split('.')[0]}.${slash[2]}`))) {", 'if (false) {']];
for (const [needle, label, fn] of TYPO_CASES) {
  test(`A: ${label} is a consumer-unknown gap (red); the old behaviour is green`, () => {
    const f = copies();
    edit(f.doc, fn);
    const r = run(f);
    assert.equal(r.status, 1, r.err);
    assert.match(r.err, new RegExp(`\\[consumer-unknown\\].*${needle.replace('.', '\\.')}`));
    const old = runMutated(OLD_A, argsOf(f));
    assert.doesNotMatch(old.stderr, new RegExp(needle.replace('.', '\\.')), `old behaviour does not name the typo: ${old.stderr}`);
  });
}

test('A: a listed future kind (quota.observed) is not a gap', () => {
  assert.equal(run(copies()).status, 0);
  assert.match(fs.readFileSync(real('events_contract_doc'), 'utf8'), /`quota\.observed`/);
});

test('B: --print-baseline refuses to print after a retype or removal; add-only prints', () => {
  const f = copies();
  editJson(f.schema, (s) => { s.$defs.data_cost_turn.properties.session.type = ['string', 'null']; });
  let r = spawnSync(process.execPath, [SCRIPT, '--print-baseline', '--schema', f.schema, '--baseline', f.baseline], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /refusing to print.*cost\.turn\.session changed nullable/);
  const g = copies();
  editJson(g.schema, (s) => { delete s.$defs.data_cost_turn.properties.tier; });
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--print-baseline', '--schema', g.schema, '--baseline', g.baseline], { encoding: 'utf8' }).status, 1);
  const h = copies();
  editJson(h.schema, (s) => { s.$defs.data_cost_turn.properties.extra_ok = { type: 'string' }; });
  r = spawnSync(process.execPath, [SCRIPT, '--print-baseline', '--schema', h.schema, '--baseline', h.baseline, '--doc', path.join(os.tmpdir(), 'no-such-doc.md')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).kinds['cost.turn'].extra_ok, 'the new field is in the printed baseline; a missing doc does not matter');
  // negative control: without the guard, the retype regenerates cleanly
  const old = runMutated([['if (fs.existsSync(baselineFile)) {\n      const existing', 'if (false) {\n      const existing']], ['--print-baseline', '--schema', f.schema, '--baseline', f.baseline]);
  assert.equal(old.status, 0, 'old behaviour (regeneration bypasses the baseline) is wrongly green');
});

test('B: a missing baseline section or a changed version key is a baseline-regression', () => {
  let f = copies();
  editJson(f.baseline, (b) => { delete b.error_object; });
  let r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.err, /\[baseline-regression\].*section error_object is missing/);
  f = copies();
  editJson(f.baseline, (b) => { b.baseline = 'autopilot.events.baseline/2'; });
  r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.err, /\[baseline-regression\].*version key/);
  f = copies();
  editJson(f.baseline, (b) => { delete b.kinds; });
  assert.equal(run(f).status, 1);
  // negative control: without the completeness assertions, deleting a section is green
  f = copies();
  editJson(f.baseline, (b) => { delete b.error_object; b.baseline = 'x'; });
  const old = runMutated([['for (const sec of BASELINE_SECTIONS) if', 'for (const sec of []) if'], ['if (baseline.baseline !== BASELINE_VERSION)', 'if (false)']], argsOf(f));
  assert.equal(old.status, 0, `old behaviour is wrongly green: ${old.stderr}`);
});

test('C: a new kind added to the schema with an undocumented property is red; the hard-coded list is green', () => {
  const f = copies();
  editJson(f.schema, (s) => {
    s.$defs.data_quota_observed = { type: 'object', additionalProperties: false, required: ['pct'], properties: { pct: { type: 'number' }, hidden_prop: { type: 'string' } } };
    s.$defs.event_quota_observed = JSON.parse(JSON.stringify(s.$defs.event_qc_verdict));
    s.$defs.event_quota_observed.properties.kind = { const: 'quota.observed' };
    s.$defs.event_quota_observed.properties.data = { $ref: '#/$defs/data_quota_observed' };
    s.$defs.event.oneOf.splice(8, 0, { $ref: '#/$defs/event_quota_observed' });
  });
  edit(f.doc, (t) => t.replace('\nNot exposed on purpose:', '\n| `quota.observed` | test row | `id` | `pct` |\n\nNot exposed on purpose:'));
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.err, /\[schema-undocumented\].*quota\.observed\.data\.hidden_prop/);
  const old = runMutated([['const km = kindMap(schema);\n  for (const kind of Object.keys(km)) {\n    const row', "const km = kindMap(schema);\n  for (const kind of ['dispatch.started', 'dispatch.ended', 'cost.turn', 'review.collected', 'review.finalized', 'qc.verdict', 'decision.row', 'run.stage']) {\n    const row"]], argsOf(f));
  assert.doesNotMatch(old.stderr, /schema-undocumented/, 'old behaviour (hard-coded kinds) does not see the new kind');
});

test('describe: enum or const containing null is nullable', () => {
  const { baselineOf } = require('./check-events-contract');
  const schema = JSON.parse(fs.readFileSync(real('events_schema'), 'utf8'));
  schema.$defs.data_cost_turn.properties.tier = { enum: ['a', null] };
  schema.$defs.data_cost_turn.properties.model = { const: null };
  const b = baselineOf(schema).kinds['cost.turn'];
  assert.deepEqual([b.tier.nullable, b.tier.type], [true, 'string']);
  assert.equal(b.model.nullable, true);
});
