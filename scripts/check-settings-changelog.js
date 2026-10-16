#!/usr/bin/env node
// check-settings-changelog.js — release gate: user-facing setting changes must be
// named in the release's `### Settings changes` CHANGELOG subsection.
//
// Compares audience=user entries of scripts/lib/config-keys.json at the previous
// release tag (git describe --tags --abbrev=0) with the working copy. Added, removed
// and default-changed names must each appear in the subsection. internal-only
// changes are never required. No user-level change => no subsection required.
// Baseline missing (config-keys.json did not exist at the tag) => bootstrap: the
// subsection must exist and link docs/settings-reference.md; no per-key listing.
//
// Usage: check-settings-changelog.js [--keys P] [--baseline-keys P] [--changelog P]
//        [--section "<heading text after ## >"] [--base-ref REF]
// Section default: `Unreleased` if the CHANGELOG has that section (pre-release), else `v<plugin.json version>`.
// Exit: 0 ok, 1 violation, 2 usage/IO error.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..');
const KEYS_REL = 'scripts/lib/config-keys.json';

function die(msg, code) { console.error(msg); process.exit(code === undefined ? 1 : code); }

const o = { keys: KEYS_REL, baselineKeys: null, changelog: 'CHANGELOG.md', section: null, baseRef: null };
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) {
  const k = { '--keys': 'keys', '--baseline-keys': 'baselineKeys', '--changelog': 'changelog', '--section': 'section', '--base-ref': 'baseRef' }[a[i]];
  if (a[i] === '-h' || a[i] === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 16).join('\n')); process.exit(0); }
  if (!k || i + 1 >= a.length) die(`bad argument: ${a[i]}`, 2);
  o[k] = a[++i];
}

function userMap(text, label) {
  let j;
  try { j = JSON.parse(text); } catch (e) { die(`cannot parse ${label}: ${e.message}`, 2); }
  if (!j || !Array.isArray(j.entries)) die(`${label}: missing entries array`, 2);
  const m = new Map();
  for (const e of j.entries) if (e.audience === 'user') m.set(e.name, JSON.stringify(e.default === undefined ? null : e.default));
  return m;
}

let cur;
try { cur = userMap(fs.readFileSync(path.resolve(REPO, o.keys), 'utf8'), o.keys); }
catch (e) { die(`cannot read ${o.keys}: ${e.message}`, 2); }

let base = null; let baseLabel = null;
if (o.baselineKeys) {
  const p = path.resolve(REPO, o.baselineKeys);
  if (!fs.existsSync(p)) die(`--baseline-keys not found: ${o.baselineKeys}`, 2);
  base = userMap(fs.readFileSync(p, 'utf8'), o.baselineKeys); baseLabel = o.baselineKeys;
} else {
  const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 20 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const ref = o.baseRef || git(['describe', '--tags', '--abbrev=0']).trim();
    baseLabel = ref;
    try { base = userMap(git(['show', `${ref}:${KEYS_REL}`]), `${ref}:${KEYS_REL}`); } catch { base = null; }
  } catch { base = null; }
}

const changelog = fs.readFileSync(path.resolve(REPO, o.changelog), 'utf8').split(/\r?\n/);
let heading = o.section;
if (!heading) {
  let ver = '';
  try { ver = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin/plugin.json'), 'utf8')).version; } catch { /* fall through */ }
  const has = (h) => changelog.some((l) => l.startsWith('## ' + h));
  heading = has('Unreleased') ? 'Unreleased' : 'v' + ver;
}
// Extract `## <heading>` section, then its `### Settings changes` subsection (fence-aware).
let inFence = false; let inSec = false; let inSub = false; let sub = null;
for (const l of changelog) {
  if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; if (inSub) sub += l + '\n'; continue; }
  if (!inFence && /^## /.test(l)) { inSec = l.startsWith('## ' + heading) && /^(\s|$|—)/.test(l.slice(3 + heading.length)); inSub = false; continue; }
  if (!inSec) continue;
  if (!inFence && /^### /.test(l)) { inSub = /^### Settings changes\s*$/i.test(l); if (inSub && sub === null) sub = ''; continue; }
  if (inSub) sub += l + '\n';
}

const need = [];
if (base) {
  for (const [n, d] of cur) { if (!base.has(n)) need.push(`added: ${n}`); else if (base.get(n) !== d) need.push(`default changed: ${n}`); }
  for (const n of base.keys()) if (!cur.has(n)) need.push(`removed: ${n}`);
}
const bootstrap = !base;
if (!bootstrap && need.length === 0) { console.log(`ok: no user-facing setting changes since ${baseLabel}`); process.exit(0); }
if (sub === null) {
  die(`CHANGELOG '## ${heading}' has no '### Settings changes' subsection` +
      (bootstrap ? ` (no ${KEYS_REL} baseline: bootstrap requires the subsection)` : `; required for:\n  ${need.join('\n  ')}`));
}
const bad = [];
if (bootstrap) { if (!sub.includes('docs/settings-reference.md')) bad.push('bootstrap: subsection must link docs/settings-reference.md'); }
else for (const n of need) { const name = n.split(': ')[1]; if (!sub.includes(name)) bad.push(`not named in Settings changes: ${n}`); }
if (bad.length) die(`CHANGELOG '## ${heading}' Settings changes incomplete:\n  ${bad.join('\n  ')}`);
console.log(`ok: Settings changes in '## ${heading}' cover ${bootstrap ? 'bootstrap' : need.length + ' change(s)'}`);
