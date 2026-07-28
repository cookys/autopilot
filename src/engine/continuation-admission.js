'use strict';

/**
 * Pre-dispatch continuation admission.
 *
 * Authoritative engine/dispatcher boundary: before a new implementer dispatch,
 * rehydrate the compaction checkpoint (root run, phase cursor, accepted commit,
 * next action) and attach/resume an existing active or terminal matching run
 * instead of dispatching again. Incomplete checkpoints fail closed. Absent
 * identities remain not_found.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ARTIFACT_TYPE = 'continuation_checkpoint';
const SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isGitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,64}$/i.test(value);
}

/**
 * Required authoritative fields for compaction-safe rehydration.
 * accepted_commit may be the literal "none" when no commit has been accepted yet.
 */
function checkpointMissingFields(checkpoint) {
  if (!isPlainObject(checkpoint)) return ['checkpoint'];
  const missing = [];
  if (checkpoint.schema_version !== SCHEMA_VERSION) missing.push('schema_version');
  if (checkpoint.artifact_type !== ARTIFACT_TYPE) missing.push('artifact_type');
  if (!isNonEmptyString(checkpoint.root_run_id)) missing.push('root_run_id');
  if (!isNonEmptyString(checkpoint.phase_cursor)) missing.push('phase_cursor');
  if (!isNonEmptyString(checkpoint.next_action)) missing.push('next_action');
  if (!(checkpoint.accepted_commit === 'none' || isGitSha(checkpoint.accepted_commit))) {
    missing.push('accepted_commit');
  }
  return missing;
}

function isCompleteCheckpoint(checkpoint) {
  return checkpointMissingFields(checkpoint).length === 0;
}

function canonicalCheckpointBody(checkpoint) {
  return {
    schema_version: SCHEMA_VERSION,
    artifact_type: ARTIFACT_TYPE,
    root_run_id: checkpoint.root_run_id,
    phase_cursor: checkpoint.phase_cursor,
    accepted_commit: checkpoint.accepted_commit,
    next_action: checkpoint.next_action,
    ...(isNonEmptyString(checkpoint.project) ? { project: checkpoint.project } : {}),
    ...(isNonEmptyString(checkpoint.branch) ? { branch: checkpoint.branch } : {}),
    ...(isNonEmptyString(checkpoint.stage) ? { stage: checkpoint.stage } : {}),
    ...(isNonEmptyString(checkpoint.base_sha) ? { base_sha: checkpoint.base_sha } : {}),
    ...(isNonEmptyString(checkpoint.idempotency_key)
      ? { idempotency_key: checkpoint.idempotency_key }
      : {}),
  };
}

function checkpointDigest(checkpoint) {
  const body = canonicalCheckpointBody(checkpoint);
  return crypto.createHash('sha256')
    .update(JSON.stringify(body), 'utf8')
    .digest('hex');
}

function buildCheckpoint(fields) {
  if (!isPlainObject(fields)) {
    throw new TypeError('buildCheckpoint requires a plain object');
  }
  const checkpoint = {
    schema_version: SCHEMA_VERSION,
    artifact_type: ARTIFACT_TYPE,
    root_run_id: fields.root_run_id,
    phase_cursor: fields.phase_cursor,
    accepted_commit: fields.accepted_commit,
    next_action: fields.next_action,
  };
  if (isNonEmptyString(fields.project)) checkpoint.project = fields.project;
  if (isNonEmptyString(fields.branch)) checkpoint.branch = fields.branch;
  if (isNonEmptyString(fields.stage)) checkpoint.stage = fields.stage;
  if (isNonEmptyString(fields.base_sha)) checkpoint.base_sha = fields.base_sha;
  if (isNonEmptyString(fields.idempotency_key)) {
    checkpoint.idempotency_key = fields.idempotency_key;
  }
  const missing = checkpointMissingFields(checkpoint);
  if (missing.length > 0) {
    const err = new Error(`incomplete continuation checkpoint: missing ${missing.join(',')}`);
    err.code = 'incomplete_checkpoint';
    err.missing = missing;
    throw err;
  }
  checkpoint.digest = checkpointDigest(checkpoint);
  return checkpoint;
}

