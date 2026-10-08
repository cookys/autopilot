#!/usr/bin/env node
/**
 * cost-fuse — PreToolUse Bash|Edit|Write|MultiEdit|NotebookEdit (default-on; v2.35.16)
 *
 * Deliverable P3 of docs/plans/_archive/2026/09/2026-09-04-default-dispatch-topology.md:
 * A PreToolUse hook that fuses brain-tier (fable/opus) implementation-shaped tool calls
 * once today's brain spend crosses a threshold, so a brain-tier session is nudged to
 * brief and dispatch to hands instead of implementing itself.
 * Warn-mode default-on; never block by default.
 *
 * Inputs:
 * - Ledger path: process.env.AUTOPILOT_COSTS_FILE else path.join(os.homedir(), '.claude', 'metrics', 'costs.jsonl')
 * - Model tier: require('../scripts/cost-digest.js').tierOf(model)
 * - Config: ~/.autopilot/config.json key cost_fuse: {"mode": "warn"|"block"|"off", "daily_usd_brain": 150, "tiers": ["brain"]}
 * - Env overrides: AUTOPILOT_COST_FUSE_MODE (block|warn|off), AUTOPILOT_COST_FUSE_DAILY_USD (positive number)
 * - Fail-open: any internal error => process.exit(0)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { tierOf } = require('../scripts/cost-digest.js');
// One shared implementation of config resolution + today's tier spend (scripts/lib/brain-spend.js; the runs watcher reads it too).
const { loadCostFuseConfig, safe, sumTodayTierSpend } = require('../scripts/lib/brain-spend.js');

const DEFAULT_DAILY_USD_BRAIN = 150; // the hook's own default; passed to the shared resolver (case7 of cost-fuse.test.sh mutates this literal)

function loadConfig() {
  return loadCostFuseConfig({ env: process.env, home: os.homedir(), defaultDailyUsdBrain: DEFAULT_DAILY_USD_BRAIN });
}

function stateDir() {
  return process.env.AUTOPILOT_COST_FUSE_DIR || path.join(os.homedir(), '.autopilot', 'cost-fuse');
}

function stateFile(sessionId) {
  return path.join(stateDir(), `${safe(sessionId)}.json`);
}

function todayUtcDay() {
  return new Date().toISOString().slice(0, 10);
}

function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && typeof s === 'object' && Number.isInteger(s.warned_multiple)) {
      if (typeof s.day === 'string' && s.day === todayUtcDay()) {
        return s;
      }
      // Stale (or day-less legacy) state from a previous UTC day: reset the
      // multiple so a session that warned yesterday can warn again today.
      return { warned_multiple: 0, day: todayUtcDay() };
    }
  } catch {
    // fresh
  }
  return { warned_multiple: 0, day: todayUtcDay() };
}

function saveState(file, st) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, file);
}

function withLock(file, fn) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 2000;
  for (;;) {
    let fd = null;
    try {
      fd = fs.openSync(lock, 'wx');
      try { return fn(); } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch { /* gone */ } }
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > 5000) { fs.unlinkSync(lock); continue; }
      } catch { /* vanished */ }
      if (Date.now() > deadline) return fn(); // fail-open: run without lock rather than hang
      const until = Date.now() + 15;
      while (Date.now() < until) { /* spin briefly */ }
    }
  }
}

function emit(decision, reason) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  })}\n`);
}

/**
 * Small allowlist for read-only Bash commands.
 * This is intentionally NOT a full parser.
 */
function isReadOnlyBash(cmd) {
  if (typeof cmd !== 'string') return false;
  const trimmed = cmd.trim();
  if (!trimmed) return true;

  // BEFORE any allowlist match: reject anything that could chain, redirect,
  // substitute, or hide a second command — this is intentionally NOT a full
  // parser, just a conservative bail-out.
  if (/[;&|><`]/.test(trimmed)) return false;
  if (trimmed.includes('$(')) return false;
  if (/\bsed\b[^\n]*(^|\s)-i\b/.test(trimmed)) return false;
  const nonBlankLines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  if (nonBlankLines.length > 1) return false;

  // Patterns specified in requirements:
  // - git status|log|diff|show|rev-parse|branch (as first two tokens)
  // - ls, cat, sed -n, grep, rg, head, tail, wc
  // - node <path-not-starting-with-dash> ... --check (a -e anywhere disqualifies)
  // - bash scripts/*-check*
  // - bash hooks/tests/*.test.sh

  if (/^node\s+/.test(trimmed) && /--check\b/.test(trimmed) && !/(^|\s)-e(\s|$)/.test(trimmed)) {
    const rest = trimmed.slice(trimmed.indexOf('node') + 'node'.length).trim();
    const firstTok = rest.split(/\s+/)[0] || '';
    if (firstTok && !firstTok.startsWith('-')) return true;
  }
  if (/^bash\s+scripts\/[^\s]*check[^\s]*/.test(trimmed)) return true;
  if (/^bash\s+hooks\/tests\/[^\s]*\.test\.sh\b/.test(trimmed)) return true;

  // Single-line at this point (multi-line already rejected above).
  const tokens = trimmed.split(/\s+/);
  const t0 = tokens[0];
  const t1 = tokens[1] || '';

  if (t0 === 'git') {
    const gitReadOnly = ['status', 'log', 'diff', 'show', 'rev-parse', 'branch'];
    if (gitReadOnly.includes(t1)) return true;
  }

  if (['ls', 'cat', 'grep', 'rg', 'head', 'tail', 'wc'].includes(t0)) {
    return true;
  }

  if (t0 === 'sed' && t1 === '-n') {
    return true;
  }

  return false;
}

