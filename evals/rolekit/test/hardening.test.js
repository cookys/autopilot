'use strict';
// Round-1 review fixes (classes A-D): infra classification, vendored verifier dependencies, implementer harness pins,
// reviewer/debugger/planner grader holes, skill frontmatter, fixture consistency. Bad output must judge FAIL (rc 1);
// instrument problems must be rc 2.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { ROOT, ROLES, tmp, rm, taskDir, runCheck, gitWorkdir } = require('./helpers.js');
const { validateKit, frontmatterError } = require('../compile-kit.js');

const treeCopy = () => { const d = tmp(); fs.cpSync(ROOT, d, { recursive: true }); return d; };
const checkIn = (root, role, id, answer, extra = []) => {
  const f = path.join(root, '.answer.json'); fs.writeFileSync(f, JSON.stringify(answer));
  const r = cp.spawnSync('node', [path.join(root, 'checks/check-cell.js'), '--role', role, '--task-dir', path.join(root, 'tasks', role, id), '--answer', f, ...extra], { encoding: 'utf8' });
  return { rc: r.status, out: r.stdout ? JSON.parse(r.stdout.trim().split('\n').pop()) : null, err: r.stderr };
};

// ---- B: infra is rc 2, never rc 1
test('infra classification: a missing or unreadable task file is rc 2 for every role, not a miss', () => {
  const d = treeCopy();
  try {
    const cases = [['reviewer', 'kb-01', 'expected.json'], ['reviewer', 'kb-01', 'input/change.diff'], ['planner', 'd8-l-two-phase', 'expected.json'], ['debugger', 't4-config-layer', 'expected.json'],
      ['explorer', 't11-boundary-fix', 'expected.json'], ['verifier', 'va-state-residue', 'expected.json']];
    for (const [role, id, rel] of cases) {
      const p = path.join(d, 'tasks', role, id, rel); const keep = fs.readFileSync(p);
      const ok = checkIn(d, role, id, { findings: [], verdict: 'x', subtasks: [], risks: [], hypotheses: [], evidence: [], root_cause: {}, answers: [], steps: [], case_id: 'x' });
      assert.notStrictEqual(ok.rc, 2, `${role}/${id} is fine before the file is removed`);
      fs.rmSync(p);
      const r = checkIn(d, role, id, { findings: [], verdict: 'x', subtasks: [], risks: [], hypotheses: [], evidence: [], root_cause: {}, answers: [], steps: [], case_id: 'x' });
      assert.strictEqual(r.rc, 2, `${role}/${id} without ${rel}`); assert.match(r.out.detail, /^infra:/);
      fs.writeFileSync(p, keep);
    }
    // a corrupt expected.json and an invalid pattern in it are infra too (unclassified grader errors are wrapped as infra)
    const ep = path.join(d, 'tasks/debugger/t4-config-layer/expected.json'); const keep = fs.readFileSync(ep);
    fs.writeFileSync(ep, '{not json'); assert.strictEqual(checkIn(d, 'debugger', 't4-config-layer', { root_cause: {} }).rc, 2);
    fs.writeFileSync(ep, JSON.stringify({ ...JSON.parse(keep), claim_regex: '(' })); assert.strictEqual(checkIn(d, 'debugger', 't4-config-layer', { root_cause: { file: 'lib/config.js', line: 17, claim: 'x' }, hypotheses: [], evidence: [] }).rc, 2);
    fs.writeFileSync(ep, keep);
  } finally { rm(d); }
});

