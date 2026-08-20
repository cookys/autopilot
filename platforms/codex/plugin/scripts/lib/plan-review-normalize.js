'use strict';

const crypto = require('crypto');
const fs = require('fs');
const {
  validateRunnerTransportEnvelope,
} = require('../../src/transport/runner-envelope');

const VERDICTS = new Set(['READY', 'CONDITIONAL', 'STOP']);
const CLASSES = new Set(['decision-now', 'implementation-spike', 'future']);
const SEVERITIES = new Set(['blocking', 'non-blocking']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateResponse(value) {
  if (!isRecord(value)
      || Object.keys(value).some((key) => !['verdict', 'findings'].includes(key))
      || !VERDICTS.has(value.verdict)
      || !Array.isArray(value.findings)) {
    throw new TypeError('plan-review payload must contain only verdict and findings');
  }
  const findings = value.findings.map((finding, index) => {
    if (!isRecord(finding)) throw new TypeError(`finding ${index + 1} must be an object`);
    const allowed = new Set([
      'rubric_id',
      'class',
      'severity',
      'affected_surface',
      'claim',
      'evidence',
      'evidence_reference',
      'repair',
      'blocks_next_slice_or_immediate_integrity',
      'cannot_defer_to_spike',
    ]);
    if (Object.keys(finding).some((key) => !allowed.has(key))) {
      throw new TypeError(`finding ${index + 1} has unsupported fields`);
    }
    for (const key of ['severity', 'evidence', 'repair']) {
      if (typeof finding[key] !== 'string' || finding[key].trim() === '') {
        throw new TypeError(`finding ${index + 1} has invalid ${key}`);
      }
    }
    if (!SEVERITIES.has(finding.severity)) {
      throw new TypeError(`finding ${index + 1} has invalid severity`);
    }
    if (finding.class !== undefined && !CLASSES.has(finding.class)) {
      throw new TypeError(`finding ${index + 1} has invalid class`);
    }
    return {
      ...finding,
      affected_surface: typeof finding.affected_surface === 'string'
        && finding.affected_surface.trim()
        ? finding.affected_surface.trim()
        : 'plan',
      claim: typeof finding.claim === 'string' && finding.claim.trim()
        ? finding.claim.trim()
        : finding.repair.trim(),
      evidence_reference: typeof finding.evidence_reference === 'string'
        && finding.evidence_reference.trim()
        ? finding.evidence_reference.trim()
        : finding.evidence.trim(),
    };
  });
  return { verdict: value.verdict, findings };
}

function objectCandidates(text) {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function parsePurposeBoundPayload(raw) {
  const normalized = String(raw)
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !/^Script (started|done) on /.test(line))
    .join('\n')
    .trim();
  try {
    return { payload: validateResponse(JSON.parse(normalized)), parser_status: 'strict' };
  } catch (strictError) {
    const valid = [];
    for (const candidate of objectCandidates(normalized)) {
      try {
        valid.push(validateResponse(JSON.parse(candidate)));
      } catch (error) {
        // Only complete objects matching this purpose-bound contract count.
      }
    }
    if (valid.length === 1) return { payload: valid[0], parser_status: 'extracted' };
    return {
      payload: null,
      parser_status: valid.length > 1 ? 'ambiguous' : 'invalid',
      error: valid.length > 1
        ? 'multiple plan-review payloads found'
        : 'no complete plan-review payload found',
    };
  }
}

function normalizePlanReviewPayload({ envelope, raw, expected }) {
  const transport = validateRunnerTransportEnvelope(envelope);
  if (transport.request_binding.operation !== 'plan-review'
      || transport.request_binding.runner !== expected.runner
      || transport.request_binding.model !== expected.model) {
    return {
      transport_status: 'identity_mismatch',
      semantic_status: 'unavailable',
      parser_status: 'not_attempted',
      payload: null,
    };
  }
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
  // Exit-first: a runner that failed or timed out reports THAT classification. The old
  // order checked raw binding first, so a 5m-killed codex seat (0-byte stdout → null
  // reference) surfaced as raw_binding_mismatch and hid the real cause (2026-08-20
  // incident, multiturn-event-harness G1). Binding is only meaningful for a run that
  // claims success.
  if (transport.outcome.classification !== 'success') {
    return {
      transport_status: transport.outcome.classification,
      semantic_status: 'unavailable',
      parser_status: 'not_attempted',
      payload: null,
    };
  }
  const reference = transport.private_raw_reference;
  if (!reference || reference.digest !== sha256(bytes)) {
    return {
      transport_status: 'raw_binding_mismatch',
      semantic_status: 'unavailable',
      parser_status: 'not_attempted',
      payload: null,
    };
  }
  const parsed = parsePurposeBoundPayload(bytes.toString('utf8'));
  return {
    transport_status: 'success',
    semantic_status: parsed.payload ? 'available' : 'unavailable',
    parser_status: parsed.parser_status,
    payload: parsed.payload,
    error: parsed.error || null,
  };
}

function readBoundRaw(envelope) {
  const transport = validateRunnerTransportEnvelope(envelope);
  if (!transport.private_raw_reference) {
    throw new TypeError('plan-review transport has no private raw reference');
  }
  return fs.readFileSync(transport.private_raw_reference.locator);
}

module.exports = {
  normalizePlanReviewPayload,
  objectCandidates,
  parsePurposeBoundPayload,
  readBoundRaw,
  validateResponse,
};
