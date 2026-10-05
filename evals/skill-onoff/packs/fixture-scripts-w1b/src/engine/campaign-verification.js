'use strict';

const crypto = require('crypto');
const { scan: scanSecretPatterns } = require('../../hooks/_shared/secret-patterns');

const VERIFICATION_RECEIPT_SCHEMA_VERSION = 1;
const MANDATORY_ENV_ALLOWLIST = Object.freeze(['PATH']);
const DEFAULT_ENV_ALLOWLIST = Object.freeze([
  ...MANDATORY_ENV_ALLOWLIST,
  'CI',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'TZ',
]);
const SECRET_NAME = /(AUTH|COOKIE|CREDENTIAL|DATABASE_URL|DB_URL|CONNECTION_STRING|KEY|PASSWORD|SECRET|TOKEN)/i;
const SENSITIVE_URL_FIELD = /auth|bearer|code|cookie|credential|jwt|key|pass|pwd|saml|sas|secret|session|sig|token/i;
const PRIVATE_KEY_VALUE = /\bPRIVATE KEY\b|PuTTY-User-Key-File-\d+:|AGE-SECRET-KEY-/i;
const LEDGER_TERMINAL_STATES = new Set(['committed', 'reviewed', 'verified', 'merged']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
  return output;
}

function canonicalDigest(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function isGitObject(value) {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

function receiptBody(receipt, label) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError(`${label} must be a receipt object`);
  }
  const { receipt_digest: digest, ...body } = receipt;
  if (digest !== canonicalDigest(body)) {
    throw new TypeError(`${label} digest is invalid`);
  }
  return body;
}

function verificationArgv(verifyCmd) {
  if (typeof verifyCmd !== 'string' || verifyCmd.length === 0) {
    throw new TypeError('verifyCmd must be a non-empty string');
  }
  return ['/bin/sh', '-c', verifyCmd];
}

function containsSecretValue(value) {
  if (PRIVATE_KEY_VALUE.test(value)
      || /^(?:basic|bearer)\s+\S+/i.test(value)
      || scanSecretPatterns(value).length > 0) {
    return true;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed
        && typeof parsed === 'object'
        && !Array.isArray(parsed)
        && typeof parsed.kty === 'string'
        && typeof parsed.d === 'string') {
      return true;
    }
  } catch (_error) {
    // Non-JSON environment values continue to URL inspection.
  }
  const sensitiveField = (name) => SENSITIVE_URL_FIELD.test(
    String(name).toLowerCase().replace(/[^a-z0-9]/g, ''),
  );
  const assignments = String(value).matchAll(
    /(?:^|[;,\s&])([^=;,\s&]+)\s*=\s*([^;,\s&]+)/g,
  );
  for (const assignment of assignments) {
    if (sensitiveField(assignment[1])) return true;
  }
  const candidates = /^jdbc:/i.test(value) ? [value, value.slice(5)] : [value];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.username.length > 0 || parsed.password.length > 0) return true;
      for (const name of parsed.searchParams.keys()) {
        if (sensitiveField(name)) return true;
      }
      const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
      if (fragment.length > 0) {
        const fragmentParams = new URLSearchParams(fragment);
        for (const name of fragmentParams.keys()) {
          if (sensitiveField(name)) return true;
        }
      }
    } catch (_error) {
      // Ordinary non-URL values are handled by the assignment scanner.
    }
  }
  return false;
}

function environmentFingerprint(env = process.env, allowlist = DEFAULT_ENV_ALLOWLIST) {
  if (!Array.isArray(allowlist)
      || allowlist.some((name) => typeof name !== 'string' || name.length === 0)) {
    throw new TypeError('environment allowlist must contain non-empty names');
  }
  const projection = {};
  const names = new Set([...MANDATORY_ENV_ALLOWLIST, ...allowlist]);
  for (const name of [...names].sort()) {
    const present = Object.prototype.hasOwnProperty.call(env, name);
    const rawValue = present ? env[name] : null;
    const value = present ? String(rawValue) : null;
    if (name === 'PATH') {
      if (typeof rawValue !== 'string'
          || rawValue.length === 0
          || containsSecretValue(rawValue)) {
        throw new TypeError('verification environment requires a concrete non-secret PATH');
      }
      projection[name] = rawValue;
      continue;
    }
    if (SECRET_NAME.test(name)
        || (value !== null && containsSecretValue(value))) {
      continue;
    }
    projection[name] = value;
  }
  return canonicalDigest(projection);
}

