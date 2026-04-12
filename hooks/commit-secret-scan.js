#!/usr/bin/env node
/**
 * commit-secret-scan — PreToolUse/Bash (git commit)
 * Scans staged content for secrets. Hard blocks commit if found.
 * Uses _shared/secret-patterns.js for consistent detection.
 */

'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const secrets = require('./_shared/secret-patterns');

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const toolInput = input.tool_input || {};
  const command = String(toolInput.command || '');

  // Only check git commit commands (not amend-only)
  if (!/\bgit\s+commit\b/.test(command)) process.exit(0);
  if (/--amend\s+--no-edit/.test(command)) process.exit(0);

  // Get staged diff
  const diff = spawnSync('git', ['diff', '--cached', '--no-color'], {
    timeout: 5000,
    encoding: 'utf8',
  });

  const staged = diff.stdout || '';
  if (!staged) process.exit(0);

  const hits = secrets.scan(staged);

  if (hits.length > 0) {
    const names = hits.map(h => `  - ${h.name}: ${h.match}`).join('\n');
    process.stderr.write(
      `BLOCKED: Potential secrets found in staged changes:\n${names}\n` +
      `Remove secrets before committing. Use \`git diff --cached\` to review.\n`
    );
    process.exit(2);
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`commit-secret-scan error: ${e.message}\n`);
  process.exit(0);
}
