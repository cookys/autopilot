#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveMissionPolicy } = require('../src/engine/mission-policy');
const { resolveGovernancePolicy } = require('../src/engine/owner-kernel/policy');

const MAX_CONTRACT_BYTES = 1024 * 1024;
const SCHEMA_PATH = path.resolve(
  __dirname,
  '..',
  'schemas',
  'implementation-campaign-contract.schema.json',
);

class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function loadCanonicalSchema() {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (error) {
    throw new CliError(`canonical campaign schema is unreadable: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !value.properties || typeof value.properties !== 'object'
      || !Array.isArray(value.required)
      || !Array.isArray(value['x-optional-properties'])
      || !value['x-profile-repair-ceilings']) {
    throw new CliError('canonical campaign schema is missing contract metadata');
  }
  const properties = Object.keys(value.properties);
  const required = new Set(value.required);
  const optional = new Set(value['x-optional-properties']);
  if (properties.length !== required.size + optional.size
      || properties.some((field) => !required.has(field) && !optional.has(field))
      || [...required].some((field) => optional.has(field))
      || value.additionalProperties !== false) {
    throw new CliError(
      'canonical campaign schema must be closed with every property required or explicitly optional',
    );
  }
  return value;
}

const CONTRACT_SCHEMA = loadCanonicalSchema();
const CONTRACT_FIELDS = new Set(Object.keys(CONTRACT_SCHEMA.properties));
const REQUIRED_FIELDS = new Set(CONTRACT_SCHEMA.required);
const PROFILE_REPAIR_CEILINGS = Object.freeze({
  ...CONTRACT_SCHEMA['x-profile-repair-ceilings'],
});

function usage() {
  return `Usage:
  node scripts/implementation-campaign-check.js seal \\
    --contract <file> --repo <git-repo> --mission-mode <off|shadow|enforce> \\
    --out <seal-file> [--mission-state <file>]
  node scripts/implementation-campaign-check.js check \\
    --contract <file> --repo <git-repo> --mission-mode <off|shadow|enforce> \\
    --seal <seal-file>

  --mission-state is optional for seal under shadow/off and required for
  enforce-mode seal authorization (reads a Mission state file, never a
  caller-supplied receipt or predicate).

Exit codes:
  0 = SEALED or VALID
  2 = usage/local I/O error
  3 = invalid contract, unsafe seal target, or seal drift`;
}

function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const command = argv[0];
  if (command !== 'seal' && command !== 'check') {
    throw new CliError(`unknown command: ${command}`);
  }
  const options = { command };
  const flags = new Map([
    ['--contract', 'contract'],
    ['--repo', 'repo'],
    ['--out', 'out'],
    ['--seal', 'seal'],
    ['--mission-mode', 'missionMode'],
    ['--mission-state', 'missionState'],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = flags.get(flag);
    if (!key) throw new CliError(`unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new CliError(`${flag} requires a value`);
    }
    if (options[key] !== undefined) {
      throw new CliError(`${flag} may be supplied only once`);
    }
    options[key] = value;
    index += 1;
  }
  for (const key of ['contract', 'repo', 'missionMode']) {
    if (!options[key]) throw new CliError(`--${key} is required`);
  }
  if (!new Set(['off', 'shadow', 'enforce']).has(options.missionMode)) {
    throw new CliError('--mission-mode must be off, shadow, or enforce');
  }
  if (command === 'seal' && !options.out) throw new CliError('--out is required for seal');
  if (command === 'check' && !options.seal) throw new CliError('--seal is required for check');
  if (command === 'seal' && options.seal) throw new CliError('--seal is not valid for seal');
  if (command === 'check' && options.out) throw new CliError('--out is not valid for check');
  if (command === 'check' && options.missionState) {
    throw new CliError('--mission-state is only valid for seal');
  }
  return options;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalFile(filePath, label) {
  let canonical;
  try {
    canonical = fs.realpathSync(filePath);
  } catch (error) {
    throw new CliError(`${label} is not readable: ${filePath}`);
  }
  const stat = fs.statSync(canonical);
  if (!stat.isFile()) throw new CliError(`${label} must be a regular file: ${filePath}`);
  return { path: canonical, stat };
}

function canonicalDirectory(directory, label) {
  let canonical;
  try {
    canonical = fs.realpathSync(directory);
  } catch (error) {
    throw new CliError(`${label} is not readable: ${directory}`);
  }
  if (!fs.statSync(canonical).isDirectory()) {
    throw new CliError(`${label} must be a directory: ${directory}`);
  }
  return canonical;
}

function runGit(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw new CliError(`git failed to start: ${result.error.message}`);
  return result;
}

function canonicalRepoIdentity(repo) {
  const common = runGit(repo, ['rev-parse', '--git-common-dir']);
  if (common.status !== 0) throw new CliError(`--repo is not a git repository: ${repo}`);
  const raw = common.stdout.trim();
  const candidate = path.isAbsolute(raw) ? raw : path.resolve(repo, raw);
  let canonical;
  try {
    canonical = fs.realpathSync(candidate);
  } catch (error) {
    throw new CliError(`cannot canonicalize git common dir: ${candidate}`);
  }
  return `git-common-dir:${canonical}`;
}

function projectMissionPolicy(repo) {
  const configPath = path.join(repo, '.claude', 'owner-kernel-governance.json');
  if (!fs.existsSync(configPath)) {
    return resolveMissionPolicy({ schema_version: 1, governance: {} });
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new CliError(`authoritative project governance is invalid: ${error.message}`, 3);
  }
  try {
    resolveGovernancePolicy(config);
    return resolveMissionPolicy(config);
  } catch (error) {
    throw new CliError(`authoritative project governance has invalid mission_convergence: ${error.message}`, 3);
  }
}

function projectMissionMode(repo) {
  return projectMissionPolicy(repo).policy.enforcement_mode;
}

function repoObjectFormat(repo) {
  const explicit = runGit(repo, ['rev-parse', '--show-object-format']);
  if (explicit.status === 0) {
    const format = explicit.stdout.trim();
    if (format === 'sha1' || format === 'sha256') return format;
  }
  const head = runGit(repo, ['rev-parse', 'HEAD']);
  if (head.status === 0 && /^[0-9a-f]{40}$/.test(head.stdout.trim())) return 'sha1';
  if (head.status === 0 && /^[0-9a-f]{64}$/.test(head.stdout.trim())) return 'sha256';
  throw new CliError('cannot determine repository object format');
}

function loadContract(contractPath) {
  const file = canonicalFile(contractPath, '--contract');
  let bytes;
  try {
    bytes = fs.readFileSync(file.path);
  } catch (error) {
    throw new CliError(`unable to read contract: ${contractPath}`);
  }
  if (bytes.length === 0 || bytes.length > MAX_CONTRACT_BYTES) {
    throw new CliError(`contract size must be 1..${MAX_CONTRACT_BYTES} bytes`, 3);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new CliError(`contract is not valid JSON: ${error.message}`, 3);
  }
  return { ...file, bytes, value, digest: sha256(bytes) };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function requireInteger(value, label, minimum, maximum, errors) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    errors.push(`${label}: expected integer in ${minimum}..${maximum}`);
  }
}

