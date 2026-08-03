'use strict';

// LSM P2 merge-intent builder and preflight.
// This module deliberately exposes no merge/stash/write adapter. Every default
// Git command is an observation (`rev-parse`, `diff`, `status`-equivalent
// inventory); execution belongs to LSM P3 and must require this artifact's seal.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { canonicalDigest } = require('../engine/implementation-campaign');

const SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'merge_intent_manifest';
const ALLOWED_MODES = new Set(['no-ff', 'ff-only']);
const REQUIRED_RESULT = 'source-contained';
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

class MergeIntentError extends Error {
  constructor(message, code = 'MERGE_INTENT_INVALID') {
    super(message);
    this.name = 'MergeIntentError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MergeIntentError(message, code);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value, required, label) {
  if (!isPlainObject(value)) fail('MERGE_INTENT_SHAPE', `${label} must be a plain object`);
  const expected = new Set(required);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) fail('MERGE_INTENT_UNKNOWN_FIELD', `${label} has unknown field "${key}"`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail('MERGE_INTENT_MISSING_FIELD', `${label} is missing "${key}"`);
    }
  }
}

function git(cwd, args, code, label) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0) {
    fail(code, `${label}: ${String(result.stderr || result.error || result.signal).trim()}`);
  }
  return result.stdout;
}

function canonicalRepo(repo) {
  if (typeof repo !== 'string' || repo.length === 0) {
    fail('MERGE_INTENT_REPO', 'repo must be a non-empty path');
  }
  let resolved;
  try {
    resolved = fs.realpathSync(repo);
  } catch (_error) {
    fail('MERGE_INTENT_REPO', `repo does not exist: ${repo}`);
  }
  git(resolved, ['rev-parse', '--git-dir'], 'MERGE_INTENT_REPO', 'repo is not a Git repository');
  return resolved;
}

function canonicalWorktree(worktree) {
  if (typeof worktree !== 'string' || worktree.length === 0 || !path.isAbsolute(worktree)) {
    fail('MERGE_INTENT_WORKTREE', 'worktree must be an absolute path');
  }
  let resolved;
  try {
    resolved = fs.realpathSync(worktree);
  } catch (_error) {
    fail('MERGE_INTENT_WORKTREE', `worktree does not exist: ${worktree}`);
  }
  const top = git(
    resolved,
    ['rev-parse', '--show-toplevel'],
    'MERGE_INTENT_WORKTREE',
    'worktree is not a Git worktree',
  ).trim();
  if (fs.realpathSync(top) !== resolved) {
    fail('MERGE_INTENT_WORKTREE', `worktree is not an exact Git worktree root: ${worktree}`);
  }
  return resolved;
}

function defaultResolveRef({ ref, worktree }) {
  if (typeof ref !== 'string' || !ref.startsWith('refs/')) {
    fail('MERGE_INTENT_REF', `ref must be an exact refs/* name: ${String(ref)}`);
  }
  const result = spawnSync('git', ['-C', worktree, 'rev-parse', '--verify', `${ref}^{commit}`], {
    encoding: 'utf8',
  });
  if (result.error || result.signal || result.status !== 0) {
    fail('MERGE_INTENT_REF_MISSING', `ref does not resolve to a commit: ${ref}`);
  }
  const sha = result.stdout.trim();
  if (!GIT_OID.test(sha)) fail('MERGE_INTENT_REF_MISSING', `ref returned an invalid OID: ${ref}`);
  return sha;
}

function defaultResolveWorktreeHead({ worktree }) {
  const sha = git(
    worktree,
    ['rev-parse', '--verify', 'HEAD^{commit}'],
    'MERGE_INTENT_WORKTREE',
    'cannot resolve worktree HEAD',
  ).trim();
  if (!GIT_OID.test(sha)) fail('MERGE_INTENT_WORKTREE', 'worktree HEAD returned an invalid OID');
  return sha;
}

