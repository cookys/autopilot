'use strict';

const { canonicalDigest } = require('./implementation-campaign');

const SEVERITIES = new Set(['🔴', '🟠', '🟡', '🔵']);
const SEVERITY_NAMES = new Map([
  ['critical', '🔴'],
  ['major', '🟠'],
  ['minor', '🟡'],
  ['suggestion', '🔵'],
]);
const FINDING_KEYS = new Set(['finding_id', 'claim', 'severity', 'source']);

function validFinding(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === FINDING_KEYS.size
    && Object.keys(value).every((key) => FINDING_KEYS.has(key))
    && typeof value.finding_id === 'string'
    && /^[A-Za-z0-9._:-]{1,128}$/.test(value.finding_id)
    && typeof value.claim === 'string'
    && value.claim.trim().length > 0
    && SEVERITIES.has(value.severity)
    && typeof value.source === 'string'
    && value.source.trim().length > 0;
}

function result(status, findings = [], reason = null) {
  const canonical = status === 'normalized' ? JSON.stringify(findings) : null;
  return {
    status,
    reason,
    findings,
    canonical,
    digest: canonical === null ? null : canonicalDigest(findings),
  };
}

function normalizeStructured(value) {
  if (!Array.isArray(value) || !value.every(validFinding)) {
    return result('invalid', [], 'product review JSON must be an exact finding array');
  }
  const seen = new Set();
  for (const finding of value) {
    if (seen.has(finding.finding_id)) {
      return result('invalid', [], `duplicate product review finding ${finding.finding_id}`);
    }
    seen.add(finding.finding_id);
  }
  return result('normalized', value.map((finding) => ({ ...finding })));
}

function normalizeProductReviewFindings(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return result('invalid', [], 'product review findings are empty');
  }
  const trimmed = raw.trim();
  // Exact clean sentinel emitted by dispatch-review for SHIP-AS-IS with no items.
  // Accept only trimmed case-insensitive `none` — not "no findings", empty, or prose.
  if (trimmed.toLowerCase() === 'none') {
    return result('normalized', []);
  }
  try {
    return normalizeStructured(JSON.parse(trimmed));
  } catch (_error) {
    // Natural-language reviews must use the bounded severity/id grammar below.
  }
  const findings = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.trim().match(
      /^(?:[-*]\s+)?(?:(🔴|🟠|🟡|🔵)(?:\s+(Critical|Major|Minor|Suggestion))?|(Critical|Major|Minor|Suggestion))\s+\[([A-Za-z0-9._:-]{1,128})\]\s+(.+)$/i,
    );
    const namedSeverity = (match && (match[2] || match[3]) || '').toLowerCase();
    const severity = match && (match[1] || SEVERITY_NAMES.get(namedSeverity));
    if (!match
        || (match[1] && namedSeverity
          && SEVERITY_NAMES.get(namedSeverity) !== match[1])
        || match[5].trim().length === 0) {
      return result('invalid', [], 'product review prose is ambiguous');
    }
    findings.push({
      finding_id: match[4],
      claim: match[5].trim(),
      severity,
      source: 'product-review',
    });
  }
  return normalizeStructured(findings);
}

// BL-0146 D3: incremental-return seat output. A seat that was shown prior open findings answers
// `{ findings: <finding array or "none">, resolutions: [{finding_id, status, evidence}] }`.
// The legacy entry point above is deliberately untouched (a bare finding array / prose / `none` stays
// the only accepted shape there), so a full round and every stored artifact keep today's bytes.
const RESOLUTION_STATUSES = new Set(['resolved', 'invalid', 'still_present']);
const RESOLUTION_KEYS = new Set(['finding_id', 'status', 'evidence']);
const EVIDENCE = /^[^\s:][^\s]*:[0-9]+(?:-[0-9]+)?$/;

function normalizeResolutions(value, priorFindingIds) {
  if (!Array.isArray(value)) return { error: 'resolutions must be an array' };
  const known = new Set(priorFindingIds);
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || !Object.keys(entry).every((key) => RESOLUTION_KEYS.has(key))
        || typeof entry.finding_id !== 'string'
        || !RESOLUTION_STATUSES.has(entry.status)
        || (entry.evidence !== undefined && typeof entry.evidence !== 'string')) {
      return { error: 'resolution entry is malformed' };
    }
    if (!known.has(entry.finding_id)) {
      return { error: `resolution names unknown finding ${entry.finding_id}` };
    }
    if (seen.has(entry.finding_id)) {
      return { error: `duplicate resolution for ${entry.finding_id}` };
    }
    seen.add(entry.finding_id);
    const evidence = typeof entry.evidence === 'string' ? entry.evidence.trim() : '';
    out.push({
      finding_id: entry.finding_id,
      status: entry.status,
      evidence: EVIDENCE.test(evidence) ? evidence : null,
      // resolved/invalid without path:line evidence is silence, not a verdict (plan 2.5).
      addressed: entry.status === 'still_present' || EVIDENCE.test(evidence),
    });
  }
  return { resolutions: out };
}

function normalizeSeatReview(raw, options = {}) {
  const priorFindingIds = Array.isArray(options.priorFindingIds) ? options.priorFindingIds : null;
  const withResolutions = (base, resolutions) => ({ ...base, resolutions });
  let parsed = null;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw.trim()); } catch (_error) { parsed = null; }
  }
  const objectForm = Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
  if (!objectForm) return withResolutions(normalizeProductReviewFindings(raw), []);
  if (priorFindingIds === null) {
    // A full round has no prior findings and never emits resolutions.
    return withResolutions(result('invalid', [], 'resolutions are only valid on an incremental round'), []);
  }
  const keys = Object.keys(parsed);
  if (!keys.every((key) => key === 'findings' || key === 'resolutions')
      || !Object.prototype.hasOwnProperty.call(parsed, 'findings')) {
    return withResolutions(result('invalid', [], 'seat review object must be {findings, resolutions}'), []);
  }
  const findings = typeof parsed.findings === 'string'
    ? normalizeProductReviewFindings(parsed.findings)
    : normalizeStructured(parsed.findings);
  if (findings.status !== 'normalized') return withResolutions(findings, []);
  const resolved = normalizeResolutions(
    Object.prototype.hasOwnProperty.call(parsed, 'resolutions') ? parsed.resolutions : [],
    priorFindingIds,
  );
  if (resolved.error) return withResolutions(result('invalid', [], resolved.error), []);
  return withResolutions(findings, resolved.resolutions);
}

module.exports = {
  normalizeProductReviewFindings,
  normalizeSeatReview,
};
