#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RECEIPT_KEYS = [
  'artifact_type',
  'blockers',
  'branch_inventory_digest',
  'branches',
  'disposition_digest',
  'issued_at',
  'journal_digest',
  'observed_head',
  'owned_worktrees',
  'receipt_digest',
  'repo_identity',
  'root_run_id',
  'schema_version',
  'worktree_observation_digest',
  'zero_residue',
];

class LifecycleError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function digest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function usage() {
  return `Usage:
  node scripts/lifecycle-residue-receipt.js issue --repo <dir> --root-run-id <id> \\
    --worktree-result <json> [--branch-result <json>] --out <json>
  node scripts/lifecycle-residue-receipt.js check --repo <dir> --root-run-id <id> \\
    --receipt <json>`;
}

function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const command = argv[0];
  if (!new Set(['issue', 'check']).has(command)) throw new LifecycleError('unknown command');
  const options = { command };
  const flags = new Map([
    ['--repo', 'repo'],
    ['--root-run-id', 'rootRunId'],
    ['--worktree-result', 'worktreeResult'],
    ['--branch-result', 'branchResult'],
    ['--out', 'out'],
    ['--receipt', 'receipt'],
  ]);
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const key = flags.get(flag);
    const value = argv[index + 1];
    if (!key || !value || value.startsWith('--')) {
      throw new LifecycleError(`invalid or incomplete argument: ${flag || '<empty>'}`);
    }
    if (options[key]) throw new LifecycleError(`duplicate argument: ${flag}`);
    options[key] = value;
  }
  if (!options.repo) throw new LifecycleError('--repo is required');
  if (command === 'issue') {
    for (const [key, flag] of [
      ['rootRunId', '--root-run-id'],
      ['worktreeResult', '--worktree-result'],
      ['out', '--out'],
    ]) {
      if (!options[key]) throw new LifecycleError(`${flag} is required`);
    }
  } else if (!options.receipt) {
    throw new LifecycleError('--receipt is required');
  } else if (!options.rootRunId) {
    throw new LifecycleError('--root-run-id is required');
  }
  return options;
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw new LifecycleError(`${label} failed to start: ${result.error.message}`);
  return result;
}

function git(repo, args, label = 'git') {
  const result = run('git', ['-C', repo, ...args], label);
  if (result.status !== 0) {
    throw new LifecycleError(`${label} failed: ${(result.stderr || '').trim()}`);
  }
  return result.stdout.trim();
}

function repoContext(rawRepo) {
  let repo;
  try {
    repo = fs.realpathSync(rawRepo);
  } catch {
    throw new LifecycleError(`repository is not readable: ${rawRepo}`);
  }
  const rawCommon = git(repo, ['rev-parse', '--git-common-dir'], 'git common-dir');
  const commonCandidate = path.isAbsolute(rawCommon) ? rawCommon : path.resolve(repo, rawCommon);
  let common;
  try {
    common = fs.realpathSync(commonCandidate);
  } catch {
    throw new LifecycleError(`cannot canonicalize git common directory: ${commonCandidate}`);
  }
  return {
    repo,
    common,
    identity: `git-common-dir:${common}`,
    head: git(repo, ['rev-parse', 'HEAD'], 'git HEAD'),
    objectFormat: git(repo, ['rev-parse', '--show-object-format'], 'git object format'),
  };
}

function readJson(file, label) {
  let canonical;
  try {
    canonical = fs.realpathSync(file);
    const stat = fs.statSync(canonical);
    if (!stat.isFile()) throw new Error('not a regular file');
    return JSON.parse(fs.readFileSync(canonical, 'utf8'));
  } catch (error) {
    throw new LifecycleError(`${label} is invalid: ${error.message}`);
  }
}

