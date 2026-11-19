#!/usr/bin/env node
'use strict';

/**
 * work-order-adopt.js — adopt a fleet work order into the session marker and enter its stage walk.
 *
 * Usage:
 *   node scripts/work-order-adopt.js --task <id> [--session-id <id>] [--repo-root <dir>]
 *
 * Behavior (fleet-stage-graph-binding P3):
 *   1. Reads `fleet task show <id> --json` once via scripts/lib/fleet-task.js (`FLEET_BIN`
 *      overridable, 1.5 s timeout). Parses size / bug / urgent from the title SizeTag ONLY
 *      (`[S]`, `[bug S]`, `[!L]`) and reads body lines ONLY for `Plan:` via
 *      scripts/lib/work-order-plan.js.
 *   2. If the live marker has any non-empty task-scoped field (`sessionMode.NEW_TASK_CLEARED`) and
 *      its `wo_task` (else `fleet_task_id`) differs from `<id>`, invokes:
 *        `session-mode.js set --new-task --fleet-task <id> --size <S> --wo-size <S> [--wo-plan <P>] [--bug] [--urgent]`
 *      otherwise omits `--new-task`. Passing `--wo-size` (and `--wo-plan`) avoids a second
 *      `fleet task show` spawn inside `session-mode.js`.
 *   3. Queries `stage-graph.js` for `<entry>` of `{ size, bug, urgent }` and invokes:
 *        `stage-advance.js --to <entry>`
 *   4. Unresolved (no SizeTag in title, conflicting SizeTags in title, or unresolvable `Plan:`):
 *      writes `wo_state: "unresolved"` to the session marker (clearing any stale task-scoped stage
 *      or size fields), prints one stderr line, exits 2, and does NOT call `stage-advance.js`.
 *   5. Fleet CLI unreachable, non-zero exit, invalid JSON, or timeout (1.5 s): prints one stderr
 *      warning line, exits 0, and leaves the marker unchanged.
 *
 * Exit codes:
 *   0 — adopted into entry stage, OR degraded cleanly when fleet CLI is unavailable/timed out
 *   2 — unresolved work order (missing/conflicting title SizeTag or unresolvable Plan) or bad CLI args
 *   3 — marker write refused (e.g. inherited parent session id) or stage-advance refusal
 *   1 — unexpected internal error
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const fleetTask = require('./lib/fleet-task');
const workOrderPlan = require('./lib/work-order-plan');
const { withWriteLock } = require('./lib/jsonl-store');
const sessionMode = require('./session-mode');
const stageGraph = require('./stage-graph');

const FLEET_TIMEOUT_MS = 1500;
const FLEET_TASK_ID_MAX = 64;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const SESSION_MODE_SCRIPT = path.join(__dirname, 'session-mode.js');
const STAGE_ADVANCE_SCRIPT = path.join(__dirname, 'stage-advance.js');

function printHelp() {
  process.stdout.write(
    'Usage: node scripts/work-order-adopt.js --task <id> [--session-id <id>] [--repo-root <dir>]\n',
  );
}

function parseArgs(argv) {
  const opts = { task: null, sessionId: null, repoRoot: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a === '--task') {
      if (i + 1 >= argv.length) return { error: '--task requires an id' };
      opts.task = argv[++i];
    } else if (a === '--session-id') {
      if (i + 1 >= argv.length) return { error: '--session-id requires a value' };
      opts.sessionId = argv[++i];
    } else if (a === '--repo-root') {
      if (i + 1 >= argv.length) return { error: '--repo-root requires a path' };
      opts.repoRoot = argv[++i];
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return opts;
}

function validateTaskId(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || /\s/u.test(raw) || [...raw].length > FLEET_TASK_ID_MAX) {
    return 'missing or invalid --task <id> (want non-empty id with no whitespace, <= 64 chars)';
  }
  return null;
}

function resolveRepoRoot(explicitRepoRoot) {
  if (typeof explicitRepoRoot === 'string' && explicitRepoRoot.trim()) {
    return path.resolve(explicitRepoRoot);
  }
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || process.cwd();
  } catch {
    return process.cwd();
  }
}

function hasNonEmptyTaskField(marker) {
  if (!marker || typeof marker !== 'object') return false;
  for (const k of sessionMode.NEW_TASK_CLEARED) {
    const v = marker[k];
    if (typeof v === 'string' && v.length > 0) return true;
    if (v === true) return true;
    if (Array.isArray(v) && v.length > 0) return true;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return true;
  }
  return false;
}

function shouldStartNewTask(current, taskId) {
  if (!hasNonEmptyTaskField(current)) return false;
  const currentTask =
    typeof current.wo_task === 'string' && current.wo_task.length > 0
      ? current.wo_task
      : typeof current.fleet_task_id === 'string' && current.fleet_task_id.length > 0
        ? current.fleet_task_id
        : null;
  return currentTask !== taskId;
}

function extractBodyPlan(task) {
  const titleRest = typeof task.title === 'string' ? task.title.split(/\r?\n/).slice(1).join('\n') : '';
  const bodySource = [titleRest, task.body, task.description]
    .filter((v) => typeof v === 'string' && v.length > 0)
    .join('\n');
  return bodySource ? workOrderPlan.parse(bodySource).plan : null;
}

function writeUnresolvedMarker({ target, taskId, parsedPlan, repoRoot }) {
  const dir = sessionMode.markerDir();
  const file = path.join(dir, `${target.id}.json`);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  withWriteLock(
    {
      storeDir: dir,
      lockFile: `${file}.lock`,
      name: 'session-mode marker',
      timeoutMs: sessionMode.PHASE_LOCK_TIMEOUT_MS,
    },
    () => {
      const current = sessionMode.readSessionRecord(target.id);
      let next;
      if (current) {
        next = { ...current };
        if (shouldStartNewTask(current, taskId)) {
          const seqPrev =
            Number.isInteger(current.task_seq) && current.task_seq >= 1
              ? current.task_seq
              : 1;
          next.task_seq = seqPrev + 1;
          next.task_started_at = nowIso;
        }
        for (const k of sessionMode.NEW_TASK_CLEARED) delete next[k];
      } else {
        let repoIdentity = null;
        try {
          repoIdentity = sessionMode.markerRepoIdentity(repoRoot) || null;
        } catch {
          repoIdentity = null;
        }
        next = {
          session_id: target.id,
          level: null,
          repo_root: repoRoot,
          repo_identity: repoIdentity,
          project_key: null,
          root_run_id: sessionMode.resolveJobRoot({ now }),
          started_at: nowIso,
          expires_at: new Date(now + DEFAULT_TTL_MS).toISOString(),
        };
      }

      next.fleet_task_id = taskId;
      next.wo_task = taskId;
      next.wo_size = null;
      next.wo_plan = parsedPlan;
      next.wo_state = 'unresolved';
      next.wo_fetched_at = nowIso;
      delete next.plan_receipt;

      sessionMode.writeMarkerFile(file, next);
    },
  );
}

function firstLine(text, fallback) {
  const line = String(text || '')
    .trim()
    .split(/\r?\n/)[0]
    .trim();
  return line || fallback;
}

function adoptWorkOrder(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.error) {
    process.stderr.write(`work-order-adopt: ${opts.error}\n`);
    return 2;
  }
  if (opts.help) {
    printHelp();
    return 0;
  }
  const taskErr = validateTaskId(opts.task);
  if (taskErr) {
    process.stderr.write(`work-order-adopt: ${taskErr}\n`);
    return 2;
  }

  const explicitId = typeof opts.sessionId === 'string' && opts.sessionId.trim() ? opts.sessionId.trim() : undefined;
  const target = sessionMode.resolveMarkerWriteTarget({ explicitId });
  if (target.refused) {
    process.stderr.write(
      `work-order-adopt: marker write refused (source ${target.source}): ${target.reason}; no file touched\n`,
    );
    return 3;
  }

  const taskId = opts.task;
  const shown = fleetTask.show(taskId, { timeoutMs: FLEET_TIMEOUT_MS });
  if (!shown.ok || typeof shown.task.title !== 'string') {
    const reason = !shown.ok ? shown.error : 'missing title field in fleet task JSON';
    process.stderr.write(`work-order-adopt: warning: fleet task ${taskId} unavailable (${reason}); marker unchanged\n`);
    return 0;
  }

  const repoRoot = resolveRepoRoot(opts.repoRoot);
  const tag = workOrderPlan.parseSizeTag(shown.task.title);
  const parsedPlan = extractBodyPlan(shown.task);

  if (!tag.size || tag.size === 'conflict') {
    const storedPlan = tag.size === 'conflict' ? null : parsedPlan;
    try {
      writeUnresolvedMarker({ target, taskId, parsedPlan: storedPlan, repoRoot });
    } catch (err) {
      process.stderr.write(`work-order-adopt: failed to write unresolved marker for ${taskId}: ${err.message}\n`);
      return 1;
    }
    const why = tag.size === 'conflict' ? 'conflicting SizeTag in title' : 'no SizeTag in title';
    process.stderr.write(`work-order-adopt: fleet task ${taskId}: ${why}; stored wo_state: unresolved\n`);
    return 2;
  }

  const current = sessionMode.readSessionRecord(target.id);
  const needsNewTask = shouldStartNewTask(current, taskId);

  const childEnv = { ...process.env };
  if (explicitId && !(process.env.AUTOPILOT_PARENT_SESSION_ID || '').trim()) {
    childEnv.AUTOPILOT_SESSION_ID = target.id;
  }

  const setArgs = [SESSION_MODE_SCRIPT, 'set'];
  if (needsNewTask) setArgs.push('--new-task');
  setArgs.push('--fleet-task', taskId, '--size', tag.size, '--wo-size', tag.size);
  if (parsedPlan) {
    const woPlanArg = typeof parsedPlan === 'string' ? parsedPlan : `${parsedPlan.path}@${parsedPlan.sha}`;
    setArgs.push('--wo-plan', woPlanArg);
  }
  if (tag.bug) setArgs.push('--bug');
  if (tag.urgent) setArgs.push('--urgent');
  if (explicitId) setArgs.push('--session-id', explicitId);
  if (opts.repoRoot) setArgs.push('--repo-root', repoRoot);

  const setRes = spawnSync(process.execPath, setArgs, {
    cwd: repoRoot,
    env: childEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (setRes.status !== 0) {
    const detail = firstLine(setRes.stderr, `session-mode set exited ${setRes.status}`);
    process.stderr.write(`${detail}\n`);
    return setRes.status || 1;
  }

  const afterSet = sessionMode.readSessionRecord(target.id);
  if (afterSet && afterSet.wo_state === 'unresolved') {
    const detail = firstLine(setRes.stderr, `work-order-adopt: fleet task ${taskId}: stored wo_state: unresolved`);
    process.stderr.write(`${detail}\n`);
    return 2;
  }

  let entry;
  try {
    const graph = JSON.parse(fs.readFileSync(stageGraph.DEFAULT_GRAPH, 'utf8'));
    const walk = stageGraph.buildWalk(graph, {
      size: tag.size,
      bug: tag.bug,
      urgent: tag.urgent,
      highRisk: false,
      research: false,
      explore: false,
      units: 1,
    });
    entry = walk.entry;
  } catch (err) {
    process.stderr.write(`work-order-adopt: stage-graph error: ${err.message}\n`);
    return 1;
  }

  const advArgs = [STAGE_ADVANCE_SCRIPT, '--to', entry];
  if (explicitId) advArgs.push('--session-id', explicitId);
  if (opts.repoRoot) advArgs.push('--repo-root', repoRoot);

  const advRes = spawnSync(process.execPath, advArgs, {
    cwd: repoRoot,
    env: childEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (advRes.status !== 0) {
    const detail = firstLine(advRes.stderr || advRes.stdout, `stage-advance exited ${advRes.status}`);
    process.stderr.write(`${detail}\n`);
    return advRes.status || 1;
  }

  if (advRes.stdout) process.stdout.write(advRes.stdout);
  return 0;
}

if (require.main === module) {
  process.exit(adoptWorkOrder());
}

module.exports = {
  adoptWorkOrder,
  parseArgs,
  validateTaskId,
  shouldStartNewTask,
  hasNonEmptyTaskField,
  FLEET_TIMEOUT_MS,
};
