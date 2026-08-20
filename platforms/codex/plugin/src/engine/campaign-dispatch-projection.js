'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ZERO_DIFF_RECEIPT_KEYS,
  validateZeroDiffReceipt: sharedValidateZeroDiffReceipt,
} = require('./sealed-zero-diff-validator');

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ROOT_RUN_ID = /^[A-Za-z0-9._-]+$/;
const CAMPAIGN_STAGE = /^campaign-implementation(?:#r((?:[2-9]|[1-9][0-9]+)))?$/;

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
  return output;
}

function canonicalDigest(value) {
  return crypto.createHash('sha256').update(
    JSON.stringify(canonicalize(value)),
  ).digest('hex');
}

function bytesDigest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requireExactObject(value, keys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} fields do not match the frozen schema`);
  }
  return value;
}

function requireString(value, label, pattern = null) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0
      || (pattern && !pattern.test(value))) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function requireRelativePath(value, label) {
  requireString(value, label);
  const core = value.endsWith('/') ? value.slice(0, -1) : value;
  if (value.startsWith('/') || value.startsWith('./') || value.includes('\\')
      || value.includes('\0') || value.includes('//')
      || core.length === 0
      || core.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new TypeError(`${label} must be a normalized repo-relative path`);
  }
  return value;
}

function requirePathArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  const normalized = value.map((entry, index) => (
    requireRelativePath(entry, `${label}[${index}]`)
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} must not contain duplicates`);
  }
  return normalized;
}

function pathWithinPrefixes(candidate, prefixes) {
  const normalizedCandidate = candidate.replace(/\/+$/, '');
  return prefixes.some((prefix) => {
    const normalizedPrefix = prefix.replace(/\/+$/, '');
    return normalizedCandidate === normalizedPrefix
      || normalizedCandidate.startsWith(`${normalizedPrefix}/`);
  });
}

function generationForStage(stage) {
  const match = CAMPAIGN_STAGE.exec(requireString(stage, 'stage'));
  if (!match) throw new TypeError('stage is not a campaign implementation stage');
  return match[1] ? Number(match[1]) - 1 : 0;
}

function expectedBranch({ campaignBranch, base, generation }) {
  if (generation === 0) return campaignBranch;
  return `${campaignBranch}-repair-r${generation + 1}-${base.slice(0, 7)}`;
}

