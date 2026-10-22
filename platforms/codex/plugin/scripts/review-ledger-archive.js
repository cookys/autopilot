#!/usr/bin/env node
'use strict';

// review-ledger-archive.js — import a hetero-review ledger into the opt-in archive, or print status.
//
// Subcommands:
//   import --ledger <dir> [--repo <dir>] [--phase <name>]
//       Copy report files (chain.json, findings.json, dispositions.json, seat-*.json,
//       range.json per g<n>, receipt-<phase>.json; diff.txt only when include_diff is on)
//       into layout A. imported_from is the source realpath. A second import of the
//       same ledger changes nothing.
//   status
//       Print ledger count, byte size, and the archive root. When the byte size is
//       over warn_mb, print a warning. The warning never blocks. Also print how many
//       month directories are already old enough to rotate and not yet compressed.
//       When that count is above zero, print "run: review-ledger-archive.js rotate".
//       The hint never changes the exit code. When the archive directory is unset,
//       print that the archive is off and exit 0.
//   rotate
//       Compress complete month directories strictly older than rotate_after_months
//       (default 2) into <bucket>/<YYYY-MM>.tar.gz. List the archive back and keep
//       it only when the regular-file count matches. Delete the month directory only
//       when rotate_remove_source is true. Manual. Not called from a hook.
//       No archive dir: print "archive is off" on stderr and exit 1.
//   prune --older-than <N>m [--execute]
//       Delete month directories and month tars strictly older than N local
//       calendar months. Dry-run is the default: print each path, delete
//       nothing. --execute deletes, under the repo bucket lock. A target whose
//       realpath is not strictly inside the archive dir, or a target that is
//       itself a symlink, is refused: one line on stderr, exit 1, nothing
//       deleted. Manual. Not called from a hook.
//
// Directory: AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR, else review_ledger_archive.dir
// from the operator config. Empty or unset means off. include_diff:
// AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF (default false). warn_mb:
// AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB (default 500). rotate_after_months:
// AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_AFTER_MONTHS (default 2).
// rotate_remove_source: AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE
// (default false). AUTOPILOT_TEST_NOW is a local ISO date, honoured only when
// AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_NOW=1.
// Plan: docs/plans/2026-10-22-review-ledger-retention.md
//
// Exit codes:
//   0  success, including status when the archive is off
//   1  operational error (caught here; the library throws)
//   2  usage: missing --ledger, unknown flag, unknown subcommand, or a bad --older-than
//
// Usage: node scripts/review-ledger-archive.js <import|status> [--ledger <dir>] [--repo <dir>] [--phase <name>]

const fs = require('fs');
const path = require('path');
const { copyLedger, describeArchive, resolveArchiveConfig } = require('./lib/review-ledger-copy');
const { listRotatableMonths, rotateArchive, pruneArchive } = require('./lib/review-ledger-tar');

function resolveNow() {
  if (process.env.AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_NOW !== '1') return new Date();
  const raw = process.env.AUTOPILOT_TEST_NOW;
  if (!raw) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function phaseTokenUnsafe(name) {
  const s = String(name);
  return s === '' || path.isAbsolute(s) || s.includes('/') || s.includes('\\') || s.includes('..');
}

// W_OK on the archive root, or on the nearest existing ancestor when the
// root does not exist yet. Does not create or chmod anything.
function archiveRootWritable(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    try {
      fs.accessSync(cur, fs.constants.W_OK);
      return true;
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        const parent = path.dirname(cur);
        if (parent === cur) return false;
        cur = parent;
        continue;
      }
      return false;
    }
  }
}

function help() {
  const lines = [];
  for (const line of require('fs').readFileSync(__filename, 'utf8').split('\n')) {
    if (line.startsWith('//')) lines.push(line.replace(/^\/\/ ?/, ''));
    else if (lines.length) break;
  }
  console.log(lines.join('\n').trim());
}

function usage(msg) {
  console.error(`review-ledger-archive: ${msg} (usage: import --ledger <dir> [--repo <dir>] [--phase <name>] | status)`);
  process.exit(2);
}

