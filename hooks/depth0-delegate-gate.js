#!/usr/bin/env node
/**
 * depth0-delegate-gate — PreToolUse WebFetch|WebSearch|Read|Grep|Glob|Bash|Agent|Task|Skill
 * (default-on, v2.36.1 P3)
 *
 * Nudges DEPTH-0 (never a subagent — skip whenever the payload carries `agent_id`, SPIKE-1)
 * away from doing its own long read bursts instead of delegating to an Explore/survey
 * subagent. Companion to foreman-guard.js (which governs depth-1 foremen/workers); this one
 * governs the orchestrator itself and is deliberately NOT bound to the l3-l6 session marker
 * — a plain session doing 30 sequential Reads is exactly the pattern this nudges.
 *
 * TOOL CLASSES:
 *   - read-class: WebFetch, WebSearch, Read, Grep, Glob, plus a Bash call whose EXECUTABLE
 *     TEXT (heredoc bodies and `#` comments stripped, same lexer as foreman-guard.js) starts
 *     with `grep `, `rg `, `find `, `cat `, `sed -n`, `head `, or `tail `. Increments the
 *     per-session `reads` counter.
 *   - delegation: Agent, Task, Skill — resets `reads` to 0 (the read burst was handed off).
 *   - anything else (e.g. Bash `npm test`, Edit, Write): no-op, counter untouched.
 *
 * WARN (default mode): at `reads >= threshold` and every `threshold` calls after, one
 * stderr line naming the count; exit 0 always (a nudge, never enforcement without a live
 * model in `block` mode).
 *
 * BLOCK: only when the CURRENT model is fresh (statusline live main file, schema_version 1,
 * written_at within 120s) and its family (scripts/lib/live-state-dir.js modelFamily) is in
 * `guarded_models`, deny at `reads >= 2*threshold` (every call past that point) with the
 * same JSON shape foreman-guard.js emits. Without a live file the model is `unknown` — never
 * blocks, only warns (§2.6: this is new stderr by design).
 *
 * MODES: ~/.autopilot/config.json {"depth0_delegate_gate": {"mode": "off"|"warn"|"block",
 * "threshold": 8, "guarded_models": ["fable","opus"]}} or AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE.
 * Garbage/unrecognised mode ⇒ warn (the default). Fail-open: any internal error ⇒ exit 0.
 * State: `<live-dir>/depth0-gate/<sid>.json` (+ AUTOPILOT_DEPTH0_GATE_DIR override), same
 * live-dir resolution as every other v2.36.1 consumer (scripts/lib/live-state-dir.js).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveLiveDir, sanitizeSessionId, readLive, modelFamily } = require('../scripts/lib/live-state-dir.js');

const DEFAULT_THRESHOLD = 8;
const DEFAULT_GUARDED = ['fable', 'opus'];
const READ_CLASS_TOOLS = new Set(['WebFetch', 'WebSearch', 'Read', 'Grep', 'Glob']);
const DELEGATION_TOOLS = new Set(['Agent', 'Task', 'Skill']);
// Executable-text prefixes (post-strip, trimmed) that make a Bash call read-class.
const BASH_READ_PREFIXES = ['grep ', 'rg ', 'find ', 'cat ', 'sed -n', 'head ', 'tail '];

// Same executable-text lexer as foreman-guard.js (heredoc bodies + `#` comments are DATA,
// quoted strings stay because `bash -c '…'`/`sh -c "…"` execute them). Deliberately
// duplicated rather than imported — single-crash isolation between the two hooks.
function executableText(cmd) {
  const out = [];
  const lines = String(cmd).split('\n');
  let heredocTag = null;
  for (const line of lines) {
    if (heredocTag !== null) {
      if (line.replace(/^\t+/, '') === heredocTag) heredocTag = null;
      continue; // heredoc body: data
    }
    let keep = '';
    let q = null;
    let wordStart = true;
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (q) {
        if (c === '\\' && q === '"' && i + 1 < line.length) { keep += c + line[i + 1]; i += 2; continue; }
        if (c === q) q = null;
        keep += c; i += 1; continue;
      }
      if (c === '\\' && i + 1 < line.length) { keep += c + line[i + 1]; i += 2; wordStart = false; continue; }
      if (c === "'" || c === '"') { q = c; keep += c; i += 1; wordStart = false; continue; }
      if (c === '#' && wordStart) break; // comment to EOL
      if (c === '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
        const m = /^<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w]*))/.exec(line.slice(i));
        if (m) { heredocTag = m[1] || m[2] || m[3]; i += m[0].length; wordStart = true; continue; }
      }
      wordStart = /[\s;&|(]/.test(c);
      keep += c; i += 1;
    }
    out.push(keep);
  }
  return `${out.join('\n')}\n`;
}

function isBashReadClass(cmd) {
  const text = executableText(typeof cmd === 'string' ? cmd : '').trim();
  return BASH_READ_PREFIXES.some((p) => text.startsWith(p));
}

function loadConfig() {
  const cfg = { mode: 'warn', threshold: DEFAULT_THRESHOLD, guardedModels: DEFAULT_GUARDED };
  try {
    const file = path.join(os.homedir(), '.autopilot', 'config.json');
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const g = j && j.depth0_delegate_gate;
      if (g && typeof g === 'object') {
        if (['off', 'warn', 'block'].includes(g.mode)) cfg.mode = g.mode;
        if (Number.isInteger(g.threshold) && g.threshold > 0) cfg.threshold = g.threshold;
        if (Array.isArray(g.guarded_models) && g.guarded_models.every((m) => typeof m === 'string')) {
          cfg.guardedModels = g.guarded_models;
        }
      }
    }
  } catch { /* defaults */ }
  const envMode = process.env.AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE;
  if (envMode !== undefined) {
    // An explicit env override wins over config; a garbage value maps to warn (never leaves block armed).
    cfg.mode = ['off', 'warn', 'block'].includes(envMode) ? envMode : 'warn';
  }
  return cfg;
}

