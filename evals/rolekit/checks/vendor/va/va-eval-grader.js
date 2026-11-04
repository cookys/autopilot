#!/usr/bin/env node
'use strict';

// va-eval-grader — deterministic offline grader for the VA declared-plan suite
// (plan 2026-08-18-verification-author-suite-v3, FROZEN §2/§5). Grading is a
// pure function of (case, parsed plan, twin observations); twin execution is
// INJECTED (the administration uses the sandboxed runner in engine-qualify;
// tests and admission use an in-process executor) so the classification logic
// itself never depends on transport.
//
// Outcome taxonomy + total precedence come from the corpus
// (plan §5, G2-F1/F2): abort classes (infra_fail, transport_fail) >
// malformed_plan > budget_exceeded > declared_mismatch > missed_defect > pass.
// Candidate exit codes do not exist in this design.

const {
  CORPUS,
  evaluateCall,
  initialState,
  normalizeObserved,
  observationsEqual,
} = require('./va-eval-generator');

class InfraError extends Error {}

// ── plan validation (malformed_plan / budget_exceeded) ───────────────────────

function normalizeDeclared(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return null;
  if (expected.kind === 'returns') {
    if (!('value' in expected)) return null;
    return normalizeObserved({ kind: 'returns', value: expected.value });
  }
  if (expected.kind === 'throws') {
    if (typeof expected.name !== 'string' || typeof expected.message_token !== 'string') return null;
    return normalizeObserved({
      kind: 'throws', name: expected.name, message_token: expected.message_token,
    });
  }
  return null;
}

function argInDomain(value, domain) {
  if (domain.type === 'int') {
    return Number.isSafeInteger(value) && value >= domain.min && value <= domain.max;
  }
  return domain.values.some((v) => JSON.stringify(v) === JSON.stringify(value));
}

// Returns { steps } (validated) or { outcome: 'malformed_plan'|'budget_exceeded',
// detail }.
function jsonDepth(value, depth = 0) {
  if (depth > CORPUS.budget.plan_max_json_depth) return depth;
  if (Array.isArray(value)) {
    return value.reduce((m, v) => Math.max(m, jsonDepth(v, depth + 1)), depth + 1);
  }
  if (value && typeof value === 'object') {
    return Object.values(value)
      .reduce((m, v) => Math.max(m, jsonDepth(v, depth + 1)), depth + 1);
  }
  return depth;
}

function validatePlan(caseData, plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { outcome: 'malformed_plan', detail: 'plan is not an object' };
  }
  if (plan.case_id !== caseData.case_id) {
    return { outcome: 'malformed_plan', detail: 'case_id mismatch' };
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { outcome: 'malformed_plan', detail: 'steps missing or empty' };
  }
  if (jsonDepth(plan) > CORPUS.budget.plan_max_json_depth) {
    return { outcome: 'malformed_plan', detail: 'json depth exceeds the cap' };
  }
  // Shape violations outrank budget (taxonomy precedence, review 2026-08-18:
  // malformed_plan > budget_exceeded when both signals are present) — validate
  // every step FIRST, then apply the budget to a well-formed plan.
  const overBudget = plan.steps.length > CORPUS.budget.steps_per_case
    ? { outcome: 'budget_exceeded', detail: `${plan.steps.length} steps` }
    : null;
  const surface = caseData.contract.surface.functions;
  const steps = [];
  for (const [index, step] of plan.steps.entries()) {
    if (!step || typeof step !== 'object' || Array.isArray(step)
        || !step.call || typeof step.call !== 'object') {
      return { outcome: 'malformed_plan', detail: `step ${index}: bad shape` };
    }
    const { call } = step;
    if (!Array.isArray(call.export_path) || call.export_path.length !== 1) {
      return { outcome: 'malformed_plan', detail: `step ${index}: bad export_path` };
    }
    const fn = surface.find((f) => f.name === call.export_path[0]);
    if (!fn) {
      return { outcome: 'malformed_plan', detail: `step ${index}: unknown export` };
    }
    if (!Array.isArray(call.args) || call.args.length !== fn.params.length) {
      return { outcome: 'malformed_plan', detail: `step ${index}: arity` };
    }
    for (const [i, arg] of call.args.entries()) {
      if (!argInDomain(arg, fn.params[i].domain)) {
        return { outcome: 'malformed_plan', detail: `step ${index}: arg ${i} outside domain` };
      }
    }
    const declared = normalizeDeclared(step.expected);
    if (!declared || declared.kind === 'unsupported') {
      return { outcome: 'malformed_plan', detail: `step ${index}: bad expected` };
    }
    steps.push({ call, declared });
  }
  if (overBudget) return overBudget;
  return { steps };
}

// ── in-process twin executor (tests + admission; the administration injects
//    the sandboxed runner instead) ────────────────────────────────────────────

function inProcessExecutor(source, sequence) {
  const moduleObj = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', source)(moduleObj, moduleObj.exports);
  return sequence.map((step) => {
    try {
      const fn = moduleObj.exports[step.call.export_path[0]];
      const value = fn(...step.call.args);
      return normalizeObserved({ kind: 'returns', value });
    } catch (error) {
      return normalizeObserved({
        kind: 'throws', name: error.name, message_token: error.message,
      });
    }
  });
}

