#!/usr/bin/env node
'use strict';

// topology-prune.js — remove retired runners from the host topology file.
//
//   node scripts/topology-prune.js --check   print `topology_retired: clean|<n> leftovers (<specs>)`;
//                                            exit 1 when leftovers exist
//   node scripts/topology-prune.js --fix     prune, after writing <file>.bak.<epoch> and reading it
//                                            back identical; prints one audit line with the restore
//                                            command; idempotent (clean file -> no write, no backup)
//   node scripts/topology-prune.js --lint [--runner-binary <file>]
//                                            exit 1 when a runner in scripts/lib/retired-runners.json
//                                            is still a key of the known-runner map (runner-binary.js):
//                                            retiring a runner and its registry entry ship together
//
// The file is the one resolve-review-loop.sh reads: $AUTOPILOT_TOPOLOGY_FILE or
// ~/.autopilot/topology.json. A missing file is clean. Unparseable JSON exits 2 and is never touched.
// Removed: every rung (see lib/topology-runners.js RUNG_LISTS) whose runner is in the registry, and every
// registry key in the runners_installed map. Runners that are merely unknown are left alone.
// Node built-ins only.

const fs = require('fs');
const path = require('path');
const { retiredRunners, topologyPath, specOf, RUNG_LISTS } = require('./lib/topology-runners');

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function leftovers(doc, retired) {
  const rungs = [];
  for (const list of RUNG_LISTS) {
    if (!Array.isArray(doc[list])) continue;
    for (const r of doc[list]) {
      if (r && typeof r.runner === 'string' && has(retired, r.runner)) rungs.push({ list, spec: specOf(r) });
    }
  }
  const keys = [];
  const map = doc.runners_installed;
  if (map && typeof map === 'object') {
    for (const k of Object.keys(map)) if (has(retired, k)) keys.push(k);
  }
  return { rungs, keys };
}

function prune(doc, retired) {
  const out = { ...doc };
  for (const list of RUNG_LISTS) {
    if (Array.isArray(doc[list])) out[list] = doc[list].filter((r) => !(r && has(retired, r.runner)));
  }
  if (doc.runners_installed && typeof doc.runners_installed === 'object') {
    out.runners_installed = Object.fromEntries(Object.entries(doc.runners_installed).filter(([k]) => !has(retired, k)));
  }
  return out;
}

function lint(args) {
  const i = args.indexOf('--runner-binary');
  const file = i >= 0 ? path.resolve(args[i + 1]) : path.join(__dirname, 'lib', 'runner-binary.js');
  const known = Object.keys(require(file).RUNNER_VERSION_BINARY);
  const bad = Object.keys(retiredRunners()).filter((r) => known.includes(r));
  if (bad.length) {
    console.log(`retired_runners_lint: FAIL ${bad.join(', ')} still in the known-runner map (${file}); remove it there, or drop its scripts/lib/retired-runners.json entry`);
    return 1;
  }
  console.log('retired_runners_lint: ok');
  return 0;
}

function main(args) {
  if (args.includes('--lint')) return lint(args);
  const mode = args.includes('--fix') ? 'fix' : args.includes('--check') ? 'check' : '';
  if (!mode) {
    process.stderr.write('usage: topology-prune.js --check | --fix | --lint [--runner-binary <file>]\n');
    return 2;
  }
  const file = topologyPath();
  if (!fs.existsSync(file)) {
    console.log('topology_retired: clean (no topology file)');
    return 0;
  }
  const raw = fs.readFileSync(file, 'utf8');
  let doc;
  try { doc = JSON.parse(raw); } catch {
    console.log(`topology_retired: unreadable (${file} is not JSON); not touched`);
    return 2;
  }
  const retired = retiredRunners();
  const found = leftovers(doc, retired);
  const n = found.rungs.length + found.keys.length;
  if (n === 0) {
    console.log('topology_retired: clean');
    return 0;
  }
  const names = [...found.rungs.map((r) => r.spec), ...found.keys.map((k) => `runners_installed.${k}`)].join(', ');
  if (mode === 'check') {
    console.log(`topology_retired: ${n} leftovers (${names})`);
    return 1;
  }
  const bak = `${file}.bak.${Math.floor(Date.now() / 1000)}`;
  fs.writeFileSync(bak, raw, 'utf8');
  if (fs.readFileSync(bak, 'utf8') !== raw) {
    process.stderr.write(`topology-prune: backup ${bak} does not read back identical; ${file} not touched\n`);
    return 3;
  }
  const indent = /^\{\n( +)"/.exec(raw);
  fs.writeFileSync(file, JSON.stringify(prune(doc, retired), null, indent ? indent[1].length : 2) + (raw.endsWith('\n') ? '\n' : ''), 'utf8');
  console.log(`topology_retired: pruned ${n} leftovers (${names}); backup ${bak}; restore: cp ${bak} ${file}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
