'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'check-architecture-map.js');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function initSandboxRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-map-test-'));
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test User');
  fs.writeFileSync(path.join(dir, 'README.md'), '# sandbox\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

function runGate(repo, extraArgs = []) {
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(
      process.execPath,
      [SCRIPT, '--repo', repo, '--base', 'HEAD~1', '--head', 'HEAD', ...extraArgs],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    exitCode = err.status || 1;
    stdout = err.stdout || '';
  }
  const parsed = JSON.parse(stdout.trim());
  return { exitCode, parsed };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// (a) Complete table and diff updates ARCHITECTURE.md -> ok
{
  const repo = initSandboxRepo();
  try {
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'console.log(1);\n');
    fs.writeFileSync(
      path.join(repo, 'ARCHITECTURE.md'),
      [
        '| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| Core | live | src/** | docs/spec.md | 無 | unit test |',
      ].join('\n') + '\n'
    );
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'add app and arch map');

    const { exitCode, parsed } = runGate(repo);
    assert.equal(exitCode, 0);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.findings, []);
  } finally {
    cleanup(repo);
  }
}

// (b) Missing columns -> exit 1
{
  const repo = initSandboxRepo();
  try {
    fs.writeFileSync(
      path.join(repo, 'ARCHITECTURE.md'),
      [
        '| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| Core | live | src/** |  | 無 |  |',
      ].join('\n') + '\n'
    );
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'incomplete row');

    const { exitCode, parsed } = runGate(repo);
    assert.equal(exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.findings[0].rule, 'missing_columns');
    assert.equal(parsed.findings[0].row, 'Core');
  } finally {
    cleanup(repo);
  }
}

// (c) Related row not updated in diff: warn -> exit 0, block -> exit 1
{
  const repo = initSandboxRepo();
  try {
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'console.log(1);\n');
    fs.writeFileSync(
      path.join(repo, 'ARCHITECTURE.md'),
      [
        '| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| Core | live | src/** | docs/spec.md | 無 | unit test |',
      ].join('\n') + '\n'
    );
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'initial arch map');

    fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'console.log(2);\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'update app without arch map');

    const warnRes = runGate(repo, ['--mode', 'warn']);
    assert.equal(warnRes.exitCode, 0);
    assert.equal(warnRes.parsed.ok, true);
    assert.equal(warnRes.parsed.findings[0].rule, 'unupdated_row');

    const blockRes = runGate(repo, ['--mode', 'block']);
    assert.equal(blockRes.exitCode, 1);
    assert.equal(blockRes.parsed.ok, false);
    assert.equal(blockRes.parsed.findings[0].rule, 'unupdated_row');
  } finally {
    cleanup(repo);
  }
}

// (d) Interaction row: missing script -> exit 1; existing tests/interaction/x.sh -> ok
{
  const repo = initSandboxRepo();
  try {
    fs.writeFileSync(
      path.join(repo, 'ARCHITECTURE.md'),
      [
        '| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| CLI | live | bin/** | docs/cli.md | terminal | tests/interaction/x.sh |',
      ].join('\n') + '\n'
    );
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'add cli row without script');

    const missingRes = runGate(repo, ['--mode', 'warn']);
    assert.equal(missingRes.exitCode, 1);
    assert.equal(missingRes.parsed.ok, false);
    assert.equal(missingRes.parsed.findings[0].rule, 'missing_interaction_script');

    fs.mkdirSync(path.join(repo, 'tests', 'interaction'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'tests', 'interaction', 'x.sh'), '#!/bin/sh\nexit 0\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'add interaction script');

    const okRes = runGate(repo);
    assert.equal(okRes.exitCode, 0);
    assert.equal(okRes.parsed.ok, true);
    assert.deepEqual(okRes.parsed.findings, []);
  } finally {
    cleanup(repo);
  }
}

// (e) No ARCHITECTURE.md -> ok with no_map
{
  const repo = initSandboxRepo();
  try {
    const { exitCode, parsed } = runGate(repo);
    assert.equal(exitCode, 0);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.note, 'no_map');
    assert.deepEqual(parsed.findings, []);
  } finally {
    cleanup(repo);
  }
}

// (f) --run-interaction: changed interaction row + script exit 0 -> ok
{
  const repo = initSandboxRepo();
  try {
    fs.mkdirSync(path.join(repo, 'tests', 'interaction'), { recursive: true });
    const scriptPath = path.join(repo, 'tests', 'interaction', 'pass.sh');
    fs.writeFileSync(scriptPath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(scriptPath, 0o755);
    fs.writeFileSync(
      path.join(repo, 'ARCHITECTURE.md'),
      [
        '| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| CLI | live | bin/** | docs/cli.md | terminal | tests/interaction/pass.sh |',
      ].join('\n') + '\n'
    );
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'add passing interaction script');

    const { exitCode, parsed } = runGate(repo, ['--run-interaction']);
    assert.equal(exitCode, 0);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.findings, []);
  } finally {
    cleanup(repo);
  }
}

// (g) --run-interaction: changed interaction row + script exit 1 -> interaction_script_failed
{
  const repo = initSandboxRepo();
  try {
    fs.mkdirSync(path.join(repo, 'tests', 'interaction'), { recursive: true });
    const scriptPath = path.join(repo, 'tests', 'interaction', 'fail.sh');
    fs.writeFileSync(scriptPath, '#!/bin/sh\necho "boom" >&2\nexit 1\n');
    fs.chmodSync(scriptPath, 0o755);
    fs.writeFileSync(
      path.join(repo, 'ARCHITECTURE.md'),
      [
        '| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| CLI | live | bin/** | docs/cli.md | terminal | tests/interaction/fail.sh |',
      ].join('\n') + '\n'
    );
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'add failing interaction script');

    const { exitCode, parsed } = runGate(repo, ['--run-interaction']);
    assert.equal(exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.findings[0].rule, 'interaction_script_failed');
    assert.ok(parsed.findings[0].detail.includes('tests/interaction/fail.sh'));
    assert.ok(parsed.findings[0].detail.includes('boom'));
  } finally {
    cleanup(repo);
  }
}

// (h) --run-interaction: unchanged interaction row is not executed even if script would fail
{
  const repo = initSandboxRepo();
  try {
    fs.mkdirSync(path.join(repo, 'tests', 'interaction'), { recursive: true });
    const scriptPath = path.join(repo, 'tests', 'interaction', 'fail.sh');
    fs.writeFileSync(scriptPath, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(scriptPath, 0o755);
    fs.writeFileSync(
      path.join(repo, 'ARCHITECTURE.md'),
      [
        '| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| CLI | live | bin/** | docs/cli.md | terminal | tests/interaction/fail.sh |',
      ].join('\n') + '\n'
    );
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'initial arch map with failing script');

    fs.writeFileSync(path.join(repo, 'README.md'), '# updated\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'unrelated change');

    const { exitCode, parsed } = runGate(repo, ['--mode', 'warn', '--run-interaction']);
    assert.equal(exitCode, 0);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.findings, []);
  } finally {
    cleanup(repo);
  }
}

console.log('All 8 architecture map gate test cases passed.');
