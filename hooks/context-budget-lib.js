// context-budget-lib.js — signal + tier decision for the context-budget hook.
//
// WHY split: wrapper (context-budget.js) owns process IO (stdin, state file,
// stderr, exit codes); this lib is the testable core — matching the
// suggest-compact-lib / transcript-reader-lib convention.
//
// Signal: the last assistant `message.usage` row in the depth-0 transcript.
// context ≈ input + cache_read + cache_creation (RAW total, not cost-weighted:
// cache_read tokens are IN the model's context — cheap ≠ absent; panel
// adjudication in project/plans/_archive/2026/07/2026-07-14-context-budget-orchestrator-gate.md).
//
// Backward scan: start with a 64KB tail window and GROW (×4) until the last
// usage row is inside it, capped at 5MB. A single JSONL line (one big tool
// result) can exceed 64KB — assuming the tail contains the row silently
// miscalibrates (MiniMax panel finding). Cap hit ⇒ null, fail-open.

'use strict';

const fs = require('fs');

const START_WINDOW_BYTES = 64 * 1024;
const CAP_BYTES = 5 * 1024 * 1024;
// Re-reminder throttle is per TOKEN STEP, not per call (cfg.step, default 50k): once a tier
// has fired, it fires again only after context grew by >= step since that tier's last fire.
// step 0 = no throttle (remind on every call past the threshold).
const DEFAULT_STEP = 50_000;

// --- Context-window inference (v2.32.56) -------------------------------------
//
// (Tiers no longer scale UP with the window — see scaleTiers. The window is still
// inferred for the proportion shown in the message.)
// The default tiers (100k/150k) are 50%/75% of a 200K window. On a 1M-window
// model they fire from 15% onward and never stop — the hook reports an absolute
// token count that the reader then mistakes for "nearly full". Observed
// 2026-07-20: a 1M session sat at 216k (22%) while T2 fired every single turn.
//
// The harness gives us NO clean signal to key off:
//   - transcript `message.model` is "claude-opus-4-8" for BOTH the 200K and the
//     1M variant — the `[1m]` suffix is not recorded.
//   - no CLAUDE_* env var carries the model or the window size.
//
// So infer it from evidence we already collect: observing N context tokens
// PROVES the window is > N (usage can never exceed the window). Ratchet the
// observed maximum and snap to the smallest known window above it. Safe under
// auto-compaction — context drops, but the historical max stays a valid lower
// bound on the window.
//
// Cost: on a 1M session the very first crossing of 150k still fires once (no
// evidence yet). It self-corrects past 200k. One spurious fire, not dozens.
//
// Extension point: add tiers to KNOWN_WINDOWS as new windows ship. Snapping to
// the SMALLEST known window above the observation is deliberate — over-guessing
// the window (e.g. assuming 1M when it is really 500k) would push the tiers
// past the real ceiling and silence the hook entirely.
const KNOWN_WINDOWS = [200_000, 1_000_000];
const BASE_WINDOW = 200_000; // the window the default tiers were calibrated for
const T3_WINDOW_RATIO = 0.7;

/** Smallest known context window strictly greater than the largest observation. */
function inferWindowTokens(observedMax, windows = KNOWN_WINDOWS) {
  if (!Number.isFinite(observedMax) || observedMax <= 0) return windows[0];
  for (const w of windows) if (observedMax < w) return w;
  return windows[windows.length - 1];
}

/**
 * Tiers for an INFERRED window. Defaults (t1=100k, t2=150k) are absolute and NEVER scale up:
 * cost is turns x context regardless of window size, so a 1M window must not push T2 to 750k.
 * This path only attaches `inferredWindow` so the message can state the proportion. Explicit
 * user config/env wins and is never touched.
 */
function scaleTiers(cfg, inferredWindow) {
  const ratio = inferredWindow / BASE_WINDOW;
  if (!Number.isFinite(ratio) || ratio <= 1) return cfg;
  return { ...cfg, inferredWindow };
}

/**
 * One line when a USER-set T2 can never be reached before Claude Code compacts: the window is below the 200K the
 * defaults were calibrated for and t2 sits past the compaction point (window - 33k buffer). Null otherwise
 * (default t2 scales down with the window, so only an explicit one can land there).
 */
function unreachableT2Warning(cfg, window) {
  if (!cfg || !cfg.explicitT2 || !(cfg.t2 > 0)) return null;
  if (!Number.isFinite(window) || window <= 0 || window >= BASE_WINDOW) return null;
  const { AUTOCOMPACT_BUFFER_TOKENS } = require('../scripts/lib/compaction-handoff.js');
  const point = window - AUTOCOMPACT_BUFFER_TOKENS;
  if (cfg.t2 <= point) return null;
  const k = (n) => `${Math.round(n / 1000)}k`;
  return `context_budget t2 ${k(cfg.t2)} is past the compaction point ${k(point)} (window ${k(window)} - ${k(AUTOCOMPACT_BUFFER_TOKENS)} buffer), so T2 never fires before Claude Code compacts (lower t2 or remove it to scale with the window)`;
}

