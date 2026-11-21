'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
      'failure_scenario',
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
    if (finding.failure_scenario !== undefined && typeof finding.failure_scenario !== 'string') {
      throw new TypeError(`finding ${index + 1} has invalid failure_scenario`);
    }
    return {
      ...finding,
      failure_scenario: typeof finding.failure_scenario === 'string' ? finding.failure_scenario.trim() : '',
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

function objectCandidatesWithTail(text) {
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
  // clean_tail: the scan must not end inside a string or an unclosed object — a
  // mid-flush kill (timeout IS the kill classification) can leave a complete wrong
  // object plus a truncated right one; extract salvage must refuse that capture
  // (g2-adjudication #5). Trailing PROSE is fine; a trailing open brace is not.
  return { candidates, clean_tail: depth === 0 && !inString && start === -1 };
}

function objectCandidates(text) {
  return objectCandidatesWithTail(text).candidates;
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

// Salvage admission matrix (verdict-bytes preservation, plan R3 §3 + g2-adjudication
// #0/#3/#5). "Unratified" = content-verified, transport-unratified: the SAME
// purpose-bound parse, recorded in a non-authoritative observation for human
// adjudication. NO authoritative field changes on any path. raw_binding_mismatch /
// identity_mismatch never salvage (contradicted evidence); interrupted/unavailable
// admit strict parse only (mid-flush truncation risk); timeout/exit_failure/quota
// additionally admit a unique extracted object IFF the scan tail is clean.
const SALVAGE_EXTRACT = new Set(['timeout', 'exit_failure', 'quota']);
const SALVAGE_STRICT_ONLY = new Set(['interrupted', 'unavailable']);

function salvageUnratifiedPayload(transport, bytes) {
  const classification = transport.outcome.classification;
  const extractAllowed = SALVAGE_EXTRACT.has(classification);
  if (!extractAllowed && !SALVAGE_STRICT_ONLY.has(classification)) return null;
  const reference = transport.private_raw_reference;
  // Salvage requires the same identity binding success demands: a reference whose
  // digest matches the captured bytes. A failed run with no reference (the frozen
  // 2026-08-20 0-byte incident shape) has nothing bindable to salvage.
  if (!reference || reference.digest !== sha256(bytes)) return null;
  if (!bytes || bytes.length === 0) return null;
  const normalized = String(bytes)
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !/^Script (started|done) on /.test(line))
    .join('\n')
    .trim();
  if (!normalized) return null;
  try {
    return { payload: validateResponse(JSON.parse(normalized)), parser_status: 'strict' };
  } catch (strictError) {
    if (!extractAllowed) return null;
  }
  const scan = objectCandidatesWithTail(normalized);
  if (!scan.clean_tail) return null;
  const valid = [];
  for (const candidate of scan.candidates) {
    try {
      valid.push(validateResponse(JSON.parse(candidate)));
    } catch (error) {
      // Only complete objects matching this purpose-bound contract count.
    }
  }
  if (valid.length === 1) return { payload: valid[0], parser_status: 'extracted' };
  return null;
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
      unratified: null,
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
      unratified: salvageUnratifiedPayload(transport, bytes),
    };
  }
  const reference = transport.private_raw_reference;
  if (!reference || reference.digest !== sha256(bytes)) {
    return {
      transport_status: 'raw_binding_mismatch',
      semantic_status: 'unavailable',
      parser_status: 'not_attempted',
      payload: null,
      unratified: null,
    };
  }
  const parsed = parsePurposeBoundPayload(bytes.toString('utf8'));
  return {
    transport_status: 'success',
    semantic_status: parsed.payload ? 'available' : 'unavailable',
    parser_status: parsed.parser_status,
    payload: parsed.payload,
    error: parsed.error || null,
    unratified: null,
  };
}

