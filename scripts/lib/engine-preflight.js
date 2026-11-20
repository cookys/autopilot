#!/usr/bin/env node
'use strict';

// engine-preflight.js — decide which runner:model to dispatch before spending a ticket.
// Node >= 20.10, built-ins only. Never invokes grok, codex, agy, opencode, kimi or cursor.
//
//   preflight({ candidates, now, sources }) -> {
//     schema: 'autopilot.engine-preflight/1',
//     chosen: { runner, model, burn_more? } | null,
//     skipped: [{ runner, model, reason, burn_more? }],
//     warnings: string[],
//     burn_more: [{ runner, model }]   // candidates listed in capacity burn_more; order kept
//   }
//
// Skip reasons:
//   capacity:<availability>/<suggest>   engines table row is spent, stopped, paused, or 不派*
//   recent:<category>@<run_id>          manifest in the last WINDOW minutes
//   probe:<overloaded|rate_limited|unsupported>
//
// Capacity table older than 30 minutes, missing, or unparseable is ignored
// (warnings capacity_table_stale / capacity_table_missing). It never blocks.
// burn_more is not a skip and does not reorder.
//
// CLI:
//   node scripts/lib/engine-preflight.js --candidate runner:model [--candidate runner:model ...]
// Exit 0 when one candidate is chosen, 3 when every candidate is skipped, 2 on usage.
// Stdout is the JSON object (fs.writeSync). Stderr is one line per skip.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { runsDir } = require('./runtime-paths.js');

const SCHEMA = 'autopilot.engine-preflight/1';
const CAPACITY_SCHEMA = 'capacity.engines/1';
const BURN_SCHEMA = 'capacity.burn_more/1';
const CAPACITY_MAX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_WINDOW_MIN = 15;
const PROBE_TIMEOUT_MS = 20000;
const PROBE_EXIT = { 75: 'overloaded', 76: 'rate_limited', 77: 'unsupported' };
const BAD_AVAILABILITY = new Set(['已用完', '停用', '暫停']);

function homeOf(env) {
  return env.HOME || os.homedir();
}

function enginesTablePath(env) {
  return env.AUTOPILOT_ENGINES_TABLE
    || path.join(homeOf(env), 'projects', 'capacity', 'out', 'engines.v1.json');
}

function burnMorePath(env) {
  return env.AUTOPILOT_BURN_MORE
    || path.join(homeOf(env), 'projects', 'capacity', 'out', 'burn_more.v1.json');
}

function windowMinOf(env, override) {
  if (Number.isFinite(override) && override >= 0) return override;
  const raw = env.AUTOPILOT_ENGINE_PREFLIGHT_WINDOW_MIN;
  if (raw == null || raw === '') return DEFAULT_WINDOW_MIN;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_WINDOW_MIN;
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return { ok: false, code: err && err.code };
  }
}

// True when eventMs is inside [now - window, now]. Exported so the window
// comparison can be shown red by inverting this predicate (negative control).
function withinWindow(eventMs, nowMs, windowMs) {
  if (!Number.isFinite(eventMs) || !Number.isFinite(nowMs) || !Number.isFinite(windowMs)) return false;
  const age = nowMs - eventMs;
  return age >= 0 && age <= windowMs;
}

function failureCategory(manifest) {
  const parts = [manifest.error_category, manifest.status, manifest.error]
    .filter((v) => typeof v === 'string');
  const text = parts.join('\n');
  const low = text.toLowerCase();
  if (low.includes('overloaded')) return 'overloaded';
  if (low.includes('rate_limited') || low.includes('rate limited') || /\b429\b/.test(text)) return 'rate_limited';
  if (low.includes('model_unsupported') || low.includes('not supported')) return 'model_unsupported';
  if (low.includes('quota exhausted') || low.includes('quota_exhausted')) return 'quota_exhausted';
  return null;
}

function loadCapacity(src, env, nowMs, warnings) {
  const given = src.enginesTable;
  if (given && typeof given === 'object') return rowsOf(given, nowMs, warnings);
  const file = typeof given === 'string' ? given : enginesTablePath(env);
  const read = readJson(file);
  if (!read.ok) {
    warnings.push('capacity_table_missing');
    return [];
  }
  return rowsOf(read.value, nowMs, warnings);
}

function rowsOf(doc, nowMs, warnings) {
  if (!doc || doc.schema !== CAPACITY_SCHEMA || !Array.isArray(doc.engines)) {
    warnings.push('capacity_table_missing');
    return [];
  }
  const gen = Date.parse(doc.generated_at);
  if (!Number.isFinite(gen) || nowMs - gen > CAPACITY_MAX_AGE_MS) {
    warnings.push('capacity_table_stale');
    return [];
  }
  return doc.engines;
}

function capacityReason(row) {
  const availability = row && row.availability != null ? String(row.availability) : '';
  const suggest = row && row.suggest != null ? String(row.suggest) : '';
  if (BAD_AVAILABILITY.has(availability) || suggest.startsWith('不派') || suggest === '暫停') {
    return `capacity:${availability}/${suggest}`;
  }
  return null;
}

function loadBurn(src, env) {
  const given = src.burnMore;
  let doc = null;
  if (given && typeof given === 'object') doc = given;
  else {
    const file = typeof given === 'string' ? given : burnMorePath(env);
    const read = readJson(file);
    if (!read.ok) return [];
    doc = read.value;
  }
  if (!doc || doc.schema !== BURN_SCHEMA || !Array.isArray(doc.engines)) return [];
  return doc.engines;
}

function listedInBurn(candidate, rows) {
  const keys = new Set([
    candidate.runner,
    candidate.model,
    `${candidate.runner}:${candidate.model}`,
    `${candidate.runner}/${candidate.model}`,
  ]);
  return rows.some((row) => row && keys.has(String(row.engine)));
}

