#!/usr/bin/env node
'use strict';

/**
 * check-test-cli-timeout.js — lints *.test.js and *.test.sh under hooks/ and scripts/
 * for child-process / node CLI invocations missing an explicit timeout.
 *
 * Usage:
 *   node scripts/check-test-cli-timeout.js [--check] [--write-baseline] [--root <dir>] [--baseline <path>]
 */

const fs = require('fs');
const path = require('path');

const CALL_RE = /\b(spawnSync|execFileSync|execSync|spawn)\s*\(/g;

function walkTestFiles(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTestFiles(full, exts, out);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function extractCallArgs(text, openParenIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIdx; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return text.slice(openParenIdx + 1, i);
      }
    }
  }
  return text.slice(openParenIdx + 1);
}

function lineNumberAt(text, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function scanJsFile(filePath, rootDir) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const violations = [];
  CALL_RE.lastIndex = 0;
  let m;
  while ((m = CALL_RE.exec(text)) !== null) {
    const kind = m[1];
    const openParenIdx = m.index + m[0].length - 1;
    const argsText = extractCallArgs(text, openParenIdx);
    if (!/\btimeout\s*:/.test(argsText)) {
      const line = lineNumberAt(text, m.index);
      violations.push({
        key: `${rel}:${line}:${kind}`,
        file: rel,
        line,
        kind,
      });
    }
  }
  return violations;
}

function scanShFile(filePath, rootDir) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const lines = text.split(/\r?\n/);
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const trimmed = lineText.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/\bnode\s+(?:scripts|hooks)\//.test(trimmed)) {
      const hasTimeout = /\btimeout\s+(?:-\S+\s+)*\d+[sm]?\b/.test(trimmed);
      if (!hasTimeout) {
        const line = i + 1;
        violations.push({
          key: `${rel}:${line}:sh-node`,
          file: rel,
          line,
          kind: 'sh-node',
        });
      }
    }
  }
  return violations;
}

function scanRepo(rootDir) {
  const jsFiles = [
    ...walkTestFiles(path.join(rootDir, 'hooks'), ['.test.js']),
    ...walkTestFiles(path.join(rootDir, 'scripts'), ['.test.js']),
  ].sort();
  const shFiles = [
    ...walkTestFiles(path.join(rootDir, 'hooks'), ['.test.sh']),
    ...walkTestFiles(path.join(rootDir, 'scripts'), ['.test.sh']),
  ].sort();

  const violations = [];
  for (const f of jsFiles) violations.push(...scanJsFile(f, rootDir));
  for (const f of shFiles) violations.push(...scanShFile(f, rootDir));
  return violations;
}

function parseArgs(argv) {
  const opts = {
    mode: 'check',
    root: path.resolve(__dirname, '..'),
    baseline: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write-baseline') opts.mode = 'write-baseline';
    else if (a === '--check') opts.mode = 'check';
    else if (a === '--root' && i + 1 < argv.length) opts.root = path.resolve(argv[++i]);
    else if (a === '--baseline' && i + 1 < argv.length) opts.baseline = path.resolve(argv[++i]);
  }
  if (!opts.baseline) {
    opts.baseline = path.join(opts.root, 'scripts', 'check-test-cli-timeout.baseline.json');
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv);
  const violations = scanRepo(opts.root);

  if (opts.mode === 'write-baseline') {
    const payload = {
      schema: 1,
      violations: violations.map((v) => v.key),
    };
    fs.writeFileSync(opts.baseline, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    process.stdout.write(`wrote ${violations.length} baseline entries to ${opts.baseline}\n`);
    process.exit(0);
  }

  let baselineSet = new Set();
  if (fs.existsSync(opts.baseline)) {
    const raw = JSON.parse(fs.readFileSync(opts.baseline, 'utf8'));
    if (Array.isArray(raw.violations)) {
      baselineSet = new Set(raw.violations);
    }
  }

  const currentKeys = new Set(violations.map((v) => v.key));
  const newViolations = violations.filter((v) => !baselineSet.has(v.key));
  const disappeared = [...baselineSet].filter((k) => !currentKeys.has(k));

  if (disappeared.length > 0) {
    process.stdout.write(`baseline entries disappeared (${disappeared.length}):\n`);
    for (const k of disappeared) process.stdout.write(`  - ${k}\n`);
  }

  if (newViolations.length > 0) {
    process.stderr.write(`check-test-cli-timeout: ${newViolations.length} new violation(s) without timeout:\n`);
    for (const v of newViolations) {
      process.stderr.write(`  ${v.key}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(`check-test-cli-timeout: OK (${violations.length} baselined, 0 new)\n`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { scanRepo, scanJsFile, scanShFile };
