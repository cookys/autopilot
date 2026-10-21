#!/usr/bin/env node
/**
 * audit-log — PostToolUse for all tools (matcher `.*`)
 * Logs bash commands to ~/.claude/bash-commands.log with auto secret redaction.
 * Uses _shared/secret-patterns.js for consistent redaction.
 * Runs on PostToolUse for all tools and no-ops (exit 0) when the event carries no bash command.
 *
 * Also the PostToolUse HOST for the live-state writers (mods P1W PERF+STAMP): awaiting-owner's
 * PostToolUse work (end a permission/question wait) and the subagent last-tool stamp run in THIS
 * process, so a tool call costs no extra node spawn for them. Picked because it is default-on, has no
 * early gate or knob of its own, is invariant_effect (kept by every execution profile) and already
 * parses the payload. HOOKQ (mods P1W) adds two more hosted legs: ask-decision.js onPostToolUse (close the decision file
 * after depth-0's AskUserQuestion; knob AUTOPILOT_ASK_DECISION) and merge-task-status-lib.js (a successful merge into the
 * integration branch re-writes the task-status input, detached; knob AUTOPILOT_MERGE_TASK_STATUS). Their opt-outs (AUTOPILOT_AWAITING_OWNER, AUTOPILOT_AGENT_ACTIVITY) are read inside
 * hooks/awaiting-owner.js handle() / hooks/live-session-lib.js, not here. Fail-open and independent of
 * the audit logging below.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const secrets = require('./_shared/secret-patterns');
const { getToolEvent } = require('./transcript-reader-lib.js');

try {
  // stdin pipe is broken for tool-event hooks (ENXIO; upstream #6305) — recover
  // the tool from the transcript instead. stdin-first keeps it future-proof.
  let stdin = '';
  try {
    stdin = fs.readFileSync(0, 'utf8');
  } catch {
    try { stdin = fs.readFileSync('/dev/stdin', 'utf8'); } catch { /* ENXIO → transcript */ }
  }
  try {
    if (stdin.trim()) {
      const p = JSON.parse(stdin);
      if (p && typeof p === 'object' && p.hook_event_name === 'PostToolUse') {
        require('./awaiting-owner.js').handle(p);
        // HOOKQ (mods P1W): the answer to depth-0's AskUserQuestion closes its decision file; a successful merge into the
        // integration branch refreshes the task-status input. Own try each, lazy-required only for their tool.
        if (p.tool_name === 'AskUserQuestion') {
          try { require('./ask-decision.js').onPostToolUse(p); } catch (e) { process.stderr.write(`audit-log: ask-decision fail-open: ${e && e.message ? e.message : e}\n`); }
        } else if (p.tool_name === 'Bash') {
          try { require('./merge-task-status-lib.js').onPostToolUse(p); } catch (e) { process.stderr.write(`audit-log: merge-task-status fail-open: ${e && e.message ? e.message : e}\n`); }
        }
      }
    }
  } catch (e) {
    process.stderr.write(`audit-log: live-state hosting fail-open: ${e && e.message ? e.message : e}\n`);
  }
  const ev = getToolEvent({ stdin, env: process.env });
  const command = (ev.tool_input && ev.tool_input.command) || '';

  if (!command) process.exit(0);

  const redacted = secrets.redact(command);
  const ts = new Date().toISOString();
  const cwd = process.cwd();

  const logDir = path.join(os.homedir(), '.claude');
  fs.mkdirSync(logDir, { recursive: true });

  const entry = `[${ts}] [${cwd}] ${redacted.replace(/\n/g, '\\n')}\n`;
  fs.appendFileSync(path.join(logDir, 'bash-commands.log'), entry);

  process.exit(0);
} catch (e) {
  process.stderr.write(`audit-log error: ${e.message}\n`);
  process.exit(0);
}
