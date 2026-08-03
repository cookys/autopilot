#!/usr/bin/env node
'use strict';

// Optional, user-local cold-start prior from Artificial Analysis.
// Official API contract: https://artificialanalysis.ai/data-api/docs
// External scores are telemetry only: this adapter can never mint qualified evidence.

const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');
const {
  appendEvidenceRecords,
  readEvidenceRows,
  resolveStoreConfig,
} = require('./engine-capability-state');
const {
  expandTilde,
  withWriteLock,
} = require('./lib/jsonl-store');
const {
  compileCapabilityEvidence,
  evaluateCapabilityEvidence,
} = require('../src/engine/capability-evidence');
const {
  canonicalJson,
  sha256,
} = require('../src/engine/owner-kernel/canonical');

const AA_ENDPOINT = 'https://artificialanalysis.ai/api/v2/language/models/free';
const AA_DOCS_URL = 'https://artificialanalysis.ai/data-api/docs';
const AA_ATTRIBUTION_URL = 'https://artificialanalysis.ai';
const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.autopilot', 'aa-capabilities');
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_MODELS = 20_000;
const CANDIDATE_PERCENTILE = 0.75;
const EVIDENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TARGET_DIMENSIONS = Object.freeze({
  intelligence: 'artificial_analysis_intelligence_index',
  coding: 'artificial_analysis_coding_index',
  agentic: 'artificial_analysis_agentic_index',
});
const REFRESH_OPTIONS = new Set([
  'apiKey',
  'cacheDir',
  'fetchImpl',
  'now',
  'recordEvidence',
  'store',
]);
const PROMPT_CONFIG_HASH = sha256(canonicalJson({
  source: 'artificial-analysis-model-level',
  prompt_configuration: 'unresolved',
}));
const CONTAINMENT_FINGERPRINT = sha256(canonicalJson({
  source: 'artificial-analysis-model-level',
  deployment_containment: 'unresolved',
}));

const HELP_TEXT = `Usage:
  node scripts/import-aa-capabilities.js refresh [--cache-dir <path>] [--store <path>] [--now <ISO-date>] [--no-record]
  node scripts/import-aa-capabilities.js current [--cache-dir <path>]

Environment:
  ARTIFICIAL_ANALYSIS_API_KEY  Required only for refresh. Sent only in the x-api-key header.

The endpoint is fixed to ${AA_ENDPOINT}. Imported data remains user-local, is attributed to
Artificial Analysis, and can produce only provisional implementer/explorer evidence.
`;

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype
        && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function boundedString(value, label, maximum = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function targetScore(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number or null`);
  }
  return value;
}

function normalizeVersion(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1000) {
    throw new Error('AA intelligence_index_version must be a bounded positive number');
  }
  const normalized = String(value);
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(normalized)) {
    throw new Error('AA intelligence_index_version has an unsupported representation');
  }
  return normalized;
}

function validatePage(raw, expectedPage) {
  const page = plainObject(raw, `AA page ${expectedPage}`);
  if (!['free', 'pro', 'commercial'].includes(page.tier)) {
    throw new Error(`AA page ${expectedPage} has an invalid tier`);
  }
  const version = normalizeVersion(page.intelligence_index_version);
  const pagination = plainObject(page.pagination, `AA page ${expectedPage}.pagination`);
  for (const field of ['page', 'page_size', 'total_pages']) {
    if (!Number.isSafeInteger(pagination[field]) || pagination[field] < 1) {
      throw new Error(`AA page ${expectedPage} pagination.${field} must be a positive integer`);
    }
  }
  if (pagination.page !== expectedPage) {
    throw new Error(`AA response page ${pagination.page} does not match requested page ${expectedPage}`);
  }
  if (pagination.total_pages > MAX_PAGES) {
    throw new Error(`AA pagination exceeds the ${MAX_PAGES}-page safety bound`);
  }
  if (typeof pagination.has_more !== 'boolean'
      || pagination.has_more !== (pagination.page < pagination.total_pages)) {
    throw new Error(`AA page ${expectedPage} has inconsistent pagination.has_more`);
  }
  if (!Array.isArray(page.data) || page.data.length > pagination.page_size) {
    throw new Error(`AA page ${expectedPage}.data exceeds its declared page size`);
  }

  const data = page.data.map((rawModel, index) => {
    const label = `AA page ${expectedPage}.data[${index}]`;
    const entry = plainObject(rawModel, label);
    const creator = plainObject(entry.model_creator, `${label}.model_creator`);
    const evaluations = plainObject(entry.evaluations, `${label}.evaluations`);
    const releaseDateValid = entry.release_date === null
      || (typeof entry.release_date === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(entry.release_date)
        && new Date(`${entry.release_date}T00:00:00.000Z`).toISOString().slice(0, 10)
          === entry.release_date);
    if (!releaseDateValid) {
      throw new Error(`${label}.release_date must be an ISO date or null`);
    }
    return {
      id: boundedString(entry.id, `${label}.id`),
      name: boundedString(entry.name, `${label}.name`),
      slug: boundedString(entry.slug, `${label}.slug`),
      release_date: entry.release_date,
      creator: {
        id: boundedString(creator.id, `${label}.model_creator.id`),
        name: boundedString(creator.name, `${label}.model_creator.name`),
      },
      scores: Object.fromEntries(Object.entries(TARGET_DIMENSIONS).map(([shortName, field]) => [
        shortName,
        targetScore(evaluations[field], `${label}.evaluations.${field}`),
      ])),
    };
  });

  return {
    tier: page.tier,
    version,
    pagination: {
      page: pagination.page,
      page_size: pagination.page_size,
      total_pages: pagination.total_pages,
      has_more: pagination.has_more,
    },
    data,
  };
}

async function fetchPage(fetchImpl, apiKey, pageNumber) {
  const url = new URL(AA_ENDPOINT);
  url.searchParams.set('page', String(pageNumber));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
        signal: controller.signal,
      });
    } catch {
      throw new Error(`Artificial Analysis request failed for page ${pageNumber}`);
    }
    if (!response || typeof response.status !== 'number' || typeof response.text !== 'function') {
      throw new Error(`Artificial Analysis returned an invalid response for page ${pageNumber}`);
    }
    if (response.redirected === true
        || (typeof response.url === 'string' && response.url.length > 0
          && response.url !== url.toString())) {
      throw new Error(`Artificial Analysis redirect was refused for page ${pageNumber}`);
    }
    if (!response.ok) {
      throw new Error(`Artificial Analysis API returned HTTP ${response.status} for page ${pageNumber}`);
    }
    const contentLength = response.headers && typeof response.headers.get === 'function'
      ? Number(response.headers.get('content-length')) : NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_PAGE_BYTES) {
      throw new Error(`Artificial Analysis page ${pageNumber} exceeds the response-size limit`);
    }
    const text = await readResponseTextBounded(response, pageNumber);
    if (text.includes(apiKey)) {
      throw new Error('Artificial Analysis response contains credential material');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Artificial Analysis page ${pageNumber} is not valid JSON`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseTextBounded(response, pageNumber) {
  const sizeError = `Artificial Analysis page ${pageNumber} exceeds the response-size limit`;
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (!chunk || typeof chunk.done !== 'boolean') {
          throw new Error('invalid stream result');
        }
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) {
          throw new Error('invalid stream chunk');
        }
        totalBytes += chunk.value.byteLength;
        if (totalBytes > MAX_PAGE_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // Cancellation is best-effort after the hard size ceiling is reached.
          }
          throw new Error(sizeError);
        }
        chunks.push(Buffer.from(chunk.value));
      }
    } catch (error) {
      if (error.message === sizeError) throw error;
      throw new Error(`Artificial Analysis response body failed for page ${pageNumber}`);
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8');
  }

  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error(`Artificial Analysis response body failed for page ${pageNumber}`);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_PAGE_BYTES) throw new Error(sizeError);
  return text;
}

