// suggest-compact-lib.js — pure threshold decision for the suggest-compact hook.
//
// WHY split: the wrapper (suggest-compact.js) owns all fs/process IO (the broken
// /dev/stdin read, the /tmp counter file, stderr). This lib is the pure decision
// — unit-tested directly, matching the intent-capture-lib / transcript-reader-lib
// convention.

'use strict';

const FIRST_THRESHOLD = 50; // first nudge at this tool count
const INTERVAL = 25;        // then every INTERVAL after (UNBOUNDED: 50, 75, 100, 125, …)

// Pure: given the post-increment tool count, decide whether to nudge and with
// what message. Returns { warn: boolean, level: 'first'|'interval'|null, message: string|null }.
function compactDecision(count, opts = {}) {
  const first = opts.first ?? FIRST_THRESHOLD;
  const interval = opts.interval ?? INTERVAL;

  if (!Number.isInteger(count) || count < 1) {
    return { warn: false, level: null, message: null };
  }
  if (count === first) {
    return {
      warn: true,
      level: 'first',
      message: `Context health: ${count} tool calls this session. Consider running /compact to free context.`,
    };
  }
  if (count > first && (count - first) % interval === 0) {
    return {
      warn: true,
      level: 'interval',
      message: `Context health: ${count} tool calls. Strongly recommend /compact.`,
    };
  }
  return { warn: false, level: null, message: null };
}

module.exports = { compactDecision, FIRST_THRESHOLD, INTERVAL };
