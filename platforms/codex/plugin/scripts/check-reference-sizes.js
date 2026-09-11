#!/usr/bin/env node
'use strict';

// check-reference-sizes.js — numbered-size gate for skills/*/references/*.md.
//
// WHY this gate exists:
// In 2026-09, `skills/ceo-agent/references/level-front-door.md` grew past the
// Claude Code Read tool's whole-file truncation cap (~60–64 KB as the tool returns
// it, line-numbered) and had to be split. When a file exceeds that cap, 81–97% of
// whole-file reads return truncated content without an explicit error, turning a
// MUST-READ reference file silently unreadable in one call.
//
// This script enforces a hard cap of 49152 numbered bytes (48 KB) across all
// `skills/*/references/*.md` files so that growth fails loudly in CI / invariants
// checks instead of manifesting as silent truncation during an active session.
//
// Numbered size calculation:
// The Read tool prepends line numbers and formatting to each line. The character
// count returned by the tool for a whole-file read is:
//   digits of 1-based line number + 1 (\t) + line characters + 1 (\n)
//
// Usage:  node scripts/check-reference-sizes.js [--json]
//                 [--max-numbered-bytes N]
// Exit:   0 = all under cap; 1 = violation(s); 2 = usage/env error.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MAX_NUMBERED_BYTES = 49152; // 48 KB

function usage() {
  process.stdout.write(
    'Usage: node scripts/check-reference-sizes.js [--json] [--max-numbered-bytes N]\n' +
    '  Assert every skills/*/references/*.md file stays under the numbered-size cap\n' +
    `  (default ${DEFAULT_MAX_NUMBERED_BYTES} bytes / 48 KB).\n` +
    '  Exit 0 = all under cap, 1 = violation(s), 2 = usage/env error.\n'
  );
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

function computeNumberedSize(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  let size = 0;
  lines.forEach((l, i) => {
    size += String(i + 1).length + 1 + l.length + 1;
  });
  return size;
}

function collectReferenceFiles() {
  const files = [];
  const skillsDir = path.join(REPO_ROOT, 'skills');
  if (!fs.existsSync(skillsDir)) {
    return files;
  }
  let skillEntries;
  try {
    skillEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (e) {
    process.stderr.write(`cannot read skills dir: ${e.message}\n`);
    process.exit(2);
  }

  for (const skill of skillEntries) {
    if (!skill.isDirectory()) continue;
    const refDir = path.join(skillsDir, skill.name, 'references');
    if (!fs.existsSync(refDir)) continue;
    let refEntries;
    try {
      refEntries = fs.readdirSync(refDir, { withFileTypes: true });
    } catch (e) {
      process.stderr.write(`cannot read ${refDir}: ${e.message}\n`);
      process.exit(2);
    }
    for (const ref of refEntries) {
      if (ref.isFile() && ref.name.endsWith('.md')) {
        const fullPath = path.join(refDir, ref.name);
        const relPath = path.relative(REPO_ROOT, fullPath);
        files.push({ fullPath, relPath });
      }
    }
  }
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }

  const maxNumberedBytes = parseIntArg(args, '--max-numbered-bytes') || DEFAULT_MAX_NUMBERED_BYTES;
  const json = args.includes('--json');
  for (const a of args) {
    if (a !== '--json') {
      process.stderr.write(`unknown arg: ${a}\n`);
      process.exit(2);
    }
  }

  const files = collectReferenceFiles();
  const violations = [];
  const results = [];

  for (const f of files) {
    let numberedSize;
    try {
      numberedSize = computeNumberedSize(f.fullPath);
    } catch (e) {
      process.stderr.write(`cannot read ${f.relPath}: ${e.message}\n`);
      process.exit(2);
    }
    const item = {
      file: f.relPath,
      numbered_bytes: numberedSize,
      max_numbered_bytes: maxNumberedBytes,
      over_cap: numberedSize > maxNumberedBytes,
    };
    results.push(item);
    if (item.over_cap) {
      violations.push(item);
    }
  }

  const ok = violations.length === 0;

  if (json) {
    process.stdout.write(JSON.stringify({
      ok,
      checked: results.length,
      max_numbered_bytes: maxNumberedBytes,
      violations,
      files: results,
    }) + '\n');
  } else {
    if (ok) {
      process.stdout.write(`reference-size: all ${results.length} skills/*/references/*.md under the ${maxNumberedBytes} numbered cap\n`);
    } else {
      for (const v of violations) {
        process.stderr.write(
          `reference-size: ${v.file} is ${v.numbered_bytes} numbered bytes (> ${maxNumberedBytes} cap) — split it; the Read tool truncates whole-file reads past ~60KB\n`
        );
      }
    }
  }

  process.exit(ok ? 0 : 1);
}

main();