function validateUniqueStrings(value, label, options, errors) {
  if (!Array.isArray(value) || value.length < options.minimum || value.length > options.maximum) {
    errors.push(`${label}: expected array length ${options.minimum}..${options.maximum}`);
    return;
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    if (!nonEmptyString(entry) || entry.length > options.maxLength) {
      errors.push(`${label}[${index}]: expected trimmed non-empty string`);
      return;
    }
    if (options.pattern && !options.pattern.test(entry)) {
      errors.push(`${label}[${index}]: invalid format`);
    }
    if (seen.has(entry)) errors.push(`${label}[${index}]: duplicate value`);
    seen.add(entry);
  });
}

function isWindowsReservedSegment(segment) {
  const basename = segment.split('.')[0].toUpperCase();
  return /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$)$/.test(basename)
    || /^(?:COM|LPT)(?:[1-9]|\u00b9|\u00b2|\u00b3)$/.test(basename);
}

function normalizeAllowedPrefix(value) {
  if (!nonEmptyString(value) || value.includes('\\') || value.includes('\0')) return null;
  if (path.posix.isAbsolute(value) || value.startsWith('./') || /^[A-Za-z]:/.test(value)) {
    return null;
  }
  const withoutTrailing = value.endsWith('/') ? value.slice(0, -1) : value;
  if (!withoutTrailing || withoutTrailing.includes('//')) return null;
  const parts = withoutTrailing.split('/');
  if (parts.some((part) => (
    part === ''
    || part === '.'
    || part === '..'
    || part.trim() !== part
    || part.endsWith('.')
    || part.includes(':')
    || isWindowsReservedSegment(part)
    || /[\u0000-\u001f\u007f]/.test(part)
  ))) return null;
  if (parts.some((part) => part.toLowerCase() === '.git')) return null;
  return parts.join('/');
}

function validBoundedVerifyCommand(value) {
  if (!nonEmptyString(value) || value.length > 4096) return false;
  const segments = value.split(' && ');
  return segments.length > 0
    && segments.join(' && ') === value
    && segments.every((segment) => (
      /^[A-Za-z0-9_./:@%+=,-]+(?: [A-Za-z0-9_./:@%+=,-]+)*$/.test(segment)
    ));
}

function validateClosedObject(value, label, fields, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label}: expected object`);
    return false;
  }
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label}: unknown field '${key}'`);
  }
  for (const field of fields) {
    if (!hasOwn(value, field)) errors.push(`${label}: missing required field '${field}'`);
  }
  return true;
}

function validateStrictPath(value, label, allowedPrefixes, errors) {
  const normalized = normalizeAllowedPrefix(value);
  if (normalized === null) {
    errors.push(`${label}: path escapes or is not normalized`);
    return null;
  }
  if (allowedPrefixes
      && !allowedPrefixes.some((prefix) => normalized === prefix
        || normalized.startsWith(`${prefix}/`))) {
    errors.push(`${label}: path is outside allowed_path_prefixes`);
  }
  return normalized;
}

