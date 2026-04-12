#!/usr/bin/env node
/**
 * accumulator — PostToolUse/Write|Edit [OPT-IN]
 * Accumulates edited JS/TS file paths to /tmp/claude-edited-{sessionId}.txt.
 * Consumed by batch-format.js at Stop time.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function getSessionId() {
  const raw = process.env.CLAUDE_SESSION_ID || '';
  if (raw) return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const toolInput = input.tool_input || {};

  // Collect file paths from Write (file_path) and Edit (file_path or edits[].file_path)
  const paths = [];
  if (toolInput.file_path) paths.push(toolInput.file_path);
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (edit.file_path) paths.push(edit.file_path);
    }
  }

  const jsPaths = paths.filter(p => /\.(ts|tsx|js|jsx)$/.test(p));
  if (jsPaths.length === 0) process.exit(0);

  const sid = getSessionId();
  const outFile = path.join(os.tmpdir(), `claude-edited-${sid}.txt`);
  fs.appendFileSync(outFile, jsPaths.join('\n') + '\n');

  process.exit(0);
} catch (e) {
  process.stderr.write(`accumulator error: ${e.message}\n`);
  process.exit(0);
}
