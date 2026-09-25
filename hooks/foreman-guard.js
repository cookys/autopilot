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
const DEFAULT_WORKER_REVIEWER_CAP = 120;
const FIRST_LINE_MAX = 64 * 1024;
const ROLE_LINE_RE = /^Role: (foreman|worker|reviewer)$/;
const ROLE_KEYS = ['foreman', 'worker', 'reviewer'];
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

function overlayRoleCaps(target, src) {
  if (!src || typeof src !== 'object') return;
  for (const key of ROLE_KEYS) {
    if (Number.isInteger(src[key]) && src[key] > 0) target[key] = src[key];
  }
}

function overlayRoleCapsEnv(target, raw) {
  if (typeof raw !== 'string' || !raw) return;
  for (const part of raw.split(',')) {
    const m = /^(foreman|worker|reviewer)=(\d+)$/.exec(part.trim());
    if (!m) continue; // malformed or unknown key: ignore
    const n = Number(m[2]);
    if (Number.isInteger(n) && n > 0) target[m[1]] = n;
  }
}

const DEFAULT_RESERVE_CALLS = 8;
const GIT_RESERVE_SUBS = new Set(['status', 'diff', 'add', 'commit', 'log', 'show', 'rev-parse', 'restore']);

function overlayNonNegInt(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 0) return n;
  return null;
}

function splitExecutableSegments(text) {
  const segs = [];
  let cur = '';
  let q = null;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"' && i + 1 < s.length) { cur += c + s[i + 1]; i += 1; continue; }
      if (c === q) q = null;
      cur += c;
      continue;
    }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i += 1; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '\n' || c === ';') { segs.push(cur); cur = ''; continue; }
    if (c === '&' && s[i + 1] === '&') { segs.push(cur); cur = ''; i += 1; continue; }
    if (c === '|' && s[i + 1] === '|') { segs.push(cur); cur = ''; i += 1; continue; }
    if (c === '|') { segs.push(cur); cur = ''; continue; }
    cur += c;
  }
  segs.push(cur);
  return segs.map((x) => x.trim()).filter((x) => x.length > 0);
}

function tokenizeArgv(seg) {
  const words = [];
  let cur = '';
  let q = null;
  const s = String(seg);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"' && i + 1 < s.length) { cur += c + s[i + 1]; i += 1; continue; }
      if (c === q) { q = null; cur += c; continue; }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (/\s/.test(c)) {
      if (cur) { words.push(cur); cur = ''; }
      continue;
    }
    cur += c;
  }
  if (cur) words.push(cur);
  return words;
}

function stripOneQuoteLayer(word) {
  if (word.length >= 2 && ((word[0] === "'" && word[word.length - 1] === "'")
      || (word[0] === '"' && word[word.length - 1] === '"'))) {
    return word.slice(1, -1);
  }
  return word;
}

function expandTmpdirPrefix(p) {
  const tmp = process.env.TMPDIR;
  if (!tmp) return p;
  if (p.startsWith('${TMPDIR}/')) return `${tmp}${p.slice('${TMPDIR}'.length)}`;
  if (p.startsWith('$TMPDIR/')) return `${tmp}${p.slice('$TMPDIR'.length)}`;
  return p;
}

function isTmpSafePath(raw) {
  let p = expandTmpdirPrefix(stripOneQuoteLayer(raw));
  if (!p.startsWith('/') || p === '/tmp') return false;
  if (p.startsWith('/tmp/')) return p.length > '/tmp/'.length;
  const tmp = process.env.TMPDIR;
  if (!tmp) return false;
  const prefix = tmp.endsWith('/') ? tmp : `${tmp}/`;
  return p.startsWith(prefix) && p.length > prefix.length;
}

function reserveDirective(left) {
  return `Close-out reserve: ${left} call(s) left before the cap. Allowed now: cd; git status/diff/add/commit/log/show/rev-parse/restore --staged; kill <pid>; rm/rmdir under /tmp or $TMPDIR; mkdir -p; ls; test; writing a file (cat >, tee, printf >). Commit, clean up, write your handoff, and end the turn.`;
}

