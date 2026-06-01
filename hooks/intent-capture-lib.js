/**
 * intent-capture-lib — pure helpers extracted from intent-capture.js for unit
 * testability. No fs/os/process IO. The wrapper (intent-capture.js) keeps all
 * fs/process side-effects.
 *
 * Mirror of the state-checkpoint-lib pattern (see state-checkpoint-lib.js header).
 */

'use strict';

// Circuit-breaker invariants. The wrapper imports and uses these directly so
// behavior is defined exactly once.
const FAILURE_THRESHOLD = 10;
const STALE_DISABLE_HOURS = 24;

const SUMMARY_FIELD_CANDIDATES = ['file_path', 'pattern', 'command', 'description', 'prompt', 'query', 'url'];
const SUMMARY_MAX_LENGTH = 80;

function summarizeToolInput(toolName, toolInput) {
  // Returns a short human-readable label for the most identifying field of the
  // tool input (file_path / pattern / command / etc.), capped to keep intent
  // file rows small. Used by both Claude Code hooks and the OpenCode plugin.
  if (!toolInput || typeof toolInput !== 'object') return toolName;
  for (const key of SUMMARY_FIELD_CANDIDATES) {
    if (toolInput[key]) {
      const v = String(toolInput[key]);
      return `${toolName} ${v.length > SUMMARY_MAX_LENGTH ? v.slice(0, SUMMARY_MAX_LENGTH - 3) + '...' : v}`;
    }
  }
  return toolName;
}

// Decision logic for circuit-breaker auto-clear. The wrapper reads mtime + flag
// content from disk, calls this with concrete values, then unlinks the flag if
// the result is 'clear'. Splitting the decision out keeps it unit-testable.
//
// flagContentJson: raw string read from the disable-flag file, or null if read
//   failed (treated as malformed → leave active for explicit human reset).
// currentVersion: result of getPluginVersion() in the wrapper.
//
// Returns one of:
//   'no_flag'         — wrapper didn't pass mtime; nothing to do
//   'clear_stale'     — flag is older than STALE_DISABLE_HOURS, wrapper should rm
//   'clear_version'   — flag was created against a different plugin version
//   'active'          — leave flag in place
function disableFlagDecision({ mtimeMs, nowMs, flagContentJson, currentVersion, staleHours = STALE_DISABLE_HOURS }) {
  if (mtimeMs == null) return 'no_flag';
  const ageHours = (nowMs - mtimeMs) / (1000 * 60 * 60);
  if (ageHours > staleHours) return 'clear_stale';
  if (flagContentJson) {
    try {
      const content = JSON.parse(flagContentJson);
      if (content.plugin_version && content.plugin_version !== currentVersion) {
        return 'clear_version';
      }
    } catch {
      // malformed flag — leave active (caller's call to either ignore or treat as STALE per a future policy)
    }
  }
  return 'active';
}

module.exports = {
  // Constants
  FAILURE_THRESHOLD,
  STALE_DISABLE_HOURS,
  SUMMARY_FIELD_CANDIDATES,
  SUMMARY_MAX_LENGTH,
  // Pure helpers
  summarizeToolInput,
  disableFlagDecision,
};