function validateMissionProjection(contract, required = false) {
  const errors = [];
  const hasRuntime = hasOwn(contract, 'mission_runtime');
  const hasDispatch = hasOwn(contract, 'strict_dispatch');
  if (required && (!hasRuntime || !hasDispatch)) {
    if (!hasRuntime) errors.push('mission_runtime: required for mission-subject-v2');
    if (!hasDispatch) errors.push('strict_dispatch: required for mission-subject-v2');
  }
  if (hasRuntime !== hasDispatch) {
    errors.push('mission_runtime and strict_dispatch must be present together');
  }
  if (!hasRuntime || !hasDispatch) return errors;

  const runtimeFields = [
    'schema_version',
    'root_run_id',
    'mission_lineage_id',
    'mission_policy_digest',
    'mission_graph_digest',
    'graph_node_id',
    'graph_node_digest',
  ];
  if (validateClosedObject(contract.mission_runtime, 'mission_runtime', runtimeFields, errors)) {
    const runtime = contract.mission_runtime;
    if (runtime.schema_version !== 1) errors.push('mission_runtime.schema_version: must be 1');
    if (!nonEmptyString(runtime.root_run_id) || runtime.root_run_id.length > 256) {
      errors.push('mission_runtime.root_run_id: expected bounded non-empty string');
    }
    if (typeof runtime.mission_lineage_id !== 'string'
        || !/^lineage-v1-[0-9a-f]{64}$/.test(runtime.mission_lineage_id)) {
      errors.push('mission_runtime.mission_lineage_id: invalid lineage id');
    }
    for (const field of [
      'mission_policy_digest',
      'mission_graph_digest',
      'graph_node_digest',
    ]) {
      if (typeof runtime[field] !== 'string' || !/^[0-9a-f]{64}$/.test(runtime[field])) {
        errors.push(`mission_runtime.${field}: expected lowercase SHA-256`);
      }
    }
    if (typeof runtime.graph_node_id !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runtime.graph_node_id)) {
      errors.push('mission_runtime.graph_node_id: invalid graph node id');
    }
  }

  const dispatchRequiredFields = [
    'schema_version',
    'spec',
    'required_paths',
    'output_paths',
    'allowed_path_prefixes',
    'budget',
    'verification_commands',
  ];
  const dispatchOptionalFields = [
    'required_change_paths',
    'authorized_creates',
    'version_mirror_paths',
    'version_mirror_generator',
  ];
  if (!contract.strict_dispatch || typeof contract.strict_dispatch !== 'object'
      || Array.isArray(contract.strict_dispatch)) {
    errors.push('strict_dispatch: expected object');
    return errors;
  }
  {
    const allowed = new Set([...dispatchRequiredFields, ...dispatchOptionalFields]);
    for (const key of Object.keys(contract.strict_dispatch)) {
      if (!allowed.has(key)) errors.push(`strict_dispatch: unknown field '${key}'`);
    }
    for (const field of dispatchRequiredFields) {
      if (!hasOwn(contract.strict_dispatch, field)) {
        errors.push(`strict_dispatch: missing required field '${field}'`);
      }
    }
  }
  const dispatch = contract.strict_dispatch;
  if (dispatch.schema_version !== 1) errors.push('strict_dispatch.schema_version: must be 1');

  const prefixes = [];
  if (!Array.isArray(dispatch.allowed_path_prefixes)
      || dispatch.allowed_path_prefixes.length === 0
      || dispatch.allowed_path_prefixes.length > 128) {
    errors.push('strict_dispatch.allowed_path_prefixes: expected array length 1..128');
  } else {
    dispatch.allowed_path_prefixes.forEach((entry, index) => {
      const normalized = validateStrictPath(
        entry,
        `strict_dispatch.allowed_path_prefixes[${index}]`,
        null,
        errors,
      );
      if (normalized !== null) prefixes.push(normalized);
    });
    if (new Set(prefixes).size !== prefixes.length) {
      errors.push('strict_dispatch.allowed_path_prefixes: duplicate normalized prefix');
    }
  }
  if (JSON.stringify(dispatch.allowed_path_prefixes) !== JSON.stringify(contract.allowed_path_prefixes)) {
    errors.push('strict_dispatch.allowed_path_prefixes: must equal allowed_path_prefixes');
  }

  if (validateClosedObject(dispatch.spec, 'strict_dispatch.spec', ['path', 'section'], errors)) {
    validateStrictPath(dispatch.spec.path, 'strict_dispatch.spec.path', prefixes, errors);
    if (!nonEmptyString(dispatch.spec.section) || dispatch.spec.section.length > 512) {
      errors.push('strict_dispatch.spec.section: expected bounded non-empty string');
    }
  }
  for (const field of ['required_paths', 'output_paths']) {
    const values = dispatch[field];
    if (!Array.isArray(values) || values.length === 0 || values.length > 128) {
      errors.push(`strict_dispatch.${field}: expected array length 1..128`);
      continue;
    }
    const normalized = values.map((entry, index) => validateStrictPath(
      entry,
      `strict_dispatch.${field}[${index}]`,
      prefixes,
      errors,
    )).filter((entry) => entry !== null);
    if (new Set(normalized).size !== normalized.length) {
      errors.push(`strict_dispatch.${field}: duplicate normalized path`);
    }
  }
  for (const field of ['required_change_paths', 'authorized_creates', 'version_mirror_paths']) {
    if (!hasOwn(dispatch, field)) continue;
    const values = dispatch[field];
    // required_change_paths when present must be non-empty; other optional arrays may be empty.
    if (field === 'required_change_paths') {
      if (!Array.isArray(values) || values.length === 0 || values.length > 128) {
        errors.push('strict_dispatch.required_change_paths: when present must be non-empty array length 1..128');
        continue;
      }
    } else if (!Array.isArray(values) || values.length > 128) {
      errors.push(`strict_dispatch.${field}: expected array length 0..128`);
      continue;
    }
    const normalized = values.map((entry, index) => validateStrictPath(
      entry,
      `strict_dispatch.${field}[${index}]`,
      prefixes,
      errors,
    )).filter((entry) => entry !== null);
    if (new Set(normalized).size !== normalized.length) {
      errors.push(`strict_dispatch.${field}: duplicate normalized path`);
    }
    if (field === 'required_change_paths' && Array.isArray(dispatch.output_paths)) {
      for (const change of normalized) {
        if (!dispatch.output_paths.includes(change)) {
          errors.push(
            `strict_dispatch.required_change_paths must be an exact subset of output_paths (${change})`,
          );
        }
      }
    }
  }
  if (Array.isArray(dispatch.version_mirror_paths)
      && dispatch.version_mirror_paths.length > 0
      && (typeof dispatch.version_mirror_generator !== 'string'
        || dispatch.version_mirror_generator.trim() === '')) {
    errors.push('strict_dispatch.version_mirror_paths require version_mirror_generator');
  }

  const budgetFields = [
    'max_changed_files',
    'max_wall_seconds',
    'max_output_bytes',
    'max_tool_calls',
    'max_engine_attempts',
  ];
  if (validateClosedObject(dispatch.budget, 'strict_dispatch.budget', budgetFields, errors)) {
    requireInteger(
      dispatch.budget.max_changed_files,
      'strict_dispatch.budget.max_changed_files',
      1,
      Number.MAX_SAFE_INTEGER,
      errors,
    );
    requireInteger(
      dispatch.budget.max_wall_seconds,
      'strict_dispatch.budget.max_wall_seconds',
      1,
      Number.MAX_SAFE_INTEGER,
      errors,
    );
    for (const field of ['max_output_bytes', 'max_tool_calls', 'max_engine_attempts']) {
      requireInteger(
        dispatch.budget[field],
        `strict_dispatch.budget.${field}`,
        0,
        Number.MAX_SAFE_INTEGER,
        errors,
      );
    }
    if (dispatch.budget.max_changed_files !== contract.max_changed_files) {
      errors.push('strict_dispatch.budget.max_changed_files: must equal max_changed_files');
    }
    if (dispatch.budget.max_wall_seconds !== contract.max_wall_seconds) {
      errors.push('strict_dispatch.budget.max_wall_seconds: must equal max_wall_seconds');
    }
  }
  validateUniqueStrings(dispatch.verification_commands, 'strict_dispatch.verification_commands', {
    minimum: 1,
    maximum: 128,
    maxLength: 4096,
  }, errors);
  if (Array.isArray(dispatch.verification_commands)
      && dispatch.verification_commands.join(' && ') !== contract.verify_cmd) {
    errors.push('strict_dispatch.verification_commands: must project exactly to verify_cmd');
  }
  return errors;
}

