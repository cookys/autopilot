'use strict';

const {
  resolveReviewLoopJson,
} = require('../engine/resolve-review-loop');
const {
  collectProviderReadinessBundle,
} = require('./status');
const {
  createQualificationProvider,
} = require('./qualification-provider');
const {
  canonicalDigest,
  consumeProviderReadinessBeforeSpend,
} = require('./receipt');

const POLICY_ENTRY_KEYS = new Set(['claim_id', 'tuple']);
const POLICY_TUPLE_KEYS = new Set([
  'runner',
  'model',
  'role',
  'effort',
  'endpoint',
  'family',
]);
const PROVIDER_TUPLE_KEYS = ['role', 'runner', 'model', 'effort', 'endpoint'];
const CODE_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const ENDPOINT_RE = /^[A-Za-z0-9_]{1,128}$/;
const CLAIM_RE = /^cap-v1-[0-9a-f]{64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SORT_EQUAL = 0;

class StrictL5ProviderBootstrapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StrictL5ProviderBootstrapError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new StrictL5ProviderBootstrapError(code, message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)
      || Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))) {
    fail('strict_l5_provider_policy_invalid', `${label} must have the exact required fields`);
  }
}

function boundedCode(value, label) {
  if (typeof value !== 'string' || !CODE_RE.test(value)) {
    fail('strict_l5_provider_tuple_unresolved', `${label} must be an exact bounded value`);
  }
  return value;
}

function boundedModel(value, label) {
  if (typeof value !== 'string'
      || value.trim().length === 0
      || value !== value.trim()
      || value.length > 256
      || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('strict_l5_provider_tuple_unresolved', `${label} must be an exact bounded model`);
  }
  return value;
}

function endpoint(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !ENDPOINT_RE.test(value)) {
    fail('strict_l5_provider_tuple_unresolved', `${label} must be canonical null or a named endpoint`);
  }
  return value;
}

function canonicalEndpoint(value, label) {
  if (value === '' || value === null) return null;
  if (value === undefined) {
    fail('strict_l5_provider_tuple_unresolved', `${label} is unresolved`);
  }
  return endpoint(value, label);
}

