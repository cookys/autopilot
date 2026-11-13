'use strict';

/**
 * pace-reading.js — shared freshness and finite-number rules for capacity.pace/1 rows.
 *
 * Shared by scripts/noncq.js and scripts/pace-select.js so "fresh vs unknown"
 * has a single definition:
 *   - Only `stale === false` is fresh (missing, null, or true is unknown).
 *   - Only finite JSON numbers count; missing or null fields are unknown, never 0.
 *
 * Node >= 20.10, built-ins only.
 */

const PACE_SCHEMA = 'capacity.pace/1';

/** A finite JSON number, or null when missing/null/non-finite. Never coerces null to 0. */
function finiteNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
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
 * Fresh linear-pace reading for one capacity.pace/1 row, or null when unknown.
 * Missing/null used_pct or expected_pct, or stale !== false, returns null.
 */
function freshReading(row) {
  if (!isFreshRow(row)) return null;
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
 * Remaining quota points on a fresh pace row (noncq drain), or null when unknown.
 * used_pct is percent-used; waste_pct_if_unused is populated on ALERT_behind rows.
 */
function rowRemaining(row, status) {
  if (!isFreshRow(row)) return null;
  const used = finiteNum(row.used_pct);
  if (used !== null) return 100 - used;
  if (status === 'ALERT_behind') return finiteNum(row.waste_pct_if_unused);
  return null;
}

module.exports = {
  PACE_SCHEMA,
  finiteNum,
  isFreshRow,
  freshReading,
  rowRemaining,
};
