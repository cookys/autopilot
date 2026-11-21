'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { preflight } = require('./lib/engine-preflight.js');

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
    assert.deepEqual(res.fallback, { from: 'codex', to: 'agy', reason: 'auth:missing', notify: true });
    // Second fallback inside 15 minutes: same record, no second notification.
    const again = preflight({ candidates: res.skipped.map(({ runner, model }) => ({ runner, model })).concat([{ runner: 'agy', model: 'gemini-4-hydrogen-high' }]), now: 1_700_000_000_000 + 60_000, sources: { env: { HOME: home }, runsDir: runs, enginesTable: { schema: 'capacity.engines/1', generated_at: new Date(1_700_000_000_000).toISOString(), rows: [] }, burnMore: { schema: 'capacity.burn_more/1', rows: [] }, probe: null } });
    assert.equal(again.fallback.notify, false);
    const later = preflight({ candidates: [{ runner: 'codex', model: 'gpt-6.1-terra' }, { runner: 'agy', model: 'gemini-4-hydrogen-high' }], now: 1_700_000_000_000 + 16 * 60_000, sources: { env: { HOME: home }, runsDir: runs, enginesTable: { schema: 'capacity.engines/1', generated_at: new Date(1_700_000_000_000 + 16 * 60_000).toISOString(), rows: [] }, burnMore: { schema: 'capacity.burn_more/1', rows: [] }, probe: null } });
    assert.equal(later.fallback.notify, true);
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

test('auth probe: an empty auth.json counts as missing, and CODEX_HOME wins over HOME', () => {
  const home = makeTempDir('preflight-home-');
  const runs = makeTempDir('preflight-runs-');
  const ch = makeTempDir('preflight-codexhome-');
  const t0 = 1_700_000_000_000;
  const mk = (env) => ({ env, runsDir: runs, enginesTable: { schema: 'capacity.engines/1', generated_at: new Date(t0).toISOString(), rows: [] }, burnMore: { schema: 'capacity.burn_more/1', rows: [] }, probe: null });
  const candidates = [{ runner: 'codex', model: 'gpt-6.1-terra' }, { runner: 'agy', model: 'gemini-4-hydrogen-high' }];
  try {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '');
    assert.equal(preflight({ candidates, now: t0, sources: mk({ HOME: home }) }).chosen.runner, 'agy');
    fs.writeFileSync(path.join(ch, 'auth.json'), 'x');
    assert.equal(preflight({ candidates, now: t0 + 6 * 60_000, sources: mk({ HOME: home, CODEX_HOME: ch }) }).chosen.runner, 'codex');
    // The cache file holds only ok + timestamp, never auth content.
    const cache = fs.readFileSync(path.join(runs, 'auth-probe-codex.json'), 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(cache)).sort(), ['checkedAt', 'ok']);
  } finally {
    for (const d of [home, runs, ch]) fs.rmSync(d, { recursive: true, force: true });
  }
});
