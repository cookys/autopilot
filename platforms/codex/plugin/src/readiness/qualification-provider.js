'use strict';

const crypto = require('crypto');
const {
  normalizeProviderTuple,
  providerTupleDigest,
} = require('./provider-readiness');

const providers = new WeakMap();
const receipts = new WeakMap();

function createQualificationProvider({ qualify, providerId = 'host-injected' } = {}) {
  if (typeof qualify !== 'function') throw new TypeError('host qualification callback is required');
  const provider = Object.freeze(Object.create(null));
  providers.set(provider, { qualify, providerId, consumed: new WeakSet() });
  return provider;
}

function issueExactRoleQualification(provider, { tuple, now, ttlSeconds = 300 } = {}) {
  const state = providers.get(provider);
  if (!state) throw new TypeError('qualification provider is not a live host-injected authority');
  const bound = normalizeProviderTuple(tuple);
  if (!['implementer', 'verification_author', 'reviewer', 'qc'].includes(bound.role)) {
    throw new TypeError('qualification role is unsupported');
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
    throw new TypeError('qualification ttlSeconds is invalid');
  }
  const issuedMs = Date.parse(now);
  if (!Number.isFinite(issuedMs)) throw new TypeError('qualification now is invalid');
  const verdict = state.qualify(Object.freeze({ ...bound }));
  if (verdict !== true) return null;
  // No enumerable fields: JSON.stringify(receipt) yields {}, which cannot be
  // replayed. All authority lives in this process's WeakMap and is one-shot.
  const receipt = Object.freeze(Object.create(null));
  receipts.set(receipt, {
    provider,
    tuple: bound,
    tupleDigest: providerTupleDigest(bound),
    issuedAt: new Date(issuedMs).toISOString(),
    expiresAt: issuedMs + ttlSeconds * 1000,
    nonce: crypto.randomBytes(32),
    providerId: state.providerId,
  });
  return receipt;
}

function consumeExactRoleQualification(provider, receipt, { tuple, now } = {}) {
  const state = providers.get(provider);
  const sealed = receipts.get(receipt);
  if (!state || !sealed || sealed.provider !== provider || state.consumed.has(receipt)) {
    throw new Error('qualification receipt is absent, foreign, serialized, or replayed');
  }
  const bound = normalizeProviderTuple(tuple);
  if (providerTupleDigest(bound) !== sealed.tupleDigest) {
    throw new Error('qualification receipt exact tuple mismatch');
  }
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || nowMs < Date.parse(sealed.issuedAt) || nowMs >= sealed.expiresAt) {
    throw new Error('qualification receipt is outside its validity window');
  }
  state.consumed.add(receipt);
  return {
    schema_version: 1,
    artifact_type: 'provider_axis_observation',
    tuple: bound,
    axis: 'qualification',
    status: 'ready',
    observed_at: sealed.issuedAt,
    ttl_seconds: Math.max(1, Math.floor((sealed.expiresAt - Date.parse(sealed.issuedAt)) / 1000)),
    evidence_class: 'host-injected-exact-role',
    reason: null,
  };
}

function qualifyExactRoleNow(provider, tuple, now, ttlSeconds = 300) {
  const receipt = issueExactRoleQualification(provider, { tuple, now, ttlSeconds });
  return receipt ? consumeExactRoleQualification(provider, receipt, { tuple, now }) : null;
}

module.exports = {
  createQualificationProvider,
  issueExactRoleQualification,
  consumeExactRoleQualification,
  qualifyExactRoleNow,
};