async function fetchAllPages(fetchImpl, apiKey) {
  const rawPages = [];
  const pages = [];
  const firstRaw = await fetchPage(fetchImpl, apiKey, 1);
  const first = validatePage(firstRaw, 1);
  rawPages.push(firstRaw);
  pages.push(first);
  for (let pageNumber = 2; pageNumber <= first.pagination.total_pages; pageNumber += 1) {
    const raw = await fetchPage(fetchImpl, apiKey, pageNumber);
    const page = validatePage(raw, pageNumber);
    if (page.version !== first.version) {
      throw new Error('AA intelligence index version changed within one paginated response');
    }
    if (page.tier !== first.tier) {
      throw new Error('AA subscription tier changed within one paginated response');
    }
    if (page.pagination.total_pages !== first.pagination.total_pages
        || page.pagination.page_size !== first.pagination.page_size) {
      throw new Error('AA pagination metadata changed within one paginated response');
    }
    rawPages.push(raw);
    pages.push(page);
  }

  const models = pages.flatMap((page) => page.data);
  if (models.length > MAX_MODELS) {
    throw new Error(`AA response exceeds the ${MAX_MODELS}-model safety bound`);
  }
  const ids = new Set();
  for (const entry of models) {
    if (ids.has(entry.id)) throw new Error('AA response repeats a model id');
    ids.add(entry.id);
  }
  return {
    tier: first.tier,
    version: first.version,
    models,
    rawPages,
  };
}

function percentileMap(models, dimension) {
  const measured = models
    .filter((entry) => entry.scores[dimension] !== null)
    .map((entry) => ({ id: entry.id, score: entry.scores[dimension] }))
    .sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));
  const result = new Map();
  for (let start = 0; start < measured.length;) {
    let end = start + 1;
    while (end < measured.length && measured[end].score === measured[start].score) end += 1;
    const percentile = measured.length === 1
      ? 0.5
      : Number(((start + ((end - start - 1) / 2)) / (measured.length - 1)).toFixed(12));
    for (let index = start; index < end; index += 1) {
      result.set(measured[index].id, percentile);
    }
    start = end;
  }
  return result;
}

function safeToken(value, prefix) {
  if (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)) return value;
  return `${prefix}-${sha256(String(value)).slice(0, 32)}`;
}

function buildIdentity(entry) {
  return {
    identity: safeToken(`aa-${entry.id}`, 'aa-model'),
    model_alias: safeToken(entry.slug, 'aa-model'),
    model_version: 'unresolved',
    family: safeToken(`aa-${entry.creator.id}`, 'aa-creator'),
    runner: 'aa-model-level',
    runner_version: 'api-v2',
    harness_version: 'unresolved',
    effort: 'unresolved',
    prompt_config_hash: PROMPT_CONFIG_HASH,
    semantic_fingerprint: sha256(canonicalJson({
      id: entry.id,
      name: entry.name,
      slug: entry.slug,
      release_date: entry.release_date,
      creator: entry.creator,
    })),
    containment_fingerprint: CONTAINMENT_FINGERPRINT,
    identity_resolved: false,
  };
}

function buildEvidence(entry, role, version, cohortHash, retrievedAt) {
  const dimensions = role === 'implementer'
    ? ['agentic_index', 'coding_index']
    : ['agentic_index', 'intelligence_index'];
  const scope = {
    task_classes: [role === 'implementer' ? 'code_implementation' : 'repository_exploration'],
    domains: ['general'],
    languages: ['und'],
    tool_surface: ['model-level-benchmark'],
  };
  const observation = {
    model_id: entry.id,
    role,
    intelligence_index_version: version,
    candidate_policy: 'both-dimensions-p75-v1',
    dimensions: Object.fromEntries(dimensions.map((dimension) => {
      const shortName = dimension.replace(/_index$/, '');
      return [dimension, entry.indices[shortName]];
    })),
  };
  return compileCapabilityEvidence({
    schema_version: 1,
    source: 'external_prior',
    source_ref: 'artificial-analysis-api-v2',
    state: 'provisional',
    role,
    scope,
    identity: buildIdentity(entry),
    issued_at: retrievedAt,
    observed_at: retrievedAt,
    expires_at: new Date(Date.parse(retrievedAt) + EVIDENCE_TTL_MS).toISOString(),
    methodology: {
      kind: 'external_prior',
      name: 'artificial-analysis-model-prior',
      version: '1.0.0',
      corpus_version: null,
      corpus_manifest_hash: null,
      thresholds: null,
      basis: {
        cohort: `aa-index-v${version}`,
        cohort_hash: cohortHash,
        observation_hash: sha256(canonicalJson(observation)),
        dimensions,
        applicability: [
          'benchmark-language-unresolved',
          'cloud-model-level',
          'deployment-unresolved',
          'harness-unresolved',
          'precision-unresolved',
          'proxy-only',
          'runner-unresolved',
        ],
      },
    },
    trials: [],
    revocation: null,
    supersedes: null,
  });
}

