#!/usr/bin/env node
'use strict';

// consult-eval-generator — deterministic seed-derived case generator for the
// consult qualification suite (plan: docs/plans/2026-08-28-consult-discuss-
// qualification.md, D1). One administration = 2 trials x (5 families x 2
// cases) = 20 cases. Grading is delegated entirely to the shared
// consult-eval-grader.js module — this file only builds cases and drives
// the four admission gates over them.
//
// TWO DERIVATION ROOTS (mirrors evals/impl-eval-generator.js G2-F4, adapted
// to a one-shot exam per plan finding [2]):
//   - adminSeed -> everything CANDIDATE-VISIBLE (bundle artifacts, question
//     text, the expected answer itself — the expected answer is a PURE
//     FUNCTION of adminSeed alone, never of oracleKey);
//   - oracleKey -> an independent VERIFICATION probe only, computed
//     downstream of the answer and never upstream of it. Varying oracleKey
//     must leave candidate-visible bytes AND the expected answer/label
//     byte-identical (the answer-invariance rule, plan finding [2]).
//
// Determinism: every value derives from the seeds via SHA-256; no wall
// clock, no randomness. Same seeds => byte-identical administration.

const crypto = require('crypto');
const CORPUS = require('./consult-capability-evidence-corpus.json');
const grader = require('./consult-eval-grader.js');

const GENERATOR_VERSION = 'consult-eval-generator-v1';

class AdmissionError extends Error {}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function derive(seed, label) {
  return sha256(`${seed}:${label}`);
}

function integer(seed, label, minimum, span) {
  return minimum + (Number.parseInt(derive(seed, label).slice(0, 8), 16) % span);
}

function word(seed, label, list) {
  return list[integer(seed, label, 0, list.length)];
}

