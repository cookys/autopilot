#!/usr/bin/env node
// closure-scan.js — static dependency closure of a skill-onoff row, so the freeze list is derived, not hand-listed.
//
//   closure-scan.js --prereg prereg/<row>.json [--root <evals/skill-onoff dir>]   prints one JSON object
//   module: closure(root, rootsRelative) -> { files, unresolved, outside_root }
//
// Only .js / .sh / .py files are scanned for references; .md and .json are followed to but not into.
// Whole-line comments (# or //) are ignored.
// Starting points: the prereg's closure_roots (files or directories, root-relative; directories are walked) and its campaign_script.
// From every text file reached (.js .sh .md .json .py) the scan follows local references:
//   - JS require('./x') / require("../x") (extension .js / index.js tried), relative to the requiring file;
//   - JS path.join(<anything>, 'a', 'b') / path.resolve(...) calls: the string-literal arguments, joined, tried against the file's dir and the root;
//   - any quoted or bare path-like token ending in .js .sh .md .json .py (covers readFileSync targets, shell `source`, `. file`,
//     `node <path>`, `bash <path>`, "$(dirname "$0")/x"): a leading $VAR / ${VAR} / $(...) prefix is dropped, then it is tried against
//     the file's dir and the root.
// A reference that resolves to a file inside the root is part of the closure (and is scanned in turn). A reference that resolves to an
// existing file outside the root goes to outside_root (digests are root-relative, so these are reported, not frozen). A reference the
// static scan cannot resolve (variable inside the path, or a bare directory built at run time) goes to unresolved.
// closure_exclude (optional prereg field, default empty = the scan above, byte for byte): [{"path": "<repo-relative or root-relative file>", "reason": "<why>"}].
// A reference that resolves to an excluded file is neither listed nor expanded. ONLY paths on EXCLUDABLE (a list written in THIS file, so that
// adding one is a reviewed code change and never a prereg edit) can be excluded; any other path is an error and is never honoured by closure().
// closure() takes the list as its third argument and returns exclude_hits (excluded paths some scanned file referenced) and excluded_roots (excluded
// paths that are closure roots: a root is never excluded); checkExclude(root, exclude, result) returns the audit errors: on the allowlist,
// non-empty reason, the file exists, not a closure root, and really referenced by a closure file.
// Node built-ins, bare module names and system commands are ignored. Exit: 0 printed . 2 usage
'use strict';
const fs = require('fs');
const path = require('path');

const TEXT = /\.(js|sh|md|json|py)$/;
const SCAN = /\.(js|sh|py)$/; // only code is scanned for references; .md / .json files are data and are not followed further
const EXT = '(?:js|sh|md|json|py)';

function walk(abs, rel, out) {
  if (fs.statSync(abs).isDirectory()) { for (const n of fs.readdirSync(abs).sort()) walk(path.join(abs, n), path.posix.join(rel, n), out); } else out.add(rel);
}

