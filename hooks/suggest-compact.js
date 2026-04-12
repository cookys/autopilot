#!/usr/bin/env node
/**
 * suggest-compact — PostToolUse/Write|Edit
 * Counts tool calls per session; suggests /compact at 50, then every 25.
 * Counter stored in /tmp/claude-tool-count-{sessionId}.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const FIRST_THRESHOLD = 50;
const INTERVAL = 25;

function getSessionId() {
  const raw = process.env.CLAUDE_SESSION_ID || process.cwd();
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

try {
  // Consume stdin (required even if unused)
  fs.readFileSync('/dev/stdin', 'utf8');

  const sid = getSessionId();
  const countFile = path.join(os.tmpdir(), `claude-tool-count-${sid}`);

  let count = 0;
  try {
    count = parseInt(fs.readFileSync(countFile, 'utf8'), 10) || 0;
  } catch {
    // First call this session
  }

  count += 1;
  fs.writeFileSync(countFile, String(count));

  if (count === FIRST_THRESHOLD) {
    process.stderr.write(
      `Context health: ${count} tool calls this session. Consider running /compact to free context.\n`
    );
  } else if (count > FIRST_THRESHOLD && (count - FIRST_THRESHOLD) % INTERVAL === 0) {
    process.stderr.write(
      `Context health: ${count} tool calls. Strongly recommend /compact.\n`
    );
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`suggest-compact error: ${e.message}\n`);
  process.exit(0);
}