function fail(err) {
  console.error(`review-ledger-archive: ${err && err.message ? err.message : err}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { cmd: null, ledger: null, repo: null, phases: null, unsafePhase: false, execute: false, olderThan: null, targets: null };
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
    } else if (a === '--phase') {
      if (!rest.length) usage('missing value for --phase');
      const name = rest.shift();
      if (phaseTokenUnsafe(name)) out.unsafePhase = true;
      if (!out.phases) out.phases = [];
      out.phases.push(name);
    } else if (a === '--older-than') {
      if (!rest.length) usage('missing value for --older-than');
      const raw = rest.shift();
      const m = /^([1-9]\d*)m$/.exec(raw);
      if (!m) usage(`malformed --older-than ${raw}`);
      out.olderThan = Number(m[1]);
    } else if (a === '--execute') {
      out.execute = true;
    } else if (a === '--target') {
      if (process.env.AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_PRUNE_TARGET !== '1') {
        usage('unknown argument --target');
      }
      if (!rest.length) usage('missing value for --target');
      if (!out.targets) out.targets = [];
      out.targets.push(rest.shift());
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
  if (args.cmd === 'prune') {
    if (args.ledger || args.repo || args.phases) usage('prune does not take --ledger, --repo, or --phase');
    if (args.olderThan == null) usage('prune requires --older-than <N>m');
    const cfg = resolveArchiveConfig();
    if (!cfg.dir) {
      console.error('review-ledger-archive: archive is off');
      return 1;
    }
    const result = pruneArchive({
      dir: cfg.dir,
      now: resolveNow(),
      olderThanMonths: args.olderThan,
      execute: args.execute === true,
      targets: args.targets || [],
    });
    for (const line of result.refusals) console.error(line);
    if (result.refusals.length) return 1;
    for (const line of result.lines) console.log(line);
    return 0;
  }
  if (args.cmd === 'rotate') {
    if (args.ledger || args.repo || args.phases || args.execute || args.olderThan != null || args.targets) {
      usage('rotate takes no flags');
    }
    let cfg;
    try {
      cfg = resolveArchiveConfig();
    } catch (err) {
      throw err;
    }
    if (!cfg.dir) {
      console.error('review-ledger-archive: archive is off');
      return 1;
    }
    const result = rotateArchive({
      dir: cfg.dir,
      now: resolveNow(),
      rotateAfterMonths: cfg.rotateAfterMonths,
      rotateRemoveSource: cfg.rotateRemoveSource,
    });
    for (const line of result.warnings) console.error(line);
    for (const line of result.lines) console.log(line);
    return 0;
  }
  if (args.cmd === 'status') {
    if (args.ledger || args.repo || args.phases || args.execute || args.olderThan != null || args.targets) {
      usage('status takes no flags');
    }
    let described;
    try {
      described = describeArchive();
    } catch (err) {
      if (err && typeof err.message === 'string' && err.message.indexOf('misconfigured') !== -1) {
        console.error(`review-ledger-archive: ${err.message}`);
        return 0;
      }
      throw err;
    }
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
    let cfg = null;
    try { cfg = resolveArchiveConfig(); } catch (_e) { cfg = null; }
    const months = cfg ? cfg.rotateAfterMonths : 2;
    const rotatable = listRotatableMonths(described.dir, resolveNow(), months);
    console.log(`rotatable months: ${rotatable.length}`);
    if (rotatable.length > 0) console.log('run: review-ledger-archive.js rotate');
    return 0;
  }
  if (args.cmd === 'import') {
    if (args.unsafePhase) {
      console.error('review-ledger-archive: unsafe phase name');
      return 1;
    }
    if (!args.ledger) usage('import requires --ledger <dir>');
    const cfg = resolveArchiveConfig();
    if (cfg.dir && !archiveRootWritable(cfg.dir)) {
      console.error('review-ledger-archive: archive root is not writable');
      return 1;
    }
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
      phases: args.phases || undefined,
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
