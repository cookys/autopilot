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
// --exclude-ref is the whole point at a pre-delete call site. Reachability is
// computed against the refs that will SURVIVE, not the ones that exist right now:
// a commit held solely by the branch about to be reaped still looks reachable
// while that branch exists, so without the exclusion it is skipped and orphaned
// milliseconds later — precisely the failure this guards against. A caller that
// is about to delete refs MUST name them.
//
// Contract:
//   scan  (default) — read-only; report which receipt-referenced commits would be
//                     unreachable. Exit 0 always; `unreachable` in the JSON is the
//                     finding. Never writes.
//   apply           — pin each one at refs/autopilot/evidence-anchors/<full-sha>.
//                     Idempotent: re-running pins nothing new.
//   --exclude-ref <ref>   repeatable; treat <ref> as already gone when computing
//                         reachability.
//
// A ref name always equals the object it points at, so the namespace is
// self-verifying. An existing anchor whose name and target disagree is treated as
// NOT covering that SHA (and reported), because trusting the name alone would let
// a mismatched ref mask an unprotected commit.
//
// Fail-closed everywhere it matters: an unreadable receipt directory or an
// exhausted traversal budget is an ERROR, never a quietly shorter scan. A caller
// deletes refs on the strength of this exit code, so "I could not read everything"
// must never look like "there was nothing to protect".
//
// Anchors are deliberately never expired here. An anchor is small and the thing it
// prevents is unrecoverable. Retiring one is an evidence-bound decision that
// belongs with mission disposition, not with a mechanical sweep.
//
// Exit codes: 0 ok (a scan finding is not an error) · 2 usage/environment failure.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ANCHOR_PREFIX = 'refs/autopilot/evidence-anchors/';
const SHA40 = /\b[0-9a-f]{40}\b/g;
const FILE_BUDGET = 200000;

function usage(stream = process.stderr, code = 2) {
  stream.write([
    'Usage:',
    '  pin-evidence-anchors.js [scan|apply] [--repo-root <dir>] [--exclude-ref <ref>]... [--json]',
    '',
    '  scan          report receipt-referenced commits that would be unreachable (read-only, default)',
    '  apply         pin them under refs/autopilot/evidence-anchors/ (idempotent)',
    '  --exclude-ref treat <ref> as already deleted when computing reachability;',
    '                REQUIRED from any caller that is about to delete refs',
    '',
  ].join('\n'));
  process.exit(code);
}

