#!/usr/bin/env node
'use strict';

/**
 * pool-mech-route.js — pool-aware mechanical routing for scripts/resolve-dispatch.sh
 * (fleet 01M883AEHTJWZH95JSY1MSKEFX).
 *
 *   node pool-mech-route.js route --role <role> [--lane <lane>]
 *       stdout: one JSON line {model,mode,agent,engine,runner,pool,source:"pool-route"}, exit 0,
 *       when the switch is on, the seat's pool is listed, and the role is mechanical;
 *       exit 1 (no output) otherwise — the caller then uses its normal table.
 *   node pool-mech-route.js private-model-ok --model <model> [--lane <lane>]
 *       exit 1 when <lane> is a private lane and <model> names a Chinese-model engine; else 0.
 *
 * Seat pool: AUTOPILOT_ACCOUNT when it matches ^[a-z0-9-]{1,24}$, else the <name> of
 * CLAUDE_CONFIG_DIR=<...>/.claude-profiles/<name>. Lane: --lane, else AUTOPILOT_LANE.
 * Switch off: AUTOPILOT_POOL_MECH_ROUTE=0, or "enabled": false in scripts/lib/pool-mech-route.json
 * (AUTOPILOT_POOL_MECH_ROUTE_CONFIG overrides the file path). AUTOPILOT_MECH_ROUTE_EXCLUDE=a,b
 * skips engines/pools by name (e.g. a pool that hit its cap).
 * Reads only that config file; never ~/.claude or credentials.
 */

const fs = require('fs');
const path = require('path');

const NAME = /^[a-z0-9-]{1,24}$/;

function loadConfig(env) {
  const p = env.AUTOPILOT_POOL_MECH_ROUTE_CONFIG || path.join(__dirname, 'pool-mech-route.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function seatPool(env) {
  if (env.AUTOPILOT_ACCOUNT && NAME.test(env.AUTOPILOT_ACCOUNT)) return env.AUTOPILOT_ACCOUNT;
  const m = /(?:^|\/)\.claude-profiles\/([a-z0-9-]{1,24})\/?$/.exec(env.CLAUDE_CONFIG_DIR || '');
  return m ? m[1] : null;
}

function isPrivateLane(cfg, lane) {
  return !!lane && cfg.private_lanes.includes(lane);
}

function route(cfg, env, role, lane) {
  if (env.AUTOPILOT_POOL_MECH_ROUTE === '0' || cfg.enabled === false) return null;
  const pool = seatPool(env);
  if (!pool || !cfg.pools.includes(pool) || !cfg.roles.includes(role)) return null;
  const skip = new Set((env.AUTOPILOT_MECH_ROUTE_EXCLUDE || '').split(',').map((s) => s.trim()).filter(Boolean));
  const priv = isPrivateLane(cfg, lane);
  const pick = cfg.engines.find((e) => !skip.has(e.engine) && !skip.has(e.pool)
    && (!priv || cfg.private_allowed_engines.includes(e.engine)));
  if (!pick) return null;
  return { model: pick.model, mode: 'default', agent: '', engine: pick.engine, runner: pick.runner,
    pool: pick.pool, source: 'pool-route' };
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  const env = process.env;
  const cfg = loadConfig(env);
  const lane = arg('--lane') || env.AUTOPILOT_LANE || '';
  if (cmd === 'route') {
    const r = route(cfg, env, arg('--role'), lane);
    if (!r) process.exit(1);
    process.stdout.write(JSON.stringify(r) + '\n');
  } else if (cmd === 'private-model-ok') {
    const bad = isPrivateLane(cfg, lane) && new RegExp(cfg.private_barred_model_pattern, 'i').test(arg('--model') || '');
    process.exit(bad ? 1 : 0);
  } else {
    process.stderr.write('usage: pool-mech-route.js route|private-model-ok ...\n');
    process.exit(2);
  }
}

if (require.main === module) main();
module.exports = { route, seatPool, isPrivateLane };
