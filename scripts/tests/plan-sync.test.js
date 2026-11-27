'use strict';
require('../lib/test-git-env'); // fixture repos must not run the account's global git config

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLAN_TO_TASKS = path.resolve(__dirname, '..', 'plan-to-tasks.js');

const SAMPLE_PLAN = `# Test Plan

## Phases

<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
| --- | --- | --- | --- | --- | --- |
| P1 | S | - | node -e "process.exit(0)" | no | Phase One |
| P2 | S | P1 | node -e "process.exit(0)" | yes | Phase Two |
| P3 | M | P1, P2 | node -e "process.exit(0)" | no | Phase Three |
| P4 | L | P3 | node -e "process.exit(0)" | yes | Phase Four |
<!-- /phases -->
`;

function setupFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-sync-test-'));
  const repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(path.join(repoDir, 'docs', 'plans'), { recursive: true });
  const planRel = 'docs/plans/2026-11-25-test.md';
  const planAbs = path.join(repoDir, planRel);
  fs.writeFileSync(planAbs, SAMPLE_PLAN, 'utf8');

  spawnSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'ignore' });
  spawnSync('git', ['add', planRel], { cwd: repoDir, stdio: 'ignore' });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'ignore' });

  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim();
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(planAbs)).digest('hex');
  const receiptPath = path.join(tmpDir, 'receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify({ commit, path: planRel, sha256, verdict: 'READY' }), 'utf8');

  const fleetLog = path.join(tmpDir, 'fleet-calls.log');
  const tasksFile = path.join(tmpDir, 'tasks.json');
  const fakeFleet = path.join(tmpDir, 'fake-fleet.sh');
  fs.writeFileSync(
    fakeFleet,
    `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${fleetLog}"
if [[ "\${1:-}" == "whoami" ]] || [[ "\${1:-} \${2:-}" == "event emit" ]]; then
  exit 0
fi
if [[ "\${1:-}" == "tasks" ]]; then
  cat "${tasksFile}"
  exit 0
fi
if [[ "\${1:-} \${2:-}" == "task comment" ]]; then
  exit 0
fi
echo "unexpected fleet call: $*" >&2
exit 1
`,
    { mode: 0o755 }
  );

  return { tmpDir, repoDir, planRel, receiptPath, fleetLog, tasksFile, fakeFleet };
}