function readBoundRaw(envelope) {
  const transport = validateRunnerTransportEnvelope(envelope);
  if (!transport.private_raw_reference) {
    throw new TypeError('plan-review transport has no private raw reference');
  }
  return fs.readFileSync(transport.private_raw_reference.locator);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimTrailingSlash(dir) {
  const stripped = String(dir).replace(/\/+$/, '');
  return stripped.length > 0 ? stripped : '';
}

function expandPathVariants(rawDir) {
  if (typeof rawDir !== 'string' || rawDir.trim() === '') return [];
  const variants = new Set();
  const resolved = trimTrailingSlash(path.resolve(rawDir));
  if (resolved) variants.add(resolved);
  if (path.isAbsolute(rawDir)) {
    const rawTrimmed = trimTrailingSlash(rawDir);
    if (rawTrimmed) variants.add(rawTrimmed);
  }
  try {
    const real = trimTrailingSlash(fs.realpathSync(rawDir));
    if (real) variants.add(real);
  } catch (error) {
    // Missing or unreadable env dirs still get textual path.resolve normalization above.
  }
  return [...variants];
}

function compileLocatorMatcher(options = {}) {
  const rules = new Map();
  const register = (dirs, placeholder) => {
    for (const dir of dirs) {
      for (const variant of expandPathVariants(dir)) {
        rules.set(variant, placeholder);
      }
    }
  };
  const homeDirs = Array.isArray(options.homeDirs)
    ? options.homeDirs
    : [process.env.HOME, os.homedir()];
  const runtimeDirs = Array.isArray(options.runtimeDirs)
    ? options.runtimeDirs
    : [process.env.XDG_RUNTIME_DIR];
  const tmpDirs = Array.isArray(options.tmpDirs)
    ? options.tmpDirs
    : [
      os.tmpdir(),
      process.env.TMPDIR,
      path.posix.join('/', 'tmp'),
      path.posix.join('/', 'private', 'tmp'),
    ];
  // Register home first, then runtime, then tmp so overlapping TMPDIR inside HOME maps to <tmp>.
  register(homeDirs, '~');
  register(runtimeDirs, '<runtime>');
  register(tmpDirs, '<tmp>');
  const sorted = [...rules.entries()].sort((a, b) => b[0].length - a[0].length);
  if (sorted.length === 0) return null;
  const alternation = sorted.map(([prefix]) => escapeRegExp(prefix)).join('|');
  // Match only at path-token boundaries; after a matched prefix only "/", end of string, whitespace, quotes, or closing brackets qualify.
  const regex = new RegExp(
    `(?<![^\\s"'\\x60(\\[{<=:,;])(${alternation})(?![^\\s/"'\\x60)\\]}>])`,
    'g',
  );
  return { regex, rules };
}

function applyLocatorMatcher(text, matcher) {
  if (typeof text !== 'string' || text.length === 0 || !matcher) return text;
  return text.replace(matcher.regex, (matched) => matcher.rules.get(matched) || matched);
}

/**
 * Redact absolute temp-dir, runtime-dir, and home-dir path prefixes in one string.
 */
function redactLocatorString(text, options = {}) {
  return applyLocatorMatcher(text, compileLocatorMatcher(options));
}

/**
 * Deep-clone an artifact or JSON payload, replacing temp-dir prefixes with <tmp>,
 * XDG runtime prefixes with <runtime>, and home prefixes with ~ without mutating input.
 */
function redactLocators(value, options = {}) {
  const matcher = compileLocatorMatcher(options);
  const skipKeys = options.skipKeys instanceof Set
    ? options.skipKeys
    : new Set(Array.isArray(options.skipKeys) ? options.skipKeys : []);

  const walk = (node) => {
    if (typeof node === 'string') return applyLocatorMatcher(node, matcher);
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (isRecord(node)) {
      const out = {};
      for (const [key, child] of Object.entries(node)) {
        out[key] = skipKeys.has(key) ? child : walk(child);
      }
      return out;
    }
    return node;
  };

  return walk(value);
}

module.exports = {
  normalizePlanReviewPayload,
  objectCandidates,
  objectCandidatesWithTail,
  parsePurposeBoundPayload,
  readBoundRaw,
  redactLocatorString,
  redactLocators,
  salvageUnratifiedPayload,
  validateResponse,
};
