#!/usr/bin/env node
// Test helper for the roster overlay (decision: tests that need other seats build a fixture roster
// instead of hand-writing one).
//
//   node roster-fixture.js build <patch-config.md> <out-roster.md>
//       out-roster = the REAL template with every key named in <patch-config.md> replaced by the
//       patch's value (keys the template lacks are appended). Patch comments are carried over.
//   node roster-fixture.js run <resolve-review-loop.sh> [args...]
//       Runs the real resolver. If REVIEW_LOOP_CONFIG_OVERRIDE names a LEGACY file (seat fields
//       outside an override block) it is split: the legacy file becomes a fixture roster
//       (REVIEW_LOOP_ROSTER_TEMPLATE) and the repo file handed to the resolver is an empty stub.
//       The stub path in the output is mapped back to the original path. When a test supplies its own repo
//       file through REVIEW_LOOP_CONFIG_OVERRIDE and no roster knob, the roster is the frozen pre-SSOT one
//       (fixtures/review-loop-roster.pre-ssot-2026-11-06.md: the old built-in seat defaults), so suites that
//       exercise resolver logic keep their seats; they are not about which models the real roster names.
//
// TEST-ONLY. Production never reads REVIEW_LOOP_ROSTER_TEMPLATE for anything but tests.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const LEGACY_ROSTER = path.join(REPO_ROOT, 'hooks', 'tests', 'fixtures', 'review-loop-roster.pre-ssot-2026-11-06.md');
const REAL_TEMPLATE = path.join(REPO_ROOT, 'project-config-template', 'review-loop-config.md');
const { parse, groupOf } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'roster-overlay.js'));

function buildRoster(templateText, patchText) {
  const patch = parse(patchText);
  const keys = new Set(patch.entries.map((e) => e.key));
  const kept = parse(templateText).entries.filter((e) => !keys.has(e.key)).map((e) => e.raw);
  return `${kept.join('\n')}\n${patchText}\n`;
}

function isLegacy(text) {
  const p = parse(text);
  if (p.decls.length) return false;
  return p.entries.some((e) => groupOf(e.key));
}

function run(argv) {
  const [resolver, ...args] = argv;
  const cfg = process.env.REVIEW_LOOP_CONFIG_OVERRIDE;
  const env = { ...process.env };
  let tmp = null;
  let stub = null;
  if (cfg && !env.REVIEW_LOOP_ROSTER_TEMPLATE) env.REVIEW_LOOP_ROSTER_TEMPLATE = LEGACY_ROSTER;
  if (cfg) {
    let text = null;
    try { text = fs.readFileSync(cfg, 'utf8'); } catch (e) { text = null; }
    if (text !== null && isLegacy(text)) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-fixture-'));
      const base = env.REVIEW_LOOP_ROSTER_TEMPLATE;
      const roster = path.join(tmp, 'roster.md');
      stub = path.join(tmp, 'repo-stub.md');
      fs.writeFileSync(roster, buildRoster(fs.readFileSync(base, 'utf8'), text));
      fs.writeFileSync(stub, '# stub: all seats come from the fixture roster\n');
      env.REVIEW_LOOP_ROSTER_TEMPLATE = roster;
      env.REVIEW_LOOP_CONFIG_OVERRIDE = stub;
    }
  }
  const r = spawnSync('bash', [resolver, ...args], { env, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 });
  const fix = (s) => (stub ? s.split(stub).join(cfg) : s);
  fs.writeSync(1, fix(r.stdout || ''));
  fs.writeSync(2, fix(r.stderr || ''));
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(r.status === null ? 1 : r.status);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'build') {
  fs.writeFileSync(rest[1], buildRoster(fs.readFileSync(REAL_TEMPLATE, 'utf8'), fs.readFileSync(rest[0], 'utf8')));
} else if (cmd === 'run') {
  run(rest);
} else {
  process.stderr.write('usage: roster-fixture.js build <patch> <out> | run <resolver> [args]\n');
  process.exit(2);
}
