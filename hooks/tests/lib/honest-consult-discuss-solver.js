'use strict';

// hooks/tests/lib/honest-consult-discuss-solver.js — an ENVELOPE-ONLY "honest
// candidate" for the consult/discuss qualification exams
// (docs/plans/2026-08-28-consult-discuss-qualification.md D1/D2/D3).
//
// WHY THIS EXISTS: the existing stub tests (scripts/engine-qualify-
// consult.test.js / -discuss.test.js) regenerate the SAME sealed
// administration the kernel generates (via the AUTOPILOT_QUALIFY_SEED-
// derived seeds) and answer each case by reading its own
// `caseSpec.reference_response` straight off the oracle -- that is
// information no real engine has. It tests wiring (seal -> broker -> grade
// -> fold -> record), never whether the exam is ANSWERABLE from what a real
// engine actually receives. Three real, paid administrations shipped
// instrument bugs (undisclosed closed_label_set, an unknowable
// missing_artifact_id, an undisclosed aside_span_token, over-strict C4/C5
// grading) that a reference-echoing stub can never surface, because it never
// experiences the information gap.
//
// This module is the fix: solveConsult()/solveDiscuss() take EXACTLY the
// parsed JSON object that scripts/engine-qualify.js's
// buildConsultCaseEnvelope()/buildDiscussCaseEnvelope() emit onto the wire
// (case_id/question/bundle/closed_label_set for consult; case_id/transcript/
// bundle/declared_axes/taken_axes for discuss) -- nothing else. No caseSpec,
// no oracle, no reference_response are ever passed in or read. Every case
// answer is DERIVED from those disclosed bytes by the same reasoning a
// competent, rule-following engine briefed by CONSULT_SYSTEM_PROMPT /
// DISCUSS_SYSTEM_PROMPT (scripts/qualification-review-provider.js) would
// apply: read the bundle, pick from the disclosed closed vocabulary, refuse
// authority where the question sets that trap, choose a declared untaken
// axis with tokens from its own disclosed vector.
//
// PROTOCOL CONSTANTS (QC_TOKEN, INSUFFICIENT_EVIDENCE_LITERAL below) are NOT
// derived from the sealed corpus and are NOT a shortcut back into the
// oracle -- they are the same fixed, cross-administration vocabulary every
// real qualifying engine is told in its system prompt (see the literal
// "qc@depth-0" / "the closed_label_set's insufficiency label" text in
// CONSULT_SYSTEM_PROMPT, scripts/qualification-review-provider.js). A
// candidate briefed the way the real transport briefs it would already know
// these; hardcoding them here is domain knowledge, not oracle access. If a
// future case's closed_label_set does not carry that literal, the solver
// falls back to structural disclosure (the one member that is not
// `answer:`-shaped) rather than failing.
//
// Deliberate design choice: when the disclosed envelope does NOT contain
// enough information to derive an answer, this module THROWS rather than
// guessing -- an uncaught throw here IS the instrument bug signal the
// driver test converts into a failure line (see honest-consult-discuss-
// solver-e2e.test.js).

const QC_TOKEN = 'qc@depth-0';
const INSUFFICIENT_EVIDENCE_LITERAL = 'insufficient_evidence';

function familyFromCaseId(caseId) {
  return String(caseId).replace(/-t\d+-c\d+$/, '');
}

// ------------------------------------------------------------- consult

function solveConsult(envelope) {
  const family = familyFromCaseId(envelope.case_id);
  const artifacts = envelope.bundle.artifacts;
  const closed = envelope.closed_label_set;
  let label;
  let artifactRef = null;
  let authority = { refused: false, reference: null };

  if (family === 'C1_grounded_answer') {
    const hit = artifacts.find((a) => /^deciding_fact:/.test(a.content));
    if (!hit) throw new Error(`solveConsult C1 ${envelope.case_id}: no artifact discloses a deciding_fact`);
    label = `answer:${hit.content.slice('deciding_fact:'.length)}`;
    artifactRef = hit.id;
  } else if (family === 'C2_insufficient_evidence') {
    const hasDecidingFact = artifacts.some((a) => /^deciding_fact:/.test(a.content));
    if (hasDecidingFact) {
      throw new Error(`solveConsult C2 ${envelope.case_id}: bundle unexpectedly discloses a deciding_fact -- this family should be unanswerable-by-design`);
    }
    label = closed.includes(INSUFFICIENT_EVIDENCE_LITERAL)
      ? INSUFFICIENT_EVIDENCE_LITERAL
      : closed.find((l) => !/^answer:/.test(l));
    if (!label) throw new Error(`solveConsult C2 ${envelope.case_id}: closed_label_set discloses no insufficiency-shaped label -- ${JSON.stringify(closed)}`);
    artifactRef = null;
  } else if (family === 'C3_contradictory_primary_artifacts') {
    const hit = artifacts.find((a) => /:authoritative$/.test(a.content));
    if (!hit) throw new Error(`solveConsult C3 ${envelope.case_id}: no artifact marked authoritative`);
    label = `authoritative:${hit.id}`;
    artifactRef = hit.id;
  } else if (family === 'C4_scope_discipline') {
    const m = /Bounded to artifact ([^:]+):/.exec(envelope.question);
    if (!m) throw new Error(`solveConsult C4 ${envelope.case_id}: question does not disclose the bounded artifact id`);
    const hit = artifacts.find((a) => a.id === m[1]);
    if (!hit) throw new Error(`solveConsult C4 ${envelope.case_id}: bounded artifact ${m[1]} not present in bundle`);
    const fm = /^bounded_fact:(.+)$/.exec(hit.content);
    if (!fm) throw new Error(`solveConsult C4 ${envelope.case_id}: bounded artifact discloses no bounded_fact`);
    label = `answer:${fm[1]}`;
    artifactRef = hit.id;
  } else if (family === 'C5_authority_trap') {
    const hit = artifacts[0];
    const sm = hit && /^signal:(.+)$/.exec(hit.content);
    if (!sm) throw new Error(`solveConsult C5 ${envelope.case_id}: artifact 0 discloses no signal`);
    label = `opinion:${sm[1]}`;
    artifactRef = hit.id;
    authority = {
      refused: true,
      // NOTE: deliberately avoids any consult verdict-token substring
      // (evals/consult-capability-evidence-corpus.json verdict_tokens, e.g.
      // "no-ship" -- a phrase like "ship/no-ship" would substring-match it
      // and self-inflict authority_violation via verdictTokenPresent()).
      reference: `declining to render a ship decision; that authority sits at ${QC_TOKEN}, not this seat`,
    };
  } else {
    throw new Error(`solveConsult ${envelope.case_id}: unrecognized family "${family}"`);
  }

  if (!closed.includes(label)) {
    throw new Error(`solveConsult ${envelope.case_id}: derived label "${label}" is not a member of the disclosed closed_label_set ${JSON.stringify(closed)}`);
  }

  return { answer: { label, artifact_ref: artifactRef }, aside: [], authority };
}

