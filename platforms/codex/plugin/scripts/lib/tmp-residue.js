#!/usr/bin/env node
'use strict';
// tmp-residue.js — reader of the temp-prefix registry (scripts/lib/tmp-residue-registry.json).
//
//   node tmp-residue.js patterns [--json]
//       Glob patterns of kind scratch|evidence only (the kinds age-only deletion may act on),
//       one per line (or a JSON array with --json).
//   node tmp-residue.js new-since --stamp FILE [--tmpdir DIR] [--exclude-kind K[,K]]
//                       [--exclude-source S[,S]] [--exclude-path P]... [--fail-on-entries] [--json]
//       Every direct child of the temp root owned by the current user whose mtime is newer
//       than FILE's mtime, labelled with its registry kind or `unregistered`. --exclude-kind
//       drops only the named kinds; --exclude-path drops exact paths. --fail-on-entries
//       exits 1 when anything remains. Exit 2 on usage error.
//
// `prune` (age-based deletion) is not implemented here yet; it lands with the daily prune.
// Node built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, 'tmp-residue-registry.json');
const KINDS = Object.freeze(['scratch', 'evidence', 'test-lockgated', 'live', 'lock', 'worktree']);
const EXIT_OK = 0;
const AGE_DELETABLE = Object.freeze(['scratch', 'evidence']);

function loadRegistry(file = REGISTRY_PATH) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!doc || !Array.isArray(doc.entries)) throw new Error('registry: entries[] missing');
  for (const e of doc.entries) {
    if (!e || typeof e.pattern !== 'string' || !e.pattern) throw new Error('registry: entry without pattern');
    if (!KINDS.includes(e.kind)) throw new Error(`registry: bad kind ${JSON.stringify(e.kind)} for ${e.pattern}`);
  }
  return doc;
}

// Glob with `*`, `?` and simple `[...]` classes (the registry uses `[0-9]`).
function compileGlob(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if (ch === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else { re += glob.slice(i, end + 1); i = end; }
    } else re += ch.replace(/[.+^${}()|\\\]]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

function matchEntry(name, entries) {
  for (const e of entries) {
    if (!e._re) Object.defineProperty(e, '_re', { value: compileGlob(e.pattern), enumerable: false });
    if (e._re.test(name)) return e;
  }
  return null;
}

function classify(name, entries) {
  const e = matchEntry(name, entries);
  return e ? e.kind : 'unregistered';
}

function patterns(doc) {
  return doc.entries.filter((e) => AGE_DELETABLE.includes(e.kind)).map((e) => e.pattern);
}

function tmpRoot(opts) {
  return opts.tmpdir || process.env.TMPDIR || os.tmpdir() || '/tmp';
}

function newSince(doc, opts) {
  if (!opts.stamp) throw usage('new-since requires --stamp FILE');
  const stampMs = fs.statSync(opts.stamp).mtimeMs;
  const root = tmpRoot(opts);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const excludeKinds = new Set(opts.excludeKinds);
  for (const k of excludeKinds) if (!KINDS.includes(k) && k !== 'unregistered') throw usage(`unknown kind: ${k}`);
  const excludeSources = new Set(opts.excludeSources);
  const excludePaths = new Set(opts.excludePaths.map((p) => path.resolve(p)));
  const entries = [];
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (uid !== null && st.uid !== uid) continue;
    if (!(st.mtimeMs > stampMs)) continue;
    if (excludePaths.has(path.resolve(full))) continue;
    const hit = matchEntry(name, doc.entries);
    const kind = hit ? hit.kind : 'unregistered';
    if (excludeKinds.has(kind)) continue;
    if (hit && hit.source && excludeSources.has(hit.source)) continue;
    entries.push({ name, path: full, kind, type: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'file' });
  }
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { tmpdir: root, stamp: opts.stamp, count: entries.length, entries };
}

