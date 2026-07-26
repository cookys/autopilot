#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_CONTRACT_BYTES = 1024 * 1024;
const CONTRACT_FIELDS = new Set([
  'schema_version',
  'ticket',
  'profile',
  'mission_grant_ref',
  'repo_identity',
  'base_sha',
  'branch',
  'vertical_acceptance',
  'allowed_path_prefixes',
  'max_changed_files',
  'baseline_churn',
  'max_growth_ratio',
  'max_extra_churn',
  'max_repair_generations',
  'max_wall_seconds',
  'verify_cmd',
  'rubric_ids',
]);
const PROFILE_REPAIR_CEILINGS = Object.freeze({
  spike: 1,
  poc: 2,
  'internal-pilot': 5,
  production: 5,
});

class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function usage() {
  return `Usage:
  node scripts/implementation-campaign-check.js seal \\
    --contract <file> --repo <git-repo> --out <seal-file>
  node scripts/implementation-campaign-check.js check \\
    --contract <file> --repo <git-repo> --seal <seal-file>

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
  for (const key of ['contract', 'repo']) {
    if (!options[key]) throw new CliError(`--${key} is required`);
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

function normalizeAllowedPrefix(value) {
  if (!nonEmptyString(value) || value.includes('\\') || value.includes('\0')) return null;
  if (path.posix.isAbsolute(value) || value.startsWith('./')) return null;
  const withoutTrailing = value.endsWith('/') ? value.slice(0, -1) : value;
  if (!withoutTrailing || withoutTrailing.includes('//')) return null;
  const parts = withoutTrailing.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  if (parts[0] === '.git') return null;
  return parts.join('/');
}

function validateContract(contract, context) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return ['contract: expected object'];
  }
  for (const key of Object.keys(contract)) {
    if (!CONTRACT_FIELDS.has(key)) errors.push(`contract: unknown field '${key}'`);
  }
  for (const key of CONTRACT_FIELDS) {
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
  if (contract.repo_identity !== context.repoIdentity) {
    errors.push('repo_identity: does not match canonical repository identity');
  }
  if (typeof contract.base_sha !== 'string'
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(contract.base_sha)) {
    errors.push('base_sha: expected full lowercase Git object ID');
  } else {
    const commit = runGit(context.repo, ['cat-file', '-e', `${contract.base_sha}^{commit}`]);
    if (commit.status !== 0) errors.push('base_sha: commit does not exist in repository');
  }
  if (!nonEmptyString(contract.branch) || contract.branch.length > 255) {
    errors.push('branch: expected non-empty branch name');
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
  requireInteger(contract.max_changed_files, 'max_changed_files', 1, Number.MAX_SAFE_INTEGER, errors);
  requireInteger(contract.baseline_churn, 'baseline_churn', 1, Number.MAX_SAFE_INTEGER, errors);
  if (typeof contract.max_growth_ratio !== 'number'
      || !Number.isFinite(contract.max_growth_ratio)
      || contract.max_growth_ratio < 1
      || contract.max_growth_ratio > 1.5) {
    errors.push('max_growth_ratio: expected finite number in 1..1.5');
  }
  requireInteger(contract.max_extra_churn, 'max_extra_churn', 0, Number.MAX_SAFE_INTEGER, errors);
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
  requireInteger(contract.max_repair_generations, 'max_repair_generations', 0, 5, errors);
  if (hasOwn(PROFILE_REPAIR_CEILINGS, contract.profile)
      && Number.isSafeInteger(contract.max_repair_generations)
      && contract.max_repair_generations > PROFILE_REPAIR_CEILINGS[contract.profile]) {
    errors.push(
      `max_repair_generations: exceeds ${contract.profile} ceiling `
      + `${PROFILE_REPAIR_CEILINGS[contract.profile]}`,
    );
  }
  requireInteger(contract.max_wall_seconds, 'max_wall_seconds', 1, 7200, errors);
  if (!nonEmptyString(contract.verify_cmd) || contract.verify_cmd.length > 4096) {
    errors.push('verify_cmd: expected trimmed non-empty string up to 4096 characters');
  }
  validateUniqueStrings(contract.rubric_ids, 'rubric_ids', {
    minimum: 1,
    maximum: 128,
    maxLength: 128,
    pattern: /^[A-Za-z][A-Za-z0-9_-]*[0-9]+$/,
  }, errors);
  return errors;
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
  try {
    fs.writeFileSync(temp, bytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, target);
  } finally {
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
      || typeof value.sealed_at !== 'string'
      || !Number.isFinite(Date.parse(value.sealed_at))) {
    throw new CliError('seal file has invalid field values', 3);
  }
  return value;
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
    const contractFile = loadContract(options.contract);
    const errors = validateContract(contractFile.value, { repo, repoIdentity });
    if (errors.length > 0) {
      emit({
        verdict: 'REJECTED',
        contract_sha256: contractFile.digest,
        errors,
      }, 3);
    }

    if (options.command === 'seal') {
      const output = resolveOutputPath(options.out, contractFile);
      const seal = {
        schema_version: 1,
        contract_sha256: contractFile.digest,
        contract_path: contractFile.path,
        repo_identity: repoIdentity,
        sealed_at: new Date().toISOString(),
      };
      atomicWriteJson(output, seal);
      emit({
        verdict: 'SEALED',
        contract_sha256: contractFile.digest,
        seal_path: output,
      }, 0);
    }

    const seal = loadSeal(options.seal, contractFile);
    const drift = [];
    if (seal.contract_sha256 !== contractFile.digest) drift.push('contract_sha256');
    if (seal.contract_path !== contractFile.path) drift.push('contract_path');
    if (seal.repo_identity !== repoIdentity) drift.push('repo_identity');
    if (drift.length > 0) {
      emit({
        verdict: 'DRIFT',
        contract_sha256: contractFile.digest,
        sealed_sha256: seal.contract_sha256,
        drift,
      }, 3);
    }
    emit({
      verdict: 'VALID',
      contract_sha256: contractFile.digest,
      sealed_sha256: seal.contract_sha256,
      repo_identity: repoIdentity,
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
  normalizeAllowedPrefix,
  validateContract,
};
