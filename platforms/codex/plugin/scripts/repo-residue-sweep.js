#!/usr/bin/env node
'use strict';
// repo-residue-sweep — repo-WIDE worktree + branch residue: classify, preserve, reap.
//
// PROBLEM (308-db, 2026-09-12, BACKLOG "PEER-REPORTED (308 dogfood)" (a)): the per-run
// lifecycle (reap-dispatch-worktrees.sh / reap-dispatch-branches.sh / lifecycle-residue-receipt)
// only sees resources the managed leaf lifecycle created. 308 had 51 worktrees (15 dirty) and
// 88 branches (65 unintegrated), most made by foremen through dispatch-hetero or by hand, and
// three dirty worktrees held staged-but-never-committed source that existed nowhere else. The
// peer exported patches by hand and said nothing guaranteed it. This tool is that guarantee.
//
// USAGE:
//   repo-residue-sweep.js scan     --repo <dir> [--integration-ref <ref>] [--sizes] [--json]
//   repo-residue-sweep.js preserve --repo <dir> --out <dir> [--worktree <path>]... [--json]
//   repo-residue-sweep.js reap     --repo <dir> --yes [--preserve-dir <dir>] [--older-than-days N]
//                                  [--integration-ref <ref>] [--json]
//   repo-residue-sweep.js reap     --repo <dir> --auto --yes [--integration-ref <ref>] [--json]
//
// CLASSES (from git facts, never from a marker's claim):
//   worktree: live | missing-dir | dirty | clean-integrated | clean-unintegrated
//     live      — `.autopilot-worktree.lock` is held (a rail is running in it): never touched
//     dirty     — any `git status --porcelain` line (staged, unstaged, untracked)
//     integrated— the worktree's HEAD is an ancestor of --integration-ref (default: the main
//                 checkout's HEAD)
//   branch:   checked-out | integrated | unintegrated  (+ ahead count, last commit date)
//
// PRESERVE: for a dirty worktree, write <out>/<name>/{staged.patch,unstaged.patch,
// untracked.tar,manifest.json}. A patch is VERIFIED by `git apply --check` against the
// worktree's own HEAD tree in a scratch index; untracked files are archived with `tar` and
// the archive listed back. `preserved: true` only when every part verified; otherwise the
// worktree stays and the manifest says which part failed.
//
// REAP (requires --yes):
//   removes  missing-dir + clean-integrated worktrees; dirty worktrees ONLY when a manifest
//            under --preserve-dir names this worktree's path + HEAD and re-verifies now
//   deletes  integrated branches not checked out anywhere, AFTER
//            pin-evidence-anchors.js apply --exclude-ref <each> (receipt-anchored commits stay
//            reachable; an anchor failure aborts the branch phase)
//   never    live worktrees, unintegrated branches, unpreserved dirty worktrees
//   --older-than-days narrows the candidate set (age from the marker's created_at, else the
//   branch's last commit date, else the directory mtime); it never widens it.
//
// AUTO MODE (`reap --auto --yes`) — THE CANONICAL AUTOMATIC REAPER (run by the SessionStart
// hook residue-auto-reap.js; `dispatch-hetero.sh --gc` is only an opt-in, rail-local fast
// path, default off). It does not combine with --preserve-dir / --older-than-days. It may
// remove ONLY:
//   1. missing-dir worktrees (`git worktree prune`);
//   2. marker worktrees (schema-2 marker valid by the same grammar as _wt_read_schema2_marker
//      in scripts/lib/worktree-reap.sh) that are not live (flock), have no process cwd inside
//      (/proc/*/cwd; no /proc = treated as busy), are clean, whose HEAD is the tip of the local
//      branch they have checked out (detached = skipped), that are clean-integrated OR
//      lease-expired (retention_expires_at, else created_at + residue.lease_hours), that do not
//      hold an unexpired explicit `retention=lease`, and that do not belong to an unresolved
//      campaign or Mission (root_run_id; see CAMPAIGN SIGNAL). The branch always stays;
//   3. dispatch branches (^(hands|hetero|foreman)/ + residue.branch_prefixes): integrated ones
//      (idle >= 1 h) via pin-evidence-anchors + `branch -D`; unintegrated ones idle longer than
//      residue.archive_branch_days (later of tip committer date and newest reflog entry), not
//      checked out, not pointed at by a live/unexpired-lease marker, not in an unresolved
//      campaign, after `update-ref refs/archive/<YYYY-MM-DD>/<branch> <tip>` + verify. Restore:
//      `git branch <name> refs/archive/<date>/<name>`.
// Everything else is remind-only: `needs_human` (kind, path|branch, class, age_days, bytes,
// reason, command) + needs_human_count / needs_human_bytes, emitted by `scan --json` too.
// `bytes` (`du -sk`, 60 s total budget, null after it) exists only for `reap --auto` and
// `scan --sizes`; a plain scan copies cached sizes from the auto result. The auto result is
// written to <git-common-dir>/autopilot-residue-auto.json (schema autopilot.residue-auto/1).
// Config: scripts/lib/residue-config.js (residue.auto_reap, lease_hours, archive_branch_days,
// branch_prefixes). pin-evidence-anchors is run before every branch deletion, archived or not
// (the archive ref would keep the tip reachable, but anchors may point at commits that are
// not the tip's ancestors, so the integrated path's guard is reused unchanged).
// CAMPAIGN SIGNAL (authoritative): a root_run_id is "unresolved" when the campaign journal
// <git-common-dir>/autopilot/implementation-campaign.jsonl has a non-terminal last event for it
// (src/engine/final-panel-seat-store.js campaignLastEvents / TERMINAL_EVENT_TYPES — the same
// signal that governs final-panel seat reaping) or the Mission registry
// <git-common-dir>/autopilot/mission/registry.json has an unresolved state whose root_run_id
// (state.root_run_id, `mission-<adoptionKey[:24]>`; src/mission/runtime.js stateIsUnresolved)
// equals it. If either source cannot be read, every marker worktree whose root_run_id differs
// from its run_id is skipped and every archive is skipped ("campaign_signal_unavailable").
//
// FINAL-PANEL SEATS: `<git-common-dir>/autopilot/final-panel-seats/<campaign_id>/` (resume
// artifacts, read only by a --resume). Class from the campaign journal, never from the
// directory: terminal (last journaled event is terminal_ready|terminal_follow_up|terminal_stop)
// | active (any other journaled event: parked or running, kept) | unknown (not journaled) |
// unsafe-name (not a plain token; never touched) | unverifiable (journal unreadable). reap
// removes terminal, and unknown ONLY while no linked worktree lock is held AND its newest
// file is older than UNKNOWN_SEAT_MIN_AGE_DAYS (14; --older-than-days overrides, 0 allowed).
// Every scan row carries decision keep|reap and a reason.
//
// OUTPUT: one JSON object; `scan` is read-only. EXIT: 0 ok · 1 reap left something it was asked
// to remove (named) · 2 usage / cannot run. A scan finding is not an error.
//
// TRUST: nothing here reads a rail's self-report. Lock state comes from flock, dirtiness from
// git status, integration from merge-base, preservation from git apply --check.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const seatStore = require('../src/engine/final-panel-seat-store');
const { TERMINAL_STATES: MISSION_TERMINAL_STATES } = require('../src/engine/mission-convergence');
const { loadResidueConfig } = require('./lib/residue-config');

// An `unknown` seat subtree (campaign not found in the readable journal generations) may still
// belong to a parked, resumable campaign whose rows rotated out; no lock proves nothing about it.
// It is reaped only once its NEWEST file is older than this floor (--older-than-days overrides).
const UNKNOWN_SEAT_MIN_AGE_DAYS = 14;