function rehydrateCheckpoint(checkpoint) {
  const missing = checkpointMissingFields(checkpoint);
  if (missing.length > 0) {
    return {
      status: 'reject',
      reason_code: 'incomplete_checkpoint',
      reason: `incomplete continuation checkpoint: missing ${missing.join(',')}`,
      missing,
      duplicate_dispatch: 0,
      rehydrated: null,
    };
  }
  if (isNonEmptyString(checkpoint.digest)) {
    const expected = checkpointDigest(checkpoint);
    if (checkpoint.digest !== expected) {
      return {
        status: 'reject',
        reason_code: 'checkpoint_digest_mismatch',
        reason: 'continuation checkpoint digest does not match authoritative fields',
        duplicate_dispatch: 0,
        rehydrated: null,
      };
    }
  }
  return {
    status: 'rehydrated',
    reason_code: null,
    reason: null,
    duplicate_dispatch: 0,
    rehydrated: {
      root_run_id: checkpoint.root_run_id,
      phase_cursor: checkpoint.phase_cursor,
      accepted_commit: checkpoint.accepted_commit,
      next_action: checkpoint.next_action,
      project: checkpoint.project || null,
      branch: checkpoint.branch || null,
      stage: checkpoint.stage || null,
      base_sha: checkpoint.base_sha || null,
      idempotency_key: checkpoint.idempotency_key || null,
      digest: checkpoint.digest || checkpointDigest(checkpoint),
    },
  };
}

