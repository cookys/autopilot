'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FRESH_MS = 15 * 60 * 1000;
const PROMPT = 'Reply with exactly: PONG';

function probeFile(env) {
  if (typeof env.AUTOPILOT_GROK_PROBE_FILE === 'string' && env.AUTOPILOT_GROK_PROBE_FILE !== '') {
    return env.AUTOPILOT_GROK_PROBE_FILE;
  }
  if (typeof env.HOME !== 'string' || env.HOME === '') return null;
  return path.join(env.HOME, '.autopilot', 'probe', 'grok.json');
}

function readFresh(file, model, nowMs) {
  if (!file) return null;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    return null;
  }
  if (!rec || typeof rec !== 'object' || typeof rec.ok !== 'boolean' || rec.model !== model) return null;
  const at = Date.parse(rec.at);
  if (!Number.isFinite(at)) return null;
  const age = nowMs - at;
  if (age < 0 || age > FRESH_MS) return null;
  return rec;
}

function writeRecord(file, rec) {
  if (!file) return;
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.grok.json.${process.pid}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(rec));
    fs.renameSync(tmp, file);
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* write failure must not throw */ }
  }
}

function grokProbeState({ env = process.env, now = Date.now(), model } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const file = probeFile(env);
  const fresh = readFresh(file, model, nowMs);
  if (fresh) return fresh.ok ? 'available' : 'unavailable';
  if (env.AUTOPILOT_GROK_PROBE === 'off') return 'unavailable';

  const bin = (typeof env.AUTOPILOT_GROK_PROBE_BIN === 'string' && env.AUTOPILOT_GROK_PROBE_BIN !== '')
    ? env.AUTOPILOT_GROK_PROBE_BIN
    : 'grok';
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-live-probe-'));
  let ok = false;
  try {
    const result = spawnSync(bin, ['-m', String(model), '-p', PROMPT], {
      cwd,
      input: '',
      timeout: 60_000,
      encoding: 'utf8',
    });
    ok = result.status === 0 && typeof result.stdout === 'string' && result.stdout.includes('PONG');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  writeRecord(file, { ok, model, at: new Date(nowMs).toISOString() });
  return ok ? 'available' : 'unavailable';
}

module.exports = { grokProbeState };
