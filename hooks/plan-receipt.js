#!/usr/bin/env node
'use strict';

/**
 * plan-receipt — PostToolUse mcp__fleet__task_accept (default-on).
 *
 * After a successful accept of a task whose title or body carries a
 * `Plan: … Phase: …` line (scripts/plan-to-tasks.js extractPhaseMarkers):
 *   1. find the newest evidence piece naming a commit (never the title),
 *   2. find the repo holding it: the hook cwd, then the sibling repos of the
 *      cwd's git toplevel,
 *   3. run `scripts/finish-triage.js --task <id> --sha <sha40> --accept --repo <dir> --json`
 *      (evaluates only; it does not call fleet accept),
 *   4. post the result as one `fleet task comment` receipt. Exit 0 and exit 1
 *      both count when stdout is a result with a `status`.
 *
 * Never blocks, never rewrites the accept, never writes stdout. Always exit 0.
 * Failures (no sha, fleet/triage/comment error, timeout) append one JSON line to
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
// The child budgets add up to less than the hooks.json timeout for this hook
// (pinned by plan-receipt.test.js).
const TIMEOUTS_MS = { show: 3000, repoSearch: 4000, triage: 8000, comment: 5000 };
const GIT_TIMEOUT_MS = 1000;
const MAX_SIBLINGS = 64;
const MAX_CANDIDATES = 40;
const COMMENT_MAX_BYTES = 4000;
const SHA_RE = /(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g;

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

/**
 * Evidence texts, newest first. Comments and journal entries are ordered by
 * time. `result` / `progress` carry no time: they are the assignee's newest
 * report, dated at the last journal entry, so only a comment later than that
 * entry outranks them.
 */
function evidencePieces(task) {
  const timed = [];
  const add = (text, time, rank) => {
    if (typeof text === 'string' && text) timed.push({ text, time, rank });
  };
  const journal = Array.isArray(task.journal) ? task.journal : [];
  let last = null;
  for (const j of journal) {
    const time = Number(j && j.at_ms) || 0;
    add(j && j.text, time, 0);
    if (!last || time >= last.time) last = { time, kind: j && j.kind };
  }
  for (const c of Array.isArray(task.comments) ? task.comments : []) {
    add(c && c.text, Date.parse(c && c.at) || 0, 0);
  }
  const reportTime = last ? last.time : Infinity;
  const progressNewer = Boolean(last) && last.kind === 'progress';
  add(task.result, reportTime, progressNewer ? 1 : 2);
  add(task.progress, reportTime, progressNewer ? 2 : 1);
  timed.sort((x, y) => (y.time === x.time ? y.rank - x.rank : y.time - x.time));
  return timed.map((p) => p.text);
}

/** Hex tokens in priority order: newest piece first, later in a piece first. */
function shaCandidates(task) {
  const seen = new Set();
  for (const text of evidencePieces(task)) {
    for (const token of (text.match(SHA_RE) || []).reverse()) seen.add(token);
  }
  return [...seen].slice(0, MAX_CANDIDATES);
}

function git(dir, args, deadline, input) {
  const left = deadline - Date.now();
  if (left <= 0) return null;
  const res = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    input,
    timeout: Math.min(GIT_TIMEOUT_MS, left),
    killSignal: 'SIGKILL',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  return res.error || res.status !== 0 ? null : res.stdout;
}

/** The cwd, then every sibling directory of its git toplevel that is a repo. */
function* repoDirs(cwd, deadline) {
  yield cwd;
  const top = (git(cwd, ['rev-parse', '--show-toplevel'], deadline) || '').trim();
  if (!top) return;
  const parent = path.dirname(top);
  let count = 0;
  for (const name of fs.readdirSync(parent).sort()) {
    const dir = path.join(parent, name);
    if (dir === top || !fs.existsSync(path.join(dir, '.git'))) continue;
    yield dir;
    if (++count >= MAX_SIBLINGS) return;
  }
}

