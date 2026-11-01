#!/usr/bin/env node
'use strict';
// layout-bootstrap-sets.js - test helper: every list, allowlist, deny list and prefix set that a consumer builds from the
// layout registry must, at stage bootstrap, be the SAME set the literal it replaced held (the literals as of d9edb0258).
//
//   REPO_LAYOUT_REGISTRY=<bootstrap registry> node hooks/tests/lib/layout-bootstrap-sets.js <repo-root> [component ...]
//
// Prints one line per mismatch and exits 1 when there is any. Components: gate exclude backlog denied packet stage stall
// scaffold migrate. The old literals are built from the constant D on purpose: a relayout rewrite of this repo's own docs/
// names must not reach them (they are the OLD names by definition).
const path = require('path');
const D = 'docs';
const J = (...p) => p.join('/');

const root = path.resolve(process.argv[2] || '.');
const only = process.argv.slice(3);
const want = (c) => only.length === 0 || only.includes(c);
const bad = [];
const same = (name, got, expected) => {
  const a = JSON.stringify(got); const b = JSON.stringify(expected);
  if (a !== b) bad.push(`${name}: got ${a} expected ${b}`);
};
const req = (rel) => require(path.join(root, rel));

if (want('gate')) {
  const gate = req('hooks/orchestrator-edit-gate-lib.js');
  same('orchestrator-edit-gate ALLOWLIST_PREFIXES', gate.ALLOWLIST_PREFIXES, [J(D, 'projects/'), J(D, 'plans/'), '.claude/', '.autopilot/']);
  same('orchestrator-edit-gate isAllowlisted backlog notes', gate.isAllowlisted(J(D, 'backlog', 'x.md')), false);
  same('orchestrator-edit-gate isAllowlisted projects', gate.isAllowlisted(J(D, 'projects', 'p', 'a.md')), true);
}
if (want('exclude')) {
  same('exclude-allowlist EXCLUDE_ALLOWLIST', req('scripts/lib/exclude-allowlist.js').EXCLUDE_ALLOWLIST, [
    'platforms/**', 'profiles/*.json', J(D, 'projects', '**'), J(D, 'plans', 'evidence', '**'), J(D, 'BACKLOG.md'),
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Gemfile.lock', 'Cargo.lock', 'composer.lock', 'poetry.lock', 'flake.lock',
    '*.lock', '**/*.lock', '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', 'lockfiles', 'generated/**',
  ]);
}
if (want('backlog')) {
  same('check-backlog-entries pointer_roots', req('scripts/check-backlog-entries.js').builtinConfig().pointer_roots,
    [J(D, 'plans/'), J(D, 'projects/'), J(D, 'backlog/')]);
}
if (want('denied')) {
  same('plan-review-context DENIED_DIRS', req('scripts/lib/plan-review-context.js').deniedDirsFor(null).source,
    `(^|\\/)(${D}\\/plans\\/(.*\\/)?evidence|${D}\\/backlog|${D}\\/BACKLOG\\.md|\\.git|\\.claude|node_modules|review-output)(\\/|$)`);
}
if (want('packet')) {
  same('review-packet DEFAULT_PACKET_DENY_LIST', req('src/runners/review-packet.js').DEFAULT_PACKET_DENY_LIST, [
    '.autopilot/**', '.qc/**', J(D, 'plans', 'evidence', '**'), J(D, 'plans', '**', '*.review.md'), J(D, 'plans', '**', '*.review.json'),
    J(D, 'plans', '**', '*disposition*.json'), '**/*.receipt.json', '**/*.raw.log',
  ]);
}
if (want('stage')) {
  const s = req('scripts/check-stage-vocab.js'); s.configureLayout(null);
  const sets = s.layoutSets();
  same('check-stage-vocab EXCLUDE_PREFIXES', sets.EXCLUDE_PREFIXES, ['CHANGELOG.md', J(D, 'plans/'), J(D, 'projects', '_archive/'),
    'evals/skill-onoff/packs/', '.claude/worktrees/', 'node_modules/', '.git/']);
  same('check-stage-vocab HISTORY_EXCLUDES[0]', sets.HISTORY_EXCLUDES[0], J(D, 'projects/'));
  same('check-stage-vocab HISTORY_EXCLUDES length', sets.HISTORY_EXCLUDES.length, 13);
  same('check-stage-vocab U4_EXCLUDE_PATHS', sets.U4_EXCLUDE_PATHS, [J(D, 'BACKLOG.md'), 'hooks/tests/mission-convergence.test.sh']);
}
if (want('stall')) {
  const pats = req('scripts/check-stall-fuse.js').processPatterns(null);
  const old = [/^docs\/plans\//u, /^docs\/projects\//u, /^docs\/backlog\//u, /^docs\/BACKLOG\.md$/u, /^docs\/adr\//u]
    .map((re) => new RegExp(re.source.replace(/docs/g, D), 'u'));
  const probes = ['plans/a.md', 'plans/evidence/e.json', 'projects/p/R.md', 'backlog/n.md', 'BACKLOG.md', 'adr/a.md', 'settings-reference.md', 'guide/x.md']
    .map((p) => J(D, p)).concat(['src/a.js', 'project/plans/a.md']);
  for (const p of probes) same(`check-stall-fuse process path ${p}`, pats.some((re) => re.test(p)), old.some((re) => re.test(p)));
}
if (want('scaffold')) {
  same('scaffold-config DEFAULT_PATHS', req('scripts/scaffold-config.js').DEFAULT_PATHS, {
    projects_dir: J(D, 'projects/'), plans_dir: J(D, 'plans/'), backlog: J(D, 'BACKLOG.md'), index: J(D, 'projects', 'INDEX.md'), archive_dir: J(D, 'projects', '_archive/'),
  });
}
if (want('migrate')) {
  same('migrate-backlog-entries CONSUMER_BACKLOG', req('scripts/migrate-backlog-entries.js').CONSUMER_BACKLOG, J(D, 'BACKLOG.md'));
}

if (bad.length) { for (const b of bad) console.log(`MISMATCH ${b}`); process.exit(1); }
console.log('all sets equal');
