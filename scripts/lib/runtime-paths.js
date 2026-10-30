#!/usr/bin/env node
'use strict';

// scripts/lib/runtime-paths.js -- the ONE place that knows where autopilot's runtime directories live and
// how to make them exist safely (BL-0336). Node >= 20.10, built-ins only.
//
//   runsDir(env)            where dispatch run manifests live: $AUTOPILOT_DISPATCH_RUNS_DIR, else
//                           $TMPDIR/<name>, else /tmp/<name>. Pure string work; no filesystem access.
//   evaluateRunsDir(env)    PURE verdict for that directory (never mkdir, never chmod): { decision, path,
//   evaluateTmpdir(env)     reason, would_create, would_tighten }. decision is 'ok' | 'create' | 'tighten' | 'refuse'.
//   evaluatePrivateDir(p)   the same verdict for any private directory (live dir, ~/.autopilot/**).
//   ensureRunsDir(env)      evaluate, then create / tighten what the verdict asked for, then re-verify.
//   ensureTmpdir(env)       -> { ok, path, reason }. ok:false means the caller must not read or write `path`.
//   ensurePrivateDir(p)
//
// Shell callers use the CLI:  node scripts/lib/runtime-paths.js runs-dir --ensure
//   success: the path on stdout, exit 0.  failure: the reason on stderr, exit 1.
//   Also `tmpdir --ensure`, and `runs-dir` / `tmpdir` without --ensure (print the path only).
//
// Trust rules for a PRIVATE directory (a runs dir, a TMPDIR the user chose but did not create yet, anything
// under ~/.autopilot):
//   * Walk from `/` down, lstat every layer. Every existing ancestor must belong to this uid or to root.
//   * An ancestor that someone else can write to (o+w, or g+w with a group that is not our own) is accepted only
//     when root owns it AND it has the sticky bit (/tmp, /dev/shm). A shared system root like that is taken as
//     found and NEVER chmod'ed; only a private subdirectory is made under it.
//   * An ancestor owned by another user is refused even when it is not writable, with owner and path in the reason.
//   * Symlinks: a root-owned link is a system layout (/var -> private/var) and is followed. A link we own is
//     followed only below $HOME and only when its target directory is ours too (nobody else can make a link in
//     our home, and this keeps a user's `~/.autopilot -> /data/autopilot` working). Any other link is refused,
//     and a link as the LEAF is always refused.
//   * Missing layers are made one at a time with mode 0700 and re-checked after creation.
//   * The leaf must be ours. A leaf that is group/other readable but not writable (an old shell `mkdir -p` 0755)
//     is tightened to 0700. A leaf that others could write to is refused and NOT chmod'ed: files may already be in it.
//   * An already-existing TMPDIR is checked, not modified: ours, or root-owned with the sticky bit.
//
// Race: Node has no openat(), so a check and the following mkdir cannot be bound to one directory handle. The
// rules above make that bounded: every ancestor is owned by us or root (or is a root-owned sticky root), so no
// other user can rename or replace a layer between our lstat and our mkdir. The only party who could is root or
// ourselves. Creation re-checks the new layer with lstat and refuses a mismatch.
//
// Tests inject `deps` ({ fs, uid, gid, home }) to simulate other owners without changing uid; the production
// path uses the real fs.

const realFs = require('fs');
const os = require('os');
const path = require('path');

const RUNS_DIR_NAME = 'autopilot-dispatch-runs';
const MAX_LINK_DEPTH = 8;

function defaults(deps) {
  const d = deps || {};
  const getuid = () => (typeof process.getuid === 'function' ? process.getuid() : 0);
  const getgid = () => (typeof process.getgid === 'function' ? process.getgid() : 0);
  return {
    fs: d.fs || realFs,
    uid: typeof d.uid === 'number' ? d.uid : getuid(),
    gid: typeof d.gid === 'number' ? d.gid : getgid(),
    home: d.home || os.homedir(),
  };
}

function runsDir(env = process.env) {
  if (env.AUTOPILOT_DISPATCH_RUNS_DIR) return env.AUTOPILOT_DISPATCH_RUNS_DIR;
  return path.join(env.TMPDIR || '/tmp', RUNS_DIR_NAME);
}

function tmpdirOf(env = process.env) {
  return env.TMPDIR || '/tmp';
}

const refuse = (p, reason) => ({ decision: 'refuse', path: p, reason, would_create: [], would_tighten: false });

function isUnder(child, parent) {
  if (!parent) return false;
  const base = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child === parent || child.startsWith(base);
}

