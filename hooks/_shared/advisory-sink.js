'use strict';
/**
 * advisory-sink.js — the advisory bridge (stage-graph plan, owner addendum A1, P7a).
 *
 * Four hooks used to inject a human-facing nudge into the model's context: cost-tracker's queued
 * cache-read advice, version-drift-check's SessionStart text, context-budget T1, suggest-compact.
 * Those texts are for the owner, not the model. With the bridge ON (the default) each hook calls
 * writeAdvisory() instead of emitting additionalContext: one row per advisory, text UNCHANGED, appended to
 *   <live>/advisories/<sanitised session id>.jsonl      row = {id, kind, severity, text, at}
 * and the `live` mod (mods/live/advisories.ts) tails that file and shows each new row as a toast.
 * The stderr copy each hook already wrote stays.
 *
 * Knob per hook (restores the old injection): advisoryMode(hook) === 'inject'.
 *   env     AUTOPILOT_ADVISORY_BRIDGE_<HOOK>=inject|sink   (HOOK = COST_TRACKER, VERSION_DRIFT, CONTEXT_BUDGET, SUGGEST_COMPACT)
 *   env     AUTOPILOT_ADVISORY_BRIDGE=inject|sink          (all four)
 *   config  ~/.autopilot/config.json  {"advisory_bridge": {"mode": "inject", "cost_tracker": "inject", ...}}
 * Precedence: per-hook env, global env, per-hook config, config mode, default 'sink'.
 * suggest-compact never injected anything (stderr only): its 'inject' means "no bridge row".
 *
 * Fail-open: nothing here throws; writeAdvisory returns false when the row could not be written.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 256 * 1024;
const KEEP_ROWS = 100;

function norm(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s === 'inject' || s === 'sink' ? s : null;
}

function advisoryMode(hook) {
  const key = String(hook).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const e = norm(process.env[`AUTOPILOT_ADVISORY_BRIDGE_${key}`]) || norm(process.env.AUTOPILOT_ADVISORY_BRIDGE);
  if (e) return e;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.autopilot', 'config.json'), 'utf8'));
    const b = cfg && cfg.advisory_bridge;
    if (b && typeof b === 'object') {
      const c = norm(b[String(hook).toLowerCase().replace(/[^a-z0-9]+/g, '_')]) || norm(b.mode);
      if (c) return c;
    }
  } catch { /* default */ }
  return 'sink';
}

// Append one advisory row. opts = {sid, kind, severity, text}. Returns true when written.
function writeAdvisory(opts) {
  try {
    const { sid, kind, text } = opts || {};
    if (typeof sid !== 'string' || sid.length === 0 || typeof text !== 'string' || text.length === 0) return false;
    const { resolveLiveDir, sanitizeSessionId } = require('../../scripts/lib/live-state-dir.js');
    const dir = path.join(resolveLiveDir().base, 'advisories');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${sanitizeSessionId(sid)}.jsonl`);
    const row = {
      id: `${kind}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      kind: String(kind),
      severity: opts.severity === 'warn' ? 'warn' : 'info',
      text,
      at: new Date().toISOString(),
    };
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
    try {
      if (fs.statSync(file).size > MAX_BYTES) {
        const keep = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-KEEP_ROWS);
        const tmp = `${file}.tmp.${process.pid}`;
        fs.writeFileSync(tmp, `${keep.join('\n')}\n`);
        fs.renameSync(tmp, file);
      }
    } catch { /* trimming is best-effort */ }
    return true;
  } catch { return false; }
}

module.exports = { advisoryMode, writeAdvisory };
