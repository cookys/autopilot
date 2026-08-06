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

// In a partial clone, `rev-list` and `cat-file` will silently contact the promisor
// remote and WRITE the fetched objects into the repo — which would make `scan`, a
// documented read-only operation, mutate the repository. Disable lazy fetching so
// an object that is not present locally is reported as absent instead.
const NO_LAZY_FETCH_ENV = { ...process.env, GIT_NO_LAZY_FETCH: '1' };

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

// Every git call here feeds a decision that authorizes deleting refs, so a failed
// probe must never be indistinguishable from a negative answer. `git` is fatal on
// any non-zero exit; `gitProbe` returns the exit code and stderr so a caller can
// tell "git says no" from "git could not answer".
function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: NO_LAZY_FETCH_ENV,
    }).trim();
  } catch (error) {
    const stderr = (error.stderr || '').toString().trim();
    fail(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
    return null; // unreachable; fail() exits
  }
}

function gitProbe(root, args) {
  try {
    const out = execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: NO_LAZY_FETCH_ENV,
    });
    return { ok: true, code: 0, out: out.trim(), stderr: '' };
  } catch (error) {
    return {
      ok: false,
      code: typeof error.status === 'number' ? error.status : null,
      out: (error.stdout || '').toString().trim(),
      stderr: (error.stderr || '').toString().trim(),
    };
  }
}

// `cat-file -t` exits non-zero both for "no such object" and for a broken object
// store. Only the former means "not a commit"; the latter must stop the run
// rather than quietly exclude a SHA we were asked to protect.
const ABSENT_OBJECT = /not a valid object name|could not get object info|bad file/i;

function objectType(root, sha) {
  const probe = gitProbe(root, ['cat-file', '-t', sha]);
  if (probe.ok) return probe.out;
  if (ABSENT_OBJECT.test(probe.stderr)) return null; // genuinely absent
  fail(`cannot determine object type for ${sha}: ${probe.stderr || `git exited ${probe.code}`}`);
  return null; // unreachable
}

