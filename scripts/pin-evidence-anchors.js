#!/usr/bin/env node
'use strict';

// pin-evidence-anchors — keep receipt-referenced commits reachable.
//
// Why this exists: mission receipts under $GIT_COMMON_DIR/autopilot/ bind their
// evidence to COMMIT SHAs (candidate_sha, observed_head, base_sha, tip, git_sha,
// review_base_sha, …). Those receipts are plain JSON — git has no idea they
// reference anything. So a commit whose only ref was a dispatch branch becomes
// unreachable the moment that branch is deleted, and `git gc` reclaims it after
// gc.pruneExpire. The receipt survives, still naming a SHA that no longer
// resolves: it can still say "verified", but what was verified is gone.
//
// This is not hypothetical. On 2026-08-06 an audit of this repo found four
// receipt-anchored commits already destroyed (af5fe9b4, 3fb64596, 6f8e7d0d,
// 92ebff99 — receipts present, objects absent) and 72 more that were unreachable
// and counting down to the same fate.
//
// Note that refs/autopilot/lifecycle-roots/ does NOT cover this: those refs point
// at BLOBs (lifecycle record authority), and a blob ref keeps only that blob
// alive, never a commit. This namespace is the commit-side counterpart.
//
// Contract:
//   scan  (default) — read-only; report which receipt-referenced commits are
//                     unreachable. Exit 0 always; `unreachable` in the JSON is
//                     the finding. Never writes.
//   apply           — pin each unreachable one at
//                     refs/autopilot/evidence-anchors/<full-sha> -> <full-sha>.
//                     Idempotent: re-running pins nothing new.
//
// A ref name always equals the object it points at, so the namespace is
// self-verifying: any name/OID mismatch means someone hand-edited it.
//
// Anchors are deliberately never expired here. An anchor is small (a ref file)
// and the thing it prevents is unrecoverable. Retiring one is a separate,
// evidence-bound decision that belongs with mission disposition, not with a
// mechanical sweep.
//
// Exit codes: 0 ok (scan finding is not an error) · 2 usage/environment failure.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ANCHOR_PREFIX = 'refs/autopilot/evidence-anchors/';
const SHA40 = /\b[0-9a-f]{40}\b/g;

function usage(stream = process.stderr, code = 2) {
  stream.write([
    'Usage:',
    '  pin-evidence-anchors.js [scan|apply] [--repo-root <dir>] [--json]',
    '',
    '  scan   report receipt-referenced commits that are unreachable (read-only, default)',
    '  apply  pin them under refs/autopilot/evidence-anchors/ (idempotent)',
    '',
  ].join('\n'));
  process.exit(code);
}

function git(root, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

function collectFiles(dir, out, budget) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable subtree is not fatal — report what we could read
  }
  for (const entry of entries) {
    if (out.length >= budget) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out, budget);
    else if (entry.isFile()) out.push(full);
  }
}

function main(argv) {
  let mode = 'scan';
  let repoRoot = '.';
  let asJson = false;

  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) {
    mode = rest.shift();
    if (mode !== 'scan' && mode !== 'apply') usage();
  }
  while (rest.length) {
    const flag = rest.shift();
    if (flag === '--repo-root') { repoRoot = rest.shift(); if (!repoRoot) usage(); }
    else if (flag === '--json') asJson = true;
    else if (flag === '-h' || flag === '--help') usage(process.stdout, 0);
    else usage();
  }

  let root;
  let commonDir;
  try {
    root = git(repoRoot, ['rev-parse', '--show-toplevel']);
    commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  } catch (error) {
    process.stderr.write(`pin-evidence-anchors: not a git repository: ${error.message}\n`);
    process.exit(2);
  }

  const receiptRoot = path.join(commonDir, 'autopilot');
  if (!fs.existsSync(receiptRoot)) {
    const empty = { mode, receipt_root: receiptRoot, scanned_files: 0, candidates: 0, unreachable: [], pinned: [], already_pinned: 0 };
    process.stdout.write(`${JSON.stringify(empty)}\n`);
    return; // no mission state in this repo — nothing to anchor, not an error
  }

  const files = [];
  collectFiles(receiptRoot, files, 200000);

  // Every 40-hex token in the receipt tree is a *candidate*; most are content
  // digests, not commits. `cat-file -t` decides, so we never guess from context.
  const tokens = new Set();
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const found = text.match(SHA40);
    if (found) for (const sha of found) tokens.add(sha);
  }

  // One rev-list beats one `for-each-ref --contains` per candidate: reachability
  // is a set membership test, and the set is the same for every candidate.
  const reachable = new Set();
  const revList = git(root, ['rev-list', '--all'], { allowFail: true });
  if (revList) for (const line of revList.split('\n')) if (line) reachable.add(line);

  const existingAnchors = new Set();
  const anchorRefs = git(root, ['for-each-ref', '--format=%(refname)', ANCHOR_PREFIX], { allowFail: true });
  if (anchorRefs) for (const ref of anchorRefs.split('\n')) if (ref) existingAnchors.add(ref.slice(ANCHOR_PREFIX.length));

  const unreachable = [];
  let candidates = 0;
  for (const sha of tokens) {
    const type = git(root, ['cat-file', '-t', sha], { allowFail: true });
    if (type !== 'commit') continue; // digests and missing objects are not our business
    candidates += 1;
    if (reachable.has(sha)) continue;
    unreachable.push(sha);
  }
  unreachable.sort();

  const pinned = [];
  let alreadyPinned = 0;
  if (mode === 'apply') {
    for (const sha of unreachable) {
      if (existingAnchors.has(sha)) { alreadyPinned += 1; continue; }
      const ref = `${ANCHOR_PREFIX}${sha}`;
      try { git(root, ['update-ref', ref, sha]); pinned.push(sha); }
      catch (error) {
        process.stderr.write(`pin-evidence-anchors: cannot pin ${sha}: ${error.message}\n`);
        process.exit(2); // a pin that silently failed is worse than a loud stop
      }
    }
  }

  const result = {
    mode,
    receipt_root: receiptRoot,
    scanned_files: files.length,
    candidates,
    unreachable,
    pinned,
    already_pinned: alreadyPinned,
    anchors_total: existingAnchors.size + pinned.length,
  };

  if (asJson || mode === 'apply') { process.stdout.write(`${JSON.stringify(result)}\n`); return; }
  process.stdout.write(`receipt-referenced commits: ${candidates}\n`);
  process.stdout.write(`unreachable (would be pinned): ${unreachable.length}\n`);
  for (const sha of unreachable) process.stdout.write(`  ${sha}\n`);
  if (unreachable.length) process.stdout.write('\nrun `pin-evidence-anchors.js apply` to anchor them\n');
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`pin-evidence-anchors: ${error.message}\n`); process.exit(2); }
}

module.exports = { ANCHOR_PREFIX };