function commonDir(worktree) {
  const raw = git(
    worktree,
    ['rev-parse', '--git-common-dir'],
    'MERGE_INTENT_WORKTREE',
    'cannot resolve worktree repository',
  ).trim();
  return fs.realpathSync(path.isAbsolute(raw) ? raw : path.resolve(worktree, raw));
}

function resolvePinnedEndpoint(repo, ref, worktree, resolveRef) {
  const exactWorktree = canonicalWorktree(worktree);
  if (commonDir(exactWorktree) !== commonDir(repo)) {
    fail('MERGE_INTENT_WORKTREE', `worktree is outside the declared repository: ${worktree}`);
  }
  const sha = resolveRef({ repo, ref, worktree: exactWorktree });
  if (!GIT_OID.test(sha)) fail('MERGE_INTENT_REF_MISSING', `ref returned an invalid OID: ${ref}`);
  const head = defaultResolveWorktreeHead({ repo, worktree: exactWorktree });
  if (head !== sha) {
    fail('MERGE_INTENT_WORKTREE_DRIFT', `worktree HEAD does not match ${ref}`);
  }
  return { worktree: exactWorktree, sha };
}

function validatePathPrefix(prefix) {
  return typeof prefix === 'string'
    && prefix.length > 0
    && prefix.endsWith('/')
    && !path.isAbsolute(prefix)
    && prefix !== '../'
    && !prefix.split('/').includes('..')
    && prefix.replace(/\\/g, '/') === prefix;
}

function edgeKey(sourceRef, targetRef) {
  return `${sourceRef}\0${targetRef}`;
}

