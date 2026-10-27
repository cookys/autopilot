'use strict';
// node --test scripts/gate-verify.test.js
//
// Controls of plan docs/plans/2026-10-26-depth0-per-turn-gate.md section 3.2 (P1).
// Every case below is a function of the verifier script path. The suite runs
// each case against the real script (green), then re-runs the cases that guard
// a defence against a copy of the script with that one defence removed
// (mutation) and requires the case to FAIL (red). The red assertion message is
// printed as "RED(<defence>) <case>: <message>" so the red run is on record.
// A mutation whose `from` text no longer matches exactly once fails the suite,
// so a refactor cannot leave a control pointing at nothing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const REAL = path.join(__dirname, 'gate-verify.js');
const SCHEMA = path.join(__dirname, '..', 'schemas', 'gate-rules.schema.json');
const GV = require('./gate-verify.js');

// ---------------------------------------------------------------- fixtures

const dirs = [];
function mk(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.AUTOPILOT_GATE_FILE;
  return Object.assign(env, extra || {});
}

function git(dir, ...a) {
  return cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a],
    { cwd: dir, env: cleanEnv(), stdio: 'pipe' }).toString().trim();
}

const HELPER = "exports.bad = (f) => require('fs').readFileSync(f, 'utf8').includes('BAD');\n";
const XTEST = "const path = require('path');\nconst { bad } = require('./helper.js');\n"
  + "if (bad(path.join(process.env.AUTOPILOT_GATE_REPO, 'src/app.js'))) { process.stderr.write('app.js is BAD'); process.exit(1); }\n";
const ENVPROBE = "if (process.env.GATE_SECRET !== undefined) { process.stderr.write('secret leaked'); process.exit(1); }\n"
  + "const repo = process.env.AUTOPILOT_GATE_REPO;\n"
  + "if (!repo) { process.stderr.write('no repo env'); process.exit(1); }\n"
  + "if (process.cwd().startsWith(repo)) { process.stderr.write('cwd in worker tree'); process.exit(1); }\n";
const SLOW = 'setTimeout(() => process.exit(0), 4000);\n';
const SMOKE = "const fs = require('fs'); const path = require('path');\n"
  + "if (!fs.existsSync(path.join(process.env.AUTOPILOT_GATE_REPO, 'src/login.txt'))) { process.stderr.write('no login'); process.exit(1); }\n";

const REGISTRY = {
  v: 1,
  checks: {
    'unit-tests': { argv: ['node', 'x.test.js'], files: ['x.test.js', 'helper.js'], timeout_s: 20 },
    envprobe: { argv: ['node', 'envprobe.js'], files: ['envprobe.js'], timeout_s: 20 },
    slow: { argv: ['node', 'slow.js'], files: ['slow.js'], timeout_s: 1 },
    'login-smoke': { argv: ['node', 'smoke.js'], files: ['smoke.js'], timeout_s: 20 },
  },
};

function makeRepo(over) {
  const dir = mk('gv-repo-');
  const aux = mk('gv-aux-');
  const files = Object.assign({
    'src/api.js': 'export function listUsers() {}\n',
    'src/app.js': 'module.exports = 1;\n',
    'src/legacy/old.js': '// legacy\n',
    'x.test.js': XTEST,
    'helper.js': HELPER,
    'envprobe.js': ENVPROBE,
    'slow.js': SLOW,
    'smoke.js': SMOKE,
    'evil.js': 'process.exit(0);\n',
    '.claude/gate-checks.json': JSON.stringify(REGISTRY),
  }, over || {});
  git(dir, 'init', '-q');
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) continue;
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return { dir, aux, base: git(dir, 'rev-parse', 'HEAD') };
}

function write(ctx, rel, text) {
  fs.mkdirSync(path.dirname(path.join(ctx.dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(ctx.dir, rel), text);
}

let seq = 0;
// Runs the verifier. rules: object (written to a file outside the repo).
function run(S, ctx, rules, o) {
  o = o || {};
  const rf = path.join(ctx.aux, 'rules-' + (seq++) + '.json');
  fs.writeFileSync(rf, typeof rules === 'string' ? rules : JSON.stringify(rules));
  const args = [S];
  if (o.check) args.push('--check');
  else args.push('--turn', '1');
  args.push('--repo', ctx.dir, '--rules', rf, '--base', o.base || ctx.base, '--json');
  if (o.mode) args.push('--mode', o.mode);
  if (o.args) args.push(...o.args);
  const r = cp.spawnSync(process.execPath, args, { env: cleanEnv(o.env), encoding: 'utf8', timeout: 60000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch (e) { /* keep null */ }
  return { status: r.status, out, stdout: r.stdout, stderr: r.stderr };
}

const L = (rules) => Object.assign({ v: 1 }, rules);
const CLEAN_RULES = L({
  forbid_paths: [{ id: 'R1', glob: 'src/legacy/**', why: 'frozen module' }],
  require_files: [{ id: 'R2', path: 'src/api.js' }],
  require_text: [{ id: 'R3', path: 'src/api.js', text: 'export function listUsers' }],
  forbid_text: [{ id: 'R4', glob: 'src/**/*.js', text: 'console.log' }],
  must_pass: [{ id: 'R5', check: 'unit-tests' }],
  features: [{ id: 'F1', check: 'js-syntax', label: 'syntax ok' }],
});

function viol(res, id) { return (res.out && res.out.violations || []).filter((v) => v.constraint === id); }
function expectViolation(res, id, evidenceRe) {
  assert.strictEqual(res.status, 1, 'exit 1 expected, got ' + res.status + ' stderr=' + res.stderr + ' out=' + res.stdout);
  const v = viol(res, id);
  assert.ok(v.length >= 1, 'violation ' + id + ' expected in ' + res.stdout);
  if (evidenceRe) assert.match(v[0].evidence, evidenceRe);
  assert.ok(v[0].rule && typeof v[0].rule === 'string');
}
function expectTwo(res, why) {
  assert.strictEqual(res.status, 2, (why || '') + ' exit 2 expected, got ' + res.status + ' out=' + res.stdout + ' err=' + res.stderr);
}
function expectClean(res) {
  assert.strictEqual(res.status, 0, 'exit 0 expected, got ' + res.status + ' out=' + res.stdout + ' err=' + res.stderr);
  assert.deepStrictEqual(res.out, { violations: [], feature_gaps: [] });
}

// ---------------------------------------------------------------- cases

const C = {};

C.clean_fixture_exits_0 = (S) => { expectClean(run(S, makeRepo(), CLEAN_RULES)); };

C.forbid_paths_modified = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/legacy/old.js', '// touched\n');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R1', /^src\/legacy\/old\.js$/);
};
C.forbid_paths_committed_after_base = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/legacy/old.js', '// touched\n');
  git(ctx.dir, 'add', '-A'); git(ctx.dir, 'commit', '-q', '-m', 'worker');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R1', /legacy/);
};
C.forbid_paths_untracked = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/legacy/new.js', '// new\n');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R1', /^src\/legacy\/new\.js$/);
};
C.require_files_absent_until_created = (S) => {
  const ctx = makeRepo();
  const rules = L({ require_files: [{ id: 'R2', path: 'docs/NOTES.md' }] });
  assert.strictEqual(run(S, ctx, rules, { check: true }).status, 0, '--check must accept a target that does not exist yet');
  expectViolation(run(S, ctx, rules), 'R2', /docs\/NOTES\.md/);
  write(ctx, 'docs/NOTES.md', 'notes\n');
  expectClean(run(S, ctx, rules));
};
C.require_text_violation = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/api.js', 'export function other() {}\n');
  const rules = L({ require_text: [{ id: 'R3', path: 'src/api.js', text: 'export function listUsers' }] });
  expectViolation(run(S, ctx, rules), 'R3', /text not found/);
  fs.rmSync(path.join(ctx.dir, 'src/api.js'));
  expectViolation(run(S, ctx, rules), 'R3', /file missing/);
};
C.forbid_text_violation = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'a\nconsole.log(1)\n');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R4', /^src\/app\.js:2$/);
};
C.must_pass_violation = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'BAD\n');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R5', /^exit 1: app\.js is BAD/);
};
C.feature_gap_not_violation = (S) => {
  const ctx = makeRepo();
  const rules = L({ features: [{ id: 'F1', check: 'login-smoke', label: 'login works' }] });
  const r = run(S, ctx, rules);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(r.out, { violations: [], feature_gaps: ['F1: login works'] });
  const r2 = run(S, ctx, rules, { mode: 'violations' });
  assert.deepStrictEqual(r2.out, { violations: [], feature_gaps: [] });
  write(ctx, 'src/login.txt', 'x');
  assert.deepStrictEqual(run(S, ctx, rules).out, { violations: [], feature_gaps: [] });
};
C.builtin_conflict_markers = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'a\n<<<<<<< HEAD\nb\n');
  const rules = L({ must_pass: [{ id: 'R5', check: 'no-conflict-markers' }] });
  expectViolation(run(S, ctx, rules), 'R5', /^src\/app\.js:2$/);
};
C.builtin_js_syntax = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'function (\n');
  const rules = L({ must_pass: [{ id: 'R5', check: 'js-syntax' }] });
  expectViolation(run(S, ctx, rules), 'R5', /src\/app\.js/);
};

