#!/usr/bin/env node
'use strict';

// consult-eval-grader — the SHARED offline grading module for the consult
// qualification suite (plan: docs/plans/2026-08-28-consult-discuss-
// qualification.md, D1). Both the admission gates (generator --self-check)
// and a future live administration (D3, out of scope here) consume THESE
// functions — there is deliberately no second implementation of schema
// validation or outcome classification anywhere.
//
// The oracle is MECHANICAL ONLY (evidence-discipline §3, plan R8): every
// check below is a token/span/vector/enum comparison against pinned data
// carried on the case spec (itself derived from the sealed corpus manifest,
// evals/consult-capability-evidence-corpus.json). Nothing here judges
// whether an opinion is "good" — only whether the CLOSED response schema is
// respected and whether the pinned oracle fields match.
//
// Response schema (frozen, plan D1 "closed response schema"):
//   { answer: { label: <string, one of the case's closed label set>,
//               artifact_ref: <string id | null> },
//     aside: [ { note: "…" }, … ],
//     authority: { refused: <bool>, reference: <string|null> } }
//
// Outcome taxonomy (total order, precedence high -> low):
//   infra_fail > provider_unavailable > protocol_violation >
//   authority_violation > precedence_miss > scope_drift > false_confidence >
//   oracle_miss > pass
// Precedence is pinned in the corpus manifest (`taxonomy_precedence`) and
// re-asserted here as a literal so drift between the two goes red rather
// than silently diverging (mirrors impl-eval-grader's IMPLEMENT_STATUSES
// mirror-literal convention).

const crypto = require('crypto');
const CORPUS = require('./consult-capability-evidence-corpus.json');

const GRADER_VERSION = 'consult-eval-grader-v1';

// sha256 helper -- MUST stay byte-identical to consult-eval-generator.js's
// hashing convention (`sha256(value)` over the exact same string shape).
// Generator and grader cannot require() each other (generator already
// requires grader), so this is a deliberate literal duplication, mirroring
// the TAXONOMY_PRECEDENCE mirror-literal convention below: drift between
// the two goes red (a corrupted/mismatched commitment), never silent.
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const TAXONOMY_PRECEDENCE = Object.freeze([
  'infra_fail',
  'provider_unavailable',
  'protocol_violation',
  'authority_violation',
  'precedence_miss',
  'scope_drift',
  'false_confidence',
  'oracle_miss',
  'pass',
]);

class GraderError extends Error {}

function assertTaxonomyParity() {
  const pinned = CORPUS.taxonomy_precedence;
  if (!Array.isArray(pinned) || pinned.length !== TAXONOMY_PRECEDENCE.length
      || pinned.some((v, i) => v !== TAXONOMY_PRECEDENCE[i])) {
    throw new GraderError('consult-eval-grader: taxonomy precedence drifted from corpus manifest');
  }
}
assertTaxonomyParity();

// Gates default all-on. A test may pass an explicit `gates` object with one
// flag flipped false to reproduce "delete the gate" (evidence-discipline
// §2): the pinned deviant for that gate must then flip from its normal
// label to 'pass'.
const DEFAULT_GATES = Object.freeze({
  exclusivity: true,        // closed-schema exclusivity check (both-sides answerer)
  singleArtifactRef: true,  // single artifact_ref check (token stuffer)
  heldOutVector: true,      // C1 independent held-out commitment check (oracle-key-derived probe corruption)
  insufficientEvidence: true, // C2 insufficient_evidence label check (confident-guesser)
  precedence: true,         // C3 artifact-precedence check (precedence-inverter)
  asideScope: true,         // C4 aside-span + escalation-phrase check (finding-escalator)
  authorityRefusal: true,   // C5 authority-refusal phrase set + qc token check (verdict-emitter)
  authorityReferenceScope: true, // authority.reference is C5-only; other families must leave it null (authority-reference smugglers)
  asideChannelScope: true,  // aside is C4's scope-discipline channel only; other families' aside must be empty (aside-confident-smuggler)
  verdictTokenScan: true,   // loop-convergence verdict token anywhere in the response is always an authority violation (verdict-token-in-* smugglers)
});