function buildMergeIntent(input, adapters = {}) {
  assertExactKeys(
    input,
    ['repo', 'root_run_id', 'edges', 'forbidden_reverse_edges', 'preservation_policy'],
    'merge intent input',
  );
  if (!isPlainObject(adapters)
      || Object.keys(adapters).some((key) => key !== 'resolveRef')) {
    fail('MERGE_INTENT_ADAPTER', 'build adapters may contain only resolveRef');
  }
  if (typeof input.root_run_id !== 'string' || input.root_run_id.length === 0) {
    fail('MERGE_INTENT_ROOT_RUN_ID', 'root_run_id must be non-empty');
  }
  if (!Array.isArray(input.edges) || input.edges.length === 0) {
    fail('MERGE_INTENT_EDGES', 'edges must be a non-empty ordered array');
  }
  if (!Array.isArray(input.forbidden_reverse_edges)) {
    fail('MERGE_INTENT_FORBIDDEN_EDGE', 'forbidden_reverse_edges must be an array');
  }
  assertExactKeys(
    input.preservation_policy,
    ['allowed_path_prefixes'],
    'preservation_policy',
  );
  if (!Array.isArray(input.preservation_policy.allowed_path_prefixes)
      || !input.preservation_policy.allowed_path_prefixes.every(validatePathPrefix)) {
    fail(
      'MERGE_INTENT_POLICY',
      'allowed_path_prefixes must contain normalized relative directory prefixes ending in "/"',
    );
  }
  const allowedPathPrefixes = [...new Set(input.preservation_policy.allowed_path_prefixes)].sort();
  if (allowedPathPrefixes.length !== input.preservation_policy.allowed_path_prefixes.length) {
    fail('MERGE_INTENT_POLICY', 'allowed_path_prefixes must not contain duplicates');
  }

  const repo = canonicalRepo(input.repo);
  const resolveRef = adapters.resolveRef || defaultResolveRef;
  const forbidden = [];
  const forbiddenKeys = new Set();
  for (const [index, item] of input.forbidden_reverse_edges.entries()) {
    assertExactKeys(item, ['source_ref', 'target_ref'], `forbidden_reverse_edges[${index}]`);
    if (typeof item.source_ref !== 'string' || !item.source_ref.startsWith('refs/')
        || typeof item.target_ref !== 'string' || !item.target_ref.startsWith('refs/')) {
      fail('MERGE_INTENT_REF', 'forbidden edges require exact refs/* names');
    }
    if (item.source_ref === item.target_ref) {
      fail('MERGE_INTENT_SAME_ENDPOINT', 'forbidden edge endpoints must differ');
    }
    const key = edgeKey(item.source_ref, item.target_ref);
    if (forbiddenKeys.has(key)) fail('MERGE_INTENT_FORBIDDEN_EDGE', 'duplicate forbidden edge');
    forbiddenKeys.add(key);
    forbidden.push({ source_ref: item.source_ref, target_ref: item.target_ref });
  }
  forbidden.sort((left, right) =>
    edgeKey(left.source_ref, left.target_ref)
      .localeCompare(edgeKey(right.source_ref, right.target_ref)));

  const seenEdges = new Set();
  const lastProducerByRef = new Map();
  const edges = input.edges.map((item, index) => {
    assertExactKeys(item, [
      'source_ref',
      'source_worktree',
      'target_ref',
      'target_worktree',
      'mode',
      'required_result',
    ], `edges[${index}]`);
    if (!ALLOWED_MODES.has(item.mode)) {
      fail('MERGE_INTENT_MODE', `edges[${index}].mode must be no-ff or ff-only`);
    }
    if (item.required_result !== REQUIRED_RESULT) {
      fail('MERGE_INTENT_REQUIRED_RESULT', `edges[${index}].required_result is unsupported`);
    }
    if (item.source_ref === item.target_ref || item.source_worktree === item.target_worktree) {
      fail('MERGE_INTENT_SAME_ENDPOINT', `edges[${index}] source and target must differ`);
    }
    const key = edgeKey(item.source_ref, item.target_ref);
    if (seenEdges.has(key)) fail('MERGE_INTENT_EDGE_DUPLICATE', `edges[${index}] is duplicated`);
    if (forbiddenKeys.has(key)) {
      fail('MERGE_INTENT_FORBIDDEN_EDGE', `edges[${index}] is explicitly forbidden`);
    }
    seenEdges.add(key);
    const source = resolvePinnedEndpoint(repo, item.source_ref, item.source_worktree, resolveRef);
    const target = resolvePinnedEndpoint(repo, item.target_ref, item.target_worktree, resolveRef);
    if (source.sha === target.sha) {
      fail('MERGE_INTENT_SAME_ENDPOINT', `edges[${index}] source and target SHAs must differ`);
    }
    const edge = {
      sequence: index + 1,
      source_ref: item.source_ref,
      source_worktree: source.worktree,
      source_sha: source.sha,
      source_from_edge: lastProducerByRef.get(item.source_ref) || null,
      target_ref: item.target_ref,
      target_worktree: target.worktree,
      target_sha: target.sha,
      target_from_edge: lastProducerByRef.get(item.target_ref) || null,
      mode: item.mode,
      required_result: item.required_result,
    };
    lastProducerByRef.set(item.target_ref, edge.sequence);
    return edge;
  });

  const manifest = {
    schema_version: SCHEMA_VERSION,
    artifact_type: ARTIFACT_TYPE,
    repo,
    root_run_id: input.root_run_id,
    edges,
    forbidden_reverse_edges: forbidden,
    preservation_policy: { allowed_path_prefixes: allowedPathPrefixes },
  };
  return { manifest, seal: canonicalDigest(manifest) };
}

function verifyMergeIntentSeal(value) {
  return isPlainObject(value)
    && isPlainObject(value.manifest)
    && typeof value.seal === 'string'
    && /^[0-9a-f]{64}$/.test(value.seal)
    && canonicalDigest(value.manifest) === value.seal;
}

function parseNul(output) {
  return output.split('\0').filter(Boolean).sort();
}

