'use strict';
// N4: dispatch usage ledger and shadow logs live in a persistent state dir (not tmpfs) and carry a model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const USAGE = path.join(ROOT, 'scripts/lib/dispatch-usage.js');
const GUARD = path.join(ROOT, 'hooks/dispatch-model-guard.js');

function sandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-'));
  const home = path.join(tmp, 'home');
  const xdgRun = path.join(tmp, 'run');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(xdgRun, { recursive: true, mode: 0o700 });
  const env = { ...process.env, HOME: home, XDG_RUNTIME_DIR: xdgRun };
  delete env.AUTOPILOT_STATE_DIR;
  delete env.XDG_STATE_HOME;
  delete env.AUTOPILOT_DISPATCH_USAGE;
  return { tmp, home, env };
}

function rows(dir) {
  return fs.readdirSync(dir).filter((n) => /^dispatch-usage-\d{6}\.jsonl$/.test(n))
    .flatMap((n) => fs.readFileSync(path.join(dir, n), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
}

function start(env, runId, runner, model) {
  return spawnSync(process.execPath, [USAGE, 'start', '--role', 'implementer', '--run-id', runId, '--runner', runner, '--model', model], { env, encoding: 'utf8' });
}

test('usage ledger defaults to ~/.local/state/autopilot, not the live (tmpfs) dir, with model', () => {
  const { home, env } = sandbox();
  const r = start(env, 'r1', 'codex', 'gpt-x');
  assert.equal(r.status, 0, r.stderr);
  const dir = path.join(home, '.local', 'state', 'autopilot');
  const got = rows(dir);
  assert.equal(got.length, 1);
  assert.equal(got[0].model, 'gpt-x');
});

test('XDG_STATE_HOME and AUTOPILOT_STATE_DIR override the default', () => {
  const { tmp, env } = sandbox();
  const xdg = path.join(tmp, 'xs');
  start({ ...env, XDG_STATE_HOME: xdg }, 'r2', 'grok', 'm2');
  assert.equal(rows(path.join(xdg, 'autopilot'))[0].model, 'm2');
  const st = path.join(tmp, 'st');
  start({ ...env, XDG_STATE_HOME: xdg, AUTOPILOT_STATE_DIR: st }, 'r3', 'grok', 'm3');
  assert.equal(rows(st)[0].model, 'm3');
});

test('shadow log lands in the state dir and every record has a model field', () => {
  const { tmp, home, env } = sandbox();
  const fleetStub = path.join(tmp, 'fleet-stub.sh');
  fs.writeFileSync(fleetStub, '#!/bin/sh\necho \'{"state":"open"}\'\n', { mode: 0o755 });
  const payload = {
    session_id: `dlp-${process.pid}-${Date.now()}`,
    tool_name: 'Agent',
    tool_input: { model: 'haiku', subagent_type: 'general-purpose', prompt: 'Engine: haiku\nRole: stats\nLane: t\nFleet-Task: 01M7ZDSR7X7C6GVSB6T3Q6YC3G\nbody' },
    cwd: tmp,
  };
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(payload), env: { ...env, AUTOPILOT_MECHANICAL_REROUTE: 'shadow', AUTOPILOT_SEAT_ROLE: 'lead', FLEET_BIN: fleetStub }, encoding: 'utf8' });
  const dir = path.join(home, '.local', 'state', 'autopilot');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /shadow\.jsonl$/.test(n)) : [];
  assert.ok(files.length > 0, `no shadow file in ${dir}; ${r.stderr}`);
  for (const f of files) {
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n')) assert.ok('model' in JSON.parse(l));
  }
});

test('an explicit AUTOPILOT_LIVE_DIR alone (isolation request) never leaks into the state dir', () => {
  const { tmp, home, env } = sandbox();
  const live = path.join(tmp, 'live');
  fs.mkdirSync(live, { mode: 0o700 });
  start({ ...env, AUTOPILOT_LIVE_DIR: live }, 'r4', 'grok', 'm4');
  assert.equal(rows(live)[0].model, 'm4');
  assert.ok(!fs.existsSync(path.join(home, '.local', 'state', 'autopilot')));
});
