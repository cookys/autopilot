#!/usr/bin/env node
/**
 * session-mode.js — orchestrator-mode marker CLI (A1/A2 support, v2.32.26).
 *
 * Written by depth-0 at /l3 /l4 /l5 /l6 entry; read by the orchestrator-edit-gate
 * and context-budget hooks. One marker file per session id:
 *   ${AUTOPILOT_SESSION_MODE_DIR:-~/.autopilot/session-mode}/<session-id>.json
 *   { level, repo_root, started_at, expires_at }
 *
 * Design notes (see docs/plans/2026-07-14-context-budget-orchestrator-gate.md):
 * - Host-stable path (~/.autopilot, NOT $TMPDIR) — docker-exec contexts see the
 *   same marker (Gemini panel finding).
 * - set OVERWRITES: /l3 re-entry after an /l5 run in the same session records
 *   level:l3, so the gate goes no-op instead of denying inline edits (MiniMax
 *   stale-marker-vs-mode-change finding).
 * - TTL (default 24h): expired ⇒ status active:false — fail-open, a crashed
 *   session can never block a later one.
 * - Atomic write via tmp+rename; corrupt marker reads as active:false.
 *
 * Usage:
 *   node scripts/session-mode.js set --level l3|l4|l5|l6 [--repo-root <dir>] [--ttl-hours N]
 *   node scripts/session-mode.js clear
 *   node scripts/session-mode.js status
 * Exit: 0 ok / 2 usage-or-invalid-args.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LEVELS = new Set(['l3', 'l4', 'l5', 'l6']);
const DEFAULT_TTL_HOURS = 24;

function markerDir() {
  return process.env.AUTOPILOT_SESSION_MODE_DIR
    || path.join(os.homedir(), '.autopilot', 'session-mode');
}

// Same fallback chain as hooks/suggest-compact.js — hook-side and CLI-side must
// derive the SAME id or the marker is invisible to the gate.
function getSessionId() {
  const raw = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || process.cwd();
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function markerPath() {
  return path.join(markerDir(), `${getSessionId()}.json`);
}

function readMarker() {
  try {
    const m = JSON.parse(fs.readFileSync(markerPath(), 'utf8'));
    if (!m || typeof m !== 'object' || !LEVELS.has(m.level)) return null;
    if (!m.expires_at || Date.parse(m.expires_at) <= Date.now()) return null; // expired ⇒ fail-open
    return m;
  } catch {
    return null; // absent or corrupt ⇒ fail-open
  }
}

function gitToplevel() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
    else args._.push(argv[i]);
  }
  return args;
}

function cmdSet(args) {
  const level = args.level;
  if (!LEVELS.has(level)) {
    process.stderr.write(`session-mode: invalid --level "${level}" (want l3|l4|l5|l6)\n`);
    return 2;
  }
  const ttlHours = args['ttl-hours'] !== undefined ? Number(args['ttl-hours']) : DEFAULT_TTL_HOURS;
  if (!Number.isFinite(ttlHours) || ttlHours < 0) {
    process.stderr.write(`session-mode: invalid --ttl-hours "${args['ttl-hours']}"\n`);
    return 2;
  }
  const now = Date.now();
  const marker = {
    level,
    repo_root: path.resolve(args['repo-root'] || gitToplevel()),
    started_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlHours * 3600 * 1000).toISOString(),
  };
  fs.mkdirSync(markerDir(), { recursive: true });
  const tmp = `${markerPath()}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`);
  fs.renameSync(tmp, markerPath()); // atomic on same fs
  process.stdout.write(`${JSON.stringify({ ok: true, marker_path: markerPath(), ...marker }, null, 2)}\n`);
  return 0;
}

function cmdClear() {
  try { fs.unlinkSync(markerPath()); } catch { /* idempotent */ }
  process.stdout.write(`${JSON.stringify({ ok: true, cleared: markerPath() }, null, 2)}\n`);
  return 0;
}

function cmdStatus() {
  const m = readMarker();
  const out = m
    ? { active: true, marker_path: markerPath(), ...m }
    : { active: false, marker_path: markerPath() };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (cmd) {
    case 'set': return cmdSet(args);
    case 'clear': return cmdClear();
    case 'status': return cmdStatus();
    default:
      process.stderr.write('Usage: session-mode.js set --level l3|l4|l5|l6 [--repo-root <dir>] [--ttl-hours N] | clear | status\n');
      return 2;
  }
}

if (require.main === module) process.exit(main());
module.exports = { readMarker, getSessionId, markerPath, LEVELS };
