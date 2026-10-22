#!/usr/bin/env node
'use strict';

// review-ledger-archive.js — import a hetero-review ledger into the opt-in archive, or print status.
//
// Subcommands:
//   import --ledger <dir> [--repo <dir>]
//       Copy report files (chain.json, findings.json, dispositions.json, seat-*.json,
//       range.json per g<n>, receipt-<phase>.json; diff.txt only when include_diff is on)
//       into layout A. imported_from is the source realpath. A second import of the
//       same ledger changes nothing.
//   status
//       Print ledger count, byte size, and the archive root. When the byte size is
//       over warn_mb, print a warning. The warning never blocks. When the archive
//       directory is unset, print that the archive is off and exit 0.
//   rotate, prune
//       Later phase. This round prints a one-line usage error.
//
// Directory: AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR, else review_ledger_archive.dir
// from the operator config. Empty or unset means off. include_diff:
// AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF (default false). warn_mb:
// AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB (default 500).
// Plan: docs/plans/2026-10-22-review-ledger-retention.md
//
// Exit codes:
//   0  success, including status when the archive is off
//   1  operational error (caught here; the library throws)
//   2  usage: missing --ledger, unknown flag, unknown subcommand, rotate, or prune
//
// Usage: node scripts/review-ledger-archive.js <import|status> [--ledger <dir>] [--repo <dir>]

const { copyLedger, describeArchive } = require('./lib/review-ledger-copy');

function help() {
  const lines = [];
  for (const line of require('fs').readFileSync(__filename, 'utf8').split('\n')) {
    if (line.startsWith('//')) lines.push(line.replace(/^\/\/ ?/, ''));
    else if (lines.length) break;
  }
  console.log(lines.join('\n').trim());
}

function usage(msg) {
  console.error(`review-ledger-archive: ${msg} (usage: import --ledger <dir> [--repo <dir>] | status)`);
  process.exit(2);
}

function fail(err) {
  console.error(`review-ledger-archive: ${err && err.message ? err.message : err}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { cmd: null, ledger: null, repo: null };
  const rest = argv.slice();
  if (rest.length === 0) usage('missing subcommand');
  out.cmd = rest.shift();
  while (rest.length) {
    const a = rest.shift();
    if (a === '--ledger') {
      if (!rest.length) usage('missing value for --ledger');
      out.ledger = rest.shift();
    } else if (a === '--repo') {
      if (!rest.length) usage('missing value for --repo');
      out.repo = rest.shift();
    } else {
      usage(`unknown argument ${a}`);
    }
  }
  return out;
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    help();
    return 0;
  }
  const args = parseArgs(argv);
  if (args.cmd === 'rotate' || args.cmd === 'prune') {
    usage(`${args.cmd} is not available yet`);
  }
  if (args.cmd === 'status') {
    if (args.ledger || args.repo) usage('status takes no flags');
    const described = describeArchive();
    if (described.off) {
      console.log('review-ledger-archive: archive is off');
      return 0;
    }
    console.log(`archive: ${described.dir}`);
    console.log(`ledgers: ${described.ledgers}`);
    console.log(`bytes: ${described.bytes}`);
    if (described.warn) {
      console.log(`review-ledger-archive: warning: ${described.bytes} bytes is over warn_mb ${described.warnMb}`);
    }
    return 0;
  }
  if (args.cmd === 'import') {
    if (!args.ledger) usage('import requires --ledger <dir>');
    const fs = require('fs');
    const path = require('path');
    const ledgerDir = path.resolve(args.ledger);
    if (!fs.existsSync(ledgerDir)) {
      console.error(`review-ledger-archive: ledger not found: ${ledgerDir}`);
      return 1;
    }
    const importedFrom = fs.realpathSync(ledgerDir);
    const result = copyLedger({
      ledgerDir,
      repoDir: args.repo ? path.resolve(args.repo) : process.cwd(),
      importedFrom,
    });
    if (!result.copied) {
      console.error('review-ledger-archive: archive is off');
      return 1;
    }
    for (const name of result.skipped || []) {
      console.error(`review-ledger-archive: skipped ${name}`);
    }
    console.log(result.dest);
    return 0;
  }
  usage(`unknown subcommand ${args.cmd}`);
  return 2;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    fail(err);
  }
}

module.exports = { main };