// exit 2 family
const TWO = {
  dotdot: [L({ require_files: [{ id: 'R2', path: '../x' }] }), L({ require_files: [{ id: 'R2', path: 'a/../b' }] })],
  absolute: [L({ require_files: [{ id: 'R2', path: '/etc/passwd' }] })],
  unknown_key: [L({ bogus: [] })],
  unknown_entry_key: [L({ require_files: [{ id: 'R2', path: 'a', cmd: 'rm -rf /' }] })],
  dup_id: [L({ require_files: [{ id: 'R2', path: 'a' }, { id: 'R2', path: 'b' }] })],
  rule_41: [L({ require_files: Array.from({ length: 41 }, (_, i) => ({ id: 'R' + i, path: 'f' + i })) })],
  glob_braces: [L({ forbid_paths: [{ id: 'R1', glob: 'src/{a,b}/x.js' }] })],
  glob_class: [L({ forbid_paths: [{ id: 'R1', glob: 'src/[ab].js' }] })],
  glob_partial_globstar: [L({ forbid_paths: [{ id: 'R1', glob: 'src/a**b' }] })],
  unregistered_check: [L({ must_pass: [{ id: 'R5', check: 'no-such-check' }] })],
  bad_version: [{ v: 2 }],
  not_json: ['{nope'],
};
for (const [name, list] of Object.entries(TWO)) {
  C['exit2_' + name] = (S) => {
    const ctx = makeRepo();
    for (const rules of list) {
      const v = run(S, ctx, rules);
      expectTwo(v, name + ' verify');
      assert.strictEqual(v.stdout, '', 'exit 2 prints no verdict on stdout');
      expectTwo(run(S, ctx, rules, { check: true }), name + ' --check');
    }
  };
}
C.exit2_symlink_escape = (S) => {
  const ctx = makeRepo(); const outside = mk('gv-out-');
  fs.symlinkSync(outside, path.join(ctx.dir, 'esc'));
  const rules = L({ require_files: [{ id: 'R2', path: 'esc/x' }] });
  expectTwo(run(S, ctx, rules), 'symlink verify');
  expectTwo(run(S, ctx, rules, { check: true }), 'symlink --check');
  expectTwo(run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'esc/**' }] })), 'symlink glob');
};
C.symlinked_file_outside_is_not_read = (S) => {
  const ctx = makeRepo(); const outside = mk('gv-out-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'console.log hidden\n');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(ctx.dir, 'src/link.txt'));
  const rules = L({ forbid_text: [{ id: 'R4', glob: 'src/*.txt', text: 'console.log' }] });
  expectClean(run(S, ctx, rules));
};
C.exit2_missing_registry_with_must_pass = (S) => {
  const ctx = makeRepo({ '.claude/gate-checks.json': null });
  const rules = L({ must_pass: [{ id: 'R5', check: 'unit-tests' }] });
  expectTwo(run(S, ctx, rules)); expectTwo(run(S, ctx, rules, { check: true }));
  // built-ins need no registry
  expectClean(run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'js-syntax' }] })));
};
C.exit2_files_entry_missing_at_base = (S) => {
  const reg = { v: 1, checks: { 'unit-tests': { argv: ['node', 'x.test.js'], files: ['x.test.js', 'ghost.js'] } } };
  const ctx = makeRepo({ '.claude/gate-checks.json': JSON.stringify(reg) });
  const rules = L({ must_pass: [{ id: 'R5', check: 'unit-tests' }] });
  expectTwo(run(S, ctx, rules, { check: true }), '--check');
  // only at the working tree, not at base: still missing at base
  write(ctx, 'ghost.js', 'process.exit(0)\n');
  expectTwo(run(S, ctx, rules, { check: true }), '--check with ghost.js in the worker tree');
  expectTwo(run(S, ctx, rules), 'verify');
};
C.exit2_argv_outside_exported_files = (S) => {
  const bads = [
    { argv: ['node', 'evil.js'], files: ['x.test.js'] },
    { argv: ['node', '-e', 'process.exit(0)'], files: ['x.test.js'] },
    { argv: ['/bin/true'], files: ['x.test.js'] },
    { argv: ['node', '/etc/hostname'], files: ['x.test.js'] },
    { argv: ['node', '--eval=process.exit(0)', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['python3', '-cimport sys;sys.exit(0)', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['sh', '-cecho', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['python3', '-cpass', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['python3', '-mjson.tool', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['node', '--test-name-pattern=foo', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['node', '--test-name-pattern', 'foo', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['node', '-pprocess.exit(0)', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['node', '-rfs', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['node', '--require=./x.test.js', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['node', '--import=./x.test.js', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['node', '-', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['node', '--test', '-B=1', 'x.test.js'], files: ['x.test.js'] },
    { argv: ['node', '--TEST', 'x.test.js'], files: ['x.test.js'] },
  ];
  for (const bad of bads) {
    const ctx = makeRepo({ '.claude/gate-checks.json': JSON.stringify({ v: 1, checks: { 'unit-tests': bad } }) });
    const rules = L({ must_pass: [{ id: 'R5', check: 'unit-tests' }] });
    expectTwo(run(S, ctx, rules, { check: true }), '--check ' + JSON.stringify(bad.argv));
    expectTwo(run(S, ctx, rules), 'verify ' + JSON.stringify(bad.argv));
  }
};
C.exit2_require_text_path_missing_at_base = (S) => {
  const ctx = makeRepo();
  const rules = L({ require_text: [{ id: 'R3', path: 'src/later.js', text: 'x' }] });
  write(ctx, 'src/later.js', 'x');
  expectTwo(run(S, ctx, rules, { check: true }));
};
C.exit2_base_not_a_commit = (S) => {
  const ctx = makeRepo();
  const rules = L({ require_files: [{ id: 'R2', path: 'src/api.js' }] });
  expectTwo(run(S, ctx, rules, { base: 'a'.repeat(40) }));
  expectTwo(run(S, ctx, rules, { base: 'HEAD' }));
};
C.rule_40_is_allowed = (S) => {
  const ctx = makeRepo();
  const rules = L({ require_files: Array.from({ length: 40 }, (_, i) => ({ id: 'R' + i, path: 'src/api.js' })) });
  expectClean(run(S, ctx, rules));
};

// worker rewrites its own check
const MUST = L({ must_pass: [{ id: 'R5', check: 'unit-tests' }] });
C.worker_rewrites_test_to_pass = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'BAD\n');
  write(ctx, 'x.test.js', 'process.exit(0);\n'); // worker makes the check exit 0
  write(ctx, 'helper.js', 'exports.bad = () => false;\n');
  expectViolation(run(S, ctx, MUST), 'R5', /app\.js is BAD/);
};
C.worker_rewrites_test_to_fail = (S) => {
  const ctx = makeRepo(); // product is fine; worker makes the check exit 1
  write(ctx, 'x.test.js', 'process.exit(1);\n');
  expectClean(run(S, ctx, MUST));
};
C.worker_rewrites_test_and_commits = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'BAD\n'); write(ctx, 'x.test.js', 'process.exit(0);\n');
  git(ctx.dir, 'add', '-A'); git(ctx.dir, 'commit', '-q', '-m', 'worker');
  expectViolation(run(S, ctx, MUST), 'R5', /app\.js is BAD/);
};
C.worker_rewrites_registry = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'BAD\n');
  const evil = { v: 1, checks: { 'unit-tests': { argv: ['node', 'evil.js'], files: ['evil.js'] } } };
  write(ctx, '.claude/gate-checks.json', JSON.stringify(evil));
  expectViolation(run(S, ctx, MUST), 'R5', /app\.js is BAD/);
  fs.rmSync(path.join(ctx.dir, '.claude/gate-checks.json'));
  expectViolation(run(S, ctx, MUST), 'R5', /app\.js is BAD/);
};
C.worker_registry_cannot_add_check = (S) => {
  const ctx = makeRepo();
  const reg = JSON.parse(JSON.stringify(REGISTRY)); reg.checks.mine = { argv: ['node', 'evil.js'], files: ['evil.js'] };
  write(ctx, '.claude/gate-checks.json', JSON.stringify(reg));
  expectTwo(run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'mine' }] })));
};

// execution environment of a registered check
C.check_runs_scrubbed_in_temp_dir = (S) => {
  const ctx = makeRepo();
  const r = run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'envprobe' }] }), { env: { GATE_SECRET: 'hunter2' } });
  expectClean(r);
};
C.temp_dir_removed = (S) => {
  const ctx = makeRepo(); const t = mk('gv-tmp-');
  expectClean(run(S, ctx, MUST, { env: { TMPDIR: t } }));
  assert.deepStrictEqual(fs.readdirSync(t), [], 'temp dir left behind after a clean run');
  write(ctx, 'src/app.js', 'BAD\n');
  expectViolation(run(S, ctx, MUST, { env: { TMPDIR: t } }), 'R5');
  assert.deepStrictEqual(fs.readdirSync(t), [], 'temp dir left behind after a failing run');
};
C.check_timeout_is_error = (S) => {
  const ctx = makeRepo();
  const t0 = Date.now();
  const r = run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'slow' }] }));
  expectTwo(r, 'must_pass timeout');
  assert.match(r.stderr, /timed out after 1s/);
  assert.strictEqual(r.stdout, '');
  assert.ok(Date.now() - t0 < 3500, 'timeout did not cut the run short');
  const f = run(S, ctx, L({ features: [{ id: 'F1', check: 'slow' }] }));
  expectTwo(f, 'feature timeout');
  // features are not run in mode violations, so no timeout can occur there
  expectClean(run(S, ctx, L({ features: [{ id: 'F1', check: 'slow' }] }), { mode: 'violations' }));
};