function createVerificationRequest({
  treeSha,
  verifyCmd,
  env = process.env,
  envAllowlist = DEFAULT_ENV_ALLOWLIST,
}) {
  if (!isGitObject(treeSha)) {
    throw new TypeError('treeSha must be a full immutable Git object id');
  }
  const request = {
    tree_sha: treeSha,
    argv_hash: canonicalDigest(verificationArgv(verifyCmd)),
    env_fingerprint: environmentFingerprint(env, envAllowlist),
  };
  return {
    ...request,
    request_digest: canonicalDigest(request),
  };
}

function createWriterFence({
  campaignId,
  stageIdentity,
  candidateCommit,
  candidateTreeSha,
  implementationResult,
}) {
  if (typeof campaignId !== 'string' || campaignId.length === 0
      || typeof stageIdentity !== 'string' || stageIdentity.length === 0
      || !isGitObject(candidateCommit)
      || !isGitObject(candidateTreeSha)) {
    throw new TypeError('writer fence identity is invalid');
  }
  const implementation = implementationResult && implementationResult.implementation;
  const transport = implementationResult && implementationResult.implementationResult;
  const directDispatchClosed = Boolean(
    transport
      && !transport.error
      && !transport.signal
      && transport.status === 0,
  );
  let ledgerReconciliation = null;
  if (!directDispatchClosed && implementation && implementation.reconcile_by_ledger === true) {
    ledgerReconciliation = receiptBody(
      implementation.reconciliation_receipt,
      'ledger reconciliation',
    );
    if (ledgerReconciliation.schema_version !== 1
        || ledgerReconciliation.artifact_type
          !== 'implementation_campaign_ledger_reconciliation'
        || ledgerReconciliation.campaign_id !== campaignId
        || ledgerReconciliation.stage_identity !== stageIdentity
        || ledgerReconciliation.candidate_commit !== candidateCommit
        || ledgerReconciliation.status !== 'closed') {
      throw new TypeError('ledger reconciliation receipt binding is invalid');
    }
  }
  const reconciledFromTerminalLedger = ledgerReconciliation !== null;
  const hasAnyCampaignDigest = Boolean(
    implementation
      && (implementation.campaign_contract_sha256
        || implementation.unit_contract_sha256
        || implementation.contract_sha256),
  );
  const hasCampaignDigestChain = Boolean(
    implementation
      && implementation.campaign_contract_sha256
      && implementation.unit_contract_sha256,
  );
  if (hasAnyCampaignDigest
      && (!hasCampaignDigestChain
        || !/^[0-9a-f]{64}$/.test(implementation.campaign_contract_sha256)
        || !/^[0-9a-f]{64}$/.test(implementation.unit_contract_sha256)
        || implementation.contract_sha256 !== implementation.unit_contract_sha256
        || implementation.boundary !== 'ok'
        || implementation.acceptance !== 'ok')) {
    throw new TypeError('writer fence campaign dispatch digest chain is invalid');
  }
  if (!implementationResult
      || implementationResult.status !== 'committed'
      || !implementation
      || implementation.commit !== candidateCommit
      || (!directDispatchClosed && !reconciledFromTerminalLedger)) {
    throw new TypeError('writer fence requires a completed committed implementation stage');
  }
  const body = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_writer_fence',
    campaign_id: campaignId,
    stage_identity: stageIdentity,
    candidate_commit: candidateCommit,
    candidate_tree_sha: candidateTreeSha,
    status: 'closed',
    evidence_mode: reconciledFromTerminalLedger ? 'terminal_ledger' : 'dispatch_exit',
    closure_evidence_digest: reconciledFromTerminalLedger
      ? implementation.reconciliation_receipt.receipt_digest
      : canonicalDigest({
        exit_status: transport.status,
        signal: transport.signal || null,
        candidate_commit: candidateCommit,
      }),
    ...(hasCampaignDigestChain ? {
      campaign_contract_sha256: implementation.campaign_contract_sha256,
      unit_contract_sha256: implementation.unit_contract_sha256,
    } : {}),
  };
  return {
    ...body,
    receipt_digest: canonicalDigest(body),
  };
}