function segmentMatchesAllowlist(seg) {
  const words = tokenizeArgv(seg);
  if (words.length === 0) return false;
  const cmd = words[0];
  if (cmd === 'git') {
    if (words.length < 2 || !GIT_RESERVE_SUBS.has(words[1])) return false;
    if (words[1] === 'restore') return words[2] === '--staged';
    return true;
  }
  if (cmd === 'kill') {
    if (words.length < 2) return false;
    return words.slice(1).every((w) => /^\d+$/.test(w));
  }
  if (cmd === 'rm' || cmd === 'rmdir') {
    const operands = words.slice(1).filter((w) => !w.startsWith('-'));
    if (operands.length === 0) return false;
    return operands.every(isTmpSafePath);
  }
  if (cmd === 'cd') return words.length >= 2;
  if (cmd === 'mkdir') return words.includes('-p');
  if (cmd === 'ls' || cmd === 'test' || cmd === '[' || cmd === 'tee') return true;
  if (cmd === 'cat' || cmd === 'printf') return seg.includes('>');
  return false;
}

function loadConfig() {
  const cfg = { mode: 'block', bashCap: DEFAULT_BASH_CAP, reserveCalls: DEFAULT_RESERVE_CALLS };
  let fileRoleCaps = null;
  try {
    const file = path.join(os.homedir(), '.autopilot', 'config.json');
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const fg = j && j.foreman_guard;
      if (fg && typeof fg === 'object') {
        if (['block', 'warn', 'off'].includes(fg.mode)) cfg.mode = fg.mode;
        if (Number.isInteger(fg.bash_cap) && fg.bash_cap > 0) cfg.bashCap = fg.bash_cap;
        if (Number.isInteger(fg.reserve_calls) && fg.reserve_calls >= 0) cfg.reserveCalls = fg.reserve_calls;
        if (fg.role_caps && typeof fg.role_caps === 'object') fileRoleCaps = fg.role_caps;
      }
    }
  } catch { /* defaults */ }
  const envMode = process.env.AUTOPILOT_FOREMAN_GUARD_MODE;
  if (['block', 'warn', 'off'].includes(envMode)) cfg.mode = envMode;
  const envCap = Number(process.env.AUTOPILOT_FOREMAN_GUARD_BASH_CAP);
  if (Number.isInteger(envCap) && envCap > 0) cfg.bashCap = envCap;
  const envReserve = overlayNonNegInt(process.env.AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS);
  if (envReserve !== null) cfg.reserveCalls = envReserve;
  cfg.roleCaps = {
    foreman: cfg.bashCap,
    worker: DEFAULT_WORKER_REVIEWER_CAP,
    reviewer: DEFAULT_WORKER_REVIEWER_CAP,
  };
  overlayRoleCaps(cfg.roleCaps, fileRoleCaps);
  overlayRoleCapsEnv(cfg.roleCaps, process.env.AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS);
  return cfg;
}

