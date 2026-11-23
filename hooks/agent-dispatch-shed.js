#!/usr/bin/env node
/**
 * agent-dispatch-shed — PreToolUse, matcher Task|Agent.
 *
 * Applies the same capacity shed semantics to subagent briefs that
 * fleet-dispatch-class.js (d11a0ad1c) applies to mcp__fleet__dispatch briefs:
 * a mechanical brief (Role: inventory|summary|chores, Size: XS|S in the first
 * 15 lines) gets its `Engine:` header rewritten to the first dispatchable shed
 * target from the burn_more signal and one `Shed: hit|skipped` line appended.
 * Honours `Engine-Pin:`, an existing `Shed:` line and AUTOPILOT_SHED_ROUTE=0.
 * The routing itself lives in fleet-dispatch-class.js `applyShedRouting` so the
 * two dispatch paths cannot drift.
 *
 * No rewrite -> exit 0 silently (the dispatch passes untouched).
 * Malformed stdin JSON -> exit 0 silently (fail-open).
 */
'use strict';

const fs = require('fs');
const { applyShedRouting } = require('./fleet-dispatch-class.js');

function decide(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.tool_name !== 'Task' && input.tool_name !== 'Agent') return null;

  const toolInput = input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input)
    ? input.tool_input
    : {};
  const prompt = toolInput.prompt;
  if (typeof prompt !== 'string' || !prompt) return null;

  const nextPrompt = applyShedRouting({ task: prompt, size: toolInput.size });
  if (nextPrompt === prompt) return null;

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: {
        ...toolInput,
        prompt: nextPrompt,
      },
    },
  };
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return fs.readFileSync('/dev/stdin', 'utf8');
  }
}

function main() {
  let input;
  try {
    const raw = readStdin();
    if (!raw || !raw.trim()) return;
    input = JSON.parse(raw);
  } catch {
    return;
  }
  try {
    const out = decide(input);
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`agent-dispatch-shed: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();

module.exports = { decide };
