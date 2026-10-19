'use strict';
/*
# RED at 45b1c5fff: tsUtc is not exported (TypeError: tsUtc is not a function on every direct call; 9 fail / 8 reject-cases only threw because the export was missing) and buildV2Record does not throw on 2026-02-30 (returns null). exit 1.
*/
// Run: node --test scripts/qualification-record-v2.test.js
// tsUtc parity with the Python v2_record_from_row gate (owner rule; the Python regex was not on this host).
// Every case uses a temp HOME. This file does not touch ~/.autopilot.

const test = require('node:test').test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qv2-home-'));
process.env.HOME = home;

const { tsUtc, buildV2Record } = require('./lib/qualification-record-v2.js');

test('tsUtc accepts Z without a fraction', () => {
  assert.equal(tsUtc('2026-10-20T01:02:03Z'), '2026-10-20T01:02:03Z');
});

test('tsUtc accepts Z with a fraction', () => {
  assert.equal(tsUtc('2026-10-20T01:02:03.123456789Z'), '2026-10-20T01:02:03.123Z');
});

test('tsUtc converts a +05:30 offset to UTC', () => {
  assert.equal(tsUtc('2026-10-20T05:30:00+05:30'), '2026-10-20T00:00:00Z');
});

test('tsUtc accepts a date-only string as midnight UTC', () => {
  assert.equal(tsUtc('2026-10-20'), '2026-10-20T00:00:00Z');
});

test('tsUtc rejects 2026-02-30', () => {
  assert.throws(() => tsUtc('2026-02-30T00:00:00Z'), Error);
});

test('tsUtc accepts leap day 2024-02-29', () => {
  assert.equal(tsUtc('2024-02-29T00:00:00Z'), '2024-02-29T00:00:00Z');
});

test('tsUtc rejects 2026-02-29', () => {
  assert.throws(() => tsUtc('2026-02-29'), Error);
});

test('tsUtc rejects a missing offset', () => {
  assert.throws(() => tsUtc('2026-10-20T01:02:03'), Error);
});

test('tsUtc rejects an offset without a colon', () => {
  assert.throws(() => tsUtc('2026-10-20T01:02:03+0530'), Error);
});

test('tsUtc rejects a lower-case t', () => {
  assert.throws(() => tsUtc('2026-10-20t01:02:03Z'), Error);
});

test('tsUtc rejects a lower-case z', () => {
  assert.throws(() => tsUtc('2026-10-20T01:02:03z'), Error);
});

test('tsUtc rejects a space separator', () => {
  assert.throws(() => tsUtc('2026-10-20 01:02:03Z'), Error);
});

test('tsUtc rejects trailing garbage', () => {
  assert.throws(() => tsUtc('2026-10-20T01:02:03Z extra'), Error);
});

test('tsUtc returns null for a non-string', () => {
  assert.equal(tsUtc(null), null);
  assert.equal(tsUtc(undefined), null);
  assert.equal(tsUtc(0), null);
});

test('tsUtc strips a .000 fraction', () => {
  assert.equal(tsUtc('2026-10-20T01:02:03.000Z'), '2026-10-20T01:02:03Z');
});

test('tsUtc keeps a .500 fraction', () => {
  assert.equal(tsUtc('2026-10-20T01:02:03.500Z'), '2026-10-20T01:02:03.500Z');
});

test('buildV2Record throws when observed_at fails the tsUtc gate', () => {
  const row = {
    role: 'reviewer', model: 'm', model_version: '1', corpus_version: 'c', prompt_config_hash: 'h',
    evidence: { observed_at: '2026-02-30T00:00:00Z' },
    evidence_store: { producer: 'p', transcript_hash: 'a'.repeat(64) },
  };
  assert.throws(() => buildV2Record(row), Error);
});