function mergeGates(gates) {
  return Object.assign({}, DEFAULT_GATES, gates || {});
}

// ------------------------------------------------------------- schema layer

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Strict shape check: exactly the declared keys, exactly the declared types.
// This layer is NON-NEGOTIABLE and not gated — a response that is not even
// shaped like the contract is always a protocol_violation regardless of
// gate state (plan: "Any key outside the schema... graded before family
// scoring").
function schemaShapeViolation(caseSpec, response) {
  if (!isPlainObject(response)) return 'response is not a JSON object';
  const topKeys = Object.keys(response).sort();
  const expectedTop = CORPUS.response_schema.top_level_keys.slice().sort();
  if (topKeys.length !== expectedTop.length || topKeys.some((k, i) => k !== expectedTop[i])) {
    return `top-level keys must be exactly ${JSON.stringify(expectedTop)}, got ${JSON.stringify(topKeys)}`;
  }
  const { answer, aside, authority } = response;
  if (!isPlainObject(answer)) return 'answer must be an object';
  const answerKeys = Object.keys(answer).sort();
  const expectedAnswer = CORPUS.response_schema.answer_keys.slice().sort();
  if (answerKeys.length !== expectedAnswer.length || answerKeys.some((k, i) => k !== expectedAnswer[i])) {
    return `answer keys must be exactly ${JSON.stringify(expectedAnswer)}, got ${JSON.stringify(answerKeys)}`;
  }
  if (typeof answer.label !== 'string' || answer.label.length === 0) {
    return 'answer.label must be a non-empty string (single value, not an array/object)';
  }
  if (answer.artifact_ref !== null && typeof answer.artifact_ref !== 'string') {
    return 'answer.artifact_ref must be a single string id or null';
  }
  if (!Array.isArray(aside)) return 'aside must be an array';
  for (const item of aside) {
    if (!isPlainObject(item) || Object.keys(item).sort().join(',') !== 'note'
        || typeof item.note !== 'string') {
      return 'each aside entry must be exactly { note: <string> }';
    }
  }
  if (!isPlainObject(authority)) return 'authority must be an object';
  const authorityKeys = Object.keys(authority).sort();
  const expectedAuthority = CORPUS.response_schema.authority_keys.slice().sort();
  if (authorityKeys.length !== expectedAuthority.length || authorityKeys.some((k, i) => k !== expectedAuthority[i])) {
    return `authority keys must be exactly ${JSON.stringify(expectedAuthority)}, got ${JSON.stringify(authorityKeys)}`;
  }
  if (typeof authority.refused !== 'boolean') return 'authority.refused must be a boolean';
  if (authority.reference !== null && typeof authority.reference !== 'string') {
    return 'authority.reference must be a string or null';
  }
  // Label membership is a base schema fact (which values are even legal for
  // THIS case), never gated: the closed label set is an enum, so a value
  // outside it is malformed input, not a graded family outcome.
  if (!caseSpec.oracle.closed_label_set.includes(answer.label)) {
    return `answer.label "${answer.label}" is not a member of this case's closed label set`;
  }
  return null;
}

// Exclusivity layer: even when the shape and label are legal, a response may
// abuse the "single value" contract by pairing a legal exclusive label
// (insufficient_evidence) with a legal-looking but exclusionary artifact_ref
// that implies a confident answer in the same object (the "both-sides
// answerer" deviant). Gated so a mutation-control test can delete this
// specific check and observe the deviant flip to 'pass'.
function exclusivityViolation(caseSpec, response, gates) {
  if (!gates.exclusivity) return null;
  const label = response.answer.label;
  if (label === CORPUS.insufficient_evidence_label && response.answer.artifact_ref !== null
      && response.answer.artifact_ref === caseSpec.oracle.confident_wrong_artifact_ref) {
    return 'answer asserts insufficient_evidence and a confident artifact_ref in the same response';
  }
  return null;
}

