#!/usr/bin/env node
'use strict';

/**
 * plan-gap-hint — PostToolUse/Bash [OPT-IN, timeout: 8s]
 * On `git ... commit` (excluding `--dry-run`), runs scripts/plan-gap-hint.js
 * and surfaces any gap hint as additionalContext. Never blocks.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isEnabled } = require('./_shared/opt-in');

if (!isEnabled('plan-gap-hint')) process.exit(0);

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return fs.readFileSync('/dev/stdin', 'utf8'); }
}

function extractGitRepoDir(cmd, baseCwd) {
  const m = cmd.match(/\bgit\s+(?:[^\n;&|]*?\s)?-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (!m) return baseCwd;
  const dir = m[1] || m[2] || m[3];
  return path.isAbsolute(dir) ? dir : path.resolve(baseCwd, dir);
}

try {
  const payload = JSON.parse(readStdin() || '{}');
  const toolInput = payload.tool_input || {};
  const cmd = String(toolInput.command || '');
  if (!cmd) process.exit(0);

  if (!/(?:^|[;&|]\s*|\s)git\b[^;&|\n]*\bcommit\b/.test(cmd)) process.exit(0);
  if (/--dry-run\b/.test(cmd)) process.exit(0);

  const baseCwd = payload.cwd || process.cwd();
  const repoDir = extractGitRepoDir(cmd, baseCwd);
  const scriptPath = path.join(PLUGIN_ROOT, 'scripts', 'plan-gap-hint.js');

  const res = spawnSync(process.execPath, [scriptPath, '--repo', repoDir], {
    encoding: 'utf8',
    timeout: 8000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const out = (res.stdout || '').trim();
  if (out) {
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: out,
      },
    })}\n`);
  }
  process.exit(0);
} catch (_e) {
  process.exit(0);
}
