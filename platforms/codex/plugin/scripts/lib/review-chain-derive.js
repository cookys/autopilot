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
 *     open_findings: Array of active open verified findings (Major/Minor),
 *     closed_findings: Array of closed findings across chain generations ({ id, closed_by_generation, ... }),
 *     openFindings: alias for open_findings,
 *     closedFindings: alias for closed_findings
 *   }
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

function deriveReceiptState(chainEntries, findingsByGeneration, dispositionsByGeneration) {
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
    // and check-phase-review-receipt (7840hs report, 2026-09-05).
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
    for (const r of resolutionsOf(rawDisp)) {
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

      if (disposition === 'verified') {
        activeVerified.set(f.id, {
          id: f.id,
          severity: f.severity,
          seat: f.seat,
          text: f.text,
          disposition: 'verified',
          generation: gen,
        });
      } else {
        // If it was refuted or deferred in this generation, it is not an active verified finding
        activeVerified.delete(f.id);
      }
    }
  }

  // Derive final open findings and verdict
  let hasVerifiedCritical = false;
  const openFindings = [];

  for (const f of activeVerified.values()) {
    if (f.severity === 'Critical') {
      hasVerifiedCritical = true;
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

  const verdict = hasVerifiedCritical ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS';
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
