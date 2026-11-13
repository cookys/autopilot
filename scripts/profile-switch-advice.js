#!/usr/bin/env node
'use strict';
/**
 * profile-switch-advice.js - recommend moving lanes out of / back into quota pools
 * (plan project/plans/2026-11-10-profile-switch.md §P3, KR4).
 *
 * Reads 7-day quota snapshots per login profile (pool), appends usable readings to
 * <baseDir>/quota-readings.jsonl via lib/jsonl-store.js appendRow, evaluates move-out /
 * move-back / 24h cooldown rules, and outputs Traditional Chinese [建議] messages
 * (or sends via `fleet send` with --send-to). Never invokes lane-switch.
 *
 * Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { MAX_AGE_MS, TIGHT_THRESHOLD, quotaDir, interpretSnapshot, readSnapshotFile } = require('./lib/account-quota');
const { claudeAccount } = require('./lib/account-alias');
const { withWriteLock, appendRow, ensureDir } = require('./lib/jsonl-store');
const { readManifest, NAME_RE } = require('./lib/lane-manifest');
const { resolveLiveDir } = require('./lib/live-state-dir');

const TARGET_MAX_PCT = 0.70;
const MIN_BURN_SPAN_MS = 60 * 60 * 1000;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const ALIAS_RE = /^(?:acct-[0-9a-f]{8}|[a-z0-9-]{1,24})$/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const TOKEN_RE = /sk-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9+/_=-]{40,}/;
const DROP_ENV = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AUTOPILOT_ACCOUNT'];
const ORDER_PLACEHOLDER = '<PM 訊息 id>';

function usage() {
  return [
    'usage: node scripts/profile-switch-advice.js [options]',
    '  --send-to <address>       send recommendations via `fleet send` instead of stdout',
    '  --base-dir <dir>          override lane/readings base dir (default ~/.config/autopilot)',
    '  --live-dir <dir>          override live quota snapshot base dir',
    '  --readings-file <path>    override quota-readings.jsonl path',
    '  --state-file <path>       override state JSON path',
    '  --help                    show help',
  ].join('\n');
}

function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--send-to' || a === '--base-dir' || a === '--live-dir' || a === '--readings-file' || a === '--state-file') {
      if (i + 1 >= argv.length) return { error: `${a} 需要參數值` };
      const v = String(argv[++i] || '').trim();
      if (!v || v.startsWith('-')) return { error: `${a} 參數無效` };
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      o[key] = v;
      continue;
    }
    return { error: `未知參數：${a}` };
  }
  return o;
}

function resolveNowMs(nowDep) {
  if (typeof nowDep === 'function') {
    const v = nowDep();
    return typeof v === 'number' ? v : Date.parse(v);
  }
  if (typeof nowDep === 'number' && Number.isFinite(nowDep)) return nowDep;
  if (typeof nowDep === 'string') return Date.parse(nowDep);
  return Date.now();
}

function taipei(msOrSec, isSeconds) {
  const ms = isSeconds ? msOrSec * 1000 : msOrSec;
  if (!Number.isFinite(ms)) return '未知';
  return `${new Date(ms + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')} +08`;
}

function pctText(pct) {
  return `${Math.round(pct * 100)}%`;
}

function scrubEnv(env) {
  const out = { ...(env || {}) };
  for (const k of DROP_ENV) delete out[k];
  return out;
}

function aliasEnv(home, profile) {
  const env = scrubEnv(process.env);
  env.HOME = home;
  if (profile === 'home') delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = path.join(home, '.claude-profiles', profile);
  return env;
}

function defaultRun(bin, args, opts) {
  return spawnSync(bin, args, { encoding: 'utf8', timeout: 30000, ...(opts || {}) });
}

function fleetBin(deps) {
  return (deps && deps.fleetBin) || process.env.AUTOPILOT_FLEET_BIN || 'fleet';
}

function assertSafeValue(k, v) {
  if (typeof v === 'string') {
    if (EMAIL_RE.test(v)) throw new Error(`unsafe_email_shaped:${k}`);
    if (TOKEN_RE.test(v)) throw new Error(`unsafe_token_shaped:${k}`);
    return;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`unsafe_nonfinite:${k}`);
    return;
  }
  throw new Error(`unsafe_type:${k}`);
}

function validateReadingRow(row) {
  const keys = ['ts_ms', 'alias', 'profile', 'pct', 'resets_at'];
  for (const k of Object.keys(row)) {
    if (!keys.includes(k)) throw new Error(`reading_field_rejected:${k}`);
    assertSafeValue(k, row[k]);
  }
  if (!ALIAS_RE.test(row.alias)) throw new Error('reading_alias_invalid');
  if (!NAME_RE.test(row.profile)) throw new Error('reading_profile_invalid');
}

function discoverProfiles(f, home, lanes, deps) {
  if (Array.isArray(deps && deps.profiles)) return [...deps.profiles];
  const found = new Set();
  if (f.existsSync(path.join(home, '.claude')) || f.existsSync(path.join(home, '.claude.json'))) {
    found.add('home');
  }
  const profRoot = path.join(home, '.claude-profiles');
  try {
    const ents = f.readdirSync(profRoot, { withFileTypes: true });
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (e.name !== 'home' && NAME_RE.test(e.name)) found.add(e.name);
    }
  } catch (_) { /* no profiles dir */ }
  for (const l of lanes) {
    if (l.profile && (l.profile === 'home' || NAME_RE.test(l.profile))) found.add(l.profile);
  }
  return [...found].sort();
}

