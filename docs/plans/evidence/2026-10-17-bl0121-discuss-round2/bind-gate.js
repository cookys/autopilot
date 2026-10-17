#!/usr/bin/env node
'use strict';
// bind-gate.js — builds the files scripts/check-guidance-eval.js needs to judge this campaign's change
// (see README "Merge gate binding"): packs/<id>/<rel> + packs/manifest.json, arm/change.json,
// gate-prereg.json, and results.jsonl (one change-arm row carrying arm_manifest_sha256). Run AFTER the
// full run, from the repo state that is to ship:   node bind-gate.js --cells cells
// gate-scorer.js is the `--scorer` adapter: it RE-DERIVES the verdict by running `harness.js score
// --phase main` on the recorded cells; it does not read a verdict from the results file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const argv = process.argv.slice(2);
const cells = argv.includes('--cells') ? argv[argv.indexOf('--cells') + 1] : 'cells';
const FILES = ['skills/think-tank/SKILL.md', 'references/consult-discuss-seats.md'];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SKILL_PACK = 'think-tank-bl0121-change';
const FILES_PACK = 'guidance-files-bl0121-change';
const manifest = { packs: { [SKILL_PACK]: {}, [FILES_PACK]: {} } };
for (const f of FILES) {
  const bytes = fs.readFileSync(path.join(REPO, f));
  const m = f.match(/^skills\/([^/]+)\/(.+)$/);
  const id = m ? SKILL_PACK : FILES_PACK;
  const rel = m ? m[2] : f;
  const dest = path.join(HERE, 'packs', id, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  manifest.packs[id][`${id}/${rel}`] = sha(bytes);
}
fs.writeFileSync(path.join(HERE, 'packs', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.mkdirSync(path.join(HERE, 'arm'), { recursive: true });
const arm = { schema_version: 1, arm: 'change', skills: { 'think-tank': SKILL_PACK }, files: FILES_PACK };
fs.writeFileSync(path.join(HERE, 'arm', 'change.json'), `${JSON.stringify(arm, null, 2)}\n`);
fs.writeFileSync(path.join(HERE, 'gate-prereg.json'), `${JSON.stringify({ guidance: { files: FILES } }, null, 2)}\n`);
const armSha = sha(fs.readFileSync(path.join(HERE, 'arm', 'change.json')));
fs.writeFileSync(path.join(HERE, 'results.jsonl'), `${JSON.stringify({ arm: 'change', campaign: 'bl0121-discuss-round2', cells, arm_manifest_sha256: armSha })}\n`);
process.stdout.write(`${JSON.stringify({ packs: Object.keys(manifest.packs), arm_manifest_sha256: armSha, cells })}\n`);