function scanWorktrees(context, rootRunId) {
  const script = path.join(__dirname, 'reap-dispatch-worktrees.sh');
  const result = run(script, [
    'scan',
    '--repo', context.repo,
    '--root-run-id', rootRunId,
  ], 'worktree lifecycle scan');
  if (result.status !== 0) {
    throw new LifecycleError(`worktree lifecycle scan failed: ${(result.stderr || '').trim()}`);
  }
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch (error) {
    throw new LifecycleError(`worktree lifecycle scan returned invalid JSON: ${error.message}`);
  }
  if (value.git_common_dir !== context.common || value.root_run_id !== rootRunId) {
    throw new LifecycleError('worktree lifecycle scan identity mismatch');
  }
  return value;
}

function journalState(context, rootRunId) {
  const directory = path.join(context.common, 'autopilot-worktree-branch-inventory');
  if (!fs.existsSync(directory)) return { digest: digest([]), branches: [] };
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new LifecycleError('branch inventory journal is not a safe directory');
  }
  const rows = [];
  for (const name of fs.readdirSync(directory).sort()) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const file = path.join(directory, name);
    const fileStat = fs.lstatSync(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new LifecycleError('branch inventory journal contains an unsafe record');
    }
    const value = readJson(file, 'branch inventory journal record');
    if (value.root_run_id === rootRunId) rows.push({ name, value });
  }
  const unique = new Map();
  for (const { name, value } of rows) {
    if (Object.keys(value).sort().join(',')
          !== 'branch,captured_at,marker_sha256,path,root_run_id,schema,tip'
        || value.schema !== 1
        || typeof value.branch !== 'string'
        || /[\u0000-\u001f\u007f]/u.test(value.branch)
        || typeof value.path !== 'string' || !path.isAbsolute(value.path)
        || /\u0000/u.test(value.path)
        || !/^[0-9a-f]{40,64}$/.test(value.tip)
        || !/^[0-9a-f]{64}$/.test(value.marker_sha256)
        || !Number.isSafeInteger(value.captured_at) || value.captured_at < 1) {
      throw new LifecycleError('branch inventory journal record has invalid branch identity');
    }
    const expectedName = `${crypto.createHash('sha256')
      .update(`${rootRunId}\0${value.path}\0${value.branch}\0${value.tip}\0`)
      .digest('hex')}.json`;
    if (name !== expectedName) {
      throw new LifecycleError('branch inventory journal filename does not bind its content');
    }
    if (unique.has(value.branch)) {
      throw new LifecycleError('branch inventory journal contains a duplicate branch identity');
    }
    unique.set(value.branch, value.tip);
  }
  const branches = [...unique.entries()]
    .map(([name, tip]) => ({ name, tip }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return { digest: digest(rows.map((row) => row.value)), branches };
}

function dispositionState(context, rootRunId) {
  const directory = path.join(context.common, 'autopilot-branch-dispositions');
  if (!fs.existsSync(directory)) return { digest: digest([]), branches: [] };
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new LifecycleError('branch disposition journal is not a safe directory');
  }
  const rows = [];
  const seen = new Set();
  for (const name of fs.readdirSync(directory).sort()) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const file = path.join(directory, name);
    const fileStat = fs.lstatSync(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new LifecycleError('branch disposition journal contains an unsafe record');
    }
    const value = readJson(file, 'branch disposition journal record');
    if (value.root_run_id !== rootRunId) continue;
    if (Object.keys(value).sort().join(',')
          !== 'acknowledged,branch,bundle,disposition,inventory_digest,recorded_at,repo_identity,root_run_id,schema,tip'
        || value.schema !== 1 || value.repo_identity !== context.identity
        || typeof value.branch !== 'string'
        || !/^[0-9a-f]{40,64}$/.test(value.tip)
        || !new Set(['reaped', 'preserved', 'failed']).has(value.disposition)
        || typeof value.acknowledged !== 'boolean'
        || (value.disposition !== 'preserved' && value.acknowledged)
        || !(value.bundle === null || typeof value.bundle === 'string')
        || !/^[0-9a-f]{64}$/.test(value.inventory_digest)
        || !Number.isSafeInteger(value.recorded_at) || value.recorded_at < 1
        || seen.has(value.branch)) {
      throw new LifecycleError('branch disposition journal record is invalid');
    }
    const expectedName = `${crypto.createHash('sha256')
      .update(`${rootRunId}\0${value.branch}\0${value.tip}\0`)
      .digest('hex')}.json`;
    if (name !== expectedName) {
      throw new LifecycleError('branch disposition journal filename does not bind its content');
    }
    seen.add(value.branch);
    rows.push(value);
  }
  const branches = rows.map((value) => ({
    name: value.branch,
    tip: value.tip,
    disposition: value.disposition,
    bundle: value.bundle,
    acknowledged: value.acknowledged,
  })).sort((left, right) => left.name.localeCompare(right.name));
  return { digest: digest(rows), branches };
}

