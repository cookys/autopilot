#!/usr/bin/env node
'use strict';

const { dispatchReview } = require('../src/runners/review');

function printHelp() {
  process.stdout.write(`Usage:
  node bin/autopilot.js dispatch review [dispatch-review args...]

Commands:
  dispatch review   Delegate to the read-only heterogeneous review dispatcher.

Exit codes:
  Delegated commands preserve the wrapped command exit code.
  2 = usage error / unknown command
`);
}

function failUsage(message = '') {
  if (message) {
    process.stderr.write(`ERROR: ${message}\n`);
  }
  printHelp();
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
  printHelp();
  process.exit(0);
}

if (args[0] === 'dispatch') {
  if (args[1] !== 'review') {
    failUsage(`unknown dispatch subcommand: ${args.slice(1).join(' ') || '<missing>'}`);
  }
  const result = dispatchReview(args.slice(2), {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    process.stderr.write(`ERROR: ${result.error.message}\n`);
    process.exit(2);
  }
  if (result.signal) {
    process.stderr.write(`ERROR: dispatch review terminated by signal ${result.signal}\n`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

failUsage(`unknown command: ${args.join(' ')}`);
