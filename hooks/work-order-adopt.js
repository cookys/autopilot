#!/usr/bin/env node
'use strict';

/**
 * work-order-adopt.js — Opt-in PostToolUse hook (stem `work-order-adopt`).
 *
 * Fires on `mcp__fleet__task_progress` and on `Bash` commands invoking
 * `fleet task progress <id>`. Runs `scripts/work-order-adopt.js --task <id> --session-id <sid>`
 * when `<id>` differs from the live session marker's `fleet_task_id`, OR when
 * `fleet_task_id === <id>` has no `stage` yet (e.g. a killed earlier run).
 *
 * Contract:
 *   - Default-off; self-gated via hooks/_shared/opt-in.js (`isEnabled('work-order-adopt')`).
 *   - Never blocks, never writes to stdout, always exits 0 on any error.
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isEnabled } = require('./_shared/opt-in');
const sessionMode = require('../scripts/session-mode');

const OPT_IN_STEM = 'work-order-adopt';
const ADOPT_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'work-order-adopt.js');
const FLEET_TASK_ID_MAX = 64;

// Matches `fleet task progress <id>` at start of command or after shell separators/env assignments.
const BASH_FLEET_PROGRESS_RE =
  /(?:^|[;&|\n]\s*|(?:&&|\|\|)\s*)(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)*(?:['"]?[^\s'";&|]*\/)?fleet['"]?\s+task\s+progress\s+(['"]?)([^\s'";&|]+)\1/u;

function isValidTaskId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    !id.startsWith('-') &&
    !/\s/u.test(id) &&
    [...id].length <= FLEET_TASK_ID_MAX
  );
}

function extractTaskId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.is_error === true) return null;

  const toolName = payload.tool_name;
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};

  if (toolName === 'mcp__fleet__task_progress') {
    const raw = input.task_id ?? input.id ?? input.taskId ?? input.task;
    const id = typeof raw === 'string' ? raw.trim() : '';
    return isValidTaskId(id) ? id : null;
  }

  if (toolName === 'Bash') {
    const cmd = typeof input.command === 'string' ? input.command : '';
    if (!cmd) return null;
    const m = BASH_FLEET_PROGRESS_RE.exec(cmd);
    if (!m) return null;
    const id = m[2].trim();
    return isValidTaskId(id) ? id : null;
  }

  return null;
}

function defaultRunAdopt({ taskId, sessionId, cwd }) {
  const args = [ADOPT_SCRIPT, '--task', taskId];
  if (sessionId) args.push('--session-id', sessionId);
  const res = spawnSync(process.execPath, args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    timeout: 4500,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (res.stderr) {
    try {
      process.stderr.write(res.stderr);
    } catch {
      /* ignore stderr pipe errors */
    }
  }
  return res;
}

function handle(payload, opts = {}) {
  if (!isEnabled(OPT_IN_STEM)) {
    return { adopted: false, reason: 'opt_in_off' };
  }
  const taskId = extractTaskId(payload);
  if (!taskId) {
    return { adopted: false, reason: 'not_task_progress' };
  }

  const payloadSid =
    payload && typeof payload.session_id === 'string' && payload.session_id.trim()
      ? payload.session_id.trim()
      : undefined;
  const target = sessionMode.resolveMarkerWriteTarget({ payloadId: payloadSid });
  if (target.refused || !target.id) {
    return { adopted: false, reason: 'unresolved_session' };
  }

  const current = sessionMode.readSessionRecord(target.id);
  if (
    current &&
    current.fleet_task_id === taskId &&
    typeof current.stage === 'string' &&
    current.stage.length > 0
  ) {
    return { adopted: false, reason: 'same_task_id' };
  }

  const cwd = payload && typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const runner = typeof opts.runAdopt === 'function' ? opts.runAdopt : defaultRunAdopt;
  runner({ taskId, sessionId: target.id, cwd });
  return { adopted: true, taskId, sessionId: target.id };
}

function main() {
  try {
    if (!isEnabled(OPT_IN_STEM)) return;
    let raw = '';
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch {
      return;
    }
    if (!raw || !raw.trim()) return;
    const payload = JSON.parse(raw);
    handle(payload);
  } catch {
    // Fail-open: never block, never emit stdout, always exit 0.
  }
}

if (require.main === module) {
  main();
  process.exit(0);
}

module.exports = {
  OPT_IN_STEM,
  extractTaskId,
  handle,
};