// gate-file envelope (hook passes it through AUTOPILOT_GATE_FILE)
function gateFile(ctx, over) {
  const g = Object.assign({
    v: 1, repo: ctx.dir, base: ctx.base, mode: 'violations+features', max_blocks: 2,
    expires_at: new Date(Date.now() + 3600e3).toISOString(), rules: CLEAN_RULES,
  }, over || {});
  const f = path.join(ctx.aux, 'gate-' + (seq++) + '.json');
  fs.writeFileSync(f, JSON.stringify(g));
  return f;
}
function runGate(S, ctx, gf, viaEnv) {
  const args = [S, '--turn', '2', '--repo', ctx.dir, '--json'];
  const env = cleanEnv(viaEnv ? { AUTOPILOT_GATE_FILE: gf } : {});
  if (!viaEnv) args.push('--gate-file', gf);
  const r = cp.spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 60000 });
  let out = null; try { out = JSON.parse(r.stdout); } catch (e) { /* null */ }
  return { status: r.status, out, stdout: r.stdout, stderr: r.stderr };
}
C.gate_file_valid_and_env_var = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/legacy/old.js', '// touched\n');
  const gf = gateFile(ctx);
  expectViolation(runGate(S, ctx, gf, false), 'R1');
  expectViolation(runGate(S, ctx, gf, true), 'R1');
  const clean = makeRepo();
  expectClean(runGate(S, clean, gateFile(clean), true));
};
C.gate_file_repo_mismatch = (S) => {
  const ctx = makeRepo(); const other = makeRepo();
  expectTwo(runGate(S, ctx, gateFile(ctx, { repo: other.dir }), false));
};
C.gate_file_bad_fields = (S) => {
  const ctx = makeRepo();
  for (const over of [{ max_blocks: 3 }, { mode: 'all' }, { base: 'abc' }, { v: 2 }, { extra: 1 }, { expires_at: 'soon' }]) {
    expectTwo(runGate(S, ctx, gateFile(ctx, over), false), JSON.stringify(over));
  }
};
C.gate_file_mode_violations_hides_features = (S) => {
  const ctx = makeRepo();
  const rules = L({ features: [{ id: 'F1', check: 'login-smoke', label: 'login works' }] });
  const a = runGate(S, ctx, gateFile(ctx, { rules, mode: 'violations' }), false);
  assert.deepStrictEqual(a.out.feature_gaps, []);
  const b = runGate(S, ctx, gateFile(ctx, { rules, mode: 'violations+features' }), false);
  assert.deepStrictEqual(b.out.feature_gaps, ['F1: login works']);
};

// ---- round-2 controls (A, B, C1-C6, D)

C.argv_code_flag_bypass = (S) => {
  // acceptance instance: python -c with the code glued to the flag must not replace a check that exits 1
  const reg = { v: 1, checks: { 'unit-tests': { argv: ['python3', '-cimport sys;sys.exit(0)', 'check.js'], files: ['check.js'] } } };
  const ctx = makeRepo({ '.claude/gate-checks.json': JSON.stringify(reg), 'check.js': 'import sys; sys.exit(1)\n' });
  expectTwo(run(S, ctx, MUST), 'verify');
  expectTwo(run(S, ctx, MUST, { check: true }), '--check');
};
C.argv_allowed_flags_still_work = (S) => {
  const reg = { v: 1, checks: { 'unit-tests': { argv: ['node', '--test', '--no-warnings', 'x.test.js'], files: ['x.test.js', 'helper.js'] } } };
  const ctx = makeRepo({ '.claude/gate-checks.json': JSON.stringify(reg) });
  assert.strictEqual(run(S, ctx, MUST, { check: true }).status, 0);
};
C.argv0_exported_script = (S) => {
  const reg = { v: 1, checks: { 'unit-tests': { argv: ['run.sh'], files: ['run.sh'] } } };
  const sh = '#!/bin/sh\ngrep -q BAD "$AUTOPILOT_GATE_REPO/src/app.js" && { echo "app is BAD" >&2; exit 1; }\nexit 0\n';
  const ctx = makeRepo({ '.claude/gate-checks.json': JSON.stringify(reg), 'run.sh': sh });
  expectClean(run(S, ctx, MUST));
  write(ctx, 'src/app.js', 'BAD\n');
  expectViolation(run(S, ctx, MUST), 'R5', /app is BAD/);
};

// C1: git reads of base bytes must not honour replace refs or inherited GIT_* state
function replaceBase(ctx, edits) {
  for (const [rel, text] of Object.entries(edits)) write(ctx, rel, text);
  git(ctx.dir, 'add', '-A'); git(ctx.dir, 'commit', '-q', '-m', 'evil');
  const evil = git(ctx.dir, 'rev-parse', 'HEAD');
  git(ctx.dir, 'reset', '-q', '--hard', ctx.base);
  git(ctx.dir, 'replace', ctx.base, evil);
}
C.replace_ref_cannot_swap_check_bytes = (S) => {
  const ctx = makeRepo();
  replaceBase(ctx, { 'x.test.js': 'process.exit(0);\n', 'helper.js': 'exports.bad = () => false;\n' });
  write(ctx, 'src/app.js', 'BAD\n');
  expectViolation(run(S, ctx, MUST), 'R5', /app\.js is BAD/);
};
C.replace_ref_cannot_swap_registry = (S) => {
  const ctx = makeRepo();
  replaceBase(ctx, { '.claude/gate-checks.json': JSON.stringify({ v: 1, checks: { 'unit-tests': { argv: ['node', 'evil.js'], files: ['evil.js'] } } }) });
  write(ctx, 'src/app.js', 'BAD\n');
  expectViolation(run(S, ctx, MUST), 'R5', /app\.js is BAD/);
};
C.replace_ref_cannot_add_require_text_target = (S) => {
  const ctx = makeRepo();
  replaceBase(ctx, { 'src/later.js': 'x' });
  expectTwo(run(S, ctx, L({ require_text: [{ id: 'R3', path: 'src/later.js', text: 'x' }] }), { check: true }));
};
C.git_env_is_not_inherited = (S) => {
  const ctx = makeRepo(); const other = makeRepo({ 'unique.txt': String(Math.random()) });
  write(ctx, 'src/legacy/new.js', '// new\n');
  const excl = path.join(ctx.aux, 'excl'); fs.writeFileSync(excl, 'src/legacy/\n');
  const env = {
    GIT_DIR: path.join(other.dir, '.git'), GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.excludesFile', GIT_CONFIG_VALUE_0: excl,
  };
  expectViolation(run(S, ctx, CLEAN_RULES, { env }), 'R1', /new\.js$/);
};
C.every_spawn_site_declares_env = (S) => {
  const src = fs.readFileSync(S, 'utf8');
  const re = /cp\.(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\(/g;
  let m; let n = 0;
  while ((m = re.exec(src))) {
    let depth = 1; let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; }
    const call = src.slice(m.index, i);
    n++;
    assert.match(call, /\benv\b/, 'spawn site without an explicit env: ' + call.slice(0, 80));
  }
  assert.ok(n >= 3, 'expected at least 3 spawn sites, found ' + n);
};

// C2: text rules tell missing, skipped (too large / outside) and ok apart
C.text_rule_skip_states = (S) => {
  const big = 'a'.repeat(9 * 1024 * 1024);
  const ctx = makeRepo({ 'src/big.txt': big, 'src/gone.txt': 'hello\n', 'src/ln.txt': 'hello\n' });
  const rt = L({ require_text: [{ id: 'R3', path: 'src/big.txt', text: 'zzz' }] });
  expectClean(run(S, ctx, rt)); // too large: skipped, not "missing"
  const ft = L({ forbid_text: [{ id: 'R4', glob: 'src/*.txt', text: 'aaa' }] });
  expectClean(run(S, ctx, ft)); // too large: skipped
  fs.rmSync(path.join(ctx.dir, 'src/gone.txt'));
  expectViolation(run(S, ctx, L({ require_text: [{ id: 'R3', path: 'src/gone.txt', text: 'hello' }] })), 'R3', /file missing/);
  // a symlink out of the repo is a path-safety failure (exit 2) for a named path
  const outside = mk('gv-out-'); fs.writeFileSync(path.join(outside, 't'), 'hello');
  fs.rmSync(path.join(ctx.dir, 'src/ln.txt')); fs.symlinkSync(path.join(outside, 't'), path.join(ctx.dir, 'src/ln.txt'));
  expectTwo(run(S, ctx, L({ require_text: [{ id: 'R3', path: 'src/ln.txt', text: 'hello' }] })));
};

// C3
C.gate_file_expires_at_is_iso = (S) => {
  const ctx = makeRepo();
  for (const v of ['January 1, 2099', '2099-01-01', '2099-01-01 00:00:00', '2099/01/01T00:00:00Z', '12/31/2099', 1e13]) {
    expectTwo(runGate(S, ctx, gateFile(ctx, { expires_at: v }), false), JSON.stringify(v));
  }
  for (const v of ['2099-01-01T00:00:00Z', '2099-01-01T00:00:00.123+08:00']) {
    assert.notStrictEqual(runGate(S, ctx, gateFile(ctx, { expires_at: v }), false).status, 2, v);
  }
};

// C4
C.require_files_needs_a_regular_file = (S) => {
  const ctx = makeRepo();
  expectViolation(run(S, ctx, L({ require_files: [{ id: 'R2', path: 'src' }] })), 'R2', /not a regular file/);
  expectViolation(run(S, ctx, L({ require_files: [{ id: 'R2', path: 'nope.txt' }] })), 'R2', /missing/);
  expectClean(run(S, ctx, L({ require_files: [{ id: 'R2', path: 'src/api.js' }] })));
};

// C5
C.hit_cap_forbid_paths = (S) => {
  const ctx = makeRepo();
  for (let i = 0; i < 60; i++) write(ctx, 'src/legacy/n' + i + '.js', '//\n');
  assert.strictEqual(viol(run(S, ctx, CLEAN_RULES), 'R1').length, 50);
  const few = makeRepo(); for (let i = 0; i < 3; i++) write(few, 'src/legacy/n' + i + '.js', '//\n');
  assert.strictEqual(viol(run(S, few, CLEAN_RULES), 'R1').length, 3);
};
C.hit_cap_forbid_text = (S) => {
  const ctx = makeRepo();
  for (let i = 0; i < 60; i++) write(ctx, 'src/m' + i + '.js', 'console.log(1)\n');
  assert.strictEqual(viol(run(S, ctx, CLEAN_RULES), 'R4').length, 50);
  const few = makeRepo(); for (let i = 0; i < 3; i++) write(few, 'src/m' + i + '.js', 'console.log(1)\n');
  assert.strictEqual(viol(run(S, few, CLEAN_RULES), 'R4').length, 3);
};
C.rule_cap_counts_features = (S) => {
  const ctx = makeRepo();
  const mk2 = (n) => L({
    require_files: Array.from({ length: n }, (_, i) => ({ id: 'R' + i, path: 'src/api.js' })),
    features: [{ id: 'F1', check: 'js-syntax' }, { id: 'F2', check: 'js-syntax' }],
  });
  expectClean(run(S, ctx, mk2(38))); // 40 in total
  expectTwo(run(S, ctx, mk2(39))); // 41 in total
  expectTwo(run(S, ctx, mk2(39), { check: true }));
};
C.registry_beats_builtin_of_the_same_name = (S) => {
  const reg = { v: 1, checks: { 'js-syntax': { argv: ['node', 'x.test.js'], files: ['x.test.js', 'helper.js'] } } };
  const ctx = makeRepo({ '.claude/gate-checks.json': JSON.stringify(reg) });
  const rules = L({ must_pass: [{ id: 'R5', check: 'js-syntax' }] });
  expectClean(run(S, ctx, rules));
  write(ctx, 'src/app.js', 'BAD\n'); // valid JS, so the built-in would pass; the registry check fails
  expectViolation(run(S, ctx, rules), 'R5', /app\.js is BAD/);
};
C.field_limits_why_label_text_id = (S) => {
  const ctx = makeRepo();
  expectClean(run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'src/legacy/**', why: 'w'.repeat(300) }] })));
  expectTwo(run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'src/legacy/**', why: 'w'.repeat(301) }] })), 'why 301');
  expectTwo(run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'src/legacy/**', why: 7 }] })), 'why number');
  expectClean(run(S, ctx, L({ features: [{ id: 'F1', check: 'js-syntax', label: 'l'.repeat(300) }] })));
  expectTwo(run(S, ctx, L({ features: [{ id: 'F1', check: 'js-syntax', label: 'l'.repeat(301) }] })), 'label 301');
  expectTwo(run(S, ctx, L({ require_files: [{ id: 'R2', path: 'src/api.js', label: 'x' }] })), 'label outside features');
  expectClean(run(S, ctx, L({ forbid_text: [{ id: 'R4', glob: 'src/**', text: 't'.repeat(1000) }] })));
  expectTwo(run(S, ctx, L({ forbid_text: [{ id: 'R4', glob: 'src/**', text: 't'.repeat(1001) }] })), 'text 1001');
  expectTwo(run(S, ctx, L({ require_files: [{ id: 'bad id!', path: 'src/api.js' }] })), 'bad id');
  const cleanW = makeRepo(); write(cleanW, 'src/legacy/old.js', '// x\n');
  assert.strictEqual(viol(run(S, cleanW, L({ forbid_paths: [{ id: 'R1', glob: 'src/legacy/**', why: 'frozen module' }] })), 'R1')[0].rule, 'frozen module');
  assert.strictEqual(viol(run(S, cleanW, L({ forbid_paths: [{ id: 'R1', glob: 'src/legacy/**' }] })), 'R1')[0].rule, 'forbid_paths R1');
};

