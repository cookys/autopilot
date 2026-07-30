'use strict';

const path = require('path');
const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./owner-kernel/canonical');
const { validateEffectiveMissionPolicy } = require('./mission-policy');

const MISSION_GRAPH_SCHEMA_VERSION = 1;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ICC_RUBRIC_ID = /^[A-Za-z][A-Za-z0-9_-]*[0-9]+$/;
const PROFILE_REPAIR_CEILINGS = Object.freeze({
  poc: 2,
  standard: 5,
  high: 5,
});
const RESERVATION_FIELDS = Object.freeze([
  'campaigns',
  'wall_seconds',
  'tool_calls',
  'engine_attempts',
  'external_wait_seconds',
  'canonical_changed_files',
  'output_bytes',
]);

class MissionGraphError extends Error {
  constructor(message, code = 'INVALID_MISSION_EXECUTION_GRAPH') {
    super(message);
    this.name = 'MissionGraphError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new MissionGraphError(message, code);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function only(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${label} has unsupported key "${key}"`);
}

function token(value, label) {
  if (typeof value !== 'string' || !TOKEN.test(value)) fail(`${label} must be an exact protocol ID`);
  return value;
}

function tokenArray(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) fail(`${label} must be an array`);
  const normalized = value.map((entry, index) => token(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail(`${label} must not contain duplicates`);
  return normalized.sort();
}

function rubricArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    fail(`${label} must contain 1..128 ICC-compatible IDs`);
  }
  const normalized = value.map((entry, index) => {
    if (typeof entry !== 'string' || !ICC_RUBRIC_ID.test(entry)) {
      fail(`${label}[${index}] must match the ICC rubric ID contract`);
    }
    return entry;
  });
  if (new Set(normalized).size !== normalized.length) fail(`${label} must not contain duplicates`);
  return normalized.sort();
}

