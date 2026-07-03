#!/usr/bin/env node
/**
 * audit-log — PostToolUse for all tools (matcher `.*`)
 * Logs bash commands to ~/.claude/bash-commands.log with auto secret redaction.
 * Uses _shared/secret-patterns.js for consistent redaction.
 * Runs on PostToolUse for all tools and no-ops (exit 0) when the event carries no bash command.
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
