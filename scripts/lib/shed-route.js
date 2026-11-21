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
function decide({ env = process.env, briefText = '', now = new Date(), skippedTargets = [] } = {}) {
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
  const skipped = new Map(skippedTargets.map((row) => [row.target, row.reason]));
  let restrictedEligible = false;
  for (const target of data.shed.rules.targets_in_order) {
    if (target === 'minimax' || target === 'kimi') {
      if (headers['Task-Shape'] !== 'from-scratch') continue;
      restrictedEligible = true;
      if (skipped.has(target)) continue;
      return { shed: true, run_id: data.run_id, pool: pool.pool, target, reason: 'listed_mechanical', ...(skipped.size ? { skipped_targets: [...skipped].map(([name, reason]) => ({ target: name, reason })) } : {}) };
    }
    if (target === 'local-27b') {
      if (skipped.has(target)) continue;
      return { shed: true, run_id: data.run_id, pool: pool.pool, target: 'local', reason: 'listed_mechanical', ...(skipped.size ? { skipped_targets: [...skipped].map(([name, reason]) => ({ target: name, reason })) } : {}) };
    }
    if (target === 'codex') {
      if (skipped.has(target)) continue;
      return { shed: true, run_id: data.run_id, pool: pool.pool, target: 'codex', reason: 'listed_mechanical', ...(skipped.size ? { skipped_targets: [...skipped].map(([name, reason]) => ({ target: name, reason })) } : {}) };
    }
  }
  return { ...no(restrictedEligible || skipped.size > 0 || (data.shed.rules.targets_in_order.some((t) => t === 'minimax' || t === 'kimi') && headers['Task-Shape'] !== 'from-scratch') ? 'no_eligible_target' : 'bad_schema'), ...(skipped.size ? { skipped_targets: [...skipped].map(([target, reason]) => ({ target, reason })) } : {}) };
}

module.exports = { decide, burnMorePath };

if (require.main === module) {
  const args = process.argv.slice(2);
  let promptFile = '';
  const skippedTargets = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt-file' && args[i + 1]) promptFile = args[++i];
    else if (args[i] === '--skip-target' && args[i + 1]) {
      const [target, ...rest] = args[++i].split('=');
      if (!target || !rest.length) { process.stderr.write('usage: shed-route.js --prompt-file <file> [--skip-target <target>=<reason>]\n'); process.exit(2); }
      skippedTargets.push({ target, reason: rest.join('=') });
    }
    else { process.stderr.write('usage: shed-route.js --prompt-file <file>\n'); process.exit(2); }
  }
  if (!promptFile) { process.stderr.write('usage: shed-route.js --prompt-file <file>\n'); process.exit(2); }
  let briefText = '';
  try { briefText = fs.readFileSync(promptFile, 'utf8'); } catch (_) { /* absent prompt has no class */ }
  process.stdout.write(`${JSON.stringify(decide({ env: process.env, briefText, skippedTargets }))}\n`);
}
