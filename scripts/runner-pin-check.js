#!/usr/bin/env node
'use strict';

// runner-pin-check.js — read-only version gate for config/runner-pins.json (v2)
// and host-local overlay ${AUTOPILOT_RUNNER_VETTED_FILE:-$HOME/.autopilot/runner-vetted.json}.
//
// Usage:
//   node scripts/runner-pin-check.js [--json] [--pins <path>] [--vetted <path>] [--help]
//   node scripts/runner-pin-check.js [--pins <path>] --suggest-table <overlay files...>
//
// Default output: one JSON line per runner:
//   {"runner":"...","actual":"...","status":"absent|vetted|unvetted","drift":false,"vetted_source":"table|overlay"|null,"autoupdate_state":"..."}
// With --json: one JSON document:
//   {"schema":"autopilot.runner-pins/2","ok":true,"drift":false,"runners":[...]}
// With --suggest-table <overlay files...>: prints a v2 table whose vetted lists
//   are the union of the given host overlays (read-only).
//
// Exit codes:
//   0 = no installed runner is unvetted (or --suggest-table succeeded)
//   1 = at least one installed runner is unvetted
//   2 = usage error or unreadable/invalid pin table or overlay
//
// Never modifies any file, binary, or runner configuration. Node built-ins only.

const path = require('path');
const {
  PIN_SCHEMA,
  DEFAULT_PINS_PATH,
  loadPinTable,
  checkAllPins,
  suggestPinTable,
} = require('./lib/runner-pins.js');

function usage(code) {
  const text = [
    'Usage:',
    '  node scripts/runner-pin-check.js [--json] [--pins <path>] [--vetted <path>] [--help]',
    '  node scripts/runner-pin-check.js [--pins <path>] --suggest-table <overlay files...>',
    '',
    'Options:',
    '  --json                        Emit a single JSON document instead of JSONL.',
    '  --pins <path>                 Override path to config/runner-pins.json.',
    '  --vetted <path>               Override host overlay path (else AUTOPILOT_RUNNER_VETTED_FILE or ~/.autopilot/runner-vetted.json).',
    '  --suggest-table <files...>    Print a v2 table unioning the given overlay files (read-only).',
    '  -h, --help                    Print this help message.',
    '',
    'Exit: 0 all installed vetted | 1 unvetted runner detected | 2 usage or validation error.',
  ].join('\n');
  (code === 0 ? process.stdout : process.stderr).write(`${text}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    json: false,
    pinsPath: DEFAULT_PINS_PATH,
    vettedPath: null,
    suggestTable: false,
    overlayFiles: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--pins') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.pinsPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--vetted') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.vettedPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--suggest-table') {
      opts.suggestTable = true;
      while (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        opts.overlayFiles.push(path.resolve(argv[i + 1]));
        i += 1;
      }
    } else if (arg === '-h' || arg === '--help') {
      usage(0);
    } else {
      process.stderr.write(`runner-pin-check: unknown argument: ${arg}\n`);
      usage(2);
    }
  }
  if (opts.suggestTable && opts.overlayFiles.length === 0) {
    process.stderr.write('runner-pin-check: --suggest-table requires at least one overlay file\n');
    usage(2);
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

  if (opts.suggestTable) {
    let suggested;
    try {
      suggested = suggestPinTable(table, opts.overlayFiles);
    } catch (err) {
      process.stderr.write(`runner-pin-check: ${err.message}\n`);
      process.exit(2);
    }
    process.stdout.write(`${JSON.stringify(suggested, null, 2)}\n`);
    process.exit(0);
  }

  let report;
  try {
    report = checkAllPins(table, { vettedPath: opts.vettedPath });
  } catch (err) {
    process.stderr.write(`runner-pin-check: ${err.message}\n`);
    process.exit(2);
  }

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