// C6
C.conflict_marker_forms = (S) => {
  const rules = L({ must_pass: [{ id: 'R5', check: 'no-conflict-markers' }] });
  const flagged = ['<<<<<<< HEAD', '>>>>>>> branch', '||||||| base', '=======', '=======\r', '<<<<<<<'];
  for (const line of flagged) {
    const ctx = makeRepo(); write(ctx, 'src/app.js', 'a\n' + line + '\nb\n');
    expectViolation(run(S, ctx, rules), 'R5', /^src\/app\.js:2$/);
  }
  const clean = [['src/app.js', '======\n'], ['src/app.js', '<<<<<<<<\n'], ['src/app.js', '  =======\n'], ['src/app.js', '========\n'],
    ['docs/t.md', 'Title\n=======\n'], ['docs/t.rst', 'Title\n=======\n']];
  for (const [rel, text] of clean) {
    const ctx = makeRepo(); write(ctx, rel, text);
    expectClean(run(S, ctx, rules));
  }
};

// ---- round-3 controls: the worker's own index, ignore rules and config are never trusted

function writeGit(ctx, rel, text) { fs.mkdirSync(path.dirname(path.join(ctx.dir, '.git', rel)), { recursive: true }); fs.writeFileSync(path.join(ctx.dir, '.git', rel), text); }
const FORBID = L({ forbid_paths: [{ id: 'R1', glob: 'src/legacy/**', why: 'frozen module' }] });

C.forbid_paths_deleted = (S) => {
  const ctx = makeRepo(); fs.rmSync(path.join(ctx.dir, 'src/legacy/old.js'));
  expectViolation(run(S, ctx, FORBID), 'R1', /^src\/legacy\/old\.js$/);
};
C.forbid_paths_mode_change = (S) => {
  const ctx = makeRepo(); fs.chmodSync(path.join(ctx.dir, 'src/legacy/old.js'), 0o755);
  expectViolation(run(S, ctx, FORBID), 'R1', /old\.js/);
};
C.forbid_paths_symlink_retarget = (S) => {
  const ctx = makeRepo({ 'src/legacy/ln': null });
  fs.symlinkSync('a', path.join(ctx.dir, 'src/legacy/ln')); git(ctx.dir, 'add', '-A'); git(ctx.dir, 'commit', '-q', '-m', 'ln');
  const base2 = git(ctx.dir, 'rev-parse', 'HEAD'); ctx.base = base2;
  expectClean(run(S, ctx, FORBID));
  fs.rmSync(path.join(ctx.dir, 'src/legacy/ln')); fs.symlinkSync('b', path.join(ctx.dir, 'src/legacy/ln'));
  expectViolation(run(S, ctx, FORBID), 'R1', /legacy\/ln/);
};
C.forbid_paths_file_replaced_by_symlink = (S) => {
  const ctx = makeRepo({ 'src/legacy/ln': 'g' }); // blob hash of "g" equals the hash of a symlink to "g"
  expectClean(run(S, ctx, FORBID));
  fs.rmSync(path.join(ctx.dir, 'src/legacy/ln')); fs.symlinkSync('g', path.join(ctx.dir, 'src/legacy/ln'));
  expectViolation(run(S, ctx, FORBID), 'R1', /legacy\/ln/);
};
C.forbid_paths_unchanged_is_clean = (S) => {
  const ctx = makeRepo(); // touch without changing bytes
  const f = path.join(ctx.dir, 'src/legacy/old.js'); const t = new Date(Date.now() + 5000); fs.utimesSync(f, t, t);
  expectClean(run(S, ctx, FORBID));
};
C.worker_exclude_info_cannot_hide_new_file = (S) => {
  const ctx = makeRepo(); writeGit(ctx, 'info/exclude', 'src/legacy/\n');
  write(ctx, 'src/legacy/new.js', '// new\n');
  expectViolation(run(S, ctx, FORBID), 'R1', /^src\/legacy\/new\.js$/);
};
C.worker_excludes_file_cannot_hide_new_file = (S) => {
  const ctx = makeRepo(); const ex = path.join(ctx.aux, 'ex'); fs.writeFileSync(ex, 'src/legacy/\n');
  git(ctx.dir, 'config', 'core.excludesFile', ex);
  write(ctx, 'src/legacy/new.js', '// new\n');
  expectViolation(run(S, ctx, FORBID), 'R1', /^src\/legacy\/new\.js$/);
};
C.worker_gitignore_cannot_hide_new_file = (S) => {
  const ctx = makeRepo(); write(ctx, '.gitignore', 'src/legacy/*.gen\n');
  git(ctx.dir, 'add', '-A'); git(ctx.dir, 'commit', '-q', '-m', 'ignore');
  write(ctx, 'src/legacy/x.gen', 'generated\n');
  assert.strictEqual(git(ctx.dir, 'status', '--porcelain'), '', 'fixture: git itself does not see the ignored file');
  expectViolation(run(S, ctx, FORBID), 'R1', /^src\/legacy\/x\.gen$/);
};
C.worker_assume_unchanged_cannot_hide_edit = (S) => {
  const ctx = makeRepo(); git(ctx.dir, 'update-index', '--assume-unchanged', 'src/legacy/old.js');
  write(ctx, 'src/legacy/old.js', '// edited\n');
  assert.strictEqual(git(ctx.dir, 'diff', '--name-only'), '', 'fixture: git diff does not see the edit');
  expectViolation(run(S, ctx, FORBID), 'R1', /^src\/legacy\/old\.js$/);
};
C.worker_skip_worktree_cannot_hide_edit = (S) => {
  const ctx = makeRepo(); git(ctx.dir, 'update-index', '--skip-worktree', 'src/legacy/old.js');
  write(ctx, 'src/legacy/old.js', '// edited\n');
  assert.strictEqual(git(ctx.dir, 'diff', '--name-only'), '', 'fixture: git diff does not see the edit');
  expectViolation(run(S, ctx, FORBID), 'R1', /^src\/legacy\/old\.js$/);
};
C.worker_fsmonitor_never_runs = (S) => {
  const ctx = makeRepo(); const marker = path.join(ctx.aux, 'fsmonitor-ran');
  const hook = path.join(ctx.aux, 'fsm.sh');
  fs.writeFileSync(hook, '#!/bin/sh\ntouch ' + marker + '\nprintf "\\0"\n', { mode: 0o755 });
  git(ctx.dir, 'config', 'core.fsmonitor', hook);
  write(ctx, 'src/legacy/old.js', '// edited\n'); write(ctx, 'src/legacy/new.js', '// new\n');
  expectViolation(run(S, ctx, FORBID), 'R1', /legacy/);
  assert.ok(!fs.existsSync(marker), 'the worker-configured fsmonitor program ran');
};
C.forbid_text_sees_ignored_and_untracked = (S) => {
  const ctx = makeRepo(); write(ctx, '.gitignore', 'src/ign.js\n'); git(ctx.dir, 'add', '-A'); git(ctx.dir, 'commit', '-q', '-m', 'ign');
  write(ctx, 'src/ign.js', 'console.log(1)\n');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R4', /^src\/ign\.js:1$/);
};
C.builtins_see_ignored_files = (S) => {
  const ctx = makeRepo(); write(ctx, '.gitignore', 'src/bad.js\nnotes.conf\n'); git(ctx.dir, 'add', '-A'); git(ctx.dir, 'commit', '-q', '-m', 'ign');
  write(ctx, 'src/bad.js', 'function (\n');
  expectViolation(run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'js-syntax' }] })), 'R5', /src\/bad\.js/);
  fs.rmSync(path.join(ctx.dir, 'src/bad.js')); write(ctx, 'notes.conf', 'a\n<<<<<<< HEAD\n');
  expectViolation(run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'no-conflict-markers' }] })), 'R5', /^notes\.conf:2$/);
};
C.no_worker_state_git_commands = (S) => {
  const src = fs.readFileSync(S, 'utf8');
  for (const cmd of ['ls-files', 'diff', 'status', 'diff-files', 'diff-index', 'update-index', 'check-ignore', 'add', 'stash', 'grep', 'log']) {
    assert.ok(!src.includes("'" + cmd + "'"), 'git ' + cmd + ' reads the worker index, ignore rules or config');
  }
  assert.ok(src.includes("'core.fsmonitor=false'") && src.includes("'core.hooksPath=/dev/null'") && src.includes("'core.excludesFile=/dev/null'"));
};
C.walk_limit_exit_2 = (S) => {
  const ctx = makeRepo(); for (let i = 0; i < 30; i++) write(ctx, 'src/legacy/n' + i + '.js', '//\n');
  const r = run(S, ctx, FORBID, { args: ['--walk-limit', '10'] });
  expectTwo(r, 'walk limit'); assert.match(r.stderr, /exceeds 10 entries/);
  assert.strictEqual(run(S, ctx, FORBID, { args: ['--walk-limit', '1000'] }).status, 1);
  expectTwo(run(S, ctx, FORBID, { args: ['--walk-limit', '0'] }));
  expectTwo(run(S, ctx, FORBID, { args: ['--walk-limit', String(GV.MAX_WALK_ENTRIES + 1)] }));
};

