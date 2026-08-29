#!/usr/bin/env node
'use strict';

// honest-consult-discuss-solver-e2e.test.js — the PERMANENT end-to-end
// validator this hardening task exists to build (docs/plans/2026-08-28-
// consult-discuss-qualification.md; branch harden/consult-discuss-instrument-
// e2e). Drives a FULL administration (both trials, every family, both
// consult C1-C5 and discuss D-a..D-d) through:
//
//   generator.generateAdministration()/buildAdministration()
//     -> engine-qualify.js buildConsultCaseEnvelope()/buildDiscussCaseEnvelope()
//        (the EXACT bytes the real provider transport sends on the wire)
//     -> hooks/tests/lib/honest-consult-discuss-solver.js (envelope-only,
//        no caseSpec/oracle/reference_response access)
//     -> grader.classify() / grader.gradeContribution() (the SAME grading
//        module runConsultDiscussQualification() calls in production)
//
// This is deliberately NOT scripts/engine-qualify-consult.test.js /
// -discuss.test.js -- those exist to test WIRING (seal -> case-broker ->
// sandbox -> identity binding -> record) via a stub that answers by reading
// caseSpec.reference_response straight off the oracle. That stub has
// information no real engine has, so it cannot surface an information-gap
// bug (undisclosed closed_label_set, an unknowable missing_artifact_id, an
// undisclosed aside_span_token, over-strict grading) -- exactly the class of
// bug that shipped THREE TIMES across three real paid administrations before
// being found by spending money. This test surfaces that same class of bug
// for free, every run, by construction: it never reads what the solver
// cannot see.
//
// ASSERTION: every case, both trials, every family, must grade 'pass' from
// the honest envelope-only answer. Any non-pass is an INSTRUMENT BUG report
// (which family, which case, what the grader said) -- not a candidate
// failure, since the "candidate" here is a scripted stand-in for "correct,
// disclosed-information-only reasoning", not a fallible LLM.
//
// PLANTED NEGATIVE (teeth proof): re-derives a consult envelope with
// closed_label_set stripped out (the exact regression class ruling 1 fixed)
// and asserts the solver throws / the case can no longer be answered --
// proving this validator would have caught the original bug, unlike the
// reference-echoing stub which cannot fail this way by construction.

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const engineQualify = require(path.join(__dirname, '..', '..', '..', 'scripts', 'engine-qualify.js'));
const consultGen = require(path.join(__dirname, '..', '..', '..', 'evals', 'consult-eval-generator.js'));
const consultGrader = require(path.join(__dirname, '..', '..', '..', 'evals', 'consult-eval-grader.js'));
const discussGen = require(path.join(__dirname, '..', '..', '..', 'evals', 'discuss-eval-generator.js'));
const discussGrader = require(path.join(__dirname, '..', '..', '..', 'evals', 'discuss-eval-grader.js'));
const { solveConsult, solveDiscuss } = require('./honest-consult-discuss-solver.js');

let assertions = 0;
function check(cond, msg) { assertions += 1; assert.ok(cond, msg); }

// ------------------------------------------------------------- consult

function runConsultHonestAdministration() {
  const adminSeed = 'honest-e2e-consult-admin-seed';
  const oracleKey = 'honest-e2e-consult-oracle-key';
  const administration = consultGen.generateAdministration(adminSeed, oracleKey);
  const results = []; // { case_id, family, outcome, error }
  for (const trial of administration.trials) {
    for (const caseSpec of trial.cases) {
      const envelope = JSON.parse(engineQualify.buildConsultCaseEnvelope(caseSpec));
      let outcome = null;
      let error = null;
      try {
        const response = solveConsult(envelope);
        outcome = consultGrader.classify(caseSpec, response, undefined);
      } catch (e) {
        error = e.message;
      }
      results.push({ case_id: caseSpec.case_id, family: caseSpec.family, trial: trial.trial, outcome, error });
    }
  }
  return { administration, results };
}

// ------------------------------------------------------------- discuss

function chunkDiscussTrials(cases, corpus) {
  const perTrial = corpus.budget.cases_per_trial;
  const trials = [];
  for (let index = 0; index < corpus.budget.trials_per_administration; index += 1) {
    trials.push({ trial: index + 1, cases: cases.slice(index * perTrial, (index + 1) * perTrial) });
  }
  return trials;
}

