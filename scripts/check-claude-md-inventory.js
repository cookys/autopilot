#!/usr/bin/env node
'use strict';

// check-claude-md-inventory.js — membership + size gate for the CLAUDE.md entry docs.
//
// Membership: every shipped script basename must be NAMED somewhere in scripts/CLAUDE.md
// (BL-0383 option A: the grouped name list lives in the subdirectory file, which Claude
// Code loads when a session touches scripts/), so the inventory cannot silently fall
// behind scripts/. A new script that is dead code (undiscoverable by future sessions)
// fails this check. The root CLAUDE.md is NOT searched: a name there does not count.
//
// Size: the root CLAUDE.md and AGENTS.md are loaded in FULL into every session in this
// repo (including every dispatched foreman/leaf). History shows the failure mode: release
// commits appending per-version behavior notes to inventory rows grew the file 11KB → 81KB
// in six weeks (2026-06/07) with no gate pushing back; BL-0383 then split the entry docs.
// So this gate enforces:
//   - root CLAUDE.md byte cap   (default 10240 — the entry-doc target)
//   - root AGENTS.md byte cap   (default 10240)
//   - scripts/CLAUDE.md byte cap (default 40000 — the harness warning threshold)
//   - per-line byte cap on root CLAUDE.md and scripts/CLAUDE.md (default 800 — a row is an
//     index entry: what it does + when to call it + pointer; version history belongs in
//     CHANGELOG.md, details in references/ or the script header)
//
// Scope (matches scripts/sync-manifest.json check-claude-md-inventory row):
//   - scripts/*.sh and scripts/*.js  (excluding *.test.sh / *.test.js)
//   - scripts/lib/*                   (every file, excluding *.test.*)
// A basename "appears" if its exact string is a substring of scripts/CLAUDE.md.
//
// Usage:  node scripts/check-claude-md-inventory.js [--json]
//                 [--max-total-bytes N] [--max-line-bytes N]
//                 [--max-root-bytes N] [--max-agents-bytes N]
// Exit:   0 = all listed + within caps; 1 = violation(s); 2 = usage/env error.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MAX_TOTAL_BYTES = 40000;
const DEFAULT_MAX_LINE_BYTES = 800;
const DEFAULT_MAX_ROOT_BYTES = 10240;
const DEFAULT_MAX_AGENTS_BYTES = 10240;

