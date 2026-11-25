#!/usr/bin/env node
'use strict';

// Shared Fleet-Task reference resolver, PM open-state gate, and fail-soft progress helper (Node built-ins only).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FLEET_TASK_LINE_RE = /^Fleet-Task:[ \t]*([0-9A-HJKMNP-TV-Z]{26})\b/m;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const CLOSED_STATES = new Set(['done', 'failed', 'cancelled', 'canceled']);
const EXEMPT_CALLER_RE = /^(?:engine-qualify|probe-)/i;
const CMDLINE_CALLER_RE = /(?:^|[\\/\0])(?:engine-qualify|probe-)[^\0]*/;

function findTaskId(text) {
  if (typeof text !== 'string' || !text) return null;
  const m = text.replace(/\r\n/g, '\n').match(FLEET_TASK_LINE_RE);
  return m ? m[1] : null;
}

function isValidTaskId(id) {
  return typeof id === 'string' && ULID_RE.test(id.trim());
}

function normalizeStateFromJson(obj, exitStatus) {
  if (!obj || typeof obj !== 'object') return null;
  const errCode = String(obj.error || obj.code || '').trim().toLowerCase();
  const raw = String(
    obj.status || obj.state || (obj.task && (obj.task.status || obj.task.state)) || '',
  ).trim().toLowerCase();

  if (errCode === 'not_found' || raw === 'not_found' || obj.found === false) {
    return 'not_found';
  }
  if (CLOSED_STATES.has(raw)) {
    return 'closed';
  }
  if (exitStatus === 0 && raw) {
    return 'open';
  }
  return null;
}

function checkTaskOpen(id, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 1500;
  const taskId = typeof id === 'string' ? id.trim() : '';
  if (!isValidTaskId(taskId)) {
    return { state: 'not_found' };
  }

  const bin = (opts.bin || process.env.FLEET_BIN || 'fleet').trim() || 'fleet';
  const r = spawnSync(bin, ['task', 'show', taskId, '--json'], {
    encoding: 'utf8',
    timeout: timeoutMs,
  });

  if (r.error || r.signal) {
    return { state: 'unavailable' };
  }

  const out = typeof r.stdout === 'string' ? r.stdout.trim() : '';
  const err = typeof r.stderr === 'string' ? r.stderr.trim() : '';

  if (out) {
    try {
      const parsed = JSON.parse(out);
      const st = normalizeStateFromJson(parsed, r.status);
      if (st) return { state: st };
    } catch {
      // Fall through to non-JSON / exit status inspection.
    }
  }

  if (r.status !== 0 && /(?:\bnot[ _-]?found\b|no task\b.*\bin this courier\x27?s table)/i.test(`${out}\n${err}`)) {
    return { state: 'not_found' };
  }

  return { state: 'unavailable' };
}

function isExemptCaller(env = process.env) {
  const role = String(env.AUTOPILOT_DISPATCH_ROLE || '').trim();
  if (EXEMPT_CALLER_RE.test(role)) return true;
  try {
    const cmdline = fs.readFileSync(`/proc/${process.ppid}/cmdline`, 'utf8');
    if (CMDLINE_CALLER_RE.test(cmdline)) return true;
  } catch {
    // /proc may be unavailable on non-Linux or restricted environments.
  }
  return false;
}

