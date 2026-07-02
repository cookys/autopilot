#!/usr/bin/env node
/**
 * check-readme-parity.js — keep README.md and README.zh-TW.md in lockstep.
 *
 * Guards the drift class swept on 2026-06-22, where the zh-TW translation silently
 * fell behind the English README: skills badge had drifted 20→16, hooks 20→14, the
 * version badge sat at 2.7.0 (vs 2.19.1), and three whole subsections were missing.
 *
 * Checks pure EN↔zh EQUALITY (orthogonal to check-hook-inventory.js, which asserts a
 * hook NUMBER matches real wiring — this only asserts the two READMEs agree with each
 * other):
 *   - every shields.io badge (version / skills / agents / hooks / dependencies /
 *     license …) has the same value in both files; flags missing-in-one too
 *   - the `##` + `###` section-header COUNT matches (catches a section added to one
 *     file only — the Install/Hooks/Inspired-By gaps that the sweep had to backfill)
 *
 * Does NOT diff prose (translations legitimately differ word-for-word). Period-accurate
 * historical numbers inside prose (e.g. "v2.5 added 14 hooks") are out of scope by design.
 *
 * Exit: 0 parity / 1 drift / 2 usage|missing file. Wired into preflight-portability.sh.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const EN = path.join(REPO, 'README.md');
const ZH = path.join(REPO, 'README.zh-TW.md');

if (process.argv[2] === '--help' || process.argv[2] === '-h') {
  console.log('Usage: node scripts/check-readme-parity.js');
  console.log('  Assert README.md and README.zh-TW.md agree on badge values + section count.');
  console.log('  Exit 0 = parity, 1 = drift, 2 = usage/missing file.');
  process.exit(0);
}

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); }
  catch (e) { console.error(`error: cannot read ${path.relative(REPO, p)}: ${e.message}`); process.exit(2); }
}

// shields.io badge URLs look like `.../badge/<name>-<value>-<color>`. Capture name→value.
function badges(text) {
  const map = new Map();
  const re = /badge\/([A-Za-z0-9]+)-([^-"?\s]+)-/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!map.has(m[1])) map.set(m[1], m[2]); // first occurrence wins (the header badge row)
  }
  return map;
}

function sectionCount(text) {
  return text.split('\n').filter((l) => /^#{2,3} /.test(l)).length;
}

const enText = read(EN);
const zhText = read(ZH);
const enB = badges(enText);
const zhB = badges(zhText);

const errors = [];
for (const name of new Set([...enB.keys(), ...zhB.keys()])) {
  const en = enB.get(name);
  const zh = zhB.get(name);
  if (en === undefined) errors.push(`badge "${name}": present in zh-TW (${zh}) but missing in README.md`);
  else if (zh === undefined) errors.push(`badge "${name}": present in README.md (${en}) but missing in zh-TW`);
  else if (en !== zh) errors.push(`badge "${name}": README.md=${en} vs zh-TW=${zh} (mismatch)`);
}

const enSec = sectionCount(enText);
const zhSec = sectionCount(zhText);
if (enSec !== zhSec) {
  errors.push(`section count: README.md=${enSec} vs zh-TW=${zhSec} (## / ### header exists in one file only)`);
}

if (errors.length) {
  console.error('README parity drift:\n');
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\n  → align README.zh-TW.md to README.md (badges + sections), then re-run.');
  console.error('    (period-accurate historical prose numbers are out of scope — badges + structure only)');
  process.exit(1);
}
console.log(`✓ README.md ↔ README.zh-TW.md in parity (${enB.size} badges + ${enSec} sections)`);