function exactInventory(worktreeResult, context, rootRunId) {
  if (!worktreeResult || worktreeResult.schema !== 1
      || worktreeResult.git_common_dir !== context.common
      || worktreeResult.root_run_id !== rootRunId
      || (!Array.isArray(worktreeResult.journal_branch_inventory)
          && !Array.isArray(worktreeResult.branch_inventory))) {
    throw new LifecycleError('worktree result identity or branch inventory is invalid');
  }
  const source = Array.isArray(worktreeResult.journal_branch_inventory)
    ? worktreeResult.journal_branch_inventory
    : worktreeResult.branch_inventory;
  const seen = new Set();
  return source.map((item) => {
    if (!item || typeof item.branch !== 'string'
        || !/^[0-9a-f]{40,64}$/.test(item.tip)
        || seen.has(item.branch)) {
      throw new LifecycleError('worktree result contains malformed or duplicate branch inventory');
    }
    seen.add(item.branch);
    return { name: item.branch, tip: item.tip };
  });
}

function validateBranchResult(raw, inventory, context, rootRunId) {
  if (inventory.length === 0) {
    if (raw === null) return [];
  }
  if (!raw || raw.repo_identity !== context.identity
      || raw.root_run_id !== rootRunId
      || !Array.isArray(raw.inventory_dispositions)) {
    throw new LifecycleError('branch result identity or dispositions are invalid');
  }
  const expectedDigest = digest({
    repo_identity: context.identity,
    root_run_id: rootRunId,
    branches: inventory,
  });
  if (raw.inventory_digest !== expectedDigest) {
    throw new LifecycleError('branch result inventory digest does not match worktree inventory');
  }
  const expected = new Map(inventory.map((item) => [item.name, item.tip]));
  const seen = new Set();
  const output = raw.inventory_dispositions.map((item) => {
    if (!item
        || Object.keys(item).sort().join(',') !== 'acknowledged,bundle,disposition,name,tip'
        || !expected.has(item.name) || seen.has(item.name)
        || item.tip !== expected.get(item.name)
        || !new Set(['reaped', 'preserved', 'failed']).has(item.disposition)
        || !(item.bundle === null || typeof item.bundle === 'string')
        || typeof item.acknowledged !== 'boolean'
        || (item.disposition !== 'preserved' && item.acknowledged)) {
      throw new LifecycleError('branch result contains an invalid exact disposition');
    }
    seen.add(item.name);
    return {
      name: item.name,
      tip: item.tip,
      disposition: item.disposition,
      bundle: item.bundle,
      acknowledged: item.acknowledged,
    };
  });
  if (seen.size !== expected.size) {
    throw new LifecycleError('branch result omits an exact inventory entry');
  }
  return output;
}

function branchExistsAt(context, name, tip) {
  const ref = `refs/heads/${name}`;
  const symbolic = run('git', [
    '--git-dir', context.common,
    'symbolic-ref', '-q', ref,
  ], 'symbolic branch lookup');
  if (symbolic.status === 0) return false;
  const result = run('git', [
    '--git-dir', context.common,
    'rev-parse', '--verify', '--quiet', ref,
  ], 'branch lookup');
  return result.status === 0 && result.stdout.trim() === tip;
}

