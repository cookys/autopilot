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
//   repo-residue-sweep.js scan     --repo <dir> [--integration-ref <ref>] [--json]
//   repo-residue-sweep.js preserve --repo <dir> --out <dir> [--worktree <path>]... [--json]
//   repo-residue-sweep.js reap     --repo <dir> --yes [--preserve-dir <dir>] [--older-than-days N]
//                                  [--integration-ref <ref>] [--json]
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

function usage(msg) {
  if (msg) process.stderr.write(`repo-residue-sweep: ${msg}\n`);
  process.stderr.write('usage: repo-residue-sweep.js scan|preserve|reap --repo <dir> [--integration-ref <ref>] [--out <dir>] [--worktree <path>]... [--yes] [--preserve-dir <dir>] [--older-than-days N] [--json]\n');
  process.exit(2);
}

function parseArgs(argv) {
  const out = { cmd: null, repo: null, integrationRef: null, out: null, worktrees: [], yes: false, preserveDir: null, olderThanDays: null };
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
    else if (k === '--preserve-dir') out.preserveDir = need();
    else if (k === '--older-than-days') { out.olderThanDays = Number(need()); if (!Number.isFinite(out.olderThanDays) || out.olderThanDays < 0) usage('--older-than-days must be a non-negative number'); }
    else if (k === '--json') { /* default */ }
    else if (k === '-h' || k === '--help') { process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n') + '\n'); process.exit(0); }
    else usage(`unknown argument: ${k}`);
  }
  if (!out.repo) usage('--repo is required');
  if (cmd === 'preserve' && !out.out) usage('preserve requires --out <dir>');
  if (cmd === 'reap' && !out.yes) usage('reap requires --yes');
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

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function safeName(p) { return p.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '').slice(-120); }

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
  const unt = git(wt, ['ls-files', '--others', '--exclude-standard', '-z']);
  const untracked = unt.ok ? unt.out.split('\0').filter((f) => f && f !== '.autopilot-worktree' && f !== '.autopilot-worktree.lock') : null;
  if (untracked === null) { parts['untracked.tar'] = { ok: false, error: unt.err.trim() }; verified = false; }
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
  const manifest = { schema: 'repo-residue-preserve/1', worktree: wt, branch: row.branch, head: row.head, dirty_lines: row.dirty_lines, preserved_at: new Date().toISOString(), parts, preserved: verified };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, preserved: verified, manifest };
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
      return { dir: path.join(preserveDir, d), valid: true };
    }
  }
  return null;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const repo = path.resolve(o.repo);
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  if (!top.ok) usage(`--repo is not a git checkout: ${repo}`);
  const mainPath = path.resolve(top.out);
  const integrationRef = o.integrationRef || 'HEAD';
  const integrationSha = git(mainPath, ['rev-parse', '--verify', `${integrationRef}^{commit}`]);
  if (!integrationSha.ok) usage(`--integration-ref does not resolve: ${integrationRef}`);
  const integrationBranch = git(mainPath, ['rev-parse', '--abbrev-ref', integrationRef]).out;

  const worktrees = classifyWorktrees(mainPath, mainPath, integrationSha.out);
  const branches = classifyBranches(mainPath, listWorktrees(mainPath).map((w) => ({ branch: w.branch, path: path.resolve(w.path) })), integrationSha.out, integrationBranch);
  const count = (rows, key) => rows.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + 1; return acc; }, {});
  const report = { command: o.cmd, repo: mainPath, integration_ref: integrationRef, integration_sha: integrationSha.out, worktrees, branches, summary: { worktrees: count(worktrees, 'class'), branches: count(branches, 'class') } };

  if (o.cmd === 'scan') { process.stdout.write(`${JSON.stringify(report)}\n`); return 0; }

  if (o.cmd === 'preserve') {
    const targets = worktrees.filter((w) => w.class === 'dirty' && (o.worktrees.length === 0 || o.worktrees.map((p) => path.resolve(p)).includes(w.path)));
    fs.mkdirSync(o.out, { recursive: true });
    report.preserved = targets.map((w) => { const r = preserveWorktree(mainPath, w, o.out); return { worktree: w.path, head: w.head, dir: r.dir, preserved: r.preserved, parts: r.manifest.parts }; });
    report.not_dirty_requested = o.worktrees.map((p) => path.resolve(p)).filter((p) => !targets.some((t) => t.path === p));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report.preserved.every((p) => p.preserved) ? 0 : 1;
  }

  // reap
  const tooYoung = (ageDays) => o.olderThanDays !== null && (ageDays === null || ageDays < o.olderThanDays);
  const actions = { worktrees_removed: [], worktrees_kept: [], branches_deleted: [], branches_kept: [], anchors: null };
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
  report.actions = actions;
  const after = classifyWorktrees(mainPath, mainPath, integrationSha.out);
  report.after = { worktrees: count(after, 'class'), branches: count(classifyBranches(mainPath, listWorktrees(mainPath).map((w) => ({ branch: w.branch, path: path.resolve(w.path) })), integrationSha.out, integrationBranch), 'class') };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  const leftover = actions.worktrees_kept.filter((k) => ['missing-dir', 'clean-integrated'].includes(k.class));
  return leftover.length > 0 ? 1 : 0;
}

try { process.exit(main()); } catch (e) { process.stderr.write(`repo-residue-sweep: ${e && e.message ? e.message : e}\n`); process.exit(2); }