function loadCheckpointFile(filePath) {
  if (!isNonEmptyString(filePath)) {
    return {
      status: 'reject',
      reason_code: 'incomplete_checkpoint',
      reason: 'checkpoint path is required',
      missing: ['checkpoint'],
      duplicate_dispatch: 0,
      rehydrated: null,
    };
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return {
      status: 'reject',
      reason_code: 'incomplete_checkpoint',
      reason: `checkpoint file not found: ${resolved}`,
      missing: ['checkpoint'],
      duplicate_dispatch: 0,
      rehydrated: null,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    return {
      status: 'reject',
      reason_code: 'incomplete_checkpoint',
      reason: `checkpoint is not valid JSON: ${error.message || String(error)}`,
      missing: ['checkpoint'],
      duplicate_dispatch: 0,
      rehydrated: null,
    };
  }
  return rehydrateCheckpoint(parsed);
}

function normalizeRunRecord(run) {
  if (!isPlainObject(run)) return null;
  const runId = run.run_id || run.runId || null;
  const rootRunId = run.root_run_id || run.rootRunId || runId;
  if (!isNonEmptyString(runId) || !isNonEmptyString(rootRunId)) return null;
  const finalStatus = run.final_status === undefined || run.final_status === null
    ? null
    : String(run.final_status);
  const endedAt = run.ended_at === undefined || run.ended_at === null
    ? null
    : run.ended_at;
  const active = finalStatus === null || finalStatus === '' || finalStatus === 'null';
  return {
    run_id: runId,
    root_run_id: rootRunId,
    stage: run.stage || null,
    branch: run.branch || null,
    base: run.base || null,
    base_sha: run.base_sha || run.baseSha || null,
    final_status: active ? null : finalStatus,
    ended_at: endedAt,
    active,
    terminal: !active,
  };
}

function runMatchesIdentity(run, identity) {
  if (!run || !identity || !isNonEmptyString(identity.root_run_id)) return false;
  if (run.root_run_id !== identity.root_run_id) return false;
  if (isNonEmptyString(identity.stage) && isNonEmptyString(run.stage)
      && run.stage !== identity.stage) {
    return false;
  }
  if (isNonEmptyString(identity.branch) && isNonEmptyString(run.branch)
      && run.branch !== identity.branch) {
    return false;
  }
  if (isNonEmptyString(identity.base_sha)) {
    const runBase = run.base_sha || run.base;
    if (isNonEmptyString(runBase) && runBase !== identity.base_sha) return false;
  }
  return true;
}

/**
 * Admit or attach a dispatch under a stable continuation identity.
 *
 * @param {object} input
 * @param {object} [input.identity] - { root_run_id, stage?, branch?, base_sha? }
 * @param {object|null} [input.checkpoint] - parsed checkpoint or null
 * @param {string|null} [input.checkpointPath] - load checkpoint from path
 * @param {Array} [input.matchingRuns] - known runs (manifests / registry)
 * @param {boolean} [input.requireIdentity=true] - absent root_run_id → not_found
 * @returns {object} admission decision
 */
function admitContinuation(input = {}) {
  const identity = isPlainObject(input.identity) ? input.identity : {};
  const requireIdentity = input.requireIdentity !== false;
  const rootRunId = identity.root_run_id;

  let rehydration = null;
  if (isNonEmptyString(input.checkpointPath)) {
    rehydration = loadCheckpointFile(input.checkpointPath);
  } else if (input.checkpoint != null) {
    rehydration = rehydrateCheckpoint(input.checkpoint);
  }

  if (rehydration && rehydration.status === 'reject') {
    return {
      status: 'reject',
      action: 'fail_closed',
      reason_code: rehydration.reason_code,
      reason: rehydration.reason,
      missing: rehydration.missing || null,
      duplicate_dispatch: 0,
      root_run_id: rootRunId || null,
      phase_cursor: null,
      accepted_commit: null,
      next_action: null,
      attached_run_id: null,
      rehydrated: null,
    };
  }

  const rehydrated = rehydration ? rehydration.rehydrated : null;
  const effectiveRoot = (rehydrated && rehydrated.root_run_id) || rootRunId || null;

  if (requireIdentity && !isNonEmptyString(effectiveRoot)) {
    return {
      status: 'not_found',
      action: 'not_found',
      reason_code: 'not_found',
      reason: 'continuation identity root_run_id is absent',
      duplicate_dispatch: 0,
      root_run_id: null,
      phase_cursor: rehydrated ? rehydrated.phase_cursor : null,
      accepted_commit: rehydrated ? rehydrated.accepted_commit : null,
      next_action: rehydrated ? rehydrated.next_action : null,
      attached_run_id: null,
      rehydrated,
    };
  }

  const matchIdentity = {
    root_run_id: effectiveRoot,
    stage: identity.stage || (rehydrated && rehydrated.stage) || null,
    branch: identity.branch || (rehydrated && rehydrated.branch) || null,
    base_sha: identity.base_sha || (rehydrated && rehydrated.base_sha) || null,
  };

  const runs = Array.isArray(input.matchingRuns)
    ? input.matchingRuns.map(normalizeRunRecord).filter(Boolean)
    : [];
  const matches = runs.filter((run) => runMatchesIdentity(run, matchIdentity));

  if (matches.length === 0 && requireIdentity && input.strictMatch === true) {
    return {
      status: 'not_found',
      action: 'not_found',
      reason_code: 'not_found',
      reason: `no active or terminal run matches root_run_id=${effectiveRoot}`,
      duplicate_dispatch: 0,
      root_run_id: effectiveRoot,
      phase_cursor: rehydrated ? rehydrated.phase_cursor : null,
      accepted_commit: rehydrated ? rehydrated.accepted_commit : null,
      next_action: rehydrated ? rehydrated.next_action : null,
      attached_run_id: null,
      rehydrated,
    };
  }

  const active = matches.find((run) => run.active);
  if (active) {
    return {
      status: 'attach',
      action: 'attach_existing',
      reason_code: null,
      reason: 'active matching run; attach instead of re-dispatch',
      duplicate_dispatch: 0,
      root_run_id: effectiveRoot,
      phase_cursor: rehydrated ? rehydrated.phase_cursor : null,
      accepted_commit: rehydrated ? rehydrated.accepted_commit : null,
      next_action: rehydrated ? rehydrated.next_action : null,
      attached_run_id: active.run_id,
      matching_run: active,
      rehydrated,
    };
  }

  const terminal = matches.find((run) => run.terminal);
  if (terminal) {
    return {
      status: 'resume',
      action: 'resume_terminal',
      reason_code: null,
      reason: 'terminal matching run; resume instead of re-dispatch',
      duplicate_dispatch: 0,
      root_run_id: effectiveRoot,
      phase_cursor: rehydrated ? rehydrated.phase_cursor : null,
      accepted_commit: rehydrated ? rehydrated.accepted_commit : null,
      next_action: rehydrated ? rehydrated.next_action : null,
      attached_run_id: terminal.run_id,
      matching_run: terminal,
      rehydrated,
    };
  }

  // No matching run: admit a new dispatch only when rehydration succeeded or
  // identity is present without strictMatch. With a rehydrated checkpoint the
  // phase cursor is authoritative for the new (or continued) work.
  if (rehydrated) {
    return {
      status: 'admit',
      action: 'dispatch_new',
      reason_code: null,
      reason: 'rehydrated continuation identity with no matching run; admit new dispatch once',
      duplicate_dispatch: 0,
      root_run_id: effectiveRoot,
      phase_cursor: rehydrated.phase_cursor,
      accepted_commit: rehydrated.accepted_commit,
      next_action: rehydrated.next_action,
      attached_run_id: null,
      rehydrated,
    };
  }

  if (!isNonEmptyString(effectiveRoot) && requireIdentity) {
    return {
      status: 'not_found',
      action: 'not_found',
      reason_code: 'not_found',
      reason: 'continuation identity root_run_id is absent',
      duplicate_dispatch: 0,
      root_run_id: null,
      phase_cursor: null,
      accepted_commit: null,
      next_action: null,
      attached_run_id: null,
      rehydrated: null,
    };
  }

  return {
    status: 'admit',
    action: 'dispatch_new',
    reason_code: null,
    reason: 'no continuation checkpoint or matching run; admit new dispatch',
    duplicate_dispatch: 0,
    root_run_id: effectiveRoot,
    phase_cursor: null,
    accepted_commit: null,
    next_action: null,
    attached_run_id: null,
    rehydrated: null,
  };
}

/**
 * Scan a dispatch-runs manifest directory for runs matching identity.
 * Fail-soft: unreadable dirs / bad JSON are skipped.
 */
function loadMatchingRunsFromManifestDir(manifestDir, identity = {}) {
  if (!isNonEmptyString(manifestDir) || !fs.existsSync(manifestDir)) return [];
  let names;
  try {
    names = fs.readdirSync(manifestDir);
  } catch (_error) {
    return [];
  }
  const runs = [];
  for (const name of names) {
    if (!name.endsWith('.manifest.json')) continue;
    const file = path.join(manifestDir, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const normalized = normalizeRunRecord(parsed);
      if (!normalized) continue;
      if (identity && isNonEmptyString(identity.root_run_id)
          && !runMatchesIdentity(normalized, identity)) {
        continue;
      }
      runs.push(normalized);
    } catch (_error) {
      // skip corrupt manifests
    }
  }
  return runs;
}

module.exports = {
  ARTIFACT_TYPE,
  SCHEMA_VERSION,
  admitContinuation,
  buildCheckpoint,
  checkpointDigest,
  checkpointMissingFields,
  isCompleteCheckpoint,
  loadCheckpointFile,
  loadMatchingRunsFromManifestDir,
  normalizeRunRecord,
  rehydrateCheckpoint,
  runMatchesIdentity,
};