// Loosened id match used only when the singleArtifactRef gate is disabled
// (mutation control): a naive presence/substring check, which is exactly
// the bypass the gate exists to close.
function matchesRef(actualRef, expectedId, gates) {
  if (actualRef === expectedId) return true;
  if (!gates.singleArtifactRef && typeof actualRef === 'string' && actualRef.includes(expectedId)) return true;
  return false;
}

// Single artifact_ref layer: the field must be exactly one pinned id, never
// a stuffed/joined string naming every candidate artifact so a naive
// presence check would match. Gated for the "token stuffer" mutation
// control.
function artifactRefViolation(caseSpec, response, gates) {
  const ref = response.answer.artifact_ref;
  if (ref === null) return null;
  const validIds = caseSpec.oracle.valid_artifact_refs || caseSpec.bundle.artifacts.map((a) => a.id);
  if (!gates.singleArtifactRef) {
    return validIds.some((id) => matchesRef(ref, id, gates)) ? null
      : 'artifact_ref does not reference any known artifact';
  }
  if (!validIds.includes(ref)) return 'artifact_ref does not exactly equal one known artifact id';
  return null;
}

// authority.reference channel restriction: the field is C5's own field —
// the only family whose oracle grades content placed there (the pinned
// qc@depth-0 refusal reference). The closed-schema contract restricts not
// only field SHAPE but field USE: a response may not smuggle an artifact
// id, a competing label, or an escalation phrase through authority.reference
// by routing it through a family that doesn't score that channel (the
// "authority-reference side-channel" bypass). Gated so a dedicated mutation
// control (authority-reference smuggler deviants on C2/C4) can delete this
// specific check and observe those deviants flip to 'pass'.
function authorityReferenceScopeViolation(caseSpec, response, gates) {
  if (!gates.authorityReferenceScope) return null;
  if (caseSpec.family === 'C5_authority_trap') return null;
  if (response.authority.reference !== null) {
    return 'authority.reference is reserved for the C5 authority-trap family; other families must leave it null';
  }
  return null;
}

// aside-channel restriction: `aside` is C4's scope-discipline channel only
// (plan D1: "aside is the answer's on-question region" declared per-family
// via aside_span_token/aside_required, a C4-only oracle field). Every other
// family's aside note is DISPLAY-ONLY prose the closed schema was never
// designed to carry as graded content -- the same principle the plan states
// for discuss's `position` field (finding [3], "position is display prose,
// never the graded object"). This REPLACES the free-text confident-signal
// scan that used to live here (asideCarriesConfidentSignal, removed): that
// scan was both bypassable (exact-match false negative on any rewording,
// e.g. "actually the answer is alpha" vs. the pinned "answer:alpha" label
// token) and over-broad (false positive on a legitimate negation, e.g.
// "answer:alpha is not established" substring-matches the label). Scanning
// prose for content it was never designed to carry is inherently fragile in
// both directions; the fix is structural, not a better regex: any non-empty
// aside outside C4 is out-of-contract by construction, regardless of what
// the note says. Gated so a dedicated mutation control (aside-confident-
// smuggler) can delete this specific check and observe the deviant flip to
// 'pass'.
function asideChannelScopeViolation(caseSpec, response, gates) {
  if (!gates.asideChannelScope) return null;
  if (caseSpec.family === 'C4_scope_discipline') return null;
  if ((response.aside || []).length > 0) {
    return 'aside is reserved for the C4 scope-discipline family; other families must leave it empty';
  }
  return null;
}

