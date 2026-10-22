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

// BL-0226: the ONLY withdrawal signal is this fixed claim prefix (case-sensitive). A reviewer's
// free-form "withdrawn" prose is self-report (ADR-0001) and is never honoured. A marked finding
// leaves the live set (so a reused id is not a duplicate) but is kept as `advisory`, never verified.
const REVOKED_MARKER = /^REVOKED:/;
function isRevoked(finding) {
  return REVOKED_MARKER.test(finding.claim);
}

function result(status, findings = [], reason = null, advisory = []) {
  const canonical = status === 'normalized' ? JSON.stringify(findings) : null;
  return {
    status,
    reason,
    findings,
    canonical,
    digest: canonical === null ? null : canonicalDigest(findings),
    ...(advisory.length > 0 ? { advisory } : {}),
  };
}

function normalizeStructured(value) {
  if (!Array.isArray(value) || !value.every(validFinding)) {
    return result('invalid', [], 'product review JSON must be an exact finding array');
  }
  const live = value.filter((finding) => !isRevoked(finding)); // guard:revoked_filter
  const advisory = value.filter(isRevoked).map((finding) => ({ ...finding }));
  const seen = new Set();
  for (const finding of live) {
    if (seen.has(finding.finding_id)) {
      return result('invalid', [], `duplicate product review finding ${finding.finding_id}`);
    }
    seen.add(finding.finding_id);
  }
  return result('normalized', live.map((finding) => ({ ...finding })), null, advisory);
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

// BL-0146 D4: evidence `path:line` only counts when `path` is one of the files the seat was given
// (the packet's file list). A path the seat was never shown cannot be evidence about its code.
function evidenceInPacket(evidence, packetPaths) {
  const cut = evidence.lastIndexOf(':');
  return cut > 0 && packetPaths.has(evidence.slice(0, cut));
}

// A seat that drops the leading "prior:" still names one carried id when the remainder is unique.
// Suffix is the part after the last "prior:sN." prefix (review-increment-wiring carried ids).
function restorePriorFindingId(rawId, known) {
  if (typeof rawId !== 'string' || rawId.includes('prior:')) return null;
  const prefixed = [];
  const bySuffix = [];
  for (const id of known) {
    if (id === `prior:${rawId}`) prefixed.push(id);
    const matches = id.matchAll(/prior:s\d+\./g);
    let last = null;
    for (const match of matches) last = match;
    if (last && id.slice(last.index + last[0].length) === rawId) bySuffix.push(id);
  }
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) return null;
  if (bySuffix.length === 1) return bySuffix[0];
  return null;
}

// Lines before or after a JSON object: take the first balanced object. Never eval.
function extractBalancedJsonObject(text) {
  const source = String(text);
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < source.length; end += 1) {
      const ch = source[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const value = JSON.parse(source.slice(start, end + 1));
            if (value && typeof value === 'object' && !Array.isArray(value)) return value;
          } catch (_error) {
            // keep scanning later braces
          }
          break;
        }
      }
    }
  }
  return null;
}

function normalizeResolutions(value, priorFindingIds, packetPaths) {
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
      const restored = restorePriorFindingId(entry.finding_id, known);
      if (!restored) return { error: `resolution names unknown finding ${entry.finding_id}` };
      entry.finding_id = restored;
    }
    if (seen.has(entry.finding_id)) {
      return { error: `duplicate resolution for ${entry.finding_id}` };
    }
    seen.add(entry.finding_id);
    const evidence = typeof entry.evidence === 'string' ? entry.evidence.trim() : '';
    const validEvidence = EVIDENCE.test(evidence)
      && evidenceInPacket(evidence, packetPaths); // guard:evidence_in_packet
    out.push({
      finding_id: entry.finding_id,
      status: entry.status,
      evidence: validEvidence ? evidence : null,
      // resolved/invalid without path:line evidence is silence, not a verdict (plan 2.5).
      addressed: entry.status === 'still_present' || validEvidence,
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
    // Incremental seats often write finding lines and then the object. A full round
    // (priorFindingIds null) keeps the exact parse-the-whole-string behaviour.
    if (parsed === null && priorFindingIds !== null) parsed = extractBalancedJsonObject(raw);
  }
  const objectForm = Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
  if (!objectForm) return withResolutions(normalizeProductReviewFindings(raw), []);
  if (priorFindingIds === null) {
    // A full round has no prior findings and never emits resolutions.
    return withResolutions(result('invalid', [], 'resolutions are only valid on an incremental round'), []);
  }  const packetPaths = options.packetPaths instanceof Set ? options.packetPaths
    : (Array.isArray(options.packetPaths) ? new Set(options.packetPaths) : null);
  if (packetPaths === null || [...packetPaths].some((p) => typeof p !== 'string' || p.length === 0)) {
    // The path list is what evidence is checked against: without it nothing can be accepted.
    return withResolutions(result('invalid', [], 'packet path list is required to check resolution evidence'), []);
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
    packetPaths,
  );
  if (resolved.error) return withResolutions(result('invalid', [], resolved.error), []);
  return withResolutions(findings, resolved.resolutions);
}

// BL-0146 D3: a stored seat artifact's resolutions are re-derived, not trusted: each entry goes back
// through the same checks a fresh answer gets (known id, status, evidence path:line inside the packet).
// Anything that does not reproduce exactly is dropped to silence (an empty list), which can only keep a
// finding open, never close one.
function revalidateResolutions(stored, priorFindingIds, packetPaths) {
  if (!Array.isArray(stored) || stored.length === 0) return [];
  if (!Array.isArray(priorFindingIds)) return [];
  const paths = packetPaths instanceof Set ? packetPaths : new Set(Array.isArray(packetPaths) ? packetPaths : []);
  if (paths.size === 0) return [];
  const raw = stored.map((entry) => ({
    finding_id: entry && entry.finding_id,
    status: entry && entry.status,
    ...(entry && typeof entry.evidence === 'string' ? { evidence: entry.evidence } : {}),
  }));
  const redone = normalizeResolutions(raw, priorFindingIds, paths);
  if (redone.error) return [];
  return JSON.stringify(redone.resolutions) === JSON.stringify(stored) ? redone.resolutions : [];
}

module.exports = {
  revalidateResolutions,
  normalizeProductReviewFindings,
  normalizeSeatReview,
};
