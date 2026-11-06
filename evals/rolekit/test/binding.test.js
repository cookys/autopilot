'use strict';
// Round-2 review fixes: the scorer is bound to the stamped root and to the tested bytes, answer file read errors are infra,
// answer-controlled keys cannot reach Object.prototype, grading is bound to frozen tasks.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { ROOT, ROLES, tmp, rm, draftCopy, taskDir, runCheck, gitWorkdir } = require('./helpers.js');
const { artifactIdentity, testFiles } = require('../lib-identity.js');
const { REQUIRED_GRADERS, schedule, taskMapFrom } = require('../score-rolekit.js');

const man = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks/manifest.json'), 'utf8'));

// ---- 1: a stamped root is the only thing the scorer will use
function stampedCopy() {
  const d = draftCopy();
  const r = cp.spawnSync('node', [path.join(d, 'stamp-rolekit.js'), '--row', 'pilot', '--authorized-by', 'd-test'], { encoding: 'utf8', cwd: d });
  assert.strictEqual(r.status, 0, r.stderr);
  const prereg = JSON.parse(fs.readFileSync(path.join(d, 'prereg/pilot.json'), 'utf8'));
  const map = taskMapFrom(JSON.parse(fs.readFileSync(path.join(d, 'tasks/manifest.json'), 'utf8')));
  const out = tmp();
  const rows = schedule(prereg, map).map((k) => { const [arm, seat, role, task, rep] = k.split('|'); const first = task === map[role][0]; return { arm, seat, role, task, rep: +rep, pass: arm === 'A' || arm === 'C' ? (first ? 1 : 0) : 1, infra: false, parse_ok: true, kit_applied: true, cost_usd: 0.02 }; });
  const results = path.join(out, 'results.jsonl'); fs.writeFileSync(results, rows.map((x) => JSON.stringify(x)).join('\n'));
  const evidence = path.join(out, 'evidence.json');
  const writeEv = (over = {}) => fs.writeFileSync(evidence, JSON.stringify({ schema_version: 1, row: 'rolekit-pilot', artifact_sha256: artifactIdentity(d).sha256, unit_tests: { files: testFiles(d), tests: 80, pass: 80, fail: 0 }, negative_controls: { graders_red: REQUIRED_GRADERS }, sentinel_calls: 0, ...over }));
  writeEv();
  const score = (...extra) => { const r2 = cp.spawnSync('node', [path.join(d, 'score-rolekit.js'), '--row', 'pilot', '--results', results, '--evidence', evidence, ...extra], { encoding: 'utf8' }); return { rc: r2.status, out: r2.stdout ? JSON.parse(r2.stdout) : null, err: r2.stderr }; };
  return { d, out, score, writeEv, cleanup: () => { rm(d); rm(out); } };
}