function defaultInventoryDirty({ edge }) {
  const cwd = edge.target_worktree;
  const ambiguous = parseNul(git(
    cwd,
    ['diff', '--name-only', '--diff-filter=U', '-z'],
    'MERGE_INTENT_DIRTY',
    'cannot inventory unmerged paths',
  ));
  return {
    staged: parseNul(git(
      cwd,
      ['diff', '--cached', '--name-only', '-z'],
      'MERGE_INTENT_DIRTY',
      'cannot inventory staged paths',
    )),
    unstaged: parseNul(git(
      cwd,
      ['diff', '--name-only', '-z'],
      'MERGE_INTENT_DIRTY',
      'cannot inventory unstaged paths',
    )),
    untracked: parseNul(git(
      cwd,
      ['ls-files', '--others', '--exclude-standard', '-z'],
      'MERGE_INTENT_DIRTY',
      'cannot inventory untracked paths',
    )),
    ambiguous,
  };
}

function defaultIncomingPaths({ edge }) {
  const baseResult = spawnSync(
    'git',
    ['-C', edge.target_worktree, 'merge-base', edge.target_sha, edge.source_sha],
    { encoding: 'utf8' },
  );
  if (baseResult.error || baseResult.signal || baseResult.status !== 0) {
    return { paths: [], ambiguous: true };
  }
  const base = baseResult.stdout.trim();
  return {
    paths: parseNul(git(
      edge.target_worktree,
      ['diff', '--name-only', '-z', base, edge.source_sha],
      'MERGE_INTENT_INCOMING',
      'cannot inventory incoming paths',
    )),
    ambiguous: false,
  };
}

function defaultIsAncestor({ repo, ancestor, descendant }) {
  const result = spawnSync(
    'git',
    ['-C', repo, 'merge-base', '--is-ancestor', ancestor, descendant],
    { encoding: 'utf8' },
  );
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    fail('MERGE_INTENT_GRAPH', 'cannot inspect commit ancestry');
  }
  return result.status === 0;
}

function normalizePathList(value, label) {
  if (!Array.isArray(value)
      || value.some((item) => typeof item !== 'string'
        || item.length === 0
        || path.isAbsolute(item)
        || item.split('/').includes('..'))) {
    fail('MERGE_INTENT_ADAPTER', `${label} must be normalized relative paths`);
  }
  return [...new Set(value)].sort();
}

function normalizeDirty(value) {
  if (!isPlainObject(value)) fail('MERGE_INTENT_ADAPTER', 'dirty inventory must be an object');
  return {
    staged: normalizePathList(value.staged, 'dirty.staged'),
    unstaged: normalizePathList(value.unstaged, 'dirty.unstaged'),
    untracked: normalizePathList(value.untracked, 'dirty.untracked'),
    ambiguous: normalizePathList(value.ambiguous, 'dirty.ambiguous'),
  };
}

function normalizeIncoming(value) {
  if (!isPlainObject(value) || typeof value.ambiguous !== 'boolean') {
    fail('MERGE_INTENT_ADAPTER', 'incoming inventory must have paths and ambiguous');
  }
  return {
    paths: normalizePathList(value.paths, 'incoming.paths'),
    ambiguous: value.ambiguous,
  };
}

function sealPreflight(body) {
  return { ...body, receipt_digest: canonicalDigest(body) };
}