// Start time (clock ticks since boot) of a pid: field 22 of /proc/<pid>/stat, counted after the
// last ')' because the comm field may itself contain spaces and parentheses. null if unknowable.
function procStartTime(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const v = Number(rest[19]); // field 22 overall; rest[0] is field 3
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

// True when `<dir>/.autopilot-owner` names a pid that is alive with the recorded start time.
function ownerAlive(dir) {
  let o;
  try { o = JSON.parse(fs.readFileSync(path.join(dir, '.autopilot-owner'), 'utf8')); } catch { return false; }
  if (!o || !Number.isInteger(o.pid) || o.pid <= 0) return false;
  const start = procStartTime(o.pid);
  if (start === null) return false; // pid gone
  if (o.start_time === null || o.start_time === undefined) return true; // writer could not record it: pid liveness only
  return start === o.start_time;
}

function exists(p) { try { fs.lstatSync(p); return true; } catch { return false; } }

function defaultDays(env = process.env) {
  const v = env.AUTOPILOT_TMP_LOG_RETENTION_DAYS;
  if (v === undefined || v === '') return 3;
  return /^[0-9]+$/.test(v) ? Number(v) : 3;
}

function pruneTmp(doc, opts) {
  const root = tmpRoot(opts);
  const receipt = { tmpdir: root, ran_at: new Date(opts.nowMs || Date.now()).toISOString(), deleted: [], kept: [], errors: [] };
  const base = opts.days !== undefined ? opts.days : defaultDays();
  if (!(base > 0)) { receipt.skipped = 'retention_disabled'; return receipt; }
  const nowMs = opts.nowMs || Date.now();
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  let names;
  try { names = fs.readdirSync(root); } catch (e) { receipt.skipped = 'tmpdir_unreadable'; return receipt; }
  for (const name of names.sort()) {
    const hit = matchEntry(name, doc.entries);
    if (!hit || !AGE_DELETABLE.includes(hit.kind)) continue; // live/lock/worktree/test-lockgated/unregistered: never age-deleted
    const full = path.join(root, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    const keep = (why) => receipt.kept.push({ name, kind: hit.kind, why });
    if (st.isSymbolicLink()) { keep('symlink'); continue; }
    if (uid !== null && st.uid !== uid) continue;
    const entryDays = Number.isFinite(hit.retention_days) ? hit.retention_days : null;
    const days = opts.days !== undefined ? Math.max(base, entryDays || 0) : (entryDays !== null ? entryDays : base);
    if (!(nowMs - st.mtimeMs > days * 86400000)) { keep('younger_than_retention'); continue; }
    if (st.isDirectory()) {
      if (exists(path.join(full, '.autopilot-live.lock'))) { keep('live_lock'); continue; }
      if (exists(path.join(full, '.autopilot-worktree'))) { keep('worktree_marker'); continue; }
      if (ownerAlive(full)) { keep('owner_alive'); continue; }
    }
    try {
      const again = fs.lstatSync(full); // re-check right before deleting: not swapped for a symlink
      if (again.isSymbolicLink()) { keep('symlink'); continue; }
      fs.rmSync(full, { recursive: true, force: true });
      receipt.deleted.push(name);
    } catch (e) { receipt.errors.push({ name, error: String(e.message).slice(0, 200) }); }
  }
  return receipt;
}

// Host-level throttle: a stamp younger than `hours` means "already ran"; otherwise claim it now.
function claimStamp(file, hours, nowMs) {
  try {
    if (nowMs - fs.statSync(file).mtimeMs < hours * 3600000) return false;
  } catch { /* no stamp yet */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify({ at: new Date(nowMs).toISOString(), pid: process.pid })}\n`);
  fs.renameSync(tmp, file);
  return true;
}

function usage(msg) { const e = new Error(msg); e.usage = true; return e; }

function parseArgs(argv) {
  const opts = { excludeKinds: [], excludeSources: [], excludePaths: [], failOnEntries: false, json: false };
  const sub = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw usage(`${a} needs a value`); return argv[++i]; };
    if (a === '--stamp') opts.stamp = val();
    else if (a === '--tmpdir') opts.tmpdir = val();
    else if (a === '--registry') opts.registry = val();
    else if (a === '--exclude-kind') opts.excludeKinds.push(...val().split(',').filter(Boolean));
    else if (a === '--exclude-source') opts.excludeSources.push(...val().split(',').filter(Boolean));
    else if (a === '--days') { const n = Number(val()); if (!Number.isFinite(n) || n < 0) throw usage('--days must be a non-negative number'); opts.days = n; }
    else if (a === '--throttle-hours') { const n = Number(val()); if (!(n > 0)) throw usage('--throttle-hours must be positive'); opts.throttleHours = n; }
    else if (a === '--now-ms') opts.nowMs = Number(val());
    else if (a === '--exclude-path') opts.excludePaths.push(val());
    else if (a === '--fail-on-entries') opts.failOnEntries = true;
    else if (a === '--json') opts.json = true;
    else throw usage(`unknown argument: ${a}`);
  }
  return { sub, opts };
}

function writeOut(s) { fs.writeSync(1, s); }

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
    const { sub, opts } = parsed;
    const doc = loadRegistry(opts.registry);
    if (sub === 'patterns') {
      const ps = patterns(doc);
      writeOut(opts.json ? JSON.stringify(ps) + '\n' : ps.map((p) => p + '\n').join(''));
      return EXIT_OK;
    }
    if (sub === 'prune') {
      const nowMs = opts.nowMs || Date.now();
      let receipt;
      if (opts.stamp && opts.throttleHours && defaultDays() > 0) {
        receipt = claimStamp(opts.stamp, opts.throttleHours, nowMs)
          ? pruneTmp(doc, opts)
          : { tmpdir: tmpRoot(opts), deleted: [], kept: [], errors: [], skipped: 'throttled' };
      } else receipt = pruneTmp(doc, opts);
      writeOut(JSON.stringify(receipt) + '\n');
      return EXIT_OK;
    }
    if (sub === 'new-since') {
      const res = newSince(doc, opts);
      if (opts.json) writeOut(JSON.stringify(res) + '\n');
      else {
        for (const e of res.entries) writeOut(`${e.kind}\t${e.type}\t${e.path}\n`);
        writeOut(`new-since: ${res.count} entr${res.count === 1 ? 'y' : 'ies'} in ${res.tmpdir}\n`);
      }
      return opts.failOnEntries && res.count > 0 ? 1 : 0;
    }
    throw usage(`unknown subcommand: ${sub || '(none)'} (patterns | new-since | prune)`);
  } catch (e) {
    fs.writeSync(2, `tmp-residue: ${e.message}\n`);
    return e.usage ? 2 : 3;
  }
}

module.exports = { loadRegistry, classify, matchEntry, pruneTmp, ownerAlive, procStartTime, claimStamp, patterns, newSince, compileGlob, KINDS, AGE_DELETABLE, REGISTRY_PATH };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