function usage() {
  process.stdout.write(
    'Usage: node scripts/check-claude-md-inventory.js [--json] ' +
    '[--max-total-bytes N] [--max-line-bytes N] [--max-root-bytes N] [--max-agents-bytes N]\n' +
    '  Assert every scripts/*.{sh,js} + scripts/lib/* basename is named in scripts/CLAUDE.md,\n' +
    `  scripts/CLAUDE.md stays under the whole-file byte cap (default ${DEFAULT_MAX_TOTAL_BYTES}),\n` +
    `  root CLAUDE.md under ${DEFAULT_MAX_ROOT_BYTES} and root AGENTS.md under ${DEFAULT_MAX_AGENTS_BYTES} bytes,\n` +
    `  and no single line of either CLAUDE.md exceeds the per-line byte cap (default ${DEFAULT_MAX_LINE_BYTES}).\n` +
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
  const maxRootBytes = parseIntArg(args, '--max-root-bytes') || DEFAULT_MAX_ROOT_BYTES;
  const maxAgentsBytes = parseIntArg(args, '--max-agents-bytes') || DEFAULT_MAX_AGENTS_BYTES;
  const json = args.includes('--json');
  for (const a of args) {
    if (a !== '--json') { process.stderr.write(`unknown arg: ${a}\n`); process.exit(2); }
  }

  const readOrDie = (rel) => {
    try {
      return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    } catch (e) {
      process.stderr.write(`cannot read ${rel}: ${e.message}\n`);
      process.exit(2);
    }
    return null;
  };
  const rootText = readOrDie('CLAUDE.md');
  const agentsText = readOrDie('AGENTS.md');
  const text = readOrDie('scripts/CLAUDE.md'); // the grouped name list (membership source)

  // The per-script DESCRIPTIONS live in docs/scripts-inventory.md; CLAUDE.md keeps
  // only the grouped name list. Both need the membership check, and the second one
  // is easy to forget: when the table moved out of CLAUDE.md this gate stayed
  // behind, so for a while a script could be missing from the inventory entirely
  // without failing anything.
  const inventoryPath = path.join(REPO_ROOT, require('./lib/repo-layout.js').path('scripts_inventory_doc'));
  let inventoryText = null;
  try {
    inventoryText = fs.readFileSync(inventoryPath, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') {
      process.stderr.write(`cannot read docs/scripts-inventory.md: ${e.message}\n`);
      process.exit(2);
    }
  }

  const scripts = collect();
  const missing = [];
  const missingFromInventory = [];
  for (const rel of scripts) {
    const base = path.basename(rel);
    if (!text.includes(base)) missing.push(rel);
    if (inventoryText !== null && !inventoryText.includes(base)) missingFromInventory.push(rel);
  }

  const totalBytes = Buffer.byteLength(text, 'utf8');
  const rootBytes = Buffer.byteLength(rootText, 'utf8');
  const agentsBytes = Buffer.byteLength(agentsText, 'utf8');
  const longLines = [];
  for (const [file, body] of [['CLAUDE.md', rootText], ['scripts/CLAUDE.md', text]]) {
    body.split('\n').forEach((line, idx) => {
      const bytes = Buffer.byteLength(line, 'utf8');
      if (bytes > maxLineBytes) longLines.push({ file, line: idx + 1, bytes });
    });
  }

  // F5: an absent inventory file is red. It used to pass silently, which let the whole
  // description-table check go dark the moment the file moved or was deleted.
  const inventoryMissing = inventoryText === null;
  const ok = missing.length === 0 && missingFromInventory.length === 0 && !inventoryMissing
    && totalBytes <= maxTotalBytes && rootBytes <= maxRootBytes && agentsBytes <= maxAgentsBytes
    && longLines.length === 0;

  if (json) {
    process.stdout.write(JSON.stringify({
      ok,
      checked: scripts.length,
      missing,
      missing_from_inventory: missingFromInventory,
      inventory_present: inventoryText !== null,
      total_bytes: totalBytes,
      max_total_bytes: maxTotalBytes,
      root_claude_bytes: rootBytes,
      max_root_bytes: maxRootBytes,
      root_agents_bytes: agentsBytes,
      max_agents_bytes: maxAgentsBytes,
      long_lines: longLines,
      max_line_bytes: maxLineBytes,
    }) + '\n');
  } else {
    if (missing.length === 0) {
      process.stdout.write(`CLAUDE.md inventory: all ${scripts.length} scripts named in scripts/CLAUDE.md\n`);
    } else {
      process.stderr.write(
        `CLAUDE.md inventory drift: ${missing.length} script(s) not named in scripts/CLAUDE.md:\n`);
      for (const m of missing) process.stderr.write(`  - ${m}\n`);
      process.stderr.write(
        'To fix: add each basename to the matching group in scripts/CLAUDE.md (the root CLAUDE.md is not searched).\n');
    }
    if (inventoryText === null) {
      process.stderr.write('docs/scripts-inventory.md is MISSING — the description table is the canonical index; the check cannot pass without it.\n');
    } else if (missingFromInventory.length === 0) {
      process.stdout.write(`docs/scripts-inventory.md: all ${scripts.length} scripts described\n`);
    } else {
      process.stderr.write(
        `docs/scripts-inventory.md drift: ${missingFromInventory.length} script(s) have no row:\n`);
      for (const m of missingFromInventory) process.stderr.write(`  - ${m}\n`);
      process.stderr.write(
        'To fix: add a row (what it does / when to call it / pointer to its contract).\n');
    }
    if (totalBytes > maxTotalBytes) {
      process.stderr.write(
        `scripts/CLAUDE.md size: ${totalBytes} bytes exceeds the ${maxTotalBytes}-byte cap ` +
        '(the harness warns past 40k).\n');
    } else {
      process.stdout.write(`scripts/CLAUDE.md size: ${totalBytes}/${maxTotalBytes} bytes\n`);
    }
    for (const [label, bytes, cap] of [['root CLAUDE.md', rootBytes, maxRootBytes], ['root AGENTS.md', agentsBytes, maxAgentsBytes]]) {
      if (bytes > cap) {
        process.stderr.write(
          `${label} size: ${bytes} bytes exceeds the ${cap}-byte cap ` +
          '(entry docs load in full every session; move domain detail to a subdirectory CLAUDE.md).\n');
      } else {
        process.stdout.write(`${label} size: ${bytes}/${cap} bytes\n`);
      }
    }
    if (longLines.length > 0) {
      process.stderr.write(
        `CLAUDE.md line cap: ${longLines.length} line(s) exceed ${maxLineBytes} bytes:\n`);
      for (const l of longLines) process.stderr.write(`  - ${l.file} line ${l.line}: ${l.bytes} bytes\n`);
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
