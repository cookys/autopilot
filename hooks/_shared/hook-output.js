'use strict';
/**
 * hook-output — the one place that builds a hook's model-facing stdout (BL-0304).
 *
 * Per https://code.claude.com/docs/en/hooks, plain exit-0 stdout reaches the model only on UserPromptSubmit,
 * UserPromptExpansion, SessionStart and PostModelSwitch; on every other event it goes to the debug log. A message
 * meant for the model on PreToolUse / PostToolUse / PostToolUseFailure travels as ONE JSON object on stdout:
 *   {"hookSpecificOutput":{"hookEventName":"<Event>","additionalContext":"<text>"}}
 * Never use this for Stop / SubagentStop: additionalContext there keeps the conversation going
 * (references/multi-agent-portability.md section 5, Stop rows).
 */

function additionalContextJson(eventName, text) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: String(text) } });
}

// Writes the object plus a newline through process.stdout.write (the chain swaps that function while a member runs).
function emitAdditionalContext(eventName, text) {
  process.stdout.write(`${additionalContextJson(eventName, text)}\n`);
}

// Parses one stdout stream as a pure context object: returns { event, text } or null when it is anything else
// (empty, plain text, several objects, extra keys, a permissionDecision). Used to merge several observers' contexts.
function parsePureContext(buf) {
  let obj;
  try { obj = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Object.keys(obj).length !== 1) return null;
  const h = obj.hookSpecificOutput;
  if (!h || typeof h !== 'object' || Object.keys(h).sort().join() !== 'additionalContext,hookEventName') return null;
  if (typeof h.additionalContext !== 'string' || typeof h.hookEventName !== 'string') return null;
  return { event: h.hookEventName, text: h.additionalContext };
}

module.exports = { additionalContextJson, emitAdditionalContext, parsePureContext };