function resolveSessionModel(payload, costsFile) {
  // 1. Read payload.transcript_path, parse from end (capped at 512 KiB) —
  //    the latest assistant message.model reflects a mid-session model
  //    switch (opus<->sonnet etc.) that the Stop-written ledger row can't.
  const tpath = payload.transcript_path;
  if (tpath && fs.existsSync(tpath)) {
    try {
      const stat = fs.statSync(tpath);
      const cap = 512 * 1024;
      const sizeToRead = Math.min(stat.size, cap);
      const startPos = stat.size - sizeToRead;
      const buf = Buffer.alloc(sizeToRead);
      const fd = fs.openSync(tpath, 'r');
      try {
        fs.readSync(fd, buf, 0, sizeToRead, startPos);
      } finally {
        fs.closeSync(fd);
      }
      const text = buf.toString('utf8');
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj && obj.message && obj.message.model) {
            return obj.message.model;
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Fall back to costs.jsonl (the Stop-written ledger row) only when the
  //    transcript yields nothing.
  const targetSession = payload.session_id;
  if (costsFile && fs.existsSync(costsFile) && targetSession) {
    try {
      const content = fs.readFileSync(costsFile, 'utf8');
      const lines = content.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const row = JSON.parse(line);
          if (row && row.session === targetSession && row.model) {
            return row.model;
          }
        } catch {
          // ignore malformed line
        }
      }
    } catch {
      // ignore read error
    }
  }

  return null;
}

/**
 * A single dispatch-rail invocation (`[bash|node] .../scripts/dispatch-*.{sh,js}`, optional
 * trailing redirects / `&`): that command IS the move the fuse asks for (hand the work to a
 * cheaper engine), so it must not trip the fuse. Anything chained (`;`, `&&`, `||`, pipes,
 * substitution, a bare `&`, newlines) is not exempt. Applied in WARN mode only (see main):
 * shell grammar cannot be made bypass-proof by regex, so block mode exempts nothing.
 */
function isDispatchBash(cmd) {
  if (typeof cmd !== 'string') return false;
  const t = cmd.trim();
  if (!t || /[;`|\n]|&&|\$\(|[<>]\(/.test(t)) return false;
  // A bare `&` chains a second command; only redirect forms (`2>&1`, `&>`) and ONE trailing
  // backgrounding `&` are tolerated.
  const noRedir = t.replace(/\d*>&\d+/g, '').replace(/&>>?/g, '').replace(/\s*&\s*$/, '');
  if (noRedir.includes('&')) return false;
  return /^(?:(?:bash|node)\s+)?\S*scripts\/dispatch-[A-Za-z0-9._-]+\.(?:sh|js)(?:\s|$)/.test(t);
}

(function main() {
  try {
    const cfg = loadConfig();
    if (cfg.mode === 'off') {
      process.exit(0);
    }

    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = ''; }
    let payload = {};
    try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { process.exit(0); }
    if (!payload || typeof payload !== 'object') {
      process.exit(0);
    }

    const costsFile = process.env.AUTOPILOT_COSTS_FILE || path.join(os.homedir(), '.claude', 'metrics', 'costs.jsonl');
    if (!fs.existsSync(costsFile)) {
      process.exit(0);
    }

    const sessionModel = resolveSessionModel(payload, costsFile);
    if (!sessionModel) {
      process.exit(0);
    }

    const sessionTier = tierOf(sessionModel);
    const tiersSet = new Set(cfg.tiers);
    if (!tiersSet.has(sessionTier)) {
      // Not in configured tiers (e.g. hands/sonnet) -> allow silently
      process.exit(0);
    }

    const todaySpend = sumTodayTierSpend(costsFile, tiersSet);
    const thisSessionId = payload.session_id || process.env.AUTOPILOT_SESSION_ID
      || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
    const sessionSpend = thisSessionId ? sumTodayTierSpend(costsFile, tiersSet, thisSessionId) : 0;
    const threshold = cfg.daily_usd_brain;

    if (todaySpend < threshold) {
      // Under threshold -> allow silently
      process.exit(0);
    }

    // Over threshold! Check if tool is read-only Bash
    const toolName = payload.tool_name || '';
    const toolInput = payload.tool_input || {};
    if (toolName === 'Bash' && (isReadOnlyBash(toolInput.command) || (cfg.mode === 'warn' && isDispatchBash(toolInput.command)))) {
      process.exit(0);
    }

    const reason = `cost-fuse: brain-tier spend today: this session $${sessionSpend.toFixed(2)} / host today $${todaySpend.toFixed(2)} (≥ $${threshold} on this host) — brief the change and dispatch it to hands (model: sonnet|haiku, or the hetero ladder); read-only commands stay allowed; AUTOPILOT_COST_FUSE_MODE=off to override`;

    if (cfg.mode === 'block') {
      emit('deny', reason);
      process.exit(0);
    }

    if (cfg.mode === 'warn') {
      const sessionId = payload.session_id || process.env.AUTOPILOT_SESSION_ID
        || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || 'session';
      const file = stateFile(sessionId);
      fs.mkdirSync(path.dirname(file), { recursive: true });

      const currentMultiple = Math.floor(todaySpend / threshold);
      withLock(file, () => {
        const st = loadState(file);
        if (currentMultiple > st.warned_multiple) {
          process.stderr.write(`${reason}\n`);
          process.stdout.write(`${JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              additionalContext: `${reason}`,
            },
          })}\n`);
          st.warned_multiple = currentMultiple;
          saveState(file, st);
        }
      });
      // Mode warn allows the tool call
      process.exit(0);
    }

    process.exit(0);
  } catch {
    process.exit(0); // fail-open
  }
})();
