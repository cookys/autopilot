// hooks/pm-output-cap.test.js — unit and integration tests for PM-session tool output truncation (P3).
// Negative control: an unguarded pass-through pm-output-cap.js fails the truncation assertions
// (41 lines -> 40 + pointer, ledger pattern -> 30, PreToolUse fallback command wrapping).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'pm-output-cap.js');
const { isPmConsole } = require('./_shared/pm-console.js');

const CONSOLE_PROGRAM = '{"schema":"autopilot.console/1","mode":"program"}';

function makeLines(count) {
  return Array.from({ length: count }, (_, i) => `line-${i + 1}`).join('\n') + '\n';
}

function bashResponse(stdout, overrides = {}) {
  return { stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false, ...overrides };
}

function withSandbox(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcap-'));
  const home = path.join(root, 'home');
  const state = path.join(root, 'state');
  const runtime = path.join(root, 'runtime');
  const pmRepo = path.join(root, 'pm-repo');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  fs.mkdirSync(path.join(pmRepo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(pmRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(pmRepo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(pmRepo, '.claude', 'console.json'), CONSOLE_PROGRAM);
  try {
    return fn({ root, home, state, runtime, pmRepo });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runHook(payload, envOverrides = {}) {
  const env = {
    PATH: process.env.PATH,
    AUTOPILOT_HOOK_PM_OUTPUT_CAP: '1',
    ...envOverrides,
  };
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
}

test('pm-console gate: requires first .git + schema autopilot.console/1 + mode program', () => {
  withSandbox(({ root, pmRepo }) => {
    assert.equal(isPmConsole(pmRepo), true);

    const subDir = path.join(pmRepo, 'nested', 'dir');
    fs.mkdirSync(subDir, { recursive: true });
    assert.equal(isPmConsole(subDir), true);

    // Worktree .git file form
    const wtRepo = path.join(root, 'wt-repo');
    fs.mkdirSync(path.join(wtRepo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(wtRepo, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
    fs.writeFileSync(path.join(wtRepo, '.claude', 'console.json'), CONSOLE_PROGRAM);
    assert.equal(isPmConsole(wtRepo), true);

    // Child repo inside PM workspace stops at its own .git and never inherits parent console.json
    const childRepo = path.join(pmRepo, 'child-repo');
    fs.mkdirSync(path.join(childRepo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(childRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    assert.equal(isPmConsole(childRepo), false);

    // Child repo with .git file also stops at its own .git
    const childWt = path.join(pmRepo, 'child-wt');
    fs.mkdirSync(childWt, { recursive: true });
    fs.writeFileSync(path.join(childWt, '.git'), 'gitdir: /elsewhere\n');
    assert.equal(isPmConsole(childWt), false);

    // Non-program mode
    const viewerRepo = path.join(root, 'viewer-repo');
    fs.mkdirSync(path.join(viewerRepo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(viewerRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.mkdirSync(path.join(viewerRepo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(viewerRepo, '.claude', 'console.json'), '{"schema":"autopilot.console/1","mode":"viewer"}');
    assert.equal(isPmConsole(viewerRepo), false);

    // Console.json without any .git
    const noGit = path.join(root, 'no-git');
    fs.mkdirSync(path.join(noGit, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(noGit, '.claude', 'console.json'), CONSOLE_PROGRAM);
    assert.equal(isPmConsole(noGit), false);

    assert.equal(isPmConsole(''), false);
  });
});

test('PostToolUse Bash: 41 lines -> 40 + pointer and full 41 lines on disk (0700/0600)', () => {
  withSandbox(({ home, state, runtime, pmRepo }) => {
    const full = makeLines(41);
    const response = bashResponse(full, { interrupted: true, noOutputExpected: true, extra: { fake: 'metadata' } });
    const res = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_01ABC_xyz-9',
        tool_input: { command: 'seq 1 41' },
        tool_response: response,
        cwd: pmRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
    );

    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, '');
    const parsed = JSON.parse(res.stdout);
    const out = parsed.hookSpecificOutput.updatedToolOutput;
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');

    const expectedFile = path.join(runtime, 'autopilot', 'pm-output', 'toolu_01ABC_xyz-9.txt');
    assert.equal(typeof out, 'object');
    assert.deepEqual(out, { ...response, stdout: out.stdout, stderr: '' });
    const outLines = out.stdout.split('\n');
    assert.equal(outLines.length, 31);
    assert.equal(outLines[0], 'line-1');
    assert.equal(outLines[19], 'line-20');
    assert.equal(outLines[20], `… 11 行已截斷，全文：${expectedFile}`);
    assert.equal(outLines[21], 'line-32');
    assert.equal(outLines[30], 'line-41');

    assert.equal(fs.readFileSync(expectedFile, 'utf8'), full);
    assert.equal(fs.statSync(path.dirname(expectedFile)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(expectedFile).mode & 0o777, 0o600);
  });
});

test('PostToolUse Bash: caps combined stdout and stderr and preserves response metadata', () => {
  withSandbox(({ home, state, runtime, pmRepo }) => {
    const stdout = makeLines(39);
    const stderr = makeLines(3);
    const full = stdout + stderr;
    const response = bashResponse(stdout, { stderr });
    const res = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_obj_1',
        tool_input: { command: 'seq 1 42' },
        tool_response: response,
        cwd: pmRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
    );

    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    const out = parsed.hookSpecificOutput.updatedToolOutput;
    const expectedFile = path.join(runtime, 'autopilot', 'pm-output', 'toolu_obj_1.txt');
    assert.equal(typeof out, 'object');
    const expectedStdout = [
      ...Array.from({ length: 20 }, (_, i) => `line-${i + 1}`),
      `… 12 行已截斷，全文：${expectedFile}`,
      ...Array.from({ length: 7 }, (_, i) => `line-${i + 33}`),
      'line-1',
      'line-2',
      'line-3',
    ].join('\n');
    assert.deepEqual(out, {
      ...response,
      stdout: expectedStdout,
      stderr: '',
    });
    assert.equal(fs.readFileSync(expectedFile, 'utf8'), full);
  });
});

test('PostToolUse Bash: non-object tool_response passes through without writing', () => {
  withSandbox(({ home, state, runtime, pmRepo }) => {
    for (const response of [makeLines(41), [{ type: 'text', text: makeLines(41) }], null, undefined, 42, true]) {
      const res = runHook(
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_use_id: 'toolu_invalid',
          tool_input: { command: 'seq 1 41' },
          tool_response: response,
          tool_output: bashResponse(makeLines(41)),
          cwd: pmRepo,
        },
        { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
      );
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stderr, '');
      assert.equal(res.stdout, '');
      assert.equal(fs.existsSync(path.join(runtime, 'autopilot', 'pm-output')), false);
    }
  });
});

test('PostToolUse Bash: 40 lines (with or without trailing newline) is untouched', () => {
  withSandbox(({ home, state, runtime, pmRepo }) => {
    for (const body of [makeLines(40), makeLines(40).slice(0, -1)]) {
      const res = runHook(
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_use_id: 'toolu_40',
          tool_input: { command: 'seq 1 40' },
          tool_response: bashResponse(body),
          cwd: pmRepo,
        },
        { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
      );
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, '');
      assert.equal(fs.existsSync(path.join(runtime, 'autopilot', 'pm-output', 'toolu_40.txt')), false);
    }
  });
});

test('PostToolUse: ledger_search_pattern lowers cap to 30 when matched', () => {
  withSandbox(({ root, home, state, runtime, pmRepo }) => {
    const cfgFile = path.join(root, 'config.json');
    fs.writeFileSync(cfgFile, JSON.stringify({
      hooks: { 'pm-output-cap': true },
      pm_output_cap: { ledger_search_pattern: '^pm-ledger search\\b' },
    }));

    const matchedOver = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_ledger_31',
        tool_input: { command: 'pm-ledger search foo' },
        tool_response: bashResponse(makeLines(31)),
        cwd: pmRepo,
      },
      {
        HOME: home,
        AUTOPILOT_STATE_DIR: state,
        XDG_RUNTIME_DIR: runtime,
        AUTOPILOT_HOOK_PM_OUTPUT_CAP: '',
        AUTOPILOT_CONFIG_FILE: cfgFile,
      },
    );
    assert.equal(matchedOver.status, 0, matchedOver.stderr);
    const out = JSON.parse(matchedOver.stdout).hookSpecificOutput.updatedToolOutput;
    const lines = out.stdout.split('\n');
    assert.equal(lines.length, 23);
    assert.equal(lines[14], 'line-15');
    assert.match(lines[15], /^… 9 行已截斷，全文：/);
    assert.equal(lines[22], 'line-31');

    const matchedExact = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_ledger_30',
        tool_input: { command: 'pm-ledger search foo' },
        tool_response: bashResponse(makeLines(30)),
        cwd: pmRepo,
      },
      {
        HOME: home,
        AUTOPILOT_STATE_DIR: state,
        XDG_RUNTIME_DIR: runtime,
        AUTOPILOT_HOOK_PM_OUTPUT_CAP: '',
        AUTOPILOT_CONFIG_FILE: cfgFile,
      },
    );
    assert.equal(matchedExact.status, 0, matchedExact.stderr);
    assert.equal(matchedExact.stdout, '');

    const unmatched = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_other_35',
        tool_input: { command: 'echo other' },
        tool_response: bashResponse(makeLines(35)),
        cwd: pmRepo,
      },
      {
        HOME: home,
        AUTOPILOT_STATE_DIR: state,
        XDG_RUNTIME_DIR: runtime,
        AUTOPILOT_HOOK_PM_OUTPUT_CAP: '',
        AUTOPILOT_CONFIG_FILE: cfgFile,
      },
    );
    assert.equal(unmatched.status, 0, unmatched.stderr);
    assert.equal(unmatched.stdout, '');
  });
});

test('non-PM repo and opt-in off leave output untouched and write nothing', () => {
  withSandbox(({ root, home, state, runtime, pmRepo }) => {
    const childRepo = path.join(pmRepo, 'child-repo');
    fs.mkdirSync(path.join(childRepo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(childRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const nonPm = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_nonpm',
        tool_input: { command: 'seq 1 50' },
        tool_response: bashResponse(makeLines(50)),
        cwd: childRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
    );
    assert.equal(nonPm.status, 0, nonPm.stderr);
    assert.equal(nonPm.stdout, '');

    const cfgOff = path.join(root, 'empty-config.json');
    fs.writeFileSync(cfgOff, '{}');
    const optOff = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_optoff',
        tool_input: { command: 'seq 1 50' },
        tool_response: bashResponse(makeLines(50)),
        cwd: pmRepo,
      },
      {
        HOME: home,
        AUTOPILOT_STATE_DIR: state,
        XDG_RUNTIME_DIR: runtime,
        AUTOPILOT_HOOK_PM_OUTPUT_CAP: '',
        AUTOPILOT_CONFIG_FILE: cfgOff,
      },
    );
    assert.equal(optOff.status, 0, optOff.stderr);
    assert.equal(optOff.stdout, '');
    assert.equal(fs.existsSync(path.join(runtime, 'autopilot', 'pm-output')), false);
  });
});

test('PostToolUse mcp__*: preserves updatedMCPToolOutput shape; Read/Grep/Glob and non-text pass through', () => {
  withSandbox(({ home, state, runtime, pmRepo }) => {
    const full = makeLines(45);
    for (const [id, resp] of [
      ['toolu_mcp_arr', [{ type: 'text', text: full }]],
      ['toolu_mcp_obj', { content: [{ type: 'text', text: full }], isError: false }],
      ['toolu_mcp_str', full],
    ]) {
      const mcpRes = runHook(
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'mcp__fleet__inbox',
          tool_use_id: id,
          tool_input: {},
          tool_response: resp,
          cwd: pmRepo,
        },
        { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
      );
      assert.equal(mcpRes.status, 0, mcpRes.stderr);
      const parsed = JSON.parse(mcpRes.stdout);
      assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
      assert.equal(parsed.hookSpecificOutput.updatedToolOutput, undefined);
      assert.equal(typeof parsed.hookSpecificOutput.updatedMCPToolOutput, 'string');
      const outLines = parsed.hookSpecificOutput.updatedMCPToolOutput.split('\n');
      assert.equal(outLines.length, 31);
      assert.match(outLines[20], /^… 15 行已截斷，全文：/);
    }

    // Non-text MCP result passes through
    const mcpImg = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'mcp__vision__shot',
        tool_use_id: 'toolu_mcp_img',
        tool_input: {},
        tool_response: [{ type: 'image', data: 'base64...', mimeType: 'image/png' }],
        cwd: pmRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
    );
    assert.equal(mcpImg.status, 0, mcpImg.stderr);
    assert.equal(mcpImg.stdout, '');

    // Read/Grep/Glob pass through
    for (const toolName of ['Read', 'Grep', 'Glob']) {
      const r = runHook(
        {
          hook_event_name: 'PostToolUse',
          tool_name: toolName,
          tool_use_id: `toolu_${toolName}`,
          tool_input: {},
          tool_response: makeLines(80),
          cwd: pmRepo,
        },
        { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
    }
  });
});

test('symlinked pm-output directory fails open without writing through symlink', () => {
  withSandbox(({ root, home, state, runtime, pmRepo }) => {
    const target = path.join(root, 'outside-target');
    fs.mkdirSync(target, { recursive: true });
    const autopilotDir = path.join(runtime, 'autopilot');
    fs.mkdirSync(autopilotDir, { recursive: true });
    fs.symlinkSync(target, path.join(autopilotDir, 'pm-output'));

    const res = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_sym',
        tool_input: { command: 'seq 1 45' },
        tool_response: bashResponse(makeLines(45)),
        cwd: pmRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
    );
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
    assert.equal(fs.existsSync(path.join(target, 'toolu_sym.txt')), false);
  });
});

test('unsafe or empty tool_use_id stays inside pm-output dir and falls back to state dir without XDG_RUNTIME_DIR', () => {
  withSandbox(({ home, state, pmRepo }) => {
    const outDir = path.join(state, 'pm-output');
    for (const badId of ['../../etc/passwd', '../..', '.', '', undefined]) {
      const res = runHook(
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_use_id: badId,
          tool_input: { command: 'seq 1 41' },
          tool_response: bashResponse(makeLines(41)),
          cwd: pmRepo,
        },
        { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: '' },
      );
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout).hookSpecificOutput.updatedToolOutput;
      const m = out.stdout.match(/全文：(.+)$/m);
      assert.ok(m, 'pointer path missing');
      const writtenPath = m[1];
      assert.equal(path.dirname(writtenPath), outDir);
      assert.match(path.basename(writtenPath), /^[A-Za-z0-9_-]+\.txt$/);
      assert.equal(fs.readFileSync(writtenPath, 'utf8'), makeLines(41));
    }
  });
});

test('PreToolUse fallback: preserves heredoc, exit 3, trailing # comment, truncates > 40 and passes <= 40', () => {
  withSandbox(({ home, state, runtime, pmRepo }) => {
    const runtimeWithSpace = path.join(runtime, 'dir with space');
    fs.mkdirSync(runtimeWithSpace, { recursive: true });

    // Case A: > 40 lines + heredoc + exit 3 + trailing # comment
    const cmdOver = [
      'seq 1 43',
      "cat <<'EOF'",
      'from-heredoc-1',
      'from-heredoc-2',
      'EOF',
      'exit 3 # trailing comment',
    ].join('\n');

    const hookOver = runHook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_pre_over',
        tool_input: { command: cmdOver, description: 'test heredoc' },
        cwd: pmRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtimeWithSpace },
    );
    assert.equal(hookOver.status, 0, hookOver.stderr);
    const parsedOver = JSON.parse(hookOver.stdout);
    assert.equal(parsedOver.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(parsedOver.hookSpecificOutput.updatedInput.description, 'test heredoc');

    const execOver = spawnSync('bash', ['-c', parsedOver.hookSpecificOutput.updatedInput.command], { encoding: 'utf8' });
    assert.equal(execOver.status, 3, execOver.stderr);
    const expectedFile = path.join(runtimeWithSpace, 'autopilot', 'pm-output', 'toolu_pre_over.txt');
    const outLines = execOver.stdout.replace(/\n$/, '').split('\n');
    assert.equal(outLines.length, 31);
    assert.equal(outLines[0], '1');
    assert.equal(outLines[19], '20');
    assert.equal(outLines[20], `… 15 行已截斷，全文：${expectedFile}`);
    assert.equal(outLines[30], 'from-heredoc-2');
    const fullDisk = fs.readFileSync(expectedFile, 'utf8');
    assert.match(fullDisk, /from-heredoc-1\nfrom-heredoc-2\n$/);
    assert.equal(fs.statSync(expectedFile).mode & 0o777, 0o600);

    // Case B: <= 40 lines + heredoc + exit 3 + trailing # comment (no trailing newline after EOF)
    const cmdUnder = [
      "cat <<'EOF'",
      'alpha',
      'beta',
      'EOF',
    ].join('\n');
    const hookUnder = runHook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_pre_under',
        tool_input: { command: `${cmdUnder}\nexit 3 # end comment` },
        cwd: pmRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtimeWithSpace },
    );
    assert.equal(hookUnder.status, 0, hookUnder.stderr);
    const wrappedUnder = JSON.parse(hookUnder.stdout).hookSpecificOutput.updatedInput.command;
    const execUnder = spawnSync('bash', ['-c', wrappedUnder], { encoding: 'utf8' });
    assert.equal(execUnder.status, 3, execUnder.stderr);
    assert.equal(execUnder.stdout, 'alpha\nbeta\n');
    assert.equal(
      fs.existsSync(path.join(runtimeWithSpace, 'autopilot', 'pm-output', 'toolu_pre_under.txt')),
      false,
    );

    // Case C: command starting with '(' and matched by ledger_search_pattern caps at 30
    const cfgFile = path.join(runtime, 'cfg.json');
    fs.writeFileSync(cfgFile, JSON.stringify({
      hooks: { 'pm-output-cap': true },
      pm_output_cap: { ledger_search_pattern: 'pm-ledger search' },
    }));
    const hookLedgerPre = runHook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_pre_ledger',
        tool_input: { command: '(seq 1 35) # pm-ledger search' },
        cwd: pmRepo,
      },
      {
        HOME: home,
        AUTOPILOT_STATE_DIR: state,
        XDG_RUNTIME_DIR: runtimeWithSpace,
        AUTOPILOT_HOOK_PM_OUTPUT_CAP: '',
        AUTOPILOT_CONFIG_FILE: cfgFile,
      },
    );
    assert.equal(hookLedgerPre.status, 0, hookLedgerPre.stderr);
    const wrappedLedger = JSON.parse(hookLedgerPre.stdout).hookSpecificOutput.updatedInput.command;
    const execLedger = spawnSync('bash', ['-c', wrappedLedger], { encoding: 'utf8' });
    assert.equal(execLedger.status, 0, execLedger.stderr);
    const ledgerLines = execLedger.stdout.replace(/\n$/, '').split('\n');
    assert.equal(ledgerLines.length, 23);
    assert.equal(ledgerLines[14], '15');
    assert.match(ledgerLines[15], /^… 13 行已截斷，全文：/);
    assert.equal(ledgerLines[22], '35');

    // Case D: non-Bash tools on PreToolUse pass through
    const hookRead = runHook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_use_id: 'toolu_pre_read',
        tool_input: { file_path: '/etc/hosts' },
        cwd: pmRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtimeWithSpace },
    );
    assert.equal(hookRead.status, 0, hookRead.stderr);
    assert.equal(hookRead.stdout, '');
  });
});