function normalizeStrictTuple(value, label = 'strict /l5 provider tuple') {
  exactKeys(value, POLICY_TUPLE_KEYS, label);
  return {
    runner: boundedCode(value.runner, `${label}.runner`),
    model: boundedModel(value.model, `${label}.model`),
    role: boundedCode(value.role, `${label}.role`),
    effort: boundedCode(value.effort, `${label}.effort`),
    endpoint: endpoint(value.endpoint, `${label}.endpoint`),
    family: boundedCode(value.family, `${label}.family`),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const STRICT_L5_CLAIM_IDS = deepFreeze([
  'cap-v1-781c5519e00aaf01911c5680d41e30ceb34fb4037d9ac3559146e35c02d15f61',
  'cap-v1-bca28cd7d6916ef0b87e555b914d384e93ae18d00d4d4358f03a19e114839fe2',
  'cap-v1-457d6083dbfb5f225185a21f49dbab55fe82ba91e97d4ab6759d2bfe2677318a',
  'cap-v1-ca37452a0f5de7391db73db82d1d280179c610635a0b012a1e35eaa75b6a8129',
  'cap-v1-9854b4497d0a2ddc3735ac0dac15078a5bae5840c741637dc16402362a019f9c',
  'cap-v1-4afeb9cc7200233255c91510646ac4135e61322b8ee93b64864e85f4a7582ed5',
]);

const STRICT_L5_PROVIDER_POLICY = deepFreeze([
  {
    claim_id: STRICT_L5_CLAIM_IDS[0],
    tuple: {
      runner: 'cc-shim',
      model: 'GLM-5.2',
      role: 'verification_author',
      effort: 'high',
      endpoint: 'glm',
      family: 'zhipu',
    },
  },
  {
    claim_id: STRICT_L5_CLAIM_IDS[1],
    tuple: {
      runner: 'cc-shim',
      model: 'GLM-5.2',
      role: 'qc',
      effort: 'high',
      endpoint: 'glm',
      family: 'zhipu',
    },
  },
  {
    claim_id: STRICT_L5_CLAIM_IDS[2],
    tuple: {
      runner: 'codex',
      model: 'gpt-5.6-sol',
      role: 'qc',
      effort: 'max',
      endpoint: null,
      family: 'openai',
    },
  },
  {
    claim_id: STRICT_L5_CLAIM_IDS[3],
    tuple: {
      runner: 'grok',
      model: 'grok-4.5',
      role: 'implementer',
      effort: 'high',
      endpoint: null,
      family: 'xai',
    },
  },
  {
    claim_id: STRICT_L5_CLAIM_IDS[4],
    tuple: {
      runner: 'cc-shim',
      model: 'MiniMax-M3',
      role: 'qc',
      effort: 'high',
      endpoint: 'minimax',
      family: 'minimax',
    },
  },
  {
    claim_id: STRICT_L5_CLAIM_IDS[5],
    tuple: {
      runner: 'cc-shim',
      model: 'MiniMax-M3',
      role: 'reviewer',
      effort: 'high',
      endpoint: 'minimax',
      family: 'minimax',
    },
  },
]);

const STRICT_L5_PROVIDER_POLICY_DIGEST = canonicalDigest(STRICT_L5_PROVIDER_POLICY);
const authorityState = new WeakMap();

function normalizePolicyCandidate(value) {
  if (!Array.isArray(value) || value.length !== STRICT_L5_CLAIM_IDS.length) {
    fail(
      'strict_l5_provider_claim_set_drift',
      'strict /l5 provider policy must contain the complete D4 claim set',
    );
  }
  const seenClaims = new Set();
  const seenTuples = new Set();
  return value.map((entry, index) => {
    exactKeys(entry, POLICY_ENTRY_KEYS, `strict /l5 provider policy entry ${index}`);
    if (typeof entry.claim_id !== 'string' || !CLAIM_RE.test(entry.claim_id)) {
      fail('strict_l5_provider_claim_substitution', 'strict /l5 claim ID is invalid');
    }
    if (entry.claim_id !== STRICT_L5_CLAIM_IDS[index]) {
      fail(
        'strict_l5_provider_claim_substitution',
        'strict /l5 claim IDs do not match the canonical D4 order',
      );
    }
    if (seenClaims.has(entry.claim_id)) {
      fail('strict_l5_provider_claim_duplicate', 'strict /l5 claim IDs contain a duplicate');
    }
    seenClaims.add(entry.claim_id);
    const tuple = normalizeStrictTuple(entry.tuple, `strict /l5 provider policy entry ${index}.tuple`);
    const tupleKey = canonicalDigest(tuple);
    if (seenTuples.has(tupleKey)) {
      fail('strict_l5_provider_tuple_duplicate', 'strict /l5 policy contains a duplicate tuple');
    }
    seenTuples.add(tupleKey);
    return { claim_id: entry.claim_id, tuple };
  });
}

function validateStrictL5ProviderPolicy(
  candidate = STRICT_L5_PROVIDER_POLICY,
  suppliedDigest = STRICT_L5_PROVIDER_POLICY_DIGEST,
) {
  if (typeof suppliedDigest !== 'string' || !SHA256_RE.test(suppliedDigest)) {
    fail('strict_l5_provider_policy_digest_drift', 'strict /l5 policy digest is invalid');
  }
  const normalized = normalizePolicyCandidate(candidate);
  const computed = canonicalDigest(normalized);
  if (computed !== STRICT_L5_PROVIDER_POLICY_DIGEST
      || suppliedDigest !== STRICT_L5_PROVIDER_POLICY_DIGEST
      || computed !== suppliedDigest) {
    fail('strict_l5_provider_policy_digest_drift', 'strict /l5 provider policy digest drifted');
  }
  return normalized;
}

function tupleSort(left, right) {
  for (const field of ['role', 'runner', 'model', 'effort', 'endpoint', 'family']) {
    const a = left.tuple[field] === null ? '' : left.tuple[field];
    const b = right.tuple[field] === null ? '' : right.tuple[field];
    const compared = a.localeCompare(b);
    if (compared !== 0) return compared;
  }
  return SORT_EQUAL;
}

function resolvedTuple(role, runner, model, effort, rawEndpoint, family, label) {
  return normalizeStrictTuple({
    runner,
    model,
    role,
    effort,
    endpoint: canonicalEndpoint(rawEndpoint, `${label}.endpoint`),
    family,
  }, label);
}

function deriveStrictL5InvocationPolicy(resolved) {
  if (!isRecord(resolved)) {
    fail('strict_l5_provider_roster_unavailable', 'strict /l5 review roster is unavailable');
  }
  const seats = [
    {
      seat_id: 'implementer',
      tuple: resolvedTuple(
        'implementer',
        resolved.implementer_runner,
        resolved.implementer_engine,
        resolved.implementer_effort,
        resolved.implementer_endpoint,
        resolved.implementer_family,
        'strict /l5 implementer tuple',
      ),
    },
    {
      seat_id: 'reviewer',
      tuple: resolvedTuple(
        'reviewer',
        resolved.reviewer_runner,
        resolved.reviewer_engine,
        resolved.reviewer_effort,
        resolved.reviewer_endpoint,
        resolved.reviewer_family,
        'strict /l5 reviewer tuple',
      ),
    },
  ];
  if (resolved.verification_author_present !== true) {
    fail(
      'strict_l5_provider_roster_incomplete',
      'strict /l5 requires the verification-author seat',
    );
  }
  seats.push({
    seat_id: 'verification_author',
    tuple: resolvedTuple(
      'verification_author',
      resolved.verification_author_runner,
      resolved.verification_author_engine,
      resolved.verification_author_effort,
      resolved.verification_author_endpoint,
      resolved.verification_author_family,
      'strict /l5 verification-author tuple',
    ),
  });

  if (resolved.qc_panel_seats_complete !== true
      || !Array.isArray(resolved.qc_panel_seats)
      || resolved.qc_panel_seats.length === 0) {
    fail('strict_l5_provider_roster_incomplete', 'strict /l5 exact QC roster is incomplete');
  }
  for (const [index, seat] of resolved.qc_panel_seats.entries()) {
    seats.push({
      seat_id: `qc:${index + 1}`,
      tuple: normalizeStrictTuple(seat, `strict /l5 QC tuple ${index + 1}`),
    });
  }

  const fallbackRows = resolved.fallback_ladder === undefined
    ? []
    : resolved.fallback_ladder;
  if (!Array.isArray(fallbackRows)) {
    fail('strict_l5_provider_roster_incomplete', 'strict /l5 fallback roster is invalid');
  }
  for (const [index, row] of fallbackRows.entries()) {
    if (!isRecord(row)) {
      fail('strict_l5_provider_tuple_unresolved', `strict /l5 fallback ${index + 1} is invalid`);
    }
    const tuple = resolvedTuple(
      'reviewer',
      row.runner,
      row.model,
      row.effort,
      row.endpoint === undefined ? null : row.endpoint,
      row.family,
      `strict /l5 fallback tuple ${index + 1}`,
    );
    if (resolved.provider_readiness_fallback_family_constraint === 'different'
        && tuple.family === resolved.reviewer_family) {
      fail(
        'strict_l5_provider_fallback_family_violation',
        'strict /l5 fallback family must differ from the primary reviewer family',
      );
    }
    seats.push({ seat_id: `reviewer:fallback:${index + 1}`, tuple });
  }

  const sorted = seats.sort(tupleSort);
  const seen = new Set();
  for (const entry of sorted) {
    const key = canonicalDigest(entry.tuple);
    if (seen.has(key)) {
      fail('strict_l5_provider_tuple_duplicate', 'strict /l5 invocation roster contains a duplicate tuple');
    }
    seen.add(key);
  }

  const policy = validateStrictL5ProviderPolicy();
  const byTuple = new Map(policy.map((entry) => [canonicalDigest(entry.tuple), entry]));

  // Canonical-policy coverage is ADVISORY, not a gate (Board decision 2026-08-16,
  // docs/plans/2026-08-16-owner-kernel-retirement.md P4).
  //
  // History: coverage started as a hard pre-spend block (the compiled policy was
  // the single legal roster), then grew an explicit opt-out
  // (`strict_l5_policy_override: <reason>`, 8b443bf8) because a certification
  // ceremony per model swap blocked ordinary operator choice. The retirement
  // plan finishes that move: what the check is FOR is stopping an UNNOTICED run
  // on unevidenced engines, and that property needs a warning that is loud and
  // recorded — not a refusal. So every derivation over a non-canonical roster
  // proceeds; each uncertified seat carries `claim_id: null` instead of
  // borrowing a certified one; the result reports `policy_override` (reason =
  // the operator's configured `strict_l5_policy_override` string, or
  // `advisory_default` when none is configured) so downstream can always tell a
  // certified bundle from an uncertified one. A byte-canonical roster derives
  // silently with `policy_override: null` — identical to the historical strict
  // pass. Pipeline-consistency checks (bootstrap→probe→consume digest binding,
  // replay/substitution detection) are NOT part of this family and stay hard.
  const overrideReason = typeof resolved.strict_l5_policy_override === 'string'
    ? resolved.strict_l5_policy_override.trim()
    : '';
  const uncertified = [];
  const invocationPolicy = sorted.map((seat) => {
    const match = byTuple.get(canonicalDigest(seat.tuple));
    if (!match) {
      uncertified.push({ seat_id: seat.seat_id, tuple: seat.tuple });
      return { seat_id: seat.seat_id, claim_id: null, tuple: seat.tuple };
    }
    return {
      seat_id: seat.seat_id,
      claim_id: match.claim_id,
      tuple: seat.tuple,
    };
  });
  const certifiedClaimIds = new Set(
    invocationPolicy.map((entry) => entry.claim_id).filter((id) => id !== null),
  );
  const drifted = uncertified.length > 0
    || sorted.length !== policy.length
    || certifiedClaimIds.size !== policy.length;
  const reason = overrideReason.length > 0 ? overrideReason : 'advisory_default';
  if (drifted) {
    // stderr, every derivation, never once-per-process: a warning that scrolls
    // past on the first run and stays silent afterwards is how a deviation
    // stops being a decision and starts being invisible.
    const seats = uncertified.map((entry) => `${entry.seat_id}=${entry.tuple.runner}/${entry.tuple.model}`);
    process.stderr.write(
      `strict /l5 POLICY OVERRIDE — ${uncertified.length} seat(s) run without a capability claim: `
      + `${seats.join(', ') || '(none)'} — reason: ${reason}\n`,
    );
  }
  return deepFreeze({
    invocation_policy: invocationPolicy,
    roster_digest: canonicalDigest(invocationPolicy.map((entry) => ({
      seat_id: entry.seat_id,
      tuple: entry.tuple,
    }))),
    policy_digest: STRICT_L5_PROVIDER_POLICY_DIGEST,
    claim_ids: [...STRICT_L5_CLAIM_IDS],
    policy_override: drifted
      ? deepFreeze({ reason, uncertified_seats: deepFreeze(uncertified) })
      : null,
  });
}

function providerTupleKey(value) {
  if (!isRecord(value)) return null;
  const projected = {};
  for (const field of PROVIDER_TUPLE_KEYS) projected[field] = value[field];
  try {
    return canonicalDigest(projected);
  } catch (_error) {
    return null;
  }
}

function readinessRosterTuples(roster) {
  if (!Array.isArray(roster)) {
    fail('strict_l5_provider_readiness_invalid', 'strict /l5 readiness roster is invalid');
  }
  const output = [];
  for (const seat of roster) {
    if (!isRecord(seat) || !isRecord(seat.tuple) || typeof seat.family !== 'string') {
      fail('strict_l5_provider_readiness_invalid', 'strict /l5 readiness seat is invalid');
    }
    output.push(normalizeStrictTuple({ ...seat.tuple, family: seat.family }));
    if (!Array.isArray(seat.fallbacks)) {
      fail('strict_l5_provider_readiness_invalid', 'strict /l5 readiness fallbacks are invalid');
    }
    for (const fallback of seat.fallbacks) {
      output.push(normalizeStrictTuple({ ...fallback.tuple, family: fallback.family }));
    }
  }
  return output.sort((left, right) => tupleSort({ tuple: left }, { tuple: right }));
}

function validateCollectedBundle(bundle, matched) {
  if (!isRecord(bundle)
      || !isRecord(bundle.receipt)
      || !Array.isArray(bundle.roster)
      || !isRecord(bundle.policy)) {
    fail('strict_l5_provider_probe_failed', 'strict /l5 live readiness collector returned no bundle');
  }
  const expectedTuples = matched.invocation_policy.map((entry) => entry.tuple);
  const observedTuples = readinessRosterTuples(bundle.roster);
  if (canonicalDigest(observedTuples) !== canonicalDigest(expectedTuples)) {
    fail('strict_l5_provider_roster_drift', 'strict /l5 live readiness roster drifted');
  }
  if (bundle.receipt.roster_digest !== canonicalDigest(bundle.roster.map((seat) => ({
    seat_id: seat.seat_id,
    required: seat.required,
    family: seat.family,
    tuple: seat.tuple,
    fallbacks: seat.fallbacks.map((fallback, index) => ({
      order: index + 1,
      family: fallback.family,
      tuple: fallback.tuple,
    })),
  })))) {
    fail('strict_l5_provider_roster_drift', 'strict /l5 readiness receipt roster digest drifted');
  }
  return bundle;
}

function createStrictL5ProviderBootstrap(options = {}, hostDependencies = {}) {
  if (!isRecord(options)
      || Object.keys(options).some((key) => key !== 'cwd' && key !== 'level')
      || (options.cwd !== undefined && typeof options.cwd !== 'string')
      || (options.level !== undefined && options.level !== 'l5' && options.level !== 'l6')) {
    fail(
      'strict_l5_provider_bootstrap_invalid',
      'strict /l5|l6 bootstrap accepts only a host cwd and level (l5 or l6)',
    );
  }
  const strictLevel = options.level || 'l5';
  if (!isRecord(hostDependencies)
      || Object.keys(hostDependencies).some((key) => !new Set([
        'collectReadiness',
        'now',
        'resolvedRoster',
      ]).has(key))) {
    fail('strict_l5_provider_bootstrap_invalid', 'strict /l5 host dependencies are invalid');
  }
  const cwd = options.cwd || process.cwd();
  let resolved = hostDependencies.resolvedRoster;
  if (!resolved) {
    const result = resolveReviewLoopJson(['--check-scorecard'], { cwd, env: process.env });
    if (result.error || result.status !== 0 || result.parseError || !result.result) {
      fail('strict_l5_provider_roster_unavailable', 'strict /l5 review roster resolution failed');
    }
    resolved = result.result;
  }
  const matched = deriveStrictL5InvocationPolicy(resolved);
  const authorizedProviderTuples = new Set(
    matched.invocation_policy.map((entry) => providerTupleKey(entry.tuple)),
  );
  const qualificationProvider = createQualificationProvider({
    providerId: `strict-l5:${matched.policy_digest}`,
    qualify: (tuple) => authorizedProviderTuples.has(providerTupleKey(tuple)),
  });
  const collectReadiness = hostDependencies.collectReadiness || collectProviderReadinessBundle;
  if (typeof collectReadiness !== 'function') {
    fail('strict_l5_provider_bootstrap_invalid', 'strict /l5 readiness collector is invalid');
  }
  const now = hostDependencies.now || (() => new Date().toISOString());
  if (typeof now !== 'function') {
    fail('strict_l5_provider_bootstrap_invalid', 'strict /l5 invocation clock is invalid');
  }
  let cachedBundle = null;
  const issuedBundles = new WeakSet();
  const providerReadinessAuthority = (request = {}) => {
    if (!isRecord(request) || !isRecord(request.roster)) {
      fail('strict_l5_provider_roster_unavailable', 'strict /l5 invocation roster is missing');
    }
    const requested = deriveStrictL5InvocationPolicy(request.roster);
    if (requested.roster_digest !== matched.roster_digest) {
      fail('strict_l5_provider_roster_drift', 'strict /l5 invocation roster changed after bootstrap');
    }
    if (cachedBundle) return cachedBundle;
    const invokedAt = now();
    let collected;
    try {
      collected = collectReadiness({
        cwd,
        now: invokedAt,
        probe: true,
        qualificationProvider,
        resolvedRoster: resolved,
      });
    } catch (error) {
      fail(
        'strict_l5_provider_probe_failed',
        `strict /l5 live readiness probe failed: ${error.message || String(error)}`,
      );
    }
    validateCollectedBundle(collected, matched);
    cachedBundle = deepFreeze({
      schema_version: 1,
      artifact_type: 'strict_l5_provider_readiness_bundle',
      strict_level: strictLevel,
      invoked_at: invokedAt,
      policy_digest: matched.policy_digest,
      claim_ids: [...matched.claim_ids],
      roster_digest: matched.roster_digest,
      observation_digest: collected.receipt.observation_digest,
      receipt: collected.receipt,
      roster: collected.roster,
      policy: collected.policy,
    });
    issuedBundles.add(cachedBundle);
    return cachedBundle;
  };
  authorityState.set(providerReadinessAuthority, {
    issuedBundles,
    qualificationProvider,
    matched,
    strictLevel,
  });
  return deepFreeze({
    roster: resolved,
    qualificationProvider,
    providerReadinessAuthority,
    policy_digest: matched.policy_digest,
    claim_ids: [...matched.claim_ids],
    roster_digest: matched.roster_digest,
    strict_level: strictLevel,
  });
}

function isStrictL5ProviderReadinessAuthority(authority) {
  return authorityState.has(authority);
}

function consumeStrictL5ProviderReadiness(authority, bundle, context = {}) {
  const state = authorityState.get(authority);
  if (!state || !isRecord(bundle) || !state.issuedBundles.has(bundle)) {
    fail(
      'strict_l5_provider_serialized_replay',
      'strict /l5 readiness bundle is absent, foreign, serialized, or replayed',
    );
  }
  if (bundle.policy_digest !== state.matched.policy_digest) {
    fail('strict_l5_provider_policy_digest_drift', 'strict /l5 readiness policy digest drifted');
  }
  if (canonicalDigest(bundle.claim_ids) !== canonicalDigest(state.matched.claim_ids)) {
    fail('strict_l5_provider_claim_substitution', 'strict /l5 readiness claim IDs drifted');
  }
  if (bundle.roster_digest !== state.matched.roster_digest) {
    fail('strict_l5_provider_roster_drift', 'strict /l5 readiness roster digest drifted');
  }
  if (bundle.observation_digest !== bundle.receipt.observation_digest) {
    fail('strict_l5_provider_observation_drift', 'strict /l5 readiness observation digest drifted');
  }
  if (bundle.strict_level !== state.strictLevel) {
    fail('strict_l5_provider_level_drift', 'strict /l5|l6 readiness bundle level drifted');
  }
  const requested = deriveStrictL5InvocationPolicy(context.roster);
  if (requested.roster_digest !== state.matched.roster_digest) {
    fail('strict_l5_provider_roster_drift', 'strict /l5 consume roster drifted');
  }
  const result = consumeProviderReadinessBeforeSpend(bundle.receipt, {
    roster: bundle.roster,
    policy: bundle.policy,
    now: context.now,
    qualificationProvider: state.qualificationProvider,
  });
  if (result.status !== 'ready') {
    fail('strict_l5_provider_not_ready', 'strict /l5 provider readiness is not usable now');
  }
  return deepFreeze({
    ...result,
    strict_level: state.strictLevel,
    invoked_at: bundle.invoked_at,
    policy_digest: bundle.policy_digest,
    claim_ids: [...bundle.claim_ids],
    roster_digest: bundle.roster_digest,
    observation_digest: bundle.observation_digest,
  });
}

module.exports = {
  STRICT_L5_CLAIM_IDS,
  STRICT_L5_PROVIDER_POLICY,
  STRICT_L5_PROVIDER_POLICY_DIGEST,
  StrictL5ProviderBootstrapError,
  consumeStrictL5ProviderReadiness,
  createStrictL5ProviderBootstrap,
  deriveStrictL5InvocationPolicy,
  isStrictL5ProviderReadinessAuthority,
  validateStrictL5ProviderPolicy,
};