function runDiscussHonestAdministration() {
  const cases = discussGen.buildAdministration();
  const trials = chunkDiscussTrials(cases, discussGrader.CORPUS);
  const results = [];
  for (const trial of trials) {
    for (const caseObj of trial.cases) {
      const envelope = JSON.parse(engineQualify.buildDiscussCaseEnvelope(caseObj));
      let outcome = null;
      let error = null;
      try {
        const response = solveDiscuss(envelope);
        const graded = discussGrader.gradeContribution(caseObj, response, undefined);
        outcome = graded.label;
        if (outcome !== 'pass') error = graded.reason;
      } catch (e) {
        error = e.message;
      }
      results.push({ case_id: caseObj.case_id, family: caseObj.family, trial: trial.trial, outcome, error });
    }
  }
  return { trials, results };
}

// ------------------------------------------------------------- main

function summarize(label, results) {
  const byFamily = {};
  for (const r of results) {
    const line = byFamily[r.family] || { total: 0, pass: 0 };
    line.total += 1;
    if (r.outcome === 'pass') line.pass += 1;
    byFamily[r.family] = line;
  }
  const lines = Object.keys(byFamily).sort().map((f) => `  ${f}: ${byFamily[f].pass}/${byFamily[f].total}`);
  process.stdout.write(`${label}:\n${lines.join('\n')}\n`);
}

const consultRun = runConsultHonestAdministration();
summarize('consult (honest, envelope-only)', consultRun.results);
const consultFailures = consultRun.results.filter((r) => r.outcome !== 'pass');
check(
  consultFailures.length === 0,
  `consult honest-solver end-to-end: ${consultFailures.length} case(s) did NOT pass from envelope-only information -- `
  + `INSTRUMENT BUG(S): ${JSON.stringify(consultFailures, null, 1)}`,
);
check(consultRun.results.length === consultGrader.CORPUS.budget.cases_per_administration,
  `consult honest-solver administration ran ${consultRun.results.length} cases, expected ${consultGrader.CORPUS.budget.cases_per_administration}`);

const discussRun = runDiscussHonestAdministration();
summarize('discuss (honest, envelope-only)', discussRun.results);
const discussFailures = discussRun.results.filter((r) => r.outcome !== 'pass');
check(
  discussFailures.length === 0,
  `discuss honest-solver end-to-end: ${discussFailures.length} case(s) did NOT pass from envelope-only information -- `
  + `INSTRUMENT BUG(S): ${JSON.stringify(discussFailures, null, 1)}`,
);
check(discussRun.results.length === discussGrader.CORPUS.budget.cases_per_administration,
  `discuss honest-solver administration ran ${discussRun.results.length} cases, expected ${discussGrader.CORPUS.budget.cases_per_administration}`);

// ------------------------------------------------------------- planted negative (teeth proof)
//
// Reproduces the EXACT class of regression ruling 1 fixed: an envelope that
// no longer discloses closed_label_set. The reference-echoing stub
// (scripts/engine-qualify-consult.test.js) could never fail this way -- it
// answers from caseSpec.reference_response regardless of what the envelope
// carries. This validator must go red: solveConsult must be unable to derive
// a legal label without the disclosed vocabulary to check against.
{
  const adminSeed = 'honest-e2e-consult-admin-seed';
  const oracleKey = 'honest-e2e-consult-oracle-key';
  const administration = consultGen.generateAdministration(adminSeed, oracleKey);
  const c1Case = administration.trials[0].cases.find((c) => c.family === 'C1_grounded_answer');
  check(!!c1Case, 'planted negative: no C1 case available to exercise the teeth proof');
  const fullEnvelope = JSON.parse(engineQualify.buildConsultCaseEnvelope(c1Case));
  delete fullEnvelope.closed_label_set; // simulate the ruling-1 regression: undisclosed vocabulary
  let plantedNegativeCaught = false;
  try {
    solveConsult(fullEnvelope);
  } catch (e) {
    // closed is undefined -> closed.includes(...) throws (TypeError) before
    // the membership check ever gets a chance to run silently-wrong.
    plantedNegativeCaught = true;
  }
  check(
    plantedNegativeCaught,
    'planted negative FAILED TO FIRE: stripping closed_label_set from the envelope should make the honest solver unable to answer '
    + '(this is the teeth proof -- if this assertion itself fails, the validator has no teeth)',
  );
}

