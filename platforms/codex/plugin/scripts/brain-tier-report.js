#!/usr/bin/env node
/**
 * brain-tier-report.js — Daily/since brain-tier spend & opus-without-reason report per lane.
 *
 * Usage:
 *   node scripts/brain-tier-report.js [--day YYYY-MM-DD | --since ISO] [--over-baseline] [--text]
 *
 * Reads:
 * - costs.jsonl via scripts/lib/brain-spend.js (costsFileOf) + scripts/cost-digest.js (tierOf)
 * - ${AUTOPILOT_STATE_DIR:-$HOME/.local/state/autopilot}/brain-tier-dispatch.jsonl
 * - ~/.autopilot/config.json key cost_fuse.brain_share_baseline (default 0.3)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { tierOf } = require('./cost-digest.js');
const { costsFileOf } = require('./lib/brain-spend.js');
const { configPath } = require('./lib/config-path.js');

const DEFAULT_BASELINE = 0.3;

function parseArgs(argv) {
  const opts = { day: null, since: null, overBaseline: false, text: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--day' && i + 1 < argv.length) {
      opts.day = argv[++i];
    } else if (a === '--since' && i + 1 < argv.length) {
      opts.since = argv[++i];
    } else if (a === '--over-baseline') {
      opts.overBaseline = true;
    } else if (a === '--text') {
      opts.text = true;
    }
  }
  if (!opts.day && !opts.since) {
    opts.day = new Date().toISOString().slice(0, 10);
  }
  return opts;
}

function loadBaseline(env = process.env, home = os.homedir()) {
  try {
    const file = configPath({ env, home });
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const val = j && j.cost_fuse && j.cost_fuse.brain_share_baseline;
      if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 1) {
        return val;
      }
    }
  } catch {
    // default
  }
  return DEFAULT_BASELINE;
}

function matchesWindow(ts, opts) {
  if (typeof ts !== 'string' || !ts) return false;
  if (opts.day) return ts.startsWith(opts.day);
  if (opts.since) return ts >= opts.since;
  return true;
}

function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return [];
  try {
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter((r) => r && typeof r === 'object');
  } catch {
    return [];
  }
}

function buildReport(opts = {}, env = process.env, home = os.homedir()) {
  const baseline = loadBaseline(env, home);
  const stateDir = env.AUTOPILOT_STATE_DIR || path.join(home, '.local', 'state', 'autopilot');
  const dispatchFile = path.join(stateDir, 'brain-tier-dispatch.jsonl');
  const costsFile = costsFileOf({ env, home });

  const lanes = new Map();
  const sessionToLane = new Map();

  function ensureLane(name) {
    const key = name || 'unknown';
    if (!lanes.has(key)) {
      lanes.set(key, { brain_usd: 0, total_usd: 0, brain_share: 0, opus_without_reason: 0 });
    }
    return lanes.get(key);
  }

  for (const row of readJsonl(dispatchFile)) {
    if (!matchesWindow(row.ts, opts)) continue;
    const lane = row.lane || 'unknown';
    if (row.session) sessionToLane.set(row.session, lane);
    const entry = ensureLane(lane);
    if (row.reason === null || row.reason === undefined || String(row.reason).trim() === '') {
      entry.opus_without_reason += 1;
    }
  }

  for (const row of readJsonl(costsFile)) {
    if (!matchesWindow(row.ts, opts)) continue;
    const cost = Number(row.cost_usd);
    if (!Number.isFinite(cost) || cost <= 0) continue;
    const lane = row.lane || (row.session && sessionToLane.get(row.session)) || 'unknown';
    const entry = ensureLane(lane);
    entry.total_usd += cost;
    if (row.model && tierOf(row.model) === 'brain') {
      entry.brain_usd += cost;
    }
  }

  const result = {};
  for (const [lane, data] of Array.from(lanes.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const brainUsd = Math.round(data.brain_usd * 1e6) / 1e6;
    const totalUsd = Math.round(data.total_usd * 1e6) / 1e6;
    const brainShare = totalUsd > 0 ? Math.round((brainUsd / totalUsd) * 1e6) / 1e6 : 0;
    if (opts.overBaseline && brainShare <= baseline) continue;
    result[lane] = {
      brain_usd: brainUsd,
      total_usd: totalUsd,
      brain_share: brainShare,
      opus_without_reason: data.opus_without_reason,
    };
  }

  return { baseline, lanes: result };
}

function formatText(report) {
  const rows = Object.entries(report.lanes);
  if (rows.length === 0) return 'No lanes matching criteria.\n';
  const lines = ['lane\tbrain_usd\ttotal_usd\tbrain_share\topus_without_reason'];
  for (const [lane, d] of rows) {
    lines.push(`${lane}\t${d.brain_usd.toFixed(2)}\t${d.total_usd.toFixed(2)}\t${(d.brain_share * 100).toFixed(1)}%\t${d.opus_without_reason}`);
  }
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const report = buildReport(opts);
  if (opts.text) {
    process.stdout.write(formatText(report));
  } else {
    process.stdout.write(JSON.stringify(report.lanes, null, 2) + '\n');
  }
}

module.exports = { buildReport, formatText, loadBaseline, parseArgs };
