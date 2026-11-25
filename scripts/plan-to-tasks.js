#!/usr/bin/env node
'use strict';

/**
 * plan-to-tasks.js — materialize a frozen plan's phases:v1 table into fleet child tasks.
 *
 * Usage:
 *   node scripts/plan-to-tasks.js --receipt <freeze-receipt.json>
 *
 * Pre-checks (exit 1 on failure, zero fleet mutations):
 *   1. Receipt JSON has commit, path, sha256, verdict === 'READY' || verdict === 'adjudicated'
 *   2. `git show <commit>:<path>` bytes sha256 === receipt.sha256
 *   3. `check-plan-phases.js` lint passes
 *
 * Exit codes:
 *   0 — all frozen phases exist 1-to-1 as fleet child tasks
 *   1 — verification failed, fleet error, or phase/task 1-to-1 mismatch
 *   2 — missing --receipt or invalid CLI arguments
 *
 * Node >= 20.10, built-ins only.
 * Fleet binary: PLAN_TO_TASKS_FLEET_BIN (default: `fleet`).
 * PLAN_TO_TASKS_ASSIGNEE (required): address that executes phases; PLAN_TO_TASKS_PARENT (optional): parent task id.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { lintPlanPhases } = require('./check-plan-phases');

const FLEET_TIMEOUT_MS = 30000;

function usage() {
  process.stderr.write('Usage: node scripts/plan-to-tasks.js --receipt <freeze-receipt.json>\n');
}

function parseArgs(argv) {
  let receiptPath = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--receipt') {
      if (i + 1 >= argv.length) {
        usage();
        process.exit(2);
      }
      receiptPath = argv[++i];
    } else if (arg.startsWith('--receipt=')) {
      receiptPath = arg.slice('--receipt='.length);
    } else {
      process.stderr.write(`plan-to-tasks: unknown argument: ${arg}\n`);
      usage();
      process.exit(2);
    }
  }
  if (!receiptPath) {
    process.stderr.write('plan-to-tasks: --receipt is required\n');
    usage();
    process.exit(2);
  }
  return { receiptPath };
}

function parsePhasesTable(markdown) {
  const startMatch = markdown.match(/^<!--\s*phases:v1\s*-->[ \t]*$/m);
  if (!startMatch) return [];
  const startIdx = startMatch.index + startMatch[0].length;
  const endRe = /<!--\s*\/phases\s*-->/g;
  endRe.lastIndex = startIdx;
  const endMatch = endRe.exec(markdown);
  if (!endMatch) return [];

  const lines = markdown
    .slice(startIdx, endMatch.index)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const phases = [];
  for (let i = 2; i < lines.length; i++) {
    const trimmed = lines[i];
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    const [id, size, dependsOn, acceptanceCmd, needsLook, title] = cells;
    const deps = dependsOn === '-'
      ? []
      : dependsOn.split(',').map((d) => d.trim()).filter(Boolean);
    phases.push({
      id,
      size,
      deps,
      acceptanceCmd,
      needsLook,
      title,
      order: i - 2,
    });
  }
  return phases;
}

function topoSort(phases) {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const inDegree = new Map(phases.map((p) => [p.id, p.deps.length]));
  const dependents = new Map(phases.map((p) => [p.id, []]));
  for (const p of phases) {
    for (const dep of p.deps) {
      if (dependents.has(dep)) dependents.get(dep).push(p.id);
    }
  }

  const ready = phases
    .filter((p) => inDegree.get(p.id) === 0)
    .sort((a, b) => a.order - b.order);
  const sorted = [];

  while (ready.length > 0) {
    const curr = ready.shift();
    sorted.push(curr);
    for (const depId of dependents.get(curr.id)) {
      inDegree.set(depId, inDegree.get(depId) - 1);
      if (inDegree.get(depId) === 0) {
        ready.push(byId.get(depId));
        ready.sort((a, b) => a.order - b.order);
      }
    }
  }

  if (sorted.length !== phases.length) {
    throw new Error('cycle detected in phases:v1 table');
  }
  return sorted;
}

function runFleet(fleetBin, args) {
  const res = spawnSync(fleetBin, args, {
    encoding: 'utf8',
    timeout: FLEET_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.error) {
    throw new Error(`fleet ${args[0] || ''} failed: ${res.error.message}`);
  }
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || '').trim();
    throw new Error(`fleet ${args.join(' ')} exited ${res.status}${msg ? `: ${msg}` : ''}`);
  }
  return res.stdout || '';
}

function extractPhaseMarker(task, planPath, commitSha) {
  const text = String(task.title || task.body || '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  // 12-char short sha: a full 40-hex run in a dispatch body is refused by fleet (secret_detected long_hex_run).
  const exactPrefix = `Plan: ${planPath}@${commitSha.slice(0, 12)} Phase: `;
  if (firstLine.startsWith(exactPrefix)) {
    return firstLine.slice(exactPrefix.length).trim().split(/\s+/)[0];
  }
  return null;
}

function parseTaskList(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.tasks)) return parsed.tasks;
  return [];
}

function parseCreatedTaskId(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('fleet dispatch returned empty output');
  const m = trimmed.match(/\b[0-9A-HJKMNP-TV-Z]{26}\b/) || trimmed.match(/\bT-\d+\b/);
  if (!m) throw new Error(`fleet dispatch output has no task id: ${trimmed.slice(0, 120)}`);
  return m[0];
}

function main() {
  const { receiptPath } = parseArgs(process.argv.slice(2));

  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`plan-to-tasks: cannot read receipt "${receiptPath}": ${err.message}\n`);
    process.exit(1);
  }

  if (!receipt || !receipt.commit || !receipt.path || !receipt.sha256 || !receipt.verdict) {
    process.stderr.write('plan-to-tasks: receipt missing required fields (commit, path, sha256, verdict)\n');
    process.exit(1);
  }

  if (receipt.verdict !== 'READY' && receipt.verdict !== 'adjudicated') {
    process.stderr.write(`plan-to-tasks: receipt verdict is "${receipt.verdict}", expected "READY" or "adjudicated"\n`);
    process.exit(1);
  }

  const gitRes = spawnSync('git', ['show', `${receipt.commit}:${receipt.path}`], {
    encoding: null,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15000,
  });
  if (gitRes.error || gitRes.status !== 0) {
    const errText = gitRes.error ? gitRes.error.message : (gitRes.stderr || '').toString('utf8').trim();
    process.stderr.write(`plan-to-tasks: git show ${receipt.commit}:${receipt.path} failed: ${errText}\n`);
    process.exit(1);
  }

  const planBytes = gitRes.stdout;
  const actualSha = crypto.createHash('sha256').update(planBytes).digest('hex');
  if (actualSha !== receipt.sha256) {
    process.stderr.write(
      `plan-to-tasks: sha256 mismatch for ${receipt.commit}:${receipt.path} (expected ${receipt.sha256}, got ${actualSha})\n`
    );
    process.exit(1);
  }

  const planText = planBytes.toString('utf8');
  const lintErrors = lintPlanPhases(planText);
  if (lintErrors.length > 0) {
    for (const err of lintErrors) {
      process.stderr.write(`${err}\n`);
    }
    process.exit(1);
  }

  const phases = topoSort(parsePhasesTable(planText));
  const frozenIds = new Set(phases.map((p) => p.id));
  const fleetBin = process.env.PLAN_TO_TASKS_FLEET_BIN || 'fleet';
  const assignee = process.env.PLAN_TO_TASKS_ASSIGNEE || process.env.AUTOPILOT_FLEET_ADDRESS || '';
  if (!assignee) {
    process.stderr.write('plan-to-tasks: set PLAN_TO_TASKS_ASSIGNEE (fleet address that executes the phases)\n');
    process.exit(2);
  }

  try {
    const lockName = `plan-to-tasks-${receipt.sha256.slice(0, 16)}`;
    runFleet(fleetBin, ['lock', 'acquire', lockName, '--ttl', '10m']);
    process.on('exit', () => {
      spawnSync(fleetBin, ['lock', 'release', lockName], { stdio: 'ignore', timeout: FLEET_TIMEOUT_MS });
    });

    const existingTasks = parseTaskList(runFleet(fleetBin, ['tasks', '--all', '--json']));
    const phaseToTaskId = new Map();
    const unknownPhases = [];

    const parentId = process.env.PLAN_TO_TASKS_PARENT || '';
    for (const task of existingTasks) {
      if (parentId && String(task.parent_task_id || task.parent_id || '') !== parentId) continue;
      const phaseId = extractPhaseMarker(task, receipt.path, receipt.commit);
      if (!phaseId) continue;
      if (!frozenIds.has(phaseId)) {
        unknownPhases.push(phaseId);
      } else if (!phaseToTaskId.has(phaseId)) {
        phaseToTaskId.set(phaseId, String(task.task_id || task.id));
      }
    }

    if (unknownPhases.length > 0) {
      process.stderr.write(
        `plan-to-tasks: existing tasks contain unknown Phase(s): ${unknownPhases.join(', ')}\n`
      );
      process.exit(1);
    }

    for (const phase of phases) {
      if (phaseToTaskId.has(phase.id)) continue;

      const body = [
        `Plan: ${receipt.path}@${receipt.commit.slice(0, 12)} Phase: ${phase.id}`,
        `Role: implementer | Size: ${phase.size} | Needs-Look: ${phase.needsLook}`,
        `Title: ${phase.title}`,
        `Acceptance: ${phase.acceptanceCmd}`,
      ].join('\n');

      const args = ['dispatch', assignee, '--size', phase.size];
      if (parentId) args.push('--parent', parentId);
      if (phase.deps.length > 0) {
        args.push('--queue');
        for (const dep of phase.deps) {
          const depTaskId = phaseToTaskId.get(dep);
          if (!depTaskId) {
            throw new Error(`missing task id for dependency ${dep} of ${phase.id}`);
          }
          args.push('--after', depTaskId);
        }
      }
      args.push(body);

      const createdOut = runFleet(fleetBin, args);
      const createdId = parseCreatedTaskId(createdOut);
      phaseToTaskId.set(phase.id, createdId);
    }

    const missing = phases.filter((p) => !phaseToTaskId.has(p.id)).map((p) => p.id);
    if (missing.length > 0) {
      process.stderr.write(`plan-to-tasks: missing Phase(s) after creation: ${missing.join(', ')}\n`);
      process.exit(1);
    }

    process.stdout.write(
      JSON.stringify({ ok: true, count: phases.length, tasks: Object.fromEntries(phaseToTaskId) }) + '\n'
    );
  } catch (err) {
    process.stderr.write(`plan-to-tasks: ${err.message}\n`);
    process.exit(1);
  }
}

main();
