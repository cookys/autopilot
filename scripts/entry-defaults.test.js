'use strict';
// The three suite entry points default to the parallel pool and --serial is one at a time.
// Dry-run only: no suite file is executed.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOME = require('fs').mkdtempSync(require('path').join(os.tmpdir(), 'entry-defaults-home-'));

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME },
  });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}
function jobsOf(out) {
  const mode = out.match(/^mode: (\S+)$/m);
  const jobs = out.match(/^jobs: (\d+)$/m);
  assert.ok(mode && jobs, out);
  return { mode: mode[1], jobs: Number(jobs[1]) };
}

test('affected-suites, run.sh and suite-baseline default to parallel and --serial is serial', () => {
  const n = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const jsJobs = Math.max(2, Math.floor(n / 2));
  const as = jobsOf(run('node', [path.join(ROOT, 'scripts/affected-suites.js'), '--dry-run']));
  assert.deepStrictEqual(as, { mode: 'parallel', jobs: jsJobs });
  assert.deepStrictEqual(jobsOf(run('node', [path.join(ROOT, 'scripts/affected-suites.js'), '--dry-run', '--serial'])), { mode: 'serial', jobs: 1 });
  assert.deepStrictEqual(jobsOf(run('node', [path.join(ROOT, 'scripts/affected-suites.js'), '--dry-run', '--jobs', '1'])), { mode: 'serial', jobs: 1 });

  const sb = jobsOf(run('node', [path.join(ROOT, 'tools/migrate/suite-baseline.js'), 'run-all', '--dry-run']));
  assert.deepStrictEqual(sb, { mode: 'parallel', jobs: jsJobs });
  assert.deepStrictEqual(jobsOf(run('node', [path.join(ROOT, 'tools/migrate/suite-baseline.js'), 'run-all', '--dry-run', '--serial'])), { mode: 'serial', jobs: 1 });
  assert.deepStrictEqual(jobsOf(run('node', [path.join(ROOT, 'tools/migrate/suite-baseline.js'), 'run-all', '--dry-run', '--jobs', '1'])), { mode: 'serial', jobs: 1 });

  const sh = jobsOf(run('bash', [path.join(ROOT, 'hooks/tests/run.sh'), '--dry-run']));
  assert.strictEqual(sh.mode, 'parallel');
  assert.ok(sh.jobs >= 2, String(sh.jobs));
  assert.deepStrictEqual(jobsOf(run('bash', [path.join(ROOT, 'hooks/tests/run.sh'), '--dry-run', '--serial'])), { mode: 'serial', jobs: 1 });
  assert.deepStrictEqual(jobsOf(run('bash', [path.join(ROOT, 'hooks/tests/run.sh'), '--dry-run', '--jobs', '1'])), { mode: 'serial', jobs: 1 });
});