describe('plan-to-tasks --sync', () => {
  let fx;

  beforeEach(() => {
    fx = setupFixture();
  });

  afterEach(() => {
    fs.rmSync(fx.tmpDir, { recursive: true, force: true });
  });

  it('exits 2 when --parent is missing (negative control)', () => {
    const res = spawnSync(process.execPath, [PLAN_TO_TASKS, '--receipt', fx.receiptPath, '--repo', fx.repoDir, '--sync'], {
      encoding: 'utf8',
      env: { ...process.env, PLAN_TO_TASKS_FLEET_BIN: fx.fakeFleet, PLAN_TO_TASKS_PARENT: '' },
    });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /--sync requires --parent/);
  });

  it('exits 2 when --sync and --coverage are both passed (negative control)', () => {
    const res = spawnSync(
      process.execPath,
      [PLAN_TO_TASKS, '--receipt', fx.receiptPath, '--repo', fx.repoDir, '--parent', '01PARENT000000000000000000', '--sync', '--coverage'],
      { encoding: 'utf8', env: { ...process.env, PLAN_TO_TASKS_FLEET_BIN: fx.fakeFleet } }
    );
    assert.equal(res.status, 2);
    assert.match(res.stderr, /mutually exclusive/);
  });

  it('writes plan-sync:v1 snapshot to parent, supports sha-less multi-phase claim, and lists only dispatchable phases without dispatching', () => {
    fs.writeFileSync(
      fx.tasksFile,
      JSON.stringify([
        {
          task_id: '01CHILD1000000000000000000',
          parent_task_id: '01PARENT000000000000000000',
          status: 'done',
          title: `Plan: ${fx.planRel} Phase: P1, P2\nRole: implementer | Size: S | Needs-Look: yes`,
        },
      ]),
      'utf8'
    );

    const res = spawnSync(
      process.execPath,
      [PLAN_TO_TASKS, '--receipt', fx.receiptPath, '--repo', fx.repoDir, '--parent', '01PARENT000000000000000000', '--sync'],
      { encoding: 'utf8', env: { ...process.env, PLAN_TO_TASKS_FLEET_BIN: fx.fakeFleet } }
    );
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.schema, 'plan-sync:v1');
    assert.deepEqual(out.untracked, ['P3', 'P4']);
    assert.deepEqual(out.dispatchable, ['P3']);
    assert.equal(out.phases[0].task_ids[0], '01CHILD1000000000000000000');
    assert.equal(out.phases[1].task_ids[0], '01CHILD1000000000000000000');

    const log = fs.readFileSync(fx.fleetLog, 'utf8');
    assert.match(log, /task comment 01PARENT000000000000000000/);
    assert.doesNotMatch(log, /\bdispatch\b/);
    assert.doesNotMatch(log, /--queue/);
  });
  it('clips titles so a large plan snapshot stays under the fleet comment cap', () => {
    const rows = Array.from({ length: 14 }, (_, i) => `| Q${i + 1} | S | - | node -e "process.exit(0)" | no | ${'很長的標題'.repeat(12)} ${i} |`).join('\n');
    const plan = `# Big\n\n<!-- phases:v1 -->\n| id | size | depends_on | acceptance_cmd | needs_look | title |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n<!-- /phases -->\n`;
    fs.writeFileSync(path.join(fx.repoDir, fx.planRel), plan, 'utf8');
    spawnSync('git', ['commit', '-qam', 'big'], { cwd: fx.repoDir, stdio: 'ignore' });
    const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fx.repoDir, encoding: 'utf8' }).stdout.trim();
    const sha256 = crypto.createHash('sha256').update(plan).digest('hex');
    fs.writeFileSync(fx.receiptPath, JSON.stringify({ commit, path: fx.planRel, sha256, verdict: 'READY' }), 'utf8');
    fs.writeFileSync(fx.tasksFile, '[]', 'utf8');
    const res = spawnSync(process.execPath, [PLAN_TO_TASKS, '--receipt', fx.receiptPath, '--repo', fx.repoDir, '--parent', '01PARENT000000000000000000', '--sync'], {
      encoding: 'utf8', env: { ...process.env, PLAN_TO_TASKS_FLEET_BIN: fx.fakeFleet },
    });
    assert.equal(res.status, 0, res.stderr);
    const logged = fs.readFileSync(fx.fleetLog, 'utf8').split('\n').find((l) => l.startsWith('task comment'));
    assert.ok(Buffer.byteLength(logged) < 4000, 'comment is ' + Buffer.byteLength(logged) + ' bytes');
    const snap = JSON.parse(logged.slice(logged.indexOf('{')));
    assert.equal(snap.phases.length, 14);
  });
  it('does not let a cancelled task claim a phase', () => {
    fs.writeFileSync(fx.tasksFile, JSON.stringify([
      { task_id: '01CANCELLED00000000000000', parent_task_id: '01PARENT000000000000000000', status: 'cancelled', title: `Plan: ${fx.planRel} Phase: P1\nRole: implementer | Size: S | Needs-Look: no` },
    ]), 'utf8');
    const res = spawnSync(process.execPath, [PLAN_TO_TASKS, '--receipt', fx.receiptPath, '--repo', fx.repoDir, '--parent', '01PARENT000000000000000000', '--sync'], {
      encoding: 'utf8', env: { ...process.env, PLAN_TO_TASKS_FLEET_BIN: fx.fakeFleet },
    });
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.ok(out.untracked.includes('P1'));
  });
});
