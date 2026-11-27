#!/usr/bin/env node
'use strict';

/**
 * plan-gap-hint.js — local snapshot + gap hint for plan commits (never opens tasks).
 *
 * Usage:
 *   node scripts/plan-gap-hint.js [--repo <dir>] [--commit <rev, default HEAD>]
 *
 * Exit codes:
 *   0 — always (including no matching plans or fleet unavailable)
 *   2 — usage error
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { lintPlanPhases } = require('./check-plan-phases');
const { parsePhasesTable, parseTaskList, extractPhaseMarkers } = require('./plan-to-tasks');

const FLEET_TIMEOUT_MS = 5000;
const PHASES_MARKER_RE = /^<!--\s*phases:v1\s*-->[ \t]*$/m;

function usage() {
  process.stderr.write('Usage: node scripts/plan-gap-hint.js [--repo <dir>] [--commit <rev>]\n');
}

function parseArgs(argv) {
  let repoDir = process.cwd();
  let commit = 'HEAD';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    } else if (arg === '--repo') {
      if (i + 1 >= argv.length) {
        usage();
        process.exit(2);
      }
      repoDir = argv[++i];
    } else if (arg.startsWith('--repo=')) {
      repoDir = arg.slice('--repo='.length);
    } else if (arg === '--commit') {
      if (i + 1 >= argv.length) {
        usage();
        process.exit(2);
      }
      commit = argv[++i];
    } else if (arg.startsWith('--commit=')) {
      commit = arg.slice('--commit='.length);
    } else {
      process.stderr.write(`plan-gap-hint: unknown argument: ${arg}\n`);
      usage();
      process.exit(2);
    }
  }
  return { repoDir, commit };
}

function runGit(repoDir, args) {
  return spawnSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 5000,
  });
}

function writeSnapshot(repoRoot, planPath, commit, phaseEntries, untracked) {
  const home = process.env.HOME || os.homedir();
  const dir = path.join(home, '.autopilot', 'plan-gaps');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const hash = crypto
    .createHash('sha256')
    .update(`${repoRoot}\n${planPath}`)
    .digest('hex')
    .slice(0, 16);
  const snapPath = path.join(dir, `${hash}.json`);
  const payload = {
    schema: 'plan-gap:v1',
    plan_path: planPath,
    commit,
    checked_at: new Date().toISOString(),
    phases: phaseEntries,
    untracked,
  };
  fs.writeFileSync(snapPath, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(snapPath, 0o600);
}

function main() {
  const { repoDir, commit } = parseArgs(process.argv.slice(2));

  const topRes = runGit(repoDir, ['rev-parse', '--show-toplevel']);
  if (topRes.error || topRes.status !== 0) process.exit(0);
  const repoRoot = (topRes.stdout || '').trim();
  if (!repoRoot) process.exit(0);

  const revRes = runGit(repoRoot, ['rev-parse', commit]);
  if (revRes.error || revRes.status !== 0) process.exit(0);
  const resolvedCommit = (revRes.stdout || '').trim();

  const diffRes = runGit(repoRoot, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    '--root',
    '--diff-filter=AM',
    resolvedCommit,
  ]);
  if (diffRes.error || diffRes.status !== 0) process.exit(0);

  const mdFiles = (diffRes.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.md'));

  if (mdFiles.length === 0) process.exit(0);

  const validPlans = [];
  for (const planPath of mdFiles) {
    const showRes = runGit(repoRoot, ['show', `${resolvedCommit}:${planPath}`]);
    if (showRes.error || showRes.status !== 0) continue;
    const blob = showRes.stdout || '';
    if (!PHASES_MARKER_RE.test(blob)) continue;

    const lintErrors = lintPlanPhases(blob);
    if (lintErrors.length > 0) {
      process.stdout.write(`plan-gap: ${planPath}: ${lintErrors[0]}\n`);
      continue;
    }
    validPlans.push({ planPath, blob });
  }

  if (validPlans.length === 0) process.exit(0);

  const fleetBin = process.env.PLAN_TO_TASKS_FLEET_BIN || 'fleet';
  const fleetRes = spawnSync(fleetBin, ['tasks', '--all', '--json'], {
    encoding: 'utf8',
    timeout: FLEET_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (fleetRes.error || fleetRes.status !== 0) {
    process.stdout.write('task list unavailable\n');
    process.exit(0);
  }

  let tasks;
  try {
    tasks = parseTaskList(fleetRes.stdout || '');
  } catch (_e) {
    process.stdout.write('task list unavailable\n');
    process.exit(0);
  }

  const activeTasks = tasks.filter(
    (t) => !['cancelled', 'canceled'].includes(String(t.status || t.state || '').toLowerCase())
  );

  for (const { planPath, blob } of validPlans) {
    const phases = parsePhasesTable(blob);
    const phaseEntries = phases.map((p) => {
      const taskIds = [];
      for (const task of activeTasks) {
        const matched = extractPhaseMarkers(task, planPath);
        if (matched.includes(p.id)) {
          taskIds.push(String(task.task_id || task.id));
        }
      }
      return { id: p.id, task_ids: taskIds };
    });
    const untracked = phaseEntries.filter((e) => e.task_ids.length === 0).map((e) => e.id);

    try {
      writeSnapshot(repoRoot, planPath, resolvedCommit, phaseEntries, untracked);
    } catch (_e) {
      // fail-soft on snapshot write
    }

    if (untracked.length > 0) {
      process.stdout.write(
        `plan-gap: ${planPath}: ${untracked.length} phase(s) without a task: ${untracked.join(', ')} (nothing was opened)\n`
      );
    }
  }

  process.exit(0);
}

if (require.main === module) {
  main();
}