function getSessionId(payload) {
  const raw = (payload && typeof payload.session_id === 'string' && payload.session_id)
    || process.env.CLAUDE_CODE_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || process.cwd();
  return sanitizeSessionId(raw);
}

function stateDir(live) {
  return process.env.AUTOPILOT_DEPTH0_GATE_DIR || path.join(live.base, 'depth0-gate');
}

function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && typeof s === 'object' && Number.isInteger(s.reads)) return s;
  } catch { /* fresh */ }
  return { reads: 0, lastFireAt: null };
}

function saveState(file, st) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, file);
}

// Exclusive-create lock around load→modify→save so parallel PreToolUse invocations (a
// depth-0 burst of parallel Reads/Greps) never lose an increment — 24 concurrent fires
// counted 22–23 unlocked (v2.36.1 pre-merge review). Same shape as foreman-guard.js's
// withLock; duplicated on purpose (single-crash isolation between the two hooks, like
// executableText above). Stale locks (>5 s) are broken; a nudge must never wedge on its state.
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
      if (Date.now() > deadline) return fn(); // fail-open: count without the lock rather than block
      const until = Date.now() + 15;
      while (Date.now() < until) { /* spin briefly */ }
    }
  }
}

function emitDeny(reason) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })}\n`);
}

function classify(tool, input) {
  if (DELEGATION_TOOLS.has(tool)) return 'delegation';
  if (READ_CLASS_TOOLS.has(tool)) return 'read';
  if (tool === 'Bash' && isBashReadClass(input && input.command)) return 'read';
  return 'other';
}

(function main() {
  try {
    const cfg = loadConfig();
    if (cfg.mode === 'off') process.exit(0);

    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = ''; }
    let payload = {};
    try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { process.exit(0); }
    if (!payload || typeof payload !== 'object') process.exit(0);
    // Presence, not truthiness: an empty/null agent_id still marks a subagent fire (review 🟠 agent-id-presence).
    if (Object.prototype.hasOwnProperty.call(payload, 'agent_id')) process.exit(0); // depth-1+: foreman-guard's territory

    const tool = payload.tool_name || '';
    const kind = classify(tool, payload.tool_input);
    if (kind === 'other') process.exit(0); // no-op: counter untouched

    const live = resolveLiveDir();
    const sid = getSessionId(payload);
    const dir = stateDir(live);
    const file = path.join(dir, `${sid}.json`);
    fs.mkdirSync(dir, { recursive: true });

    // v2.36.2: the whole load→modify→save runs under the per-session lock; the verdict
    // (deny / nudge / silent) is computed inside and acted on outside, so the live-file read
    // for `block` mode — its own I/O — never holds the lock.
    const verdict = withLock(file, () => {
      const st = loadState(file);
      if (kind === 'delegation') {
        st.reads = 0;
        saveState(file, st);
        return { action: 'silent' };
      }
      // kind === 'read'
      st.reads += 1;
      const reads = st.reads;
      const threshold = cfg.threshold;
      const nudge = reads >= threshold && reads % threshold === 0;
      if (nudge) st.lastFireAt = new Date().toISOString();
      const action = cfg.mode === 'block' && reads >= 2 * threshold ? 'maybe-block' : (nudge ? 'nudge' : 'silent');
      saveState(file, st);
      return { action, nudge, reads };
    });

    if (verdict.action === 'maybe-block') {
      const liveMain = readLive(live.base, sid, { kind: 'main' });
      const modelId = liveMain && liveMain.model && typeof liveMain.model.id === 'string' ? liveMain.model.id : null;
      const family = modelId ? modelFamily(modelId) : 'unknown';
      if (modelId && family !== 'unknown' && cfg.guardedModels.includes(family)) {
        emitDeny(`depth0-delegate-gate: ${verdict.reads} consecutive read-class calls at depth-0 on a `
          + `guarded model (family "${family}") — delegate to an Explore/survey subagent (model: sonnet) `
          + 'and read only its conclusion.');
        process.exit(0);
      }
      // unguarded / unknown model past 2x: only the periodic nudge rule applies
    }

    if (verdict.nudge) {
      process.stderr.write(`depth0-delegate-gate: ${verdict.reads} consecutive read-class calls at depth-0 — `
        + 'delegate to an Explore/survey subagent (model: sonnet) and read only its conclusion\n');
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: a nudge must never wedge a tool call by crashing
  }
})();
