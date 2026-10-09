'use strict';
// residue-config — the one resolver for the `residue` knobs (worktree/branch auto-reap).
//
//   loadResidueConfig({ env?, home? }) -> { auto_reap, lease_hours, archive_branch_days, branch_prefixes }
//   CLI:  node residue-config.js [--field <key>]     (prints JSON, or the raw value of one key)
//
// Chain, lowest to highest: built-in defaults, then `residue` in ~/.autopilot/config.json,
// then env (AUTOPILOT_RESIDUE_AUTO_REAP=0|1, AUTOPILOT_RESIDUE_LEASE_HOURS,
// AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS). Machine-local on purpose: there is no
// version-controlled project JSON config in this repo, so there is no project tier.
// A malformed value never throws; it falls back to the lower tier's value.
//
// Defaults: { auto_reap: true, lease_hours: 72, archive_branch_days: 14, branch_prefixes: [] }.
//
// Consumers: scripts/repo-residue-sweep.js (auto mode), scripts/lib/worktree-reap.sh
// (_wt_residue_lease_hours, the rails' retention record), hooks/residue-auto-reap.js.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = Object.freeze({ auto_reap: true, lease_hours: 72, archive_branch_days: 14, branch_prefixes: Object.freeze([]) });

function posNum(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null; }
function envNum(v) { if (v === undefined || v === '') return null; const n = Number(v); return posNum(n); }

function loadResidueConfig(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || env.HOME || os.homedir();
  const cfg = { auto_reap: DEFAULTS.auto_reap, lease_hours: DEFAULTS.lease_hours, archive_branch_days: DEFAULTS.archive_branch_days, branch_prefixes: [] };
  try {
    const file = path.join(home, '.autopilot', 'config.json');
    if (fs.existsSync(file)) {
      const r = JSON.parse(fs.readFileSync(file, 'utf8')).residue;
      if (r && typeof r === 'object') {
        if (typeof r.auto_reap === 'boolean') cfg.auto_reap = r.auto_reap;
        if (posNum(r.lease_hours) !== null) cfg.lease_hours = r.lease_hours;
        if (posNum(r.archive_branch_days) !== null) cfg.archive_branch_days = r.archive_branch_days;
        if (Array.isArray(r.branch_prefixes)) cfg.branch_prefixes = r.branch_prefixes.filter((p) => typeof p === 'string' && /^[A-Za-z0-9._-]+\/?$/.test(p) && p.length > 0);
      }
    }
  } catch { /* defaults */ }
  if (env.AUTOPILOT_RESIDUE_AUTO_REAP === '0') cfg.auto_reap = false;
  else if (env.AUTOPILOT_RESIDUE_AUTO_REAP === '1') cfg.auto_reap = true;
  const lh = envNum(env.AUTOPILOT_RESIDUE_LEASE_HOURS); if (lh !== null) cfg.lease_hours = lh;
  const ad = envNum(env.AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS); if (ad !== null) cfg.archive_branch_days = ad;
  return cfg;
}

module.exports = { loadResidueConfig, DEFAULTS };

if (require.main === module) {
  const cfg = loadResidueConfig();
  const i = process.argv.indexOf('--field');
  if (i > 0) {
    const v = cfg[process.argv[i + 1]];
    process.stdout.write(v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  } else process.stdout.write(`${JSON.stringify(cfg)}\n`);
}