function branchRefExists(context, name) {
  const ref = `refs/heads/${name}`;
  const direct = run('git', [
    '--git-dir', context.common,
    'show-ref', '--verify', '--quiet', ref,
  ], 'branch existence lookup');
  if (direct.status === 0) return true;
  const symbolic = run('git', [
    '--git-dir', context.common,
    'symbolic-ref', '-q', ref,
  ], 'symbolic branch existence lookup');
  return symbolic.status === 0;
}

function verifyBundle(context, branch) {
  if (typeof branch.bundle !== 'string') return false;
  let bundle;
  try {
    bundle = fs.realpathSync(branch.bundle);
    if (!fs.statSync(bundle).isFile()) return false;
  } catch {
    return false;
  }
  const verify = run('git', ['-C', context.repo, 'bundle', 'verify', bundle], 'bundle verify');
  if (verify.status !== 0) return false;
  const heads = run('git', ['-C', context.repo, 'bundle', 'list-heads', bundle], 'bundle heads');
  if (heads.status !== 0) return false;
  if (!heads.stdout.split('\n').some(
    (line) => line === `${branch.tip} refs/heads/${branch.name}`,
  )) return false;
  const emptyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-bundle-verify-'));
  try {
    const init = run('git', [
      'init', '--bare', '-q', `--object-format=${context.objectFormat}`, emptyRepo,
    ], 'empty bundle verifier');
    if (init.status !== 0) return false;
    const unbundle = run('git', [
      '--git-dir', emptyRepo,
      'bundle', 'unbundle', bundle,
    ], 'standalone bundle verification');
    return unbundle.status === 0;
  } finally {
    fs.rmSync(emptyRepo, { recursive: true, force: true });
  }
}

function worktreeBlockers(scan) {
  const blockers = [];
  const kindForState = {
    dirty: 'dirty_worktree',
    live: 'live_worktree',
    lock_unsupported: 'unsupported_worktree',
    status_unsupported: 'unsupported_worktree',
    malformed: 'unknown_worktree',
    raced: 'raced_worktree',
  };
  for (const item of scan.owned || []) {
    blockers.push({
      kind: kindForState[item.state] || 'owned_worktree',
      subject: item.path,
      reason: item.reason,
      instruction: item.state === 'live'
        ? 'stop_owner_then_reap'
        : 'preserve_or_clean_then_reap',
    });
  }
  for (const item of scan.pending_creation || []) {
    blockers.push({
      kind: 'pending_creation',
      subject: item.path,
      reason: 'unresolved_pending_creation',
      instruction: 'reconcile_pending_creation',
    });
  }
  for (const item of scan.legacy || []) {
    blockers.push({
      kind: 'unknown_worktree',
      subject: item.path,
      reason: item.reason,
      instruction: 'inspect_and_handoff',
    });
  }
  const knownSubjects = new Set(blockers.map((item) => item.subject));
  for (const item of scan.malformed || []) {
    if (knownSubjects.has(item.path)) continue;
    blockers.push({
      kind: 'unknown_worktree',
      subject: item.path,
      reason: item.reason,
      instruction: 'inspect_and_handoff',
    });
    knownSubjects.add(item.path);
  }
  return blockers;
}

function branchBlockers(context, branches) {
  const blockers = [];
  for (const branch of branches) {
    if (branch.disposition === 'reaped') {
      if (branchRefExists(context, branch.name) || !verifyBundle(context, branch)) {
        blockers.push({
          kind: 'branch_disposition_invalid',
          subject: `refs/heads/${branch.name}`,
          reason: 'reaped_branch_or_bundle_drift',
          instruction: 'restore_or_reconcile_bundle',
        });
      }
    } else if (!branch.acknowledged || !branchExistsAt(context, branch.name, branch.tip)) {
      const exact = branchExistsAt(context, branch.name, branch.tip);
      blockers.push({
        kind: 'branch_disposition_pending',
        subject: `refs/heads/${branch.name}`,
        reason: exact ? branch.disposition : 'branch_tip_drift',
        instruction: 'integrate_or_ack_exact_tip',
      });
    }
  }
  return blockers;
}

