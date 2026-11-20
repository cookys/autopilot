#!/usr/bin/env node
'use strict';

/**
 * CLI tests for scripts/verify-strength.js (wrapper over src/engine/verification-strength.js).
 * Run: node --test scripts/verify-strength.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(__dirname, 'verify-strength.js');
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-strength-test-'));

test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

function runCli(args, input) {
  const opts = {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '' },
    input,
  };
  return spawnSync(process.execPath, [CLI, ...args], opts);
}

function writeJson(name, value) {
  const file = path.join(TMP_ROOT, name);
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  return file;
}

test('--help exits 0 and prints usage', () => {
  const res = runCli(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /verify-strength\.js/);
  assert.match(res.stdout, /score --signals/);
});

test('score --signals: VALIDATED high metrics -> strong', () => {
  const signals = {
    red_green: 'VALIDATED',
    assertion_density: 0.5,
    changed_line_coverage: 0.8,
    mutation_survival: 0.8,
    oracle_present: true,
  };
  const file = writeJson('signals-strong.json', signals);
  const res = runCli(['score', '--signals', file]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.strength, 'strong');
  assert.equal(out.reason, 'scored');
  assert.ok(out.score >= 7);
});

test('score --signals: INCONCLUSIVE -> inconclusive', () => {
  const file = writeJson('signals-inc.json', { red_green: 'INCONCLUSIVE' });
  const res = runCli(['score', '--signals', file]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.strength, 'inconclusive');
  assert.match(out.reason, /INCONCLUSIVE/);
});

test('score --signals: NOT_RED_ON_BASE -> weak', () => {
  const file = writeJson('signals-nored.json', { red_green: 'NOT_RED_ON_BASE' });
  const res = runCli(['score', '--signals', file]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).strength, 'weak');
});

test('score reads JSON from stdin when --signals is omitted', () => {
  const payload = JSON.stringify({
    red_green: 'VALIDATED',
    assertion_density: 0.5,
    changed_line_coverage: 0.5,
  });
  const res = runCli(['score'], payload);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.strength, 'medium');
  assert.ok(out.score >= 4 && out.score < 7);
});

test('calibrate without --corpus exits 2', () => {
  const res = runCli(['calibrate']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--corpus required/);
});

test('calibrate: corpus smaller than 60 -> allow_strong_reduction false', () => {
  const file = writeJson('corpus-small.json', [{ strength: 'strong' }]);
  const res = runCli(['calibrate', '--corpus', file]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.allow_strong_reduction, false);
  assert.match(out.reason, /< 60/);
});

test('calibrate: { cases: [...] } wrapper is accepted', () => {
  const cases = Array.from({ length: 60 }, (_, i) => ({
    strength: i === 0 ? 'strong' : 'medium',
    escaped: false,
  }));
  const file = writeJson('corpus-wrap.json', { cases });
  const res = runCli(['calibrate', '--corpus', file]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.n, 60);
  assert.equal(out.strong_escapes, 0);
});

test('calibrate: strong-labelled escape blocks reduction', () => {
  const corpus = Array.from({ length: 60 }, (_, i) => ({
    strength: 'strong',
    escaped: i === 0,
  }));
  const file = writeJson('corpus-escape.json', corpus);
  const res = runCli(['calibrate', '--corpus', file]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.allow_strong_reduction, false);
  assert.match(out.reason, /escapes=/);
});

test('density-delta: weak -> delta_loops 1', () => {
  const res = runCli(['density-delta', '--strength', 'weak']);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.delta_loops, 1);
  assert.equal(out.effective_strength, 'weak');
  assert.equal(out.allow_reduction, false);
});

test('density-delta: medium -> delta_loops 0', () => {
  const res = runCli(['density-delta', '--strength', 'medium']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).delta_loops, 0);
});

test('density-delta: strong without calibration -> no reduction', () => {
  const res = runCli(['density-delta', '--strength', 'strong']);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.delta_loops, 0);
  assert.equal(out.allow_reduction, false);
});

test('density-delta: strong with allow_strong_reduction -> -1 loop', () => {
  const cal = writeJson('cal-allow.json', { allow_strong_reduction: true });
  const res = runCli(['density-delta', '--strength', 'strong', '--calibration', cal]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.delta_loops, -1);
  assert.equal(out.allow_reduction, true);
});

test('density-delta: unknown strength normalizes to weak', () => {
  const res = runCli(['density-delta', '--strength', 'not-a-level']);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.effective_strength, 'weak');
  assert.equal(out.delta_loops, 1);
});

test('unknown subcommand exits 2', () => {
  const res = runCli(['nope']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown command/);
});