function validateContract(contract, context) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return ['contract: expected object'];
  }
  for (const key of Object.keys(contract)) {
    if (!CONTRACT_FIELDS.has(key)) errors.push(`contract: unknown field '${key}'`);
  }
  for (const key of REQUIRED_FIELDS) {
    if (!hasOwn(contract, key)) errors.push(`contract: missing required field '${key}'`);
  }
  if (contract.schema_version !== 1) errors.push('schema_version: must be 1');
  if (!nonEmptyString(contract.ticket)
      || contract.ticket.length > 128
      || !/^[A-Za-z0-9._-]+$/.test(contract.ticket)) {
    errors.push('ticket: must match [A-Za-z0-9._-]+ and be at most 128 characters');
  }
  if (!hasOwn(PROFILE_REPAIR_CEILINGS, contract.profile)) {
    errors.push('profile: unsupported profile');
  }
  if (contract.mission_grant_ref !== null
      && (typeof contract.mission_grant_ref !== 'string'
        || !/^[0-9a-f]{64}$/.test(contract.mission_grant_ref))) {
    errors.push('mission_grant_ref: expected null or lowercase SHA-256');
  }
  if (context.missionMode === 'enforce' && contract.mission_grant_ref === null) {
    errors.push('mission_grant_ref: required when Mission enforcement is enabled');
  }
  if (context.missionMode === 'enforce'
      && contract.mission_grant_ref !== null
      && (typeof contract.mission_grant_ref !== 'string'
        || !/^[0-9a-f]{64}$/.test(contract.mission_grant_ref))) {
    errors.push('mission_grant_ref: enforce mode requires a content-bound SHA-256 Mission grant digest');
  }
  if (contract.repo_identity !== context.repoIdentity) {
    errors.push('repo_identity: does not match canonical repository identity');
  }
  const expectedObjectLength = context.objectFormat === 'sha256' ? 64 : 40;
  if (typeof contract.base_sha !== 'string'
      || !new RegExp(`^[0-9a-f]{${expectedObjectLength}}$`).test(contract.base_sha)) {
    errors.push(
      `base_sha: expected ${expectedObjectLength}-hex ${context.objectFormat} object ID`,
    );
  } else {
    const commit = runGit(context.repo, ['cat-file', '-e', `${contract.base_sha}^{commit}`]);
    if (commit.status !== 0) errors.push('base_sha: commit does not exist in repository');
  }
  if (!nonEmptyString(contract.branch)
      || contract.branch.length > 255
      || contract.branch.startsWith('-')) {
    errors.push('branch: invalid Git branch name');
  } else {
    const refCheck = runGit(context.repo, ['check-ref-format', '--branch', contract.branch]);
    if (refCheck.status !== 0) errors.push('branch: invalid Git branch name');
  }
  validateUniqueStrings(contract.vertical_acceptance, 'vertical_acceptance', {
    minimum: 1,
    maximum: 64,
    maxLength: 1024,
  }, errors);
  validateUniqueStrings(contract.allowed_path_prefixes, 'allowed_path_prefixes', {
    minimum: 1,
    maximum: 128,
    maxLength: 1024,
  }, errors);
  if (Array.isArray(contract.allowed_path_prefixes)) {
    const normalized = new Set();
    contract.allowed_path_prefixes.forEach((prefix, index) => {
      const value = normalizeAllowedPrefix(prefix);
      if (value === null) {
        errors.push(`allowed_path_prefixes[${index}]: path escapes or is not normalized`);
      } else if (normalized.has(value)) {
        errors.push(`allowed_path_prefixes[${index}]: duplicate normalized prefix`);
      } else {
        normalized.add(value);
      }
    });
  }
  requireInteger(
    contract.max_changed_files,
    'max_changed_files',
    CONTRACT_SCHEMA.properties.max_changed_files.minimum,
    CONTRACT_SCHEMA.properties.max_changed_files.maximum,
    errors,
  );
  requireInteger(
    contract.baseline_churn,
    'baseline_churn',
    CONTRACT_SCHEMA.properties.baseline_churn.minimum,
    CONTRACT_SCHEMA.properties.baseline_churn.maximum,
    errors,
  );
  if (typeof contract.max_growth_ratio !== 'number'
      || !Number.isFinite(contract.max_growth_ratio)
      || contract.max_growth_ratio < CONTRACT_SCHEMA.properties.max_growth_ratio.minimum
      || contract.max_growth_ratio > CONTRACT_SCHEMA.properties.max_growth_ratio.maximum) {
    errors.push(
      `max_growth_ratio: expected finite number in `
      + `${CONTRACT_SCHEMA.properties.max_growth_ratio.minimum}`
      + `..${CONTRACT_SCHEMA.properties.max_growth_ratio.maximum}`,
    );
  }
  requireInteger(
    contract.max_extra_churn,
    'max_extra_churn',
    CONTRACT_SCHEMA.properties.max_extra_churn.minimum,
    CONTRACT_SCHEMA.properties.max_extra_churn.maximum,
    errors,
  );
  if (Number.isSafeInteger(contract.baseline_churn)
      && typeof contract.max_growth_ratio === 'number'
      && Number.isFinite(contract.max_growth_ratio)
      && Number.isSafeInteger(contract.max_extra_churn)) {
    const ratioCeiling = Math.floor(
      contract.baseline_churn * Math.max(0, contract.max_growth_ratio - 1) + 1e-9,
    );
    if (contract.max_extra_churn > ratioCeiling) {
      errors.push(`max_extra_churn: exceeds ratio-derived ceiling ${ratioCeiling}`);
    }
  }
  requireInteger(
    contract.max_repair_generations,
    'max_repair_generations',
    CONTRACT_SCHEMA.properties.max_repair_generations.minimum,
    CONTRACT_SCHEMA.properties.max_repair_generations.maximum,
    errors,
  );
  if (hasOwn(PROFILE_REPAIR_CEILINGS, contract.profile)
      && Number.isSafeInteger(contract.max_repair_generations)
      && contract.max_repair_generations > PROFILE_REPAIR_CEILINGS[contract.profile]) {
    errors.push(
      `max_repair_generations: exceeds ${contract.profile} ceiling `
      + `${PROFILE_REPAIR_CEILINGS[contract.profile]}`,
    );
  }
  requireInteger(
    contract.max_wall_seconds,
    'max_wall_seconds',
    CONTRACT_SCHEMA.properties.max_wall_seconds.minimum,
    CONTRACT_SCHEMA.properties.max_wall_seconds.maximum,
    errors,
  );
  if (!validBoundedVerifyCommand(contract.verify_cmd)) {
    errors.push(
      'verify_cmd: expected bounded space-delimited argv without shell control operators',
    );
  }
  validateUniqueStrings(contract.rubric_ids, 'rubric_ids', {
    minimum: 1,
    maximum: 128,
    maxLength: 128,
    pattern: /^[A-Za-z][A-Za-z0-9_-]*[0-9]+$/,
  }, errors);
  errors.push(...validateMissionProjection(
    contract,
    context && context.requireMissionProjection === true,
  ));
  return errors;
}

