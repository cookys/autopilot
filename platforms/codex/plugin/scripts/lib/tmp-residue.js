#!/usr/bin/env node
'use strict';
// tmp-residue.js — reader of the temp-prefix registry (scripts/lib/tmp-residue-registry.json).
//
//   node tmp-residue.js patterns [--json]
//       Glob patterns of kind scratch|evidence only (the kinds age-only deletion may act on),
//       one per line (or a JSON array with --json).
//   node tmp-residue.js new-since --stamp FILE [--tmpdir DIR] [--exclude-kind K[,K]]
//                       [--exclude-path P]... [--fail-on-entries] [--json]
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

function classify(name, entries) {
  for (const e of entries) {
    if (!e._re) Object.defineProperty(e, '_re', { value: compileGlob(e.pattern), enumerable: false });
    if (e._re.test(name)) return e.kind;
  }
  return 'unregistered';
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
  const excludePaths = new Set(opts.excludePaths.map((p) => path.resolve(p)));
  const entries = [];
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (uid !== null && st.uid !== uid) continue;
    if (!(st.mtimeMs > stampMs)) continue;
    if (excludePaths.has(path.resolve(full))) continue;
    const kind = classify(name, doc.entries);
    if (excludeKinds.has(kind)) continue;
    entries.push({ name, path: full, kind, type: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'file' });
  }
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { tmpdir: root, stamp: opts.stamp, count: entries.length, entries };
}

function usage(msg) { const e = new Error(msg); e.usage = true; return e; }

function parseArgs(argv) {
  const opts = { excludeKinds: [], excludePaths: [], failOnEntries: false, json: false };
  const sub = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw usage(`${a} needs a value`); return argv[++i]; };
    if (a === '--stamp') opts.stamp = val();
    else if (a === '--tmpdir') opts.tmpdir = val();
    else if (a === '--registry') opts.registry = val();
    else if (a === '--exclude-kind') opts.excludeKinds.push(...val().split(',').filter(Boolean));
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
      return 0;
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
    throw usage(`unknown subcommand: ${sub || '(none)'} (patterns | new-since)`);
  } catch (e) {
    fs.writeSync(2, `tmp-residue: ${e.message}\n`);
    return e.usage ? 2 : 3;
  }
}

module.exports = { loadRegistry, classify, patterns, newSince, compileGlob, KINDS, AGE_DELETABLE, REGISTRY_PATH };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
