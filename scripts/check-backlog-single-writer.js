#!/usr/bin/env node
'use strict';
// scripts/check-backlog-single-writer.js - pre-commit / pre-merge-commit / dispatch-hetero guard: with a hippo store present,
// BACKLOG.md and the store must agree.
//
//   node scripts/check-backlog-single-writer.js [--staged | --range <base>..<head>] [--target <dir>]
//
// The store is the source and BACKLOG.md a view written by `node scripts/project-record.js backlog new|reply|close|sync|import`.
// When the change (staged diff, or the range) touches the backlog file or anything under .hippo/, this runs the reconcile
// (`check-backlog-entries.js --hippo --reconcile`, the working tree) and fails if file and store disagree: a row with no record, an
// open record with no row, a closed record whose row is still open, or a row field that differs from its record's. A hand edit of
// BACKLOG.md and a store op without its row are both red; a project-record.js write (which changes both) is green.
// Known drift in project/backlog/store-drift.json ({"records": {"<ULID>": "reason"}}) is evaluated by the reconcile itself: a listed
// record is reported with allowed: true, and an entry that no longer drifts fails until removed (the list only shrinks).
// Default is --staged (the pre-commit and pre-merge-commit use); --range <base>..<head> is used by dispatch-hetero.sh and audits.
// No .hippo/repo.toml in the repo root: nothing to guard, exit 0. hippo missing or broken (reconcile exit 5): a loud warning and
// exit 0, the writers spool in that state.
// Exit: 0 ok | 1 disagreement | 2 usage / not a git repo / corrupt store-drift.json.
// Why it exists: hippo M5 acceptance item 5 - 18 direct edits of BACKLOG.md left the store behind (two systems running).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  collectEntries,
  builtinConfig,
  mergeConfig,
  parseConfigFile,
  resolveBacklogConfigPath,
  NEXT_ID_RE,
  BL_ID_RE,
} = require('./check-backlog-entries.js');

const BACKLOG_FILES = ['project/backlog/BACKLOG.md', 'docs/BACKLOG.md'];
const GATE = path.join(__dirname, 'check-backlog-entries.js');
const MESSAGE = '禁止直接手改 BACKLOG.md 或 .hippo/（單一寫入者保護）：請改用 node scripts/project-record.js backlog new|sync（回覆或關閉請用 backlog reply|close）同步 store 與 BACKLOG.md 後再 commit。';
// Negative-control toggle checked by hooks/tests/check-backlog-single-writer.test.sh.
const ENFORCE_NEXT_ID_GUARD = true;

function die(code, msg) { process.stderr.write(`${msg}\n`); process.exit(code); }

function watchedBacklogFiles(root) {
  const list = BACKLOG_FILES.slice();
  const r = spawnSync('bash', [path.join(__dirname, 'resolve-project-paths.sh'), '--target', root, '--field', 'backlog'], { encoding: 'utf8' });
  if (r.status === 0) {
    const v = (r.stdout || '').trim().replace(/^\.\/+/, '').replace(/\\/g, '/');
    if (v && v !== 'none' && !path.isAbsolute(v) && !list.includes(v)) list.push(v);
  }
  return list;
}

function loadCfg(root) {
  let cfg = builtinConfig(root);
  const p = resolveBacklogConfigPath(root);
  if (p) cfg = mergeConfig(cfg, parseConfigFile(p));
  return cfg;
}

