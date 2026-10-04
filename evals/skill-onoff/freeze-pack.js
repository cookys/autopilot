#!/usr/bin/env node
// freeze-pack.js — freeze a skill pack (or a fixture-scripts pack) into packs/<id>/ and record
// per-file sha256 digests in packs/manifest.json (the harness verifies them on every cell).
//
// Usage:
//   freeze-pack.js --id <pack-id> --skill <name> --ref <git-ref>
//       → packs/<id>/ = git tree of skills/<name>/ at <ref> (SKILL.md + references/…).
//   freeze-pack.js --id <pack-id> --scripts <p1,p2,…> --ref <git-ref>
//       → packs/<id>/<repo-relative path> for each listed repo path plus the transitive closure
//         of their relative JS requires, read from <ref>. Used for fixture scripts (E3): the pack
//         root is copied onto the fixture repo root, so scripts/… lands at scripts/….
//   freeze-pack.js --id <pack-id> --from-dir <dir> [--ref <label>]
//       → byte-copy of <dir> (a pack-provided helper dir, e.g. the post-row helpers).
//   Add --force to replace an existing id. Without it an existing id is a hard error: a frozen
//   pack is never mutated in place (a changed arm = a NEW id; the historical one stays).
//   Env ONOFF_PACKS_DIR overrides the packs directory (tests).
// Exit: 0 frozen · 2 usage/error.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const id = opt('--id');
const skill = opt('--skill');
const scripts = opt('--scripts');
const fromDir = opt('--from-dir');
const ref = opt('--ref');
const force = argv.includes('--force');
const die = (m) => { console.error(`freeze-pack: ${m}`); process.exit(2); };
if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) die('--id <pack-id> required ([a-z0-9._-])');
if ([skill, scripts, fromDir].filter(Boolean).length !== 1) die('exactly one of --skill / --scripts / --from-dir');
if ((skill || scripts) && !ref) die('--ref <git-ref> required for --skill/--scripts');

const here = __dirname;
const packsDir = process.env.ONOFF_PACKS_DIR || path.join(here, 'packs');
const repoRoot = cp.execFileSync('git', ['-C', here, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const manifestPath = path.join(packsDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.packs = manifest.packs || {};
const dest = path.join(packsDir, id);
if ((manifest.packs[id] || fs.existsSync(dest)) && !force) die(`pack id already exists: ${id} (frozen packs are never mutated; use a new id)`);
if (force) fs.rmSync(dest, { recursive: true, force: true });

const git = (args, enc = 'buffer') => cp.execFileSync('git', ['-C', repoRoot, ...args], { encoding: enc === 'buffer' ? null : enc, maxBuffer: 1 << 28 });
const resolvedRef = ref && ref !== 'label' && !fromDir ? git(['rev-parse', '--verify', `${ref}^{commit}`], 'utf8').trim() : (ref || null);
const files = new Map(); // rel-in-pack → {data, mode}

function readAt(p) {
  const data = git(['show', `${resolvedRef}:${p}`]);
  const mode = git(['ls-tree', resolvedRef, p], 'utf8').split(' ')[0];
  return { data, mode };
}
if (skill) {
  const names = git(['ls-tree', '-r', '--name-only', resolvedRef, `skills/${skill}/`], 'utf8').split('\n').filter(Boolean);
  if (!names.length) die(`no skills/${skill}/ at ${ref}`);
  for (const n of names) files.set(path.posix.relative(`skills/${skill}`, n), readAt(n));
} else if (scripts) {
  const seen = new Set();
  const queue = scripts.split(',').map((s) => s.trim()).filter(Boolean);
  while (queue.length) {
    const p = path.posix.normalize(queue.shift());
    if (seen.has(p)) continue;
    seen.add(p);
    let f;
    try { f = readAt(p); } catch { die(`path not in ${ref}: ${p}`); }
    files.set(p, f);
    if (p.endsWith('.js')) {
      const src = f.data.toString('utf8');
      for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
        const base = path.posix.join(path.posix.dirname(p), m[1]);
        const cands = [base, `${base}.js`, `${base}.json`, `${base}/index.js`];
        const hit = cands.find((c) => { try { cp.execFileSync('git', ['-C', repoRoot, 'cat-file', '-e', `${resolvedRef}:${c}`], { stdio: 'ignore' }); return true; } catch { return false; } });
        if (!hit) die(`unresolvable require ${m[1]} from ${p}`);
        queue.push(hit);
      }
    }
  }
} else {
  const walk = (d, pre = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name), `${pre}${e.name}/`) : [[`${pre}${e.name}`, path.join(d, e.name)]]);
  for (const [rel, abs] of walk(fromDir)) files.set(rel, { data: fs.readFileSync(abs), mode: (fs.statSync(abs).mode & 0o111) ? '100755' : '100644' });
}

const digests = {};
for (const [rel, f] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const out = path.join(dest, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, f.data, { mode: f.mode === '100755' ? 0o755 : 0o644 });
  digests[`${id}/${rel}`] = crypto.createHash('sha256').update(f.data).digest('hex');
}
manifest.packs[id] = digests;
manifest.pack_meta = manifest.pack_meta || {};
manifest.pack_meta[id] = { kind: skill ? 'skill' : scripts ? 'scripts' : 'dir', source: skill || scripts || fromDir, ref: resolvedRef };
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`frozen ${id}: ${files.size} files @ ${resolvedRef || 'dir'}`);