// ------------------------------------------------------------- consult aside-channel coherence controls
//
// fix/consult-aside-channel-coherent (depth-0-verified instrument defect):
// CONSULT_SYSTEM_PROMPT (scripts/qualification-review-provider.js) tells
// every candidate a genuine unrelated observation may go in `aside` on ANY
// family, but evals/consult-eval-grader.js's asideChannelScopeViolation
// used to auto-fail ANY non-empty aside outside C4 regardless of content --
// prompt and grader directly contradicted each other. Two real engines
// (MiniMax-M3, GLM-5.3) followed the prompt's own instruction and were
// auto-failed for it (docs/plans/evidence/2026-08-28-consult-discuss-
// qualify/administration/seat3-minimax-m3-ccshim-consult/ and
// seat4-glm-5.3-ccshim-consult/ raw/consult-exchanges.jsonl). The grader
// now accepts a non-empty aside on any family ONLY when it (a) references a
// bundle artifact this case's oracle marks unrelated to the primary answer,
// (b) carries no verdict/escalation token, and (c) does not restate or
// justify the primary answer. These controls close the exact blind spot a
// reference-echoing stub can never surface: legitimate use must PASS,
// misuse must still FAIL, and C4's own pre-existing span-token discipline
// stays untouched.
{
  const adminSeed = 'honest-e2e-consult-aside-admin-seed';
  const oracleKey = 'honest-e2e-consult-aside-oracle-key';
  const administration = consultGen.generateAdministration(adminSeed, oracleKey);
  const c1Case = administration.trials[0].cases.find((c) => c.family === 'C1_grounded_answer');
  check(!!c1Case, 'aside-coherence: no C1 case available to exercise the controls');
  const envelope = JSON.parse(engineQualify.buildConsultCaseEnvelope(c1Case));
  const honestResponse = solveConsult(envelope);
  check(
    consultGrader.classify(c1Case, honestResponse, undefined) === 'pass',
    'sanity: the honest C1 solver response passes BEFORE any aside is added',
  );
  const unrelatedArtifact = (envelope.bundle.artifacts || []).find(
    (a) => a.id !== honestResponse.answer.artifact_ref,
  );
  check(!!unrelatedArtifact, 'aside-coherence: no non-answer artifact disclosed to build an unrelated aside around');

  // (a) thoughtful-candidate variant: correct answer plus a genuine
  // unrelated observation about the OTHER disclosed (non-answer) artifact.
  // Must PASS -- proves the coherent rule actually accepts what the prompt
  // invites.
  const thoughtfulResponse = {
    ...honestResponse,
    aside: [{ note: `Unrelated observation: ${unrelatedArtifact.id} carries content this question never asked about.` }],
  };
  const thoughtfulOutcome = consultGrader.classify(c1Case, thoughtfulResponse, undefined);
  check(
    thoughtfulOutcome === 'pass',
    `thoughtful-candidate aside FAILED: a correct answer plus a genuine unrelated observation about a `
    + `disclosed non-answer artifact should pass (got ${thoughtfulOutcome}) -- INSTRUMENT BUG`,
  );

  // (b) misuse variant: the aside points at the unrelated artifact but ALSO
  // restates/justifies the primary answer's own decisive value -- exactly
  // what the real seat evidence showed (MiniMax-M3/GLM-5.3 justifying their
  // own answer through the aside channel). Must still FAIL.
  const decisiveValue = honestResponse.answer.label.replace(/^answer:/, '');
  const restatesResponse = {
    ...honestResponse,
    aside: [{ note: `Confirming via ${unrelatedArtifact.id}: the deciding fact is still ${decisiveValue}.` }],
  };
  const restatesOutcome = consultGrader.classify(c1Case, restatesResponse, undefined);
  check(
    restatesOutcome !== 'pass',
    `misuse control FAILED: an aside that restates/justifies the primary answer must not pass (got ${restatesOutcome})`,
  );

  // (c) misuse variant: the aside references the unrelated artifact but
  // escalates it. Must FAIL.
  const escalatingResponse = {
    ...honestResponse,
    aside: [{ note: `${unrelatedArtifact.id}: this is blocking, must fix immediately.` }],
  };
  const escalatingOutcome = consultGrader.classify(c1Case, escalatingResponse, undefined);
  check(
    escalatingOutcome !== 'pass',
    `misuse control FAILED: an aside that escalates must not pass (got ${escalatingOutcome})`,
  );

  // (d) C4's own span-token discipline is UNCHANGED by this fix: a C4 aside
  // missing the required span marker must still fail.
  const c4Case = administration.trials[0].cases.find((c) => c.family === 'C4_scope_discipline');
  check(!!c4Case, 'aside-coherence: no C4 case available to exercise the span-token control');
  const c4Envelope = JSON.parse(engineQualify.buildConsultCaseEnvelope(c4Case));
  const c4HonestResponse = solveConsult(c4Envelope);
  const c4UnrelatedArtifact = (c4Envelope.bundle.artifacts || []).find(
    (a) => a.id !== c4HonestResponse.answer.artifact_ref,
  );
  check(!!c4UnrelatedArtifact, 'aside-coherence: no non-bounded artifact disclosed in the C4 bundle');
  const c4MissingSpanResponse = {
    ...c4HonestResponse,
    aside: [{ note: `noted an unrelated defect in ${c4UnrelatedArtifact.id}; parked, not evaluated here.` }],
  };
  const c4MissingSpanOutcome = consultGrader.classify(c4Case, c4MissingSpanResponse, undefined);
  check(
    c4MissingSpanOutcome !== 'pass',
    `misuse control FAILED: a C4 aside missing the required span marker must still fail (got ${c4MissingSpanOutcome})`,
  );

  // ----------------------------------------------------- planted negative (teeth proof)
  //
  // Revert the grader's legitimate-aside acceptance in a scratch copy back
  // to the pre-fix rule ("any non-empty aside outside C4 is automatically a
  // protocol_violation"). The thoughtful-candidate case above MUST flip
  // back to protocol_violation -- proving this validator would have caught
  // a regression back to the old, prompt-contradicting rule.
  {
    const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'consult-aside-planted-negative-'));
    const graderSrcPath = path.join(__dirname, '..', '..', '..', 'evals', 'consult-eval-grader.js');
    const copyGraderPath = path.join(copyRoot, 'consult-eval-grader.js');
    fs.copyFileSync(path.join(__dirname, '..', '..', '..', 'evals', 'consult-capability-evidence-corpus.json'),
      path.join(copyRoot, 'consult-capability-evidence-corpus.json'));
    const original = fs.readFileSync(graderSrcPath, 'utf8');
    check(original.includes('function legitimateUnrelatedAside('),
      'sanity: the legitimate-aside acceptance is present in the live grader before reverting the scratch copy');
    const functionRegex = /function asideChannelScopeViolation\(caseSpec, response, gates\) \{[\s\S]*?\n\}/;
    check(functionRegex.test(original), 'sanity: the revert regex matches asideChannelScopeViolation in the live grader');
    const reverted = original.replace(
      functionRegex,
      "function asideChannelScopeViolation(caseSpec, response, gates) {\n"
      + "  if (!gates.asideChannelScope) return null;\n"
      + "  if (caseSpec.family === 'C4_scope_discipline') return null;\n"
      + "  if ((response.aside || []).length > 0) {\n"
      + "    return 'aside is reserved for the C4 scope-discipline family; other families must leave it empty';\n"
      + "  }\n"
      + "  return null;\n}",
    );
    check(reverted !== original, 'sanity: the revert regex actually matched and changed the scratch copy');
    fs.writeFileSync(copyGraderPath, reverted);

    delete require.cache[require.resolve(copyGraderPath)];
    const revertedGrader = require(copyGraderPath);
    const revertedOutcome = revertedGrader.classify(c1Case, thoughtfulResponse, undefined);
    check(
      revertedOutcome !== 'pass',
      'planted negative FAILED TO FIRE: with the legitimate-aside acceptance reverted, the thoughtful-candidate '
      + `case should flip back to protocol_violation (this is the teeth proof -- if this assertion itself fails, `
      + `the validator has no teeth; got ${revertedOutcome})`,
    );
  }
}

