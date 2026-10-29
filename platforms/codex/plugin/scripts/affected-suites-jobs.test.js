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
    const env = { AUTOPILOT_TEST_DURATIONS_FILE: tmpTsv() };
    const p = run(r.dir, ['--jobs', '3'], env);
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    const rows = fs.readFileSync(path.join(r.dir, 'env.log'), 'utf8').trim().split('\n').map((l) => l.split(' '));
    assert.strictEqual(rows.length, 5);
    assert.strictEqual(new Set(rows.map((x) => x[0])).size, 5);
    assert.strictEqual(new Set(rows.map((x) => x[1])).size, 5);
    for (const x of rows) assert.match(x[0], /affected-suites-jobs-[^/]+\/\d+\/tmp$/);
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
    const anchor = 'const again = await exec(rel, 1);';
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
