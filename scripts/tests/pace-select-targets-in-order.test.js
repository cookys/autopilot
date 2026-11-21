#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { selectEngine } = require('../pace-select.js');

const NOW = new Date('2026-11-22T03:00:00Z');
const RESET_AT = '2026-11-22T08:00:00Z';

const BASE_POOLS = {
  agy: { key: 'agy', runner: 'agy', model: 'gemini-4-hydrogen-low', family: 'google' },
  minimax: { key: 'minimax', runner: 'minimax', model: 'minimax-m1', family: 'minimax' },
};

const BASE_ROLES = {
  PACE_CEILING_PCT: 85,
  implementer: ['agy', 'minimax'],
  reviewer: ['agy', 'minimax'],
  priority: {
    implementer: ['minimax', 'agy'],
    reviewer: ['minimax', 'agy'],
  },
};

function makeRow(pool, used_pct, expected_pct = 50, extra = {}) {
  return {
    pool,
    class: 'other',
    used_pct,
    expected_pct,
    reset_at: RESET_AT,
    seen_at: NOW.toISOString(),
    ...extra,
  };
}

test('picks agy from targets_in_order [agy, minimax] even when minimax has higher quota score', () => {
  const res = selectEngine({
    pace: {
      schema: 'capacity.pace/1',
      generated_at: NOW.toISOString(),
      burn_more: { targets_in_order: ['agy', 'minimax'] },
      rows: [makeRow('agy', 40), makeRow('minimax', 10)],
    },
    pools: BASE_POOLS,
    roles: BASE_ROLES,
    role: 'implementer',
    now: NOW,
  });
  assert.equal(res.engine, 'agy');
});

test('picks minimax when agy is unavailable (over ceiling)', () => {
  const res = selectEngine({
    pace: {
      schema: 'capacity.pace/1',
      generated_at: NOW.toISOString(),
      burn_more: { targets_in_order: ['agy', 'minimax'] },
      rows: [makeRow('agy', 90), makeRow('minimax', 20)],
    },
    pools: BASE_POOLS,
    roles: BASE_ROLES,
    role: 'implementer',
    now: NOW,
  });
  assert.equal(res.engine, 'minimax');
});

test('stale reading keeps the current quota-score order', () => {
  const res = selectEngine({
    pace: {
      schema: 'capacity.pace/1',
      generated_at: '2026-11-19T00:00:00Z',
      stale: true,
      burn_more: { targets_in_order: ['agy', 'minimax'] },
      rows: [makeRow('agy', 40), makeRow('minimax', 10)],
    },
    pools: BASE_POOLS,
    roles: BASE_ROLES,
    role: 'implementer',
    now: NOW,
  });
  assert.equal(res.engine, 'minimax');
});

test('missing targets_in_order keeps the current quota-score order', () => {
  const res = selectEngine({
    pace: {
      schema: 'capacity.pace/1',
      generated_at: NOW.toISOString(),
      rows: [makeRow('agy', 40), makeRow('minimax', 10)],
    },
    pools: BASE_POOLS,
    roles: BASE_ROLES,
    role: 'implementer',
    now: NOW,
  });
  assert.equal(res.engine, 'minimax');
});

test('agy at 60% used: mechanical dispatch goes to next engine, hetero dispatch still goes to agy', () => {
  const pace = {
    schema: 'capacity.pace/1',
    generated_at: NOW.toISOString(),
    burn_more: { targets_in_order: ['agy', 'minimax'], hetero_reserve_pct: 50 },
    rows: [makeRow('agy', 60), makeRow('minimax', 20)],
  };
  const mech = selectEngine({
    pace,
    pools: BASE_POOLS,
    roles: BASE_ROLES,
    role: 'implementer',
    scope: 'mechanical',
    now: NOW,
  });
  assert.equal(mech.engine, 'minimax');

  const hetero = selectEngine({
    pace,
    pools: BASE_POOLS,
    roles: BASE_ROLES,
    role: 'reviewer',
    now: NOW,
  });
  assert.equal(hetero.engine, 'agy');
});
