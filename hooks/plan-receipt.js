#!/usr/bin/env node
'use strict';

/**
 * plan-receipt — PostToolUse mcp__fleet__task_accept (default-on).
 *
 * After a successful accept of a task whose title or body carries a
 * `Plan: … Phase: …` line (scripts/plan-to-tasks.js extractPhaseMarkers),
 * runs `node scripts/finish-triage.js --task <id> --sha <sha> --accept --repo <cwd>`.
 * `<sha>` is the commit sha in the last evidence piece (comments, then the
 * result message). finish-triage --accept only evaluates; it does not call
 * fleet accept, so an already-accepted task still gets that run and is not
 * accepted twice.
 *
 * Never blocks, never rewrites the accept, never writes stdout. Always exit 0.
 * Failures (no sha, fleet/triage error, timeout) append one JSON line to
 * ${PLAN_RECEIPT_AUDIT:-${XDG_STATE_HOME:-~/.local/state}/autopilot/plan-receipt-audit.jsonl}.
 *
 * Fleet binary: FINISH_TRIAGE_FLEET_BIN (default `fleet`).
 * Triage script override (tests): PLAN_RECEIPT_TRIAGE_JS.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractPhaseMarkers } = require('../scripts/plan-to-tasks');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const FLEET_TIMEOUT_MS = 2500;
const TRIAGE_TIMEOUT_MS = 5000;
const SHA_RE = /[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const SHA_SHORT_RE = /(?:^|[^0-9a-fA-F])([0-9a-fA-F]{16,40})(?![0-9a-fA-F])/g;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function auditPath() {
  if (process.env.PLAN_RECEIPT_AUDIT) return process.env.PLAN_RECEIPT_AUDIT;
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'autopilot', 'plan-receipt-audit.jsonl');
}

function audit(task, reason) {
  try {
    const file = auditPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      task: task || '',
      reason,
    });
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    /* stay silent */
  }
}

function carriesPlanPhase(task) {
  const texts = [];
  if (typeof task.title === 'string') texts.push(task.title);
  if (typeof task.body === 'string') texts.push(task.body);
  for (const text of texts) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith('Plan: ')) continue;
      const token = line.slice('Plan: '.length).split(/\s+/)[0];
      if (!token) continue;
      const planPath = token.replace(/@[0-9a-fA-F]{7,40}$/, '');
      if (extractPhaseMarkers({ title: line }, planPath).length > 0) return true;
    }
  }
  return false;
}

function evidencePieces(task) {
  const pieces = [];
  if (Array.isArray(task.comments)) {
    for (const c of task.comments) {
      if (typeof c === 'string') pieces.push(c);
      else if (c && typeof c === 'object') {
        const t = c.text || c.body || c.message || c.content;
        if (typeof t === 'string') pieces.push(t);
      }
    }
  }
  for (const key of ['result_text', 'result', 'result_message']) {
    const v = task[key];
    if (typeof v === 'string' && v.trim()) {
      pieces.push(v);
      break;
    }
  }
  return pieces;
}

function shaInText(text) {
  const full = [...String(text).matchAll(SHA_RE)];
  if (full.length) return full[full.length - 1][0].toLowerCase();
  const short = [...String(text).matchAll(SHA_SHORT_RE)];
  if (short.length) return short[short.length - 1][1].toLowerCase();
  return '';
}

function lastEvidenceSha(task) {
  const pieces = evidencePieces(task);
  if (!pieces.length) return '';
  return shaInText(pieces[pieces.length - 1]);
}

function acceptSucceeded(payload) {
  if (!payload || payload.is_error === true) return false;
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  if (input.accept !== true) return false;
  const resp = payload.tool_response;
  if (resp == null) return false;
  if (typeof resp === 'object') {
    if (resp.is_error === true || resp.isError === true) return false;
    if (typeof resp.error === 'string' && resp.error) return false;
  }
  return true;
}

function showTask(taskId) {
  const fleetBin = process.env.FINISH_TRIAGE_FLEET_BIN || 'fleet';
  const res = spawnSync(fleetBin, ['task', 'show', taskId, '--json'], {
    encoding: 'utf8',
    timeout: FLEET_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.error || res.status !== 0) {
    const timedOut = res.error && res.error.code === 'ETIMEDOUT';
    return { ok: false, reason: timedOut ? 'timeout' : 'fleet_show' };
  }
  try {
    const task = JSON.parse(res.stdout || '');
    if (!task || typeof task !== 'object' || Array.isArray(task)) return { ok: false, reason: 'fleet_show' };
    return { ok: true, task };
  } catch {
    return { ok: false, reason: 'fleet_show' };
  }
}

function runTriage(taskId, sha, repo) {
  const script = process.env.PLAN_RECEIPT_TRIAGE_JS
    || path.join(PLUGIN_ROOT, 'scripts', 'finish-triage.js');
  const res = spawnSync(process.execPath, [
    script, '--task', taskId, '--sha', sha, '--accept', '--repo', repo,
  ], {
    encoding: 'utf8',
    timeout: TRIAGE_TIMEOUT_MS,
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.error && res.error.code === 'ETIMEDOUT') return 'timeout';
  if (res.error || res.status !== 0) return 'finish_triage';
  return '';
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    return;
  }
  if (!acceptSucceeded(payload)) return;
  const taskId = String(payload.tool_input.task_id || '').trim();
  if (!taskId) {
    audit('', 'missing_task_id');
    return;
  }
  const shown = showTask(taskId);
  if (!shown.ok) {
    audit(taskId, shown.reason);
    return;
  }
  if (!carriesPlanPhase(shown.task)) return;
  const sha = lastEvidenceSha(shown.task);
  if (!sha || sha.length < 16) {
    audit(taskId, 'no_sha');
    return;
  }
  const repo = payload.cwd || process.cwd();
  const reason = runTriage(taskId, sha, repo);
  if (reason) audit(taskId, reason);
}

try {
  main();
} catch {
  /* fail open, silent */
}
process.exit(0);
