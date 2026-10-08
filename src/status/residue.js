'use strict';

// src/status/residue.js — the worktree-residue fact the runs watcher publishes (stage-graph plan P7 D3, band `wt N`).
//
//   <live>/runs/<project_key>.residue.json   schema autopilot.residue/1   (project scope)
//   { schema, project_key, at, reapable_worktrees, by_class: { <class>: n }, source: "repo-residue-sweep scan" }
//
// `reapable_worktrees` = worktrees of class clean-integrated + missing-dir, i.e. exactly what `repo-residue-sweep.js reap`
// would remove without --preserve-dir. Dirty / clean-unintegrated / live worktrees are never counted: they are not the
// band's "you can clean this" number. The count restates a scan (git facts, flock); it attests nothing.
//
// The scan (scripts/repo-residue-sweep.js scan --json) can take seconds on a repo with many worktrees, so it is spawned
// ASYNCHRONOUSLY, never on the tick's critical path, at most once per THROTTLE_S per publisher (= per project), and never
// two at once. On any failure (spawn error, non-zero exit, unparseable output, timeout) the previous file is left in place
// and one line is logged; the next attempt waits the throttle again.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCHEMA = 'autopilot.residue/1';
const THROTTLE_S = 60;
const SCAN_TIMEOUT_MS = 45000;
const MAX_OUT_BYTES = 8 * 1024 * 1024;
const REAPABLE_CLASSES = ['clean-integrated', 'missing-dir'];
const SWEEP = path.join(__dirname, '..', '..', 'scripts', 'repo-residue-sweep.js');

function buildResidueFact({ key, report, atMs }) {
  const byClass = {};
  for (const w of Array.isArray(report && report.worktrees) ? report.worktrees : []) {
    if (w && typeof w.class === 'string') byClass[w.class] = (byClass[w.class] || 0) + 1;
  }
  return {
    schema: SCHEMA,
    project_key: key,
    at: new Date(atMs).toISOString(),
    reapable_worktrees: REAPABLE_CLASSES.reduce((n, c) => n + (byClass[c] || 0), 0),
    by_class: byClass,
    source: 'repo-residue-sweep scan',
  };
}

// Run one child to completion, output capped, hard timeout. Never rejects: -> { code, out, err, error }.
function capture(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let settled = false;
    let child;
    const done = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out, err, error });
    };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_e) { /* gone */ } done(null, new Error('timeout')); }, timeoutMs);
    timer.unref();
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { done(null, e); return; }
    child.stdout.on('data', (d) => { if (out.length < MAX_OUT_BYTES) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 4096) err += d; });
    child.on('error', (e) => done(null, e));
    child.on('close', (code) => done(code, null));
  });
}

// The sweep excludes the checkout it is pointed at, so it must be pointed at the MAIN worktree (git lists it first): scanned
// from a linked worktree it would count the main checkout as `clean-integrated` and inflate the reapable count by one.
async function mainWorktreeOf(repo) {
  const r = await capture('git', ['-C', repo, 'worktree', 'list', '--porcelain'], 10000);
  if (r.error || r.code !== 0) return repo;
  const first = String(r.out).split('\n').find((l) => l.startsWith('worktree '));
  return first ? first.slice('worktree '.length) : repo;
}

function createResiduePublisher({ runsDir, key, repo, writeAtomic, log = () => {}, now = Date.now, sweep = SWEEP, nodeBin = process.execPath, throttleS = THROTTLE_S }) {
  const file = path.join(runsDir, `${key}.residue.json`);
  let lastStartMs = null;
  let inflight = null; // Promise while a scan runs

  function finish(r) {
    if (r.error || r.code !== 0) { log(`residue scan failed (${r.error ? r.error.message : `rc=${r.code}`}); keeping the previous file${r.err ? `: ${String(r.err).trim().slice(0, 200)}` : ''}`); return false; }
    let report;
    try { report = JSON.parse(r.out); } catch (e) { log(`residue scan output unparseable (${e.message}); keeping the previous file`); return false; }
    if (!report || !Array.isArray(report.worktrees)) { log('residue scan output has no worktrees[]; keeping the previous file'); return false; }
    if (!fs.existsSync(runsDir)) return false; // the live dir vanished while the scan ran (teardown): do not recreate it
    try { writeAtomic(file, `${JSON.stringify(buildResidueFact({ key, report, atMs: now() }), null, 2)}\n`); return true; } catch (e) { log(`residue write failed: ${e.message}`); return false; }
  }

  // Returns the in-flight Promise when a scan was started (tests await it), else null. Never throws, never blocks.
  function publish({ nowMs }) {
    if (inflight) return null; // never two at once
    if (lastStartMs !== null && nowMs - lastStartMs < throttleS * 1000) return null;
    lastStartMs = nowMs;
    inflight = (async () => {
      try {
        const main = await mainWorktreeOf(repo);
        return finish(await capture(nodeBin, [sweep, 'scan', '--repo', main, '--json'], SCAN_TIMEOUT_MS));
      } catch (e) { log(`residue publish failed: ${e.message}`); return false; } finally { inflight = null; }
    })();
    return inflight;
  }

  return { publish, file };
}

module.exports = { SCHEMA, THROTTLE_S, REAPABLE_CLASSES, buildResidueFact, createResiduePublisher };
