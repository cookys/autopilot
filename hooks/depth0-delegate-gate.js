#!/usr/bin/env node
/**
 * depth0-delegate-gate — PreToolUse WebFetch|WebSearch|Read|Grep|Glob|Bash|Agent|Task|Skill
 * (default-on, v2.36.1 P3; foreground-wait advisory added later)
 *
 * Nudges DEPTH-0 (the read-burst and wait nudges skip subagents — payload carries `agent_id`, SPIKE-1;
 * the Bash-launch guard below is the exception and runs at every depth)
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
 * Accepted for v2.36.1 as an expansion over the frozen plan matcher in
 * docs/plans/_archive/2026/09/2026-09-05-statusline-live-context-feed.md §4 P3.1 (which listed
 * WebFetch|WebSearch|Read|Grep|Glob|Agent|Skill|Task only) — Bash was added so read-shaped Bash calls
 * (grep/cat/find/etc.) are not a silent bypass of the read-burst counter; recorded here so the delta
 * from the frozen plan is explicit.
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
 * FOREGROUND-WAIT ADVISORY (advice-only): independent of the read counter, a depth-0 Bash call
 * that is NOT `run_in_background` and (a) runs `sleep` >= 20 s, (b) is a `while`/`until` loop whose
 * body sleeps or spins, or (c) is `tail -f`/`-F`/`--follow`, gets one additionalContext line
 * recommending run_in_background + completion notification, Monitor, or a background `until` loop.
 * The match rules are the SAME ones foreman-guard.js denies on (scripts/lib/bash-wait-rules.js,
 * shared; the 20 s floor is this gate's, foreman-guard denies any sleep). Throttle: the 1st hit per
 * session and every `wait_advice_every`-th (default 5) hit after it; counter `waitHits` in the
 * session state file. This rule supports `off` and `warn` only: in `block` mode it STILL only
 * advises, because the foreground-wait guidance text (dev-flow SKILL.md) is still awaiting its
 * eval and an unevidenced deny would enforce guidance nobody has measured. Mode `off` silences it.
 *
 * BASH-LAUNCH GUARD (BL-0019; applies at EVERY depth, subagents included, and runs before the
 * depth-0-only skip; scripts/lib/bash-launch-rules.js defines the rules):
 *   1. DENY  trailing `&` or `setsid -f` launching a dispatch rail entrypoint (see bash-launch-rules.js)
 *            with no wake-up in the same command (wait-dispatch-results / `wait`) — use the Bash
 *            tool's run_in_background. Non-rail detaches (`setsid nohup bash x.sh`) are untouched.
 *            Exception: a `setsid -f` review/author/hetero/foreman launch carrying every ledger arg
 *            (--ledger --run-id [--stage]) is allowed — its <ledger>.results/<id>.<stage>.exit file is
 *            the wake-up source for the next call (foreman --resume and DISPATCH_DETACH=0 excluded).
 *   2. DENY  (BL-0148; was WARN) `pkill -f` / `pgrep -f` whose pattern has no `[x]` self-exclusion bracket —
 *            the pattern matches the Bash tool's own command line, so the call can kill its own shell.
 *            Knob (independent of the gate mode): ~/.autopilot/config.json depth0_delegate_gate.pkill_self_match
 *            or env AUTOPILOT_BASH_GUARD_PKILL_MODE = off|warn|deny (default deny; garbage ⇒ deny). Only the
 *            Bash TOOL call text is judged — scripts that use pgrep -f internally are never run through this hook.
 *   3. WARN  (only when the shell is zsh; never a deny, by owner ruling) a word starting with `=`
 *            or an unquoted glob that matches nothing — zsh aborts the whole line.
 * Gate mode `off` silences all three. Rules 1 and 2 deny in `warn` and `block` modes alike.
 *
 * MODES: ~/.autopilot/config.json {"depth0_delegate_gate": {"mode": "off"|"warn"|"block",
 * "threshold": 8, "guarded_models": ["fable","opus"], "wait_advice_every": 5}} or
 * AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE / AUTOPILOT_DEPTH0_WAIT_ADVICE_EVERY.
 * Garbage/unrecognised mode ⇒ warn (the default). Fail-open: any internal error ⇒ exit 0.
 * State: `<live-dir>/depth0-gate/<sid>.json` (+ AUTOPILOT_DEPTH0_GATE_DIR override), same
 * live-dir resolution as every other v2.36.1 consumer (scripts/lib/live-state-dir.js).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const { configPath } = require('../scripts/lib/config-path.js');
const path = require('path');
const { resolveLiveDir, sanitizeSessionId, readLive, modelFamily } = require('../scripts/lib/live-state-dir.js');
// Executable-text lexer + foreground-wait rules are shared with foreman-guard.js.
const { executableText, detectForegroundWait } = require('../scripts/lib/bash-wait-rules.js');
// Bash-launch hazards (BL-0019): detach-without-wake (deny), pkill -f self-match (deny, knob), zsh `=`/glob (warn).
const { detectDetachNoWake, detectPkillSelfMatch, detectZshExpansion } = require('../scripts/lib/bash-launch-rules.js');

const DEFAULT_THRESHOLD = 8;
const DEFAULT_GUARDED = ['fable', 'opus'];
const READ_CLASS_TOOLS = new Set(['WebFetch', 'WebSearch', 'Read', 'Grep', 'Glob']);
const DELEGATION_TOOLS = new Set(['Agent', 'Task', 'Skill']);
const DEFAULT_WAIT_ADVICE_EVERY = 5;
const WAIT_MIN_SLEEP_SECONDS = 20;
// Executable-text prefixes (post-strip, trimmed) that make a Bash call read-class.
const BASH_READ_PREFIXES = ['grep ', 'rg ', 'find ', 'cat ', 'sed -n', 'head ', 'tail '];

function isBashReadClass(cmd) {
  const text = executableText(typeof cmd === 'string' ? cmd : '').trim();
  return BASH_READ_PREFIXES.some((p) => text.startsWith(p));
}

function loadConfig() {
  const cfg = {
    mode: 'warn', pkillMode: 'deny', threshold: DEFAULT_THRESHOLD, guardedModels: DEFAULT_GUARDED, waitAdviceEvery: DEFAULT_WAIT_ADVICE_EVERY,
  };
  try {
    const file = configPath();
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const g = j && j.depth0_delegate_gate;
      if (g && typeof g === 'object') {
        if (['off', 'warn', 'block'].includes(g.mode)) cfg.mode = g.mode;
        if (['off', 'warn', 'deny'].includes(g.pkill_self_match)) cfg.pkillMode = g.pkill_self_match;
        if (Number.isInteger(g.threshold) && g.threshold > 0) cfg.threshold = g.threshold;
        if (Number.isInteger(g.wait_advice_every) && g.wait_advice_every > 0) cfg.waitAdviceEvery = g.wait_advice_every;
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
  // Env wins over config; unset/empty leaves config alone, a garbage value maps to deny (never leaves the rule disarmed).
  const envPk = process.env.AUTOPILOT_BASH_GUARD_PKILL_MODE;
  if (envPk !== undefined && envPk !== '') cfg.pkillMode = ['off', 'warn', 'deny'].includes(envPk) ? envPk : 'deny';
  const envEvery = process.env.AUTOPILOT_DEPTH0_WAIT_ADVICE_EVERY;
  if (envEvery !== undefined && /^\d+$/.test(envEvery.trim()) && Number(envEvery) > 0) cfg.waitAdviceEvery = Number(envEvery);
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
    if (s && typeof s === 'object' && Number.isInteger(s.reads)) {
      if (!Number.isInteger(s.waitHits)) s.waitHits = 0;
      return s;
    }
  } catch { /* fresh */ }
  return { reads: 0, lastFireAt: null, waitHits: 0 };
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
// BL-0137: synchronous sleep for withLock's retry gap. Atomics.wait parks the thread on a
// private cell that nothing notifies, so it waits the full timeout without burning CPU.
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) { Atomics.wait(SLEEP_CELL, 0, 0, ms); }

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
      sleepSync(15); // synchronous sleep (BL-0137): no CPU burn while the holder finishes
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
    // BASH-LAUNCH GUARD (all depths — runs BEFORE the depth-0-only skip below). See header.
    // Rule 1 denies here; rules 2/3 only collect warnings, which ride along with whatever the
    // rest of this hook emits (the read counter and the wait advisory still run).
    const launchWarns = [];
    if (payload.tool_name === 'Bash' && payload.tool_input && typeof payload.tool_input.command === 'string') {
      const cmd = payload.tool_input.command;
      const detach = detectDetachNoWake(cmd);
      if (detach) {
        emitDeny(`bash-launch-guard (${detach.rule}): ${detach.why}. ${detach.advice}`);
        process.exit(0);
      }
      const pk = cfg.pkillMode === 'off' ? null : detectPkillSelfMatch(cmd);
      if (pk && cfg.pkillMode === 'deny') {
        emitDeny(`bash-launch-guard (${pk.rule}): ${pk.why}. Set AUTOPILOT_BASH_GUARD_PKILL_MODE=warn|off `
          + '(or depth0_delegate_gate.pkill_self_match in ~/.autopilot/config.json) to relax.');
        process.exit(0);
      }
      if (pk) launchWarns.push(`bash-launch-guard (${pk.rule}): ${pk.why}`);
      const shellName = path.basename(process.env.AUTOPILOT_BASH_GUARD_SHELL || process.env.SHELL || '');
      if (shellName === 'zsh') {
        const z = detectZshExpansion(cmd, typeof payload.cwd === 'string' ? payload.cwd : process.cwd());
        if (z) launchWarns.push(`bash-launch-guard (${z.rule}, warn only): ${z.why}`);
      }
    }
    const emitAdvisory = (lines) => {
      const advisory = lines.join('\n');
      process.stderr.write(`${advisory}\n`);
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: advisory } })}\n`);
    };
    // Presence, not truthiness: an empty/null agent_id still marks a subagent fire (review 🟠 agent-id-presence).
    if (Object.prototype.hasOwnProperty.call(payload, 'agent_id')) { // depth-1+: foreman-guard's territory
      if (launchWarns.length) emitAdvisory(launchWarns);
      process.exit(0);
    }

    const tool = payload.tool_name || '';
    const kind = classify(tool, payload.tool_input);
    // Foreground-wait advisory (advice-only, never a deny): a depth-0 Bash that sleeps >=20 s,
    // loops on sleep, or follows a log in the foreground. Independent of the read counter.
    const waitRule = tool === 'Bash' && payload.tool_input
      ? detectForegroundWait(payload.tool_input.command, payload.tool_input.run_in_background, WAIT_MIN_SLEEP_SECONDS)
      : null;
    if (kind === 'other' && !waitRule) { // no-op: counter untouched
      if (launchWarns.length) emitAdvisory(launchWarns);
      process.exit(0);
    }

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
      // Throttle: first hit, then every `waitAdviceEvery`-th hit after it (hits 1, 1+N, 1+2N, ...).
      let waitNudge = false;
      if (waitRule) {
        st.waitHits += 1;
        waitNudge = (st.waitHits - 1) % cfg.waitAdviceEvery === 0;
      }
      if (kind === 'other') {
        saveState(file, st);
        return { action: 'silent', waitNudge };
      }
      if (kind === 'delegation') {
        st.reads = 0;
        saveState(file, st);
        return { action: 'silent', waitNudge };
      }
      // kind === 'read'
      st.reads += 1;
      const reads = st.reads;
      const threshold = cfg.threshold;
      const nudge = reads >= threshold && reads % threshold === 0;
      if (nudge) st.lastFireAt = new Date().toISOString();
      const action = cfg.mode === 'block' && reads >= 2 * threshold ? 'maybe-block' : (nudge ? 'nudge' : 'silent');
      saveState(file, st);
      return { action, nudge, reads, waitNudge };
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

    const advisories = [...launchWarns];
    if (verdict.nudge) {
      advisories.push(`depth0-delegate-gate: ${verdict.reads} consecutive read-class calls at depth-0 — `
        + 'delegate to an Explore/survey subagent (model: sonnet) and read only its conclusion');
    }
    if (verdict.waitNudge) {
      advisories.push(`depth0-delegate-gate: foreground wait at depth-0 (${waitRule}) — prefer run_in_background `
        + 'with a completion notification, the Monitor tool, or an `until` loop run in the background, '
        + 'instead of holding the turn with sleep/tail polling');
    }
    if (advisories.length) {
      const advisory = advisories.join('\n');
      process.stderr.write(`${advisory}\n`);
      process.stdout.write(`${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: advisory,
        },
      })}\n`);
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: a nudge must never wedge a tool call by crashing
  }
})();