// Module-private object-identity attestation for enforce-mode Mission grant
// bindings. Only the real CLI/checker seal path may mint an entry after reading
// a Mission state file and resolving the exact live claim. Callers cannot mint,
// clone, or forge a usable binding — there is no public factory.
const MISSION_GRANT_BINDING_REGISTRY = new WeakSet();

function isAttestedMissionGrantBinding(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && MISSION_GRANT_BINDING_REGISTRY.has(value)
    && value.verified === true
    && typeof value.binding_digest === 'string'
    && /^[0-9a-f]{64}$/.test(value.binding_digest);
}

function grantBindingMatchesRef(bindingDigest, grantRef) {
  return typeof bindingDigest === 'string'
    && bindingDigest === grantRef
    && /^[0-9a-f]{64}$/.test(bindingDigest);
}

// Module-private mint. Reads the Mission state file, validates it, finds the
// unique live claim whose binding_digest equals the campaign grant ref, and
// validates claim identity against the campaign being sealed:
//   * v2 (mission-subject-v2): recomputed subject + campaign-v2 id, base SHA,
//     acceptance IDs, repo/lineage/authority — never raw final-byte digest
//   * v1/legacy: campaign_contract_digest must equal raw contract digest
// Never exported.
function mintMissionGrantBindingFromStateFile({
  missionStatePath,
  grantRef,
  contract,
  contractDigest,
  repoIdentity,
}) {
  if (typeof missionStatePath !== 'string' || missionStatePath.length === 0) {
    throw new CliError(
      'mission_grant_ref: enforce-mode seal requires --mission-state <file>',
      3,
    );
  }
  if (typeof grantRef !== 'string' || !/^[0-9a-f]{64}$/.test(grantRef)) {
    throw new CliError(
      'mission_grant_ref: enforce mode requires a content-bound SHA-256 Mission grant digest',
      3,
    );
  }
  const stateFile = canonicalFile(missionStatePath, '--mission-state');
  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile.path, 'utf8'));
  } catch (error) {
    throw new CliError(`--mission-state is not valid JSON: ${error.message}`, 3);
  }
  let mission;
  let identity;
  try {
    mission = require(path.resolve(__dirname, '..', 'src', 'engine', 'mission-convergence'));
    identity = require(path.resolve(__dirname, '..', 'src', 'engine', 'mission-campaign-identity'));
  } catch (error) {
    throw new CliError(
      `mission grant binding cannot load Mission engine: ${error.message}`,
      3,
    );
  }
  try {
    mission.validateMissionState(state);
  } catch (error) {
    throw new CliError(
      `mission_grant_ref: Mission state failed validation: ${error.message || String(error)}`,
      3,
    );
  }
  if (typeof state.repo_identity === 'string'
      && typeof repoIdentity === 'string'
      && state.repo_identity !== repoIdentity) {
    throw new CliError(
      'mission_grant_ref: Mission state repo_identity does not match the campaign repository',
      3,
    );
  }
  const matches = [];
  const claims = state.claims && typeof state.claims === 'object' ? state.claims : {};
  for (const claim of Object.values(claims)) {
    if (claim && grantBindingMatchesRef(claim.binding_digest, grantRef)) {
      matches.push(claim);
    }
  }
  if (matches.length === 0) {
    throw new CliError(
      'mission_grant_ref: no live Mission claim matches the campaign grant digest',
      3,
    );
  }
  if (matches.length > 1) {
    throw new CliError(
      'mission_grant_ref: Mission grant digest is ambiguous across multiple claims',
      3,
    );
  }
  const claim = matches[0];
  if (claim.released === true || claim.terminal === true) {
    throw new CliError(
      'mission_grant_ref: matching Mission claim is released or terminal',
      3,
    );
  }

  let subjectDigest = null;
  let campaignId = null;
  let identityScheme = null;
  const isV2 = identity.isMissionSubjectV2Claim(claim);

  if (isV2) {
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
      throw new CliError(
        'mission_grant_ref: enforce-mode seal requires the campaign contract for subject identity',
        3,
      );
    }
    const projectionErrors = validateMissionProjection(contract, true);
    if (projectionErrors.length > 0) {
      throw new CliError(
        `mission_grant_ref: ${projectionErrors.join('; ')}`,
        3,
      );
    }
    const graph = state.execution_graph;
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const node = nodes.find((entry) => entry.id === claim.graph_node_id);
    if (!node) {
      throw new CliError(
        'mission_grant_ref: v2 claim graph node is absent from frozen Mission graph',
        3,
      );
    }
    const expectedRuntime = {
      schema_version: 1,
      root_run_id: state.root_run_id,
      mission_lineage_id: state.mission_lineage_id,
      mission_policy_digest: state.mission_policy_digest || state.policy_hash,
      mission_graph_digest: state.mission_graph_digest,
      graph_node_id: node.id,
      graph_node_digest: mission.sha256(mission.canonicalJson(node)),
    };
    const expectedDispatch = {
      schema_version: 1,
      spec: node.campaign.spec,
      required_paths: node.campaign.required_paths,
      output_paths: node.campaign.output_paths,
      allowed_path_prefixes: node.campaign.allowed_path_prefixes,
      budget: {
        max_changed_files: node.campaign.max_changed_files,
        max_wall_seconds: node.campaign.max_wall_seconds,
        max_output_bytes: node.reservation.output_bytes,
        max_tool_calls: node.reservation.tool_calls,
        max_engine_attempts: node.reservation.engine_attempts,
      },
      verification_commands: node.verification_commands,
    };
    if (Array.isArray(node.campaign.required_change_paths)
        && node.campaign.required_change_paths.length > 0) {
      expectedDispatch.required_change_paths = node.campaign.required_change_paths;
    }
    if (Array.isArray(node.campaign.authorized_creates)
        && node.campaign.authorized_creates.length > 0) {
      expectedDispatch.authorized_creates = node.campaign.authorized_creates;
    }
    if (Array.isArray(node.campaign.version_mirror_paths)
        && node.campaign.version_mirror_paths.length > 0) {
      expectedDispatch.version_mirror_paths = node.campaign.version_mirror_paths;
      expectedDispatch.version_mirror_generator = node.campaign.version_mirror_generator;
    }
    if (mission.canonicalJson(contract.mission_runtime)
        !== mission.canonicalJson(expectedRuntime)) {
      throw new CliError(
        'mission_grant_ref: mission_runtime does not match frozen Mission state',
        3,
      );
    }
    if (mission.canonicalJson(contract.strict_dispatch)
        !== mission.canonicalJson(expectedDispatch)) {
      throw new CliError(
        'mission_grant_ref: strict_dispatch does not match frozen Mission graph node',
        3,
      );
    }
    try {
      subjectDigest = identity.missionSubjectDigest(contract);
      campaignId = identity.missionCampaignIdFor(
        repoIdentity,
        contract.ticket,
        subjectDigest,
      );
    } catch (error) {
      throw new CliError(
        `mission_grant_ref: cannot recompute mission subject identity: ${error.message}`,
        3,
      );
    }
    const claimSubject = identity.claimMissionSubjectDigest(claim);
    if (claimSubject !== subjectDigest) {
      throw new CliError(
        'mission_grant_ref: claim mission_subject_digest does not match recomputed subject',
        3,
      );
    }
    if (claim.campaign_id !== campaignId) {
      throw new CliError(
        'mission_grant_ref: claim campaign_id does not match recomputed campaign-v2 id',
        3,
      );
    }
    if (typeof contract.base_sha === 'string'
        && claim.base_sha !== contract.base_sha) {
      throw new CliError(
        'mission_grant_ref: claim base_sha does not match the sealed contract',
        3,
      );
    }
    const claimAccept = Array.isArray(claim.acceptance_ids)
      ? [...claim.acceptance_ids].map(String).sort()
      : [];
    const contractAccept = Array.isArray(contract.vertical_acceptance)
      ? [...contract.vertical_acceptance].map(String).sort()
      : [];
    if (claimAccept.length !== contractAccept.length
        || claimAccept.some((id, i) => id !== contractAccept[i])) {
      throw new CliError(
        'mission_grant_ref: claim acceptance_ids do not match vertical_acceptance',
        3,
      );
    }
    // v2: stored claim lineage + authority must exist and exactly match the
    // validated Mission state. Missing fields are rejection, not compatibility.
    if (typeof claim.mission_lineage_id !== 'string'
        || claim.mission_lineage_id.length === 0
        || claim.mission_lineage_id !== state.mission_lineage_id) {
      throw new CliError(
        'mission_grant_ref: claim mission_lineage_id does not match Mission state',
        3,
      );
    }
    if (typeof claim.task_authority_id !== 'string'
        || claim.task_authority_id.length === 0
        || claim.task_authority_id !== state.task_authority_id) {
      throw new CliError(
        'mission_grant_ref: claim task_authority_id does not match Mission state',
        3,
      );
    }
    identityScheme = identity.IDENTITY_SCHEME_V2;
  } else if (typeof contractDigest === 'string'
      && /^[0-9a-f]{64}$/.test(contractDigest)
      && claim.campaign_contract_digest !== contractDigest) {
    throw new CliError(
      'mission_grant_ref: claim campaign_contract_digest does not match the sealed contract',
      3,
    );
  }

  const binding = Object.freeze({
    kind: 'mission_grant_binding',
    verified: true,
    binding_digest: grantRef,
    claim_id: typeof claim.claim_id === 'string' ? claim.claim_id : null,
    campaign_contract_digest: isV2
      ? subjectDigest
      : (typeof claim.campaign_contract_digest === 'string'
        ? claim.campaign_contract_digest
        : null),
    identity_scheme: identityScheme,
    mission_subject_digest: subjectDigest,
    campaign_id: campaignId || (typeof claim.campaign_id === 'string' ? claim.campaign_id : null),
  });
  MISSION_GRANT_BINDING_REGISTRY.add(binding);
  return binding;
}