function normalizeCampaignAuthority(contract) {
  if (!isPlainObject(contract)) throw new TypeError('campaign contract must be an object');
  const runtime = requireExactObject(contract.mission_runtime, [
    'schema_version',
    'root_run_id',
    'mission_lineage_id',
    'mission_policy_digest',
    'mission_graph_digest',
    'graph_node_id',
    'graph_node_digest',
  ], 'campaign mission_runtime');
  // Required keys plus optional path-role fields (authorized creates / generator closure).
  const strictRequired = [
    'schema_version',
    'spec',
    'required_paths',
    'output_paths',
    'allowed_path_prefixes',
    'budget',
    'verification_commands',
  ];
  const strictOptional = [
    'required_change_paths',
    'authorized_creates',
    'version_mirror_paths',
    'version_mirror_generator',
  ];
  if (!isPlainObject(contract.strict_dispatch)) {
    throw new TypeError('campaign strict_dispatch must be an object');
  }
  const strictKeys = Object.keys(contract.strict_dispatch).sort();
  const allowedStrictKeys = new Set([...strictRequired, ...strictOptional]);
  for (const key of strictKeys) {
    if (!allowedStrictKeys.has(key)) {
      throw new TypeError(`campaign strict_dispatch fields do not match the frozen schema (${key})`);
    }
  }
  for (const key of strictRequired) {
    if (!Object.prototype.hasOwnProperty.call(contract.strict_dispatch, key)) {
      throw new TypeError(`campaign strict_dispatch missing required field ${key}`);
    }
  }
  const strict = contract.strict_dispatch;
  if (runtime.schema_version !== 1 || strict.schema_version !== 1) {
    throw new TypeError('campaign projection schema_version must be 1');
  }
  const spec = requireExactObject(strict.spec, ['path', 'section'], 'strict_dispatch.spec');
  const budget = requireExactObject(strict.budget, [
    'max_changed_files',
    'max_wall_seconds',
    'max_output_bytes',
    'max_tool_calls',
    'max_engine_attempts',
  ], 'strict_dispatch.budget');
  const allowedPaths = requirePathArray(
    strict.allowed_path_prefixes,
    'strict_dispatch.allowed_path_prefixes',
  );
  const requiredPaths = requirePathArray(strict.required_paths, 'strict_dispatch.required_paths');
  const outputPaths = requirePathArray(strict.output_paths, 'strict_dispatch.output_paths');
  // Present empty array is invalid — omit the key or provide a non-empty unique set.
  let requiredChangePaths = [];
  if (Object.prototype.hasOwnProperty.call(strict, 'required_change_paths')) {
    if (!Array.isArray(strict.required_change_paths)
        || strict.required_change_paths.length === 0) {
      throw new TypeError(
        'strict_dispatch.required_change_paths when present must be a non-empty array',
      );
    }
    requiredChangePaths = requirePathArray(
      strict.required_change_paths,
      'strict_dispatch.required_change_paths',
    );
    for (const change of requiredChangePaths) {
      if (!outputPaths.includes(change)) {
        throw new TypeError(
          `strict_dispatch.required_change_paths must be an exact subset of output_paths (${change})`,
        );
      }
    }
  }
  const authorizedCreates = Array.isArray(strict.authorized_creates)
    && strict.authorized_creates.length > 0
    ? requirePathArray(strict.authorized_creates, 'strict_dispatch.authorized_creates')
    : [];
  const versionMirrorPaths = Array.isArray(strict.version_mirror_paths)
    && strict.version_mirror_paths.length > 0
    ? requirePathArray(strict.version_mirror_paths, 'strict_dispatch.version_mirror_paths')
    : [];
  if (versionMirrorPaths.length > 0
      && (typeof strict.version_mirror_generator !== 'string'
        || strict.version_mirror_generator.trim() === '')) {
    throw new TypeError('strict_dispatch.version_mirror_paths require version_mirror_generator');
  }
  const specPath = requireRelativePath(spec.path, 'strict_dispatch.spec.path');
  requireString(spec.section, 'strict_dispatch.spec.section');
  for (const [label, entries] of [
    ['strict_dispatch.spec.path', [specPath]],
    ['strict_dispatch.required_paths', requiredPaths],
    ['strict_dispatch.output_paths', outputPaths],
    ['strict_dispatch.required_change_paths', requiredChangePaths],
    ['strict_dispatch.authorized_creates', authorizedCreates],
    ['strict_dispatch.version_mirror_paths', versionMirrorPaths],
  ]) {
    for (const entry of entries) {
      if (!pathWithinPrefixes(entry, allowedPaths)) {
        throw new TypeError(`${label} is outside strict_dispatch.allowed_path_prefixes`);
      }
    }
  }
  if (!Array.isArray(strict.verification_commands)
      || strict.verification_commands.length === 0) {
    throw new TypeError('strict_dispatch.verification_commands must be non-empty');
  }
  const verificationCommands = strict.verification_commands.map((command, index) => {
    requireString(command, `strict_dispatch.verification_commands[${index}]`);
    if (command.length > 4096 || command.includes('\0')) {
      throw new TypeError(`strict_dispatch.verification_commands[${index}] is unbounded`);
    }
    return command;
  });
  if (new Set(verificationCommands).size !== verificationCommands.length) {
    throw new TypeError('strict_dispatch.verification_commands must not contain duplicates');
  }
  const maxChangedFiles = requireInteger(
    budget.max_changed_files,
    'strict_dispatch.budget.max_changed_files',
    1,
  );
  const maxWallSeconds = requireInteger(
    budget.max_wall_seconds,
    'strict_dispatch.budget.max_wall_seconds',
    1,
  );
  if (maxWallSeconds < 10 || maxWallSeconds > 3600) {
    throw new TypeError('strict_dispatch.budget.max_wall_seconds must be in 10..3600');
  }
  requireInteger(budget.max_output_bytes, 'strict_dispatch.budget.max_output_bytes', 1);
  requireInteger(budget.max_tool_calls, 'strict_dispatch.budget.max_tool_calls', 1);
  const maxEngineAttempts = requireInteger(
    budget.max_engine_attempts,
    'strict_dispatch.budget.max_engine_attempts',
    1,
  );
  if (maxEngineAttempts > 3) {
    throw new TypeError('strict_dispatch.budget.max_engine_attempts must be in 1..3');
  }
  if (outputPaths.length > maxChangedFiles) {
    throw new TypeError('strict_dispatch.output_paths exceed max_changed_files');
  }

  const campaignAllowed = requirePathArray(
    contract.allowed_path_prefixes,
    'campaign allowed_path_prefixes',
  );
  if (JSON.stringify(campaignAllowed) !== JSON.stringify(allowedPaths)) {
    throw new TypeError('strict_dispatch allowed paths disagree with campaign authority');
  }
  if (contract.max_changed_files !== maxChangedFiles
      || contract.max_wall_seconds !== maxWallSeconds) {
    throw new TypeError('strict_dispatch budget disagrees with campaign authority');
  }
  const baselineChurn = requireInteger(
    contract.baseline_churn,
    'campaign baseline_churn',
    1,
  );
  const maxExtraChurn = requireInteger(contract.max_extra_churn, 'campaign max_extra_churn');
  if (typeof contract.max_growth_ratio !== 'number'
      || !Number.isFinite(contract.max_growth_ratio)
      || contract.max_growth_ratio < 1) {
    throw new TypeError('campaign max_growth_ratio is invalid');
  }
  const ratioLimit = Math.floor(baselineChurn * contract.max_growth_ratio);
  const additiveLimit = baselineChurn + maxExtraChurn;

  return {
    runtime: {
      root_run_id: requireString(runtime.root_run_id, 'mission_runtime.root_run_id', ROOT_RUN_ID),
      mission_lineage_id: requireString(
        runtime.mission_lineage_id,
        'mission_runtime.mission_lineage_id',
      ),
      mission_policy_digest: requireString(
        runtime.mission_policy_digest,
        'mission_runtime.mission_policy_digest',
        SHA256,
      ),
      mission_graph_digest: requireString(
        runtime.mission_graph_digest,
        'mission_runtime.mission_graph_digest',
        SHA256,
      ),
      graph_node_id: requireString(runtime.graph_node_id, 'mission_runtime.graph_node_id'),
      graph_node_digest: requireString(
        runtime.graph_node_digest,
        'mission_runtime.graph_node_digest',
        SHA256,
      ),
    },
    strict,
    spec: { path: specPath, section: spec.section },
    requiredPaths,
    outputPaths,
    requiredChangePaths,
    authorizedCreates,
    versionMirrorPaths,
    versionMirrorGenerator: versionMirrorPaths.length > 0
      ? strict.version_mirror_generator
      : null,
    allowedPaths,
    verificationCommands,
    maxChangedFiles,
    maxWallSeconds,
    maxEngineAttempts,
    maxDiffLines: Math.max(1, Math.min(ratioLimit, additiveLimit)),
  };
}

