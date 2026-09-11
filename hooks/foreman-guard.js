#!/usr/bin/env node
/**
 * foreman-guard — PreToolUse Bash|Monitor (default-on; v2.35.15)
 *
 * Runtime enforcement of ironlaw #6 (docs/ironlaw-to-gate-map.md) for the actor it
 * names: a depth-1 foreman / worker subagent inside an /l4 /l5 /l6 session. Until this
 * hook existed the only enforcer was scripts/check-foreman-polling.js, which runs
 * AFTER the run at depth-0 harvest — the 2026-09-04 cuda quota digest found foremen
 * that had made 1,900–7,400 Bash calls (cap: 40), polled with `true`×450 and
 * `while ! grep …; do sleep 10; done`, and lived 13–33 hours, at ≈$2,200 API-equivalent
 * in 36 hours. Nothing had stopped them because nothing was IN the loop.
 *
 * SCOPE (both must hold, else the hook is inert — exit 0, no output):
 *   - the session-mode marker is ACTIVE with level l4|l5|l6
 *     (scripts/session-mode.js readMarker; absent/expired/corrupt ⇒ inert), AND
 *   - the payload carries `agent_id` (SPIKE-1, CC 2.1.208: subagent identity —
 *     depth-0 never has it). Depth-0 keeps Monitor and unlimited Bash; it is the
 *     control loop.
 *
 * RULES (a deny names the rule and the sanctioned alternative):
 *   - Bash cap: per (session, agent_id) call counter; call N > bash_cap (default 40)
 *     is denied with the lifecycle directive: write the handoff, end the turn
 *     (一刀一命 — skills/l4|l5|l6/SKILL.md).
 *   - Polling: a FOREGROUND Bash whose command is a wait loop or a liveness poll is
 *     denied. `run_in_background: true` is the sanctioned wait (one notification).
 *   - Monitor from a subagent is denied (ironlaw #6: foremen must not hold a Monitor).
 *   - Context ceiling (v2.36.1, P2): the subagent status line publishes THIS agent's own
 *     `tasks[].tokenCount`/`contextWindowSize` (matched by `tasks[].id === agent_id` — the
 *     P0 spike ruling, `docs/projects/2026-09-05-statusline-live-context-feed/ledger/p0/`).
 *     `tokenCount ≥ t2(contextWindowSize)` (same context_budget.{t1,t2} config/env as
 *     context-budget.js, scaled to THIS row's window) denies the next Bash with the
 *     handoff directive. 0 or ≥2 matching rows ⇒ ambiguous ⇒ never a gate — pass, plus one
 *     stderr diagnostic naming the count. A stale (>120s) or absent tasks file is silence,
 *     never a gate pass.
 *
 * ACCOUNTING: every Bash attempt (allowed OR denied) is reserved against the cap under an
 * exclusive-create lock, so a denied poll still spends a call and parallel invocations
 * never lose an increment. Rules run on executable text (heredoc bodies and comments
 * stripped); quoted strings are kept because `bash -c` executes them.
 *
 * MODES: ~/.autopilot/config.json {"foreman_guard": {"mode": "block"|"warn"|"off",
 * "bash_cap": 40}} or AUTOPILOT_FOREMAN_GUARD_MODE / AUTOPILOT_FOREMAN_GUARD_BASH_CAP.
 * warn ⇒ stderr line, allow. Fail-open: any internal error ⇒ exit 0 silently.
 * State: ~/.autopilot/foreman-guard/<session>-<agent>.json (host-stable, not TMPDIR).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readMarker } = require('../scripts/session-mode.js');
const { tiersForKnownWindow } = require('./context-budget-lib.js');
const { resolveLiveDir, sanitizeSessionId, readLive } = require('../scripts/lib/live-state-dir.js');

const DEFAULT_BASH_CAP = 40;
const FOREMAN_LEVELS = new Set(['l4', 'l5', 'l6']);

// Foreground wait/poll shapes observed in the digest and the 5ca9b104 incident.
// The rules run on EXECUTABLE text only: heredoc bodies and `#` comments are stripped
// first (review round 1, gpt-5.6-sol: a `sleep` inside a heredoc being written to a
// file is not a wait; `/bin/sleep 10` and `bash -c 'sleep 10'` are). Quoted strings are
// kept — `bash -c '…'` and `sh -c "…"` execute them — so the sleep rule requires a
// digit after `sleep` to stay off prose like `-m "sleep well"`.
const POLL_RULES = [
  { id: 'noop-spin', re: /^\s*(?:true|:)\s*(?:;|&&|\|\|)?\s*$/, why: 'a no-op Bash call is a spin-wait' },
  { id: 'sleep', re: /(?:^|[;&|(`\s'"])(?:\/[\w./-]*\/)?sleep\s+\d/, why: 'foreground sleep is a poll' },
  { id: 'while-wait', re: /\b(?:while|until)\b[\s\S]*?\bdo\b[\s\S]*?(?:(?:^|[;&|(`\s'"])(?:\/[\w./-]*\/)?sleep\s+\d|(?:^|[;\s])(?:true|:)(?:\s*;|\s*$|\s+done\b))/, why: 'a while/until loop whose body sleeps or spins is a poll' },
  { id: 'liveness-poll', re: /(?:^|[;&|(`\s'"])(?:\/[\w./-]*\/)?(?:pgrep\b|ps\s+-p\b|kill\s+-0\b)/, why: 'liveness probing is a poll' },
  { id: 'leaf-output-read', re: /\b(?:cat|tail|head|sed\s+-n|less|more)\b[^|;&]*\/tasks\/[^\s'"]*\.output\b/, why: 'reading a leaf output file into the foreman context' },
];

// Strip the parts of a Bash command that are DATA, not executed commands: heredoc
// BODIES (`<<TAG … TAG`, quoted or unquoted tag, optional `-`) and `#` comments to end
// of line. Quote-aware (review round 2, gpt-5.6-sol): a `#` or `<<` inside single/double
// quotes is literal, and the executable text before AND after a heredoc introducer on
// its own line (`cat <<EOF; sleep 10`) is kept — only the body lines are dropped.
// Quoted strings themselves stay: `bash -c '…'` / `sh -c "…"` / `eval` execute them.
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
    let q = null; // active quote char
    // Lexical word-start state (review round 3, gpt-5.6-sol): `#` opens a comment only at
    // the START of a word. `echo foo\ #bar` keeps `#bar` inside the word because the
    // escaped space did not end it — inspecting the raw previous char got that wrong.
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
        if (m) { heredocTag = m[1] || m[2] || m[3]; i += m[0].length; wordStart = true; continue; } // drop the introducer only
      }
      wordStart = /[\s;&|(]/.test(c);
      keep += c; i += 1;
    }
    out.push(keep);
  }
  return `${out.join('\n')}\n`;
}

function isAffirmative(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase());
  return false;
}

function loadConfig() {
  const cfg = { mode: 'block', bashCap: DEFAULT_BASH_CAP };
  try {
    const file = path.join(os.homedir(), '.autopilot', 'config.json');
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const fg = j && j.foreman_guard;
      if (fg && typeof fg === 'object') {
        if (['block', 'warn', 'off'].includes(fg.mode)) cfg.mode = fg.mode;
        if (Number.isInteger(fg.bash_cap) && fg.bash_cap > 0) cfg.bashCap = fg.bash_cap;
      }
    }
  } catch { /* defaults */ }
  const envMode = process.env.AUTOPILOT_FOREMAN_GUARD_MODE;
  if (['block', 'warn', 'off'].includes(envMode)) cfg.mode = envMode;
  const envCap = Number(process.env.AUTOPILOT_FOREMAN_GUARD_BASH_CAP);
  if (Number.isInteger(envCap) && envCap > 0) cfg.bashCap = envCap;
  return cfg;
}