test('PostToolUse: empty ledger_search_pattern leaves 30-line rule off; pattern matches mcp__* tool names', () => {
  withSandbox(({ root, home, state, runtime, pmRepo }) => {
    const cfgEmpty = path.join(root, 'cfg-empty.json');
    fs.writeFileSync(cfgEmpty, JSON.stringify({
      hooks: { 'pm-output-cap': true },
      pm_output_cap: { ledger_search_pattern: '' },
    }));
    const emptyRuleRes = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_empty_pat',
        tool_input: { command: 'pm-ledger search foo' },
        tool_response: bashResponse(makeLines(35)),
        cwd: pmRepo,
      },
      {
        HOME: home,
        AUTOPILOT_STATE_DIR: state,
        XDG_RUNTIME_DIR: runtime,
        AUTOPILOT_HOOK_PM_OUTPUT_CAP: '',
        AUTOPILOT_CONFIG_FILE: cfgEmpty,
      },
    );
    assert.equal(emptyRuleRes.status, 0, emptyRuleRes.stderr);
    assert.equal(emptyRuleRes.stdout, '', 'empty ledger_search_pattern must leave 30-line rule off');

    const cfgMcp = path.join(root, 'cfg-mcp.json');
    fs.writeFileSync(cfgMcp, JSON.stringify({
      hooks: { 'pm-output-cap': true },
      pm_output_cap: { ledger_search_pattern: 'fleet__inbox' },
    }));
    const mcpRes = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'mcp__fleet__inbox',
        tool_use_id: 'toolu_mcp_pat',
        tool_input: {},
        tool_response: makeLines(35),
        cwd: pmRepo,
      },
      {
        HOME: home,
        AUTOPILOT_STATE_DIR: state,
        XDG_RUNTIME_DIR: runtime,
        AUTOPILOT_HOOK_PM_OUTPUT_CAP: '',
        AUTOPILOT_CONFIG_FILE: cfgMcp,
      },
    );
    assert.equal(mcpRes.status, 0, mcpRes.stderr);
    const out = JSON.parse(mcpRes.stdout).hookSpecificOutput.updatedMCPToolOutput;
    const lines = out.split('\n');
    assert.equal(lines.length, 23);
    assert.equal(lines[14], 'line-15');
    assert.match(lines[15], /^… 13 行已截斷，全文：/);
    assert.equal(lines[22], 'line-35');
  });
});