/**
 * The highest-priority candidate that `<x>^{commit}` resolves in some repo,
 * as { sha: <40 hex>, repo }, or null. One `git cat-file --batch-check` per
 * repo resolves all candidates at once, so the cost does not grow with them.
 */
function resolveCommit(candidates, cwd) {
  if (!candidates.length) return null;
  const deadline = Date.now() + TIMEOUTS_MS.repoSearch;
  const input = candidates.map((c) => `${c}^{commit}\n`).join('');
  let best = null;
  for (const repo of repoDirs(cwd, deadline)) {
    const out = git(repo, ['cat-file', '--batch-check'], deadline, input);
    if (out === null) continue;
    const rows = out.split('\n');
    const limit = best ? best.index : candidates.length;
    for (let i = 0; i < limit; i++) {
      const [oid, type] = (rows[i] || '').split(' ');
      // The prefix test rejects a ref that merely looks like a sha.
      if (type === 'commit' && oid.startsWith(candidates[i])) {
        best = { index: i, sha: oid, repo };
        break;
      }
    }
    if (best && best.index === 0) break;
  }
  return best;
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
    timeout: TIMEOUTS_MS.show,
    killSignal: 'SIGKILL',
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
    script, '--task', taskId, '--sha', sha, '--accept', '--repo', repo, '--json',
  ], {
    encoding: 'utf8',
    timeout: TIMEOUTS_MS.triage,
    killSignal: 'SIGKILL',
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.error && res.error.code === 'ETIMEDOUT') return { reason: 'timeout' };
  if (res.error || (res.status !== 0 && res.status !== 1)) return { reason: 'finish_triage' };
  try {
    const result = JSON.parse(res.stdout);
    if (result && typeof result.status === 'string') return { result };
  } catch {
    /* not a result */
  }
  return { reason: 'finish_triage' };
}

function receiptText(result, sha) {
  const rows = result.rows || {};
  const receipt = result.receipt || {};
  const mark = (cell) => (cell && cell.ok ? 'PASS' : 'FAIL');
  const text = [
    'receipt (finish-triage):',
    `status=${result.status}`,
    `waiting_on=${result.waiting_on || 'none'}`,
    `commit=${sha}`,
    `merged=${mark(rows.merged)}`,
    `live=${mark(rows.live)}`,
    `used=${mark(result.cells && result.cells.used)}`,
    `test_count=${receipt.test_count ?? 'none'}`,
    `target=${receipt.target || 'none'}`,
  ].join(' ');
  // target is last and the only unbounded field; drop a split trailing character.
  const bytes = Buffer.from(text);
  if (bytes.length <= COMMENT_MAX_BYTES) return text;
  return bytes.subarray(0, COMMENT_MAX_BYTES).toString('utf8').replace(/\uFFFD+$/, '');
}

function postComment(taskId, text) {
  const fleetBin = process.env.FINISH_TRIAGE_FLEET_BIN || 'fleet';
  const res = spawnSync(fleetBin, ['task', 'comment', taskId, text], {
    encoding: 'utf8',
    timeout: TIMEOUTS_MS.comment,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.error && res.error.code === 'ETIMEDOUT') return 'timeout';
  return res.error || res.status !== 0 ? 'fleet_comment' : '';
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
  try {
    const reason = writeReceipt(taskId, payload.cwd || process.cwd());
    if (reason) audit(taskId, reason);
  } catch {
    audit(taskId, 'internal');
  }
}

/** Returns the audit reason on failure, '' when done or not applicable. */
function writeReceipt(taskId, cwd) {
  const shown = showTask(taskId);
  if (!shown.ok) return shown.reason;
  if (!carriesPlanPhase(shown.task)) return '';
  const commit = resolveCommit(shaCandidates(shown.task), cwd);
  if (!commit) return 'no_sha';
  const triage = runTriage(taskId, commit.sha, commit.repo);
  if (triage.reason) return triage.reason;
  return postComment(taskId, receiptText(triage.result, commit.sha));
}

if (require.main === module) {
  try {
    main();
  } catch {
    /* fail open, silent */
  }
  process.exit(0);
}

module.exports = { TIMEOUTS_MS };