function preflightCanonicalMergeIntent(sealed, adapters = {}) {
  if (!isPlainObject(adapters)
      || Object.keys(adapters).some((key) =>
        ![
          'resolveRef',
          'resolveWorktreeHead',
          'inventoryDirty',
          'incomingPaths',
          'isAncestor',
        ].includes(key))) {
    fail(
      'MERGE_INTENT_ADAPTER',
      'preflight adapters may contain only read-only ref, worktree, dirty, and incoming observers',
    );
  }
  if (!verifyMergeIntentSeal(sealed)) {
    return sealPreflight({
      schema_version: SCHEMA_VERSION,
      artifact_type: 'merge_intent_preflight',
      manifest_seal: sealed && typeof sealed.seal === 'string' ? sealed.seal : null,
      status: 'blocked',
      can_merge: false,
      edges: [],
      blockers: [{ edge_sequence: null, reason: 'manifest_seal_drift', paths: [] }],
    });
  }
  const { manifest } = sealed;
  const resolveRef = adapters.resolveRef || defaultResolveRef;
  const resolveWorktreeHead = adapters.resolveWorktreeHead || defaultResolveWorktreeHead;
  const inventoryDirty = adapters.inventoryDirty || defaultInventoryDirty;
  const incomingPaths = adapters.incomingPaths || defaultIncomingPaths;
  const isAncestor = adapters.isAncestor || defaultIsAncestor;
  const policy = manifest.preservation_policy.allowed_path_prefixes;
  const forbidden = new Set(manifest.forbidden_reverse_edges.map((edge) =>
    edgeKey(edge.source_ref, edge.target_ref)));
  const blockers = [];
  const edgeReports = [];

  for (const edge of manifest.edges) {
    let sourceSha;
    let targetSha;
    let sourceHead;
    let targetHead;
    try {
      sourceSha = resolveRef({
        repo: manifest.repo,
        ref: edge.source_ref,
        worktree: edge.source_worktree,
      });
      targetSha = resolveRef({
        repo: manifest.repo,
        ref: edge.target_ref,
        worktree: edge.target_worktree,
      });
      sourceHead = resolveWorktreeHead({
        repo: manifest.repo,
        worktree: edge.source_worktree,
      });
      targetHead = resolveWorktreeHead({
        repo: manifest.repo,
        worktree: edge.target_worktree,
      });
    } catch (error) {
      blockers.push({
        edge_sequence: edge.sequence,
        reason: 'ref_resolution_failed',
        paths: [],
      });
      edgeReports.push({
        sequence: edge.sequence,
        status: 'blocked',
        dirty: { staged: [], unstaged: [], untracked: [], ambiguous: [] },
        incoming_paths: [],
        overlapping_paths: [],
        preservation_proposal: [],
      });
      continue;
    }
    if (forbidden.has(edgeKey(edge.source_ref, edge.target_ref))) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'forbidden_edge', paths: [] });
    }
    if (sourceSha !== edge.source_sha) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'source_sha_drift', paths: [] });
    }
    if (targetSha !== edge.target_sha) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'target_sha_drift', paths: [] });
    }
    if (sourceHead !== edge.source_sha) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'source_worktree_drift', paths: [] });
    }
    if (targetHead !== edge.target_sha) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'target_worktree_drift', paths: [] });
    }
    if (edge.mode === 'ff-only') {
      let fastForwardPossible = false;
      try {
        fastForwardPossible = isAncestor({
          repo: manifest.repo,
          ancestor: edge.target_sha,
          descendant: edge.source_sha,
        }) === true;
      } catch (_error) {
        blockers.push({
          edge_sequence: edge.sequence,
          reason: 'ancestry_resolution_failed',
          paths: [],
        });
      }
      if (!fastForwardPossible) {
        blockers.push({
          edge_sequence: edge.sequence,
          reason: 'ff_only_not_possible',
          paths: [],
        });
      }
    }

    let dirty;
    let incoming;
    try {
      dirty = normalizeDirty(inventoryDirty({ repo: manifest.repo, edge: { ...edge } }));
      incoming = normalizeIncoming(incomingPaths({ repo: manifest.repo, edge: { ...edge } }));
    } catch (_error) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'inventory_failed', paths: [] });
      edgeReports.push({
        sequence: edge.sequence,
        status: 'blocked',
        dirty: { staged: [], unstaged: [], untracked: [], ambiguous: [] },
        incoming_paths: [],
        overlapping_paths: [],
        preservation_proposal: [],
      });
      continue;
    }
    const dirtyPaths = [...new Set([
      ...dirty.staged,
      ...dirty.unstaged,
      ...dirty.untracked,
      ...dirty.ambiguous,
    ])].sort();
    const outside = dirtyPaths.filter((item) =>
      !policy.some((prefix) => item.startsWith(prefix)));
    if (outside.length > 0) {
      blockers.push({
        edge_sequence: edge.sequence,
        reason: 'dirty_path_outside_policy',
        paths: outside,
      });
    }
    const incomingSet = new Set(incoming.paths);
    const overlapping = dirtyPaths.filter((item) => incomingSet.has(item));
    let status = 'safe';
    if (outside.length > 0) status = 'blocked';
    else if (dirty.ambiguous.length > 0 || incoming.ambiguous) status = 'ambiguous';
    else if (overlapping.length > 0) status = 'overlapping';
    edgeReports.push({
      sequence: edge.sequence,
      source_ref: edge.source_ref,
      source_from_edge: edge.source_from_edge,
      target_ref: edge.target_ref,
      target_from_edge: edge.target_from_edge,
      mode: edge.mode,
      status,
      dirty,
      incoming_paths: incoming.paths,
      overlapping_paths: overlapping,
      preservation_proposal: status === 'overlapping' ? overlapping : [],
    });
  }

  let status = 'safe';
  if (blockers.length > 0 || edgeReports.some((edge) => edge.status === 'blocked')) status = 'blocked';
  else if (edgeReports.some((edge) => edge.status === 'ambiguous')) status = 'ambiguous';
  else if (edgeReports.some((edge) => edge.status === 'overlapping')) status = 'overlapping';
  return sealPreflight({
    schema_version: SCHEMA_VERSION,
    artifact_type: 'merge_intent_preflight',
    manifest_seal: sealed.seal,
    status,
    can_merge: status === 'safe',
    edges: edgeReports,
    blockers,
  });
}

