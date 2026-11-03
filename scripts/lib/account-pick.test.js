'use strict';
// Tests for account-pick.js (N10, N14 pick half, N15). Run: node --test scripts/lib/account-pick.test.js
const test = require('node:test');
const assert = require('node:assert');
const { pick } = require('./account-pick');

const NOW = 1_800_000_000_000;
const S = (pct7, pct5, over) => Object.assign({
  schema: 'codeforge.quota/1', alias: 'x', root: null, written_at_ms: NOW - 1000,
  five_hour: pct5 === null ? null : { pct: pct5, resets_at: NOW / 1000 + 3600 },
  seven_day: pct7 === null ? null : { pct: pct7, resets_at: NOW / 1000 + 86400 },
}, over || {});
const snapFor = (alias, s) => Object.assign({}, s, { alias });
const A = (alias, priority) => ({ alias, priority });

test('N10: tight excluded when an ok exists; ok by used ascending', () => {
  const r = pick({
    accounts: [A('a', 1), A('b', 2), A('c', 3)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.95, 0.1)), b: snapFor('b', S(0.5, 0.5)), c: snapFor('c', S(0.2, 0.3)) },
  });
  assert.strictEqual(r.choice.alias, 'c');
  assert.strictEqual(r.choice.class, 'ok');
});

test('N10: unknown comes after ok, before tight', () => {
  const r = pick({ accounts: [A('a', 1), A('b', 2), A('c', 3)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.95, 0.1)), c: snapFor('c', S(0.7, 0.1)) } });
  assert.strictEqual(r.choice.alias, 'c');
  const r2 = pick({ accounts: [A('a', 1), A('b', 2)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.95, 0.1)) } });
  assert.strictEqual(r2.choice.alias, 'b');
  assert.strictEqual(r2.choice.class, 'unknown');
  assert.strictEqual(r2.choice.source, 'none');
});

test('N10: unknown ordered by priority; ties by priority then alias', () => {
  const r = pick({ accounts: [A('z', 5), A('y', 1), A('x', 5)], nowMs: NOW, snapshots: {} });
  assert.strictEqual(r.choice.alias, 'y');
  const t = pick({ accounts: [A('b', 1), A('a', 1)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.3, 0.3)), b: snapFor('b', S(0.3, 0.3)) } });
  assert.strictEqual(t.choice.alias, 'a');
  const t2 = pick({ accounts: [A('b', 1), A('a', 2)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.3, 0.3)), b: snapFor('b', S(0.3, 0.3)) } });
  assert.strictEqual(t2.choice.alias, 'b');
});

test('N10: stale snapshot is unknown, expired window ignored, root mismatch ignored', () => {
  const stale = snapFor('a', S(0.1, 0.1, { written_at_ms: NOW - 7 * 3600e3 }));
  const r = pick({ accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: stale } });
  assert.strictEqual(r.choice.class, 'unknown');
  const expired = snapFor('a', S(0.2, 0.99, { five_hour: { pct: 0.99, resets_at: NOW / 1000 - 1 } }));
  const r2 = pick({ accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: expired } });
  assert.strictEqual(r2.choice.class, 'ok');
  assert.strictEqual(r2.choice.used, 0.2);
  const mis = snapFor('a', S(0.1, 0.1, { root: 'deadbeef' }));
  const r3 = pick({ accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: mis }, roots: { a: 'cafef00d' } });
  assert.strictEqual(r3.choice.class, 'unknown');
  assert.deepStrictEqual(r3.notes, [{ alias: 'a', note: 'snapshot_root_mismatch' }]);
});

test('N10: exactly 0.90 is tight (boundary), 0.8999 is ok', () => {
  const at = pick({ accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.9, 0.1)) } });
  assert.strictEqual(at.choice.class, 'tight');
  const below = pick({ accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.8999, 0.1)) } });
  assert.strictEqual(below.choice.class, 'ok');
  // either window at 0.90 is enough
  const fh = pick({ accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.1, 0.9)) } });
  assert.strictEqual(fh.choice.class, 'tight');
});

test('N14: all tight, refuse_all_tight false picks least tight with all_tight', () => {
  const snaps = { a: snapFor('a', S(0.97, 0.1)), b: snapFor('b', S(0.92, 0.1)) };
  const r = pick({ accounts: [A('a', 1), A('b', 2)], nowMs: NOW, snapshots: snaps, refuseAllTight: false });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.choice.alias, 'b');
  assert.strictEqual(r.outcome, 'all_tight');
});

test('N14: refuse_all_tight true fails closed with exit 3', () => {
  const snaps = { a: snapFor('a', S(0.95, 0.1)), b: snapFor('b', S(0.95, 0.1)) };
  const r = pick({ accounts: [A('a', 1), A('b', 2)], nowMs: NOW, snapshots: snaps, refuseAllTight: true });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.exit, 3);
  assert.strictEqual(r.code, 'all_tight_refused');
  // the knob never blocks a non-tight pick
  const okr = pick({ accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.1, 0.1)) }, refuseAllTight: true });
  assert.strictEqual(okr.ok, true);
});

test('N15: unsupported schema is unknown, noted, no crash', () => {
  const bad = snapFor('a', S(0.99, 0.99, { schema: 'codeforge.quota/9' }));
  const r = pick({ accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: bad } });
  assert.strictEqual(r.choice.class, 'unknown');
  assert.deepStrictEqual(r.notes, [{ alias: 'a', note: 'quota_schema_unsupported' }]);
});

test('exclude and cooldown drop with capacity reasons; nothing left is exit 3', () => {
  const r = pick({ accounts: [A('a', 1), A('b', 2)], nowMs: NOW, exclude: ['a'], cooldowns: { b: NOW + 1 } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.exit, 3);
  assert.strictEqual(r.code, 'no_account_available');
  assert.deepStrictEqual(r.dropped, [{ alias: 'a', reason: 'excluded' }, { alias: 'b', reason: 'cooldown' }]);
  assert.strictEqual(pick({ accounts: [], nowMs: NOW }).ok, false);
});

test('purity: inputs are not mutated, same input same output', () => {
  const input = { accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.1, 0.1)) }, exclude: [] };
  const copy = JSON.parse(JSON.stringify(input));
  const r1 = pick(input);
  const r2 = pick(input);
  assert.deepStrictEqual(input, copy);
  assert.deepStrictEqual(r1, r2);
});

test('nowMs is required: missing or non-finite throws (never fails open on cooldowns)', () => {
  assert.throws(() => pick({ accounts: [A('a', 1)], cooldowns: { a: NOW + 1 } }), TypeError);
  assert.throws(() => pick({ accounts: [A('a', 1)], nowMs: NaN }), TypeError);
  assert.throws(() => pick({ accounts: [A('a', 1)], nowMs: '5' }), TypeError);
});
