#!/usr/bin/env node
/**
 * context-budget — PostToolUse * (default-on since v2.35.15; opt-in v2.32.27–v2.35.14)
 *
 * Measures the REAL context size (last assistant `message.usage` in the
 * transcript: input + cache_read + cache_creation) and nudges/directs session
 * splitting at thresholds. Born of the 2026-07-14 transcript study: 96%+ of
 * all tokens were cache_read on ever-growing depth-0 sessions (1.12B-token
 * single session worst case) — context cost ≈ length × remaining messages,
 * quadratic in session length. suggest-compact counts tool calls (a proxy);
 * this hook reads the actual curve.
 *
 * Tiers (defaults; override via ~/.autopilot/config.json context_budget
 * {t1,t2,mode} or env AUTOPILOT_CONTEXT_BUDGET_T1/T2/MODE):
 *  - T1 (100k): stderr nudge, exit 0 (user-visible). Refire ≤ every 20 calls.
 *  - T2 (150k): escalated advisory, exit 2 (stderr fed to the MODEL): write a
 *    handoff NOW + user-facing "/clear after it lands". Refire ≤ every 10
 *    calls. PostToolUse cannot deny and /clear is a USER action — no pretend
 *    enforcement (MiniMax panel finding). T3 deny tier deliberately DEFERRED
 *    until warn-mode calibration exists (see plan §Out of scope).
 *
 * Cost control: below T1 the transcript is parsed only every 5th call; at/after
 * T1, every call (burst-overshoot finding). State (call counters, last-fire
 * marks) lives in ~/.autopilot/context-budget/<sid>.json — host-stable, NOT
 * TMPDIR (docker-exec visibility); corrupt state ⇒ reset-and-continue.
 *
 * Enable: ~/.autopilot/config.json {"hooks":{"context-budget":true}} or
 * AUTOPILOT_HOOK_CONTEXT_BUDGET=1.
 * Fail-open: any error ⇒ exit 0. Separate state/script from
 * orchestrator-edit-gate (single-crash isolation, panel finding).
 *
 * v2.36.1 (P2): the statusline live file (scripts/lib/live-state-dir.js) publishes the
 * REAL context window and total_input_tokens, so when it is present and fresh the window
 * is READ, not inferred — inferWindowTokens/scaleTiers-by-ratchet stay as the fallback for
 * when no usable live file exists (absent, stale >120s, wrong schema_version, malformed).
 * State dir also moves under the resolved live base (`<base>/context-budget/`) unless
 * AUTOPILOT_CONTEXT_BUDGET_DIR is set; with no RAM-backed base, resolveLiveDir()'s own SSD
 * fallback IS ~/.autopilot, so the no-live-file path is byte-for-byte v2.36.0.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readContextTokens, readContextUsage, budgetDecision, inferWindowTokens, scaleTiers, tiersForKnownWindow,
} = require('./context-budget-lib.js');
const { resolveLiveDir, sanitizeSessionId, readLive } = require('../scripts/lib/live-state-dir.js');

const PARSE_EVERY_BELOW_T1 = 5;

// Writer/reader parity (plan §2.5): session_id from the hook payload first, env second,
// cwd last — the SAME sanitiser used by every live-file consumer.
function getSessionId(payload) {
  const raw = (payload && typeof payload.session_id === 'string' && payload.session_id)
    || process.env.CLAUDE_CODE_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || process.cwd();
  return sanitizeSessionId(raw);
}

function loadConfig() {
  // explicitT1/T2 track whether the value came from the USER (config/env) or is
  // still the 200K-calibrated default. Window inference may rescale defaults;
  // it must never override a value the user set by hand. (v2.32.56)
  const cfg = { t1: 100_000, t2: 150_000, mode: 'warn', explicitT1: false, explicitT2: false };
  try {
    const file = path.join(os.homedir(), '.autopilot', 'config.json');
    const user = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cb = user && user.context_budget;
    if (cb && typeof cb === 'object') {
      if (Number.isFinite(cb.t1)) { cfg.t1 = cb.t1; cfg.explicitT1 = true; }
      if (Number.isFinite(cb.t2)) { cfg.t2 = cb.t2; cfg.explicitT2 = true; }
      if (cb.mode === 'off' || cb.mode === 'warn') cfg.mode = cb.mode;
    }
  } catch { /* absent/corrupt config → defaults */ }
  const envT1 = Number(process.env.AUTOPILOT_CONTEXT_BUDGET_T1);
  const envT2 = Number(process.env.AUTOPILOT_CONTEXT_BUDGET_T2);
  if (Number.isFinite(envT1) && envT1 > 0) { cfg.t1 = envT1; cfg.explicitT1 = true; }
  if (Number.isFinite(envT2) && envT2 > 0) { cfg.t2 = envT2; cfg.explicitT2 = true; }
  if (process.env.AUTOPILOT_CONTEXT_BUDGET_MODE === 'off') cfg.mode = 'off';
  return cfg;
}

function loadState(file) {
  try {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (st && typeof st === 'object' && Number.isFinite(st.calls)) return st;
  } catch { /* corrupt/absent ⇒ reset-and-continue */ }
  return { calls: 0, lastT1Call: 0, lastT2Call: 0, lastContext: 0, observedMax: 0 };
}

function saveState(file, st) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, file);
}