function createLedgerReconciliationReceipt({
  campaignId,
  stageIdentity,
  candidateCommit,
  reconcileResult,
  latestRecord,
}) {
  if (typeof campaignId !== 'string' || campaignId.length === 0
      || typeof stageIdentity !== 'string' || stageIdentity.length === 0
      || !isGitObject(candidateCommit)
      || !reconcileResult
      || typeof reconcileResult !== 'object'
      || !latestRecord
      || typeof latestRecord !== 'object') {
    throw new TypeError('ledger reconciliation identity is invalid');
  }
  const terminalClosure = reconcileResult.reason === 'terminal_state'
    && reconcileResult.terminal === true
    && LEDGER_TERMINAL_STATES.has(latestRecord.state);
  const gitTruthClosure = reconcileResult.reason === 'git_truth'
    && reconcileResult.git_truth === true
    && reconcileResult.holder_alive === false;
  if (reconcileResult.status !== 'resolved'
      || reconcileResult.run_id !== campaignId
      || reconcileResult.stage !== stageIdentity
      || reconcileResult.pending_side_effects !== 0
      || reconcileResult.holder_alive !== false
      || !Number.isSafeInteger(latestRecord.pid)
      || latestRecord.pid <= 0
      || !Number.isSafeInteger(latestRecord.start_time)
      || latestRecord.start_time <= 0
      || !Number.isSafeInteger(latestRecord.heartbeat_ts)
      || latestRecord.heartbeat_ts <= 0
      || (!terminalClosure && !gitTruthClosure)
      || !Number.isSafeInteger(reconcileResult.generation)
      || reconcileResult.generation !== latestRecord.generation
      || reconcileResult.state !== latestRecord.state
      || typeof reconcileResult.nonce !== 'string'
      || reconcileResult.nonce.length === 0
      || reconcileResult.nonce !== latestRecord.nonce
      || latestRecord.kind !== 'stage'
      || latestRecord.run_id !== campaignId
      || latestRecord.stage !== stageIdentity
      || latestRecord.git_sha !== candidateCommit
      || !Number.isSafeInteger(latestRecord.generation)
      || latestRecord.generation < 0) {
    throw new TypeError('ledger reconciliation does not prove a closed implementation writer');
  }
  const body = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_ledger_reconciliation',
    campaign_id: campaignId,
    stage_identity: stageIdentity,
    candidate_commit: candidateCommit,
    ledger_generation: latestRecord.generation,
    lease_nonce_digest: sha256(latestRecord.nonce),
    status: 'closed',
    reason: reconcileResult.reason,
    reconcile_result_digest: canonicalDigest(reconcileResult),
    ledger_record_digest: canonicalDigest(latestRecord),
  };
  return {
    ...body,
    receipt_digest: canonicalDigest(body),
  };
}

function createDetachedCheckoutAttestation({
  candidateCommit,
  candidateTreeSha,
  worktreeResult,
}) {
  if (!isGitObject(candidateCommit) || !isGitObject(candidateTreeSha)) {
    throw new TypeError('detached checkout identity is invalid');
  }
  if (!worktreeResult
      || worktreeResult.error
      || worktreeResult.signal
      || worktreeResult.status !== 0
      || worktreeResult.detached !== true
      || worktreeResult.commit !== candidateCommit
      || worktreeResult.observed_commit !== candidateCommit
      || worktreeResult.observed_tree_sha !== candidateTreeSha
      || typeof worktreeResult.worktree !== 'string'
      || worktreeResult.worktree.length === 0) {
    throw new TypeError('verification checkout is not attested detached and immutable');
  }
  const body = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_checkout_attestation',
    candidate_commit: candidateCommit,
    candidate_tree_sha: candidateTreeSha,
    mode: 'detached',
    worktree_path_digest: sha256(worktreeResult.worktree),
  };
  return {
    ...body,
    receipt_digest: canonicalDigest(body),
  };
}

