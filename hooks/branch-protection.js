#!/usr/bin/env node
/**
 * branch-protection — PreToolUse/Bash
 * Blocks force push and direct commits on protected branches.
 *
 * Ship A C1 fix: anchored whole-ref match (not substring).
 * Default protected: main, master only.
 * Override: env AUTOPILOT_PROTECTED_BRANCHES or settings.json autopilot.protectedBranches.
 */

'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

const DEFAULT_PROTECTED = /^(main|master)$/;

function getProtectedRegex() {
  // Priority: env var > default
  const envVal = process.env.AUTOPILOT_PROTECTED_BRANCHES;
  if (envVal) {
    return new RegExp(`^(${envVal})$`);
  }
  return DEFAULT_PROTECTED;
}

function getCurrentBranch() {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    timeout: 5000,
    encoding: 'utf8',
  });
  return (r.stdout || '').trim();
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const toolInput = input.tool_input || {};
  const command = String(toolInput.command || '');

  // Only check git commands
  if (!/\bgit\b/.test(command)) process.exit(0);

  const protectedRegex = getProtectedRegex();
  const branch = getCurrentBranch();

  if (!protectedRegex.test(branch)) {
    // Not on a protected branch — also check push targets
    const pushMatch = command.match(/\bgit\s+push\b.*?\s+([\w./-]+)\s+([\w./-]+)/);
    if (pushMatch) {
      const targetBranch = pushMatch[2];
      if (protectedRegex.test(targetBranch) && /--force\b|-f\b|--force-with-lease\b/.test(command)) {
        process.stderr.write(
          `BLOCKED: Force push to protected branch '${targetBranch}' is not allowed.\n`
        );
        process.exit(2);
      }
    }
    process.exit(0);
  }

  // On a protected branch — check for dangerous operations
  const isCommit = /\bgit\s+commit\b/.test(command) && !/--amend\s+--no-edit/.test(command);
  const isForcePush = /\bgit\s+push\b/.test(command) && /--force\b|-f\b|--force-with-lease\b/.test(command);

  if (isForcePush) {
    process.stderr.write(
      `BLOCKED: Force push on protected branch '${branch}' is not allowed.\n` +
      `Create a feature branch: git checkout -b feature/your-change\n`
    );
    process.exit(2);
  }

  if (isCommit) {
    process.stderr.write(
      `BLOCKED: Direct commit on protected branch '${branch}' is not allowed.\n` +
      `Create a feature branch: git checkout -b feature/your-change\n`
    );
    process.exit(2);
  }

  // Warn on other mutations (merge, rebase, reset, cherry-pick)
  if (/\bgit\s+(merge|rebase|reset|cherry-pick|revert)\b/.test(command)) {
    process.stderr.write(
      `WARNING: Mutation on protected branch '${branch}'. Proceed with caution.\n`
    );
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`branch-protection error: ${e.message}\n`);
  process.exit(0);
}