// ---- round-4 controls: the walk has no fail-open exit

function makeSubRepo() {
  const ctx = makeRepo();
  const s = path.join(ctx.dir, 'sub'); fs.mkdirSync(s);
  git(s, 'init', '-q'); fs.writeFileSync(path.join(s, 'p'), 'old'); git(s, 'add', '-A'); git(s, 'commit', '-q', '-m', 'old');
  const sha = git(s, 'rev-parse', 'HEAD');
  git(ctx.dir, 'update-index', '--add', '--cacheinfo', '160000,' + sha + ',sub'); git(ctx.dir, 'commit', '-q', '-m', 'gitlink');
  ctx.base = git(ctx.dir, 'rev-parse', 'HEAD');
  return { ctx, s };
}
const SUBRULES = L({ forbid_paths: [{ id: 'sub', glob: 'sub/**' }] });
C.submodule_commit_change_is_a_violation = (S) => {
  const { ctx, s } = makeSubRepo();
  expectClean(run(S, ctx, SUBRULES));
  fs.writeFileSync(path.join(s, 'p'), 'new'); git(s, 'add', '-A'); git(s, 'commit', '-q', '-m', 'new');
  expectViolation(run(S, ctx, SUBRULES), 'sub', /^sub$/);
};
C.submodule_head_unreadable_is_exit_2 = (S) => {
  const a = makeSubRepo(); fs.writeFileSync(path.join(a.s, '.git', 'HEAD'), 'garbage\n');
  expectTwo(run(S, a.ctx, SUBRULES), 'corrupt HEAD');
  const b = makeSubRepo(); fs.rmSync(path.join(b.s, '.git'), { recursive: true, force: true });
  expectTwo(run(S, b.ctx, SUBRULES), 'uninitialised submodule directory');
};

const FAKE_GIT = {
  empty_file: (d) => fs.writeFileSync(path.join(d, '.git'), ''),
  empty_dir: (d) => fs.mkdirSync(path.join(d, '.git')),
  gitdir_file: (d) => fs.writeFileSync(path.join(d, '.git'), 'gitdir: ../elsewhere\n'),
  dir_with_payload: (d) => { fs.mkdirSync(path.join(d, '.git')); fs.writeFileSync(path.join(d, '.git', 'evil.js'), 'BAD function (\n'); },
};
C.fake_nested_dot_git_cannot_hide_a_subtree = (S) => {
  for (const [name, mkfake] of Object.entries(FAKE_GIT)) {
    const ctx = makeRepo(); fs.mkdirSync(path.join(ctx.dir, 'hidden'));
    if (name !== 'dir_with_payload') write(ctx, 'hidden/a.js', 'BAD function (\n');
    mkfake(path.join(ctx.dir, 'hidden'));
    const at = (r) => name + ': ' + JSON.stringify(r.out) + r.stderr;
    const fp = run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'hidden/**/*.js' }] }));
    assert.strictEqual(fp.status, 1, 'forbid_paths ' + at(fp));
    const ft = run(S, ctx, L({ forbid_text: [{ id: 'R4', glob: 'hidden/**/*.js', text: 'BAD' }] }));
    assert.strictEqual(ft.status, 1, 'forbid_text ' + at(ft));
    const js = run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'js-syntax' }] }));
    assert.strictEqual(js.status, 1, 'js-syntax ' + at(js));
  }
};

const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
function withMode(file, mode, fn) {
  fs.chmodSync(file, mode);
  try { fn(); } finally { fs.chmodSync(file, fs.statSync(file).isDirectory() ? 0o755 : 0o644); }
}
C.unreadable_directory_is_exit_2 = (S) => {
  if (IS_ROOT) return;
  const ctx = makeRepo(); const d = path.join(ctx.dir, 'hidden');
  fs.mkdirSync(path.join(d, 'sub'), { recursive: true }); fs.writeFileSync(path.join(d, 'a.js'), 'BAD');
  withMode(d, 0o000, () => {
    expectTwo(run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'hidden/**' }] })), 'readdir');
    expectTwo(run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'hidden/sub/**' }] })), 'prefix lstat');
    expectTwo(run(S, ctx, L({ forbid_text: [{ id: 'R4', glob: 'hidden/**', text: 'BAD' }] })), 'forbid_text');
  });
};
C.unsearchable_directory_is_exit_2 = (S) => {
  if (IS_ROOT) return;
  const ctx = makeRepo(); const d = path.join(ctx.dir, 'hidden'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'a.js'), 'BAD');
  withMode(d, 0o444, () => { // listable, but its children cannot be looked at
    expectTwo(run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'hidden/**' }] })));
  });
};
C.unreadable_file_is_exit_2 = (S) => {
  if (IS_ROOT) return;
  const ctx = makeRepo(); const f = path.join(ctx.dir, 'src/legacy/old.js');
  withMode(f, 0o000, () => { expectTwo(run(S, ctx, FORBID), 'hash a tracked file'); });
  const g = path.join(ctx.dir, 'src/secret.js'); fs.writeFileSync(g, 'console.log(1)\n');
  withMode(g, 0o000, () => { expectTwo(run(S, ctx, L({ forbid_text: [{ id: 'R4', glob: 'src/*.js', text: 'console.log' }] })), 'forbid_text read'); });
};

// ---- round-5 controls: "not found" must not be forgeable

