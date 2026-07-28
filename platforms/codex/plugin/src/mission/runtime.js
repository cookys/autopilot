'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const mission = require('../engine/mission-convergence');
const {
  missionCampaignIdFor,
  missionSubjectDigest,
} = require('../engine/mission-campaign-identity');
const {
  normalizeTaskAuthorityEnvelope,
} = require('../engine/owner-kernel/task-authority');

const RUNTIME_SCHEMA_VERSION = 1;
const PREPARE_ARTIFACT = 'mission_prepare_receipt';
const REGISTRY_ARTIFACT = 'mission_runtime_registry';
const TERMINAL_OUTCOMES = new Set(['ready', 'follow_up', 'blocked', 'abort', 'unknown']);
const SHA256 = /^[a-f0-9]{64}$/;
const LINEAGE = /^lineage-v1-[a-f0-9]{64}$/;
const REGISTRY_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'repo_identity',
  'missions',
]);
const REGISTRY_ENTRY_KEYS = new Set([
  'schema_version',
  'adoption_key',
  'repo_identity',
  'mission_lineage_id',
  'task_authority_id',
  'policy_hash',
  'intent_hash',
  'initial_required_acceptance_hashes',
  'mission_policy_digest',
  'mission_graph_digest',
  'enforcement_mode',
  'prepared_state_hash',
  'state_ref',
]);
const PREPARE_RECEIPT_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'repo_identity',
  'adoption_key',
  'mission_lineage_id',
  'task_authority_id',
  'policy_hash',
  'intent_hash',
  'initial_required_acceptance_hashes',
  'mission_policy_digest',
  'mission_graph_digest',
  'enforcement_mode',
  'state_hash',
  'adopted',
  'prepared_at',
  'receipt_digest',
]);

class MissionRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MissionRuntimeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MissionRuntimeError(code, message);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) fail('MISSION_RUNTIME_INVALID', `${label} must be an object`);
  return value;
}

function requireString(value, label, pattern = null) {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    fail('MISSION_RUNTIME_INVALID', `${label} is invalid`);
  }
  return value;
}

function assertExactKeys(value, allowed, label, code = 'MISSION_RUNTIME_INVALID') {
  const keys = Object.keys(requireObject(value, label));
  const unexpected = keys.filter((key) => !allowed.has(key));
  const missing = [...allowed].filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (unexpected.length > 0 || missing.length > 0) {
    fail(
      code,
      `${label} keys are invalid`
        + `${unexpected.length > 0 ? `; unexpected: ${unexpected.join(', ')}` : ''}`
        + `${missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''}`,
    );
  }
  return value;
}

function canonicalClone(value) {
  return JSON.parse(mission.canonicalJson(value));
}

function atomicWriteJson(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  let fd = null;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, bytes, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, target);
    try {
      const parent = fs.openSync(path.dirname(target), 'r');
      try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    } catch (_error) {
      // Some filesystems do not permit directory fsync.
    }
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_error) { /* ignore */ }
    }
    try { fs.unlinkSync(temp); } catch (_error) { /* ignore */ }
  }
}

function positiveEnvironmentInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function processStartIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close === -1) return null;
    const fieldsFromState = stat.slice(close + 2).trim().split(/\s+/);
    const startTime = fieldsFromState[19];
    return typeof startTime === 'string' && /^\d+$/.test(startTime) ? startTime : null;
  } catch (_error) {
    return null;
  }
}

function processIsAlive(owner) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return error.code === 'EPERM';
  }
  const observedStart = processStartIdentity(owner.pid);
  if (owner.process_start !== null && observedStart !== null) {
    return owner.process_start === observedStart;
  }
  return true;
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function inspectLock(lockPath) {
  let before;
  try {
    before = fs.lstatSync(lockPath);
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    return { status: 'unsafe', stat: before };
  }
  let fd = null;
  let opened;
  let raw;
  try {
    fd = fs.openSync(
      lockPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    opened = fs.fstatSync(fd);
    raw = fs.readFileSync(fd, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing' };
    if (error.code === 'ELOOP') return { status: 'unsafe', stat: before };
    throw error;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_error) { /* ignore */ }
    }
  }
  if (!opened.isFile() || !sameInode(before, opened)) return { status: 'changed' };
  let value;
  try { value = JSON.parse(raw); } catch (_error) { value = null; }
  let after;
  try {
    after = fs.lstatSync(lockPath);
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
  if (!sameInode(before, after)) return { status: 'changed' };
  const valid = isPlainObject(value)
    && value.schema_version === 1
    && Number.isSafeInteger(value.pid)
    && value.pid > 0
    && (value.process_start === null
      || (typeof value.process_start === 'string' && /^\d+$/.test(value.process_start)))
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at))
    && typeof value.nonce === 'string'
    && /^[a-f0-9]{32}$/.test(value.nonce)
    && Object.keys(value).sort().join(',') === [
      'created_at',
      'nonce',
      'pid',
      'process_start',
      'schema_version',
    ].sort().join(',');
  return {
    status: valid ? 'valid' : 'invalid',
    stat: after,
    owner: valid ? value : null,
  };
}