function createVerificationReceipt({
  campaignId,
  request,
  exitStatus,
  startedAt,
  endedAt,
  writerFence,
  checkoutAttestation,
  executedArgv,
  stdout = '',
  stderr = '',
}) {
  if (typeof campaignId !== 'string' || campaignId.length === 0) {
    throw new TypeError('campaignId is required');
  }
  if (!request || request.request_digest !== canonicalDigest({
    tree_sha: request.tree_sha,
    argv_hash: request.argv_hash,
    env_fingerprint: request.env_fingerprint,
  })) {
    throw new TypeError('verification request binding is invalid');
  }
  if (!Number.isInteger(exitStatus)) throw new TypeError('exitStatus must be an integer');
  if (!Array.isArray(executedArgv)
      || executedArgv.length === 0
      || !executedArgv.every((part) => typeof part === 'string')
      || canonicalDigest(executedArgv) !== request.argv_hash) {
    throw new TypeError('verification runner argv attestation does not match the request');
  }
  const writerFenceBody = receiptBody(writerFence, 'writer fence');
  const checkoutBody = receiptBody(checkoutAttestation, 'checkout attestation');
  if (writerFenceBody.schema_version !== 1
      || writerFenceBody.artifact_type !== 'implementation_campaign_writer_fence'
      || writerFenceBody.campaign_id !== campaignId
      || writerFenceBody.status !== 'closed'
      || writerFenceBody.candidate_tree_sha !== request.tree_sha
      || checkoutBody.schema_version !== 1
      || checkoutBody.artifact_type !== 'implementation_campaign_checkout_attestation'
      || checkoutBody.mode !== 'detached'
      || checkoutBody.candidate_tree_sha !== request.tree_sha
      || checkoutBody.candidate_commit !== writerFenceBody.candidate_commit) {
    throw new TypeError('authoritative verification fence or checkout binding is invalid');
  }
  if (!Number.isFinite(Date.parse(startedAt))
      || !Number.isFinite(Date.parse(endedAt))
      || Date.parse(endedAt) < Date.parse(startedAt)) {
    throw new TypeError('verification timestamps are invalid');
  }
  const body = {
    schema_version: VERIFICATION_RECEIPT_SCHEMA_VERSION,
    artifact_type: 'implementation_campaign_verification',
    campaign_id: campaignId,
    tree_sha: request.tree_sha,
    argv_hash: request.argv_hash,
    env_fingerprint: request.env_fingerprint,
    request_digest: request.request_digest,
    verdict: exitStatus === 0 ? 'GREEN' : 'RED',
    exit_status: exitStatus,
    writer_lease_closed: true,
    detached_checkout: true,
    runner_argv_attested: true,
    writer_fence_digest: writerFence.receipt_digest,
    checkout_attestation_digest: checkoutAttestation.receipt_digest,
    stdout_digest: sha256(String(stdout)),
    stderr_digest: sha256(String(stderr)),
    started_at: startedAt,
    ended_at: endedAt,
  };
  return {
    ...body,
    receipt_digest: canonicalDigest(body),
  };
}

function reusableGreenReceipt(receipt, request) {
  if (!receipt || receipt.verdict !== 'GREEN' || receipt.exit_status !== 0) return false;
  if (receipt.writer_lease_closed !== true
      || receipt.detached_checkout !== true
      || receipt.runner_argv_attested !== true) {
    return false;
  }
  if (!/^[0-9a-f]{64}$/.test(receipt.writer_fence_digest || '')
      || !/^[0-9a-f]{64}$/.test(receipt.checkout_attestation_digest || '')) {
    return false;
  }
  if (receipt.tree_sha !== request.tree_sha
      || receipt.argv_hash !== request.argv_hash
      || receipt.env_fingerprint !== request.env_fingerprint
      || receipt.request_digest !== request.request_digest) {
    return false;
  }
  const { receipt_digest: digest, ...body } = receipt;
  return digest === canonicalDigest(body);
}

module.exports = {
  DEFAULT_ENV_ALLOWLIST,
  VERIFICATION_RECEIPT_SCHEMA_VERSION,
  canonicalDigest,
  createDetachedCheckoutAttestation,
  createLedgerReconciliationReceipt,
  createVerificationReceipt,
  createVerificationRequest,
  createWriterFence,
  environmentFingerprint,
  reusableGreenReceipt,
  verificationArgv,
};
