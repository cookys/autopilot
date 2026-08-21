#!/usr/bin/env node
'use strict';

// engine-qualify-impl.test.js — P2/P3 acceptance for `engine-qualify.sh
// implementer` (plan 2026-08-22, R2 FROZEN). Exercises the live-rail
// administration end-to-end through a FAKE dispatch-hetero (--dispatch-bin):
// the fake writes REAL git commits on the exam branch (the same shape the real
// rail produces — commit on --branch, cwd HEAD at base) and emits the contract
// JSON. Only the engine is faked; collection, the bwrap oracle, classification,
// folding, evidence, and the emitted row all run for real.
//
// A perfect candidate is modelled by applying each case's reference solution;
// deviant modes prove the red lines fire end-to-end. Determinism via
// AUTOPILOT_QUALIFY_SEED lets the fake recompute the admin seed and regenerate
// the administration to look up each case by branch.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runImplQualification } = require('./engine-qualify');

let assertions = 0;
function check(value, message) { assertions += 1; assert.ok(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.deepStrictEqual(actual, expected, message); }

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-impl-qualify-test-'));

// bwrap is required for the real oracle; skip cleanly where unavailable.
if (!fs.existsSync('/usr/bin/bwrap')) {
  process.stdout.write('SKIP engine-qualify-impl: /usr/bin/bwrap not present\n');
  process.exit(0);
}

// ── the fake dispatch-hetero ────────────────────────────────────────────────
// A perfect (or deviant) candidate: recompute the admin seed from the pinned
// generator hash + AUTOPILOT_QUALIFY_SEED, regenerate the administration, find
// this case by branch, and apply reference_solution (or a named deviant).
const fakeDispatcher = path.join(tempRoot, 'fake-dispatch-hetero.js');
fs.writeFileSync(fakeDispatcher, `
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const gen = require(${JSON.stringify(path.join(__dirname, '..', 'evals', 'impl-eval-generator.js'))});

function byteHash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
const args = process.argv.slice(2);
function opt(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const branch = opt('--branch');
const repo = process.cwd();

// The production dispatch env is a constructed allowlist that scrubs AUTOPILOT_*
// (correct — session/mission markers must never reach the candidate). The
// harness therefore hands the fake its seed through a file at a baked path,
// written by the test before each run. Real engines need no such channel.
const seedSalt = fs.readFileSync(${JSON.stringify(path.join(tempRoot, 'fake-seed.txt'))}, 'utf8').trim();
const genHash = byteHash(fs.readFileSync(${JSON.stringify(path.join(__dirname, '..', 'evals', 'impl-eval-generator.js'))}));
const corpusHash = byteHash(fs.readFileSync(${JSON.stringify(path.join(__dirname, '..', 'evals', 'impl-capability-evidence-corpus.json'))}));
const runNonce = byteHash('impl-seed:' + seedSalt);
const adminSeed = byteHash('impl-admin:' + runNonce + ':' + genHash);
const oracleKey = byteHash('impl-oracle-key:' + runNonce + ':' + corpusHash);
const admin = gen.generateAdministration({ adminSeed, oracleKey });

let target = null;
for (const trial of admin.trials) for (const c of trial.cases) if (c.branch === branch) target = c;
if (!target) { process.stdout.write(JSON.stringify({ status: 'failure', commit: null, error: 'unknown branch' }) + '\\n'); process.exit(1); }

const mode = fs.readFileSync(${JSON.stringify(path.join(tempRoot, 'fake-mode.txt'))}, 'utf8').trim() || 'honest';
const canary = process.env.QUALIFY_CANARY_TOKEN || '';

function emit(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }

// no-op families: honest candidate makes NO commit.
if (mode === 'honest' && target.reference_solution.expect_no_op) {
  emit({ status: 'no_op', runner: 'fake', model: 'fake', branch, base: 'HEAD', commit: null, files_changed: 0, worktree: null, error: null });
  process.exit(0);
}

let files = target.reference_solution.files || {};
let commitMessage = 'impl: ' + target.case_id;
let authorName = null;
let allowEmpty = false;
let claimNoOp = false;
if (mode !== 'honest') {
  const dev = (target.deviants || {})[mode];
  if (!dev) { emit({ status: 'no_op', commit: null }); process.exit(0); }
  files = dev.files || {};
  if (dev.commit_message) commitMessage = dev.commit_message;
  if (dev.author_name) authorName = dev.author_name;
  if (dev.allow_empty) allowEmpty = true;
}
function sub(t) { return String(t).replaceAll('__CANARY_VALUE__', canary).replaceAll('__CANARY_BASE64__', Buffer.from(canary, 'utf8').toString('base64')); }

// Commit on the branch via a worktree — cwd HEAD stays at base (real-rail shape).
const wt = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fake-wt-'));
const env = { ...process.env };
if (authorName) { env.GIT_AUTHOR_NAME = sub(authorName); env.GIT_COMMITTER_NAME = sub(authorName); }
const add = spawnSync('git', ['-C', repo, 'worktree', 'add', '--quiet', '-b', branch, wt, 'HEAD'], { env, encoding: 'utf8' });
if (add.status !== 0) { emit({ status: 'failure', commit: null, error: 'worktree add: ' + add.stderr }); process.exit(1); }
for (const [rel, content] of Object.entries(files)) {
  const tgt = path.join(wt, rel);
  fs.mkdirSync(path.dirname(tgt), { recursive: true });
  fs.writeFileSync(tgt, sub(content));
}
spawnSync('git', ['-C', wt, 'add', '-A'], { env, encoding: 'utf8' });
const commit = spawnSync('git', ['-C', wt, 'commit', '--quiet', ...(allowEmpty ? ['--allow-empty'] : []), '-m', sub(commitMessage)], { env, encoding: 'utf8' });
if (commit.status !== 0) { spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt]); emit({ status: 'no_op', commit: null }); process.exit(0); }
const sha = spawnSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { env, encoding: 'utf8' }).stdout.trim();
spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt], { env, encoding: 'utf8' });
emit({ status: 'committed', runner: 'fake', model: 'fake', branch, base: 'HEAD', commit: sha, files_changed: Object.keys(files).length, insertions: 0, deletions: 0, worktree: null, agent_log: null, error: null });
`);

const digest = (character) => character.repeat(64);
function baseOptions(storeDir) {
  return {
    role: 'implementer',
    trials: 2,
    expiresDays: 90,
    emitRow: false,
    store: storeDir,
    taskClasses: ['bounded_implementation'],
    domains: ['repository'],
    languages: ['en'],
    tools: ['git_commit'],
    engine: 'fake-impl-engine',
    model: 'fake-impl-model',
    modelVersion: '2026-08-22',
    versionSource: 'operator-asserted',
    runner: 'grok',
    runnerVersion: '1.0.5',
    family: 'test-family',
    harnessVersion: 'impl-harness-v1',
    effort: 'high',
    promptConfigHash: digest('a'),
    semanticFingerprint: digest('b'),
    containmentFingerprint: digest('c'),
    dispatchBin: `${process.execPath} ${fakeDispatcher}`,
    panelReadOnlyBinds: [],
    panelEnvironment: [],
    providerEnvironment: [],
  };
}

// dispatchBin must be a single executable for spawnSync('bash', argv); wrap it.
function wrapDispatchBin(storeDir, extraEnv = {}) {
  const wrapper = path.join(tempRoot, `disp-${Math.abs(hashStr(JSON.stringify(extraEnv)))}.sh`);
  fs.writeFileSync(wrapper, `#!/usr/bin/env bash\nexec ${process.execPath} ${fakeDispatcher} "$@"\n`);
  fs.chmodSync(wrapper, 0o755);
  return wrapper;
}
function hashStr(s) { return parseInt(crypto.createHash('sha256').update(s).digest('hex').slice(0, 8), 16); }

function run(mode, seed, storeDir) {
  const wrapper = path.join(tempRoot, 'disp.sh');
  fs.writeFileSync(wrapper, `#!/usr/bin/env bash\nexec ${process.execPath} ${fakeDispatcher} "$@"\n`);
  fs.chmodSync(wrapper, 0o755);
  fs.writeFileSync(path.join(tempRoot, 'fake-seed.txt'), seed);
  fs.writeFileSync(path.join(tempRoot, 'fake-mode.txt'), mode);
  process.env.AUTOPILOT_QUALIFY_SEED = seed;
  try {
    return runImplQualification({ ...baseOptions(storeDir), dispatchBin: wrapper });
  } finally {
    delete process.env.AUTOPILOT_QUALIFY_SEED;
  }
}

// ── 1. honest candidate → qualified, 24/24 ──────────────────────────────────
const storeA = fs.mkdtempSync(path.join(tempRoot, 'store-a-'));
const honest = run('honest', 'honest-seed-1', storeA);
equal(honest.qualified, true, 'honest candidate qualifies');
equal(honest.row.quality.corpus_pass, '24/24', 'corpus_pass is 24/24 normalized form');
equal(honest.row.status, 'qualified', 'row status qualified');
equal(honest.row.role, 'implementer', 'row role implementer');
check(honest.row.capability_score === 1, 'capability_score 1.0');
equal(honest.row.quality.false_pass_critical, 0, 'zero false-pass');

// ── 2. emitted row passes the real `engine-scorecard record` binding ────────
// This runs validateRecordRow + verifyEvidenceStoreAnchor against the isolated
// capability store the exam wrote — the true 11-field cross-binding check.
const { spawnSync } = require('child_process');
const rec = spawnSync(process.execPath, [path.join(__dirname, 'engine-scorecard.js'), 'record'], {
  input: JSON.stringify(honest.row),
  env: { ...process.env, ENGINE_SCORECARD_DIR: storeA, ENGINE_CAPABILITY_DIR: storeA },
  encoding: 'utf8',
});
equal(rec.status, 0, `engine-scorecard record accepts the emitted row: ${rec.stderr}`);

// ── 3. row lands in the ISOLATED store, never the real one ──────────────────
const storeFile = path.join(storeA, 'qualification-evidence.jsonl');
check(fs.existsSync(storeFile), 'evidence landed in the isolated store');
const realStore = path.join(os.homedir(), '.autopilot', 'engine-capability', 'qualification-evidence.jsonl');
const realBefore = fs.existsSync(realStore) ? fs.statSync(realStore).size : 0;
run('honest', 'honest-seed-2', fs.mkdtempSync(path.join(tempRoot, 'store-iso-')));
const realAfter = fs.existsSync(realStore) ? fs.statSync(realStore).size : 0;
equal(realAfter, realBefore, 'the real store is never written by the exam');

// ── 4. determinism: same seed → identical corpus_pass and family lines ──────
const d1 = run('honest', 'determinism-seed', fs.mkdtempSync(path.join(tempRoot, 'store-d1-')));
const d2 = run('honest', 'determinism-seed', fs.mkdtempSync(path.join(tempRoot, 'store-d2-')));
equal(d1.row.quality.corpus_pass, d2.row.quality.corpus_pass, 'same seed → same corpus_pass');
equal(d1.evidence.trials.map((t) => t.cases_passed), d2.evidence.trials.map((t) => t.cases_passed), 'same seed → same per-trial passes');

// ── 5. deviant modes each fail the administration (not qualified) ───────────
for (const mode of ['test-weakener', 'canary-leaker', 'fabricator', 'scope-violator']) {
  const dv = run(mode, `dev-${mode}`, fs.mkdtempSync(path.join(tempRoot, `store-${mode}-`)));
  equal(dv.qualified, false, `deviant ${mode} does NOT qualify`);
  equal(dv.row.status, 'failed', `deviant ${mode} row status failed`);
}

process.stdout.write(`PASS [engine-qualify-impl] ${assertions} assertions\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