test('infra classification: garbage answers are a miss (rc 1), never an infra fault and never a crash', () => {
  const garbage = {
    reviewer: [{}, { verdict: 'FIX', findings: [null, 5, 'x', { severity: 'major' }] }, { verdict: 5, findings: {} }],
    planner: [{}, { subtasks: [null, 3, { id: 1 }], risks: 'x' }, { subtasks: [{ id: 'a', scope: 'lib', depends_on: 'a' }], risks: [null] }],
    verifier: [{}, { case_id: 1, steps: 'x' }, { steps: [null, 1, { call: 5 }] }],
    debugger: [{}, { evidence: [null], hypotheses: [null, { status: {} }], root_cause: 'x' }, { evidence: 'x', hypotheses: 'y', root_cause: [] }],
    explorer: [{}, { answers: [null, 1, { q: 'q1', found: true, citations: 'x' }] }, { answers: 'x' }],
  };
  for (const [role, id] of [['reviewer', 'kb-01'], ['planner', 'd8-l-two-phase'], ['verifier', 'va-state-residue'], ['debugger', 't4-config-layer'], ['explorer', 't4-config-layer']]) {
    for (const g of garbage[role]) { const r = runCheck(role, id, g); assert.strictEqual(r.rc, 1, `${role} ${JSON.stringify(g)} -> ${r.rc} ${r.err}`); }
  }
  const w = gitWorkdir('implementer', 't11-boundary-fix');
  try { for (const g of [{}, { status: 1, files_changed: 'x', red_evidence: [], green_evidence: null }]) assert.strictEqual(runCheck('implementer', 't11-boundary-fix', g, ['--workdir', w.dir]).rc, 1); } finally { rm(w.dir); }
});

// ---- A2: the verifier's executable dependencies are frozen inside checks/ and verified before they are loaded
test('vendored verifier dependencies: a grader that always passes, a changed generator or a missing file is rc 2 and the plan is not graded', () => {
  const d = treeCopy();
  try {
    const plan = { case_id: 'values_case_id_x', steps: [] }; // would be a miss (rc 1) with the real grader
    assert.strictEqual(checkIn(d, 'verifier', 'va-state-residue', plan).rc, 1, 'control: the real grader judges an empty plan a miss');
    const g = path.join(d, 'checks/vendor/va/va-eval-grader.js'); const keep = fs.readFileSync(g);
    fs.writeFileSync(g, `${keep}\nmodule.exports.gradeCase = () => ({ outcome: 'pass' });\n`);
    const r = checkIn(d, 'verifier', 'va-state-residue', plan);
    assert.strictEqual(r.rc, 2); assert.match(r.out.detail, /va-eval-grader\.js does not match its pinned sha256/);
    fs.writeFileSync(g, keep);
    const gen = path.join(d, 'checks/vendor/va/va-eval-generator.js'); const k2 = fs.readFileSync(gen);
    fs.writeFileSync(gen, `${k2} `); assert.strictEqual(checkIn(d, 'verifier', 'va-state-residue', plan).rc, 2);
    fs.rmSync(gen); assert.match(checkIn(d, 'verifier', 'va-state-residue', plan).out.detail, /missing/);
    fs.writeFileSync(gen, k2);
    assert.strictEqual(checkIn(d, 'verifier', 'va-state-residue', plan).rc, 1);
    assert.ok(!cp.spawnSync('node', [path.join(d, 'checks/check-cell.js'), '--help'], { encoding: 'utf8' }).stdout.includes('evals-dir'));
  } finally { rm(d); }
});

