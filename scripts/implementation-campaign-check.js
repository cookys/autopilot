#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
      || !value['x-profile-repair-ceilings']) {
    throw new CliError('canonical campaign schema is missing contract metadata');
  }
  const properties = Object.keys(value.properties);
  const required = new Set(value.required);
  if (properties.length !== required.size
      || properties.some((field) => !required.has(field))
      || value.additionalProperties !== false) {
    throw new CliError('canonical campaign schema must be closed with every property required');
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
    --out <seal-file>
  node scripts/implementation-campaign-check.js check \\
    --contract <file> --repo <git-repo> --mission-mode <off|shadow|enforce> \\
    --seal <seal-file>

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

function projectMissionMode(repo) {
  const configPath = path.join(repo, '.claude', 'owner-kernel-governance.json');
  if (!fs.existsSync(configPath)) return 'off';
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new CliError(`authoritative project governance is invalid: ${error.message}`, 3);
  }
  if (!hasOwn(config, 'mission_convergence')) return 'off';
  const section = config.mission_convergence;
  if (!section || typeof section !== 'object' || Array.isArray(section)
      || !new Set(['off', 'shadow', 'enforce']).has(section.enforcement_mode)) {
    throw new CliError(
      'authoritative project governance has invalid mission_convergence.enforcement_mode',
      3,
    );
  }
  return section.enforcement_mode;
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
  return nonEmptyString(value)
    && value.length <= 4096
    && /^[A-Za-z0-9_./:@%+=,-]+(?: [A-Za-z0-9_./:@%+=,-]+)*$/.test(value);
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
  return errors;
}

// Enforce-mode sealing verifies a content-bound Mission grant. Structural shape
// is checked by validateContract; this gate additionally requires a host-injected
// verifier to attest that the grant ref binds this exact contract. A bare
// boolean/predicate can never claim a grant is verified — the verifier must
// return a content-bound attestation whose binding_digest equals the grant ref.
// Without an injected verifier (the pre-integration CLI path) or on any mismatch,
// sealing fails closed.
function verifyEnforcedMissionGrant(contract, context = {}) {
  const grantRef = contract ? contract.mission_grant_ref : null;
  if (typeof grantRef !== 'string' || !/^[0-9a-f]{64}$/.test(grantRef)) {
    return 'mission_grant_ref: enforce mode requires a content-bound SHA-256 Mission grant digest';
  }
  const verifier = typeof context.missionGrantVerifier === 'function'
    ? context.missionGrantVerifier
    : null;
  if (!verifier) {
    return 'mission_grant_ref: enforced grant verification is unavailable until Mission integration';
  }
  let attestation;
  try {
    attestation = verifier({
      mission_grant_ref: grantRef,
      campaign_contract_digest: context.contractDigest || null,
      repo_identity: context.repoIdentity || null,
    });
  } catch (_error) {
    attestation = null;
  }
  if (!attestation || typeof attestation !== 'object'
      || attestation.verified !== true
      || attestation.binding_digest !== grantRef) {
    return 'mission_grant_ref: enforced grant verification is unavailable until Mission integration';
  }
  return null;
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
  const allowed = new Set([
    'schema_version',
    'contract_sha256',
    'contract_path',
    'repo_identity',
    'mission_mode',
    'sealed_at',
  ]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError('seal file must contain an object', 3);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CliError(`seal file has unknown field '${key}'`, 3);
  }
  for (const key of allowed) {
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
  const drift = [];
  if (seal.contract_sha256 !== contractFile.digest) drift.push('contract_sha256');
  if (seal.contract_path !== contractFile.path) drift.push('contract_path');
  if (seal.repo_identity !== repoIdentity) drift.push('repo_identity');
  if (seal.mission_mode !== missionMode) drift.push('mission_mode');
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
      if (options.missionMode === 'enforce') {
        const grantError = verifyEnforcedMissionGrant(contractFile.value, {
          repoIdentity,
          contractDigest: contractFile.digest,
          missionGrantVerifier: options.missionGrantVerifier,
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
      const seal = {
        schema_version: 1,
        contract_sha256: contractFile.digest,
        contract_path: contractFile.path,
        repo_identity: repoIdentity,
        mission_mode: options.missionMode,
        sealed_at: new Date().toISOString(),
      };
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
  projectMissionMode,
  repoObjectFormat,
  validateContract,
  validBoundedVerifyCommand,
  verifyEnforcedMissionGrant,
};
