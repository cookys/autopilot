'use strict';

// engine-preflight tests. Temp HOME and temp dispatch-runs dir only.
// Never reads the real capacity repo or a real engine CLI.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { preflight } = require('./lib/engine-preflight.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-preflight-'));
const home = path.join(root, 'home');
const bin = path.join(root, 'bin');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(bin, { recursive: true });

const lib = path.join(__dirname, 'lib', 'engine-preflight.js');
const NOW = Date.parse('2026-11-20T00:00:00.000Z');

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function caseDir(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function manifest(dir, name, body, ageMs) {
  const file = path.join(dir, name);
  writeJson(file, body);
  const when = new Date(NOW - ageMs);
  fs.utimesSync(file, when, when);
  return file;
}

function enginesDoc(rows, generatedAt) {
  return {
    schema: 'capacity.engines/1',
    generated_at: generatedAt,
    engines: rows,
  };
}

function sources(runs, extra) {
  return Object.assign({
    env: { HOME: home, AUTOPILOT_DISPATCH_RUNS_DIR: runs },
    runsDir: runs,
    enginesTable: path.join(root, 'no-engines.json'),
    burnMore: path.join(root, 'no-burn.json'),
    probe: null,
    windowMin: 15,
  }, extra);
}

const terra = { runner: 'codex', model: 'gpt-6.1-terra' };
const sol = { runner: 'codex', model: 'gpt-6.1-sol' };

test('codeforge-v74-E-overloaded', () => {
  const runs = caseDir('e');
  manifest(runs, 'hetero-e.manifest.json', {
    run_id: 'hetero-e',
    runner: 'codex',
    model: 'gpt-6.1-terra',
    ended_at: new Date(NOW - 5 * 60 * 1000).toISOString(),
    error_category: 'overloaded',
  }, 5 * 60 * 1000);
  const out = preflight({ candidates: [terra, sol], now: NOW, sources: sources(runs) });
  assert.deepEqual(out.skipped, [{ runner: 'codex', model: 'gpt-6.1-terra', reason: 'recent:overloaded@hetero-e' }]);
  assert.deepEqual(out.chosen, sol);
});

test('codeforge-v74-F-rate-limited', () => {
  const runs = caseDir('f');
  manifest(runs, 'hetero-f.manifest.json', {
    run_id: 'hetero-f',
    runner: 'codex',
    model: 'gpt-6.1-terra',
    ended_at: new Date(NOW - 2 * 60 * 1000).toISOString(),
    error_category: 'rate_limited',
  }, 2 * 60 * 1000);
  const out = preflight({ candidates: [terra, sol], now: NOW, sources: sources(runs) });
  assert.equal(out.skipped[0].reason, 'recent:rate_limited@hetero-f');
  assert.deepEqual(out.chosen, sol);
});

test('manifest 40 min old with overloaded is outside the window', () => {
  const runs = caseDir('old');
  manifest(runs, 'hetero-old.manifest.json', {
    run_id: 'hetero-old',
    runner: 'codex',
    model: 'gpt-6.1-sol',
    ended_at: new Date(NOW - 40 * 60 * 1000).toISOString(),
    error_category: 'overloaded',
  }, 40 * 60 * 1000);
  const out = preflight({ candidates: [sol, terra], now: NOW, sources: sources(runs) });
  assert.deepEqual(out.chosen, sol);
  assert.deepEqual(out.skipped, []);
});

test('capacity 已用完 skips; 不派(待重考) skips; stale generated_at warns and does not skip', () => {
  const fresh = new Date(NOW - 5 * 60 * 1000).toISOString();
  const spent = path.join(root, 'engines-spent.json');
  writeJson(spent, enginesDoc([
    { harness: 'codex', model: 'gpt-6.1-terra', availability: '已用完', suggest: '不派' },
  ], fresh));
  const runs = caseDir('cap');
  const spentOut = preflight({ candidates: [terra, sol], now: NOW, sources: sources(runs, { enginesTable: spent }) });
  assert.equal(spentOut.skipped[0].reason, 'capacity:已用完/不派');
  assert.deepEqual(spentOut.chosen, sol);

  const recheck = path.join(root, 'engines-recheck.json');
  writeJson(recheck, enginesDoc([
    { harness: 'codex', model: 'gpt-6.1-terra', availability: '可用', suggest: '不派(待重考)' },
  ], fresh));
  const recheckOut = preflight({ candidates: [terra, sol], now: NOW, sources: sources(runs, { enginesTable: recheck }) });
  assert.equal(recheckOut.skipped[0].reason, 'capacity:可用/不派(待重考)');

  const stale = path.join(root, 'engines-stale.json');
  writeJson(stale, enginesDoc([
    { harness: 'codex', model: 'gpt-6.1-terra', availability: '已用完', suggest: '不派' },
  ], new Date(NOW - 2 * 60 * 60 * 1000).toISOString()));
  const staleOut = preflight({ candidates: [terra, sol], now: NOW, sources: sources(runs, { enginesTable: stale }) });
  assert.deepEqual(staleOut.chosen, terra);
  assert.deepEqual(staleOut.skipped, []);
  assert.ok(staleOut.warnings.includes('capacity_table_stale'));
});

test('account-unsupported', () => {
  const runs = caseDir('acct');
  manifest(runs, 'hetero-acct.manifest.json', {
    run_id: 'hetero-acct',
    runner: 'codex',
    model: 'gpt-6.1-terra',
    ended_at: new Date(NOW - 60 * 1000).toISOString(),
    error: 'not supported when using Codex with a ChatGPT account',
  }, 60 * 1000);
  const out = preflight({ candidates: [terra, sol], now: NOW, sources: sources(runs) });
  assert.equal(out.skipped[0].reason, 'recent:model_unsupported@hetero-acct');
  assert.deepEqual(out.chosen, sol);
});

test('burn_more is reported; ordering changes only when preferred', () => {
  const file = path.join(root, 'burn.json');
  writeJson(file, {
    schema: 'capacity.burn_more/1',
    engines: [{ engine: 'codex:gpt-6.1-sol', pool: 'codex', used_pct: 10 }],
  });
  const out = preflight({
    candidates: [terra, sol],
    now: NOW,
    sources: sources(caseDir('burn'), { burnMore: file }),
  });
  assert.deepEqual(out.chosen, terra);
  assert.deepEqual(out.burn_more, [sol]);
  const preferred = preflight({
    candidates: [terra, sol],
    now: NOW,
    preferBurnMore: true,
    sources: sources(caseDir('burn-preferred'), { burnMore: file }),
  });
  assert.deepEqual(preferred.chosen, { ...sol, burn_more: true });
  assert.deepEqual(preferred.skipped, []);
  assert.deepEqual(preferred.burn_more, [sol]);
});

test('missing capacity table warns and does not skip', () => {
  const out = preflight({ candidates: [terra], now: NOW, sources: sources(caseDir('missing')) });
  assert.deepEqual(out.chosen, terra);
  assert.ok(out.warnings.includes('capacity_table_missing'));
});

test('burn preference keeps local candidates first for mechanical work', () => {
  const file = path.join(root, 'burn-local.json');
  writeJson(file, { schema: 'capacity.burn_more/1', engines: [{ engine: 'kimi' }] });
  const local = { runner: 'cc-shim', model: 'glm-5.3', endpoint: 'glm' };
  const cloud = { runner: 'grok', model: 'grok-4.7' };
  const kimi = { runner: 'kimi', model: 'kimi-code/kimi-for-coding' };
  const out = preflight({
    candidates: [cloud, kimi, local], now: NOW, preferBurnMore: true, localFirst: true,
    sources: sources(caseDir('burn-local'), { burnMore: file }),
  });
  assert.deepEqual(out.chosen, { runner: local.runner, model: local.model });
});

function probeStub(code) {
  const file = path.join(bin, `probe-${code}.sh`);
  fs.writeFileSync(file, `#!/bin/sh\nif [ "$2" = "gpt-6.1-terra" ]; then exit ${code}; fi\nexit 0\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

function probeIgnoreTerm() {
  const file = path.join(bin, 'probe-ignore-term.js');
  // In-process timer. A child sleep would survive SIGKILL of the parent. stdin is ignored, so `read -t` returns at once.
  fs.writeFileSync(file, `#!/usr/bin/env node
'use strict';
process.on('SIGTERM', () => {});
if (process.argv[3] === 'gpt-6.1-terra') {
  const until = Date.now() + 60000;
  setInterval(() => { if (Date.now() >= until) process.exit(0); }, 200);
} else {
  process.exit(0);
}
`);
  fs.chmodSync(file, 0o755);
  return file;
}

test('probe that ignores SIGTERM is killed and the next candidate is chosen', { timeout: 30000 }, () => {
  const started = Date.now();
  const out = preflight({
    candidates: [terra, sol],
    now: NOW,
    sources: sources(caseDir('probe-term'), { probe: probeIgnoreTerm() }),
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 25000, `preflight returned in ${elapsed}ms`);
  assert.equal(out.skipped[0].runner, 'codex');
  assert.equal(out.skipped[0].model, 'gpt-6.1-terra');
  assert.equal(out.skipped[0].reason, 'probe:timeout');
  assert.ok(out.warnings.includes('probe_unknown:timeout'));
  assert.deepEqual(out.chosen, sol);
});

test('probe stub exit 76 skips probe:rate_limited; exit 1 is a warning only', () => {
  const skip = preflight({
    candidates: [terra, sol],
    now: NOW,
    sources: sources(caseDir('probe76'), { probe: probeStub(76) }),
  });
  assert.equal(skip.skipped[0].reason, 'probe:rate_limited');
  assert.deepEqual(skip.chosen, sol);

  const warn = preflight({
    candidates: [terra],
    now: NOW,
    sources: sources(caseDir('probe1'), { probe: probeStub(1) }),
  });
  assert.deepEqual(warn.chosen, terra);
  assert.deepEqual(warn.skipped, []);
  assert.ok(warn.warnings.includes('probe_unknown:1'));
});

test('all candidates skipped -> chosen null, CLI exit 3', () => {
  const runs = caseDir('cli-all');
  const wall = Date.now();
  manifest(runs, 'hetero-e.manifest.json', {
    run_id: 'hetero-e',
    runner: 'codex',
    model: 'gpt-6.1-terra',
    ended_at: new Date(wall - 5 * 60 * 1000).toISOString(),
    error_category: 'overloaded',
  }, 5 * 60 * 1000);
  manifest(runs, 'hetero-f.manifest.json', {
    run_id: 'hetero-f',
    runner: 'codex',
    model: 'gpt-6.1-sol',
    ended_at: new Date(wall - 2 * 60 * 1000).toISOString(),
    error_category: 'rate_limited',
  }, 2 * 60 * 1000);
  const result = spawnSync(process.execPath, [
    lib,
    '--candidate', 'codex:gpt-6.1-terra',
    '--candidate', 'codex:gpt-6.1-sol',
  ], {
    env: {
      HOME: home,
      PATH: process.env.PATH,
      AUTOPILOT_DISPATCH_RUNS_DIR: runs,
      AUTOPILOT_ENGINES_TABLE: path.join(root, 'no-engines.json'),
      AUTOPILOT_BURN_MORE: path.join(root, 'no-burn.json'),
      AUTOPILOT_ENGINE_PREFLIGHT_WINDOW_MIN: '15',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 3, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.schema, 'autopilot.engine-preflight/1');
  assert.equal(body.chosen, null);
  assert.equal(body.skipped.length, 2);
  assert.match(result.stderr, /preflight: skip codex:gpt-6\.1-terra \(recent:overloaded@hetero-e\); next codex:gpt-6\.1-sol/);
  assert.match(result.stderr, /preflight: skip codex:gpt-6\.1-sol \(recent:rate_limited@hetero-f\); next none/);
});
