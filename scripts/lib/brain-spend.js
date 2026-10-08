'use strict';

// scripts/lib/brain-spend.js — the ONE implementation of "today's tier spend vs the cost-fuse cap" (stage-graph P7 D1).
//
// Two readers share it so the number can never drift: hooks/cost-fuse.js (the PreToolUse fuse) and the runs watcher
// (src/status/runs-watch.js -> envelope fields host_today_brain_usd / brain_cap_usd, read by the band's spend slot).
//
//   loadCostFuseConfig({ env, home, defaultDailyUsdBrain? }) -> { mode, daily_usd_brain, tiers }   (~/.autopilot/config.json `cost_fuse`, then
//                                        env overrides AUTOPILOT_COST_FUSE_MODE / AUTOPILOT_COST_FUSE_DAILY_USD)
//   costsFileOf({ env, home })        -> costs.jsonl path (AUTOPILOT_COSTS_FILE else <home>/.claude/metrics/costs.jsonl)
//   sumTodayTierSpend(file, tiersSet, onlySession?) -> USD summed over today's (UTC) rows whose model tier is in tiersSet
//   safe(s)                           -> session-id sanitiser shared with cost-fuse state files
//
// Fail-soft by construction: config errors fall back to defaults, an unreadable costs file sums to 0. Node >= 20.10.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { tierOf } = require('../cost-digest.js');

const DEFAULT_DAILY_USD_BRAIN = 150;
const DEFAULT_MODE = 'warn';
const DEFAULT_TIERS = ['brain'];

function homeOf(opts) {
  return (opts && opts.home) || os.homedir();
}

function loadCostFuseConfig(opts = {}) {
  const env = opts.env || process.env;
  const cfg = {
    mode: DEFAULT_MODE,
    daily_usd_brain: Number.isFinite(opts.defaultDailyUsdBrain) ? opts.defaultDailyUsdBrain : DEFAULT_DAILY_USD_BRAIN,
    tiers: DEFAULT_TIERS.slice(),
  };

  try {
    const file = path.join(homeOf(opts), '.autopilot', 'config.json');
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const cf = j && j.cost_fuse;
      if (cf && typeof cf === 'object') {
        if (['block', 'warn', 'off'].includes(cf.mode)) {
          cfg.mode = cf.mode;
        }
        if (typeof cf.daily_usd_brain === 'number' && Number.isFinite(cf.daily_usd_brain) && cf.daily_usd_brain > 0) {
          cfg.daily_usd_brain = cf.daily_usd_brain;
        }
        if (Array.isArray(cf.tiers) && cf.tiers.every((t) => typeof t === 'string' && t.length > 0)) {
          cfg.tiers = cf.tiers.slice();
        }
      }
    }
  } catch {
    // defaults
  }

  const envMode = env.AUTOPILOT_COST_FUSE_MODE;
  if (envMode && ['block', 'warn', 'off'].includes(envMode)) {
    cfg.mode = envMode;
  }

  const envDailyUsd = Number(env.AUTOPILOT_COST_FUSE_DAILY_USD);
  if (Number.isFinite(envDailyUsd) && envDailyUsd > 0) {
    cfg.daily_usd_brain = envDailyUsd;
  }

  return cfg;
}

function costsFileOf(opts = {}) {
  const env = opts.env || process.env;
  return env.AUTOPILOT_COSTS_FILE || path.join(homeOf(opts), '.claude', 'metrics', 'costs.jsonl');
}

function safe(s) {
  return String(s || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
}

function sumTodayTierSpend(costsFile, tiersSet, onlySession) {
  if (!costsFile || !fs.existsSync(costsFile)) return 0;
  const todayPrefix = new Date().toISOString().slice(0, 10);
  let total = 0;
  try {
    const content = fs.readFileSync(costsFile, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        if (!row || typeof row !== 'object') continue;
        const ts = typeof row.ts === 'string' ? row.ts : '';
        if (!ts.startsWith(todayPrefix)) continue;
        const model = row.model;
        if (!model) continue;
        if (onlySession && safe(row.session) !== safe(onlySession)) continue;
        const tier = tierOf(model);
        if (tiersSet.has(tier)) {
          const cost = Number(row.cost_usd);
          if (Number.isFinite(cost) && cost > 0) {
            total += cost;
          }
        }
      } catch {
        // ignore malformed line
      }
    }
  } catch {
    return 0;
  }
  return total;
}

module.exports = { DEFAULT_DAILY_USD_BRAIN, loadCostFuseConfig, costsFileOf, safe, sumTodayTierSpend };
