#!/usr/bin/env node
'use strict';
// scripts/check-backlog-single-writer.js - pre-commit guard: with a hippo store present, BACKLOG.md and the store must agree.
//
//   node scripts/check-backlog-single-writer.js [--staged | --range <base>..<head>] [--target <dir>]
//
// The store is the source and BACKLOG.md a view written by `node scripts/project-record.js backlog new|reply|close|sync`. When the
// change (staged diff, or the range) touches the backlog file or anything under .hippo/, this runs the reconcile
// (`check-backlog-entries.js --hippo --reconcile`, the working tree) and fails if file and store disagree: a row with no record, an
// open record with no row, a closed record whose row is still open, or a row field that differs from its record's. A hand edit of
// BACKLOG.md and a store op without its row are both red; a project-record.js write (which changes both) is green.
// Known drift that cannot be fixed yet is listed in project/backlog/store-drift.json ({"records": {"<ULID>": "reason"}}); a listed
// record passes, and an entry that no longer drifts fails until removed (the list only shrinks).
// Default is --staged (the pre-commit use). No .hippo/repo.toml in the repo root: nothing to guard, exit 0. hippo missing or broken
// (reconcile exit 5): a loud warning and exit 0, the writers spool in that state.
// Exit: 0 ok | 1 disagreement | 2 usage / not a git repo.
// Why it exists: hippo M5 acceptance item 5 - 18 direct edits of BACKLOG.md left the store behind (two systems running).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKLOG_FILES = ['project/backlog/BACKLOG.md', 'docs/BACKLOG.md'];
const GATE = path.join(__dirname, 'check-backlog-entries.js');
const DEBT_FILE = 'project/backlog/store-drift.json';
const MESSAGE = 'BACKLOG.md is written by scripts/project-record.js and must agree with the store; run: node scripts/project-record.js backlog ...';

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
  const touched = files.filter((f) => BACKLOG_FILES.includes(f) || f.startsWith('.hippo/'));
  if (!touched.length) return 0;
  if (mode === 'staged') {
    // The reconcile reads the working tree: a partly staged writer run (store op committed, row left behind, or the reverse) would pass.
    const st = spawnSync('git', ['-C', root, 'status', '--porcelain', '-z', '--untracked-files=all', '--', ...BACKLOG_FILES, '.hippo'], { encoding: 'utf8' });
    if (st.status !== 0) die(2, `git status failed: ${(st.stderr || '').trim()}`);
    // A rename/copy entry (column 0 R or C) is `XY dest\0orig\0`: the orig field is not a status line.
    const unstaged = [];
    const ents = st.stdout.split('\0');
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.length <= 3) continue;
      if (e[0] === 'R' || e[0] === 'C') i++;
      if (e[1] !== ' ') unstaged.push(e.slice(3));
    }
    if (unstaged.length) die(1, `${MESSAGE}\nunstaged changes in: ${unstaged.slice(0, 5).join(', ')}${unstaged.length > 5 ? ', ...' : ''}; stage BACKLOG.md and .hippo together (git add the backlog file and .hippo in the same commit)`);
  }
  const r = spawnSync(process.execPath, [GATE, '--hippo', '--reconcile', '--mode', 'block', '--target', root], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 5 || r.status === 2) {
    process.stderr.write(`WARNING backlog single-writer: the store could not be read, agreement not checked (${(r.stderr || '').trim() || `reconcile exit ${r.status}`})\n`);
    return 0;
  }
  let rep;
  try { rep = JSON.parse(r.stdout); } catch { die(2, `reconcile gave no JSON (exit ${r.status}): ${(r.stderr || r.stdout || '').trim()}`); }
  let debt = {};
  try { debt = (JSON.parse(fs.readFileSync(path.join(root, DEBT_FILE), 'utf8')).records) || {}; } catch (e) { if (e.code !== 'ENOENT') die(2, `${DEBT_FILE}: ${e.message}`); }
  const drift = (rep.reconcile && rep.reconcile.drift) || [];
  const driftCodes = new Set(['backlog_unprojected', 'backlog_stale_row', 'backlog_store_mismatch']);
  const problems = [];
  for (const v of rep.violations || []) if (!driftCodes.has(v.code)) problems.push(`${v.code}: ${v.detail}`);
  for (const d of drift) if (!Object.prototype.hasOwnProperty.call(debt, d.record)) problems.push(`${d.code}: ${d.detail}`);
  const live = new Set(drift.map((d) => d.record));
  for (const id of Object.keys(debt)) if (!live.has(id)) problems.push(`${DEBT_FILE}: ${id} no longer drifts; remove it from the list`);
  if (!problems.length) return 0;
  die(1, `${MESSAGE}\n${problems.join('\n')}\n(checked because the ${mode === 'staged' ? 'commit' : 'range'} touches: ${touched.slice(0, 5).join(', ')}${touched.length > 5 ? ', ...' : ''})`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