// Same knob context-budget.js reads (context_budget.{t1,t2} / AUTOPILOT_CONTEXT_BUDGET_T1/T2)
// — the context-ceiling rule below is the SAME T2 tier concept applied to a subagent's own
// row instead of depth-0's transcript. Deliberately duplicated (not required) rather than
// imported from hooks/context-budget.js: single-crash isolation between the two hooks
// (header note, both files).
function loadContextBudgetTiers() {
  const cfg = { t1: 100_000, t2: 150_000, explicitT1: false, explicitT2: false };
  try {
    const file = path.join(os.homedir(), '.autopilot', 'config.json');
    const user = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cb = user && user.context_budget;
    if (cb && typeof cb === 'object') {
      if (Number.isFinite(cb.t1)) { cfg.t1 = cb.t1; cfg.explicitT1 = true; }
      if (Number.isFinite(cb.t2)) { cfg.t2 = cb.t2; cfg.explicitT2 = true; }
    }
  } catch { /* absent/corrupt config ⇒ defaults */ }
  const envT1 = Number(process.env.AUTOPILOT_CONTEXT_BUDGET_T1);
  const envT2 = Number(process.env.AUTOPILOT_CONTEXT_BUDGET_T2);
  if (Number.isFinite(envT1) && envT1 > 0) { cfg.t1 = envT1; cfg.explicitT1 = true; }
  if (Number.isFinite(envT2) && envT2 > 0) { cfg.t2 = envT2; cfg.explicitT2 = true; }
  return cfg;
}

