#!/usr/bin/env node
'use strict';
// local-reviewer-exclusion.js — operator via PM 01M7XHF4.
// When the implementer of the reviewed run was local/qwen, a reviewer seat in the
// same family (qwen, alibaba, qwen_local, cc-shim on qwen_local) is dropped.
// If that leaves no reviewer, the caller refuses with one line.

function norm(v) {
  return String(v || '').trim().toLowerCase();
}

function implementerIsLocalQwen(impl = {}) {
  const runner = norm(impl.runner);
  const endpoint = norm(impl.endpoint);
  const model = norm(impl.model || impl.engine);
  if (runner === 'local' || runner === 'qwen_local' || endpoint === 'qwen_local' || model === 'qwen_local') return true;
  if (model === 'qwen' && (runner === 'local' || runner === 'cc-shim' || runner === '')) return true;
  return false;
}

function reviewerSameAsLocalQwen(seat = {}) {
  const family = norm(seat.family);
  const runner = norm(seat.runner);
  const endpoint = norm(seat.endpoint);
  const model = norm(seat.model || seat.engine);
  if (family === 'alibaba' || family === 'qwen') return true;
  if (runner === 'qwen_local' || endpoint === 'qwen_local' || model === 'qwen_local') return true;
  if (runner === 'cc-shim' && (endpoint === 'qwen_local' || model === 'qwen' || model.startsWith('qwen'))) return true;
  return false;
}

function filterReviewers(seats, impl) {
  const list = Array.isArray(seats) ? seats : [];
  if (!implementerIsLocalQwen(impl)) return { seats: list.slice(), dropped: 0, empty: false };
  const kept = [];
  let dropped = 0;
  for (const seat of list) {
    if (reviewerSameAsLocalQwen(seat)) dropped += 1;
    else kept.push(seat);
  }
  return { seats: kept, dropped, empty: kept.length === 0 };
}

const REFUSAL = 'resolve-review: local qwen implementer left no reviewer from another family (01M7XHF4)';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : '';
}

function main() {
  const cmd = process.argv[2];
  const impl = { runner: arg('runner'), endpoint: arg('endpoint'), model: arg('model') };
  if (cmd === 'implementer-is-local') {
    process.exit(implementerIsLocalQwen(impl) ? 0 : 1);
  }
  if (cmd === 'seat-dropped') {
    const seat = { runner: arg('seat-runner'), endpoint: arg('seat-endpoint'), model: arg('seat-model'), family: arg('seat-family') };
    const drop = implementerIsLocalQwen(impl) && reviewerSameAsLocalQwen(seat);
    process.exit(drop ? 0 : 1);
  }
  if (cmd === 'refusal') {
    process.stdout.write(`${REFUSAL}\n`);
    return;
  }
  process.stderr.write('usage: local-reviewer-exclusion.js implementer-is-local|seat-dropped|refusal\n');
  process.exit(2);
}

if (require.main === module) main();

module.exports = {
  implementerIsLocalQwen,
  reviewerSameAsLocalQwen,
  filterReviewers,
  REFUSAL,
};