// excluded path -> root-relative posix path (repo-relative paths are resolved against root/../.., root-relative ones against root)
function excludeRel(root, p) {
  for (const base of [path.resolve(root, '../..'), root]) {
    const abs = path.resolve(base, String(p));
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) { const r = path.relative(root, abs).split(path.sep).join('/'); return r.startsWith('..') ? null : r; }
  }
  return null;
}
const EXCLUDABLE = Object.freeze(['evals/skill-onoff/stamp-prereg.js']); // the stamping gate tool: not an evaluation input (the formal-run launch guard calls it)
const excludableRel = (root) => new Set(EXCLUDABLE.map((p) => excludeRel(root, p)).filter(Boolean));
function checkExclude(root, exclude, res) {
  const hits = (res && res.exclude_hits) || [];
  const rootsHit = (res && res.excluded_roots) || [];
  const allowed = excludableRel(root);
  const errors = [];
  if (exclude === undefined) return errors;
  if (!Array.isArray(exclude)) return ['closure_exclude must be an array of {path, reason}'];
  exclude.forEach((e, i) => {
    if (!e || typeof e !== 'object' || typeof e.path !== 'string' || !e.path.trim()) { errors.push(`closure_exclude[${i}] has no path`); return; }
    if (typeof e.reason !== 'string' || !e.reason.trim()) { errors.push(`closure_exclude[${i}] (${e.path}) has no reason`); return; }
    const rel = excludeRel(root, e.path);
    if (rel === null) { errors.push(`closure_exclude[${i}] (${e.path}) does not exist inside the root`); return; }
    if (!allowed.has(rel)) { errors.push(`closure_exclude[${i}] (${e.path}) is not on the closure-scan.js allowlist (${EXCLUDABLE.join(', ')}); only a reviewed change to closure-scan.js can add a path`); return; }
    if (rootsHit.includes(rel)) { errors.push(`closure_exclude[${i}] (${e.path}) is a closure root and cannot be excluded`); return; }
    if (!hits.includes(rel)) errors.push(`closure_exclude[${i}] (${e.path}) is not referenced by any file in the closure (remove the useless exclusion)`);
  });
  return errors;
}
function closure(root, roots, exclude) {
  const allowedRel = excludableRel(root);
  const excluded = new Set(Array.isArray(exclude) ? exclude.map((e) => (e && typeof e.path === 'string' ? excludeRel(root, e.path) : null)).filter((r) => r && allowedRel.has(r)) : []);
  const rootSet = new Set();
  const hits = new Set();
  const rootsHit = new Set();
  const files = new Set();
  const unresolved = new Set();
  const outside = new Set();
  const queue = [];
  const inRoot = (abs) => { const r = path.relative(root, abs); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
  const add = (abs, isRoot) => {
    if (!fs.existsSync(abs)) return false;
    if (fs.statSync(abs).isDirectory()) return false;
    if (!inRoot(abs)) { outside.add(path.relative(path.resolve(root, '../..'), abs).split(path.sep).join('/')); return true; }
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!isRoot && excluded.has(rel)) { if (rootSet.has(rel)) rootsHit.add(rel); else { hits.add(rel); return true; } }
    if (!files.has(rel)) { files.add(rel); if (SCAN.test(rel)) queue.push(rel); }
    return true;
  };
  for (const r of roots) {
    const abs = path.join(root, r);
    if (!fs.existsSync(abs)) { unresolved.add(`${r} (closure root missing)`); continue; }
    const set = new Set(); walk(abs, r, set);
    for (const f of set) { rootSet.add(f); add(path.join(root, f), true); }
  }
  const tryResolve = (from, cand) => {
    const bases = cand.includes('/') ? [path.dirname(path.join(root, from)), root] : [path.dirname(path.join(root, from))]; // a bare name is only the file's own sibling
    for (const b of bases) for (const c of [cand, `${cand}.js`, path.join(cand, 'index.js')]) {
      const abs = path.resolve(b, c);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    }
    return null;
  };
  while (queue.length) {
    const rel = queue.shift();
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    text = text.split('\n').filter((l) => !/^\s*(#(?!!)|\/\/)/.test(l)).join('\n'); // whole-line comments name files without using them
    const cands = new Set();
    if (rel.endsWith('.js')) {
      for (const m of text.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) cands.add(m[1]);
      for (const m of text.matchAll(/path\.(?:join|resolve)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
        const lits = [...m[1].matchAll(/'([^']*)'|"([^"]*)"|`([^`$]*)`/g)].map((x) => x[1] ?? x[2] ?? x[3]).filter((s) => s !== '');
        if (lits.length) cands.add(lits.join('/'));
      }
    }
    // shell: $(dirname "$0") is this file's directory; any other $( ... ) is a run-time value and acts like a variable
    const flat = rel.endsWith('.sh') ? text.replace(/\$\(\s*dirname\s+[^()]*\)/g, '.').replace(/\$\([^()]*\)/g, '$X') : text;
    for (const m of flat.matchAll(new RegExp('[A-Za-z0-9_./${}-]*[A-Za-z0-9_-]\.' + EXT + '\\b', 'g'))) cands.add(m[0]);
    for (const raw of cands) {
      let c = raw.replace(/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\/?/, '');
      if (!c || /^https?:/.test(c)) continue;
      if (/[$`{}()]/.test(c)) { unresolved.add(`${rel}: ${raw}`); continue; } // a run-time value inside the path
      if (path.isAbsolute(c) || /^~/.test(c)) continue;
      const abs = tryResolve(rel, c) || tryResolve(rel, c.replace(/^(\.{1,2}\/)+/, ''));
      if (abs) add(abs);
    }
  }
  return { files: [...files].sort(), unresolved: [...unresolved].sort(), outside_root: [...outside].sort(), ...(excluded.size ? { exclude_hits: [...hits].sort(), excluded_roots: [...rootsHit].sort() } : {}) };
}

module.exports = { closure, checkExclude, EXCLUDABLE };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const preregRel = opt('--prereg');
  const root = path.resolve(opt('--root') || __dirname);
  if (!preregRel) { console.error('usage: closure-scan.js --prereg prereg/<row>.json [--root <dir>]'); process.exit(2); }
  const prereg = JSON.parse(fs.readFileSync(path.join(root, preregRel), 'utf8'));
  const roots = [...(prereg.closure_roots || []), ...(prereg.campaign_script ? [prereg.campaign_script] : [])];
  const res = closure(root, roots, prereg.closure_exclude);
  const exErr = checkExclude(root, prereg.closure_exclude, res);
  if (exErr.length) { console.error(`closure-scan: ${exErr.join('; ')}`); process.exit(2); }
  console.log(JSON.stringify(res, null, 2));
}