function rawName(dir, rel, bytes) { return Buffer.concat([Buffer.from(path.join(dir, rel) + '/'), Buffer.from(bytes)]); }
C.non_utf8_file_name_is_exit_2 = (S) => {
  const ctx = makeRepo(); fs.mkdirSync(path.join(ctx.dir, 'hidden'));
  fs.writeFileSync(rawName(ctx.dir, 'hidden', [0x65, 0x76, 0x69, 0x6c, 0xff, 0x2e, 0x6a, 0x73]), 'BAD function (');
  expectTwo(run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'hidden/**' }] })), 'forbid_paths');
  expectTwo(run(S, ctx, L({ forbid_text: [{ id: 'R4', glob: 'hidden/**', text: 'BAD' }] })), 'forbid_text');
  expectTwo(run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'js-syntax' }] })), 'js-syntax');
  // a valid, non-ASCII UTF-8 name is an ordinary file
  const ok = makeRepo(); fs.mkdirSync(path.join(ok.dir, 'hidden')); write(ok, 'hidden/é中.js', 'BAD');
  expectViolation(run(S, ok, L({ forbid_paths: [{ id: 'R1', glob: 'hidden/**' }] })), 'R1', /é中\.js$/);
};
C.non_utf8_path_in_base_tree_is_exit_2 = (S) => {
  const ctx = makeRepo(); const env = cleanEnv();
  const gi = (args, input) => cp.execFileSync('git', args, { cwd: ctx.dir, env, input, stdio: ['pipe', 'pipe', 'pipe'] });
  const blob = String(gi(['hash-object', '-w', '--stdin'], 'x')).trim();
  const sub = String(gi(['mktree', '-z'], Buffer.concat([Buffer.from('100644 blob ' + blob + '\t'), Buffer.from([0x65, 0xff]), Buffer.from('\0')]))).trim();
  const root = String(gi(['mktree', '-z'], Buffer.from('040000 tree ' + sub + '\thidden\0'))).trim();
  const commit = String(cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit-tree', root, '-m', 'raw'], { cwd: ctx.dir, env })).trim();
  expectTwo(run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'hidden/**' }] }), { base: commit }));
};
// ENOENT from stat / readFile is "missing"; any other error is exit 2 (no fs shim needed: the
// function is called in-process with fs.statSync / fs.readFileSync patched for one path)
function withFsPatch(name, target, code, fn) {
  const orig = fs[name];
  fs[name] = function patched(p, ...rest) {
    if (String(p) === target) { const e = new Error(code); e.code = code; throw e; }
    return orig.call(fs, p, ...rest);
  };
  try { fn(); } finally { fs[name] = orig; }
}
C.read_worktree_file_enoent_is_missing = (S) => {
  const m = require(S);
  const dir = mk('gv-rw-'); const f = path.join(dir, 'x.txt'); fs.writeFileSync(f, 'hello');
  assert.strictEqual(m.readWorktreeFile(dir, 'x.txt').state, 'ok');
  for (const fnName of ['statSync', 'readFileSync']) {
    withFsPatch(fnName, f, 'ENOENT', () => assert.strictEqual(m.readWorktreeFile(dir, 'x.txt').state, 'missing', fnName + ' ENOENT'));
    withFsPatch(fnName, f, 'EACCES', () => assert.throws(() => m.readWorktreeFile(dir, 'x.txt'), /cannot (stat|read)/, fnName + ' EACCES'));
  }
};

// every case is either a negative control with at least one mutation, or listed here with a reason
const POSITIVE_ONLY = {
  clean_fixture_exits_0: 'clean baseline, asserted by the exit-0 side of the other cases',
  argv_allowed_flags_still_work: 'positive side of the argv allowlist',
  rule_40_is_allowed: 'positive side of the 40-rule cap (negative: exit2_rule_41)',
  forbid_paths_unchanged_is_clean: 'positive side of forbid_paths',
  gate_file_valid_and_env_var: 'positive side of the gate-file envelope',
  gate_file_mode_violations_hides_features: 'covered by mode-violations-skips-features',
};
function uncovered(cases, mutations, positive) {
  const covered = new Set();
  for (const m of mutations) for (const c of m.cases) covered.add(c);
  return Object.keys(cases).filter((n) => !covered.has(n) && !(n in positive));
}

// ---------------------------------------------------------------- green run

for (const [name, fn] of Object.entries(C)) {
  test('green: ' + name, () => fn(REAL));
}

test('green: --check writes nothing and uses no temp dir', () => {
  const ctx = makeRepo(); const t = mk('gv-tmp-');
  const r = run(REAL, ctx, CLEAN_RULES, { check: true, env: { TMPDIR: t } });
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(r.out, { ok: true, errors: [] });
  assert.strictEqual(git(ctx.dir, 'status', '--porcelain'), '');
  assert.deepStrictEqual(fs.readdirSync(t), []);
});

test('green: cli errors exit 2', () => {
  const ctx = makeRepo();
  const sp = (...a) => cp.spawnSync(process.execPath, [REAL, ...a], { env: cleanEnv(), encoding: 'utf8' });
  assert.strictEqual(sp('--bogus').status, 2);
  assert.strictEqual(sp('--repo', ctx.dir, '--json').status, 2); // no rule list
  assert.strictEqual(sp('--turn', 'x', '--repo', ctx.dir, '--rules', '/nonexistent', '--base', ctx.base).status, 2);
  assert.strictEqual(sp('--repo', mk('gv-nogit-'), '--rules', '/nonexistent', '--base', ctx.base).status, 2);
});

test('green: glob matcher subset', () => {
  const m = GV.matchGlob;
  assert.ok(m('src/legacy/**', 'src/legacy/a/b.js'));
  assert.ok(m('src/legacy/**', 'src/legacy'));
  assert.ok(!m('src/legacy/**', 'src/legacyx/a.js'));
  assert.ok(m('src/**/*.js', 'src/a.js'));
  assert.ok(m('src/**/*.js', 'src/a/b/c.js'));
  assert.ok(!m('src/*.js', 'src/a/b.js'));
  assert.ok(m('a?c', 'abc'));
  assert.ok(!m('a?c', 'ac'));
  assert.ok(!m('a?c', 'a/c'));
  assert.ok(!m('SRC/*.js', 'src/a.js'), 'case-sensitive');
  assert.ok(m('*', 'x') && !m('*', 'x/y'));
});

test('green: schema file matches the validator vocabulary', () => {
  assert.doesNotThrow(() => compareSchema(JSON.parse(fs.readFileSync(SCHEMA, 'utf8'))));
});

function compareSchema(schema) {
  assert.deepStrictEqual(Object.keys(schema.properties).sort(), GV.RULE_KEYS.slice().sort());
  assert.ok(schema.description.includes(String(GV.MAX_WALK_ENTRIES)), 'walk cap stated in the schema description');
  assert.deepStrictEqual(schema.$defs.argvFlag.enum.slice().sort(), GV.ALLOWED_FLAGS.slice().sort(), 'argv flag allowlist');
  const defFor = { forbid_paths: 'forbidPath', require_files: 'requireFile', require_text: 'requireText', forbid_text: 'forbidText', must_pass: 'mustPass', features: 'feature' };
  for (const [kind, spec] of Object.entries(GV.KIND_FIELDS)) {
    const def = schema.$defs[defFor[kind]];
    assert.deepStrictEqual(Object.keys(def.properties).sort(), spec.req.concat(spec.opt).sort(), kind);
    assert.deepStrictEqual(def.required.slice().sort(), spec.req.slice().sort(), kind + ' required');
    assert.strictEqual(def.additionalProperties, false);
  }
}

// ---------------------------------------------------------------- red run (mutations)

const DEAD_CASES = ['forbid_paths_modified', 'require_files_absent_until_created', 'require_text_violation',
  'forbid_text_violation', 'must_pass_violation'];