test('score-rolekit: the CLI scores only a stamped root - an unstamped row, a fabricated task manifest, a changed grader or a tampered stamper are refused', () => {
  const unst = draftCopy();
  try { const r = cp.spawnSync('node', [path.join(unst, 'score-rolekit.js'), '--row', 'pilot', '--results', '/dev/null'], { encoding: 'utf8' }); assert.strictEqual(r.status, 2); assert.match(r.stderr, /not a valid stamped row/); } finally { rm(unst); }
  const s = stampedCopy();
  try {
    const ok = s.score(); assert.strictEqual(ok.rc, 0, ok.err); assert.strictEqual(ok.out.verdict, 'PILOT_OK', JSON.stringify(ok.out.failing_gates));
    // same number of tasks, invented ids: the frozen manifest no longer matches the stamp record
    const mp = path.join(s.d, 'tasks/manifest.json'); const keep = fs.readFileSync(mp);
    fs.writeFileSync(mp, keep.toString().replace(/"id": "kb-0(\d)"/g, '"id": "fake-$1"'));
    let r = s.score(); assert.strictEqual(r.rc, 2); assert.match(r.err, /tasks\/manifest\.json/);
    fs.writeFileSync(mp, keep); assert.strictEqual(s.score().rc, 0);
    // a different prereg is not an option, and an edited one is red
    r = s.score('--prereg', '/tmp/other.json'); assert.strictEqual(r.rc, 2); assert.match(r.err, /unknown option --prereg/);
    r = s.score('--tasks', '/tmp/other.json'); assert.strictEqual(r.rc, 2); assert.match(r.err, /unknown option --tasks/);
    const pp = path.join(s.d, 'prereg/pilot.json'); const pk = fs.readFileSync(pp); fs.writeFileSync(pp, pk.toString().replace('"infra_total_max": 0.1', '"infra_total_max": 0.9'));
    r = s.score(); assert.strictEqual(r.rc, 2); assert.match(r.err, /prereg\/pilot\.json/); fs.writeFileSync(pp, pk);
    // a changed grader: the stamp check is red
    const gp = path.join(s.d, 'checks/check-cell.js'); const gk = fs.readFileSync(gp); fs.appendFileSync(gp, '\n');
    r = s.score(); assert.strictEqual(r.rc, 2); assert.match(r.err, /checks\/check-cell\.js/); fs.writeFileSync(gp, gk);
    // a stamper that lies "ok" is caught by the scorer's own digest check of stamp-rolekit.js
    const sp = path.join(s.d, 'stamp-rolekit.js'); const sk = fs.readFileSync(sp); fs.writeFileSync(sp, 'process.exit(0);\n');
    r = s.score(); assert.strictEqual(r.rc, 2); assert.match(r.err, /stamp-rolekit\.js is not the frozen one/); fs.writeFileSync(sp, sk);
    assert.strictEqual(s.score().rc, 0);
  } finally { s.cleanup(); }
});

test('score-rolekit: duplicate task ids are refused before a schedule is built', () => {
  const m = man(); const dup = { tasks: [...m.tasks, m.tasks[0]] };
  assert.throws(() => taskMapFrom(dup), /duplicate task id/);
  assert.throws(() => taskMapFrom({ tasks: [{ role: 'planner', id: '' }] }), /malformed manifest task/);
  const pilot = JSON.parse(fs.readFileSync(path.join(ROOT, 'prereg/pilot.json'), 'utf8'));
  const map = taskMapFrom(m); const bad = { ...map, reviewer: [map.reviewer[0], map.reviewer[0], map.reviewer[1]] };
  assert.throws(() => schedule(pilot, bad), /duplicate task id/);
});

// ---- 4: evidence is bound to the bytes it was collected from
test('score-rolekit: G6 evidence is tied to the tree - editing a test or a grader after collection voids it; a partial run or a hand-typed identity does too', () => {
  const s = stampedCopy();
  try {
    assert.strictEqual(s.score().out.verdict, 'PILOT_OK');
    const t = path.join(s.d, 'test/kits.test.js'); const tk = fs.readFileSync(t);
    fs.appendFileSync(t, '\n// edited after the evidence was collected\n');
    let r = s.score(); assert.strictEqual(r.rc, 0, 'the stamped files are untouched, only a test changed');
    assert.strictEqual(r.out.verdict, 'PILOT_FIX'); assert.ok(r.out.failing_gates.includes('G6')); assert.match(r.out.why.G6.join(), /artifact_sha256 does not match/);
    s.writeEv(); assert.strictEqual(s.score().out.verdict, 'PILOT_OK', 'evidence re-collected on the edited tree is accepted');
    fs.writeFileSync(t, tk);
    r = s.score(); assert.ok(r.out.failing_gates.includes('G6'), 'old evidence no longer matches after the test is restored');
    s.writeEv();
    s.writeEv({ unit_tests: { files: ['kits.test.js'], tests: 5, pass: 5, fail: 0 } }); assert.match(s.score().out.why.G6.join(), /partial run/);
    s.writeEv({ artifact_sha256: 'e'.repeat(64) }); assert.ok(s.score().out.failing_gates.includes('G6'));
    const { artifact_sha256, ...noId } = JSON.parse(fs.readFileSync(path.join(s.out, 'evidence.json'), 'utf8')); void artifact_sha256;
    fs.writeFileSync(path.join(s.out, 'evidence.json'), JSON.stringify({ ...noId, head_sha: 'a'.repeat(40) })); assert.ok(s.score().out.failing_gates.includes('G6'));
  } finally { s.cleanup(); }
});

