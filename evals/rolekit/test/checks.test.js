'use strict';
// Positive and negative controls for every machine check. No model, no binary other than node/git/bash/python3.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runCheck, gitWorkdir, taskDir, rm, VA } = require('./helpers.js');

test('reviewer: a matching critical finding that cites a diff line passes; wrong, uncited or SHIP-AS-IS fails', () => {
  const good = { verdict: 'FIX-THEN-SHIP', findings: [{ severity: 'critical', file: 'scripts/emit.sh', line: 14, claim: 'flock failure is silently dropped; emit_event always returns 0 even when the append fails' }] };
  assert.strictEqual(runCheck('reviewer', 'kb-01', good).rc, 0);
  const wrongLine = { ...good, findings: [{ ...good.findings[0], line: 400 }] };
  const r1 = runCheck('reviewer', 'kb-01', wrongLine);
  assert.strictEqual(r1.rc, 1); assert.match(r1.out.detail, /false_must_fix=1/);
  assert.strictEqual(runCheck('reviewer', 'kb-01', { ...good, verdict: 'SHIP-AS-IS' }).rc, 1);
  assert.strictEqual(runCheck('reviewer', 'kb-01', { verdict: 'FIX-THEN-SHIP', findings: [{ severity: 'minor', file: 'scripts/emit.sh', line: 14, claim: 'flock failure is silently dropped' }] }).rc, 1);
  assert.strictEqual(runCheck('reviewer', 'kb-01', { verdict: 'FIX-THEN-SHIP', findings: [{ severity: 'major', file: 'scripts/emit.sh', line: 14, claim: 'naming style is inconsistent' }] }).rc, 1);
});