function hasCampaignDispatchAuthority(contract) {
  return isPlainObject(contract)
    && Object.prototype.hasOwnProperty.call(contract, 'mission_runtime')
    && Object.prototype.hasOwnProperty.call(contract, 'strict_dispatch');
}

function validateZeroDiffReceipt(receipt, context) {
  // Delegate to the single production sealed zero-diff validator (D2 A06).
  return sharedValidateZeroDiffReceipt(receipt, {
    base: context.base,
    campaignProjection: context.campaignProjection,
    acceptance: context.acceptance,
    requiredChangePaths: context.requiredChangePaths,
    outputPaths: context.outputPaths,
  });
}

function buildMissionZeroDiffReceipt(input = {}) {
  const adoption = input.missionNoopAdoption;
  if (!isPlainObject(adoption)
      || !isPlainObject(adoption.noop_receipt)
      || adoption.noop_receipt_digest !== adoption.noop_receipt.digest
      || !SHA256.test(adoption.noop_receipt_digest || '')
      || !SHA256.test(adoption.source_work_order_digest || '')
      || typeof adoption.source_work_order_id !== 'string'
      || adoption.source_work_order_id.length === 0) {
    throw new TypeError('Mission no-op adoption lacks exact controller Work Order authority');
  }
  const source = adoption.noop_receipt;
  const sourceBody = { ...source };
  delete sourceBody.digest;
  if (source.artifact_type !== 'noop_receipt'
      || canonicalDigest(sourceBody) !== source.digest
      || source.dispatcher_called !== false
      || source.mutation_attempts !== 0
      || source.gate_attempts !== 0) {
    throw new TypeError('Mission no-op source receipt is invalid');
  }
  const projectionInput = { ...input };
  delete projectionInput.missionNoopAdoption;
  delete projectionInput.zeroDiffReceipt;
  const unit = deriveCampaignDispatchUnit(projectionInput);
  const projection = unit.campaign_projection;
  const relevantPaths = [...new Set([
    ...(unit.output.required_change_paths || []),
    ...unit.output.paths,
  ])].sort();
  if (source.base_sha !== input.base
      || source.accepted_commit !== input.base
      || source.mission_lineage_id !== projection.mission_lineage_id
      || source.mission_policy_digest !== projection.mission_policy_digest
      || source.mission_graph_digest !== projection.mission_graph_digest
      || source.graph_node_id !== projection.graph_node_id
      || adoption.graph_node_id !== projection.graph_node_id
      || !isPlainObject(source.path_byte_digests)
      || JSON.stringify(Object.keys(source.path_byte_digests).sort())
        !== JSON.stringify(relevantPaths)) {
    throw new TypeError('Mission no-op source does not bind the current sealed graph node');
  }
  const acceptance = unit.acceptance.map((entry) => ({
    argv: entry.argv,
    exit: entry.exit,
  }));
  const body = {
    schema_version: 1,
    artifact_type: 'campaign_zero_diff_receipt',
    base_sha: input.base,
    acceptance_digest: bytesDigest(Buffer.from(JSON.stringify(acceptance), 'utf8')),
    campaign_contract_digest: projection.campaign_contract_sha256,
    strict_dispatch_digest: projection.strict_dispatch_sha256,
    campaign_id: projection.campaign_id,
    mission_lineage_id: projection.mission_lineage_id,
    mission_policy_digest: projection.mission_policy_digest,
    mission_graph_digest: projection.mission_graph_digest,
    graph_node_id: projection.graph_node_id,
    mission_noop_receipt_digest: source.digest,
    source_work_order_id: adoption.source_work_order_id,
    source_work_order_digest: adoption.source_work_order_digest,
    path_byte_digests: source.path_byte_digests,
    candidate_zero_change: true,
  };
  return {
    ...body,
    digest: bytesDigest(Buffer.from(JSON.stringify(body), 'utf8')),
  };
}

