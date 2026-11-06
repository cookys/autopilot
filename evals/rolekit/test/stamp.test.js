'use strict';
// Red cases for stamp-rolekit.js. Every mutation is applied to a COPY of the tree that was stamped there; the real
// drafts are never stamped. Each case shows red after the change and green again after it is undone (red -> green).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { ROOT, tmp, rm, draftCopy } = require('./helpers.js');

const AUTH = 'd-test0000';
function stamped(row = 'pilot') {
  const d = draftCopy();
  const run = (...a) => cp.spawnSync('node', [path.join(d, 'stamp-rolekit.js'), ...a], { encoding: 'utf8', cwd: d });
  const r = run('--row', row, '--authorized-by', AUTH);
  assert.strictEqual(r.status, 0, r.stderr);
  return { d, run, check: () => run('--row', row, '--check') };
}
const edit = (f, fn) => { const keep = fs.readFileSync(f); fs.writeFileSync(f, fn(keep.toString('utf8'))); return () => fs.writeFileSync(f, keep); };

test('the real pilot row is stamped (FROZEN.json + receipt, --check green) and the formal row is still unstamped', () => {
  const fz = JSON.parse(fs.readFileSync(path.join(ROOT, 'prereg/FROZEN.json'), 'utf8'));
  assert.ok(fz.rows.pilot && fz.rows.pilot.stamped === true); assert.ok(!fz.rows.formal, 'formal is not stamped');
  assert.ok(fs.existsSync(path.join(ROOT, 'prereg/receipt-pilot.json')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'prereg/receipt-formal.json')));
  const pilot = JSON.parse(fs.readFileSync(path.join(ROOT, 'prereg/pilot.json'), 'utf8'));
  assert.strictEqual(pilot.stamped, true); assert.match(pilot.status, /^stamped \d{4}-\d\d-\d\d$/);
  const r = cp.spawnSync('node', [path.join(ROOT, 'stamp-rolekit.js'), '--row', 'pilot', '--check'], { encoding: 'utf8', cwd: ROOT });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'prereg/formal.json'), 'utf8')).stamped, false);
});

test('(a) after stamping, changing a task file, a role card (kit and placebo) or a verdict file turns --check red and names the file', () => {
  const s = stamped();
  try {
    assert.strictEqual(s.check().status, 0, 'fresh stamp is green');
    const cases = [
      ['task prompt', 'tasks/reviewer/kb-01/prompt.md', (t) => `${t} `],
      ['task input', 'tasks/implementer/t11-boundary-fix/input/lib/pager.py', (t) => `${t}# x\n`],
      ['task expected', 'tasks/debugger/t4-config-layer/expected.json', (t) => t.replace('lib/config.js', 'lib/parser.js')],
      ['kit role card', 'kits/planner/role.md', (t) => `${t}x`],
      ['placebo role card', 'placebo/reviewer/role.md', (t) => `${t}x`],
      ['kit skill', 'kits/debugger/plugin/skills/debug/SKILL.md', (t) => `${t}x`],
      ['kit tools', 'kits/explorer/tools', (t) => `${t.trim()},Bash\n`],
      ['check', 'checks/check-cell.js', (t) => t.replace("pass: !!pass", "pass: true")],
      ['verdict script', 'score-rolekit.js', (t) => t.replace('e.harm = cmp', 'e.harm = false && cmp')],
      ['prereg verdict rule', 'prereg/pilot.json', (t) => t.replace('G1 infra: infra rows <= 10%', 'G1 infra: infra rows <= 90%')],
      ['vendored verifier grader', 'checks/vendor/va/va-eval-grader.js', (t) => `${t}\n`],
      ['cost model', 'cost-model.json', (t) => t.replace('0.0162', '0.0001')],
    ];
    for (const [name, rel, fn] of cases) {
      const undo = edit(path.join(s.d, rel), fn);
      const red = s.check();
      assert.strictEqual(red.status, 2, `${name}: must be red`);
      assert.ok(red.stderr.includes(rel), `${name}: message must name ${rel}, got: ${red.stderr}`);
      undo();
      assert.strictEqual(s.check().status, 0, `${name}: green again after undo`);
    }
    // a new file under a frozen directory and a deleted frozen file are also red and named
    fs.writeFileSync(path.join(s.d, 'tasks/reviewer/kb-01/extra.txt'), 'x');
    let r = s.check(); assert.strictEqual(r.status, 2); assert.ok(r.stderr.includes('tasks/reviewer/kb-01/extra.txt'));
    fs.rmSync(path.join(s.d, 'tasks/reviewer/kb-01/extra.txt'));
    const gone = path.join(s.d, 'placebo/explorer/role.md'); const keep = fs.readFileSync(gone); fs.rmSync(gone);
    r = s.check(); assert.strictEqual(r.status, 2); assert.ok(r.stderr.includes('placebo/explorer/role.md'));
    fs.writeFileSync(gone, keep); assert.strictEqual(s.check().status, 0);
  } finally { rm(s.d); }
});

