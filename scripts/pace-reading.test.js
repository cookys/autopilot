'use strict';

/**
 * Tests for scripts/lib/pace-reading.js — the shared freshness / finite-number
 * rules for capacity.pace/1 rows.
 * Run: node --test scripts/pace-reading.test.js
 *
 * Pure logic module: no fs, no env. The kimi freshness window is anchored at a
 * fixed `now` so the cases are deterministic.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PACE_SCHEMA,
  ALERT_BEHIND_STATUS,
  BEHIND_EARLY_STATUS,
  WARN_AHEAD_STATUS,
  BEHIND_PACE_STATUSES,
  SEEN_AT_FRESH_MS,
  finiteNum,
  isBehindPaceStatus,
  isAheadPaceStatus,
  isFreshRow,
  isSeenAtFresh,
  isFreshRowForKey,
  freshReading,
  isBehindPaceRow,
  rowRemaining,
} = require('./lib/pace-reading.js');

const NOW = new Date('2026-11-20T12:00:00.000Z');
const isoHoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

const FRESH_ROW = { pool: 'agy', stale: false, used_pct: 26, expected_pct: 40, hours_to_reset: 12 };

test('constants: schema, statuses, window and frozen status list', () => {
  assert.equal(PACE_SCHEMA, 'capacity.pace/1');
  assert.equal(ALERT_BEHIND_STATUS, 'ALERT_behind');
  assert.equal(BEHIND_EARLY_STATUS, 'behind_early');
  assert.equal(WARN_AHEAD_STATUS, 'WARN_ahead');
  assert.deepEqual(BEHIND_PACE_STATUSES, ['ALERT_behind', 'behind_early']);
  assert.equal(Object.isFrozen(BEHIND_PACE_STATUSES), true);
  assert.equal(SEEN_AT_FRESH_MS, 24 * 3600 * 1000);
});

test('finiteNum: finite JSON numbers only; null is never coerced to 0', () => {
  assert.equal(finiteNum(0), 0);
  assert.equal(finiteNum(-3.5), -3.5);
  assert.equal(finiteNum(null), null);
  assert.equal(finiteNum(undefined), null);
  assert.equal(finiteNum('10'), null);
  assert.equal(finiteNum(Number.NaN), null);
  assert.equal(finiteNum(Number.POSITIVE_INFINITY), null);
});

test('isBehindPaceStatus / isAheadPaceStatus: exact matches only', () => {
  assert.equal(isBehindPaceStatus('ALERT_behind'), true);
  assert.equal(isBehindPaceStatus('behind_early'), true);
  assert.equal(isBehindPaceStatus('WARN_ahead'), false);
  assert.equal(isBehindPaceStatus('ok'), false);
  assert.equal(isBehindPaceStatus(undefined), false);
  assert.equal(isAheadPaceStatus('WARN_ahead'), true);
  assert.equal(isAheadPaceStatus('ALERT_behind'), false);
  assert.equal(isAheadPaceStatus('warn_ahead'), false); // case-sensitive
});

test('isFreshRow: plain object, non-empty pool, stale === false', () => {
  assert.equal(isFreshRow(FRESH_ROW), true);
  for (const bad of [
    null,
    undefined,
    [],
    'agy',
    {},
    { pool: '', stale: false },
    { pool: 'agy' }, // missing stale is unknown, not fresh
    { pool: 'agy', stale: true },
    { pool: 'agy', stale: null },
    { pool: 'agy', stale: 'false' }, // string is not === false
  ]) {
    assert.equal(isFreshRow(bad), false, `expected not fresh: ${JSON.stringify(bad)}`);
  }
});

test('isSeenAtFresh: seen_at within [now - maxAgeMs, now], inclusive', () => {
  const row = (seen_at) => ({ pool: 'kimi', seen_at });
  assert.equal(isSeenAtFresh(row(isoHoursAgo(1)), NOW), true);
  assert.equal(isSeenAtFresh(row(isoHoursAgo(24)), NOW), true); // inclusive boundary
  assert.equal(isSeenAtFresh(row(isoHoursAgo(24) - 1), NOW), false); // 24h + 1ms
  assert.equal(isSeenAtFresh(row(NOW.toISOString()), NOW), true); // age 0
  assert.equal(isSeenAtFresh(row(new Date(NOW.getTime() + 1000).toISOString()), NOW), false); // future
  assert.equal(isSeenAtFresh(row('not a date'), NOW), false);
  assert.equal(isSeenAtFresh(row(''), NOW), false);
  assert.equal(isSeenAtFresh(row(null), NOW), false);
  assert.equal(isSeenAtFresh({ seen_at: isoHoursAgo(1) }, NOW), false); // pool required
  assert.equal(isSeenAtFresh({ pool: '', seen_at: isoHoursAgo(1) }, NOW), false);
  assert.equal(isSeenAtFresh([], NOW), false);
  assert.equal(isSeenAtFresh(row(isoHoursAgo(1)), Number.NaN), false); // non-finite now
  // now may be a number of ms, and maxAgeMs is configurable.
  assert.equal(isSeenAtFresh(row(isoHoursAgo(2)), NOW.getTime()), true);
  assert.equal(isSeenAtFresh(row(isoHoursAgo(2)), NOW.getTime(), 3600 * 1000), false);
});

test('isFreshRowForKey: kimi judges by seen_at; every other key uses the stale flag', () => {
  const staleFlagFresh = { pool: 'kimi', stale: false };
  const seenAtFresh = { pool: 'kimi', stale: true, seen_at: isoHoursAgo(1) };
  const seenAtStale = { pool: 'kimi', stale: false, seen_at: isoHoursAgo(48) };

  assert.equal(isFreshRowForKey(seenAtFresh, 'kimi', NOW), true); // stale flag ignored for kimi
  assert.equal(isFreshRowForKey(seenAtStale, 'kimi', NOW), false); // stale flag ignored for kimi
  assert.equal(isFreshRowForKey(staleFlagFresh, 'kimi', NOW), false); // seen_at required for kimi
  assert.equal(isFreshRowForKey(seenAtFresh, 'grok', NOW), false); // other keys: stale === false wins
  assert.equal(isFreshRowForKey(staleFlagFresh, 'grok', NOW), true);
});

test('freshReading: slack reading for fresh finite rows, null when unknown', () => {
  assert.deepEqual(freshReading(FRESH_ROW), {
    pool: 'agy',
    used_pct: 26,
    expected_pct: 40,
    slack: 14,
    hours_to_reset: 12,
  });
  // Explicit numeric 0 is a real reading, distinct from null/missing.
  assert.deepEqual(
    freshReading({ pool: 'glm', stale: false, used_pct: 0, expected_pct: 0, hours_to_reset: 0 }),
    { pool: 'glm', used_pct: 0, expected_pct: 0, slack: 0, hours_to_reset: 0 },
  );
  // Missing hours_to_reset is unknown (null), never 0.
  assert.equal(
    freshReading({ pool: 'glm', stale: false, used_pct: 10, expected_pct: 25 }).hours_to_reset,
    null,
  );
  for (const bad of [
    null,
    { pool: 'agy', stale: true, used_pct: 10, expected_pct: 20 },
    { pool: 'agy', stale: false, used_pct: null, expected_pct: 20 },
    { pool: 'agy', stale: false, used_pct: 10 },
    { pool: 'agy', stale: false, used_pct: '10', expected_pct: 20 },
    { pool: 'agy', stale: false, used_pct: 10, expected_pct: Number.NaN },
  ]) {
    assert.equal(freshReading(bad), null, `expected null: ${JSON.stringify(bad)}`);
  }
});

test('freshReading: opts.key=kimi reads freshness by seen_at within the window', () => {
  const row = { pool: 'kimi', stale: true, seen_at: isoHoursAgo(1), used_pct: 10, expected_pct: 30 };
  assert.deepEqual(freshReading(row, { key: 'kimi', now: NOW }), {
    pool: 'kimi',
    used_pct: 10,
    expected_pct: 30,
    slack: 20,
    hours_to_reset: null,
  });
  // A stale-flag-fresh kimi row with an old seen_at is still unknown.
  assert.equal(
    freshReading(
      { pool: 'kimi', stale: false, seen_at: isoHoursAgo(48), used_pct: 10, expected_pct: 30 },
      { key: 'kimi', now: NOW },
    ),
    null,
  );
  // opts without key falls back to the stale-flag rule.
  assert.equal(freshReading(FRESH_ROW, { now: NOW }).slack, 14);
});

test('isBehindPaceRow: fresh finite reading AND behind status', () => {
  const behind = { ...FRESH_ROW, status: 'ALERT_behind' };
  const behindEarly = { ...FRESH_ROW, status: 'behind_early' };
  assert.equal(isBehindPaceRow(behind), true);
  assert.equal(isBehindPaceRow(behindEarly), true);
  assert.equal(isBehindPaceRow({ ...FRESH_ROW, status: 'ok' }), false);
  assert.equal(isBehindPaceRow({ ...FRESH_ROW, status: 'WARN_ahead' }), false);
  // Freshness still gates the status: a stale behind row is not behind.
  assert.equal(isBehindPaceRow({ ...behind, stale: true }), false);
  assert.equal(isBehindPaceRow({ ...behind, used_pct: null }), false);
});

test('rowRemaining: 100 - used_pct, or waste_pct_if_unused on ALERT_behind rows', () => {
  assert.equal(rowRemaining(FRESH_ROW), 74);
  assert.equal(rowRemaining({ ...FRESH_ROW, used_pct: 0 }), 100);
  // used_pct unknown: only an ALERT_behind row may fall back to waste_pct_if_unused.
  const alertRow = { pool: 'grok-cli', stale: false, used_pct: null, waste_pct_if_unused: 12, status: 'ALERT_behind' };
  assert.equal(rowRemaining(alertRow, 'ALERT_behind'), 12);
  assert.equal(rowRemaining(alertRow, 'behind_early'), null);
  assert.equal(rowRemaining({ ...alertRow, status: 'ok' }, 'ok'), null);
  assert.equal(rowRemaining({ ...alertRow, stale: true }, 'ALERT_behind'), null);
  // Non-finite waste falls back to null, never NaN.
  assert.equal(rowRemaining({ ...alertRow, waste_pct_if_unused: Number.NaN }, 'ALERT_behind'), null);
});
