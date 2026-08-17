#!/usr/bin/env node
'use strict';

// va-eval-generator.test.js — P1 acceptance for the VA declared-plan suite
// (plan 2026-08-18-verification-author-suite-v3, FROZEN). Covers determinism,
// per-trial divergence, admission stability, the clause-inversion property
// test, red cases for every admission gate (twin non-deviation, solver over
// budget, leak scan), and the observable value algebra.

const assert = require('assert');
const g = require('../evals/va-eval-generator');

let assertions = 0;
function check(value, message) { assertions += 1; assert.ok(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.deepStrictEqual(actual, expected, message); }

const adminJson = (admin) => g.canonicalJson({
  trials: admin.trials.map((t) => ({
    id: t.trial_id,
    cases: t.cases.map((c) => ({ id: c.case_id, env: c.envelope, renderer: c.renderer_id })),
  })),
});

// ── determinism + divergence ─────────────────────────────────────────────────
{
  const a1 = g.generateAdministration('t-seed-a');
  const a2 = g.generateAdministration('t-seed-a');
  const b = g.generateAdministration('t-seed-b');
  equal(adminJson(a1), adminJson(a2), 'same admin seed => byte-identical administration');
  check(adminJson(a1) !== adminJson(b), 'different admin seed => different administration');
  equal(a1.trials.length, g.CORPUS.budget.trials_per_administration, 'trial count from corpus');
  equal(a1.trials[0].cases.length,
    g.CORPUS.families.length * g.CORPUS.budget.cases_per_family_per_trial,
    'case count from corpus');
  const t0 = new Set(a1.trials[0].cases.map((c) => c.case_id));
  const overlap = a1.trials[1].cases.filter((c) => t0.has(c.case_id));
  equal(overlap, [], 'per-trial seeds: trial 2 shares no case with trial 1');
  for (const trial of a1.trials) {
    for (const c of trial.cases) {
      check(c.solver_sequence.length <= g.CORPUS.budget.steps_per_case,
        `solver within constant budget (${c.family})`);
    }
  }
}

// ── admission stability sweep ────────────────────────────────────────────────
{
  for (let i = 0; i < 20; i += 1) g.generateAdministration(`t-sweep-${i}`);
  check(true, '20-seed admission sweep completes without aborts');
}

// ── payload-level derivation independence (G2-F3) ────────────────────────────
// The mutation only affects defect_source / defect_contract; the candidate-
// visible envelope must be a pure function of (contract, renderer). Verify by
// asserting the envelope never mentions any defect-only token (leak scan
// enforces this at generation; here we pin the independence property itself:
// two cases with identical contracts would have identical envelopes — proxy:
// the envelope is reconstructible from public parts only).
{
  const admin = g.generateAdministration('t-indep');
  for (const c of admin.trials[0].cases) {
    equal(g.buildEnvelope(c, c.renderer_id), c.envelope,
      `envelope reconstructs from contract+renderer alone (${c.family})`);
  }
}

// ── clause inversion property test (plan §3, G1-F1/F10) ─────────────────────
{
  const admin = g.generateAdministration('t-render');
  for (const trial of admin.trials) {
    for (const c of trial.cases) {
      for (const rendererId of g.CORPUS.renderers) {
        const lines = g.renderSpec(c, rendererId);
        check(lines.length >= 2, `at least domain+behavior clauses (${c.family})`);
        for (const line of lines) {
          const inverted = g.invertRendered(rendererId, line);
          check(inverted && inverted.id && inverted.core,
            `every rendered clause inverts (${rendererId}: ${line.slice(0, 40)})`);
        }
      }
      // The three renderers carry the SAME clause ids (surface parity).
      const ids = g.CORPUS.renderers.map((r) => g.renderSpec(c, r)
        .map((l) => g.invertRendered(r, l).id).join('|'));
      check(ids[0] === ids[1] && ids[1] === ids[2],
        'clause id sets are renderer-invariant');
    }
  }
}

// ── admission red cases ──────────────────────────────────────────────────────
{
  // Twin non-deviation: an identity mutation must abort admission.
  const original = g.FAMILIES['boundary-off-by-one'];
  try {
    g.FAMILIES['boundary-off-by-one'] = (vSeed) => {
      const spec = original(vSeed);
      return { ...spec, mutate: (body) => JSON.parse(JSON.stringify(body)) };
    };
    assert.throws(() => g.generateAdministration('t-red-identity'),
      g.AdmissionError, 'identity mutation aborts (defect ≡ clean)');
    assertions += 1;
  } finally {
    g.FAMILIES['boundary-off-by-one'] = original;
  }
}
{
  // Solver over budget: a bloated solver must abort admission.
  const original = g.FAMILIES['precision-contract'];
  try {
    g.FAMILIES['precision-contract'] = (vSeed) => {
      const spec = original(vSeed);
      const bloated = [];
      for (let i = 0; i < g.CORPUS.budget.steps_per_case + 5; i += 1) {
        bloated.push(spec.solverSteps[i % spec.solverSteps.length]);
      }
      return { ...spec, solverSteps: bloated };
    };
    assert.throws(() => g.generateAdministration('t-red-budget'),
      g.AdmissionError, 'over-budget solver aborts');
    assertions += 1;
  } finally {
    g.FAMILIES['precision-contract'] = original;
  }
}
{
  // Solver non-revealing: probes that avoid the defect surface must abort.
  const original = g.FAMILIES['boundary-off-by-one'];
  try {
    g.FAMILIES['boundary-off-by-one'] = (vSeed) => {
      const spec = original(vSeed);
      const domain = spec.contract.surface.functions[0].params[0].domain;
      return { ...spec, solverSteps: [[domain.min]] };
    };
    assert.throws(() => g.generateAdministration('t-red-reveal'),
      g.AdmissionError, 'non-revealing solver aborts');
    assertions += 1;
  } finally {
    g.FAMILIES['boundary-off-by-one'] = original;
  }
}
{
  // Leak scan red: an envelope carrying a family name must be rejected.
  const admin = g.generateAdministration('t-red-leak');
  const sabotaged = {
    trials: [{
      cases: [{
        ...admin.trials[0].cases[0],
        envelope: `${admin.trials[0].cases[0].envelope}boundary-off-by-one`,
      }],
    }],
  };
  const violations = g.leakScan(sabotaged);
  check(violations.length > 0, 'leak scan flags an oracle-vocabulary token in the envelope');
}

// ── observable value algebra ─────────────────────────────────────────────────
{
  const unsupported = [undefined, NaN, -0, () => {}];
  for (const v of unsupported) {
    const n = g.normalizeObserved({ kind: 'returns', value: v });
    equal(n.kind, 'unsupported', 'unsupported value normalizes');
    check(!g.observationsEqual(n, n), 'unsupported never matches anything, itself included');
  }
  const a = g.normalizeObserved({ kind: 'returns', value: { x: 1, y: [2, 3] } });
  const b = g.normalizeObserved({ kind: 'returns', value: { y: [2, 3], x: 1 } });
  check(g.observationsEqual(a, b), 'canonicalJson equality is key-order independent');
  const t1 = g.normalizeObserved({ kind: 'throws', name: 'RangeError', message_token: 'tok_1' });
  const t2 = g.normalizeObserved({ kind: 'throws', name: 'RangeError', message_token: 'tok_2' });
  check(!g.observationsEqual(t1, t2), 'throw identity includes the message token');
}

// ── dual-path independence: compiled twin vs oracle on a fresh sweep ─────────
{
  const admin = g.generateAdministration('t-dual');
  const c = admin.trials[0].cases.find((x) => x.family === 'state-residue');
  const addFn = c.contract.surface.functions[0].name;
  const resetFn = c.contract.surface.functions[1].name;
  const seq = [
    { fn: addFn, args: [3] }, { fn: addFn, args: [4] },
    { fn: resetFn, args: [] }, { fn: addFn, args: [5] },
  ];
  const oracle = g.oracleSequence(c.contract, seq);
  equal(JSON.parse(oracle[3].canonical), 5, 'clean oracle: reset really clears');
  const defectOracle = g.oracleSequence(c.defect_contract, seq);
  equal(JSON.parse(defectOracle[3].canonical), 12, 'defect oracle: reset leaks state');
}

// ── PLAN_CONTRACT single statement ───────────────────────────────────────────
{
  check(g.PLAN_CONTRACT.name === 'va-plan-contract-v1', 'plan contract is named');
  check(g.PLAN_CONTRACT.description.includes(String(g.CORPUS.budget.steps_per_case)),
    'plan contract states the constant budget');
}

process.stdout.write(`${assertions} assertions passed\n`);