// Someone other than us can write to this directory. g+w only counts when the group is not our own primary
// group (with user-private groups, umask 002 makes every home directory g+w for a group of one).
function othersCanWrite(st, ctx) {
  const mode = st.mode & 0o7777;
  if (mode & 0o002) return true;
  return Boolean(mode & 0o020) && st.gid !== ctx.gid;
}

function errText(error) {
  return (error && (error.code || error.message)) || String(error);
}

function ownerText(st) {
  return `uid ${st.uid}`;
}

// Walk `target` from the root. -> { decision, ... } without touching anything.
function evaluatePrivateDir(target, deps, linkDepth = 0) {
  const ctx = defaults(deps);
  const f = ctx.fs;
  if (typeof target !== 'string' || target === '') return refuse(String(target), 'empty path');
  const abs = path.resolve(target);
  if (linkDepth > MAX_LINK_DEPTH) return refuse(abs, `too many symlinks while resolving ${abs}`);
  const parts = abs.split(path.sep).filter(Boolean);
  let cur = path.sep;
  for (let i = 0; i < parts.length; i += 1) {
    const next = path.join(cur, parts[i]);
    const isLeaf = i === parts.length - 1;
    let st;
    try {
      st = f.lstatSync(next);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        // This layer and everything below it is missing; cur (the parent) was validated on the way down.
        const would = [];
        let p = cur;
        for (let j = i; j < parts.length; j += 1) { p = path.join(p, parts[j]); would.push(p); }
        return { decision: 'create', path: abs, reason: null, would_create: would, would_tighten: false };
      }
      return refuse(abs, `cannot inspect ${next}: ${errText(error)}`);
    }
    if (st.isSymbolicLink()) {
      if (isLeaf) return refuse(abs, `${next} is a symbolic link; a runtime directory must be a real directory`);
      let follow = false;
      if (st.uid === 0) follow = true;
      else if (st.uid === ctx.uid && isUnder(next, ctx.home)) follow = true;
      if (!follow) return refuse(abs, `${next} is a symbolic link owned by ${ownerText(st)} outside the home directory; refusing to follow it`);
      let real;
      try {
        real = f.realpathSync(next);
      } catch (error) {
        return refuse(abs, `cannot resolve the symbolic link ${next}: ${errText(error)}`);
      }
      if (st.uid !== 0) {
        let tst;
        try { tst = f.statSync(real); } catch (error) { return refuse(abs, `cannot inspect the target ${real} of ${next}: ${errText(error)}`); }
        if (!tst.isDirectory() || tst.uid !== ctx.uid) return refuse(abs, `the target ${real} of the symbolic link ${next} is not a directory owned by this user (${ownerText(tst)})`);
      }
      return evaluatePrivateDir(path.join(real, ...parts.slice(i + 1)), deps, linkDepth + 1);
    }
    if (!st.isDirectory()) return refuse(abs, `${next} exists and is not a directory`);
    if (!isLeaf) {
      if (st.uid !== ctx.uid && st.uid !== 0) return refuse(abs, `${next} is owned by ${ownerText(st)}; every parent of a private directory must belong to this user or root`);
      if (othersCanWrite(st, ctx)) {
        const sticky = (st.mode & 0o1000) !== 0;
        if (!(st.uid === 0 && sticky)) return refuse(abs, `${next} is writable by other users${st.uid === 0 ? ' and has no sticky bit' : ''} (mode ${(st.mode & 0o7777).toString(8)}); refusing to place a private directory below it`);
      }
    } else {
      if (st.uid !== ctx.uid) return refuse(abs, `${next} is owned by ${ownerText(st)}, not this user`);
      if (othersCanWrite(st, ctx)) return refuse(abs, `${next} is writable by other users (mode ${(st.mode & 0o7777).toString(8)}) and may already hold files from them; remove or recreate it as mode 0700`);
      if ((st.mode & 0o077) !== 0) return { decision: 'tighten', path: abs, reason: null, would_create: [], would_tighten: true };
    }
    cur = next;
  }
  return { decision: 'ok', path: abs, reason: null, would_create: [], would_tighten: false };
}