function currentHead(context) {
  return git(context.repo, ['rev-parse', 'HEAD'], 'git HEAD');
}

function branchObservation(context, branches) {
  return branches.map((branch) => {
    const ref = `refs/heads/${branch.name}`;
    const symbolic = run('git', [
      '--git-dir', context.common,
      'symbolic-ref', '-q', ref,
    ], 'branch observation');
    let refState = 'missing';
    if (symbolic.status === 0) {
      refState = `symbolic:${symbolic.stdout.trim()}`;
    } else {
      const direct = run('git', [
        '--git-dir', context.common,
        'rev-parse', '--verify', '--quiet', ref,
      ], 'branch observation');
      if (direct.status === 0) refState = `direct:${direct.stdout.trim()}`;
    }
    let bundleDigest = null;
    if (typeof branch.bundle === 'string') {
      try {
        bundleDigest = crypto.createHash('sha256')
          .update(fs.readFileSync(fs.realpathSync(branch.bundle)))
          .digest('hex');
      } catch {
        bundleDigest = 'unreadable';
      }
    }
    return { name: branch.name, ref_state: refState, bundle_digest: bundleDigest };
  });
}

function observeLifecycle(context, rootRunId, branches) {
  const scan = scanWorktrees(context, rootRunId);
  const journal = journalState(context, rootRunId);
  const dispositions = dispositionState(context, rootRunId);
  const observation = {
    head: currentHead(context),
    scan_digest: digest(scan),
    journal_digest: journal.digest,
    disposition_digest: dispositions.digest,
    branches: branchObservation(context, branches),
  };
  return {
    scan,
    journal,
    dispositions,
    observation,
    observationDigest: digest(observation),
  };
}

function receiptMaterial(receipt) {
  const { receipt_digest: ignored, ...material } = receipt;
  return material;
}

function validReceiptShape(receipt) {
  const isDigest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  const isOid = (value) => typeof value === 'string' && /^[0-9a-f]{40,64}$/.test(value);
  return Boolean(receipt)
    && typeof receipt === 'object'
    && !Array.isArray(receipt)
    && Object.keys(receipt).sort().join(',') === RECEIPT_KEYS.join(',')
    && Number.isInteger(receipt.schema_version)
    && typeof receipt.issued_at === 'string'
    && typeof receipt.repo_identity === 'string'
    && isOid(receipt.observed_head)
    && isDigest(receipt.worktree_observation_digest)
    && isDigest(receipt.journal_digest)
    && isDigest(receipt.disposition_digest)
    && isDigest(receipt.branch_inventory_digest)
    && isDigest(receipt.receipt_digest)
    && typeof receipt.zero_residue === 'boolean'
    && Array.isArray(receipt.owned_worktrees)
    && Array.isArray(receipt.branches)
    && receipt.branches.every((item) => (
      item && Object.keys(item).sort().join(',')
        === 'acknowledged,bundle,disposition,name,tip'
      && typeof item.name === 'string'
      && !/[\u0000-\u001f\u007f]/u.test(item.name)
      && isOid(item.tip)
      && new Set(['reaped', 'preserved', 'failed']).has(item.disposition)
      && (item.bundle === null || typeof item.bundle === 'string')
      && typeof item.acknowledged === 'boolean'
      && (item.disposition === 'preserved' || !item.acknowledged)
    ))
    && Array.isArray(receipt.blockers)
    && receipt.blockers.every((item) => (
      item && Object.keys(item).sort().join(',') === 'instruction,kind,reason,subject'
      && ['instruction', 'kind', 'reason', 'subject'].every(
        (key) => typeof item[key] === 'string' && item[key].length !== 0,
      )
    ));
}

