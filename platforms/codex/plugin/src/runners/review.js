'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { bufferToString } = require('../lib/common');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DISPATCH_REVIEW = path.join(REPO_ROOT, 'scripts', 'dispatch-review.sh');
const REVIEW_RESULT_FIELDS = ['runner', 'model', 'status', 'verdict', 'findings', 'raw_log', 'error'];
const REVIEW_STATUSES = ['reviewed', 'no_verdict', 'precondition_failed'];
const REVIEW_VERDICTS = ['SHIP-AS-IS', 'FIX-THEN-SHIP', null];


function validateReviewResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('review output JSON is not an object');
  }
  for (const field of REVIEW_RESULT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`review output JSON missing field: ${field}`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!REVIEW_RESULT_FIELDS.includes(field)) {
      throw new Error(`review output JSON has unknown field: ${field}`);
    }
  }
  if (typeof value.runner !== 'string' || value.runner.length === 0) {
    throw new Error('review output JSON field runner must be a non-empty string');
  }
  if (typeof value.model !== 'string' || value.model.length === 0) {
    throw new Error('review output JSON field model must be a non-empty string');
  }
  if (!REVIEW_STATUSES.includes(value.status)) {
    throw new Error(`review output JSON status must be one of: ${REVIEW_STATUSES.join(', ')}`);
  }
  if (!REVIEW_VERDICTS.includes(value.verdict)) {
    throw new Error('review output JSON verdict must be one of: SHIP-AS-IS, FIX-THEN-SHIP, null');
  }
  if (typeof value.findings !== 'string') {
    throw new Error('review output JSON field findings must be a string');
  }
  if (value.raw_log !== null && (typeof value.raw_log !== 'string' || value.raw_log.length === 0)) {
    throw new Error('review output JSON field raw_log must be null or non-empty string');
  }
  if (value.error !== null && (typeof value.error !== 'string' || value.error.length === 0)) {
    throw new Error('review output JSON field error must be null or non-empty string');
  }
  return value;
}

function parseReviewOutput(stdout) {
  const text = bufferToString(stdout);
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return validateReviewResult(JSON.parse(trimmed));
    } catch (_err) {
      // Fall through to line-oriented parsing; stdout may include non-JSON preface text.
    }
  }

  let lastParseError = null;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      return validateReviewResult(JSON.parse(line));
    } catch (error) {
      lastParseError = error;
    }
  }

  if (lastParseError) {
    throw lastParseError;
  }
  throw new Error('no JSON object found in review stdout');
}

function dispatchReview(args, options = {}) {
  const scriptPath = options.scriptPath || DISPATCH_REVIEW;
  if (!fs.existsSync(scriptPath)) {
    return {
      error: new Error(`dispatch-review.sh not found: ${scriptPath}`),
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

function dispatchReviewJson(args, options = {}) {
  const child = dispatchReview(args, {
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
      result: parseReviewOutput(stdout),
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
  dispatchReview,
  dispatchReviewJson,
  parseReviewOutput,
  DISPATCH_REVIEW,
};