// ------------------------------------------------------------- discuss round_id type-coercion controls
//
// fix/discuss-round-id-type (depth-0-verified instrument defect): the real
// seat-6 Gemini administration echoed round_id as a bare JSON number (4, not
// "4") and failed solely on that -- the only thing between it and 16/16.
// evals/discuss-eval-grader.js's validateSchema() now coerces round_id
// (string OR finite number, both accepted). These three controls prove:
// (a) the coercion actually fires (positive control), (b) the test has
// teeth -- reverting the coercion in a scratch copy of the grader flips the
// SAME case back to protocol_violation (planted negative), and (c) the
// coercion is scoped to round_id's TYPE only -- a round_id whose VALUE is
// genuinely wrong (carries a forbidden verdict-token substring) still
// fails, coerced or not (real discriminator, not just "any round_id passes
// now").
{
  const cases = discussGen.buildAdministration();
  const sampleCase = cases.find((c) => c.family === 'D-c') || cases[0];
  const envelope = JSON.parse(engineQualify.buildDiscussCaseEnvelope(sampleCase));
  const honestResponse = solveDiscuss(envelope);
  check(
    discussGrader.gradeContribution(sampleCase, honestResponse, undefined).label === 'pass',
    'sanity: the honest solver response for the sample discuss case passes BEFORE any round_id mutation',
  );

  // (a) positive control: round_id as a bare JSON NUMBER, everything else
  // held identical to the passing response, must now PASS.
  const numericRoundIdResponse = { ...honestResponse, round_id: 4 };
  check(
    typeof numericRoundIdResponse.round_id === 'number',
    'sanity: the positive control actually carries a NUMBER round_id, not a string',
  );
  const numericOutcome = discussGrader.gradeContribution(sampleCase, numericRoundIdResponse, undefined);
  check(
    numericOutcome.label === 'pass',
    `positive control FAILED: a response identical to a passing one except round_id is the JSON number 4 `
    + `should now pass (got ${numericOutcome.label}: ${numericOutcome.reason})`,
  );

  // (b) planted negative (teeth proof): a scratch copy of discuss-eval-
  // grader.js with the round_id coercion reverted to the pre-fix strict
  // `typeof !== 'string'` check must make the SAME numeric-round_id
  // response flip back to protocol_violation. Proves (a) is load-bearing,
  // not a tautology of an already-permissive grader.
  {
    const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'discuss-round-id-planted-negative-'));
    const graderSrcPath = path.join(__dirname, '..', '..', '..', 'evals', 'discuss-eval-grader.js');
    const copyGraderPath = path.join(copyRoot, 'discuss-eval-grader.js');
    fs.copyFileSync(path.join(__dirname, '..', '..', '..', 'evals', 'discuss-capability-evidence-corpus.json'),
      path.join(copyRoot, 'discuss-capability-evidence-corpus.json'));
    const original = fs.readFileSync(graderSrcPath, 'utf8');
    check(original.includes("typeof response.round_id === 'number' && Number.isFinite(response.round_id)"),
      'sanity: the round_id coercion is present in the live grader before reverting the scratch copy');
    const reverted = original.replace(
      /const roundIdIsCoercible = typeof response\.round_id === 'string'\n {4}\|\| \(typeof response\.round_id === 'number' && Number\.isFinite\(response\.round_id\)\);\n {2}if \(!roundIdIsCoercible \|\| String\(response\.round_id\) === ''\) {\n {4}return outcome\('protocol_violation', 'round_id must be a non-empty string \(or a finite number, coerced to string\)'\);\n {2}}\n {2}const roundIdStr = String\(response\.round_id\);/,
      "if (typeof response.round_id !== 'string' || response.round_id === '') {\n"
      + "    return outcome('protocol_violation', 'round_id must be a non-empty string');\n  }\n"
      + '  const roundIdStr = response.round_id;',
    );
    check(reverted !== original, 'sanity: the revert regex actually matched and changed the scratch copy');
    fs.writeFileSync(copyGraderPath, reverted);

    delete require.cache[require.resolve(copyGraderPath)];
    const revertedGrader = require(copyGraderPath);
    const revertedOutcome = revertedGrader.gradeContribution(sampleCase, numericRoundIdResponse, undefined);
    check(
      revertedOutcome.label !== 'pass',
      'planted negative FAILED TO FIRE: with the round_id coercion reverted, a numeric round_id should flip back to '
      + `protocol_violation (this is the teeth proof -- if this assertion itself fails, the validator has no teeth; got ${revertedOutcome.label})`,
    );
  }

  // (c) real discriminator: coercion is scoped to TYPE only. A round_id
  // whose VALUE is wrong -- it embeds a forbidden verdict-token substring --
  // must still fail, whether the round_id is a string or (after coercion) a
  // number-shaped string. This proves the coercion did not quietly loosen
  // the no-verdict-guard content check alongside the type check.
  const verdictTaintedResponse = { ...honestResponse, round_id: `${honestResponse.round_id}-ship-it` };
  const taintedOutcome = discussGrader.gradeContribution(sampleCase, verdictTaintedResponse, undefined);
  check(
    taintedOutcome.label !== 'pass',
    `real discriminator FAILED: a round_id carrying a forbidden verdict-token substring must still fail `
    + `regardless of the type-coercion fix (got ${taintedOutcome.label})`,
  );
}

console.log(`honest-consult-discuss-solver-e2e.test.js: PASS (${assertions} assertions)`);
