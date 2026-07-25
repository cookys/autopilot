#!/usr/bin/env node
'use strict';

/**
 * check-repair-scope.js — cumulative implementation-repair scope stop-loss.
 *
 * Driven by an immutable JSON contract frozen at implementation-review intake.
 * Every check recomputes the full base_sha..HEAD diff (never sums per-round
 * deltas), so revert/re-add cannot game the counter.
 *
 * Usage:
 *   node scripts/check-repair-scope.js check --contract <path> [--repo <dir>]
 *       [--head <sha>] [--intake-contract <path>] [--json]
 *   node scripts/check-repair-scope.js seal --contract <path>
 *
 * Exit codes:
 *   0 = PASS (in-scope repair)
 *   1 = TRIP (path/new-file/churn/contract-mutation stop)
 *   2 = usage / malformed contract / git error
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HELP_TEXT = `Usage:
  node scripts/check-repair-scope.js check --contract <path> [--repo <dir>]
      [--head <sha>] [--intake-contract <path>] [--json]
  node scripts/check-repair-scope.js seal --contract <path>
  -h, --help

Contract fields (schema 1, all required; no permissive defaults):
  schema                 must be 1
  task_id                non-empty string
  base_sha               immutable task base (git object)
  implementation_sha     first reviewed implementation (git object)
  allowed_path_prefixes  string[] of repo-relative prefixes
  allowed_new_paths      string[] of globs for newly tracked paths
  baseline_churn         positive number (insertions+deletions at freeze)
  max_growth_ratio       positive number; trip when total > baseline * ratio
  max_extra_churn        positive number; trip when (total - baseline) > extra

Trip rules (any one trips automatic repair):
  1. Full base_sha..HEAD accounting (insertions+deletions; binary = path-only)
  2. total_churn > baseline_churn * max_growth_ratio
  3. (total_churn - baseline_churn) > max_extra_churn
  4. changed path outside allowed_path_prefixes
  5. newly tracked path (absent at implementation_sha) not matching allowed_new_paths
  6. path traversal / symlink-resolved escape outside repo
  7. --intake-contract differs from --contract (in-loop reset / mutation)

Exit: 0 PASS, 1 TRIP, 2 usage/contract/git error.
`;

function printUsage() {
  process.stdout.write(HELP_TEXT);
}

function usageError(message) {
  if (message) process.stderr.write(`ERROR: ${message}\n`);
  process.exit(2);
}

function isHelpToken(token) {
  return token === '-h' || token === '--help' || token === 'help';
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        options[key] = argv[++i];
      } else {
        options[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0], options };
}

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function positiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function stringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Canonical JSON for byte-stable intake comparison (sorted keys, no whitespace). */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function loadContract(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    usageError(`cannot read contract ${filePath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    usageError(`malformed contract JSON: ${err.message}`);
  }
  validateContract(parsed);
  return parsed;
}

function validateContract(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    usageError('contract must be a JSON object');
  }
  const allowed = new Set([
    'schema', 'task_id', 'base_sha', 'implementation_sha',
    'allowed_path_prefixes', 'allowed_new_paths',
    'baseline_churn', 'max_growth_ratio', 'max_extra_churn'
  ]);
  for (const key of Object.keys(c)) {
    if (!allowed.has(key)) {
      usageError(`unknown contract field: ${key}`);
    }
  }
  for (const key of allowed) {
    if (!(key in c)) {
      usageError(`missing required contract field: ${key}`);
    }
  }
  if (c.schema !== 1) {
    usageError('contract.schema must be 1');
  }
  if (!nonEmptyString(c.task_id)) usageError('task_id must be a non-empty string');
  if (!nonEmptyString(c.base_sha)) usageError('base_sha must be a non-empty string');
  if (!nonEmptyString(c.implementation_sha)) {
    usageError('implementation_sha must be a non-empty string');
  }
  if (!stringArray(c.allowed_path_prefixes) || c.allowed_path_prefixes.length === 0) {
    usageError('allowed_path_prefixes must be a non-empty string array');
  }
  if (!stringArray(c.allowed_new_paths)) {
    usageError('allowed_new_paths must be a string array (may be empty)');
  }
  if (!positiveNumber(c.baseline_churn)) {
    usageError('baseline_churn must be a positive number');
  }
  if (!positiveNumber(c.max_growth_ratio)) {
    usageError('max_growth_ratio must be a positive number');
  }
  if (!positiveNumber(c.max_extra_churn)) {
    usageError('max_extra_churn must be a positive number');
  }
  for (const p of c.allowed_path_prefixes) {
    assertSafeRepoRelative(p, 'allowed_path_prefixes entry');
  }
  for (const p of c.allowed_new_paths) {
    assertSafeRepoRelative(p, 'allowed_new_paths entry');
  }
}

function assertSafeRepoRelative(p, label) {
  if (!nonEmptyString(p)) usageError(`${label} must be non-empty`);
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) {
    usageError(`${label} must be repo-relative (got absolute): ${p}`);
  }
  const parts = p.split(/[/\\]/);
  if (parts.some((seg) => seg === '..')) {
    usageError(`${label} must not contain '..' traversal: ${p}`);
  }
}

/**
 * Glob match: single * = one path segment; ** = any depth (incl. zero).
 * Bare directory (no wildcards) owns its subtree.
 * Brace/char-class unsupported (fail closed).
 */
function globMatch(filePath, glob) {
  if (/[{}[\]]/.test(glob)) {
    return false;
  }
  let g = glob.endsWith('/') ? glob.slice(0, -1) : glob;
  let reSrc = g
    .replace(/[.[\^$()+{}|]/g, '\\$&')
    .replace(/\*\*\//g, '§DBLSLASH§')
    .replace(/\/\*\*/g, '§SLASHDBL§')
    .replace(/\*\*/g, '§DBL§')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/§DBLSLASH§/g, '(.*/)?')
    .replace(/§SLASHDBL§/g, '(/.*)?')
    .replace(/§DBL§/g, '.*');
  const re = new RegExp(`^${reSrc}$`);
  if (re.test(filePath)) return true;
  if (/[*?]/.test(g)) return false;
  const sub = new RegExp(`^${reSrc}/.*$`);
  return sub.test(filePath);
}

function pathMatchesAnyGlob(filePath, globs) {
  return globs.some((g) => globMatch(filePath, g));
}

function pathHasAllowedPrefix(filePath, prefixes) {
  for (const raw of prefixes) {
    const prefix = raw.endsWith('/') ? raw : `${raw}/`;
    if (filePath === raw.replace(/\/$/, '') || filePath.startsWith(prefix) || filePath === raw) {
      return true;
    }
    // Prefix without trailing slash matching exact file under that dir:
    if (!raw.endsWith('/') && (filePath === raw || filePath.startsWith(`${raw}/`))) {
      return true;
    }
  }
  return false;
}

function runGit(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) {
    usageError(`git failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || '').trim() || `git exit ${result.status}`;
    usageError(`git ${args.join(' ')}: ${msg}`);
  }
  return result.stdout;
}

