#!/usr/bin/env node
'use strict';
// scripts/check-backlog-single-writer.js - pre-commit guard: with a hippo store present, a commit that changes the backlog file
// must also carry a store op (.hippo/ops/*), i.e. the change went through scripts/project-record.js and not a hand edit.
//
//   node scripts/check-backlog-single-writer.js [--staged | --range <base>..<head>] [--target <dir>]
//
// Default is --staged (the pre-commit use). No .hippo/repo.toml in the repo root: nothing to guard, exit 0.
// Exit: 0 ok | 1 direct edit of the backlog file | 2 usage / not a git repo.
// Why it exists: hippo M5 acceptance item 5 - 18 direct edits of BACKLOG.md left the store behind (two systems running).
// Limit: this checks that a store op rides along, not that the op matches the edit; the store is not yet rendered back to the file.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKLOG_FILES = ['project/backlog/BACKLOG.md', 'docs/BACKLOG.md'];
const MESSAGE = 'BACKLOG.md is written by scripts/project-record.js; run: node scripts/project-record.js backlog ...';

function die(code, msg) { process.stderr.write(`${msg}\n`); process.exit(code); }

function main(argv) {
  let mode = 'staged', range = null, target = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged') mode = 'staged';
    else if (a === '--range') { mode = 'range'; range = argv[++i]; if (!range) die(2, 'usage: --range needs <base>..<head>'); }
    else if (a === '--target') { target = argv[++i]; if (!target) die(2, 'usage: --target needs <dir>'); }
    else die(2, `usage: check-backlog-single-writer.js [--staged | --range <base>..<head>] [--target <dir>] (unknown arg ${a})`);
  }
  const top = spawnSync('git', ['-C', target, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0) die(2, `not a git repo: ${target}`);
  const root = top.stdout.trim();
  if (!fs.existsSync(path.join(root, '.hippo', 'repo.toml'))) return 0;
  const gitArgs = mode === 'staged' ? ['diff', '--cached', '--name-only', '-z'] : ['diff', '--name-only', '-z', range];
  const d = spawnSync('git', ['-C', root].concat(gitArgs), { encoding: 'utf8' });
  if (d.status !== 0) die(2, `git diff failed: ${(d.stderr || '').trim()}`);
  const files = d.stdout.split('\0').filter(Boolean);
  const touched = files.filter((f) => BACKLOG_FILES.includes(f));
  if (!touched.length) return 0;
  if (files.some((f) => f.startsWith('.hippo/ops/'))) return 0;
  die(1, `${MESSAGE}\n(changed without a .hippo/ops/ entry in the same ${mode === 'staged' ? 'commit' : 'range'}: ${touched.join(', ')})`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