function readLaneManifestWithFs(f, baseDir, laneName) {
  if (f === fs) return readManifest(baseDir, laneName);
  const file = path.join(baseDir, 'lanes', `${laneName}.json`);
  let raw;
  try {
    const st = f.statSync(file);
    if ((st.mode & 0o777) !== 0o600) throw new Error('manifest_mode_not_0600');
    raw = f.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  const obj = JSON.parse(raw);
  if (!obj || typeof obj !== 'object' || obj.lane !== laneName) throw new Error('manifest_invalid');
  return obj;
}

function discoverLanes(f, baseDir, deps) {
  if (Array.isArray(deps && deps.lanes)) return [...deps.lanes].sort((a, b) => a.lane.localeCompare(b.lane));
  const dir = path.join(baseDir, 'lanes');
  let ents;
  try {
    ents = f.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const out = [];
  for (const e of ents) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const laneName = e.name.slice(0, -5);
    if (!NAME_RE.test(laneName)) continue;
    const rec = readLaneManifestWithFs(f, baseDir, laneName);
    if (rec && rec.profile) out.push(rec);
  }
  return out.sort((a, b) => a.lane.localeCompare(b.lane));
}

function readRawSnapshot(f, liveBase, alias, deps) {
  if (deps && deps.snapshots && Object.prototype.hasOwnProperty.call(deps.snapshots, alias)) {
    return deps.snapshots[alias];
  }
  if (f === fs) return readSnapshotFile(liveBase, alias);
  if (!ALIAS_RE.test(String(alias))) return { __error: 'quota_invalid' };
  const file = path.join(quotaDir(liveBase), `${alias}.json`);
  let text;
  try {
    text = f.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return { __error: 'quota_unreadable' };
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    return { __error: 'quota_invalid' };
  }
}

function readPoolSevenDay(f, liveBase, alias, nowMs, deps) {
  const raw = readRawSnapshot(f, liveBase, alias, deps);
  if (!raw || raw.__error) return { usable: false, alias, note: (raw && raw.__error) || null };
  const interp = interpretSnapshot(raw, { alias, nowMs });
  if (interp.state !== 'known') return { usable: false, alias, note: interp.note };
  const win = raw.seven_day;
  if (!win || typeof win !== 'object') return { usable: false, alias, note: 'seven_day_missing' };
  if (win.resets_at * 1000 <= nowMs) return { usable: false, alias, note: 'seven_day_expired' };
  return {
    usable: true,
    alias,
    pct: win.pct,
    resets_at: win.resets_at,
    written_at_ms: raw.written_at_ms,
  };
}

function appendReadingRow(f, readingsFile, row) {
  validateReadingRow(row);
  const dir = path.dirname(readingsFile);
  if (f === fs) {
    withWriteLock({ storeDir: dir, lockFile: `${readingsFile}.lock`, name: 'quota-readings' }, () => {
      ensureDir(dir);
      appendRow(readingsFile, row);
    });
    return;
  }
  f.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const line = `${JSON.stringify(row)}\n`;
  if (typeof f.appendFileSync === 'function') {
    f.appendFileSync(readingsFile, line, { encoding: 'utf8', mode: 0o600 });
  } else {
    let prev = '';
    try { prev = f.readFileSync(readingsFile, 'utf8'); } catch (_) { prev = ''; }
    f.writeFileSync(readingsFile, prev + line, { encoding: 'utf8', mode: 0o600 });
  }
}

function readReadingsHistory(f, readingsFile) {
  let raw;
  try {
    raw = f.readFileSync(readingsFile, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && Number.isFinite(obj.ts_ms) && Number.isFinite(obj.pct) && Number.isFinite(obj.resets_at)) {
        rows.push(obj);
      }
    } catch (_) { /* ignore malformed history line */ }
  }
  return rows;
}

