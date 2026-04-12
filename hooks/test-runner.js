#!/usr/bin/env node
/**
 * test-runner — PostToolUse/Write|Edit [OPT-IN, timeout: 60s]
 * Finds and runs sibling test files for edited JS/TS code.
 * Non-blocking — failures reported to stderr.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_OUTPUT_LINES = 30;

function findBin(name) {
  const local = path.join('node_modules', '.bin', name);
  if (fs.existsSync(local)) return local;
  return null;
}

function findTestFile(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  // Skip if already a test file
  if (/\.(test|spec)\./.test(filePath)) return null;

  const candidates = [
    path.join(dir, `${base}.test.ts`),
    path.join(dir, `${base}.test.tsx`),
    path.join(dir, `${base}.test.js`),
    path.join(dir, `${base}.spec.ts`),
    path.join(dir, `${base}.spec.tsx`),
    path.join(dir, `${base}.spec.js`),
    path.join(dir, '__tests__', `${base}.test.ts`),
    path.join(dir, '__tests__', `${base}.test.tsx`),
  ];

  return candidates.find(c => fs.existsSync(c)) || null;
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path;

  if (!filePath || !/\.[jt]sx?$/.test(filePath)) process.exit(0);
  if (!fs.existsSync(filePath)) process.exit(0);

  const testFile = findTestFile(filePath);
  if (!testFile) process.exit(0);

  // Find runner
  const vitest = findBin('vitest');
  const jest = findBin('jest');

  let args;
  let bin;
  if (vitest) {
    bin = vitest;
    args = ['run', '--reporter=basic', testFile];
  } else if (jest) {
    bin = jest;
    args = ['--no-coverage', '--silent', testFile];
  } else {
    process.exit(0); // No runner available
  }

  const r = spawnSync(bin, args, { timeout: 55000, encoding: 'utf8' });
  const output = (r.stdout || '') + (r.stderr || '');

  if (r.status !== 0) {
    const lines = output.split('\n').slice(0, MAX_OUTPUT_LINES);
    process.stderr.write(`Test failure for ${path.basename(filePath)}:\n${lines.join('\n')}\n`);
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`test-runner error: ${e.message}\n`);
  process.exit(0);
}
