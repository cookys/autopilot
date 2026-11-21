'use strict';
require('./lib/test-git-env');
// node --test scripts/affected-suites-fast.test.js
// --fast selection: strong edges only, at most 2 hops, plus same-name and ALWAYS_RUN.
// Negative control: a suite that only mentions the changed file's name must stay unselected.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SEL = path.join(__dirname, 'affected-suites.js');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-home-'));

function gitEnv(dir) {
  const e = { ...process.env, HOME, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  delete e.NODE_TEST_CONTEXT;
  delete e.NODE_TEST_WORKER_ID;
  delete e.AUTOPILOT_TEST_DURATIONS_FILE;
  e.GIT_CONFIG_COUNT = '1';
  e.GIT_CONFIG_KEY_0 = 'commit.gpgsign';
  e.GIT_CONFIG_VALUE_0 = 'false';
  return e;
}

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-fast-'));
  for (const [p, body] of Object.entries(files)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, env: gitEnv(dir), encoding: 'utf8' });
  const init = git('init', '-q');
  assert.strictEqual(init.status, 0, init.stderr);
  assert.strictEqual(git('add', '-A').status, 0);
  assert.strictEqual(git('commit', '-qm', 'base').status, 0);
  return dir;
}

function runSel(dir, args, env) {
  const e = { ...gitEnv(dir), AUTOPILOT_TEST_DURATIONS_FILE: path.join(dir, 'durs.tsv'), ...env };
  return spawnSync('node', [SEL, '--root', dir, ...args], { encoding: 'utf8', env: e });
}

const GRAPH = {
  'scripts/lib/x.sh': ':\n',
  'scripts/s.sh': 'source scripts/lib/x.sh\n',
  'scripts/s2.sh': 'source scripts/s.sh\n',
  'hooks/tests/a.test.sh': '#!/usr/bin/env bash\nsource scripts/lib/x.sh\n',
  'hooks/tests/b.test.sh': '#!/usr/bin/env bash\necho x.sh\n',
  'hooks/tests/c.test.sh': '#!/usr/bin/env bash\nsource scripts/s.sh\n',
  'hooks/tests/d.test.sh': '#!/usr/bin/env bash\nsource scripts/s2.sh\n',
};

// Golden of today's default selector on GRAPH with scripts/lib/x.sh changed: strong hops are free,
// so the 3-hop suite D is included, and the weak name mention B is included.
const DEFAULT_GOLDEN = [
  'hooks/tests/a.test.sh',
  'hooks/tests/b.test.sh',
  'hooks/tests/c.test.sh',
  'hooks/tests/d.test.sh',
].join('\n') + '\n';

test('--fast selects strong edges within 2 hops and leaves the default mode unchanged', () => {
  const dir = makeRepo(GRAPH);
  try {
    const plain = runSel(dir, ['--files', 'scripts/lib/x.sh']);
    assert.strictEqual(plain.status, 0, plain.stderr);
    assert.strictEqual(plain.stdout, DEFAULT_GOLDEN);
    assert.doesNotMatch(plain.stdout, /fast-gate:/);

    const fast = runSel(dir, ['--files', 'scripts/lib/x.sh', '--fast', '--jobs', '2']);
    assert.strictEqual(fast.status, 0, fast.stderr);
    const paths = fast.stdout.split('\n').filter((l) => l.endsWith('.test.sh'));
    assert.deepStrictEqual(paths, ['hooks/tests/a.test.sh', 'hooks/tests/c.test.sh']);
    assert.match(fast.stdout, /^fast-gate: selected 2 of 4 \(full mode would select 4\), deferred 0\n/);
    // Negative control: B is a weak name mention only. Selecting it means rule (b) followed a weak edge.
    assert.ok(!paths.includes('hooks/tests/b.test.sh'), 'weak-edge suite b.test.sh must not be selected');
    assert.ok(!paths.includes('hooks/tests/d.test.sh'), '3-hop suite d.test.sh must not be selected');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('two --fast pool jobs see different HOME values, and those dirs are removed', () => {
  const dir = makeRepo({
    'scripts/seed.sh': ':\n',
    'hooks/tests/h1.test.sh': '#!/usr/bin/env bash\nsource scripts/seed.sh\nprintf "HOME=%s\\n" "$HOME"\n',
    'hooks/tests/h2.test.sh': '#!/usr/bin/env bash\nsource scripts/seed.sh\nprintf "HOME=%s\\n" "$HOME"\n',
  });
  try {
    const r = runSel(dir, ['--run', '--files', 'scripts/seed.sh', '--fast', '--jobs', '2']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const homes = [...r.stdout.matchAll(/^HOME=(\S+)$/gm)].map((m) => m[1]);
    assert.strictEqual(homes.length, 2, r.stdout);
    assert.notStrictEqual(homes[0], homes[1]);
    assert.ok(homes.every((h) => h !== HOME));
    for (const h of homes) assert.strictEqual(fs.existsSync(h), false, h);
    assert.match(r.stdout, /fast-gate: wall \d+s\n/);
    assert.match(r.stdout, /fast-gate: slowest hooks\/tests\/h[12]\.test\.sh /);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--fast defers a suite over the per-suite cap and a serial suite with no duration', () => {
  const dir = makeRepo({
    ...GRAPH,
    'hooks/tests/lib/serial-suites.txt': 'hooks/tests/c.test.sh\n',
  });
  try {
    const tsv = path.join(dir, 'durs.tsv');
    fs.writeFileSync(tsv, 'hooks/tests/a.test.sh\t90\nhooks/tests/d.test.sh\t1\n');
    const fast = runSel(dir, ['--files', 'scripts/lib/x.sh', '--fast', '--jobs', '2', '--fast-max-suite-seconds', '60'], { AUTOPILOT_TEST_DURATIONS_FILE: tsv });
    assert.strictEqual(fast.status, 0, fast.stderr);
    assert.match(fast.stdout, /deferred-to-post-merge: hooks\/tests\/a\.test\.sh 90s/);
    assert.match(fast.stdout, /deferred-to-post-merge: hooks\/tests\/c\.test\.sh \?s/);
    const paths = fast.stdout.split('\n').filter((l) => l.endsWith('.test.sh') && !l.startsWith('deferred'));
    assert.deepStrictEqual(paths, []);
    assert.match(fast.stdout, /fast-gate: selected 0 of 4 \(full mode would select 4\), deferred 2/);
    assert.strictEqual(fast.status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