function readPromptText(filePath) {
  if (!filePath) return '';
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function resolveParentTaskId({ fleetTaskArg = '', text = '', env = process.env } = {}) {
  const cli = String(fleetTaskArg || '').trim();
  if (isValidTaskId(cli)) return cli;
  const envFleet = String(env.AUTOPILOT_FLEET_TASK || '').trim();
  if (isValidTaskId(envFleet)) return envFleet;
  if (envFleet !== 'none') {
    const upstream = String(env.AUTOPILOT_UPSTREAM_TASK_ID || '').trim();
    if (isValidTaskId(upstream)) return upstream;
  }
  return findTaskId(text);
}

function resolvePmGate({
  repoRoot = '',
  fleetTaskArg = '',
  text = '',
  hasBinStub = false,
  env = process.env,
  timeoutMs = 1500,
} = {}) {
  const parentRunId = String(env.AUTOPILOT_PARENT_RUN_ID || '').trim();
  if (parentRunId) {
    return {
      allowed: true,
      inherited: true,
      taskId: resolveParentTaskId({ fleetTaskArg, text, env }) || null,
    };
  }
  if (hasBinStub) {
    return { allowed: true, exempt: 'bin-stub', taskId: resolveParentTaskId({ fleetTaskArg, text, env }) || null };
  }
  if (isExemptCaller(env)) {
    return { allowed: true, exempt: 'caller', taskId: resolveParentTaskId({ fleetTaskArg, text, env }) || null };
  }

  const cli = String(fleetTaskArg || '').trim();
  const envFleet = String(env.AUTOPILOT_FLEET_TASK || '').trim();
  const candidate = cli || (envFleet && envFleet !== 'none' ? envFleet : '') || findTaskId(text) || '';

  if (!candidate) {
    const reason = 'Fleet-Task precondition failed: missing Fleet-Task (<26-char id>). Open or pick a task (`fleet task show`) and pass `--fleet-task <id>`, set `AUTOPILOT_FLEET_TASK`, or add `Fleet-Task: <id>` to the brief/plan.';
    return {
      allowed: false,
      code: 'missing',
      reason,
    };
  }

  const probe = checkTaskOpen(candidate, { timeoutMs });
  if (probe.state === 'open') {
    return { allowed: true, taskId: candidate };
  }
  if (probe.state === 'unavailable') {
    return {
      allowed: true,
      taskId: candidate,
      unavailable: true,
      note: `fleet task ${candidate} check unavailable — allowing (fail-open)`,
    };
  }
  if (probe.state === 'not_found') {
    const reason = `Fleet-Task precondition failed: Fleet-Task ${candidate} was not_found (\`fleet task show ${candidate}\`). Open or pick a valid open task.`;
    return {
      allowed: false,
      code: 'not_found',
      taskId: candidate,
      reason,
    };
  }
  const reason = `Fleet-Task precondition failed: Fleet-Task ${candidate} is closed (done/failed/cancelled). Open or pick an open task (\`fleet task show\`).`;
  return {
    allowed: false,
    code: 'closed',
    taskId: candidate,
    reason,
  };
}

function emitProgressFailSoft(taskId, text) {
  if (!isValidTaskId(taskId) || !text) return;
  try {
    const fleetTask = require(path.join(__dirname, 'fleet-task.js'));
    fleetTask.progress(String(taskId).trim(), String(text));
  } catch {
    // Fail-soft: never affect caller stdout or exit code.
  }
}

function parseCliFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--') && i + 1 < argv.length) {
      out[k.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function cli(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  if (cmd === 'find-in-file') {
    const id = findTaskId(readPromptText(argv[1]));
    if (id) process.stdout.write(id + '\n');
    return 0;
  }
  if (cmd === 'check-open') {
    const res = checkTaskOpen(argv[1] || '');
    process.stdout.write(JSON.stringify(res) + '\n');
    return 0;
  }
  if (cmd === 'resolve-parent') {
    const f = parseCliFlags(argv.slice(1));
    const id = resolveParentTaskId({
      fleetTaskArg: f['fleet-task'] || '',
      text: readPromptText(f['prompt-file'] || ''),
    });
    if (id) process.stdout.write(id + '\n');
    return 0;
  }
  if (cmd === 'pm-check') {
    const f = parseCliFlags(argv.slice(1));
    const res = resolvePmGate({
      repoRoot: f['repo-root'] || '',
      fleetTaskArg: f['fleet-task'] || '',
      text: readPromptText(f['prompt-file'] || ''),
      hasBinStub: f['bin-stub'] === '1',
    });
    if (!res.allowed) {
      process.stderr.write(res.reason + '\n');
      return 2;
    }
    if (res.note) process.stderr.write(res.note + '\n');
    if (res.taskId) process.stdout.write(res.taskId + '\n');
    return 0;
  }
  if (cmd === 'progress') {
    emitProgressFailSoft(argv[1] || '', argv[2] || '');
    return 0;
  }
  process.stderr.write('usage: fleet-task-ref.js <find-in-file|check-open|resolve-parent|pm-check|progress>\n');
  return 2;
}

if (require.main === module) {
  process.exit(cli());
}

module.exports = {
  FLEET_TASK_LINE_RE,
  ULID_RE,
  findTaskId,
  isValidTaskId,
  checkTaskOpen,
  isExemptCaller,
  resolveParentTaskId,
  resolvePmGate,
  emitProgressFailSoft,
};
