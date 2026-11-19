'use strict';

/**
 * broker-run-pace.js — behind-pace signal for cursor and kimi implementers.
 *
 * 1. Real reading wins: when capacity.pace/1 has a fresh row with finite
 *    used_pct and expected_pct for the engine's pool (for kimi, reading
 *    freshness is judged by row seen_at within 24 h, never by reset_at or
 *    file mtime), `basis = "pace"` and `behind` is true iff status is
 *    `ALERT_behind` or `behind_early` (`isBehindPaceRow` from pace-reading.js).
 * 2. Daily-run proxy fallback: otherwise count today's completed runs (in the
 *    Asia/Taipei calendar day) from the published read-only broker audit TSV
 *    (`/srv/<runner>-broker/audit.tsv`, configured in pace-roles.json
 *    `broker_audit` and overridable via AUTOPILOT_CURSOR_BROKER_AUDIT /
 *    AUTOPILOT_KIMI_BROKER_AUDIT). `expected_runs = daily_target * elapsed_day`
 *    and `behind = runs_today < expected_runs` (`basis = "proxy_runs"`).
 *    This proxy measures runs per day, not quota percent, and is retired
 *    automatically whenever a fresh pace reading exists.
 * 3. `behind` is strictly a yes/no preference — never scaled or boosted
 *    proportionally by how many points or runs behind a pool is.
 * 4. Missing, unreadable, or headerless audit files return `basis = "none"`
 *    with `behind = false` and never throw.
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const path = require('path');
const { finiteNum, freshReading, isBehindPaceRow } = require('./pace-reading.js');

const BEHIND_PACE_KEYS = new Set(['cursor', 'kimi']);
const PROXY_NOTE = 'runs per day, not quota percent';
const TAIPEI_TZ = 'Asia/Taipei';
const DAY_MS = 86_400_000;

const DEFAULT_DAILY_RUN_TARGETS = Object.freeze({
  cursor: 15,
  kimi: 12,
});

const DEFAULT_BROKER_AUDIT = Object.freeze({
  cursor: '/srv/cursor-broker/audit.tsv',
  kimi: '/srv/kimi-broker/audit.tsv',
});

const AUDIT_ENV_KEYS = Object.freeze({
  cursor: 'AUTOPILOT_CURSOR_BROKER_AUDIT',
  kimi: 'AUTOPILOT_KIMI_BROKER_AUDIT',
});

const TS_HEADER_NAMES = Object.freeze([
  'finished_at',
  'completed_at',
  'ended_at',
  'ts',
  'timestamp',
  'started_at',
  'created_at',
  'time',
  'at',
]);

const TAIPEI_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TAIPEI_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TAIPEI_CLOCK_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TAIPEI_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function taipeiDateOfMs(ms) {
  const parts = TAIPEI_DATE_FMT.formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month').padStart(2, '0')}-${get('day').padStart(2, '0')}`;
}

function taipeiDayProgress(now) {
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const parts = TAIPEI_CLOCK_FMT.formatToParts(clock);
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  const date = `${get('year')}-${get('month').padStart(2, '0')}-${get('day').padStart(2, '0')}`;
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const elapsedMs = (((hour * 3600) + (minute * 60) + second) * 1000) + clock.getMilliseconds();
  return {
    date,
    fraction: elapsedMs / DAY_MS,
    nowMs: clock.getTime(),
  };
}

function parseAuditTimestampMs(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return NaN;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const num = Number(text);
    if (!Number.isFinite(num)) return NaN;
    return num < 1e11 ? num * 1000 : num;
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) {
    return Date.parse(`${text.replace(' ', 'T')}+08:00`);
  }
  return Date.parse(text);
}

function resolveAuditPath(key, { roles, env = process.env, expandHome } = {}) {
  const envName = AUDIT_ENV_KEYS[key];
  const envRaw = envName && env && typeof env[envName] === 'string' ? env[envName].trim() : '';
  const cfgRaw = (
    roles
    && roles.broker_audit
    && typeof roles.broker_audit === 'object'
    && !Array.isArray(roles.broker_audit)
    && typeof roles.broker_audit[key] === 'string'
  )
    ? roles.broker_audit[key].trim()
    : '';
  const raw = envRaw || cfgRaw || DEFAULT_BROKER_AUDIT[key] || '';
  if (!raw) return null;
  try {
    const expanded = typeof expandHome === 'function' ? expandHome(raw, env) : raw;
    return path.resolve(expanded);
  } catch {
    return null;
  }
}

function resolveDailyTarget(key, roles) {
  if (
    roles
    && roles.daily_run_targets
    && typeof roles.daily_run_targets === 'object'
    && !Array.isArray(roles.daily_run_targets)
    && Object.prototype.hasOwnProperty.call(roles.daily_run_targets, key)
  ) {
    const configured = finiteNum(roles.daily_run_targets[key]);
    return configured !== null && configured > 0 ? configured : null;
  }
  const fallback = finiteNum(DEFAULT_DAILY_RUN_TARGETS[key]);
  return fallback !== null && fallback > 0 ? fallback : null;
}

function firstColIndex(cols, names) {
  for (const name of names) {
    const idx = cols.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

function countCompletedRunsToday(auditPath, { key, todayTaipei, nowMs } = {}) {
  if (typeof auditPath !== 'string' || auditPath === '') return { ok: false };
  let text;
  try {
    text = fs.readFileSync(auditPath, 'utf8');
  } catch {
    return { ok: false };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    headerIndex = i;
    break;
  }
  if (headerIndex < 0) return { ok: false };

  const cols = lines[headerIndex].split('\t').map((c) => c.trim().toLowerCase());
  const tsIdx = firstColIndex(cols, TS_HEADER_NAMES);
  if (tsIdx < 0) return { ok: false };

  const verdictIdx = firstColIndex(cols, ['verdict', 'outcome', 'result']);
  const statusIdx = firstColIndex(cols, ['status', 'state']);
  const okIdx = cols.indexOf('ok');
  const rcIdx = firstColIndex(cols, ['rc', 'exit_code', 'exit']);
  const runnerIdx = firstColIndex(cols, ['runner', 'engine', 'pool']);

  let runsToday = 0;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const cells = rawLine.split('\t');

    if (runnerIdx >= 0) {
      const rowRunner = (cells[runnerIdx] || '').trim().toLowerCase();
      if (rowRunner && key && rowRunner !== key && !rowRunner.startsWith(key)) continue;
    }

    if (verdictIdx >= 0) {
      const verdict = (cells[verdictIdx] || '').trim().toLowerCase();
      if (!['done', 'ok', 'completed', 'success'].includes(verdict)) continue;
    } else if (statusIdx >= 0) {
      const status = (cells[statusIdx] || '').trim().toLowerCase();
      if (!['done', 'ok', 'completed', 'success', 'committed'].includes(status)) continue;
    } else if (okIdx >= 0) {
      const okVal = (cells[okIdx] || '').trim().toLowerCase();
      if (!['true', '1', 'yes', 'ok'].includes(okVal)) continue;
    } else if (rcIdx >= 0) {
      const rcVal = (cells[rcIdx] || '').trim();
      if (rcVal !== '0') continue;
    }

    const ms = parseAuditTimestampMs(cells[tsIdx]);
    if (!Number.isFinite(ms)) continue;
    if (Number.isFinite(nowMs) && ms > nowMs) continue;
    if (taipeiDateOfMs(ms) === todayTaipei) {
      runsToday += 1;
    }
  }
  return { ok: true, runs_today: runsToday };
}

function freshScore(fr) {
  if (fr.hours_to_reset === null) return -Infinity;
  return (100 - fr.used_pct) / Math.max(fr.hours_to_reset, 1);
}

function evaluateBehindSignal({
  key,
  paceRows,
  poolNames,
  ceiling = 85,
  roles,
  now,
  env = process.env,
  expandHome,
} = {}) {
  try {
    if (!BEHIND_PACE_KEYS.has(key)) {
      return { basis: 'none', behind: false, fields: {} };
    }

    const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    let bestRow = null;
    let bestFr = null;
    let bestUnderCeiling = false;
    if (Array.isArray(paceRows) && poolNames instanceof Set && poolNames.size > 0) {
      for (const row of paceRows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        if (row.class === 'claude') continue;
        const poolName = typeof row.pool === 'string' ? row.pool : '';
        if (!poolNames.has(poolName)) continue;
        const fr = freshReading(row, { key, now: clock });
        if (!fr) continue;
        const underCeiling = fr.used_pct < ceiling;
        if (
          !bestFr
          || (underCeiling && !bestUnderCeiling)
          || (underCeiling === bestUnderCeiling && (
            freshScore(fr) > freshScore(bestFr)
            || (freshScore(fr) === freshScore(bestFr) && fr.slack > bestFr.slack)
          ))
        ) {
          bestRow = row;
          bestFr = fr;
          bestUnderCeiling = underCeiling;
        }
      }
    }

    if (bestRow && bestFr) {
      const behind = bestUnderCeiling && isBehindPaceRow(bestRow, { key, now: clock });
      return {
        basis: 'pace',
        behind,
        freshReading: bestFr,
        freshRow: bestRow,
        fields: { basis: 'pace' },
      };
    }

    const dailyTarget = resolveDailyTarget(key, roles);
    if (dailyTarget === null) {
      return { basis: 'none', behind: false, fields: { basis: 'none' } };
    }
    const auditPath = resolveAuditPath(key, { roles, env, expandHome });
    const dayInfo = taipeiDayProgress(clock);
    const counted = countCompletedRunsToday(auditPath, {
      key,
      todayTaipei: dayInfo.date,
      nowMs: dayInfo.nowMs,
    });
    if (!counted.ok) {
      return { basis: 'none', behind: false, fields: { basis: 'none' } };
    }

    const runsToday = counted.runs_today;
    const expectedRuns = dailyTarget * dayInfo.fraction;
    const behind = runsToday < expectedRuns;
    const fields = {
      basis: 'proxy_runs',
      runs_today: runsToday,
      daily_target: dailyTarget,
      expected_runs: expectedRuns,
      note: PROXY_NOTE,
    };
    return {
      basis: 'proxy_runs',
      behind,
      runs_today: runsToday,
      daily_target: dailyTarget,
      expected_runs: expectedRuns,
      note: PROXY_NOTE,
      fields,
    };
  } catch {
    return { basis: 'none', behind: false, fields: { basis: 'none' } };
  }
}

module.exports = {
  BEHIND_PACE_KEYS,
  PROXY_NOTE,
  DEFAULT_DAILY_RUN_TARGETS,
  DEFAULT_BROKER_AUDIT,
  AUDIT_ENV_KEYS,
  taipeiDateOfMs,
  taipeiDayProgress,
  parseAuditTimestampMs,
  resolveAuditPath,
  resolveDailyTarget,
  countCompletedRunsToday,
  evaluateBehindSignal,
};
