#!/usr/bin/env node
/**
 * log-error — PostToolUse/*
 * Detects error keywords in tool output and appends to ~/.claude/error-log.md.
 * Rewritten from devteam's log-error.sh to Node.js for consistency.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ERROR_PATTERN = /\b(error|failed|fatal|ENOENT|EACCES|permission denied|not found|exception|traceback)\b/i;
const MAX_INPUT_CHARS = 300;
const MAX_ERROR_CHARS = 500;

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const toolName = input.tool_name || 'unknown';
  const toolOutput = String(input.tool_output || '');
  const toolInput = JSON.stringify(input.tool_input || {});

  if (!ERROR_PATTERN.test(toolOutput)) process.exit(0);

  const ts = new Date().toISOString();
  const truncInput = toolInput.length > MAX_INPUT_CHARS
    ? toolInput.slice(0, MAX_INPUT_CHARS) + '...'
    : toolInput;
  const truncError = toolOutput.length > MAX_ERROR_CHARS
    ? toolOutput.slice(0, MAX_ERROR_CHARS) + '...'
    : toolOutput;

  const entry = [
    `### ${ts}`,
    `**Tool:** ${toolName}`,
    `**Input:** \`${truncInput}\``,
    '```',
    truncError,
    '```',
    '**Solution:** (fill in after fix)',
    '',
    '---',
    '',
  ].join('\n');

  const logPath = path.join(os.homedir(), '.claude', 'error-log.md');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, entry);

  process.exit(0);
} catch (e) {
  process.stderr.write(`log-error error: ${e.message}\n`);
  process.exit(0);
}