/**
 * Evaluate linear burn-rate over >=2 readings in the current resets_at window,
 * spanning >= 1 h, with the latest reading younger than MAX_AGE_MS (6 h).
 */
function evaluateBurnRate(windowReadings, resetsAtSec, nowMs) {
  if (!Array.isArray(windowReadings) || windowReadings.length < 2) return null;
  if (!Number.isFinite(resetsAtSec) || resetsAtSec * 1000 <= nowMs) return null;
  const byTs = new Map();
  for (const r of windowReadings) {
    if (!Number.isFinite(r.ts_ms) || !Number.isFinite(r.pct)) continue;
    if (r.ts_ms - nowMs > FUTURE_SKEW_MS) continue;
    byTs.set(r.ts_ms, r.pct);
  }
  const points = [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts_ms, pct]) => ({ ts_ms, pct }));
  if (points.length < 2) return null;

  const first = points[0];
  const latest = points[points.length - 1];
  if (nowMs - latest.ts_ms > MAX_AGE_MS) return null;
  if (latest.ts_ms - first.ts_ms < MIN_BURN_SPAN_MS) return null;

  const t0 = first.ts_ms;
  const xs = points.map((p) => (p.ts_ms - t0) / 3600000);
  const ys = points.map((p) => p.pct);
  const n = points.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  if (den <= 0) return null;
  const slope = num / den;
  if (slope <= 0) return null;

  const resetsAtMs = resetsAtSec * 1000;
  const tReset = (resetsAtMs - t0) / 3600000;
  const projectedAtReset = meanY + slope * (tReset - meanX);
  const tHit = meanX + (1.0 - meanY) / slope;
  const hitMs = t0 + tHit * 3600000;
  return {
    trigger: projectedAtReset >= 1.0 && hitMs < resetsAtMs,
    slopePerHour: slope,
    projectedAtReset,
    hitMs,
  };
}

function loadState(f, stateFile) {
  try {
    const raw = f.readFileSync(stateFile, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && obj.lanes && typeof obj.lanes === 'object') {
      return { version: 1, lanes: obj.lanes };
    }
  } catch (e) {
    if (!e || e.code !== 'ENOENT') throw e;
  }
  return { version: 1, lanes: {} };
}

