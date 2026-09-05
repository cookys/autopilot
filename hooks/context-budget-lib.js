// context-budget-lib.js — signal + tier decision for the context-budget hook.
//
// WHY split: wrapper (context-budget.js) owns process IO (stdin, state file,
// stderr, exit codes); this lib is the testable core — matching the
// suggest-compact-lib / transcript-reader-lib convention.
//
// Signal: the last assistant `message.usage` row in the depth-0 transcript.
// context ≈ input + cache_read + cache_creation (RAW total, not cost-weighted:
// cache_read tokens are IN the model's context — cheap ≠ absent; panel
// adjudication in docs/plans/2026-07-14-context-budget-orchestrator-gate.md).
//
// Backward scan: start with a 64KB tail window and GROW (×4) until the last
// usage row is inside it, capped at 5MB. A single JSONL line (one big tool
// result) can exceed 64KB — assuming the tail contains the row silently
// miscalibrates (MiniMax panel finding). Cap hit ⇒ null, fail-open.

'use strict';

const fs = require('fs');

const START_WINDOW_BYTES = 64 * 1024;
const CAP_BYTES = 5 * 1024 * 1024;
const T1_THROTTLE_CALLS = 20; // T1 refires at most every 20 tool calls
const T2_THROTTLE_CALLS = 10; // T2 refires at most every 10 tool calls

// --- Context-window inference (v2.32.56) -------------------------------------
//
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

/** Smallest known context window strictly greater than the largest observation. */
function inferWindowTokens(observedMax, windows = KNOWN_WINDOWS) {
  if (!Number.isFinite(observedMax) || observedMax <= 0) return windows[0];
  for (const w of windows) if (observedMax < w) return w;
  return windows[windows.length - 1];
}

/**
 * Scale non-explicit tiers to the inferred window, preserving their calibrated
 * proportions (t1=50%, t2=75% of window by default).
 * Explicit user config/env ALWAYS wins — inference only fills what was left
 * to the defaults, so a hand-set threshold is never silently overridden.
 */
function scaleTiers(cfg, inferredWindow) {
  const ratio = inferredWindow / BASE_WINDOW;
  if (!Number.isFinite(ratio) || ratio <= 1) return cfg;
  return {
    ...cfg,
    t1: cfg.explicitT1 ? cfg.t1 : Math.round(cfg.t1 * ratio),
    t2: cfg.explicitT2 ? cfg.t2 : Math.round(cfg.t2 * ratio),
    inferredWindow,
  };
}

/**
 * v2.36.1: scale tiers to a window read EXACTLY from the statusline live file (not
 * inferred). Same proportional formula as scaleTiers, but always tags the result with
 * `inferredWindow` (even at ratio 1) so budgetDecision always states the proportion and
 * attributes it to the statusline — scaleTiers' ratio<=1 short-circuit exists only to
 * avoid noise on an UNEVIDENCED base-window guess, which does not apply to a real number.
 */
function tiersForKnownWindow(cfg, window) {
  const ratio = Number.isFinite(window) && window > 0 ? window / BASE_WINDOW : 1;
  return {
    ...cfg,
    t1: cfg.explicitT1 ? cfg.t1 : Math.round(cfg.t1 * ratio),
    t2: cfg.explicitT2 ? cfg.t2 : Math.round(cfg.t2 * ratio),
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
  const total = n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
  if (total <= 0) return null;
  return { tokens: total, timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : null };
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

/**
 * Pure tier decision. state: {contextTokens, calls, lastT1Call, lastT2Call};
 * cfg: {t1, t2}. Returns {tier: null|'t1'|'t2', message: string|null}.
 * T2 outranks T1; each tier throttles on its own last-fire counter.
 */
function budgetDecision(state, cfg) {
  const { contextTokens, calls, lastT1Call = 0, lastT2Call = 0 } = state;
  const k = Math.round(contextTokens / 1000);
  // Always state the PROPORTION, not just the absolute count. An absolute "216k"
  // reads as "nearly full" on a 200K window and as "barely started" on 1M; the
  // hook's own reader cannot disambiguate without this. (2026-07-20 finding.)
  const win = Number.isFinite(cfg.inferredWindow) ? cfg.inferredWindow : null;
  // v2.36.1: when the window came from the statusline live file (exact, not inferred),
  // say so — "inferred from observed usage" would be a false claim about a real number.
  const windowClause = cfg.windowSource === 'statusline'
    ? '(statusline)'
    : 'inferred from observed usage';
  const pct = win ? ` = ${Math.round((contextTokens / win) * 100)}% of the ` +
    `~${Math.round(win / 1000)}k window ${windowClause}` : '';
  if (cfg.t2 > 0 && contextTokens >= cfg.t2) {
    // lastT2Call 0 = never fired ⇒ always eligible (first crossing must not be throttled)
    if (lastT2Call > 0 && calls - lastT2Call < T2_THROTTLE_CALLS) return { tier: null, message: null };
    return {
      tier: 't2',
      message:
        `Context budget T2: context is ${k}k tokens${pct} (threshold ${Math.round(cfg.t2 / 1000)}k). ` +
        'Directive: STOP taking on new work. Write a handoff doc NOW (autopilot:handoff), ' +
        'then tell the user to /clear or restart the session — context cost compounds ' +
        'quadratically with session length. [USER: after the handoff lands, /clear or ' +
        'start a fresh session to reset the context.]',
    };
  }
  if (cfg.t1 > 0 && contextTokens >= cfg.t1) {
    if (lastT1Call > 0 && calls - lastT1Call < T1_THROTTLE_CALLS) return { tier: null, message: null };
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

module.exports = {
  readContextTokens,
  readContextUsage,
  budgetDecision,
  usageOf,
  inferWindowTokens,
  scaleTiers,
  tiersForKnownWindow,
  START_WINDOW_BYTES,
  CAP_BYTES,
  T1_THROTTLE_CALLS,
  T2_THROTTLE_CALLS,
  KNOWN_WINDOWS,
  BASE_WINDOW,
};
