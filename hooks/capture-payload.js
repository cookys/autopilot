#!/usr/bin/env node
/**
 * capture-payload — diagnostic hook (Tier B, opt-in)
 *
 * Dumps raw hook stdin plus CLAUDE_ / AUTOPILOT_ env vars to
 * ~/.autopilot/payloads/<ts>-<pid>-<marker>.json
 *
 * Purpose: investigate Claude Code hook payload schema when other hooks
 * silently no-op (e.g. PostToolUse `last_tool: <unknown>` symptom +
 * audit-log missing `tool_input.command`).
 *
 * Activation: requires AUTOPILOT_CAPTURE_PAYLOAD=1 — defaults off so the
 * spawn cost is one env check + exit when not investigating.
 *
 * Wire-up: NOT auto-added to hooks.json. To use, manually add an entry like:
 *   { "type": "command",
 *     "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/capture-payload.js post-bash" }
 * under the matcher of interest, restart `claude` (per BACKLOG bug 1
 * /clear-kills-dispatch), then run target tool calls. After collecting
 * samples, revert hooks.json.
 *
 * Marker arg (optional): label embedded in filename to disambiguate captures
 * from different matcher contexts.
 *
 * Rotation: keeps 50 most recent files, FIFO eviction.
 * Permissions: dir 0700, files 0600.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PAYLOAD_DIR = path.join(os.homedir(), '.autopilot', 'payloads');
const KEEP = 50;

if (process.env.AUTOPILOT_CAPTURE_PAYLOAD !== '1') process.exit(0);

try {
  const stdin = fs.readFileSync('/dev/stdin', 'utf8');
  const marker = (process.argv[2] || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  const ts = Date.now();

  fs.mkdirSync(PAYLOAD_DIR, { recursive: true, mode: 0o700 });

  const envSubset = Object.keys(process.env)
    .filter((k) => k.startsWith('CLAUDE') || k.startsWith('AUTOPILOT'))
    .sort()
    .reduce((acc, k) => { acc[k] = process.env[k]; return acc; }, {});

  let stdinParsed = null;
  try { stdinParsed = JSON.parse(stdin); } catch { /* leave null */ }

  const meta = {
    captured_at: new Date(ts).toISOString(),
    marker,
    pid: process.pid,
    cwd: process.cwd(),
    env: envSubset,
    stdin_length: stdin.length,
    stdin_raw: stdin,
    stdin_parsed: stdinParsed,
  };

  const file = path.join(PAYLOAD_DIR, `${ts}-${process.pid}-${marker}.json`);
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 });

  // FIFO rotation: keep KEEP most recent files
  try {
    const files = fs.readdirSync(PAYLOAD_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(PAYLOAD_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const f of files.slice(KEEP)) {
      try { fs.unlinkSync(path.join(PAYLOAD_DIR, f.name)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
} catch (e) {
  process.stderr.write(`capture-payload error: ${e.message}\n`);
}

process.exit(0);
