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
 *  - Per-model tiers (BL-0205): context_budget.per_model {"<model glob>": {t1,t2}}, matched against the live
 *    file's model.id (most literal characters wins; no match or no id keeps the top-level tiers; env T1/T2
 *    still beat it). See scripts/lib/config-path.js.
 *  - Defaults are ABSOLUTE (100k/150k) whatever the window: cost is turns x context, so a 1M
 *    window does not move them up. Only a window smaller than 200K scales them down.
 *  - T1 (100k): stderr nudge, exit 0 (user-visible). On a known 1M window with no auto-compact
 *    window set and compaction on (scripts/lib/autocompact-window.js), it adds one line telling
 *    the owner to set autoCompactWindow.
 *  - T2 (150k): escalated advisory, exit 2 (stderr fed to the MODEL): write a
 *    handoff NOW + user-facing "/clear after it lands". When an auto-compact window is set
 *    (finite > 0) and compaction is on, the wording is instead "keep working, write a handoff
 *    at the next phase boundary" (BL-0124), wherever the window sits relative to T2. Without one
 *    the STOP wording also tells the owner to set autoCompactWindow. For T2 to remind BEFORE
 *    compaction, t2 + gap <= window - 33000 (session-start warns otherwise).
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
 * Default-on (since v2.35.15, no enabling step). Opt out: context_budget.mode=off in ~/.autopilot/config.json or
 * AUTOPILOT_CONTEXT_BUDGET_MODE=off (case-insensitive; any other value is warned about and ignored).
 * Config problems (unknown mode, t1 >= t2, a user-set t2 past the compaction point of a <200K window) are
 * written once per session to stderr; they never change a threshold and never make the hook fail.
 * Post-compact (BL-0271): state-checkpoint arms one check per PostCompact in this state file. The next
 * time a fresh statusline live total is readable, that total is recorded. Above
 * context_budget.post_compact_warn (default 100000; 0 disables; env
 * AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN) one T1-channel advisory fires. The check never changes
 * compaction. A missing live total leaves the check armed and exits 0. A live file written before
 * the arm (postCompactArmedAt, ms) is the pre-compaction value and is skipped until a newer one lands.
 * State file updates run under a short lock (<state>.lock via scripts/lib/jsonl-store.js) shared with
 * the arm; an unobtainable lock fails open (unlocked, exit 0).
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
const { readContextBudget, applyPerModel } = require('../scripts/lib/config-path.js');
const path = require('path');
const {
  lockStateFile, readContextTokens, readContextUsage, budgetDecision, inferWindowTokens, scaleTiers, tiersForKnownWindow, unreachableT2Warning, BASE_WINDOW,
} = require('./context-budget-lib.js');
const { resolveLiveDir, sanitizeSessionId, readLive } = require('../scripts/lib/live-state-dir.js');
const { writeLiveRecord } = require('../scripts/statusline-live-tee.js');
const autocompact = require('../scripts/lib/autocompact-window.js');

const PARSE_EVERY_BELOW_T1 = 5;

// One stderr line per distinct config problem per session (the state file remembers which were said).
function warnOnce(st, text) {
  if (!text) return;
  if (!st.warned || typeof st.warned !== 'object') st.warned = {};
  if (st.warned[text]) return;
  st.warned[text] = true;
  process.stderr.write(`context-budget config: ${text}\n`);
}

// Writer/reader parity (plan §2.5): session_id from the hook payload first, env second,
// cwd last — the SAME sanitiser used by every live-file consumer.
function getSessionId(payload) {
  const raw = (payload && typeof payload.session_id === 'string' && payload.session_id)
    || process.env.CLAUDE_CODE_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || process.cwd();
  return sanitizeSessionId(raw);
}