const MUTATIONS = [
  { defence: 'dead-verifier-exit-code', from: 'return result.violations.length > 0 ? 1 : 0;', to: 'return 0;', cases: DEAD_CASES },
  { defence: 'dead-verifier-no-evaluation', from: 'const result = evaluate(prep, input, repoReal, repoReal);', to: 'const result = { violations: [], feature_gaps: [] };', cases: DEAD_CASES },
  { defence: 'forbid_paths-base-fixed', from: 'const b = baseEntries(repo, base, prefix);', to: "const b = baseEntries(repo, 'HEAD', prefix);", cases: ['forbid_paths_committed_after_base'] },
  { defence: 'forbid_paths-added-detection', from: 'for (const p of w.keys()) if (!b.has(p)) changed.add(p);', to: '', cases: ['forbid_paths_untracked', 'worker_exclude_info_cannot_hide_new_file'] },
  { defence: 'forbid_paths-deleted-detection', from: 'if (!we || differs(repoReal, be, we)) changed.add(p);', to: 'if (we && differs(repoReal, be, we)) changed.add(p);', cases: ['forbid_paths_deleted'] },
  { defence: 'forbid_paths-mode-compare', from: "if (we.kind === 'file' && (be.mode === '100755') !== we.exec) return true;", to: '', cases: ['forbid_paths_mode_change'] },
  { defence: 'forbid_paths-symlink-target-compare', from: 'e.kind === \'symlink\' ? Buffer.from(fs.readlinkSync(abs)) : fs.readFileSync(abs)', to: 'e.kind === \'symlink\' ? Buffer.alloc(0) : fs.readFileSync(abs)', cases: ['forbid_paths_symlink_retarget'] },
  { defence: 'forbid_paths-kind-compare', from: 'if (baseKind(be) !== we.kind) return true;', to: '', cases: ['forbid_paths_file_replaced_by_symlink'] },
  // worker index / ignore / config must not decide what changed: swap the filesystem judgement for git's
  { defence: 'worker-ignore-rules-added-files', from: 'for (const p of w.keys()) if (!b.has(p)) changed.add(p);',
    to: "for (const p of nulList(git(repo, ['ls-files', '-z', '--others', '--exclude-standard']).stdout)) changed.add(p);",
    cases: ['worker_exclude_info_cannot_hide_new_file', 'worker_gitignore_cannot_hide_new_file'] },
  // core.excludesFile is also neutralised by the -c flag (depth); both defences are removed here
  { defence: 'worker-config-excludes-file', edits: [
    ['for (const p of w.keys()) if (!b.has(p)) changed.add(p);', "for (const p of nulList(git(repo, ['ls-files', '-z', '--others', '--exclude-standard']).stdout)) changed.add(p);"],
    ["const full = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.excludesFile=/dev/null'].concat(args);", 'const full = args;']],
    cases: ['worker_excludes_file_cannot_hide_new_file'] },
  { defence: 'worker-index-flags-modified-files', from: 'return wtBlobSha(repoReal, we) !== be.sha;',
    to: "return nulList(git(repoReal, ['diff', '--name-only', '-z', 'HEAD', '--', we.rel]).stdout).length > 0;",
    cases: ['worker_assume_unchanged_cannot_hide_edit', 'worker_skip_worktree_cannot_hide_edit'] },
  { defence: 'git-config-flags-vs-fsmonitor', edits: [
    ["const full = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.excludesFile=/dev/null'].concat(args);", 'const full = args;'],
    ['return wtBlobSha(repoReal, we) !== be.sha;', "return nulList(git(repoReal, ['diff', '--name-only', '-z', 'HEAD', '--', we.rel]).stdout).length > 0;"]],
    cases: ['worker_fsmonitor_never_runs'] },
  { defence: 'no-index-reading-git-commands', from: "const args = ['--literal-pathspecs', 'ls-tree', '-r', '-z', base];", to: "const args = ['--literal-pathspecs', 'ls-files', '-z', base];", cases: ['no_worker_state_git_commands'] },
  { defence: 'text-rules-walk-ignored-files', from: 'for (const rel of walkFiles(repo, repoReal, base, prefixOf(f.norm))) {',
    to: "for (const rel of nulList(git(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).stdout)) {", cases: ['forbid_text_sees_ignored_and_untracked'] },
  { defence: 'conflict-marker-walk-ignored-files', from: "for (const rel of walkFiles(repo, repoReal, base, '')) {",
    to: "for (const rel of nulList(git(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).stdout)) {", cases: ['builtins_see_ignored_files'] },
  { defence: 'js-syntax-walk-ignored-files', from: "for (const e of walkFs(repoReal, '', gitlinksOf(b))) {",
    to: "for (const e of walkFs(repoReal, '', gitlinksOf(b)).filter((x) => nulList(git(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).stdout).includes(x.rel))) {", cases: ['builtins_see_ignored_files'] },
  { defence: 'fake-dot-git-gitlink-by-existence', from: 'if (gitlinks.has(r)) {', to: "if (gitlinks.has(r) || (r && fs.existsSync(path.join(abs, '.git')))) {", cases: ['fake_nested_dot_git_cannot_hide_a_subtree'] },
  { defence: 'nested-dot-git-name-skipped', from: "if (!(n === '.git' && !r)) visit(", to: "if (n !== '.git') visit(", cases: ['fake_nested_dot_git_cannot_hide_a_subtree'] },
  { defence: 'submodule-commit-compare', from: 'return submoduleHead(repoReal, we.rel) !== be.sha;', to: 'return false;', cases: ['submodule_commit_change_is_a_violation'] },
  { defence: 'submodule-head-error-swallowed', edits: [['function submoduleHead(', 'function submoduleHead(repoReal, rel) { try { return submoduleHead0(repoReal, rel); } catch (e) { return null; } }\nfunction submoduleHead0(']], cases: ['submodule_head_unreadable_is_exit_2'] },
  { defence: 'submodule-own-repo-guard', from: "if (top !== fs.realpathSync(dir)) return fail(", to: "if (false) return fail(", cases: ['submodule_head_unreadable_is_exit_2'] },
  { defence: 'walk-readdir-error', from: "return fail('cannot list ' + (r || '.') + ': ' + e.code);", to: 'return;', cases: ['unreadable_directory_is_exit_2'] },
  { defence: 'walk-entry-lstat-error', from: "return fail('cannot look at ' + r + ': ' + e.code);", to: 'return;', cases: ['unsearchable_directory_is_exit_2'] },
  { defence: 'hash-read-error', from: "return fail('cannot read ' + e.rel + ': ' + err.code);", to: 'return null;', cases: ['unreadable_file_is_exit_2'] },
  { defence: 'text-read-error', from: ": fail('cannot read ' + rel + ': ' + e.code); }", to: ": { state: 'skip', reason: 'unreadable' }; }", cases: ['unreadable_file_is_exit_2'] },
  { defence: 'builtin-conflict-markers-detect', from: "return { ok: false, evidence: rel + ':' + (i + 1) };", to: 'void 0;', cases: ['builtin_conflict_markers'] },
  { defence: 'builtin-js-syntax-detect', from: "if (r.status !== 0) return { ok: false, evidence: rel + ': ' + String(r.stderr).slice(0, 200) };", to: 'void 0;', cases: ['builtin_js_syntax'] },
  { defence: 'rules-file-json-parse', from: "try { return JSON.parse(text); } catch (e) { fail(what + ' is not valid JSON'); }", to: "try { return JSON.parse(text); } catch (e) { return { v: 1 }; }", cases: ['exit2_not_json'] },
  { defence: 'walk-non-utf8-name', from: "if (!Buffer.from(str, 'utf8').equals(buf)) return fail(", to: 'if (false) return fail(', cases: ['non_utf8_file_name_is_exit_2'] },
  { defence: 'base-tree-non-utf8-path', from: "if (!Buffer.from(String(raw), 'utf8').equals(raw)) fail(", to: 'if (false) fail(', cases: ['non_utf8_path_in_base_tree_is_exit_2'] },
  { defence: 'read-file-stat-enoent-is-missing', from: "try { st = fs.statSync(real); } catch (e) { return e.code === 'ENOENT' ? { state: 'missing' } : fail('cannot stat ' + rel + ': ' + e.code); }", to: "try { st = fs.statSync(real); } catch (e) { return fail('cannot stat ' + rel + ': ' + e.code); }", cases: ['read_worktree_file_enoent_is_missing'] },
  { defence: 'read-file-read-enoent-is-missing', from: "catch (e) { return e.code === 'ENOENT' ? { state: 'missing' } : fail('cannot read ' + rel + ': ' + e.code); }", to: "catch (e) { return fail('cannot read ' + rel + ': ' + e.code); }", cases: ['read_worktree_file_enoent_is_missing'] },
  { defence: 'walk-limit', from: 'if (++walkState.n > walkState.limit) fail(', to: 'if (++walkState.n < 0) fail(', cases: ['walk_limit_exit_2'] },
  { defence: 'path-dotdot', from: "if (p.split('/').includes('..')) return { error: 'contains a .. segment' };", to: '', cases: ['exit2_dotdot'] },
  { defence: 'path-absolute', from: "if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return { error: 'absolute path' };", to: '', cases: ['exit2_absolute'] },
  { defence: 'path-symlink-containment', from: 'if (!containedInRepo(literalPrefix(n.norm, isGlob), repoReal)) {', to: 'if (false) {', cases: ['exit2_symlink_escape'] },
  { defence: 'read-symlink-containment', edits: [["if (!inside(real, repoReal)) return { state: 'skip', reason: 'outside' };", ''], [".filter((e) => e.kind === 'file').map", ".filter((e) => e.kind !== 'gitlink').map"]], cases: ['symlinked_file_outside_is_not_read'] },
  { defence: 'rule-unknown-key', from: "if (!RULE_KEYS.includes(k)) errs.push('unknown key: ' + k);", to: '', cases: ['exit2_unknown_key'] },
  { defence: 'rule-unknown-entry-key', from: 'if (!spec.req.includes(k) && !spec.opt.includes(k)) errs.push(', to: 'if (false) errs.push(', cases: ['exit2_unknown_entry_key'] },
  { defence: 'rule-duplicate-id', from: 'else if (ids.has(entry.id))', to: 'else if (false)', cases: ['exit2_dup_id'] },
  { defence: 'rule-cap-40', from: 'if (flat.length > MAX_RULES)', to: 'if (false)', cases: ['exit2_rule_41'] },
  { defence: 'rule-version', from: "if (rules.v !== 1) errs.push('v must be the integer 1');", to: '', cases: ['exit2_bad_version'] },
  { defence: 'glob-subset-metachars', from: 'if (GLOB_BAD.test(norm))', to: 'if (false)', cases: ['exit2_glob_braces', 'exit2_glob_class'] },
  { defence: 'glob-globstar-whole-segment', from: "if (seg.includes('**') && seg !== '**')", to: 'if (false)', cases: ['exit2_glob_partial_globstar'] },
  { defence: 'check-name-registered', from: "else errs.push('unregistered check name: ' + name + (reg ? '' : ' (no registry at base)'));", to: "else out.set(name, { kind: 'builtin', name });", cases: ['exit2_unregistered_check', 'exit2_missing_registry_with_must_pass'] },
  { defence: 'files-exist-at-base', from: 'if (!blobAtBase(repo, base, n.norm)) { errs.push(', to: 'if (false) { errs.push(', cases: ['exit2_files_entry_missing_at_base'] },
  { defence: 'argv-only-exported-files', from: 'if (n.error || !fileSet.has(n.norm)) errs.push(', to: 'if (n.error) errs.push(', cases: ['exit2_argv_outside_exported_files'] },
  { defence: 'argv-flag-allowlist', from: 'if (!ALLOWED_FLAGS.includes(a)) errs.push(', to: 'if (false) errs.push(', cases: ['exit2_argv_outside_exported_files', 'argv_code_flag_bypass'] },
  // the old enumerated deny-list (exact flag, split at '=') must fail the same cases: structural, not enumerated
  { defence: 'argv-denylist-regression', from: 'if (!ALLOWED_FLAGS.includes(a)) errs.push(', to: "if (['-e', '-p', '-r', '-c', '-m', '--eval', '--print', '--require', '--import'].includes(a.split('=')[0])) errs.push(", cases: ['exit2_argv_outside_exported_files', 'argv_code_flag_bypass'] },
  { defence: 'require_text-exists-at-base', from: "if (f.kind === 'require_text' && f.norm && !blobAtBase(", to: "if (false && !blobAtBase(", cases: ['exit2_require_text_path_missing_at_base'] },
  { defence: 'base-must-be-commit', from: "if (!baseResolves(repo, input.base)) fail('base does not resolve to a commit');", to: '', cases: ['exit2_base_not_a_commit'] },
  { defence: 'registry-from-base', from: "const r = git(repo, ['show', base + ':./.claude/gate-checks.json']);\n  let reg;\n  try { reg = JSON.parse(String(r.stdout)); }",
    to: "let reg;\n  try { reg = JSON.parse(fs.readFileSync(path.join(repo, '.claude/gate-checks.json'), 'utf8')); }",
    cases: ['worker_rewrites_registry', 'worker_registry_cannot_add_check'] },
  { defence: 'base-bytes-execution', from: "const blob = git(repo, ['show', base + ':./' + rel]).stdout;", to: 'const blob = fs.readFileSync(path.join(repoReal, rel));',
    cases: ['worker_rewrites_test_to_pass', 'worker_rewrites_test_to_fail', 'worker_rewrites_test_and_commits'] },
  { defence: 'scrubbed-env', from: 'cwd: tmp, env, stdio', to: 'cwd: tmp, env: process.env, stdio', cases: ['check_runs_scrubbed_in_temp_dir'] },
  { defence: 'run-outside-worker-tree', from: 'cwd: tmp, env, stdio', to: 'cwd: repoReal, env, stdio', cases: ['check_runs_scrubbed_in_temp_dir'] },
  { defence: 'temp-dir-removed', from: 'if (tmp) fs.rmSync(tmp, { recursive: true, force: true });', to: 'void 0;', cases: ['temp_dir_removed'] },
  { defence: 'hard-timeout', from: 'timeout: res.timeoutS * 1000,', to: 'timeout: 60000,', cases: ['check_timeout_is_error'] },
  { defence: 'timeout-is-error', from: "fail('check timed out after ' + res.timeoutS + 's');", to: "return { ok: false, evidence: 'timeout' };", cases: ['check_timeout_is_error'] },
  { defence: 'git-no-replace-objects', from: "env.GIT_NO_REPLACE_OBJECTS = '1';", to: 'void 0;', cases: ['replace_ref_cannot_swap_check_bytes', 'replace_ref_cannot_swap_registry', 'replace_ref_cannot_add_require_text_target'] },
  { defence: 'git-env-scrub', from: "if (!k.startsWith('GIT_'))", to: 'if (true)', cases: ['git_env_is_not_inherited'] },
  { defence: 'spawn-site-env', from: 'timeout: 20000, env: { PATH: process.env.PATH } }', to: 'timeout: 20000 }', cases: ['every_spawn_site_declares_env'] },
  { defence: 'text-too-large-is-skip', from: "if (st.size > MAX_FILE_BYTES) return { state: 'skip', reason: 'too-large' };", to: "if (st.size > MAX_FILE_BYTES) return { state: 'missing' };", cases: ['text_rule_skip_states'] },
  { defence: 'text-skip-not-missing', from: "if (r.state === 'missing') viol(", to: "if (r.state !== 'ok') viol(", cases: ['text_rule_skip_states'] },
  { defence: 'expires-at-iso', from: '!ISO_RE.test(g.expires_at) ||', to: '', cases: ['gate_file_expires_at_is_iso'] },
  { defence: 'require-files-regular-file', from: 'return inside(real, repoReal) && fs.statSync(real).isFile();', to: 'return inside(real, repoReal);', cases: ['require_files_needs_a_regular_file'] },
  { defence: 'hit-cap-forbid_paths', from: 'if (matchGlob(f.norm, rel) && n++ < MAX_HITS_PER_RULE)', to: 'if (matchGlob(f.norm, rel))', cases: ['hit_cap_forbid_paths'] },
  { defence: 'hit-cap-forbid_text', from: 'if (idx >= 0 && n++ < MAX_HITS_PER_RULE)', to: 'if (idx >= 0)', cases: ['hit_cap_forbid_text'] },
  { defence: 'rule-cap-counts-features', from: 'if (flat.length > MAX_RULES)', to: "if (flat.filter((f) => f.kind !== 'features').length > MAX_RULES)", cases: ['rule_cap_counts_features'] },
  { defence: 'registry-before-builtin', from: 'if (reg && Object.prototype.hasOwnProperty.call(reg.checks, name)) {', to: 'if (false) {', cases: ['registry_beats_builtin_of_the_same_name'] },
  { defence: 'why-label-length', from: "(typeof entry[k] !== 'string' || entry[k].length > 300)", to: "(typeof entry[k] !== 'string')", cases: ['field_limits_why_label_text_id'] },
  { defence: 'why-label-type', from: "(typeof entry[k] !== 'string' || entry[k].length > 300)", to: '(entry[k].length > 300)', cases: ['field_limits_why_label_text_id'] },
  { defence: 'text-length', from: 'entry.text.length > 1000', to: 'entry.text.length > 100000', cases: ['field_limits_why_label_text_id'] },
  { defence: 'id-format', from: "typeof entry.id !== 'string' || !ID_RE.test(entry.id)", to: "typeof entry.id !== 'string'", cases: ['field_limits_why_label_text_id'] },
  { defence: 'rule-why-in-output', from: 'rule: e.why || (kind', to: 'rule: (kind', cases: ['field_limits_why_label_text_id'] },
  { defence: 'conflict-lone-separator', from: ' || (lone && /^={7}$/.test(line))', to: '', cases: ['conflict_marker_forms'] },
  { defence: 'conflict-diff3-marker', from: '/^(<{7}|>{7}|\\|{7})( |$)/', to: '/^(<{7}|>{7})( |$)/', cases: ['conflict_marker_forms'] },
  { defence: 'conflict-prose-exemption', from: 'const lone = !/', to: 'const lone = true || !/', cases: ['conflict_marker_forms'] },
  { defence: 'argv0-exported-path', from: 'const cmd = INTERPRETERS.has(res.argv[0]) ? res.argv[0] : path.join(tmp, normaliseRel(res.argv[0], false).norm);', to: 'const cmd = res.argv[0];', cases: ['argv0_exported_script'] },
  { defence: 'gate-file-repo-binding', from: 'if (real !== repoReal)', to: 'if (false)', cases: ['gate_file_repo_mismatch'] },
  { defence: 'gate-file-max-blocks-cap', from: 'g.max_blocks > 2', to: 'g.max_blocks > 200', cases: ['gate_file_bad_fields'] },
  { defence: 'gate-file-unknown-field', from: "if (!GATE_KEYS.includes(k)) errs.push('unknown gate-file key: ' + k);", to: '', cases: ['gate_file_bad_fields'] },
  { defence: 'mode-violations-skips-features', from: "if (input.mode === 'violations+features') {", to: 'if (true) {', cases: ['gate_file_mode_violations_hides_features', 'feature_gap_not_violation'] },
];

