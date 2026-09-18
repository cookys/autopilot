#!/usr/bin/env node
/**
 * secret-scan-diff.js — Range/staged secret scan for the completeness gate.
 * Gets added lines via `git diff`, runs them through secret-patterns.js.
 * JSON: {findings: [{file, line, pattern_name, redacted_snippet}]}
 * Exit 1 if findings (blocking), 0 clean, 2 usage / cannot scan.
 * per-file streaming (2026-09-18): a 1 MiB spawnSync buffer made release ranges
 * unscannable.
 */

'use strict';

const { spawnSync } = require('child_process');
const secrets = require('../hooks/_shared/secret-patterns');

const FILE_DIFF_MAX_BUFFER = 256 * 1024 * 1024;

const args = process.argv.slice(2);
let mode = 'staged';
let range = '';
let files = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--staged') {
    mode = 'staged';
  } else if (args[i] === '--range') {
    mode = 'range';
    range = args[++i];
    if (range === undefined || range === '') {
      process.stderr.write('secret-scan-diff: --range requires an argument (A..B)\n');
      process.exit(2);
    }
  } else if (args[i] === '--files') {
    files = args.slice(i + 1);
    break;
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log('Usage: secret-scan-diff.js [--staged | --range A..B | --files ...]');
    process.exit(0);
  } else {
    console.error(`unknown arg: ${args[i]}`);
    process.exit(2);
  }
}

function gitBaseArgs(unified) {
  const diffArgs = ['diff'];
  if (unified) {
    diffArgs.push('-U0');
  } else {
    diffArgs.push('--name-only');
  }
  diffArgs.push('--diff-filter=ACMR');
  if (mode === 'range') {
    diffArgs.push(range);
  } else if (mode === 'staged') {
    diffArgs.push('--cached');
  }
  return diffArgs;
}

function gitCall(gitArgs, maxBuffer) {
  const opts = { encoding: 'utf8', timeout: 10000 };
  if (maxBuffer !== undefined) opts.maxBuffer = maxBuffer;
  return spawnSync('git', gitArgs, opts);
}

function reportGitFailure(proc) {
  if (proc.error) {
    console.error(`git diff error: ${proc.error.message}`);
    process.exit(2);
  }
  if (proc.status !== 0) {
    console.error(`git diff failed with status ${proc.status}: ${proc.stderr || ''}`);
    process.exit(2);
  }
}

function scanDiffText(text, findings) {
  let currentFile = '';
  let lineNum = 0;
  let inHunk = false;

  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/ b\/(.*)$/);
      if (match) currentFile = match[1];
      inHunk = false;
      continue;
    }
    if (line.startsWith('@@ ')) {
      const match = line.match(/\+([0-9]+)/);
      if (match) lineNum = parseInt(match[1], 10);
      inHunk = true;
      continue;
    }
    if (inHunk && line.startsWith('+') && !line.startsWith('+++')) {
      const content = line.substring(1);
      const ln = lineNum++;

      const hits = secrets.scan(content);
      if (hits.length > 0) {
        let patternName = hits[0].name;
        let myRedacted = content;

        for (const { name, pattern } of secrets.patterns) {
          const p = new RegExp(pattern.source, 'g');
          myRedacted = myRedacted.replace(p, (m) => m.substring(0, 4) + '…');
        }

        findings.push({
          file: currentFile,
          line: ln,
          pattern_name: patternName,
          redacted_snippet: myRedacted
        });
      }
    }
  }
}

const nameArgs = gitBaseArgs(false);
if (files.length > 0) {
  nameArgs.push('--', ...files);
}

const nameProc = gitCall(nameArgs);
reportGitFailure(nameProc);

const paths = (nameProc.stdout || '')
  .split('\n')
  .map((p) => p.replace(/\r$/, ''))
  .filter((p) => p.length > 0);

const findings = [];
for (const path of paths) {
  const fileArgs = gitBaseArgs(true);
  fileArgs.push('--', path);
  const diffProc = gitCall(fileArgs, FILE_DIFF_MAX_BUFFER);
  if (diffProc.error) {
    const msg = diffProc.error.message || '';
    const code = diffProc.error.code || '';
    if (code === 'ENOBUFS' || code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /ENOBUFS|maxBuffer/i.test(msg)) {
      process.stderr.write(`secret-scan-diff: ${path}: diff too large to scan\n`);
      process.exit(2);
    }
    console.error(`git diff error: ${diffProc.error.message}`);
    process.exit(2);
  }
  if (diffProc.status !== 0) {
    console.error(`git diff failed with status ${diffProc.status}: ${diffProc.stderr || ''}`);
    process.exit(2);
  }
  scanDiffText(diffProc.stdout || '', findings);
}

console.log(JSON.stringify({ findings }, null, 2));
process.exit(findings.length > 0 ? 1 : 0);