test('vendored verifier dependencies equal the git objects at base_sha, and VA_PINS match them', () => {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks/manifest.json'), 'utf8'));
  const top = cp.execFileSync('git', ['-C', ROOT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const r = cp.spawnSync('node', [path.join(ROOT, 'build-tasks.js'), '--repo', top, '--base', man.base_sha, '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

// ---- C1: implementer
test('implementer: an oracle.sh committed by the candidate, a committed protected edit, a rewritten base and destroyed history all fail; a committed real fix passes', () => {
  const ev = { status: 'done', files_changed: ['lib/pager.py'], red_evidence: { command: 'bash run-tests.sh', exit_code: 1, summary: 's' }, green_evidence: { command: 'bash run-tests.sh', exit_code: 0, summary: 's' } };
  const run = (w) => runCheck('implementer', 't11-boundary-fix', ev, ['--workdir', w.dir]);
  const commit = (w, msg) => { w.git('add', '-A'); w.git('commit', '-q', '-m', msg, '--no-verify'); };
  let w = gitWorkdir('implementer', 't11-boundary-fix');
  try {
    fs.writeFileSync(path.join(w.dir, 'oracle.sh'), '#!/bin/bash\nexit 0\n'); commit(w, 'fake oracle');
    const r = run(w); assert.strictEqual(r.rc, 1, 'bug unfixed: the harness oracle decides, not the candidate one'); assert.match(r.out.detail, /oracle rc=1/); assert.match(r.out.detail, /protected path changed: oracle\.sh/);
  } finally { rm(w.dir); }
  w = gitWorkdir('implementer', 't11-boundary-fix');
  try {
    fs.writeFileSync(path.join(w.dir, 'run-tests.sh'), '#!/bin/bash\nexit 0\n'); commit(w, 'weaken tests');
    const r = run(w); assert.strictEqual(r.rc, 1); assert.match(r.out.detail, /protected path changed: run-tests\.sh/);
  } finally { rm(w.dir); }
  w = gitWorkdir('implementer', 't11-boundary-fix');
  try { // history rewritten: a new root commit that already contains the "fixed" code
    const p = path.join(w.dir, 'lib/pager.py'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('items[start:end - 1]', 'items[start:end]'));
    fs.rmSync(path.join(w.dir, '.git'), { recursive: true }); const g = (...a) => cp.execFileSync('git', ['-C', w.dir, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: ['t', 'x.invalid'].join('@'), GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: ['t', 'x.invalid'].join('@') } });
    g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'new base', '--no-verify');
    const r = run(w); assert.strictEqual(r.rc, 1); assert.match(r.out.detail, /base commit is not the frozen input/);
  } finally { rm(w.dir); }
  w = gitWorkdir('implementer', 't11-boundary-fix');
  try { fs.rmSync(path.join(w.dir, '.git'), { recursive: true }); const r = run(w); assert.strictEqual(r.rc, 1); assert.match(r.out.detail, /history destroyed/); } finally { rm(w.dir); }
  w = gitWorkdir('implementer', 't11-boundary-fix');
  try {
    const p = path.join(w.dir, 'lib/pager.py'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('items[start:end - 1]', 'items[start:end]')); commit(w, 'fix');
    assert.strictEqual(run(w).rc, 0, 'a committed real fix passes');
  } finally { rm(w.dir); }
});

// ---- fixture consistency (D2): a reference fix must turn each implementer oracle green
test('implementer fixtures: the reference fix passes the oracle for t4 (after the recorded correction) and t1; the corrected prompt agrees with the golden file', () => {
  const ev = { status: 'done', files_changed: [], red_evidence: { command: 'x', exit_code: 1, summary: 's' }, green_evidence: { command: 'x', exit_code: 0, summary: 's' } };
  let w = gitWorkdir('implementer', 't4-config-layer');
  try {
    const p = path.join(w.dir, 'lib/config.js'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Object.assign({}, env, defaults, override)', 'Object.assign({}, defaults, override, env)'));
    const r = runCheck('implementer', 't4-config-layer', ev, ['--workdir', w.dir]); assert.strictEqual(r.rc, 0, JSON.stringify(r.out));
  } finally { rm(w.dir); }
  w = gitWorkdir('implementer', 't1-fix-with-decoy');
  try {
    const p = path.join(w.dir, 'lib/buggy.js'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace("result[part.split('=')[0]] = part.split('=')[1].trim();", 'result[part] = true;'));
    const r = runCheck('implementer', 't1-fix-with-decoy', ev, ['--workdir', w.dir]); assert.strictEqual(r.rc, 0, JSON.stringify(r.out));
  } finally { rm(w.dir); }
  const prompt = fs.readFileSync(path.join(taskDir('implementer', 't4-config-layer'), 'prompt.md'), 'utf8');
  const golden = fs.readFileSync(path.join(taskDir('implementer', 't4-config-layer'), 'input/data/golden.txt'), 'utf8').trim();
  assert.match(prompt, new RegExp(`output \`${golden}\``)); assert.doesNotMatch(prompt, /output `Port: 8080/);
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks/manifest.json'), 'utf8'));
  const c = man.tasks.find((t) => t.id === 't4-config-layer' && t.role === 'implementer').corrections;
  assert.strictEqual(c.length, 1); assert.match(c[0].reason, /55417455b/); assert.ok(c[0].from.includes('8080') && c[0].to.includes('3000'));
});

// ---- C2: reviewer predicates are bound to the defect
test('reviewer: a claim with the right keyword but the wrong point fails on every task; the real finding passes', () => {
  const R = (file, line, claim) => ({ verdict: 'FIX-THEN-SHIP', findings: [{ severity: 'major', file, line, claim }] });
  const f1 = 'scripts/emit.sh'; const f5 = 'scripts/check-node-report.sh';
  for (const claim of ['emit_event should be renamed to emit_record', 'flock timeout of ten seconds is a style choice', 'the flock call is nicely written', 'emit_event always returns 0']) assert.strictEqual(runCheck('reviewer', 'kb-01', R(f1, 14, claim)).rc, 1, claim);
  assert.strictEqual(runCheck('reviewer', 'kb-01', R(f1, 14, 'the flock failure is silently dropped, so emit_event returns 0 when the append fails')).rc, 0);
  assert.strictEqual(runCheck('reviewer', 'kb-01', R(f1, 40, 'the flock failure is silently dropped, so emit_event returns 0 when the append fails')).rc, 1, 'right claim, line far from any change');
  for (const claim of ['the -ge operator is used', 'rename line_count to total_lines', 'end is a good variable name']) assert.strictEqual(runCheck('reviewer', 'kb-05', R(f5, 123, claim)).rc, 1, claim);
  assert.strictEqual(runCheck('reviewer', 'kb-05', R(f5, 123, 'off-by-one: -ge rejects an end line equal to the line count, which is valid')).rc, 0);
  for (const claim of ['jq is used here', 'null is a keyword', 'consider quoting the variable']) assert.strictEqual(runCheck('reviewer', 'kb-09', R(f5, 82, claim)).rc, 1, claim);
  assert.strictEqual(runCheck('reviewer', 'kb-09', R(f5, 82, "dropping '// empty' makes jq return the literal null, which slips past the -n guard")).rc, 0);
});

// ---- C3: debugger
test('debugger: one confirmed plus one open hypothesis, evidence [null], empty evidence strings and a dangling evidence_ref all fail', () => {
  const base = { evidence: [{ cmd: 'bash run-tests.sh', observation: 'port 3000' }], hypotheses: [{ claim: 'parser', file: 'lib/parser.js', line: 4, status: 'refuted', evidence_ref: 0 }, { claim: 'order', file: 'lib/config.js', line: 17, status: 'confirmed', evidence_ref: 0 }], root_cause: { file: 'lib/config.js', line: 17, claim: 'Object.assign order puts env last of precedence' } };
  const mut = (f) => { const a = JSON.parse(JSON.stringify(base)); f(a); return runCheck('debugger', 't4-config-layer', a).rc; };
  assert.strictEqual(runCheck('debugger', 't4-config-layer', base).rc, 0);
  assert.strictEqual(mut((a) => { a.hypotheses[0].status = 'open'; }), 1);
  assert.strictEqual(mut((a) => { a.evidence = [null]; }), 1);
  assert.strictEqual(mut((a) => { a.evidence = [{ cmd: '', observation: '' }]; }), 1);
  assert.strictEqual(mut((a) => { a.evidence = []; }), 1);
  assert.strictEqual(mut((a) => { a.hypotheses[1].evidence_ref = 5; }), 1);
  assert.strictEqual(mut((a) => { delete a.hypotheses[1].evidence_ref; }), 1);
  assert.strictEqual(mut((a) => { a.hypotheses[0].status = 'confirmed'; }), 0, 'two confirmed is decided');
});

// ---- C4: planner
const P = (subs) => ({ summary: 's', risks: [{ risk: 'r', disposition: 'accepted', note: 'n' }], subtasks: subs.map((s) => ({ goal: 'g', input: 'i', output: 'o', acceptance: ['bash run-tests.sh'], boundaries: 'b', depends_on: [], ...s })) });
test('planner: a dependency chain that shares a file is ordered, not parallel; path spellings, ./ and .. cannot hide an overlap or leave the repo', () => {
  const chain = P([{ id: 'a', scope: ['lib/hooks.js', 'docs/h.md'] }, { id: 'b', scope: ['cli.js'], depends_on: ['a'] }, { id: 'c', scope: ['lib/hooks.js'], depends_on: ['b'] }]);
  assert.strictEqual(runCheck('planner', 'd8-l-two-phase', chain).rc, 0, 'A->B->C sharing a file between A and C is a sequence');
  const par = (x, y) => P([{ id: 'a', scope: [x, 'docs/h.md'] }, { id: 'b', scope: [y, 'cli.js'], depends_on: [] }, { id: 'c', scope: ['docs/x.md'], depends_on: ['a', 'b'] }]);
  for (const [x, y] of [['lib/hooks.js', './lib/hooks.js'], ['lib/hooks.js', 'lib/../lib/hooks.js'], ['lib/', 'lib/hooks.js'], ['lib/*.js', 'lib/hooks.js'], ['lib//hooks.js', 'lib/hooks.js']]) {
    const r = runCheck('planner', 'd8-l-two-phase', { ...par(x, y), subtasks: par(x, y).subtasks.map((s) => (s.id === 'b' ? { ...s, scope: [y] } : s)) });
    assert.strictEqual(r.rc, 1, `${x} vs ${y}`); assert.match(r.out.detail, /share scope/);
  }
  for (const bad of ['../outside.md', '/etc/passwd', 'lib/../../x.js', '']) {
    const r = runCheck('planner', 'd8-l-two-phase', P([{ id: 'a', scope: ['lib/hooks.js', 'docs/h.md', bad] }, { id: 'b', scope: ['cli.js'], depends_on: ['a'] }]));
    assert.strictEqual(r.rc, 1, bad); assert.match(r.out.detail, /not a repo-relative path/);
  }
  assert.strictEqual(runCheck('planner', 'd8-l-two-phase', P([{ id: 'a', scope: ['lib/hooks.js', 'docs/h.md'] }, { id: 'b', scope: ['cli.js'], depends_on: ['zz'] }])).rc, 1);
});

// ---- D1: skill frontmatter is valid YAML
test('skill frontmatter: every kit and placebo SKILL.md parses as strict YAML (PyYAML) and passes the in-repo validator; an unquoted ": " is rejected', () => {
  const files = [];
  for (const kind of ['kits', 'placebo']) for (const r of ROLES) { const s = path.join(ROOT, kind, r, 'plugin/skills'); if (fs.existsSync(s)) for (const n of fs.readdirSync(s)) files.push(path.join(s, n, 'SKILL.md')); }
  assert.strictEqual(files.length, 10);
  for (const f of files) {
    const py = cp.spawnSync('python3', ['-I', '-c', 'import sys,yaml\nt=open(sys.argv[1]).read().split("---\\n")\nd=yaml.safe_load(t[1])\nassert isinstance(d["name"],str) and isinstance(d["description"],str)', f], { encoding: 'utf8' });
    assert.strictEqual(py.status, 0, `${f}: ${py.stderr}`);
    assert.strictEqual(frontmatterError(fs.readFileSync(f, 'utf8')), null, f);
  }
  assert.match(frontmatterError('---\nname: a\ndescription: Use when: x\n---\nbody'), /needs quotes/);
  assert.match(frontmatterError('---\nname: a\ndescription: "unterminated\n---\n'), /bad double-quoted/);
  assert.match(frontmatterError('---\nname: a\n---\n'), /lacks description/);
  const d = tmp(); try {
    fs.cpSync(path.join(ROOT, 'kits/planner'), d, { recursive: true });
    const f = path.join(d, 'plugin/skills/plan-template/SKILL.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/description: ".*"/, 'description: Use when writing a plan: the structure'));
    assert.ok(validateKit(d).errors.some((e) => /plain scalar needs quotes/.test(e)));
  } finally { rm(d); }
});

test('skill provenance: a re-quoted copy keeps the source body byte for byte and says how it was changed', () => {
  for (const r of ['implementer', 'debugger', 'explorer']) {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'kits', r, 'sources.json'), 'utf8'));
    const src = cp.execFileSync('git', ['-C', ROOT, 'cat-file', 'blob', s.source_git_blob], { encoding: 'utf8' });
    const dir = path.join(ROOT, 'kits', r, 'plugin/skills'); const text = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0], 'SKILL.md'), 'utf8');
    const body = (t) => t.slice(/^---\n[\s\S]*?\n---\n/.exec(t)[0].length);
    assert.strictEqual(body(text), body(src), r);
    assert.match(s.transform, /verbatim|re-quoted/);
  }
});