// Compatibility boundary frozen by the independent LSM P2 oracle. It accepts
// injected read-only observations and returns a flat sealed manifest. The
// repository-backed builder above remains the stricter production constructor.
function sealMergeIntent(input, adapters = {}) {
  if (!isPlainObject(input)
      || input.schema_version !== SCHEMA_VERSION
      || input.artifact_type !== ARTIFACT_TYPE
      || typeof input.repo !== 'string'
      || !Array.isArray(input.edges)
      || input.edges.length === 0
      || !Array.isArray(input.forbidden_edges)
      || !isPlainObject(input.preservation_policy)
      || !Array.isArray(input.preservation_policy.allowed_paths)) {
    fail('MERGE_INTENT_SHAPE', 'flat merge intent has an invalid shape');
  }
  if (!isPlainObject(adapters) || typeof adapters.resolveRef !== 'function') {
    fail('MERGE_INTENT_ADAPTER', 'flat merge intent requires read-only resolveRef');
  }
  const allowedPaths = normalizePathList(
    input.preservation_policy.allowed_paths,
    'preservation_policy.allowed_paths',
  );
  const forbiddenKeys = new Set();
  const forbiddenEdges = input.forbidden_edges.map((edge, index) => {
    if (!isPlainObject(edge)
        || typeof edge.source_ref !== 'string'
        || typeof edge.target_ref !== 'string') {
      fail('MERGE_INTENT_FORBIDDEN_EDGE', `forbidden_edges[${index}] is invalid`);
    }
    const key = edgeKey(edge.source_ref, edge.target_ref);
    if (forbiddenKeys.has(key)) fail('MERGE_INTENT_FORBIDDEN_EDGE', 'duplicate forbidden edge');
    forbiddenKeys.add(key);
    return { source_ref: edge.source_ref, target_ref: edge.target_ref };
  }).sort((left, right) =>
    edgeKey(left.source_ref, left.target_ref)
      .localeCompare(edgeKey(right.source_ref, right.target_ref)));
  const seen = new Set();
  const lastProducerByRef = new Map();
  const edges = input.edges.map((edge, index) => {
    if (!isPlainObject(edge)
        || typeof edge.source_ref !== 'string'
        || typeof edge.target_ref !== 'string'
        || typeof edge.target_worktree !== 'string') {
      fail('MERGE_INTENT_SHAPE', `edges[${index}] is invalid`);
    }
    if (!ALLOWED_MODES.has(edge.mode)) {
      fail('MERGE_INTENT_MODE', `edges[${index}].mode must be no-ff or ff-only`);
    }
    if (edge.required_result !== true) {
      fail('MERGE_INTENT_REQUIRED_RESULT', `edges[${index}].required_result must be true`);
    }
    if (edge.source_ref === edge.target_ref) {
      fail('MERGE_INTENT_SAME_ENDPOINT', `edges[${index}] source and target refs are equal`);
    }
    const key = edgeKey(edge.source_ref, edge.target_ref);
    if (forbiddenKeys.has(key)) {
      fail('MERGE_INTENT_FORBIDDEN_EDGE', `edges[${index}] direction is forbidden`);
    }
    if (seen.has(key)) fail('MERGE_INTENT_EDGE_DUPLICATE', `edges[${index}] is duplicated`);
    seen.add(key);
    const sourceSha = adapters.resolveRef({ repo: input.repo, ref: edge.source_ref });
    const targetSha = adapters.resolveRef({ repo: input.repo, ref: edge.target_ref });
    if (!GIT_OID.test(sourceSha)) {
      fail('MERGE_INTENT_REF_MISSING', `source ref is missing: ${edge.source_ref}`);
    }
    if (!GIT_OID.test(targetSha)) {
      fail('MERGE_INTENT_REF_MISSING', `target ref is missing: ${edge.target_ref}`);
    }
    if (sourceSha === targetSha) {
      fail('MERGE_INTENT_SAME_ENDPOINT', `edges[${index}] source and target SHAs are equal`);
    }
    const sealedEdge = {
      sequence: index + 1,
      source_ref: edge.source_ref,
      source_sha: sourceSha,
      source_from_edge: lastProducerByRef.get(edge.source_ref) || null,
      target_ref: edge.target_ref,
      target_sha: targetSha,
      target_from_edge: lastProducerByRef.get(edge.target_ref) || null,
      target_worktree: edge.target_worktree,
      mode: edge.mode,
      required_result: true,
    };
    lastProducerByRef.set(edge.target_ref, sealedEdge.sequence);
    return sealedEdge;
  });
  const body = {
    schema_version: SCHEMA_VERSION,
    artifact_type: ARTIFACT_TYPE,
    repo: input.repo,
    edges,
    forbidden_edges: forbiddenEdges,
    preservation_policy: { allowed_paths: allowedPaths },
  };
  return { ...body, seal: canonicalDigest(body) };
}

