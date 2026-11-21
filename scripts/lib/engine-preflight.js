#!/usr/bin/env node
'use strict';

// engine-preflight.js — decide which runner:model to dispatch before spending a ticket.
// Node >= 20.10, built-ins only. Never invokes grok, codex, agy, opencode, kimi or cursor.
//
//   preflight({ candidates, now, sources, preferBurnMore }) -> {
//     schema: 'autopilot.engine-preflight/1',
//     chosen: { runner, model, burn_more? } | null,
//     skipped: [{ runner, model, reason, burn_more? }],
//     warnings: string[],
//     burn_more: [{ runner, model }]   // candidates listed in capacity burn_more
//   }
//
// Skip reasons:
//   capacity:<availability>/<suggest>   engines table row is spent, stopped, paused, or 不派*
//   recent:<category>@<run_id>          manifest in the last WINDOW minutes
//   probe:<overloaded|rate_limited|unsupported|timeout>
//
// Capacity table older than 30 minutes, missing, or unparseable is ignored
// (warnings: capacity_table_stale, capacity_table_missing,
// capacity_table_unparseable). Other emitted warnings are
// all_candidates_skipped_default_order and probe_unknown:<timeout|spawn|signal|exit-code>.
// It never blocks.
// burn_more is not a skip. `preferBurnMore` stably moves listed candidates first.
//
// CLI:
//   node scripts/lib/engine-preflight.js [--prefer-burn-more] [--local-first] [--fallback-on-all-skipped]
//     (--candidate runner:model ... | --candidates-json '[{"runner":"...","model":"..."}]')
// Exit 0 when one candidate is chosen, 3 when every candidate is skipped and
// --fallback-on-all-skipped is not set, 2 on usage.
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
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const AUTH_NOTIFY_TTL_MS = 15 * 60 * 1000;
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
  if (low.includes('model_unsupported') || low.includes('not supported') || low.includes('model unavailable') || low.includes('model is not available')) return 'model_unsupported';
  if (low.includes('quota exhausted') || low.includes('quota_exhausted')) return 'quota_exhausted';
  return null;
}

function loadCapacity(src, env, nowMs, warnings) {
  const given = src.enginesTable;
  if (given && typeof given === 'object') return rowsOf(given, nowMs, warnings);
  const file = typeof given === 'string' ? given : enginesTablePath(env);
  const read = readJson(file);
  if (!read.ok) {
    warnings.push(read.code === 'ENOENT' ? 'capacity_table_missing' : 'capacity_table_unparseable');
    return [];
  }
  return rowsOf(read.value, nowMs, warnings);
}

function rowsOf(doc, nowMs, warnings) {
  if (!doc || doc.schema !== CAPACITY_SCHEMA || !Array.isArray(doc.engines)) {
    warnings.push('capacity_table_unparseable');
    return [];
  }
  const gen = Date.parse(doc.generated_at);
  if (!Number.isFinite(gen)) {
    warnings.push('capacity_table_unparseable');
    return [];
  }
  if (nowMs - gen > CAPACITY_MAX_AGE_MS) {
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

function authFileForRunner(runner, env) {
  if (runner === 'codex') {
    return env.CODEX_HOME ? path.join(env.CODEX_HOME, 'auth.json') : path.join(homeOf(env), '.codex', 'auth.json');
  }
  return null;
}

function writeJsonBestEffort(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {
    // Best-effort cache/notify state; never block preflight.
  }
}

function checkAuthWithCache(runner, env, nowMs, dir) {
  const authFile = authFileForRunner(runner, env);
  if (!authFile) return null;
  const cacheFile = path.join(dir, `auth-probe-${runner}.json`);
  const cached = readJson(cacheFile);
  if (
    cached.ok &&
    cached.value &&
    typeof cached.value.checkedAt === 'number' &&
    typeof cached.value.ok === 'boolean' &&
    nowMs >= cached.value.checkedAt &&
    (nowMs - cached.value.checkedAt) < AUTH_CACHE_TTL_MS
  ) {
    return cached.value.ok ? null : 'auth:missing';
  }
  let ok = false;
  try {
    const st = fs.statSync(authFile);
    ok = st.isFile() && st.size > 0;
  } catch {
    ok = false;
  }
  writeJsonBestEffort(cacheFile, { ok, checkedAt: nowMs });
  return ok ? null : 'auth:missing';
}

function shouldNotifyAuthMissing(runner, nowMs, dir) {
  const notifyFile = path.join(dir, `auth-notify-${runner}.json`);
  const prev = readJson(notifyFile);
  if (
    prev.ok &&
    prev.value &&
    typeof prev.value.notifiedAt === 'number' &&
    nowMs >= prev.value.notifiedAt &&
    (nowMs - prev.value.notifiedAt) < AUTH_NOTIFY_TTL_MS
  ) {
    return false;
  }
  writeJsonBestEffort(notifyFile, { notifiedAt: nowMs });
  return true;
}

function probeCandidate(probe, candidate) {
  if (!probe) return { skip: null, warning: null };
  const result = spawnSync(probe, [candidate.runner, candidate.model], {
    timeout: PROBE_TIMEOUT_MS,
    // SIGTERM is the default. A probe that traps it keeps spawnSync blocked past the budget.
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'ignore', 'ignore'],
    encoding: 'utf8',
  });
  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    return {
      skip: timedOut ? 'probe:timeout' : null,
      warning: `probe_unknown:${timedOut ? 'timeout' : 'spawn'}`,
    };
  }
  const code = result.status;
  if (code === 0) return { skip: null, warning: null };
  if (Object.prototype.hasOwnProperty.call(PROBE_EXIT, code)) {
    return { skip: `probe:${PROBE_EXIT[code]}`, warning: null };
  }
  return { skip: null, warning: `probe_unknown:${code == null ? 'signal' : code}` };
}

