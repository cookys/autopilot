'use strict';
// run-ledger-config — the one resolver for run_ledger.max_rotations (BL-0256).
//
//   maxRotations({ env?, home? }) -> integer 1..64 (default 4)
//   CLI:  node run-ledger-config.js        (prints the number)
//
// Source: `run_ledger.max_rotations` in the operator config (configPath: $AUTOPILOT_CONFIG_FILE or
// ~/.autopilot/config.json). The RUN_LEDGER_MAX_ROTATIONS environment variable is deliberately NOT read: a sweep or test
// environment must not change how many rotated segments the real ledger keeps (owner decision d-b40f40cf, 2026-10-23).
// A missing, malformed or out-of-range value falls back to 4.
//
// Consumers: src/campaign/cli.js, src/engine/work-order.js, src/engine/autopilot-engine.js,
// src/engine/final-panel-seat-store.js. scripts/run-ledger.sh applies the same rule with jq (DEFAULT_MAX_ROTATIONS).

const fs = require('fs');
const os = require('os');
const { configPath } = require('./config-path.js');

const DEFAULT_MAX_ROTATIONS = 4;
const MAX_ALLOWED = 64;

function maxRotations(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || env.HOME || os.homedir();
  try {
    const file = configPath({ env, home });
    if (!fs.existsSync(file)) return DEFAULT_MAX_ROTATIONS;
    const rl = JSON.parse(fs.readFileSync(file, 'utf8')).run_ledger;
    const v = rl && typeof rl === 'object' ? rl.max_rotations : undefined;
    if (Number.isSafeInteger(v) && v >= 1 && v <= MAX_ALLOWED) return v;
  } catch { /* default */ }
  return DEFAULT_MAX_ROTATIONS;
}

module.exports = { maxRotations, DEFAULT_MAX_ROTATIONS };

if (require.main === module) process.stdout.write(`${maxRotations()}\n`);
