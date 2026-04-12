#!/usr/bin/env node
/**
 * batch-format — Stop [OPT-IN, timeout: 300s]
 * Batch formats (Prettier) and typechecks (tsc) all JS/TS files edited this session.
 * Reads file list from accumulator.js output.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const MAX_ERROR_LINES = 30;

function getSessionId() {
  const raw = process.env.CLAUDE_SESSION_ID || '';
  if (raw) return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function findBin(name) {
  const local = path.join('node_modules', '.bin', name);
  if (fs.existsSync(local)) return local;
  return null;
}

try {
  fs.readFileSync('/dev/stdin', 'utf8');

  const sid = getSessionId();
  const listFile = path.join(os.tmpdir(), `claude-edited-${sid}.txt`);

  if (!fs.existsSync(listFile)) process.exit(0);

  const content = fs.readFileSync(listFile, 'utf8').trim();
  fs.unlinkSync(listFile); // Clean up

  if (!content) process.exit(0);

  const files = [...new Set(content.split('\n'))].filter(f => fs.existsSync(f));
  if (files.length === 0) process.exit(0);

  // Prettier
  const prettier = findBin('prettier');
  if (prettier) {
    const r = spawnSync(prettier, ['--write', ...files], {
      timeout: 60000,
      encoding: 'utf8',
    });
    if (r.stderr) {
      process.stderr.write(`Prettier warnings:\n${r.stderr.slice(0, 500)}\n`);
    }
  }

  // TypeScript check (only if TS files present)
  const tsFiles = files.filter(f => /\.tsx?$/.test(f));
  if (tsFiles.length > 0) {
    const r = spawnSync('npx', ['tsc', '--noEmit'], {
      timeout: 120000,
      encoding: 'utf8',
    });
    if (r.stdout) {
      const lines = r.stdout.split('\n').slice(0, MAX_ERROR_LINES);
      if (lines.length > 0) {
        process.stderr.write(`TypeScript errors:\n${lines.join('\n')}\n`);
      }
    }
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`batch-format error: ${e.message}\n`);
  process.exit(0);
}
