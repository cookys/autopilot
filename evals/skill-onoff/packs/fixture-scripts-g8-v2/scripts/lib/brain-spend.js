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
//   createTierSpendReader(file)       -> incremental per-UTC-day, per-tier aggregate of the same rows (watcher; reads only appended
//                                        bytes, resets on shrink / inode change); .read() -> { ok, todaySpend(tiersSet) }; ok=false when the
//                                        file exists but cannot be read (the watcher publishes null; the fuse stays fail-soft on 0)
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

// Incremental twin of sumTodayTierSpend for long-lived readers. Same row rules (ts day, model present, tierOf, finite cost > 0),
// aggregated per day and tier so a tier-set change needs no re-read. Only bytes past the last complete line are parsed.
// A shrunk file or a changed inode (rotation) triggers a full re-read. read() never throws.
function createTierSpendReader(file) {
  const st = { offset: 0, ino: null, byDay: new Map() }; // day -> Map(tier -> usd)
  function reset() { st.offset = 0; st.byDay = new Map(); }
  function ingest(text) {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        if (!row || typeof row !== 'object' || typeof row.ts !== 'string' || !row.model) continue;
        const cost = Number(row.cost_usd);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        const day = row.ts.slice(0, 10);
        const tier = tierOf(row.model);
        const tiers = st.byDay.get(day) || new Map();
        tiers.set(tier, (tiers.get(tier) || 0) + cost);
        st.byDay.set(day, tiers);
      } catch {
        // ignore malformed line
      }
    }
  }
  function read() {
    let stat;
    try { stat = fs.statSync(file); } catch { return { ok: false, todaySpend: () => null }; }
    if (st.ino !== null && (stat.ino !== st.ino || stat.size < st.offset)) reset();
    st.ino = stat.ino;
    if (stat.size > st.offset) {
      try {
        const fd = fs.openSync(file, 'r');
        try {
          const buf = Buffer.alloc(stat.size - st.offset);
          const n = fs.readSync(fd, buf, 0, buf.length, st.offset);
          const end = buf.subarray(0, n).lastIndexOf(10);
          if (end !== -1) {
            ingest(buf.subarray(0, end + 1).toString('utf8'));
            st.offset += end + 1;
          }
        } finally { fs.closeSync(fd); }
      } catch { return { ok: false, todaySpend: () => null }; }
    }
    return {
      ok: true,
      todaySpend(tiersSet) {
        const tiers = st.byDay.get(new Date().toISOString().slice(0, 10));
        let total = 0;
        if (tiers) for (const [tier, usd] of tiers) if (tiersSet.has(tier)) total += usd;
        return total;
      },
    };
  }
  return { read };
}

module.exports = { DEFAULT_DAILY_USD_BRAIN, loadCostFuseConfig, costsFileOf, safe, sumTodayTierSpend, createTierSpendReader };
