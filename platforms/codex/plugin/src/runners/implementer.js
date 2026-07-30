'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { isImmutableGitSha, bufferToString, findJsonObjectCandidates } = require('../lib/common');
const { createRunnerTransportEnvelope } = require('../transport/runner-envelope');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DISPATCH_HETERO = path.join(REPO_ROOT, 'scripts', 'dispatch-hetero.sh');
const IMPLEMENT_RESULT_FIELDS = [
  'status',
  'runner',
  'model',
  'branch',
  'base',
  'commit',
  'files_changed',
  'insertions',
  'deletions',
  'worktree',
  'agent_log',
  'error',
];

const IMPLEMENT_STATUSES = [
  'committed',
  'no_op',
  'question_suspected',
  'dirty',
  'failure',
  'acceptance_failed',
  'precondition_failed',
  'engine_unavailable',
];

function isSealedZeroDiffAdmission(value) {
  return value.status === 'no_op'
    && value.runner === 'sealed-zero-diff-admission'
    && value.model === null
    && value.commit === null
    && value.worktree === null
    && value.agent_log === null
    && value.error === null
    && value.dispatcher_called === false
    && value.files_changed === 0
    && value.insertions === 0
    && value.deletions === 0
    && value.model_calls === 0
    && value.mutation_attempts === 0
    && value.gate_attempts === 0
    && value.resources_created === 0
    && typeof value.zero_diff_receipt_digest === 'string'
    && /^[0-9a-f]{64}$/.test(value.zero_diff_receipt_digest);
}

function validateImplementationResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('dispatch-hetero output JSON is not an object');
  }

  for (const field of IMPLEMENT_RESULT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`dispatch-hetero output JSON missing field: ${field}`);
    }
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'status')) {
    throw new Error('dispatch-hetero output JSON missing status');
  }
  if (!IMPLEMENT_STATUSES.includes(value.status)) {
    throw new Error(`dispatch-hetero output JSON status must be one of: ${IMPLEMENT_STATUSES.join(', ')}`);
  }
  if (typeof value.runner !== 'string' || value.runner.length === 0) {
    throw new Error('dispatch-hetero output JSON field runner must be a non-empty string');
  }
  const sealedZeroDiffAdmission = isSealedZeroDiffAdmission(value);
  if (!sealedZeroDiffAdmission
      && (typeof value.model !== 'string' || value.model.length === 0)) {
    throw new Error('dispatch-hetero output JSON field model must be a non-empty string');
  }
  if (value.status !== 'precondition_failed') {
    if (typeof value.branch !== 'string' || value.branch.length === 0) {
      throw new Error('dispatch-hetero output JSON field branch must be a non-empty string');
    }
    if (typeof value.base !== 'string' || value.base.length === 0) {
      throw new Error('dispatch-hetero output JSON field base must be a non-empty string');
    }
    if (!sealedZeroDiffAdmission
        && (typeof value.containment !== 'string' || value.containment.length === 0)) {
      throw new Error('dispatch-hetero output JSON field containment must be a non-empty string');
    }
    if (!sealedZeroDiffAdmission && typeof value.contained !== 'boolean') {
      throw new Error('dispatch-hetero output JSON field contained must be a boolean');
    }
  }

  if (value.commit !== null && (typeof value.commit !== 'string' || value.commit.length === 0)) {
    throw new Error('dispatch-hetero output JSON field commit must be null or non-empty string');
  }
  if (value.status === 'committed' && value.commit === null) {
    throw new Error('dispatch-hetero output JSON status committed requires a non-empty commit');
  }
  if (value.status === 'committed' && !isImmutableGitSha(value.commit)) {
    throw new Error('dispatch-hetero output JSON status committed requires a full immutable git SHA commit');
  }
  if (!Number.isInteger(value.files_changed) || value.files_changed < 0) {
    throw new Error('dispatch-hetero output JSON field files_changed must be a non-negative integer');
  }
  if (!Number.isInteger(value.insertions) || value.insertions < 0) {
    throw new Error('dispatch-hetero output JSON field insertions must be a non-negative integer');
  }
  if (!Number.isInteger(value.deletions) || value.deletions < 0) {
    throw new Error('dispatch-hetero output JSON field deletions must be a non-negative integer');
  }
  if (value.worktree !== null && (typeof value.worktree !== 'string' || value.worktree.length === 0)) {
    throw new Error('dispatch-hetero output JSON field worktree must be null or non-empty string');
  }
  if (value.agent_log !== null && (typeof value.agent_log !== 'string' || value.agent_log.length === 0)) {
    throw new Error('dispatch-hetero output JSON field agent_log must be null or non-empty string');
  }
  if (value.error !== null && (typeof value.error !== 'string' || value.error.length === 0)) {
    throw new Error('dispatch-hetero output JSON field error must be null or non-empty string');
  }

  return value;
}


function looksLikeImplementationResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return IMPLEMENT_RESULT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function parseImplementationOutput(stdout) {
  const text = bufferToString(stdout);
  const { candidates, trailingUnclosedStart } = findJsonObjectCandidates(text);
  let lastParseError = null;

  const lastCandidate = candidates[candidates.length - 1];
  if (lastCandidate && trailingUnclosedStart >= lastCandidate.end) {
    throw new Error('trailing incomplete JSON object found in dispatch-hetero stdout');
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    let parsed;
    try {
      parsed = JSON.parse(candidates[i].source);
    } catch (error) {
      lastParseError = error;
      continue;
    }
    try {
      return validateImplementationResult(parsed);
    } catch (error) {
      if (looksLikeImplementationResult(parsed)) {
        throw error;
      }
      lastParseError = error;
    }
  }

  if (lastParseError) {
    throw lastParseError;
  }
  if (trailingUnclosedStart !== -1) {
    throw new Error('incomplete JSON object found in dispatch-hetero stdout');
  }
  throw new Error('no JSON object found in dispatch-hetero stdout');
}

function dispatchImplement(args, options = {}) {
  const scriptPath = options.scriptPath || DISPATCH_HETERO;
  if (!fs.existsSync(scriptPath)) {
    return {
      error: new Error(`dispatch-hetero.sh not found: ${scriptPath}`),
      status: null,
      signal: null,
    };
  }
  try {
    return spawnSync(scriptPath, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      stdio: options.stdio || 'inherit',
    });
  } catch (error) {
    return { error, status: null, signal: null };
  }
}

function dispatchImplementJson(args, options = {}) {
  const child = dispatchImplement(args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = bufferToString(child.stdout);
  const stderr = bufferToString(child.stderr);
  const argValue = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 && typeof args[index + 1] === 'string' ? args[index + 1] : null;
  };
  const transportEnvelope = createRunnerTransportEnvelope({
    runner: argValue('--runner') || 'unknown',
    model: argValue('--model') || 'unknown',
    operation: 'implement',
    argv: args,
    cwd: options.cwd || process.cwd(),
    child: { ...child, stdout, stderr },
    outcomeHints: options.transportOutcomeHints,
    privateRawReference: options.privateRawReference,
  });

  if (child.error) {
    return {
      error: child.error,
      status: child.status,
      signal: child.signal,
      stdout,
      stderr,
      result: null,
      parseError: null,
      transportEnvelope,
    };
  }

  try {
    return {
      error: child.error || null,
      status: child.status,
      signal: child.signal,
      stdout,
      stderr,
      result: parseImplementationOutput(stdout),
      parseError: null,
      transportEnvelope,
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
      transportEnvelope,
    };
  }
}

module.exports = {
  dispatchImplement,
  dispatchImplementJson,
  parseImplementationOutput,
  validateImplementationResult,
  looksLikeImplementationResult,
  isImmutableGitSha,
  DISPATCH_HETERO,
};
