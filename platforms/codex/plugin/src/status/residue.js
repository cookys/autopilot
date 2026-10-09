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
// Residue auto-reap R4 (docs/plans/evidence/2026-10-09-residue-auto-reap/contract.md): when `<git-common-dir>/autopilot-residue-auto.json`
// (written by `repo-residue-sweep.js reap --auto`, schema autopilot.residue-auto/1) exists, the fact also carries the additive fields
// needs_human_count / needs_human_bytes / needs_human (capped at 20) / auto_ran_at / auto_removed_count / auto_archived_count. The band's
// `wt N` is needs_human_count. This file is only READ here: the watcher never starts `du` (sizes come from the auto run).
//
// The scan (scripts/repo-residue-sweep.js scan --json) can take seconds on a repo with many worktrees, so it is spawned
// ASYNCHRONOUSLY, never on the tick's critical path, at most once per THROTTLE_S per publisher (= per project), and never
// two at once. On any failure (spawn error, non-zero exit, unparseable output, timeout) the previous file is left in place
// and one line is logged; the next attempt waits the throttle again. If the main worktree cannot be resolved the publish is skipped the same way
// (scanning the supplied checkout instead would silently change what is counted).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCHEMA = 'autopilot.residue/1';
const THROTTLE_S = 60;
const SCAN_TIMEOUT_MS = 45000;
const MAX_OUT_BYTES = 8 * 1024 * 1024;
const AUTO_SCHEMA = 'autopilot.residue-auto/1';
const AUTO_FILE = 'autopilot-residue-auto.json';
const NEEDS_HUMAN_CAP = 20;
const REAPABLE_CLASSES = ['clean-integrated', 'missing-dir'];
const SWEEP = path.join(__dirname, '..', '..', 'scripts', 'repo-residue-sweep.js');

const isCount = (v) => Number.isInteger(v) && v >= 0;
const textOf = (v) => (typeof v === 'string' && v ? v : null);

// A valid autopilot.residue-auto/1 record -> the additive fields, else null (absent / foreign / unparseable = no fields).
function autoFields(auto) {
  if (!auto || typeof auto !== 'object' || auto.schema !== AUTO_SCHEMA || !isCount(auto.needs_human_count)) return null;
  const rows = [];
  for (const e of Array.isArray(auto.needs_human) ? auto.needs_human : []) {
    if (!e || typeof e !== 'object' || (e.kind !== 'worktree' && e.kind !== 'branch')) continue;
    const row = {
      kind: e.kind,
      class: textOf(e.class) || 'unknown',
      age_days: Number.isFinite(e.age_days) ? e.age_days : null,
      bytes: isCount(e.bytes) ? e.bytes : null,
      reason: textOf(e.reason),
      command: textOf(e.command),
    };
    if (e.kind === 'worktree') { if (!textOf(e.path)) continue; row.path = e.path; } else { if (!textOf(e.branch)) continue; row.branch = e.branch; }
    rows.push(row);
    if (rows.length >= NEEDS_HUMAN_CAP) break;
  }
  return {
    needs_human_count: auto.needs_human_count,
    needs_human_bytes: isCount(auto.needs_human_bytes) ? auto.needs_human_bytes : null,
    needs_human: rows,
    auto_ran_at: textOf(auto.ran_at),
    auto_removed_count: Array.isArray(auto.removed) ? auto.removed.length : 0,
    auto_archived_count: Array.isArray(auto.archived) ? auto.archived.length : 0,
  };
}

function buildResidueFact({ key, report, atMs, auto = null }) {
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
    ...(autoFields(auto) || {}),
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
  if (r.error || r.code !== 0) return null;
  const first = String(r.out).split('\n').find((l) => l.startsWith('worktree '));
  return first ? first.slice('worktree '.length) : null;
}

// The auto-run record sits in the repo's git common dir; read it (never throws) -> object or null.
async function readAutoRecord(main) {
  const r = await capture('git', ['-C', main, 'rev-parse', '--path-format=absolute', '--git-common-dir'], 10000);
  if (r.error || r.code !== 0) return null;
  const common = String(r.out).trim();
  if (!common) return null;
  try { return JSON.parse(fs.readFileSync(path.join(common, AUTO_FILE), 'utf8')); } catch (_e) { return null; }
}

function createResiduePublisher({ runsDir, key, repo, writeAtomic, log = () => {}, now = Date.now, sweep = SWEEP, nodeBin = process.execPath, throttleS = THROTTLE_S }) {
  const file = path.join(runsDir, `${key}.residue.json`);
  let lastStartMs = null;
  let inflight = null; // Promise while a scan runs

  function finish(r, auto) {
    if (r.error || r.code !== 0) { log(`residue scan failed (${r.error ? r.error.message : `rc=${r.code}`}); keeping the previous file${r.err ? `: ${String(r.err).trim().slice(0, 200)}` : ''}`); return false; }
    let report;
    try { report = JSON.parse(r.out); } catch (e) { log(`residue scan output unparseable (${e.message}); keeping the previous file`); return false; }
    if (!report || !Array.isArray(report.worktrees)) { log('residue scan output has no worktrees[]; keeping the previous file'); return false; }
    if (!fs.existsSync(runsDir)) return false; // the live dir vanished while the scan ran (teardown): do not recreate it
    try { writeAtomic(file, `${JSON.stringify(buildResidueFact({ key, report, atMs: now(), auto }), null, 2)}\n`); return true; } catch (e) { log(`residue write failed: ${e.message}`); return false; }
  }

  // Returns the in-flight Promise when a scan was started (tests await it), else null. Never throws, never blocks.
  function publish({ nowMs }) {
    if (inflight) return null; // never two at once
    if (lastStartMs !== null && nowMs - lastStartMs < throttleS * 1000) return null;
    lastStartMs = nowMs;
    inflight = (async () => {
      try {
        const main = await mainWorktreeOf(repo);
        if (main === null) { log('residue: cannot resolve the main worktree (git worktree list failed); keeping the previous file'); return false; }
        const scanned = await capture(nodeBin, [sweep, 'scan', '--repo', main, '--json'], SCAN_TIMEOUT_MS);
        return finish(scanned, await readAutoRecord(main));
      } catch (e) { log(`residue publish failed: ${e.message}`); return false; } finally { inflight = null; }
    })();
    return inflight;
  }

  return { publish, file };
}

module.exports = { SCHEMA, AUTO_SCHEMA, AUTO_FILE, NEEDS_HUMAN_CAP, autoFields, THROTTLE_S, REAPABLE_CLASSES, buildResidueFact, createResiduePublisher };
