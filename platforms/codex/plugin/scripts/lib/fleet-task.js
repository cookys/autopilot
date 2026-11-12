'use strict';

/**
 * fleet-task.js — append one progress line to a fleet task.
 *
 *   progress(taskId, text)  ->  { ok: true } | { ok: false, status, error }
 *
 * Binary: FLEET_BIN, or `fleet` on PATH when that is unset.
 * Verb, from a read-only `$FLEET_BIN task --help` (never a send): `task update <id> <progress...>`
 * ("assignee only; progress only"). `task progress <id> <blocked_human|running>` is a state report,
 * the same shape as the MCP `task_progress` tool, and cannot carry an arbitrary line.
 * Tests point FLEET_BIN at a stub. This module never sends a message.
 * Node >= 20.10, built-ins only.
 */

const { spawnSync } = require('child_process');

function bin() {
  return process.env.FLEET_BIN || 'fleet';
}

function progress(taskId, text) {
  const r = spawnSync(bin(), ['task', 'update', String(taskId), String(text)], { encoding: 'utf8' });
  if (r.error) return { ok: false, status: null, error: r.error.message };
  if (r.status !== 0) {
    const detail = (r.stderr || '').trim().split('\n')[0];
    return { ok: false, status: r.status, error: detail || `exit ${r.status}` };
  }
  return { ok: true };
}

module.exports = { progress, bin };