function writeAtomic(file, value) {
  const target = path.resolve(file);
  const parent = path.dirname(target);
  const parentReal = fs.realpathSync(parent);
  const resolvedTarget = path.join(parentReal, path.basename(target));
  if (fs.existsSync(resolvedTarget) && fs.lstatSync(resolvedTarget).isSymbolicLink()) {
    throw new LifecycleError('receipt output must not be a symlink');
  }
  const temporary = `${resolvedTarget}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, resolvedTarget);
}

function issue(options) {
  if (!/^[A-Za-z0-9._-]+$/.test(options.rootRunId)) {
    throw new LifecycleError('--root-run-id has invalid grammar');
  }
  const context = repoContext(options.repo);
  const worktreeResult = readJson(options.worktreeResult, 'worktree result');
  const inventory = exactInventory(worktreeResult, context, options.rootRunId);
  const rawBranch = options.branchResult
    ? readJson(options.branchResult, 'branch result')
    : null;
  const rawBranches = validateBranchResult(
    rawBranch,
    inventory,
    context,
    options.rootRunId,
  );
  const journalAtIssue = journalState(context, options.rootRunId);
  const dispositionsAtIssue = dispositionState(context, options.rootRunId);
  const journalIndex = new Map(
    journalAtIssue.branches.map((item) => [item.name, item.tip]),
  );
  if (inventory.length !== 0 && journalIndex.size === 0) {
    throw new LifecycleError(
      'nonempty branch inventory has no canonical journal provenance',
    );
  }
  for (const item of inventory) {
    if (journalIndex.get(item.name) !== item.tip) {
      throw new LifecycleError(
        'worktree result omits or changes canonical branch inventory journal entries',
      );
    }
  }
  let branches = rawBranches;
  if (journalAtIssue.branches.length !== dispositionsAtIssue.branches.length) {
    throw new LifecycleError(
      'branch disposition journal does not exactly cover canonical inventory',
    );
  }
  if (journalAtIssue.branches.length !== 0) {
    const dispositionIndex = new Map(
      dispositionsAtIssue.branches.map((item) => [item.name, item]),
    );
    if (journalAtIssue.branches.some(
      (item) => dispositionIndex.get(item.name)?.tip !== item.tip,
    )) {
      throw new LifecycleError('exact branch inventory has an unresolved disposition');
    }
    branches = journalAtIssue.branches.map(
      (item) => dispositionIndex.get(item.name),
    );
  }
  const branchesByName = new Map(branches.map((item) => [item.name, item]));
  for (const item of rawBranches) {
    if (digest(branchesByName.get(item.name)) !== digest(item)) {
      throw new LifecycleError('branch result differs from durable disposition journal');
    }
  }
  const first = observeLifecycle(context, options.rootRunId, branches);
  const blockers = [
    ...worktreeBlockers(first.scan),
    ...branchBlockers(context, branches),
  ];
  const second = observeLifecycle(context, options.rootRunId, branches);
  if (first.observationDigest !== second.observationDigest) {
    throw new LifecycleError('lifecycle state changed during receipt issuance; retry');
  }
  const selectedInventory = branches.map(
    ({ name, tip }) => ({ name, tip }),
  );
  if (digest(selectedInventory) !== digest(second.journal.branches)
      || digest(branches) !== digest(second.dispositions.branches)) {
    throw new LifecycleError(
      'canonical branch inventory changed before receipt publication; retry',
    );
  }
  const { scan } = second;
  const receipt = {
    schema_version: 1,
    artifact_type: 'lifecycle_residue_receipt',
    issued_at: new Date().toISOString(),
    repo_identity: context.identity,
    root_run_id: options.rootRunId,
    observed_head: second.observation.head,
    worktree_observation_digest: digest(scan),
    journal_digest: second.journal.digest,
    disposition_digest: second.dispositions.digest,
    branch_inventory_digest: digest(selectedInventory),
    owned_worktrees: scan.owned || [],
    branches,
    blockers,
    zero_residue: blockers.length === 0,
    receipt_digest: '',
  };
  receipt.receipt_digest = digest(receiptMaterial(receipt));
  writeAtomic(options.out, receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function inspectLifecycleReceipt(options) {
  const context = repoContext(options.repo);
  const receipt = readJson(options.receipt, 'lifecycle receipt');
  if (!validReceiptShape(receipt) || receipt.schema_version !== 1
      || receipt.artifact_type !== 'lifecycle_residue_receipt'
      || receipt.repo_identity !== context.identity
      || receipt.root_run_id !== options.rootRunId
      || !/^[A-Za-z0-9._-]+$/.test(receipt.root_run_id)
      || !Array.isArray(receipt.branches)
      || !Array.isArray(receipt.blockers)
      || receipt.receipt_digest !== digest(receiptMaterial(receipt))) {
    throw new LifecycleError('lifecycle receipt is malformed or has an invalid digest', 1);
  }
  const first = observeLifecycle(context, receipt.root_run_id, receipt.branches);
  const currentBlockers = [
    ...worktreeBlockers(first.scan),
    ...branchBlockers(context, receipt.branches),
  ];
  const second = observeLifecycle(context, receipt.root_run_id, receipt.branches);
  if (first.observationDigest !== second.observationDigest) {
    return { status: 'stale', drift: ['concurrent_lifecycle_drift'] };
  }
  const { scan } = second;
  const drift = [];
  if (receipt.observed_head !== second.observation.head) drift.push('observed_head');
  if (receipt.worktree_observation_digest !== digest(scan)) drift.push('worktree_inventory');
  if (receipt.journal_digest !== second.journal.digest) {
    drift.push('branch_inventory_journal');
  }
  if (receipt.disposition_digest !== second.dispositions.digest) {
    drift.push('branch_disposition_journal');
  }
  const receiptInventory = receipt.branches.map(
    ({ name, tip }) => ({ name, tip }),
  );
  const externalInventory = second.journal.branches;
  if (digest(receiptInventory) !== digest(externalInventory)
      || receipt.branch_inventory_digest !== digest(externalInventory)) {
    drift.push('branch_inventory_digest');
  }
  if (second.dispositions.branches.length !== 0
      && digest(receipt.branches) !== digest(second.dispositions.branches)) {
    drift.push('branch_disposition_evidence');
  }
  if (digest(receipt.owned_worktrees) !== digest(scan.owned || [])) {
    drift.push('owned_worktrees');
  }
  if (digest(receipt.blockers) !== digest(currentBlockers)
      || receipt.zero_residue !== (currentBlockers.length === 0)) {
    drift.push('residue_semantics');
  }
  if (drift.length !== 0) {
    return { status: 'stale', drift };
  }
  // Authenticated current scan + dispositions are already bound above.
  // Expose active-owned counts for LSM without re-scanning or name inference.
  const activeOwnedWorktrees = Array.isArray(scan.owned) ? scan.owned.length : 0;
  const activeOwnedBranches = receipt.branches.filter(
    (branch) => branch && branch.disposition !== 'reaped',
  ).length;
  return {
    status: 'valid',
    zero_residue: receipt.zero_residue,
    receipt_digest: receipt.receipt_digest,
    active_owned_worktrees: activeOwnedWorktrees,
    active_owned_branches: activeOwnedBranches,
  };
}

function check(options) {
  const result = inspectLifecycleReceipt(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'valid') process.exitCode = 1;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === 'issue') issue(options);
    else check(options);
  } catch (error) {
    process.stderr.write(`LIFECYCLE_RECEIPT_ERROR: ${error.message}\n`);
    process.exitCode = error.exitCode || 2;
  }
}

if (require.main === module) main();

module.exports = {
  inspectLifecycleReceipt,
};
