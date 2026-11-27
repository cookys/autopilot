#!/usr/bin/env node
'use strict';
require('./lib/test-git-env'); // fixture repos must not run the account's global git config

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'plan-gap-hint.js');
const HOOK = path.join(REPO_ROOT, 'hooks', 'plan-gap-hint.js');

const VALID_PLAN = `# Test Plan

<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
| --- | --- | --- | --- | --- | --- |
| P1 | S | - | node -e "process.exit(0)" | no | First phase |
| P2 | M | P1 | node -e "process.exit(0)" | yes | Second phase |
<!-- /phases -->
`;

function makeTempEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gap-hint-test-'));
  const home = path.join(base, 'home');
  const repo = path.join(base, 'repo');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });

  const git = (args) => {
    const res = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
    return (res.stdout || '').trim();
  };

  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);

  const fleetLog = path.join(base, 'fleet.log');
  const fleetBin = path.join(base, 'fake-fleet.sh');
  fs.writeFileSync(
    fleetBin,
    `#!/usr/bin/env bash
echo "$*" >> "${fleetLog}"
if [ "\${FAKE_FLEET_FAIL:-0}" = "1" ]; then
  echo "fleet error" >&2
  exit 1
fi
default='[]'
printf '%s\\n' "\${FAKE_FLEET_JSON:-$default}"
`,
    { mode: 0o755 }
  );

  return {
    base,
    home,
    repo,
    git,
    fleetLog,
    fleetBin,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

function runScript(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runHook(payload, env) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
  });
}