// Role from the child's FIRST user message only. Own try/catch, own file read,
// before the state lock. Any failure ⇒ "foreman" (never throw, never uncap).
function resolveRole(payload) {
  try {
    const tpath = payload.transcript_path;
    if (typeof tpath !== 'string' || !tpath) return 'foreman';
    const child = path.join(
      path.dirname(tpath),
      String(payload.session_id),
      'subagents',
      `agent-${payload.agent_id}.jsonl`,
    );
    const fd = fs.openSync(child, 'r');
    try {
      const buf = Buffer.alloc(FIRST_LINE_MAX + 1);
      const n = fs.readSync(fd, buf, 0, FIRST_LINE_MAX + 1, 0);
      const slice = buf.subarray(0, n);
      const nl = slice.indexOf(0x0a);
      if (nl < 0 || nl > FIRST_LINE_MAX) return 'foreman';
      let rec;
      try { rec = JSON.parse(slice.subarray(0, nl).toString('utf8')); } catch { return 'foreman'; }
      if (!rec || typeof rec !== 'object' || rec.type !== 'user') return 'foreman';
      if (rec.agentId !== payload.agent_id) return 'foreman';
      const content = rec.message && rec.message.content;
      if (typeof content !== 'string') return 'foreman';
      const lines = content.split('\n').slice(0, 5);
      for (const line of lines) {
        const m = ROLE_LINE_RE.exec(line);
        if (m) return m[1];
      }
      return 'foreman';
    } finally {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  } catch {
    return 'foreman';
  }
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

// Advisories that used to be stderr-only on an ALLOW (mode=warn, ambiguous-rows
// diagnostic) never reached the model: stderr on exit 0 is debug-log only.
// Same envelope as emit() deny, but permissionDecision allow + additionalContext.
function emitAllowContext(text) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      additionalContext: text,
    },
  })}\n`);
}

function decide(payload, cfg, st, ceiling = {}, role = 'foreman') {
  const tool = payload.tool_name || '';
  const input = payload.tool_input || {};
  if (tool === 'Monitor') {
    return { deny: true, rule: 'monitor', reason:
      'foreman-guard: Monitor is depth-0 only (ironlaw #6). A foreman waits with run_in_background + a paired dead-man `sleep <deadline>; echo WAKE`, then ENDS ITS TURN.' };
  }
  if (tool !== 'Bash') return { deny: false, diagnostic: ceiling.diagnostic };
  const cap = cfg.roleCaps && Number.isInteger(cfg.roleCaps[role]) ? cfg.roleCaps[role] : cfg.bashCap;
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
  if (n > cap) {
    return { deny: true, rule: 'bash-cap', count: n, reason:
      `foreman-guard: Bash call ${n} exceeds the ${role} cap of ${cap} (ironlaw #6, 一刀一命). Write your handoff (autopilot:handoff) NOW and end the turn; depth-0 spawns the next foreman for the next deliverable. Resident foremen are forbidden.`,
      diagnostic: ceiling.diagnostic };
  }
  if (!background) {
    const text = executableText(cmd);
    for (const r of POLL_RULES) {
      if (r.re.test(text)) {
        return { deny: true, rule: r.id, count: n, reason:
          `foreman-guard: ${r.why} (rule ${r.id}, ironlaw #6). Wait with run_in_background: true (one notification) + a background dead-man timer, then END THE TURN; never read a leaf's .output into context — consume only its schema verdict. (Bash call ${n}/${cap} spent.)`,
          diagnostic: ceiling.diagnostic };
      }
    }
  }
  const configuredReserve = Number.isInteger(cfg.reserveCalls) ? cfg.reserveCalls : DEFAULT_RESERVE_CALLS;
  const effReserve = Math.min(configuredReserve, Math.floor(cap / 2));
  if (effReserve > 0 && n > cap - effReserve) {
    const text = executableText(cmd);
    const segs = splitExecutableSegments(text);
    const left = cap - n + 1;
    const directive = reserveDirective(left);
    const first = n === cap - effReserve + 1;
    const ok = segs.length > 0 && segs.every(segmentMatchesAllowlist);
    if (!ok) {
      return { deny: true, rule: 'reserve', count: n, reason: directive, diagnostic: ceiling.diagnostic };
    }
    return {
      deny: false,
      count: n,
      diagnostic: ceiling.diagnostic,
      reserveDirective: first ? directive : null,
    };
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
    const role = payload.tool_name === 'Bash' ? resolveRole(payload) : 'foreman';
    const file = stateFile(sessionId, payload.agent_id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const d = withLock(file, () => {
      const st = loadState(file);
      const r = decide(payload, cfg, st, ceiling, role);
      if (Number.isInteger(r.count)) st.bash_calls = r.count; // every Bash attempt is counted
      if (r.deny) { st.denied += 1; st.last_denied_rule = r.rule; }
      // v2.36.2: the ambiguous-rows diagnostic is printed once per agent per distinct text
      // (it repeated on every Bash call of a run). A changed count (0 → 2) prints again.
      if (r.diagnostic && st.last_diagnostic === r.diagnostic) r.diagnostic = null;
      else if (r.diagnostic) st.last_diagnostic = r.diagnostic;
      saveState(file, st);
      return r;
    });
    const advisory = [];
    if (d.diagnostic) {
      process.stderr.write(`${d.diagnostic}\n`); // ambiguous rows: never a gate
      advisory.push(d.diagnostic);
    }
    if (d.reserveDirective) advisory.push(d.reserveDirective);
    if (!d.deny) {
      if (advisory.length) emitAllowContext(advisory.join('\n'));
      process.exit(0);
    }
    if (cfg.mode === 'warn') {
      const warnLine = `${d.reason} [mode=warn: allowed]`;
      process.stderr.write(`${warnLine}\n`);
      advisory.push(warnLine);
      emitAllowContext(advisory.join('\n'));
      process.exit(0);
    }
    emit('deny', d.reason);
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: a guard must never wedge a tool call by crashing
  }
})();