test('score-rolekit: the identity covers files, their content and their names; stamping files and symlinks behave as documented', () => {
  const d = tmp(); fs.cpSync(ROOT, d, { recursive: true });
  try {
    const a = artifactIdentity(d).sha256;
    fs.writeFileSync(path.join(d, 'prereg/FROZEN.json'), '{}'); fs.writeFileSync(path.join(d, 'prereg/receipt-pilot.json'), '{}');
    assert.strictEqual(artifactIdentity(d).sha256, a, 'stamp files are covered by the stamp check, not the identity');
    fs.writeFileSync(path.join(d, 'new.txt'), 'x'); assert.notStrictEqual(artifactIdentity(d).sha256, a, 'a new file');
    fs.rmSync(path.join(d, 'new.txt'));
    fs.renameSync(path.join(d, 'test/score.test.js'), path.join(d, 'test/score2.test.js')); assert.notStrictEqual(artifactIdentity(d).sha256, a, 'a rename');
    fs.renameSync(path.join(d, 'test/score2.test.js'), path.join(d, 'test/score.test.js')); assert.strictEqual(artifactIdentity(d).sha256, a);
    fs.symlinkSync('/etc/hostname', path.join(d, 'link')); assert.throws(() => artifactIdentity(d), /symlink/);
  } finally { rm(d); }
});

// ---- 2: answer file read errors are infra, a JSON syntax error is the model's miss
test('check-cell: an answer file that exists but cannot be read (a directory, no permission) is rc 2; invalid JSON is rc 1', () => {
  const d = tmp();
  try {
    const run = (answer) => cp.spawnSync('node', [path.join(ROOT, 'checks/check-cell.js'), '--role', 'reviewer', '--task-dir', taskDir('reviewer', 'kb-01'), '--answer', answer], { encoding: 'utf8' });
    const asDir = run(d); assert.strictEqual(asDir.status, 2); assert.match(asDir.stdout, /infra: answer file unreadable: EISDIR/);
    const f = path.join(d, 'a.json'); fs.writeFileSync(f, '{"verdict":'); assert.strictEqual(run(f).status, 1);
    fs.writeFileSync(f, '{"verdict":"FIX-THEN-SHIP","findings":[]}'); fs.chmodSync(f, 0);
    if (process.getuid && process.getuid() !== 0) { const r = run(f); assert.strictEqual(r.status, 2); assert.match(r.stdout, /EACCES/); }
    fs.chmodSync(f, 0o644); assert.strictEqual(run(f).status, 1, 'readable, valid, and a miss');
    assert.strictEqual(run(path.join(d, 'missing.json')).status, 2);
  } finally { rm(d); }
});

