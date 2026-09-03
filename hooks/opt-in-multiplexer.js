#!/usr/bin/env node
'use strict';

/**
 * Per-event opt-in hook multiplexer (D6 A12).
 *
 * One registration per event replaces N opt-in spawns. On each event:
 *   1. Read hooks/opt-in-manifest.json + user config / AUTOPILOT_HOOK_* env
 *   2. Select enabled stems that match the event + tool matcher
 *   3. Spawn only those children, preserving payload and order
 * Disabled handlers start zero child processes.
 *
 * Usage: node hooks/opt-in-multiplexer.js <EventName>
 * stdin: original hook JSON payload
 * Exit: fail-open 0 on multiplexer errors; otherwise last non-zero child status.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  || path.resolve(__dirname, '..');

// Closed table: event → ordered [{stem, matcher, args[]}]
// Matchers use the same strings as hooks.json. Keep membership in lockstep with
// hooks/opt-in-manifest.json (13 unique stems; mcp-health on two events). context-budget,
// dispatch-model-guard and cost-tracker became default-on in v2.35.15 and are wired
// directly in hooks.json.
const EVENT_TABLE = {
  PreToolUse: [
    { stem: 'branch-protection', matcher: 'Bash', args: [] },
    { stem: 'exec-boundary', matcher: 'Bash', args: [] },
    { stem: 'commit-secret-scan', matcher: 'Bash', args: [] },
    { stem: 'large-file-warner', matcher: 'Read', args: [] },
    { stem: 'config-protection', matcher: 'Write|Edit', args: [] },
    { stem: 'mcp-health', matcher: 'mcp__.*', args: ['pre'] },
    { stem: 'orchestrator-edit-gate', matcher: 'Edit|Write|NotebookEdit', args: [] },
  ],
  PostToolUse: [
    { stem: 'accumulator', matcher: 'Write|Edit', args: [] },
    { stem: 'test-runner', matcher: 'Write|Edit', args: [] },
    { stem: 'design-quality', matcher: 'Write|Edit', args: [] },
  ],
  PostToolUseFailure: [
    { stem: 'mcp-health', matcher: 'mcp__.*', args: ['failure'] },
  ],
  Stop: [
    { stem: 'session-summary', matcher: '', args: [] },
    { stem: 'check-console', matcher: '', args: [] },
    { stem: 'batch-format', matcher: '', args: [] },
  ],
};

function isEnabled(stem, userConfig) {
  const envKey = `AUTOPILOT_HOOK_${stem.replace(/-/g, '_').toUpperCase()}`;
  const envVal = process.env[envKey];
  if (envVal === '1' || envVal === 'true') return true;
  if (envVal === '0' || envVal === 'false') return false;
  const hooks = userConfig && userConfig.hooks;
  if (hooks && Object.prototype.hasOwnProperty.call(hooks, stem)) {
    return hooks[stem] === true;
  }
  return false;
}

function matcherHits(matcher, toolName) {
  if (!matcher || matcher === '' || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(toolName || '');
  } catch (_e) {
    return false;
  }
}

function main() {
  const eventName = process.argv[2];
  if (!eventName || !EVENT_TABLE[eventName]) {
    process.exit(0);
  }

  let userConfig = {};
  try {
    userConfig = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), '.autopilot', 'config.json'), 'utf8'),
    );
  } catch (_e) { /* empty */ }

  const payloadBuf = fs.readFileSync(0);
  let toolName = '';
  try {
    const payload = JSON.parse(payloadBuf.toString('utf8') || '{}');
    toolName = payload.tool_name || payload.toolName || '';
  } catch (_e) { /* unmatched matchers treated carefully below */ }

  let exitCode = 0;
  for (const reg of EVENT_TABLE[eventName]) {
    if (!isEnabled(reg.stem, userConfig)) continue;
    if (!matcherHits(reg.matcher, toolName)) continue;
    const script = path.join(PLUGIN_ROOT, 'hooks', `${reg.stem}.js`);
    if (!fs.existsSync(script)) continue;
    const child = spawnSync(process.execPath, [script, ...reg.args], {
      input: payloadBuf,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      maxBuffer: 16 * 1024 * 1024,
    });
    if (child.stdout && child.stdout.length) process.stdout.write(child.stdout);
    if (child.stderr && child.stderr.length) process.stderr.write(child.stderr);
    if (typeof child.status === 'number' && child.status !== 0) {
      exitCode = child.status;
    }
  }
  process.exit(exitCode);
}

try {
  main();
} catch (_e) {
  process.exit(0);
}