/**
 * Tiers for a window read EXACTLY from the statusline live file (not inferred). Always tags
 * `inferredWindow` so budgetDecision states the proportion and attributes it to the statusline.
 * Defaults never scale UP; a window smaller than the 200K the defaults were calibrated for
 * still scales them DOWN (so T2 can never sit above the real ceiling).
 */
function tiersForKnownWindow(cfg, window, seat) {
  const ratio = Number.isFinite(window) && window > 0 ? Math.min(1, window / BASE_WINDOW) : 1;
  const seatPct = seat && cfg.t2PctBySeat && Number.isFinite(cfg.t2PctBySeat[seat]) ? cfg.t2PctBySeat[seat] : null;
  const t2 = (!cfg.envT2 && seatPct !== null && Number.isFinite(window) && window > 0)
    ? Math.round(window * (seatPct / 100))
    : (cfg.explicitT2 ? cfg.t2 : Math.round(cfg.t2 * ratio));
  return {
    ...cfg,
    t1: cfg.explicitT1 ? cfg.t1 : Math.round(cfg.t1 * ratio),
    t2,
    // T3 default: 70% of an exactly known window (budgetDecision ignores it unless it is above t2).
    t3: cfg.explicitT3 ? cfg.t3 : (Number.isFinite(window) && window > 0 ? Math.round(window * T3_WINDOW_RATIO) : 0),
    inferredWindow: window,
  };
}

