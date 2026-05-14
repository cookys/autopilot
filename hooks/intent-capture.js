#!/usr/bin/env node
/**
 * intent-capture — PostToolUse/.* hook (Tier A, v2.7.2+)
 *
 * Writes rolling "last intent" sibling file (not in transcript → survives
 * compact). SessionStart reads this for cross-session resume hints.
 *
 * File layout: ~/.autopilot/intent/<sha1(realpath($PWD))>.json
 * - Per-cwd to avoid multi-session race
 * - chmod 600 on file + 0700 on parent dir
 *
 * Self-disable:
 * - Env opt-out: AUTOPILOT_INTENT_CAPTURE=false → skip
 * - Circuit breaker: 10 consecutive fails → write intent-capture.disabled flag
 * - Auto-clear: flag is cleared if (a) plugin version differs from flag's
 *   stamp, (b) flag mtime > 24h, OR (c) user manually `rm`s it
 *
 * Fail-open: exit 0 always (matches large-file-warner / log-error /
 * reload-watch / accumulator convention).
 *
 * Inspired by autopilot/hooks/accumulator.js (state pattern) +
 * claude-powerloop-plugin sibling-file approach.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// === Constants ===
const STATE_DIR = path.join(os.homedir(), '.autopilot');
const INTENT_DIR = path.join(STATE_DIR, 'intent');
const DISABLE_FLAG = path.join(STATE_DIR, 'intent-capture.disabled');
const FAILURE_COUNTER = path.join(STATE_DIR, '.intent-capture-failures');
const FAILURE_THRESHOLD = 10;
const STALE_DISABLE_HOURS = 24;
const SESSION_TOOL_COUNTER_PREFIX = path.join(os.tmpdir(), 'claude-intent-tool-count-');

// === Helpers ===

function getPluginVersion() {
  try {
    const pkgRoot = process.env.CLAUDE_PLUGIN_ROOT;
    if (!pkgRoot) return 'unknown';
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getSessionId() {
  const raw = process.env.CLAUDE_SESSION_ID || '';
  if (raw) return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function getGitBranch() {
  try {
    const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      timeout: 1000, encoding: 'utf8', cwd: process.cwd(),
    });
    return (r.stdout || '').trim() || null;
  } catch {
    return null;
  }
}

function canonicalCwd() {
  try {
    return fs.realpathSync(process.cwd());
  } catch {
    return process.cwd();
  }
}

function intentFileFor(cwd) {
  const hash = crypto.createHash('sha1').update(cwd).digest('hex');
  return path.join(INTENT_DIR, `${hash}.json`);
}

function readFailureCount() {
  try {
    return parseInt(fs.readFileSync(FAILURE_COUNTER, 'utf8').trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function writeFailureCount(n) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(FAILURE_COUNTER, String(n), { mode: 0o600 });
  } catch { /* ignore */ }
}

function checkDisableFlag() {
  // Returns true if hook should skip (flag active and not auto-clearable)
  try {
    if (!fs.existsSync(DISABLE_FLAG)) return false;

    const stat = fs.statSync(DISABLE_FLAG);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

    // Auto-clear: stale (>24h)
    if (ageHours > STALE_DISABLE_HOURS) {
      try { fs.unlinkSync(DISABLE_FLAG); } catch { /* ignore */ }
      return false;
    }

    // Auto-clear: version differs
    try {
      const content = JSON.parse(fs.readFileSync(DISABLE_FLAG, 'utf8'));
      const currentVersion = getPluginVersion();
      if (content.plugin_version && content.plugin_version !== currentVersion) {
        try { fs.unlinkSync(DISABLE_FLAG); } catch { /* ignore */ }
        return false;
      }
    } catch { /* malformed flag — leave active */ }

    return true;
  } catch {
    return false;
  }
}

function writeDisableFlag(reason) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const content = {
      disabled_at: new Date().toISOString(),
      reason,
      plugin_version: getPluginVersion(),
      manual_reset: `rm ${DISABLE_FLAG}`,
    };
    fs.writeFileSync(DISABLE_FLAG, JSON.stringify(content, null, 2), { mode: 0o600 });
    process.stderr.write(`[intent-capture] disabled after ${FAILURE_THRESHOLD} consecutive failures — see ${DISABLE_FLAG}\n`);
  } catch { /* nothing more we can do */ }
}

function summarizeToolInput(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return toolName;
  // Best-effort short summary
  const candidates = ['file_path', 'pattern', 'command', 'description', 'prompt', 'query', 'url'];
  for (const key of candidates) {
    if (toolInput[key]) {
      const v = String(toolInput[key]);
      return `${toolName} ${v.length > 80 ? v.slice(0, 77) + '...' : v}`;
    }
  }
  return toolName;
}

function getToolCount(sessionId) {
  try {
    const f = SESSION_TOOL_COUNTER_PREFIX + sessionId;
    let n = 0;
    try { n = parseInt(fs.readFileSync(f, 'utf8'), 10) || 0; } catch { /* first */ }
    n++;
    fs.writeFileSync(f, String(n));
    return n;
  } catch {
    return 0;
  }
}

function atomicWrite(target, content, mode = 0o600) {
  const tmp = target + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, content, { mode });
  fs.renameSync(tmp, target);
  try { fs.chmodSync(target, mode); } catch { /* ignore */ }
}

// === Main ===

(function main() {
  try {
    // Always consume stdin (required even if unused)
    let toolName = '<unknown>';
    let toolInput = {};
    try {
      const stdin = fs.readFileSync('/dev/stdin', 'utf8');
      if (stdin.trim()) {
        const input = JSON.parse(stdin);
        toolName = input.tool_name || '<unknown>';
        toolInput = input.tool_input || {};
      }
    } catch { /* parse fail → still try to write minimal record */ }

    // Env opt-out
    if (process.env.AUTOPILOT_INTENT_CAPTURE === 'false') return process.exit(0);

    // Disable flag check (with auto-clear logic)
    if (checkDisableFlag()) return process.exit(0);

    // Ensure dirs
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(INTENT_DIR)) fs.mkdirSync(INTENT_DIR, { recursive: true, mode: 0o700 });

    const cwd = canonicalCwd();
    const sessionId = getSessionId();
    const intent = {
      session_id: sessionId,
      hostname: os.hostname(),
      last_updated: new Date().toISOString(),
      last_tool: toolName,
      last_tool_input_summary: summarizeToolInput(toolName, toolInput),
      tool_count_session: getToolCount(sessionId),
      cwd,
      git_branch: getGitBranch(),
    };

    atomicWrite(intentFileFor(cwd), JSON.stringify(intent, null, 2) + '\n', 0o600);

    // Reset failure counter on success
    writeFailureCount(0);
  } catch (err) {
    // Increment failure counter; engage circuit breaker if threshold hit
    const failures = readFailureCount() + 1;
    writeFailureCount(failures);
    if (failures >= FAILURE_THRESHOLD) {
      writeDisableFlag(`${failures} consecutive failures: ${err.message}`);
    }
    // Fail-open
  }
  process.exit(0);
})();
