#!/usr/bin/env node
'use strict';
// miss-check-wide.js — round 3 of the affected-suites miss check (BL-0001 phase 2 step 1, 2026-10-16).
// Usage: node miss-check-wide.js [--n 60] [--head HEAD] [--root <repo>]    env: AFFECTED_SUITES_BIN (selector under test)
// For the last N non-merge commits that touched code (anything outside docs/ and root *.md), run the selector on
// C^..C and apply two oracles that do NOT use the selector's text graph:
//   convention: for each changed non-test source file F, a suite named after F that exists at HEAD
//     (scripts/F.test.js, scripts/lib/F.test.js, hooks/F.test.js, hooks/tests/F.test.sh, scripts/F.test.sh,
//      with an optional `test-`/`check-` stem tolerance) must be selected, or the result must be mode full.
//   rule: a commit touching mods/live/ must list mods/live/run-tests.sh in extra_runners; a commit touching
//     hooks/hooks.json or .claude-plugin/ must be mode full.
// A "miss" is any violated expectation. Prints one JSON line per commit and a summary; exit 1 if any miss.
const { execFileSync } = require('child_process');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('--root', path.join(__dirname, '../../../..')));
const head = arg('--head', 'HEAD');
const N = Number(arg('--n', '60'));
const SEL = process.env.AFFECTED_SUITES_BIN || path.join(root, 'scripts/affected-suites.js');
const git = (...a) => execFileSync('git', a, { cwd: root, maxBuffer: 1 << 28 }).toString();
const headFiles = new Set(git('ls-tree', '-r', '--name-only', head).split('\n'));
const isTest = (p) => /\.test\.(js|sh|ts)$/.test(p);
const isProse = (p) => /^docs\//.test(p) || /^[^/]+\.(md|txt)$/.test(p);

function conventionSuites(f) {
  if (isTest(f) || !/\.(js|mjs|sh|bash|py)$/.test(f)) return [];
  const stem = path.basename(f).replace(/\.[^.]+$/, '');
  const out = [];
  for (const c of [stem, stem.replace(/^(check|test)-/, '')]) {
    for (const cand of [`scripts/${c}.test.js`, `scripts/lib/${c}.test.js`, `hooks/${c}.test.js`, `hooks/tests/${c}.test.sh`, `scripts/${c}.test.sh`]) {
      if (headFiles.has(cand)) out.push(cand);
    }
  }
  return [...new Set(out)];
}

const commits = git('log', '--no-merges', '--format=%H', '-n', '1500', head).split('\n').filter(Boolean);
const rows = []; let misses = 0;
for (const c of commits) {
  if (rows.length >= N) break;
  const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--no-renames', c).split('\n').filter(Boolean);
  if (!files.some((f) => !isProse(f))) continue;
  const out = JSON.parse(execFileSync('node', [SEL, '--root', root, '--base', `${c}^`, '--head', c, '--json'], { cwd: root, maxBuffer: 1 << 28 }).toString());
  const selected = new Set([...out.suites, ...out.always_run]);
  const why = [];
  if (out.mode !== 'full') {
    for (const f of files) for (const s of conventionSuites(f)) if (!selected.has(s)) why.push(`convention: ${f} -> ${s} not selected`);
  }
  if (files.some((f) => /^mods\/live\//.test(f)) && !(out.extra_runners || []).includes('mods/live/run-tests.sh')) why.push('rule: mods/live change without mods/live/run-tests.sh');
  if (files.some((f) => f === 'hooks/hooks.json' || /^\.claude-plugin\//.test(f)) && out.mode !== 'full') why.push('rule: hooks.json/.claude-plugin change not full');
  if (why.length) misses++;
  rows.push({ commit: c.slice(0, 8), mode: out.mode, selected: out.suites.length, live: files.some((f) => /^mods\/live\//.test(f)), miss: why });
}
for (const r of rows) console.log(JSON.stringify(r));
const full = rows.filter((r) => r.mode === 'full').length;
console.log(JSON.stringify({ summary: true, commits: rows.length, full, selective: rows.length - full, mods_live_commits: rows.filter((r) => r.live).length, misses }));
process.exitCode = misses ? 1 : 0;
