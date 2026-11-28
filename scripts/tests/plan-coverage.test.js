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

const SAMPLE_PLAN = `# Coverage Plan

## Phases

<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
| --- | --- | --- | --- | --- | --- |
| P1 | S | - | node -e "process.exit(0)" | no | Phase One |
| P2 | S | P1 | node -e "process.exit(0)" | no | Phase Two |
| P3 | M | P2 | node -e "process.exit(0)" | yes | Phase Three |
<!-- /phases -->
`;

function setupFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-coverage-test-'));
  const repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(path.join(repoDir, 'docs', 'plans'), { recursive: true });
  const planRel = 'docs/plans/2026-11-25-cov.md';
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

  const tasksFile = path.join(tmpDir, 'tasks.json');
  const fakeFleet = path.join(tmpDir, 'fake-fleet.sh');
  fs.writeFileSync(
    fakeFleet,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "whoami" ]] || [[ "\${1:-} \${2:-}" == "event emit" ]]; then
  exit 0
fi
if [[ "\${1:-}" == "tasks" ]]; then
  cat "${tasksFile}"
  exit 0
fi
echo "unexpected fleet call: $*" >&2
exit 1
`,
    { mode: 0o755 }
  );

  return { tmpDir, repoDir, planRel, receiptPath, tasksFile, fakeFleet };
}

describe('plan-to-tasks --coverage', () => {
  let fx;

  beforeEach(() => {
    fx = setupFixture();
  });

  afterEach(() => {
    fs.rmSync(fx.tmpDir, { recursive: true, force: true });
  });

  it('exits 1 when any phase has no corresponding fleet task (negative control)', () => {
    fs.writeFileSync(
      fx.tasksFile,
      JSON.stringify([
        {
          task_id: '01CHILD1000000000000000000',
          status: 'done',
          title: `Plan: ${fx.planRel} Phase: P1`,
        },
      ]),
      'utf8'
    );

    const res = spawnSync(
      process.execPath,
      [PLAN_TO_TASKS, '--receipt', fx.receiptPath, '--repo', fx.repoDir, '--coverage'],
      { encoding: 'utf8', env: { ...process.env, PLAN_TO_TASKS_FLEET_BIN: fx.fakeFleet } }
    );
    assert.equal(res.status, 1);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.gaps, 2);
    assert.equal(out.covered, 1);
  });

  it('exits 0 when all phases are covered (gaps === 0)', () => {
    fs.writeFileSync(
      fx.tasksFile,
      JSON.stringify([
        {
          task_id: '01CHILD1000000000000000000',
          status: 'done',
          title: `Plan: ${fx.planRel} Phase: P1, P2`,
        },
        {
          task_id: '01CHILD2000000000000000000',
          status: 'pending',
          title: `Plan: ${fx.planRel} Phase: P3`,
        },
      ]),
      'utf8'
    );

    const res = spawnSync(
      process.execPath,
      [PLAN_TO_TASKS, '--receipt', fx.receiptPath, '--repo', fx.repoDir, '--coverage'],
      { encoding: 'utf8', env: { ...process.env, PLAN_TO_TASKS_FLEET_BIN: fx.fakeFleet } }
    );
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.gaps, 0);
    assert.equal(out.covered, 3);
    assert.equal(out.total, 3);
  });

  it('counts a task stamped with an older sha, but not one for a different plan path', () => {
    const run = (planRef) => {
      fs.writeFileSync(
        fx.tasksFile,
        JSON.stringify([{ task_id: '01CHILD1000000000000000000', status: 'done', title: `Plan: ${planRef} Phase: P1, P2, P3` }]),
        'utf8'
      );
      const res = spawnSync(
        process.execPath,
        [PLAN_TO_TASKS, '--receipt', fx.receiptPath, '--repo', fx.repoDir, '--coverage'],
        { encoding: 'utf8', env: { ...process.env, PLAN_TO_TASKS_FLEET_BIN: fx.fakeFleet } }
      );
      return JSON.parse(res.stdout);
    };
    assert.equal(run(`${fx.planRel}@7598d09d0000`).gaps, 0);
    assert.equal(run('docs/plans/other.md@7598d09d0000').gaps, 3);
  });
  describe('marker in a comment, cross-parent', () => {
    const ROOT = '01M88TW9EPZ806DFR3846AM28R';
    const run = (fx, tasks) => {
      fs.writeFileSync(fx.tasksFile, JSON.stringify(tasks), 'utf8');
      const res = spawnSync(
        process.execPath,
        [PLAN_TO_TASKS, '--receipt', fx.receiptPath, '--repo', fx.repoDir, '--coverage', '--parent', ROOT],
        { encoding: 'utf8', env: { ...process.env, PLAN_TO_TASKS_FLEET_BIN: fx.fakeFleet } }
      );
      return JSON.parse(res.stdout);
    };

    it('counts a marker that lives in a task comment, title without marker', () => {
      const out = run(fx, [
        { task_id: '01M89APAPAXBD2F1KSNDABA5PJ', status: 'done', parent_task_id: ROOT, title: 'Engine: build the thing',
          comments: [{ author: 'x', text: `note\nPlan: ${fx.planRel}@0948ed9a Phase: P1` }] },
        { task_id: '01M8BRKSWB8GGBFWMGJ4M9PZ6B', status: 'done', parent_task_id: ROOT, title: 'Plan step',
          comments: [{ author: 'x', text: `Plan: ${fx.planRel} Phase: P2, P3` }] },
      ]);
      assert.equal(out.gaps, 0);
      assert.deepEqual(out.phases.find((p) => p.id === 'P1').task_ids, ['01M89APAPAXBD2F1KSNDABA5PJ']);
    });

    it('counts a task whose parent is not the plan root (cross-parent)', () => {
      const out = run(fx, [
        { task_id: '01M89V2A8WV3MSA93A1EX0ZBNJ', status: 'done', parent_task_id: '01M89B1F51AZVAEG7AE2HKR71J',
          title: `Plan: ${fx.planRel}@a783846e Phase: P1, P2, P3` },
      ]);
      assert.equal(out.gaps, 0);
    });

    it('a comment naming a different plan path still does not match', () => {
      const out = run(fx, [
        { task_id: '01M89SSD12XC2YPXS51X64KBQB', status: 'done', parent_task_id: '01M89B1F51AZVAEG7AE2HKR71J', title: 'x',
          comments: [{ author: 'x', text: 'Plan: docs/plans/other.md@a783846e Phase: P1, P2, P3' }] },
      ]);
      assert.equal(out.gaps, 3);
    });
  });
});