describe('plan-gap-hint', () => {
  it('no plan in commit -> no fleet call, exit 0, silent', () => {
    const t = makeTempEnv();
    try {
      fs.writeFileSync(path.join(t.repo, 'README.md'), '# hello\n');
      t.git(['add', 'README.md']);
      t.git(['commit', '-m', 'docs: add readme']);

      const res = runScript(['--repo', t.repo], {
        HOME: t.home,
        PLAN_TO_TASKS_FLEET_BIN: t.fleetBin,
      });
      assert.equal(res.status, 0);
      assert.equal(res.stdout, '');
      assert.equal(fs.existsSync(t.fleetLog), false);
    } finally {
      t.cleanup();
    }
  });

  it('gaps listed and snapshot written; fake fleet log contains only tasks --all --json', () => {
    const t = makeTempEnv();
    try {
      const planRel = 'docs/plans/2026-11-27-test.md';
      fs.mkdirSync(path.join(t.repo, 'docs', 'plans'), { recursive: true });
      fs.writeFileSync(path.join(t.repo, planRel), VALID_PLAN);
      t.git(['add', planRel]);
      t.git(['commit', '-m', 'docs: add plan']);
      const head = t.git(['rev-parse', 'HEAD']);
      const realRepo = t.git(['rev-parse', '--show-toplevel']);

      const tasksJson = JSON.stringify([
        { id: '01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', status: 'open', title: `Plan: ${planRel} Phase: P1` },
      ]);

      const res = runScript(['--repo', t.repo], {
        HOME: t.home,
        PLAN_TO_TASKS_FLEET_BIN: t.fleetBin,
        FAKE_FLEET_JSON: tasksJson,
      });
      assert.equal(res.status, 0);
      assert.equal(
        res.stdout,
        `plan-gap: ${planRel}: 1 phase(s) without a task: P2 (nothing was opened)\n`
      );

      const logLines = fs.readFileSync(t.fleetLog, 'utf8').trim().split('\n');
      assert.deepEqual(logLines, ['tasks --all --json']);

      const hash = crypto
        .createHash('sha256')
        .update(`${realRepo}\n${planRel}`)
        .digest('hex')
        .slice(0, 16);
      const snapPath = path.join(t.home, '.autopilot', 'plan-gaps', `${hash}.json`);
      assert.equal(fs.existsSync(snapPath), true);
      const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      assert.equal(snap.schema, 'plan-gap:v1');
      assert.equal(snap.plan_path, planRel);
      assert.equal(snap.commit, head);
      assert.deepEqual(snap.untracked, ['P2']);
      assert.deepEqual(snap.phases, [
        { id: 'P1', task_ids: ['01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'] },
        { id: 'P2', task_ids: [] },
      ]);
    } finally {
      t.cleanup();
    }
  });

  it('fully covered -> silent', () => {
    const t = makeTempEnv();
    try {
      const planRel = 'docs/plans/2026-11-27-test.md';
      fs.mkdirSync(path.join(t.repo, 'docs', 'plans'), { recursive: true });
      fs.writeFileSync(path.join(t.repo, planRel), VALID_PLAN);
      t.git(['add', planRel]);
      t.git(['commit', '-m', 'docs: add plan']);

      const tasksJson = JSON.stringify([
        { id: '01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', status: 'done', title: `Plan: ${planRel} Phase: P1` },
        { id: '01BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', status: 'open', title: `Plan: ${planRel} Phase: P2` },
      ]);

      const res = runScript(['--repo', t.repo], {
        HOME: t.home,
        PLAN_TO_TASKS_FLEET_BIN: t.fleetBin,
        FAKE_FLEET_JSON: tasksJson,
      });
      assert.equal(res.status, 0);
      assert.equal(res.stdout, '');
    } finally {
      t.cleanup();
    }
  });

  it('cancelled task does not cover', () => {
    const t = makeTempEnv();
    try {
      const planRel = 'docs/plans/2026-11-27-test.md';
      fs.mkdirSync(path.join(t.repo, 'docs', 'plans'), { recursive: true });
      fs.writeFileSync(path.join(t.repo, planRel), VALID_PLAN);
      t.git(['add', planRel]);
      t.git(['commit', '-m', 'docs: add plan']);

      const tasksJson = JSON.stringify([
        { id: '01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', status: 'cancelled', title: `Plan: ${planRel} Phase: P1` },
        { id: '01BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', status: 'open', title: `Plan: ${planRel} Phase: P2` },
      ]);

      const res = runScript(['--repo', t.repo], {
        HOME: t.home,
        PLAN_TO_TASKS_FLEET_BIN: t.fleetBin,
        FAKE_FLEET_JSON: tasksJson,
      });
      assert.equal(res.status, 0);
      assert.equal(
        res.stdout,
        `plan-gap: ${planRel}: 1 phase(s) without a task: P1 (nothing was opened)\n`
      );
    } finally {
      t.cleanup();
    }
  });

  it('fleet failure -> exit 0, task list unavailable', () => {
    const t = makeTempEnv();
    try {
      const planRel = 'docs/plans/2026-11-27-test.md';
      fs.mkdirSync(path.join(t.repo, 'docs', 'plans'), { recursive: true });
      fs.writeFileSync(path.join(t.repo, planRel), VALID_PLAN);
      t.git(['add', planRel]);
      t.git(['commit', '-m', 'docs: add plan']);

      const res = runScript(['--repo', t.repo], {
        HOME: t.home,
        PLAN_TO_TASKS_FLEET_BIN: t.fleetBin,
        FAKE_FLEET_FAIL: '1',
      });
      assert.equal(res.status, 0);
      assert.equal(res.stdout, 'task list unavailable\n');
    } finally {
      t.cleanup();
    }
  });

  it('hook ignores non-commit commands and is silent when not enabled', () => {
    const t = makeTempEnv();
    try {
      const planRel = 'docs/plans/2026-11-27-test.md';
      fs.mkdirSync(path.join(t.repo, 'docs', 'plans'), { recursive: true });
      fs.writeFileSync(path.join(t.repo, planRel), VALID_PLAN);
      t.git(['add', planRel]);
      t.git(['commit', '-m', 'docs: add plan']);

      const disabledRes = runHook(
        { tool_name: 'Bash', tool_input: { command: 'git commit -m "x"' }, cwd: t.repo },
        { HOME: t.home, AUTOPILOT_HOOK_PLAN_GAP_HINT: '0', PLAN_TO_TASKS_FLEET_BIN: t.fleetBin }
      );
      assert.equal(disabledRes.status, 0);
      assert.equal(disabledRes.stdout, '');

      const nonCommitRes = runHook(
        { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: t.repo },
        { HOME: t.home, AUTOPILOT_HOOK_PLAN_GAP_HINT: '1', PLAN_TO_TASKS_FLEET_BIN: t.fleetBin }
      );
      assert.equal(nonCommitRes.status, 0);
      assert.equal(nonCommitRes.stdout, '');

      const dryRunRes = runHook(
        { tool_name: 'Bash', tool_input: { command: 'git commit --dry-run -m "x"' }, cwd: t.repo },
        { HOME: t.home, AUTOPILOT_HOOK_PLAN_GAP_HINT: '1', PLAN_TO_TASKS_FLEET_BIN: t.fleetBin }
      );
      assert.equal(dryRunRes.status, 0);
      assert.equal(dryRunRes.stdout, '');

      const enabledRes = runHook(
        { tool_name: 'Bash', tool_input: { command: `git -C "${t.repo}" commit -m "x"` }, cwd: t.base },
        { HOME: t.home, AUTOPILOT_HOOK_PLAN_GAP_HINT: '1', PLAN_TO_TASKS_FLEET_BIN: t.fleetBin }
      );
      assert.equal(enabledRes.status, 0);
      const parsed = JSON.parse(enabledRes.stdout);
      assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
      assert.match(parsed.hookSpecificOutput.additionalContext, /2 phase\(s\) without a task: P1, P2/);
    } finally {
      t.cleanup();
    }
  });
});