// v2.36.1 (P2): read THIS agent's row off the subagent status line's tasks file and decide
// whether its own context has crossed T2. Returns {} (no signal ⇒ never a gate — silence is
// never a gate pass) unless:
//   - {diagnostic} — 0 or ≥2 rows matched `agent_id` (ambiguous; P0 ruling: fail-open + name
//     the count), or
//   - {deny, reason} — exactly one row matched and its tokenCount ≥ t2(its own contextWindowSize).
function checkContextCeiling(payload) {
  let live;
  try { live = resolveLiveDir(); } catch { return {}; }
  const sid = sanitizeSessionId(payload.session_id || process.env.CLAUDE_CODE_SESSION_ID
    || process.env.CLAUDE_SESSION_ID || process.cwd());
  const tasksFile = readLive(live.base, sid, { kind: 'tasks' });
  if (!tasksFile || !Array.isArray(tasksFile.tasks)) return {}; // absent/stale ⇒ no signal
  const rows = tasksFile.tasks.filter((t) => t && t.id === payload.agent_id);
  if (rows.length !== 1) {
    return {
      diagnostic: `foreman-guard: ${rows.length} tasks[] row(s) matched agent_id "${payload.agent_id}" `
        + '(expected exactly 1) — context-ceiling check skipped this call (fail-open, never a gate on ambiguity).',
    };
  }
  const row = rows[0];
  // v2.36.2: a non-positive window is no window (was accepted, scaling tiers by -1/0).
  const w = Number.isFinite(row.contextWindowSize) && row.contextWindowSize > 0 ? row.contextWindowSize : null;
  const tokenCount = Number.isFinite(row.tokenCount) ? row.tokenCount : null;
  if (w === null || tokenCount === null) return {};
  const tiers = tiersForKnownWindow(loadContextBudgetTiers(), w);
  if (tokenCount >= tiers.t2) {
    return {
      deny: true,
      reason: `foreman-guard: this agent's own context is ${tokenCount} tokens, at or past T2 `
        + `(${tiers.t2} of its ${w}-token window, subagent status line). Write your handoff `
        + '(autopilot:handoff) NOW and end the turn (一刀一命); depth-0 spawns the next foreman/worker '
        + 'for the remaining work.',
    };
  }
  return {};
}

function stateDir() {
  return process.env.AUTOPILOT_FOREMAN_GUARD_DIR || path.join(os.homedir(), '.autopilot', 'foreman-guard');
}
function safe(s) { return String(s || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96); }
function stateFile(sessionId, agentId) {
  return path.join(stateDir(), `${safe(sessionId)}-${safe(agentId)}.json`);
}
function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && typeof s === 'object' && Number.isInteger(s.bash_calls)) return s;
  } catch { /* fresh */ }
  return { bash_calls: 0, denied: 0, started_at: new Date().toISOString() };
}
function saveState(file, st) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, file);
}
// Exclusive-create lock around load→modify→save so parallel PreToolUse invocations
// (a foreman fanning out, or a retry storm) never lose an increment (review round 1,
// gpt-5.6-sol). Stale locks (>5 s) are broken — a guard must never wedge on its own state.
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