// Enforce-mode sealing verifies a content-bound Mission grant. Structural shape
// is checked by validateContract. Authorization accepts ONLY a module-private
// identity-attested binding minted by the real seal path after reading a
// Mission state file. Plain missionGrantReceipt, plain missionState, arbitrary
// functions, and any publicly constructible adapter/object cannot authorize.
// Without a trusted Mission binding, sealing fails closed.
function verifyEnforcedMissionGrant(contract, context = {}) {
  const grantRef = contract ? contract.mission_grant_ref : null;
  if (typeof grantRef !== 'string' || !/^[0-9a-f]{64}$/.test(grantRef)) {
    return 'mission_grant_ref: enforce mode requires a content-bound SHA-256 Mission grant digest';
  }

  // Reject every caller-supplied plain receipt / plain state / function. Only
  // the WeakSet-attested binding minted by mintMissionGrantBindingFromStateFile
  // may authorize; nothing else is consulted.
  const binding = context.missionGrantBinding;
  if (isAttestedMissionGrantBinding(binding)
      && grantBindingMatchesRef(binding.binding_digest, grantRef)) {
    return null;
  }

  return 'mission_grant_ref: enforced grant verification is unavailable until Mission integration';
}

function resolveOutputPath(rawPath, contractFile) {
  const absolute = path.resolve(rawPath);
  const parent = canonicalDirectory(path.dirname(absolute), '--out parent');
  const target = path.join(parent, path.basename(absolute));
  if (target === contractFile.path) {
    throw new CliError('seal target must be independent from the contract path', 3);
  }
  if (fs.existsSync(target)) {
    const targetLstat = fs.lstatSync(target);
    if (targetLstat.isSymbolicLink()) {
      throw new CliError('seal target must not be a symbolic link', 3);
    }
    const targetStat = fs.statSync(target);
    if (targetStat.dev === contractFile.stat.dev && targetStat.ino === contractFile.stat.ino) {
      throw new CliError('seal target must not alias the contract inode', 3);
    }
    if (!targetStat.isFile()) throw new CliError('seal target must be a regular file', 3);
  }
  return target;
}