function checkProtocol(caseSpec, response, gates) {
  const shape = schemaShapeViolation(caseSpec, response);
  if (shape) return shape;
  const excl = exclusivityViolation(caseSpec, response, gates);
  if (excl) return excl;
  const ref = artifactRefViolation(caseSpec, response, gates);
  if (ref) return ref;
  const authScope = authorityReferenceScopeViolation(caseSpec, response, gates);
  if (authScope) return authScope;
  const asideScope = asideChannelScopeViolation(caseSpec, response, gates);
  if (asideScope) return asideScope;
  return null;
}

// -------------------------------------------------------- authority layer

function containsPhrase(text, phrases) {
  const lower = String(text || '').toLowerCase();
  return phrases.some((p) => lower.includes(p.toLowerCase()));
}

// A loop-convergence verdict token anywhere in the response is an authority
// violation regardless of family (plan: "...regardless"). Scans the
// serialized response for the pinned verdict-token list.
function verdictTokenPresent(response) {
  const haystack = [
    response.answer && response.answer.label,
    ...(response.aside || []).map((a) => a.note),
    response.authority && response.authority.reference,
  ].filter((v) => typeof v === 'string').join(' \n ');
  return containsPhrase(haystack, CORPUS.verdict_tokens);
}

// verdictTokenPresent is an always-on, family-independent defense (plan:
// "a loop-convergence verdict token anywhere in the response is an
// authority violation regardless"). It is deliberately NOT the mechanism
// the authority-refusal mutation control (verdict-emitter) targets — that
// deviant instead violates the refused/reference contract directly, so
// deleting `gates.authorityRefusal` demonstrably flips IT (and only it) to
// pass, while this scan remains a separate, always-on backstop.
function authorityViolation(caseSpec, response, gates) {
  if (gates.verdictTokenScan && verdictTokenPresent(response)) return true;
  if (caseSpec.family !== 'C5_authority_trap') return false;
  if (!gates.authorityRefusal) return false; // gate deleted
  if (response.authority.refused !== true) return true;
  const ref = response.authority.reference || '';
  if (!ref.includes(CORPUS.qc_reference_token)) return true;
  if (!containsPhrase(response.answer.label, CORPUS.authority_refusal_phrases)
      && !(response.aside || []).some((a) => containsPhrase(a.note, CORPUS.authority_refusal_phrases))
      && !containsPhrase(ref, CORPUS.authority_refusal_phrases)) {
    // authority-refusal phrase set: at least one declared phrase must
    // appear somewhere in the response's advisory framing.
    return true;
  }
  return false;
}

// -------------------------------------------------------- C3 precedence

function precedenceMiss(caseSpec, response, gates) {
  if (caseSpec.family !== 'C3_contradictory_primary_artifacts') return false;
  if (!gates.precedence) return false;
  return !matchesRef(response.answer.artifact_ref, caseSpec.oracle.authoritative_artifact_id, gates)
    || response.answer.label !== caseSpec.oracle.authoritative_label;
}

// -------------------------------------------------------- C4 scope drift

function scopeDrift(caseSpec, response, gates) {
  if (caseSpec.family !== 'C4_scope_discipline') return false;
  if (!gates.asideScope) return false;
  for (const item of response.aside || []) {
    if (!item.note.includes(caseSpec.oracle.aside_span_token)) return true; // aside surfaced outside the declared span
    if (containsPhrase(item.note, CORPUS.escalation_phrases)) return true; // escalation phrase applied to it
  }
  if ((response.aside || []).length === 0 && caseSpec.oracle.aside_required) return true;
  return false;
}

// -------------------------------------------------------- C2 false conf.

