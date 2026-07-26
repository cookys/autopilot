'use strict';

const crypto = require('crypto');

const VERIFICATION_RECEIPT_SCHEMA_VERSION = 1;
const DEFAULT_ENV_ALLOWLIST = Object.freeze(['CI', 'LANG', 'LC_ALL', 'NODE_ENV', 'TZ']);
const SECRET_NAME = /(AUTH|COOKIE|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)/i;

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

function verificationArgv(verifyCmd) {
  if (typeof verifyCmd !== 'string' || verifyCmd.length === 0) {
    throw new TypeError('verifyCmd must be a non-empty string');
  }
  return ['/bin/sh', '-lc', verifyCmd];
}

function environmentFingerprint(env = process.env, allowlist = DEFAULT_ENV_ALLOWLIST) {
  if (!Array.isArray(allowlist)
      || allowlist.some((name) => typeof name !== 'string' || name.length === 0)) {
    throw new TypeError('environment allowlist must contain non-empty names');
  }
  const projection = {};
  for (const name of [...new Set(allowlist)].sort()) {
    if (SECRET_NAME.test(name)) continue;
    projection[name] = Object.prototype.hasOwnProperty.call(env, name)
      ? String(env[name])
      : null;
  }
  return canonicalDigest(projection);
}

function createVerificationRequest({
  treeSha,
  verifyCmd,
  env = process.env,
  envAllowlist = DEFAULT_ENV_ALLOWLIST,
}) {
  if (typeof treeSha !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(treeSha)) {
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

function createVerificationReceipt({
  campaignId,
  request,
  exitStatus,
  startedAt,
  endedAt,
  writerLeaseClosed,
  detachedCheckout,
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
  if (writerLeaseClosed !== true || detachedCheckout !== true) {
    throw new TypeError('authoritative verification requires a closed writer and detached checkout');
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
  if (receipt.writer_lease_closed !== true || receipt.detached_checkout !== true) return false;
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
  createVerificationReceipt,
  createVerificationRequest,
  environmentFingerprint,
  reusableGreenReceipt,
  verificationArgv,
};
