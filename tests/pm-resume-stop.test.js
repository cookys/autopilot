'use strict';
// Stop reminder: once per session, only when the injected in-flight work was not touched or the injection failed.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeMarker, readMarker } = require('../hooks/lib/pm-resume.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmstop-'));
const env = { PATH: process.env.PATH, HOME: tmp, XDG_RUNTIME_DIR: tmp, FLEET_ADDRESS: 'cookys/testhost/pm--claude' };
const ID = '01M7R4PE3RN586XSY3ET1P4YNF';
const hook = path.join(__dirname, '..', 'hooks', 'pm-resume-stop.js');
const stop = (sid, transcript, extraEnv = {}) => spawnSync(process.execPath, [hook], {
  input: JSON.stringify({ session_id: sid, transcript_path: transcript }), encoding: 'utf8', env: { ...env, ...extraEnv },
});
const transcript = (lines) => { const f = path.join(tmp, `t-${Math.random().toString(36).slice(2)}.jsonl`); fs.writeFileSync(f, lines.join('\n')); return f; };
let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log(`ok - ${name}`); };

t('marker ok, in-flight id never used in a tool call: reminds once', () => {
  writeMarker('a1', { ok: true, ids: [ID] }, env);
  const tr = transcript([`{"type":"attachment","text":"IN_FLIGHT ${ID}"}`]);
  assert.match(stop('a1', tr).stderr, /一張都沒碰過/);
  assert.strictEqual(readMarker('a1', env).reminded, true);
  assert.strictEqual(stop('a1', tr).stderr, '', 'second Stop is silent');
});

t('marker ok, a tool call names the id: silent', () => {
  writeMarker('a2', { ok: true, ids: [ID] }, env);
  const tr = transcript([`{"type":"assistant","message":{"content":[{"type":"tool_use","input":{"task_id":"${ID}"}}]}}`]);
  assert.strictEqual(stop('a2', tr).stderr, '');
});

t('failed injection: reminds to run resume by hand', () => {
  writeMarker('a3', { ok: false, ids: [] }, env);
  assert.match(stop('a3', transcript(['{}'])).stderr, /resume 沒讀到/);
});

t('no marker on a fleet seat: reminds; no marker and no seat: silent', () => {
  assert.match(stop('a4', transcript(['{}'])).stderr, /沒有記錄到 fleet pm resume/);
  const noSeat = { ...env }; delete noSeat.FLEET_ADDRESS;
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: 'a5' }), encoding: 'utf8', env: noSeat });
  assert.strictEqual(r.stderr, '');
});

t('opt-out and exit code: never blocks', () => {
  writeMarker('a6', { ok: false, ids: [] }, env);
  const r = stop('a6', transcript(['{}']), { AUTOPILOT_PM_RESUME_STOP: 'off' });
  assert.strictEqual(r.status, 0); assert.strictEqual(r.stderr, ''); assert.strictEqual(r.stdout, '');
  assert.strictEqual(stop('a7', null).status, 0);
});

t('a hand-run `fleet pm resume` counts as touched, with a marker or without one', () => {
  const manual = transcript([`{"type":"assistant","message":{"content":[{"type":"tool_use","input":{"command":"fleet pm resume --seat pm--claude --role pm"}}]}}`]);
  writeMarker('a8', { ok: true, ids: [ID] }, env);
  assert.strictEqual(stop('a8', manual).stderr, '');
  assert.strictEqual(stop('a9', manual).stderr, '', 'no marker but the seat ran resume itself');
});

t('no XDG_RUNTIME_DIR (runtime base under /tmp): the marker still round-trips, so the reminder cannot repeat every turn', () => {
  const bare = { PATH: process.env.PATH, HOME: tmp, FLEET_ADDRESS: env.FLEET_ADDRESS };
  const sid = `nox-${process.pid}`;
  try {
    writeMarker(sid, { ok: true, ids: [ID] }, bare);
    assert.strictEqual(readMarker(sid, bare).ok, true);
    const tr = transcript(['{}']);
    const run = () => spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: sid, transcript_path: tr }), encoding: 'utf8', env: bare });
    assert.match(run().stderr, /一張都沒碰過/);
    assert.strictEqual(run().stderr, '', 'second Stop is silent');
  } finally {
    const base = `/tmp/autopilot-${process.getuid()}/pm-resume`;
    try { fs.rmSync(path.join(base, `${sid}.json`), { force: true }); } catch { /* best effort */ }
  }
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${n} passed`);
