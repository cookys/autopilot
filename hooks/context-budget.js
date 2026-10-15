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
 * {t1,t2,step,mode} or env AUTOPILOT_CONTEXT_BUDGET_T1/T2/STEP/MODE):
 *  - Defaults are ABSOLUTE (100k/150k) whatever the window: cost is turns x context, so a 1M
 *    window does not move them up. Only a window smaller than 200K scales them down.
 *  - T1 (100k): stderr nudge, exit 0 (user-visible). On a known 1M window with no auto-compact
 *    window set and compaction on (scripts/lib/autocompact-window.js), it adds one line telling
 *    the owner to set autoCompactWindow.
 *  - T2 (150k): escalated advisory, exit 2 (stderr fed to the MODEL): write a
 *    handoff NOW + user-facing "/clear after it lands".
 *  - Re-reminder throttle is per TOKEN STEP, not per call: a tier refires only after context
 *    grew >= step (default 50000; config context_budget.step / env AUTOPILOT_CONTEXT_BUDGET_STEP)
 *    since that tier's last fire; the context at last fire lives in the state file
 *    (lastT1Context/lastT2Context). step 0 = remind on every call past the threshold.
 *    Two restart rules: context falling by >= step since the last reminder starts a new count,
 *    and context dropping below a tier's threshold resets that tier (the next climb reminds).
 *    PostToolUse cannot deny and /clear is a USER action — no pretend
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
 * Transcript `message.model` carries no `[1m]` suffix (same string for 200K and 1M
 * variants); `[1m]` exists only on the live file's `model.id`. With no live file there
 * is no window signal in the transcript — do not invent a CLAUDE_* window env var.
 * State dir also moves under the resolved live base (`<base>/context-budget/`) unless
 * AUTOPILOT_CONTEXT_BUDGET_DIR is set; with no RAM-backed base, resolveLiveDir()'s own SSD
 * fallback IS ~/.autopilot, so the no-live-file path is byte-for-byte v2.36.0.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const { configPath } = require('../scripts/lib/config-path.js');
const path = require('path');
const {
  readContextTokens, readContextUsage, budgetDecision, inferWindowTokens, scaleTiers, tiersForKnownWindow, BASE_WINDOW,
} = require('./context-budget-lib.js');
const { resolveLiveDir, sanitizeSessionId, readLive } = require('../scripts/lib/live-state-dir.js');
const { writeLiveRecord } = require('../scripts/statusline-live-tee.js');
const autocompact = require('../scripts/lib/autocompact-window.js');

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
  // still the absolute default. Only a window SMALLER than 200K rescales defaults down;
  // it must never override a value the user set by hand. (v2.32.56)
  const cfg = { t1: 100_000, t2: 150_000, mode: 'warn', explicitT1: false, explicitT2: false, liveWrite: true, step: 50_000 };
  try {
    const file = configPath();
    const user = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cb = user && user.context_budget;
    if (cb && typeof cb === 'object') {
      if (Number.isFinite(cb.t1)) { cfg.t1 = cb.t1; cfg.explicitT1 = true; }
      if (Number.isFinite(cb.t2)) { cfg.t2 = cb.t2; cfg.explicitT2 = true; }
      if (Number.isFinite(cb.step) && cb.step >= 0) cfg.step = cb.step;
      if (cb.mode === 'off' || cb.mode === 'warn') cfg.mode = cb.mode;
      if (cb.live_write === false) cfg.liveWrite = false;
    }
  } catch { /* absent/corrupt config → defaults */ }
  const envT1 = Number(process.env.AUTOPILOT_CONTEXT_BUDGET_T1);
  const envT2 = Number(process.env.AUTOPILOT_CONTEXT_BUDGET_T2);
  if (Number.isFinite(envT1) && envT1 > 0) { cfg.t1 = envT1; cfg.explicitT1 = true; }
  if (Number.isFinite(envT2) && envT2 > 0) { cfg.t2 = envT2; cfg.explicitT2 = true; }
  const envStepRaw = process.env.AUTOPILOT_CONTEXT_BUDGET_STEP;
  const envStep = envStepRaw === undefined || envStepRaw === '' ? NaN : Number(envStepRaw);
  if (Number.isFinite(envStep) && envStep >= 0) cfg.step = envStep; // env beats config; 0 = remind on every call
  if (process.env.AUTOPILOT_CONTEXT_BUDGET_MODE === 'off') cfg.mode = 'off';
  // v2.37 (mods P1W W2f) opt-out for the live-context-file writer only (the hook keeps nudging).
  const lw = process.env.AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE;
  if (lw === 'off' || lw === '0' || lw === 'false') cfg.liveWrite = false;
  return cfg;
}