function deriveCampaignDispatchUnit(input) {
  const {
    campaignContract,
    campaignContractSha256,
    campaignId,
    branch,
    base,
    runner,
    model,
    stage,
    rootRunId,
  } = input || {};
  requireString(campaignContractSha256, 'campaignContractSha256', SHA256);
  requireString(campaignId, 'campaignId', /^campaign-v[12]-[0-9a-f]{64}$/);
  requireString(base, 'base', GIT_OBJECT);
  requireString(branch, 'branch');
  requireString(runner, 'runner');
  requireString(model, 'model');
  requireString(rootRunId, 'rootRunId', ROOT_RUN_ID);
  const authority = normalizeCampaignAuthority(campaignContract);
  const generation = generationForStage(stage);
  const campaignBase = requireString(campaignContract.base_sha, 'campaign base_sha', GIT_OBJECT);
  const campaignBranch = requireString(campaignContract.branch, 'campaign branch');
  const expected = expectedBranch({ campaignBranch, base, generation });
  if (branch !== expected) {
    throw new TypeError(`caller branch disagrees with campaign stage (expected ${expected})`);
  }
  if (generation === 0 && base !== campaignBase) {
    throw new TypeError('caller base disagrees with campaign base_sha');
  }
  if (rootRunId !== authority.runtime.root_run_id) {
    throw new TypeError('caller root_run_id disagrees with campaign mission_runtime');
  }
  const strictDispatchSha256 = canonicalDigest(authority.strict);
  const campaignProjection = {
    schema_version: 1,
    campaign_contract_sha256: campaignContractSha256,
    strict_dispatch_sha256: strictDispatchSha256,
    campaign_id: campaignId,
    ticket: requireString(
      campaignContract.ticket,
      'campaign ticket',
      /^[A-Za-z0-9._-]{1,128}$/,
    ),
    campaign_base_sha: campaignBase,
    branch,
    stage,
    generation,
    root_run_id: authority.runtime.root_run_id,
    mission_lineage_id: authority.runtime.mission_lineage_id,
    mission_policy_digest: authority.runtime.mission_policy_digest,
    mission_graph_digest: authority.runtime.mission_graph_digest,
    graph_node_id: authority.runtime.graph_node_id,
    graph_node_digest: authority.runtime.graph_node_digest,
    runner,
    model,
  };
  const dependsOn = generation === 0 ? [] : [campaignBase];
  const acceptance = authority.verificationCommands.map((command) => ({
    argv: ['sh', '-lc', command],
    exit: 0,
  }));
  const zeroDiffReceipt = Object.prototype.hasOwnProperty.call(
    input || {},
    'zeroDiffReceipt',
  )
    ? validateZeroDiffReceipt(input.zeroDiffReceipt, {
      base,
      campaignProjection,
      acceptance,
      requiredChangePaths: authority.requiredChangePaths,
      outputPaths: authority.outputPaths,
    })
    : null;
  return {
    schema: 1,
    unit_id: `${campaignProjection.ticket}:${stage}:g${generation}`,
    role: 'implementer',
    goal: `Implement sealed campaign ${campaignProjection.ticket} at ${stage}`,
    spec: authority.spec,
    base_sha: base,
    depends_on: dependsOn,
    scope: {
      allow_paths: authority.allowedPaths,
      deny_paths: [],
      max_files: authority.maxChangedFiles,
      max_diff_lines: authority.maxDiffLines,
    },
    go: {
      required_paths: authority.requiredPaths,
      required_engine_role: 'implementer',
      required_red_command: ['sh', '-lc', authority.verificationCommands[0]],
    },
    no_go: {
      on_missing_spec: 'stop',
      on_dirty_base: 'stop',
      on_unknown_engine: 'stop',
      on_quota_unavailable: 'stop',
      on_scope_violation: 'stop',
      on_budget_exceeded: 'stop',
      on_clarification_needed: 'stop',
      forbidden_actions: ['push', 'merge', 'network', 'dependency-change'],
    },
    output: {
      kind: 'commit',
      paths: authority.outputPaths,
      // Effectful candidates must change every required_change_path; no-op is the only exception.
      ...(authority.requiredChangePaths && authority.requiredChangePaths.length > 0
        ? { required_change_paths: authority.requiredChangePaths }
        : {}),
      ...(zeroDiffReceipt ? { zero_diff_receipt: zeroDiffReceipt } : {}),
    },
    acceptance,
    budget: {
      wall_seconds: authority.maxWallSeconds,
      max_attempts: authority.maxEngineAttempts,
      max_context_files: Math.max(1, Math.min(20, authority.requiredPaths.length)),
    },
    campaign_projection: campaignProjection,
  };
}

