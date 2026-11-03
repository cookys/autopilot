#!/usr/bin/env node
'use strict';
// scripts/lib/fixtures/gen-account-pick-g37-golden.js — produces account-pick-g37-golden.json (G40 D3, N87).
//
// The golden file records what the UNMODIFIED G37 code (account-pick.js, account-quota.js, claude-account.js)
// answers: `pick()` output strings (JSON.stringify, key order included) and the CLI results (exit code, stdout,
// stderr, audit records) of pick / status / run in fixed scenarios with no mirror. It is generated ONCE from the
// develop commit before D3 touched pick, and never regenerated: the parity tests replay the same inputs against
// the changed code and demand the same bytes.
//
//   node scripts/lib/fixtures/gen-account-pick-g37-golden.js [--out <file>]   write the golden; refuses unless the three
//        G37 files equal their blobs at PIN_COMMIT (git show), and fails closed when git cannot answer
//   node scripts/lib/fixtures/gen-account-pick-g37-golden.js --check          re-derive and diff against the file (the
//        status coverage line is dropped on both sides; the recorded G37 hashes and the pinned commit are compared too)
//
// This module also exports the scenario runner so the parity tests replay the identical scenarios. Tempdir only,
// FAKE- tokens, Node claude shim only. No real home, credential or network.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const NOW = 1_800_000_000_000;
const GOLDEN_FILE = path.join(__dirname, 'account-pick-g37-golden.json');
// The commit the golden is generated from. The golden is only ever written from files byte-equal to this commit's blobs.
const PIN_COMMIT = '254a851d39ef876ecfaa38edac5f27557b258b0d';
const G37_FILES = ['scripts/lib/account-pick.js', 'scripts/lib/account-quota.js', 'scripts/claude-account.js'];

// sha256 of each G37 file as committed at PIN_COMMIT, from `git show`. Throws when git cannot answer (fail closed).
function pinnedHashes(repoRoot) {
  const out = {};
  for (const f of G37_FILES) {
    const r = spawnSync('git', ['show', `${PIN_COMMIT}:${f}`], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0 || !Buffer.isBuffer(r.stdout) || r.stdout.length === 0) throw new Error(`git show ${PIN_COMMIT}:${f} failed`);
    out[f] = crypto.createHash('sha256').update(r.stdout).digest('hex');
  }
  return out;
}

// Returns null when every G37 file in the working tree equals its blob at PIN_COMMIT, else a reason string.
function pinProblem(repoRoot) {
  let pinned;
  try { pinned = pinnedHashes(repoRoot); } catch (e) { return String(e.message); }
  for (const f of G37_FILES) {
    let cur;
    try { cur = crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, f))).digest('hex'); } catch (_) { return `cannot read ${f}`; }
    if (cur !== pinned[f]) return `${f} differs from ${PIN_COMMIT}`;
  }
  return null;
}

const COVERAGE_LINE = /^observations newest_age: /;
// D5: once `run` has copied a statusline snapshot into the mirror, a later `status` line may carry the mirror fields.
const MIRROR_FIELDS = / mirror_class=\S+ mirror_age=\S+( observed_at=\S+)?/;
const stripCoverage = (out) => String(out).split('\n').filter((l) => !COVERAGE_LINE.test(l)).map((l) => l.replace(MIRROR_FIELDS, '')).join('\n');

// ---------------------------------------------------------------- pick() cases (the 10 account-pick.test.js groups + extras)

const S = (pct7, pct5, over) => Object.assign({
  schema: 'codeforge.quota/1', alias: 'x', root: null, written_at_ms: NOW - 1000,
  five_hour: pct5 === null ? null : { pct: pct5, resets_at: NOW / 1000 + 3600 },
  seven_day: pct7 === null ? null : { pct: pct7, resets_at: NOW / 1000 + 86400 },
}, over || {});
const snapFor = (alias, s) => Object.assign({}, s, { alias });
const A = (alias, priority) => ({ alias, priority });