const WRITER_ID = 'context-budget';
const BASE_WINDOW_TOKENS = 200_000;
const ONE_M = 1_000_000;

// Mods P1W W2f: when the host status line does not keep `<live>/context/<sid>.json` fresh,
// derive it from the transcript's last usage row (same schema as scripts/statusline-live-tee.js,
// plus `writer` / `window_source`). `fresh` is readLive's verdict (<=120 s, schema 1). A fresh
// file that this writer did not author is the status line's: never overwritten. Window: a
// status-line window ever seen for this session (st.knownWindow, or a stale status-line file
// still on disk) > observed context above 200K (so 1M) > unknown (pct null; tokens still written).
function maybeWriteLive(base, sid, tpath, st, fresh) {
  if (fresh && fresh.writer !== WRITER_ID) return;
  const usage = readContextUsage(tpath);
  if (usage === null) return;
  let window = Number.isFinite(st.knownWindow) && st.knownWindow > 0 ? st.knownWindow : null;
  if (window === null) {
    // Same validation as the inference branch (schema 1, parseable written_at, not our own echo,
    // positive window): an unvalidated file must not become the remembered window here either.
    const w = readStaleWindow(base, sid);
    if (w !== null) { window = w; st.knownWindow = w; }
  }
  let windowSource = 'statusline';
  if (window === null) {
    const peak = Math.max(usage.tokens, Number.isFinite(st.observedMax) ? st.observedMax : 0);
    if (peak > BASE_WINDOW_TOKENS) { window = ONE_M; windowSource = 'observed'; } else windowSource = 'unknown';
  }
  const record = {
    schema_version: 1,
    session_id: sid,
    written_at: new Date().toISOString(),
    writer: WRITER_ID,
    window_source: windowSource,
    model: {},
    context_window: {
      context_window_size: window,
      used_percentage: window ? Math.round((usage.tokens / window) * 100) : null,
      total_input_tokens: usage.tokens,
      current_usage: usage.parts,
    },
  };
  writeLiveRecord(base, record);
}

// The context window of THIS session's status-line live file regardless of its age (readLive
// applies the 120 s cap; a window does not go stale). Null when the file is absent, malformed,
// not schema 1, authored by this hook, or carries no positive window.
function readStaleWindow(base, sid) {
  const rec = readLive(base, sid, { kind: 'main', maxAgeMs: Number.MAX_SAFE_INTEGER });
  if (!rec || rec.writer === WRITER_ID || !rec.context_window) return null;
  const w = rec.context_window.context_window_size;
  return Number.isFinite(w) && w > 0 ? w : null;
}

function loadState(file) {
  try {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (st && typeof st === 'object' && Number.isFinite(st.calls)) return st;
  } catch { /* corrupt/absent ⇒ reset-and-continue */ }
  return { calls: 0, lastT1Context: 0, lastT2Context: 0, lastContext: 0, observedMax: 0 };
}

// A tier's step throttle restarts when context falls back under that tier's threshold
// (compaction / clear): the next climb past it is a NEW cycle and must remind at once.
function resetBelowTiers(st, contextTokens, cfg) {
  if (contextTokens < cfg.t1) st.lastT1Context = 0;
  if (contextTokens < cfg.t2) st.lastT2Context = 0;
}

function saveState(file, st) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, file);
}