function buildRetirementEvidence(
  previousEvidence,
  snapshot,
  retrievedAt,
  reason,
  targetEvidenceId = previousEvidence.evidence_id,
) {
  const applicability = [...new Set([
    ...previousEvidence.methodology.basis.applicability,
    'candidate-retired',
    reason,
  ])];
  return compileCapabilityEvidence({
    schema_version: 1,
    source: 'external_prior',
    source_ref: 'artificial-analysis-api-v2',
    state: 'degraded',
    role: previousEvidence.role,
    scope: previousEvidence.scope,
    identity: previousEvidence.identity,
    issued_at: retrievedAt,
    observed_at: retrievedAt,
    expires_at: new Date(Date.parse(retrievedAt) + EVIDENCE_TTL_MS).toISOString(),
    methodology: {
      kind: 'external_prior',
      name: 'artificial-analysis-model-prior',
      version: '1.0.0',
      corpus_version: null,
      corpus_manifest_hash: null,
      thresholds: null,
      basis: {
        cohort: snapshot.cohort,
        cohort_hash: snapshot.cohort_hash,
        observation_hash: sha256(canonicalJson({
          target_evidence_id: targetEvidenceId,
          intelligence_index_version: snapshot.intelligence_index_version,
          reason,
        })),
        dimensions: previousEvidence.methodology.basis.dimensions,
        applicability,
      },
    },
    trials: [],
    revocation: null,
    supersedes: null,
  });
}

function candidateEvidenceByModel(snapshot) {
  const byIdentityRole = new Map(snapshot.evidence
    .filter((evidence) => evidence.state === 'provisional')
    .map((evidence) => [
      canonicalJson([evidence.identity_hash, evidence.role]),
      evidence,
    ]));
  const result = new Map();
  for (const entry of snapshot.models) {
    const identityHash = sha256(canonicalJson(buildIdentity(entry)));
    for (const role of entry.provisional_roles) {
      const evidence = byIdentityRole.get(canonicalJson([identityHash, role]));
      if (!evidence) {
        throw new Error('AA snapshot is missing evidence for a provisional role');
      }
      result.set(canonicalJson([entry.id, role]), evidence);
    }
  }
  return result;
}