(function main() {
  let exitCode = 0;
  try {
    // default-on since v2.35.15 (was opt-in); opt out with context_budget.mode=off or
    // AUTOPILOT_CONTEXT_BUDGET_MODE=off (loadConfig).
    const cfg = loadConfig();
    if (cfg.mode === 'off') process.exit(0);

    let payload = {};
    // fd 0, not '/dev/stdin': the device path throws ENXIO under piped spawns
    // (#6305 — the same trap documented in suggest-compact.js).
    try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* fail-open */ }
    // Depth-0 only: subagent fires carry agent_id (SPIKE-1) and would read the
    // PARENT transcript anyway — a T2 exit-2 there would inject the handoff
    // directive into the wrong actor's stderr (pre-merge review finding).
    if (payload && payload.agent_id) process.exit(0);
    const tpath = payload && payload.transcript_path;
    if (!tpath || typeof tpath !== 'string') process.exit(0);

    const sid = getSessionId(payload);
    const live = resolveLiveDir();
    const stDir = process.env.AUTOPILOT_CONTEXT_BUDGET_DIR || path.join(live.base, 'context-budget');
    fs.mkdirSync(stDir, { recursive: true });
    const stateFile = path.join(stDir, `${sid}.json`);
    const st = loadState(stateFile);
    st.calls += 1;

    const liveMain = readLive(live.base, sid, { kind: 'main' });
    const liveWindow = liveMain && liveMain.context_window
      && Number.isFinite(liveMain.context_window.context_window_size)
      ? liveMain.context_window.context_window_size : null;
    const liveTotal = liveMain && liveMain.context_window
      && Number.isFinite(liveMain.context_window.total_input_tokens)
      ? liveMain.context_window.total_input_tokens : null;
    const liveUsable = liveWindow !== null && liveTotal !== null;

    if (liveUsable) {
      // v2.36.1 (P2): the live file gives the EXACT window — skip inferWindowTokens.
      // contextTokens defaults to the live total (free — the live file is already
      // parsed); only on the periodic parse cadence do we also read the transcript,
      // to guard against a live tick that lags a transcript row that already grew
      // past it (contextTokens = max(transcript, live total) when the transcript
      // row predates the live file's own written_at; otherwise the transcript row
      // is at least as fresh, so it is trusted directly).
      const liveCfg = tiersForKnownWindow(cfg, liveWindow);
      const mustParse = st.lastContext >= liveCfg.t1 || st.calls % PARSE_EVERY_BELOW_T1 === 0 || st.calls === 1;
      let contextTokens = liveTotal;
      if (mustParse) {
        const usage = readContextUsage(tpath);
        if (usage !== null) {
          const writtenMs = Date.parse(liveMain.written_at);
          const rowMs = usage.timestamp ? Date.parse(usage.timestamp) : NaN;
          if (Number.isFinite(writtenMs) && Number.isFinite(rowMs) && rowMs < writtenMs) {
            contextTokens = Math.max(usage.tokens, liveTotal);
          } else if (Number.isFinite(rowMs)) {
            contextTokens = usage.tokens; // transcript is at least as fresh as the live tick
          }
        }
      }
      st.lastContext = contextTokens;
      st.observedMax = Math.max(Number.isFinite(st.observedMax) ? st.observedMax : 0, contextTokens);
      const d = budgetDecision(
        { contextTokens, calls: st.calls, lastT1Call: st.lastT1Call, lastT2Call: st.lastT2Call },
        { ...liveCfg, windowSource: 'statusline' },
      );
      if (d.tier === 't1') {
        st.lastT1Call = st.calls;
        process.stderr.write(`${d.message}\n`);
      } else if (d.tier === 't2') {
        st.lastT2Call = st.calls;
        process.stderr.write(`${d.message}\n`);
        exitCode = 2; // PostToolUse exit 2 ⇒ stderr reaches the model
      }
    } else {
      // Unchanged inference path: no usable live file (absent, stale, wrong
      // schema_version, or malformed) ⇒ v2.36.0 behaviour, byte-for-byte.
      //
      // Window inference (v2.32.56): scale the 200K-calibrated defaults to the
      // window implied by the largest context this session has actually reached.
      // Applied to the mustParse gate too, so the cheap path uses the same tiers.
      const effCfg = scaleTiers(cfg, inferWindowTokens(st.observedMax));

      // Cheap path below T1: parse only every Nth call. Once T1 territory has
      // been seen, parse every call (a burst can overshoot fast).
      const mustParse = st.lastContext >= effCfg.t1 || st.calls % PARSE_EVERY_BELOW_T1 === 0 || st.calls === 1;
      if (mustParse) {
        const tokens = readContextTokens(tpath);
        if (tokens !== null) {
          st.lastContext = tokens;
          // Ratchet: observing N tokens proves the window is > N. Monotonic, so
          // auto-compaction (which lowers current context) cannot walk it back.
          st.observedMax = Math.max(Number.isFinite(st.observedMax) ? st.observedMax : 0, tokens);
          const liveCfg = scaleTiers(cfg, inferWindowTokens(st.observedMax));
          const d = budgetDecision(
            { contextTokens: tokens, calls: st.calls, lastT1Call: st.lastT1Call, lastT2Call: st.lastT2Call },
            liveCfg,
          );
          if (d.tier === 't1') {
            st.lastT1Call = st.calls;
            process.stderr.write(`${d.message}\n`);
          } else if (d.tier === 't2') {
            st.lastT2Call = st.calls;
            process.stderr.write(`${d.message}\n`);
            exitCode = 2; // PostToolUse exit 2 ⇒ stderr reaches the model
          }
        }
      }
    }
    saveState(stateFile, st);
  } catch (e) {
    try { process.stderr.write(`context-budget error (fail-open): ${e.message}\n`); } catch { /* ignore */ }
    exitCode = 0;
  }
  process.exit(exitCode);
})();
