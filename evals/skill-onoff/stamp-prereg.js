#!/usr/bin/env node
// stamp-prereg.js — freeze a skill-onoff prereg row: write the arm-manifest sha256 into the prereg JSON and record the
// digest of every file the row depends on in prereg/FROZEN.json. Row-generic (stamp-g67-amendment.js is the g67-specific
// ancestor and stays untouched: it is digest-frozen with that row's live results).
//
//   stamp-prereg.js --row <row> [--root <evals/skill-onoff dir>] [--check]
//
// The row's prereg is prereg/<row>.json. It names, itself: arms.{off,on} + arm_manifests.*.file (every manifest listed,
// including arms beyond off/on), freeze_files (files or directories, relative to --root; directories are walked and
// symlinks followed) and freeze_packs (pack ids whose provenance, manifest.pack_meta, is recorded). Steps, in order,
// all refusals exit 2 and write nothing:
//   1. every pack each arm manifest names is in packs/manifest.json (skills, files, fixture_scripts), and each freeze_pack has pack_meta.ref;
//   2. allowed_arm_difference.files is non-empty;
//   3. arm check: the row's campaign_script (default run-g67-campaign.js) --check-arms with this row's prereg/arms (ONOFF_PACKS_DIR=<root>/packs) is ok;
//   4. write each arm manifest sha256 into the prereg, THEN digest freeze_files (so the stamped prereg is what gets digested);
//      --check re-derives every sha256 that is present. An extra manifest with no sha256 yet (a legacy row) is left unchecked.
//   5. FROZEN.json[<row>] = {frozen_at, stamped:true, packs, files}.
// Dir-arms mode (a prereg with arms_dir and no arm_manifests, e.g. findings-batch): steps 1 and 4's manifest digests are skipped; the arm files
// are covered by freeze_files, which must include the arms dir. Step 3 runs the campaign_script's --check-arms.
// closure_roots (optional): when present, every file closure-scan.js reaches from them (plus campaign_script) must be covered by freeze_files, else exit 2.
// Order matters: stamp LAST. Any later edit to a digested file voids the row. --check re-derives everything and writes nothing.
// Exit: 0 stamped/ok . 2 usage, unfrozen packs, empty allowed list, failed arm check, or (--check) a digest mismatch
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const row = opt('--row');
const root = path.resolve(opt('--root') || __dirname);
const check = argv.includes('--check');
const die = (m) => { console.error(`stamp-prereg: ${m}`); process.exit(2); };
if (!row || !/^[a-z0-9][a-z0-9._-]*$/.test(row)) die('usage: stamp-prereg.js --row <row> [--root <dir>] [--check]');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');

const preregRel = `prereg/${row}.json`;
const prereg = readJson(preregRel);
const manifest = readJson('packs/manifest.json');
// Dir-arms mode (findings-batch): the prereg has no arm_manifests; its arms are the files under prereg.arms_dir, which freeze_files must cover.
const dirArms = !prereg.arm_manifests && typeof prereg.arms_dir === 'string';
const armFile = (a) => prereg.arm_manifests[prereg.arms[a]].file;

function expand(entry) { // a file, or a directory walked recursively (symlinks followed); returns root-relative paths
  const abs = path.join(root, entry);
  if (!fs.existsSync(abs)) die(`freeze_files entry does not exist: ${entry}`);
  if (!fs.statSync(abs).isDirectory()) return [entry];
  const out = [];
  for (const name of fs.readdirSync(abs).sort()) out.push(...expand(path.posix.join(entry, name)));
  return out;
}
const freezeFiles = () => [...new Set((prereg.freeze_files || []).flatMap(expand))].sort();

