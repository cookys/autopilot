'use strict';
// config-path.js — the ONE place that decides which operator config file to read.
//   configPath({ env?, home? }) -> $AUTOPILOT_CONFIG_FILE when set (non-empty), else <home>/.autopilot/config.json
// `home` defaults to os.homedir(). The path decision is the only shared rule for most callers, which keep their own parsing; context_budget is the exception (below). BL-0181.
// Shell callers inline the same rule: "${AUTOPILOT_CONFIG_FILE:-$HOME/.autopilot/config.json}".
//
// readContextBudget({ env?, home? }) is the one parse of the context_budget block (config file + env), shared by
// hooks/context-budget.js (the nudges) and scripts/lib/compaction-handoff.js (the SessionStart budget warning), so
// the two cannot disagree on t2, gap or whether the feature is off. hooks/foreman-guard.js (the subagent context
// ceiling) reads it too, so context_budget.mode=off switches that off as well.
// A tier <= 0 means "that tier is off" from BOTH config and env (the decision code tests `t > 0`); a non-numeric
// or empty value is ignored. `cfg.warnings` lists one-line config problems (unknown mode, t1 >= t2) for the caller to print.
const fs = require('fs');
const os = require('os');
const path = require('path');

function configPath(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  if (env.AUTOPILOT_CONFIG_FILE) return env.AUTOPILOT_CONFIG_FILE;
  return path.join(o.home || os.homedir(), '.autopilot', 'config.json');
}

// explicitT1/T2 track whether the value came from the USER (config/env) or is still the absolute default.
function normMode(raw, where, warnings) {
  if (raw === undefined || raw === null || raw === '') return null;
  const m = String(raw).trim().toLowerCase();
  if (m === 'off' || m === 'warn') return m;
  warnings.push(`context_budget mode "${raw}" (${where}) is not off|warn, so it is ignored and the hook stays on`);
  return null;
}

function readContextBudget(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const cfg = { t1: 100_000, t2: 150_000, gap: 50_000, mode: 'warn', explicitT1: false, explicitT2: false, liveWrite: true, step: 50_000, warnings: [] };
  try {
    const user = JSON.parse(fs.readFileSync(configPath({ env, home: o.home }), 'utf8'));
    const cb = user && user.context_budget;
    if (cb && typeof cb === 'object') {
      if (Number.isFinite(cb.t1)) { cfg.t1 = cb.t1; cfg.explicitT1 = true; }
      if (Number.isFinite(cb.t2)) { cfg.t2 = cb.t2; cfg.explicitT2 = true; }
      if (Number.isFinite(cb.step) && cb.step >= 0) cfg.step = cb.step;
      if (Number.isFinite(cb.gap) && cb.gap >= 0) cfg.gap = cb.gap;
      const cm = normMode(cb.mode, 'config', cfg.warnings);
      if (cm) cfg.mode = cm;
      if (cb.live_write === false) cfg.liveWrite = false;
    }
  } catch { /* absent/corrupt config -> defaults */ }
  const envTier = (raw) => (raw === undefined || String(raw).trim() === '' ? NaN : Number(raw)); // '' is unset, not 0
  const envT1 = envTier(env.AUTOPILOT_CONTEXT_BUDGET_T1);
  const envT2 = envTier(env.AUTOPILOT_CONTEXT_BUDGET_T2);
  if (Number.isFinite(envT1)) { cfg.t1 = envT1; cfg.explicitT1 = true; }
  if (Number.isFinite(envT2)) { cfg.t2 = envT2; cfg.explicitT2 = true; }
  const envStepRaw = env.AUTOPILOT_CONTEXT_BUDGET_STEP;
  const envStep = envStepRaw === undefined || envStepRaw === '' ? NaN : Number(envStepRaw);
  if (Number.isFinite(envStep) && envStep >= 0) cfg.step = envStep; // env beats config; 0 = remind on every call
  const envGapRaw = env.AUTOPILOT_CONTEXT_BUDGET_GAP;
  const envGap = envGapRaw === undefined || envGapRaw === '' ? NaN : Number(envGapRaw);
  if (Number.isFinite(envGap) && envGap >= 0) cfg.gap = envGap;
  const em = normMode(env.AUTOPILOT_CONTEXT_BUDGET_MODE, 'env AUTOPILOT_CONTEXT_BUDGET_MODE', cfg.warnings);
  if (em) cfg.mode = em;
  if (cfg.t1 > 0 && cfg.t2 > 0 && cfg.t1 >= cfg.t2) {
    cfg.warnings.push(`context_budget t1 ${cfg.t1} >= t2 ${cfg.t2}: T2 outranks T1, so T1 never fires (set t1 below t2)`);
  }
  // Opt-out for the live-context-file writer only (the hook keeps nudging).
  const lw = env.AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE;
  if (lw === 'off' || lw === '0' || lw === 'false') cfg.liveWrite = false;
  return cfg;
}

module.exports = { configPath, readContextBudget };
