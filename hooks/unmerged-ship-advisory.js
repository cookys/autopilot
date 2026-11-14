#!/usr/bin/env node
/**
 * unmerged-ship-advisory - Stop (Claude Code). Default-on.
 *
 * Why: a branch with a SHIP-AS-IS review verdict sat unmerged for hours waiting for a batch and nothing noticed.
 * What: at turn end, runs `scripts/check-unmerged-ship.js --notify` for the cwd repo (alerts are SHIP-AS-IS heads older
 * than unmerged_ship.max_age_minutes that are not in origin/develop; the script also appends a blocked line to the fleet task).
 * At most once per 15 minutes per session (stamp in the RAM-backed live dir). The scan is cut off at 1.8 s: a slow or
 * failing scan is skipped, never a blocked turn.
 *
 * Output: a Stop hook cannot add model context itself, so the alert lines go where this repo's other Stop advisories go:
 * the session's advisory queue (hooks/advisory-relay.js hands it to the model as additionalContext on the next prompt),
 * plus stderr. Never a Stop `decision`.
 *
 * Opt-out: AUTOPILOT_UNMERGED_SHIP=false (or 0/off/no), or `unmerged_ship.enabled: false` in ~/.autopilot/config.json.
 * Fail-open: any error -> exit 0, no output.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { configPath } = require('../scripts/lib/config-path.js');

const THROTTLE_MS = 15 * 60 * 1000;
const SCAN_TIMEOUT_MS = 1800;
const QUEUE_MAX_ENTRIES = 20;
const QUEUE_MAX_BYTES = 8192;

function readPayload() {
  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = fs.readFileSync('/dev/stdin', 'utf8'); }
  const input = JSON.parse(raw);
  if (!input || typeof input !== 'object') throw new Error('payload is not an object');
  return input;
}

function optedOut(env) {
  const v = env.AUTOPILOT_UNMERGED_SHIP;
  if (typeof v === 'string' && ['false', '0', 'off', 'no'].includes(v.trim().toLowerCase())) return true;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return !!cfg && cfg.unmerged_ship !== undefined && (cfg.unmerged_ship === false || cfg.unmerged_ship.enabled === false);
  } catch { return false; }
}

function enqueue(sessionId, text) {
  const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
  const qdir = path.join(resolveLiveDir({ warn: () => {} }).base, 'advisory-queue');
  fs.mkdirSync(qdir, { recursive: true });
  const qfile = path.join(qdir, `${sanitizeSessionId(sessionId)}.jsonl`);
  let entries = [];
  try {
    entries = fs.readFileSync(qfile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { entries = []; }
  entries.push({ ts: new Date().toISOString(), source: 'unmerged-ship-advisory', text });
  while (entries.length > QUEUE_MAX_ENTRIES) entries.shift();
  const dump = () => entries.map((e) => `${JSON.stringify(e)}\n`).join('');
  while (entries.length > 1 && Buffer.byteLength(dump(), 'utf8') > QUEUE_MAX_BYTES) entries.shift();
  const tmp = `${qfile}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, dump());
  fs.renameSync(tmp, qfile);
}

function throttled(sessionId, repoRoot, now) {
  const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
  const dir = path.join(resolveLiveDir({ warn: () => {} }).base, 'unmerged-ship');
  fs.mkdirSync(dir, { recursive: true });
  const crypto = require('crypto');
  const key = crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
  const file = path.join(dir, `scan-${key}-${sanitizeSessionId(sessionId)}.json`);
  try {
    const last = JSON.parse(fs.readFileSync(file, 'utf8')).last_scan_at;
    if (typeof last === 'number' && now - last < THROTTLE_MS) return true;
  } catch { /* no stamp */ }
  fs.writeFileSync(file, JSON.stringify({ last_scan_at: now }));
  return false;
}

function main() {
  const env = process.env;
  const input = readPayload();
  if (optedOut(env)) return;
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const top = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 1000 });
  if (top.error || top.status !== 0 || !top.stdout.trim()) return;
  const repoRoot = top.stdout.trim();
  const sessionId = input.session_id || env.CLAUDE_CODE_SESSION_ID || env.CODEX_THREAD_ID || 'unknown';
  if (throttled(sessionId, repoRoot, Date.now())) return;

  const script = path.join(__dirname, '..', 'scripts', 'check-unmerged-ship.js');
  const res = spawnSync(process.execPath, [script, '--repo', repoRoot, '--notify'], { encoding: 'utf8', timeout: SCAN_TIMEOUT_MS, env });
  if (res.error || res.status !== 1) return; // timeout, crash or no alert: stay silent
  const text = res.stdout.trim();
  if (!text) return; // alerts already notified for these heads
  process.stderr.write(`${text}\n`);
  try { enqueue(sessionId, text); } catch { /* queue is best-effort */ }
}

try {
  main();
} catch (e) {
  try { process.stderr.write(`unmerged-ship-advisory: fail-open: ${e && e.message ? e.message : e}\n`); } catch { /* ignore */ }
}
process.exit(0);
