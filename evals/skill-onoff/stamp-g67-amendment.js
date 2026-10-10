#!/usr/bin/env node
// stamp-g67-amendment.js — the post-merge step of stage-graph-g67 amendment 1 (prereg/stage-graph-g67.amend-1-plugin-scripts.json).
// Run AFTER fixture-scripts-g67-v2 and the *-sg-change-v8 packs are frozen (steps in prereg/stage-graph-g67.json
// fixture_scripts_freeze.post_merge_steps). It
//   1. refuses unless every pack the two arm manifests name exists in packs/manifest.json,
//   2. writes sha256(arms/g67/off.json|on.json) into prereg/stage-graph-g67.json arm_manifests.*.sha256,
//   3. records the amendment in prereg/FROZEN.json stage-graph-g67.amendments.amend-1-plugin-scripts (digests of every
//      file the amendment touched; the row's original "files" stay as the v1 as-run record).
// Order matters: stamp LAST. Any later edit to a digested file voids the amendment.
// Usage: stamp-g67-amendment.js [--root <evals/skill-onoff dir>] [--check]    (--check: verify only, write nothing)
// Exit: 0 stamped/ok · 2 usage, missing packs, or (--check) digest mismatch
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const root = path.resolve(opt('--root') || __dirname);
const check = argv.includes('--check');
const die = (m) => { console.error(`stamp-g67-amendment: ${m}`); process.exit(2); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

const AMEND = 'amend-1-plugin-scripts';
const TOUCHED = [
  'arms/g67/off.json', 'arms/g67/on.json',
  'prereg/stage-graph-g67.json', 'prereg/stage-graph-g67.md', 'prereg/stage-graph-g67.amend-1-plugin-scripts.json',
  'run-g67-campaign.js', 'run-skill-onoff-eval.sh', 'stamp-g67-amendment.js',
  'packs/manifest.json', 'README.md', '../../hooks/tests/skill-onoff-g67.test.sh',
];

const manifest = readJson('packs/manifest.json');
const missing = [];
for (const a of ['off', 'on']) {
  const m = readJson(`arms/g67/${a}.json`);
  for (const id of [...Object.values(m.skills), ...[].concat(m.files || []), ...(m.fixture_scripts || [])]) if (!(manifest.packs || {})[id]) missing.push(`${a}:${id}`);
}
if (missing.length) die(`packs not frozen yet (run the post_merge_steps first): ${missing.join(', ')}`);

// provenance of a pack the amendment introduced: freeze-pack writes manifest.packs[id] (file digests, the key the existence
// check above uses) and manifest.pack_meta[id] (source ref); both must be there or the stamp refuses
function packMeta(id) {
  const meta = (manifest.pack_meta || {})[id];
  if (!meta || !meta.ref) die(`packs/manifest.json has no pack_meta.${id}.ref (freeze it with freeze-pack.js)`);
  return { ...meta, files: Object.keys(manifest.packs[id]).length, digest_sha256: crypto.createHash('sha256').update(JSON.stringify(manifest.packs[id])).digest('hex') };
}
const preregPath = path.join(root, 'prereg/stage-graph-g67.json');
const prereg = readJson('prereg/stage-graph-g67.json');
const armSha = { off: sha('arms/g67/off.json'), on: sha('arms/g67/on.json') };
if (check) {
  const bad = [];
  for (const a of ['off', 'on']) if (prereg.arm_manifests[a].sha256 !== armSha[a]) bad.push(`arm ${a} sha256`);
  const fz = readJson('prereg/FROZEN.json')['stage-graph-g67'];
  const rec = ((fz || {}).amendments || {})[AMEND];
  if (!rec || !rec.stamped) bad.push('FROZEN.json amendment not stamped');
  else {
    for (const f of TOUCHED) {
      // packs/manifest.json is shared by every skill-onoff row and only ever grows (a new row freezes new packs into it), so a
      // whole-file digest goes stale on the first unrelated row. For THIS amendment check what it owns instead: every pack
      // the g67 arms name is present, and fixture-scripts-g67-v2 (the one pack the amendment introduced) is byte-identical to
      // the digest recorded at stamp time.
      if (f === 'packs/manifest.json') {
        const owned = ((rec.packs || {})['fixture-scripts-g67-v2'] || {}).digest_sha256;
        const now = manifest.packs['fixture-scripts-g67-v2'] && crypto.createHash('sha256').update(JSON.stringify(manifest.packs['fixture-scripts-g67-v2'])).digest('hex');
        if (!owned || owned !== now) bad.push('packs/manifest.json (fixture-scripts-g67-v2 entry)');
        continue;
      }
      if (rec.files[f] !== sha(f)) bad.push(f);
    }
  }
  if (bad.length) die(`digest mismatch: ${bad.join(', ')}`);
  console.log(JSON.stringify({ ok: true, arm_sha256: armSha }));
  process.exit(0);
}
for (const a of ['off', 'on']) prereg.arm_manifests[a].sha256 = armSha[a];
fs.writeFileSync(preregPath, `${JSON.stringify(prereg, null, 2)}\n`);

const frozenPath = path.join(root, 'prereg/FROZEN.json');
const frozen = readJson('prereg/FROZEN.json');
const row = frozen['stage-graph-g67'];
if (!row) die('FROZEN.json has no stage-graph-g67 row');
row.amendments = row.amendments || {};
const files = {};
for (const f of TOUCHED) files[f] = sha(f);
row.amendments[AMEND] = {
  date: '2026-10-10',
  stamped: true,
  made_after_v1_results_seen: true,
  v1_status: 'INSTRUMENT-DEFECTIVE for G6 (precondition false: session-mode.js absent from the plugin); G7 v1 superseded by the v8 text. Never re-scored.',
  v2_results: 'results/stage-graph-g67.v2.jsonl',
  packs: Object.fromEntries(['fixture-scripts-g67-v2'].map((id) => [id, packMeta(id)])),
  files,
};
row.files_note = 'files = digests of the v1 as-run state (arms v7, fixture-scripts-g67); superseded by amendments.amend-1-plugin-scripts.files for every file listed there';
fs.writeFileSync(frozenPath, `${JSON.stringify(frozen, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, arm_sha256: armSha, amendment: AMEND, files: Object.keys(files).length }));