const DISPATCH_BRANCH_RE = /^(hands|hetero|foreman)\//;
const SIZE_BUDGET_MS = 60 * 1000;
// An integrated dispatch branch younger than this is left alone: `worktree add -b` and a
// branch created ahead of its worktree both start integrated (tip == base).
const MIN_INTEGRATED_BRANCH_IDLE_S = 3600;
const AUTO_RESULT_NAME = 'autopilot-residue-auto.json';

function usage(msg) {
  if (msg) process.stderr.write(`repo-residue-sweep: ${msg}\n`);
  process.stderr.write('usage: repo-residue-sweep.js scan|preserve|reap --repo <dir> [--integration-ref <ref>] [--out <dir>] [--worktree <path>]... [--yes] [--auto] [--sizes] [--preserve-dir <dir>] [--older-than-days N] [--json]\n');
  process.exit(2);
}

function parseArgs(argv) {
  const out = { cmd: null, repo: null, integrationRef: null, out: null, worktrees: [], yes: false, preserveDir: null, olderThanDays: null, auto: false, sizes: false };
  const cmd = argv[0];
  if (!['scan', 'preserve', 'reap'].includes(cmd)) usage(`command must be scan|preserve|reap (got: ${cmd || ''})`);
  out.cmd = cmd;
  for (let i = 1; i < argv.length; i += 1) {
    const k = argv[i];
    const need = () => { if (argv[i + 1] === undefined) usage(`${k} needs a value`); i += 1; return argv[i]; };
    if (k === '--repo') out.repo = need();
    else if (k === '--integration-ref') out.integrationRef = need();
    else if (k === '--out') out.out = need();
    else if (k === '--worktree') out.worktrees.push(need());
    else if (k === '--yes') out.yes = true;
    else if (k === '--auto') out.auto = true;
    else if (k === '--sizes') out.sizes = true;
    else if (k === '--preserve-dir') out.preserveDir = need();
    else if (k === '--older-than-days') { out.olderThanDays = Number(need()); if (!Number.isFinite(out.olderThanDays) || out.olderThanDays < 0) usage('--older-than-days must be a non-negative number'); }
    else if (k === '--json') { /* default */ }
    else if (k === '-h' || k === '--help') { process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n') + '\n'); process.exit(0); }
    else usage(`unknown argument: ${k}`);
  }
  if (!out.repo) usage('--repo is required');
  if (cmd === 'preserve' && !out.out) usage('preserve requires --out <dir>');
  if (cmd === 'reap' && !out.yes) usage('reap requires --yes');
  if (out.auto && cmd !== 'reap') usage('--auto belongs to reap');
  if (out.auto && (out.preserveDir !== null || out.olderThanDays !== null)) usage('--auto does not combine with --preserve-dir or --older-than-days');
  if (out.sizes && cmd !== 'scan') usage('--sizes belongs to scan');
  return out;
}

function git(repo, args, opts = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' }, ...opts });
  return { ok: r.status === 0, out: (r.stdout || '').replace(/\n$/, ''), err: (r.stdout === undefined ? String(r.error) : r.stderr || ''), status: r.status };
}
function mustGit(repo, args) {
  const r = git(repo, args);
  if (!r.ok) throw new Error(`git ${args.join(' ')} failed: ${r.err.trim()}`);
  return r.out;
}

function lockHeld(lockPath) {
  // flock -n succeeding means nobody holds it; failing with 1 means held. Absent lock file = not held.
  if (!fs.existsSync(lockPath)) return false;
  const r = spawnSync('flock', ['-n', lockPath, 'true'], { encoding: 'utf8' });
  if (r.error) return null; // flock unavailable: unknowable
  return r.status !== 0;
}

function readMarker(dir) {
  const p = path.join(dir, '.autopilot-worktree');
  if (!fs.existsSync(p)) return null;
  const m = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) m[line.slice(0, i)] = line.slice(i + 1);
  }
  return m;
}

function listWorktrees(repo) {
  const raw = mustGit(repo, ['worktree', 'list', '--porcelain']);
  const items = [];
  let cur = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), head: null, branch: null, bare: false, detached: false, prunable: null }; items.push(cur); }
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'bare') cur.bare = true;
    else if (line === 'detached') cur.detached = true;
    else if (line.startsWith('prunable')) cur.prunable = line.slice(8).trim() || 'prunable';
  }
  return items;
}