function int(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be a safe integer in ${minimum}..${maximum}`);
  }
  return value;
}

function normalizeReservation(raw, label) {
  const value = object(raw, label);
  only(value, new Set(RESERVATION_FIELDS), label);
  const result = {};
  for (const field of RESERVATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) fail(`${label}.${field} is required`);
    const minimum = new Set(['campaigns', 'tool_calls', 'engine_attempts', 'output_bytes']).has(field)
      ? 1 : 0;
    const maximum = field === 'engine_attempts' ? 3 : Number.MAX_SAFE_INTEGER;
    result[field] = int(value[field], `${label}.${field}`, minimum, maximum);
  }
  return result;
}

function normalizeCampaign(raw, label) {
  const value = object(raw, label);
  // Path-role contract (controller execution discipline):
  // - allowed_path_prefixes: paths allowed to change (prefix allowlist)
  // - required_paths: required existing inputs (must exist unless authorized create)
  // - required_change_paths (optional): paths that MUST appear in an effectful candidate diff
  // - output_paths: authorized create/modify surface (NOT every path must appear in every diff)
  // - authorized_creates (optional): absent outputs permitted only when listed
  // - version_mirror_paths + version_mirror_generator (optional): generator closure
  const requiredKeys = new Set([
    'profile',
    'allowed_path_prefixes',
    'max_changed_files',
    'baseline_churn',
    'max_growth_ratio',
    'max_extra_churn',
    'max_repair_generations',
    'max_wall_seconds',
    'spec',
    'required_paths',
    'output_paths',
  ]);
  const optionalKeys = new Set([
    'required_change_paths',
    'authorized_creates',
    'version_mirror_paths',
    'version_mirror_generator',
  ]);
  const keys = new Set([...requiredKeys, ...optionalKeys]);
  only(value, keys, label);
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${label}.${key} is required`);
  }
  if (!new Set(['poc', 'standard', 'high']).has(value.profile)) fail(`${label}.profile is unsupported`);
  if (!Array.isArray(value.allowed_path_prefixes) || value.allowed_path_prefixes.length === 0) {
    fail(`${label}.allowed_path_prefixes must be non-empty`);
  }
  if (value.allowed_path_prefixes.length > 128) {
    fail(`${label}.allowed_path_prefixes must contain at most 128 entries`);
  }
  const paths = value.allowed_path_prefixes.map((entry, index) => {
    const normalizedPrefix = typeof entry === 'string' && entry.endsWith('/')
      ? entry.slice(0, -1) : entry;
    if (typeof normalizedPrefix !== 'string' || normalizedPrefix.length === 0
        || normalizedPrefix.length > 512 || normalizedPrefix.startsWith('/')
        || normalizedPrefix.includes('\\') || /[*?\0]/.test(normalizedPrefix)
        || path.posix.normalize(normalizedPrefix) !== normalizedPrefix
        || normalizedPrefix.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')) {
      fail(`${label}.allowed_path_prefixes[${index}] must be a bounded relative prefix`);
    }
    return normalizedPrefix;
  }).sort();
  if (new Set(paths).size !== paths.length) fail(`${label}.allowed_path_prefixes has duplicates`);
  if (typeof value.max_growth_ratio !== 'number' || !Number.isFinite(value.max_growth_ratio)
      || value.max_growth_ratio < 1 || value.max_growth_ratio > 1.5) {
    fail(`${label}.max_growth_ratio must be in 1..1.5`);
  }
  function boundedPath(entry, pathLabel) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 512
        || entry.startsWith('/') || entry.includes('\\') || /[*?\0]/.test(entry)
        || entry.endsWith('/') || path.posix.normalize(entry) !== entry
        || entry.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')) {
      fail(`${pathLabel} must be a bounded relative path`);
    }
    if (!paths.some((prefix) => entry === prefix || entry.startsWith(`${prefix}/`))) {
      fail(`${pathLabel} must be inside an allowed path prefix`);
    }
    return entry;
  }
  function boundedPaths(entries, pathLabel, { allowEmpty = false } = {}) {
    if (!Array.isArray(entries)) fail(`${pathLabel} must be an array`);
    if (!allowEmpty && entries.length === 0) fail(`${pathLabel} must be non-empty`);
    const normalized = entries.map((entry, index) => boundedPath(entry, `${pathLabel}[${index}]`)).sort();
    if (new Set(normalized).size !== normalized.length) fail(`${pathLabel} must not contain duplicates`);
    return normalized;
  }
  const spec = object(value.spec, `${label}.spec`);
  only(spec, new Set(['path', 'section']), `${label}.spec`);
  if (typeof spec.section !== 'string' || spec.section.trim() !== spec.section
      || spec.section.length === 0 || spec.section.length > 512) {
    fail(`${label}.spec.section must be bounded non-empty text`);
  }
  // required_paths = required existing inputs (not "must change every generation").
  const requiredPaths = boundedPaths(value.required_paths, `${label}.required_paths`);
  // output_paths = authorized create/modify surface (narrow repair need not touch all).
  const outputPaths = boundedPaths(value.output_paths, `${label}.output_paths`);
  // required_change_paths = must appear in an effectful candidate diff (unless no-op).
  // Present empty array is invalid (omit the field or provide non-empty unique paths).
  let requiredChangePaths = [];
  if (Object.prototype.hasOwnProperty.call(value, 'required_change_paths')) {
    if (!Array.isArray(value.required_change_paths) || value.required_change_paths.length === 0) {
      fail(`${label}.required_change_paths when present must be a non-empty array`);
    }
    requiredChangePaths = boundedPaths(
      value.required_change_paths,
      `${label}.required_change_paths`,
      { allowEmpty: false },
    );
  }
  const authorizedCreates = Object.prototype.hasOwnProperty.call(value, 'authorized_creates')
    ? boundedPaths(value.authorized_creates, `${label}.authorized_creates`, { allowEmpty: true })
    : [];
  const versionMirrorPaths = Object.prototype.hasOwnProperty.call(value, 'version_mirror_paths')
    ? boundedPaths(value.version_mirror_paths, `${label}.version_mirror_paths`, { allowEmpty: true })
    : [];
  let versionMirrorGenerator = null;
  if (Object.prototype.hasOwnProperty.call(value, 'version_mirror_generator')) {
    if (value.version_mirror_generator !== null
        && (typeof value.version_mirror_generator !== 'string'
          || value.version_mirror_generator.trim() !== value.version_mirror_generator
          || value.version_mirror_generator.length === 0
          || value.version_mirror_generator.length > 512)) {
      fail(`${label}.version_mirror_generator must be bounded non-empty text or null`);
    }
    versionMirrorGenerator = value.version_mirror_generator;
  }
  if (versionMirrorPaths.length > 0 && !versionMirrorGenerator) {
    fail(`${label}.version_mirror_paths require version_mirror_generator closure`);
  }
  for (const mirror of versionMirrorPaths) {
    if (!outputPaths.includes(mirror) && !requiredPaths.includes(mirror)) {
      fail(`${label}.version_mirror_paths must close into required_paths/output_paths (${mirror})`);
    }
  }
  for (const create of authorizedCreates) {
    if (!outputPaths.includes(create) && !requiredPaths.includes(create)) {
      fail(`${label}.authorized_creates must be covered by required_paths/output_paths (${create})`);
    }
  }
  // Exact subset of output_paths — prefix membership alone is insufficient.
  for (const change of requiredChangePaths) {
    if (!outputPaths.includes(change)) {
      fail(`${label}.required_change_paths must be an exact subset of output_paths (${change})`);
    }
  }
  const maxChangedFiles = int(value.max_changed_files, `${label}.max_changed_files`, 1, 4096);
  if (outputPaths.length > maxChangedFiles) {
    fail(`${label}.output_paths exceed max_changed_files`);
  }
  const baselineChurn = int(value.baseline_churn, `${label}.baseline_churn`, 1, 10000000);
  const maxExtraChurn = int(value.max_extra_churn, `${label}.max_extra_churn`, 0, 5000000);
  const ratioCeiling = Math.floor(
    baselineChurn * Math.max(0, value.max_growth_ratio - 1) + 1e-9,
  );
  if (maxExtraChurn > ratioCeiling) {
    fail(`${label}.max_extra_churn exceeds ratio-derived ceiling ${ratioCeiling}`);
  }
  const maxRepairGenerations = int(
    value.max_repair_generations,
    `${label}.max_repair_generations`,
    0,
    PROFILE_REPAIR_CEILINGS[value.profile],
  );
  const result = {
    profile: value.profile,
    allowed_path_prefixes: paths,
    spec: {
      path: boundedPath(spec.path, `${label}.spec.path`),
      section: spec.section,
    },
    required_paths: requiredPaths,
    output_paths: outputPaths,
    max_changed_files: maxChangedFiles,
    baseline_churn: baselineChurn,
    max_growth_ratio: value.max_growth_ratio,
    max_extra_churn: maxExtraChurn,
    max_repair_generations: maxRepairGenerations,
    max_wall_seconds: int(value.max_wall_seconds, `${label}.max_wall_seconds`, 1, 3600),
  };
  // Optional path-role fields: only emit when present so legacy graph digests stay stable
  // when graphs omit them.
  if (requiredChangePaths.length > 0) result.required_change_paths = requiredChangePaths;
  if (authorizedCreates.length > 0) result.authorized_creates = authorizedCreates;
  if (versionMirrorPaths.length > 0) {
    result.version_mirror_paths = versionMirrorPaths;
    result.version_mirror_generator = versionMirrorGenerator;
  }
  return result;
}

