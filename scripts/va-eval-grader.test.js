#!/usr/bin/env node
'use strict';

// va-eval-grader.test.js — P2 acceptance: the deviant matrix rows that are
// grader-local (frozen plan §7), each pinning ONE deterministic taxonomy
// value, plus the two negative controls (twin invocation counting via the
// injected executor; delete-the-gate mutation control on a sandbox copy).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const g = require('../evals/va-eval-generator');
const grader = require('../evals/va-eval-grader');

let assertions = 0;
function check(value, message) { assertions += 1; assert.ok(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.deepStrictEqual(actual, expected, message); }

const admin = g.generateAdministration('grader-test-seed');
const trial = admin.trials[0];

// Perfect plan for a case: solver sequence with oracle-derived declarations.
function perfectPlan(caseData) {
  let state = g.initialState(caseData.contract);
  const steps = [];
  for (const s of caseData.solver_sequence) {
    const call = { export_path: [s.fn], args: s.args };
    const { result, state: next } = g.evaluateCall(caseData.contract, state, call);
    state = next;
    const normalized = g.normalizeObserved(result);
    const expected = normalized.kind === 'throws'
      ? { kind: 'throws', name: normalized.name, message_token: normalized.message_token }
      : { kind: 'returns', value: JSON.parse(normalized.canonical) };
    steps.push({ call, expected });
  }
  return { case_id: caseData.case_id, steps };
}

// ── perfect ⇒ qualified ─────────────────────────────────────────────────────
{
  const plans = admin.trials.map((t) => Object.fromEntries(
    t.cases.map((c) => [c.case_id, perfectPlan(c)]),
  ));
  const graded = grader.gradeAdministration(admin, plans);
  equal(graded.outcome, 'graded', 'perfect administration grades');
  equal(graded.qualified, true, 'perfect candidate qualifies');
  equal(graded.subjects,
    { declared_accuracy: true, sensitivity: true, robustness: true },
    'all three subjects pass');
}

// ── per-case deviants (one deterministic taxonomy value each) ────────────────
const sample = trial.cases.find((c) => c.family === 'boundary-off-by-one');
const stateCase = trial.cases.find((c) => c.family === 'state-residue');
{
  equal(grader.gradeCase(sample, null).outcome, 'malformed_plan', 'missing plan');
  equal(grader.gradeCase(sample, 'not an object').outcome, 'malformed_plan', 'non-object plan');
  equal(grader.gradeCase(sample, { case_id: 'wrong', steps: [] }).outcome,
    'malformed_plan', 'case_id mismatch');
  equal(grader.gradeCase(sample, { case_id: sample.case_id, steps: [] }).outcome,
    'malformed_plan', 'vacuous empty plan');
  const p = perfectPlan(sample);
  const over = {
    case_id: sample.case_id,
    steps: Array.from({ length: g.CORPUS.budget.steps_per_case + 1 }, () => p.steps[0]),
  };
  equal(grader.gradeCase(sample, over).outcome, 'budget_exceeded', 'spec-blind enumerator hits budget');
  const badExport = { case_id: sample.case_id, steps: [{ call: { export_path: ['nope'], args: [1] }, expected: { kind: 'returns', value: 1 } }] };
  equal(grader.gradeCase(sample, badExport).outcome, 'malformed_plan', 'surface-outside call');
  const fn = sample.contract.surface.functions[0];
  const outOfDomain = { case_id: sample.case_id, steps: [{ call: { export_path: [fn.name], args: [fn.params[0].domain.max + 100] }, expected: { kind: 'returns', value: 1 } }] };
  equal(grader.gradeCase(sample, outOfDomain).outcome, 'malformed_plan', 'out-of-domain args');
  const unsupported = { case_id: sample.case_id, steps: [{ call: perfectPlan(sample).steps[0].call, expected: { kind: 'returns', value: undefined } }] };
  equal(grader.gradeCase(sample, unsupported).outcome, 'malformed_plan', 'unsupported expected value');
}
{
  // over-strict / wrong declarations ⇒ declared_mismatch
  const p = perfectPlan(sample);
  p.steps[0].expected = { kind: 'throws', name: 'Error', message_token: 'nope' };
  equal(grader.gradeCase(sample, p).outcome, 'declared_mismatch', 'over-strict declaration');
}
{
  // defect-imitating declarations ⇒ declared_mismatch (declaration ≠ oracle)
  const p = perfectPlan(sample);
  const revealingIndex = p.steps.findIndex((step) => {
    const clean = grader.inProcessExecutor(sample.clean_source, [{ call: step.call }]);
    const defect = grader.inProcessExecutor(sample.defect_source, [{ call: step.call }]);
    return !g.observationsEqual(clean[0], defect[0]);
  });
  check(revealingIndex !== -1, 'sample case has a revealing solver step');
  const defectObs = grader.inProcessExecutor(
    sample.defect_source, [{ call: p.steps[revealingIndex].call }],
  )[0];
  p.steps[revealingIndex].expected = defectObs.kind === 'throws'
    ? { kind: 'throws', name: defectObs.name, message_token: defectObs.message_token }
    : { kind: 'returns', value: JSON.parse(defectObs.canonical) };
  equal(grader.gradeCase(sample, p).outcome, 'declared_mismatch',
    'declaring the DEFECT behavior fails declared accuracy');
}
{
  // happy-path-only ⇒ missed_defect (valid declarations, no revealing input)
  const fn = sample.contract.surface.functions[0];
  const hi = fn.body.if.r.v;
  const happyArg = fn.params[0].domain.min; // far side of the boundary
  check(happyArg < hi, 'happy arg avoids the boundary');
  const call = { export_path: [fn.name], args: [happyArg] };
  const { result } = g.evaluateCall(sample.contract, g.initialState(sample.contract), call);
  const n = g.normalizeObserved(result);
  const plan = {
    case_id: sample.case_id,
    steps: [{ call, expected: { kind: 'returns', value: JSON.parse(n.canonical) } }],
  };
  equal(grader.gradeCase(sample, plan).outcome, 'missed_defect', 'happy-path-only misses the defect');
}
{
  // stateful sequence: perfect plan on state-residue passes (ordered fold)
  equal(grader.gradeCase(stateCase, perfectPlan(stateCase)).outcome, 'pass',
    'ordered stateful plan passes end-to-end');
}

// ── infra / abort semantics ─────────────────────────────────────────────────
{
  const crash = () => { throw new grader.InfraError('sandbox launch failed'); };
  equal(grader.gradeCase(sample, perfectPlan(sample), crash).outcome, 'infra_fail',
    'runner InfraError classifies as infra_fail');
  const badShape = () => [];
  equal(grader.gradeCase(sample, perfectPlan(sample), badShape).outcome, 'infra_fail',
    'runner protocol shape violation is infra_fail');
  const plans = admin.trials.map((t) => Object.fromEntries(
    t.cases.map((c) => [c.case_id, perfectPlan(c)]),
  ));
  const graded = grader.gradeAdministration(admin, plans, crash);
  equal(graded.outcome, 'aborted', 'infra_fail aborts the administration');
  equal(graded.qualified, null, 'aborted administration has NO verdict');
  equal(graded.abort_class, 'infra_fail', 'abort class is carried');
}

// ── negative control (a): the injected executor observes real invocations ────
{
  let invocations = 0;
  const counting = (source, steps) => {
    invocations += steps.length;
    return grader.inProcessExecutor(source, steps);
  };
  grader.gradeCase(sample, perfectPlan(sample), counting);
  equal(invocations, perfectPlan(sample).steps.length * 2,
    'both twins actually execute every declared step');
}

// ── negative control (b): delete-the-gate mutation (discriminating deviant) ──
{
  const graderSource = fs.readFileSync(
    path.join(__dirname, '..', 'evals', 'va-eval-grader.js'), 'utf8',
  );
  const gateless = graderSource.replace(
    /if \(!revealed\) \{\n    return \{ case_id: caseData\.case_id, outcome: 'missed_defect', detail: null \};\n  \}/u,
    '',
  );
  assert.notStrictEqual(gateless, graderSource, 'the sensitivity gate was located and deleted');
  assertions += 1;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'va-gateless-'));
  fs.mkdirSync(path.join(tmp, 'evals'));
  fs.writeFileSync(path.join(tmp, 'evals', 'va-eval-grader.js'), gateless);
  // The sandbox copy resolves its generator import back to the real one.
  fs.writeFileSync(path.join(tmp, 'evals', 'va-eval-generator.js'),
    `module.exports = require(${JSON.stringify(path.join(__dirname, '..', 'evals', 'va-eval-generator.js'))});\n`);
  // eslint-disable-next-line global-require
  const gatelessGrader = require(path.join(tmp, 'evals', 'va-eval-grader.js'));
  // The HAPPY-PATH-ONLY deviant (missed_defect under the real gate) must now
  // slip through to pass — a discriminating flip; the perfect mock qualifies
  // under both graders and proves nothing (G2-F6).
  const fn = sample.contract.surface.functions[0];
  const call = { export_path: [fn.name], args: [fn.params[0].domain.min] };
  const { result } = g.evaluateCall(sample.contract, g.initialState(sample.contract), call);
  const plan = {
    case_id: sample.case_id,
    steps: [{ call, expected: { kind: 'returns', value: JSON.parse(g.normalizeObserved(result).canonical) } }],
  };
  equal(gatelessGrader.gradeCase(sample, plan).outcome, 'pass',
    'without the sensitivity gate the happy-path deviant passes — the gate is load-bearing');
  equal(grader.gradeCase(sample, plan).outcome, 'missed_defect',
    'with the real gate the same deviant fails — discriminating control');
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write(`${assertions} assertions passed\n`);