function preflightFlatMergeIntent(sealed, adapters) {
  if (!isPlainObject(sealed) || typeof sealed.seal !== 'string') {
    return {
      status: 'blocked',
      can_merge: false,
      edges: [],
      blockers: [{ reason: 'manifest_seal_missing', paths: [] }],
    };
  }
  const { seal, ...body } = sealed;
  if (canonicalDigest(body) !== seal) {
    return {
      status: 'blocked',
      can_merge: false,
      edges: [],
      blockers: [{ reason: 'manifest_seal_drift', paths: [] }],
    };
  }
  if (!isPlainObject(adapters)
      || typeof adapters.resolveRef !== 'function'
      || typeof adapters.incomingPaths !== 'function'
      || typeof adapters.inspectDirty !== 'function') {
    fail('MERGE_INTENT_ADAPTER', 'flat preflight requires three read-only observers');
  }
  const allowed = new Set(sealed.preservation_policy.allowed_paths);
  const forbidden = new Set(sealed.forbidden_edges.map((edge) =>
    edgeKey(edge.source_ref, edge.target_ref)));
  const blockers = [];
  const reports = [];
  const proposed = new Set();
  const dirtyInventory = [];
  let hasOverlap = false;
  let hasAmbiguity = false;
  for (const edge of sealed.edges) {
    const sourceSha = adapters.resolveRef({ repo: sealed.repo, ref: edge.source_ref });
    const targetSha = adapters.resolveRef({ repo: sealed.repo, ref: edge.target_ref });
    if (!GIT_OID.test(sourceSha)) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'source_ref_missing', paths: [] });
    } else if (sourceSha !== edge.source_sha) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'source_sha_drift', paths: [] });
    }
    if (!GIT_OID.test(targetSha)) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'target_ref_missing', paths: [] });
    } else if (targetSha !== edge.target_sha) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'target_sha_drift', paths: [] });
    }
    if (forbidden.has(edgeKey(edge.source_ref, edge.target_ref))) {
      blockers.push({ edge_sequence: edge.sequence, reason: 'forbidden_edge', paths: [] });
    }
    const incomingValue = adapters.incomingPaths({
      repo: sealed.repo,
      source_sha: edge.source_sha,
      target_sha: edge.target_sha,
    });
    const incoming = Array.isArray(incomingValue)
      ? normalizePathList(incomingValue, 'incoming paths')
      : normalizeIncoming(incomingValue).paths;
    const rawDirty = adapters.inspectDirty({
      repo: sealed.repo,
      worktree: edge.target_worktree,
      target_ref: edge.target_ref,
    });
    const dirty = normalizeDirty({
      staged: rawDirty.staged || [],
      unstaged: rawDirty.unstaged || [],
      untracked: rawDirty.untracked || [],
      ambiguous: rawDirty.ambiguous || [],
    });
    dirtyInventory.push({
      edge_sequence: edge.sequence,
      target_ref: edge.target_ref,
      ...dirty,
    });
    const incomingSet = new Set(incoming);
    const dirtyPaths = [...new Set([
      ...dirty.staged,
      ...dirty.unstaged,
      ...dirty.untracked,
      ...dirty.ambiguous,
    ])].sort();
    const overlapping = dirtyPaths.filter((item) => incomingSet.has(item));
    const outside = overlapping.filter((item) => !allowed.has(item));
    if (outside.length > 0) {
      blockers.push({
        edge_sequence: edge.sequence,
        reason: 'overlap_outside_preservation_policy',
        paths: outside,
      });
    }
    for (const item of overlapping) {
      if (allowed.has(item)) proposed.add(item);
    }
    if (dirty.ambiguous.length > 0) hasAmbiguity = true;
    if (overlapping.length > 0) hasOverlap = true;
    reports.push({
      ...edge,
      status: outside.length > 0
        ? 'blocked'
        : (dirty.ambiguous.length > 0 ? 'ambiguous' : (overlapping.length > 0 ? 'overlapping' : 'safe')),
      dirty,
      incoming_paths: incoming,
      overlapping_paths: overlapping,
      preservation_proposal: overlapping.filter((item) => allowed.has(item)),
    });
  }
  let status = 'safe';
  if (blockers.length > 0) status = 'blocked';
  else if (hasAmbiguity) status = 'ambiguous';
  else if (hasOverlap) status = 'overlapping';
  return sealPreflight({
    schema_version: SCHEMA_VERSION,
    artifact_type: 'merge_intent_preflight',
    manifest_seal: seal,
    status,
    can_merge: status === 'safe',
    edges: reports,
    blockers,
    proposed_preservation_paths: [...proposed].sort(),
    dirty_inventory: dirtyInventory,
  });
}

function preflightMergeIntent(sealed, adapters = {}) {
  return sealed && Object.prototype.hasOwnProperty.call(sealed, 'manifest')
    ? preflightCanonicalMergeIntent(sealed, adapters)
    : preflightFlatMergeIntent(sealed, adapters);
}

module.exports = {
  ARTIFACT_TYPE,
  MergeIntentError,
  SCHEMA_VERSION,
  buildMergeIntent,
  preflightMergeIntent,
  sealMergeIntent,
  verifyMergeIntentSeal,
};
