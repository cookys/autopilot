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

module.exports = {
  normalizeProductReviewFindings,
};
