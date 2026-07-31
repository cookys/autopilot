#!/usr/bin/env node
/**
 * commit-secret-scan — PreToolUse/Bash (git commit)
 * Scans staged content for secrets. Hard blocks commit if found.
 * Uses _shared/secret-patterns.js for consistent detection.
 */

'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { isEnabled } = require('./_shared/opt-in');

if (!isEnabled('commit-secret-scan')) process.exit(0);

const secrets = require('./_shared/secret-patterns');

try {
  // Read fd 0 directly — opening the '/dev/stdin' PATH throws ENXIO in the
  // Bun-spawned hook environment (verified 2.1.186), but fd 0 carries the payload.
  // Same fallback chain as failure-escalation.js. #6305.
  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch { raw = fs.readFileSync('/dev/stdin', 'utf8'); }
  const input = JSON.parse(raw);
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
  if (diff.error || diff.status !== 0) {
    throw new Error(diff.error
      ? `git diff failed: ${diff.error.message}`
      : `git diff failed with status ${diff.status}`);
  }

  const staged = diff.stdout || '';
  if (!staged) process.exit(0);

  // Commit blocking is about secrets introduced by this commit. Restrict the
  // scan to added hunk content so removing an existing secret is never blocked
  // by the deleted `-` line or by diff metadata.
  const additions = [];
  let inHunk = false;
  for (const line of staged.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
    } else if (line.startsWith('@@ ')) {
      inHunk = true;
    } else if (inHunk && line.startsWith('+')) {
      additions.push(line.slice(1));
    }
  }
  if (additions.length === 0) process.exit(0);

  const hits = secrets.scan(additions.join('\n'));

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