function activeRecordedAaCandidates(rows, evaluationTime) {
  const groups = new Map();
  for (const row of rows.filter((entry) => entry.producer === 'aa-import-v1')) {
    const evidence = row.evidence;
    const key = canonicalJson([evidence.identity_hash, evidence.role, evidence.scope_hash]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(evidence);
  }
  const candidates = [];
  for (const evidence of groups.values()) {
    const result = evaluateCapabilityEvidence(evidence, {
      role: evidence[0].role,
      scope: evidence[0].scope,
      identity: evidence[0].identity,
      evaluation_time: evaluationTime,
    });
    if (result.state !== 'provisional') continue;
    const selected = evidence.find((entry) => entry.evidence_id === result.evidence_id);
    if (selected) candidates.push(selected);
  }
  return candidates;
}

function attachRetirements(
  snapshot,
  previousSnapshot,
  retrievedAt,
  carryPendingRetirements,
  recordedCandidates = [],
  recordedEvidenceIds = new Set(),
  recordEvidence = false,
) {
  const previousCandidates = previousSnapshot
    ? candidateEvidenceByModel(previousSnapshot) : new Map();
  const currentCandidates = candidateEvidenceByModel(snapshot);
  const currentCandidatesByIdentityRole = new Map([...currentCandidates.values()].map(
    (evidence) => [canonicalJson([evidence.identity_hash, evidence.role]), evidence],
  ));
  const currentModels = new Map(snapshot.models.map((entry) => [entry.id, entry]));
  const currentModelsByIdentity = new Map(snapshot.models.map((entry) => [
    sha256(canonicalJson(buildIdentity(entry))),
    entry,
  ]));
  const previousModelsByIdentity = new Map((previousSnapshot
    ? previousSnapshot.models : []).map((entry) => [
    sha256(canonicalJson(buildIdentity(entry))),
    entry,
  ]));
  const retirements = [];
  const retirementEvidence = [];
  const retiredIdentityRoles = new Set();

  function retire(modelId, role, previousEvidence, reason, targetEvidenceId) {
    const identityRole = canonicalJson([previousEvidence.identity_hash, role]);
    if (retiredIdentityRoles.has(identityRole)) return;
    if (recordEvidence && !recordedEvidenceIds.has(targetEvidenceId)) return;
    const evidence = buildRetirementEvidence(
      previousEvidence,
      snapshot,
      retrievedAt,
      reason,
      targetEvidenceId,
    );
    retiredIdentityRoles.add(identityRole);
    retirementEvidence.push(evidence);
    retirements.push({
      model_id: modelId,
      role,
      reason,
      target_evidence_id: targetEvidenceId,
      retirement_evidence_id: evidence.evidence_id,
    });
  }

  for (const [modelRole, previousEvidence] of previousCandidates) {
    const currentEvidence = currentCandidates.get(modelRole);
    if (currentEvidence
        && currentEvidence.identity_hash === previousEvidence.identity_hash) {
      continue;
    }
    const [modelId, role] = JSON.parse(modelRole);
    let reason = 'below_candidate_floor';
    if (!currentModels.has(modelId)) {
      reason = 'model_missing_current_cohort';
    } else if (currentEvidence) {
      reason = 'model_identity_changed';
    }
    retire(
      modelId,
      role,
      previousEvidence,
      reason,
      previousEvidence.evidence_id,
    );
  }

  if (carryPendingRetirements && previousSnapshot) {
    const evidenceById = new Map(previousSnapshot.evidence.map((entry) => [
      entry.evidence_id,
      entry,
    ]));
    for (const retirement of previousSnapshot.retirements) {
      const previousEvidence = evidenceById.get(retirement.retirement_evidence_id);
      const currentEvidence = currentCandidates.get(canonicalJson([
        retirement.model_id,
        retirement.role,
      ]));
      if (currentEvidence
          && currentEvidence.identity_hash === previousEvidence.identity_hash) {
        continue;
      }
      retire(
        retirement.model_id,
        retirement.role,
        previousEvidence,
        retirement.reason,
        retirement.target_evidence_id,
      );
    }
  }

  for (const previousEvidence of recordedCandidates) {
    const identityRole = canonicalJson([
      previousEvidence.identity_hash,
      previousEvidence.role,
    ]);
    if (currentCandidatesByIdentityRole.has(identityRole)) continue;
    const matchingModel = currentModelsByIdentity.get(previousEvidence.identity_hash)
      || previousModelsByIdentity.get(previousEvidence.identity_hash);
    const modelId = matchingModel
      ? matchingModel.id : previousEvidence.identity.identity;
    let reason = 'below_candidate_floor';
    if (!currentModels.has(modelId)) {
      reason = 'model_missing_current_cohort';
    } else if (currentCandidates.has(canonicalJson([modelId, previousEvidence.role]))) {
      reason = 'model_identity_changed';
    }
    retire(
      modelId,
      previousEvidence.role,
      previousEvidence,
      reason,
      previousEvidence.evidence_id,
    );
  }

  if (retirementEvidence.length === 0) return snapshot;
  const evidence = [...snapshot.evidence, ...retirementEvidence].sort((left, right) => (
    left.identity.identity.localeCompare(right.identity.identity)
    || left.role.localeCompare(right.role)
    || left.state.localeCompare(right.state)
  ));
  retirements.sort((left, right) => (
    left.model_id.localeCompare(right.model_id)
    || left.role.localeCompare(right.role)
  ));
  return {
    ...snapshot,
    retirements,
    evidence,
  };
}

function sourceDescriptor() {
  return {
    name: 'Artificial Analysis',
    url: AA_ENDPOINT,
    docs_url: AA_DOCS_URL,
    attribution_url: AA_ATTRIBUTION_URL,
  };
}

function candidatePolicyDescriptor() {
  return {
    name: 'both-dimensions-p75-v1',
    percentile_floor: CANDIDATE_PERCENTILE,
    role_dimensions: {
      implementer: ['coding', 'agentic'],
      explorer: ['intelligence', 'agentic'],
    },
    excluded_roles: ['owner', 'reviewer', 'verification_author'],
  };
}

function normalizeSnapshot(fetched, retrievedAt) {
  const percentiles = Object.fromEntries(Object.keys(TARGET_DIMENSIONS).map((dimension) => [
    dimension,
    percentileMap(fetched.models, dimension),
  ]));
  const models = fetched.models.map((entry) => {
    const indices = Object.fromEntries(Object.keys(TARGET_DIMENSIONS).map((dimension) => [
      dimension,
      {
        score: entry.scores[dimension],
        percentile: percentiles[dimension].get(entry.id) ?? null,
      },
    ]));
    const provisionalRoles = [];
    if (indices.coding.percentile >= CANDIDATE_PERCENTILE
        && indices.agentic.percentile >= CANDIDATE_PERCENTILE) {
      provisionalRoles.push('implementer');
    }
    if (indices.intelligence.percentile >= CANDIDATE_PERCENTILE
        && indices.agentic.percentile >= CANDIDATE_PERCENTILE) {
      provisionalRoles.push('explorer');
    }
    return {
      id: entry.id,
      name: entry.name,
      slug: entry.slug,
      release_date: entry.release_date,
      creator: entry.creator,
      indices,
      provisional_roles: provisionalRoles.sort(),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const cohortHash = sha256(canonicalJson({
    intelligence_index_version: fetched.version,
    models: models.map((entry) => ({
      id: entry.id,
      indices: Object.fromEntries(Object.entries(entry.indices).map(([name, value]) => [
        name,
        value.score,
      ])),
    })),
  }));
  const evidence = [];
  for (const entry of models) {
    for (const role of entry.provisional_roles) {
      evidence.push(buildEvidence(entry, role, fetched.version, cohortHash, retrievedAt));
    }
  }
  evidence.sort((left, right) => (
    left.identity.identity.localeCompare(right.identity.identity)
    || left.role.localeCompare(right.role)
  ));
  return {
    schema_version: 1,
    source: sourceDescriptor(),
    retrieved_at: retrievedAt,
    tier: fetched.tier,
    intelligence_index_version: fetched.version,
    cohort: `aa-index-v${fetched.version}`,
    cohort_hash: cohortHash,
    candidate_policy: candidatePolicyDescriptor(),
    models,
    retirements: [],
    evidence,
  };
}

function nearestGitRoot(target) {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolvePhysicalTarget(target) {
  const suffix = [];
  let existing = path.resolve(target);
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync(existing), ...suffix);
}

function assertOutsideGit(target, label) {
  const gitRoot = nearestGitRoot(target);
  if (gitRoot && (target === gitRoot || target.startsWith(`${gitRoot}${path.sep}`))) {
    throw new Error(`${label} must be outside a Git worktree`);
  }
}

function assertCacheDestination(cacheDir) {
  const currentPhysical = resolvePhysicalTarget(cacheDir);
  if (currentPhysical !== cacheDir) {
    throw new Error('AA cache destination changed during refresh');
  }
  if (fs.existsSync(cacheDir)) {
    const stats = fs.lstatSync(cacheDir);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('AA cache path must be a real directory');
    }
  }
  assertOutsideGit(cacheDir, 'AA cache directory');
}

function resolveEvidenceConfig(store) {
  const resolved = resolveStoreConfig(store === undefined ? {} : { store });
  const storeDir = resolvePhysicalTarget(resolved.storeDir);
  if (fs.existsSync(storeDir) && !fs.statSync(storeDir).isDirectory()) {
    throw new Error('AA evidence store path must be a directory');
  }
  assertOutsideGit(storeDir, 'AA evidence store');
  const evidenceFile = path.join(storeDir, path.basename(resolved.evidenceFile));
  const lockFile = path.join(storeDir, path.basename(resolved.lockFile));
  for (const [file, label] of [
    [evidenceFile, 'AA evidence file'],
    [lockFile, 'AA evidence lock'],
  ]) {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
      throw new Error(`${label} must not be a symbolic link`);
    }
  }
  return {
    ...resolved,
    storeDir,
    storeFile: path.join(storeDir, path.basename(resolved.storeFile)),
    evidenceFile,
    lockFile,
  };
}

function assertEvidenceDestination(config) {
  if (resolvePhysicalTarget(config.storeDir) !== config.storeDir) {
    throw new Error('AA evidence store destination changed during refresh');
  }
  assertOutsideGit(config.storeDir, 'AA evidence store');
  if (fs.existsSync(config.evidenceFile)
      && fs.lstatSync(config.evidenceFile).isSymbolicLink()) {
    throw new Error('AA evidence file must not be a symbolic link');
  }
  if (fs.existsSync(config.lockFile)
      && fs.lstatSync(config.lockFile).isSymbolicLink()) {
    throw new Error('AA evidence lock must not be a symbolic link');
  }
}

function containsStringFragment(value, needle) {
  if (typeof value === 'string') return value.includes(needle);
  if (Array.isArray(value)) return value.some((entry) => containsStringFragment(entry, needle));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) => (
      key.includes(needle) || containsStringFragment(entry, needle)
    ));
  }
  return false;
}

