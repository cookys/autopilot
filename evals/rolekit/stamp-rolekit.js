#!/usr/bin/env node
'use strict';
// stamp-rolekit.js -- freeze a rolekit prereg row. The skill-onoff stamp-prereg.js is built for skill packs and arm
// manifests (it needs packs/manifest.json and a --check-arms campaign script); a role-kit arm is a directory, so this is
// the small equivalent with the same FROZEN.json shape.
//   stamp-rolekit.js --row pilot|formal [--check]
// Steps, all refusals exit 2 and write nothing:
//   1. the prereg status is "draft" and every freeze_files entry exists (directories are walked; symlinks refused);
//   2. every kit and placebo kit passes compile-kit validateKit; each placebo role.md / skill is within 5% of its kit's bytes;
//   3. tasks/manifest.json still matches the bytes of every frozen task file;
//   4. set prereg.status = "stamped <date>", stamped = true, then write sha256 of every frozen file into prereg/FROZEN.json[<row>].
// --check re-derives the digests and refuses on any difference. Stamp LAST; any later edit voids the row.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateKit } = require('./compile-kit.js');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const row = opt('--row'); const check = argv.includes('--check');
const root = path.resolve(opt('--root') || __dirname);
const die = (m) => { console.error(`stamp-rolekit: ${m}`); process.exit(2); };
if (!row || !/^[a-z0-9-]+$/.test(row)) die('usage: stamp-rolekit.js --row pilot|formal [--check] [--root dir]');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
const preregRel = `prereg/${row}.json`;
const prereg = JSON.parse(fs.readFileSync(path.join(root, preregRel), 'utf8'));

function expand(entry) {
  const abs = path.join(root, entry);
  if (!fs.existsSync(abs)) die(`freeze_files entry does not exist: ${entry}`);
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) die(`symlink in frozen set: ${entry}`);
  if (!st.isDirectory()) return [entry];
  return fs.readdirSync(abs).sort().flatMap((n) => expand(path.posix.join(entry, n)));
}
const frozen = () => [...new Set(prereg.freeze_files.flatMap(expand))].sort();

function preflight() {
  const roles = prereg.design.roles;
  for (const kind of ['kits', 'placebo']) for (const r of roles) {
    const v = validateKit(path.join(root, kind, r));
    if (v.errors.length) die(`${kind}/${r}: ${v.errors.join('; ')}`);
  }
  const size = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
  const within = (a, b) => Math.abs(a - b) <= 0.05 * b;
  for (const r of roles) {
    if (!within(size(path.join(root, 'placebo', r, 'role.md')), size(path.join(root, 'kits', r, 'role.md')))) die(`placebo/${r}/role.md is not within 5% of the kit role.md`);
    const skill = (dir) => { const d = path.join(root, dir, r, 'plugin', 'skills'); return fs.existsSync(d) ? path.join(d, fs.readdirSync(d)[0], 'SKILL.md') : null; };
    const ks = skill('kits'); const ps = skill('placebo');
    if (!!ks !== !!ps) die(`${r}: kit and placebo disagree on having a plugin`);
    if (ks && !within(size(ps), size(ks))) die(`${r}: placebo skill is not within 5% of the kit skill`);
    if (fs.readFileSync(path.join(root, 'kits', r, 'tools'), 'utf8') !== fs.readFileSync(path.join(root, 'placebo', r, 'tools'), 'utf8')) die(`${r}: placebo tools differ from kit tools`);
  }
  const man = JSON.parse(fs.readFileSync(path.join(root, 'tasks/manifest.json'), 'utf8'));
  for (const t of man.tasks) for (const [rel, h] of Object.entries(t.files)) {
    const f = `tasks/${t.dir}/${rel}`;
    if (!fs.existsSync(path.join(root, f)) || sha(f) !== h) die(`task file changed: ${f}`);
  }
}

const frozenPath = path.join(root, 'prereg/FROZEN.json');
const readFrozen = () => (fs.existsSync(frozenPath) ? JSON.parse(fs.readFileSync(frozenPath, 'utf8')) : { schema_version: 1, artifact_type: 'rolekit_prereg_freeze', rows: {} });

if (check) {
  const fz = readFrozen().rows[row];
  if (!fz || !fz.stamped) die(`row ${row} is not stamped`);
  const now = Object.fromEntries(frozen().map((f) => [f, sha(f)]));
  const diff = Object.keys({ ...now, ...fz.files }).filter((k) => now[k] !== fz.files[k]);
  if (diff.length) die(`digest mismatch: ${diff.join(', ')}`);
  console.log(`stamp-rolekit: ${row} ok (${Object.keys(now).length} files)`);
} else {
  if (prereg.status !== 'draft' || prereg.stamped) die(`prereg status is "${prereg.status}", not draft: refusing to re-stamp`);
  preflight();
  prereg.status = `stamped ${new Date().toISOString().slice(0, 10)}`;
  prereg.stamped = true;
  fs.writeFileSync(path.join(root, preregRel), `${JSON.stringify(prereg, null, 2)}\n`);
  const fz = readFrozen();
  fz.rows[row] = { frozen_at: new Date().toISOString().slice(0, 10), stamped: true, files: Object.fromEntries(frozen().map((f) => [f, sha(f)])) };
  fs.writeFileSync(frozenPath, `${JSON.stringify(fz, null, 2)}\n`);
  console.log(`stamp-rolekit: stamped ${row} (${Object.keys(fz.rows[row].files).length} files)`);
}