function resolveHead(repo, headOpt) {
  if (headOpt && headOpt !== true) {
    runGit(repo, ['rev-parse', '--verify', headOpt]);
    return runGit(repo, ['rev-parse', headOpt]).trim();
  }
  return runGit(repo, ['rev-parse', 'HEAD']).trim();
}

function listTreePaths(repo, sha) {
  const out = runGit(repo, ['ls-tree', '-r', '--name-only', sha]);
  const set = new Set();
  for (const line of out.split('\n')) {
    if (line.length > 0) set.add(line);
  }
  return set;
}

/**
 * Parse numstat for base..head. Binary rows: '-' '-' path → churn 0, still listed.
 * Renames appear as path (git --numstat without -M collapses? Use --numstat -z? 
 * Standard: `git diff --numstat A B` shows renamed as old => new with -M;
 * without -M shows as delete+add. Use plain --numstat for stable accounting.
 */
function parseNumstat(repo, baseSha, headSha) {
  const out = runGit(repo, ['diff', '--numstat', `${baseSha}..${headSha}`]);
  const files = [];
  let insertions = 0;
  let deletions = 0;
  for (const line of out.split('\n')) {
    if (!line) continue;
    // Format: <ins>\t<del>\t<path>  OR with rename: <ins>\t<del>\t<old>\t<new> rare
    // Binary: -\t-\t<path>
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const insRaw = parts[0];
    const delRaw = parts[1];
    // Rename with -M: "old => new" in last field; without -M two lines.
    let filePath = parts.slice(2).join('\t');
    if (filePath.includes(' => ')) {
      // take the new path
      filePath = filePath.split(' => ').pop();
    }
    const isBinary = insRaw === '-' && delRaw === '-';
    let ins = 0;
    let del = 0;
    if (!isBinary) {
      ins = Number.parseInt(insRaw, 10) || 0;
      del = Number.parseInt(delRaw, 10) || 0;
      insertions += ins;
      deletions += del;
    }
    files.push({
      path: filePath,
      insertions: ins,
      deletions: del,
      binary: isBinary,
      churn: ins + del
    });
  }
  return { files, insertions, deletions, total_churn: insertions + deletions };
}

/**
 * Reject traversal and symlink escapes: path must be repo-relative and its
 * realpath (when present on disk at HEAD worktree) must stay inside repo root.
 * For pure git-object paths (not checked out), lexical checks suffice.
 */
function checkPathContainment(repo, filePath) {
  // Fail closed on traversal/absolute; return trip (do not process.exit — caller aggregates).
  if (!nonEmptyString(filePath)
    || filePath.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return { ok: false, reason: 'path_escape', path: filePath };
  }
  const parts = filePath.split(/[/\\]/);
  if (parts.some((seg) => seg === '..')) {
    return { ok: false, reason: 'path_escape', path: filePath };
  }

  let repoReal;
  try {
    repoReal = fs.realpathSync(repo);
  } catch {
    repoReal = path.resolve(repo);
  }
  const abs = path.resolve(repoReal, filePath);
  const rel = path.relative(repoReal, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: 'path_escape', path: filePath };
  }

  // Symlink / realpath containment when the path exists on disk.
  let lst;
  try {
    lst = fs.lstatSync(abs);
  } catch {
    return { ok: true }; // only in git objects
  }

  if (lst.isSymbolicLink()) {
    let target;
    try {
      target = fs.readlinkSync(abs);
    } catch {
      return { ok: false, reason: 'symlink_escape', path: filePath };
    }
    const resolved = path.resolve(path.dirname(abs), target);
    let realTarget = resolved;
    try {
      realTarget = fs.realpathSync(resolved);
    } catch {
      // dangling — still check lexical target
    }
    const relT = path.relative(repoReal, realTarget);
    if (relT.startsWith('..') || path.isAbsolute(relT)) {
      return { ok: false, reason: 'symlink_escape', path: filePath };
    }
  } else {
    try {
      const real = fs.realpathSync(abs);
      const relR = path.relative(repoReal, real);
      if (relR.startsWith('..') || path.isAbsolute(relR)) {
        return { ok: false, reason: 'symlink_escape', path: filePath };
      }
    } catch {
      /* ignore */
    }
  }
  return { ok: true };
}