// ---- 3: answer-controlled keys never reach Object.prototype
test('check-cell: answer-controlled keys (constructor, __proto__, hasOwnProperty, toString, non-strings) are a miss, never an infra fault', () => {
  const keys = ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf'];
  for (const file of [...keys, { a: 1 }, ['x'], null, 5]) {
    const r = runCheck('reviewer', 'kb-01', { verdict: 'FIX-THEN-SHIP', findings: [{ severity: 'critical', file, line: 14, claim: 'the flock failure is silently dropped' }] });
    assert.strictEqual(r.rc, 1, `file=${JSON.stringify(file)}: ${r.out && r.out.detail}`);
  }
  for (const id of keys) {
    const plan = { summary: 's', risks: [{ risk: 'r', disposition: 'accepted' }], subtasks: [
      { id, goal: 'g', scope: ['lib/hooks.js', 'docs/h.md'], input: 'i', output: 'o', acceptance: ['bash run-tests.sh'], boundaries: 'b', depends_on: [id === 'constructor' ? 'toString' : 'constructor'] },
      { id: id === 'constructor' ? 'toString' : 'constructor', goal: 'g', scope: ['cli.js'], input: 'i', output: 'o', acceptance: ['bash run-tests.sh'], boundaries: 'b', depends_on: [id] }] };
    const r = runCheck('planner', 'd8-l-two-phase', plan); assert.strictEqual(r.rc, 1, `${id}: ${r.out && r.out.detail}`); assert.match(r.out.detail, /cycle/);
  }
  for (const q of keys) assert.strictEqual(runCheck('explorer', 't4-config-layer', { answers: [{ q, found: true, citations: [{ file: q, line: 1, quote: q }] }] }).rc, 1);
  const w = gitWorkdir('implementer', 't11-boundary-fix'); // a tracked file whose name is a prototype key
  try {
    fs.writeFileSync(path.join(w.dir, 'constructor'), 'x'); fs.writeFileSync(path.join(w.dir, '__proto__'), 'x'); w.git('add', '-A');
    const rootless = tmp(); fs.cpSync(taskDir('implementer', 't11-boundary-fix') + '/input', rootless, { recursive: true });
    fs.writeFileSync(path.join(rootless, 'constructor'), 'x'); fs.writeFileSync(path.join(rootless, '__proto__'), 'x');
    const g = (...a) => cp.execFileSync('git', ['-C', rootless, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: ['t', 'x.invalid'].join('@'), GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: ['t', 'x.invalid'].join('@') } });
    g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'b', '--no-verify');
    const ev = { status: 'done', files_changed: [], red_evidence: { command: 'x', exit_code: 1, summary: 's' }, green_evidence: { command: 'x', exit_code: 0, summary: 's' } };
    const r = runCheck('implementer', 't11-boundary-fix', ev, ['--workdir', rootless]); assert.strictEqual(r.rc, 1); assert.match(r.out.detail, /base commit is not the frozen input/);
    rm(rootless);
  } finally { rm(w.dir); }
});

// ---- scan: the task dir is bound too
test('check-cell: --task-dir must be a frozen task of that role under this root; a fabricated trivial task, another role, a symlink are rc 2', () => {
  const d = tmp();
  try {
    const fake = path.join(d, 'tasks', 'reviewer', 'kb-01'); fs.cpSync(taskDir('reviewer', 'kb-01'), fake, { recursive: true });
    fs.writeFileSync(path.join(fake, 'expected.json'), JSON.stringify({ groups: [['.'], ['.']], line_slack: 1000 }));
    const ans = path.join(d, 'a.json'); fs.writeFileSync(ans, JSON.stringify({ verdict: 'FIX-THEN-SHIP', findings: [{ severity: 'major', file: 'scripts/emit.sh', line: 13, claim: 'anything' }] }));
    const run = (role, dir) => cp.spawnSync('node', [path.join(ROOT, 'checks/check-cell.js'), '--role', role, '--task-dir', dir, '--answer', ans], { encoding: 'utf8' });
    assert.strictEqual(run('reviewer', fake).status, 2, 'outside the frozen tasks/');
    assert.strictEqual(run('planner', taskDir('reviewer', 'kb-01')).status, 2, 'wrong role');
    assert.strictEqual(run('reviewer', path.join(ROOT, 'tasks/reviewer')).status, 2, 'not a task dir');
    const link = path.join(d, 'link'); fs.symlinkSync(fake, link); assert.strictEqual(run('reviewer', link).status, 2, 'symlink to a fabricated task');
    assert.strictEqual(run('reviewer', taskDir('reviewer', 'kb-01')).status, 1, 'the frozen task is gradable (and this answer is a miss)');
  } finally { rm(d); }
});