function reapLock(lockPath, inspected) {
  let current;
  try {
    current = fs.lstatSync(lockPath);
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
  if (!inspected.stat || !sameInode(inspected.stat, current)) return false;
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

function withExclusiveLock(lockPath, operation) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now()
    + positiveEnvironmentInteger('AUTOPILOT_MISSION_LOCK_TIMEOUT_MS', 8000);
  const invalidGraceMs = positiveEnvironmentInteger(
    'AUTOPILOT_MISSION_LOCK_STALE_MS',
    30000,
  );
  let delay = 5;
  let acquired = false;
  const owner = {
    schema_version: 1,
    pid: process.pid,
    process_start: processStartIdentity(process.pid),
    created_at: new Date().toISOString(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  while (!acquired) {
    let fd = null;
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(fd, `${JSON.stringify(owner)}\n`);
      fs.fsyncSync(fd);
      acquired = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const inspected = inspectLock(lockPath);
      if (inspected.status === 'unsafe') {
        fail('MISSION_RUNTIME_LOCK_UNSAFE', `unsafe lock object at ${lockPath}`);
      }
      if (inspected.status === 'valid' && !processIsAlive(inspected.owner)) {
        if (reapLock(lockPath, inspected)) continue;
      } else if (inspected.status === 'invalid'
          && Date.now() - inspected.stat.mtimeMs >= invalidGraceMs) {
        if (reapLock(lockPath, inspected)) continue;
      } else if (inspected.status === 'missing' || inspected.status === 'changed') {
        continue;
      }
      if (Date.now() >= deadline) {
        fail('MISSION_RUNTIME_LOCKED', `timed out acquiring ${lockPath}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      delay = Math.min(delay * 2, 50);
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch (_error) { /* ignore */ }
      }
    }
  }
  try {
    return operation();
  } finally {
    const inspected = inspectLock(lockPath);
    if (inspected.status === 'valid'
        && inspected.owner.pid === owner.pid
        && inspected.owner.process_start === owner.process_start
        && inspected.owner.nonce === owner.nonce) {
      reapLock(lockPath, inspected);
    }
  }
}

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    fail(
      'MISSION_REPO_INVALID',
      result.error ? result.error.message : String(result.stderr || 'git command failed').trim(),
    );
  }
  return result.stdout.trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pre-spend gate: every frozen graph node must reference a real base-tree
// Markdown file whose exact heading matches campaign.spec.section. Fails
// before Mission state or grant artifacts are created.
function validateGraphSpecsAtBase(repo, graph, baseSha) {
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  // Accept Git SHA-1 (40) or SHA-256 (64) object IDs (lowercase hex).
  if (typeof baseSha !== 'string' || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(baseSha)) {
    fail('MISSION_GRAPH_SPEC_INVALID', 'authoritative base SHA is required to validate graph specs');
  }
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string') {
      fail('MISSION_GRAPH_SPEC_INVALID', 'graph node id is required for spec validation');
    }
    const campaign = node.campaign;
    const spec = campaign && campaign.spec;
    if (!spec || typeof spec.path !== 'string' || typeof spec.section !== 'string') {
      fail(
        'MISSION_GRAPH_SPEC_INVALID',
        `graph node ${node.id} campaign.spec.path/section is required`,
      );
    }
    const raw = spawnSync('git', ['-C', repo, 'show', `${baseSha}:${spec.path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (raw.error || raw.status !== 0) {
      fail(
        'MISSION_GRAPH_SPEC_INVALID',
        `graph node ${node.id} spec.path missing at base (${spec.path})`,
      );
    }
    const specText = String(raw.stdout || '');
    // CommonMark ATX: at most 3 leading ASCII spaces (reject 4-space code indent).
    const heading = new RegExp(`^ {0,3}#{1,6}\\s+${escapeRegExp(spec.section)}\\s*$`);
    const found = specText.split(/\r?\n/).some((line) => heading.test(line));
    if (!found) {
      fail(
        'MISSION_GRAPH_SPEC_INVALID',
        `graph node ${node.id} missing heading '${spec.section}' in ${spec.path}`,
      );
    }
  }
}

function canonicalRepository(repo) {
  let canonical;
  try {
    canonical = fs.realpathSync(repo);
  } catch (_error) {
    fail('MISSION_REPO_INVALID', `repository is not readable: ${repo}`);
  }
  const raw = git(canonical, ['rev-parse', '--git-common-dir']);
  const candidate = path.isAbsolute(raw) ? raw : path.resolve(canonical, raw);
  let common;
  try {
    common = fs.realpathSync(candidate);
  } catch (_error) {
    fail('MISSION_REPO_INVALID', `Git common directory is not readable: ${candidate}`);
  }
  return {
    repo: canonical,
    common,
    repo_identity: `git-common-dir:${common}`,
  };
}

function runtimePaths(repoInfo, adoptionKey = null) {
  const root = path.join(repoInfo.common, 'autopilot', 'mission');
  const base = {
    root,
    registry: path.join(root, 'registry.json'),
    registry_lock: path.join(root, 'registry.lock'),
  };
  if (adoptionKey === null) return base;
  requireString(adoptionKey, 'adoption key', SHA256);
  return {
    ...base,
    state: path.join(root, 'states', `${adoptionKey}.json`),
    journal_dir: path.join(root, 'journals', adoptionKey),
    artifact_dir: path.join(root, 'artifacts', adoptionKey),
  };
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail('MISSION_RUNTIME_IO', `${label} cannot be read: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail('MISSION_RUNTIME_INVALID', `${label} is not valid JSON: ${error.message}`);
  }
}

function initialAcceptanceHashes(authority) {
  const acceptance = requireObject(authority.acceptance, 'task authority acceptance');
  return [
    requireString(acceptance.contract_hash, 'acceptance.contract_hash', SHA256),
    requireString(acceptance.criteria_hash, 'acceptance.criteria_hash', SHA256),
  ].sort();
}

function acceptanceHashFor(acceptanceId) {
  requireString(acceptanceId, 'acceptance id');
  return mission.sha256(mission.canonicalJson({
    schema_version: 1,
    acceptance_id: acceptanceId,
  }));
}

function requiredAcceptanceHashes(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const hashes = [];
  for (const node of nodes) {
    if (!Array.isArray(node.acceptance_ids)) {
      fail('MISSION_GRAPH_INVALID', `graph node ${node.id || '<unknown>'} lacks acceptance_ids`);
    }
    for (const id of node.acceptance_ids) hashes.push(acceptanceHashFor(id));
  }
  return [...new Set(hashes)].sort();
}

function defaultDependencies() {
  let policy;
  let graph;
  try {
    policy = require('../engine/mission-policy');
    graph = require('../engine/mission-execution-graph');
  } catch (error) {
    fail(
      'MISSION_RUNTIME_DEPENDENCY_MISSING',
      `canonical Mission policy/graph modules are unavailable: ${error.message}`,
    );
  }
  return {
    resolveMissionPolicy: policy.resolveMissionPolicy,
    freezeMissionExecutionGraph: graph.freezeMissionExecutionGraph,
    deriveMissionAdoptionKey: policy.deriveMissionAdoptionKey,
    deriveMissionLineageId: policy.deriveMissionLineageId,
  };
}

function normalizeDependencies(injected) {
  const dependencies = injected || defaultDependencies();
  for (const name of [
    'resolveMissionPolicy',
    'freezeMissionExecutionGraph',
    'deriveMissionAdoptionKey',
    'deriveMissionLineageId',
  ]) {
    if (typeof dependencies[name] !== 'function') {
      fail('MISSION_RUNTIME_DEPENDENCY_MISSING', `${name} dependency is required`);
    }
  }
  return dependencies;
}

function policyInteger(policy, field, minimum = 0) {
  const value = policy[field];
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail('MISSION_POLICY_INVALID', `Mission policy ${field} must be an integer >= ${minimum}`);
  }
  return value;
}

function buildMissionContract({
  repoIdentity,
  adoptionKey,
  lineageId,
  authority,
  policy,
  policyDigest,
  graph,
  graphDigest,
  initialRequiredAcceptanceHashes,
}) {
  const axes = {};
  for (const axis of mission.SUPPORTED_AXES) {
    const ceiling = policyInteger(policy, `max_${axis}`);
    axes[axis] = {
      authorized_ceiling: ceiling,
      reserved_active: 0,
      durable_consumed: 0,
      known: true,
      enforced: policy.enforcement_mode === 'enforce',
    };
  }
  const requiredHashes = requiredAcceptanceHashes(graph);
  return {
    schema_version: 1,
    artifact_type: 'mission_convergence_contract',
    contract_id: `mission-v1-${mission.sha256(mission.canonicalJson({
      repo_identity: repoIdentity,
      adoption_key: adoptionKey,
      task_authority_id: authority.task_authority_id,
      policy_hash: authority.policy_hash,
      mission_policy_digest: policyDigest,
      mission_graph_digest: graphDigest,
    }))}`,
    repo_identity: repoIdentity,
    mission_lineage_id: lineageId,
    task_authority_id: authority.task_authority_id,
    policy_hash: authority.policy_hash,
    mission_policy_digest: policyDigest,
    mission_graph_digest: graphDigest,
    initial_required_acceptance_hashes: initialRequiredAcceptanceHashes,
    required_acceptance_hashes: requiredHashes,
    execution_graph: graph,
    enforcement_mode: policy.enforcement_mode,
    state: 'DRAFT',
    closure_ratio: typeof policy.closure_ratio === 'number' ? policy.closure_ratio : 0.75,
    max_stagnant_campaigns: policyInteger(policy, 'max_stagnant_campaigns'),
    axes,
    grant_contract: {
      idempotency_key_required: true,
      single_use: true,
      expiry_seconds: Number.isSafeInteger(policy.grant_expiry_seconds)
        ? policy.grant_expiry_seconds : 3600,
      bindings: [
        'mission_lineage_id',
        'task_authority_id',
        'campaign_id',
        'mission_subject_digest',
        'base_sha',
        'acceptance_ids',
      ],
    },
    control_contract: {
      actions: ['ceiling_adjust', 'scope_frozen', 'finish_requested', 'abort_requested'],
      allowed_authorities: [
        'authenticated_user',
        'authenticated_doa',
        'agent',
        'owner_kernel',
      ],
      ceiling_loosen_authority: 'authenticated_user',
      pre_effect_sequence_check: true,
    },
    lineage_binding: {
      task_authority_id: authority.task_authority_id,
      root_run_id: `mission-${adoptionKey.slice(0, 24)}`,
      policy_hash: authority.policy_hash,
      successor_inherits_durable_consumed: true,
    },
  };
}

function emptyRegistry(repoIdentity) {
  return {
    schema_version: RUNTIME_SCHEMA_VERSION,
    artifact_type: REGISTRY_ARTIFACT,
    repo_identity: repoIdentity,
    missions: {},
  };
}

function loadRegistry(repoInfo) {
  const paths = runtimePaths(repoInfo);
  if (!fs.existsSync(paths.registry)) return emptyRegistry(repoInfo.repo_identity);
  const registry = readJson(paths.registry, 'Mission registry');
  assertExactKeys(
    registry,
    REGISTRY_KEYS,
    'Mission registry',
    'MISSION_REGISTRY_INVALID',
  );
  if (registry.schema_version !== RUNTIME_SCHEMA_VERSION
      || registry.artifact_type !== REGISTRY_ARTIFACT
      || registry.repo_identity !== repoInfo.repo_identity
      || !isPlainObject(registry.missions)) {
    fail('MISSION_REGISTRY_INVALID', 'Mission registry binding is invalid');
  }
  for (const [adoptionKey, entry] of Object.entries(registry.missions)) {
    assertExactKeys(
      entry,
      REGISTRY_ENTRY_KEYS,
      `Mission registry entry ${adoptionKey}`,
      'MISSION_REGISTRY_INVALID',
    );
    if (!SHA256.test(adoptionKey)
        || entry.schema_version !== RUNTIME_SCHEMA_VERSION
        || entry.adoption_key !== adoptionKey
        || entry.repo_identity !== repoInfo.repo_identity
        || !LINEAGE.test(entry.mission_lineage_id || '')
        || !SHA256.test(entry.task_authority_id || '')
        || !SHA256.test(entry.policy_hash || '')
        || !SHA256.test(entry.intent_hash || '')
        || !SHA256.test(entry.mission_policy_digest || '')
        || !SHA256.test(entry.mission_graph_digest || '')
        || !new Set(['shadow', 'enforce']).has(entry.enforcement_mode)
        || !SHA256.test(entry.prepared_state_hash || '')
        || entry.state_ref !== path.join('states', `${adoptionKey}.json`)
        || !Array.isArray(entry.initial_required_acceptance_hashes)
        || entry.initial_required_acceptance_hashes.length === 0
        || entry.initial_required_acceptance_hashes.some((hash) => !SHA256.test(hash))) {
      fail('MISSION_REGISTRY_INVALID', `Mission registry entry ${adoptionKey} is invalid`);
    }
  }
  return registry;
}

function stateIsUnresolved(statePath) {
  try {
    const state = readJson(statePath, 'Mission state');
    mission.validateMissionState(state);
    return !(state.terminal && mission.TERMINAL_STATES.has(state.state));
  } catch (_error) {
    // A missing or malformed registered state is unresolved and blocks reset.
    return true;
  }
}

function prepareReceiptBody(entry, state, adopted, preparedAt) {
  return {
    schema_version: RUNTIME_SCHEMA_VERSION,
    artifact_type: PREPARE_ARTIFACT,
    repo_identity: entry.repo_identity,
    adoption_key: entry.adoption_key,
    mission_lineage_id: entry.mission_lineage_id,
    task_authority_id: entry.task_authority_id,
    policy_hash: entry.policy_hash,
    intent_hash: entry.intent_hash,
    initial_required_acceptance_hashes: entry.initial_required_acceptance_hashes,
    mission_policy_digest: entry.mission_policy_digest,
    mission_graph_digest: entry.mission_graph_digest,
    enforcement_mode: entry.enforcement_mode,
    state_hash: entry.prepared_state_hash,
    adopted,
    prepared_at: preparedAt,
  };
}

function prepareMissionRuntimeInternal(input, options) {
  const repoInfo = canonicalRepository(input.repo || process.cwd());
  let authority;
  try {
    authority = options.testOnlySkipAuthorityNormalization
      ? requireObject(input.taskAuthority, 'task authority')
      : normalizeTaskAuthorityEnvelope(input.taskAuthority);
  } catch (error) {
    fail(
      error.code || 'MISSION_AUTHORITY_INVALID',
      `TaskAuthority validation failed: ${error.message || String(error)}`,
    );
  }
  const governance = requireObject(input.authoritativeGovernance, 'authoritative governance');
  const rawGraph = requireObject(input.executionGraph, 'execution graph');
  const dependencies = normalizeDependencies(options.dependencies);
  const resolved = requireObject(
    dependencies.resolveMissionPolicy(governance, input.policyOptions || {}),
    'resolved Mission policy',
  );
  const policy = requireObject(resolved.policy, 'resolved Mission policy.policy');
  const policyDigest = requireString(
    resolved.policy_digest,
    'resolved Mission policy.policy_digest',
    SHA256,
  );
  if (!new Set(['shadow', 'enforce']).has(policy.enforcement_mode)) {
    fail('MISSION_POLICY_INVALID', 'Mission prepare requires shadow or enforce policy');
  }
  const frozenGraph = requireObject(
    dependencies.freezeMissionExecutionGraph(rawGraph, policy),
    'frozen execution graph',
  );
  const graph = requireObject(frozenGraph.graph, 'frozen execution graph.graph');
  const graphDigest = requireString(
    frozenGraph.graph_digest,
    'frozen execution graph.graph_digest',
    SHA256,
  );
  // Fail closed before any Mission registry/state write when a frozen node
  // references a missing base-tree path or a non-existent Markdown heading.
  const prepareBaseSha = git(repoInfo.repo, ['rev-parse', 'HEAD']);
  validateGraphSpecsAtBase(repoInfo.repo, graph, prepareBaseSha);
  const initialRequired = initialAcceptanceHashes(authority);
  const adoptionBinding = {
    repo_identity: repoInfo.repo_identity,
    intent: canonicalClone(requireObject(authority.intent, 'task authority intent')),
    initial_required_acceptance_hashes: initialRequired,
  };
  const adoptionKey = requireString(
    dependencies.deriveMissionAdoptionKey(adoptionBinding),
    'Mission adoption key',
    SHA256,
  );
  const lineageId = requireString(
    dependencies.deriveMissionLineageId(adoptionBinding),
    'Mission lineage id',
    LINEAGE,
  );
  requireString(authority.task_authority_id, 'task_authority_id', SHA256);
  requireString(authority.policy_hash, 'policy_hash', SHA256);
  if (authority.mission_lineage_id !== lineageId
      || authority.mission_policy_digest !== policyDigest
      || authority.mission_graph_digest !== graphDigest) {
    fail(
      'MISSION_AUTHORITY_BINDING_MISMATCH',
      'TaskAuthority Mission lineage/policy/graph binding does not match prepare inputs',
    );
  }
  const paths = runtimePaths(repoInfo, adoptionKey);
  const preparedAt = input.preparedAt || new Date().toISOString();
  if (typeof preparedAt !== 'string' || !Number.isFinite(Date.parse(preparedAt))) {
    fail('MISSION_RUNTIME_INVALID', 'preparedAt must be a valid timestamp');
  }
  return withExclusiveLock(paths.registry_lock, () => {
    const registry = loadRegistry(repoInfo);
    const unresolvedEntries = Object.values(registry.missions)
      .filter((entry) => entry.enforcement_mode === 'enforce')
      .filter((entry) => stateIsUnresolved(runtimePaths(repoInfo, entry.adoption_key).state));
    const existing = registry.missions[adoptionKey] || null;
    if (!existing && policy.enforcement_mode === 'enforce' && unresolvedEntries.length > 0) {
      fail(
        'UNRESOLVED_MISSION_EXISTS',
        'an unresolved Mission already exists for this canonical repository',
      );
    }

    let state;
    let entry;
    let adopted = false;
    if (existing) {
      state = readJson(paths.state, 'registered Mission state');
      mission.validateMissionState(state);
      const bindingMatches = existing.repo_identity === repoInfo.repo_identity
        && existing.mission_lineage_id === lineageId
        && existing.task_authority_id === authority.task_authority_id
        && existing.policy_hash === authority.policy_hash
        && existing.mission_policy_digest === policyDigest
        && existing.mission_graph_digest === graphDigest
        && mission.canonicalJson(existing.initial_required_acceptance_hashes)
          === mission.canonicalJson(initialRequired);
      if (!bindingMatches) {
        fail(
          'MISSION_BINDING_MISMATCH',
          'unresolved Mission exists but current TaskAuthority/policy/graph binding differs',
        );
      }
      adopted = true;
      entry = existing;
    } else {
      const contract = buildMissionContract({
        repoIdentity: repoInfo.repo_identity,
        adoptionKey,
        lineageId,
        authority,
        policy,
        policyDigest,
        graph,
        graphDigest,
        initialRequiredAcceptanceHashes: initialRequired,
      });
      state = mission.createMissionState(contract);
      atomicWriteJson(paths.state, state);
      entry = {
        schema_version: RUNTIME_SCHEMA_VERSION,
        adoption_key: adoptionKey,
        repo_identity: repoInfo.repo_identity,
        mission_lineage_id: lineageId,
        task_authority_id: authority.task_authority_id,
        policy_hash: authority.policy_hash,
        intent_hash: mission.sha256(mission.canonicalJson(authority.intent)),
        initial_required_acceptance_hashes: initialRequired,
        mission_policy_digest: policyDigest,
        mission_graph_digest: graphDigest,
        enforcement_mode: state.enforcement_mode,
        prepared_state_hash: mission.stateHash(state),
        state_ref: path.relative(paths.root, paths.state),
      };
      registry.missions[adoptionKey] = entry;
      atomicWriteJson(paths.registry, registry);
    }
    const body = prepareReceiptBody(
      entry,
      state,
      adopted,
      preparedAt,
    );
    return {
      receipt: {
        ...body,
        receipt_digest: mission.sha256(mission.canonicalJson(body)),
      },
      state,
      adopted,
      registry_path: paths.registry,
      state_path: paths.state,
    };
  });
}

function prepareMissionRuntime(input = {}) {
  if (Object.prototype.hasOwnProperty.call(input, 'dependencies')) {
    fail(
      'MISSION_RUNTIME_DEPENDENCY_INJECTION_REJECTED',
      'production Mission prepare does not accept injected policy/graph dependencies',
    );
  }
  return prepareMissionRuntimeInternal(input, {
    dependencies: defaultDependencies(),
    testOnlySkipAuthorityNormalization: false,
  });
}

function prepareMissionRuntimeForTest(input = {}, dependencies) {
  if (process.env.AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS !== '1') {
    fail(
      'MISSION_RUNTIME_TEST_SEAM_DISABLED',
      'Mission runtime test seams require explicit test-process opt-in',
    );
  }
  return prepareMissionRuntimeInternal(input, {
    dependencies: normalizeDependencies(dependencies),
    testOnlySkipAuthorityNormalization: true,
  });
}

function validatePreparedReceipt(receipt, repoInfo) {
  const value = requireObject(receipt, 'Mission prepare receipt');
  assertExactKeys(
    value,
    PREPARE_RECEIPT_KEYS,
    'Mission prepare receipt',
    'MISSION_PREPARE_RECEIPT_INVALID',
  );
  if (value.schema_version !== RUNTIME_SCHEMA_VERSION
      || value.artifact_type !== PREPARE_ARTIFACT
      || value.repo_identity !== repoInfo.repo_identity
      || !SHA256.test(value.receipt_digest || '')) {
    fail('MISSION_PREPARE_RECEIPT_INVALID', 'Mission prepare receipt shape/binding is invalid');
  }
  const body = { ...value };
  delete body.receipt_digest;
  if (mission.sha256(mission.canonicalJson(body)) !== value.receipt_digest) {
    fail('MISSION_PREPARE_RECEIPT_INVALID', 'Mission prepare receipt digest is invalid');
  }
  requireString(value.adoption_key, 'prepare receipt adoption_key', SHA256);
  requireString(value.mission_lineage_id, 'prepare receipt mission_lineage_id', LINEAGE);
  requireString(value.task_authority_id, 'prepare receipt task_authority_id', SHA256);
  requireString(value.policy_hash, 'prepare receipt policy_hash', SHA256);
  requireString(value.mission_policy_digest, 'prepare receipt mission_policy_digest', SHA256);
  requireString(value.mission_graph_digest, 'prepare receipt mission_graph_digest', SHA256);
  requireString(value.intent_hash, 'prepare receipt intent_hash', SHA256);
  requireString(value.state_hash, 'prepare receipt state_hash', SHA256);
  if (!Array.isArray(value.initial_required_acceptance_hashes)
      || value.initial_required_acceptance_hashes.length === 0
      || value.initial_required_acceptance_hashes.some((hash) => !SHA256.test(hash))) {
    fail(
      'MISSION_PREPARE_RECEIPT_INVALID',
      'Mission prepare receipt acceptance binding is invalid',
    );
  }
  if (!new Set(['shadow', 'enforce']).has(value.enforcement_mode)
      || typeof value.adopted !== 'boolean'
      || typeof value.prepared_at !== 'string'
      || !Number.isFinite(Date.parse(value.prepared_at))) {
    fail('MISSION_PREPARE_RECEIPT_INVALID', 'Mission prepare receipt metadata is invalid');
  }
  const paths = runtimePaths(repoInfo, value.adoption_key);
  const registry = loadRegistry(repoInfo);
  const entry = registry.missions[value.adoption_key];
  if (!entry
      || entry.adoption_key !== value.adoption_key
      || entry.repo_identity !== value.repo_identity
      || entry.mission_lineage_id !== value.mission_lineage_id
      || entry.task_authority_id !== value.task_authority_id
      || entry.policy_hash !== value.policy_hash
      || entry.intent_hash !== value.intent_hash
      || entry.mission_policy_digest !== value.mission_policy_digest
      || entry.mission_graph_digest !== value.mission_graph_digest
      || entry.enforcement_mode !== value.enforcement_mode
      || entry.prepared_state_hash !== value.state_hash
      || entry.state_ref !== path.relative(paths.root, paths.state)
      || mission.canonicalJson(entry.initial_required_acceptance_hashes)
        !== mission.canonicalJson(value.initial_required_acceptance_hashes)) {
    fail('MISSION_PREPARE_RECEIPT_INVALID', 'Mission prepare receipt is not registered');
  }
  const state = readJson(paths.state, 'prepared Mission state');
  mission.validateMissionState(state);
  if (state.repo_identity !== value.repo_identity
      || state.mission_lineage_id !== value.mission_lineage_id
      || state.task_authority_id !== value.task_authority_id
      || state.policy_hash !== value.policy_hash
      || state.mission_policy_digest !== value.mission_policy_digest
      || state.mission_graph_digest !== value.mission_graph_digest
      || state.enforcement_mode !== value.enforcement_mode
      || mission.canonicalJson(state.initial_required_acceptance_hashes)
        !== mission.canonicalJson(value.initial_required_acceptance_hashes)) {
    fail('MISSION_PREPARE_RECEIPT_INVALID', 'Mission state does not match prepare receipt');
  }
  return { value, entry, paths, state };
}

function journalFile(paths, claimId, suffix) {
  requireString(claimId, 'claim id', /^claim-v1-[a-f0-9]{64}$/);
  return path.join(paths.journal_dir, `${claimId}.${suffix}.json`);
}

function terminalJournalLock(paths, claimId) {
  requireString(claimId, 'claim id', /^claim-v1-[a-f0-9]{64}$/);
  return path.join(paths.journal_dir, `${claimId}.lock`);
}

function createRuntimeStateStore(paths) {
  const base = mission.createFileBackedMissionStateStore(paths.state);
  return {
    ...base,
    state_path: paths.state,
    journalTerminal(receipt) {
      return withExclusiveLock(terminalJournalLock(paths, receipt.claim_id), () => {
        const pending = journalFile(paths, receipt.claim_id, 'pending');
        const applied = journalFile(paths, receipt.claim_id, 'applied');
        const present = [applied, pending].filter((file) => fs.existsSync(file));
        for (const file of present) {
          const existing = readJson(file, 'Mission terminal journal');
          if (mission.canonicalJson(existing) !== mission.canonicalJson(receipt)) {
            return { status: 'conflict', path: file };
          }
        }
        if (present.length > 0) {
          return fs.existsSync(applied)
            ? { status: 'applied', path: applied }
            : { status: 'pending', path: pending };
        }
        atomicWriteJson(pending, receipt);
        return { status: 'journaled', path: pending };
      });
    },
    pendingTerminalReceipts() {
      if (!fs.existsSync(paths.journal_dir)) return [];
      return fs.readdirSync(paths.journal_dir)
        .filter((name) => name.endsWith('.pending.json'))
        .sort()
        .map((name) => {
          const claimId = name.slice(0, -'.pending.json'.length);
          return withExclusiveLock(terminalJournalLock(paths, claimId), () => {
            const pending = journalFile(paths, claimId, 'pending');
            return fs.existsSync(pending)
              ? readJson(pending, 'Mission terminal journal')
              : null;
          });
        })
        .filter(Boolean);
    },
    markTerminalApplied(receipt) {
      return withExclusiveLock(terminalJournalLock(paths, receipt.claim_id), () => {
        const pending = journalFile(paths, receipt.claim_id, 'pending');
        const applied = journalFile(paths, receipt.claim_id, 'applied');
        if (fs.existsSync(applied)) {
          const existing = readJson(applied, 'Mission terminal journal');
          if (mission.canonicalJson(existing) !== mission.canonicalJson(receipt)) return false;
          if (fs.existsSync(pending)) {
            const pendingReceipt = readJson(pending, 'Mission terminal journal');
            if (mission.canonicalJson(pendingReceipt) !== mission.canonicalJson(receipt)) {
              return false;
            }
            fs.unlinkSync(pending);
          }
          return true;
        }
        if (!fs.existsSync(pending)) return false;
        const existing = readJson(pending, 'Mission terminal journal');
        if (mission.canonicalJson(existing) !== mission.canonicalJson(receipt)) return false;
        fs.mkdirSync(path.dirname(applied), { recursive: true, mode: 0o700 });
        fs.renameSync(pending, applied);
        try {
          const parent = fs.openSync(path.dirname(applied), 'r');
          try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
        } catch (_error) {
          // Some filesystems do not permit directory fsync.
        }
        return true;
      });
    },
  };
}

function openPreparedMissionStateStore(input = {}) {
  const repoInfo = canonicalRepository(input.repo || process.cwd());
  const verified = validatePreparedReceipt(input.preparedReceipt, repoInfo);
  return createRuntimeStateStore(verified.paths);
}

function graphNode(state, nodeId) {
  const graph = state.execution_graph || (state.config && state.config.execution_graph);
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node) fail('MISSION_GRAPH_NODE_UNKNOWN', `unknown execution graph node: ${nodeId}`);
  return node;
}

function activeClaimForNode(state, nodeId) {
  return Object.values(state.claims || {}).find((claim) => (
    claim.graph_node_id === nodeId && !claim.terminal && !claim.released
  )) || null;
}

function attemptsForNode(state, nodeId) {
  return Object.values(state.claims || {})
    .filter((claim) => claim.graph_node_id === nodeId)
    .reduce((max, claim) => Math.max(max, claim.graph_attempt || 0), 0);
}

function graphNodeReady(state, node) {
  const progress = state.graph_progress || {};
  for (const dependency of node.dependencies || []) {
    if (!progress[dependency] || progress[dependency].status !== 'ready') {
      fail(
        'MISSION_GRAPH_DEPENDENCY_UNRESOLVED',
        `graph node ${node.id} dependency ${dependency} is not ready`,
      );
    }
  }
}

function ticketFor(adoptionKey, nodeId, attempt) {
  const safe = String(nodeId).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 72);
  return `mission-${adoptionKey.slice(0, 12)}-${safe}-a${attempt}`.slice(0, 128);
}

function branchFor(adoptionKey, nodeId, attempt) {
  const safe = String(nodeId).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 96);
  return `mission/${adoptionKey.slice(0, 12)}/${safe}-a${attempt}`;
}

function implementationProfile(graphProfile) {
  const mapped = {
    poc: 'poc',
    standard: 'internal-pilot',
    high: 'production',
  }[graphProfile];
  if (!mapped) fail('MISSION_GRAPH_INVALID', `unsupported campaign profile: ${graphProfile}`);
  return mapped;
}

function reservationForNode(state, node) {
  const reservation = requireObject(node.reservation, `graph node ${node.id} reservation`);
  return {
    per_axis: mission.SUPPORTED_AXES.map((axis) => {
      const reserved = reservation[axis];
      if (!Number.isSafeInteger(reserved) || reserved < 0) {
        fail('MISSION_GRAPH_INVALID', `graph node ${node.id} reservation.${axis} is invalid`);
      }
      return {
        axis,
        authorized_ceiling: state.axes[axis].authorized_ceiling,
        reserved_active: reserved,
        durable_consumed: state.axes[axis].durable_consumed,
        known: true,
      };
    }),
  };
}

function campaignDraftFor({ state, node, adoptionKey, attempt, repoInfo, baseSha }) {
  const campaign = requireObject(node.campaign, `graph node ${node.id} campaign`);
  const spec = requireObject(campaign.spec, `graph node ${node.id} campaign.spec`);
  const graphNodeDigest = mission.sha256(mission.canonicalJson(node));
  // Never re-resolve HEAD here — callers bind one authoritative base SHA per
  // grant attempt (validated heading + sealed contract base_sha must match).
  if (typeof baseSha !== 'string' || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(baseSha)) {
    fail('MISSION_RUNTIME_INVALID', 'campaign draft requires an authoritative base SHA');
  }
  const acceptanceIds = [...node.acceptance_ids];
  const rubricIds = [...node.source_rubric_ids];
  return {
    schema_version: 1,
    ticket: ticketFor(adoptionKey, node.id, attempt),
    profile: implementationProfile(campaign.profile),
    mission_grant_ref: null,
    repo_identity: repoInfo.repo_identity,
    base_sha: baseSha,
    branch: branchFor(adoptionKey, node.id, attempt),
    vertical_acceptance: acceptanceIds,
    allowed_path_prefixes: [...campaign.allowed_path_prefixes],
    max_changed_files: campaign.max_changed_files,
    baseline_churn: campaign.baseline_churn,
    max_growth_ratio: campaign.max_growth_ratio,
    max_extra_churn: campaign.max_extra_churn,
    max_repair_generations: campaign.max_repair_generations,
    max_wall_seconds: campaign.max_wall_seconds,
    verify_cmd: node.verification_commands.join(' && '),
    rubric_ids: rubricIds,
    mission_runtime: {
      schema_version: 1,
      root_run_id: state.root_run_id,
      mission_lineage_id: state.mission_lineage_id,
      mission_policy_digest: state.mission_policy_digest || state.policy_hash,
      mission_graph_digest: state.mission_graph_digest,
      graph_node_id: node.id,
      graph_node_digest: graphNodeDigest,
    },
    strict_dispatch: {
      schema_version: 1,
      spec: {
        path: spec.path,
        section: spec.section,
      },
      required_paths: [...campaign.required_paths],
      output_paths: [...campaign.output_paths],
      allowed_path_prefixes: [...campaign.allowed_path_prefixes],
      budget: {
        max_changed_files: campaign.max_changed_files,
        max_wall_seconds: campaign.max_wall_seconds,
        max_output_bytes: node.reservation.output_bytes,
        max_tool_calls: node.reservation.tool_calls,
        max_engine_attempts: node.reservation.engine_attempts,
      },
      verification_commands: [...node.verification_commands],
    },
  };
}

function grantArtifactPaths(paths, nodeId, attempt) {
  const safe = String(nodeId).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 96);
  const dir = path.join(paths.artifact_dir, safe, `attempt-${attempt}`);
  return {
    contract: path.join(dir, 'campaign.json'),
    seal: path.join(dir, 'campaign.seal.json'),
  };
}

function writeGrantArtifacts({
  paths,
  state,
  claim,
  draft,
  subject,
  campaignId,
  nodeId,
  attempt,
  replay,
  sealedAt,
}) {
  const artifactPaths = grantArtifactPaths(paths, nodeId, attempt);
  const finalContract = { ...draft, mission_grant_ref: claim.binding_digest };
  if (!fs.existsSync(artifactPaths.contract)) {
    atomicWriteJson(artifactPaths.contract, finalContract);
  } else {
    const existing = readJson(artifactPaths.contract, 'Mission campaign contract');
    if (mission.canonicalJson(existing) !== mission.canonicalJson(finalContract)) {
      fail('MISSION_GRANT_ARTIFACT_CONFLICT', 'existing campaign contract conflicts with grant');
    }
  }
  const raw = fs.readFileSync(artifactPaths.contract);
  const rawDigest = crypto.createHash('sha256').update(raw).digest('hex');
  const expectedSeal = {
    schema_version: 1,
    contract_sha256: rawDigest,
    contract_path: fs.realpathSync(artifactPaths.contract),
    repo_identity: state.repo_identity,
    mission_mode: state.enforcement_mode,
    sealed_at: sealedAt,
    identity_scheme: 'mission-subject-v2',
    mission_subject_digest: subject,
    campaign_id: campaignId,
    claim_id: claim.claim_id,
    mission_grant_ref: claim.binding_digest,
  };
  if (!fs.existsSync(artifactPaths.seal)) {
    atomicWriteJson(artifactPaths.seal, expectedSeal);
  } else {
    const existing = readJson(artifactPaths.seal, 'Mission campaign seal');
    if (mission.canonicalJson(existing) !== mission.canonicalJson(expectedSeal)) {
      fail('MISSION_GRANT_ARTIFACT_CONFLICT', 'existing campaign seal conflicts with grant');
    }
  }
  return {
    status: replay ? 'replay' : 'claimed',
    mission_lineage_id: state.mission_lineage_id,
    claim_id: claim.claim_id,
    mission_grant_ref: claim.binding_digest,
    mission_subject_digest: subject,
    mission_campaign_id: campaignId,
    graph_node_id: nodeId,
    graph_attempt: attempt,
    contract_path: artifactPaths.contract,
    seal_path: artifactPaths.seal,
    branch: draft.branch,
    base_sha: draft.base_sha,
    state_hash: mission.stateHash(state),
  };
}

function recoverPendingTerminals(store) {
  if (!store || typeof store.pendingTerminalReceipts !== 'function') return { status: 'none' };
  for (const receipt of store.pendingTerminalReceipts()) {
    const recovered = applyTerminalReceiptCas(store, receipt);
    if (!new Set(['applied', 'replay_noop']).has(recovered.status)) return recovered;
    if (!store.markTerminalApplied(receipt)) {
      return { status: 'rejected', reason: 'terminal_journal_finalize_failed' };
    }
  }
  return { status: 'recovered' };
}

function grantMissionCampaign(input = {}) {
  const repoInfo = canonicalRepository(input.repo || process.cwd());
  const verified = validatePreparedReceipt(input.preparedReceipt, repoInfo);
  const store = createRuntimeStateStore(verified.paths);
  const recovered = recoverPendingTerminals(store);
  if (recovered.status === 'rejected') {
    fail('MISSION_TERMINAL_RECOVERY_FAILED', recovered.reason);
  }
  const nodeId = requireString(input.nodeId, 'graph node id');
  const now = input.now || new Date().toISOString();
  if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) {
    fail('MISSION_RUNTIME_INVALID', 'grant now must be a valid timestamp');
  }
  for (let retry = 0; retry < 4; retry += 1) {
    const state = store.load();
    if (state.terminal || mission.TERMINAL_STATES.has(state.state)) {
      fail(
        state.terminal && state.terminal.reason === 'stagnation'
          ? 'MISSION_STAGNATION' : 'MISSION_STATE_TERMINAL',
        `Mission is terminal: ${(state.terminal && state.terminal.reason) || state.state}`,
      );
    }
    const node = graphNode(state, nodeId);
    const progress = state.graph_progress && state.graph_progress[nodeId];
    if (progress && progress.status === 'ready') {
      fail('MISSION_GRAPH_NODE_COMPLETE', `graph node ${nodeId} is already ready`);
    }
    const live = activeClaimForNode(state, nodeId);
    if (live) {
      const draft = live.campaign_contract_draft;
      return writeGrantArtifacts({
        paths: verified.paths,
        state,
        claim: live,
        draft,
        subject: live.mission_subject_digest,
        campaignId: live.campaign_id,
        nodeId,
        attempt: live.graph_attempt,
        replay: true,
        sealedAt: live.issued_at,
      });
    }
    graphNodeReady(state, node);
    const attempt = attemptsForNode(state, nodeId) + 1;
    if (!Number.isSafeInteger(node.gate_attempt_budget)
        || attempt > node.gate_attempt_budget) {
      fail('MISSION_GATE_BUDGET_EXHAUSTED', `graph node ${nodeId} gate budget exhausted`);
    }
    // Resolve the grant base exactly once per attempt: validate the node
    // heading at that SHA and seal the same SHA into the campaign draft so
    // base_sha cannot drift from the validated tree.
    const grantBaseSha = git(repoInfo.repo, ['rev-parse', 'HEAD']);
    validateGraphSpecsAtBase(repoInfo.repo, { nodes: [node] }, grantBaseSha);
    const draft = campaignDraftFor({
      state,
      node,
      adoptionKey: verified.value.adoption_key,
      attempt,
      repoInfo,
      baseSha: grantBaseSha,
    });
    if (draft.base_sha !== grantBaseSha) {
      fail(
        'MISSION_RUNTIME_INVALID',
        'campaign draft base_sha must equal the validated grant base',
      );
    }
    const subject = missionSubjectDigest(draft);
    const campaignId = missionCampaignIdFor(
      state.repo_identity,
      draft.ticket,
      subject,
    );
    const acceptanceHashes = node.acceptance_ids.map(acceptanceHashFor).sort();
    const payload = {
      identity_scheme: 'mission-subject-v2',
      idempotency_key: `graph-node:${nodeId}:attempt:${attempt}`,
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: campaignId,
      mission_subject_digest: subject,
      campaign_contract_digest: subject,
      base_sha: grantBaseSha,
      acceptance_ids: [...node.acceptance_ids],
      acceptance_hashes: acceptanceHashes,
      graph_node_id: nodeId,
      graph_attempt: attempt,
      campaign_contract_draft: draft,
      reservation: reservationForNode(state, node),
      issued_at: now,
      expires_at: new Date(
        Date.parse(now) + state.config.grant_contract.expiry_seconds * 1000,
      ).toISOString(),
    };
    const result = mission.reduceMissionState(state, {
      event_type: 'grant_claimed',
      sequence: state.events.length + 1,
      mission_lineage_id: state.mission_lineage_id,
      payload,
    });
    if (!result || !result.receipt
        || result.receipt.artifact_type === 'mission_grant_rejected') {
      fail(
        result && result.receipt && result.receipt.reason === 'stagnation'
          ? 'MISSION_STAGNATION' : 'MISSION_GRANT_REJECTED',
        (result && result.receipt && result.receipt.reason) || 'Mission grant rejected',
      );
    }
    if (!store.save(state, result.state)) continue;
    const claim = result.state.claims[result.receipt.claim_id];
    return writeGrantArtifacts({
      paths: verified.paths,
      state: result.state,
      claim,
      draft,
      subject,
      campaignId,
      nodeId,
      attempt,
      replay: false,
      sealedAt: now,
    });
  }
  fail('MISSION_STATE_CAS_FAILED', 'Mission grant compare-and-swap did not converge');
}

function unknownActualUsage(state, claim) {
  return {
    per_axis: mission.SUPPORTED_AXES.map((axis) => ({
      axis,
      authorized_ceiling: claim.reservation[axis].authorized_ceiling,
      reserved_active: 0,
      durable_consumed: claim.reservation[axis].durable_consumed,
      known: false,
    })),
  };
}

function createCampaignTerminalReceipt(input = {}) {
  const state = input.state;
  mission.validateMissionState(state);
  const claim = state.claims[input.claimId];
  if (!claim || claim.binding_digest !== input.grantRef) {
    fail('MISSION_TERMINAL_BINDING_MISMATCH', 'terminal claim/grant binding is invalid');
  }
  if (!TERMINAL_OUTCOMES.has(input.outcome)) {
    fail('MISSION_TERMINAL_INVALID', 'terminal outcome is invalid');
  }
  requireString(
    input.iccCampaignId,
    'ICC campaign id',
    /^campaign-v1-[a-f0-9]{64}$/,
  );
  requireString(input.rawCampaignContractDigest, 'raw campaign contract digest', SHA256);
  if (input.possiblyEffectful !== true) {
    fail(
      'MISSION_TERMINAL_EFFECT_STATE_REQUIRED',
      'terminal reconciliation requires an explicitly possibly-effectful claim',
    );
  }
  if (typeof input.observedAt !== 'string' || input.observedAt.length === 0) {
    fail('MISSION_TERMINAL_TIMESTAMP_REQUIRED', 'terminal observed_at is required');
  }
  const observedAt = input.observedAt;
  if (!observedAt.endsWith('Z') || !Number.isFinite(Date.parse(observedAt))) {
    fail('MISSION_TERMINAL_INVALID', 'terminal observed_at must be a valid UTC timestamp');
  }
  const body = {
    schema_version: 1,
    artifact_type: 'campaign_terminal_receipt',
    claim_id: claim.claim_id,
    mission_lineage_id: state.mission_lineage_id,
    campaign_id: claim.campaign_id,
    mission_campaign_id: claim.campaign_id,
    icc_campaign_id: input.iccCampaignId,
    campaign_contract_digest: claim.campaign_contract_digest,
    raw_campaign_contract_digest: input.rawCampaignContractDigest,
    graph_node_id: claim.graph_node_id,
    graph_attempt: claim.graph_attempt,
    outcome: input.outcome,
    possibly_effectful: true,
    actual_usage: input.actualUsage || unknownActualUsage(state, claim),
    satisfied_acceptance_hashes: input.outcome === 'ready'
      ? [...(claim.acceptance_hashes || [])].sort()
      : [],
    observed_at: observedAt,
  };
  return {
    ...body,
    receipt_digest: mission.sha256(mission.canonicalJson(body)),
  };
}

function applyTerminalReceiptCas(store, receipt) {
  for (let retry = 0; retry < 4; retry += 1) {
    const state = store.load();
    const result = mission.applyMissionCampaignReceipt(state, receipt);
    if (result.status === 'replay_noop') return result;
    if (result.status !== 'applied') return result;
    if (store.save(state, result.state)) return result;
  }
  return { status: 'rejected', reason: 'mission_state_cas_failed' };
}

function reconcileMissionCampaignTerminal(input = {}) {
  const store = input.store;
  if (!store || typeof store.load !== 'function' || typeof store.save !== 'function'
      || typeof store.journalTerminal !== 'function'
      || typeof store.markTerminalApplied !== 'function') {
    return { status: 'rejected', reason: 'terminal_journal_store_required' };
  }
  let receipt;
  try {
    const state = store.load();
    receipt = createCampaignTerminalReceipt({ ...input, state });
  } catch (error) {
    return {
      status: 'rejected',
      reason: error.code || error.message || String(error),
    };
  }
  const journal = store.journalTerminal(receipt);
  if (journal.status === 'conflict') {
    return { status: 'rejected', reason: 'terminal_receipt_conflict' };
  }
  const applied = applyTerminalReceiptCas(store, receipt);
  if (!new Set(['applied', 'replay_noop']).has(applied.status)) return applied;
  if (!store.markTerminalApplied(receipt)) {
    return { status: 'rejected', reason: 'terminal_journal_finalize_failed' };
  }
  return { ...applied, receipt };
}

module.exports = {
  MissionRuntimeError,
  acceptanceHashFor,
  atomicWriteJson,
  campaignDraftFor,
  canonicalRepository,
  createCampaignTerminalReceipt,
  grantMissionCampaign,
  openPreparedMissionStateStore,
  prepareMissionRuntime,
  prepareMissionRuntimeForTest,
  reconcileMissionCampaignTerminal,
  recoverPendingTerminals,
  requiredAcceptanceHashes,
  validateGraphSpecsAtBase,
  validatePreparedReceipt,
};
