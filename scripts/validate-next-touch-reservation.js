#!/usr/bin/env node
'use strict';

// Archive-only: the next-touch mission is closed; no mission ending must run this. Kept as the thin CLI over scripts/next-touch-validation.js, exercised by hooks/tests/next-touch-validation.test.sh.

const core = require('./next-touch-validation');

try {
  const args = core.parseStrictArgs(
    process.argv.slice(2),
    ['--ledger', '--pre-spend'],
    ['--repo', '--authorization', '--prepared'],
    ['--pre-spend'],
  );
  const result = core.validateReservation(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`validate-next-touch-reservation: ${error.code || 'VALIDATION_FAILED'}: ${error.message}\n`);
  process.exitCode = 1;
}