function evaluate(contract, repo, headSha) {
  const trips = [];
  const baseSha = contract.base_sha;
  const implSha = contract.implementation_sha;

  // Verify objects exist
  runGit(repo, ['rev-parse', '--verify', baseSha]);
  runGit(repo, ['rev-parse', '--verify', implSha]);
  runGit(repo, ['rev-parse', '--verify', headSha]);

  const numstat = parseNumstat(repo, baseSha, headSha);
  const implPaths = listTreePaths(repo, implSha);

  const ratioLimit = contract.baseline_churn * contract.max_growth_ratio;
  const extra = numstat.total_churn - contract.baseline_churn;

  if (numstat.total_churn > ratioLimit) {
    trips.push({
      reason: 'ratio_trip',
      total_churn: numstat.total_churn,
      limit: ratioLimit,
      baseline_churn: contract.baseline_churn,
      max_growth_ratio: contract.max_growth_ratio
    });
  }
  if (extra > contract.max_extra_churn) {
    trips.push({
      reason: 'absolute_trip',
      total_churn: numstat.total_churn,
      added_churn: extra,
      max_extra_churn: contract.max_extra_churn,
      baseline_churn: contract.baseline_churn
    });
  }

  const pathEscapes = [];
  const prefixViolations = [];
  const newFileViolations = [];

  for (const f of numstat.files) {
    const containment = checkPathContainment(repo, f.path);
    if (!containment.ok) {
      pathEscapes.push({ path: f.path, reason: containment.reason });
      trips.push({ reason: containment.reason, path: f.path });
      continue;
    }
    if (!pathHasAllowedPrefix(f.path, contract.allowed_path_prefixes)) {
      prefixViolations.push(f.path);
      trips.push({ reason: 'path_escape', path: f.path });
      continue;
    }
    const isNew = !implPaths.has(f.path);
    if (isNew && !pathMatchesAnyGlob(f.path, contract.allowed_new_paths)) {
      newFileViolations.push(f.path);
      trips.push({ reason: 'unapproved_new_file', path: f.path });
    }
  }

  return {
    verdict: trips.length === 0 ? 'PASS' : 'TRIP',
    task_id: contract.task_id,
    base_sha: baseSha,
    implementation_sha: implSha,
    head_sha: headSha,
    total_churn: numstat.total_churn,
    insertions: numstat.insertions,
    deletions: numstat.deletions,
    baseline_churn: contract.baseline_churn,
    max_growth_ratio: contract.max_growth_ratio,
    max_extra_churn: contract.max_extra_churn,
    ratio_limit: ratioLimit,
    added_churn: extra,
    changed_files: numstat.files.map((f) => f.path),
    trips,
    path_escapes: pathEscapes,
    prefix_violations: prefixViolations,
    new_file_violations: newFileViolations
  };
}

function contractsEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printUsage();
    process.exit(2);
  }
  if (isHelpToken(argv[0])) {
    printUsage();
    process.exit(0);
  }

  const { command, options } = parseArgs(argv);
  if (!command) usageError('No subcommand specified (check|seal)');

  if (command === 'seal') {
    if (!options.contract || options.contract === true) {
      usageError('--contract <path> is required');
    }
    const c = loadContract(options.contract);
    const digest = crypto.createHash('sha256').update(canonicalJson(c)).digest('hex');
    process.stdout.write(JSON.stringify({ seal: digest, contract: options.contract }) + '\n');
    process.exit(0);
  }

  if (command !== 'check') {
    usageError(`Unknown subcommand: ${command}`);
  }

  if (!options.contract || options.contract === true) {
    usageError('--contract <path> is required');
  }

  const contractPath = path.resolve(options.contract);
  const contract = loadContract(contractPath);

  if (options['intake-contract'] && options['intake-contract'] !== true) {
    const intake = loadContract(path.resolve(options['intake-contract']));
    if (!contractsEqual(contract, intake)) {
      const result = {
        verdict: 'TRIP',
        reason: 'contract_mutated',
        trips: [{ reason: 'contract_mutated' }],
        message: 'contract differs from intake freeze; in-loop reset is forbidden'
      };
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(1);
    }
  }

  const repo = options.repo && options.repo !== true
    ? path.resolve(options.repo)
    : process.cwd();
  if (!fs.existsSync(path.join(repo, '.git')) && !fs.existsSync(repo)) {
    usageError(`repo not found: ${repo}`);
  }
  // Accept bare .git files (worktrees) via rev-parse
  try {
    runGit(repo, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    usageError(`not a git repo: ${repo}`);
  }

  const headSha = resolveHead(repo, options.head);
  const result = evaluate(contract, repo, headSha);

  if (options.json || true) {
    // Always emit JSON (machine-checkable); --json kept for API symmetry.
    process.stdout.write(JSON.stringify(result) + '\n');
  }

  process.exit(result.verdict === 'PASS' ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  canonicalJson,
  globMatch,
  pathHasAllowedPrefix,
  pathMatchesAnyGlob,
  validateContract,
  parseNumstat,
  evaluate,
  contractsEqual
};