function preflight({ candidates, now, sources, preferBurnMore = false, localFirst = false, fallbackOnAllSkipped = false } = {}) {
  const src = sources || {};
  const env = src.env || process.env;
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  const warnings = [];
  const input = Array.isArray(candidates) ? candidates : [];
  const windowMs = windowMinOf(env, src.windowMin) * 60 * 1000;
  const capacity = loadCapacity(src, env, nowMs, warnings);
  const capacitySource = src.enginesTable;
  const capacityPath = typeof capacitySource === 'string' ? capacitySource : enginesTablePath(env);
  const capacityDoc = capacitySource && typeof capacitySource === 'object'
    ? capacitySource
    : readJson(capacityPath).value;
  const burn = loadBurn(src, env);
  const list = (preferBurnMore || localFirst)
    ? input.map((candidate, index) => ({ candidate, index, preferred: listedInBurn(candidate, burn) }))
      .sort((a, b) => {
        const aLocal = localFirst && (a.candidate.runner === 'local' || a.candidate.runner === 'cc-shim');
        const bLocal = localFirst && (b.candidate.runner === 'local' || b.candidate.runner === 'cc-shim');
        return Number(bLocal) - Number(aLocal)
          || (preferBurnMore ? Number(b.preferred) - Number(a.preferred) : 0)
          || a.index - b.index;
      })
      .map(({ candidate }) => candidate)
    : input;
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
    const auth = checkAuthWithCache(runner, env, nowMs, dir);
    let reason = cap || recent || auth;
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
  if (!chosen && fallbackOnAllSkipped && list.length > 0) {
    const first = input[0];
    chosen = { runner: first.runner, model: first.model, fallback: true };
    warnings.push('all_candidates_skipped_default_order');
  }
  const authSkipped = skipped.find((s) => s.reason === 'auth:missing');
  const fallback = (chosen && authSkipped)
    ? { from: authSkipped.runner, to: chosen.runner, reason: 'auth:missing' }
    : null;
  // notify is true at most once per runner per 15 minutes; the dispatcher prints the one stderr line.
  if (fallback) fallback.notify = shouldNotifyAuthMissing(authSkipped.runner, nowMs, dir);
  return {
    schema: SCHEMA,
    chosen,
    skipped,
    warnings,
    burn_more: burnListed,
    fallback,
    table_path: capacityPath,
    generated_at: capacityDoc && typeof capacityDoc.generated_at === 'string' ? capacityDoc.generated_at : null,
  };
}

function parseArgs(argv) {
  const candidates = [];
  let preferBurnMore = false;
  let localFirst = false;
  let fallbackOnAllSkipped = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true, candidates };
    if (a === '--prefer-burn-more') { preferBurnMore = true; continue; }
    if (a === '--local-first') { localFirst = true; continue; }
    if (a === '--fallback-on-all-skipped') { fallbackOnAllSkipped = true; continue; }
    if (a === '--candidate') {
      const value = argv[++i];
      if (!value || !value.includes(':')) return { error: 'usage: --candidate runner:model' };
      const cut = value.indexOf(':');
      candidates.push({ runner: value.slice(0, cut), model: value.slice(cut + 1) });
      continue;
    }
    if (a === '--candidates-json') {
      const value = argv[++i];
      try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed) || parsed.some((r) => !r || typeof r.runner !== 'string' || typeof r.model !== 'string')) {
          return { error: 'usage: --candidates-json must be an array of runner/model objects' };
        }
        candidates.push(...parsed);
      } catch {
        return { error: 'usage: --candidates-json must be valid JSON' };
      }
      continue;
    }
    return { error: `unknown argument: ${a}` };
  }
  if (candidates.length === 0) return { error: 'usage: --candidate runner:model (repeatable)' };
  return { candidates, preferBurnMore, localFirst, fallbackOnAllSkipped };
}

function helpText() {
  return [
    'Usage: node scripts/lib/engine-preflight.js [--prefer-burn-more] [--local-first] [--fallback-on-all-skipped] (--candidate runner:model ... | --candidates-json JSON)',
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
  const result = preflight({ candidates: parsed.candidates, preferBurnMore: parsed.preferBurnMore, localFirst: parsed.localFirst, fallbackOnAllSkipped: parsed.fallbackOnAllSkipped });
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
