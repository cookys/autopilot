#!/usr/bin/env node
'use strict';

/**
 * fleet-stop — opt-in Stop hook: runs `fleet hook stop` so a turn that claims a fleet task done without
 * task_result / blocked gets sent back. Default OFF: does nothing until `hooks.fleet-stop` is enabled
 * (opt-in.js: ~/.autopilot/config.json {"hooks":{"fleet-stop":true}} or AUTOPILOT_HOOK_FLEET_STOP=1;
 * scripts/dev-setup.sh turns it on for hosts that have `fleet`).
 *
 * Pipes the Stop payload (stdin, byte-identical) to `fleet hook stop` and passes its stdout, stderr and
 * exit status through. `fleet` missing from PATH, or any error in this wrapper, exits 0 (fail-open).
 * Node >= 20.10, built-ins only.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const { isEnabled } = require('./_shared/opt-in.js');

function main() {
  if (!isEnabled('fleet-stop')) return 0;
  const input = fs.readFileSync(0);
  const r = spawnSync('fleet', ['hook', 'stop'], { input, maxBuffer: 16 * 1024 * 1024, timeout: 20000 });
  if (r.error || typeof r.status !== 'number') return 0;
  if (r.stdout && r.stdout.length) process.stdout.write(r.stdout);
  if (r.stderr && r.stderr.length) process.stderr.write(r.stderr);
  return r.status;
}

let code = 0;
try { code = main(); } catch (_e) { code = 0; }
process.exitCode = code;
