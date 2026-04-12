#!/usr/bin/env node
/**
 * check-console — Stop [OPT-IN]
 * Scans modified JS/TS files for console.log statements.
 * Warning only — does not block.
 */

'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

const EXCLUDED = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.config\.[jt]s$/,
  /scripts\//,
  /__tests__\//,
];

const MAX_REPORT = 5;

try {
  fs.readFileSync('/dev/stdin', 'utf8');

  const diff = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
    timeout: 3000,
    encoding: 'utf8',
  });

  const files = (diff.stdout || '').trim().split('\n').filter(f =>
    /\.[jt]sx?$/.test(f) && !EXCLUDED.some(ex => ex.test(f))
  );

  const hits = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/console\.log\b/.test(lines[i]) && !/^\s*\/\//.test(lines[i])) {
        hits.push({ file, line: i + 1 });
        if (hits.length >= MAX_REPORT) break;
      }
    }
    if (hits.length >= MAX_REPORT) break;
  }

  if (hits.length > 0) {
    const report = hits.map(h => `  ${h.file}:${h.line}`).join('\n');
    process.stderr.write(
      `console.log found in modified files:\n${report}\n` +
      `Consider removing before committing.\n`
    );
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`check-console error: ${e.message}\n`);
  process.exit(0);
}