// Create / tighten what evaluatePrivateDir asked for, then verify the result with a fresh evaluation.
function ensurePrivateDir(target, deps) {
  const ctx = defaults(deps);
  const f = ctx.fs;
  const result = (r) => (r.decision === 'refuse'
    ? { ok: false, path: r.path, reason: r.reason }
    : { ok: true, path: r.path, reason: null });
  let verdict = evaluatePrivateDir(target, deps);
  for (let round = 0; round < MAX_LINK_DEPTH && verdict.decision === 'create'; round += 1) {
    for (const layer of verdict.would_create) {
      try {
        f.mkdirSync(layer, { mode: 0o700 });
      } catch (error) {
        if (!error || error.code !== 'EEXIST') return { ok: false, path: verdict.path, reason: `cannot create ${layer}: ${errText(error)}` };
      }
      let st;
      try { st = f.lstatSync(layer); } catch (error) { return { ok: false, path: verdict.path, reason: `cannot inspect ${layer} after creating it: ${errText(error)}` }; }
      if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== ctx.uid || othersCanWrite(st, ctx)) {
        return { ok: false, path: verdict.path, reason: `${layer} is not a private directory of this user right after creation (${ownerText(st)}, mode ${(st.mode & 0o7777).toString(8)})` };
      }
    }
    verdict = evaluatePrivateDir(target, deps);
  }
  if (verdict.decision === 'tighten') {
    try {
      f.chmodSync(verdict.path, 0o700);
    } catch (error) {
      return { ok: false, path: verdict.path, reason: `cannot tighten ${verdict.path} to 0700: ${errText(error)}` };
    }
    verdict = evaluatePrivateDir(target, deps);
  }
  if (verdict.decision === 'create' || verdict.decision === 'tighten') {
    return { ok: false, path: verdict.path, reason: `${verdict.path} still needs ${verdict.decision} after the attempt` };
  }
  return result(verdict);
}

function evaluateRunsDir(env = process.env, deps) {
  return evaluatePrivateDir(runsDir(env), deps);
}

function ensureRunsDir(env = process.env, deps) {
  return ensurePrivateDir(runsDir(env), deps);
}

// TMPDIR: unset -> /tmp, which is a shared system root and is only checked. Set and present -> checked, never
// modified. Set and absent -> the user chose that place, so it is a private directory we may create.
function evaluateTmpdir(env = process.env, deps) {
  const ctx = defaults(deps);
  const f = ctx.fs;
  const dir = path.resolve(tmpdirOf(env));
  let st;
  try {
    st = f.statSync(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      if (!env.TMPDIR) return refuse(dir, `${dir} does not exist`);
      return evaluatePrivateDir(dir, deps);
    }
    return refuse(dir, `cannot inspect ${dir}: ${errText(error)}`);
  }
  if (!st.isDirectory()) return refuse(dir, `${dir} exists and is not a directory`);
  const sticky = (st.mode & 0o1000) !== 0;
  const sharedRoot = st.uid === 0 && sticky;
  if (st.uid !== ctx.uid && !sharedRoot) return refuse(dir, `TMPDIR ${dir} is owned by ${ownerText(st)} and is not a shared system directory (root-owned with the sticky bit)`);
  try {
    f.accessSync(dir, realFs.constants.W_OK);
  } catch (error) {
    return refuse(dir, `TMPDIR ${dir} is not writable by this user (${errText(error)})`);
  }
  return { decision: 'ok', path: dir, reason: null, would_create: [], would_tighten: false };
}

function ensureTmpdir(env = process.env, deps) {
  const v = evaluateTmpdir(env, deps);
  if (v.decision === 'refuse') return { ok: false, path: v.path, reason: v.reason };
  if (v.decision === 'ok') return { ok: true, path: v.path, reason: null };
  return ensurePrivateDir(v.path, deps);
}

module.exports = {
  RUNS_DIR_NAME, runsDir, tmpdirOf, evaluatePrivateDir, ensurePrivateDir, evaluateRunsDir, ensureRunsDir, evaluateTmpdir, ensureTmpdir,
};

if (require.main === module) {
  const [what, ...flags] = process.argv.slice(2);
  const ensure = flags.includes('--ensure');
  if (what !== 'runs-dir' && what !== 'tmpdir') {
    process.stderr.write('usage: runtime-paths.js runs-dir|tmpdir [--ensure]\n');
    process.exit(2);
  }
  if (!ensure) {
    process.stdout.write(`${what === 'runs-dir' ? runsDir(process.env) : tmpdirOf(process.env)}\n`);
    process.exit(0);
  }
  let r;
  if (what === 'runs-dir') {
    // The runs dir normally sits under TMPDIR: make a TMPDIR that does not exist yet first (same rules), so the
    // reason names the right layer. An explicit AUTOPILOT_DISPATCH_RUNS_DIR does not depend on TMPDIR.
    r = ensureRunsDir(process.env);
  } else {
    r = ensureTmpdir(process.env);
  }
  if (r.ok) {
    process.stdout.write(`${r.path}\n`);
    process.exit(0);
  }
  process.stderr.write(`${what === 'runs-dir' ? 'dispatch runs directory' : 'temp directory'} unusable: ${r.reason}\n`);
  process.exit(1);
}