function pickCases() {
  const c = [];
  const add = (name, input) => c.push({ name, input });
  add('ok-ascending', { accounts: [A('a', 1), A('b', 2), A('c', 3)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.95, 0.1)), b: snapFor('b', S(0.5, 0.5)), c: snapFor('c', S(0.2, 0.3)) } });
  add('unknown-after-ok', { accounts: [A('a', 1), A('b', 2), A('c', 3)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.95, 0.1)), c: snapFor('c', S(0.7, 0.1)) } });
  add('unknown-before-tight', { accounts: [A('a', 1), A('b', 2)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.95, 0.1)) } });
  add('unknown-by-priority', { accounts: [A('z', 5), A('y', 1), A('x', 5)], nowMs: NOW, snapshots: {} });
  add('tie-alias-order', { accounts: [A('b', 1), A('a', 1)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.3, 0.3)), b: snapFor('b', S(0.3, 0.3)) } });
  add('tie-priority-order', { accounts: [A('b', 1), A('a', 2)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.3, 0.3)), b: snapFor('b', S(0.3, 0.3)) } });
  add('stale-snapshot', { accounts: [A('a', 1)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.1, 0.1, { written_at_ms: NOW - 7 * 3600e3 })) } });
  add('expired-window', { accounts: [A('a', 1)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.2, 0.99, { five_hour: { pct: 0.99, resets_at: NOW / 1000 - 1 } })) } });
  add('root-mismatch', { accounts: [A('a', 1)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.1, 0.1, { root: 'deadbeef' })) }, roots: { a: 'cafef00d' } });
  add('exactly-090', { accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.9, 0.1)) } });
  add('below-090', { accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.8999, 0.1)) } });
  add('five-hour-090', { accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.1, 0.9)) } });
  add('all-tight-least', { accounts: [A('a', 1), A('b', 2)], nowMs: NOW, refuseAllTight: false,
    snapshots: { a: snapFor('a', S(0.97, 0.1)), b: snapFor('b', S(0.92, 0.1)) } });
  add('all-tight-refused', { accounts: [A('a', 1), A('b', 2)], nowMs: NOW, refuseAllTight: true,
    snapshots: { a: snapFor('a', S(0.95, 0.1)), b: snapFor('b', S(0.95, 0.1)) } });
  add('refuse-knob-nontight', { accounts: [A('a', 1)], nowMs: NOW, refuseAllTight: true, snapshots: { a: snapFor('a', S(0.1, 0.1)) } });
  add('unsupported-schema', { accounts: [A('a', 1)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.99, 0.99, { schema: 'codeforge.quota/9' })) } });
  add('exclude-and-cooldown', { accounts: [A('a', 1), A('b', 2)], nowMs: NOW, exclude: ['a'], cooldowns: { b: NOW + 1 } });
  add('empty-accounts', { accounts: [], nowMs: NOW });
  add('purity-plain', { accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.1, 0.1)) }, exclude: [] });
  add('cooldown-elapsed', { accounts: [A('a', 1), A('b', 2)], nowMs: NOW, cooldowns: { a: NOW }, snapshots: { b: snapFor('b', S(0.4, 0.4)) } });
  add('snapshot-null-entry', { accounts: [A('a', 1), A('b', 2)], nowMs: NOW, snapshots: { a: null, b: snapFor('b', S(0.4, 0.4)) } });
  add('mixed-seven-tight-five-ok', { accounts: [A('a', 1), A('b', 2)], nowMs: NOW,
    snapshots: { a: snapFor('a', S(0.91, 0.05)), b: snapFor('b', S(0.5, 0.95)) } });
  add('ok-used-only-seven', { accounts: [A('a', 1)], nowMs: NOW, snapshots: { a: snapFor('a', S(0.4, null)) } });
  add('missing-nowms', { accounts: [A('a', 1)], cooldowns: { a: NOW + 1 } });
  add('nan-nowms', { accounts: [A('a', 1)], nowMs: null });
  add('string-nowms', { accounts: [A('a', 1)], nowMs: '5' });
  return c;
}

// The exact bytes the parity tests compare: JSON.stringify of the result, or THROWS:<ErrorName>.
function runPick(pick, input) {
  try { return JSON.stringify(pick(input)); } catch (e) { return `THROWS:${e && e.name}`; }
}

// ---------------------------------------------------------------- CLI scenarios

const cliSnap = (alias, pct5, pct7, over) => Object.assign({
  schema: 'codeforge.quota/1', alias, root: null, written_at_ms: NOW - 1000,
  five_hour: pct5 === null ? null : { pct: pct5, resets_at: NOW / 1000 + 3600 },
  seven_day: pct7 === null ? null : { pct: pct7, resets_at: NOW / 1000 + 86400 },
}, over || {});