function recentReason(candidate, runs, nowMs, windowMs) {
  let best = null;
  for (const hit of runs) {
    if (hit.runner !== candidate.runner || hit.model !== candidate.model) continue;
    if (!withinWindow(hit.at, nowMs, windowMs)) continue;
    if (!best || hit.at > best.at) best = hit;
  }
  if (!best) return null;
  return `recent:${best.category}@${best.runId}`;
}

function loadRuns(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.manifest.json')) continue;
    const file = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (!stat.isFile()) continue;
    const read = readJson(file);
    if (!read.ok || !read.value || typeof read.value !== 'object') continue;
    const manifest = read.value;
    const category = failureCategory(manifest);
    if (!category) continue;
    const ended = Date.parse(manifest.ended_at);
    const at = Number.isFinite(ended) ? ended : stat.mtimeMs;
    const runId = typeof manifest.run_id === 'string' && manifest.run_id
      ? manifest.run_id
      : name.replace(/\.manifest\.json$/, '');
    out.push({
      runner: manifest.runner,
      model: manifest.model,
      category,
      at,
      runId,
    });
  }
  return out;
}

function probeCandidate(probe, candidate) {
  if (!probe) return { skip: null, warning: null };
  const result = spawnSync(probe, [candidate.runner, candidate.model], {
    timeout: PROBE_TIMEOUT_MS,
    stdio: ['ignore', 'ignore', 'ignore'],
    encoding: 'utf8',
  });
  if (result.error) {
    const kind = result.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn';
    return { skip: null, warning: `probe_unknown:${kind}` };
  }
  const code = result.status;
  if (code === 0) return { skip: null, warning: null };
  if (Object.prototype.hasOwnProperty.call(PROBE_EXIT, code)) {
    return { skip: `probe:${PROBE_EXIT[code]}`, warning: null };
  }
  return { skip: null, warning: `probe_unknown:${code == null ? 'signal' : code}` };
}

function preflight({ candidates, now, sources } = {}) {
  const src = sources || {};
  const env = src.env || process.env;
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  const warnings = [];
  const list = Array.isArray(candidates) ? candidates : [];
  const windowMs = windowMinOf(env, src.windowMin) * 60 * 1000;
  const capacity = loadCapacity(src, env, nowMs, warnings);
  const burn = loadBurn(src, env);
  const dir = src.runsDir || runsDir(env);
  const runs = loadRuns(dir);
  const probe = src.probe !== undefined ? src.probe : (env.AUTOPILOT_ENGINE_PREFLIGHT_PROBE || null);

  const skipped = [];
  const burnListed = [];
  let chosen = null;
  for (const candidate of list) {
    const runner = candidate && candidate.runner;
    const model = candidate && candidate.model;
    const burnMore = listedInBurn({ runner, model }, burn);
    if (burnMore) burnListed.push({ runner, model });
    if (chosen) continue;
    const row = capacity.find((r) => r && r.harness === runner && r.model === model);
    const cap = row ? capacityReason(row) : null;
    const recent = recentReason({ runner, model }, runs, nowMs, windowMs);
    let reason = cap || recent;
    let warning = null;
    if (!reason && probe) {
      const probed = probeCandidate(probe, { runner, model });
      reason = probed.skip;
      warning = probed.warning;
    }
    if (warning) warnings.push(warning);
    if (reason) {
      const item = { runner, model, reason };
      if (burnMore) item.burn_more = true;
      skipped.push(item);
    } else {
      chosen = { runner, model };
      if (burnMore) chosen.burn_more = true;
    }
  }
  return {
    schema: SCHEMA,
    chosen,
    skipped,
    warnings,
    burn_more: burnListed,
  };
}

function parseArgs(argv) {
  const candidates = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true, candidates };
    if (a === '--candidate') {
      const value = argv[++i];
      if (!value || !value.includes(':')) return { error: 'usage: --candidate runner:model' };
      const cut = value.indexOf(':');
      candidates.push({ runner: value.slice(0, cut), model: value.slice(cut + 1) });
      continue;
    }
    return { error: `unknown argument: ${a}` };
  }
  if (candidates.length === 0) return { error: 'usage: --candidate runner:model (repeatable)' };
  return { candidates };
}

function helpText() {
  return [
    'Usage: node scripts/lib/engine-preflight.js --candidate runner:model [--candidate runner:model ...]',
    'Exit 0 when a candidate is chosen, 3 when every candidate is skipped, 2 on usage.',
    'Env: AUTOPILOT_ENGINES_TABLE, AUTOPILOT_BURN_MORE, AUTOPILOT_ENGINE_PREFLIGHT_WINDOW_MIN, AUTOPILOT_ENGINE_PREFLIGHT_PROBE.',
  ].join('\n');
}

function writeStdout(text) {
  fs.writeSync(1, text);
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    writeStdout(`${helpText()}\n`);
    return 0;
  }
  if (parsed.error) {
    fs.writeSync(2, `${parsed.error}\n${helpText()}\n`);
    return 2;
  }
  const result = preflight({ candidates: parsed.candidates });
  for (let i = 0; i < result.skipped.length; i++) {
    const item = result.skipped[i];
    const idx = parsed.candidates.findIndex((c) => c.runner === item.runner && c.model === item.model);
    const next = parsed.candidates[idx + 1];
    const nxt = next ? `${next.runner}:${next.model}` : 'none';
    fs.writeSync(2, `preflight: skip ${item.runner}:${item.model} (${item.reason}); next ${nxt}\n`);
  }
  writeStdout(`${JSON.stringify(result)}\n`);
  return result.chosen ? 0 : 3;
}

module.exports = {
  preflight,
  withinWindow,
  failureCategory,
  SCHEMA,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