function emitInjected(message) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `${message}`,
    },
  })}\n`);
}

// T1 is an owner nudge, not a model instruction (P7a advisory bridge): one advisory row for the live mod, no
// additionalContext. AUTOPILOT_ADVISORY_BRIDGE_CONTEXT_BUDGET=inject restores the injection. T2 never comes here.
// A 1M-window session with no auto-compact window set compacts only near 1M, so T1 also tells the
// owner how to set one (evidence: docs/plans/evidence/2026-10-12-context-reset-cost/README.md).
// Read only when T1 fires; any read failure leaves the message as it was.
function withAutocompactTip(message, window, payload, model) {
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || (payload && typeof payload.cwd === 'string' ? payload.cwd : undefined);
    const tip = autocompact.recommendation(autocompact.resolve({ projectDir, model }), window);
    return tip ? `${message} ${tip}` : message;
  } catch { return message; }
}

// BL-0124: the effective auto-compact window, only when compaction is on and this context is
// already at T2 (the only place it matters; avoids settings reads on every tool call).
function autocompactForT2(contextTokens, t2, payload, model) {
  try {
    if (!(t2 > 0 && contextTokens >= t2)) return null;
    const projectDir = process.env.CLAUDE_PROJECT_DIR || (payload && typeof payload.cwd === 'string' ? payload.cwd : undefined);
    const r = autocompact.resolve({ projectDir, model });
    return r.enabled && Number.isFinite(r.configured) ? r.configured : null;
  } catch { return null; }
}

function emitT1(sid, message) {
  const sink = require('./_shared/advisory-sink.js');
  if (sink.advisoryMode('context_budget') === 'inject') { emitInjected(message); return; }
  if (!sink.writeAdvisory({ sid, kind: 'context-budget-t1', severity: 'info', text: message })) emitInjected(message);
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

    const liveRaw = readLive(live.base, sid, { kind: 'main' });
    // A file this hook wrote itself (W2f) is a derived echo of the transcript, not a status-line
    // window: it must never drive the "(statusline)" path.
    const liveMain = liveRaw && liveRaw.writer !== WRITER_ID ? liveRaw : null;
    // v2.36.2 diagnostic (state only, no behaviour): record how old the live file was at
    // hook time, so a T1/T2 that arrives WITHOUT "(statusline)" on a host that has the
    // writer can be attributed (stale tick vs absent file) after the fact. 2026-09-05:
    // two inference-path T2s on a 1M session whose live file was fresh seconds later.
    try {
      const liveFile = path.join(live.base, 'context', `${sid}.json`);
      const ageMs = Date.now() - fs.statSync(liveFile).mtimeMs;
      st.lastLive = { at: new Date().toISOString(), ageMs: Math.round(ageMs), present: liveMain !== null };
    } catch { st.lastLive = { at: new Date().toISOString(), ageMs: null, present: false }; }
    // v2.36.2: a window must be > 0 — `-1` produced a "-15300000% of the ~-0k window"
    // message and `0` silently reverted to the unscaled ceiling while still claiming
    // "(statusline)". A non-positive window is treated as absent (inference path).
    const liveWindow = liveMain && liveMain.context_window
      && Number.isFinite(liveMain.context_window.context_window_size)
      && liveMain.context_window.context_window_size > 0
      ? liveMain.context_window.context_window_size : null;
    const liveTotal = liveMain && liveMain.context_window
      && Number.isFinite(liveMain.context_window.total_input_tokens)
      ? liveMain.context_window.total_input_tokens : null;
    const liveUsable = liveWindow !== null && liveTotal !== null;
    st.lastLive.used = liveUsable; // false also when present but the window/total was rejected (review 🟡)

    if (liveUsable) {
      // v2.36.1 (P2): the live file gives the EXACT window — skip inferWindowTokens.
      // contextTokens defaults to the live total (free — the live file is already
      // parsed); only on the periodic parse cadence do we also read the transcript,
      // to guard against a live tick that lags a transcript row that already grew
      // past it (contextTokens = max(transcript, live total) when the transcript
      // row predates the live file's own written_at; otherwise the transcript row
      // is at least as fresh, so it is trusted directly).
      const liveCfg = tiersForKnownWindow(cfg, liveWindow);
      // v2.36.22: a session's context window never changes, so remember it. The live
      // file is written by the statusline, which stops ticking while the session waits
      // on a long background task — exactly when a long session is sitting above the
      // 200K-calibrated ceiling. Without this the stale-file fallback re-derives the
      // window from observed usage and fires a spurious T2 (2026-09-09: "threshold 150k"
      // on a 1M window at 21% used; the same shape as the 2026-09-05 note above).
      st.knownWindow = liveWindow;
      if (liveMain.model && typeof liveMain.model.id === 'string') st.knownModel = liveMain.model.id;
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
      resetBelowTiers(st, contextTokens, liveCfg);
      const d = budgetDecision(
        { contextTokens, calls: st.calls, lastT1Context: st.lastT1Context, lastT2Context: st.lastT2Context },
        { ...liveCfg, windowSource: 'statusline', autocompactWindow: autocompactForT2(contextTokens, liveCfg.t2, payload, st.knownModel) },
      );
      if (d.tier === 't1') {
        st.lastT1Context = contextTokens;
        const message = withAutocompactTip(d.message, liveWindow, payload, st.knownModel);
        process.stderr.write(`${message}\n`);
        emitT1(sid, message);
      } else if (d.tier === 't2') {
        st.lastT2Context = contextTokens;
        process.stderr.write(`${d.message}\n`);
        exitCode = 2; // PostToolUse exit 2 ⇒ stderr reaches the model
      }
    } else {
      // Unchanged inference path: no usable live file (absent, stale, wrong
      // schema_version, or malformed) ⇒ v2.36.0 behaviour, byte-for-byte.
      // Transcript `message.model` is not a window source: it has no `[1m]`
      // suffix on real JSONL, so this branch stays on the observed-token ratchet.
      //
      // Window inference (v2.32.56): scale the 200K-calibrated defaults to the
      // window implied by the largest context this session has actually reached.
      // Applied to the mustParse gate too, so the cheap path uses the same tiers.
      // BL-0091: a hook with no memory yet (fresh state, first call after a long tool call)
      // still has this session's own stale status-line file on disk. Its window never changes,
      // so adopt it: only the freshness of the token total is in doubt, and that comes from
      // the transcript on this branch.
      if (!(Number.isFinite(st.knownWindow) && st.knownWindow > 0)) {
        const staleWindow = readStaleWindow(live.base, sid);
        if (staleWindow !== null) st.knownWindow = staleWindow;
      }
      const rememberedWindow = Number.isFinite(st.knownWindow) && st.knownWindow > 0
        ? st.knownWindow : null;
      const effCfg = rememberedWindow !== null
        ? tiersForKnownWindow(cfg, rememberedWindow)
        : scaleTiers(cfg, inferWindowTokens(st.observedMax));

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
          const liveCfg = rememberedWindow !== null
            ? tiersForKnownWindow(cfg, rememberedWindow)
            : scaleTiers(cfg, inferWindowTokens(st.observedMax));
          resetBelowTiers(st, tokens, liveCfg);
          const d = budgetDecision(
            { contextTokens: tokens, calls: st.calls, lastT1Context: st.lastT1Context, lastT2Context: st.lastT2Context },
            rememberedWindow !== null
              ? { ...liveCfg, windowSource: 'session-window', autocompactWindow: autocompactForT2(tokens, liveCfg.t2, payload, st.knownModel) }
              // Unknown window: no live file, nothing remembered, and observedMax < 200K (200K and
              // 1M are indistinguishable). A user-explicit T2 keeps today's directive behaviour.
              : { ...liveCfg, windowUnknown: !cfg.explicitT2 && st.observedMax < BASE_WINDOW },
          );
          if (d.tier === 't1' || (d.tier === 't2' && d.advisory)) {
            if (d.tier === 't2') { st.lastT2Context = tokens; }
            else { st.lastT1Context = tokens; }
            const message = d.tier === 't1'
              ? withAutocompactTip(d.message, rememberedWindow, payload, st.knownModel) : d.message;
            process.stderr.write(`${message}\n`);
            if (d.tier === 't1') emitT1(sid, message);
            else emitInjected(message); // the unknown-window T2 advisory stays model-facing
          } else if (d.tier === 't2') {
            st.lastT2Context = tokens;
            process.stderr.write(`${d.message}\n`);
            exitCode = 2; // PostToolUse exit 2 ⇒ stderr reaches the model
          }
        }
      }
    }
    if (cfg.liveWrite) {
      try { maybeWriteLive(live.base, sid, tpath, st, liveRaw); } catch { /* the writer never breaks the hook */ }
    }
    saveState(stateFile, st);
  } catch (e) {
    try { process.stderr.write(`context-budget error (fail-open): ${e.message}\n`); } catch { /* ignore */ }
    exitCode = 0;
  }
  process.exit(exitCode);
})();
