'use strict';

/**
 * pace-reading.js — shared freshness and finite-number rules for capacity.pace/1 rows.
 *
 * Shared by scripts/noncq.js and scripts/pace-select.js so "fresh vs unknown"
 * has a single definition:
 *   - Default: only `stale === false` is fresh (missing, null, or true is unknown).
 *   - For `kimi`: reading freshness is judged by `seen_at` within the last 24 h
 *     (`0 <= now - Date.parse(seen_at) <= 24 h`), never by `reset_at` or file mtime.
 *   - Only finite JSON numbers count; missing or null fields are unknown, never 0.
 *   - A fresh row counts as behind pace when `status` is `ALERT_behind` or `behind_early`
 *     (any other status is not behind).
 *
 * Node >= 20.10, built-ins only.
 */

const PACE_SCHEMA = 'capacity.pace/1';
const ALERT_BEHIND_STATUS = 'ALERT_behind';
const BEHIND_EARLY_STATUS = 'behind_early';
const BEHIND_PACE_STATUSES = Object.freeze([ALERT_BEHIND_STATUS, BEHIND_EARLY_STATUS]);
const SEEN_AT_FRESH_MS = 24 * 3600 * 1000;

/** A finite JSON number, or null when missing/null/non-finite. Never coerces null to 0. */
function finiteNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** True only when status is ALERT_behind or behind_early. */
function isBehindPaceStatus(status) {
  return status === ALERT_BEHIND_STATUS || status === BEHIND_EARLY_STATUS;
}

/** True only when row is a plain object with a non-empty pool name and stale === false. */
function isFreshRow(row) {
  return Boolean(
    row
    && typeof row === 'object'
    && !Array.isArray(row)
    && typeof row.pool === 'string'
    && row.pool.length > 0
    && row.stale === false,
  );
}

/**
 * True only when row is a plain object with a non-empty pool name and a valid
 * `seen_at` timestamp in `[now - maxAgeMs, now]` (inclusive).
 */
function isSeenAtFresh(row, now = new Date(), maxAgeMs = SEEN_AT_FRESH_MS) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  if (typeof row.pool !== 'string' || row.pool.length === 0) return false;
  if (typeof row.seen_at !== 'string' || row.seen_at.trim() === '') return false;
  const seenMs = Date.parse(row.seen_at.trim());
  if (!Number.isFinite(seenMs)) return false;
  const nowMs = now instanceof Date
    ? now.getTime()
    : (now === undefined || now === null ? Date.now() : Number(now));
  if (!Number.isFinite(nowMs)) return false;
  const ageMs = nowMs - seenMs;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

/**
 * Freshness of a row for a given engine key:
 *   - `kimi`: judged by `seen_at` (within 24 h), not reset_at, stale flag, or file mtime.
 *   - all other keys: `isFreshRow(row)` (`stale === false`).
 */
function isFreshRowForKey(row, key, now = new Date()) {
  if (key === 'kimi') return isSeenAtFresh(row, now);
  return isFreshRow(row);
}

/**
 * Fresh linear-pace reading for one capacity.pace/1 row, or null when unknown.
 * Missing/null used_pct or expected_pct, or a non-fresh row, returns null.
 */
function freshReading(row, opts) {
  const fresh = opts && typeof opts === 'object' && opts.key !== undefined
    ? isFreshRowForKey(row, opts.key, opts.now)
    : isFreshRow(row);
  if (!fresh) return null;
  const used_pct = finiteNum(row.used_pct);
  const expected_pct = finiteNum(row.expected_pct);
  if (used_pct === null || expected_pct === null) return null;
  return {
    pool: row.pool,
    used_pct,
    expected_pct,
    slack: expected_pct - used_pct,
    hours_to_reset: finiteNum(row.hours_to_reset),
  };
}

/**
 * True when row has a fresh finite reading and its capacity.pace/1 status is
 * ALERT_behind or behind_early. Any other status is not behind.
 */
function isBehindPaceRow(row, opts) {
  return freshReading(row, opts) !== null && isBehindPaceStatus(row.status);
}

/**
 * Remaining quota points on a fresh pace row (noncq drain), or null when unknown.
 * used_pct is percent-used; waste_pct_if_unused is populated on ALERT_behind rows.
 */
function rowRemaining(row, status) {
  if (!isFreshRow(row)) return null;
  const used = finiteNum(row.used_pct);
  if (used !== null) return 100 - used;
  if (status === ALERT_BEHIND_STATUS) return finiteNum(row.waste_pct_if_unused);
  return null;
}

module.exports = {
  PACE_SCHEMA,
  ALERT_BEHIND_STATUS,
  BEHIND_EARLY_STATUS,
  BEHIND_PACE_STATUSES,
  SEEN_AT_FRESH_MS,
  finiteNum,
  isBehindPaceStatus,
  isFreshRow,
  isSeenAtFresh,
  isFreshRowForKey,
  freshReading,
  isBehindPaceRow,
  rowRemaining,
};