function atomicWriteJson(target, value) {
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
    try {
      fs.linkSync(temp, target);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new CliError('seal target already exists; choose a new independent path', 3);
      }
      throw error;
    }
    fs.unlinkSync(temp);
    const parentFd = fs.openSync(path.dirname(target), 'r');
    try {
      fs.fsyncSync(parentFd);
    } finally {
      fs.closeSync(parentFd);
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
    try {
      fs.unlinkSync(temp);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function loadSeal(sealPath, contractFile) {
  const sealFile = canonicalFile(sealPath, '--seal');
  if (sealFile.path === contractFile.path
      || (sealFile.stat.dev === contractFile.stat.dev && sealFile.stat.ino === contractFile.stat.ino)) {
    throw new CliError('seal file must be independent from the contract', 3);
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(sealFile.path, 'utf8'));
  } catch (error) {
    throw new CliError(`seal file is not valid JSON: ${error.message}`, 3);
  }
  // Core provenance fields (always required). v2 enforce seals may also carry
  // mission-subject-v2 identity fields; raw contract_sha256 remains the
  // final-byte drift seal and is never replaced by the subject digest.
  const required = new Set([
    'schema_version',
    'contract_sha256',
    'contract_path',
    'repo_identity',
    'mission_mode',
    'sealed_at',
  ]);
  const optionalV2 = new Set([
    'identity_scheme',
    'mission_subject_digest',
    'campaign_id',
    'claim_id',
    'mission_grant_ref',
  ]);
  const allowed = new Set([...required, ...optionalV2]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError('seal file must contain an object', 3);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CliError(`seal file has unknown field '${key}'`, 3);
  }
  for (const key of required) {
    if (!hasOwn(value, key)) throw new CliError(`seal file is missing '${key}'`, 3);
  }
  if (value.schema_version !== 1
      || typeof value.contract_sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(value.contract_sha256)
      || typeof value.contract_path !== 'string'
      || typeof value.repo_identity !== 'string'
      || !new Set(['off', 'shadow', 'enforce']).has(value.mission_mode)
      || typeof value.sealed_at !== 'string'
      || !Number.isFinite(Date.parse(value.sealed_at))) {
    throw new CliError('seal file has invalid field values', 3);
  }
  if (hasOwn(value, 'identity_scheme')
      || hasOwn(value, 'mission_subject_digest')
      || hasOwn(value, 'campaign_id')
      || hasOwn(value, 'claim_id')
      || hasOwn(value, 'mission_grant_ref')) {
    if (value.identity_scheme !== 'mission-subject-v2'
        || typeof value.mission_subject_digest !== 'string'
        || !/^[0-9a-f]{64}$/.test(value.mission_subject_digest)
        || typeof value.campaign_id !== 'string'
        || !/^campaign-v2-[0-9a-f]{64}$/.test(value.campaign_id)
        || typeof value.claim_id !== 'string'
        || value.claim_id.length === 0
        || typeof value.mission_grant_ref !== 'string'
        || !/^[0-9a-f]{64}$/.test(value.mission_grant_ref)) {
      throw new CliError('seal file has invalid mission-subject-v2 identity fields', 3);
    }
  }
  return value;
}

function inspectSealedCampaignContract({
  contractPath,
  repoPath,
  sealPath,
  missionModeAssertion,
}) {
  const repo = canonicalDirectory(repoPath, '--repo');
  const repoIdentity = canonicalRepoIdentity(repo);
  const objectFormat = repoObjectFormat(repo);
  const missionMode = projectMissionMode(repo);
  if (missionModeAssertion !== undefined && missionModeAssertion !== missionMode) {
    throw new CliError(
      `--mission-mode ${missionModeAssertion} does not match authoritative project mode `
        + missionMode,
      3,
    );
  }
  const contractFile = loadContract(contractPath);
  const errors = validateContract(contractFile.value, {
    repo,
    repoIdentity,
    objectFormat,
    missionMode,
  });
  if (errors.length > 0) {
    return {
      ok: false,
      verdict: 'REJECTED',
      contract_sha256: contractFile.digest,
      errors,
    };
  }

  const seal = loadSeal(sealPath, contractFile);
  if (seal.identity_scheme === 'mission-subject-v2') {
    const v2Errors = validateContract(contractFile.value, {
      repo,
      repoIdentity,
      objectFormat,
      missionMode,
      requireMissionProjection: true,
    });
    if (v2Errors.length > 0) {
      return {
        ok: false,
        verdict: 'REJECTED',
        contract_sha256: contractFile.digest,
        errors: v2Errors,
      };
    }
  }
  const drift = [];
  if (seal.contract_sha256 !== contractFile.digest) drift.push('contract_sha256');
  if (seal.contract_path !== contractFile.path) drift.push('contract_path');
  if (seal.repo_identity !== repoIdentity) drift.push('repo_identity');
  if (seal.mission_mode !== missionMode) drift.push('mission_mode');

  // Recompute and re-check v2 subject identity when the seal carries it.
  // Subject is semantic (excludes mission_grant_ref); raw contract_sha256
  // remains the final-byte provenance above.
  let recomputedSubject = null;
  let recomputedCampaignId = null;
  if (seal.identity_scheme === 'mission-subject-v2') {
    let identity;
    try {
      identity = require(path.resolve(__dirname, '..', 'src', 'engine', 'mission-campaign-identity'));
      recomputedSubject = identity.missionSubjectDigest(contractFile.value);
      recomputedCampaignId = identity.missionCampaignIdFor(
        repoIdentity,
        contractFile.value.ticket,
        recomputedSubject,
      );
    } catch (error) {
      throw new CliError(
        `seal mission subject identity cannot be recomputed: ${error.message}`,
        3,
      );
    }
    if (seal.mission_subject_digest !== recomputedSubject) {
      drift.push('mission_subject_digest');
    }
    if (seal.campaign_id !== recomputedCampaignId) {
      drift.push('campaign_id');
    }
    if (typeof contractFile.value.mission_grant_ref === 'string'
        && seal.mission_grant_ref !== contractFile.value.mission_grant_ref) {
      drift.push('mission_grant_ref');
    }
  }

  if (drift.length > 0) {
    return {
      ok: false,
      verdict: 'DRIFT',
      contract_sha256: contractFile.digest,
      sealed_sha256: seal.contract_sha256,
      drift,
    };
  }
  return {
    ok: true,
    verdict: 'VALID',
    contract_sha256: contractFile.digest,
    sealed_sha256: seal.contract_sha256,
    contract_path: contractFile.path,
    seal_path: fs.realpathSync(sealPath),
    repo,
    repo_identity: repoIdentity,
    mission_mode: missionMode,
    contract: contractFile.value,
    identity_scheme: seal.identity_scheme || null,
    mission_subject_digest: seal.mission_subject_digest || recomputedSubject || null,
    campaign_id: seal.campaign_id || recomputedCampaignId || null,
    claim_id: seal.claim_id || null,
    mission_grant_ref: seal.mission_grant_ref || null,
  };
}

function emit(payload, code) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(code);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const repo = canonicalDirectory(options.repo, '--repo');
    const repoIdentity = canonicalRepoIdentity(repo);
    const objectFormat = repoObjectFormat(repo);
    const configuredMissionMode = projectMissionMode(repo);
    if (options.missionMode !== configuredMissionMode) {
      throw new CliError(
        `--mission-mode ${options.missionMode} does not match authoritative project mode `
          + configuredMissionMode,
        3,
      );
    }
    const contractFile = loadContract(options.contract);
    const errors = validateContract(contractFile.value, {
      repo,
      repoIdentity,
      objectFormat,
      missionMode: options.missionMode,
    });
    if (errors.length > 0) {
      emit({
        verdict: 'REJECTED',
        contract_sha256: contractFile.digest,
        errors,
      }, 3);
    }

    if (options.command === 'seal') {
      let missionGrantBinding = null;
      if (options.missionMode === 'enforce') {
        // Only the real CLI seal path may mint an identity-attested binding,
        // and only after reading --mission-state. Without a state file the
        // verifier fails closed; plain receipts/predicates never authorize.
        if (options.missionState) {
          try {
            missionGrantBinding = mintMissionGrantBindingFromStateFile({
              missionStatePath: options.missionState,
              grantRef: contractFile.value.mission_grant_ref,
              contract: contractFile.value,
              contractDigest: contractFile.digest,
              repoIdentity,
            });
          } catch (error) {
            if (error instanceof CliError) {
              emit({
                verdict: 'REJECTED',
                contract_sha256: contractFile.digest,
                errors: [error.message],
              }, 3);
            }
            throw error;
          }
        }
        const grantError = verifyEnforcedMissionGrant(contractFile.value, {
          repoIdentity,
          contractDigest: contractFile.digest,
          missionGrantBinding,
        });
        if (grantError) {
          emit({
            verdict: 'REJECTED',
            contract_sha256: contractFile.digest,
            errors: [grantError],
          }, 3);
        }
      }
      const output = resolveOutputPath(options.out, contractFile);
      // Raw contract_sha256 is always final-byte provenance. Enforce seals that
      // mint a v2 grant binding also record subject identity + campaign-v2 id.
      const seal = {
        schema_version: 1,
        contract_sha256: contractFile.digest,
        contract_path: contractFile.path,
        repo_identity: repoIdentity,
        mission_mode: options.missionMode,
        sealed_at: new Date().toISOString(),
      };
      if (missionGrantBinding
          && missionGrantBinding.identity_scheme === 'mission-subject-v2') {
        seal.identity_scheme = 'mission-subject-v2';
        seal.mission_subject_digest = missionGrantBinding.mission_subject_digest;
        seal.campaign_id = missionGrantBinding.campaign_id;
        seal.claim_id = missionGrantBinding.claim_id;
        seal.mission_grant_ref = missionGrantBinding.binding_digest;
      }
      atomicWriteJson(output, seal);
      emit({
        verdict: 'SEALED',
        contract_sha256: contractFile.digest,
        seal_path: output,
      }, 0);
    }

    const inspection = inspectSealedCampaignContract({
      contractPath: options.contract,
      repoPath: repo,
      sealPath: options.seal,
      missionModeAssertion: options.missionMode,
    });
    if (!inspection.ok) emit(inspection, 3);
    emit({
      verdict: inspection.verdict,
      contract_sha256: inspection.contract_sha256,
      sealed_sha256: inspection.sealed_sha256,
      repo_identity: inspection.repo_identity,
    }, 0);
  } catch (error) {
    const code = error instanceof CliError ? error.exitCode : 2;
    process.stderr.write(`implementation-campaign-check: ${error.message}\n`);
    if (code === 2) process.stderr.write(`${usage()}\n`);
    process.exit(code);
  }
}

if (require.main === module) main();

module.exports = {
  PROFILE_REPAIR_CEILINGS,
  canonicalRepoIdentity,
  inspectSealedCampaignContract,
  isWindowsReservedSegment,
  normalizeAllowedPrefix,
  projectMissionPolicy,
  projectMissionMode,
  repoObjectFormat,
  validateContract,
  validBoundedVerifyCommand,
  verifyEnforcedMissionGrant,
};
