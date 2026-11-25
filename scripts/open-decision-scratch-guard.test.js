'use strict';
// A card opened from a scratch/temp repo is refused unless the run is sandboxed (AUTOPILOT_CARD_NOTIFY=off) or explicitly allowed.
// Why: the courier publishes any repo's ledger to the real hub, and a deleted scratch repo leaves an orphan "Needs you" card (2026-11-25).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { openDecision } = require('./open-decision.js');

function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-scratch-'));
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}

function withEnv(patch, fn) {
  const saved = {};
  for (const k of Object.keys(patch)) { saved[k] = process.env[k]; if (patch[k] === null) delete process.env[k]; else process.env[k] = patch[k]; }
  try { return fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

test('a scratch repo without a sandbox is refused and writes no card', () => {
  const repo = scratchRepo();
  try {
    const r = withEnv({ AUTOPILOT_CARD_NOTIFY: null, AUTOPILOT_ALLOW_SCRATCH_CARD: null }, () => openDecision({ cwd: repo, question: 'Scratch question?' }));
    assert.strictEqual(r.status, 'error');
    assert.match(r.message, /scratch\/temp path/);
    assert.ok(!fs.existsSync(path.join(repo, '.git', 'autopilot', 'ledger')), 'no ledger written');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('the sandbox switch and the explicit override both allow it', () => {
  for (const patch of [{ AUTOPILOT_CARD_NOTIFY: 'off', AUTOPILOT_ALLOW_SCRATCH_CARD: null }, { AUTOPILOT_CARD_NOTIFY: 'off', AUTOPILOT_ALLOW_SCRATCH_CARD: '1' }]) {
    const repo = scratchRepo();
    try {
      const r = withEnv(patch, () => openDecision({ cwd: repo, question: 'Scratch question?' }));
      assert.strictEqual(r.status, 'ok');
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  }
});
