#!/usr/bin/env node
/**
 * quota-wait-check.js — Check engine quota from `fleet seats --quota --json` (harness section).
 *
 * Usage:
 *   node scripts/quota-wait-check.js --engine <engine> [--json]
 *
 * Env:
 *   AUTOPILOT_FLEET_QUOTA_JSON_FILE  Optional path to a JSON file mocking `fleet seats --quota --json`.
 *
 * Exports:
 *   checkEngineQuota(engine, opts) -> { engine, resolved_engine, verdict, pct_5h, pct_7d, reset_at, observed_at, reason, reading_line }
 *   normalizeEngine(engine)
 *   formatReadingLine(reading)
 *   parseQuotaFromHarness(harness, engine, topLevelObservedAt)
 */
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

function normalizeEngine(engine) {
  if (typeof engine !== 'string') return '';
  const raw = engine.trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'agy' || raw.includes('carbon') || raw.includes('hydrogen') || raw.includes('gemini')) return 'agy';
  if (raw === 'codex' || raw.includes('gpt')) return 'codex';
  if (raw === 'claude' || raw.includes('opus') || raw.includes('sonnet') || raw.includes('haiku')) return 'claude';
  if (raw.includes('grok')) return 'grok';
  if (raw.includes('kimi')) return 'kimi';
  if (raw.includes('cursor') || raw.includes('composer')) return 'cursor';
  if (raw.includes('opencode')) return 'opencode';
  return raw;
}

function finiteNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/%$/, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickFirstNum(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const n = finiteNum(obj[k]);
      if (n !== null) return n;
    }
  }
  return null;
}

function pickFirstStr(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

function extractWindowPct(entry, windowKey) {
  if (!entry || typeof entry !== 'object') return null;
  const directKeys = windowKey === '5h'
    ? ['pct_5h', '5h_pct', 'five_hour_pct', '5h', 'five_hour_used_pct']
    : ['pct_7d', '7d_pct', 'seven_day_pct', '7d', 'seven_day_used_pct'];
  const direct = pickFirstNum(entry, directKeys);
  if (direct !== null) return direct;

  const subObj = windowKey === '5h'
    ? (entry.five_hour || entry['5h'] || (entry.windows && entry.windows['5h']) || (entry.quota && entry.quota['5h']))
    : (entry.seven_day || entry['7d'] || (entry.windows && entry.windows['7d']) || (entry.quota && entry.quota['7d']));
  if (subObj && typeof subObj === 'object') {
    const used = pickFirstNum(subObj, ['used_pct', 'pct', 'used', 'percent']);
    if (used !== null) return used;
    const rem = pickFirstNum(subObj, ['remaining_pct', 'left_pct']);
    if (rem !== null) return Math.max(0, 100 - rem);
  }
  return null;
}

function extractResetAt(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const direct = pickFirstStr(entry, ['reset_at', 'resets_at', 'reset_time', 'reset', 'five_hour_reset_at', 'seven_day_reset_at']);
  if (direct) return direct;
  for (const sub of [entry.five_hour, entry['5h'], entry.seven_day, entry['7d'], entry.windows && entry.windows['5h'], entry.windows && entry.windows['7d']]) {
    const s = pickFirstStr(sub, ['reset_at', 'resets_at', 'reset_time', 'reset']);
    if (s) return s;
  }
  return null;
}

function findHarnessEntry(harness, engine) {
  if (!harness || typeof harness !== 'object') return null;
  const norm = normalizeEngine(engine);
  const raw = String(engine || '').trim().toLowerCase();

  if (Array.isArray(harness)) {
    return harness.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const k = String(item.engine || item.harness || item.name || '').trim().toLowerCase();
      return k === raw || k === norm || normalizeEngine(k) === norm;
    }) || null;
  }

  if (raw && harness[raw] && typeof harness[raw] === 'object') return harness[raw];
  if (norm && harness[norm] && typeof harness[norm] === 'object') return harness[norm];
  for (const [k, v] of Object.entries(harness)) {
    if (v && typeof v === 'object' && normalizeEngine(k) === norm) return v;
  }
  return null;
}

function formatReadingLine(r) {
  if (!r) return '';
  const eng = r.resolved_engine || r.engine || 'unknown';
  const p5 = r.pct_5h !== null && r.pct_5h !== undefined ? `${r.pct_5h}%` : 'unknown';
  const p7 = r.pct_7d !== null && r.pct_7d !== undefined ? `${r.pct_7d}%` : 'unknown';
  const rst = r.reset_at || 'unknown';
  const obs = r.observed_at || 'unknown';
  return `quota_reading: engine=${eng} 5h=${p5} 7d=${p7} reset_at=${rst} observed_at=${obs}`;
}

