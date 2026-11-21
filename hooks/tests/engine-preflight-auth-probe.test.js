'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { preflight } = require('../../scripts/lib/engine-preflight.js');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('auth probe: missing codex auth.json skips codex with auth:missing and falls back to agy', () => {
  const home = makeTempDir('preflight-home-');
  const runs = makeTempDir('preflight-runs-');
  try {
    const res = preflight({
      candidates: [
        { runner: 'codex', model: 'gpt-6.1-terra' },
        { runner: 'agy', model: 'gemini-4-hydrogen-high' },
      ],
      now: 1_700_000_000_000,
      sources: {
        env: { HOME: home },
        runsDir: runs,
        enginesTable: { schema: 'capacity.engines/1', generated_at: new Date(1_700_000_000_000).toISOString(), rows: [] },
        burnMore: { schema: 'capacity.burn_more/1', rows: [] },
        probe: null,
      },
    });
    assert.equal(res.chosen?.runner, 'agy');
    assert.deepEqual(res.skipped, [
      { runner: 'codex', model: 'gpt-6.1-terra', reason: 'auth:missing' },
    ]);
    assert.deepEqual(res.fallback, { from: 'codex', to: 'agy', reason: 'auth:missing' });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(runs, { recursive: true, force: true });
  }
});

test('auth probe: present codex auth.json chooses codex, caches for 5m, and re-checks after 5m', () => {
  const home = makeTempDir('preflight-home-');
  const runs = makeTempDir('preflight-runs-');
  const authFile = path.join(home, '.codex', 'auth.json');
  const t0 = 1_700_000_000_000;
  try {
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, '{"token":"dummy"}');

    const baseSources = {
      env: { HOME: home },
      runsDir: runs,
      enginesTable: { schema: 'capacity.engines/1', generated_at: new Date(t0).toISOString(), rows: [] },
      burnMore: { schema: 'capacity.burn_more/1', rows: [] },
      probe: null,
    };
    const candidates = [
      { runner: 'codex', model: 'gpt-6.1-terra' },
      { runner: 'agy', model: 'gemini-4-hydrogen-high' },
    ];

    const first = preflight({ candidates, now: t0, sources: baseSources });
    assert.equal(first.chosen?.runner, 'codex');
    assert.equal(first.fallback, null);

    // Delete auth file; within 5 minutes the cached result should still choose codex.
    fs.rmSync(authFile);
    const second = preflight({ candidates, now: t0 + 4 * 60 * 1000, sources: baseSources });
    assert.equal(second.chosen?.runner, 'codex');

    // After 5 minutes, cache expires and preflight re-checks, falling back to agy.
    const third = preflight({ candidates, now: t0 + 5 * 60 * 1000, sources: baseSources });
    assert.equal(third.chosen?.runner, 'agy');
    assert.equal(third.skipped[0]?.reason, 'auth:missing');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(runs, { recursive: true, force: true });
  }
});