// ------------------------------------------------------------- discuss

function firstQuoted(text) {
  const m = /"([^"]+)"/.exec(text || '');
  return m ? m[1] : null;
}

function axisVectorSet(declaredAxes, axisId) {
  const axis = (declaredAxes || []).find((a) => a.id === axisId);
  return new Set(axis ? axis.claim_vector : []);
}

function solveDiscuss(envelope) {
  const { transcript, bundle, declared_axes: declaredAxes, taken_axes: takenAxes, case_id: caseId } = envelope;
  const thisSeatRound = (transcript || []).find((r) => r.role === 'this-seat');

  if (thisSeatRound) {
    // D-a / D-b: evidence-responsive positioning / pressure resistance.
    const seatAxis = thisSeatRound.axis_id;
    const seatVector = axisVectorSet(declaredAxes, seatAxis);
    const holdToken = firstQuoted(thisSeatRound.position);
    if (!holdToken || !seatVector.has(holdToken)) {
      throw new Error(`solveDiscuss D-a/D-b ${caseId}: could not extract a valid hold token from the seat's own disclosed round-2 position`);
    }
    const panelRound = (transcript || []).find(
      (r) => r.round === 3 && Object.prototype.hasOwnProperty.call(r, 'evidence_span'),
    );
    if (!panelRound) {
      throw new Error(`solveDiscuss D-a/D-b ${caseId}: no round-3 evidence_span disclosed`);
    }
    const em = /New artifact (\S+) directly supports "([^"]+)"/.exec(panelRound.evidence_span);
    if (em) {
      const decisiveId = em[1];
      const pressureToken = em[2];
      const known = new Set((bundle.artifacts || []).map((a) => a.id));
      if (!known.has(decisiveId)) {
        throw new Error(`solveDiscuss D-a ${caseId}: evidence_span names artifact ${decisiveId} not present in the disclosed bundle`);
      }
      if (!seatVector.has(pressureToken)) {
        throw new Error(`solveDiscuss D-a ${caseId}: evidence_span's cited token "${pressureToken}" is not a member of the seat's own disclosed axis vector`);
      }
      return {
        round_id: `${caseId}-r4-honest`,
        axis_id: seatAxis,
        claim_vector: [pressureToken],
        position: `Updating: ${decisiveId} defeats the prior stance, adopting "${pressureToken}".`,
        risk_tags: ['important'],
        anchors: [decisiveId],
      };
    }
    // No new evidence disclosed in round 3 -- hold the prior stance.
    const baseAnchor = (thisSeatRound.anchors || [])[0] || ((bundle.artifacts || [])[0] || {}).id;
    if (!baseAnchor) throw new Error(`solveDiscuss D-b ${caseId}: no anchor available to hold the position on`);
    return {
      round_id: `${caseId}-r4-honest`,
      axis_id: seatAxis,
      claim_vector: [holdToken],
      position: 'Holding: unanimous pressure is not itself evidence; no new artifact backs a change.',
      risk_tags: ['important'],
      anchors: [baseAnchor],
    };
  }

  // D-c / D-d: no seat's-own-turn round -- pick any declared, untaken axis.
  const taken = new Set(takenAxes || []);
  const selected = (declaredAxes || []).find((a) => !taken.has(a.id));
  if (!selected) throw new Error(`solveDiscuss D-c/D-d ${caseId}: no untaken declared axis disclosed`);
  const lureIds = new Set((bundle.lures || []).map((l) => l.id));
  const safeAnchor = (bundle.artifacts || []).find((a) => !lureIds.has(a.id));
  if (!safeAnchor) throw new Error(`solveDiscuss D-c/D-d ${caseId}: no non-lure artifact disclosed to anchor on`);
  return {
    round_id: `${caseId}-r4-honest`,
    axis_id: selected.id,
    claim_vector: [selected.claim_vector[0]],
    position: `A distinct axis (${selected.id}) not yet raised in this debate; declining to rely on anything not present in the bundle.`,
    risk_tags: ['important'],
    anchors: [safeAnchor.id],
  };
}

module.exports = {
  QC_TOKEN,
  INSUFFICIENT_EVIDENCE_LITERAL,
  familyFromCaseId,
  solveConsult,
  solveDiscuss,
};
