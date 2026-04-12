#!/usr/bin/env node
/**
 * audit-log — PostToolUse/Bash
 * Logs bash commands to ~/.claude/bash-commands.log with auto secret redaction.
 * Uses _shared/secret-patterns.js for consistent redaction.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const secrets = require('./_shared/secret-patterns');

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const toolInput = input.tool_input || {};
  const command = toolInput.command || '';

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
