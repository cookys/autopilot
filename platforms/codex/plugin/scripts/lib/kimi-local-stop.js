#!/usr/bin/env node
'use strict';

// Local Kimi refresh rotates the operator's login. AUTOPILOT_KIMI_LOCAL_ALLOW=1
// is a test seam only and must never be set in production.
const REASON = 'kimi_local_stopped: local kimi CLI start is disabled until the kimi broker ships (refresh rotates the operator\'s login)';

function isStopped(env = process.env) {
  return env.AUTOPILOT_KIMI_LOCAL_ALLOW !== '1';
}

module.exports = { isStopped, REASON };

if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== 'check') {
    process.stderr.write('usage: kimi-local-stop.js check\n');
    process.exitCode = 2;
  } else if (isStopped()) {
    process.stderr.write(`${REASON}\n`);
    process.exitCode = 3;
  }
}
