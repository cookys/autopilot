#!/usr/bin/env node
'use strict';

const { dispatchReview } = require('../src/runners/review');
const { resolveReviewLoop } = require('../src/engine/resolve-review-loop');
const { runHarnessCli } = require('../src/harness/cli');

function printHelp() {
  process.stdout.write(`Usage:
  node bin/autopilot.js dispatch review [dispatch-review args...]
  node bin/autopilot.js engine review-loop [resolve-review-loop args...]
  node bin/autopilot.js harness report [harness report args...]

Commands:
  dispatch review   Delegate to the read-only heterogeneous review dispatcher.
  engine review-loop
                    Delegate to the review-loop roster resolver.
  harness report    Emit read-only harness capability state and stale flags.

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

if (args[0] === 'engine') {
  if (args[1] !== 'review-loop') {
    failUsage(`unknown engine subcommand: ${args.slice(1).join(' ') || '<missing>'}`);
  }
  const result = resolveReviewLoop(args.slice(2), {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    process.stderr.write(`ERROR: ${result.error.message}\n`);
    process.exit(2);
  }
  if (result.signal) {
    process.stderr.write(`ERROR: engine review-loop terminated by signal ${result.signal}\n`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

if (args[0] === 'harness') {
  const result = runHarnessCli(args.slice(1), {
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exit(result.status);
}

failUsage(`unknown command: ${args.join(' ')}`);
