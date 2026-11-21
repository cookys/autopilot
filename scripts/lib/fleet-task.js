'use strict';

/**
 * fleet-task.js — fleet task verbs: show task JSON, emit one progress line, or mark a task blocked on a target.
 *
 *   show(taskId, { timeoutMs })       ->  { ok: true, task, stdout } | { ok: false, status, timedOut, error }
 *   progress(taskId, text)            ->  { ok: true } | { ok: false, status, error }   (`task update <id> <text>`, used by stage-advance)
 *   blocked(taskId, blockedOn, note)  ->  { ok: true } | { ok: false, status, error }
 *   dispatchEnding(taskId, {role, runId, status, sha, log}, {timeoutMs})
 *                                     ->  progress line `[dispatch:<role>] <run_id> <status> sha=<sha|-> log=<path|->`; used by the
 *                                         SubagentStop / TaskStop write-back hook (short timeout, caller swallows failure)
 *   ownerAddress()                    ->  'ns/courier/member' | null
 *
 * Binary: FLEET_BIN, or `fleet` on PATH when that is unset.
 * Verb: `fleet task progress <id> blocked --blocked-on <target> [note]`; target is a member address, a `d-xxxxxxxx`
 * card id or a task id, anything else is refused by fleet with `blocked_on_invalid` (surfaced as the error).
 * Owner address, in order: (1) env FLEET_ADDRESS (any `@session` suffix stripped: --blocked-on takes the bare seat);
 * (2) when CLAUDE_CODE_SESSION_ID is set, `fleet whoami --session <id>` exit 0 -> first stdout line, which must be a
 * `ns/courier/member` triple (stderr, e.g. a courier socket mismatch notice, is ignored; exit 2 `session_unknown` / 3 courier
 * unreachable -> unavailable). Plain `fleet whoami` is not used: from a shell it only ever reports the CLI's own identity
 * (member `fleet-cli`), never the session's seat. null when neither gives a triple (never guessed).
 * Tests point FLEET_BIN at a stub. This module never sends a message.
 * Node >= 20.10, built-ins only.
 */

const { spawnSync } = require('child_process');

function bin() {
  return process.env.FLEET_BIN || 'fleet';
}

function run(args, timeoutMs = 15000) {
  const r = spawnSync(bin(), args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) {
    const timedOut = r.error.code === 'ETIMEDOUT';
    return {
      ok: false,
      status: null,
      timedOut,
      error: timedOut ? `timed out after ${timeoutMs}ms` : r.error.message,
    };
  }
  if (r.signal) {
    return { ok: false, status: null, timedOut: false, error: `signal ${r.signal}` };
  }
  if (r.status !== 0) {
    const detail = (r.stderr || '').trim().split('\n')[0];
    return { ok: false, status: r.status, timedOut: false, error: detail || `exit ${r.status}`, stdout: r.stdout };
  }
  return { ok: true, stdout: r.stdout };
}

function show(taskId, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 1500;
  const r = run(['task', 'show', String(taskId), '--json'], timeoutMs);
  if (!r.ok) return r;
  let task;
  try {
    task = JSON.parse(r.stdout || '');
  } catch (err) {
    return { ok: false, status: 0, timedOut: false, error: `invalid JSON (${err.message})` };
  }
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return { ok: false, status: 0, timedOut: false, error: 'invalid task JSON object' };
  }
  return { ok: true, task, stdout: r.stdout };
}

function progress(taskId, text) {
  return run(['task', 'update', String(taskId), String(text)]);
}

function oneToken(v) {
  const t = String(v == null ? '' : v).trim().replace(/\s+/g, '_');
  return t || '-';
}

function dispatchEnding(taskId, { role, runId, status, sha, log } = {}, { timeoutMs = 3000 } = {}) {
  const text = `[dispatch:${oneToken(role)}] ${oneToken(runId)} ${oneToken(status)} sha=${oneToken(sha)} log=${oneToken(log)}`;
  return run(['task', 'update', String(taskId), text], timeoutMs);
}

function blocked(taskId, blockedOn, note) {
  const args = ['task', 'progress', String(taskId), 'blocked', '--blocked-on', String(blockedOn)];
  if (note) args.push(String(note));
  return run(args);
}

const ADDR_RE = /^[^/\s]+\/[^/\s]+\/[^/\s]+$/;

function whoamiSession(sid, { binPath = bin(), timeoutMs = 3000, env = process.env } = {}) {
  const s = String(sid || '').trim();
  if (!s) return { ok: false, reason: 'no_session', address: null };
  const r = spawnSync(binPath, ['whoami', '--session', s], {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  if (r.error) {
    return { ok: false, reason: 'error', address: null };
  }
  if (r.signal || r.status !== 0) {
    return { ok: false, reason: r.status === 2 ? 'session_unknown' : 'unresolved', status: r.status, address: null };
  }
  const first = (r.stdout || '').split('\n')[0].trim().replace(/@.*$/, '');
  if (ADDR_RE.test(first)) {
    return { ok: true, reason: 'ok', address: first };
  }
  return { ok: false, reason: 'unresolved', status: 0, address: null };
}

function ownerAddress() {
  const env = (process.env.FLEET_ADDRESS || '').trim().replace(/@.*$/, '');
  if (ADDR_RE.test(env)) return env;
  const r = whoamiSession(process.env.CLAUDE_CODE_SESSION_ID);
  return r.ok ? r.address : null;
}

module.exports = { show, progress, dispatchEnding, blocked, ownerAddress, whoamiSession, bin };
