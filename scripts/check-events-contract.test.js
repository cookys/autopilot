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
  ['example-drift', ' of checkExamples(doc)'],
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
