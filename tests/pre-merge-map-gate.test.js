'use strict';
require('../scripts/lib/test-git-env'); // fixture repos must not run the account's global git config

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WORKTREE_ROOT = path.resolve(__dirname, '..');
const HOOK_SRC = path.join(WORKTREE_ROOT, '.githooks', 'pre-merge-commit');
const CHECKER_SRC = path.join(WORKTREE_ROOT, 'scripts', 'check-architecture-map.js');

const tempDirs = [];

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-merge-map-gate-'));
  tempDirs.push(dir);

  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' });

  const hooksDir = path.join(dir, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookDst = path.join(hooksDir, 'pre-merge-commit');
  fs.copyFileSync(HOOK_SRC, hookDst);
  fs.chmodSync(hookDst, 0o755);

  const scriptsDir = path.join(dir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(CHECKER_SRC, path.join(scriptsDir, 'check-architecture-map.js'));
  fs.writeFileSync(path.join(scriptsDir, 'check-backlog-single-writer.js'), 'process.exit(0);\n'); // stub: this test covers only the map gate

  return dir;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('pre-merge-commit architecture map gate', () => {
  it('(a) allows non-ff merge when ARCHITECTURE.md is complete', () => {
    const repo = makeTempRepo();
    fs.writeFileSync(
      path.join(repo, 'ARCHITECTURE.md'),
      [
        '# Architecture',
        '',
        '| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| feature-a | live | `src/a.js` | spec | 無 | unit test |',
        '',
      ].join('\n')
    );
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'module.exports = 1;\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'init']);

    git(repo, ['checkout', '-b', 'feat/b']);
    fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'module.exports = 2;\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'add b']);

    git(repo, ['checkout', 'main']);
    fs.writeFileSync(path.join(repo, 'README.md'), 'main\n');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-m', 'main commit']);

    const out = git(repo, ['merge', '--no-ff', '--no-edit', 'feat/b']);
    assert.ok(out.includes('Merge made by') || out.includes('feat/b'));
  });

  it('(b) blocks non-ff merge when live row in ARCHITECTURE.md is missing required column', () => {
    const repo = makeTempRepo();
    fs.writeFileSync(
      path.join(repo, 'ARCHITECTURE.md'),
      [
        '# Architecture',
        '',
        '| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| broken-feature | live | `src/a.js` | | CLI | unit test |',
        '',
      ].join('\n')
    );
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'module.exports = 1;\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'init']);

    git(repo, ['checkout', '-b', 'feat/c']);
    fs.writeFileSync(path.join(repo, 'src', 'c.js'), 'module.exports = 3;\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'add c']);

    git(repo, ['checkout', 'main']);
    fs.writeFileSync(path.join(repo, 'README.md'), 'main\n');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-m', 'main commit']);

    assert.throws(
      () => git(repo, ['merge', '--no-ff', '--no-edit', 'feat/c']),
      (err) => {
        const combined = `${err.stdout || ''}\n${err.stderr || ''}`;
        assert.ok(combined.includes('broken-feature'), `Expected output to include 'broken-feature', got:\n${combined}`);
        return true;
      }
    );
  });

  it('(c) allows non-ff merge when ARCHITECTURE.md does not exist', () => {
    const repo = makeTempRepo();
    fs.writeFileSync(path.join(repo, 'README.md'), 'init\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'init']);

    git(repo, ['checkout', '-b', 'feat/d']);
    fs.writeFileSync(path.join(repo, 'd.txt'), 'd\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'add d']);

    git(repo, ['checkout', 'main']);
    fs.writeFileSync(path.join(repo, 'main.txt'), 'main\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'main commit']);

    const out = git(repo, ['merge', '--no-ff', '--no-edit', 'feat/d']);
    assert.ok(out.includes('Merge made by') || out.includes('feat/d'));
  });
});