function gitShow(root, spec) {
  const r = spawnSync('git', ['-C', root, 'show', spec], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function parseNextIdMark(text) {
  const m = String(text || '').match(NEXT_ID_RE);
  if (!m) return null;
  const bm = String(m[1] || '').match(BL_ID_RE);
  return bm ? { id: `BL-${bm[1]}`, num: parseInt(bm[1], 10) } : null;
}

function checkNextIdEdits(root, mode, range, touchedBacklog) {
  if (!ENFORCE_NEXT_ID_GUARD || !touchedBacklog.length) return [];
  let baseRef = 'HEAD';
  let headRef = '';
  if (mode === 'range') {
    if (range.includes('...')) {
      const [l, r] = range.split('...');
      const mb = spawnSync('git', ['-C', root, 'merge-base', l || 'HEAD', r || 'HEAD'], { encoding: 'utf8' });
      if (mb.status !== 0) return [];
      baseRef = mb.stdout.trim();
      headRef = r || 'HEAD';
    } else if (range.includes('..')) {
      const idx = range.indexOf('..');
      baseRef = range.slice(0, idx) || 'HEAD';
      headRef = range.slice(idx + 2) || 'HEAD';
    } else {
      baseRef = `${range}^`;
      headRef = range;
    }
  }
  const cfg = loadCfg(root);
  if ((cfg.style || 'heading') !== 'heading') return [];
  const problems = [];
  for (const rel of touchedBacklog) {
    const beforeText = gitShow(root, `${baseRef}:${rel}`);
    const afterText = gitShow(root, `${headRef}:${rel}`);
    if (beforeText == null || afterText == null) continue;
    const beforeMark = parseNextIdMark(beforeText);
    const afterMark = parseNextIdMark(afterText);
    if (!beforeMark || !afterMark || beforeMark.num === afterMark.num) continue;
    if (afterMark.num < beforeMark.num) {
      problems.push(`next_id_hand_edited: ${rel} lowered <!-- next-id --> from ${beforeMark.id} to ${afterMark.id}`);
      continue;
    }
    const beforeIds = new Set(collectEntries(beforeText, 'heading', cfg).map((e) => e.id).filter(Boolean));
    const afterIds = new Set(collectEntries(afterText, 'heading', cfg).map((e) => e.id).filter(Boolean));
    const missing = [];
    for (let n = beforeMark.num; n < afterMark.num; n++) {
      const expectId = `BL-${String(n).padStart(4, '0')}`;
      if (beforeIds.has(expectId) || !afterIds.has(expectId)) missing.push(expectId);
    }
    if (missing.length) {
      problems.push(`next_id_hand_edited: ${rel} raised <!-- next-id --> from ${beforeMark.id} to ${afterMark.id} without adding ${missing.join(', ')}`);
    }
  }
  return problems;
}

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
  const backlogFiles = watchedBacklogFiles(root);
  const gitArgs = mode === 'staged' ? ['diff', '--cached', '--name-only', '-z'] : ['diff', '--name-only', '-z', range];
  const d = spawnSync('git', ['-C', root].concat(gitArgs), { encoding: 'utf8' });
  if (d.status !== 0) die(2, `git diff failed: ${(d.stderr || '').trim()}`);
  const files = d.stdout.split('\0').filter(Boolean);
  const touched = files.filter((f) => backlogFiles.includes(f) || f.startsWith('.hippo/'));
  if (!touched.length) return 0;
  const touchedBacklog = files.filter((f) => backlogFiles.includes(f));
  if (mode === 'staged') {
    // .hippo/.cache is a gitignored read cache that hippo rewrites on every read; it is never part of a store write.
    // The reconcile reads the working tree: a partly staged writer run (store op committed, row left behind, or the reverse) would pass.
    const st = spawnSync('git', ['-C', root, 'status', '--porcelain', '-z', '--untracked-files=all', '--', ...backlogFiles, '.hippo', ':(exclude).hippo/.cache'], { encoding: 'utf8' });
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
  const nextIdProblems = checkNextIdEdits(root, mode, range, touchedBacklog);
  const r = spawnSync(process.execPath, [GATE, '--hippo', '--reconcile', '--mode', 'block', '--target', root], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 2 && (r.stderr || '').includes('store-drift.json')) die(2, (r.stderr || '').trim());
  if (r.status === 5 || r.status === 2) {
    if (nextIdProblems.length) die(1, `${MESSAGE}\n${nextIdProblems.join('\n')}`);
    process.stderr.write(`WARNING backlog single-writer: the store could not be read, agreement not checked (${(r.stderr || '').trim() || `reconcile exit ${r.status}`})\n`);
    return 0;
  }
  let rep;
  try { rep = JSON.parse(r.stdout); } catch { die(2, `reconcile gave no JSON (exit ${r.status}): ${(r.stderr || r.stdout || '').trim()}`); }
  const problems = (rep.violations || [])
    .filter((v) => !v.allowed && v.level !== 'warn')
    .map((v) => `${v.code}: ${v.detail}`)
    .concat(nextIdProblems);
  if (!problems.length && r.status === 0) return 0;
  if (!problems.length) problems.push(`reconcile exited ${r.status}`);
  die(1, `${MESSAGE}\n${problems.join('\n')}\n(checked because the ${mode === 'staged' ? 'commit' : 'range'} touches: ${touched.slice(0, 5).join(', ')}${touched.length > 5 ? ', ...' : ''})`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