// Collect every regular file under dir. Any unreadable subtree or an exhausted
// budget aborts: a partial scan that reported success would authorize a deletion
// against evidence it never looked at.
function collectFiles(dir, out, seen) {
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
    if (entry.isDirectory()) { collectFiles(full, out, seen); continue; }
    if (entry.isFile()) { out.push(full); continue; }
    // Anything else — symlink, socket, fifo, unstatable — is resolved explicitly
    // rather than skipped. A symlinked receipt subtree that silently vanished from
    // the scan would let `apply` report success over evidence it never read.
    let st;
    try { st = fs.statSync(full); }
    catch (error) { fail(`cannot stat receipt entry ${full}: ${error.message}`); }
    const key = `${st.dev}:${st.ino}`;
    if (seen.has(key)) continue; // symlink loop or repeated target
    seen.add(key);
    if (st.isDirectory()) collectFiles(full, out, seen);
    else if (st.isFile()) out.push(full);
    else fail(`unsupported receipt entry ${full} (not a file or directory); refusing a partial scan`);
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

  const topProbe = gitProbe(repoRoot, ['rev-parse', '--show-toplevel']);
  if (!topProbe.ok) {
    fail(`not a git repository (${repoRoot}): ${topProbe.stderr || `git exited ${topProbe.code}`}`);
  }
  const root = topProbe.out;
  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);

  // Only a genuine ENOENT means "this repo has no mission state". A permission or
  // I/O error must not collapse into the same no-op success.
  const receiptRoot = path.join(commonDir, 'autopilot');
  // lstat first: a DANGLING symlink at the receipt root makes statSync report
  // ENOENT, which would read as "this repo has no mission state" and authorize a
  // deletion without ever traversing an unavailable receipt tree. lstat sees the
  // link itself, so genuine absence and a broken link are distinguishable.
  let receiptRootMissing = false;
  try {
    fs.lstatSync(receiptRoot);
    try { fs.statSync(receiptRoot); }
    catch (error) { fail(`receipt root ${receiptRoot} exists but does not resolve: ${error.message}`); }
  } catch (error) {
    if (error.code === 'ENOENT') receiptRootMissing = true;
    else fail(`cannot stat ${receiptRoot}: ${error.message}`);
  }
  if (receiptRootMissing) {
    process.stdout.write(`${JSON.stringify({
      mode, receipt_root: receiptRoot, scanned_files: 0, candidates: 0,
      excluded_refs: excludeRefs, unreachable: [], pinned: [], repaired: [], anchors_total: 0,
    })}\n`);
    return; // no mission state here — nothing to anchor, not an error
  }

  const files = [];
  collectFiles(receiptRoot, files, new Set());

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
  const symbolic = [];
  const anchorRefs = git(root, ['for-each-ref', '--format=%(refname) %(objectname) %(symref)', ANCHOR_PREFIX]);
  if (anchorRefs) {
    for (const line of anchorRefs.split('\n')) {
      if (!line) continue;
      const [ref, oid, symref] = line.split(' ');
      const named = ref.slice(ANCHOR_PREFIX.length);
      // A symbolic anchor is not something this tool ever creates. Left alone it
      // would protect a SHA through whatever branch it points at — including a
      // branch queued for deletion — and any repair would follow the symref and
      // rewrite that BRANCH instead of the anchor. Refuse rather than guess.
      if (symref) { symbolic.push({ ref, symref }); continue; }
      if (named === oid) anchorTargets.set(named, oid);
      else mismatched.push({ ref, named, oid });
    }
  }
  if (symbolic.length) {
    fail(`symbolic anchor ref(s) present, refusing to act: ${
      symbolic.map((s) => `${s.ref} -> ${s.symref}`).join(', ')
    }. Remove them with \`git symbolic-ref --delete\` after confirming what they were for.`);
  }

  // Reachability against the refs that SURVIVE this run: neither the caller's
  // pending deletions nor the mismatched anchors we are about to remove.
  const doomedRefs = [...excludeRefs, ...mismatched.map((m) => m.ref)];
  const revListArgs = ['rev-list'];
  for (const ref of doomedRefs) revListArgs.push(`--exclude=${ref}`);
  revListArgs.push('--all');
  const reachable = new Set();
  const revList = git(root, revListArgs);
  if (revList) for (const line of revList.split('\n')) if (line) reachable.add(line);

  const unreachable = [];
  let candidates = 0;
  for (const sha of tokens) {
    const type = objectType(root, sha);
    if (type !== 'commit') continue; // digests and absent objects are not our business
    candidates += 1;
    if (reachable.has(sha)) continue;
    if (anchorTargets.has(sha)) continue; // already correctly anchored
    unreachable.push(sha);
  }
  unreachable.sort();

  const pinned = [];
  const repaired = [];
  if (mode === 'apply' && (unreachable.length || mismatched.length)) {
    // ONE transaction, creates ordered before deletes. A mismatched anchor may be
    // the last ref holding a receipt-referenced commit up (it points at that
    // commit's descendant), so deleting it in a separate call that is followed by
    // a failed create would expose the evidence — the preservation step itself
    // becoming the loss. `update-ref --stdin` applies all or none.
    // `update` rather than `create`: a mismatched anchor is often named for the
    // very SHA being pinned (that is how it masked it), and git refuses two
    // updates to one ref in a transaction. `update` corrects an existing ref and
    // creates a missing one, so the delete list covers only anchors that are not
    // being rewritten.
    const rewritten = new Set(unreachable);
    const stdin = [
      ...unreachable.map((sha) => `update ${ANCHOR_PREFIX}${sha} ${sha}`),
      ...mismatched.filter((bad) => !rewritten.has(bad.named)).map((bad) => `delete ${bad.ref}`),
      '',
    ].join('\n');
    try {
      execFileSync('git', ['-C', root, 'update-ref', '--no-deref', '--stdin'], {
        input: stdin, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const stderr = (error.stderr || '').toString().trim();
      fail(`anchor transaction failed (nothing applied)${stderr ? `: ${stderr}` : ''}`);
    }
    pinned.push(...unreachable);
    repaired.push(...mismatched.map((bad) => bad.ref));
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
