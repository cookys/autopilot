#!/usr/bin/env node
'use strict';
// stamp-rolekit.js -- freeze a rolekit prereg row. The skill-onoff stamp-prereg.js is built for skill packs and arm
// manifests (it needs packs/manifest.json and a --check-arms campaign script); a role-kit arm is a directory, so this is
// the small equivalent with the same FROZEN.json shape.
//   stamp-rolekit.js --row pilot|formal --authorized-by <id>      (stamp; <id> = the PM authorisation, e.g. the decision id)
//   stamp-rolekit.js --row pilot|formal --check                   (re-derive everything, write nothing)
// Steps, all refusals exit 2 and write nothing:
//   1. the prereg status is "draft" and every freeze_files entry exists (directories are walked; symlinks refused);
//   2. every kit and placebo kit passes compile-kit validateKit; each placebo role.md / skill is within 5% of its kit's bytes;
//   3. tasks/manifest.json still matches the bytes of every frozen task file;
//   4. --authorized-by is required; set prereg.status = "stamped <date>", stamped = true, then write sha256 of every frozen file into prereg/FROZEN.json[<row>].
// 5. write prereg/receipt-<row>.json: stamped_at, authorized_by, prereg_sha256, and one digest each for kits, placebo, tasks,
//    checks and the verdict code (score-rolekit.js, compile-kit.js, cost files); FROZEN.json keeps the per-file digests.
// --check re-derives the per-file digests AND the receipt (prereg sha, group digests, authoriser) and refuses on any
// difference, naming the file or the receipt field. Stamp LAST; any later edit voids the row.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateKit } = require('./compile-kit.js');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const row = opt('--row'); const check = argv.includes('--check'); const authorizedBy = opt('--authorized-by');
const root = path.resolve(opt('--root') || __dirname);
const die = (m) => { console.error(`stamp-rolekit: ${m}`); process.exit(2); };
if (!row || !/^[a-z0-9-]+$/.test(row)) die('usage: stamp-rolekit.js --row pilot|formal (--authorized-by <id> | --check) [--root dir]');
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

const receiptRel = `prereg/receipt-${row}.json`;
const GROUPS = { kits: (f) => f.startsWith('kits/'), placebo: (f) => f.startsWith('placebo/'), tasks: (f) => f.startsWith('tasks/'), checks: (f) => f.startsWith('checks/'), verdict_code: (f) => !/^(kits|placebo|tasks|checks)\//.test(f) && f !== preregRel };
function groupDigests(files) { // files: path -> sha256; digest of "path<TAB>sha\n" lines, sorted
  const out = {};
  for (const [g, pred] of Object.entries(GROUPS)) out[g] = crypto.createHash('sha256').update(Object.keys(files).filter(pred).sort().map((f) => `${f}\t${files[f]}\n`).join('')).digest('hex');
  return out;
}
const frozenPath = path.join(root, 'prereg/FROZEN.json');
const readFrozen = () => (fs.existsSync(frozenPath) ? JSON.parse(fs.readFileSync(frozenPath, 'utf8')) : { schema_version: 1, artifact_type: 'rolekit_prereg_freeze', rows: {} });

if (check) {
  const fz = readFrozen().rows[row];
  if (!fz || !fz.stamped) die(`row ${row} is not stamped`);
  const now = Object.fromEntries(frozen().map((f) => [f, sha(f)]));
  const diff = Object.keys({ ...now, ...fz.files }).filter((k) => now[k] !== fz.files[k]);
  if (diff.length) die(`digest mismatch: ${diff.join(', ')}`);
  if (!fs.existsSync(path.join(root, receiptRel))) die(`receipt missing: ${receiptRel}`);
  const rc = JSON.parse(fs.readFileSync(path.join(root, receiptRel), 'utf8'));
  const bad = [];
  if (rc.artifact_type !== 'rolekit_stamp_receipt' || rc.row !== row) bad.push('artifact_type/row');
  if (typeof rc.authorized_by !== 'string' || rc.authorized_by.trim() === '') bad.push('authorized_by');
  if (!/^\d{4}-\d\d-\d\dT/.test(String(rc.stamped_at))) bad.push('stamped_at');
  if (rc.prereg_sha256 !== sha(preregRel)) bad.push('prereg_sha256');
  const gd = groupDigests(now);
  for (const g of Object.keys(GROUPS)) if (!rc.digests || rc.digests[g] !== gd[g]) bad.push(`digests.${g}`);
  if (bad.length) die(`receipt mismatch: ${bad.join(', ')}`);
  console.log(`stamp-rolekit: ${row} ok (${Object.keys(now).length} files)`);
} else {
  if (!authorizedBy || !/^[A-Za-z0-9_.:\/-]+$/.test(authorizedBy)) die('--authorized-by <id> is required (the PM authorisation, e.g. d-xxxxxxxx)');
  if (prereg.status !== 'draft' || prereg.stamped) die(`prereg status is "${prereg.status}", not draft: refusing to re-stamp`);
  preflight();
  prereg.status = `stamped ${new Date().toISOString().slice(0, 10)}`;
  prereg.stamped = true;
  fs.writeFileSync(path.join(root, preregRel), `${JSON.stringify(prereg, null, 2)}\n`);
  const fz = readFrozen();
  fz.rows[row] = { frozen_at: new Date().toISOString().slice(0, 10), stamped: true, files: Object.fromEntries(frozen().map((f) => [f, sha(f)])) };
  fs.writeFileSync(frozenPath, `${JSON.stringify(fz, null, 2)}\n`);
  const stampedAt = new Date().toISOString();
  const receipt = { schema_version: 1, artifact_type: 'rolekit_stamp_receipt', row, stamped_at: stampedAt, authorized_by: authorizedBy, prereg_sha256: sha(preregRel), digests: groupDigests(fz.rows[row].files), frozen_files: Object.keys(fz.rows[row].files).length };
  fs.writeFileSync(path.join(root, receiptRel), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`stamp-rolekit: stamped ${row} (${Object.keys(fz.rows[row].files).length} files)`);
}
