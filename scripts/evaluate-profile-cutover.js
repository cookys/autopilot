#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  ProfileCutoverError,
  evaluateProfileCutover,
} = require('../src/engine/profile-cutover');

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const HELP = `Usage:
  node scripts/evaluate-profile-cutover.js evaluate --input <snapshot.json> [--require-eligible]

The CLI emits an advisory decision receipt and never edits project configuration. Live verifier
capabilities cannot be reconstructed from JSON, so a file-only evaluation remains hold_guided.
Use the imported evaluateProfileCutover function from a trusted host to supply live verifiers.
`;

function parseArgs(argv) {
  if (!argv[2] || ['help', '--help', '-h'].includes(argv[2])) return { help: true };
  if (argv[2] !== 'evaluate') {
    throw new ProfileCutoverError(`unknown command: ${argv[2]}`, 'INVALID_ARGUMENT');
  }
  const options = { requireEligible: false };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === '--require-eligible') {
      options.requireEligible = true;
      continue;
    }
    if (argv[index] !== '--input' || index + 1 >= argv.length) {
      throw new ProfileCutoverError(
        `unknown or incomplete argument: ${argv[index]}`,
        'INVALID_ARGUMENT',
      );
    }
    if (options.input) {
      throw new ProfileCutoverError('--input may appear only once', 'INVALID_ARGUMENT');
    }
    options.input = argv[++index];
  }
  if (!options.input) {
    throw new ProfileCutoverError('--input is required', 'INVALID_ARGUMENT');
  }
  return options;
}

function readSnapshot(file) {
  const resolved = path.resolve(file);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw new ProfileCutoverError(
      `cutover snapshot is unavailable: ${error.code || error.message}`,
      'INPUT_UNAVAILABLE',
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_INPUT_BYTES) {
    throw new ProfileCutoverError(
      'cutover snapshot must be a bounded regular file',
      'INPUT_UNTRUSTED',
    );
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new ProfileCutoverError(
      `cutover snapshot is invalid JSON: ${error.message}`,
      'INVALID_PROFILE_CUTOVER_SNAPSHOT',
    );
  }
}

function run(argv = process.argv) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(HELP);
      return 0;
    }
    const decision = evaluateProfileCutover(readSnapshot(options.input));
    process.stdout.write(`${JSON.stringify(decision)}\n`);
    return options.requireEligible && decision.decision !== 'eligible_to_enable_adaptive' ? 1 : 0;
  } catch (rawError) {
    const error = rawError instanceof ProfileCutoverError
      ? rawError
      : new ProfileCutoverError(rawError.message || 'profile cutover evaluation failed');
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      decision: 'hold_guided',
      authority_status: 'advisory_only',
      reason: error.code,
    })}\n`);
    return error.code === 'INVALID_ARGUMENT' ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = run();

module.exports = {
  parseArgs,
  readSnapshot,
  run,
};