const SRC = fs.readFileSync(REAL, 'utf8');

for (const m of MUTATIONS) {
  test('red: removing ' + m.defence + ' turns ' + m.cases.join(', ') + ' red', () => {
    let text = SRC;
    for (const [from, to] of (m.edits || [[m.from, m.to]])) {
      const occurrences = text.split(from).length - 1;
      assert.strictEqual(occurrences, 1, 'mutation anchor must appear exactly once, found ' + occurrences + ': ' + from.slice(0, 60));
      text = text.replace(from, () => to);
    }
    const dir = mk('gv-mut-');
    const mutated = path.join(dir, 'gate-verify.js');
    fs.writeFileSync(mutated, text);
    for (const name of m.cases) {
      let msg = null;
      try { C[name](mutated); } catch (e) { msg = String(e.message || e).split('\n')[0].slice(0, 200); }
      assert.ok(msg !== null, 'case ' + name + ' stayed green with ' + m.defence + ' removed: the control guards nothing');
      console.log('RED(' + m.defence + ') ' + name + ': ' + msg);
    }
  });
}

test('green: every case is a negative control with a mutation, or listed positive-only', () => {
  assert.deepStrictEqual(uncovered(C, MUTATIONS, POSITIVE_ONLY), []);
  for (const n of Object.keys(POSITIVE_ONLY)) assert.ok(n in C, 'stale positive-only entry ' + n);
});

test('red: the coverage check flags a case no mutation guards', () => {
  const fake = { ...C, a_new_case_nobody_mutates: () => {} };
  assert.deepStrictEqual(uncovered(fake, MUTATIONS, POSITIVE_ONLY), ['a_new_case_nobody_mutates']);
});

test('red: a schema file that drifts from the validator fails the pin', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  schema.properties.exec = { type: 'array' };
  assert.throws(() => compareSchema(schema));
  const s2 = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  delete s2.$defs.mustPass.properties.check;
  assert.throws(() => compareSchema(s2));
  const s3 = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  s3.$defs.argvFlag.enum.push('-c');
  assert.throws(() => compareSchema(s3));
});
