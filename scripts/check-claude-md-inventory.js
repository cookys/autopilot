#!/usr/bin/env node
'use strict';

// check-claude-md-inventory.js — membership + size gate for CLAUDE.md.
//
// Membership: every shipped script basename must be NAMED somewhere in CLAUDE.md,
// so the "Scripts inventory" table cannot silently fall behind scripts/. A new
// script that is dead code (undiscoverable by future sessions) fails this check.
//
// Size: CLAUDE.md is loaded in FULL into every session in this repo (including
// every dispatched foreman/leaf), and the harness warns past 40k chars. History
// shows the failure mode: release commits appending per-version behavior notes to
// inventory rows grew the file 11KB → 81KB in six weeks (2026-06/07) with no gate
// pushing back. So this gate also enforces:
//   - whole-file byte cap (default 40000 — the harness warning threshold)
//   - per-line byte cap  (default 800 — an inventory row is an index entry:
//     what it does + when to call it + pointer; version history belongs in
//     CHANGELOG.md, details in references/ or the script header)
//
// Scope (matches scripts/sync-manifest.json check-claude-md-inventory row):
//   - scripts/*.sh and scripts/*.js  (excluding *.test.sh / *.test.js)
//   - scripts/lib/*                   (every file, excluding *.test.*)
// A basename "appears" if its exact string is a substring of CLAUDE.md.
//
// Usage:  node scripts/check-claude-md-inventory.js [--json]
//                 [--max-total-bytes N] [--max-line-bytes N]
// Exit:   0 = all listed + within caps; 1 = violation(s); 2 = usage/env error.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MAX_TOTAL_BYTES = 40000;
const DEFAULT_MAX_LINE_BYTES = 800;

function usage() {
  process.stdout.write(
    'Usage: node scripts/check-claude-md-inventory.js [--json] ' +
    '[--max-total-bytes N] [--max-line-bytes N]\n' +
    '  Assert every scripts/*.{sh,js} + scripts/lib/* basename is named in CLAUDE.md,\n' +
    `  CLAUDE.md stays under the whole-file byte cap (default ${DEFAULT_MAX_TOTAL_BYTES}),\n` +
    `  and no single line exceeds the per-line byte cap (default ${DEFAULT_MAX_LINE_BYTES}).\n` +
    '  Exit 0 = clean, 1 = violation(s), 2 = usage/env error.\n');
}

function isTest(name) {
  return /\.test\.(sh|js)$/.test(name);
}

function collect() {
  const names = [];
  const scriptsDir = path.join(REPO_ROOT, 'scripts');
  for (const f of fs.readdirSync(scriptsDir)) {
    if (!/\.(sh|js)$/.test(f)) continue;
    if (isTest(f)) continue;
    const p = path.join(scriptsDir, f);
    if (!fs.statSync(p).isFile()) continue;
    names.push('scripts/' + f);
  }
  const libDir = path.join(scriptsDir, 'lib');
  if (fs.existsSync(libDir)) {
    for (const f of fs.readdirSync(libDir)) {
      if (isTest(f)) continue;
      const p = path.join(libDir, f);
      if (!fs.statSync(p).isFile()) continue;
      names.push('scripts/lib/' + f);
    }
  }
  return names.sort();
}

function parseIntArg(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const v = Number.parseInt(args[i + 1], 10);
  if (!Number.isFinite(v) || v <= 0) {
    process.stderr.write(`${flag} requires a positive integer\n`);
    process.exit(2);
  }
  args.splice(i, 2);
  return v;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { usage(); process.exit(0); }
  const maxTotalBytes = parseIntArg(args, '--max-total-bytes') || DEFAULT_MAX_TOTAL_BYTES;
  const maxLineBytes = parseIntArg(args, '--max-line-bytes') || DEFAULT_MAX_LINE_BYTES;
  const json = args.includes('--json');
  for (const a of args) {
    if (a !== '--json') { process.stderr.write(`unknown arg: ${a}\n`); process.exit(2); }
  }

  const claudeMdPath = path.join(REPO_ROOT, 'CLAUDE.md');
  let text;
  try {
    text = fs.readFileSync(claudeMdPath, 'utf8');
  } catch (e) {
    process.stderr.write(`cannot read CLAUDE.md: ${e.message}\n`);
    process.exit(2);
  }

  const scripts = collect();
  const missing = [];
  for (const rel of scripts) {
    const base = path.basename(rel);
    if (!text.includes(base)) missing.push(rel);
  }

  const totalBytes = Buffer.byteLength(text, 'utf8');
  const longLines = [];
  text.split('\n').forEach((line, idx) => {
    const bytes = Buffer.byteLength(line, 'utf8');
    if (bytes > maxLineBytes) longLines.push({ line: idx + 1, bytes });
  });

  const ok = missing.length === 0 && totalBytes <= maxTotalBytes && longLines.length === 0;

  if (json) {
    process.stdout.write(JSON.stringify({
      ok,
      checked: scripts.length,
      missing,
      total_bytes: totalBytes,
      max_total_bytes: maxTotalBytes,
      long_lines: longLines,
      max_line_bytes: maxLineBytes,
    }) + '\n');
  } else {
    if (missing.length === 0) {
      process.stdout.write(`CLAUDE.md inventory: all ${scripts.length} scripts named\n`);
    } else {
      process.stderr.write(
        `CLAUDE.md inventory drift: ${missing.length} script(s) not named in CLAUDE.md:\n`);
      for (const m of missing) process.stderr.write(`  - ${m}\n`);
      process.stderr.write(
        'To fix: add a row (or inline mention) for each to the CLAUDE.md "Scripts inventory" table.\n');
    }
    if (totalBytes > maxTotalBytes) {
      process.stderr.write(
        `CLAUDE.md size: ${totalBytes} bytes exceeds the ${maxTotalBytes}-byte cap ` +
        '(the harness loads this file in full every session and warns past 40k).\n');
    } else {
      process.stdout.write(`CLAUDE.md size: ${totalBytes}/${maxTotalBytes} bytes\n`);
    }
    if (longLines.length > 0) {
      process.stderr.write(
        `CLAUDE.md line cap: ${longLines.length} line(s) exceed ${maxLineBytes} bytes:\n`);
      for (const l of longLines) process.stderr.write(`  - line ${l.line}: ${l.bytes} bytes\n`);
    }
    if (totalBytes > maxTotalBytes || longLines.length > 0) {
      process.stderr.write(
        'To fix: trim the row to an index entry (what it does + when to call it + pointer). ' +
        'Version history belongs in CHANGELOG.md; details in references/ or the script header.\n');
    }
  }

  process.exit(ok ? 0 : 1);
}

main();