function saveState(f, stateFile, state) {
  const dir = path.dirname(stateFile);
  f.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${stateFile}.tmp.${process.pid}`;
  const body = `${JSON.stringify(state, null, 2)}\n`;
  f.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
  if (typeof f.chmodSync === 'function') f.chmodSync(tmp, 0o600);
  f.renameSync(tmp, stateFile);
}

function switchCommand(lane, profile) {
  return `node scripts/lane-switch.js --lane ${lane} --profile ${profile} --order ${ORDER_PLACEHOLDER}`;
}

function formatMoveOutMessage({ lane, from, fromReading, burn, target }) {
  const reason = fromReading.pct >= TIGHT_THRESHOLD
    ? `7天用量：${pctText(fromReading.pct)}（已達警戒 ${pctText(TIGHT_THRESHOLD)}）`
    : `7天用量：${pctText(fromReading.pct)}（依目前消耗速率，預估將於 ${taipei(burn.hitMs, false)} 達 100%，重置前預估達 ${pctText(burn.projectedAtReset)}）`;
  return [
    '[建議]',
    `車道：${lane}`,
    `來源：${from}（${reason}，重置時間：${taipei(fromReading.resets_at, true)}）`,
    `目標：${target.profile}（7天用量：${pctText(target.reading.pct)}，重置時間：${taipei(target.reading.resets_at, true)}）`,
    `指令：${switchCommand(lane, target.profile)}`,
  ].join('\n');
}

function formatNoTargetMessage({ lane, from, fromReading, burn }) {
  const reason = fromReading.pct >= TIGHT_THRESHOLD
    ? `7天用量：${pctText(fromReading.pct)}（已達警戒 ${pctText(TIGHT_THRESHOLD)}）`
    : `7天用量：${pctText(fromReading.pct)}（依目前消耗速率，預估將於 ${taipei(burn.hitMs, false)} 達 100%，重置前預估達 ${pctText(burn.projectedAtReset)}）`;
  return [
    '[建議]',
    `車道：${lane}`,
    `來源：${from}（${reason}，重置時間：${taipei(fromReading.resets_at, true)}）`,
    `目標：無可用目標訂閱池（目前沒有 7 天用量低於 ${pctText(TARGET_MAX_PCT)} 且讀數在 6 小時內的訂閱池，暫不建議切換）。`,
  ].join('\n');
}

function formatMoveBackMessage({ lane, from, fromPool, to, toPool, originResetsAt }) {
  const fromDetail = fromPool && fromPool.reading && fromPool.reading.usable
    ? `7天用量：${pctText(fromPool.reading.pct)}，重置時間：${taipei(fromPool.reading.resets_at, true)}`
    : '目前無可用 7 天讀數';
  const toDetail = toPool && toPool.reading && toPool.reading.usable
    ? `原訂閱池已重置（7天用量：${pctText(toPool.reading.pct)}，重置時間：${taipei(toPool.reading.resets_at, true)}）`
    : `原訂閱池已重置（重置時間：${taipei(originResetsAt, true)}）`;
  return [
    '[建議]',
    `車道：${lane}`,
    `來源：${from}（${fromDetail}）`,
    `目標：${to}（${toDetail}）`,
    `指令：${switchCommand(lane, to)}`,
  ].join('\n');
}

function pickBestTarget(pools, excludeProfile) {
  const candidates = pools
    .filter((p) => p.profile !== excludeProfile && p.reading.usable && p.reading.pct < TARGET_MAX_PCT)
    .sort((a, b) => (a.reading.pct - b.reading.pct) || a.profile.localeCompare(b.profile));
  return candidates[0] || null;
}

function shouldMoveBack(laneState, originPool, nowMs) {
  if (!laneState || !laneState.origin_profile) return false;
  const originResetsAt = laneState.origin_resets_at;
  if (originPool && originPool.reading && originPool.reading.usable) {
    if (Number.isFinite(originResetsAt)) {
      if (originPool.reading.resets_at > originResetsAt) {
        return originPool.reading.pct < TARGET_MAX_PCT;
      }
      return false;
    }
    return originPool.reading.pct < TARGET_MAX_PCT;
  }
  return Number.isFinite(originResetsAt) && originResetsAt * 1000 <= nowMs;
}

function evaluateLane(laneRec, laneState, poolsByName, allPools, historyRows, nowMs) {
  const lane = laneRec.lane;
  const profile = laneRec.profile;

  const nextState = { ...(laneState || {}) };
  if (nextState.origin_profile && nextState.origin_profile === profile) {
    delete nextState.origin_profile;
    delete nextState.origin_resets_at;
    delete nextState.target_profile;
  }

  if (Number.isFinite(nextState.last_recommended_at_ms) && nowMs - nextState.last_recommended_at_ms < COOLDOWN_MS) {
    return { advice: null, nextState };
  }

  if (nextState.origin_profile && nextState.origin_profile !== profile) {
    const originPool = poolsByName.get(nextState.origin_profile) || null;
    if (shouldMoveBack(nextState, originPool, nowMs)) {
      const fromPool = poolsByName.get(profile) || null;
      const msg = formatMoveBackMessage({
        lane,
        from: profile,
        fromPool,
        to: nextState.origin_profile,
        toPool: originPool,
        originResetsAt: nextState.origin_resets_at,
      });
      nextState.last_recommended_at_ms = nowMs;
      nextState.last_action = 'move_back';
      return { advice: { kind: 'move_back', lane, from: profile, to: nextState.origin_profile, message: msg }, nextState };
    }
  }

  const currentPool = poolsByName.get(profile);
  if (!currentPool || !currentPool.reading || !currentPool.reading.usable) {
    return { advice: null, nextState };
  }

  const r = currentPool.reading;
  const tight = r.pct >= TIGHT_THRESHOLD;
  const winRows = historyRows.filter((h) => h.alias === currentPool.alias && h.resets_at === r.resets_at);
  const burn = evaluateBurnRate(winRows, r.resets_at, nowMs);
  if (!tight && !(burn && burn.trigger)) {
    return { advice: null, nextState };
  }

  const target = pickBestTarget(allPools, profile);
  if (!target) {
    const msg = formatNoTargetMessage({ lane, from: profile, fromReading: r, burn });
    nextState.last_recommended_at_ms = nowMs;
    nextState.last_action = 'no_target';
    return { advice: { kind: 'no_target', lane, from: profile, to: null, message: msg }, nextState };
  }

  const msg = formatMoveOutMessage({ lane, from: profile, fromReading: r, burn, target });
  if (!nextState.origin_profile) {
    nextState.origin_profile = profile;
    nextState.origin_resets_at = r.resets_at;
  }
  nextState.target_profile = target.profile;
  nextState.last_recommended_at_ms = nowMs;
  nextState.last_action = 'move_out';
  return { advice: { kind: 'move_out', lane, from: profile, to: target.profile, message: msg }, nextState };
}

function advise(opts, deps) {
  const o = opts || {};
  const d = deps || {};
  const f = d.fs || fs;
  const nowMs = resolveNowMs(d.now);
  const home = d.home || os.homedir();
  const baseDir = o.baseDir || d.baseDir || process.env.AUTOPILOT_LANE_BASE_DIR || path.join(home, '.config', 'autopilot');
  const readingsFile = o.readingsFile || d.readingsFile || path.join(baseDir, 'quota-readings.jsonl');
  const stateFile = o.stateFile || d.stateFile || path.join(path.dirname(readingsFile), 'profile-switch-advice-state.json');
  const liveBase = o.liveDir || d.liveBase || resolveLiveDir({ warn: () => {} }).base;

  const lanes = discoverLanes(f, baseDir, d);
  const profiles = discoverProfiles(f, home, lanes, d);

  const allPools = [];
  const poolsByName = new Map();
  for (const profile of profiles) {
    const alias = (d.aliases && d.aliases[profile]) || claudeAccount(aliasEnv(home, profile));
    const reading = readPoolSevenDay(f, liveBase, alias, nowMs, d);
    const pool = { profile, alias, reading };
    allPools.push(pool);
    poolsByName.set(profile, pool);
    if (reading.usable) {
      appendReadingRow(f, readingsFile, {
        ts_ms: reading.written_at_ms,
        alias,
        profile,
        pct: reading.pct,
        resets_at: reading.resets_at,
      });
    }
  }

  const historyRows = readReadingsHistory(f, readingsFile);
  const state = loadState(f, stateFile);
  const advices = [];
  let stateDirty = false;

  for (const laneRec of lanes) {
    const prev = state.lanes[laneRec.lane];
    const { advice, nextState } = evaluateLane(laneRec, prev, poolsByName, allPools, historyRows, nowMs);
    if (JSON.stringify(prev || {}) !== JSON.stringify(nextState)) {
      state.lanes[laneRec.lane] = nextState;
      stateDirty = true;
    }
    if (advice) advices.push(advice);
  }

  return { advices, state, stateFile, stateDirty, readingsFile };
}

function main(argv, deps) {
  const d = deps || {};
  const f = d.fs || fs;
  const out = d.out || ((s) => process.stdout.write(`${s}\n`));
  const err = d.err || ((s) => process.stderr.write(`${s}\n`));
  const run = d.run || defaultRun;

  const opts = parse(argv || []);
  if (opts.help) { out(usage()); return 0; }
  if (opts.error) { err(opts.error); err(usage()); return 2; }

  const res = advise(opts, d);
  if (res.advices.length === 0) {
    if (res.stateDirty) saveState(f, res.stateFile, res.state);
    return 0;
  }

  if (opts.sendTo) {
    const env = { ...process.env };
    delete env.FLEET_FYI;
    const bin = fleetBin(d);
    for (const a of res.advices) {
      const r = run(bin, ['send', opts.sendTo, a.message], { encoding: 'utf8', env });
      if (!r || r.error || r.status !== 0) {
        err(`傳送建議至 ${opts.sendTo} 失敗（${(r && (r.stderr || (r.error && r.error.message))) || `exit ${r && r.status}`}）`);
        return 1;
      }
    }
    saveState(f, res.stateFile, res.state);
    return 0;
  }

  saveState(f, res.stateFile, res.state);
  out(res.advices.map((a) => a.message).join('\n\n'));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { advise, main, evaluateBurnRate, parse, taipei, switchCommand };