// session (default) or resident. Unknown values are ignored, same as an unknown mode.
// Env AUTOPILOT_CONTEXT_BUDGET_SEAT beats the config. FLEET_LIFETIME is not consulted.
function normSeat(raw, where, warnings) {
  if (raw === undefined || raw === null || raw === '') return null;
  const seat = String(raw).trim().toLowerCase();
  if (seat === 'session' || seat === 'resident') return seat;
  warnings.push(`context_budget seat "${raw}" (${where}) is not session|resident, so it is ignored and the seat stays session`);
  return null;
}

const POST_COMPACT_WARN_DEFAULT = 100_000;

// Positive integer, or 0 (disabled). Anything else is ignored so the caller keeps the default.
function normPostCompactWarn(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function loadConfig() {
  // One parse of context_budget (config + env), shared with the SessionStart budget warning:
  // scripts/lib/config-path.js readContextBudget. seat and post_compact_warn are read here (BL-0271).
  const parsed = {};
  const cfg = readContextBudget({ parsedOut: parsed });
  cfg.seat = 'session';
  cfg.postCompactWarn = POST_COMPACT_WARN_DEFAULT;
  try {
    const cb = parsed.contextBudget;
    if (cb && typeof cb === 'object') {
      const fromConfig = normSeat(cb.seat, 'config', cfg.warnings);
      if (fromConfig) cfg.seat = fromConfig;
      const warn = normPostCompactWarn(cb.post_compact_warn);
      if (warn !== null) cfg.postCompactWarn = warn;
    }
  } catch { /* a malformed section keeps session and the default post-compact threshold */ }
  const fromEnv = normSeat(process.env.AUTOPILOT_CONTEXT_BUDGET_SEAT, 'env AUTOPILOT_CONTEXT_BUDGET_SEAT', cfg.warnings);
  if (fromEnv) cfg.seat = fromEnv;
  const warnEnv = normPostCompactWarn(process.env.AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN);
  if (warnEnv !== null) cfg.postCompactWarn = warnEnv;
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

// The model id of this session's status-line live file regardless of its age; null when unavailable.
function readStaleModel(base, sid) {
  const rec = readLive(base, sid, { kind: 'main', maxAgeMs: Number.MAX_SAFE_INTEGER });
  if (!rec || rec.writer === WRITER_ID || !rec.model) return null;
  return typeof rec.model.id === 'string' && rec.model.id ? rec.model.id : null;
}

// BL-0205: context_budget.per_model tiers for the model id remembered in state (live file model.id).
// No model id or no match leaves cfg as is; new config warnings are said once per session.
function applyModelTiers(st, cfg) {
  const next = applyPerModel(cfg, st.knownModel);
  if (next !== cfg) for (const w of (next.warnings || []).slice((cfg.warnings || []).length)) warnOnce(st, w);
  return next;
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

// One measurement per PostCompact generation. liveTokens is the statusline total, or null when
// that file cannot be read. Null leaves the generation armed. The advisory uses the T1 channel.
function advisePostCompact(st, sid, liveTokens, cfg) {
  const gen = Number.isFinite(st.postCompactGen) ? st.postCompactGen : 0;
  const seen = Number.isFinite(st.postCompactSeen) ? st.postCompactSeen : 0;
  if (!(gen > seen)) return;
  if (!Number.isFinite(liveTokens)) return;
  st.postCompactSeen = gen;
  st.postCompactTokens = liveTokens;
  const limit = cfg.postCompactWarn;
  if (!(limit > 0) || !(liveTokens > limit)) return;
  const message = `${liveTokens} tokens remain after compaction. A fresh conversation would start around 43K (the reporter's unverified figure). Update the state file or hand off.`;
  process.stderr.write(`${message}\n`);
  emitT1(sid, message);
}

(function main() {
  let exitCode = 0;
  let releaseLock = () => {};
  try {
    // default-on since v2.35.15 (was opt-in); opt out with context_budget.mode=off or
    // AUTOPILOT_CONTEXT_BUDGET_MODE=off (loadConfig).
    let cfg = loadConfig();
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
    // Serialise the load-modify-save of the state file with the PostCompact arm (state-checkpoint.js).
    // No lock inside ~1s ⇒ carry on unlocked (advisory hook, fail open). Released on every exit path.
    const rawRelease = lockStateFile(stateFile);
    let lockHeld = !!rawRelease;
    // Release exactly once (a second release could drop another process's lock): right after the save, or on exit.
    releaseLock = () => { if (lockHeld) { lockHeld = false; try { rawRelease(); } catch { /* ignore */ } } };
    process.on('exit', releaseLock);
    const st = loadState(stateFile);
    st.calls += 1;
    for (const w of cfg.warnings || []) warnOnce(st, w);

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
    // (b) A live value written before the compaction event (st.postCompactArmedAt) is the
    // pre-compaction size: drop its token total BEFORE any decision or state update reads it.
    // The window/model from the same record stay usable.
    const liveWrittenMs = liveMain ? Date.parse(liveMain.written_at) : NaN;
    const preCompactLive = Number.isFinite(st.postCompactArmedAt) && Number.isFinite(liveWrittenMs) && liveWrittenMs <= st.postCompactArmedAt;
    const liveTotal = liveMain && liveMain.context_window && !preCompactLive
      && Number.isFinite(liveMain.context_window.total_input_tokens)
      ? liveMain.context_window.total_input_tokens : null;
    const liveUsable = liveWindow !== null && liveTotal !== null;
    st.lastLive.used = liveUsable; // false also when present but the window/total was rejected (review 🟡)
    let measuredLive = null;

    if (liveUsable) {
      measuredLive = liveTotal;
      // v2.36.1 (P2): the live file gives the EXACT window — skip inferWindowTokens.
      // contextTokens defaults to the live total (free — the live file is already
      // parsed); only on the periodic parse cadence do we also read the transcript,
      // to guard against a live tick that lags a transcript row that already grew
      // past it (contextTokens = max(transcript, live total) when the transcript
      // row predates the live file's own written_at; otherwise the transcript row
      // is at least as fresh, so it is trusted directly).
      if (liveMain.model && typeof liveMain.model.id === 'string') st.knownModel = liveMain.model.id;
      cfg = applyModelTiers(st, cfg);
      const liveCfg = tiersForKnownWindow(cfg, liveWindow);
      warnOnce(st, unreachableT2Warning(cfg, liveWindow));
      // v2.36.22: a session's context window never changes, so remember it. The live
      // file is written by the statusline, which stops ticking while the session waits
      // on a long background task — exactly when a long session is sitting above the
      // 200K-calibrated ceiling. Without this the stale-file fallback re-derives the
      // window from observed usage and fires a spurious T2 (2026-09-09: "threshold 150k"
      // on a 1M window at 21% used; the same shape as the 2026-09-05 note above).
      st.knownWindow = liveWindow;
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
      if (typeof st.knownModel !== 'string' || !st.knownModel) {
        const staleModel = readStaleModel(live.base, sid);
        if (staleModel !== null) st.knownModel = staleModel;
      }
      cfg = applyModelTiers(st, cfg);
      const rememberedWindow = Number.isFinite(st.knownWindow) && st.knownWindow > 0
        ? st.knownWindow : null;
      if (rememberedWindow !== null) warnOnce(st, unreachableT2Warning(cfg, rememberedWindow));
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
    try { advisePostCompact(st, sid, measuredLive, cfg); } catch { /* the size check never breaks the hook */ }
    if (cfg.liveWrite) {
      try { maybeWriteLive(live.base, sid, tpath, st, liveRaw); } catch { /* the writer never breaks the hook */ }
    }
    try { saveState(stateFile, st); } finally { releaseLock(); }
  } catch (e) {
    releaseLock();
    try { process.stderr.write(`context-budget error (fail-open): ${e.message}\n`); } catch { /* ignore */ }
    exitCode = 0;
  }
  process.exit(exitCode);
})();
