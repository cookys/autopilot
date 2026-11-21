#!/usr/bin/env node
'use strict';
// local-impl-slot.js — free-slot and context-fit decision for the implicit local implementer.
// operator via PM 01M7XHF4. Prints one JSON line:
//   {"choose":true} or {"choose":false,"reason":"...","detail":"..."}
// Reasons: no_free_slot | draining | context_too_large.
// Config: local_slots_cmd, local_context_bytes (default 400000) via configPath.
// Env AUTOPILOT_LOCAL_SLOTS_CMD overrides the config command. No command: endpoint-probe.js on qwen_local.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { configPath } = require('./config-path');

const DEFAULT_BYTES = 400000;

function readConfig(env) {
  const file = configPath({ env });
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function scopePaths(promptFile) {
  let text = '';
  try { text = fs.readFileSync(promptFile, 'utf8'); } catch { return []; }
  const lines = text.split(/\r?\n/).slice(0, 8);
  const out = [];
  for (const line of lines) {
    const m = /(?:^|\|)\s*Scope:\s*(.*)$/.exec(line);
    if (!m) continue;
    for (const part of m[1].split(/[,\n]/)) {
      const p = part.trim();
      if (p) out.push(p);
    }
  }
  return out;
}

function contextBytes(promptFile, cwd) {
  let n = 0;
  try { n += fs.statSync(promptFile).size; } catch { /* missing prompt is zero */ }
  for (const rel of scopePaths(promptFile)) {
    if (rel.includes('..') || path.isAbsolute(rel)) continue;
    try { n += fs.statSync(path.resolve(cwd, rel)).size; } catch { /* absent scope file counts 0 */ }
  }
  return n;
}

function endpointReady(env) {
  const r = spawnSync('bash', [path.join(__dirname, '..', 'resolve-endpoint.sh'), 'qwen_local'], {
    env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15000,
  });
  const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('{'));
  if (!line) return false;
  try {
    const o = JSON.parse(line);
    return o && o.ready === true;
  } catch { return false; }
}

function slotsFromCmd(cmd, env) {
  const r = spawnSync('bash', ['-c', cmd], {
    env: { ...process.env, ...env }, encoding: 'utf8', timeout: 3000,
  });
  const line = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find((s) => s.startsWith('{'));
  if (r.error || !line) return { ok: false, detail: 'slots_cmd_failed' };
  let o;
  try { o = JSON.parse(line); } catch { return { ok: false, detail: 'slots_cmd_bad_json' }; }
  const free = Number(o.free);
  const draining = o.draining === true;
  if (!Number.isFinite(free)) return { ok: false, detail: 'slots_cmd_bad_json' };
  if (draining) return { ok: false, reason: 'draining', detail: 'draining' };
  if (free > 0) return { ok: true };
  return { ok: false, reason: 'no_free_slot', detail: 'free_0' };
}

function probeSlot(env) {
  const r = spawnSync(process.execPath, [
    path.join(__dirname, 'endpoint-probe.js'), '--endpoint', 'qwen_local', '--model', 'qwen',
  ], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 8000 });
  const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('{'));
  let decision = 'unreachable';
  if (line) {
    try { decision = JSON.parse(line).decision || decision; } catch { /* keep */ }
  }
  if (decision === 'ok') return { ok: true };
  if (decision === 'busy') return { ok: false, reason: 'no_free_slot', detail: 'probe_busy' };
  return { ok: false, reason: 'no_free_slot', detail: `probe_${decision}` };
}

function decide(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const promptFile = opts.promptFile;
  if (!endpointReady(env)) {
    return { choose: false, reason: 'no_free_slot', detail: 'endpoint_not_ready' };
  }
  const cfg = readConfig(env);
  const limit = Number.isFinite(Number(cfg.local_context_bytes)) && Number(cfg.local_context_bytes) > 0
    ? Number(cfg.local_context_bytes) : DEFAULT_BYTES;
  const bytes = contextBytes(promptFile, cwd);
  if (bytes > limit) {
    return { choose: false, reason: 'context_too_large', detail: String(bytes) };
  }
  const cmd = String(env.AUTOPILOT_LOCAL_SLOTS_CMD || cfg.local_slots_cmd || '').trim();
  const slot = cmd ? slotsFromCmd(cmd, env) : probeSlot(env);
  if (slot.ok) return { choose: true };
  return { choose: false, reason: slot.reason || 'no_free_slot', detail: slot.detail || 'no_slot' };
}

function main() {
  const i = process.argv.indexOf('--prompt-file');
  const promptFile = i >= 0 ? process.argv[i + 1] : '';
  const cwdIdx = process.argv.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
  process.stdout.write(`${JSON.stringify(decide({ promptFile, cwd }))}\n`);
}

if (require.main === module) main();

module.exports = { decide, contextBytes, DEFAULT_BYTES };
