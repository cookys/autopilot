#!/usr/bin/env node
'use strict';

/**
 * launch-decision.js — turn resolve-dispatch.sh JSON into ONE launch decision
 * (fleet 01M883AEHTJWZH95JSY1MSKEFX). Called by scripts/resolve-launch.sh.
 *
 *   node launch-decision.js --json '<resolve-dispatch json>' [--branch <b>] [--prompt-file <f>]
 *   stdout (one line):
 *     {"launch":"claude","model":...,"mode":...,"agent":...,"source":...}      no engine/runner, or Claude
 *     {"launch":"hetero","runner":"agy","model":...,"pool":...,"argv":["scripts/dispatch-hetero.sh","--runner",...]}
 *   exit 2 invalid input (runner/model token outside [A-Za-z0-9._-]); exit 3 private lane + Chinese-model runner.
 * Lane: AUTOPILOT_LANE; private lanes and the barred pattern come from pool-mech-route.json.
 */

const fs = require('fs');
const path = require('path');

const TOKEN = /^[A-Za-z0-9._-]+$/;

function decide(resolved, opts, env) {
  const engine = resolved.engine || '';
  const runner = resolved.runner || '';
  if (!engine || !runner || runner === 'claude' || engine === 'claude') {
    return { code: 0, out: { launch: 'claude', model: resolved.model, mode: resolved.mode,
      agent: resolved.agent || '', source: resolved.source } };
  }
  if (!TOKEN.test(runner) || !TOKEN.test(resolved.model || '')) return { code: 2, err: 'invalid runner/model token' };
  const cfgPath = env.AUTOPILOT_POOL_MECH_ROUTE_CONFIG || path.join(__dirname, 'pool-mech-route.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const lane = env.AUTOPILOT_LANE || '';
  if (lane && cfg.private_lanes.includes(lane)
    && new RegExp(cfg.private_barred_model_pattern, 'i').test(`${runner} ${engine} ${resolved.model}`)) {
    return { code: 3, err: `private lane ${lane} refuses runner ${runner}` };
  }
  const argv = ['scripts/dispatch-hetero.sh', '--runner', runner, '--model', resolved.model,
    '--no-campaign', '--pin-reason', `pool-route ${resolved.pool || engine}`]; // outside a sealed campaign dispatch-hetero refuses without it; campaign callers drop it
  if (opts.branch) argv.push('--branch', opts.branch);
  if (opts['prompt-file']) argv.push('--prompt-file', opts['prompt-file']);
  return { code: 0, out: { launch: 'hetero', runner, model: resolved.model, pool: resolved.pool || '', argv } };
}

function main() {
  const a = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < a.length; i += 2) opts[a[i].replace(/^--/, '')] = a[i + 1];
  let resolved;
  try { resolved = JSON.parse(opts.json); } catch (e) {
    process.stderr.write('launch-decision: --json is not valid JSON\n'); process.exit(2);
  }
  const r = decide(resolved, opts, process.env);
  if (r.err) process.stderr.write(`launch-decision: ${r.err}\n`);
  if (r.out) process.stdout.write(JSON.stringify(r.out) + '\n');
  process.exit(r.code);
}

if (require.main === module) main();
module.exports = { decide };
