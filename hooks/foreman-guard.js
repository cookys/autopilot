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

const DEFAULT_BASH_CAP = 40;
const FOREMAN_LEVELS = new Set(['l4', 'l5', 'l6']);

// Foreground wait/poll shapes observed in the digest and the 5ca9b104 incident.
const POLL_RULES = [
  { id: 'noop-spin', re: /^\s*(?:true|:)\s*(?:;|&&|\|\|)?\s*$/, why: 'a no-op Bash call is a spin-wait' },
  { id: 'sleep', re: /(?:^|[;&|(\s])sleep\s+\d/, why: 'foreground sleep is a poll' },
  { id: 'while-wait', re: /\bwhile\b[^;]*?\b(?:sleep|grep|test|\[\[?|pgrep|kill\s+-0|ps\s+-p)\b/, why: 'a while-loop that waits is a poll' },
  { id: 'liveness-poll', re: /\b(?:pgrep|ps\s+-p|kill\s+-0)\b/, why: 'liveness probing is a poll' },
  { id: 'leaf-output-read', re: /\b(?:cat|tail|head|sed\s+-n|less|more)\b[^|;&]*\/tasks\/[^\s'"]*\.output\b/, why: 'reading a leaf output file into the foreman context' },
];

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
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, file);
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

function decide(payload, cfg, st) {
  const tool = payload.tool_name || '';
  const input = payload.tool_input || {};
  if (tool === 'Monitor') {
    return { deny: true, rule: 'monitor', reason:
      'foreman-guard: Monitor is depth-0 only (ironlaw #6). A foreman waits with run_in_background + a paired dead-man `sleep <deadline>; echo WAKE`, then ENDS ITS TURN.' };
  }
  if (tool !== 'Bash') return { deny: false };
  const cmd = typeof input.command === 'string' ? input.command : '';
  const background = isAffirmative(input.run_in_background);
  if (!background) {
    for (const r of POLL_RULES) {
      if (r.re.test(cmd)) {
        return { deny: true, rule: r.id, reason:
          `foreman-guard: ${r.why} (rule ${r.id}, ironlaw #6). Wait with run_in_background: true (one notification) + a background dead-man timer, then END THE TURN; never read a leaf's .output into context — consume only its schema verdict.` };
      }
    }
  }
  const n = st.bash_calls + 1;
  if (n > cfg.bashCap) {
    return { deny: true, rule: 'bash-cap', count: n, reason:
      `foreman-guard: Bash call ${n} exceeds the foreman cap of ${cfg.bashCap} (ironlaw #6, 一刀一命). Write your handoff (autopilot:handoff) NOW and end the turn; depth-0 spawns the next foreman for the next deliverable. Resident foremen are forbidden.` };
  }
  return { deny: false, count: n };
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
    const file = stateFile(sessionId, payload.agent_id);
    const st = loadState(file);
    const d = decide(payload, cfg, st);
    if (payload.tool_name === 'Bash' && !d.deny) st.bash_calls = d.count;
    if (d.deny) {
      st.denied += 1;
      st.last_denied_rule = d.rule;
      if (d.rule === 'bash-cap') st.bash_calls = d.count; // the attempt still counts
    }
    saveState(file, st);
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