function secureDirectory(directory) {
  if (fs.existsSync(directory)) {
    const stats = fs.lstatSync(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`AA cache path must be a real directory: ${directory}`);
    }
  } else {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(directory, 0o700);
}

function writeContentAddressed(directory, value) {
  secureDirectory(directory);
  const content = canonicalJson(value);
  const hash = sha256(content);
  const target = path.join(directory, `${hash}.json`);
  if (fs.existsSync(target)) {
    const stats = fs.lstatSync(target);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`AA cache object must be a regular file: ${target}`);
    }
    if (fs.readFileSync(target, 'utf8') !== content) {
      throw new Error(`content-address collision at ${target}`);
    }
    fs.chmodSync(target, 0o600);
    return { hash, target, created: false };
  }
  const temporary = `${target}.tmp.${process.pid}.${process.hrtime.bigint()}`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The rename may already have consumed the temporary path.
    }
    throw error;
  }
  return { hash, target, created: true };
}

function writeCurrentAtomic(cacheDir, manifest) {
  const target = path.join(cacheDir, 'current.json');
  const temporary = `${target}.tmp.${process.pid}.${process.hrtime.bigint()}`;
  let previous = null;
  let previousMode = 0o600;
  if (fs.existsSync(target)) {
    const stats = fs.lstatSync(target);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`AA current manifest path must be a regular file: ${target}`);
    }
    previous = fs.readFileSync(target);
    previousMode = stats.mode & 0o777;
  }
  let published = false;
  try {
    fs.writeFileSync(temporary, `${canonicalJson(manifest)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
    published = true;
    fs.chmodSync(target, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The rename may already have consumed the temporary path.
    }
    if (published) {
      try {
        if (previous === null) {
          fs.unlinkSync(target);
        } else {
          const restore = `${target}.restore.${process.pid}.${process.hrtime.bigint()}`;
          fs.writeFileSync(restore, previous, { flag: 'wx', mode: previousMode });
          fs.renameSync(restore, target);
          fs.chmodSync(target, previousMode);
        }
      } catch (rollbackError) {
        throw new Error(
          `${error.message}; AA current manifest rollback failed: ${rollbackError.message}`,
        );
      }
    }
    throw error;
  }
}

function captureCurrent(cacheDir) {
  const target = path.join(cacheDir, 'current.json');
  if (!fs.existsSync(target)) return null;
  const stats = fs.lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`AA current manifest path must be a regular file: ${target}`);
  }
  return {
    content: fs.readFileSync(target),
    mode: stats.mode & 0o777,
  };
}

function restoreCurrent(cacheDir, previous) {
  const target = path.join(cacheDir, 'current.json');
  if (previous === null) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return;
  }
  const temporary = `${target}.rollback.${process.pid}.${process.hrtime.bigint()}`;
  try {
    fs.writeFileSync(temporary, previous.content, { flag: 'wx', mode: previous.mode });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, previous.mode);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The rename may already have consumed the rollback path.
    }
    throw error;
  }
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(plainObject(value, label)).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new Error(`${label} has unsupported or missing fields`);
  }
}

function validPercentile(value, label) {
  if (value !== null
      && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error(`${label} must be a percentile or null`);
  }
}

function validateCachedModel(entry, index) {
  const label = `AA snapshot.models[${index}]`;
  exactKeys(
    entry,
    ['id', 'name', 'slug', 'release_date', 'creator', 'indices', 'provisional_roles'],
    label,
  );
  boundedString(entry.id, `${label}.id`);
  boundedString(entry.name, `${label}.name`);
  boundedString(entry.slug, `${label}.slug`);
  if (entry.release_date !== null
      && (typeof entry.release_date !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(entry.release_date))) {
    throw new Error(`${label}.release_date is invalid`);
  }
  exactKeys(entry.creator, ['id', 'name'], `${label}.creator`);
  boundedString(entry.creator.id, `${label}.creator.id`);
  boundedString(entry.creator.name, `${label}.creator.name`);
  exactKeys(entry.indices, Object.keys(TARGET_DIMENSIONS), `${label}.indices`);
  for (const dimension of Object.keys(TARGET_DIMENSIONS)) {
    const metric = entry.indices[dimension];
    exactKeys(metric, ['score', 'percentile'], `${label}.indices.${dimension}`);
    targetScore(metric.score, `${label}.indices.${dimension}.score`);
    validPercentile(metric.percentile, `${label}.indices.${dimension}.percentile`);
  }
  const expectedRoles = [];
  if (entry.indices.coding.percentile !== null
      && entry.indices.agentic.percentile !== null
      && entry.indices.coding.percentile >= CANDIDATE_PERCENTILE
      && entry.indices.agentic.percentile >= CANDIDATE_PERCENTILE) {
    expectedRoles.push('implementer');
  }
  if (entry.indices.intelligence.percentile !== null
      && entry.indices.agentic.percentile !== null
      && entry.indices.intelligence.percentile >= CANDIDATE_PERCENTILE
      && entry.indices.agentic.percentile >= CANDIDATE_PERCENTILE) {
    expectedRoles.push('explorer');
  }
  if (canonicalJson(entry.provisional_roles) !== canonicalJson(expectedRoles.sort())) {
    throw new Error(`${label}.provisional_roles does not match the candidate policy`);
  }
}

function validateCachedAaEvidence(rawEvidence, label) {
  const evidence = compileCapabilityEvidence(rawEvidence);
  const expectedTask = evidence.role === 'implementer'
    ? 'code_implementation' : 'repository_exploration';
  const expectedDimensions = evidence.role === 'implementer'
    ? ['agentic_index', 'coding_index']
    : ['agentic_index', 'intelligence_index'];
  if (canonicalJson(evidence) !== canonicalJson(rawEvidence)
      || !['implementer', 'explorer'].includes(evidence.role)
      || !['provisional', 'degraded'].includes(evidence.state)
      || evidence.source !== 'external_prior'
      || evidence.source_ref !== 'artificial-analysis-api-v2'
      || evidence.methodology.kind !== 'external_prior'
      || evidence.methodology.name !== 'artificial-analysis-model-prior'
      || evidence.methodology.version !== '1.0.0'
      || evidence.identity.runner !== 'aa-model-level'
      || evidence.identity.runner_version !== 'api-v2'
      || evidence.identity.harness_version !== 'unresolved'
      || evidence.identity.effort !== 'unresolved'
      || canonicalJson(evidence.scope.task_classes) !== canonicalJson([expectedTask])
      || canonicalJson(evidence.scope.domains) !== canonicalJson(['general'])
      || canonicalJson(evidence.scope.languages) !== canonicalJson(['und'])
      || canonicalJson(evidence.scope.tool_surface)
        !== canonicalJson(['model-level-benchmark'])
      || canonicalJson(evidence.methodology.basis.dimensions)
        !== canonicalJson(expectedDimensions)
      || evidence.identity.identity_resolved !== false) {
    throw new Error(`${label} violates the Artificial Analysis evidence contract`);
  }
  return evidence;
}

function validateCachedSnapshot(snapshot) {
  exactKeys(snapshot, [
    'schema_version',
    'source',
    'retrieved_at',
    'tier',
    'intelligence_index_version',
    'cohort',
    'cohort_hash',
    'candidate_policy',
    'models',
    'retirements',
    'evidence',
  ], 'AA snapshot');
  if (snapshot.schema_version !== 1
      || canonicalJson(snapshot.source) !== canonicalJson(sourceDescriptor())
      || canonicalJson(snapshot.candidate_policy) !== canonicalJson(candidatePolicyDescriptor())
      || !['free', 'pro', 'commercial'].includes(snapshot.tier)
      || typeof snapshot.intelligence_index_version !== 'string'
      || !/^[0-9]+(?:\.[0-9]+)?$/.test(snapshot.intelligence_index_version)
      || snapshot.cohort !== `aa-index-v${snapshot.intelligence_index_version}`
      || typeof snapshot.retrieved_at !== 'string'
      || new Date(snapshot.retrieved_at).toISOString() !== snapshot.retrieved_at
      || !/^[a-f0-9]{64}$/.test(snapshot.cohort_hash)) {
    throw new Error('AA snapshot metadata is invalid');
  }
  if (!Array.isArray(snapshot.models) || !Array.isArray(snapshot.retirements)
      || !Array.isArray(snapshot.evidence)) {
    throw new Error('AA snapshot collections are invalid');
  }
  snapshot.models.forEach(validateCachedModel);
  const modelIds = snapshot.models.map((entry) => entry.id);
  if (new Set(modelIds).size !== modelIds.length) {
    throw new Error('AA snapshot repeats a model id');
  }
  const expectedCohortHash = sha256(canonicalJson({
    intelligence_index_version: snapshot.intelligence_index_version,
    models: snapshot.models.map((entry) => ({
      id: entry.id,
      indices: Object.fromEntries(Object.entries(entry.indices).map(([name, value]) => [
        name,
        value.score,
      ])),
    })),
  }));
  if (snapshot.cohort_hash !== expectedCohortHash) {
    throw new Error('AA snapshot cohort hash is invalid');
  }

  const evidence = snapshot.evidence.map((entry, index) => (
    validateCachedAaEvidence(entry, `AA snapshot.evidence[${index}]`)
  ));
  if (evidence.some((entry) => (
    entry.methodology.basis.cohort !== snapshot.cohort
    || entry.methodology.basis.cohort_hash !== snapshot.cohort_hash
  ))) {
    throw new Error('AA snapshot evidence does not match its comparison cohort');
  }
  const evidenceIds = evidence.map((entry) => entry.evidence_id);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error('AA snapshot repeats an evidence id');
  }
  const currentCandidates = candidateEvidenceByModel(snapshot);
  const currentCandidateIds = new Set(
    [...currentCandidates.values()].map((entry) => entry.evidence_id),
  );

  const retirementIds = new Set();
  for (let index = 0; index < snapshot.retirements.length; index += 1) {
    const retirement = snapshot.retirements[index];
    const label = `AA snapshot.retirements[${index}]`;
    exactKeys(retirement, [
      'model_id',
      'role',
      'reason',
      'target_evidence_id',
      'retirement_evidence_id',
    ], label);
    boundedString(retirement.model_id, `${label}.model_id`);
    if (!['implementer', 'explorer'].includes(retirement.role)
        || ![
          'below_candidate_floor',
          'model_identity_changed',
          'model_missing_current_cohort',
        ].includes(retirement.reason)
        || !/^[a-f0-9]{64}$/.test(retirement.target_evidence_id)
        || !/^[a-f0-9]{64}$/.test(retirement.retirement_evidence_id)) {
      throw new Error(`${label} is invalid`);
    }
    const linked = evidence.find(
      (entry) => entry.evidence_id === retirement.retirement_evidence_id,
    );
    if (!linked || linked.state !== 'degraded' || linked.role !== retirement.role) {
      throw new Error(`${label} does not bind degraded evidence`);
    }
    retirementIds.add(retirement.retirement_evidence_id);
  }
  const candidateCount = snapshot.models.reduce(
    (total, entry) => total + entry.provisional_roles.length,
    0,
  );
  if (candidateCount + snapshot.retirements.length !== evidence.length
      || evidence.some((entry) => (
        entry.state === 'degraded' && !retirementIds.has(entry.evidence_id)
      ))
      || evidence.filter((entry) => entry.state === 'provisional').some((entry) => (
        !currentCandidateIds.has(entry.evidence_id)
      ))) {
    throw new Error('AA snapshot evidence inventory is inconsistent');
  }
  return snapshot;
}

function candidateRoles(snapshot) {
  return [...new Set(snapshot.models.flatMap((entry) => entry.provisional_roles))].sort();
}

function validateRawPages(cacheDir, manifest) {
  if (!Array.isArray(manifest.raw_pages) || manifest.raw_pages.length === 0) {
    throw new Error('AA current manifest has no raw-page provenance');
  }
  let first = null;
  const models = [];
  for (let index = 0; index < manifest.raw_pages.length; index += 1) {
    const reference = manifest.raw_pages[index];
    const label = `AA current manifest.raw_pages[${index}]`;
    exactKeys(reference, ['page', 'hash', 'path'], label);
    if (reference.page !== index + 1
        || typeof reference.hash !== 'string'
        || !/^[a-f0-9]{64}$/.test(reference.hash)
        || reference.path !== `raw/${reference.hash}.json`) {
      throw new Error(`${label} is invalid`);
    }
    const rawFile = path.join(cacheDir, reference.path);
    let stats;
    try {
      stats = fs.lstatSync(rawFile);
    } catch {
      throw new Error(`${label} references a missing raw page`);
    }
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_PAGE_BYTES) {
      throw new Error(`${label} references an invalid raw page`);
    }
    const content = fs.readFileSync(rawFile, 'utf8');
    if (sha256(content) !== reference.hash) {
      throw new Error('AA current raw page failed its content hash');
    }
    let raw;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new Error(`${label} is not valid JSON`);
    }
    const page = validatePage(raw, index + 1);
    models.push(...page.data);
    if (first === null) {
      first = page;
    } else if (page.version !== first.version || page.tier !== first.tier
        || page.pagination.total_pages !== first.pagination.total_pages
        || page.pagination.page_size !== first.pagination.page_size) {
      throw new Error('AA current raw-page cohort is inconsistent');
    }
  }
  if (first.pagination.total_pages !== manifest.raw_pages.length
      || first.version !== manifest.intelligence_index_version
      || first.tier !== manifest.tier) {
    throw new Error('AA current raw pages do not match manifest metadata');
  }
  if (models.length > MAX_MODELS) {
    throw new Error(`AA current raw pages exceed the ${MAX_MODELS}-model safety bound`);
  }
  const modelIds = models.map((entry) => entry.id);
  if (new Set(modelIds).size !== modelIds.length) {
    throw new Error('AA current raw pages repeat a model id');
  }
  return {
    tier: first.tier,
    version: first.version,
    models,
  };
}

function validateRawSnapshotBinding(fetched, snapshot) {
  const expected = normalizeSnapshot(fetched, snapshot.retrieved_at);
  for (const field of [
    'tier',
    'intelligence_index_version',
    'cohort',
    'cohort_hash',
    'candidate_policy',
    'models',
  ]) {
    if (canonicalJson(snapshot[field]) !== canonicalJson(expected[field])) {
      throw new Error(`AA current raw pages do not derive snapshot field '${field}'`);
    }
  }
  const provisionalEvidence = snapshot.evidence.filter((entry) => (
    entry.state === 'provisional'
  ));
  if (canonicalJson(provisionalEvidence) !== canonicalJson(expected.evidence)) {
    throw new Error('AA current raw pages do not derive snapshot provisional evidence');
  }
}

function validateManifestMetadata(manifest, snapshot) {
  exactKeys(manifest, [
    'schema_version',
    'source',
    'retrieved_at',
    'tier',
    'intelligence_index_version',
    'cohort',
    'cohort_hash',
    'model_count',
    'evidence_count',
    'evidence_ids',
    'roles',
    'raw_pages',
    'snapshot_hash',
    'snapshot_path',
    'evidence_recorded',
  ], 'AA current manifest');
  const expected = {
    schema_version: 1,
    source: snapshot.source,
    retrieved_at: snapshot.retrieved_at,
    tier: snapshot.tier,
    intelligence_index_version: snapshot.intelligence_index_version,
    cohort: snapshot.cohort,
    cohort_hash: snapshot.cohort_hash,
    model_count: snapshot.models.length,
    evidence_count: snapshot.evidence.length,
    evidence_ids: snapshot.evidence.map((entry) => entry.evidence_id),
    roles: candidateRoles(snapshot),
  };
  for (const [field, value] of Object.entries(expected)) {
    if (canonicalJson(manifest[field]) !== canonicalJson(value)) {
      throw new Error(`AA current manifest metadata does not match snapshot field '${field}'`);
    }
  }
  if (typeof manifest.evidence_recorded !== 'boolean') {
    throw new Error('AA current manifest evidence_recorded must be boolean');
  }
}

function readCacheBundle(cacheDirRaw) {
  const cacheDir = resolvePhysicalTarget(expandTilde(cacheDirRaw || DEFAULT_CACHE_DIR));
  const currentFile = path.join(cacheDir, 'current.json');
  let currentStats;
  try {
    currentStats = fs.lstatSync(currentFile);
  } catch {
    throw new Error(`no valid Artificial Analysis cache at ${currentFile}`);
  }
  if (currentStats.isSymbolicLink() || !currentStats.isFile()
      || currentStats.size > MAX_MANIFEST_BYTES) {
    throw new Error(`AA current manifest path is invalid: ${currentFile}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
  } catch {
    throw new Error(`no valid Artificial Analysis cache at ${currentFile}`);
  }
  plainObject(manifest, 'AA current manifest');
  if (typeof manifest.snapshot_hash !== 'string'
      || !/^[a-f0-9]{64}$/.test(manifest.snapshot_hash)
      || manifest.snapshot_path !== `normalized/${manifest.snapshot_hash}.json`) {
    throw new Error('AA current manifest has an invalid snapshot reference');
  }
  const snapshotFile = path.join(cacheDir, manifest.snapshot_path);
  let snapshotStats;
  try {
    snapshotStats = fs.lstatSync(snapshotFile);
  } catch {
    throw new Error('AA current manifest references a missing snapshot');
  }
  if (snapshotStats.isSymbolicLink() || !snapshotStats.isFile()
      || snapshotStats.size > MAX_SNAPSHOT_BYTES) {
    throw new Error('AA current manifest references an invalid snapshot');
  }
  const content = fs.readFileSync(snapshotFile, 'utf8');
  if (sha256(content) !== manifest.snapshot_hash) {
    throw new Error('AA current snapshot failed its content hash');
  }
  let snapshot;
  try {
    snapshot = JSON.parse(content);
  } catch {
    throw new Error('AA current snapshot is not valid JSON');
  }
  validateCachedSnapshot(snapshot);
  validateManifestMetadata(manifest, snapshot);
  const fetched = validateRawPages(cacheDir, manifest);
  validateRawSnapshotBinding(fetched, snapshot);
  return { cacheDir, manifest, snapshot };
}