function fail(message) {
  process.stderr.write(`pin-evidence-anchors: ${message}\n`);
  process.exit(2);
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

// Collect every regular file under dir. Any unreadable subtree or an exhausted
// budget aborts: a partial scan that reported success would authorize a deletion
// against evidence it never looked at.
function collectFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    fail(`cannot read receipt directory ${dir}: ${error.message}`);
  }
  for (const entry of entries) {
    if (out.length >= FILE_BUDGET) {
      fail(`receipt traversal budget (${FILE_BUDGET} files) exhausted at ${dir}; refusing a partial scan`);
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function main(argv) {
  let mode = 'scan';
  let repoRoot = '.';
  let asJson = false;
  const excludeRefs = [];

  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) {
    mode = rest.shift();
    if (mode !== 'scan' && mode !== 'apply') usage();
  }
  while (rest.length) {
    const flag = rest.shift();
    if (flag === '--repo-root') { repoRoot = rest.shift(); if (!repoRoot) usage(); }
    else if (flag === '--exclude-ref') { const r = rest.shift(); if (!r) usage(); excludeRefs.push(r); }
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
    fail(`not a git repository: ${error.message}`);
  }

  const receiptRoot = path.join(commonDir, 'autopilot');
  if (!fs.existsSync(receiptRoot)) {
    process.stdout.write(`${JSON.stringify({
      mode, receipt_root: receiptRoot, scanned_files: 0, candidates: 0,
      excluded_refs: excludeRefs, unreachable: [], pinned: [], repaired: [], anchors_total: 0,
    })}\n`);
    return; // no mission state here — nothing to anchor, not an error
  }

  const files = [];
  collectFiles(receiptRoot, files);

  // Every 40-hex token in the receipt tree is a *candidate*; most are content
  // digests, not commits. `cat-file -t` decides, so we never guess from context.
  const tokens = new Set();
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (error) { fail(`cannot read receipt ${file}: ${error.message}`); }
    const found = text.match(SHA40);
    if (found) for (const sha of found) tokens.add(sha);
  }

  // Anchors are trusted only when name and target agree. A ref named for SHA A
  // pointing at SHA B would otherwise make A look protected while it is not.
  // This must be resolved BEFORE reachability, not after: `apply` deletes every
  // mismatched ref, so counting one as a live ref while computing reachability
  // would mark its target's ancestors reachable — including a SHA the mismatched
  // ref is named for — and skip anchoring them, right before removing the very
  // ref that made them look safe.
  const anchorTargets = new Map();
  const mismatched = [];
  const anchorRefs = git(root, ['for-each-ref', '--format=%(refname) %(objectname)', ANCHOR_PREFIX], { allowFail: true });
  if (anchorRefs) {
    for (const line of anchorRefs.split('\n')) {
      if (!line) continue;
      const [ref, oid] = line.split(' ');
      const named = ref.slice(ANCHOR_PREFIX.length);
      if (named === oid) anchorTargets.set(named, oid);
      else mismatched.push({ ref, named, oid });
    }
  }

  // Reachability against the refs that SURVIVE this run: neither the caller's
  // pending deletions nor the mismatched anchors we are about to remove.
  const doomedRefs = [...excludeRefs, ...mismatched.map((m) => m.ref)];
  const revListArgs = ['rev-list'];
  for (const ref of doomedRefs) revListArgs.push(`--exclude=${ref}`);
  revListArgs.push('--all');
  const reachable = new Set();
  const revList = git(root, revListArgs, { allowFail: true });
  if (revList) for (const line of revList.split('\n')) if (line) reachable.add(line);

  const unreachable = [];
  let candidates = 0;
  for (const sha of tokens) {
    const type = git(root, ['cat-file', '-t', sha], { allowFail: true });
    if (type !== 'commit') continue; // digests and absent objects are not our business
    candidates += 1;
    if (reachable.has(sha)) continue;
    if (anchorTargets.has(sha)) continue; // already correctly anchored
    unreachable.push(sha);
  }
  unreachable.sort();

  const pinned = [];
  const repaired = [];
  if (mode === 'apply') {
    // Repair name/OID mismatches first: leaving one in place keeps a lie in a
    // namespace whose whole value is that it cannot lie.
    for (const bad of mismatched) {
      try { git(root, ['update-ref', '-d', bad.ref]); repaired.push(bad.ref); }
      catch (error) { fail(`cannot remove mismatched anchor ${bad.ref}: ${error.message}`); }
    }
    for (const sha of unreachable) {
      try { git(root, ['update-ref', `${ANCHOR_PREFIX}${sha}`, sha]); pinned.push(sha); }
      catch (error) { fail(`cannot pin ${sha}: ${error.message}`); }
    }
  }

  const result = {
    mode,
    receipt_root: receiptRoot,
    scanned_files: files.length,
    candidates,
    excluded_refs: excludeRefs,
    unreachable,
    pinned,
    repaired,
    mismatched_anchors: mismatched.map((m) => m.ref),
    anchors_total: anchorTargets.size + pinned.length,
  };

  if (asJson || mode === 'apply') { process.stdout.write(`${JSON.stringify(result)}\n`); return; }
  process.stdout.write(`receipt-referenced commits: ${candidates}\n`);
  if (excludeRefs.length) process.stdout.write(`reachability excludes: ${excludeRefs.join(' ')}\n`);
  if (mismatched.length) process.stdout.write(`name/OID mismatched anchors: ${mismatched.length}\n`);
  process.stdout.write(`unreachable (would be pinned): ${unreachable.length}\n`);
  for (const sha of unreachable) process.stdout.write(`  ${sha}\n`);
  if (unreachable.length) process.stdout.write('\nrun `pin-evidence-anchors.js apply` to anchor them\n');
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { fail(error.message); }
}

module.exports = { ANCHOR_PREFIX };
