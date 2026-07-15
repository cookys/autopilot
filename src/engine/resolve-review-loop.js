'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { bufferToString, findJsonObjectCandidates } = require('../lib/common');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RESOLVE_REVIEW_LOOP = path.join(REPO_ROOT, 'scripts', 'resolve-review-loop.sh');
const MAX_REVIEW_LOOP_STDOUT_BYTES = 1024 * 1024;

// Single source of truth for the always-emitted review-loop contract fields.
// REVIEW_LOOP_FIELDS (ordered list) and the assertOneOf enum tables below are
// DERIVED from schemas/review-loop-contract.schema.json — do not hand-maintain a
// second copy. Resolved relative to __dirname so the codex-mirror copy finds ITS
// sibling schema.
const CONTRACT_SCHEMA = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', '..', 'schemas', 'review-loop-contract.schema.json'),
    'utf8',
  ),
);
const REVIEW_LOOP_FIELDS = CONTRACT_SCHEMA['x-field-order'];
if (
  !Array.isArray(REVIEW_LOOP_FIELDS)
  || REVIEW_LOOP_FIELDS.length === 0
  || !REVIEW_LOOP_FIELDS.every((f) => typeof f === 'string' && f.length > 0)
) {
  throw new Error('review-loop-contract schema x-field-order must be a non-empty array of field-name strings');
}

function schemaEnum(field) {
  const prop = CONTRACT_SCHEMA.properties && CONTRACT_SCHEMA.properties[field];
  if (!prop || !Array.isArray(prop.enum)) {
    throw new Error(`review-loop-contract schema missing enum for field: ${field}`);
  }
  return prop.enum;
}


function assertField(value, field, predicate, expected) {
  if (!Object.prototype.hasOwnProperty.call(value, field)) {
    throw new Error(`review-loop output JSON missing field: ${field}`);
  }
  if (!predicate(value[field])) {
    throw new Error(`review-loop output JSON field ${field} must be ${expected}`);
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function emptyString(value) {
  return typeof value === 'string' && value.length === 0;
}

function assertOneOf(value, field, allowed) {
  assertField(value, field, (v) => allowed.includes(v), `one of: ${allowed.join(', ')}`);
}

function validateReviewLoopConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('review-loop output JSON is not an object');
  }

  for (const field of REVIEW_LOOP_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`review-loop output JSON missing field: ${field}`);
    }
  }

  for (const field of [
    'reviewer_engine',
    'reviewer_effort',
    'reviewer_runner',
    'implementer_engine',
    'implementer_effort',
    'implementer_runner',
    'loop_convergence_verdict',
    'spec_review',
    'independent_harness',
    'qc_panel_aggregation',
    'review_risk',
    'review_diff_scope',
    'source',
    'work_domain',
    'domain_source',
    'capability_state_source',
    'quota_status',
    'skill_mode_requested',
    'skill_mode_effective',
  ]) {
    assertField(value, field, nonEmptyString, 'a non-empty string');
  }
  assertOneOf(value, 'reviewer_effort', schemaEnum('reviewer_effort'));
  assertOneOf(value, 'implementer_effort', schemaEnum('implementer_effort'));
  // claude-native (dispatch-review.sh) is deliberately NOT roster-eligible — it is a measurement/probe runner; an unknown reviewer_runner here silently falls back to the default.
  assertOneOf(value, 'reviewer_runner', schemaEnum('reviewer_runner'));
  assertOneOf(value, 'implementer_runner', schemaEnum('implementer_runner'));
  assertOneOf(value, 'spec_review', schemaEnum('spec_review'));
  assertOneOf(value, 'independent_harness', schemaEnum('independent_harness'));
  assertOneOf(value, 'qc_panel_aggregation', schemaEnum('qc_panel_aggregation'));
  assertOneOf(value, 'review_risk', schemaEnum('review_risk'));
  assertOneOf(value, 'review_diff_scope', schemaEnum('review_diff_scope'));
  assertOneOf(value, 'work_domain', schemaEnum('work_domain'));
  assertOneOf(value, 'domain_source', schemaEnum('domain_source'));
  assertField(value, 'loop_max_rounds', (v) => Number.isInteger(v), 'an integer');
  assertField(value, 'required_review_families', (v) => Number.isInteger(v), 'an integer');
  assertField(value, 'qc_panel', Array.isArray, 'an array');
  for (const member of value.qc_panel) {
    if (!nonEmptyString(member)) {
      throw new Error('review-loop output JSON field qc_panel must contain only non-empty strings');
    }
  }
  for (const field of ['l1_required', 'cross_family_required', 'cross_family_satisfied']) {
    assertField(value, field, (v) => typeof v === 'boolean', 'a boolean');
  }
  assertField(value, 'quota_reset_at', (v) => v === null || typeof v === 'string', 'a string or null');
  assertField(value, 'capability_warnings', Array.isArray, 'an array');
  for (const member of value.capability_warnings) {
    if (typeof member !== 'string') {
      throw new Error('review-loop output JSON field capability_warnings must contain only strings');
    }
  }
  for (const field of [
    'reviewer_endpoint',
    'implementer_endpoint',
    'verification_author_engine',
    'verification_author_runner',
    'verification_author_effort',
    'verification_author_endpoint',
    'verification_author_family',
    'implementer_family',
    'config_path',
  ]) {
    assertField(value, field, (v) => typeof v === 'string', 'a string');
  }
  assertField(value, 'verification_author_present', (v) => typeof v === 'boolean', 'a boolean');
  assertOneOf(value, 'verification_author_runner', schemaEnum('verification_author_runner'));
  assertOneOf(value, 'verification_author_effort', schemaEnum('verification_author_effort'));
  if (value.verification_author_present) {
    for (const field of [
      'verification_author_engine',
      'verification_author_runner',
      'verification_author_effort',
    ]) {
      assertField(value, field, nonEmptyString, 'a non-empty string');
    }
  } else {
    for (const field of [
      'verification_author_engine',
      'verification_author_runner',
      'verification_author_effort',
      'verification_author_endpoint',
    ]) {
      assertField(value, field, emptyString, 'an empty string');
    }
  }
  assertField(value, 'min_panel_size', (v) => Number.isInteger(v) && v >= 1, 'an integer >= 1');
  assertOneOf(value, 'on_engine_unavailable', schemaEnum('on_engine_unavailable'));
  for (const field of ['reviewer_fallback_preference', 'reviewer_fallback_preference_low_risk']) {
    assertField(value, field, Array.isArray, 'an array');
    for (const member of value[field]) {
      if (typeof member !== 'string' || member.length === 0) {
        throw new Error(`review-loop output JSON field ${field} must contain only non-empty strings`);
      }
    }
  }

  const hasReviewerQualified = Object.prototype.hasOwnProperty.call(value, 'reviewer_qualified');
  const hasFallbackLadder = Object.prototype.hasOwnProperty.call(value, 'fallback_ladder');
  if (hasReviewerQualified !== hasFallbackLadder) {
    throw new Error('review-loop output JSON must include reviewer_qualified and fallback_ladder together');
  }
  if (hasReviewerQualified) {
    assertField(value, 'reviewer_qualified', (v) => typeof v === 'boolean', 'a boolean');
  }
  if (hasFallbackLadder) {
    assertField(value, 'fallback_ladder', Array.isArray, 'an array');
  }
  // Conditional provenance for the family-conflict fallback (v2.32.25): names the
  // implementer family the ladder was computed against so a stale pre-resolved
  // roster can be detected. Emitted alongside fallback_ladder by --check-scorecard.
  if (Object.prototype.hasOwnProperty.call(value, 'fallback_ladder_implementer_family')) {
    assertField(value, 'fallback_ladder_implementer_family', (v) => typeof v === 'string', 'a string');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'verify_first')) {
    assertField(value, 'verify_first', (v) => typeof v === 'boolean', 'a boolean');
  }

  return value;
}


function looksLikeReviewLoopConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [...REVIEW_LOOP_FIELDS, 'reviewer_qualified', 'fallback_ladder', 'verify_first'].some((field) =>
    Object.prototype.hasOwnProperty.call(value, field),
  );
}

function parseReviewLoopOutput(stdout) {
  const text = bufferToString(stdout);
  if (Buffer.byteLength(text, 'utf8') > MAX_REVIEW_LOOP_STDOUT_BYTES) {
    throw new Error('review-loop stdout exceeds maximum parse size');
  }

  const { candidates, trailingUnclosedStart } = findJsonObjectCandidates(text);

  const lastCandidate = candidates[candidates.length - 1];
  if (lastCandidate && trailingUnclosedStart >= lastCandidate.end) {
    throw new Error('trailing incomplete JSON object found in review-loop stdout');
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    let parsed;
    try {
      parsed = JSON.parse(candidates[i].source);
    } catch (error) {
      continue;
    }

    try {
      return validateReviewLoopConfig(parsed);
    } catch (error) {
      if (looksLikeReviewLoopConfig(parsed)) {
        throw error;
      }
    }
  }

  if (trailingUnclosedStart !== -1) {
    throw new Error('incomplete JSON object found in review-loop stdout');
  }
  throw new Error('no JSON object found in review-loop stdout');
}

function resolveReviewLoop(args, options = {}) {
  const scriptPath = options.scriptPath || RESOLVE_REVIEW_LOOP;
  if (!fs.existsSync(scriptPath)) {
    return {
      error: new Error(`resolve-review-loop.sh not found: ${scriptPath}`),
      status: null,
      signal: null,
    };
  }
  try {
    return spawnSync(scriptPath, args, {
      cwd: options.cwd || REPO_ROOT,
      env: options.env || process.env,
      shell: false,
      stdio: options.stdio || 'inherit',
    });
  } catch (error) {
    return { error, status: null, signal: null };
  }
}

function resolveReviewLoopJson(args = [], options = {}) {
  const child = resolveReviewLoop(args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = bufferToString(child.stdout);
  const stderr = bufferToString(child.stderr);

  if (child.error) {
    return {
      error: child.error,
      status: child.status,
      signal: child.signal,
      stdout,
      stderr,
      result: null,
      parseError: null,
    };
  }

  try {
    return {
      error: child.error || null,
      status: child.status,
      signal: child.signal,
      stdout,
      stderr,
      result: parseReviewLoopOutput(stdout),
      parseError: null,
    };
  } catch (error) {
    return {
      error: child.error || null,
      status: child.status,
      signal: child.signal,
      stdout,
      stderr,
      result: null,
      parseError: error,
    };
  }
}

module.exports = {
  resolveReviewLoop,
  REVIEW_LOOP_FIELDS,
  resolveReviewLoopJson,
  parseReviewLoopOutput,
  validateReviewLoopConfig,
  findJsonObjectCandidates,
  looksLikeReviewLoopConfig,
  RESOLVE_REVIEW_LOOP,
};