function normalizeRefreshOptions(rawOptions) {
  const options = plainObject(rawOptions, 'refresh options');
  for (const key of Object.keys(options)) {
    if (!REFRESH_OPTIONS.has(key)) throw new Error(`unsupported option "${key}"`);
  }
  const apiKey = options.apiKey === undefined
    ? process.env.ARTIFICIAL_ANALYSIS_API_KEY : options.apiKey;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('ARTIFICIAL_ANALYSIS_API_KEY is required for refresh');
  }
  const fetchImpl = options.fetchImpl === undefined ? globalThis.fetch : options.fetchImpl;
  if (typeof fetchImpl !== 'function') throw new Error('this Node runtime does not provide fetch');
  if (options.recordEvidence !== undefined && typeof options.recordEvidence !== 'boolean') {
    throw new Error('recordEvidence must be boolean');
  }
  const cacheDir = resolvePhysicalTarget(expandTilde(options.cacheDir || DEFAULT_CACHE_DIR));
  assertCacheDestination(cacheDir);
  const recordEvidence = options.recordEvidence !== false;
  const evidenceConfig = recordEvidence ? resolveEvidenceConfig(options.store) : null;
  const parsedNow = options.now === undefined ? Date.now() : Date.parse(options.now);
  if (!Number.isFinite(parsedNow)
      || (options.now !== undefined && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(options.now))) {
    throw new Error('now must be an ISO-8601 timestamp with a timezone');
  }
  return {
    apiKey,
    cacheDir,
    fetchImpl,
    now: new Date(parsedNow).toISOString(),
    recordEvidence,
    evidenceConfig,
  };
}

