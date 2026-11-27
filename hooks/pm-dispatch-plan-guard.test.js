'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { isPmConsole, pmConsoleStatus } = require('./_shared/pm-console.js');
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

test('PM Fleet-Task exemptions and work dispatches', () => {
  const fx = mkPmFixture();
  try {
    for (const [type, model, allowed] of [
      ['web-fetch', 'sonnet', true],
      ['claude-code-guide', 'sonnet', true],
      ['general-purpose', 'Claude-Haiku-4', false],
      ['general-purpose', 'sonnet', false],
      ['autopilot:reviewer', 'sonnet', false],
    ]) {
      const payload = { tool_name: 'Agent', cwd: fx.pmRepo, tool_input: { subagent_type: type, model, prompt: `Engine: ${model}\nDo work.` } };
      const res = runGuard(path.join(__dirname, 'dispatch-model-guard.js'), payload, { ...fx, envExtra: { AUTOPILOT_MECHANICAL_REROUTE: 'off' } });
      assert.equal(res.status, 0, type);
      if (allowed) assert.ok(!res.stdout.includes('Fleet-Task:'), `${type}: expected no Fleet-Task denial`);
      else assert.ok(res.stdout.includes('Fleet-Task:'), `${type}: expected Fleet-Task denial`);
    }
  } finally {
    fx.cleanup();
  }
});

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

test('pm-console: isPmConsole writes nothing to stderr when seat is undetermined', () => {
  const fx = mkPmFixture();
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-stdio-'));
  const dirs = { undet: fx.noGitDir, pm: fx.pmRepo, nonPm: fx.nonProgramRepo };
  try {
    // Hermetic child: the checks must not inherit the caller's FLEET_ADDRESS /
    // session ids, or "undetermined" flips on a real seat.
    const r = spawnSync(process.execPath, ['-e', `
      const pm = require(process.argv[1]);
      const dirs = JSON.parse(process.argv[2]);
      const out = {};
      for (const [name, dir] of Object.entries(dirs)) {
        out[name] = { isPm: pm.isPmConsole(dir), status: pm.pmConsoleStatus(dir) };
      }
      process.stdout.write(JSON.stringify(out));
    `, path.join(__dirname, '_shared/pm-console.js'), JSON.stringify(dirs)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: fx.home,
        FLEET_ADDRESS: '',
        AUTOPILOT_FLEET_ADDRESS: '',
        CLAUDE_CODE_SESSION_ID: '',
        AUTOPILOT_SESSION_ID: '',
        XDG_RUNTIME_DIR: xdg,
      },
    });
    assert.equal(r.status, 0, `child exit 0 (${r.stderr})`);
    assert.equal(r.stderr, '', `expected silent child, got: ${r.stderr}`);
    const results = JSON.parse(r.stdout);
    assert.equal(results.undet.isPm, false);
    assert.deepEqual(results.undet.status, { pm: false, undetermined: true });
    assert.deepEqual(results.pm.status, { pm: true, undetermined: false });
    assert.deepEqual(results.nonPm.status, { pm: false, undetermined: false });
  } finally {
    fs.rmSync(xdg, { recursive: true, force: true });
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
        tool_input: { to: 'ns/courier/lane', content: 'Tests passed.', fyi: true },
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
    fs.mkdirSync(path.join(sandbox, 'hooks', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(GUARD_PATH, path.join(sandbox, 'hooks', 'fleet-send-work-order-guard.js'));
    fs.copyFileSync(path.join(__dirname, '_shared', 'opt-in.js'), path.join(sandbox, 'hooks', '_shared', 'opt-in.js'));
    fs.copyFileSync(path.join(__dirname, 'lib', 'gate-hint.js'), path.join(sandbox, 'hooks', 'lib', 'gate-hint.js'));
    fs.copyFileSync(path.join(__dirname, '_shared', 'hook-log.js'), path.join(sandbox, 'hooks', '_shared', 'hook-log.js'));
    fs.copyFileSync(path.join(__dirname, 'gates.tsv'), path.join(sandbox, 'hooks', 'gates.tsv'));
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
    fs.writeFileSync(path.join(sandbox, 'hooks', '_shared', 'pm-console.js'), 'module.exports = { isPmConsole: () => true };\n');
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

test('pm-console fleet address identifies the PM and gates Agent briefs', () => {
  const fx = mkPmFixture();
  try {
    fs.writeFileSync(path.join(fx.nonProgramRepo, '.claude', 'console.json'), JSON.stringify({ schema: 'autopilot.console/1' }));
    const probe = (address, cwd = fx.nonProgramRepo) => spawnSync(process.execPath, ['-e', 'process.stdout.write(String(require(process.argv[1]).isPmConsole(process.argv[2])))', path.join(__dirname, '_shared/pm-console.js'), cwd], {
      encoding: 'utf8', env: { ...process.env, HOME: fx.home, FLEET_ADDRESS: address, AUTOPILOT_FLEET_ADDRESS: '', CLAUDE_CODE_SESSION_ID: '' },
    });
    assert.equal(probe('x/y/pm--claude').stdout, 'true');
    assert.equal(probe('x/y/autopilot--claude').stdout, 'false');
    const missing = probe('', fx.childRepoDir);
    assert.equal(missing.stdout, 'false');
    assert.equal(missing.stderr, '');
    assert.equal(probe('', fx.pmRepo).stdout, 'true');
    const payload = { tool_name: 'Agent', cwd: fx.nonProgramRepo, tool_input: { model: 'sonnet', prompt: 'Engine: sonnet\nDo work.' } };
    for (const [address, denied] of [['x/y/pm--claude', true], ['x/y/autopilot--claude', false]]) {
      const res = runGuard(path.join(__dirname, 'dispatch-model-guard.js'), payload, { ...fx, envExtra: { FLEET_ADDRESS: address, AUTOPILOT_FLEET_ADDRESS: '', CLAUDE_CODE_SESSION_ID: '', AUTOPILOT_MECHANICAL_REROUTE: 'off' } });
      assert.equal(res.stdout.includes('Fleet-Task:'), denied, address);
    }
    // The undetermined-seat warning moved from isPmConsole to dispatch-model-guard:
    // one Agent run on an undetermined seat must print it exactly once on stderr.
    const seatWarn = 'pm-console: cannot determine PM seat (no console.json mode, no fleet address)';
    const warned = runGuard(
      path.join(__dirname, 'dispatch-model-guard.js'),
      { tool_name: 'Agent', cwd: fx.childRepoDir, tool_input: { model: 'sonnet', prompt: 'Engine: sonnet\nDo work.' } },
      { ...fx, envExtra: { FLEET_ADDRESS: '', AUTOPILOT_FLEET_ADDRESS: '', CLAUDE_CODE_SESSION_ID: '' } },
    );
    assert.equal(warned.status, 0, `guard exit 0 (${warned.stderr})`);
    assert.equal(warned.stderr.split(seatWarn).length - 1, 1, `expected ${seatWarn} exactly once, got: ${warned.stderr}`);
  } finally { fx.cleanup(); }
});
