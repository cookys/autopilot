'use strict';
/**
 * ask-guard — the PM question-gate seat decision, shared by hooks/ask-decision.js (PreToolUse
 * AskUserQuestion) and hooks/lib/owner-question-rules.js (Stop plain-text questions). The
 * decision is "may this seat ask the human operator directly?" and it NEVER reads team.json
 * (the c4140 incident: no team.json on the host made a lane seat resolve as solo and pass).
 *
 *   1. Seat identity is the session's fleet address: env FLEET_ADDRESS (else
 *      AUTOPILOT_FLEET_ADDRESS — the env the fleet rails export for the session; the same
 *      source scripts/lib/fleet-task.js ownerAddress() reads; an @<session> suffix is
 *      stripped). A session with NO fleet address is the operator's own session: allow.
 *   2. allow list ask_guard.allow_members (config.json, default ["pm--claude", "glm-trial*"],
 *      glob on the member part of the address — the last '/'-separated segment) and the
 *      existing PM-console check (hooks/_shared/pm-console.js isPmConsole on the session cwd):
 *      allow.
 *   3. Every other seat rolls out like foreman_guard.poll_enforce_from (same
 *      Date.parse / unparsable-enforces-now shape as hooks/foreman-guard.js pollBlocks):
 *      until ask_guard.enforce_from (default 2026-11-24T00:00:00+08:00, env
 *      AUTOPILOT_ASK_GUARD_ENFORCE_FROM) + 1 h a hit is a warn — one JSON line in
 *      <autopilot state dir>/ask-guard/hits.jsonl plus a stderr line; at or after that
 *      instant it is a deny (block / permissionDecision deny).
 *
 * Fail-open: any internal error resolves to the allow verdict with no side effects.
 * Node built-ins only; this module sends nothing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { configPath, globToRegExp } = require('../../scripts/lib/config-path.js');
const { isPmConsole } = require('../_shared/pm-console.js');

const DEFAULT_ALLOW_MEMBERS = ['pm--claude', 'glm-trial*'];
const DEFAULT_ENFORCE_FROM = '2026-11-24T00:00:00+08:00';
const WARN_WINDOW_MS = 60 * 60 * 1000; // rule 3: the first hour after enforce-from only warns

// The session's fleet member address, or '' when the session has no fleet address
// (the operator's own session). An @<session> suffix is stripped, same as
// scripts/lib/fleet-task.js ownerAddress().
function seatAddressOf(env) {
  const raw = String(env.FLEET_ADDRESS || env.AUTOPILOT_FLEET_ADDRESS || '');
  return raw.replace(/@.*$/, '').trim();
}

// The member part of the address: the last '/'-separated segment (the whole string when
// there is no '/'). The allow list globs on this part only.
function memberOf(address) {
  const s = String(address || '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

function globMatch(pattern, value) {
  try {
    return globToRegExp(String(pattern)).test(String(value));
  } catch {
    return String(pattern) === String(value);
  }
}

function loadGuardConfig(env) {
  const cfg = { allowMembers: [...DEFAULT_ALLOW_MEMBERS], enforceFrom: DEFAULT_ENFORCE_FROM };
  try {
    const file = configPath({ env });
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ag = j && typeof j === 'object' ? j.ask_guard : null;
      if (ag && typeof ag === 'object') {
        if (Array.isArray(ag.allow_members)) {
          const members = ag.allow_members.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim());
          if (members.length) cfg.allowMembers = members;
        }
        if (typeof ag.enforce_from === 'string' && ag.enforce_from.trim()) cfg.enforceFrom = ag.enforce_from.trim();
      }
    }
  } catch { /* absent/corrupt config -> defaults */ }
  const envEnforce = typeof env.AUTOPILOT_ASK_GUARD_ENFORCE_FROM === 'string' ? env.AUTOPILOT_ASK_GUARD_ENFORCE_FROM.trim() : '';
  if (envEnforce) cfg.enforceFrom = envEnforce;
  return cfg;
}

/**
 * The gate decision for one seat. Returns one of:
 *   { verdict: 'allow', why: 'no-fleet-address' | 'allow-members' | 'pm-console', seat, member }
 *   { verdict: 'warn',  why: 'warn-window', seat, member, denyFrom }
 *   { verdict: 'deny',  why: 'deny-window', seat, member, denyFrom }
 * opts: { env?, cwd?, nowMs? } (nowMs for tests; env defaults to process.env).
 */
function decide(opts = {}) {
  const env = opts.env || process.env;
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const address = seatAddressOf(env);
  const member = memberOf(address);
  if (!address) return { verdict: 'allow', why: 'no-fleet-address', seat: null, member: null };
  let allowMembers = DEFAULT_ALLOW_MEMBERS;
  let enforceFrom = DEFAULT_ENFORCE_FROM;
  try {
    const cfg = loadGuardConfig(env);
    allowMembers = cfg.allowMembers;
    enforceFrom = cfg.enforceFrom;
  } catch { /* defaults */ }
  if (allowMembers.some((g) => globMatch(g, member))) {
    return { verdict: 'allow', why: 'allow-members', seat: address, member };
  }
  const cwd = typeof opts.cwd === 'string' && opts.cwd ? opts.cwd : process.cwd();
  try {
    if (isPmConsole(cwd)) return { verdict: 'allow', why: 'pm-console', seat: address, member };
  } catch { /* not a PM console */ }
  const t = Date.parse(enforceFrom);
  // Unparsable enforce-from enforces now (same shape as foreman-guard pollBlocks).
  const denyFromMs = Number.isFinite(t) ? t + WARN_WINDOW_MS : nowMs;
  if (nowMs < denyFromMs) {
    return { verdict: 'warn', why: 'warn-window', seat: address, member, denyFrom: new Date(denyFromMs).toISOString() };
  }
  return { verdict: 'deny', why: 'deny-window', seat: address, member, denyFrom: new Date(denyFromMs).toISOString() };
}

// The one warn line appended to <autopilot state dir>/ask-guard/hits.jsonl.
function hitsFile() {
  return path.join(os.homedir(), '.autopilot', 'ask-guard', 'hits.jsonl');
}

function recordHit(d, { env, sessionId } = {}) {
  try {
    const e = env || process.env;
    const file = hitsFile();
    const row = {
      ts: new Date().toISOString(),
      session_id: sessionId || e.AUTOPILOT_SESSION_ID || e.CLAUDE_CODE_SESSION_ID || e.CLAUDE_SESSION_ID || 'session',
      seat: d.seat || null,
      member: d.member || null,
      mode: 'warn',
      deny_from: d.denyFrom || null,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  } catch { /* fail-open: a gate must never wedge a tool call by crashing */ }
}

function warnLine(d) {
  return `ask-guard: warn (denying from ${d.denyFrom}): seat ${d.seat} is not an operator-facing seat; `
    + 'send the question to the PM with scripts/request-decision.js instead of asking the operator directly.';
}

// The deny reason a gated seat sees (names the sanctioned path; hooks/ask-decision.js tests pin the script name).
function denyReason(d) {
  return `ask-guard: 座位 ${d.seat} 不能直接問操作員（非操作員本機、不在 ask_guard.allow_members、非 PM console）。`
    + '請改用 scripts/request-decision.js，把問題、選項與建議送給 PM。';
}

module.exports = {
  seatAddressOf,
  memberOf,
  globMatch,
  loadGuardConfig,
  decide,
  recordHit,
  hitsFile,
  warnLine,
  denyReason,
  DEFAULT_ALLOW_MEMBERS,
  DEFAULT_ENFORCE_FROM,
  WARN_WINDOW_MS,
};