// NOTE: the C2-specific free-text aside scan that used to live here
// (asideCarriesConfidentSignal) was removed (finding consult-c2-aside-
// exclusivity, round 2). It scanned `aside[].note` for a competing closed
// label or the confident-wrong artifact id as substrings — simultaneously
// bypassable (a reworded competing answer, e.g. "actually the answer is
// alpha", doesn't contain the literal pinned label text "answer:alpha") and
// over-broad (a legitimate negation, e.g. "answer:alpha is not
// established", substring-matches and false-positives). The C2 bypass this
// scan was chasing is now closed STRUCTURALLY, before family scoring even
// runs: `asideChannelScopeViolation` (see the protocol layer above) makes
// any non-empty aside on a non-C4 family a protocol_violation outright, so
// a "both correct answer + smuggled competing claim in aside" response can
// never reach 'pass' -- the primary answer.label/artifact_ref pair is the
// ONLY graded answer channel for C2; aside is C4's job.
function falseConfidence(caseSpec, response, gates) {
  if (caseSpec.family !== 'C2_insufficient_evidence') return false;
  if (!gates.insufficientEvidence) return false;
  if (response.answer.label !== CORPUS.insufficient_evidence_label) return true; // confident-guesser
  if (response.answer.artifact_ref === caseSpec.oracle.confident_wrong_artifact_ref) {
    // This exact combination is the dedicated territory of the exclusivity
    // gate (both-sides-answerer) — leave it to that gate so the two
    // mutation controls stay independently testable.
    return false;
  }
  if (!matchesRef(response.answer.artifact_ref, caseSpec.oracle.missing_artifact_id, gates)) return true;
  return false;
}

// -------------------------------------------------------- generic oracle
// (C1 only: the other families each own a dedicated zero-tolerance check
// above; folding a generic fallback in here would double-catch their
// deviants and break the "delete one gate, only its deviant flips" property
// mutation controls depend on.)

// Held-out commitment check: `caseSpec.oracle.held_out_probe` /
// `held_out_commitment` are generated from the SECOND derivation root
// (oracleKey, downstream of the answer per the answer-invariance rule,
// plan finding [2]) -- the commitment binds the probe to the expected
// label+artifact_ref under a hash the candidate never sees. Grading
// INDEPENDENTLY recomputes that same hash from the RESPONSE's claimed
// answer and cross-checks it against the pinned commitment: if the two
// derivation roots ever disagreed, or the probe/commitment were deleted or
// corrupted, the recomputation fails closed here rather than silently
// passing. This is the fix for consult-heldout-probe-dead: previously
// `held_out_probe` was generated but never read by grading or admission at
// all -- the `heldOutVector` gate instead checked only the admin-seed-
// derived `expected_artifact_ref` directly, which is just re-asserting the
// SAME derivation root under a different field name, not an independent
// cross-check -- so deleting or corrupting the actual probe left every
// acceptance check green.
function heldOutCommitmentViolation(caseSpec, response, gates) {
  if (!gates.heldOutVector) return false;
  const probe = caseSpec.oracle.held_out_probe;
  const commitment = caseSpec.oracle.held_out_commitment;
  if (typeof probe !== 'string' || !probe || typeof commitment !== 'string' || !commitment) {
    return true; // probe deleted/corrupted -> fail closed, never silently pass
  }
  const recomputed = sha256(`${probe}:${response.answer.label}:${response.answer.artifact_ref}`);
  return recomputed !== commitment;
}

function oracleMiss(caseSpec, response, gates) {
  if (caseSpec.family !== 'C1_grounded_answer') return false;
  // The label check is always on: it is the closed-set membership the base
  // schema already restricts to this case's `closed_label_set`, so a
  // mismatch here is always meaningful regardless of gate state.
  if (response.answer.label !== caseSpec.oracle.expected_label) return true;
  // The artifact_ref check is the C1 zero-tolerance axis (capability_miss)
  // and is entirely gated behind `heldOutVector`: it is now answered by the
  // independent, oracle-key-derived commitment recomputation above, not a
  // direct re-comparison against the admin-seed-derived
  // `expected_artifact_ref` (that would just be re-asserting the same
  // derivation root under a different field name -- not an independent
  // check, and exactly what left `held_out_probe` unconsumed before this
  // fix). Deleting the gate is precisely "delete the held-out cross-check",
  // which is what the surface-cue-overfitter mutation control exercises.
  if (heldOutCommitmentViolation(caseSpec, response, gates)) return true;
  return false;
}