function normalizeNode(raw, index) {
  const label = `mission graph.nodes[${index}]`;
  const value = object(raw, label);
  only(value, new Set([
    'id',
    'source_plan_ids',
    'source_rubric_ids',
    'dependencies',
    'acceptance_ids',
    'verification_commands',
    'gate_attempt_budget',
    'reservation',
    'campaign',
  ]), label);
  if (!Array.isArray(value.verification_commands) || value.verification_commands.length === 0) {
    fail(`${label}.verification_commands must be non-empty`);
  }
  const verificationCommands = value.verification_commands.map((command, commandIndex) => {
    if (typeof command !== 'string' || command.trim() !== command || command.length === 0 || command.length > 4096) {
      fail(`${label}.verification_commands[${commandIndex}] must be a bounded trimmed command`);
    }
    return command;
  });
  if (new Set(verificationCommands).size !== verificationCommands.length) {
    fail(`${label}.verification_commands must not contain duplicates`);
  }
  if (verificationCommands.join(' && ').length > 4096) {
    fail(`${label}.verification_commands projection exceeds 4096 characters`);
  }
  const acceptanceIds = tokenArray(
    value.acceptance_ids,
    `${label}.acceptance_ids`,
    { nonEmpty: true },
  );
  if (acceptanceIds.length > 64) fail(`${label}.acceptance_ids must contain at most 64 entries`);
  return {
    id: token(value.id, `${label}.id`),
    source_plan_ids: tokenArray(value.source_plan_ids, `${label}.source_plan_ids`, { nonEmpty: true }),
    source_rubric_ids: rubricArray(value.source_rubric_ids, `${label}.source_rubric_ids`),
    dependencies: tokenArray(value.dependencies, `${label}.dependencies`),
    acceptance_ids: acceptanceIds,
    verification_commands: verificationCommands,
    gate_attempt_budget: int(value.gate_attempt_budget, `${label}.gate_attempt_budget`, 1),
    reservation: normalizeReservation(value.reservation, `${label}.reservation`),
    campaign: normalizeCampaign(value.campaign, `${label}.campaign`),
  };
}

