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

const { getToolEvent } = require('./transcript-reader-lib.js');

// CLI stdin read. stdin pipe broken for tool-event hooks (ENXIO; #6305) → '' → transcript fallback in runHook().
// fd 0 first: the '/dev/stdin' PATH throws ENXIO on a socket stdin.
function readStdinCli() {
  try { return fs.readFileSync(0, 'utf8'); }
  catch { try { return fs.readFileSync('/dev/stdin', 'utf8'); } catch { return ''; /* ENXIO → transcript */ } }
}

// Exported body (post-tool-chain runs it in-process): `stdin` is the payload text; returns the exit
// status and never calls process.exit.
function runHook(stdin) {
  try {
    const ev = getToolEvent({ stdin, env: process.env });
    const toolName = ev.tool_name || 'unknown';
    const toolOutput = typeof ev.tool_response === 'string'
      ? ev.tool_response
      : (ev.tool_response !== undefined ? JSON.stringify(ev.tool_response) : '');
    const toolInput = JSON.stringify(ev.tool_input || {});

    // Trigger on an explicit error flag OR error keywords in the output.
    if (!ev.is_error && !ERROR_PATTERN.test(toolOutput)) return 0;

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

    return 0;
  } catch (e) {
    process.stderr.write(`log-error error: ${e.message}\n`);
    return 0;
  }
}

module.exports = { runHook };

if (require.main === module) process.exit(runHook(readStdinCli()));