test('(b) a second stamp is refused and FROZEN.json and the receipt stay byte-identical', () => {
  const s = stamped();
  try {
    const f = path.join(s.d, 'prereg/FROZEN.json'); const rc = path.join(s.d, 'prereg/receipt-pilot.json'); const pj = path.join(s.d, 'prereg/pilot.json');
    const before = [fs.readFileSync(f), fs.readFileSync(rc), fs.readFileSync(pj)];
    const r = s.run('--row', 'pilot', '--authorized-by', 'd-other');
    assert.strictEqual(r.status, 2); assert.match(r.stderr, /refusing to re-stamp/);
    assert.deepStrictEqual([fs.readFileSync(f), fs.readFileSync(rc), fs.readFileSync(pj)], before);
  } finally { rm(s.d); }
});

test('stamping without --authorized-by is refused and writes nothing; an unstamped row cannot pass --check', () => {
  const d = draftCopy();
  try {
    const run = (...a) => cp.spawnSync('node', [path.join(d, 'stamp-rolekit.js'), ...a], { encoding: 'utf8', cwd: d });
    assert.strictEqual(run('--row', 'pilot').status, 2);
    assert.strictEqual(run('--row', 'pilot', '--authorized-by', 'bad id with spaces').status, 2);
    assert.ok(!fs.existsSync(path.join(d, 'prereg/FROZEN.json')) && !fs.existsSync(path.join(d, 'prereg/receipt-pilot.json')));
    assert.strictEqual(run('--row', 'pilot', '--check').status, 2);
    fs.writeFileSync(path.join(d, 'placebo/planner/role.md'), 'short');
    const r = run('--row', 'pilot', '--authorized-by', AUTH);
    assert.strictEqual(r.status, 2); assert.match(r.stderr, /not within 5%/);
    assert.ok(!fs.existsSync(path.join(d, 'prereg/receipt-pilot.json')), 'a refused stamp writes no receipt');
  } finally { rm(d); }
});

test('(c) the receipt records time, prereg sha256, kit/placebo/tasks/checks digests and the authoriser; --check verifies each field', () => {
  const s = stamped();
  try {
    const rcPath = path.join(s.d, 'prereg/receipt-pilot.json');
    const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
    assert.strictEqual(rc.artifact_type, 'rolekit_stamp_receipt'); assert.strictEqual(rc.schema_version, 1);
    assert.strictEqual(rc.authorized_by, AUTH);
    assert.match(rc.stamped_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
    assert.strictEqual(rc.prereg_sha256, require('crypto').createHash('sha256').update(fs.readFileSync(path.join(s.d, 'prereg/pilot.json'))).digest('hex'));
    for (const g of ['kits', 'placebo', 'tasks', 'checks', 'verdict_code']) assert.match(rc.digests[g], /^[0-9a-f]{64}$/, g);
    const cases = [
      ['authorized_by blank', (j) => { j.authorized_by = ' '; }, /authorized_by/],
      ['authorized_by removed', (j) => { delete j.authorized_by; }, /authorized_by/],
      ['stamped_at garbage', (j) => { j.stamped_at = 'yesterday'; }, /stamped_at/],
      ['prereg sha changed', (j) => { j.prereg_sha256 = '0'.repeat(64); }, /prereg_sha256/],
      ['tasks digest changed', (j) => { j.digests.tasks = '0'.repeat(64); }, /digests\.tasks/],
      ['checks digest changed', (j) => { j.digests.checks = '0'.repeat(64); }, /digests\.checks/],
      ['kits digest removed', (j) => { delete j.digests.kits; }, /digests\.kits/],
      ['placebo digest changed', (j) => { j.digests.placebo = '1'.repeat(64); }, /digests\.placebo/],
      ['wrong row', (j) => { j.row = 'formal'; }, /\brow\b/],
      ['authorized_by swapped for another legal id', (j) => { j.authorized_by = 'd-someone-else'; }, /authorized_by/],
      ['stamped_at swapped for another legal time', (j) => { j.stamped_at = '2020-01-01T00:00:00.000Z'; }, /stamped_at/],
      ['schema_version changed', (j) => { j.schema_version = 2; }, /schema_version/],
      ['frozen_files changed', (j) => { j.frozen_files = 1; }, /frozen_files/],
      ['unknown field added', (j) => { j.note = 'x'; }, /unknown field/],
    ];
    for (const [name, mut, re] of cases) {
      const keep = fs.readFileSync(rcPath);
      const j = JSON.parse(keep); mut(j); fs.writeFileSync(rcPath, JSON.stringify(j));
      const r = s.check();
      assert.strictEqual(r.status, 2, name); assert.match(r.stderr, re, name);
      fs.writeFileSync(rcPath, keep); assert.strictEqual(s.check().status, 0, `${name}: green after restore`);
    }
    // the pinned metadata in FROZEN.json is compared too: changing it alone, to a legal value, is red
    const fp = path.join(s.d, 'prereg/FROZEN.json'); const fkeep = fs.readFileSync(fp);
    for (const [k, v] of [['authorized_by', 'd-other'], ['stamped_at', '2020-01-01T00:00:00.000Z'], ['receipt_sha256', '0'.repeat(64)], ['frozen_file_count', 3]]) {
      const j = JSON.parse(fkeep); j.rows.pilot[k] = v; fs.writeFileSync(fp, JSON.stringify(j));
      assert.strictEqual(s.check().status, 2, `FROZEN.${k}`);
      fs.writeFileSync(fp, fkeep); assert.strictEqual(s.check().status, 0);
    }
    fs.rmSync(rcPath);
    const r = s.check(); assert.strictEqual(r.status, 2); assert.match(r.stderr, /receipt missing/);
  } finally { rm(s.d); }
});