function parseQuotaFromHarness(harness, engine, topLevelObservedAt) {
  const norm = normalizeEngine(engine);
  const entry = findHarnessEntry(harness, engine);
  if (!entry) {
    return {
      engine: String(engine || ''),
      resolved_engine: norm || String(engine || ''),
      verdict: 'unknown',
      pct_5h: null,
      pct_7d: null,
      reset_at: null,
      observed_at: topLevelObservedAt || null,
      reason: `harness 段找不到引擎 ${engine || '(empty)'} 的額度資料`,
      reading_line: '',
    };
  }

  const pct_5h = extractWindowPct(entry, '5h');
  const pct_7d = extractWindowPct(entry, '7d');
  const reset_at = extractResetAt(entry);
  const observed_at = pickFirstStr(entry, ['observed_at', 'updated_at', 'checked_at', 'fetched_at']) || topLevelObservedAt || null;

  let verdict = 'unknown';
  let reason = '';
  if (entry.exhausted === true || entry.status === 'exhausted' || (pct_5h !== null && pct_5h >= 100) || (pct_7d !== null && pct_7d >= 100)) {
    verdict = 'exhausted';
    reason = `引擎 ${norm || engine} 額度已耗盡 (5h=${pct_5h ?? 'unknown'}%, 7d=${pct_7d ?? 'unknown'}%)`;
  } else if (pct_5h !== null || pct_7d !== null) {
    verdict = 'has_quota';
    reason = `引擎 ${norm || engine} 仍有額度 (5h=${pct_5h ?? 'unknown'}%, 7d=${pct_7d ?? 'unknown'}%)，可直接派工`;
  } else {
    verdict = 'unknown';
    reason = `引擎 ${norm || engine} 缺少 5h/7d 額度讀數`;
  }

  const result = {
    engine: String(engine || ''),
    resolved_engine: norm || String(engine || ''),
    verdict,
    pct_5h,
    pct_7d,
    reset_at,
    observed_at,
    reason,
    reading_line: '',
  };
  result.reading_line = formatReadingLine(result);
  return result;
}

function readFleetQuotaJson(opts = {}) {
  if (opts.fleetData) return { ok: true, data: opts.fleetData };
  const mockFile = opts.quotaJsonFile || process.env.AUTOPILOT_FLEET_QUOTA_JSON_FILE;
  if (mockFile) {
    try {
      const raw = fs.readFileSync(mockFile, 'utf8');
      return { ok: true, data: JSON.parse(raw) };
    } catch (err) {
      return { ok: false, error: `讀取額度假檔失敗 (${mockFile}): ${err.message}` };
    }
  }
  try {
    const out = execFileSync('fleet', ['seats', '--quota', '--json'], {
      encoding: 'utf8',
      timeout: opts.timeoutMs || 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, data: JSON.parse(out) };
  } catch (err) {
    return { ok: false, error: `fleet seats --quota --json 執行失敗: ${err.message}` };
  }
}

function checkEngineQuota(engine, opts = {}) {
  if (!engine || typeof engine !== 'string' || !engine.trim()) {
    return {
      engine: '',
      resolved_engine: '',
      verdict: 'unknown',
      pct_5h: null,
      pct_7d: null,
      reset_at: null,
      observed_at: null,
      reason: '未指定 engine',
      reading_line: '',
    };
  }
  const res = readFleetQuotaJson(opts);
  if (!res.ok) {
    return {
      engine: engine.trim(),
      resolved_engine: normalizeEngine(engine),
      verdict: 'unknown',
      pct_5h: null,
      pct_7d: null,
      reset_at: null,
      observed_at: null,
      reason: `${res.error}（判定為 unknown，不當作 exhausted）`,
      reading_line: '',
    };
  }
  const data = res.data || {};
  const topObservedAt = pickFirstStr(data, ['observed_at', 'updated_at', 'timestamp']);
  if (!data.harness) {
    return {
      engine: engine.trim(),
      resolved_engine: normalizeEngine(engine),
      verdict: 'unknown',
      pct_5h: null,
      pct_7d: null,
      reset_at: null,
      observed_at: topObservedAt,
      reason: 'fleet seats --quota --json 缺少 harness 段（判定為 unknown，不當作 exhausted）',
      reading_line: '',
    };
  }
  return parseQuotaFromHarness(data.harness, engine.trim(), topObservedAt);
}

function parseArgs(argv) {
  const args = { engine: '', json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--engine' && i + 1 < argv.length) { args.engine = argv[++i]; }
    else if (a.startsWith('--engine=')) { args.engine = a.slice('--engine='.length); }
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  if (!args.engine) {
    console.error('用法: node scripts/quota-wait-check.js --engine <engine> [--json]');
    process.exit(2);
  }
  const result = checkEngineQuota(args.engine);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[${result.verdict}] ${result.reason}`);
    if (result.reading_line) console.log(result.reading_line);
  }
}

module.exports = {
  checkEngineQuota,
  normalizeEngine,
  formatReadingLine,
  parseQuotaFromHarness,
};
