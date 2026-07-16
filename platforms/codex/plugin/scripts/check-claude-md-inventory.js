#!/usr/bin/env node
'use strict';

// check-claude-md-inventory.js — membership gate for the CLAUDE.md scripts inventory.
//
// Asserts that every shipped script basename is NAMED somewhere in CLAUDE.md, so the
// ~80-row "Scripts inventory" table cannot silently fall behind scripts/. A new script
// that is dead code (undiscoverable by future sessions) fails this check.
//
// Scope (matches scripts/sync-manifest.json check-claude-md-inventory row):
//   - scripts/*.sh and scripts/*.js  (excluding *.test.sh / *.test.js)
//   - scripts/lib/*                   (every file, excluding *.test.*)
// A basename "appears" if its exact string is a substring of CLAUDE.md.
//
// Usage:  node scripts/check-claude-md-inventory.js [--json]
// Exit:   0 = all listed; 1 = one or more unlisted; 2 = usage/env error.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function usage() {
  process.stdout.write(
    'Usage: node scripts/check-claude-md-inventory.js [--json]\n' +
    '  Assert every scripts/*.{sh,js} + scripts/lib/* basename is named in CLAUDE.md.\n' +
    '  Exit 0 = all listed, 1 = unlisted found, 2 = usage/env error.\n');
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

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { usage(); process.exit(0); }
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

  if (json) {
    process.stdout.write(JSON.stringify({
      ok: missing.length === 0,
      checked: scripts.length,
      missing,
    }) + '\n');
  } else if (missing.length === 0) {
    process.stdout.write(`CLAUDE.md inventory: all ${scripts.length} scripts named\n`);
  } else {
    process.stderr.write(
      `CLAUDE.md inventory drift: ${missing.length} script(s) not named in CLAUDE.md:\n`);
    for (const m of missing) process.stderr.write(`  - ${m}\n`);
    process.stderr.write(
      'To fix: add a row (or inline mention) for each to the CLAUDE.md "Scripts inventory" table.\n');
  }

  process.exit(missing.length === 0 ? 0 : 1);
}

main();