function verifyCampaignDispatchUnit(input) {
  const expected = deriveCampaignDispatchUnit(input);
  const supplied = input && input.unitContract;
  if (!isPlainObject(supplied)
      || JSON.stringify(canonicalize(supplied)) !== JSON.stringify(canonicalize(expected))) {
    throw new TypeError('dispatch-unit contract does not match sealed campaign projection');
  }
  return expected;
}

function writeCampaignDispatchUnit(input) {
  const contract = deriveCampaignDispatchUnit(input);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-campaign-unit-'));
  const contractPath = path.join(directory, 'dispatch-unit.json');
  const bytes = `${JSON.stringify(contract, null, 2)}\n`;
  fs.writeFileSync(contractPath, bytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return {
    contract,
    contract_path: contractPath,
    contract_sha256: bytesDigest(bytes),
    cleanup() {
      try {
        fs.unlinkSync(contractPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try {
        fs.rmdirSync(directory);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    },
  };
}

module.exports = {
  buildMissionZeroDiffReceipt,
  canonicalDigest,
  deriveCampaignDispatchUnit,
  generationForStage,
  hasCampaignDispatchAuthority,
  normalizeCampaignAuthority,
  validateZeroDiffReceipt,
  verifyCampaignDispatchUnit,
  writeCampaignDispatchUnit,
};