// ── per-case grading ─────────────────────────────────────────────────────────
// executeTwin(source, validatedSteps) -> observations[] (throws InfraError on
// runner/transport-level failure).

function gradeCase(caseData, plan, executeTwin = inProcessExecutor) {
  const validated = validatePlan(caseData, plan);
  if (validated.outcome) {
    return { case_id: caseData.case_id, outcome: validated.outcome, detail: validated.detail };
  }
  const { steps } = validated;

  let observedClean;
  let observedDefect;
  try {
    observedClean = executeTwin(caseData.clean_source, steps);
    observedDefect = executeTwin(caseData.defect_source, steps);
  } catch (error) {
    if (error instanceof InfraError) {
      return { case_id: caseData.case_id, outcome: 'infra_fail', detail: error.message };
    }
    throw error;
  }
  if (!Array.isArray(observedClean) || observedClean.length !== steps.length
      || !Array.isArray(observedDefect) || observedDefect.length !== steps.length) {
    return { case_id: caseData.case_id, outcome: 'infra_fail', detail: 'runner protocol shape' };
  }

  // declared_accuracy: three-way agreement per step (G2-F0) — declaration ===
  // contract oracle === clean-twin observation.
  let state = initialState(caseData.contract);
  for (const [index, step] of steps.entries()) {
    const { result, state: next } = evaluateCall(caseData.contract, state, step.call);
    state = next;
    const oracle = normalizeObserved(result);
    if (!observationsEqual(step.declared, oracle)) {
      return {
        case_id: caseData.case_id,
        outcome: 'declared_mismatch',
        detail: `step ${index}`,
      };
    }
    if (!observationsEqual(oracle, observedClean[index])) {
      // The declaration matched the CONTRACT but the clean twin disagreed with
      // its own oracle — a generator/runner defect, never the candidate's
      // (review 2026-08-18: route to the abort class, not declared_mismatch).
      return {
        case_id: caseData.case_id,
        outcome: 'infra_fail',
        detail: `oracle/clean-twin divergence at step ${index}`,
      };
    }
  }

  // sensitivity: the defect twin must deviate from the declaration somewhere.
  const revealed = steps.some(
    (step, index) => !observationsEqual(step.declared, observedDefect[index]),
  );
  if (!revealed) {
    return { case_id: caseData.case_id, outcome: 'missed_defect', detail: null };
  }
  return { case_id: caseData.case_id, outcome: 'pass', detail: null };
}

// ── trial + administration fold (plan §2 subjects) ───────────────────────────

const ROBUSTNESS_OUTCOMES = new Set(['malformed_plan', 'budget_exceeded']);
const ABORT_OUTCOMES = new Set(['infra_fail', 'transport_fail']);

function gradeTrial(trial, plans, executeTwin = inProcessExecutor) {
  const results = [];
  for (const caseData of trial.cases) {
    const plan = Object.hasOwn(plans, caseData.case_id) ? plans[caseData.case_id] : null;
    const graded = gradeCase(caseData, plan, executeTwin);
    results.push(graded);
    if (ABORT_OUTCOMES.has(graded.outcome)) {
      return {
        trial_id: trial.trial_id,
        aborted: graded.outcome,
        abort_detail: graded.detail,
        results,
        subjects: { declared_accuracy: null, sensitivity: null, robustness: null },
      };
    }
  }
  const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
  const subjects = {
    declared_accuracy: count('declared_mismatch') <= CORPUS.thresholds.max_declared_mismatches,
    sensitivity: count('missed_defect') <= CORPUS.thresholds.max_missed_defects,
    robustness: results.filter((r) => ROBUSTNESS_OUTCOMES.has(r.outcome)).length
      <= CORPUS.thresholds.max_robustness_violations,
  };
  return { trial_id: trial.trial_id, aborted: null, results, subjects };
}

function gradeAdministration(admin, plansPerTrial, executeTwin = inProcessExecutor) {
  const trials = admin.trials.map(
    (trial, index) => gradeTrial(trial, plansPerTrial[index] || {}, executeTwin),
  );
  const aborted = trials.find((t) => t.aborted);
  if (aborted) {
    return {
      generator_version: admin.generatorVersion,
      qualified: null,
      outcome: 'aborted',
      abort_class: aborted.aborted,
      trials,
      subjects: { declared_accuracy: null, sensitivity: null, robustness: null },
    };
  }
  const subjects = {
    declared_accuracy: trials.every((t) => t.subjects.declared_accuracy === true),
    sensitivity: trials.every((t) => t.subjects.sensitivity === true),
    robustness: trials.every((t) => t.subjects.robustness === true),
  };
  return {
    generator_version: admin.generatorVersion,
    qualified: subjects.declared_accuracy && subjects.sensitivity && subjects.robustness,
    outcome: 'graded',
    subjects,
    trials,
  };
}

module.exports = {
  ABORT_OUTCOMES,
  InfraError,
  gradeAdministration,
  gradeCase,
  gradeTrial,
  inProcessExecutor,
  normalizeDeclared,
  validatePlan,
};
