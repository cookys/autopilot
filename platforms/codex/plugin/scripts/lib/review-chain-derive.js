'use strict';

/**
 * review-chain-derive.js — shared receipt re-derivation and finding closure routine.
 *
 * Used by:
 *   - scripts/hetero-review-loop.js (handleFinalize)
 *   - scripts/check-phase-review-receipt.js (validation)
 *
 * Contract:
 *   deriveReceiptState(chainEntries, findingsByGeneration, dispositionsByGeneration)
 *
 * Parameters:
 *   - chainEntries: Array of generation chain entry objects ({ generation, status, closed_findings, ... })
 *   - findingsByGeneration: Map or Object keyed by generation number (integer or string),
 *       mapping to an array of finding objects ({ id, severity, seat, text, ... }) or an object with a .findings array
 *   - dispositionsByGeneration: Map or Object keyed by generation number (integer or string),
 *       mapping to an array of disposition objects ({ id, disposition, rationale, ... }) or an object with a .findings array
 *
 * Returns:
 *   {
 *     verdict: 'SHIP-AS-IS' | 'FIX-THEN-SHIP',
 *     open_findings: Array of active open verified findings (Major/Minor); any verified Critical or Major makes the verdict FIX-THEN-SHIP,
 *     closed_findings: Array of closed findings across chain generations ({ id, closed_by_generation, ... }),
 *     openFindings: alias for open_findings,
 *     closedFindings: alias for closed_findings
 *   }
 *
 * Optional 4th parameter (BL-0384 b): addendumResolutions, [{ id, rationale, fix_sha, reviewed_head }].
 * Default empty. Each closes its finding as if the generation whose finalized head is reviewed_head
 * had carried the resolution. Git ancestry of fix_sha is NOT judged here (no I/O); callers verify it.
 *
 * Closure: only an explicit `resolutions` entry ({ id, rationale }) in a later generation's
 * dispositions closes an earlier verified finding; absence never does (BL-0032). Pass the
 * dispositions value as { findings, resolutions } to carry them.
 *
 * Mutation: mutates input chain entry objects in place to (re)populate closed_findings
 * (existing stamps are discarded first, BL-0092);
 * callers (hetero-review-loop finalize) rely on those stamps reaching chain.json.
 * No fs, process, or network I/O.
 */

function toList(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (Array.isArray(val.findings)) return val.findings;
  return [];
}

// Explicit re-verification entries ({ id, rationale }) a generation's dispositions may carry
// next to `findings`. They are the ONLY way an earlier verified finding is closed (BL-0032).
function resolutionsOf(val) {
  if (!val || Array.isArray(val) || !Array.isArray(val.resolutions)) return [];
  return val.resolutions.filter((r) => r && typeof r.id === 'string');
}

function getFromGenMap(mapOrObj, gen) {
  if (!mapOrObj) return [];
  if (mapOrObj instanceof Map) {
    if (mapOrObj.has(gen)) return toList(mapOrObj.get(gen));
    if (mapOrObj.has(String(gen))) return toList(mapOrObj.get(String(gen)));
    return [];
  }
  if (typeof mapOrObj === 'object') {
    if (mapOrObj[gen] !== undefined) return toList(mapOrObj[gen]);
    if (mapOrObj[String(gen)] !== undefined) return toList(mapOrObj[String(gen)]);
  }
  return [];
}

// Gate rule A as a machine check (G14). A Critical or Major finding leaves the gate in exactly one of
// three ways: verified (then a later generation's resolution closes it), refuted as a FALSE finding
// (refutation_kind false_claim | unreachable, plus evidence), or formally downgraded to Minor or
// Suggestion (to, evidence_kind unreachable | impact_bounded, plus evidence). "Not blocking",
// "low impact" and "follow-up" are not refutation kinds: a true finding with small impact is
// downgraded with evidence, never refuted. Minor and Suggestion findings keep the old rules.
// Only chain entries carrying `disposition_schema: 2` are judged: the new finalize writes that marker,
// so an entry finalized by the old finalize (which could not write kinds) is never re-opened, whatever
// its finalized_at says.
const DISPOSITION_SCHEMA = 2;
const REFUTATION_KINDS = ['false_claim', 'unreachable'];
const DOWNGRADE_TO = ['Minor', 'Suggestion'];
const DOWNGRADE_EVIDENCE_KINDS = ['unreachable', 'impact_bounded'];

function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }

// Returns an error string for a Major+ finding whose disposition does not satisfy rule A, else null.
function majorDispositionError(finding, disp) {
  if (!finding || (finding.severity !== 'Critical' && finding.severity !== 'Major')) return null;
  const id = finding.id;
  const d = disp && disp.disposition;
  if (d === 'verified') return null;
  if (d === 'refuted') {
    if (!REFUTATION_KINDS.includes(disp.refutation_kind)) {
      return `${finding.severity} finding ${id} is refuted without refutation_kind ${REFUTATION_KINDS.join(' | ')} ("not blocking" / "low impact" are not refutations; a true finding with small impact needs disposition "downgraded" with evidence)`;
    }
    if (!nonEmpty(disp.evidence)) return `${finding.severity} finding ${id} is refuted without non-empty evidence (file:line, a command and its output, or a test)`;
    return null;
  }
  if (d === 'downgraded') {
    if (!DOWNGRADE_TO.includes(disp.to)) return `${finding.severity} finding ${id} is downgraded without "to" ${DOWNGRADE_TO.join(' | ')}`;
    if (!DOWNGRADE_EVIDENCE_KINDS.includes(disp.evidence_kind)) return `${finding.severity} finding ${id} is downgraded without evidence_kind ${DOWNGRADE_EVIDENCE_KINDS.join(' | ')}`;
    if (!nonEmpty(disp.evidence)) return `${finding.severity} finding ${id} is downgraded without non-empty evidence`;
    return null;
  }
  return `${finding.severity} finding ${id} has disposition '${d}'; a Critical or Major finding must be verified, refuted (refutation_kind + evidence) or downgraded (to + evidence_kind + evidence)`;
}

// A downgraded non-Major finding is not a downgrade: only Major+ may use the form.
function downgradeMisuseError(finding, disp) {
  if (disp && disp.disposition === 'downgraded' && finding && finding.severity !== 'Critical' && finding.severity !== 'Major') {
    return `finding ${finding.id} is ${finding.severity}; "downgraded" applies only to a Critical or Major finding`;
  }
  return null;
}

function enforcedBySchema(chainEntry) {
  return !!(chainEntry && chainEntry.disposition_schema === DISPOSITION_SCHEMA);
}

