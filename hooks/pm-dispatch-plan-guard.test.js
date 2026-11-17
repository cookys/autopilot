'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { isPmConsole } = require('./_shared/pm-console.js');
const {
  DISPATCH_SIZE_DENY_REASON,
  DISPATCH_PLAN_DENY_REASON,
} = require('./fleet-send-work-order-guard.js');

const GUARD_PATH = path.join(__dirname, 'fleet-send-work-order-guard.js');

function mkPmFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-guard-test-'));
  const home = path.join(root, 'home');
  const pmRepo = path.join(root, 'pm-ws');
  const pmSub = path.join(pmRepo, 'packages', 'sub');
  const childRepoDir = path.join(pmRepo, 'child-dir');
  const childRepoFile = path.join(pmRepo, 'child-file');
  const nonProgramRepo = path.join(root, 'tui-ws');
  const noGitDir = path.join(root, 'plain-dir');

  fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
  fs.mkdirSync(path.join(pmRepo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(pmRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(pmRepo, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(pmRepo, '.claude', 'console.json'),
    JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' }),
  );
  fs.mkdirSync(pmSub, { recursive: true });

  fs.mkdirSync(path.join(childRepoDir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(childRepoDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');

  fs.mkdirSync(childRepoFile, { recursive: true });
  fs.writeFileSync(path.join(childRepoFile, '.git'), 'gitdir: ../pm-ws/.git/worktrees/child\n');

  fs.mkdirSync(path.join(nonProgramRepo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(nonProgramRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(nonProgramRepo, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(nonProgramRepo, '.claude', 'console.json'),
    JSON.stringify({ schema: 'autopilot.console/1', mode: 'tui' }),
  );

  fs.mkdirSync(noGitDir, { recursive: true });
  const cfgPath = path.join(home, '.autopilot', 'config.json');
  fs.writeFileSync(cfgPath, '{}\n');

  return {
    root,
    home,
    cfgPath,
    pmRepo,
    pmSub,
    childRepoDir,
    childRepoFile,
    nonProgramRepo,
    noGitDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function runGuard(guardScript, payload, { home, cfgPath, envExtra = {} }) {
  const env = {
    ...process.env,
    HOME: home,
    AUTOPILOT_CONFIG_FILE: cfgPath,
    ...envExtra,
  };
  if (!('AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD' in envExtra)) {
    delete env.AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD;
  }
  const r = spawnSync(process.execPath, [guardScript], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
  return {
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

function dispatchPayload(cwd, task) {
  return {
    tool_name: 'mcp__fleet__dispatch',
    cwd,
    tool_input: { to: 'ns/courier/lane', task },
  };
}

function assertDenied(res, expectedReason, msg) {
  assert.equal(res.status, 0, `${msg}: exit 0 (${res.stderr})`);
  assert.ok(res.stdout.length > 0, `${msg}: expected deny JSON on stdout`);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny', msg);
  assert.equal(parsed.hookSpecificOutput.permissionDecisionReason, expectedReason, msg);
}

function assertAllowed(res, msg) {
  assert.equal(res.status, 0, `${msg}: exit 0 (${res.stderr})`);
  assert.equal(res.stdout, '', `${msg}: expected empty stdout`);
}

test('pm-console: walks up to first .git and requires autopilot.console/1 + mode program', () => {
  const fx = mkPmFixture();
  try {
    assert.equal(isPmConsole(fx.pmRepo), true);
    assert.equal(isPmConsole(fx.pmSub), true);
    assert.equal(isPmConsole({ cwd: fx.pmSub }), true);
    assert.equal(isPmConsole(fx.childRepoDir), false);
    assert.equal(isPmConsole(fx.childRepoFile), false);
    assert.equal(isPmConsole(fx.nonProgramRepo), false);
    assert.equal(isPmConsole(fx.noGitDir), false);

    // Wrong schema
    fs.writeFileSync(
      path.join(fx.nonProgramRepo, '.claude', 'console.json'),
      JSON.stringify({ schema: 'other/1', mode: 'program' }),
    );
    assert.equal(isPmConsole(fx.nonProgramRepo), false);

    // Corrupt JSON
    fs.writeFileSync(path.join(fx.nonProgramRepo, '.claude', 'console.json'), '{bad');
    assert.equal(isPmConsole(fx.nonProgramRepo), false);
  } finally {
    fx.cleanup();
  }
});

test('pm-dispatch-plan-guard: enforces Size and Plan rules in PM program console', () => {
  const fx = mkPmFixture();
  try {
    const envOn = { AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD: '1' };

    // Denied: Size: M unmarked
    assertDenied(
      runGuard(GUARD_PATH, dispatchPayload(fx.pmRepo, 'Size: M\nImplement feature X'), { ...fx, envExtra: envOn }),
      DISPATCH_PLAN_DENY_REASON,
      'Size: M unmarked denied',
    );

    // Denied: - **Size**: L unmarked
    assertDenied(
      runGuard(GUARD_PATH, dispatchPayload(fx.pmSub, '- **Size**: L\nImplement feature Y'), { ...fx, envExtra: envOn }),
      DISPATCH_PLAN_DENY_REASON,
      '- **Size**: L unmarked denied',
    );

    // Denied: prose "we follow plan-first" with Size: M
    assertDenied(
      runGuard(GUARD_PATH, dispatchPayload(fx.pmRepo, 'Size: M\nNote: we follow plan-first here.'), { ...fx, envExtra: envOn }),
      DISPATCH_PLAN_DENY_REASON,
      'prose plan-first with Size: M denied',
    );

    // Denied: missing Size
    assertDenied(
      runGuard(GUARD_PATH, dispatchPayload(fx.pmRepo, 'Please fix the typo'), { ...fx, envExtra: envOn }),
      DISPATCH_SIZE_DENY_REASON,
      'no Size denied with Size message',
    );

    // Denied: conflicting Size lines
    assertDenied(
      runGuard(GUARD_PATH, dispatchPayload(fx.pmRepo, 'Size: S\n- **Size**: M\nPlan: plan-first'), { ...fx, envExtra: envOn }),
      DISPATCH_SIZE_DENY_REASON,
      'two conflicting Size lines denied',
    );

    // Allowed: Plan: docs/plans/x.md@abc1234
    assertAllowed(
      runGuard(GUARD_PATH, dispatchPayload(fx.pmRepo, 'Size: M\nPlan: docs/plans/x.md@abc1234\nDo work'), { ...fx, envExtra: envOn }),
      'Plan: path@sha allowed',
    );

    // Allowed: Plan: plan-first (also via config.json opt-in)
    fs.writeFileSync(fx.cfgPath, JSON.stringify({ hooks: { 'pm-dispatch-plan-guard': true } }));
    assertAllowed(
      runGuard(GUARD_PATH, dispatchPayload(fx.pmRepo, 'Size: L\nPlan: plan-first\nDo work'), { ...fx }),
      'Plan: plan-first allowed via config.json',
    );

    // Denied via config.json opt-in too
    assertDenied(
      runGuard(GUARD_PATH, dispatchPayload(fx.pmRepo, 'Size: M\nMissing plan'), { ...fx }),
      DISPATCH_PLAN_DENY_REASON,
      'config.json opt-in denies unmarked M',
    );

    // Allowed: Size: S unmarked
    assertAllowed(
      runGuard(GUARD_PATH, dispatchPayload(fx.pmRepo, 'Size: S\nSmall fix'), { ...fx, envExtra: envOn }),
      'Size: S unmarked allowed',
    );

    // Untouched: opt-in off
    fs.writeFileSync(fx.cfgPath, '{}\n');
    assertAllowed(
      runGuard(GUARD_PATH, dispatchPayload(fx.pmRepo, 'Size: M\nUnmarked'), { ...fx }),
      'opt-in off untouched',
    );

    // Untouched: child repo with its own .git under PM workspace (dir and gitfile)
    assertAllowed(
      runGuard(GUARD_PATH, dispatchPayload(fx.childRepoDir, 'Size: M\nUnmarked'), { ...fx, envExtra: envOn }),
      'child repo (.git dir) untouched',
    );
    assertAllowed(
      runGuard(GUARD_PATH, dispatchPayload(fx.childRepoFile, 'Size: M\nUnmarked'), { ...fx, envExtra: envOn }),
      'child repo (.git file) untouched',
    );

    // Untouched: mode not program
    assertAllowed(
      runGuard(GUARD_PATH, dispatchPayload(fx.nonProgramRepo, 'Size: M\nUnmarked'), { ...fx, envExtra: envOn }),
      'mode not program untouched',
    );

    // Unchanged: mcp__fleet__send still denies work-order phrases even with opt-in off
    const sendDenied = runGuard(GUARD_PATH, {
      tool_name: 'mcp__fleet__send',
      cwd: fx.nonProgramRepo,
      tool_input: { to: 'ns/courier/lane', content: '請跑 tests' },
    }, { ...fx });
    assert.equal(sendDenied.status, 0);
    assert.equal(JSON.parse(sendDenied.stdout).hookSpecificOutput.permissionDecision, 'deny');

    // Unchanged: mcp__fleet__send fyi=true still passes
    assertAllowed(
      runGuard(GUARD_PATH, {
        tool_name: 'mcp__fleet__send',
        cwd: fx.pmRepo,
        tool_input: { to: 'ns/courier/lane', content: '請跑 tests', fyi: true },
      }, { ...fx, envExtra: envOn }),
      'mcp__fleet__send fyi=true untouched',
    );
  } finally {
    fx.cleanup();
  }
});

test('negative control: unguarded pm-console and work-order-plan stubs fail behavioural checks', () => {
  const fx = mkPmFixture();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-nc-'));
  try {
    // Mirror minimal tree into sandbox so relative requires load stubs
    fs.mkdirSync(path.join(sandbox, 'hooks', '_shared'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(GUARD_PATH, path.join(sandbox, 'hooks', 'fleet-send-work-order-guard.js'));
    fs.copyFileSync(path.join(__dirname, '_shared', 'opt-in.js'), path.join(sandbox, 'hooks', '_shared', 'opt-in.js'));
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'config-path.js'), path.join(sandbox, 'scripts', 'lib', 'config-path.js'));

    // Stub 1: pm-console.js returning true -> child repo is wrongly denied
    fs.writeFileSync(path.join(sandbox, 'hooks', '_shared', 'pm-console.js'), 'module.exports = { isPmConsole: () => true };\n');
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'work-order-plan.js'), path.join(sandbox, 'scripts', 'lib', 'work-order-plan.js'));
    const resChild = runGuard(
      path.join(sandbox, 'hooks', 'fleet-send-work-order-guard.js'),
      dispatchPayload(fx.childRepoDir, 'Size: M\nUnmarked'),
      { ...fx, envExtra: { AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD: '1' } },
    );
    assert.notEqual(resChild.stdout, '', 'unguarded pm-console stub wrongly blocks child repo');

    // Stub 2: work-order-plan.js returning {size:null,plan:null} -> valid Plan dispatch wrongly denied
    fs.copyFileSync(path.join(__dirname, '_shared', 'pm-console.js'), path.join(sandbox, 'hooks', '_shared', 'pm-console.js'));
    fs.writeFileSync(
      path.join(sandbox, 'scripts', 'lib', 'work-order-plan.js'),
      'module.exports = { parse: () => ({ size: null, plan: null }), isMPlus: () => false };\n',
    );
    const resPlan = runGuard(
      path.join(sandbox, 'hooks', 'fleet-send-work-order-guard.js'),
      dispatchPayload(fx.pmRepo, 'Size: M\nPlan: plan-first'),
      { ...fx, envExtra: { AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD: '1' } },
    );
    assert.notEqual(resPlan.stdout, '', 'unguarded work-order-plan stub wrongly blocks valid dispatch');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
    fx.cleanup();
  }
});
