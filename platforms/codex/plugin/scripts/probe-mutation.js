#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');
const crypto = require('crypto');
const child_process = require('child_process');

const HELP_TEXT = `Usage:
  node scripts/probe-mutation.js --repo <git-repo> --ref <sha|HEAD> --probe <cmd> --mutate <cmd> [--json]
`;

function usage() {
  process.stderr.write(HELP_TEXT);
  process.exit(2);
}

// Parse command line arguments
const argv = process.argv.slice(2);
const options = {};

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--json') {
    options.json = true;
  } else if (arg === '--repo') {
    if (i + 1 >= argv.length) usage();
    options.repo = argv[++i];
  } else if (arg === '--ref') {
    if (i + 1 >= argv.length) usage();
    options.ref = argv[++i];
  } else if (arg === '--probe') {
    if (i + 1 >= argv.length) usage();
    options.probe = argv[++i];
  } else if (arg === '--mutate') {
    if (i + 1 >= argv.length) usage();
    options.mutate = argv[++i];
  } else {
    usage();
  }
}

if (!options.repo || !options.ref || !options.probe || !options.mutate) {
  usage();
}

// Validate repo path
const repoPath = path.resolve(options.repo);
if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
  process.stderr.write(`ERROR: Invalid repo directory: ${options.repo}\n`);
  process.exit(2);
}

// Verify ref
const refCheck = child_process.spawnSync('git', ['-C', repoPath, 'rev-parse', '--verify', options.ref], { encoding: 'utf8' });
if (refCheck.status !== 0) {
  process.stderr.write(`ERROR: Invalid ref: ${options.ref}\n`);
  process.exit(2);
}

// Global state for cleanup
let worktreePath = null;

function cleanup() {
  if (worktreePath) {
    try {
      child_process.spawnSync('git', [
        '-C', repoPath,
        'worktree', 'remove',
        '--force',
        worktreePath
      ], { stdio: 'ignore' });
    } catch (e) {}
    try {
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    } catch (e) {}
    worktreePath = null;
  }
}

// Register exit traps
process.on('exit', () => {
  cleanup();
});

const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
signals.forEach((sig) => {
  process.on(sig, () => {
    cleanup();
    process.exit(128 + (sig === 'SIGINT' ? 2 : sig === 'SIGTERM' ? 15 : 1));
  });
});

function failWithStatus(status, exitCode, message, extra = {}) {
  const output = { status, ...extra };
  if (options.json) {
    process.stdout.write(JSON.stringify(output) + '\n');
  } else {
    process.stderr.write(`ERROR [${status}]: ${message}\n`);
  }
  process.exit(exitCode);
}

// Setup timeout
const defaultTimeout = 120 * 1000; // 120s
const envTimeout = process.env.PROBE_TIMEOUT ? parseInt(process.env.PROBE_TIMEOUT, 10) : null;
const timeoutMs = (envTimeout && !isNaN(envTimeout)) ? envTimeout * 1000 : defaultTimeout;

function runInWorktree(cmd, timeoutMs) {
  const result = child_process.spawnSync('bash', ['-c', cmd], {
    cwd: worktreePath,
    timeout: timeoutMs,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024 // 10MB
  });

  if (result.error && result.error.code === 'ETIMEDOUT') {
    return { timeout: true };
  }
  if (result.signal === 'SIGTERM' || result.signal === 'SIGKILL') {
    return { timeout: true };
  }

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combined = stdout + stderr;

  const digest = crypto.createHash('sha256').update(combined).digest('hex');
  const head = combined.slice(0, 400);

  let exitCode = result.status;
  if (exitCode === null && result.signal) {
    exitCode = -1;
  }

  return {
    exitCode,
    output: combined,
    digest,
    head,
    timeout: false
  };
}

// Step 1: Create detached worktree
const tempDirPrefix = path.join(os.tmpdir(), 'probe-mutation-');
try {
  worktreePath = fs.mkdtempSync(tempDirPrefix);
} catch (err) {
  failWithStatus('temp_dir_failed', 2, `Failed to create temp directory: ${err.message}`);
}

const gitAdd = child_process.spawnSync('git', [
  '-C', repoPath,
  'worktree', 'add',
  '--detach',
  worktreePath,
  options.ref
], { encoding: 'utf8' });

if (gitAdd.status !== 0) {
  // Clean up directory if git add failed
  try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch (_) {}
  worktreePath = null;
  failWithStatus('worktree_failed', 2, `Failed to add git worktree: ${gitAdd.stderr}`);
}

// Step 2: Run baseline probe
const baselineResult = runInWorktree(options.probe, timeoutMs);
if (baselineResult.timeout) {
  failWithStatus('probe_timeout', 2, 'Baseline probe run timed out');
}

if (baselineResult.exitCode !== 0) {
  failWithStatus('baseline_failing', 2, 'Probe fires already at baseline', {
    baseline: {
      probe_cmd: options.probe,
      exit_code: baselineResult.exitCode,
      output: baselineResult.output,
      digest: baselineResult.digest,
      head: baselineResult.head
    }
  });
}

// Step 3: Run mutation
const mutateResult = child_process.spawnSync('bash', ['-c', options.mutate], {
  cwd: worktreePath,
  env: process.env,
  encoding: 'utf8'
});

if (mutateResult.status !== 0) {
  failWithStatus('mutation_failed', 2, `Mutation command failed: ${mutateResult.stderr || mutateResult.stdout || ''}`, {
    mutation_desc: options.mutate
  });
}

// Verify worktree changed
const gitStatus = child_process.spawnSync('git', ['status', '--porcelain'], {
  cwd: worktreePath,
  encoding: 'utf8'
});

if (gitStatus.status !== 0) {
  failWithStatus('git_status_failed', 2, `Failed to run git status: ${gitStatus.stderr}`);
}

if (gitStatus.stdout.trim() === '') {
  failWithStatus('mutation_noop', 2, 'Worktree did not change after mutation command', {
    mutation_desc: options.mutate
  });
}

// Step 4: Re-run probe under mutation
const mutationProbeResult = runInWorktree(options.probe, timeoutMs);
if (mutationProbeResult.timeout) {
  failWithStatus('probe_timeout', 2, 'Probe run under mutation timed out');
}

const probeFired = mutationProbeResult.exitCode !== 0;

if (probeFired) {
  const outputJson = {
    status: 'probe_valid',
    probe_fired_under_mutation: true,
    mutation_desc: options.mutate,
    mutation_probe_output: mutationProbeResult.output,
    baseline: {
      probe_cmd: options.probe,
      exit_code: baselineResult.exitCode,
      output: baselineResult.output,
      digest: baselineResult.digest,
      head: baselineResult.head
    }
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(outputJson) + '\n');
  } else {
    process.stdout.write("Probe fired under mutation! Probe is valid.\n");
    process.stdout.write(JSON.stringify(outputJson, null, 2) + '\n');
  }
  process.exit(0);
} else {
  const outputJson = {
    status: 'vacuous_probe',
    probe_fired_under_mutation: false,
    mutation_desc: options.mutate,
    mutation_probe_output: mutationProbeResult.output,
    baseline: {
      probe_cmd: options.probe,
      exit_code: baselineResult.exitCode,
      output: baselineResult.output,
      digest: baselineResult.digest,
      head: baselineResult.head
    }
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(outputJson) + '\n');
  } else {
    process.stdout.write("WARNING: Probe stayed green under mutation. Probe is vacuous!\n");
    process.stdout.write(JSON.stringify(outputJson, null, 2) + '\n');
  }
  process.exit(1);
}