function deriveReceiptState(chainEntries, findingsByGeneration, dispositionsByGeneration, addendumResolutions) {
  const addenda = Array.isArray(addendumResolutions) ? addendumResolutions.filter((r) => r && typeof r.id === 'string') : [];
  const chain = Array.isArray(chainEntries) ? [...chainEntries] : [];
  chain.sort((a, b) => (a.generation || 0) - (b.generation || 0));

  // Map of active open verified findings: id -> finding object
  // Map of closed findings: id -> { id, closed_by_generation, ... }
  const activeVerified = new Map();
  const closedMap = new Map();
  const unmatchedResolutions = [];

  // Chain-entry closed_findings stamps are OUTPUT of this routine (BL-0092): drop whatever a
  // previous derive (including a pre-v2.36.3 one) left, so a re-derivation rewrites them from
  // evidence alone instead of inheriting a stale attribution.
  for (const entry of chain) {
    if (entry && entry.closed_findings !== undefined) delete entry.closed_findings;
  }

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    // v2.36.3: an aborted generation (branch moved during collection, or a seat's findings
    // failed to parse) produced NO reviewable result — it must contribute nothing. Before this
    // guard its empty findings set "closed by absence" every open verified finding from the
    // earlier generations (an abort was an audit escape), in both hetero-review-loop finalize
    // and check-phase-review-receipt (<host> report, 2026-09-05).
    if (entry.status === 'aborted') continue;
    const gen = entry.generation || (i + 1);

    const genFindings = getFromGenMap(findingsByGeneration, gen);
    const genDispositions = getFromGenMap(dispositionsByGeneration, gen);

    const currentFindingIds = new Set(genFindings.map((f) => f && f.id).filter(Boolean));

    // 1. Cross-generation closure is EXPLICIT (BL-0032): an earlier verified finding is closed only
    // by a `resolutions` entry in this generation's dispositions (a re-verification claim with a
    // rationale). Absence from this generation's findings is not evidence — a reviewer that did not
    // re-raise a finding may simply not have looked — so the finding stays open. A resolution
    // naming no open verified finding is recorded as unmatched; callers refuse it.
    const rawDisp = dispositionsByGeneration instanceof Map
      ? (dispositionsByGeneration.get(gen) !== undefined ? dispositionsByGeneration.get(gen) : dispositionsByGeneration.get(String(gen)))
      : dispositionsByGeneration && (dispositionsByGeneration[gen] !== undefined ? dispositionsByGeneration[gen] : dispositionsByGeneration[String(gen)]);
    // BL-0384 (b): an addendum resolution closes at the generation whose FINALIZED head is its
    // reviewed_head (git ancestry of the fix is checked by the callers, which have a repository).
    const addForGen = addenda.filter((a) => {
      const g = chain.find((c) => c && c.status === 'finalized' && c.head === a.reviewed_head);
      return g === entry;
    });
    for (const r of resolutionsOf(rawDisp).concat(addForGen)) {
      const id = r.id;
      const finding = activeVerified.get(id);
      if (!finding || currentFindingIds.has(id)) {
        unmatchedResolutions.push({ id, generation: gen });
        continue;
      }
      activeVerified.delete(id);
      closedMap.set(id, {
        id,
        closed_by_generation: gen,
        severity: finding.severity,
        seat: finding.seat,
      });
      // Stamp the generation that originated the finding
      for (const prevEntry of chain) {
        if (prevEntry.status === 'aborted') continue; // an aborted record stays minimal (v2.36.3 review)
        if (prevEntry.generation < gen) {
          if (!Array.isArray(prevEntry.closed_findings)) prevEntry.closed_findings = [];
          if (!prevEntry.closed_findings.some((cf) => cf && cf.id === id)) {
            prevEntry.closed_findings.push({ id, closed_by_generation: gen });
          }
        }
      }
    }

    // 2. (removed, v2.36.3) Pre-existing `closed_findings` stamps on chain entries are OUTPUT of
    // this routine, never input: closure is re-derived from findings + dispositions evidence
    // alone (ADR-0001, verification over attestation). Honouring stamps let a stamp written
    // by the pre-v2.36.3 derive — which attributed a closure to an aborted generation — keep
    // closing the finding on every later re-derivation, and let a forged stamp close a
    // finding with no evidence at all.

    // 3. Process current generation's dispositions
    const dispMap = new Map();
    for (const d of genDispositions) {
      if (d && d.id) {
        dispMap.set(d.id, d);
      }
    }

    for (const f of genFindings) {
      if (!f || !f.id) continue;
      const disp = dispMap.get(f.id);
      const disposition = disp ? disp.disposition : undefined;

      // Rule A, enforced here once for every consumer: in a marker-carrying entry a Critical/Major whose
      // disposition fails majorDispositionError (bare refuted/deferred, missing, ...) stays open as if verified.
      const ruleAOpen = enforcedBySchema(entry) && !!majorDispositionError(f, disp);
      if (disposition === 'verified' || ruleAOpen) {
        activeVerified.set(f.id, {
          id: f.id,
          severity: f.severity,
          seat: f.seat,
          text: f.text,
          disposition: 'verified',
          generation: gen,
        });
      } else {
        // If it was refuted, downgraded or deferred in this generation, it is not an active verified finding
        activeVerified.delete(f.id);
      }
    }
  }

  // An addendum naming a reviewed_head that is no finalized chain head closes nothing.
  for (const a of addenda) {
    if (!chain.some((c) => c && c.status === 'finalized' && c.head === a.reviewed_head)) {
      unmatchedResolutions.push({ id: a.id, generation: 0 });
    }
  }

  // Derive final open findings and verdict
  // A verified Critical or Major is a confirmed defect awaiting its fix: it blocks (FIX-THEN-SHIP).
  // A verified Minor rides in open_findings and can be left open on purpose (--allow-unresolved).
  let hasBlocking = false;
  const openFindings = [];

  for (const f of activeVerified.values()) {
    if (f.severity === 'Critical' || f.severity === 'Major') {
      hasBlocking = true;
    }
    if (f.severity === 'Major' || f.severity === 'Minor') {
      openFindings.push({
        id: f.id,
        severity: f.severity,
        seat: f.seat,
        text: f.text,
        disposition: 'verified',
      });
    }
  }

  const verdict = hasBlocking ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS';
  const closedList = Array.from(closedMap.values());

  return {
    verdict,
    open_findings: openFindings,
    closed_findings: closedList,
    unmatched_resolutions: unmatchedResolutions,
    openFindings,
    closedFindings: closedList,
  };
}

module.exports = deriveReceiptState;
module.exports.deriveReceiptState = deriveReceiptState;
module.exports.majorDispositionError = majorDispositionError;
module.exports.downgradeMisuseError = downgradeMisuseError;
module.exports.enforcedBySchema = enforcedBySchema;
module.exports.DISPOSITION_SCHEMA = DISPOSITION_SCHEMA;