test('head+tail+error truncation preserves trailing "# fail 3", middle FAIL line, and short output untouched', () => {
  withSandbox(({ home, state, runtime, pmRepo }) => {
    const bodyLines = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`);
    bodyLines[25] = 'FAIL tests/foo.test.js';
    bodyLines[59] = '# fail 3';
    const full = `${bodyLines.join('\n')}\n`;

    const res = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_head_tail_err',
        tool_input: { command: 'node --test' },
        tool_response: bashResponse(full),
        cwd: pmRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
    );
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout).hookSpecificOutput.updatedToolOutput;
    const outLines = out.stdout.split('\n');
    assert.equal(outLines[0], 'line-1');
    assert.equal(outLines[19], 'line-20');
    assert.match(outLines[20], /^… 29 行已截斷，全文：/);
    assert.ok(outLines.includes('FAIL tests/foo.test.js'), 'middle FAIL line must be preserved');
    assert.equal(outLines[outLines.length - 1], '# fail 3', 'trailing # fail 3 must be preserved');

    // Short output (<= cap) passes through untouched
    const shortRes = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_short_pass',
        tool_input: { command: 'echo ok' },
        tool_response: bashResponse(makeLines(10)),
        cwd: pmRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
    );
    assert.equal(shortRes.status, 0, shortRes.stderr);
    assert.equal(shortRes.stdout, '');
  });
});

test('PostToolUse Bash: 40 very long lines (30k chars) are byte-capped to <= 6.5k with a pointer', () => {
  withSandbox(({ home, state, runtime, pmRepo }) => {
    const full = Array.from({ length: 40 }, (_, i) => `L${i + 1}:${'x'.repeat(740)}`).join('\n') + '\n';
    const res = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_long',
        tool_input: { command: 'cat big.json' },
        tool_response: bashResponse(full),
        cwd: pmRepo,
      },
      { HOME: home, AUTOPILOT_STATE_DIR: state, XDG_RUNTIME_DIR: runtime },
    );
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout).hookSpecificOutput.updatedToolOutput.stdout;
    const file = path.join(runtime, 'autopilot', 'pm-output', 'toolu_long.txt');
    assert.ok(out.length <= 6500, `got ${out.length}`);
    assert.ok(out.includes(`全文：${file}`));
    assert.equal(fs.readFileSync(file, 'utf8'), full);
  });
});