function emit(decision, reason) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  })}\n`);
}

function decide(payload, cfg, st, ceiling = {}) {
  const tool = payload.tool_name || '';
  const input = payload.tool_input || {};
  if (tool === 'Monitor') {
    return { deny: true, rule: 'monitor', reason:
      'foreman-guard: Monitor is depth-0 only (ironlaw #6). A foreman waits with run_in_background + a paired dead-man `sleep <deadline>; echo WAKE`, then ENDS ITS TURN.' };
  }
  if (tool !== 'Bash') return { deny: false, diagnostic: ceiling.diagnostic };
  const cmd = typeof input.command === 'string' ? input.command : '';
  const background = isAffirmative(input.run_in_background);
  // Every Bash ATTEMPT is reserved against the cap before any rule runs — a denied
  // poll still spent a model call, and a foreman that retries a denial must not get
  // unlimited retries (review round 1).
  const n = st.bash_calls + 1;
  // v2.36.1 (P2): context-ceiling deny (this agent's OWN tokenCount ≥ its own T2, per the
  // subagent status line) runs before the cap/poll rules — a denied ceiling attempt still
  // spends a call, same accounting as every other rule here.
  if (ceiling.deny) {
    return { deny: true, rule: 'context-ceiling', count: n, reason: ceiling.reason, diagnostic: ceiling.diagnostic };
  }
  if (n > cfg.bashCap) {
    return { deny: true, rule: 'bash-cap', count: n, reason:
      `foreman-guard: Bash call ${n} exceeds the foreman cap of ${cfg.bashCap} (ironlaw #6, 一刀一命). Write your handoff (autopilot:handoff) NOW and end the turn; depth-0 spawns the next foreman for the next deliverable. Resident foremen are forbidden.`,
      diagnostic: ceiling.diagnostic };
  }
  if (!background) {
    const text = executableText(cmd);
    for (const r of POLL_RULES) {
      if (r.re.test(text)) {
        return { deny: true, rule: r.id, count: n, reason:
          `foreman-guard: ${r.why} (rule ${r.id}, ironlaw #6). Wait with run_in_background: true (one notification) + a background dead-man timer, then END THE TURN; never read a leaf's .output into context — consume only its schema verdict. (Bash call ${n}/${cfg.bashCap} spent.)`,
          diagnostic: ceiling.diagnostic };
      }
    }
  }
  return { deny: false, count: n, diagnostic: ceiling.diagnostic };
}

(function main() {
  try {
    const cfg = loadConfig();
    if (cfg.mode === 'off') process.exit(0);
    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = ''; }
    let payload = {};
    try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { process.exit(0); }
    if (!payload || !payload.agent_id) process.exit(0); // depth-0 or unknown actor: inert
    const marker = readMarker();
    if (!marker || !FOREMAN_LEVELS.has(marker.level)) process.exit(0); // not an orchestrated session
    const sessionId = payload.session_id || process.env.AUTOPILOT_SESSION_ID
      || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || 'session';
    // v2.36.1 (P2): resolve this agent's own context-ceiling verdict BEFORE taking the
    // state lock (it does its own I/O — a live-file read and a findmnt shell-out — that
    // has no business holding the per-agent lock).
    const ceiling = payload.tool_name === 'Bash' ? checkContextCeiling(payload) : {};
    const file = stateFile(sessionId, payload.agent_id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const d = withLock(file, () => {
      const st = loadState(file);
      const r = decide(payload, cfg, st, ceiling);
      if (Number.isInteger(r.count)) st.bash_calls = r.count; // every Bash attempt is counted
      if (r.deny) { st.denied += 1; st.last_denied_rule = r.rule; }
      // v2.36.2: the ambiguous-rows diagnostic is printed once per agent per distinct text
      // (it repeated on every Bash call of a run). A changed count (0 → 2) prints again.
      if (r.diagnostic && st.last_diagnostic === r.diagnostic) r.diagnostic = null;
      else if (r.diagnostic) st.last_diagnostic = r.diagnostic;
      saveState(file, st);
      return r;
    });
    if (d.diagnostic) process.stderr.write(`${d.diagnostic}\n`); // ambiguous rows: never a gate
    if (!d.deny) process.exit(0);
    if (cfg.mode === 'warn') {
      process.stderr.write(`${d.reason} [mode=warn: allowed]\n`);
      process.exit(0);
    }
    emit('deny', d.reason);
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: a guard must never wedge a tool call by crashing
  }
})();