// Extract {tokens, timestamp} from one parsed transcript line, or null.
// `timestamp` is the row's own ISO string when present, else null — used by the
// v2.36.1 live-file comparison (contextTokens = max(transcript, live total) when the
// transcript row is OLDER than the live file's written_at).
function usageRowOf(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  const u = obj && obj.message && obj.message.usage;
  if (!u || typeof u !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const sumOf = (x) => n(x.input_tokens) + n(x.cache_read_input_tokens) + n(x.cache_creation_input_tokens);
  // v2.36.6: a turn that ran the advisor tool carries `usage.iterations` and its top-level
  // cache_read_input_tokens is the SUM over every sub-request (message + advisor_message +
  // message), i.e. roughly double the real context (2026-09-06: 1,244,686 "tokens" on a
  // 1M window at 620k). The last `type: 'message'` iteration is the actual final request.
  let src = u;
  if (Array.isArray(u.iterations)) {
    for (let i = u.iterations.length - 1; i >= 0; i--) {
      const it = u.iterations[i];
      if (it && typeof it === 'object' && (it.type === undefined || it.type === 'message')) { src = it; break; }
    }
  }
  const total = sumOf(src);
  if (total <= 0) return null;
  return {
    tokens: total,
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : null,
    // The three components of `tokens` (live-file `current_usage` shape; W2f writer).
    parts: {
      input_tokens: n(src.input_tokens),
      cache_creation_input_tokens: n(src.cache_creation_input_tokens),
      cache_read_input_tokens: n(src.cache_read_input_tokens),
    },
  };
}

function isCompactBoundary(line) {
  if (!line.includes('compact_boundary')) return false;
  try {
    const o = JSON.parse(line);
    return !!o && o.type === 'system' && o.subtype === 'compact_boundary';
  } catch { return false; }
}

// Back-compat: tokens-only view of usageRowOf (pre-v2.36.1 callers/tests).
function usageOf(line) {
  const row = usageRowOf(line);
  return row ? row.tokens : null;
}

// Backward scan shared by readContextTokens and readContextUsage: grow a tail window
// (×4, capped) until the last usage row is found, or the cap is hit ⇒ null.
function scanLastUsageRow(tpath, opts = {}) {
  const capBytes = opts.capBytes || CAP_BYTES;
  try {
    const size = fs.statSync(tpath).size;
    let window = Math.min(opts.startBytes || START_WINDOW_BYTES, capBytes);
    for (;;) {
      const start = Math.max(0, size - window);
      const buf = Buffer.alloc(Math.min(window, size));
      const fd = fs.openSync(tpath, 'r');
      try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
      const raw = buf.toString('utf8');
      // Drop the first (possibly truncated) line unless we're at file start.
      const lines = raw.split('\n');
      const usable = start > 0 ? lines.slice(1) : lines;
      for (let i = usable.length - 1; i >= 0; i--) {
        const t = usable[i].trim();
        if (!t) continue;
        // v2.36.6: a compact_boundary reached before any usage row means every usage row
        // behind it describes the PRE-compaction context. Report "no signal" instead of
        // the stale (possibly window-sized) number (2026-09-06: T2 fired at 8% real usage).
        if (isCompactBoundary(t)) return null;
        const row = usageRowOf(t);
        if (row !== null) return row;
      }
      if (start === 0 || window >= capBytes) return null; // cap hit / whole file scanned
      window = Math.min(window * 4, capBytes);
    }
  } catch {
    return null;
  }
}

/**
 * Read the current context-token size from a transcript file.
 * Returns a positive number, or null (missing file / no usage row within cap /
 * any error) — callers treat null as "no signal", never as zero.
 */
function readContextTokens(tpath, opts = {}) {
  const row = scanLastUsageRow(tpath, opts);
  return row ? row.tokens : null;
}

/**
 * Read the current context-token size AND the timestamp of the transcript row it came
 * from. Returns {tokens, timestamp} (timestamp may be null if the row carried none), or
 * null under the same conditions as readContextTokens.
 */
function readContextUsage(tpath, opts = {}) {
  return scanLastUsageRow(tpath, opts);
}

// Step throttle: eligible when the tier never fired (lastCtx 0), step <= 0, context grew by
// >= step since its last fire, or context fell by >= step (compaction/clear = a new cycle).
function stepEligible(contextTokens, lastCtx, step) {
  if (!(step > 0) || !(lastCtx > 0)) return true;
  const delta = contextTokens - lastCtx;
  return delta >= step || delta <= -step;
}

// The fixed land checklist (T2 and T3). The model answers each item; the context-land-gate Stop hook
// then blocks stopping (at most twice per fire) until a handoff file newer than the fire exists.
function landMessage(label, k, pct, threshold, handoffPath) {
  const where = handoffPath ? `；handoff 檔寫到 ${handoffPath}` : '';
  return `Context budget ${label}: context is ${k}k tokens${pct} (threshold ${Math.round(threshold / 1000)}k). 先落地再繼續，逐項回答：\n` +
    '1. 本 session 有沒有還沒寫回 repo 的東西：文件、skill、SOP、討論結論、發現、知識、plan、決策紀錄、memory？\n' +
    '2. 有的話寫去哪：照 references/knowledge-routing.md 的去向表（先跑 scripts/resolve-knowledge-routing.sh 取本專案的實際路徑），用 learn / distill 落地。\n' +
    `3. 然後執行 /handoff（autopilot:handoff skill）${where}。\n` +
    '沒寫 handoff 就停下會被擋（每次觸發最多擋兩次）。';
}

// --- land gate shared helpers (context-budget.js writes the fire, context-land-gate.js reads it) ---
function sessionIdOf(payload) {
  const { sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
  const raw = (payload && typeof payload.session_id === 'string' && payload.session_id)
    || process.env.CLAUDE_CODE_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || process.cwd();
  return sanitizeSessionId(raw);
}

function stateDirOf(liveBase) {
  return process.env.AUTOPILOT_CONTEXT_BUDGET_DIR || require('path').join(liveBase, 'context-budget');
}

// The per-session handoff file the land checklist names: the same path the post-compaction restore reads
// (scripts/lib/compaction-handoff.js modelNotePath; one implementation, lazily loaded to keep hooks light).
function sessionHandoffPath(sid) {
  return require('../scripts/lib/compaction-handoff.js').modelNotePath(sid, {});
}

/**
 * Pure tier decision. state: {contextTokens, calls, lastT1Context, lastT2Context};
 * cfg: {t1, t2, step}. Returns {tier: null|'t1'|'t2', message: string|null}.
 * T2 outranks T1; each tier throttles on the context size at its own last fire.
 */
function budgetDecision(state, cfg) {
  const { contextTokens, lastT1Context = 0, lastT2Context = 0 } = state;
  const step = Number.isFinite(cfg.step) ? cfg.step : DEFAULT_STEP;
  const k = Math.round(contextTokens / 1000);
  // Always state the PROPORTION, not just the absolute count. An absolute "216k"
  // reads as "nearly full" on a 200K window and as "barely started" on 1M; the
  // hook's own reader cannot disambiguate without this. (2026-07-20 finding.)
  const win = Number.isFinite(cfg.inferredWindow) ? cfg.inferredWindow : null;
  // v2.36.1: when the window came from the statusline live file (exact, not inferred),
  // say so — "inferred from observed usage" would be a false claim about a real number.
  const windowClause = cfg.windowSource === 'statusline'
    ? '(statusline)'
    : cfg.windowSource === 'session-window'
      ? '(this session\'s window, read from the statusline earlier)'
      : 'inferred from observed usage';
  const pct = win ? ` = ${Math.round((contextTokens / win) * 100)}% of the ` +
    `~${Math.round(win / 1000)}k window ${windowClause}` : '';
  // T3 outranks T2. Only above t2 (a default 70% of a 200K window sits below t2: then T2 is the last tier).
  // Resident seats and an unknown window never get it by default (cfg.t3 is 0 there).
  if (cfg.t3 > 0 && cfg.t3 > (cfg.t2 || 0) && cfg.seat !== 'resident' && contextTokens >= cfg.t3) {
    if (!stepEligible(contextTokens, state.lastT3Context || 0, step)) return { tier: null, message: null };
    return { tier: 't3', land: true, message: landMessage('T3', k, pct, cfg.t3, cfg.handoffPath) };
  }
  if (cfg.t2 > 0 && contextTokens >= cfg.t2) {
    // lastT2Context 0 = never fired ⇒ always eligible (first crossing must not be throttled)
    if (!stepEligible(contextTokens, lastT2Context, step)) return { tier: null, message: null };
    // Window genuinely unknown (no live file, no remembered window, observedMax < 200K):
    // 200K and 1M are indistinguishable, so a directive STOP would be a guess. Degrade to an
    // advisory — tier 't2' keeps the T2 throttle/counter, `advisory` tells the hook to deliver
    // it like T1 (exit 0, additionalContext).
    const resident = cfg.seat === 'resident';
    const residentClose = 'Update the state file and confirm that after compaction only the state file path and unfinished items remain.';
    // Resident seats cannot change thread: they keep the state-file wording. Every other seat gets the
    // fixed land checklist (landMessage): the old "keep working, handoff as a backup" wording was ignored.
    const keepWorking = `Keep working. Claude Code auto-compacts at the window. ${residentClose}`;
    const keepWorkingAdvisory = 'Keep working. Claude Code auto-compacts at the window; write a handoff file as a BACKUP (not as a stopping point) and continue the task.';
    if (cfg.windowUnknown === true) {
      return {
        tier: 't2',
        advisory: true,
        message: resident
          ? `Context budget T2 (advisory): context is ${k}k tokens; the context window is unknown ` +
            '(no statusline live file, so 200K and 1M cannot be told apart). ' +
            keepWorking
          : `Context budget T2 (advisory): context is ${k}k tokens; the context window is unknown ` +
            '(no statusline live file, so 200K and 1M cannot be told apart). ' +
            'If this is a 200K window, the handoff file is the backup; ' +
            'on a 1M window this is early and no action is needed. ' +
            keepWorkingAdvisory,
      };
    }
    return {
      tier: 't2',
      land: !resident,
      message: resident
        ? `Context budget T2: context is ${k}k tokens${pct} (threshold ${Math.round(cfg.t2 / 1000)}k). ${keepWorking}`
        : landMessage('T2', k, pct, cfg.t2, cfg.handoffPath),
    };
  }
  if (cfg.t1 > 0 && contextTokens >= cfg.t1) {
    if (!stepEligible(contextTokens, lastT1Context, step)) return { tier: null, message: null };
    return {
      tier: 't1',
      message:
        `Context budget T1: context is ${k}k tokens${pct} (threshold ${Math.round(cfg.t1 / 1000)}k). ` +
        'Plan a milestone checkpoint/handoff at the next phase boundary; avoid loading ' +
        'large files inline — dispatch instead.',
    };
  }
  return { tier: null, message: null };
}

// Short advisory lock for the per-session state file (shared by context-budget.js and the
// state-checkpoint.js PostCompact arm). Returns a release function, or null when the lock could
// not be taken inside ~1s: the hooks are advisory, so callers continue unlocked (fail open).
function lockStateFile(file) {
  try {
    const store = require('../scripts/lib/jsonl-store.js');
    const lockFile = `${file}.lock`;
    store.acquireLock({ storeDir: require('path').dirname(file), lockFile, name: 'context-budget-state', timeoutMs: 1000 });
    return () => store.releaseLock(lockFile);
  } catch { return null; }
}

module.exports = {
  lockStateFile,
  readContextTokens,
  readContextUsage,
  budgetDecision,
  landMessage,
  sessionIdOf,
  stateDirOf,
  sessionHandoffPath,
  T3_WINDOW_RATIO,
  usageOf,
  inferWindowTokens,
  scaleTiers,
  tiersForKnownWindow,
  unreachableT2Warning,
  START_WINDOW_BYTES,
  CAP_BYTES,
  DEFAULT_STEP,
  KNOWN_WINDOWS,
  BASE_WINDOW,
};