function effectivePolicy(input) {
  const policy = input && input.policy ? input.policy : input;
  const normalized = validateEffectiveMissionPolicy(policy);
  if (normalized.enforcement_mode === 'off') fail('Mission graph cannot be enabled while policy is off');
  return normalized;
}

function normalizeGraph(raw, policyInput) {
  const policy = effectivePolicy(policyInput);
  const value = object(raw, 'mission graph');
  only(value, new Set([
    'schema_version',
    'artifact_type',
    'nodes',
    'calculated_depth',
    'calculated_batches',
    'graph_digest',
  ]), 'mission graph');
  if (value.schema_version !== MISSION_GRAPH_SCHEMA_VERSION) fail('mission graph.schema_version must equal 1');
  if (value.artifact_type !== 'mission_execution_graph') fail('mission graph.artifact_type is invalid');
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) fail('mission graph.nodes must be non-empty');
  if (value.nodes.length > policy.max_deliverables) {
    fail(
      `mission graph has ${value.nodes.length} deliverables; policy allows ${policy.max_deliverables}`,
      'MISSION_GRAPH_DELIVERABLE_LIMIT',
    );
  }
  const nodes = value.nodes.map(normalizeNode).sort((left, right) => left.id.localeCompare(right.id));
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node.id)) fail(`mission graph has duplicate node id "${node.id}"`);
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (dependency === node.id) fail(`mission graph node "${node.id}" depends on itself`);
      if (!byId.has(dependency)) fail(`mission graph node "${node.id}" has unknown dependency "${dependency}"`);
    }
  }
  const visiting = new Set();
  const depths = new Map();
  function depth(id) {
    if (depths.has(id)) return depths.get(id);
    if (visiting.has(id)) fail(`mission graph contains a cycle at "${id}"`, 'MISSION_GRAPH_CYCLE');
    visiting.add(id);
    const node = byId.get(id);
    const result = node.dependencies.length === 0
      ? 1
      : 1 + Math.max(...node.dependencies.map(depth));
    visiting.delete(id);
    depths.set(id, result);
    return result;
  }
  for (const node of nodes) depth(node.id);
  const calculatedDepth = Math.max(...depths.values());
  const batches = new Map();
  for (const valueDepth of depths.values()) batches.set(valueDepth, (batches.get(valueDepth) || 0) + 1);
  const calculatedBatches = batches.size;
  const widestBatch = Math.max(...batches.values());
  if (calculatedDepth > policy.max_graph_depth) fail('mission graph exceeds max_graph_depth', 'MISSION_GRAPH_DEPTH_LIMIT');
  if (calculatedBatches > policy.max_batches) fail('mission graph exceeds max_batches', 'MISSION_GRAPH_BATCH_LIMIT');
  if (widestBatch > policy.max_parallel) fail('mission graph exceeds max_parallel', 'MISSION_GRAPH_PARALLEL_LIMIT');
  const reservationTotals = Object.fromEntries(RESERVATION_FIELDS.map((field) => [field, 0]));
  let gateAttemptTotal = 0;
  for (const node of nodes) {
    gateAttemptTotal += node.gate_attempt_budget;
    if (node.campaign.max_repair_generations + 1 > node.gate_attempt_budget) {
      fail(`mission graph node "${node.id}" review and repair generations exceed its gate attempt budget`, 'MISSION_GRAPH_GATE_LIMIT');
    }
    if (node.campaign.max_wall_seconds > node.reservation.wall_seconds) {
      fail(`mission graph node "${node.id}" campaign wall ceiling exceeds its reservation`);
    }
    for (const field of RESERVATION_FIELDS) reservationTotals[field] += node.reservation[field];
  }
  if (gateAttemptTotal > policy.max_gate_attempts) {
    fail('mission graph aggregate gate attempts exceed max_gate_attempts', 'MISSION_GRAPH_GATE_LIMIT');
  }
  const aggregateBindings = {
    campaigns: 'max_campaigns',
    wall_seconds: 'max_wall_seconds',
    tool_calls: 'max_tool_calls',
    engine_attempts: 'max_engine_attempts',
    external_wait_seconds: 'max_external_wait_seconds',
    canonical_changed_files: 'max_canonical_changed_files',
    output_bytes: 'max_output_bytes',
  };
  for (const [reservationField, policyField] of Object.entries(aggregateBindings)) {
    if (reservationTotals[reservationField] > policy[policyField]) {
      fail(
        `mission graph aggregate ${reservationField} reservation exceeds ${policyField}`,
        'MISSION_GRAPH_RESERVATION_LIMIT',
      );
    }
  }
  const body = {
    schema_version: MISSION_GRAPH_SCHEMA_VERSION,
    artifact_type: 'mission_execution_graph',
    nodes,
    calculated_depth: calculatedDepth,
    calculated_batches: calculatedBatches,
  };
  const digest = sha256(canonicalJson(body));
  if (value.calculated_depth !== undefined && value.calculated_depth !== calculatedDepth) {
    fail('mission graph.calculated_depth does not match the DAG');
  }
  if (value.calculated_batches !== undefined && value.calculated_batches !== calculatedBatches) {
    fail('mission graph.calculated_batches does not match the DAG');
  }
  if (value.graph_digest !== undefined && (!isSha256(value.graph_digest) || value.graph_digest !== digest)) {
    fail('mission graph.graph_digest does not match canonical graph content');
  }
  return { body, digest };
}