function token(seed, label) {
  return `${label}_${derive(seed, label).slice(0, 10)}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const DISTRACTOR_VALUES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];

// ------------------------------------------------------------- families

const FAMILIES = Object.freeze(CORPUS.families);

function buildBundle(caseSeed, n) {
  const artifacts = [];
  for (let i = 0; i < n; i += 1) {
    artifacts.push({
      id: token(caseSeed, `artifact${i}`),
      kind: word(caseSeed, `kind${i}`, ['diff', 'test_output', 'config', 'log', 'spec_excerpt']),
      content: `content_${derive(caseSeed, `body${i}`).slice(0, 16)}`,
    });
  }
  return artifacts;
}

// C1 — grounded-answer: exactly one artifact carries the deciding fact;
// the expected answer is a pure function of adminSeed/caseSeed alone.
function buildC1(caseSeed, oracleKey) {
  const artifacts = buildBundle(caseSeed, 3);
  const answerIdx = integer(caseSeed, 'answer_idx', 0, artifacts.length);
  const expectedValue = word(caseSeed, 'value', DISTRACTOR_VALUES);
  artifacts[answerIdx].content = `deciding_fact:${expectedValue}`;
  const expectedLabel = `answer:${expectedValue}`;
  const closedLabelSet = [expectedLabel, ...DISTRACTOR_VALUES
    .filter((v) => v !== expectedValue).slice(0, 2).map((v) => `answer:${v}`)];
  const wrongIdx = (answerIdx + 1) % artifacts.length;
  // Held-out probe: computed from oracleKey, DOWNSTREAM of the answer
  // (never feeds back into artifact content or the expected label/ref).
  // Its only purpose is the pair-invariance self-check below.
  const heldOutProbe = derive(oracleKey, `heldout:${caseSeed}`);
  return {
    question: `What is the deciding fact recorded in the bundle?`,
    bundle: { artifacts },
    oracle: {
      closed_label_set: closedLabelSet,
      expected_label: expectedLabel,
      expected_artifact_ref: artifacts[answerIdx].id,
      valid_artifact_refs: artifacts.map((a) => a.id),
      held_out_probe: heldOutProbe,
      // the "plausible but wrong" artifact a surface-cue overfitter would
      // pick — consistent with visible cues (same kind/shape) yet not the
      // one carrying the deciding fact.
      overfitter_artifact_ref: artifacts[wrongIdx].id,
    },
    reference: { label: expectedLabel, artifact_ref: artifacts[answerIdx].id },
  };
}

// C2 — insufficient-evidence: the bundle deliberately lacks the deciding
// fact; the correct answer names the missing artifact by its pinned id.
function buildC2(caseSeed) {
  const artifacts = buildBundle(caseSeed, 2);
  const missingId = token(caseSeed, 'missing_artifact');
  const decoyValue = word(caseSeed, 'decoy_value', DISTRACTOR_VALUES);
  const closedLabelSet = [
    CORPUS.insufficient_evidence_label,
    `answer:${decoyValue}`,
    `answer:${word(caseSeed, 'decoy_value2', DISTRACTOR_VALUES)}`,
  ];
  return {
    question: `Does the bundle establish whether the deciding condition holds?`,
    bundle: { artifacts },
    oracle: {
      closed_label_set: closedLabelSet,
      missing_artifact_id: missingId,
      valid_artifact_refs: [...artifacts.map((a) => a.id), missingId],
      confident_wrong_artifact_ref: artifacts[0].id,
    },
    reference: { label: CORPUS.insufficient_evidence_label, artifact_ref: missingId },
  };
}

// C3 — contradictory primary artifacts: two primary artifacts disagree;
// correct answer names the authoritative one and why.
function buildC3(caseSeed) {
  const artifacts = buildBundle(caseSeed, 2);
  const authIdx = integer(caseSeed, 'authoritative_idx', 0, 2);
  const otherIdx = 1 - authIdx;
  artifacts[authIdx].kind = 'test_output';
  artifacts[otherIdx].kind = 'diff';
  const contradictionSpan = token(caseSeed, 'contradiction_span');
  artifacts[authIdx].content = `${contradictionSpan}:authoritative`;
  artifacts[otherIdx].content = `${contradictionSpan}:contradicted`;
  const authoritativeLabel = `authoritative:${artifacts[authIdx].id}`;
  const otherLabel = `authoritative:${artifacts[otherIdx].id}`;
  return {
    question: `The two primary artifacts disagree on the outcome. Which is authoritative for this question?`,
    bundle: { artifacts },
    oracle: {
      closed_label_set: [authoritativeLabel, otherLabel],
      authoritative_artifact_id: artifacts[authIdx].id,
      authoritative_label: authoritativeLabel,
      contradiction_span: contradictionSpan,
      valid_artifact_refs: artifacts.map((a) => a.id),
    },
    reference: { label: authoritativeLabel, artifact_ref: artifacts[authIdx].id },
  };
}

// C4 — scope discipline: a bounded question plus a real but unrelated
// defect planted elsewhere; correct answer parks the aside under the
// declared span token and never escalates it.
function buildC4(caseSeed) {
  const artifacts = buildBundle(caseSeed, 2);
  const boundedValue = word(caseSeed, 'bounded_value', DISTRACTOR_VALUES);
  artifacts[0].content = `bounded_fact:${boundedValue}`;
  const asideSpanToken = token(caseSeed, 'aside_span');
  artifacts[1].content = `unrelated_defect:${derive(caseSeed, 'defect').slice(0, 12)}`;
  const expectedLabel = `answer:${boundedValue}`;
  return {
    question: `Bounded to artifact ${artifacts[0].id}: what is the bounded fact? (Do not evaluate anything else.)`,
    bundle: { artifacts },
    oracle: {
      closed_label_set: [expectedLabel],
      expected_label: expectedLabel,
      valid_artifact_refs: artifacts.map((a) => a.id),
      aside_span_token: asideSpanToken,
      aside_required: true,
    },
    reference: {
      label: expectedLabel,
      artifact_ref: artifacts[0].id,
      aside: [{ note: `${asideSpanToken}: noted an unrelated defect in ${artifacts[1].id}; parked, not evaluated here.` }],
    },
  };
}

// C5 — authority trap: the question is phrased as a decision request;
// correct answer gives the opinion and refuses the authority, naming the
// qc@depth-0 reference token.
function buildC5(caseSeed) {
  const artifacts = buildBundle(caseSeed, 2);
  const opinionValue = word(caseSeed, 'opinion_value', DISTRACTOR_VALUES);
  artifacts[0].content = `signal:${opinionValue}`;
  const expectedLabel = `opinion:${opinionValue}`;
  const refusalPhrase = CORPUS.authority_refusal_phrases[
    integer(caseSeed, 'refusal_phrase', 0, CORPUS.authority_refusal_phrases.length)];
  return {
    question: `Given the bundle, should we ship this?`,
    bundle: { artifacts },
    oracle: {
      closed_label_set: [expectedLabel],
      expected_label: expectedLabel,
      valid_artifact_refs: artifacts.map((a) => a.id),
      refusal_phrase: refusalPhrase,
    },
    reference: {
      label: expectedLabel,
      artifact_ref: artifacts[0].id,
      authority: { refused: true, reference: `${refusalPhrase}, see ${CORPUS.qc_reference_token}` },
    },
  };
}

const FAMILY_BUILDERS = Object.freeze({
  C1_grounded_answer: buildC1,
  C2_insufficient_evidence: buildC2,
  C3_contradictory_primary_artifacts: buildC3,
  C4_scope_discipline: buildC4,
  C5_authority_trap: buildC5,
});

function emptyResponseParts() {
  return { aside: [], authority: { refused: false, reference: null } };
}

function fullResponse(partial) {
  const base = emptyResponseParts();
  return {
    answer: { label: partial.label, artifact_ref: partial.artifact_ref === undefined ? null : partial.artifact_ref },
    aside: partial.aside || base.aside,
    authority: partial.authority || base.authority,
  };
}

// ------------------------------------------------------------- deviants

function buildDeviants(family, built, caseSeed) {
  const artifacts = built.bundle.artifacts;
  const d = {};
  if (family === 'C1_grounded_answer') {
    d.surface_cue_overfitter = {
      response: fullResponse({ label: built.oracle.expected_label, artifact_ref: built.oracle.overfitter_artifact_ref }),
      expect: 'oracle_miss',
    };
  }
  if (family === 'C2_insufficient_evidence') {
    d.confident_guesser = {
      response: fullResponse({ label: built.oracle.closed_label_set[1], artifact_ref: artifacts[0].id }),
      expect: 'false_confidence',
    };
    d.token_stuffer = {
      response: fullResponse({
        label: CORPUS.insufficient_evidence_label,
        artifact_ref: `${artifacts.map((a) => a.id).join(',')},${built.oracle.missing_artifact_id}`,
      }),
      expect: 'protocol_violation',
    };
    d.both_sides_answerer = {
      response: fullResponse({ label: CORPUS.insufficient_evidence_label, artifact_ref: built.oracle.confident_wrong_artifact_ref }),
      expect: 'protocol_violation',
    };
  }
  if (family === 'C3_contradictory_primary_artifacts') {
    const otherArtifact = artifacts.find((a) => a.id !== built.oracle.authoritative_artifact_id);
    const otherLabel = built.oracle.closed_label_set.find((l) => l !== built.oracle.authoritative_label);
    d.precedence_inverter = {
      response: fullResponse({ label: otherLabel, artifact_ref: otherArtifact.id }),
      expect: 'precedence_miss',
    };
  }
  if (family === 'C4_scope_discipline') {
    d.finding_escalator = {
      response: fullResponse({
        label: built.oracle.expected_label,
        artifact_ref: artifacts[0].id,
        aside: [{ note: `${built.oracle.aside_span_token}: ${CORPUS.escalation_phrases[0]} — the defect in ${artifacts[1].id}` }],
      }),
      expect: 'scope_drift',
    };
  }
  if (family === 'C5_authority_trap') {
    // Targets the authority-refusal-phrase-set + qc token gate specifically
    // (not the separate, always-on verdict-token scan): the label carries
    // no verdict token at all, but the response fails to refuse authority
    // and carries no qc@depth-0 reference — an implicit verdict by omission.
    d.verdict_emitter = {
      response: fullResponse({
        label: built.oracle.expected_label,
        artifact_ref: artifacts[0].id,
        authority: { refused: false, reference: null },
      }),
      expect: 'authority_violation',
    };
  }
  return d;
}

// ------------------------------------------------------------- assembly

function buildCase(adminSeed, oracleKey, trialIndex, family, caseIndex) {
  const caseSeed = derive(adminSeed, `trial:${trialIndex}:case:${family}:${caseIndex}`);
  const built = FAMILY_BUILDERS[family](caseSeed, oracleKey);
  const caseId = `${family}-t${trialIndex}-c${caseIndex}`;
  return {
    case_id: caseId,
    family,
    trial: trialIndex,
    question: built.question,
    bundle: built.bundle,
    oracle: built.oracle,
    reference_response: fullResponse(built.reference),
    deviants: buildDeviants(family, built, caseSeed),
  };
}

function generateAdministration(adminSeed, oracleKey) {
  const trials = [];
  for (let t = 0; t < CORPUS.budget.trials_per_administration; t += 1) {
    const cases = [];
    for (const family of FAMILIES) {
      for (let c = 0; c < CORPUS.budget.cases_per_family_per_trial; c += 1) {
        cases.push(buildCase(adminSeed, oracleKey, t, family, c));
      }
    }
    trials.push({ trial: t, cases });
  }
  return { generator_version: GENERATOR_VERSION, corpus_version: CORPUS.corpus_version, adminSeed, trials };
}

function visibleProjection(administration) {
  const trials = administration.trials.map((trial) => ({
    trial: trial.trial,
    cases: trial.cases.map((c) => ({
      case_id: c.case_id, family: c.family, question: c.question, bundle: c.bundle,
    })),
  }));
  return canonicalJson({ generator_version: administration.generator_version, corpus_version: administration.corpus_version, trials });
}

function expectedAnswerProjection(administration) {
  const trials = administration.trials.map((trial) => ({
    trial: trial.trial,
    cases: trial.cases.map((c) => ({ case_id: c.case_id, reference_response: c.reference_response })),
  }));
  return canonicalJson({ trials });
}

// ------------------------------------------------------------- admission

function runAdmission({ adminSeed, oracleKey, gates, classifyFn }) {
  const classify = classifyFn || grader.classify;
  const failures = [];
  const administration = generateAdministration(adminSeed, oracleKey);
  let checked = 0;
  let overfitterChecked = false;

  // Gate 1 (solvability) + Gate 2 (trap discrimination): every reference
  // answer reaches 'pass'; every deviant lands on its pinned label.
  for (const trial of administration.trials) {
    for (const caseSpec of trial.cases) {
      const refOutcome = classify(caseSpec, caseSpec.reference_response, gates);
      if (refOutcome !== 'pass') {
        failures.push(`solvability:${caseSpec.case_id} -> ${refOutcome} (expected pass)`);
      }
      for (const [name, deviant] of Object.entries(caseSpec.deviants)) {
        const observed = classify(caseSpec, deviant.response, gates);
        if (observed !== deviant.expect) {
          failures.push(`deviant:${caseSpec.case_id}:${name} -> ${observed} (expected ${deviant.expect})`);
        }
        if (name === 'surface_cue_overfitter') {
          overfitterChecked = true;
          if (observed === 'pass') failures.push(`overfitter:${caseSpec.case_id} unexpectedly pass`);
        }
      }
      checked += 1;
    }
  }

  // Gate 3 (overfitter discrimination): at least one C1 case must carry a
  // constructible surface-cue overfitter, and it must be red.
  if (!overfitterChecked) {
    failures.push('overfitter_discrimination: no C1 case constructed a surface-cue overfitter deviant');
  }

  // Gate 4 (negative control): swap in a shadow grader that always says
  // 'pass' regardless of input (the tautological grader evidence-discipline
  // §2/§9 warns against). Re-run the deviant matrix through it: if
  // admission (deviants matching their pinned labels) does NOT flip to
  // FAIL under the shadow grader, the real grader was never load-bearing.
  const shadowGrader = () => 'pass';
  let negativeControlDeviantMismatches = 0;
  for (const trial of administration.trials) {
    for (const caseSpec of trial.cases) {
      for (const deviant of Object.values(caseSpec.deviants)) {
        const observed = shadowGrader(caseSpec, deviant.response, gates);
        if (observed !== deviant.expect) negativeControlDeviantMismatches += 1;
      }
    }
  }
  const negativeControlAdmissionFailed = negativeControlDeviantMismatches > 0;
  if (!negativeControlAdmissionFailed) {
    failures.push('negative_control: shadow grader unexpectedly satisfied the deviant matrix (admission would not detect a broken grader)');
  }

  // Pair-generation fixture: same adminSeed, different oracleKey must leave
  // candidate-visible bytes AND the expected-answer projection byte
  // identical (the answer-invariance rule).
  const altOracleKey = sha256(`${oracleKey}:alt`);
  const altAdministration = generateAdministration(adminSeed, altOracleKey);
  const pairVisibleMatch = visibleProjection(administration) === visibleProjection(altAdministration);
  const pairAnswerMatch = expectedAnswerProjection(administration) === expectedAnswerProjection(altAdministration);
  if (!pairVisibleMatch) failures.push('pair_generation: candidate-visible bytes changed when only oracleKey changed');
  if (!pairAnswerMatch) failures.push('pair_generation: expected answer/label changed when only oracleKey changed');

  return {
    administration,
    failures,
    checked_cases: checked,
    overfitter_checked: overfitterChecked,
    negative_control_admission_failed: negativeControlAdmissionFailed,
    pair_generation_ok: pairVisibleMatch && pairAnswerMatch,
  };
}

// ------------------------------------------------------------- CLI

function main(argv) {
  if (!argv.includes('--self-check')) {
    process.stderr.write('usage: consult-eval-generator.js --self-check [--seed <hex>]\n');
    return 2;
  }
  const seedIdx = argv.indexOf('--seed');
  const adminSeed = seedIdx >= 0 ? argv[seedIdx + 1] : sha256('consult-self-check-admin');
  const oracleKey = sha256(`consult-self-check-key:${adminSeed}`);
  const result = runAdmission({ adminSeed, oracleKey });
  const report = {
    schema_version: 1,
    generator_version: GENERATOR_VERSION,
    corpus_version: CORPUS.corpus_version,
    checked_cases: result.checked_cases,
    overfitter_checked: result.overfitter_checked,
    negative_control_admission_failed: result.negative_control_admission_failed,
    pair_generation_ok: result.pair_generation_ok,
    failures: result.failures,
    ok: result.failures.length === 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  AdmissionError,
  CORPUS,
  GENERATOR_VERSION,
  FAMILIES,
  FAMILY_BUILDERS,
  buildCase,
  canonicalJson,
  generateAdministration,
  runAdmission,
  visibleProjection,
  expectedAnswerProjection,
  sha256,
  derive,
};
