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

// Extract context tokens from one parsed transcript line, or null.
function usageOf(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  const u = obj && obj.message && obj.message.usage;
  if (!u || typeof u !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const total = n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
  return total > 0 ? total : null;
}

/**
 * Read the current context-token size from a transcript file.
 * Returns a positive number, or null (missing file / no usage row within cap /
 * any error) — callers treat null as "no signal", never as zero.
 */
function readContextTokens(tpath, opts = {}) {
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
        const tokens = usageOf(t);
        if (tokens !== null) return tokens;
      }
      if (start === 0 || window >= capBytes) return null; // cap hit / whole file scanned
      window = Math.min(window * 4, capBytes);
    }
  } catch {
    return null;
  }
}

/**
 * Pure tier decision. state: {contextTokens, calls, lastT1Call, lastT2Call};
 * cfg: {t1, t2}. Returns {tier: null|'t1'|'t2', message: string|null}.
 * T2 outranks T1; each tier throttles on its own last-fire counter.
 */
function budgetDecision(state, cfg) {
  const { contextTokens, calls, lastT1Call = 0, lastT2Call = 0 } = state;
  const k = Math.round(contextTokens / 1000);
  if (cfg.t2 > 0 && contextTokens >= cfg.t2) {
    // lastT2Call 0 = never fired ⇒ always eligible (first crossing must not be throttled)
    if (lastT2Call > 0 && calls - lastT2Call < T2_THROTTLE_CALLS) return { tier: null, message: null };
    return {
      tier: 't2',
      message:
        `Context budget T2: context is ${k}k tokens (threshold ${Math.round(cfg.t2 / 1000)}k). ` +
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
        `Context budget T1: context is ${k}k tokens (threshold ${Math.round(cfg.t1 / 1000)}k). ` +
        'Plan a milestone checkpoint/handoff at the next phase boundary; avoid loading ' +
        'large files inline — dispatch instead.',
    };
  }
  return { tier: null, message: null };
}

module.exports = {
  readContextTokens,
  budgetDecision,
  usageOf,
  START_WINDOW_BYTES,
  CAP_BYTES,
  T1_THROTTLE_CALLS,
  T2_THROTTLE_CALLS,
};
