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

// === Pure helpers + invariants extracted to intent-capture-lib.js ===
// (2026-06-01 v2.7.5 test-suite ship). Wrapper owns all fs/process IO; the
// lib is unit-tested directly.
const lib = require('./intent-capture-lib.js');
const {
  summarizeToolInput,
  disableFlagDecision,
  FAILURE_THRESHOLD,
  STALE_DISABLE_HOURS,
} = lib;
const { normalizeClaudeHookEvent } = require('../src/hooks/normalize/claude');
const { buildIntentCaptureRecord } = require('../src/hooks/handlers/intent-capture');

// === Constants ===
const STATE_DIR = path.join(os.homedir(), '.autopilot');
const INTENT_DIR = path.join(STATE_DIR, 'intent');
const DISABLE_FLAG = path.join(STATE_DIR, 'intent-capture.disabled');
const FAILURE_COUNTER = path.join(STATE_DIR, '.intent-capture-failures');
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

function sanitizeSessionId(raw) {
  if (raw) return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return null;
}

function getSessionId() {
  const envSession = sanitizeSessionId(process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '');
  if (envSession) return envSession;
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function getGitBranch() {
  try {
    // Walk up from cwd looking for .git — skip spawn if not a git repo
    let dir = process.cwd();
    let found = false;
    for (let i = 0; i < 10; i++) { // bounded climb
      if (fs.existsSync(path.join(dir, '.git'))) { found = true; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!found) return null;
    const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      timeout: 250, encoding: 'utf8', cwd: process.cwd(),
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
  // Returns true if hook should skip (flag active and not auto-clearable).
  // Decision logic lives in lib.disableFlagDecision (unit-tested); this wrapper
  // does the fs side: stat the flag, read its content, act on the decision.
  try {
    if (!fs.existsSync(DISABLE_FLAG)) return false;

    const stat = fs.statSync(DISABLE_FLAG);
    let flagContentJson = null;
    try { flagContentJson = fs.readFileSync(DISABLE_FLAG, 'utf8'); } catch { /* leave null */ }

    const decision = disableFlagDecision({
      mtimeMs: stat.mtimeMs,
      nowMs: Date.now(),
      flagContentJson,
      currentVersion: getPluginVersion(),
      staleHours: STALE_DISABLE_HOURS,
    });

    if (decision === 'clear_stale' || decision === 'clear_version' || decision === 'clear_malformed') {
      try { fs.unlinkSync(DISABLE_FLAG); } catch { /* ignore */ }
      return false;
    }
    return decision === 'active';
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

// summarizeToolInput is imported from intent-capture-lib.js at module top.

function getToolCount(sessionId) {
  try {
    const f = SESSION_TOOL_COUNTER_PREFIX + sessionId;
    let n = 0;
    try { n = parseInt(fs.readFileSync(f, 'utf8'), 10) || 0; } catch { /* first */ }
    n++;
    fs.writeFileSync(f, String(n), { mode: 0o600 });
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
    let toolSource = 'stdin';
    let rawPayload = null;
    try {
      const stdin = fs.readFileSync('/dev/stdin', 'utf8');
      if (stdin.trim()) {
        const input = JSON.parse(stdin);
        rawPayload = input;
        toolName = input.tool_name || '<unknown>';
        toolInput = input.tool_input || {};
      }
    } catch { /* parse fail → still try to write minimal record */ }

    // stdin pipe is broken for PreToolUse/PostToolUse hooks (ENXIO; upstream
    // #6305) — when it yields nothing, recover the tool from the session
    // transcript JSONL. PostToolUse only: the tool has run, so its entry exists.
    if (toolName === '<unknown>') {
      try {
        const { readLatestToolEvent } = require('./transcript-reader-lib.js');
        const ev = readLatestToolEvent({ env: process.env });
        if (ev && ev.tool_name) {
          toolName = ev.tool_name;
          toolInput = ev.tool_input || {};
          rawPayload = {
            tool_name: toolName,
            tool_input: toolInput,
          };
          toolSource = 'transcript';
        }
      } catch { /* fail-open — transcript-reader is itself fail-open */ }
    }

    // Env opt-out
    if (process.env.AUTOPILOT_INTENT_CAPTURE === 'false') return process.exit(0);

    // Disable flag check (with auto-clear logic)
    if (checkDisableFlag()) return process.exit(0);

    // Ensure dirs
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(INTENT_DIR)) fs.mkdirSync(INTENT_DIR, { recursive: true, mode: 0o700 });

    const cwd = canonicalCwd();
    const sessionId = getSessionId();
    const nowIso = new Date().toISOString();
    const event = normalizeClaudeHookEvent(rawPayload || {
      tool_name: toolName,
      tool_input: toolInput,
    }, {
      env: process.env,
      hookEventName: 'PostToolUse',
      cwd,
      sessionId,
      nowIso,
    });
    event.input_source = toolSource;
    event.session_id = sanitizeSessionId(event.session_id) || sessionId;
    const intent = buildIntentCaptureRecord({
      event,
      fallbackSessionId: sessionId,
      hostname: os.hostname(),
      nowIso,
      toolCount: getToolCount(event.session_id),
      gitBranch: getGitBranch(),
      summarizeToolInput,
    });

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
