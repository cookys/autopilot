#!/usr/bin/env node
'use strict';

// runner-pin-check.js — read-only drift gate for config/runner-pins.json.
//
// Usage:
//   node scripts/runner-pin-check.js [--json] [--pins <path>] [--help]
//
// Default output: one JSON line per runner:
//   {"runner":"...","pinned":"...","actual":"...","drift":false,"autoupdate_state":"..."}
// With --json: one JSON document:
//   {"schema":"autopilot.runner-pins/1","ok":true,"drift":false,"runners":[...]}
//
// Exit codes:
//   0 = no installed runner drifted
//   1 = at least one installed runner drifted (or an unpinned runner appeared)
//   2 = usage error or unreadable/invalid pin table
//
// Never modifies any file, binary, or runner configuration. Node built-ins only.

const path = require('path');
const {
  PIN_SCHEMA,
  DEFAULT_PINS_PATH,
  loadPinTable,
  checkAllPins,
} = require('./lib/runner-pins.js');

function usage(code) {
  const text = [
    'Usage: node scripts/runner-pin-check.js [--json] [--pins <path>] [--help]',
    '',
    'Options:',
    '  --json          Emit a single JSON document instead of one JSON line per runner.',
    '  --pins <path>   Override path to config/runner-pins.json.',
    '  -h, --help      Print this help message.',
    '',
    'Exit: 0 no drift | 1 drift detected | 2 usage or table validation error.',
  ].join('\n');
  (code === 0 ? process.stdout : process.stderr).write(`${text}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { json: false, pinsPath: DEFAULT_PINS_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--pins') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.pinsPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      usage(0);
    } else {
      process.stderr.write(`runner-pin-check: unknown argument: ${arg}\n`);
      usage(2);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let table;
  try {
    table = loadPinTable(opts.pinsPath);
  } catch (err) {
    process.stderr.write(`runner-pin-check: ${err.message}\n`);
    process.exit(2);
  }

  const report = checkAllPins(table);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({
      schema: PIN_SCHEMA,
      ok: report.ok,
      drift: report.drift,
      runners: report.rows,
    }, null, 2)}\n`);
  } else {
    for (const row of report.rows) {
      process.stdout.write(`${JSON.stringify(row)}\n`);
    }
  }
  process.exit(report.drift ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs };
