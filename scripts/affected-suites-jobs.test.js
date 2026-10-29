'use strict';
// node --test scripts/affected-suites-jobs.test.js
// BL-0330 (per-suite seconds + durations tsv) and BL-0331 (--jobs N pool). Fake suites in a throwaway git repo; no real suite runs.
// Negative controls are inline: (a) a self-interfering suite taken off the serial list is caught, (b) a copy of the runner
// with the serial rerun removed turns the flaky case red, (c) no durations file falls back to name order.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SEL = process.env.AFFECTED_SUITES_BIN || path.join(__dirname, 'affected-suites.js'); // env: run the suite against a mutated runner copy

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-suites-jobs-test-'));
  fs.mkdirSync(path.join(dir, 'hooks', 'tests', 'lib'), { recursive: true });
  for (const [p, body] of Object.entries({ 'scripts/seed.js': 'x\n', ...files })) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, stdio: 'pipe' }).toString().trim();
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base');
  return { dir, cleanup() { fs.rmSync(dir, { recursive: true, force: true }); } };
}

// A suite names scripts/seed.js so `--files scripts/seed.js` selects it.
const suite = (body) => `#!/usr/bin/env bash\n: scripts/seed.js\n${body}\n`;
const SERIAL_LIST = 'hooks/tests/lib/serial-suites.txt';

function run(dir, args, env = {}, bin = SEL) {
  const e = { ...process.env, ...env };
  delete e.NODE_TEST_CONTEXT; delete e.NODE_TEST_WORKER_ID;
  delete e.AUTOPILOT_TEST_TIMING_FACTOR;
  Object.assign(e, env);
  const t0 = Date.now();
  const r = spawnSync('node', [bin, '--root', dir, '--run', '--files', 'scripts/seed.js', ...args], { encoding: 'utf8', env: e });
  return { ...r, wall: (Date.now() - t0) / 1000 };
}
const rcSet = (out) => [...out.matchAll(/^rc=(\d+) (\S+)$/gm)].map((m) => `${m[1]} ${m[2]}`).sort();
const tmpTsv = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durs-')), 'test-durations.tsv');
const num = (f) => Number(fs.readFileSync(f, 'utf8').trim());

test('--jobs 1 and no flag are byte-for-byte identical (stdout, stderr, status)', () => {
  const r = makeRepo({
    'hooks/tests/a.test.sh': suite('echo hello-a'),
    'hooks/tests/b.test.sh': suite('echo oops >&2; exit 3'),
    'hooks/tests/c.test.sh': suite('echo hello-c'),
  });
  try {
    const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() };
    const plain = run(r.dir, [], env);
    const one = run(r.dir, ['--jobs', '1'], env);
    assert.strictEqual(plain.status, 1);
    assert.strictEqual(one.stdout, plain.stdout);
    assert.strictEqual(one.stderr, plain.stderr);
    assert.strictEqual(one.status, plain.status);
    assert.match(plain.stdout, /summary: 3 run, 1 failed\n$/);
  } finally { r.cleanup(); }
});

test('--record carries seconds per suite (rc line unchanged) and the durations tsv is written in run.sh format; a fixture root without the env var writes nothing', () => {
  const r = makeRepo({ 'hooks/tests/a.test.sh': suite('sleep 1'), 'scripts/seed.js': 'x\n' });
  try {
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: r.dir }).toString().trim();
    const base = g('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(r.dir, 'scripts', 'seed.js'), 'y\n');
    g('add', '-A'); g('commit', '-qm', 'seed');
    const rec = path.join(r.dir, 'rec.json');
    const tsv = tmpTsv();
    const e = { ...process.env, AUTOPILOT_TEST_DURATIONS_FILE: tsv }; delete e.NODE_TEST_CONTEXT; delete e.NODE_TEST_WORKER_ID;
    const ok = spawnSync('node', [SEL, '--root', r.dir, '--base', base, '--head', 'HEAD', '--run', '--record', rec], { encoding: 'utf8', env: e });
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /^rc=0 hooks\/tests\/a\.test\.sh$/m);
    const doc = JSON.parse(fs.readFileSync(rec, 'utf8'));
    assert.strictEqual(doc.suites.length, 1);
    assert.deepStrictEqual(Object.keys(doc.suites[0]), ['path', 'rc', 'seconds']);
    assert.ok(doc.suites[0].seconds >= 1 && doc.suites[0].seconds < 10, String(doc.suites[0].seconds));
    assert.match(fs.readFileSync(tsv, 'utf8'), /^hooks\/tests\/a\.test\.sh\t1\n$/);
    // Same fixture root, no env var: the shared history file is not touched.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const e2 = { ...e, HOME: home, XDG_CACHE_HOME: path.join(home, 'c') }; delete e2.AUTOPILOT_TEST_DURATIONS_FILE;
    spawnSync('node', [SEL, '--root', r.dir, '--base', base, '--head', 'HEAD', '--run'], { encoding: 'utf8', env: e2 });
    assert.strictEqual(fs.existsSync(path.join(home, 'c')), false);
  } finally { r.cleanup(); }
});

test('--jobs 4 runs 8 one-second suites in clearly less wall time than serial, with the same rc set', () => {
  const files = {};
  for (let i = 0; i < 8; i++) files[`hooks/tests/s${i}.test.sh`] = suite(i === 5 ? 'sleep 1; exit 2' : 'sleep 1');
  const r = makeRepo(files);
  try {
    const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() };
    const ser = run(r.dir, [], env);
    const par = run(r.dir, ['--jobs', '4'], env);
    assert.deepStrictEqual(rcSet(par.stdout), rcSet(ser.stdout));
    assert.strictEqual(par.status, 1);
    assert.match(par.stdout, /summary: 8 run, 1 failed\n/);
    assert.match(par.stdout, /\nslowest: /);
    assert.ok(ser.wall >= 8, `serial ${ser.wall}`);
    assert.ok(par.wall < ser.wall * 0.6, `parallel ${par.wall} vs serial ${ser.wall}`);
  } finally { r.cleanup(); }
});

test('each pool entry gets its own TMPDIR / XDG_RUNTIME_DIR and the timing factor defaults to N (a caller value wins; serial part gets 1)', () => {
  const files = {};
  for (let i = 0; i < 4; i++) files[`hooks/tests/e${i}.test.sh`] = suite(`echo "$TMPDIR $XDG_RUNTIME_DIR $AUTOPILOT_TEST_TIMING_FACTOR" >> "$PWD/env.log"`);
  files['hooks/tests/zser.test.sh'] = suite('echo "$TMPDIR $XDG_RUNTIME_DIR $AUTOPILOT_TEST_TIMING_FACTOR" >> "$PWD/env.log"');
  files[SERIAL_LIST] = 'hooks/tests/zser.test.sh\n';
  const r = makeRepo(files);
  try {
    const callerXdg = fs.mkdtempSync(path.join(os.tmpdir(), 'caller-xdg-'));
    const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv(), XDG_RUNTIME_DIR: callerXdg };
    const p = run(r.dir, ['--jobs', '3'], env);
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    const rows = fs.readFileSync(path.join(r.dir, 'env.log'), 'utf8').trim().split('\n').map((l) => l.split(' '));
    assert.strictEqual(rows.length, 5);
    assert.strictEqual(new Set(rows.map((x) => x[0])).size, 5);
    const poolRows = rows.filter((x) => x[2] === '3');
    assert.strictEqual(new Set(poolRows.map((x) => x[1])).size, 4); // pool entries: private XDG_RUNTIME_DIR each
    for (const x of poolRows) assert.ok(x[1].startsWith(`${callerXdg}/asj.`) && /\/\d+$/.test(x[1]), x[1]); // under the caller's XDG, never under /tmp
    assert.deepStrictEqual(rows.filter((x) => x[2] === '1').map((x) => x[1]), [callerXdg]); // serial part: the caller's, like a direct run
    for (const x of rows) assert.match(x[0], /asj\.[^/]+\/\d+$/);
    assert.deepStrictEqual(rows.map((x) => x[2]).sort(), ['1', '3', '3', '3', '3']);
    fs.rmSync(path.join(r.dir, 'env.log'));
    run(r.dir, ['--jobs', '3'], { ...env, AUTOPILOT_TEST_TIMING_FACTOR: '7' });
    assert.deepStrictEqual(fs.readFileSync(path.join(r.dir, 'env.log'), 'utf8').trim().split('\n').map((l) => l.split(' ')[2]), ['7', '7', '7', '7', '7']);
  } finally { r.cleanup(); }
});

// Suites that log "<start> <end>" (ns) to $PWD/times/<name>.
const timed = (name, secs) => suite(`mkdir -p "$PWD/times"; s=$(date +%s%N); sleep ${secs}; e=$(date +%s%N); echo "$s $e" > "$PWD/times/${name}"`);
const interval = (dir, name) => fs.readFileSync(path.join(dir, 'times', name), 'utf8').trim().split(' ').map(Number);
const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

test('a suite on the serial list never overlaps a pool suite; taking it off the list lets it overlap (negative control)', () => {
  const files = { 'hooks/tests/aser.test.sh': timed('aser', 0.6) };
  for (let i = 0; i < 4; i++) files[`hooks/tests/p${i}.test.sh`] = timed(`p${i}`, 1);
  const withList = { ...files, [SERIAL_LIST]: '# comment\nhooks/tests/aser.test.sh   # trailing\n' };
  const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() };
  let r = makeRepo(withList);
  try {
    const p = run(r.dir, ['--jobs', '4'], env);
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    const ser = interval(r.dir, 'aser');
    for (let i = 0; i < 4; i++) assert.ok(!overlaps(ser, interval(r.dir, `p${i}`)), `aser overlaps p${i}`);
    // listed suite is after every pool entry in the printed order
    const order = rcSet(p.stdout);
    assert.strictEqual(order.length, 5);
    const idx = (n) => p.stdout.indexOf(`rc=0 hooks/tests/${n}.test.sh`);
    for (let i = 0; i < 4; i++) assert.ok(idx(`p${i}`) < idx('aser'));
  } finally { r.cleanup(); }
  r = makeRepo({ ...files, [SERIAL_LIST]: '' });
  try {
    const p = run(r.dir, ['--jobs', '4'], env);
    const ser = interval(r.dir, 'aser');
    assert.ok([0, 1, 2, 3].some((i) => overlaps(ser, interval(r.dir, `p${i}`))), 'negative control: without the list the suite overlaps the pool');
    assert.strictEqual(p.status, 0);
  } finally { r.cleanup(); }
});

// Two suites that share a fixed lock directory: one of them fails when the other holds it.
const LOCKER = suite('if mkdir "$PWD/.shared-lock" 2>/dev/null; then sleep 1; rmdir "$PWD/.shared-lock"; else echo collided; exit 1; fi');

test('fixed-path interference: on the serial list both pass with no flaky label; off the list the collision is caught (negative control a)', () => {
  const base = { 'hooks/tests/l1.test.sh': LOCKER, 'hooks/tests/l2.test.sh': LOCKER };
  const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() };
  let r = makeRepo({ ...base, [SERIAL_LIST]: 'hooks/tests/l1.test.sh\nhooks/tests/l2.test.sh\n' });
  try {
    const p = run(r.dir, ['--jobs', '4'], env);
    assert.strictEqual(p.status, 0, p.stdout);
    assert.doesNotMatch(p.stdout, /flaky-under-parallel/);
  } finally { r.cleanup(); }
  r = makeRepo({ ...base, [SERIAL_LIST]: '' });
  try {
    const p = run(r.dir, ['--jobs', '4'], env);
    assert.match(p.stdout, /^flaky-under-parallel: hooks\/tests\/l[12]\.test\.sh \(rc=1 in pool\)$/m, 'interference must be visible');
  } finally { r.cleanup(); }
});

const FLAKY_FILES = {
  // fails only while a sibling is running (the sibling marks itself for 2 s)
  'hooks/tests/a-busy.test.sh': suite('touch "$PWD/.busy"; sleep 2; rm -f "$PWD/.busy"'),
  'hooks/tests/flaky.test.sh': suite('sleep 0.5; if [ -e "$PWD/.busy" ]; then echo sibling-running; exit 1; fi'),
  'hooks/tests/always-red.test.sh': suite('echo really-broken; exit 4'),
};

test('flaky under parallel: serial rerun passes -> labelled, rc=0, record flag; an always-red suite stays red', () => {
  const r = makeRepo(FLAKY_FILES);
  try {
    const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() };
    const p = run(r.dir, ['--jobs', '3'], env);
    assert.match(p.stdout, /^flaky-under-parallel: hooks\/tests\/flaky\.test\.sh \(rc=1 in pool\)\nrc=0 hooks\/tests\/flaky\.test\.sh$/m);
    assert.doesNotMatch(p.stdout, /rc=1 hooks\/tests\/flaky/);
    assert.match(p.stdout, /^really-broken\nrc=4 hooks\/tests\/always-red\.test\.sh$/m);
    assert.doesNotMatch(p.stdout, /flaky-under-parallel: hooks\/tests\/always-red/);
    assert.match(p.stdout, /summary: 3 run, 1 failed\n/);
    assert.strictEqual(p.status, 1);
  } finally { r.cleanup(); }
});

test('flaky under parallel: --record marks flaky_under_parallel and keeps seconds; works with --entry-timeout', () => {
  const r = makeRepo({ ...FLAKY_FILES, 'scripts/seed.js': 'x\n' });
  try {
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: r.dir }).toString().trim();
    const base = g('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(r.dir, 'scripts', 'seed.js'), 'y\n');
    g('add', '-A'); g('commit', '-qm', 'c');
    const rec = path.join(r.dir, 'rec.json');
    const e = { ...process.env, AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() }; delete e.NODE_TEST_CONTEXT; delete e.NODE_TEST_WORKER_ID;
    const p = spawnSync('node', [SEL, '--root', r.dir, '--base', base, '--head', 'HEAD', '--run', '--jobs', '3', '--entry-timeout', '30', '--record', rec], { encoding: 'utf8', env: e });
    const doc = JSON.parse(fs.readFileSync(rec, 'utf8'));
    const by = Object.fromEntries(doc.suites.map((s) => [s.path, s]));
    assert.strictEqual(by['hooks/tests/flaky.test.sh'].rc, 0);
    assert.strictEqual(by['hooks/tests/flaky.test.sh'].flaky_under_parallel, true);
    assert.strictEqual(by['hooks/tests/always-red.test.sh'].rc, 4);
    assert.strictEqual(by['hooks/tests/always-red.test.sh'].flaky_under_parallel, undefined);
    for (const s of doc.suites) assert.strictEqual(typeof s.seconds, 'number');
    assert.strictEqual(p.status, 1);
  } finally { r.cleanup(); }
});

test('negative control b: a runner copy without the serial rerun turns the flaky case red', () => {
  const r = makeRepo(FLAKY_FILES);
  try {
    const src = fs.readFileSync(SEL, 'utf8');
    const anchor = 'const again = await exec(rel, 1, false);';
    assert.ok(src.includes(anchor), 'mutation anchor drifted');
    const mutant = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mut-')), 'affected-suites.js');
    fs.writeFileSync(mutant, src.replace(anchor, 'const again = r;'));
    const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() };
    const p = run(r.dir, ['--jobs', '3'], env, mutant);
    assert.match(p.stdout, /^rc=1 hooks\/tests\/flaky\.test\.sh$/m);
    assert.match(p.stdout, /summary: 3 run, 2 failed\n/);
    assert.doesNotMatch(p.stdout, /flaky-under-parallel/);
  } finally { r.cleanup(); }
});

test('durations: slowest first from the tsv; no tsv falls back to name order without crashing and creates it (negative control c)', () => {
  const files = {};
  for (const n of ['a', 'b', 'c', 'd']) files[`hooks/tests/${n}.test.sh`] = timed(n, 0.7);
  const r = makeRepo(files);
  try {
    const tsv = tmpTsv();
    fs.writeFileSync(tsv, 'hooks/tests/d.test.sh\t100\nhooks/tests/c.test.sh\t50\nhooks/tests/a.test.sh\t1\nhooks/tests/b.test.sh\t1\ngarbage line\n');
    let p = run(r.dir, ['--jobs', '2'], { AUTOPILOT_TEST_DURATIONS_FILE: tsv });
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    const st = (n) => interval(r.dir, n)[0];
    assert.ok(st('c') < st('a') && st('c') < st('b') && st('d') < st('a') && st('d') < st('b'), 'slow files start first');
    // run.sh format kept: one tsv row per suite, integer seconds, merged over old rows
    assert.match(fs.readFileSync(tsv, 'utf8'), /^hooks\/tests\/a\.test\.sh\t1\nhooks\/tests\/b\.test\.sh\t1\nhooks\/tests\/c\.test\.sh\t1\nhooks\/tests\/d\.test\.sh\t1\n$/);
    fs.rmSync(path.join(r.dir, 'times'), { recursive: true });
    const missing = path.join(path.dirname(tsv), 'gone', 'test-durations.tsv');
    p = run(r.dir, ['--jobs', '2'], { AUTOPILOT_TEST_DURATIONS_FILE: missing });
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    assert.ok(st('a') < st('c') && st('b') < st('d'), 'name order without history');
    assert.ok(fs.existsSync(missing));
  } finally { r.cleanup(); }
});

test('--entry-timeout with --jobs: a hung suite is rc 124, listed in the summary, others still pass', () => {
  const r = makeRepo({ 'hooks/tests/hang.test.sh': suite('sleep 30'), 'hooks/tests/ok.test.sh': suite('true') });
  try {
    const p = run(r.dir, ['--jobs', '2', '--entry-timeout', '1'], { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() });
    assert.match(p.stdout, /^rc=124 hooks\/tests\/hang\.test\.sh$/m);
    assert.match(p.stdout, /^rc=0 hooks\/tests\/ok\.test\.sh$/m);
    assert.match(p.stdout, /summary: 2 run, 1 failed \(timeout: hooks\/tests\/hang\.test\.sh\)\n/);
    assert.strictEqual(p.status, 1);
    assert.ok(p.wall < 20, String(p.wall));
  } finally { r.cleanup(); }
});

test('usage: --jobs needs --run, a positive integer, and excludes --budget-seconds when N>1', () => {
  const r = makeRepo({ 'hooks/tests/a.test.sh': suite('true') });
  try {
    const x = (args) => spawnSync('node', [SEL, '--root', r.dir, '--files', 'scripts/seed.js', ...args], { encoding: 'utf8' });
    assert.strictEqual(x(['--jobs', '2']).status, 2);
    for (const bad of ['0', 'x', '-1', '1.5']) assert.strictEqual(x(['--run', '--jobs', bad]).status, 2, bad);
    assert.strictEqual(x(['--run', '--jobs', '2', '--budget-seconds', '5']).status, 2);
  } finally { r.cleanup(); }
});

// ---- review round 1: rerun is final, pool-timeout label, slowest placement, durations lock ----

