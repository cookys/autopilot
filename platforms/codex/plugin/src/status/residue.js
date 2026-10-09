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
// auto_ran_at / auto_removed_count / auto_archived_count and lends its cached sizes. needs_human_count / needs_human (capped at 20) come
// from the watcher's own scan (`needs_human` in `scan --json`), so they track the repo and do not need the auto run; needs_human_bytes
// is the sum of the sizes known by path (null when none). The band's `wt N` is needs_human_count. The watcher never starts `du`.
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

// The list a person must act on comes from the watcher's own throttled `scan --json` (so it follows the repo as the person acts
// on it, and exists with residue.auto_reap=false); the auto-run record only lends cached sizes (matched by path) and the auto_* counts.
function validAuto(auto) {
  return auto && typeof auto === 'object' && auto.schema === AUTO_SCHEMA && isCount(auto.needs_human_count) ? auto : null;
}
function cachedSizes(auto) {
  const m = new Map();
  for (const e of Array.isArray(auto.needs_human) ? auto.needs_human : []) {
    if (e && e.kind === 'worktree' && textOf(e.path) && isCount(e.bytes)) m.set(e.path, e.bytes);
  }
  return m;
}

// scan report (+ optional auto record) -> the additive fields. No `needs_human` array in the scan = no needs_human fields.
function autoFields(report, auto) {
  const valid = validAuto(auto);
  const scanList = report && Array.isArray(report.needs_human) ? report.needs_human : null;
  const out = {};
  if (scanList) {
    const sizes = valid ? cachedSizes(valid) : new Map();
    const rows = [];
    let known = 0; let anyKnown = false;
    for (const e of scanList) {
      if (!e || typeof e !== 'object' || (e.kind !== 'worktree' && e.kind !== 'branch')) continue;
      if (e.kind === 'worktree' ? !textOf(e.path) : !textOf(e.branch)) continue;
      const bytes = e.kind === 'worktree' && sizes.has(e.path) ? sizes.get(e.path) : null;
      if (bytes !== null) { known += bytes; anyKnown = true; }
      const row = {
        kind: e.kind,
        class: textOf(e.class) || 'unknown',
        age_days: Number.isFinite(e.age_days) ? e.age_days : null,
        bytes,
        reason: textOf(e.reason),
        command: textOf(e.command),
      };
      if (e.kind === 'worktree') row.path = e.path; else row.branch = e.branch;
      rows.push(row);
    }
    out.needs_human_count = rows.length;
    out.needs_human_bytes = anyKnown ? known : null;
    out.needs_human = rows.slice(0, NEEDS_HUMAN_CAP);
  }
  if (valid) {
    out.auto_ran_at = textOf(valid.ran_at);
    out.auto_removed_count = Array.isArray(valid.removed) ? valid.removed.length : 0;
    out.auto_archived_count = Array.isArray(valid.archived) ? valid.archived.length : 0;
  }
  return out;
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
    ...autoFields(report, auto),
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