const PICK = ['pick'];
const STATUS = ['status'];
const RUN = ['run', '--purpose', 'tst', '--', 'claude', '-p', 'hi'];
const THREE = [PICK, ['pick', '--exclude', 'a'], STATUS];

function cliScenarios() {
  return [
    { name: 'no-snapshots', aliases: [{ alias: 'a' }, { alias: 'b' }], runs: THREE.concat([RUN]) },
    { name: 'mixed', aliases: [{ alias: 'a' }, { alias: 'b' }, { alias: 'c' }],
      snapshots: { a: cliSnap('a', 0.95, 0.1), b: cliSnap('b', 0.3, 0.2) }, runs: THREE.concat([RUN]) },
    { name: 'all-tight-refuse', aliases: [{ alias: 'a' }, { alias: 'b' }], config: { accounts: { refuse_all_tight: true } },
      snapshots: { a: cliSnap('a', 0.97, 0.1), b: cliSnap('b', 0.95, 0.1) }, runs: THREE.concat([RUN]) },
    { name: 'all-tight-allowed', aliases: [{ alias: 'a' }, { alias: 'b' }],
      snapshots: { a: cliSnap('a', 0.97, 0.1), b: cliSnap('b', 0.95, 0.1) }, runs: THREE.concat([RUN]) },
    { name: 'cooldown-a', aliases: [{ alias: 'a' }, { alias: 'b' }], cooldowns: { a: 3600e3 },
      snapshots: { b: cliSnap('b', 0.2, 0.2) }, runs: THREE.concat([RUN]) },
    { name: 'cooldown-all', aliases: [{ alias: 'a' }, { alias: 'b' }], cooldowns: { a: 3600e3, b: 1800e3 }, runs: THREE.concat([RUN]) },
    { name: 'unsupported-schema', aliases: [{ alias: 'a' }, { alias: 'b' }],
      snapshots: { a: cliSnap('a', 0.99, 0.99, { schema: 'codeforge.quota/9' }), b: cliSnap('b', 0.4, 0.1) }, runs: THREE },
    { name: 'stale-snapshot', aliases: [{ alias: 'a' }, { alias: 'b' }],
      snapshots: { a: cliSnap('a', 0.1, 0.1, { written_at_ms: NOW - 7 * 3600e3 }) }, runs: THREE },
    { name: 'root-mismatch', aliases: [{ alias: 'a' }],
      snapshots: { a: cliSnap('a', 0.1, 0.1, { root: 'deadbeef' }) }, runs: THREE },
    // D5: `run` is NOT last. It copies the statusline snapshot into the mirror first (adapter), then pick and status must still
    // answer as G37 does; the whole-second written_at_ms makes the mirror row a same-second copy (a tie goes to the snapshot).
    { name: 'run-first-whole-second-tight', aliases: [{ alias: 'a' }, { alias: 'b' }],
      snapshots: { a: cliSnap('a', 0.95, 0.1), b: cliSnap('b', 0.97, 0.1) }, runs: [RUN, PICK, ['pick', '--exclude', 'a'], STATUS] },
    { name: 'live-dir-relative', aliases: [{ alias: 'a' }], envOverride: { AUTOPILOT_LIVE_DIR: 'relative/live' }, runs: [PICK, STATUS, RUN] },
    // ctx.liveDir === null: resolveLiveDir refuses /etc, cli() answers live_dir_refused for every subcommand.
    { name: 'live-dir-null', aliases: [{ alias: 'a' }], envOverride: { AUTOPILOT_LIVE_DIR: '/etc' }, runs: [PICK, STATUS, RUN] },
  ];
}

// Variants of the mirror area of <live>/quota written BEFORE the run. G37 code never looks at it.
function writeMirrorVariant(fx, aliases, variant) {
  if (variant === 'none') return;
  const qdir = path.join(fx.liveDir, 'quota');
  const cdir = path.join(qdir, 'claude');
  fs.mkdirSync(cdir, { recursive: true, mode: 0o700 });
  if (variant === 'empty-dir') return;
  if (variant === 'corrupt') {
    for (const a of aliases) fs.writeFileSync(path.join(cdir, `${a.alias}.json`), '{"schema": "fleet.quota-view/1", "rows": [', { mode: 0o600 });
    fs.writeFileSync(path.join(qdir, 'namespace.json'), 'not json at all', { mode: 0o600 });
    return;
  }
  throw new Error(`unknown mirror variant ${variant}`);
}