function freezeMissionExecutionGraph(rawGraph, policy) {
  const { body, digest } = normalizeGraph(rawGraph, policy);
  return {
    graph: cloneCanonical({ ...body, graph_digest: digest }),
    graph_digest: digest,
    calculated_depth: body.calculated_depth,
    calculated_batches: body.calculated_batches,
  };
}

function validateMissionExecutionGraph(rawGraph, policy) {
  return freezeMissionExecutionGraph(rawGraph, policy);
}

function deriveMissionGraphNodeDigest(rawGraph, nodeId, policy) {
  const frozen = freezeMissionExecutionGraph(rawGraph, policy);
  const exactId = token(nodeId, 'Mission graph node ID');
  const node = frozen.graph.nodes.find((entry) => entry.id === exactId);
  if (!node) fail(`mission graph has no node "${exactId}"`);
  return sha256(canonicalJson(node));
}

function checkMissionGraphCoverage(rawGraph, expected, policy) {
  const frozen = freezeMissionExecutionGraph(rawGraph, policy);
  const planIds = tokenArray(expected && expected.planIds, 'expected plan IDs', { nonEmpty: true });
  const rubricIds = rubricArray(expected && expected.rubricIds, 'expected rubric IDs');
  const actualPlans = frozen.graph.nodes.flatMap((node) => node.source_plan_ids);
  const actualRubrics = frozen.graph.nodes.flatMap((node) => node.source_rubric_ids);
  if (new Set(actualPlans).size !== actualPlans.length) fail('source plan IDs must map to exactly one node');
  if (new Set(actualRubrics).size !== actualRubrics.length) fail('source rubric IDs must map to exactly one node');
  if (canonicalJson(actualPlans.sort()) !== canonicalJson(planIds)) {
    fail('mission graph source plan coverage is not exact', 'MISSION_GRAPH_PLAN_COVERAGE');
  }
  if (canonicalJson(actualRubrics.sort()) !== canonicalJson(rubricIds)) {
    fail('mission graph source rubric coverage is not exact', 'MISSION_GRAPH_RUBRIC_COVERAGE');
  }
  return { ...frozen, coverage: { plan_ids: planIds, rubric_ids: rubricIds } };
}

function admitMissionExecutionGraph({ graph, policy, effect }) {
  const frozen = freezeMissionExecutionGraph(graph, policy);
  const result = typeof effect === 'function' ? effect(frozen) : undefined;
  return { ...frozen, effect_result: result };
}

module.exports = {
  MISSION_GRAPH_SCHEMA_VERSION,
  ICC_RUBRIC_ID,
  MissionGraphError,
  PROFILE_REPAIR_CEILINGS,
  RESERVATION_FIELDS,
  admitMissionExecutionGraph,
  checkMissionGraphCoverage,
  deriveMissionGraphNodeDigest,
  freezeMissionExecutionGraph,
  validateMissionExecutionGraph,
};