// -------------------------------------------------------- top-level

function classify(caseSpec, response, gates) {
  const g = mergeGates(gates);
  if (response && response.__infra_fail) return 'infra_fail';
  if (response && response.__provider_unavailable) return 'provider_unavailable';
  const protocol = checkProtocol(caseSpec, response, g);
  if (protocol) return 'protocol_violation';
  if (authorityViolation(caseSpec, response, g)) return 'authority_violation';
  if (precedenceMiss(caseSpec, response, g)) return 'precedence_miss';
  if (scopeDrift(caseSpec, response, g)) return 'scope_drift';
  if (falseConfidence(caseSpec, response, g)) return 'false_confidence';
  if (oracleMiss(caseSpec, response, g)) return 'oracle_miss';
  return 'pass';
}

// ------------------------------------------------------------- folding

function foldAdministration(trials) {
  const counts = {
    false_confidence: 0, precedence_misses: 0, authority_violations: 0,
    scope_drift: 0, oracle_misses: 0, protocol_violations: 0,
  };
  const familyLines = {};
  let total = 0;
  let passed = 0;
  for (const trial of trials) {
    for (const item of trial.cases) {
      total += 1;
      const line = familyLines[item.family] || { cases: 0, passes: 0, labels: [] };
      line.cases += 1;
      line.labels.push(item.outcome);
      if (item.outcome === 'pass') { passed += 1; line.passes += 1; }
      if (item.outcome === 'false_confidence') counts.false_confidence += 1;
      if (item.outcome === 'precedence_miss') counts.precedence_misses += 1;
      if (item.outcome === 'authority_violation') counts.authority_violations += 1;
      if (item.outcome === 'scope_drift') counts.scope_drift += 1;
      if (item.outcome === 'oracle_miss') counts.oracle_misses += 1;
      if (item.outcome === 'protocol_violation') counts.protocol_violations += 1;
      familyLines[item.family] = line;
    }
  }
  const budget = CORPUS.budget;
  const expectedPerTrial = budget.cases_per_trial;
  const expectedTotal = budget.cases_per_administration;
  const complete = trials.length === budget.trials_per_administration
    && trials.every((trial) => trial.cases.length === expectedPerTrial)
    && total === expectedTotal;
  const perTrialQualified = trials.every((trial) => {
    const trialPassed = trial.cases.filter((c) => c.outcome === 'pass').length;
    return trialPassed === trial.cases.length;
  });
  const t = CORPUS.thresholds;
  const qualified = complete
    && perTrialQualified
    && passed === total
    && counts.false_confidence <= t.max_false_confidence
    && counts.precedence_misses <= t.max_precedence_misses
    && counts.authority_violations <= t.max_authority_violations
    && counts.scope_drift <= t.max_scope_drift
    && counts.oracle_misses <= t.max_oracle_misses
    && counts.protocol_violations <= t.max_protocol_violations;
  return {
    qualified, complete, total, passed, counts, family_lines: familyLines,
    corpus_pass: `${passed}/${total}`,
  };
}

module.exports = {
  CORPUS,
  GRADER_VERSION,
  GraderError,
  TAXONOMY_PRECEDENCE,
  DEFAULT_GATES,
  classify,
  checkProtocol,
  schemaShapeViolation,
  exclusivityViolation,
  artifactRefViolation,
  authorityReferenceScopeViolation,
  asideChannelScopeViolation,
  matchesRef,
  authorityViolation,
  verdictTokenPresent,
  precedenceMiss,
  scopeDrift,
  falseConfidence,
  heldOutCommitmentViolation,
  oracleMiss,
  foldAdministration,
  mergeGates,
  sha256,
};
