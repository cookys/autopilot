'use strict';

const crypto = require('crypto');
const fs = require('fs');

const DISPOSITIONS = new Set([
  'accepted_blocker',
  'accepted_nonblocking',
  'rejected',
  'duplicate',
  'deferred',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonical(value[key]);
  return output;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function fingerprintFinding(finding) {
  return sha256(JSON.stringify(canonical({
    rubric_id: finding.rubric_id || null,
    affected_surface: normalizeText(finding.affected_surface),
    claim: normalizeText(finding.claim),
    evidence_reference: normalizeText(finding.evidence_reference),
  })));
}

function isCandidateBlocker(raw, rubricIds) {
  const validRubric = typeof raw.rubric_id === 'string' && rubricIds.has(raw.rubric_id);
  return validRubric
    && raw.severity === 'blocking'
    && raw.class === 'decision-now'
    && raw.blocks_next_slice_or_immediate_integrity === true
    && raw.cannot_defer_to_spike === true;
}

/**
 * Merge duplicate classification conservatively: a valid blocker admission from
 * any seat must survive seat-order. Never let an earlier non-blocker report
 * suppress a later (or earlier) candidate_blocker for the same fingerprint.
 */
function mergeFindingClassification(existing, incoming) {
  if (!incoming.candidate_blocker) return;
  if (existing.candidate_blocker) return;
  existing.candidate_blocker = true;
  existing.rubric_mapped = true;
  existing.rubric_id = incoming.rubric_id;
  existing.class = incoming.class;
  existing.severity = incoming.severity;
  existing.blocks_next_slice_or_immediate_integrity = true;
  existing.cannot_defer_to_spike = true;
  // Prefer the blocker report's repair/evidence surfaces for depth-0 adjudication.
  if (incoming.evidence !== undefined) existing.evidence = incoming.evidence;
  if (incoming.repair !== undefined) existing.repair = incoming.repair;
}

function normalizeAndDedupeFindings(seatReviews, rubricIds) {
  const byFingerprint = new Map();
  for (const seatReview of seatReviews) {
    for (const raw of seatReview.findings) {
      const validRubric = typeof raw.rubric_id === 'string' && rubricIds.has(raw.rubric_id);
      const candidateBlocker = isCandidateBlocker(raw, rubricIds);
      const finding = {
        rubric_id: typeof raw.rubric_id === 'string' ? raw.rubric_id : null,
        class: typeof raw.class === 'string' ? raw.class : null,
        severity: raw.severity,
        affected_surface: raw.affected_surface,
        claim: raw.claim,
        evidence: raw.evidence,
        evidence_reference: raw.evidence_reference,
        repair: raw.repair,
        blocks_next_slice_or_immediate_integrity:
          raw.blocks_next_slice_or_immediate_integrity === true,
        cannot_defer_to_spike: raw.cannot_defer_to_spike === true,
        rubric_mapped: validRubric,
        candidate_blocker: candidateBlocker,
        provenance: [{
          seat_id: seatReview.seat_id,
          runner: seatReview.runner,
          model: seatReview.model,
        }],
        duplicate_reports: [],
        disposition: null,
      };
      finding.fingerprint = fingerprintFinding(finding);
      const existing = byFingerprint.get(finding.fingerprint);
      if (existing) {
        existing.duplicate_reports.push({
          disposition: 'duplicate',
          seat_id: seatReview.seat_id,
          runner: seatReview.runner,
          model: seatReview.model,
        });
        existing.provenance.push(...finding.provenance);
        mergeFindingClassification(existing, finding);
      } else {
        byFingerprint.set(finding.fingerprint, finding);
      }
    }
  }
  return [...byFingerprint.values()];
}

function loadDispositionFile(filePath, expected) {
  if (!filePath) return null;
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new TypeError(`disposition file is unreadable: ${error.message}`);
  }
  const keys = new Set(['schema_version', 'logical_plan_id', 'generation', 'findings']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !keys.has(key))
      || value.schema_version !== 1
      || value.logical_plan_id !== expected.logicalPlanId
      || value.generation !== expected.generation
      || !Array.isArray(value.findings)) {
    throw new TypeError('disposition file identity or shape is invalid');
  }
  const decisions = new Map();
  for (const decision of value.findings) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)
        || typeof decision.fingerprint !== 'string'
        || !/^[0-9a-f]{64}$/.test(decision.fingerprint)
        || !DISPOSITIONS.has(decision.disposition)
        || typeof decision.rationale !== 'string'
        || decision.rationale.trim() === ''
        || decisions.has(decision.fingerprint)) {
      throw new TypeError('disposition file contains an invalid or duplicate decision');
    }
    decisions.set(decision.fingerprint, {
      disposition: decision.disposition,
      rationale: decision.rationale.trim(),
    });
  }
  return decisions;
}

function applyDispositions(findings, decisions, options = {}) {
  for (const finding of findings) {
    let decision = decisions ? decisions.get(finding.fingerprint) : null;
    if (!decision && options.legacyAutoAdmit === true) {
      decision = {
        disposition: finding.candidate_blocker
          ? 'accepted_blocker'
          : finding.rubric_mapped
            ? 'accepted_nonblocking'
            : 'rejected',
        rationale: 'legacy compatibility translation',
      };
    }
    if (!decision) continue;
    if (decision.disposition === 'accepted_blocker' && !finding.candidate_blocker) {
      throw new TypeError(
        `finding ${finding.fingerprint} cannot be accepted_blocker without frozen-rubric admission`,
      );
    }
    finding.disposition = decision.disposition;
    finding.disposition_rationale = decision.rationale;
  }
  if (decisions) {
    for (const fingerprint of decisions.keys()) {
      if (!findings.some((finding) => finding.fingerprint === fingerprint)) {
        throw new TypeError(`disposition references unknown finding ${fingerprint}`);
      }
    }
  }
  return findings;
}

/**
 * Blocker candidates that still lack a depth-0 disposition after applyDispositions.
 * Generation 2 is authorized only when this set is empty and at least one candidate
 * was accepted_blocker. A fully dispositioned set with zero accepts is terminal
 * CONDITIONAL — not depth_0_adjudication_required.
 */
function unresolvedCandidateFingerprints(findings) {
  return findings
    .filter((finding) => finding.candidate_blocker && finding.disposition == null)
    .map((finding) => finding.fingerprint);
}

function backlogCandidates(findings) {
  return findings
    .filter((finding) => (
      ['accepted_nonblocking', 'deferred', 'rejected'].includes(finding.disposition)
      || (finding.disposition === null && !finding.candidate_blocker)
      || !finding.rubric_mapped
    ))
    .map((finding) => ({
      fingerprint: finding.fingerprint,
      rubric_id: finding.rubric_id,
      affected_surface: finding.affected_surface,
      claim: finding.claim,
      evidence_reference: finding.evidence_reference,
      disposition: finding.disposition,
    }));
}

module.exports = {
  DISPOSITIONS,
  applyDispositions,
  backlogCandidates,
  fingerprintFinding,
  loadDispositionFile,
  normalizeAndDedupeFindings,
  unresolvedCandidateFingerprints,
};
