'use strict';
require('./lib/test-git-env');
// Per-suite wall cap and the --fast measured-wall gate. Fixture suites only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SEL = path.join(__dirname, 'affected-suites.js');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-home-'));

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-wall-'));
  for (const [p, body] of Object.entries({ 'scripts/seed.js': 'x\n', ...files })) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base');
  return dir;
}
function run(dir, args, env) {
  const e = { ...process.env, HOME, ...env };
  delete e.NODE_TEST_CONTEXT; delete e.NODE_TEST_WORKER_ID;
  delete e.AUTOPILOT_TOKEN_SEAT; delete e.AUTOPILOT_SESSION_ID;
  return spawnSync('node', [SEL, '--root', dir, ...args], { encoding: 'utf8', env: e });
}
const suite = (body) => `#!/usr/bin/env bash\n: scripts/seed.js\n${body}\n`;

test('a suite that sleeps past its duration cap is killed, recorded timeout, and the next suite still runs', { timeout: 120000 }, () => {
  const dir = makeRepo({
    'hooks/tests/hung.test.sh': suite('echo hung-start; sleep 90; echo hung-finished'),
    'hooks/tests/next.test.sh': suite('echo next-ran'),
  });
  const durs = path.join(dir, 'test-durations.tsv');
  fs.writeFileSync(durs, 'hooks/tests/hung.test.sh\t10\nhooks/tests/next.test.sh\t1\n');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  try {
    const r = run(dir, ['--run', '--files', 'scripts/seed.js', '--jobs', '2'], { AUTOPILOT_TEST_DURATIONS_FILE: durs });
    assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /timeout: hooks\/tests\/hung\.test\.sh 30s/);
    assert.match(r.stdout, /rc=124 hooks\/tests\/hung\.test\.sh/);
    assert.match(r.stdout, /next-ran/);
    assert.match(r.stdout, /rc=0 hooks\/tests\/next\.test\.sh/);
    assert.doesNotMatch(r.stdout, /hung-finished/);
    const reds = fs.readFileSync(path.join(dir, 'test-reds.tsv'), 'utf8').trim().split('\n');
    assert.strictEqual(reds.length, 1, reds.join('\n'));
    assert.match(reds[0], new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z\\thooks/tests/hung\\.test\\.sh\\ttimeout\\t${sha}$`));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--fast exits 5 when measured wall exceeds --fast-budget-seconds even though every suite passed', { timeout: 60000 }, () => {
  const dir = makeRepo({
    'scripts/seed.sh': ':\n',
    'hooks/tests/slow.test.sh': '#!/usr/bin/env bash\nsource scripts/seed.sh\nsleep 3\necho slow-ok\n',
  });
  const durs = path.join(dir, 'test-durations.tsv');
  try {
    const r = run(dir, ['--run', '--files', 'scripts/seed.sh', '--fast', '--jobs', '2', '--fast-budget-seconds', '1'], { AUTOPILOT_TEST_DURATIONS_FILE: durs });
    assert.strictEqual(r.status, 5, r.stdout + r.stderr);
    assert.match(r.stdout, /rc=0 hooks\/tests\/slow\.test\.sh/);
    assert.match(r.stdout, /fast-gate: FAIL wall \d+s over budget 1s/);
    assert.match(r.stdout, /slow-ok/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