const missing = [];
for (const [name, spec] of Object.entries(prereg.arm_manifests || {})) {
  if (!spec || typeof spec.file !== 'string') die(`arm_manifests.${name} has no file`);
  const m = readJson(spec.file);
  for (const id of [...Object.values(m.skills || {}), ...[].concat(m.files || []), ...(m.fixture_scripts || [])]) if (!(manifest.packs || {})[id]) missing.push(`${name}:${id}`);
}
if (missing.length) die(`packs not frozen yet (run the post_merge_steps first): ${missing.join(', ')}`);
if (dirArms && !(prereg.freeze_files || []).some((e) => path.posix.normalize(e) === path.posix.relative('evals/skill-onoff', prereg.arms_dir))) die(`dir-arms mode: freeze_files must include the arms dir (${path.posix.relative('evals/skill-onoff', prereg.arms_dir)})`);
if (!Array.isArray((prereg.allowed_arm_difference || {}).files) || prereg.allowed_arm_difference.files.length === 0) die('allowed_arm_difference.files is empty (fill it from the text change first)');
const packMeta = (id) => {
  const meta = (manifest.pack_meta || {})[id];
  if (!manifest.packs[id] || !meta || !meta.ref) die(`packs/manifest.json has no pack_meta.${id}.ref (freeze it with freeze-pack.js)`);
  return { ...meta, files: Object.keys(manifest.packs[id]).length, digest_sha256: crypto.createHash('sha256').update(JSON.stringify(manifest.packs[id])).digest('hex') };
};
// Closure gate: a prereg with closure_roots must freeze every file its dependency closure (closure-scan.js) reaches inside the root.
if (Array.isArray(prereg.closure_roots)) {
  const entries = (prereg.freeze_files || []).map((e) => path.posix.normalize(e));
  const uncovered = require('./closure-scan').closure(root, [...prereg.closure_roots, ...(prereg.campaign_script ? [prereg.campaign_script] : [])]).files
    .filter((f) => !entries.some((e) => f === e || f.startsWith(`${e}/`)));
  if (uncovered.length) die(`freeze_files misses files the evaluation reads (dependency closure): ${uncovered.join(', ')}`);
}
const packs = Object.fromEntries((prereg.freeze_packs || []).map((id) => [id, packMeta(id)]));

const frozenPath = path.join(root, 'prereg/FROZEN.json');
if (check) {
  const bad = [];
  for (const [name, spec] of Object.entries(prereg.arm_manifests || {})) {
    const primary = name === prereg.arms.off || name === prereg.arms.on;
    if (!primary && (typeof spec.sha256 !== 'string' || spec.sha256 === '')) continue;
    if (spec.sha256 !== sha(spec.file)) bad.push(`arm ${name} sha256`);
  }
  const rec = readJson('prereg/FROZEN.json')[row];
  if (!rec || !rec.stamped) bad.push('FROZEN.json row not stamped');
  else {
    for (const f of freezeFiles()) if (rec.files[f] !== sha(f)) bad.push(f);
    for (const f of Object.keys(rec.files)) if (!fs.existsSync(path.join(root, f))) bad.push(`${f} (gone)`);
    for (const [id, p] of Object.entries(packs)) if (!rec.packs || !rec.packs[id] || rec.packs[id].digest_sha256 !== p.digest_sha256) bad.push(`pack ${id}`);
  }
  if (bad.length) die(`digest mismatch: ${bad.join(', ')}`);
  console.log(JSON.stringify({ ok: true, row }));
  process.exit(0);
}

const armsDir = dirArms ? path.join(root, path.posix.relative('evals/skill-onoff', prereg.arms_dir)) : path.join(root, path.dirname(armFile('off')));
const campaignScript = prereg.campaign_script || 'run-g67-campaign.js';
if (!/^[a-z0-9][a-z0-9._-]*\.js$/.test(campaignScript)) die(`campaign_script is not a local script name: ${campaignScript}`);
const chk = cp.spawnSync('node', [path.join(__dirname, campaignScript), '--check-arms', '--prereg', path.join(root, preregRel), '--arms-dir', armsDir], { encoding: 'utf8', env: { ...process.env, ONOFF_PACKS_DIR: path.join(root, 'packs') } });
if (chk.status !== 0) die(`arm check failed: ${(chk.stdout || '').trim()} ${(chk.stderr || '').trim()}`);

const armSha = {};
for (const [name, spec] of Object.entries(prereg.arm_manifests || {})) {
  armSha[name] = sha(spec.file);
  spec.sha256 = armSha[name];
}
fs.writeFileSync(path.join(root, preregRel), `${JSON.stringify(prereg, null, 2)}\n`);
const frozen = fs.existsSync(frozenPath) ? readJson('prereg/FROZEN.json') : {};
const files = {};
for (const f of freezeFiles()) files[f] = sha(f);
frozen[row] = {
  frozen_at: new Date().toISOString().slice(0, 10),
  stamped: true,
  note: `sha256 of the ${row} pre-registration (rule, markers, scorer, briefs, arm manifests, shared harness files) frozen before any live cell. Any edit after the first live cell voids the row.`,
  packs,
  files,
};
fs.writeFileSync(frozenPath, `${JSON.stringify(frozen, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, row, arm_sha256: armSha, files: Object.keys(files).length }));