function isAncestor(repo, a, b) {
  const r = git(repo, ['merge-base', '--is-ancestor', a, b]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
}

function classifyWorktrees(repo, mainPath, integrationSha) {
  const now = Date.now();
  const rows = [];
  for (const wt of listWorktrees(repo)) {
    const p = path.resolve(wt.path);
    if (p === mainPath) continue;
    const row = { path: p, branch: wt.branch, head: wt.head, class: null, dirty_lines: null, lock_held: null, marker: null, age_days: null, integrated: null, reason: '' };
    if (!fs.existsSync(p)) { row.class = 'missing-dir'; row.reason = wt.prunable || 'directory absent'; rows.push(row); continue; }
    row.marker = readMarker(p);
    row.marker_strict = parseSchema2Marker(path.join(p, '.autopilot-worktree'));
    row.lock_held = lockHeld(path.join(p, '.autopilot-worktree.lock'));
    let ageMs = null;
    if (row.marker && /^\d+$/.test(row.marker.created_at || '')) ageMs = now - Number(row.marker.created_at) * 1000;
    else { try { ageMs = now - fs.statSync(p).mtimeMs; } catch { ageMs = null; } }
    row.age_days = ageMs === null ? null : Math.round(ageMs / 864000) / 100;
    if (row.lock_held === true) { row.class = 'live'; row.reason = 'worktree lock is held by a running rail'; rows.push(row); continue; }
    // A lock file whose state cannot be measured (no flock binary) is not "not held": the
    // worktree is unverifiable and reap never touches that class.
    if (row.lock_held === null) { row.class = 'unverifiable'; row.reason = 'lock file present but flock unavailable: liveness unknowable'; rows.push(row); continue; }
    const st = git(p, ['status', '--porcelain', '--untracked-files=all', '--ignored=no']);
    if (!st.ok) { row.class = 'unverifiable'; row.reason = `git status failed: ${st.err.trim()}`; rows.push(row); continue; }
    const lines = st.out ? st.out.split('\n').filter((l) => l && !/^\?\? \.autopilot-worktree(\.lock)?$/.test(l)) : [];
    row.dirty_lines = lines.length;
    if (lines.length > 0) { row.class = 'dirty'; row.reason += `${lines.length} uncommitted path(s)`; rows.push(row); continue; }
    row.integrated = wt.head ? isAncestor(repo, wt.head, integrationSha) : null;
    if (row.integrated === null) { row.class = 'unverifiable'; row.reason += 'merge-base could not run'; }
    else if (row.integrated) { row.class = 'clean-integrated'; row.reason += 'HEAD is an ancestor of the integration ref'; }
    else { row.class = 'clean-unintegrated'; row.reason += 'clean, but HEAD is not integrated'; }
    rows.push(row);
  }
  return rows;
}

function classifyBranches(repo, worktrees, integrationSha, integrationBranch) {
  const raw = mustGit(repo, ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(committerdate:unix)', 'refs/heads']);
  const checkedOut = new Map();
  for (const w of worktrees) if (w.branch) checkedOut.set(w.branch, w.path);
  const mainBranch = integrationBranch;
  const rows = [];
  for (const line of raw ? raw.split('\n') : []) {
    const [name, tip, date] = line.split('\0');
    if (!name) continue;
    const row = { branch: name, tip, last_commit_unix: Number(date) || null, class: null, ahead: null, checked_out_in: checkedOut.get(name) || null, integrated: null };
    if (name === mainBranch) { row.class = 'integration-ref'; rows.push(row); continue; }
    row.integrated = isAncestor(repo, tip, integrationSha);
    const ahead = git(repo, ['rev-list', '--count', `${integrationSha}..${tip}`]);
    row.ahead = ahead.ok ? Number(ahead.out) : null;
    if (row.checked_out_in) row.class = 'checked-out';
    else if (row.integrated === null) row.class = 'unverifiable';
    else row.class = row.integrated ? 'integrated' : 'unintegrated';
    rows.push(row);
  }
  return rows;
}

function newestMtimeMs(p) {
  let newest = 0;
  const walk = (q) => {
    let st; try { st = fs.lstatSync(q); } catch { return; }
    if (st.mtimeMs > newest) newest = st.mtimeMs;
    if (st.isDirectory()) { let names = []; try { names = fs.readdirSync(q); } catch { return; } for (const n of names) walk(path.join(q, n)); }
  };
  walk(p);
  return newest;
}

function classifyFinalPanelSeats(mainPath, worktrees, olderThanDays) {
  const common = git(mainPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common.ok) return { root: null, rows: [] };
  const root = path.join(common.out, 'autopilot', 'final-panel-seats');
  if (!fs.existsSync(root)) return { root, rows: [] };
  const events = seatStore.campaignLastEvents(path.join(common.out, 'autopilot', 'implementation-campaign.jsonl'));
  const lockUnknown = worktrees.some((w) => w.lock_held === true || w.lock_held === null);
  const now = Date.now();
  const rows = [];
  let names;
  try { names = fs.readdirSync(root).sort(); } catch { return { root, rows: [] }; }
  for (const name of names) {
    const p = path.join(root, name);
    let st; try { st = fs.lstatSync(p); } catch { continue; }
    const row = { campaign_id: name, path: p, class: null, age_days: Math.round((now - (st.isDirectory() ? newestMtimeMs(p) : st.mtimeMs)) / 864000) / 100, lock_held_elsewhere: lockUnknown, unknown_min_age_days: UNKNOWN_SEAT_MIN_AGE_DAYS, decision: 'keep', decision_reason: '', reason: '' };
    if (!st.isDirectory() || !seatStore.isPlainCampaignToken(name)) { row.class = 'unsafe-name'; row.reason = 'not a plain campaign-token directory'; row.decision_reason = row.reason; rows.push(row); continue; }
    if (events === null) { row.class = 'unverifiable'; row.reason = 'campaign journal unreadable'; row.decision_reason = row.reason; rows.push(row); continue; }
    const type = events.get(name);
    if (type === undefined) { row.class = 'unknown'; row.reason = 'campaign not journaled'; }
    else if (seatStore.TERMINAL_EVENT_TYPES.has(type)) { row.class = 'terminal'; row.reason = `last event ${type}`; }
    else { row.class = 'active'; row.reason = `last event ${type}: resumable, artifacts kept`; }
    const tooYoungFor = (floor) => floor !== null && row.age_days < floor;
    if (row.class === 'terminal') {
      if (tooYoungFor(olderThanDays)) row.decision_reason = `younger than ${olderThanDays} days`;
      else { row.decision = 'reap'; row.decision_reason = row.reason; }
    } else if (row.class === 'unknown') {
      const floor = olderThanDays !== null ? olderThanDays : UNKNOWN_SEAT_MIN_AGE_DAYS;
      if (lockUnknown) row.decision_reason = 'live_lock_held: a rail may own this campaign; journal not found';
      else if (row.age_days < floor) row.decision_reason = olderThanDays !== null ? `younger than ${olderThanDays} days` : `younger than the ${UNKNOWN_SEAT_MIN_AGE_DAYS}-day unknown-subtree floor (may be a parked campaign whose journal rotated out)`;
      else { row.decision = 'reap'; row.decision_reason = `journal not found, no live lock, newest file ${row.age_days} days old`; }
    } else row.decision_reason = row.reason;
    rows.push(row);
  }
  return { root, rows };
}

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function safeName(p) { const n = p.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '').slice(-120); return n || crypto.createHash('sha256').update(p).digest('hex').slice(0, 16); }

// Verify a patch applies to the worktree's HEAD tree in a scratch index (never the live index).
function patchAppliesToHead(wt, head, patchPath, cached) {
  if (fs.statSync(patchPath).size === 0) return true;
  const tmpIndex = path.join(os.tmpdir(), `residue-sweep-index-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const rt = spawnSync('git', ['-C', wt, 'read-tree', head], { encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: tmpIndex } });
    if (rt.status !== 0) return false;
    const args = ['-C', wt, 'apply', '--check', '--cached', patchPath];
    const r = spawnSync('git', args, { encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: tmpIndex } });
    // an unstaged patch is relative to the INDEX (staged) state; checking it against HEAD can
    // legitimately fail when staged hunks overlap. Fall back: staged+unstaged combined = HEAD..worktree.
    if (r.status !== 0 && !cached) return null;
    return r.status === 0;
  } finally { try { fs.unlinkSync(tmpIndex); } catch { /* absent */ } }
}

function preserveWorktree(repo, row, outRoot) {
  const wt = row.path;
  const name = `${safeName(path.basename(wt))}-${(row.head || 'nohead').slice(0, 12)}`;
  const dir = path.join(outRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const parts = {};
  const write = (file, args) => {
    const r = git(wt, args);
    if (!r.ok) { parts[file] = { ok: false, error: r.err.trim() }; return null; }
    const p = path.join(dir, file);
    fs.writeFileSync(p, r.out ? `${r.out}\n` : '');
    parts[file] = { ok: true, bytes: fs.statSync(p).size, sha256: sha256File(p) };
    return p;
  };
  const staged = write('staged.patch', ['diff', '--binary', '--cached', '--no-color']);
  const unstaged = write('unstaged.patch', ['diff', '--binary', '--no-color']);
  const combined = write('head-to-worktree.patch', ['diff', '--binary', '--no-color', 'HEAD']);
  let verified = true;
  if (staged) { const v = patchAppliesToHead(wt, row.head, staged, true); parts['staged.patch'].applies_to_head = v; if (v !== true) verified = false; }
  if (combined) { const v = patchAppliesToHead(wt, row.head, combined, true); parts['head-to-worktree.patch'].applies_to_head = v; if (v !== true) verified = false; }
  if (unstaged) parts['unstaged.patch'].note = 'relative to the index; head-to-worktree.patch is the verified whole';
  // untracked files: list from git, archive with tar, list the archive back
  const untracked = listUntracked(wt);
  let untrackedDigests = null;
  if (untracked === null) { parts['untracked.tar'] = { ok: false, error: 'git ls-files --others failed' }; verified = false; }
  else if (untracked.length > 0) {
    const listFile = path.join(dir, 'untracked.list');
    fs.writeFileSync(listFile, untracked.join('\0'));
    const tarPath = path.join(dir, 'untracked.tar');
    const t = spawnSync('tar', ['-C', wt, '--null', '-T', listFile, '-cf', tarPath], { encoding: 'utf8' });
    if (t.status !== 0) { parts['untracked.tar'] = { ok: false, error: (t.stderr || String(t.error)).trim() }; verified = false; }
    else {
      const back = spawnSync('tar', ['-tf', tarPath], { encoding: 'utf8' });
      const names = back.status === 0 ? back.stdout.split('\n').filter(Boolean) : [];
      const missing = untracked.filter((f) => !names.includes(f) && !names.includes(`./${f}`));
      parts['untracked.tar'] = { ok: missing.length === 0, count: untracked.length, bytes: fs.statSync(tarPath).size, sha256: sha256File(tarPath), missing };
      if (missing.length) verified = false;
    }
  } else parts['untracked.tar'] = { ok: true, count: 0 };
  // Per-file digests of every untracked path: `git diff HEAD` never sees untracked files and the
  // tar's own sha256 does not change when a NEW untracked file appears later, so reap re-derives
  // this inventory and refuses on any difference (review round 2, 2026-09-13).
  if (untracked !== null) untrackedDigests = untrackedInventory(wt, untracked);
  const manifest = { schema: 'repo-residue-preserve/2', worktree: wt, branch: row.branch, head: row.head, dirty_lines: row.dirty_lines, preserved_at: new Date().toISOString(), parts, untracked_inventory: untrackedDigests, preserved: verified && untrackedDigests !== null };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, preserved: verified, manifest };
}

function listUntracked(wt) {
  const unt = git(wt, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (!unt.ok) return null;
  return unt.out.split('\0').filter((f) => f && f !== '.autopilot-worktree' && f !== '.autopilot-worktree.lock').sort();
}
// {path: sha256} for every untracked path; a directory entry or unreadable file is recorded as such.
function untrackedInventory(wt, untracked) {
  const inv = {};
  for (const f of untracked) {
    const p = path.join(wt, f);
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) inv[f] = `symlink:${fs.readlinkSync(p)}`;
      else if (st.isFile()) inv[f] = sha256File(p);
      else inv[f] = `type:${st.mode.toString(8)}`;
    } catch { return null; }
  }
  return inv;
}

function findPreserveRecord(preserveDir, row) {
  if (!preserveDir || !fs.existsSync(preserveDir)) return null;
  for (const d of fs.readdirSync(preserveDir)) {
    const mp = path.join(preserveDir, d, 'manifest.json');
    if (!fs.existsSync(mp)) continue;
    let m; try { m = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { continue; }
    if (m.worktree === row.path && m.head === row.head && m.preserved === true) {
      // re-verify the bytes now: a manifest is a claim, the sha256 is the check
      for (const [file, part] of Object.entries(m.parts || {})) {
        if (part && part.sha256) { const p = path.join(preserveDir, d, file); if (!fs.existsSync(p) || sha256File(p) !== part.sha256) return { dir: path.join(preserveDir, d), valid: false, why: `${file} sha256 mismatch or missing` }; }
      }
      // the worktree must not have changed since: same dirty inventory digest
      const st = git(row.path, ['diff', '--binary', '--no-color', 'HEAD']);
      const cur = crypto.createHash('sha256').update(st.ok ? `${st.out}\n` : 'x').digest('hex');
      const rec = m.parts['head-to-worktree.patch'] && m.parts['head-to-worktree.patch'].sha256;
      if (!st.ok || cur !== rec) return { dir: path.join(preserveDir, d), valid: false, why: 'worktree changed since it was preserved' };
      // untracked inventory: names AND contents, re-derived now
      if (!m.untracked_inventory || typeof m.untracked_inventory !== 'object') return { dir: path.join(preserveDir, d), valid: false, why: 'preserve record has no untracked inventory (pre-v2 record); re-run preserve' };
      const nowList = listUntracked(row.path);
      const nowInv = nowList === null ? null : untrackedInventory(row.path, nowList);
      if (nowInv === null) return { dir: path.join(preserveDir, d), valid: false, why: 'untracked inventory could not be re-derived' };
      const a = JSON.stringify(Object.entries(m.untracked_inventory).sort());
      const b = JSON.stringify(Object.entries(nowInv).sort());
      if (a !== b) return { dir: path.join(preserveDir, d), valid: false, why: 'untracked files changed since it was preserved' };
      return { dir: path.join(preserveDir, d), valid: true };
    }
  }
  return null;
}

// ------------------------------------------------------------------ marker grammar
// Mirrors _wt_read_schema2_marker (scripts/lib/worktree-reap.sh) exactly: every line is one
// allowed key, each key at most once, the 7 required keys present, and the optional retention
// keys in one of the accepted shapes. hooks/tests/repo-residue-auto.test.sh runs both parsers
// over the same fixtures so they cannot drift.
const MARKER_REQUIRED = ['created_at', 'branch', 'base_sha', 'run_id', 'root_run_id', 'loop_id', 'schema'];
const MARKER_OPTIONAL = ['retention', 'retention_owner', 'retention_reason_sha256', 'retention_expires_at', 'retention_reason'];
function parseSchema2Marker(file) {
  const bad = (why) => ({ valid: false, why });
  let st;
  try { st = fs.lstatSync(file); } catch { return null; }
  if (!st.isFile() || st.isSymbolicLink()) return bad('marker is not a regular file');
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return bad('marker not owned by this user');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return bad('marker unreadable'); }
  if (!text.endsWith('\n')) return bad('last line has no newline');
  const kv = {};
  for (const line of text.slice(0, -1).split('\n')) {
    const i = line.indexOf('=');
    const key = i > 0 ? line.slice(0, i) : null;
    if (!key || !(MARKER_REQUIRED.includes(key) || MARKER_OPTIONAL.includes(key))) return bad(`unexpected line: ${line.slice(0, 40)}`);
    if (Object.prototype.hasOwnProperty.call(kv, key)) return bad(`duplicate key ${key}`);
    kv[key] = line.slice(i + 1);
  }
  for (const k of MARKER_REQUIRED) if (!Object.prototype.hasOwnProperty.call(kv, k)) return bad(`missing ${k}`);
  const has = (k) => Object.prototype.hasOwnProperty.call(kv, k);
  if (kv.schema !== '2') return bad('schema is not 2');
  if (!/^[0-9]+$/.test(kv.created_at)) return bad('created_at');
  if (!/^[0-9a-f]{40,64}$/.test(kv.base_sha)) return bad('base_sha');
  for (const k of ['run_id', 'root_run_id', 'loop_id']) if (!/^[A-Za-z0-9._-]+$/.test(kv[k])) return bad(k);
  const retention = has('retention') ? kv.retention : '';
  if (retention === 'lease') {
    if (!has('retention_owner') || !has('retention_reason_sha256') || !has('retention_expires_at')) return bad('incomplete lease');
    if (has('retention_reason')) return bad('lease carries retention_reason');
    if (!/^[A-Za-z0-9._-]+$/.test(kv.retention_owner)) return bad('retention_owner');
    if (!/^[0-9a-f]{64}$/.test(kv.retention_reason_sha256)) return bad('retention_reason_sha256');
    if (!/^[0-9]+$/.test(kv.retention_expires_at)) return bad('retention_expires_at');
  } else {
    if (retention !== '' && retention !== 'inspect') return bad('retention value');
    if (has('retention_owner') || has('retention_reason_sha256')) return bad('lease field without lease');
    if (has('retention_reason') !== has('retention_expires_at')) return bad('retention_reason and retention_expires_at travel together');
    if (has('retention_reason')) {
      if (!/^[a-z0-9_]+$/.test(kv.retention_reason)) return bad('retention_reason');
      if (!/^[0-9]+$/.test(kv.retention_expires_at)) return bad('retention_expires_at');
    }
  }
  const ref = spawnSync('git', ['check-ref-format', '--branch', kv.branch], { encoding: 'utf8' });
  if (ref.status !== 0) return bad('branch name');
  return {
    valid: true,
    lease: retention === 'lease',
    created_at: Number(kv.created_at),
    branch: kv.branch,
    run_id: kv.run_id,
    root_run_id: kv.root_run_id,
    retention_reason: has('retention_reason') ? kv.retention_reason : null,
    retention_expires_at: has('retention_expires_at') ? Number(kv.retention_expires_at) : null,
  };
}

// ------------------------------------------------------------------ liveness and campaign signals
// Every cwd (realpath) of every process this user can read, or null when /proc is unavailable.
function readProcCwds() {
  let pids;
  try { pids = fs.readdirSync('/proc').filter((n) => /^[0-9]+$/.test(n)); } catch { return null; }
  if (pids.length === 0) return null;
  const out = [];
  for (const pid of pids) { try { out.push(fs.readlinkSync(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/, '')); } catch { /* gone or not ours */ } }
  return out;
}
function cwdInside(cwds, dir) {
  if (cwds === null) return null; // unknowable: callers treat as busy
  let real = dir; try { real = fs.realpathSync(dir); } catch { /* missing */ }
  return cwds.some((c) => c === real || c.startsWith(`${real}/`));
}

function loadCampaignSignal(commonDir) {
  const unresolved = new Set();
  const why = [];
  const events = seatStore.campaignLastEvents(path.join(commonDir, 'autopilot', 'implementation-campaign.jsonl'));
  if (events === null) why.push('campaign journal unreadable');
  else for (const [id, type] of events) if (!seatStore.TERMINAL_EVENT_TYPES.has(type)) unresolved.add(id);
  const missionRoot = path.join(commonDir, 'autopilot', 'mission');
  const regPath = path.join(missionRoot, 'registry.json');
  if (fs.existsSync(regPath)) {
    let reg = null;
    try { reg = JSON.parse(fs.readFileSync(regPath, 'utf8')); } catch { why.push('mission registry unreadable'); }
    if (reg && reg.missions && typeof reg.missions === 'object') {
      for (const key of Object.keys(reg.missions)) {
        let state = null; let open = true;
        try {
          state = JSON.parse(fs.readFileSync(path.join(missionRoot, 'states', `${key}.json`), 'utf8'));
          open = !(state.terminal && MISSION_TERMINAL_STATES.has(state.state)); // same test as runtime.js stateIsUnresolved
        } catch { open = true; }
        if (open) {
          if (/^[0-9a-f]{24,}$/.test(key)) unresolved.add(`mission-${key.slice(0, 24)}`);
          if (state && typeof state.root_run_id === 'string') unresolved.add(state.root_run_id);
        }
      }
    } else if (reg) why.push('mission registry malformed');
  }
  return { reliable: why.length === 0, why, unresolved };
}

// ------------------------------------------------------------------ small helpers
function writeStdout(text) {
  // process.exit() after a large process.stdout.write truncates a pipe; write synchronously.
  const buf = Buffer.from(text); let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off, buf.length - off); } catch (e) { if (e.code === 'EAGAIN') continue; if (e.code === 'EPIPE') return; throw e; }
  }
}
function shq(v) { return `'${String(v).replace(/'/g, `'\\''`)}'`; }
function isDispatchBranch(name, cfg) { return DISPATCH_BRANCH_RE.test(name) || cfg.branch_prefixes.some((p) => name.startsWith(p)); }
function daysSince(unix, nowMs) { return unix ? Math.round(((nowMs / 1000 - unix) / 86400) * 100) / 100 : null; }
function utcDate(nowMs) { return new Date(nowMs).toISOString().slice(0, 10); }
function branchLastActivity(repo, b) {
  // later of the tip committer date and the newest reflog entry
  let t = b.last_commit_unix || 0;
  // `%gd` with --date=unix prints `<ref>@{<reflog entry time>}`; `%ct` would be the commit's date.
  const r = git(repo, ['reflog', 'show', '--date=unix', '--format=%gd', '-1', `refs/heads/${b.branch}`]);
  const m = r.ok ? /@\{(\d+)\}$/.exec(r.out.trim()) : null;
  if (m) t = Math.max(t, Number(m[1]));
  return t || null;
}

function annotateWorktrees(rows, cfg, nowMs, cwds, repo) {
  for (const w of rows) {
    w.marker_valid = null; w.retention_reason = null; w.retention_expires_at = null; w.lease = null; w.lease_expired = null;
    w.detached = false; w.head_is_branch_tip = null; w.cwd_busy = null;
    if (w.class === 'missing-dir') continue;
    w.cwd_busy = cwdInside(cwds, w.path);
    w.detached = !w.branch;
    if (w.branch) { const t = git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${w.branch}`]); w.head_is_branch_tip = t.ok && t.out.trim() === w.head; }
    const m = w.marker_strict;
    if (m && m.valid) {
      w.marker_valid = true;
      w.retention_reason = m.retention_reason;
      w.lease = m.lease ? 'lease' : (m.retention_reason ? 'default' : null);
      const exp = m.retention_expires_at !== null ? m.retention_expires_at : m.created_at + cfg.lease_hours * 3600;
      w.retention_expires_at = exp;
      w.lease_expired = nowMs / 1000 > exp;
    } else if (m) { w.marker_valid = false; w.reason = `${w.reason}${w.reason ? '; ' : ''}marker invalid: ${m.why}`; }
  }
}

function readCachedSizes(common) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(common, AUTO_RESULT_NAME), 'utf8'));
    const m = new Map();
    for (const e of j.needs_human || []) if (e.kind === 'worktree' && typeof e.bytes === 'number') m.set(e.path, e.bytes);
    return m;
  } catch { return new Map(); }
}
// du -sk per path under one shared budget; null once it is spent.
function measureSizes(paths) {
  const start = Date.now(); const out = new Map();
  for (const p of paths) {
    const left = SIZE_BUDGET_MS - (Date.now() - start);
    if (left <= 0) { out.set(p, null); continue; }
    const r = spawnSync('du', ['-sk', '--', p], { encoding: 'utf8', timeout: left });
    const kb = r.status === 0 ? Number(String(r.stdout).split(/\s/)[0]) : NaN;
    out.set(p, Number.isFinite(kb) ? kb * 1024 : null);
  }
  return out;
}

// ------------------------------------------------------------------ needs-human set
// ctx: { mainPath, cfg, nowMs, sig, scriptPath, failedWorktrees:Set, failedBranches:Set }
function computeNeedsHuman(rows, branches, ctx) {
  const list = [];
  const wtRoot = `${ctx.mainPath}/.claude/worktrees/`;
  const cmdRemove = (p) => `git -C ${shq(ctx.mainPath)} worktree remove ${shq(p)}`;
  const cmdInspect = (p) => `git -C ${shq(p)} status --short`;
  // campaign-held: an unresolved campaign/Mission names this root; campaign-unknown: the signal is unreadable
  // and the marker's root differs from its run (the auto mode keeps those too).
  const heldClass = (m) => {
    if (!ctx.sig) return null;
    if (!ctx.sig.reliable) return m.root_run_id !== m.run_id ? 'campaign-unknown' : null;
    return ctx.sig.unresolved.has(m.root_run_id) ? 'campaign-held' : null;
  };
  // No one-line abort exists: `mission finalize-abort` needs a drained Mission state file. Point at the scan and the id.
  const holdCommand = (root) => `node ${shq(path.join(__dirname, 'repo-residue-sweep.js'))} scan --json --repo ${shq(ctx.mainPath)}  # find root_run_id ${root}; close or abort that campaign/Mission (node bin/autopilot.js mission finalize-abort --state <mission state> --out <file>), then the next auto run reaps it`;
  const markerBranches = new Map();
  for (const w of rows) if (w.marker_strict && w.marker_strict.valid && fs.existsSync(w.path)) markerBranches.set(w.marker_strict.branch, w);
  for (const w of rows) {
    if (w.class === 'live' || w.class === 'missing-dir') continue;
    if (w.cwd_busy === true && w.path.startsWith(wtRoot)) continue; // someone is working in it
    const entry = (command) => ({ kind: 'worktree', path: w.path, class: w.class, age_days: w.age_days, bytes: null, reason: w.retention_reason || (w.reason || '').slice(0, 120), command });
    const needsInspect = w.class === 'dirty' || w.class === 'unverifiable';
    if (w.marker_valid === true) {
      if (!w.lease_expired) continue; // unexpired lease: the owner asked for it to stay
      if (needsInspect) { list.push(entry(cmdInspect(w.path))); continue; }
      if (w.detached || w.head_is_branch_tip !== true) { list.push(entry(cmdRemove(w.path))); continue; }
      if (ctx.failedWorktrees.has(w.path)) { list.push(entry(cmdRemove(w.path))); continue; }
      // Retained only because of an unresolved campaign (or an unreadable campaign signal): never removed
      // here, but it must still reach the person once its lease has run out.
      const hold = w.cwd_busy === false && w.head_is_branch_tip === true && w.marker_strict.branch === w.branch ? heldClass(w.marker_strict) : null;
      if (hold) list.push(Object.assign(entry(holdCommand(w.marker_strict.root_run_id)), { class: hold, reason: `root_run_id=${w.marker_strict.root_run_id}` }));
      continue; // otherwise: busy or about to be reaped by the next auto run
    }
    if (needsInspect) list.push(entry(cmdInspect(w.path)));
    else if (w.class === 'clean-unintegrated' || w.class === 'clean-integrated') list.push(entry(cmdRemove(w.path)));
  }
  for (const b of branches) {
    if (b.class !== 'unintegrated') continue;
    const dispatch = isDispatchBranch(b.branch, ctx.cfg);
    if (dispatch && !ctx.failedBranches.has(b.branch)) {
      // the archive path owns these — unless a campaign (or an unreadable signal) is what keeps them
      if (!ctx.sig) continue;
      const act0 = b.activity_unix !== undefined ? b.activity_unix : branchLastActivity(ctx.mainPath, b);
      const age0 = daysSince(act0 || b.last_commit_unix, ctx.nowMs);
      if (age0 === null || age0 < ctx.cfg.archive_branch_days) continue;
      const ptr = markerBranches.get(b.branch);
      if (ptr && (ptr.class === 'live' || ptr.lease_expired === false)) continue;
      let hold = null;
      if (!ctx.sig.reliable) hold = 'campaign-unknown';
      else if ((ptr && ctx.sig.unresolved.has(ptr.marker_strict.root_run_id)) || [...ctx.sig.unresolved].some((id) => id.length >= 8 && b.branch.includes(id))) hold = 'campaign-held';
      if (hold) {
        const root = ptr ? ptr.marker_strict.root_run_id : ([...ctx.sig.unresolved].find((id) => id.length >= 8 && b.branch.includes(id)) || 'unknown');
        list.push({ kind: 'branch', branch: b.branch, class: hold, age_days: age0, bytes: null, reason: `root_run_id=${root}`, command: holdCommand(root) });
      }
      continue;
    }
    if (!dispatch && b.activity_unix === undefined) b.activity_unix = branchLastActivity(ctx.mainPath, b);
    const act = dispatch ? (b.activity_unix || b.last_commit_unix) : b.activity_unix;
    const age = daysSince(act, ctx.nowMs);
    if (age === null || age < ctx.cfg.archive_branch_days) continue;
    const ref = `refs/archive/${utcDate(ctx.nowMs)}/${b.branch}`;
    list.push({ kind: 'branch', branch: b.branch, class: b.class, age_days: age, bytes: null, reason: dispatch ? 'archive_failed' : 'unintegrated_non_dispatch', command: `git -C ${shq(ctx.mainPath)} update-ref ${shq(ref)} ${b.tip} && git -C ${shq(ctx.mainPath)} branch -D ${shq(b.branch)}` });
  }
  return list;
}

function attachNeedsHuman(report, rows, branches, ctx, sizeMode, cachedSizes) {
  const list = computeNeedsHuman(rows, branches, ctx);
  const sizes = sizeMode === 'measure' ? measureSizes(list.filter((e) => e.kind === 'worktree').map((e) => e.path)) : cachedSizes;
  for (const e of list) if (e.kind === 'worktree') e.bytes = sizes.has(e.path) ? sizes.get(e.path) : null;
  report.needs_human = list;
  report.needs_human_count = list.length;
  report.needs_human_bytes = list.reduce((a, e) => a + (typeof e.bytes === 'number' ? e.bytes : 0), 0);
  return list;
}

// ------------------------------------------------------------------ auto reap
function removeMarkerWorktree(mainPath, w) {
  // Under the worktree's own lifetime lock: re-check cleanliness (ignoring the two marker files),
  // then remove. A rail that took the lock in the meantime makes flock -n fail: nothing removed.
  const script = 'st=$(git -C "$1" status --porcelain --untracked-files=all) || exit 3; '
    + 'st=$(printf "%s\\n" "$st" | grep -v -E "^\\?\\? \\.autopilot-worktree(\\.lock)?$" || true); '
    + '[ -z "$st" ] || exit 4; exec git -C "$2" worktree remove --force "$1"';
  const r = spawnSync('flock', ['-n', path.join(w.path, '.autopilot-worktree.lock'), 'bash', '-c', script, '_', w.path, mainPath], { encoding: 'utf8' });
  if (r.error) return { ok: false, why: `flock unavailable: ${r.error.message}` };
  if (r.status === 0) return { ok: true };
  if (r.status === 1 && !(r.stderr || '').trim()) return { ok: false, why: 'lock held (live) at removal time' };
  if (r.status === 4) return { ok: false, why: 'became dirty before removal' };
  return { ok: false, why: `worktree remove failed (rc ${r.status}): ${(r.stderr || '').trim().slice(0, 200)}` };
}

function runAuto(o, mainPath, integrationSha, integrationBranch, common) {
  const cfg = loadResidueConfig();
  const nowMs = Date.now();
  const resultPath = path.join(common, AUTO_RESULT_NAME);
  if (!cfg.auto_reap) {
    const skipped = { schema: 'autopilot.residue-auto/1', skipped: 'auto_reap_disabled', config: cfg };
    writeStdout(`${JSON.stringify(skipped)}\n`);
    return 0;
  }
  const cwds = readProcCwds();
  const sig = loadCampaignSignal(common);
  let rows = classifyWorktrees(mainPath, mainPath, integrationSha);
  annotateWorktrees(rows, cfg, nowMs, cwds, mainPath);
  let branches = classifyBranches(mainPath, listWorktrees(mainPath).map((w) => ({ branch: w.branch, path: path.resolve(w.path) })), integrationSha, integrationBranch);
  const removed = []; const archived = []; const kept = []; const failedWorktrees = new Set(); const failedBranches = new Set();
  const notes = [];
  if (!sig.reliable) notes.push(`campaign_signal_unavailable: ${sig.why.join('; ')}`);
  const heldByCampaign = (root) => sig.unresolved.has(root);

  // 1. missing-dir
  const missing = rows.filter((w) => w.class === 'missing-dir');
  if (missing.length > 0) {
    git(mainPath, ['worktree', 'prune']);
    const still = new Set(listWorktrees(mainPath).map((x) => path.resolve(x.path)));
    for (const w of missing) {
      if (still.has(w.path)) { kept.push({ kind: 'worktree', path: w.path, class: w.class, why: 'git worktree prune did not drop the entry (locked?)' }); failedWorktrees.add(w.path); }
      else removed.push({ kind: 'worktree', path: w.path, class: w.class, reason: 'missing_dir' });
    }
  }

  // 2. marker worktrees
  for (const w of rows) {
    if (w.class === 'missing-dir') continue;
    const keep = (why) => kept.push({ kind: 'worktree', path: w.path, class: w.class, why });
    if (w.class === 'live' || w.class === 'dirty' || w.class === 'unverifiable') { keep(w.class); continue; }
    if (w.marker_valid !== true) { keep(w.marker_valid === false ? 'marker_invalid' : 'no_marker'); continue; }
    const m = w.marker_strict;
    if (w.cwd_busy !== false) { keep(w.cwd_busy === null ? 'proc_unavailable' : 'process_cwd_inside'); continue; }
    if (w.lease === 'lease' && !w.lease_expired) { keep('explicit_lease_unexpired'); continue; }
    if (w.class !== 'clean-integrated' && !w.lease_expired) { keep('lease_not_expired'); continue; }
    if (w.detached || w.head_is_branch_tip !== true) { keep('detached_or_head_not_branch_tip'); continue; }
    if (m.branch !== w.branch) { keep('marker_branch_mismatch'); continue; }
    if (!sig.reliable && m.root_run_id !== m.run_id) { keep('campaign_signal_unavailable'); continue; }
    if (sig.reliable && heldByCampaign(m.root_run_id)) { keep('unresolved_campaign'); continue; }
    const r = removeMarkerWorktree(mainPath, w);
    if (r.ok) removed.push({ kind: 'worktree', path: w.path, class: w.class, reason: w.class === 'clean-integrated' ? 'integrated' : 'lease_expired', branch: w.branch });
    else { keep(r.why); failedWorktrees.add(w.path); }
  }

  // 3. branches (re-read: removals above may free a branch)
  const wtAfter = listWorktrees(mainPath);
  const checkedOut = new Set(wtAfter.map((x) => x.branch).filter(Boolean));
  // markers still on disk that name a branch: live/unexpired/campaign-held worktrees point at it
  const markerBranches = new Map();
  for (const w of rows) if (w.marker_strict && w.marker_strict.valid && fs.existsSync(w.path)) markerBranches.set(w.marker_strict.branch, w);
  branches = classifyBranches(mainPath, wtAfter.map((w) => ({ branch: w.branch, path: path.resolve(w.path) })), integrationSha, integrationBranch);
  const doomedIntegrated = []; const doomedArchive = [];
  for (const b of branches) {
    if (b.class === 'integration-ref' || b.class === 'checked-out' || checkedOut.has(b.branch)) continue;
    if (!isDispatchBranch(b.branch, cfg)) continue;
    const act = branchLastActivity(mainPath, b);
    const idleS = act ? nowMs / 1000 - act : null;
    if (b.class === 'integrated') {
      if (idleS === null || idleS < MIN_INTEGRATED_BRANCH_IDLE_S) { kept.push({ kind: 'branch', branch: b.branch, class: b.class, why: 'integrated_but_recent' }); continue; }
      doomedIntegrated.push(b); continue;
    }
    if (b.class !== 'unintegrated') continue;
    if (idleS === null || idleS / 86400 < cfg.archive_branch_days) { kept.push({ kind: 'branch', branch: b.branch, class: b.class, why: 'younger_than_archive_days' }); continue; }
    const pointer = markerBranches.get(b.branch);
    if (pointer && (pointer.class === 'live' || pointer.lease_expired === false)) { kept.push({ kind: 'branch', branch: b.branch, class: b.class, why: 'live_or_unexpired_lease_worktree' }); continue; }
    if (!sig.reliable) { kept.push({ kind: 'branch', branch: b.branch, class: b.class, why: 'campaign_signal_unavailable' }); continue; }
    const campaignHit = (pointer && heldByCampaign(pointer.marker_strict.root_run_id))
      || [...sig.unresolved].some((id) => id.length >= 8 && b.branch.includes(id));
    if (campaignHit) { kept.push({ kind: 'branch', branch: b.branch, class: b.class, why: 'unresolved_campaign' }); continue; }
    doomedArchive.push(b);
  }
  // archive first (each verified), then one anchor pass, then delete
  const archiveReady = [];
  for (const b of doomedArchive) {
    const ref = `refs/archive/${utcDate(nowMs)}/${b.branch}`;
    const cur = git(mainPath, ['rev-parse', '--verify', '--quiet', ref]);
    let ok = cur.ok && cur.out.trim() === b.tip;
    if (!ok && !cur.ok) ok = git(mainPath, ['update-ref', ref, b.tip, '']).ok;
    const verify = ok ? git(mainPath, ['rev-parse', '--verify', `${ref}^{commit}`]) : null;
    if (verify && verify.ok && verify.out.trim() === b.tip) archiveReady.push({ b, ref });
    else { kept.push({ kind: 'branch', branch: b.branch, class: b.class, why: 'archive_ref_failed' }); failedBranches.add(b.branch); }
  }
  const toDelete = doomedIntegrated.map((b) => ({ b, ref: null })).concat(archiveReady);
  let anchors = null;
  if (toDelete.length > 0) {
    const args = [path.join(__dirname, 'pin-evidence-anchors.js'), 'apply', '--repo-root', mainPath, '--json'];
    for (const { b } of toDelete) args.push('--exclude-ref', `refs/heads/${b.branch}`);
    const r = spawnSync('node', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    anchors = { ok: r.status === 0, stderr: (r.stderr || '').slice(0, 1000) };
    if (r.status !== 0) {
      for (const { b } of toDelete) { kept.push({ kind: 'branch', branch: b.branch, class: b.class, why: 'evidence_anchoring_failed' }); failedBranches.add(b.branch); }
    } else {
      for (const { b, ref } of toDelete) {
        // the tip must be unchanged since classification (a run may have committed meanwhile)
        const nowTip = git(mainPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${b.branch}`]);
        if (!nowTip.ok || nowTip.out.trim() !== b.tip) { kept.push({ kind: 'branch', branch: b.branch, class: b.class, why: 'tip_changed' }); continue; }
        const d = git(mainPath, ['branch', '-D', b.branch]);
        if (!d.ok) { kept.push({ kind: 'branch', branch: b.branch, class: b.class, why: d.err.trim().slice(0, 200) }); failedBranches.add(b.branch); continue; }
        if (ref) archived.push({ kind: 'branch', branch: b.branch, tip: b.tip, ref });
        else removed.push({ kind: 'branch', branch: b.branch, class: b.class, reason: 'integrated', tip: b.tip });
      }
    }
  }

  // 4. what remains for a person
  rows = classifyWorktrees(mainPath, mainPath, integrationSha);
  annotateWorktrees(rows, cfg, Date.now(), cwds, mainPath);
  branches = classifyBranches(mainPath, listWorktrees(mainPath).map((w) => ({ branch: w.branch, path: path.resolve(w.path) })), integrationSha, integrationBranch);
  const report = { schema: 'autopilot.residue-auto/1', ran_at: new Date(nowMs).toISOString(), ran_at_epoch: Math.floor(nowMs / 1000), removed, archived, kept, notes, anchors };
  const ctx = { mainPath, cfg, nowMs: Date.now(), sig, failedWorktrees, failedBranches };
  attachNeedsHuman(report, rows, branches, ctx, 'measure', null);
  const tmp = `${resultPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify({ schema: report.schema, ran_at: report.ran_at, ran_at_epoch: report.ran_at_epoch, removed, archived, needs_human: report.needs_human, needs_human_count: report.needs_human_count, needs_human_bytes: report.needs_human_bytes })}\n`);
  fs.renameSync(tmp, resultPath);
  writeStdout(`${JSON.stringify(report)}\n`);
  const leftover = kept.filter((k) => /^(worktree remove failed|became dirty|lock held|git worktree prune)/.test(k.why || ''));
  return leftover.length > 0 ? 1 : 0;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const repo = path.resolve(o.repo);
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  if (!top.ok) usage(`--repo is not a git checkout: ${repo}`);
  // The primary worktree is the first entry of `git worktree list`: when --repo is itself a linked
  // worktree, "the main checkout" (default integration ref, never-a-candidate) is still that one.
  const primary = listWorktrees(path.resolve(top.out)).find((w) => !w.bare);
  const mainPath = path.resolve(primary ? primary.path : top.out);
  const integrationRef = o.integrationRef || 'HEAD';
  const integrationSha = git(mainPath, ['rev-parse', '--verify', `${integrationRef}^{commit}`]);
  if (!integrationSha.ok) usage(`--integration-ref does not resolve: ${integrationRef}`);
  const integrationBranch = git(mainPath, ['rev-parse', '--abbrev-ref', integrationRef]).out;

  const commonRaw = git(mainPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const common = commonRaw.ok ? commonRaw.out : path.join(mainPath, '.git');
  if (o.cmd === 'reap' && o.auto) return runAuto(o, mainPath, integrationSha.out, integrationBranch, common);

  const worktrees = classifyWorktrees(mainPath, mainPath, integrationSha.out);
  const branches = classifyBranches(mainPath, listWorktrees(mainPath).map((w) => ({ branch: w.branch, path: path.resolve(w.path) })), integrationSha.out, integrationBranch);
  const count = (rows, key) => rows.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + 1; return acc; }, {});
  const seats = classifyFinalPanelSeats(mainPath, worktrees, o.olderThanDays);
  const report = { command: o.cmd, repo: mainPath, integration_ref: integrationRef, integration_sha: integrationSha.out, worktrees, branches, final_panel_seats: seats.rows, summary: { worktrees: count(worktrees, 'class'), branches: count(branches, 'class'), final_panel_seats: count(seats.rows, 'class') } };

  if (o.cmd === 'scan') {
    const cfg = loadResidueConfig();
    const nowMs = Date.now();
    annotateWorktrees(worktrees, cfg, nowMs, readProcCwds(), mainPath);
    const ctx = { mainPath, cfg, nowMs, sig: loadCampaignSignal(common), failedWorktrees: new Set(), failedBranches: new Set() };
    attachNeedsHuman(report, worktrees, branches, ctx, o.sizes ? 'measure' : 'cached', readCachedSizes(common));
    writeStdout(`${JSON.stringify(report)}\n`);
    return 0;
  }

  if (o.cmd === 'preserve') {
    const targets = worktrees.filter((w) => w.class === 'dirty' && (o.worktrees.length === 0 || o.worktrees.map((p) => path.resolve(p)).includes(w.path)));
    fs.mkdirSync(o.out, { recursive: true });
    report.preserved = targets.map((w) => { const r = preserveWorktree(mainPath, w, o.out); return { worktree: w.path, head: w.head, dir: r.dir, preserved: r.preserved, parts: r.manifest.parts }; });
    report.not_dirty_requested = o.worktrees.map((p) => path.resolve(p)).filter((p) => !targets.some((t) => t.path === p));
    writeStdout(`${JSON.stringify(report)}\n`);
    return report.preserved.every((p) => p.preserved) ? 0 : 1;
  }

  // reap
  const tooYoung = (ageDays) => o.olderThanDays !== null && (ageDays === null || ageDays < o.olderThanDays);
  const actions = { worktrees_removed: [], worktrees_kept: [], branches_deleted: [], branches_kept: [], final_panel_seats_removed: [], final_panel_seats_kept: [], anchors: null };
  for (const w of worktrees) {
    if (w.class === 'live' || w.class === 'unverifiable' || w.class === 'clean-unintegrated') { actions.worktrees_kept.push({ path: w.path, class: w.class, why: w.reason }); continue; }
    if (tooYoung(w.age_days)) { actions.worktrees_kept.push({ path: w.path, class: w.class, why: `younger than ${o.olderThanDays} days` }); continue; }
    if (w.class === 'dirty') {
      const rec = findPreserveRecord(o.preserveDir, w);
      if (!rec || !rec.valid) { actions.worktrees_kept.push({ path: w.path, class: w.class, why: rec ? `preserve record invalid: ${rec.why}` : 'no verified preserve record under --preserve-dir' }); continue; }
      const r = git(mainPath, ['worktree', 'remove', '--force', w.path]);
      if (r.ok) actions.worktrees_removed.push({ path: w.path, class: w.class, preserve_record: rec.dir }); else actions.worktrees_kept.push({ path: w.path, class: w.class, why: `worktree remove failed: ${r.err.trim()}` });
      continue;
    }
    const r = w.class === 'missing-dir' ? git(mainPath, ['worktree', 'remove', '--force', w.path]) : git(mainPath, ['worktree', 'remove', w.path]);
    if (r.ok || w.class === 'missing-dir') { if (!r.ok) git(mainPath, ['worktree', 'prune']); actions.worktrees_removed.push({ path: w.path, class: w.class }); }
    else actions.worktrees_kept.push({ path: w.path, class: w.class, why: `worktree remove failed: ${r.err.trim()}` });
  }
  // branches: only integrated + not checked out (re-read checkouts after the removals above)
  const stillCheckedOut = new Set(listWorktrees(mainPath).map((x) => x.branch).filter(Boolean));
  const candidates = branches.filter((b) => b.class === 'integrated' && !stillCheckedOut.has(b.branch) && !tooYoung(b.last_commit_unix ? (Date.now() / 1000 - b.last_commit_unix) / 86400 : null));
  for (const b of branches) if (!candidates.includes(b) && b.class !== 'integration-ref') actions.branches_kept.push({ branch: b.branch, class: b.class, ahead: b.ahead });
  if (candidates.length > 0) {
    const pin = path.join(__dirname, 'pin-evidence-anchors.js');
    const args = [pin, 'apply', '--repo-root', mainPath, '--json'];
    for (const b of candidates) args.push('--exclude-ref', `refs/heads/${b.branch}`);
    const r = spawnSync('node', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    actions.anchors = { ok: r.status === 0, stdout: (r.stdout || '').slice(0, 4000), stderr: (r.stderr || '').slice(0, 2000) };
    if (r.status !== 0) {
      for (const b of candidates) actions.branches_kept.push({ branch: b.branch, class: b.class, why: 'evidence anchoring failed; branch phase aborted' });
    } else {
      for (const b of candidates) {
        const d = git(mainPath, ['branch', '-D', b.branch]);
        if (d.ok) actions.branches_deleted.push({ branch: b.branch, tip: b.tip }); else actions.branches_kept.push({ branch: b.branch, class: b.class, why: d.err.trim() });
      }
    }
  }
  // final-panel seat subtrees: terminal always; unknown only with no live/unmeasurable lock
  for (const r of seats.rows) {
    const keep = (why) => actions.final_panel_seats_kept.push({ campaign_id: r.campaign_id, class: r.class, why });
    if (r.decision !== 'reap') { keep(r.decision_reason); continue; }
    const res = seatStore.reapCampaignSeats({ root: seats.root, campaignId: r.campaign_id });
    if (res.status === 'removed') actions.final_panel_seats_removed.push({ campaign_id: r.campaign_id, class: r.class, path: res.path });
    else keep(`reap ${res.status}: ${res.reason}`);
  }
  report.actions = actions;
  const after = classifyWorktrees(mainPath, mainPath, integrationSha.out);
  report.after = { worktrees: count(after, 'class'), final_panel_seats: count(classifyFinalPanelSeats(mainPath, after, o.olderThanDays).rows, 'class'), branches: count(classifyBranches(mainPath, listWorktrees(mainPath).map((w) => ({ branch: w.branch, path: path.resolve(w.path) })), integrationSha.out, integrationBranch), 'class') };
  writeStdout(`${JSON.stringify(report)}\n`);
  const leftover = actions.worktrees_kept.filter((k) => ['missing-dir', 'clean-integrated'].includes(k.class))
    .concat(actions.final_panel_seats_kept.filter((k) => /^reap (failed|refused)/.test(k.why)));
  return leftover.length > 0 ? 1 : 0;
}

module.exports = { parseSchema2Marker }; // test seam: hooks/tests/repo-residue-auto.test.sh pins parity with _wt_read_schema2_marker
if (require.main === module) {
  try { process.exit(main()); } catch (e) { process.stderr.write(`repo-residue-sweep: ${e && e.message ? e.message : e}\n`); process.exit(2); }
}
