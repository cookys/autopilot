#!/usr/bin/env node
// run-g8-campaign.js — one command for the stage-graph-g8 eval (prereg/stage-graph-g8.{md,json}).
//
// A thin front for run-g67-campaign.js, which is generic in everything the prereg names (tasks, prefix, check-skill,
// timeout, arms, thresholds, runner pin, plugin_required_scripts, allowed_arm_difference) and scores with score-g67.js
// (also prereg-driven). Those g67 files are digest-frozen because stage-graph-g67 has live results, so g8 reuses them
// instead of forking them. What this front adds:
//   - defaults --prereg prereg/stage-graph-g8.json and --arms-dir arms/g8 (either can still be overridden, e.g. by tests);
//   - refuses an EMPTY allowed_arm_difference.files for --check-arms and for any non-dry run: the generic checker would pass
//     an off/on pair that differs in nothing (a vacuous ON arm), and for g8 the list is filled in only after the text
//     branch lands (prereg/stage-graph-g8.json TO_FILL).
// Everything else (flags, exit codes 0 SHIP . 3 NOT-SHIP . 4 STOP . 5 INSTRUMENT-INVALID . 2 usage) is run-g67-campaign.js's.
// Cell artifacts land in <results dir>/g67-cells/<task>/<arm>/<rep>/ (the generic runner's fixed name; gitignored; the g8
// extraction is g8-extracted.json next to the transcript).
//
//   PATH="<runner_pin_path>:$PATH" node evals/skill-onoff/run-g8-campaign.js --results evals/skill-onoff/results/stage-graph-g8.v1.jsonl
//   run-g8-campaign.js --results <f> --dry-run        # cells, pin, cost; needs no packs
//   run-g8-campaign.js --check-arms                   # off/on differ only in the registered files
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m) => { console.error(`run-g8-campaign: ${m}`); process.exit(2); };

const preregPath = val('--prereg') || path.join(HERE, 'prereg', 'stage-graph-g8.json');
const args = [...argv];
if (val('--prereg') === undefined) args.push('--prereg', preregPath);
if (val('--arms-dir') === undefined) args.push('--arms-dir', path.join(HERE, 'arms', 'g8'));

const dry = argv.includes('--dry-run');
if (!dry) {
  let P;
  try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`unreadable prereg ${preregPath}: ${e.message}`); }
  const files = (P.allowed_arm_difference || {}).files;
  if (!Array.isArray(files) || files.length === 0) {
    die('allowed_arm_difference.files is empty: fill it with the files the G8 text change touches (prereg/stage-graph-g8.json TO_FILL) before --check-arms or a live run');
  }
}
const r = cp.spawnSync('node', [path.join(HERE, 'run-g67-campaign.js'), ...args], { stdio: 'inherit' });
process.exit(r.status === null ? 2 : r.status);