// Replays one scenario under the given `cli` entry point. Returns normalised, JSON-serialisable results.
async function runCliScenario(spec, variant, deps) {
  const { cli } = deps.cli;
  const { makeFixture } = deps.shim;
  const cooldown = deps.cooldown;
  const fx = makeFixture({ aliases: spec.aliases, config: spec.config, snapshots: spec.snapshots });
  try {
    writeMirrorVariant(fx, spec.aliases, variant || 'none');
    for (const [al, ahead] of Object.entries(spec.cooldowns || {})) {
      cooldown.writeCooldown(al, NOW + ahead, { dir: fx.cooldownDir, nowMs: NOW });
    }
    const norm = (s) => s.split(fx.root).join('<ROOT>');
    const runs = [];
    for (const args of spec.runs) {
      let out = '';
      let err = '';
      const code = await cli(args, {
        env: Object.assign({}, fx.env, spec.envOverride || {}), realHome: fx.realHome, warn: () => {}, now: () => NOW,
        write: (fd, d) => { if (fd === 1) out += d.toString(); else err += d.toString(); },
      });
      runs.push({ args, code, out: norm(out), err: norm(err) });
    }
    const audit = fs.existsSync(fx.auditFile) ? norm(fs.readFileSync(fx.auditFile, 'utf8')) : null;
    return { runs, audit };
  } finally { fx.cleanup(); }
}

function loadDeps() {
  const root = path.resolve(__dirname, '..', '..', '..');
  return {
    cli: require(path.join(root, 'scripts', 'claude-account.js')),
    shim: require(path.join(root, 'scripts', 'lib', 'account-fixtures', 'shim-install.js')),
    cooldown: require(path.join(root, 'scripts', 'lib', 'account-cooldown.js')),
    pick: require(path.join(root, 'scripts', 'lib', 'account-pick.js')).pick,
  };
}

async function buildGolden() {
  const deps = loadDeps();
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const files = pinnedHashes(repoRoot);
  const head = PIN_COMMIT;
  const picks = pickCases().map((c) => ({ name: c.name, input: c.input, output: runPick(deps.pick, c.input) }));
  const cliOut = [];
  for (const spec of cliScenarios()) cliOut.push({ spec, result: await runCliScenario(spec, 'none', deps) });
  return { schema: 'autopilot.g37-golden/1', generated_from_commit: head, g37_file_sha256: files, now_ms: NOW, pick: picks, cli: cliOut };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const check = process.argv.includes('--check');
  const oi = process.argv.indexOf('--out');
  const outFile = oi >= 0 ? process.argv[oi + 1] : GOLDEN_FILE;
  if (!check) {
    const problem = pinProblem(repoRoot);
    if (problem !== null) { process.stderr.write(`refusing: ${problem}\n`); return 2; }
  }
  const g = await buildGolden();
  const text = `${JSON.stringify(g, null, 2)}\n`;
  if (check) {
    const cur = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
    const norm = (cli) => JSON.stringify(cli, (k, v) => (k === 'out' && typeof v === 'string' ? stripCoverage(v) : v));
    const same = JSON.stringify(cur.pick) === JSON.stringify(g.pick) && norm(cur.cli) === norm(g.cli) &&
      JSON.stringify(cur.g37_file_sha256) === JSON.stringify(g.g37_file_sha256) && cur.generated_from_commit === PIN_COMMIT;
    process.stdout.write(same ? 'golden matches\n' : 'golden DIFFERS\n');
    return same ? 0 : 1;
  }
  fs.writeFileSync(outFile, text);
  process.stdout.write(`wrote ${outFile} from ${g.generated_from_commit}\n`);
  return 0;
}

module.exports = { NOW, GOLDEN_FILE, G37_FILES, PIN_COMMIT, pinnedHashes, pinProblem, stripCoverage, pickCases, cliScenarios, runPick, runCliScenario, writeMirrorVariant, loadDeps, buildGolden };

if (require.main === module) main().then((c) => { process.exitCode = c; });
