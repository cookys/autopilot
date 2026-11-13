'use strict';
/**
 * lane-switch-transcript.js — P2 step 4 (plan project/plans/2026-11-10-profile-switch.md).
 *
 * collectAndCopy(opts, deps) -> { ok, copied, skipped, reason? }
 *
 * 1. `codeforge usage collect` for the old profile. No --quiet (the collector
 *    waits for its lock). Stdout and stderr are discarded. CLAUDE_CONFIG_DIR is
 *    the old profile directory, or unset when that profile is home. home's
 *    directory is <home>/.claude; a named profile is <home>/.claude-profiles/<name>.
 *    CODEFORGE_DATA_DIR is never set (it is removed from the child env).
 * 2. COPY, never move, <old>/projects/<cwd-key>/<sid>.jsonl and, when present,
 *    <sid>/subagents/ into <new>/projects/<cwd-key>/, creating directories.
 *    Same bytes at a destination are skipped. A different existing file refuses
 *    the whole copy and nothing is written. Symlinks are refused, so a link
 *    cannot be followed into a credential file. .credentials.json and
 *    .claude.json are never opened.
 *
 * cwd-key: every character outside [A-Za-z0-9] becomes "-".
 *   /home/u/proj -> -home-u-proj
 *
 * opts: { from, to, cwd, sessionId, order, lane, home?, base? }
 *   from/to are profile names ('home' or a profile name), not directories.
 * deps: { run?, now?, fs?, env?, home?, base? }
 *   run(cmd, args, spawnOpts) is spawnSync-shaped. now is an ISO string or a
 *   function that returns one. fs defaults to node:fs. env defaults to process.env
 *   and is copied, not mutated.
 * One journal row, step collect-copy, via switch-journal. Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { appendJournal } = require('./switch-journal');
const { defaultBase } = require('./lane-manifest');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ORDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/;
const SID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CRED_NAMES = new Set(['.credentials.json', '.claude.json']);
const COPY_EXCL = fs.constants.COPYFILE_EXCL;

function cwdKey(cwd) { return String(cwd).replace(/[^A-Za-z0-9]/g, '-'); }

function profileConfigDir(home, profile) {
  if (profile === 'home') return path.join(home, '.claude');
  return path.join(home, '.claude-profiles', profile);
}

function collectEnv(parent, profile, dir) {
  const env = { ...(parent || {}) };
  delete env.CODEFORGE_DATA_DIR;
  if (profile === 'home') delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = dir;
  return env;
}

function validate(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('opts_invalid');
  if (opts.from !== 'home' && !NAME_RE.test(opts.from || '')) throw new Error('profile_invalid');
  if (opts.to !== 'home' && !NAME_RE.test(opts.to || '')) throw new Error('profile_invalid');
  if (!ORDER_RE.test(opts.order || '')) throw new Error('order_invalid');
  if (!NAME_RE.test(opts.lane || '')) throw new Error('lane_invalid');
  if (!SID_RE.test(opts.sessionId || '')) throw new Error('session_invalid');
  if (typeof opts.cwd !== 'string' || !path.isAbsolute(opts.cwd)) throw new Error('cwd_not_absolute');
}

function lstatOrNull(f, p) {
  try { return f.lstatSync(p); } catch (e) { if (e && e.code === 'ENOENT') return null; throw e; }
}

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function sameBytes(f, a, b, size) {
  if (size === 0) return true;
  const fa = f.openSync(a, 'r');
  const fb = f.openSync(b, 'r');
  try {
    const bufA = Buffer.alloc(Math.min(65536, size));
    const bufB = Buffer.alloc(bufA.length);
    let pos = 0;
    while (pos < size) {
      const n = f.readSync(fa, bufA, 0, bufA.length, pos);
      const m = f.readSync(fb, bufB, 0, bufB.length, pos);
      if (n === 0 || n !== m || !bufA.subarray(0, n).equals(bufB.subarray(0, m))) return false;
      pos += n;
    }
    return true;
  } finally {
    f.closeSync(fa);
    f.closeSync(fb);
  }
}

function walk(f, root, dir, rel, files) {
  const names = f.readdirSync(dir);
  names.sort();
  for (const name of names) {
    if (name === '.' || name === '..') continue;
    if (CRED_NAMES.has(name) || name.includes('/') || name.includes('\\') || name.includes('\0')) return 'credential_refused';
    const abs = path.join(dir, name);
    const childRel = `${rel}/${name}`;
    if (!inside(root, abs)) return 'path_escape';
    const st = lstatOrNull(f, abs);
    if (!st) continue;
    if (st.isSymbolicLink()) return 'symlink_refused';
    if (st.isDirectory()) {
      const err = walk(f, root, abs, childRel, files);
      if (err) return err;
    } else if (st.isFile()) files.push({ rel: childRel, abs, size: st.size });
    else return 'unsupported_type';
  }
  return null;
}

function listFiles(f, oldProject, sid) {
  const transcriptRel = `${sid}.jsonl`;
  const transcriptAbs = path.join(oldProject, transcriptRel);
  if (!inside(oldProject, transcriptAbs)) return { error: 'path_escape' };
  const st = lstatOrNull(f, transcriptAbs);
  if (!st) return { error: 'transcript_missing' };
  if (st.isSymbolicLink()) return { error: 'symlink_refused' };
  if (!st.isFile()) return { error: 'transcript_not_file' };
  const files = [{ rel: transcriptRel, abs: transcriptAbs, size: st.size }];
  const subAbs = path.join(oldProject, sid, 'subagents');
  if (!inside(oldProject, subAbs)) return { error: 'path_escape' };
  const sub = lstatOrNull(f, subAbs);
  if (!sub) return { files };
  if (sub.isSymbolicLink()) return { error: 'symlink_refused' };
  if (!sub.isDirectory()) return { error: 'subagents_not_dir' };
  const err = walk(f, oldProject, subAbs, `${sid}/subagents`, files);
  if (err) return { error: err };
  return { files };
}

function classify(f, newProject, files) {
  const copy = [];
  const skipped = [];
  for (const file of files) {
    const dest = path.join(newProject, ...file.rel.split('/'));
    if (!inside(newProject, dest)) return { error: 'path_escape' };
    const dst = lstatOrNull(f, dest);
    if (!dst) { copy.push({ ...file, dest }); continue; }
    if (dst.isSymbolicLink() || !dst.isFile()) return { error: 'dest_differs' };
    if (dst.size !== file.size || !sameBytes(f, file.abs, dest, file.size)) return { error: 'dest_differs' };
    skipped.push(file.rel);
  }
  return { copy, skipped };
}

function nowOf(deps) {
  const n = deps && deps.now;
  if (typeof n === 'function') return n();
  return n;
}

function record(base, now, opts, outcome, detail) {
  appendJournal(base, {
    order: opts.order, lane: opts.lane, step: 'collect-copy', from: opts.from, to: opts.to, outcome, detail,
  }, now);
}

function stop(base, now, opts, outcome, detail, reason) {
  record(base, now, opts, outcome, detail);
  return { ok: false, copied: [], skipped: [], reason };
}

function collectDetail(ran) {
  if (!ran || ran.error) return 'spawn_error';
  if (ran.signal) return 'signal';
  return `status=${ran.status}`;
}

function collectAndCopy(opts, deps) {
  validate(opts);
  const d = deps || {};
  const f = d.fs || fs;
  const home = opts.home || d.home || os.homedir();
  const base = opts.base || d.base || process.env.AUTOPILOT_LANE_BASE_DIR || defaultBase();
  const now = nowOf(d);
  const oldDir = profileConfigDir(home, opts.from);
  const newDir = profileConfigDir(home, opts.to);
  const parent = Object.prototype.hasOwnProperty.call(d, 'env') ? d.env : process.env;
  const run = d.run || spawnSync;
  const childEnv = collectEnv(parent, opts.from, oldDir);
  let ran;
  try {
    ran = run('codeforge', ['usage', 'collect'], { env: childEnv, stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (_e) {
    return stop(base, now, opts, 'collect_failed', 'spawn_error', 'collect_failed');
  }
  if (!ran || ran.error || ran.signal || ran.status !== 0) {
    return stop(base, now, opts, 'collect_failed', collectDetail(ran), 'collect_failed');
  }
  const oldProject = path.join(oldDir, 'projects', cwdKey(opts.cwd));
  const newProject = path.join(newDir, 'projects', cwdKey(opts.cwd));
  const listed = listFiles(f, oldProject, opts.sessionId);
  if (listed.error) {
    const outcome = listed.error === 'transcript_missing' ? 'missing' : 'refused';
    return stop(base, now, opts, outcome, listed.error, listed.error);
  }
  const plan = classify(f, newProject, listed.files);
  if (plan.error) return stop(base, now, opts, 'refused', plan.error, plan.error);
  for (const file of plan.copy) {
    f.mkdirSync(path.dirname(file.dest), { recursive: true });
    f.copyFileSync(file.abs, file.dest, COPY_EXCL);
  }
  const copied = plan.copy.map((file) => file.rel);
  record(base, now, opts, 'ok', `copied=${copied.length} skipped=${plan.skipped.length}`);
  return { ok: true, copied, skipped: plan.skipped };
}

module.exports = { collectAndCopy, cwdKey };