async function refreshCapabilities(rawOptions = {}) {
  const options = normalizeRefreshOptions(rawOptions);
  const fetched = await fetchAllPages(options.fetchImpl, options.apiKey);
  if (containsStringFragment(fetched.rawPages, options.apiKey)) {
    throw new Error('Artificial Analysis response contains credential material');
  }
  const baseSnapshot = normalizeSnapshot(fetched, options.now);
  const cacheLock = path.join(options.cacheDir, '.refresh.lock');
  assertCacheDestination(options.cacheDir);
  if (options.evidenceConfig) assertEvidenceDestination(options.evidenceConfig);

  return withWriteLock({
    storeDir: options.cacheDir,
    lockFile: cacheLock,
    name: 'Artificial Analysis cache',
  }, () => {
    assertCacheDestination(options.cacheDir);
    if (options.evidenceConfig) assertEvidenceDestination(options.evidenceConfig);
    secureDirectory(options.cacheDir);
    const currentFile = path.join(options.cacheDir, 'current.json');
    const previous = fs.existsSync(currentFile)
      ? readCacheBundle(options.cacheDir) : null;
    if (previous
        && Date.parse(previous.manifest.retrieved_at) > Date.parse(options.now)) {
      return previous.manifest;
    }
    const recordedRows = options.evidenceConfig
      ? readEvidenceRows(options.evidenceConfig.evidenceFile) : [];
    const recordedCandidates = activeRecordedAaCandidates(recordedRows, options.now);
    const snapshot = attachRetirements(
      baseSnapshot,
      previous ? previous.snapshot : null,
      options.now,
      previous ? !previous.manifest.evidence_recorded : false,
      recordedCandidates,
      new Set(recordedRows.map((row) => row.evidence.evidence_id)),
      options.recordEvidence,
    );
    const roles = candidateRoles(snapshot);
    const rawDir = path.join(options.cacheDir, 'raw');
    const normalizedDir = path.join(options.cacheDir, 'normalized');
    const createdFiles = [];
    try {
      const rawPages = fetched.rawPages.map((page, index) => {
        const stored = writeContentAddressed(rawDir, page);
        if (stored.created) createdFiles.push(stored.target);
        return {
          page: index + 1,
          hash: stored.hash,
          path: `raw/${stored.hash}.json`,
        };
      });
      const storedSnapshot = writeContentAddressed(normalizedDir, snapshot);
      if (storedSnapshot.created) createdFiles.push(storedSnapshot.target);

      const manifest = {
        schema_version: 1,
        source: snapshot.source,
        retrieved_at: snapshot.retrieved_at,
        tier: snapshot.tier,
        intelligence_index_version: snapshot.intelligence_index_version,
        cohort: snapshot.cohort,
        cohort_hash: snapshot.cohort_hash,
        model_count: snapshot.models.length,
        evidence_count: snapshot.evidence.length,
        evidence_ids: snapshot.evidence.map((entry) => entry.evidence_id),
        roles,
        raw_pages: rawPages,
        snapshot_hash: storedSnapshot.hash,
        snapshot_path: `normalized/${storedSnapshot.hash}.json`,
        evidence_recorded: options.recordEvidence,
      };
      const priorCurrent = captureCurrent(options.cacheDir);
      const publish = () => writeCurrentAtomic(options.cacheDir, manifest);
      const rollback = () => restoreCurrent(options.cacheDir, priorCurrent);
      if (options.recordEvidence && snapshot.evidence.length > 0) {
        assertEvidenceDestination(options.evidenceConfig);
        appendEvidenceRecords(
          options.evidenceConfig,
          snapshot.evidence,
          'aa-import-v1',
          { commit: publish, rollback },
        );
      } else {
        publish();
      }
      return manifest;
    } catch (error) {
      for (const file of createdFiles.reverse()) {
        try {
          fs.unlinkSync(file);
        } catch {
          // A pre-existing content-addressed object is never removed.
        }
      }
      for (const directory of [normalizedDir, rawDir]) {
        try {
          fs.rmdirSync(directory);
        } catch {
          // Keep non-empty directories and any objects owned by an earlier refresh.
        }
      }
      throw error;
    }
  });
}