function recRun(r, args, env = {}) {
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: r.dir }).toString().trim();
  const base = g('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(r.dir, 'scripts', 'seed.js'), 'changed\n');
  g('add', '-A'); g('commit', '-qm', 'c');
  const rec = path.join(r.dir, 'rec.json');
  const e = { ...process.env, AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv(), ...env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_TEST_WORKER_ID; delete e.AUTOPILOT_TEST_TIMING_FACTOR;
  const p = spawnSync('node', [SEL, '--root', r.dir, '--base', base, '--head', 'HEAD', '--run', '--record', rec, ...args], { encoding: 'utf8', env: e });
  return { p, doc: JSON.parse(fs.readFileSync(rec, 'utf8')) };
}
// Different result on the second run of the same suite: first = $1, second = $2 (a number, or "hang" to sleep).
const twoStage = (first, second) => suite(`n="$PWD/.n-$(basename "$0")"; if [ ! -e "$n" ]; then : > "$n"; ${first}; fi; ${second}`);

test('rerun still red: the rerun is final (rc 2 not the pool rc 1), in output and record', () => {
  const r = makeRepo({ 'hooks/tests/x.test.sh': twoStage('echo pool-run; exit 1', 'echo rerun; exit 2'), 'hooks/tests/ok.test.sh': suite('true') });
  try {
    const { p, doc } = recRun(r, ['--jobs', '2']);
    assert.match(p.stdout, /^rerun\nrc=2 hooks\/tests\/x\.test\.sh$/m);
    assert.doesNotMatch(p.stdout, /pool-run|rc=1 hooks\/tests\/x/);
    assert.match(p.stdout, /summary: 2 run, 1 failed\n/);
    const x = doc.suites.find((s) => s.path === 'hooks/tests/x.test.sh');
    assert.strictEqual(x.rc, 2);
    assert.strictEqual(x.flaky_under_parallel, undefined);
    assert.strictEqual(p.status, 1);
  } finally { r.cleanup(); }
});

test('rerun times out after a pool rc=1: rc 124, summary timeout list and record say so', () => {
  const r = makeRepo({ 'hooks/tests/x.test.sh': twoStage('exit 1', 'sleep 30') });
  try {
    const { p, doc } = recRun(r, ['--jobs', '2', '--entry-timeout', '1']);
    assert.match(p.stdout, /^rc=124 hooks\/tests\/x\.test\.sh$/m);
    assert.match(p.stdout, /summary: 1 run, 1 failed \(timeout: hooks\/tests\/x\.test\.sh\)\n/);
    assert.strictEqual(doc.suites[0].rc, 124);
    assert.strictEqual(p.status, 1);
  } finally { r.cleanup(); }
});

test('pool timeout but green rerun is labelled "timeout in pool" and the record tells it from an rc flake', () => {
  const r = makeRepo({ 'hooks/tests/t.test.sh': twoStage('sleep 30', 'true'), 'hooks/tests/f.test.sh': twoStage('exit 1', 'true') });
  try {
    const { p, doc } = recRun(r, ['--jobs', '2', '--entry-timeout', '1']);
    assert.match(p.stdout, /^flaky-under-parallel: hooks\/tests\/t\.test\.sh \(timeout in pool\)$/m);
    assert.match(p.stdout, /^flaky-under-parallel: hooks\/tests\/f\.test\.sh \(rc=1 in pool\)$/m);
    const by = Object.fromEntries(doc.suites.map((s) => [s.path, s]));
    assert.strictEqual(by['hooks/tests/t.test.sh'].pool_timed_out, true);
    assert.strictEqual(by['hooks/tests/t.test.sh'].pool_rc, 124);
    assert.strictEqual(by['hooks/tests/f.test.sh'].pool_timed_out, undefined);
    assert.strictEqual(by['hooks/tests/f.test.sh'].pool_rc, 1);
    assert.strictEqual(by['hooks/tests/f.test.sh'].flaky_under_parallel, true);
    assert.match(p.stdout, /summary: 2 run, 0 failed\n/);
    assert.strictEqual(p.status, 0);
  } finally { r.cleanup(); }
});

test('with --jobs the slowest line comes after the record line', () => {
  const r = makeRepo({ 'hooks/tests/a.test.sh': suite('true'), 'hooks/tests/b.test.sh': suite('true') });
  try {
    const { p } = recRun(r, ['--jobs', '2']);
    assert.match(p.stdout, /summary: 2 run, 0 failed\nrecord: [^\n]+\nslowest: [^\n]+\n$/);
  } finally { r.cleanup(); }
});

// Durations lock. A delay is injected between the read and the write of the tsv (in a runner copy, so the product has
// no test seam); the same copy minus the lock must lose a row.
const DELAY = "const merged = readDurations(file); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);";
function runnerCopy({ noLock }) {
  let src = fs.readFileSync(path.join(__dirname, 'affected-suites.js'), 'utf8');
  const a1 = 'const merged = readDurations(file);';
  const a2 = "const lockedRun = (opts, fn) => require('./lib/jsonl-store.js').withWriteLock(opts, fn);";
  assert.ok(src.includes(a1) && src.includes(a2), 'mutation anchors drifted');
  src = src.replace(a1, DELAY);
  if (noLock) src = src.replace(a2, 'const lockedRun = (opts, fn) => fn();');
  src = src.replace("require('./lib/jsonl-store.js')", `require(${JSON.stringify(path.join(__dirname, 'lib', 'jsonl-store.js'))})`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durlock-'));
  const f = path.join(dir, 'affected-suites.js');
  fs.writeFileSync(f, src);
  return f;
}
async function twoWriters(bin) {
  const tsv = tmpTsv();
  const repos = ['one', 'two'].map((n) => makeRepo({ [`hooks/tests/${n}.test.sh`]: suite('true') }));
  try {
    const e = { ...process.env, AUTOPILOT_TEST_DURATIONS_FILE: tsv };
    delete e.NODE_TEST_CONTEXT; delete e.NODE_TEST_WORKER_ID;
    await Promise.all(repos.map((r) => new Promise((resolve) => {
      const c = require('child_process').spawn('node', [bin, '--root', r.dir, '--run', '--files', 'scripts/seed.js'], { env: e, stdio: 'ignore' });
      c.on('close', resolve);
    })));
    return fs.readFileSync(tsv, 'utf8');
  } finally { repos.forEach((r) => r.cleanup()); }
}

test('two runs writing durations at the same time keep both rows (lock); the same race without the lock loses one (negative control)', async () => {
  const locked = await twoWriters(runnerCopy({ noLock: false }));
  assert.match(locked, /hooks\/tests\/one\.test\.sh\t\d+\n/);
  assert.match(locked, /hooks\/tests\/two\.test\.sh\t\d+\n/);
  const raced = await twoWriters(runnerCopy({ noLock: true }));
  const rows = raced.trim().split('\n').filter(Boolean);
  assert.strictEqual(rows.length, 1, `without the lock one writer's row is overwritten, got ${JSON.stringify(rows)}`);
});

test('a lock that cannot be taken is a warning, not a hang or a failure', () => {
  const r = makeRepo({ 'hooks/tests/a.test.sh': suite('true') });
  try {
    const tsv = tmpTsv();
    // a live holder: this very test process
    fs.writeFileSync(`${tsv}.lock`, String(process.pid));
    const src = fs.readFileSync(SEL, 'utf8').replace('timeoutMs: 10000', 'timeoutMs: 300');
    const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lockto-')), 'affected-suites.js');
    fs.writeFileSync(bin, src.replace("require('./lib/jsonl-store.js')", `require(${JSON.stringify(path.join(__dirname, 'lib', 'jsonl-store.js'))})`));
    const p = run(r.dir, [], { AUTOPILOT_TEST_DURATIONS_FILE: tsv }, bin);
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stderr, /durations not recorded: timed out waiting for durations lock/);
    assert.strictEqual(fs.existsSync(tsv), false);
  } finally { r.cleanup(); }
});

// ---- jobsfix: false reds under --jobs (2026-10-29) ----

test('a rerun never sees the pool run\'s TMPDIR: marker left by the first run does not poison the rerun; flaky is labelled (negative control: reuse the old dir -> red)', () => {
  // first run leaves a marker in $TMPDIR and fails; a run that finds a marker fails; otherwise green
  const files = { 'hooks/tests/marker.test.sh': suite('if [ -e "$TMPDIR/marker" ]; then echo marker-found; exit 1; fi; touch "$TMPDIR/marker"; exit 1'),
    'hooks/tests/marker2.test.sh': suite('if [ -e "$TMPDIR/marker" ]; then echo marker-found; exit 1; fi; if [ ! -e "$PWD/.seen" ]; then touch "$TMPDIR/marker" "$PWD/.seen"; exit 1; fi; exit 0') };
  const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() };
  let r = makeRepo(files);
  try {
    const p = run(r.dir, ['--jobs', '2'], env);
    assert.match(p.stdout, /^flaky-under-parallel: hooks\/tests\/marker2\.test\.sh \(rc=1 in pool\)\nrc=0 hooks\/tests\/marker2\.test\.sh$/m, p.stdout);
    assert.doesNotMatch(p.stdout, /marker-found/);
  } finally { r.cleanup(); }
  // negative control: a runner copy whose rerun reuses the pool run's directory index must go red
  r = makeRepo(files);
  const mutated = path.join(r.dir, 'affected-suites-mutated.js');
  try {
    const src = fs.readFileSync(SEL, 'utf8');
    const needle = 'const dir = path.join(base, String(idx));';
    assert.ok(src.includes(needle));
    // every call uses directory "0" (the rerun reuses the pool run's directory)
    fs.writeFileSync(mutated, src.replace(needle, "const dir = path.join(base, '0');").replace('fs.mkdirSync(dir, { mode: 0o700 });', 'fs.mkdirSync(dir, { recursive: true, mode: 0o700 });').replace('fs.mkdirSync(xdg, { mode: 0o700 });', 'fs.mkdirSync(xdg, { recursive: true, mode: 0o700 });').replace(/require\('\.\//g, "require('" + path.dirname(SEL) + '/'));
    const p = run(r.dir, ['--jobs', '2'], env, mutated);
    assert.match(p.stdout, /marker-found/, 'negative control must go red: ' + p.stdout);
  } finally { r.cleanup(); }
});

test('serial part keeps the caller\'s XDG_RUNTIME_DIR; a suite that fails under a per-entry one is green serial (negative control: a pool-style XDG for the serial part -> red)', () => {
  // red when XDG_RUNTIME_DIR is a per-entry directory (as dispatch-detach was), green when it is the caller's
  const files = { 'hooks/tests/xdgdep.test.sh': suite('[ "$XDG_RUNTIME_DIR" = "$EXPECT_XDG" ] || { echo per-entry-xdg; exit 1; }'),
    [SERIAL_LIST]: 'hooks/tests/xdgdep.test.sh\n' };
  const callerXdg = fs.mkdtempSync(path.join(os.tmpdir(), 'caller-xdg-'));
  const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv(), XDG_RUNTIME_DIR: callerXdg, EXPECT_XDG: callerXdg };
  let r = makeRepo(files);
  try {
    const p = run(r.dir, ['--jobs', '2'], env);
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    assert.doesNotMatch(p.stdout, /flaky-under-parallel|per-entry-xdg/);
  } finally { r.cleanup(); }
  r = makeRepo(files);
  const mutated = path.join(r.dir, 'affected-suites-mutated.js');
  try {
    const src = fs.readFileSync(SEL, 'utf8');
    const needle = 'isolateXdg ? xdgBase : null';
    assert.ok(src.includes(needle));
    fs.writeFileSync(mutated, src.replace(needle, 'xdgBase').replace(/require\('\.\//g, "require('" + path.dirname(SEL) + '/'));
    const p = run(r.dir, ['--jobs', '2'], env, mutated);
    assert.match(p.stdout, /per-entry-xdg/);
    assert.strictEqual(p.status, 1);
  } finally { r.cleanup(); }
});

test('the per-entry TMPDIR is 0700 and short (suites build unix socket paths under it: engine-qualify-a went red in pool and rerun with the long nested one); negative controls: 0775 and the old long prefix are red', () => {
  const files = { 'hooks/tests/mode.test.sh': suite('m=$(stat -c %a "$TMPDIR"); echo "mode=$m len=${#TMPDIR}" > "$PWD/mode.log"; [ "$m" = 700 ] && [ "${#TMPDIR}" -le 24 ]') };
  const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv(), TMPDIR: '/tmp' };
  const mutate = (r, from, to) => {
    const mutated = path.join(r.dir, 'affected-suites-mutated.js');
    const src = fs.readFileSync(SEL, 'utf8');
    assert.ok(src.includes(from), `mutation anchor drifted: ${from}`);
    fs.writeFileSync(mutated, src.replace(from, to).replace(/require\('\.\//g, "require('" + path.dirname(SEL) + '/'));
    return mutated;
  };
  let r = makeRepo(files);
  try {
    const p = run(r.dir, ['--jobs', '2'], env);
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    assert.match(fs.readFileSync(path.join(r.dir, 'mode.log'), 'utf8').trim(), /^mode=700 len=\d+$/);
  } finally { r.cleanup(); }
  r = makeRepo(files);
  try {
    const q = run(r.dir, ['--jobs', '2'], env, mutate(r, 'fs.chmodSync(dir, 0o700);', 'fs.chmodSync(dir, 0o775);'));
    assert.strictEqual(q.status, 1, 'negative control (mode) must go red');
  } finally { r.cleanup(); }
  r = makeRepo(files);
  try {
    const q = run(r.dir, ['--jobs', '2'], env, mutate(r, "path.join(os.tmpdir(), 'asj.')", "path.join(os.tmpdir(), 'affected-suites-jobs-')"));
    assert.strictEqual(q.status, 1, 'negative control (long path) must go red');
  } finally { r.cleanup(); }
});

test('a process left behind in a pool entry\'s process group is gone before the serial part starts (guard; a setsid escapee is outside any group and out of scope)', () => {
  const files = { 'hooks/tests/leaver.test.sh': suite('sleep 30 & echo $! > "$PWD/leaked.pid"; sleep 0.2'),
    'hooks/tests/zser.test.sh': suite('kill -0 "$(cat "$PWD/leaked.pid")" 2>/dev/null && { echo leaked-alive; exit 1; }; exit 0'),
    [SERIAL_LIST]: 'hooks/tests/zser.test.sh\n' };
  const r = makeRepo(files);
  try {
    const p = run(r.dir, ['--jobs', '2'], { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() });
    assert.doesNotMatch(p.stdout, /leaked-alive/, p.stdout + p.stderr);
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
  } finally { r.cleanup(); }
});