test('answer file problems: not JSON and not an object fail as a miss; a missing file is infra (exit 2)', () => {
  assert.strictEqual(runCheck('reviewer', 'kb-01', 'this is prose').rc, 1);
  assert.strictEqual(runCheck('reviewer', 'kb-01', '[1,2]').rc, 1);
  const r = require('child_process').spawnSync('node', [path.join(__dirname, '../checks/check-cell.js'), '--role', 'reviewer', '--task-dir', taskDir('reviewer', 'kb-01'), '--answer', '/nonexistent/answer.json'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
});

test('implementer: the real fix with red/green evidence passes; the unfixed tree, missing evidence and a protected edit fail; no workdir is infra', () => {
  const ev = { status: 'done', files_changed: ['lib/pager.py'], red_evidence: { command: 'bash run-tests.sh', exit_code: 1, summary: 'page 2 wrong' }, green_evidence: { command: 'bash run-tests.sh', exit_code: 0, summary: 'ok' } };
  const w = gitWorkdir('implementer', 't11-boundary-fix');
  try {
    assert.strictEqual(runCheck('implementer', 't11-boundary-fix', ev, ['--workdir', w.dir]).rc, 1, 'unfixed tree must be red');
    const p = path.join(w.dir, 'lib/pager.py');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('return items[start:end - 1]', 'return items[start:end]'));
    assert.strictEqual(runCheck('implementer', 't11-boundary-fix', ev, ['--workdir', w.dir]).rc, 0, 'fixed tree must be green');
    assert.strictEqual(runCheck('implementer', 't11-boundary-fix', { ...ev, red_evidence: { ...ev.red_evidence, exit_code: 0 } }, ['--workdir', w.dir]).rc, 1, 'a red run that exits 0 is not red evidence');
    fs.appendFileSync(path.join(w.dir, 'run-tests.sh'), '\n# edited\n');
    const r = runCheck('implementer', 't11-boundary-fix', ev, ['--workdir', w.dir]);
    assert.strictEqual(r.rc, 1); assert.match(r.out.detail, /run-tests\.sh/);
  } finally { rm(w.dir); }
  assert.strictEqual(runCheck('implementer', 't11-boundary-fix', ev).rc, 2);
});

test('implementer t1 and t4: the untouched repositories are red under their own oracle', () => {
  for (const id of ['t4-config-layer', 't1-fix-with-decoy']) {
    const w = gitWorkdir('implementer', id);
    try {
      const ev = { status: 'done', files_changed: [], red_evidence: { command: 'x', exit_code: 1, summary: 's' }, green_evidence: { command: 'x', exit_code: 0, summary: 's' } };
      assert.strictEqual(runCheck('implementer', id, ev, ['--workdir', w.dir]).rc, 1, id);
    } finally { rm(w.dir); }
  }
});

test('verifier: a plan derived from the contract passes; a wrong declaration, a trivial plan and a bad shape fail', () => {
  const gen = require(path.join(VA, 'va-eval-generator.js'));
  for (const id of ['va-boundary-off-by-one', 'va-error-path-swallow', 'va-state-residue']) {
    const exp = JSON.parse(fs.readFileSync(path.join(taskDir('verifier', id), 'expected.json'), 'utf8'));
    const c = gen.generateAdministration(exp.seed).trials[exp.trial].cases.find((x) => x.case_id === exp.case_id);
    let state = gen.initialState(c.contract);
    const steps = c.solver_sequence.map((s) => {
      const call = { export_path: [s.fn], args: s.args };
      const { result, state: next } = gen.evaluateCall(c.contract, state, call);
      state = next;
      return { call, expected: result };
    });
    const plan = { case_id: c.case_id, steps };
    assert.strictEqual(runCheck('verifier', id, plan).rc, 0, `${id} derived plan`);
    const wrong = JSON.parse(JSON.stringify(plan));
    wrong.steps[0].expected = wrong.steps[0].expected.kind === 'returns' ? { kind: 'returns', value: 987654 } : { kind: 'returns', value: 1 };
    assert.strictEqual(runCheck('verifier', id, wrong).rc, 1, `${id} wrong declaration`);
    assert.strictEqual(runCheck('verifier', id, { case_id: c.case_id, steps: [] }).rc, 1, `${id} empty plan`);
    assert.strictEqual(runCheck('verifier', id, { case_id: 'other', steps }).rc, 1, `${id} case id mismatch`);
  }
});

const sub = (id, scope, extra = {}) => ({ id, goal: 'g', scope, input: 'i', output: 'o', acceptance: ['bash run-tests.sh'], boundaries: 'b', depends_on: [], ...extra });
const risks = [{ risk: 'r', disposition: 'accepted', note: 'n' }];

test('planner: a complete disjoint plan passes; each broken property fails', () => {
  const plan = { summary: 's', subtasks: [sub('a', ['lib/hooks.js']), sub('b', ['cli.js'], { depends_on: ['a'] }), sub('c', ['docs/hooks.md'], { depends_on: ['a'] })], risks };
  assert.strictEqual(runCheck('planner', 'd8-l-two-phase', plan).rc, 0);
  const bad = (mut) => { const p = JSON.parse(JSON.stringify(plan)); mut(p); return runCheck('planner', 'd8-l-two-phase', p); };
  assert.match(bad((p) => { p.subtasks[0].boundaries = ''; }).out.detail, /boundaries empty/);
  assert.match(bad((p) => { p.subtasks[0].acceptance = ['it works']; }).out.detail, /runnable acceptance/);
  assert.match(bad((p) => { p.subtasks[2].scope = ['lib/hooks.js']; p.subtasks[2].depends_on = []; p.subtasks[1].depends_on = ['a']; }).out.detail, /share scope/);
  assert.match(bad((p) => { p.subtasks.forEach((s) => { s.depends_on = []; }); }).out.detail, /no dependency edge/);
  assert.match(bad((p) => { p.subtasks[2].scope = ['nowhere/x.md']; }).out.detail, /not under the repo/);
  assert.match(bad((p) => { p.subtasks = p.subtasks.slice(0, 2); }).out.detail, /uncovered: docs\//);
  assert.match(bad((p) => { p.subtasks[0].depends_on = ['b']; }).out.detail, /cycle/);
  assert.match(bad((p) => { p.risks = []; }).out.detail, /risks/);
  assert.strictEqual(runCheck('planner', 'd8-l-two-phase', { summary: 's', subtasks: [], risks }).rc, 1);
});

test('debugger: the planted cause passes; the decoy file, a wrong line, one hypothesis and an edited repo fail', () => {
  const ans = { evidence: [{ cmd: 'bash run-tests.sh', observation: 'port 3000' }], hypotheses: [{ claim: 'parser drops values', file: 'lib/parser.js', line: 4, status: 'refuted', evidence_ref: 0 }, { claim: 'env has the lowest precedence in Object.assign', file: 'lib/config.js', line: 17, status: 'confirmed', evidence_ref: 0 }], root_cause: { file: 'lib/config.js', line: 17, claim: 'Object.assign order gives override the top and env the lowest precedence' } };
  const id = 't4-config-layer';
  const w = gitWorkdir('debugger', id);
  try {
    assert.strictEqual(runCheck('debugger', id, ans, ['--workdir', w.dir]).rc, 0);
    const mut = (f) => { const a = JSON.parse(JSON.stringify(ans)); f(a); return runCheck('debugger', id, a, ['--workdir', w.dir]); };
    const decoy = mut((a) => { a.root_cause = { file: 'lib/parser.js', line: 4, claim: 'parser precedence' }; });
    assert.strictEqual(decoy.rc, 1); assert.match(decoy.out.detail, /decoy_blamed=true/);
    assert.strictEqual(mut((a) => { a.root_cause.line = 99; }).rc, 1);
    assert.strictEqual(mut((a) => { a.hypotheses = a.hypotheses.slice(1); }).rc, 1);
    assert.strictEqual(mut((a) => { a.hypotheses.forEach((h) => { h.status = 'open'; }); }).rc, 1);
    fs.appendFileSync(path.join(w.dir, 'lib/config.js'), '\n// fixed it\n');
    const edited = runCheck('debugger', id, ans, ['--workdir', w.dir]);
    assert.strictEqual(edited.rc, 1); assert.match(edited.out.detail, /repo_clean=false/);
  } finally { rm(w.dir); }
});

test('explorer: real citations and an honest not-found pass; a fabricated line, a wrong quote and a citation on an absent thing fail', () => {
  const id = 't15-cache-invalidation';
  const ans = { answers: [
    { q: 'q1', found: true, citations: [{ file: 'keys.py', line: 8, quote: 'return (record["id"],)' }] },
    { q: 'q2', found: true, citations: [{ file: 'store.py', line: 17, quote: 'self._cache = {}' }] },
    { q: 'q3', found: false, citations: [] }] };
  assert.strictEqual(runCheck('explorer', id, ans).rc, 0);
  const mut = (f) => { const a = JSON.parse(JSON.stringify(ans)); f(a); return runCheck('explorer', id, a); };
  assert.strictEqual(mut((a) => { a.answers[0].citations[0].line = 3; }).rc, 1);
  assert.strictEqual(mut((a) => { a.answers[0].citations[0].quote = 'return record'; }).rc, 1);
  assert.strictEqual(mut((a) => { a.answers[2] = { q: 'q3', found: true, citations: [{ file: 'store.py', line: 17, quote: 'self._cache = {}' }] }; }).rc, 1);
  assert.strictEqual(mut((a) => { a.answers[0].citations[0].file = '../../../etc/passwd'; }).rc, 1);
  const partial = mut((a) => { a.answers.pop(); });
  assert.strictEqual(partial.rc, 1); assert.ok(Math.abs(partial.out.score - 2 / 3) < 1e-9);
});