function readCurrent(cacheDirRaw) {
  return readCacheBundle(cacheDirRaw).manifest;
}

function parseCli(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }
  const command = argv[0];
  const allowed = command === 'refresh'
    ? new Set(['cache-dir', 'store', 'now', 'no-record'])
    : command === 'current' ? new Set(['cache-dir']) : null;
  if (!allowed) throw new Error(`unknown command '${command}'`);
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--') || !allowed.has(arg.slice(2))) {
      throw new Error(`unknown option '${arg}'`);
    }
    const name = arg.slice(2);
    if (Object.prototype.hasOwnProperty.call(options, name)) {
      throw new Error(`duplicate option '${arg}'`);
    }
    if (name === 'no-record') {
      options[name] = true;
      continue;
    }
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }
    options[name] = argv[++index];
  }
  return { command, options };
}

async function main() {
  let parsed;
  try {
    parsed = parseCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.stdout.write(HELP_TEXT);
    process.exitCode = 2;
    return;
  }
  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  try {
    const result = parsed.command === 'refresh'
      ? await refreshCapabilities({
        cacheDir: parsed.options['cache-dir'],
        store: parsed.options.store,
        now: parsed.options.now,
        recordEvidence: !parsed.options['no-record'],
      })
      : readCurrent(parsed.options['cache-dir']);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  AA_ENDPOINT,
  normalizeSnapshot,
  readCurrent,
  refreshCapabilities,
};
