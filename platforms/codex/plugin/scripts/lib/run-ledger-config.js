'use strict';
// run-ledger-config — the one resolver for run_ledger.max_rotations (BL-0256).
//
//   configuredValue({ env?, home? }) -> run_ledger.max_rotations as a string (what the env var used to carry), or undefined
//   maxRotations({ env?, home? })    -> integer 1..64 (default 4), the work-order/engine parse
//   Each consumer keeps the exact parse it had before BL-0256, only the input source changed: campaign/cli.js
//   (Number, finite >= 0, floor), final-panel-seat-store (parseInt, >= 1), run-ledger.sh (jq/shell string, used as-is),
//   work-order/engine (maxRotations()).
//   CLI:  node run-ledger-config.js        (prints the number)
//
// Source: `run_ledger.max_rotations` in the operator config (configPath: $AUTOPILOT_CONFIG_FILE or
// ~/.autopilot/config.json). The RUN_LEDGER_MAX_ROTATIONS environment variable is deliberately NOT read: a sweep or test
// environment must not change how many rotated segments the real ledger keeps (owner decision d-b40f40cf, 2026-10-23).
// A missing or malformed value, or one the consumer's own range rejects, falls back to 4.
//
// Consumers: src/campaign/cli.js, src/engine/work-order.js, src/engine/autopilot-engine.js,
// src/engine/final-panel-seat-store.js. scripts/run-ledger.sh applies the same rule with jq (DEFAULT_MAX_ROTATIONS).

const fs = require('fs');
const os = require('os');
const { configPath } = require('./config-path.js');

const DEFAULT_MAX_ROTATIONS = 4;
const MAX_ALLOWED = 64;

// The config number as the STRING the old env var would have carried (undefined = "unset"). Every consumer then runs
// its own pre-BL-0256 parse on it unchanged, so 1.5, -1, 0 and 100 behave exactly as they did from the environment.
function configuredValue(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || env.HOME || os.homedir();
  try {
    const file = configPath({ env, home });
    if (!fs.existsSync(file)) return undefined;
    const rl = JSON.parse(fs.readFileSync(file, 'utf8')).run_ledger;
    const v = rl && typeof rl === 'object' ? rl.max_rotations : undefined;
    return typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined;
  } catch { return undefined; }
}

// work-order / autopilot-engine parse, verbatim from before BL-0256: Number(raw || 4), safe integer 1..64, else 4.
function maxRotations(opts = {}) {
  let m = Number(configuredValue(opts) || DEFAULT_MAX_ROTATIONS);
  if (!Number.isSafeInteger(m) || m < 1 || m > MAX_ALLOWED) m = DEFAULT_MAX_ROTATIONS;
  return m;
}

module.exports = { maxRotations, configuredValue, DEFAULT_MAX_ROTATIONS };

if (require.main === module) process.stdout.write(`${maxRotations()}\n`);
