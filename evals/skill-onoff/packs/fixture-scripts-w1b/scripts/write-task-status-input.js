#!/usr/bin/env node
'use strict';

// write-task-status-input.js — (re)write the `autopilot status task` input bundle
// for one root run from real state (ledger, Mission store, work orders, git).
//
// Usage:
//   node scripts/write-task-status-input.js --repo <dir> --root-run-id <id> \
//     [--terminal-receipt <file>] [--contract <file>]... [--goal <text>] \
//     [--merge-preflight <file>] [--merge-execution <file>] [--merge-provenance <file>] \
//     [--target-ref <ref>] [--remote-ref <ref>] [--consumer-ref <ref>] [--print]
//
// Writes ${AUTOPILOT_TASK_STATUS_DIR:-${TMPDIR:-/tmp}/autopilot-task-status}/<root>.json
// atomically and prints the path. The engine already calls the same module at
// every managed-campaign terminal (src/status/task-status-input.js); run this
// after a merge to fold in merge receipts (record-integration.js output) and
// re-derive the integration refs. The bundle carries no verdicts: the reader
// recomputes everything.
//
// Exit: 0 = written; 2 = invalid arguments, unsafe root id, or not a git repo.

const fs = require('fs');
const path = require('path');
const { refreshTaskStatusInput } = require('../src/status/task-status-input');

const VALUE_FLAGS = new Set([
  'repo', 'root-run-id', 'terminal-receipt', 'contract', 'goal',
  'merge-preflight', 'merge-execution', 'merge-provenance',
  'target-ref', 'remote-ref', 'consumer-ref',
]);

function usage() {
  process.stderr.write(
    'Usage: write-task-status-input.js --repo <dir> --root-run-id <id> '
    + '[--terminal-receipt <file>] [--contract <file>]... [--goal <text>] '
    + '[--merge-preflight|--merge-execution|--merge-provenance <file>] '
    + '[--target-ref <ref>] [--remote-ref <ref>] [--consumer-ref <ref>] [--print]\n',
  );
}

function parse(argv) {
  const options = { contract: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--print') { options.print = true; continue; }
    if (!flag.startsWith('--') || !VALUE_FLAGS.has(flag.slice(2)) || argv[index + 1] === undefined) {
      throw new Error(`unknown or incomplete option: ${flag}`);
    }
    const key = flag.slice(2);
    const value = argv[index + 1];
    index += 1;
    if (key === 'contract') { options.contract.push(path.resolve(value)); continue; }
    if (Object.prototype.hasOwnProperty.call(options, key)) throw new Error(`duplicate option: ${flag}`);
    options[key] = value;
  }
  if (!options.repo) throw new Error('--repo is required');
  if (!options['root-run-id']) throw new Error('--root-run-id is required');
  return options;
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} unreadable: ${error.message}`);
  }
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { usage(); return 0; }
  let options;
  try {
    options = parse(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    usage();
    return 2;
  }
  try {
    const terminalReceipts = {};
    if (options['terminal-receipt']) {
      const receipt = readJson(options['terminal-receipt'], '--terminal-receipt');
      // Keyed by campaign: the producer matches it to the ledger by digest, so a
      // receipt for another campaign simply never binds.
      terminalReceipts['*'] = receipt;
    }
    const optional = (key) => (options[key] ? readJson(options[key], `--${key}`) : null);
    const result = refreshTaskStatusInput({
      repo: options.repo,
      rootRunId: options['root-run-id'],
      goal: options.goal === undefined ? null : options.goal,
      terminalReceipts,
      contractFiles: options.contract,
      mergePreflight: optional('merge-preflight'),
      mergeExecution: optional('merge-execution'),
      mergeProvenance: optional('merge-provenance'),
      integration: {
        targetRef: options['target-ref'],
        remoteRef: options['remote-ref'],
        consumerRef: options['consumer-ref'],
      },
    });
    process.stdout.write(options.print
      ? `${JSON.stringify(result.bundle, null, 2)}\n`
      : `${result.path}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`write-task-status-input: ${error.code || 'error'}: ${error.message}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
