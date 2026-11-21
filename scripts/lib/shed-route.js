#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const SCHEMA = 'capacity.burn_more/1';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function burnMorePath(env) {
  return env.AUTOPILOT_BURN_MORE || path.join(env.HOME || os.homedir(), 'projects', 'capacity', 'out', 'burn_more.v1.json');
}

function no(reason) { return { shed: false, reason }; }
function seatOf(env) {
  if (env.AUTOPILOT_FLEET_ADDRESS) {
    return env.AUTOPILOT_FLEET_ADDRESS.split('/').pop().replace(/@[^@]*$/, '');
  }
  return env.AUTOPILOT_LANE ? `${env.AUTOPILOT_LANE}--claude` : '';
}
function briefHeaders(text) {
  const headers = {};
  for (const line of String(text || '').split(/\r?\n/).slice(0, 10)) {
    const m = line.match(/^(Work-Class|Task-Shape):\s*(.*?)\s*$/);
    if (m) headers[m[1]] = m[2];
  }
  return headers;
}
function decide({ env = process.env, briefText = '', now = new Date() } = {}) {
  if (env.AUTOPILOT_SHED_ROUTE === '0') return no('off');
  let data;
  let raw;
  try { raw = fs.readFileSync(burnMorePath(env), 'utf8'); }
  catch (error) { return no(error && error.code === 'ENOENT' ? 'no_file' : 'bad_schema'); }
  try { data = JSON.parse(raw); }
  catch (_) { return no('bad_schema'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schema !== SCHEMA
      || typeof data.run_id !== 'string' || !data.run_id || typeof data.generated_at !== 'string'
      || !data.shed || typeof data.shed !== 'object' || !Array.isArray(data.shed.pools)
      || !data.shed.rules || typeof data.shed.rules !== 'object'
      || !Array.isArray(data.shed.rules.mechanical_classes) || !Array.isArray(data.shed.rules.targets_in_order)) {
    return no('bad_schema');
  }
  const generated = Date.parse(data.generated_at);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(generated) || !Number.isFinite(nowMs) || generated > nowMs || nowMs - generated > MAX_AGE_MS) return no('stale');
  const seat = seatOf(env);
  const pool = data.shed.pools.find((p) => p && typeof p.pool === 'string' && Array.isArray(p.seats) && p.seats.includes(seat));
  if (!pool) return no('not_listed');
  const headers = briefHeaders(briefText);
  if (!headers['Work-Class'] || !data.shed.rules.mechanical_classes.includes(headers['Work-Class'])) return no('not_mechanical');
  for (const target of data.shed.rules.targets_in_order) {
    if (target === 'minimax' || target === 'kimi') {
      if (headers['Task-Shape'] !== 'from-scratch') continue;
      return { shed: true, run_id: data.run_id, pool: pool.pool, target, reason: 'listed_mechanical' };
    }
    if (target === 'local-27b') return { shed: true, run_id: data.run_id, pool: pool.pool, target: 'local', reason: 'listed_mechanical' };
    if (target === 'codex') return { shed: true, run_id: data.run_id, pool: pool.pool, target: 'codex', reason: 'listed_mechanical' };
  }
  return no('bad_schema');
}

module.exports = { decide, burnMorePath };

if (require.main === module) {
  const args = process.argv.slice(2);
  let promptFile = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt-file' && args[i + 1]) promptFile = args[++i];
    else { process.stderr.write('usage: shed-route.js --prompt-file <file>\n'); process.exit(2); }
  }
  if (!promptFile) { process.stderr.write('usage: shed-route.js --prompt-file <file>\n'); process.exit(2); }
  let briefText = '';
  try { briefText = fs.readFileSync(promptFile, 'utf8'); } catch (_) { /* absent prompt has no class */ }
  process.stdout.write(`${JSON.stringify(decide({ env: process.env, briefText }))}\n`);
}
