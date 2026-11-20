#!/usr/bin/env node
'use strict';

/**
 * Tests for scripts/status-events-bench.js (small --scale runs only; no real fleet/network).
 * Run: node --test scripts/status-events-bench.test.js < /dev/null
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BENCH = path.join(__dirname, 'status-events-bench.js');

function runBench(args = []) {
  return spawnSync(process.execPath, [BENCH, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });
}

test('usage error on unknown flag exits 2', () => {
  const res = runBench(['--not-real']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage: status-events-bench/);
});

test('invalid --scale token exits 2', () => {
  const res = runBench(['--scale', '0']);
  assert.equal(res.status, 2);
});

test('--scale 200 --json emits a report object (smoke, seconds)', () => {
  const res = runBench(['--scale', '200', '--json']);
  assert.ok(res.status === 0 || res.status === 1, `unexpected exit ${res.status}: ${res.stderr}`);
  const body = JSON.parse(res.stdout);
  assert.equal(body.scale, 200);
  assert.ok(body.counts && typeof body.counts.cost === 'number');
  assert.equal(typeof body.ok, 'boolean');
  assert.ok(Array.isArray(body.results));
  assert.equal(body.ok, res.status === 0);
});

test('negative control --fault no-review yields NOT MET (ok false, exit 1)', () => {
  const res = runBench(['--scale', '200', '--fault', 'no-review', '--json']);
  assert.equal(res.status, 1, res.stderr);
  const body = JSON.parse(res.stdout);
  assert.equal(body.ok, false);
  assert.ok(body.problems.length > 0);
});

test('negative control --fault rss-unit yields NOT MET (ok false, exit 1)', () => {
  const res = runBench(['--scale', '200', '--fault', 'rss-unit', '--json']);
  assert.equal(res.status, 1, res.stderr);
  const body = JSON.parse(res.stdout);
  assert.equal(body.ok, false);
  assert.ok(body.problems.some((p) => p.includes('RSS measurement not trustworthy')));
});