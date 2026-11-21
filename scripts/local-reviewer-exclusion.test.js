'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const ex = require('./lib/local-reviewer-exclusion');

test('local qwen implementer drops same-family reviewers and refuses an empty panel', () => {
  const impl = { runner: 'local', model: 'qwen', endpoint: 'qwen_local' };
  const seats = [
    { runner: 'cc-shim', model: 'Qwen3.8-27B', endpoint: 'qwen_local', family: 'alibaba' },
    { runner: 'grok', model: 'grok-4.7', endpoint: '', family: 'xai' },
    { runner: 'cc-shim', model: 'qwen', endpoint: 'qwen_local', family: 'unknown' },
  ];
  const r = ex.filterReviewers(seats, impl);
  assert.equal(r.dropped, 2);
  assert.equal(r.seats.length, 1);
  assert.equal(r.seats[0].family, 'xai');
  const none = ex.filterReviewers(seats.slice(0, 1), impl);
  assert.equal(none.empty, true);
  assert.equal(ex.filterReviewers(seats, { runner: 'grok', model: 'grok-4.7' }).dropped, 0);
});

test('CLI refusal is one line when the panel would be empty', () => {
  const script = path.join(__dirname, 'lib', 'local-reviewer-exclusion.js');
  const local = spawnSync(process.execPath, [script, 'implementer-is-local', '--runner', 'cc-shim', '--model', 'qwen', '--endpoint', 'qwen_local'], { encoding: 'utf8' });
  assert.equal(local.status, 0);
  const drop = spawnSync(process.execPath, [script, 'seat-dropped', '--runner', 'local', '--model', 'qwen', '--endpoint', 'qwen_local', '--seat-runner', 'grok', '--seat-model', 'grok-4.7', '--seat-family', 'xai'], { encoding: 'utf8' });
  assert.equal(drop.status, 1);
  const same = spawnSync(process.execPath, [script, 'seat-dropped', '--runner', 'local', '--endpoint', 'qwen_local', '--seat-family', 'alibaba', '--seat-runner', 'cc-shim', '--seat-endpoint', 'qwen_local'], { encoding: 'utf8' });
  assert.equal(same.status, 0);
  const line = spawnSync(process.execPath, [script, 'refusal'], { encoding: 'utf8' });
  assert.equal(line.stdout.trim().split('\n').length, 1);
  assert.match(line.stdout, /01M7XHF4/);
});
